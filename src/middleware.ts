import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

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
      loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
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
