import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

/**
 * Admin auth + legacy URL forwarding + cache-buster.
 *
 * Every admin-related URL flows through this middleware so the CDN
 * and browser never serve a cached redirect that could loop. The
 * ERR_TOO_MANY_REDIRECTS the user saw at
 * `/login?callbackUrl=%2Fadmin%3Fcallback%3D...` was caused by 308
 * responses from older deployments that lacked explicit
 * `Cache-Control: no-store` - browsers cached those 308s and kept
 * replaying the chain even after the fix commits landed.
 *
 * Rules:
 *   - `/login`, `/admin/login` -> 307 `/admin` (query stripped)
 *   - `/admin` + any query      -> 307 `/admin` (query stripped)
 *   - `/admin` (clean URL)       -> pass through to page, with
 *                                   `Cache-Control: no-store` on the
 *                                   200 response so browsers don't
 *                                   cache it (and, importantly, any
 *                                   stale 308 entry gets replaced the
 *                                   next time the URL is requested)
 *   - `/admin/:path+` unauth    -> 307 `/admin` (query stripped)
 *   - `/admin/:path+` non-admin -> 307 apex `/`
 *
 * All redirects carry:
 *     Cache-Control: no-store, no-cache, must-revalidate, max-age=0
 *     Pragma: no-cache
 *     Expires: 0
 * so stale 308s in browser cache are overwritten on the first fresh
 * hit. 307 itself is a Temporary Redirect that browsers don't cache
 * aggressively by default.
 */

function noCacheRedirect(req: NextRequest, path: string): NextResponse {
  const url = new URL(path, req.url);
  const res = NextResponse.redirect(url, 307);
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

function noCacheNext(): NextResponse {
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Legacy URLs -> /admin (always fresh, query stripped).
  if (pathname === '/login' || pathname === '/admin/login') {
    return noCacheRedirect(req, '/admin');
  }

  // /admin itself: strip any query, then serve the page with
  // no-store headers so stale 308 cache entries get replaced.
  if (pathname === '/admin') {
    if (search) return noCacheRedirect(req, '/admin');
    return noCacheNext();
  }

  // Protected /admin/* subpaths.
  if (pathname.startsWith('/admin/')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return noCacheRedirect(req, '/admin');
    if ((token as { role?: string }).role !== 'admin') return noCacheRedirect(req, '/');
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/admin', '/admin/login', '/admin/:path+'],
};
