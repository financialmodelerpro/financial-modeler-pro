import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

/**
 * Admin auth + legacy URL forwarding.
 *
 * Handles every admin-related URL in one place so the CDN never serves
 * a cacheable 308 again. Background (2026-04-24): users with stale 308
 * redirect-cache entries from earlier deployments were stuck in a
 * recursive `/login?callbackUrl=%2Fadmin%3FcallbackUrl=%252Fadmin...`
 * loop even after cookies were cleared and incognito was used, because
 * 308 redirects are cached by browsers per HTTP spec unless explicit
 * Cache-Control says otherwise. `next.config.redirects({ permanent:
 * true })` emits 308 without cache-control, so the cache entries
 * survived every prior fix attempt.
 *
 * The middleware now owns the entire surface and:
 *   - always returns 307 (Temporary Redirect, not cached by default)
 *   - sets explicit `Cache-Control: no-store, no-cache, must-revalidate`
 *     + `Pragma: no-cache` + `Expires: 0` so even eager caches skip
 *   - strips query parameters when forwarding `/login` + `/admin/login`
 *     so a recursive `callbackUrl` in the URL collapses on the first
 *     fresh hit
 *
 * Matcher includes `/login`, `/admin/login`, and `/admin/:path+` (all
 * subpaths of /admin). `/admin` itself is deliberately not matched so
 * the login page renders inline without middleware touching it.
 */
function noCacheRedirect(req: NextRequest, path: string): NextResponse {
  const url = new URL(path, req.url);
  const res = NextResponse.redirect(url, 307);
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Legacy URLs -> /admin (always fresh, never cached).
  // Query params are dropped here intentionally. Any recursive
  // callbackUrl in the URL from a stale cache collapses on the first
  // hit instead of re-wrapping.
  if (pathname === '/login' || pathname === '/admin/login') {
    return noCacheRedirect(req, '/admin');
  }

  // Protected /admin/* subpaths (never /admin itself - matcher + this
  // guard together ensure /admin bypasses middleware entirely).
  if (pathname.startsWith('/admin/')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return noCacheRedirect(req, '/admin');
    }
    if ((token as { role?: string }).role !== 'admin') {
      return noCacheRedirect(req, '/portal');
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/admin/login', '/admin/:path+'],
};
