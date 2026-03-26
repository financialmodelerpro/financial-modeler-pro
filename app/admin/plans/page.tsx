'use client';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import PermissionsManager from '@/src/components/admin/PermissionsManager';
import { useEffect, useState } from 'react';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

interface UserOption { id: string; email: string; name: string | null; subscription_plan: string; }

export default function AdminPlansPage() {
  const { loading } = useRequireAdmin();
  const [users, setUsers] = useState<UserOption[]>([]);
  useEffect(() => {
    fetch('/api/admin/users?size=200')
      .then(r => r.json())
      .then(j => setUsers(j.users ?? []));
  }, []);

  if (loading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/plans" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>📋 Plan Configuration</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
          Toggle which features are included in each plan. Changes apply immediately — no code deploy required.
        </p>
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#92400E' }}>ℹ️ <strong>Module access</strong> is now managed in the Pricing admin — Module Access tab.</span>
          <a href="/admin/pricing?tab=modules" style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none', background: '#fff', border: '1px solid #BDD0F0', borderRadius: 5, padding: '4px 12px', whiteSpace: 'nowrap' }}>
            Manage Module Access →
          </a>
        </div>
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24 }}>
          <PermissionsManager
            users={users.map(u => ({
              id: u.id,
              email: u.email,
              name: u.name,
              subscription_plan: u.subscription_plan as 'free' | 'professional' | 'enterprise',
            }))}
            initialTab="plans"
          />
        </div>
      </main>
    </div>
  );
}
