'use client';

interface Props {
  watchPct:       number;
  threshold:      number;
  enforcing:      boolean;
  adminBypass:    boolean;
  sessionBypass:  boolean;
}

/**
 * Student-facing watch progress UI.
 *
 * Intentionally a no-op. The threshold + live watch percentage drive the
 * Mark-Complete button's visibility server-side (see watch page gating:
 * `canMarkComplete = videoEnded && (bypassActive || thresholdMet)`),
 * but they are **not** surfaced to students in any form — no bar, no
 * number, no "X% to go" countdown. Exposing the rule incentivises
 * skipping to hit the threshold; keeping it silent means the student
 * simply watches the video and the button appears when they're done.
 *
 * The component is retained (rather than deleted) so the callsite on
 * the watch page + its prop shape stay stable. Admin-side progress
 * still lives on `/admin/training-settings` where the threshold is
 * configured.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WatchProgressBar(_props: Props) {
  return null;
}
