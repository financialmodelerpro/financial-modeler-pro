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
  now: number = Date.now(),
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
