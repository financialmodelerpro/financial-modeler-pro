import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getWatchEnforcement, canCompleteWith } from '@/src/lib/training/watchEnforcementCheck';
import { detectVideoChange } from '@/src/lib/training/detectVideoChange';

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
    .select('status, watch_seconds, total_seconds, last_position, updated_at')
    .eq('student_email', email)
    .eq('tab_key', tab_key)
    .maybeSingle();

  // Guard: don't downgrade 'completed' → 'in_progress'. Still merge progress fields though.
  let effectiveStatus = existing?.status === 'completed' ? 'completed' : status;

  const existingSec   = Number(existing?.watch_seconds ?? 0);
  const existingTotal = Number(existing?.total_seconds ?? 0);
  const incomingSec   = typeof body.watch_seconds === 'number' ? Math.max(0, Math.round(body.watch_seconds)) : null;
  const incomingTotal = typeof body.total_seconds === 'number' ? Math.max(0, Math.round(body.total_seconds)) : null;

  // Auto-detect video swap: if the admin replaced this session's video,
  // the stored total_seconds will disagree meaningfully from what the
  // new YT player reports. In that case, keeping the stale progress
  // would make watch_percentage nonsense — reset to the incoming
  // values so this student starts fresh on the new video. Works for
  // any session_type (3SFM, BVM, future courses) since the detection
  // lives in a shared helper.
  const verdict = incomingTotal !== null
    ? detectVideoChange(existingTotal, incomingTotal)
    : { changed: false };

  let mergedWatch: number;
  let mergedTotal: number;

  if (verdict.changed) {
    console.log('[video-change-detected] certification-watch reset', {
      email, tab_key, reason: verdict.reason,
    });
    mergedWatch     = incomingSec ?? 0;
    mergedTotal     = incomingTotal!;
    effectiveStatus = 'in_progress'; // demote even if previously completed — new video = new requirement
  } else {
    // Same video (or can't tell) — MAX merge as before. Wall-clock rate
    // limit keeps a tampered client from posting a huge watch_seconds
    // in one shot.
    let clampedIncoming = incomingSec;
    const existingUpdatedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : null;
    if (clampedIncoming !== null && existingUpdatedAt && clampedIncoming > existingSec) {
      const realElapsedSec = Math.max(0, (Date.now() - existingUpdatedAt) / 1000) + 5; // 5s buffer
      const maxAllowed = existingSec + realElapsedSec;
      if (clampedIncoming > maxAllowed) {
        console.warn('[certification-watch] clamped watch_seconds (too fast)', {
          tab_key, email, existingSec, incomingSec: clampedIncoming, clampedTo: Math.round(maxAllowed), realElapsedSec,
        });
        clampedIncoming = Math.round(maxAllowed);
      }
    }
    mergedWatch = clampedIncoming === null ? existingSec : Math.max(existingSec, clampedIncoming);
    mergedTotal = incomingTotal === null ? existingTotal : Math.max(existingTotal, incomingTotal);
  }

  const pct = mergedTotal > 0 ? Math.min(100, Math.max(0, Math.round((mergedWatch / mergedTotal) * 100))) : 0;

  // Server-side enforcement: refuse to flip this row to 'completed' when the
  // stored watch percentage is still below threshold. The client tracker caps
  // intervals by wall-clock elapsed time, and this check makes a tampered
  // submit (status='completed' with fabricated values) bounce with 403.
  const wantsCompleted = effectiveStatus === 'completed' && existing?.status !== 'completed';
  if (wantsCompleted) {
    const enforcement = await getWatchEnforcement(tab_key);
    if (!canCompleteWith(enforcement, pct)) {
      console.warn('[certification-watch] Completion rejected — below threshold', {
        tab_key, email, pct, threshold: enforcement.threshold,
        mergedWatch, mergedTotal,
      });
      return NextResponse.json({
        success: false,
        error: 'Watch threshold not met',
        current: pct,
        required: enforcement.threshold,
      }, { status: 403 });
    }
  }
  console.log('[certification-watch] upsert', {
    tab_key, email, status: effectiveStatus, mergedWatch, mergedTotal, pct,
  });

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
  // On a detected video swap, clear the old completed_at so the row
  // doesn't present as "still completed" on the new video.
  if (verdict.changed) {
    record.completed_at = null;
    record.last_position = typeof body.last_position === 'number' ? Math.max(0, Math.round(body.last_position)) : 0;
  }

  const { error } = await sb
    .from('certification_watch_history')
    .upsert(record, { onConflict: 'student_email,tab_key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, watch_seconds: mergedWatch, total_seconds: mergedTotal, watch_percentage: pct });
}
