import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

interface WatchedPayload {
  email: string;
  regId?: string;
  status?: 'in_progress' | 'completed';
  watch_seconds?: number;
  total_seconds?: number;
  last_position?: number;
}

/**
 * POST /api/training/live-sessions/[id]/watched
 *
 * Unified endpoint for both progress ticks (fired ~every 10s from the
 * YouTubePlayer interval-merging tracker) and the final Mark Complete action.
 *
 * Body:
 *   { email, regId, status?, watch_seconds?, total_seconds?, last_position? }
 *
 * - `status` defaults to 'completed' for backwards compatibility with callers
 *   that just want to mark a recording watched (+50 points, awarded once).
 * - When progress fields are provided we use MAX(existing, incoming) so a stale
 *   client update can never shrink a student's progress on refresh.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = (await req.json()) as WatchedPayload;
    const { email, regId = '', status = 'completed', watch_seconds, total_seconds, last_position } = body;
    if (!email) return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });

    const sb = getServerClient();

    // Current row (if any)
    const { data: existing } = await sb
      .from('session_watch_history')
      .select('id, status, watch_seconds, total_seconds, watch_percentage, points_awarded')
      .eq('session_id', id)
      .eq('student_email', email)
      .maybeSingle();

    const incomingWatchSec = Math.max(0, Math.round(watch_seconds ?? 0));
    const incomingTotalSec = Math.max(0, Math.round(total_seconds ?? 0));
    const incomingPos      = Math.max(0, Math.round(last_position ?? 0));

    const mergedWatchSec = Math.max(existing?.watch_seconds ?? 0, incomingWatchSec);
    const mergedTotalSec = Math.max(existing?.total_seconds ?? 0, incomingTotalSec);
    const pct = mergedTotalSec > 0
      ? Math.min(100, Math.round((mergedWatchSec / mergedTotalSec) * 100))
      : status === 'completed' ? 100 : existing?.watch_percentage ?? 0;
    // Once completed, stay completed — progress ticks shouldn't demote back.
    const mergedStatus = existing?.status === 'completed' || status === 'completed' ? 'completed' : 'in_progress';

    const shouldAwardPoints =
      mergedStatus === 'completed' && (!existing || (existing.points_awarded ?? 0) === 0);

    const nowIso = new Date().toISOString();

    const upsertRow: Record<string, unknown> = {
      session_id:       id,
      student_email:    email,
      student_reg_id:   regId,
      status:           mergedStatus,
      watch_seconds:    mergedWatchSec,
      total_seconds:    mergedTotalSec,
      last_position:    incomingPos,
      watch_percentage: pct,
      updated_at:       nowIso,
    };
    if (shouldAwardPoints) {
      upsertRow.points_awarded = 50;
      upsertRow.watched_at = nowIso;
    }

    const { error: upsertErr } = await sb
      .from('session_watch_history')
      .upsert(upsertRow, { onConflict: 'session_id,student_email' });

    if (upsertErr) {
      console.error('[watched] Upsert error:', upsertErr.message);
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
    }

    // Award 50 points exactly once — when the row transitions into completed.
    if (shouldAwardPoints && regId) {
      const { data: profile } = await sb
        .from('student_profiles')
        .select('total_points')
        .eq('registration_id', regId)
        .maybeSingle();
      if (profile) {
        await sb
          .from('student_profiles')
          .update({ total_points: (profile.total_points ?? 0) + 50 })
          .eq('registration_id', regId);
      }
    }

    return NextResponse.json({
      success: true,
      pointsAwarded: shouldAwardPoints ? 50 : 0,
      alreadyWatched: !!existing && existing.status === 'completed',
      watch_percentage: pct,
      watch_seconds: mergedWatchSec,
      total_seconds: mergedTotalSec,
      status: mergedStatus,
    });
  } catch (e) {
    console.error('[watched] Error:', e);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

/**
 * GET /api/training/live-sessions/[id]/watched?email=...
 * Returns the student's current watch state for the session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ status: 'not_started', watch_percentage: 0, watch_seconds: 0, total_seconds: 0 });

  const sb = getServerClient();
  const { data } = await sb
    .from('session_watch_history')
    .select('status, watch_percentage, watch_seconds, total_seconds, last_position, watched_at')
    .eq('session_id', id)
    .eq('student_email', email)
    .maybeSingle();

  if (!data) return NextResponse.json({ status: 'not_started', watch_percentage: 0, watch_seconds: 0, total_seconds: 0 });
  return NextResponse.json(data);
}
