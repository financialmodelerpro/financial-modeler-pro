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
  const [cmsReady,   setCmsReady]   = useState<Set<string>>(new Set());
  const [comingSoon, setComingSoon] = useState(false);
  const [togglingCS, setTogglingCS] = useState(false);
  const [trainingCS,       setTrainingCS]       = useState(false);
  const [trainingDate,     setTrainingDate]     = useState('');
  const [trainingDateDraft,setTrainingDateDraft]= useState('');
  const [togglingTCS,      setTogglingTCS]      = useState(false);
  const [savingTrainingDate,setSavingTrainingDate] = useState(false);
  const [loadingM,   setLoadingM]   = useState(true);
  const [loadingA,   setLoadingA]   = useState(true);
  const [togglingM,  setTogglingM]  = useState<string | null>(null);
  const [togglingA,  setTogglingA]  = useState<string | null>(null);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState({ name: '', description: '', icon: '' });
  const [savingEdit, setSavingEdit] = useState(false);
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
    fetch('/api/admin/modules/cms-status')
      .then(r => r.json())
      .then(j => { setCmsReady(new Set((j.slugs as string[]) ?? [])); })
      .catch(() => {});
    fetch('/api/admin/modeling-coming-soon')
      .then(r => r.json())
      .then(j => setComingSoon(j.enabled ?? false))
      .catch(() => {});
    fetch('/api/admin/training-coming-soon')
      .then(r => r.json())
      .then(j => {
        setTrainingCS(j.enabled ?? false);
        const iso = (j.launchDate ?? '') as string;
        setTrainingDate(iso);
        setTrainingDateDraft(isoToLocal(iso));
      })
      .catch(() => {});
  }, []);

  function isoToLocal(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function localToIso(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  async function toggleTrainingComingSoon() {
    setTogglingTCS(true);
    try {
      const res = await fetch('/api/admin/training-coming-soon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !trainingCS }),
      });
      if (res.ok) {
        setTrainingCS(!trainingCS);
        showToast(trainingCS ? 'Training Hub is now LIVE' : 'Training Hub set to Coming Soon');
      } else { showToast('Update failed', 'error'); }
    } catch { showToast('Update failed', 'error'); }
    finally { setTogglingTCS(false); }
  }

  async function saveTrainingLaunchDate() {
    setSavingTrainingDate(true);
    try {
      const iso = localToIso(trainingDateDraft);
      const res = await fetch('/api/admin/training-coming-soon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchDate: iso }),
      });
      if (res.ok) {
        setTrainingDate(iso);
        showToast('Launch date saved');
      } else { showToast('Save failed', 'error'); }
    } catch { showToast('Save failed', 'error'); }
    finally { setSavingTrainingDate(false); }
  }

  async function toggleComingSoon() {
    setTogglingCS(true);
    try {
      const res = await fetch('/api/admin/modeling-coming-soon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !comingSoon }),
      });
      if (res.ok) {
        setComingSoon(!comingSoon);
        showToast(comingSoon ? 'Modeling Hub is now LIVE' : 'Modeling Hub set to Coming Soon');
      } else { showToast('Update failed', 'error'); }
    } catch { showToast('Update failed', 'error'); }
    finally { setTogglingCS(false); }
  }

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

  function startEdit(mod: Module) {
    setEditingId(mod.id);
    setEditForm({ name: mod.name, description: mod.description, icon: mod.icon });
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    try {
      const res = await fetch('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: editForm.name, description: editForm.description, icon: editForm.icon }),
      });
      if (res.ok) {
        setModules(prev => prev.map(m => m.id === id ? { ...m, ...editForm } : m));
        setEditingId(null);
        showToast('Platform updated');
      } else { showToast('Update failed', 'error'); }
    } catch { showToast('Update failed', 'error'); }
    finally { setSavingEdit(false); }
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB',
    borderRadius: 6, fontSize: 13, color: '#1B3A6B', background: '#fff', boxSizing: 'border-box',
  };

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

        {/* ── Launch Settings — Modeling Hub ── */}
        <div style={{ background: comingSoon ? '#FFFBEB' : '#F0FFF4', border: `1px solid ${comingSoon ? '#FDE68A' : '#BBF7D0'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
              🚀 Modeling Hub Launch Status
            </div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              {comingSoon
                ? 'Coming Soon mode is ON - signin and register pages show a coming soon message. Admins can bypass via ?bypass=true.'
                : 'Modeling Hub is LIVE - signin and register pages work normally.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: comingSoon ? '#FEF3C7' : '#E8F7EC', color: comingSoon ? '#92400E' : '#1A7A30' }}>
              {comingSoon ? 'COMING SOON' : 'LIVE'}
            </span>
            <button onClick={toggleComingSoon} disabled={togglingCS}
              style={{ padding: '8px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: togglingCS ? 'not-allowed' : 'pointer', background: comingSoon ? '#1A7A30' : '#B45309', color: '#fff', opacity: togglingCS ? 0.6 : 1 }}>
              {togglingCS ? 'Updating…' : comingSoon ? 'Set to LIVE →' : 'Set to Coming Soon'}
            </button>
          </div>
        </div>

        {/* ── Launch Settings — Training Hub ── */}
        <div style={{ background: trainingCS ? '#FFFBEB' : '#F0FFF4', border: `1px solid ${trainingCS ? '#FDE68A' : '#BBF7D0'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
                🎓 Training Hub Launch Status
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {trainingCS
                  ? 'Coming Soon mode is ON — signin and register pages show a countdown. Admins can bypass via ?bypass=true on /signin.'
                  : 'Training Hub is LIVE — signin and register pages work normally.'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: trainingCS ? '#FEF3C7' : '#E8F7EC', color: trainingCS ? '#92400E' : '#1A7A30' }}>
                {trainingCS ? 'COMING SOON' : 'LIVE'}
              </span>
              <button onClick={toggleTrainingComingSoon} disabled={togglingTCS}
                style={{ padding: '8px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: togglingTCS ? 'not-allowed' : 'pointer', background: trainingCS ? '#1A7A30' : '#B45309', color: '#fff', opacity: togglingTCS ? 0.6 : 1 }}>
                {togglingTCS ? 'Updating…' : trainingCS ? 'Set to LIVE →' : 'Set to Coming Soon'}
              </button>
              <a href="https://learn.financialmodelerpro.com/signin" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, fontWeight: 700, padding: '8px 14px', borderRadius: 7, border: '1px solid #1B4F8A', background: '#fff', color: '#1B4F8A', textDecoration: 'none' }}>
                Preview ↗
              </a>
            </div>
          </div>

          {trainingCS && (
            <div style={{ marginTop: 16, borderTop: '1px dashed #E5E7EB', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4, letterSpacing: '0.05em' }}>LAUNCH DATE &amp; TIME</div>
                <input
                  type="datetime-local"
                  value={trainingDateDraft}
                  onChange={e => setTrainingDateDraft(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, color: '#1B3A6B', background: '#fff', fontFamily: "'Inter', sans-serif" }}
                />
                <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
                  Shown as a countdown on /signin and /register. Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </div>
              </div>
              <button
                onClick={saveTrainingLaunchDate}
                disabled={savingTrainingDate || localToIso(trainingDateDraft) === trainingDate}
                style={{ padding: '8px 18px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: (savingTrainingDate || localToIso(trainingDateDraft) === trainingDate) ? 'not-allowed' : 'pointer', background: '#1B4F8A', color: '#fff', opacity: (savingTrainingDate || localToIso(trainingDateDraft) === trainingDate) ? 0.5 : 1 }}>
                {savingTrainingDate ? 'Saving…' : 'Save Launch Date'}
              </button>
              {trainingDateDraft && (
                <button
                  onClick={() => { setTrainingDateDraft(''); }}
                  style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#fff', color: '#6B7280' }}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Platforms ── */}
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Module Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
          Edit platform name, description, icon and toggle visibility. Changes reflect on the Modeling Hub within 60 seconds.
        </p>

        {loadingM ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading platforms…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden', marginBottom: 48 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead cols={['#', 'Icon', 'Platform Name & Description', 'Status', 'Page', 'Actions']} />
              <tbody>
                {modules.map((mod, i) => {
                  const cfg = STATUS_CFG[mod.status];
                  const isEditing = editingId === mod.id;
                  return (
                    <>
                      <tr key={mod.id} style={{ borderTop: '1px solid #E8F0FB', background: isEditing ? '#F0F7FF' : i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF', width: 40 }}>{mod.display_order}</td>
                        <td style={{ padding: '12px 16px', fontSize: 24, width: 52 }}>{mod.icon}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{mod.name}</div>
                          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{mod.description.substring(0, 80)}{mod.description.length > 80 ? '…' : ''}</div>
                        </td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                        </td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          {cmsReady.has(mod.slug) ? (
                            <a href={`/admin/page-builder/modeling-${mod.slug}`} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#E8F7EC', color: '#1A7A30', textDecoration: 'none' }}>Content Ready ✓</a>
                          ) : (
                            <a href={`/admin/page-builder/modeling-${mod.slug}`} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', textDecoration: 'none' }}>Setup Required</a>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => isEditing ? setEditingId(null) : startEdit(mod)}
                              style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #1B4F8A', background: isEditing ? '#1B4F8A' : '#fff', cursor: 'pointer', color: isEditing ? '#fff' : '#1B4F8A' }}
                            >
                              {isEditing ? 'Cancel' : 'Edit'}
                            </button>
                            <button
                              onClick={() => cycleModuleStatus(mod)}
                              disabled={togglingM === mod.id}
                              style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', opacity: togglingM === mod.id ? 0.5 : 1 }}
                            >
                              {togglingM === mod.id ? 'Saving…' : NEXT_LABEL[mod.status]}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline edit row */}
                      {isEditing && (
                        <tr key={`${mod.id}-edit`} style={{ borderTop: '1px solid #BFDBFE', background: '#EFF6FF' }}>
                          <td colSpan={5} style={{ padding: '16px 20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>ICON</div>
                                <input
                                  value={editForm.icon}
                                  onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))}
                                  style={{ ...inputStyle, textAlign: 'center', fontSize: 22 }}
                                  placeholder="🏗️"
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>PLATFORM NAME</div>
                                <input
                                  value={editForm.name}
                                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                  style={inputStyle}
                                  placeholder="Platform name…"
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4 }}>DESCRIPTION</div>
                                <input
                                  value={editForm.description}
                                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                                  style={inputStyle}
                                  placeholder="Short description shown on Modeling Hub grid…"
                                />
                              </div>
                              <button
                                onClick={() => saveEdit(mod.id)}
                                disabled={savingEdit}
                                style={{ fontSize: 12, fontWeight: 700, padding: '8px 20px', borderRadius: 6, border: 'none', background: '#1B4F8A', color: '#fff', cursor: 'pointer', opacity: savingEdit ? 0.6 : 1, whiteSpace: 'nowrap' }}
                              >
                                {savingEdit ? 'Saving…' : 'Save Changes'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
