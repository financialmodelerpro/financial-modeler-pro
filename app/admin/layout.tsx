'use client';

import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';
import { usePathname } from 'next/navigation';

/**
 * Rendered only for non-login admin pages.
 * Keeping useRequireAdmin in its own component means the hook
 * is never called on the auth pages, which would trigger
 * router.replace('/admin') in a render loop.
 */
function AdminProtected({ children }: { children: React.ReactNode }) {
  const { loading } = useRequireAdmin();
  if (loading) return null;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /admin is the unified login entry (FIX 1, 2026-04-23). The legacy
  // /admin/login route still exists as a redirect to /admin so we
  // exclude it from the auth hook too. Both must skip the hook so
  // unauthed visitors reach the credential form without bouncing.
  if (pathname === '/admin' || pathname === '/admin/login') return <>{children}</>;
  return <AdminProtected>{children}</AdminProtected>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
