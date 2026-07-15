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

/**
 * The UTC hour at which /api/cron/publish-scheduled-articles runs, and the ONLY
 * moment a scheduled article can actually go live. MUST match the cron entry in
 * vercel.json ("0 5 * * *"); verify-article-scheduling asserts the two agree.
 *
 * Why daily and not the per-minute schedule this feature was built for: the
 * Vercel account is on the HOBBY plan, which rejects any cron expression that
 * would run more than once a day. A sub-daily expression does not merely fail
 * to run, it FAILS THE WHOLE DEPLOYMENT, so an every-minute entry silently
 * blocks every unrelated change from reaching production too. Per-minute needs
 * the Pro plan; until then this is the honest cadence.
 */
export const PUBLISH_CHECK_UTC_HOUR = 5;

/**
 * When an article scheduled for `afterMs` will REALLY be published: the first
 * daily check at or after it.
 *
 * This exists because the picker must not promise a time the platform cannot
 * keep. On a daily check, a 09:00 schedule does not publish at 09:00; the 05:00
 * check has already passed, so it waits for TOMORROW's, nearly a day later. The
 * admin has to see that before saving, not discover it the next morning.
 *
 * Hobby also only guarantees the hour, not the minute (Vercel documents a drift
 * of up to 59 minutes), so treat the result as the earliest possible moment.
 */
export function nextPublishCheckAfter(afterMs: number): Date {
  const d = new Date(afterMs);
  const todaysCheck = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PUBLISH_CHECK_UTC_HOUR, 0, 0, 0,
  );
  const DAY_MS = 24 * 60 * 60 * 1000;
  return new Date(todaysCheck >= afterMs ? todaysCheck : todaysCheck + DAY_MS);
}

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
