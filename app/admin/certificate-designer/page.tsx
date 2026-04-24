'use client';

import React, { useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { TemplatesTab } from './TemplatesTab';
import { CertificateLayoutTab } from './CertificateLayoutTab';
import { BadgeLayoutTab } from './BadgeLayoutTab';
import { TranscriptLayoutTab } from './TranscriptLayoutTab';

type TabKey = 'templates' | 'certificate' | 'badge' | 'transcript';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'templates',   label: 'Templates',          icon: '📁' },
  { key: 'certificate', label: 'Certificate Layout', icon: '🎨' },
  { key: 'badge',       label: 'Badge Layout',       icon: '🎖' },
  { key: 'transcript',  label: 'Transcript Layout',  icon: '📄' },
];

function isValidTab(v: string | null): v is TabKey {
  return v === 'templates' || v === 'certificate' || v === 'badge' || v === 'transcript';
}

function CertificateDesignerInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const tabParam = params.get('tab');
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'templates';

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session?.user as { role?: string } | undefined)?.role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  function setTab(key: TabKey) {
    const url = key === 'templates' ? '/admin/certificate-designer' : `/admin/certificate-designer?tab=${key}`;
    router.replace(url, { scroll: false });
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav active="/admin/certificate-designer" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Page header + tab strip */}
        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '20px 28px 0' }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0D2E5A' }}>🎨 Certificate Designer</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>
              Templates, certificate PDF layout, badge PNG overlay, and transcript layout in one place.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            {TABS.map(t => {
              const active = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: '10px 18px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    color: active ? '#1B4F8A' : '#6B7280',
                    borderBottom: active ? '3px solid #1B4F8A' : '3px solid transparent',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    whiteSpace: 'nowrap',
                    transition: 'color 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'templates'   && <TemplatesTab />}
          {activeTab === 'certificate' && <CertificateLayoutTab />}
          {activeTab === 'badge'       && <BadgeLayoutTab />}
          {activeTab === 'transcript'  && <TranscriptLayoutTab />}
        </div>
      </main>
    </div>
  );
}

export default function CertificateDesignerPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>
        Loading…
      </div>
    }>
      <CertificateDesignerInner />
    </Suspense>
  );
}
