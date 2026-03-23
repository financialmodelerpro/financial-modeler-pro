'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Module    { id: string; name: string; slug: string; description: string; icon: string; status: 'live' | 'coming_soon' | 'hidden'; display_order: number; launch_date: string | null }
interface AssetType { id: string; name: string; description: string; icon: string; visible: boolean; display_order: number }

const STATUS_CFG = {
  live:        { label: '✓ Live',      bg: '#E8F7EC', color: '#1A7A30' },
  coming_soon: { label: 'Coming Soon', bg: '#FEF3C7', color: '#92400E' },
  hidden:      { label: 'Hidden',      bg: '#F3F4F6', color: '#6B7280' },
};
const NEXT_STATUS: Record<string, Module['status']> = { live: 'coming_soon', coming_soon: 'hidden', hidden: 'live' };
const NEXT_LABEL:  Record<string, string>            = { live: 'Set Coming Soon', coming_soon: 'Set Hidden', hidden: 'Set Live' };

export default function AdminModulesPage() {
  const [modules,    setModules]    = useState<Module[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [loadingM,   setLoadingM]   = useState(true);
  const [loadingA,   setLoadingA]   = useState(true);
  const [togglingM,  setTogglingM]  = useState<string | null>(null);
  const [togglingA,  setTogglingA]  = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch('/api/admin/modules')
      .then(r => r.json())
      .then(j => { setModules(j.modules ?? []); setLoadingM(false); })
      .catch(() => setLoadingM(false));
    fetch('/api/admin/asset-types')
      .then(r => r.json())
      .then(j => { setAssetTypes(j.assetTypes ?? []); setLoadingA(false); })
      .catch(() => setLoadingA(false));
  }, []);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function cycleModuleStatus(mod: Module) {
    const newStatus = NEXT_STATUS[mod.status];
    setTogglingM(mod.id);
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mod.id, status: newStatus }),
      });
      if (res.ok) {
        setModules(prev => prev.map(m => m.id === mod.id ? { ...m, status: newStatus } : m));
        showToast('Platform status updated');
      } else { showToast('Update failed', 'error'); }
    } catch { showToast('Update failed', 'error'); }
    finally { setTogglingM(null); }
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

        {/* ── Platforms ── */}
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Module Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
          Toggle platform visibility and status. Changes reflect on the landing page within 60 seconds.
        </p>

        {loadingM ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading platforms…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden', marginBottom: 48 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead cols={['#', 'Icon', 'Platform Name', 'Status', 'Actions']} />
              <tbody>
                {modules.map((mod, i) => {
                  const cfg = STATUS_CFG[mod.status];
                  return (
                    <tr key={mod.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF', width: 40 }}>{mod.display_order}</td>
                      <td style={{ padding: '12px 16px', fontSize: 24 }}>{mod.icon}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{mod.name}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{mod.description.substring(0, 70)}{mod.description.length > 70 ? '…' : ''}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          onClick={() => cycleModuleStatus(mod)}
                          disabled={togglingM === mod.id}
                          style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', opacity: togglingM === mod.id ? 0.5 : 1 }}
                        >
                          {togglingM === mod.id ? 'Saving…' : NEXT_LABEL[mod.status]}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
