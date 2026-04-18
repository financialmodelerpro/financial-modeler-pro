/**
 * watchTracker — records actual playback time as [start, end] intervals and
 * merges overlaps on every commit so seeking forward/back/replaying does NOT
 * inflate the total. Enforces: "Watch ≥ threshold% of the video before
 * Mark Complete becomes available."
 *
 * Semantics:
 *  - `onPlay(pos)` opens an interval at pos
 *  - `onTick(pos)` extends the open interval to pos (or closes + reopens on seek)
 *  - `onPause(pos)` / `onEnded(pos)` / `onSeek(newPos)` close the open interval
 *  - `watchedSeconds` = sum of lengths of all merged intervals
 *  - Persistence is external — caller passes in existing intervals (from DB
 *    `watch_seconds`) as the lower bound; tracker only ADDS on top of that.
 *
 * Intentionally tiny / framework-agnostic so it can be unit-tested if needed.
 */

export type Interval = readonly [start: number, end: number];

export interface WatchTrackerState {
  /** Sorted, merged, non-overlapping intervals. */
  intervals: Interval[];
  /** Open interval's start, or null if not currently playing. */
  openStart: number | null;
  /** Most recent known position (for seek detection). */
  lastPos: number;
  /** Seed value for watched seconds already persisted server-side. */
  baseline: number;
}

export function makeWatchTracker(baselineWatchedSeconds = 0): WatchTrackerState {
  return { intervals: [], openStart: null, lastPos: 0, baseline: Math.max(0, Math.round(baselineWatchedSeconds)) };
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

/** Total watched seconds, including any open interval currently in progress and the persisted baseline. */
export function watchedSeconds(s: WatchTrackerState, livePos?: number): number {
  const base = sumIntervals(s.intervals);
  const open = s.openStart !== null && livePos !== undefined && livePos > s.openStart ? livePos - s.openStart : 0;
  // Note: only the *new* intervals since the baseline are counted in `base` +
  // `open`. We take the max of (baseline, base + open) so that reloading with
  // a higher persisted value never makes the live counter go backwards mid-session.
  return Math.max(s.baseline, Math.round(base + open));
}

/** Call when the player transitions to PLAYING. */
export function onPlay(s: WatchTrackerState, pos: number): WatchTrackerState {
  return { ...s, openStart: pos, lastPos: pos };
}

/**
 * Call on each ~1s tick while playing. If `pos` is close to `lastPos + tickDelta`,
 * the open interval is simply extended (implicit, via `watchedSeconds`). If
 * there's a discontinuity (seek), we close the prior segment and open a new one.
 */
export function onTick(s: WatchTrackerState, pos: number, tickDelta = 1): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos };
  const expected = s.lastPos + tickDelta;
  // Allow some slop (±2s) — playback doesn't tick exactly on 1s boundaries.
  if (Math.abs(pos - expected) <= 2) {
    return { ...s, lastPos: pos };
  }
  // Treat as seek — close the segment [openStart, lastPos] and open new at pos.
  const closed = insertAndMerge(s.intervals, [s.openStart, s.lastPos]);
  return { ...s, intervals: closed, openStart: pos, lastPos: pos };
}

/** Close the open interval (pause / ended / seek-away / unmount). */
export function onClose(s: WatchTrackerState, pos: number): WatchTrackerState {
  if (s.openStart === null) return { ...s, lastPos: pos };
  const end = Math.max(s.openStart, pos);
  const next = insertAndMerge(s.intervals, [s.openStart, end]);
  return { ...s, intervals: next, openStart: null, lastPos: pos };
}

/** Handy for tests / debugging — serialize the merged intervals. */
export function serialize(s: WatchTrackerState): string {
  return JSON.stringify({ baseline: s.baseline, intervals: s.intervals });
}
