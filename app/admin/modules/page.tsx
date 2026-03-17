'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Module { id: string; name: string; slug: string; description: string; icon: string; status: 'live' | 'coming_soon' | 'hidden'; display_order: number; launch_date: string | null }

export default function AdminModulesPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch('/api/admin/modules')
      .then(r => r.json())
      .then(j => { setModules(j.modules ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function cycleStatus(mod: Module) {
    const next: Record<string, Module['status']> = { live: 'coming_soon', coming_soon: 'hidden', hidden: 'live' };
    const newStatus = next[mod.status];
    setToggling(mod.id);
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mod.id, status: newStatus }),
      });
      if (res.ok) {
        setModules(prev => prev.map(m => m.id === mod.id ? { ...m, status: newStatus } : m));
        setToast({ msg: 'Status updated', type: 'success' });
        setTimeout(() => setToast(null), 2500);
      }
    } catch { setToast({ msg: 'Update failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    finally { setToggling(null); }
  }

  const statusConfig = {
    live:        { label: '✓ Live',        bg: '#E8F7EC', color: '#1A7A30', next: 'Coming Soon →' },
    coming_soon: { label: 'Coming Soon',   bg: '#FEF3C7', color: '#92400E', next: 'Hide →' },
    hidden:      { label: 'Hidden',        bg: '#F3F4F6', color: '#6B7280', next: 'Make Live →' },
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/modules" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Module Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>Toggle module visibility and status on the landing page.</p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading modules…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  {['#', 'Icon', 'Module Name', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modules.map((mod, i) => {
                  const cfg = statusConfig[mod.status];
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
                          onClick={() => cycleStatus(mod)}
                          disabled={toggling === mod.id}
                          style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', opacity: toggling === mod.id ? 0.5 : 1 }}
                        >
                          {toggling === mod.id ? 'Saving…' : `→ ${cfg.next}`}
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
