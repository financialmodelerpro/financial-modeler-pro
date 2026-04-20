/**
 * Detect whether the admin swapped the session video.
 *
 * When `total_seconds` on a watch-history row disagrees meaningfully from
 * what the current client is reporting, the stored progress is about a
 * DIFFERENT video than the one the student is now watching. Keeping the
 * stale numbers would make `watch_percentage` nonsense (e.g. a student
 * who previously completed a 30-min video would show as partially-watched
 * on a new 60-min replacement, or fully-completed on a short trailer).
 *
 * The detection heuristic requires BOTH an absolute and relative
 * difference so a near-identical re-upload (silent normalization, a few
 * seconds' re-edit) doesn't flip the reset. Only a meaningful video
 * swap triggers the reset.
 *
 *   absolute diff > 30 seconds  AND  relative diff > 10% of existing
 *
 * Used by both /api/training/certification-watch (3SFM/BVM sessions) and
 * /api/training/live-sessions/[id]/watched (live sessions). Any future
 * endpoint that stores a duration alongside watch progress can reuse this
 * and automatically inherit the reset behavior.
 */
export interface VideoChangeVerdict {
  changed:      boolean;
  /** Human-readable reason; set only when `changed === true`. Goes into
   *  server logs so we can trace which student/tab triggered a reset. */
  reason?:      string;
}

export function detectVideoChange(
  existingTotal: number,
  incomingTotal: number,
): VideoChangeVerdict {
  // Either side missing → can't compare. Normal progress merge runs
  // instead (e.g. first watch where no prior total exists, or a client
  // that hasn't loaded YT metadata yet and sent total_seconds=0).
  if (existingTotal <= 0 || incomingTotal <= 0) return { changed: false };

  const diff     = Math.abs(incomingTotal - existingTotal);
  const diffPct  = diff / existingTotal;
  if (diff > 30 && diffPct > 0.1) {
    return {
      changed: true,
      reason:  `old=${existingTotal}s new=${incomingTotal}s diff=${diff}s (${Math.round(diffPct * 100)}%)`,
    };
  }
  return { changed: false };
}
