'use client';
import { useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { LaunchStatusCard } from '@/src/components/admin/LaunchStatusCard';
import { DeviceVerificationCard } from '@/src/components/admin/DeviceVerificationCard';

export default function AdminModulesPage() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/modules" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Launch Settings</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
          Modeling Hub Coming Soon toggles + the early-access whitelist.
          To edit platforms (REFM, BVM, FPA…), their sub-modules and per-platform asset classes go to <a href="/admin/platform-modules" style={{ color: '#1B4F8A', fontWeight: 700 }}>Modules</a>.
        </p>

        {/* ── Launch Settings - Modeling Hub (split signin + register, migration 136) ── */}
        <LaunchStatusCard
          label="Modeling Hub - Sign In"
          icon="🔐"
          endpoint="/api/admin/modeling-signin-coming-soon"
          previewUrl={(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com') + '/signin'}
          onMessage={showToast}
        />

        <LaunchStatusCard
          label="Modeling Hub - Register"
          icon="📝"
          endpoint="/api/admin/modeling-register-coming-soon"
          previewUrl={(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com') + '/register'}
          onMessage={showToast}
        />

        {/* Banner: the two toggles above are bypassable per-email via the
            whitelist. Short sentence + link so admins find their way to
            the add/revoke UI without hunting through the sidebar. */}
        <div style={{
          background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10,
          padding: '14px 18px', marginBottom: 28,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 20 }}>🔑</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 2 }}>
              Grant early access to specific emails
            </div>
            <div style={{ fontSize: 12, color: '#1B4F8A' }}>
              Whitelisted emails bypass both Coming Soon toggles above. Admins are always allowed.
            </div>
          </div>
          <a
            href="/admin/modeling-access"
            style={{
              fontSize: 12, fontWeight: 700, padding: '8px 16px',
              borderRadius: 7, border: '1px solid #1B4F8A',
              background: '#fff', color: '#1B4F8A', textDecoration: 'none',
            }}
          >
            Manage Whitelist →
          </a>
        </div>

        {/* ── Security ─────────────────────────────────────────────────── */}
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', margin: '8px 0 6px' }}>Security</h2>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
          Controls that apply to sign-in across both the Training and Modeling hubs.
        </p>
        <DeviceVerificationCard onMessage={showToast} />
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
