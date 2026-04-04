import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default withAuth(
  function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (req as any).nextauth?.token;
    const host =
      req.headers.get('x-forwarded-host') ||
      req.headers.get('host') || '';

    console.log('HOST:', host, 'PATH:', pathname);

    const isLearn = host.includes('learn.');
    const isApp   = host.includes('app.');

    // ── FIRST: handle learn. subdomain ──────────────────────────────────────
    if (isLearn) {
      if (
        pathname.startsWith('/training') ||
        pathname.startsWith('/api/training') ||
        pathname.startsWith('/api/_next') ||
        pathname.startsWith('/_next')
      ) return NextResponse.next();

      return NextResponse.redirect(new URL('/training', req.url));
    }

    // ── SECOND: handle app. subdomain ───────────────────────────────────────
    if (isApp) {
      if (
        pathname.startsWith('/refm')     ||
        pathname.startsWith('/modeling') ||
        pathname.startsWith('/settings') ||
        pathname.startsWith('/api')      ||
        pathname.startsWith('/_next')
      ) return NextResponse.next();

      return NextResponse.redirect(new URL('/modeling', req.url));
    }

    // ── Admin protection (main domain only) ─────────────────────────────────
    if (pathname.startsWith('/admin')) {
      if (!token) return NextResponse.redirect(new URL('/login', req.url));
      if (token.role !== 'admin') return NextResponse.redirect(new URL('/portal', req.url));
      return NextResponse.next();
    }

    // ── Main domain redirects ────────────────────────────────────────────────
    if (pathname.startsWith('/training')) {
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_LEARN_URL),
      );
    }

    if (pathname.startsWith('/refm') || pathname.startsWith('/modeling')) {
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_APP_URL),
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (req.nextUrl.pathname.startsWith('/admin')) {
          return !!token;
        }
        return true;
      },
    },
  },
);

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/training/:path*',
    '/refm/:path*',
    '/modeling/:path*',
    '/settings/:path*',
    '/about/:path*',
    '/articles/:path*',
    '/pricing',
    '/contact',
    '/login',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
