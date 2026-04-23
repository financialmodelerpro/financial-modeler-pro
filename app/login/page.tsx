import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Dumb one-shot redirect to the unified admin auth entry.
 *
 * Deliberately does NOT read searchParams or preserve callbackUrl
 * (2026-04-24). Previous versions did, and a combination of nested
 * encoding + Vercel edge caching of old redirect responses produced
 * the ERR_TOO_MANY_REDIRECTS reported on /login?callbackUrl=%2Fadmin.
 * Dropping ALL query parameters is safe here because the only
 * legitimate callback path for admin auth is through the middleware,
 * which writes its own fresh `callbackUrl` at the moment it bounces
 * an unauthed user. Anything that lands here must be either a stale
 * link, a bookmark, or a NextAuth fallback - none of those need the
 * old query carried forward.
 */
export default function LoginRedirect() {
  redirect('/admin');
}
