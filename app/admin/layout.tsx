'use client';

import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

/**
 * Admin layout — applies useRequireAdmin guard to every /admin/* page.
 * Non-admins are redirected to /refm; unauthenticated users to /login.
 */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { loading } = useRequireAdmin();
  if (loading) return null;
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
