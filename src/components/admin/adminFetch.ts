/**
 * adminFetch.ts
 *
 * ONE way for an admin screen to read JSON from an API route.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * On 2026-09-02 the admin user list showed "0 total users" and "No users
 * found" in production while all eight users sat untouched in the database.
 * The route was correctly answering HTTP 500 (a PostgREST embed had become
 * ambiguous, see the note in app/api/admin/users/route.ts). The page did this:
 *
 *   fetch(url)
 *     .then(r => r.json())                          // never checks r.ok
 *     .then(j => { setUsers(j.users ?? []); setTotal(j.total ?? 0); })
 *     .catch(() => setLoading(false));
 *
 * On a 500 the body is `{"error": "..."}`, so `j.users` is `undefined`, `?? []`
 * turns it into an empty array, and a HARD SERVER ERROR renders as a perfectly
 * ordinary empty list. Nobody sees a problem: an outage and a genuinely empty
 * table are pixel-identical.
 *
 * That is the absent-value trap (TRAPS 2.4) in its most expensive form: an
 * ERROR collapsed into a REAL VALUE. `?? []` is not the bug on its own, it is
 * the right default for a genuinely absent field. The bug is defaulting BEFORE
 * establishing that the response was a success at all.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * Check `res.ok` FIRST. A non-2xx response yields an Error carrying the
 * server's own message, so the screen can SAY what went wrong. Only once the
 * response is known to be a success may a caller default a missing field.
 *
 * No em dashes in this file.
 */

/** Thrown for any non-2xx response, carrying the server's message and status. */
export class AdminFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminFetchError';
    this.status = status;
  }
}

/**
 * GET (or otherwise fetch) JSON from an admin route.
 *
 * Resolves with the parsed body ONLY when the response is a success. Rejects
 * with an AdminFetchError otherwise, so `.catch` on the caller is reached and
 * an error can never be mistaken for empty data.
 */
// The default generic mirrors `Response.json()`, which is `any`. That is
// deliberate: converting an existing `.then(r => r.json())` call site to this
// helper must change its ERROR handling and nothing else, and a stricter
// default (`unknown`, say) would force unrelated type churn across every
// screen being repaired, which is how a safety fix turns into a risky one.
// New call sites should pass an explicit shape, as the users page does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminFetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  // Parse first, because the useful message lives in the error BODY, and read
  // it defensively: an error response is exactly the case most likely to carry
  // HTML (a proxy error page) or nothing at all rather than the JSON we expect.
  let body: unknown = null;
  let parsed = true;
  try { body = await res.json(); } catch { parsed = false; }

  if (!res.ok) {
    const fromBody = parsed && body && typeof body === 'object'
      ? (body as { error?: unknown; message?: unknown }).error
        ?? (body as { message?: unknown }).message
      : null;
    const msg = typeof fromBody === 'string' && fromBody.trim()
      ? fromBody
      : `Request failed with status ${res.status}.`;
    throw new AdminFetchError(msg, res.status);
  }

  // A 2xx that is not JSON is also a failure, and a silent one if we returned
  // an empty object here: the caller would default every field and render a
  // blank screen, which is the very thing this module exists to prevent.
  if (!parsed) {
    throw new AdminFetchError('The server returned a success status but not JSON.', res.status);
  }
  return body as T;
}

/** Message for any thrown value, so a `catch` block never renders "[object Object]". */
export function adminErrorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof AdminFetchError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
