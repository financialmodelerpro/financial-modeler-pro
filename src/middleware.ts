import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Protect /admin/* routes
    if (pathname.startsWith('/admin')) {
      if (!token) {
        return NextResponse.redirect(new URL('/login', req.url));
      }
      if (token.role !== 'admin') {
        return NextResponse.redirect(new URL('/portal', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Always allow the middleware function to run (return true)
        // Actual auth checks happen above
        if (req.nextUrl.pathname.startsWith('/admin')) {
          return !!token; // Must be signed in to reach middleware logic
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ['/admin/:path*'],
};
