'use client';

import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';
import { usePathname } from 'next/navigation';

/**
 * Admin layout — applies useRequireAdmin guard to every /admin/* page
 * except /admin/login (would cause a redirect loop).
 * Middleware handles the server-side auth check for /admin/*.
 */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading } = useRequireAdmin();

  // Never guard the login page itself — middleware already protects other routes
  if (pathname === '/admin/login') return <>{children}</>;
  if (loading) return null;
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
