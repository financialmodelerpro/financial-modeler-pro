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
  // /admin is the single admin auth entry (the /admin/login page was
  // deleted 2026-04-24; its URL now hits a next.config-level 308 to
  // /admin). Skip the auth hook here so the login form renders
  // without the hook firing router.replace('/admin') and bouncing in
  // place. Every other /admin/* subpath is protected both by this
  // client hook AND by middleware (for the server-side guarantee).
  if (pathname === '/admin') return <>{children}</>;
  return <AdminProtected>{children}</AdminProtected>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
