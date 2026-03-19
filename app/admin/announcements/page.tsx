'use client';

import React, { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import AnnouncementsManager from '@/src/components/admin/AnnouncementsManager';

export default function AnnouncementsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>📢 Announcements</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>
          Push system-wide banners to all users. No code deploy needed.
        </p>
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24 }}>
          <AnnouncementsManager />
        </div>
      </main>
    </div>
  );
}
