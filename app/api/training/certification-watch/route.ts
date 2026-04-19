import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getWatchEnforcement, canCompleteWith } from '@/src/lib/training/watchEnforcementCheck';

/**
 * GET /api/training/certification-watch?email=x
 * Returns all certification watch history records for a student
 * (tab_key, status, timing, watch_seconds / watch_percentage / last_position).
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ history: [] });

  const sb = getServerClient();
  const { data } = await sb
    .from('certification_watch_history')
    .select('tab_key, status, started_at, completed_at, watch_seconds, total_seconds, watch_percentage, last_position')
    .eq('student_email', email.toLowerCase());

  return NextResponse.json({ history: data ?? [] });
}

/**
 * POST /api/training/certification-watch
 * Upserts a watch record. Body: {
 *   student_email, tab_key, course_id, status,
 *   watch_seconds?, total_seconds?, last_position?  (optional progress fields)
 * }
 *
 * Guards:
 *  - 'completed' is a terminal state — never downgraded back to 'in_progress'
 *  - watch_seconds uses MAX(existing, incoming) so stale or lower-value updates
 *    never shrink the persisted progress
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    student_email?: string;
    tab_key?: string;
    course_id?: string;
    status?: string;
    watch_seconds?: number;
    total_seconds?: number;
    last_position?: number;
  };

  const { student_email, tab_key, course_id, status } = body;
  if (!student_email || !tab_key || !course_id || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (status !== 'in_progress' && status !== 'completed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const sb = getServerClient();
  const email = student_email.toLowerCase();

  // Read existing row for terminal-status guard + MAX merging
  const { data: existing } = await sb
    .from('certification_watch_history')
    .select('status, watch_seconds, total_seconds, last_position')
    .eq('student_email', email)
    .eq('tab_key', tab_key)
    .maybeSingle();

  // Guard: don't downgrade 'completed' → 'in_progress'. Still merge progress fields though.
  const effectiveStatus = existing?.status === 'completed' ? 'completed' : status;

  const existingSec = Number(existing?.watch_seconds ?? 0);
  const incomingSec = typeof body.watch_seconds === 'number' ? Math.max(0, Math.round(body.watch_seconds)) : null;
  const mergedWatch = incomingSec === null ? existingSec : Math.max(existingSec, incomingSec);

  const existingTotal = Number(existing?.total_seconds ?? 0);
  const incomingTotal = typeof body.total_seconds === 'number' ? Math.max(0, Math.round(body.total_seconds)) : null;
  const mergedTotal = incomingTotal === null ? existingTotal : Math.max(existingTotal, incomingTotal);

  const pct = mergedTotal > 0 ? Math.min(100, Math.max(0, Math.round((mergedWatch / mergedTotal) * 100))) : 0;

  // Server-side enforcement: refuse to flip this row to 'completed' when the
  // stored watch percentage is still below threshold. The client tracker caps
  // intervals by wall-clock elapsed time, and this check makes a tampered
  // submit (status='completed' with fabricated values) bounce with 403.
  const wantsCompleted = effectiveStatus === 'completed' && existing?.status !== 'completed';
  if (wantsCompleted) {
    const enforcement = await getWatchEnforcement(tab_key);
    if (!canCompleteWith(enforcement, pct)) {
      return NextResponse.json({
        success: false,
        error: 'Watch threshold not met',
        current: pct,
        required: enforcement.threshold,
      }, { status: 403 });
    }
  }

  const record: Record<string, unknown> = {
    student_email: email,
    tab_key,
    course_id,
    status: effectiveStatus,
    watch_seconds: mergedWatch,
    total_seconds: mergedTotal,
    watch_percentage: pct,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.last_position === 'number') record.last_position = Math.max(0, Math.round(body.last_position));
  if (effectiveStatus === 'completed' && existing?.status !== 'completed') {
    record.completed_at = new Date().toISOString();
  }

  const { error } = await sb
    .from('certification_watch_history')
    .upsert(record, { onConflict: 'student_email,tab_key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, watch_seconds: mergedWatch, total_seconds: mergedTotal, watch_percentage: pct });
}
