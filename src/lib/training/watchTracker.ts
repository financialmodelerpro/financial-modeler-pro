/**
 * watchTracker — records actual playback time as [start, end] intervals and
 * merges overlaps on every commit so seeking forward/back/replaying does NOT
 * inflate the total. Enforces: "Watch ≥ threshold% of the video before
 * Mark Complete becomes available."
 *
 * Semantics:
 *  - `onPlay(pos)` opens an interval at pos and records wall-clock time
 *  - `onTick(pos)` extends the open interval — but a seek (position jumps
 *    faster than wall-clock allows) closes the old interval and opens a new
 *    one at the new position; the skipped range is NOT credited.
 *  - `onPause(pos)` / `onEnded(pos)` / `onClose(pos)` close the open interval
 *  - `watchedSeconds` = sum of lengths of all merged intervals
 *  - Persistence is external — caller passes in existing intervals (from DB
 *    `watch_seconds`) as the lower bound; tracker only ADDS on top of that.
 *
 * **Security property**: every accepted interval length is bounded by wall-
 * clock elapsed time since `openStart` (plus a small 1.5s buffer for frame
 * timing). A user who drags the playhead to the end of a 10-minute video and
 * triggers ENDED cannot fabricate a 600-second interval — the tracker caps
 * the end at `openStart + wallElapsed + buffer` regardless of the `pos` the
 * player reports. Combined with server-side threshold enforcement this makes
 * skip-to-end infeasible.
 *
 * Intentionally tiny / framework-agnostic so it can be unit-tested if needed.
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
  /** Seed value for watched seconds already persisted server-side. */
  baseline: number;
}

/** Small buffer for clock / frame timing jitter (seconds). */
const CLOCK_BUFFER_SEC = 1.5;

export function makeWatchTracker(baselineWatchedSeconds = 0): WatchTrackerState {
  return {
    intervals: [],
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

function sumIntervals(intervals: Interval[]): number {
  let s = 0;
  for (const [a, b] of intervals) s += Math.max(0, b - a);
  return s;
}

/**
 * Compute the maximum legal end position given wall-clock elapsed time.
 * Clamps `pos` so a single interval can never exceed real elapsed time —
 * this is the core defence against the skip-to-end attack.
 */
function clampEnd(openStart: number, openStartAt: number | null, pos: number, nowMs: number): number {
  if (openStartAt === null) return openStart; // paranoid — no wall-clock anchor
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
  // `base + open` counts only new intervals this session. We take max with
  // `baseline` so reloading with a higher persisted value never makes the
  // live counter go backwards mid-session.
  return Math.max(s.baseline, Math.round(base + open));
}

/** Call when the player transitions to PLAYING. */
export function onPlay(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  return { ...s, openStart: pos, openStartAt: nowMs, lastPos: pos, lastTickAt: nowMs };
}

/**
 * Call on each ~1s tick while playing. Uses wall-clock delta to detect seeks
 * reliably — any forward jump faster than real-time (accounting for up to 2×
 * fast-forward) or any backward jump closes the current segment and opens a
 * new one at the seek target. The skipped range is never credited.
 */
export function onTick(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos, lastTickAt: nowMs };

  const since = s.lastTickAt ?? s.openStartAt ?? nowMs;
  const realDeltaSec = Math.max(0, (nowMs - since) / 1000);
  const posDelta = pos - s.lastPos;

  // Normal playback: pos advances by ~realDelta. Allow up to 2× for YT's
  // fast-forward setting, plus a small buffer for timing jitter.
  const maxPosDelta = realDeltaSec * 2 + CLOCK_BUFFER_SEC;
  const isForwardSeek = posDelta > maxPosDelta;
  const isBackwardSeek = posDelta < -CLOCK_BUFFER_SEC;

  if (!isForwardSeek && !isBackwardSeek) {
    return { ...s, lastPos: pos, lastTickAt: nowMs };
  }

  // Seek detected — close the prior segment (bounded by wall-clock), open new.
  const cappedEnd = clampEnd(s.openStart, s.openStartAt, s.lastPos, nowMs);
  const closed = insertAndMerge(s.intervals, [s.openStart, cappedEnd]);
  return { ...s, intervals: closed, openStart: pos, openStartAt: nowMs, lastPos: pos, lastTickAt: nowMs };
}

/** Close the open interval (pause / ended / seek-away / unmount). */
export function onClose(s: WatchTrackerState, pos: number, nowMs: number = Date.now()): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos, lastTickAt: nowMs };
  const end = clampEnd(s.openStart, s.openStartAt, pos, nowMs);
  const next = insertAndMerge(s.intervals, [s.openStart, end]);
  return { ...s, intervals: next, openStart: null, openStartAt: null, lastPos: pos, lastTickAt: nowMs };
}

/** Handy for tests / debugging — serialize the merged intervals. */
export function serialize(s: WatchTrackerState): string {
  return JSON.stringify({ baseline: s.baseline, intervals: s.intervals });
}
