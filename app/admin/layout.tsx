'use client';

import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';
import { usePathname } from 'next/navigation';

/**
 * Rendered only for non-login admin pages.
 * Keeping useRequireAdmin in its own component means the hook
 * is never called on /admin/login, which would trigger
 * router.replace('/admin/login') in a render loop.
 */
function AdminProtected({ children }: { children: React.ReactNode }) {
  const { loading } = useRequireAdmin();
  if (loading) return null;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Login page must never run the auth hook - it has no session by definition
  if (pathname === '/admin/login') return <>{children}</>;
  return <AdminProtected>{children}</AdminProtected>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
