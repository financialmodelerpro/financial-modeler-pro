'use client';

import React, { useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { CampaignsTab } from './CampaignsTab';
import { EmailSettingsTab } from './EmailSettingsTab';
import { ShareTemplatesTab } from './ShareTemplatesTab';
import { NewsletterTab } from './NewsletterTab';

type TabKey = 'campaigns' | 'email-settings' | 'share-templates' | 'newsletter';

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: 'campaigns',       label: 'Campaigns',       icon: '✉️', desc: 'Targeted student emails + history + share modal copy' },
  { key: 'email-settings',  label: 'Email Settings',  icon: '🎨', desc: 'Branding, signature, and live-session email templates' },
  { key: 'share-templates', label: 'Share Templates', icon: '📣', desc: 'Centralized share-button copy and global mention settings' },
  { key: 'newsletter',      label: 'Newsletter',      icon: '📧', desc: 'Subscribers, compose, campaigns, and auto notifications' },
];

function isValidTab(v: string | null): v is TabKey {
  return v === 'campaigns' || v === 'email-settings' || v === 'share-templates' || v === 'newsletter';
}

function CommunicationsHubInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const tabParam = params.get('tab');
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'campaigns';

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session?.user as { role?: string } | undefined)?.role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  function setTab(key: TabKey) {
    const url = key === 'campaigns' ? '/admin/communications-hub' : `/admin/communications-hub?tab=${key}`;
    router.replace(url, { scroll: false });
  }

  const activeMeta = TABS.find(t => t.key === activeTab) ?? TABS[0];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav active="/admin/communications-hub" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '20px 28px 0' }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0D2E5A' }}>📬 Communications Hub</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>{activeMeta.desc}</p>
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

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'campaigns'       && <CampaignsTab />}
          {activeTab === 'email-settings'  && <EmailSettingsTab />}
          {activeTab === 'share-templates' && <ShareTemplatesTab />}
          {activeTab === 'newsletter'      && <NewsletterTab />}
        </div>
      </main>
    </div>
  );
}

export default function CommunicationsHubPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>
        Loading…
      </div>
    }>
      <CommunicationsHubInner />
    </Suspense>
  );
}
