'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Redirect unauthenticated visitors to the Modeling Hub sign-in.
 *
 * This hook guards the Modeling Hub app pages (the REFM platform at /refm and
 * /settings) which live on the app subdomain. On session expiry it MUST keep
 * the user on the app subdomain's sign-in page (app.financialmodelerpro.com/
 * signin, which resolves per-subdomain to the modeling sign-in).
 *
 * It previously redirected to `/admin`, but `/admin` is a main-site path: the
 * middleware + subdomain rules bounce it to www.financialmodelerpro.com/admin,
 * so an expired modeling session (1-hour JWT) dumped the user on the wrong
 * site's admin login. `/signin?bypass=true` matches the dashboard's own
 * stale-session redirect and stays on the app subdomain.
 *
 * Returns { loading } so the page can avoid rendering until resolved.
 */
export function useRequireAuth(): { loading: boolean } {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.replace('/signin?bypass=true');
    }
  }, [session, status, router]);

  return { loading: status === 'loading' || !session };
}
