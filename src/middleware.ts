import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { safeAdminCallback } from '@/src/lib/shared/safeAdminCallback';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect /admin/* but exclude the auth entries themselves so we
  // don't bounce in a loop. /admin (the unified login page, FIX 1
  // 2026-04-23) and /admin/login (legacy redirect to /admin) both
  // need to be reachable while logged out.
  if (pathname.startsWith('/admin') && pathname !== '/admin' && pathname !== '/admin/login') {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const loginUrl = new URL('/admin', req.url);
      // FIX 2026-04-24: sanitize the callback we're about to wrap in.
      // sanitized=null means the original URL was malformed (recursive
      // callbackUrl from the prior loop bug, off-origin, auth-cycle
      // path); in that case redirect plain to /admin with no
      // callbackUrl. Otherwise preserve the legitimate deep link.
      const sanitized = safeAdminCallback(pathname + req.nextUrl.search);
      if (sanitized) loginUrl.searchParams.set('callbackUrl', sanitized);
      return NextResponse.redirect(loginUrl);
    }
    if ((token as { role?: string }).role !== 'admin') {
      return NextResponse.redirect(new URL('/portal', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
