/**
 * Sanitize a `callbackUrl` query param destined for the admin auth flow.
 *
 * Background (2026-04-24): after the unified admin login (commit
 * d528c32), a chain of redirect rewrites was wrapping `callbackUrl`
 * recursively - each hop URL-encoded the previous URL into the new
 * `callbackUrl`, producing browser ERR_TOO_MANY_REDIRECTS with paths
 * like `/admin?callbackUrl=%2Fadmin%3FcallbackUrl%3D%252Fadmin...`.
 *
 * Returns `null` when the input is missing OR fails any check below;
 * caller decides what to default to. This lets the middleware decide
 * "no callbackUrl at all" while AdminLoginClient defaults to
 * /admin/dashboard for the post-signin destination.
 *
 * Checks:
 *   - Decodes percent-encoding up to 5 times (handles `%25` ladder).
 *   - Same-origin paths only (must start with `/`, not `//`).
 *   - Reject auth-cycle paths (`/admin`, `/admin/login`, `/login`) -
 *     these would just put the user back on the login form.
 *   - Reject anything with a protocol prefix or `\` to defeat
 *     open-redirect attempts.
 *
 * Used by:
 *   - AdminLoginClient (post-signin destination)
 *   - /login & /admin/login server-side redirects
 *   - middleware (the redirect-to-/admin URL when an unauthed user
 *     hits a protected /admin/* route)
 *   - /admin/page.tsx server component (deep-link redirect for
 *     already-authed admins)
 */
const AUTH_CYCLE_PATHS = new Set<string>([
  '/admin',
  '/admin/login',
  '/login',
]);

export function safeAdminCallback(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Decode nested percent-encoding. Each loop hop encoded once more
  // (`%2F` -> `%252F` -> `%25252F`); five iterations covers any
  // realistic depth before bailing.
  let decoded = raw;
  try {
    for (let i = 0; i < 5; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }

  // Same-origin paths only.
  if (!decoded.startsWith('/'))    return null;
  if (decoded.startsWith('//'))    return null;
  if (decoded.startsWith('/\\'))   return null;
  if (/^\/+https?:/i.test(decoded)) return null;

  // Pull the bare path so we can check the auth-cycle deny-list.
  const pathOnly = decoded.split('?')[0].split('#')[0];
  if (AUTH_CYCLE_PATHS.has(pathOnly)) return null;

  return decoded;
}

/** Convenience for callers that want a destination, never null. */
export const ADMIN_DEFAULT_DESTINATION = '/admin/dashboard';
export function safeAdminCallbackOrDefault(raw: string | null | undefined): string {
  return safeAdminCallback(raw) ?? ADMIN_DEFAULT_DESTINATION;
}
