'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { LaunchStatusCard } from '@/src/components/admin/LaunchStatusCard';

interface AssetType { id: string; name: string; description: string; icon: string; visible: boolean; display_order: number }

export default function AdminModulesPage() {
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [loadingA,   setLoadingA]   = useState(true);
  const [togglingA,  setTogglingA]  = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch('/api/admin/asset-types')
      .then(r => r.json())
      .then(j => { setAssetTypes(j.assetTypes ?? []); setLoadingA(false); })
      .catch(() => setLoadingA(false));
  }, []);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function toggleAssetVisible(a: AssetType) {
    setTogglingA(a.id);
    try {
      const res = await fetch('/api/admin/asset-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, visible: !a.visible }),
      });
      if (res.ok) {
        setAssetTypes(prev => prev.map(t => t.id === a.id ? { ...t, visible: !t.visible } : t));
        showToast('Asset class visibility updated');
      } else { showToast('Update failed', 'error'); }
    } catch { showToast('Update failed', 'error'); }
    finally { setTogglingA(null); }
  }

  const THead = ({ cols }: { cols: string[] }) => (
    <thead>
      <tr style={{ background: '#1B4F8A' }}>
        {cols.map(h => (
          <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/modules" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Launch & Assets</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
          Modeling Hub Coming Soon toggles, the early-access whitelist, and Real Estate asset class visibility.
          To edit platforms (REFM, BVM, FPA…) and their sub-modules go to <a href="/admin/platform-modules" style={{ color: '#1B4F8A', fontWeight: 700 }}>Modules</a>.
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

        {/* ── Real Estate Asset Classes ── */}
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Real Estate Asset Classes</h2>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
          Toggle which asset class cards are visible to visitors. Hidden items show a lock badge in admin only.
        </p>

        {loadingA ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading asset classes…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead cols={['#', 'Icon', 'Asset Class', 'Visibility', 'Toggle']} />
              <tbody>
                {assetTypes.map((a, i) => (
                  <tr key={a.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF', width: 40 }}>{a.display_order}</td>
                    <td style={{ padding: '12px 16px', fontSize: 24 }}>{a.icon}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{a.description.substring(0, 70)}{a.description.length > 70 ? '…' : ''}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {a.visible
                        ? <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#E8F7EC', color: '#1A7A30' }}>✓ Visible</span>
                        : <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280' }}>🔒 Hidden</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => toggleAssetVisible(a)}
                        disabled={togglingA === a.id}
                        style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: a.visible ? '#fff' : '#1B4F8A', cursor: 'pointer', color: a.visible ? '#374151' : '#fff', opacity: togglingA === a.id ? 0.5 : 1 }}
                      >
                        {togglingA === a.id ? 'Saving…' : a.visible ? 'Hide' : 'Make Visible'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
