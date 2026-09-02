/**
 * rateLimit.ts
 *
 * Fixed-window in-memory rate limiting for public API routes.
 *
 * It lives here rather than inside the route file for a mundane but hard
 * reason: a Next route module may only export a fixed set of names (the HTTP
 * verbs, `dynamic`, `runtime` and friends), so a route that exports a test seam
 * such as a reset function fails the build with a route-type constraint error.
 * Anything a test needs to reach has to sit outside the route.
 *
 * PER INSTANCE, not global. On serverless each warm instance keeps its own
 * counter, so the effective ceiling across a fanned-out deployment is a
 * multiple of the configured limit. That is acceptable for protecting a
 * read-only cached feed and is stated rather than implied; a global limit would
 * need Redis or an Edge Config counter.
 *
 * No em dashes in this file.
 */

interface Window { count: number; resetAt: number }

const buckets = new Map<string, Map<string, Window>>();

/**
 * THE CLOCK, injectable. Production never touches this: nothing outside a test
 * calls `setRateLimitClock`, and with no injection it is `Date.now`.
 *
 * It exists because a fixed WINDOW cannot be tested against a real clock
 * without racing it. `verify-public-pages-api` fired 61 live requests at a
 * 60-per-60,000ms limiter, and each request runs the real handler with its
 * database queries, so the loop took about as long as the window it was
 * measuring. It straddled the boundary, the counter rolled over mid-loop, the
 * 61st request was allowed, and three checks went red together. Three
 * identical runs gave fail, pass, fail. The limiter was correct throughout;
 * the test was timing it with a stopwatch the same length as the thing being
 * timed.
 *
 * Widening the limit or retrying the loop would have hidden that rather than
 * removing it. Injecting the clock removes it: the test freezes time, so the
 * requests land in one window BY CONSTRUCTION however slow the machine is, and
 * it can then step time forward deliberately to prove the window rolls, which
 * a wall-clock test could never assert without sleeping for a minute.
 */
let clock: () => number = Date.now;

function bucket(name: string): Map<string, Window> {
  let b = buckets.get(name);
  if (!b) { b = new Map(); buckets.set(name, b); }
  return b;
}

/**
 * Count a hit and report whether the caller has exceeded `limit` within
 * `windowMs`. The first call in a window starts it.
 */
export function rateLimited(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
  // Defaults to the injectable clock, evaluated per call so an injection made
  // after module load still takes effect. An explicit `now` still wins, so the
  // existing parameter contract is unchanged.
  now: number = clock(),
): boolean {
  const b = bucket(name);
  const entry = b.get(key);
  if (!entry || now >= entry.resetAt) {
    b.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic sweep so a long-lived instance does not grow an entry per
    // key forever. Only runs when a window rolls over, so it is cheap.
    if (b.size > 5_000) {
      for (const [k, v] of b) if (now >= v.resetAt) b.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

/** Clear one bucket, or all of them. Test seam. */
export function resetRateLimit(name?: string): void {
  if (name) buckets.get(name)?.clear();
  else buckets.clear();
}

/**
 * Replace the clock, or pass null to restore `Date.now`. TEST SEAM ONLY.
 *
 * Deliberately a separate exported function rather than a mutable exported
 * binding, so the only way to move the clock is a deliberate call that greps
 * for itself. `verify-public-pages-api` asserts that no file under `app/`
 * calls it, so a route can never quietly acquire a fake clock.
 */
export function setRateLimitClock(fn: (() => number) | null): void {
  clock = fn ?? Date.now;
}
