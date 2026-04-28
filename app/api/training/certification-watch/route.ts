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

/**
 * GET /api/training/certification-watch?email=x
 * Returns all certification watch history records for a student
 * (tab_key, status, timing, watch_seconds / watch_percentage / last_position
 *  + watch_intervals JSONB so the player can hydrate the tracker on mount).
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ history: [] });

  const sb = getServerClient();
  const { data } = await sb
    .from('certification_watch_history')
    .select('tab_key, status, started_at, completed_at, watch_seconds, total_seconds, watch_percentage, last_position, watch_intervals')
    .eq('student_email', email.toLowerCase());

  return NextResponse.json({ history: data ?? [] });
}

/**
 * POST /api/training/certification-watch
 * Upserts a watch record. Body: {
 *   student_email, tab_key, course_id, status,
 *   watch_seconds?, total_seconds?, last_position?,
 *   watch_intervals?  (snapshot from the client tracker; migration 146)
 * }
 *
 * Guards:
 *  - 'completed' is a terminal state (never downgraded back to 'in_progress'
 *    except on a detected video swap which deliberately resets).
 *  - watch_seconds is derived from `union(existing_intervals, incoming_intervals)`
 *    when intervals are provided. For legacy clients that omit intervals we
 *    fall back to MAX(existing, incoming) on the scalar so stale or
 *    lower-value updates never shrink the persisted progress.
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
    watch_intervals?: unknown;
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

  // Read existing row for terminal-status guard, MAX merging, and the
  // existing intervals JSONB to union with the incoming snapshot.
  const { data: existing } = await sb
    .from('certification_watch_history')
    .select('status, watch_seconds, total_seconds, last_position, updated_at, watch_intervals')
    .eq('student_email', email)
    .eq('tab_key', tab_key)
    .maybeSingle();

  // Guard: don't downgrade 'completed' -> 'in_progress'. Still merge
  // progress fields though. Exception below: when video-swap detection
  // fires, effectiveStatus is reset to 'in_progress' since the new
  // video has its own threshold to clear.
  let effectiveStatus = existing?.status === 'completed' ? 'completed' : status;

  const existingSec   = Number(existing?.watch_seconds ?? 0);
  const existingTotal = Number(existing?.total_seconds ?? 0);
  const incomingSec   = typeof body.watch_seconds === 'number' ? Math.max(0, Math.round(body.watch_seconds)) : null;
  const incomingTotal = typeof body.total_seconds === 'number' ? Math.max(0, Math.round(body.total_seconds)) : null;

  // Hydrate intervals from both sides. `existing.watch_intervals` is the
  // JSONB column added by migration 146; pre-migration rows / new rows
  // before the column was populated arrive as `[]` or undefined.
  const existingIntervals: Interval[] = hydrateIntervals(existing?.watch_intervals ?? []);
  const incomingIntervals: Interval[] = body.watch_intervals !== undefined
    ? hydrateIntervals(body.watch_intervals)
    : [];
  const intervalsProvided = body.watch_intervals !== undefined;

  // Auto-detect video swap: if the admin replaced this session's video,
  // the stored total_seconds will disagree meaningfully from what the
  // new YT player reports. Keeping the stale progress would make
  // watch_percentage nonsense -- reset to the incoming values + drop
  // the prior intervals (those refer to a different video).
  const verdict = incomingTotal !== null
    ? detectVideoChange(existingTotal, incomingTotal)
    : { changed: false };

  let mergedWatch: number;
  let mergedTotal: number;
  let mergedIntervals: Interval[];

  if (verdict.changed) {
    console.log('[video-change-detected] certification-watch reset', {
      email, tab_key, reason: verdict.reason,
    });
    mergedIntervals = incomingIntervals;
    mergedWatch     = intervalsProvided ? sumIntervals(mergedIntervals) : (incomingSec ?? 0);
    mergedTotal     = incomingTotal!;
    effectiveStatus = 'in_progress'; // demote even if previously completed -- new video = new requirement
  } else if (intervalsProvided) {
    // Cross-session union -- THE smoking-gun fix. Pre-migration the
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
    if (existingUpdatedAt && intervalSeconds > existingSec) {
      const realElapsedSec = Math.max(0, (Date.now() - existingUpdatedAt) / 1000) + 5; // 5s buffer
      const maxAllowed = existingSec + realElapsedSec;
      if (intervalSeconds > maxAllowed) {
        console.warn('[certification-watch] clamped intervals (too fast); discarding incoming', {
          tab_key, email, existingSec, intervalSeconds, maxAllowed: Math.round(maxAllowed), realElapsedSec,
        });
        // Refuse the new portion entirely. The existing JSONB stays
        // authoritative. watch_seconds is held at the existing scalar
        // (or the incoming clamp ceiling, whichever is lower).
        mergedIntervals = existingIntervals;
        mergedWatch     = existingSec;
      } else {
        // Take MAX with the legacy scalar so a row whose intervals
        // JSONB was empty pre-migration doesn't lose its old credit.
        mergedWatch = Math.max(existingSec, intervalSeconds);
      }
    } else {
      mergedWatch = Math.max(existingSec, intervalSeconds);
    }
    mergedTotal = incomingTotal === null ? existingTotal : Math.max(existingTotal, incomingTotal);
  } else {
    // Legacy client (no intervals in body). MAX-merge the scalar like
    // the pre-146 behaviour. Wall-clock clamp keeps fabrication slow.
    let clampedIncoming = incomingSec;
    const existingUpdatedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : null;
    if (clampedIncoming !== null && existingUpdatedAt && clampedIncoming > existingSec) {
      const realElapsedSec = Math.max(0, (Date.now() - existingUpdatedAt) / 1000) + 5;
      const maxAllowed = existingSec + realElapsedSec;
      if (clampedIncoming > maxAllowed) {
        console.warn('[certification-watch] clamped watch_seconds (too fast)', {
          tab_key, email, existingSec, incomingSec: clampedIncoming, clampedTo: Math.round(maxAllowed), realElapsedSec,
        });
        clampedIncoming = Math.round(maxAllowed);
      }
    }
    mergedIntervals = existingIntervals; // unchanged on legacy POSTs
    mergedWatch     = clampedIncoming === null ? existingSec : Math.max(existingSec, clampedIncoming);
    mergedTotal     = incomingTotal === null ? existingTotal : Math.max(existingTotal, incomingTotal);
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
      console.warn('[certification-watch] Completion rejected -- below threshold', {
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
    intervalsProvided, intervalCount: mergedIntervals.length,
  });

  const record: Record<string, unknown> = {
    student_email: email,
    tab_key,
    course_id,
    status: effectiveStatus,
    watch_seconds: mergedWatch,
    total_seconds: mergedTotal,
    watch_percentage: pct,
    watch_intervals: serializeIntervals(mergedIntervals),
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
  return NextResponse.json({
    success: true,
    watch_seconds: mergedWatch,
    total_seconds: mergedTotal,
    watch_percentage: pct,
    watch_intervals: serializeIntervals(mergedIntervals),
  });
}
