'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /login is permanently moved to /admin/login.
 * next.config.ts handles the server-side permanent redirect (308).
 * This component is a client-side fallback.
 */
export default function LoginRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/login'); }, [router]);
  return null;
}
