import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MAIN_DOMAIN  = 'financialmodelerpro.com';
const LEARN_DOMAIN = 'learn.financialmodelerpro.com';
const APP_DOMAIN   = 'app.financialmodelerpro.com';

function getSubdomain(hostname: string): 'main' | 'learn' | 'app' {
  if (hostname === LEARN_DOMAIN || hostname.startsWith('learn.')) return 'learn';
  if (hostname === APP_DOMAIN   || hostname.startsWith('app.'))   return 'app';
  return 'main';
}

export default withAuth(
  function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const hostname     = req.headers.get('host') ?? '';
    const subdomain    = getSubdomain(hostname);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token        = (req as any).nextauth?.token;

    // ── Admin protection (main domain only) ─────────────────────────────────
    if (pathname.startsWith('/admin')) {
      if (!token) {
        return NextResponse.redirect(new URL('/login', req.url));
      }
      if (token.role !== 'admin') {
        return NextResponse.redirect(new URL('/portal', req.url));
      }
      return NextResponse.next();
    }

    // ── learn.financialmodelerpro.com ────────────────────────────────────────
    // Only /training/* and /api/* are served here.
    if (subdomain === 'learn') {
      if (
        pathname.startsWith('/training') ||
        pathname.startsWith('/api')      ||
        pathname === '/'
      ) {
        return NextResponse.next();
      }
      // Everything else on learn. → redirect to main domain
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com'),
      );
    }

    // ── app.financialmodelerpro.com ──────────────────────────────────────────
    // Only /refm/*, /modeling/*, /settings/* and /api/* are served here.
    if (subdomain === 'app') {
      if (
        pathname.startsWith('/refm')     ||
        pathname.startsWith('/modeling') ||
        pathname.startsWith('/settings') ||
        pathname.startsWith('/api')      ||
        pathname === '/'
      ) {
        return NextResponse.next();
      }
      // Everything else on app. → redirect to main domain
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com'),
      );
    }

    // ── financialmodelerpro.com (main) ───────────────────────────────────────
    // Block /training/* → redirect to learn subdomain
    if (pathname.startsWith('/training')) {
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'),
      );
    }
    // Block /refm/* and /modeling/* → redirect to app subdomain
    if (pathname.startsWith('/refm') || pathname.startsWith('/modeling')) {
      return NextResponse.redirect(
        new URL(pathname, process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'),
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Admin routes require a valid session before the middleware function runs
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
    '/admin/:path*',
    '/training/:path*',
    '/refm/:path*',
    '/modeling/:path*',
    '/settings/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
