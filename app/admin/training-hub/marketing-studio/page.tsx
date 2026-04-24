'use client';

import React, { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { LinkedInBannerStudio } from './LinkedInBannerStudio';
import { LiveSessionBannerStudio } from './LiveSessionBannerStudio';
import { YouTubeThumbnailStudio } from './YouTubeThumbnailStudio';
import { ArticleBannerStudio } from './ArticleBannerStudio';
import { AssetLibrary } from './AssetLibrary';

type TabKey = 'linkedin' | 'live-session' | 'youtube' | 'article' | 'library';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'linkedin',     label: 'LinkedIn Banners',     icon: '🔵' },
  { key: 'live-session', label: 'Live Session Banner',  icon: '📡' },
  { key: 'youtube',      label: 'YouTube Thumbnail',    icon: '▶️' },
  { key: 'article',      label: 'Article Banner',       icon: '📰' },
  { key: 'library',      label: 'Asset Library',        icon: '🗂' },
];

function isValidTab(v: string | null): v is TabKey {
  return v === 'linkedin' || v === 'live-session' || v === 'youtube' || v === 'article' || v === 'library';
}

function MarketingStudioInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'linkedin';

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session?.user as { role?: string } | undefined)?.role !== 'admin') {
      router.replace('/');
    }
  }, [status, session, router]);

  function setTab(key: TabKey) {
    const url = key === 'linkedin' ? '/admin/training-hub/marketing-studio' : `/admin/training-hub/marketing-studio?tab=${key}`;
    router.replace(url, { scroll: false });
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav active="/admin/training-hub/marketing-studio" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '20px 28px 0' }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0D2E5A' }}>🎨 Marketing Studio</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>
              Brand-locked banners and thumbnails for the Training Hub. Pick a template, fill the fields, export PNG.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            {TABS.map(t => {
              const active = t.key === activeTab;
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  style={{
                    padding: '10px 18px', border: 'none', background: 'transparent',
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? '#1B4F8A' : '#6B7280',
                    borderBottom: active ? '3px solid #1B4F8A' : '3px solid transparent',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                    whiteSpace: 'nowrap', transition: 'color 0.15s ease, border-color 0.15s ease',
                  }}>
                  <span style={{ fontSize: 14 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {activeTab === 'linkedin'     && <LinkedInBannerStudio />}
          {activeTab === 'live-session' && <LiveSessionBannerStudio />}
          {activeTab === 'youtube'      && <YouTubeThumbnailStudio />}
          {activeTab === 'article'      && <ArticleBannerStudio />}
          {activeTab === 'library'      && <AssetLibrary />}
        </div>
      </main>
    </div>
  );
}

export default function MarketingStudioPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading…</div>
    }>
      <MarketingStudioInner />
    </Suspense>
  );
}
