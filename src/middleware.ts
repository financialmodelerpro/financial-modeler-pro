import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

/**
 * Admin-route guard.
 *
 * Matcher `/admin/:path+` uses `+` (one-or-more segments) so `/admin`
 * ITSELF never enters middleware - no in-code guard needed. Every other
 * /admin/* route is protected:
 *   - no token            -> redirect to /admin (plain, no query)
 *   - token, not admin    -> redirect to /portal
 *   - token, admin        -> continue
 *
 * There is deliberately ZERO callbackUrl plumbing. Users who land here
 * unauthed see the login form; after signin they go to the default
 * post-signin destination (/admin/dashboard, enforced by NextAuth's
 * callbacks.redirect in src/lib/shared/auth.ts). Dropping the
 * callbackUrl flow eliminates every loop vector the auth surface
 * previously had.
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.redirect(new URL('/admin', req.url));
  }
  if ((token as { role?: string }).role !== 'admin') {
    return NextResponse.redirect(new URL('/portal', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path+'],
};
