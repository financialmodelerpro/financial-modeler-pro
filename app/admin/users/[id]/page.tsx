'use client';

/**
 * /admin/users/[id] - Single user detail (consolidated)
 *
 * The former /admin/access "User Access" tab now lives here, reached from the
 * Users list, so user management + per-user entitlements are one tab. Renders
 * the shared UserAccessPanel for the selected user.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';
import { UserAccessPanel } from '@/src/components/admin/UserAccessPanel';

export default function AdminUserDetailPage() {
  const { loading: authLoading } = useRequireAdmin();
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/users" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }} data-testid="admin-user-detail-page">
        <Link href="/admin/users" style={{ fontSize: 13, fontWeight: 600, color: '#1B4F8A', textDecoration: 'none' }}>← Back to users</Link>
        <div style={{ height: 16 }} />
        {id ? <UserAccessPanel userId={id} /> : <div style={{ color: '#94a3b8' }}>No user selected.</div>}
      </main>
    </div>
  );
}
