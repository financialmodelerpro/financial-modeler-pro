'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Redirect unauthenticated visitors to /admin (the unified login entry).
 * Returns { loading } so the page can avoid rendering until resolved.
 */
export function useRequireAuth(): { loading: boolean } {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.replace('/admin');
    }
  }, [session, status, router]);

  return { loading: status === 'loading' || !session };
}
