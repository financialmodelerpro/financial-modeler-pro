import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') || '';

  console.log('HOST:', host, 'PATH:', pathname);

  const isLearn = host.includes('learn.');
  const isApp   = host.includes('app.');

  // ── learn.financialmodelerpro.com ────────────────────────────────────────
  if (isLearn) {
    if (
      pathname.startsWith('/training') ||
      pathname.startsWith('/_next')    ||
      pathname.startsWith('/api')
    ) return NextResponse.next();

    // Everything else → redirect to training hub
    return NextResponse.redirect(new URL('/training', req.url));
  }

  // ── app.financialmodelerpro.com ──────────────────────────────────────────
  if (isApp) {
    if (
      pathname.startsWith('/refm')     ||
      pathname.startsWith('/modeling') ||
      pathname.startsWith('/settings') ||
      pathname.startsWith('/_next')    ||
      pathname.startsWith('/api')
    ) return NextResponse.next();

    // Everything else → redirect to modeling hub
    return NextResponse.redirect(new URL('/modeling', req.url));
  }

  // ── financialmodelerpro.com (main) ───────────────────────────────────────

  // Admin protection — check token manually
  if (pathname.startsWith('/admin')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.redirect(new URL('/login', req.url));
    if ((token as { role?: string }).role !== 'admin') {
      return NextResponse.redirect(new URL('/portal', req.url));
    }
  }

  // Cross-domain redirects on main domain
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
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
