/**
 * watchTracker -- records actual playback time as [start, end] intervals
 * and merges overlaps on every commit so seeking forward/back/replaying
 * does NOT inflate the total. Enforces:
 *
 *     "Watch >= threshold% of the video before Mark Complete becomes available."
 *
 * Semantics:
 *   - `onPlay(pos)` closes any open interval first (FIX 2.1, see below),
 *     then opens a new interval at `pos` and records wall-clock time.
 *   - `onTick(pos)` extends the open interval -- but a seek (position jumps
 *     faster than wall-clock allows) closes the old interval and opens a new
 *     one at the new position; the skipped range is NOT credited.
 *   - `onPause(pos)` / `onEnded(pos)` / `onClose(pos)` close the open interval.
 *   - `watchedSeconds` = sum of lengths of all merged intervals (plus the
 *     bounded open interval if any), with the persisted baseline as a floor.
 *
 * Persistence (migration 146):
 *   - The tracker now accepts an `initialIntervals` array on construction
 *     and merges it into the closed intervals so cross-session resumes
 *     correctly union prior watch with the current session. Without this,
 *     multi-session viewers would stay frozen at their largest-single-run
 *     percentage (the smoking-gun bug Fakhri experienced).
 *   - `snapshotIntervals(state, livePos)` returns the intervals INCLUDING
 *     the bounded open interval as if it were closed at the current
 *     position -- callers POST this snapshot to the server so the JSONB
 *     column always reflects what the student actually watched, not just
 *     intervals that happened to be closed at report time.
 *   - `unionIntervals(a, b)` is the server-side merge primitive.
 *
 * Security property:
 *   Every accepted interval length is bounded by wall-clock elapsed time
 *   since `openStart` (plus a small 1.5s buffer for frame timing). A user
 *   who drags the playhead to the end of a 10-minute video and triggers
 *   ENDED cannot fabricate a 600-second interval -- the tracker caps the
 *   end at `openStart + wallElapsed + buffer` regardless of the `pos` the
 *   player reports. Combined with server-side threshold enforcement this
 *   makes skip-to-end infeasible.
 *
 * Intentionally tiny / framework-agnostic so it can be unit-tested if
 * needed.
 */

export type Interval = readonly [start: number, end: number];

export interface WatchTrackerState {
  /** Sorted, merged, non-overlapping intervals. */
  intervals: Interval[];
  /** Open interval's start position (video seconds), or null if not playing. */
  openStart: number | null;
  /** Wall-clock epoch (ms) when `openStart` was set. */
  openStartAt: number | null;
  /** Most recent known position (for seek detection). */
  lastPos: number;
  /** Wall-clock epoch (ms) of the most recent tick update. */
  lastTickAt: number | null;
  /** Seed value for watched seconds already persisted server-side as a
   *  scalar. Acts as a FLOOR so a legacy row whose `watch_intervals` is
   *  `[]` doesn't silently drop below `persisted_watch_seconds` when the
   *  current session's intervals are shorter. New rows whose
   *  `watch_intervals` is populated set baseline to the same scalar so
   *  the floor is consistent with what's persisted. */
  baseline: number;
}

/** Small buffer for clock / frame timing jitter (seconds). */
const CLOCK_BUFFER_SEC = 1.5;

/**
 * Construct a fresh tracker. `initialIntervals` is optional and used by
 * the player on mount to seed the tracker with a student's prior
 * cross-session watch history. Pass it the JSONB column hydrated via
 * `hydrateIntervals`. The merged intervals from prior sessions are
 * union-merged into `intervals` so the tracker treats them as already
 * closed -- subsequent live playback adds new closed intervals on top.
 */
export function makeWatchTracker(
  baselineWatchedSeconds = 0,
  initialIntervals: ReadonlyArray<Interval> = [],
): WatchTrackerState {
  return {
    intervals: insertAndMergeMany(initialIntervals),
    openStart: null,
    openStartAt: null,
    lastPos: 0,
    lastTickAt: null,
    baseline: Math.max(0, Math.round(baselineWatchedSeconds)),
  };
}

function insertAndMerge(intervals: Interval[], next: Interval): Interval[] {
  const [ns, ne] = next;
  if (ne <= ns) return intervals;
  const all = [...intervals, next].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const iv of all) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], iv[1])];
    } else {
      merged.push(iv);
    }
  }
  return merged;
}

function insertAndMergeMany(intervals: ReadonlyArray<Interval>): Interval[] {
  let merged: Interval[] = [];
  for (const iv of intervals) merged = insertAndMerge(merged, [iv[0], iv[1]]);
  return merged;
}

/** Total seconds covered by a closed interval list. Exported for server use. */
export function sumIntervals(intervals: ReadonlyArray<Interval>): number {
  let s = 0;
  for (const [a, b] of intervals) s += Math.max(0, b - a);
  return s;
}

/**
 * Compute the maximum legal end position given wall-clock elapsed time.
 * Clamps `pos` so a single interval can never exceed real elapsed time --
 * this is the core defence against the skip-to-end attack.
 */
function clampEnd(openStart: number, openStartAt: number | null, pos: number, nowMs: number): number {
  if (openStartAt === null) return openStart; // paranoid -- no wall-clock anchor
  const wallElapsedSec = Math.max(0, (nowMs - openStartAt) / 1000) + CLOCK_BUFFER_SEC;
  const maxEnd = openStart + wallElapsedSec;
  const proposed = Math.max(openStart, pos);
  return Math.min(proposed, maxEnd);
}

/** Total watched seconds, including any open interval currently in progress and the persisted baseline. */
export function watchedSeconds(s: WatchTrackerState, livePos?: number, nowMs: number = Date.now()): number {
  const base = sumIntervals(s.intervals);
  let open = 0;
  if (s.openStart !== null && livePos !== undefined && livePos > s.openStart) {
    const capped = clampEnd(s.openStart, s.openStartAt, livePos, nowMs);
    open = Math.max(0, capped - s.openStart);
  }
  // base + open counts new + cross-session merged intervals. Take max with
  // baseline so a legacy row whose `watch_intervals` is empty still keeps
  // the persisted scalar as a floor.
  return Math.max(s.baseline, Math.round(base + open));
}

/**
 * Snapshot the tracker as a list of CLOSED intervals, virtually closing
 * the open interval at the current position (clamped by wall-clock).
 * This is what callers POST to the server -- the persisted JSONB always
 * reflects the student's actual watch, not just intervals that happened
 * to be closed at report time.
 */
export function snapshotIntervals(s: WatchTrackerState, livePos?: number, nowMs: number = Date.now()): Interval[] {
  if (s.openStart === null || livePos === undefined) return [...s.intervals];
  const capped = clampEnd(s.openStart, s.openStartAt, livePos, nowMs);
  if (capped <= s.openStart) return [...s.intervals];
  return insertAndMerge([...s.intervals], [s.openStart, capped]);
}

/** Call when the player transitions to PLAYING.
 *
 * FIX 2.1 -- closes any pre-existing open interval before opening a new
 * one. Without this, a PLAYING -> BUFFERING -> PLAYING sequence (network
 * glitch, quality switch, ad insertion, mobile orientation change)
 * silently overwrites `openStart` and discards everything between the
 * original PLAYING and the glitch. Across many glitches this could strip
 * 30-60% of credited watch time on flaky connections. Closing first
 * preserves it. */
export function onPlay(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  const closed = s.openStart !== null ? onClose(s, s.lastPos, nowMs) : s;
  return { ...closed, openStart: pos, openStartAt: nowMs, lastPos: pos, lastTickAt: nowMs };
}

/**
 * Call on each ~1s tick while playing. Uses wall-clock delta to detect seeks
 * reliably -- any forward jump faster than real-time (accounting for up to 2x
 * fast-forward) or any backward jump closes the current segment and opens a
 * new one at the seek target. The skipped range is never credited.
 */
export function onTick(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos, lastTickAt: nowMs };

  const since = s.lastTickAt ?? s.openStartAt ?? nowMs;
  const realDeltaSec = Math.max(0, (nowMs - since) / 1000);
  const posDelta = pos - s.lastPos;

  // Normal playback: pos advances by ~realDelta. Allow up to 2x for YT's
  // fast-forward setting, plus a small buffer for timing jitter.
  const maxPosDelta = realDeltaSec * 2 + CLOCK_BUFFER_SEC;
  const isForwardSeek = posDelta > maxPosDelta;
  const isBackwardSeek = posDelta < -CLOCK_BUFFER_SEC;

  if (!isForwardSeek && !isBackwardSeek) {
    return { ...s, lastPos: pos, lastTickAt: nowMs };
  }

  // Seek detected -- close the prior segment (bounded by wall-clock), open new.
  const cappedEnd = clampEnd(s.openStart, s.openStartAt, s.lastPos, nowMs);
  const closed = insertAndMerge(s.intervals, [s.openStart, cappedEnd]);
  return { ...s, intervals: closed, openStart: pos, openStartAt: nowMs, lastPos: pos, lastTickAt: nowMs };
}

/** Close the open interval (pause / ended / buffering / seek-away / unmount). */
export function onClose(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos, lastTickAt: nowMs };
  const end = clampEnd(s.openStart, s.openStartAt, pos, nowMs);
  const next = insertAndMerge(s.intervals, [s.openStart, end]);
  return { ...s, intervals: next, openStart: null, openStartAt: null, lastPos: pos, lastTickAt: nowMs };
}

/**
 * Re-seed an existing tracker with a (possibly larger) baseline + a more
 * complete intervals list. Used by the player when the watch-history
 * fetch resolves AFTER the player mounted (Failure #12 in the diagnosis):
 * without this the tracker stays anchored at baseline=0 / intervals=[]
 * for the rest of the session and the student's persisted progress is
 * silently lost.
 *
 * Both fields are monotonically merged -- `baseline` takes the max,
 * `intervals` are union-merged with the existing closed intervals. The
 * open interval (if any) is preserved.
 */
export function reseedTracker(
  s: WatchTrackerState,
  baselineWatchedSeconds: number,
  initialIntervals: ReadonlyArray<Interval>,
): WatchTrackerState {
  const mergedClosed = unionIntervals(s.intervals, initialIntervals);
  const newBaseline = Math.max(s.baseline, Math.round(Math.max(0, baselineWatchedSeconds)));
  return { ...s, intervals: mergedClosed, baseline: newBaseline };
}

/**
 * Server-side merge primitive. Union two lists of intervals into one
 * sorted, non-overlapping list. Used by `/api/training/certification-watch`
 * (and the live-sessions equivalent) to combine the incoming snapshot
 * with the JSONB column already in the database -- so the persisted
 * intervals always reflect the cumulative cross-session watch.
 */
export function unionIntervals(a: ReadonlyArray<Interval>, b: ReadonlyArray<Interval>): Interval[] {
  return insertAndMergeMany([...a, ...b]);
}

/**
 * Hydrate an arbitrary unknown value from the JSONB column into a typed
 * intervals array. Tolerant of malformed rows (skips invalid items). Both
 * server (route handlers reading the JSONB column) and client (tracker
 * seeding from the GET response) call this.
 */
export function hydrateIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length === 2) {
      const a = Number(item[0]);
      const b = Number(item[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0) {
        out.push([a, b]);
      }
    }
  }
  return insertAndMergeMany(out);
}

/**
 * Serialise an intervals list for JSONB storage / network transit. Just a
 * shallow array conversion -- kept as a named export so callers don't
 * stringly depend on the array shape and so future changes (e.g. switch
 * to {start, end} objects) localise to this file.
 */
export function serializeIntervals(intervals: ReadonlyArray<Interval>): [number, number][] {
  return intervals.map(([a, b]) => [Math.max(0, Math.round(a)), Math.max(0, Math.round(b))] as [number, number]);
}

/** Handy for tests / debugging -- serialize the merged intervals + baseline. */
export function serialize(s: WatchTrackerState): string {
  return JSON.stringify({ baseline: s.baseline, intervals: s.intervals });
}
