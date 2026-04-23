'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import PermissionsManager from '@/src/components/admin/PermissionsManager';

interface UserRow { id: string; email: string; name: string | null; subscription_plan: 'free' | 'professional' | 'enterprise'; }

export default function PermissionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    fetch('/api/admin/users').then((r) => r.json()).then((j) => setUsers(j.users ?? [])).catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🔐 Feature Permissions</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>
          Configure which features each plan can access, and set per-user overrides. Changes apply instantly.
        </p>
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24 }}>
          <PermissionsManager users={users.map((u) => ({ id: u.id, email: u.email, name: u.name, subscription_plan: u.subscription_plan }))} />
        </div>
      </main>
    </div>
  );
}
