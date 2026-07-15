/**
 * Article scheduled-publish rules (migration 198).
 *
 * One place decides what a scheduling intent means, so the admin API (POST/PATCH)
 * and the publish cron can never drift apart on it.
 *
 * The governing rule: `status='scheduled'` with a `scheduled_at` in the PAST is not
 * a state worth storing, because the cron would publish it on the very next tick
 * anyway. `resolveSchedule` collapses it to a straight publish, which lands two
 * things at once:
 *
 *   1. The editor auto-saves every 60s carrying its local status. Once the cron
 *      publishes a scheduled article, an open editor tab would otherwise PATCH
 *      'scheduled' straight back over it and silently UN-publish the article.
 *      Normalizing a due schedule to 'published' makes that auto-save idempotent.
 *   2. A mistyped past date publishes immediately instead of being swallowed, which
 *      is the same thing the cron would do a minute later, only without the wait.
 */

export const SCHEDULE_TIME_REQUIRED_MSG = 'A publish date and time is required to schedule';
export const SCHEDULE_TIME_INVALID_MSG  = 'The scheduled publish time is not a valid date';

/** Statuses an article may resolve to. `scheduled` always carries a future time. */
export type ArticleStatus = 'draft' | 'published' | 'scheduled';

export interface ResolvedSchedule {
  /** The status to actually store (a due 'scheduled' resolves to 'published'). */
  status: ArticleStatus;
  /** The timestamp to store. Null clears the timer (draft / published / just-fired). */
  scheduledAt: string | null;
  /** True when a due schedule was collapsed to a publish (caller announces it). */
  firedNow: boolean;
  /** Set when the intent is unusable; the caller should reject with this message. */
  error?: string;
}

/** Parse an incoming scheduled_at into a Date. Null when absent, blank, or unparseable. */
export function parseScheduledAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve a requested status + scheduled_at into what should be stored.
 *
 * Returns null when the request carries no recognised status, meaning the caller
 * must leave both status and the timer untouched. Callers MUST handle that rather
 * than defaulting, or a PATCH of an unrelated field would rewrite the status.
 *
 * `nowMs` is injectable so the rule is testable without waiting on the clock.
 */
export function resolveSchedule(
  status: unknown,
  rawScheduledAt: unknown,
  nowMs: number = Date.now(),
): ResolvedSchedule | null {
  if (status === 'scheduled') {
    // Distinguish "no time given" from "time given but nonsense" so the admin gets
    // an error that says which mistake they made.
    const provided = typeof rawScheduledAt === 'string' && rawScheduledAt.trim().length > 0;
    const when = parseScheduledAt(rawScheduledAt);
    if (!when) {
      return {
        status: 'scheduled',
        scheduledAt: null,
        firedNow: false,
        error: provided ? SCHEDULE_TIME_INVALID_MSG : SCHEDULE_TIME_REQUIRED_MSG,
      };
    }
    if (when.getTime() <= nowMs) {
      return { status: 'published', scheduledAt: null, firedNow: true };
    }
    return { status: 'scheduled', scheduledAt: when.toISOString(), firedNow: false };
  }

  // Moving to draft or published abandons any pending schedule, so the cron cannot
  // later resurrect a timer the admin has visibly moved away from.
  if (status === 'published' || status === 'draft') {
    return { status, scheduledAt: null, firedNow: false };
  }

  // No recognised status in this request: the caller leaves status + timer alone.
  return null;
}
