import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getWatchEnforcement, canCompleteWith } from '@/src/lib/training/watchEnforcementCheck';
import { detectVideoChange } from '@/src/lib/training/detectVideoChange';
import {
  hydrateIntervals,
  unionIntervals,
  serializeIntervals,
  sumIntervals,
  type Interval,
} from '@/src/lib/training/watchTracker';

export const dynamic = 'force-dynamic';

interface WatchedPayload {
  email: string;
  regId?: string;
  status?: 'in_progress' | 'completed';
  watch_seconds?: number;
  total_seconds?: number;
  last_position?: number;
  watch_intervals?: unknown;
}

/**
 * POST /api/training/live-sessions/[id]/watched
 *
 * Unified endpoint for both progress ticks (fired ~every 10s from the
 * YouTubePlayer interval-merging tracker) and the final Mark Complete action.
 *
 * Body:
 *   { email, regId, status?, watch_seconds?, total_seconds?, last_position?, watch_intervals? }
 *
 * - `status` defaults to 'completed' for backwards compatibility with callers
 *   that just want to mark a recording watched (+50 points, awarded once).
 * - When `watch_intervals` is provided we union them with the existing JSONB
 *   column (migration 146) and recompute watch_seconds from the merged set.
 *   Legacy callers that omit intervals fall back to MAX(existing, incoming)
 *   on the scalar so stale updates never shrink the persisted progress.
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

    // Current row (if any). Now also reads watch_intervals JSONB so we can
    // union with the incoming snapshot for cross-session accumulation.
    const { data: existing } = await sb
      .from('session_watch_history')
      .select('id, status, watch_seconds, total_seconds, watch_percentage, points_awarded, updated_at, watch_intervals')
      .eq('session_id', id)
      .eq('student_email', email)
      .maybeSingle();

    const incomingWatchSec = Math.max(0, Math.round(watch_seconds ?? 0));
    const incomingTotalSec = Math.max(0, Math.round(total_seconds ?? 0));
    const incomingPos      = Math.max(0, Math.round(last_position ?? 0));
    const existingWatchSec = Math.max(0, Math.round(existing?.watch_seconds ?? 0));
    const existingTotalSec = Math.max(0, Math.round(existing?.total_seconds ?? 0));

    // Hydrate intervals from both sides. `existing.watch_intervals` is the
    // JSONB column added by migration 146; pre-migration rows arrive as
    // `[]` or undefined.
    const existingIntervals: Interval[] = hydrateIntervals(existing?.watch_intervals ?? []);
    const incomingIntervals: Interval[] = body.watch_intervals !== undefined
      ? hydrateIntervals(body.watch_intervals)
      : [];
    const intervalsProvided = body.watch_intervals !== undefined;

    // Auto-detect video swap. If the admin replaced this session's video
    // the stored total_seconds will disagree meaningfully from what the
    // new YT player reports. Keeping the stale progress would make
    // watch_percentage nonsense — reset to the incoming values so the
    // student starts fresh on the new video. Shared helper so 3SFM /
    // BVM sessions and any future session type inherit the same rule.
    const verdict = incomingTotalSec > 0
      ? detectVideoChange(existingTotalSec, incomingTotalSec)
      : { changed: false };

    let mergedWatchSec: number;
    let mergedTotalSec: number;
    let mergedIntervals: Interval[];

    if (verdict.changed) {
      console.log('[video-change-detected] live-session watched reset', {
        session_id: id, email, reason: verdict.reason,
      });
      // Reset to incoming values — new video, fresh start. Drop the prior
      // intervals (they refer to a different video). The completion guard
      // below still runs, so a reset row won't flip to 'completed'
      // unless the new incoming values clear threshold.
      mergedIntervals = incomingIntervals;
      mergedWatchSec  = intervalsProvided ? sumIntervals(mergedIntervals) : incomingWatchSec;
      mergedTotalSec  = incomingTotalSec;
    } else if (intervalsProvided) {
      // Cross-session union — the smoking-gun fix. Pre-migration the
      // tracker was seeded with `baseline = persisted_watch_seconds` only,
      // so a multi-session viewer's prior intervals weren't available to
      // merge. Now the JSONB column carries them and the union below
      // makes cumulative coverage actually accumulate.
      mergedIntervals = unionIntervals(existingIntervals, incomingIntervals);
      const intervalSeconds = sumIntervals(mergedIntervals);

      // Wall-clock rate limit: total credited seconds can't grow faster
      // than real time between updates. A tampered client posting a
      // huge interval list in one shot bounces. The existing intervals
      // are trusted (they were already persisted); we only rate-limit
      // the new portion.
      const existingUpdatedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : null;
      if (existingUpdatedAt && intervalSeconds > existingWatchSec) {
        const realElapsedSec = Math.max(0, (Date.now() - existingUpdatedAt) / 1000) + 5; // 5s buffer
        const maxAllowed = existingWatchSec + realElapsedSec;
        if (intervalSeconds > maxAllowed) {
          console.warn('[watched] clamped intervals (too fast); discarding incoming', {
            session_id: id, email, existingWatchSec, intervalSeconds, maxAllowed: Math.round(maxAllowed), realElapsedSec,
          });
          // Refuse the new portion entirely. The existing JSONB stays
          // authoritative. watch_seconds is held at the existing scalar.
          mergedIntervals = existingIntervals;
          mergedWatchSec  = existingWatchSec;
        } else {
          // Take MAX with the legacy scalar so a row whose intervals
          // JSONB was empty pre-migration doesn't lose its old credit.
          mergedWatchSec = Math.max(existingWatchSec, intervalSeconds);
        }
      } else {
        mergedWatchSec = Math.max(existingWatchSec, intervalSeconds);
      }
      mergedTotalSec = Math.max(existingTotalSec, incomingTotalSec);
    } else {
      // Legacy client (no intervals in body). Apply the same wall-clock
      // clamp on the scalar then MAX-merge.
      let clampedIncoming = incomingWatchSec;
      const existingUpdatedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : null;
      if (existingUpdatedAt && incomingWatchSec > existingWatchSec) {
        const realElapsedSec = Math.max(0, (Date.now() - existingUpdatedAt) / 1000) + 5;
        const maxAllowed = existingWatchSec + realElapsedSec;
        if (clampedIncoming > maxAllowed) {
          console.warn('[watched] clamped watch_seconds (too fast)', {
            session_id: id, email, existingWatchSec, incomingWatchSec, clampedTo: Math.round(maxAllowed), realElapsedSec,
          });
          clampedIncoming = Math.round(maxAllowed);
        }
      }
      mergedIntervals = existingIntervals; // unchanged on legacy POSTs
      mergedWatchSec  = Math.max(existingWatchSec, clampedIncoming);
      mergedTotalSec  = Math.max(existingTotalSec, incomingTotalSec);
    }

    // Always compute pct from ACTUAL seconds — never trust `status='completed'`
    // alone to imply 100%. If total_seconds is unknown we fall back to the
    // stored percentage so we never accidentally demote a valid prior
    // completion — except on a detected video swap, where we deliberately
    // reset against the new total.
    const pct = mergedTotalSec > 0
      ? Math.min(100, Math.max(0, Math.round((mergedWatchSec / mergedTotalSec) * 100)))
      : verdict.changed ? 0 : existing?.watch_percentage ?? 0;

    // Server-side enforcement: reject an attempt to flip this row to
    // `completed` when the actual stored watch percentage is still below the
    // admin-configured threshold. Belt and braces — the client tracker caps
    // intervals by wall-clock, this rejects a tampered submit.
    const wantsCompleted = status === 'completed' && existing?.status !== 'completed';
    if (wantsCompleted) {
      const enforcement = await getWatchEnforcement(`LIVE_${id}`);
      if (!canCompleteWith(enforcement, pct)) {
        console.warn('[watched] Completion rejected — below threshold', {
          session_id: id, email, pct, threshold: enforcement.threshold,
          mergedWatchSec, mergedTotalSec, incomingWatchSec, incomingTotalSec,
        });
        return NextResponse.json({
          success: false,
          error: 'Watch threshold not met',
          current: pct,
          required: enforcement.threshold,
        }, { status: 403 });
      }
    }

    console.log('[watched] upsert', {
      session_id: id, email, status, mergedStatus: existing?.status === 'completed' || status === 'completed' ? 'completed' : 'in_progress',
      mergedWatchSec, mergedTotalSec, pct, intervalsProvided, intervalCount: mergedIntervals.length,
    });

    // Once completed, stay completed — progress ticks shouldn't demote back.
    // EXCEPT on a detected video swap: the old completion was against a
    // different video and is no longer valid. Demote to in_progress so
    // the student has to watch the new video past the threshold.
    const mergedStatus = verdict.changed
      ? 'in_progress'
      : (existing?.status === 'completed' || status === 'completed' ? 'completed' : 'in_progress');

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
      watch_intervals:  serializeIntervals(mergedIntervals),
      updated_at:       nowIso,
    };
    if (shouldAwardPoints) {
      upsertRow.points_awarded = 50;
      upsertRow.watched_at = nowIso;
    }
    // Video-swap reset: clear the legacy completion timestamp + points
    // flag so the new video's completion re-awards cleanly.
    if (verdict.changed) {
      upsertRow.watched_at     = null;
      upsertRow.points_awarded = 0;
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
      watch_intervals: serializeIntervals(mergedIntervals),
      status: mergedStatus,
    });
  } catch (e) {
    console.error('[watched] Error:', e);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

/**
 * GET /api/training/live-sessions/[id]/watched?email=...
 * Returns the student's current watch state for the session including the
 * watch_intervals JSONB so the player can hydrate the tracker on mount.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ status: 'not_started', watch_percentage: 0, watch_seconds: 0, total_seconds: 0, watch_intervals: [] });

  const sb = getServerClient();
  const { data } = await sb
    .from('session_watch_history')
    .select('status, watch_percentage, watch_seconds, total_seconds, last_position, watched_at, watch_intervals')
    .eq('session_id', id)
    .eq('student_email', email)
    .maybeSingle();

  if (!data) return NextResponse.json({ status: 'not_started', watch_percentage: 0, watch_seconds: 0, total_seconds: 0, watch_intervals: [] });
  return NextResponse.json(data);
}
