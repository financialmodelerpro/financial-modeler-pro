'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Redirect non-admin visitors away from admin pages.
 * - Not signed in  → /login
 * - Signed in, not admin → /
 *
 * Returns { loading } so the page can avoid rendering until the check resolves.
 */
export function useRequireAdmin(): { loading: boolean } {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.replace('/admin/login');
      return;
    }
    if ((session.user as { role?: string }).role !== 'admin') {
      router.replace('/refm');
    }
  }, [session, status, router]);

  return { loading: status === 'loading' || !session || (session.user as { role?: string }).role !== 'admin' };
}
