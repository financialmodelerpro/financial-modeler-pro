'use client';

import { useEffect, useState, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { RichTextarea } from '@/src/components/admin/RichTextarea';

interface Instructor {
  id: string;
  name: string;
  title: string;
  bio?: string | null;
  photo_url?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  credentials?: string | null;
  display_order: number;
  is_default: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const GREEN = '#2EAA4A';
const DANGER = '#DC2626';
const BORDER = '#E5E7EB';
const GOLD = '#F5B942';

const EMPTY: Partial<Instructor> = {
  name: '', title: '', bio: '', photo_url: '', email: '', linkedin_url: '',
  credentials: '', display_order: 0, is_default: false, active: true,
};

const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280',
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4,
};
const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 700, background: bg, color: fg, cursor: 'pointer',
});

export default function AdminInstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Instructor> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const show = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/instructors');
      const j = await res.json() as { instructors?: Instructor[] };
      setInstructors(j.instructors ?? []);
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.title?.trim()) {
      show('Name and title are required.', 'err');
      return;
    }
    setSaving(true);
    try {
      const body = { ...editing, display_order: Number(editing.display_order ?? 0) };
      const res = editing.id
        ? await fetch(`/api/admin/instructors/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/admin/instructors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
      const j = await res.json() as { error?: string };
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      show(editing.id ? 'Instructor updated' : 'Instructor created');
      setEditing(null);
      await load();
    } catch (e) {
      show((e as Error).message, 'err');
    }
    setSaving(false);
  }

  async function remove(ins: Instructor) {
    if (!confirm(`Delete ${ins.name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/instructors/${ins.id}`, { method: 'DELETE' });
      const j = await res.json() as { error?: string; inUse?: boolean };
      if (!res.ok) throw new Error(j.error ?? 'Delete failed');
      show('Instructor deleted');
      await load();
    } catch (e) {
      show((e as Error).message, 'err');
    }
  }

  async function toggleActive(ins: Instructor) {
    try {
      const res = await fetch(`/api/admin/instructors/${ins.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !ins.active }),
      });
      if (!res.ok) throw new Error('Update failed');
      await load();
    } catch (e) { show((e as Error).message, 'err'); }
  }

  async function makeDefault(ins: Instructor) {
    if (ins.is_default) return;
    try {
      const res = await fetch(`/api/admin/instructors/${ins.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error('Update failed');
      show('Default instructor updated');
      await load();
    } catch (e) { show((e as Error).message, 'err'); }
  }

  async function move(ins: Instructor, direction: -1 | 1) {
    const sorted = [...instructors].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex(i => i.id === ins.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    try {
      await Promise.all([
        fetch(`/api/admin/instructors/${ins.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_order: swap.display_order }),
        }),
        fetch(`/api/admin/instructors/${swap.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_order: ins.display_order }),
        }),
      ]);
      await load();
    } catch { /* ignore */ }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/instructors" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Instructors</h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              Manage the instructor roster. The default instructor is pre-selected when creating new live sessions.
            </p>
          </div>
          <button onClick={() => setEditing({ ...EMPTY, display_order: instructors.length })} style={btn(BLUE)}>
            + Add Instructor
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>
        ) : instructors.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12 }}>
            No instructors yet. Click &quot;+ Add Instructor&quot; to create one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {instructors.map((ins, idx) => (
              <div key={ins.id} style={{
                background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12,
                padding: '16px 18px',
                display: 'flex', alignItems: 'center', gap: 16,
                opacity: ins.active ? 1 : 0.55,
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: ins.photo_url ? `url(${ins.photo_url}) center/cover` : 'linear-gradient(135deg, #14B8A6, #0D2E5A)',
                  color: '#fff', fontSize: 18, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {!ins.photo_url && ins.name.split(' ').map(s => s[0]).slice(0, 2).join('')}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{ins.name}</div>
                    {ins.is_default && (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: `${GOLD}25`, color: '#92400E', letterSpacing: '0.08em' }}>DEFAULT</span>
                    )}
                    {!ins.active && (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: '#F3F4F6', color: '#6B7280', letterSpacing: '0.08em' }}>INACTIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 2 }}>{ins.title}</div>
                  {ins.credentials && (
                    <div style={{ fontSize: 11.5, color: '#9CA3AF', marginTop: 2 }}>{ins.credentials}</div>
                  )}
                  {(ins.email || ins.linkedin_url) && (
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, display: 'flex', gap: 10 }}>
                      {ins.email && <span>✉ {ins.email}</span>}
                      {ins.linkedin_url && <a href={ins.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, textDecoration: 'none' }}>in ↗</a>}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => move(ins, -1)} disabled={idx === 0}
                          style={{ ...btn('#fff', NAVY), padding: '6px 10px', border: `1px solid ${BORDER}`, opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                  <button onClick={() => move(ins, 1)} disabled={idx === instructors.length - 1}
                          style={{ ...btn('#fff', NAVY), padding: '6px 10px', border: `1px solid ${BORDER}`, opacity: idx === instructors.length - 1 ? 0.3 : 1 }}>↓</button>
                  {!ins.is_default && (
                    <button onClick={() => makeDefault(ins)} style={{ ...btn('#fff', '#92400E'), border: `1px solid ${GOLD}` }}>Make Default</button>
                  )}
                  <button onClick={() => toggleActive(ins)} style={{ ...btn(ins.active ? '#fff' : GREEN, ins.active ? '#6B7280' : '#fff'), border: `1px solid ${BORDER}` }}>
                    {ins.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => setEditing(ins)} style={btn(NAVY)}>Edit</button>
                  <button onClick={() => remove(ins)} style={btn(DANGER)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit / Add modal */}
        {editing && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
            <div style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: NAVY, margin: 0 }}>
                  {editing.id ? 'Edit Instructor' : 'New Instructor'}
                </h2>
                <button onClick={() => setEditing(null)} style={{ ...btn('#fff', '#6B7280'), border: `1px solid ${BORDER}` }}>Close</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={label}>Name *</label>
                  <input style={field} value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label style={label}>Title *</label>
                  <input style={field} value={editing.title ?? ''} onChange={e => setEditing(p => ({ ...p, title: e.target.value }))}
                         placeholder="e.g. Corporate Finance & Transaction Advisory Specialist" />
                </div>
                <div>
                  <label style={label}>Credentials</label>
                  <input style={field} value={editing.credentials ?? ''} onChange={e => setEditing(p => ({ ...p, credentials: e.target.value }))}
                         placeholder="e.g. ACCA, FMVA, CFA" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={label}>Email</label>
                    <input style={field} type="email" value={editing.email ?? ''} onChange={e => setEditing(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div>
                    <label style={label}>LinkedIn URL</label>
                    <input style={field} value={editing.linkedin_url ?? ''} onChange={e => setEditing(p => ({ ...p, linkedin_url: e.target.value }))}
                           placeholder="https://linkedin.com/in/…" />
                  </div>
                </div>
                <div>
                  <label style={label}>Photo URL</label>
                  <input style={field} value={editing.photo_url ?? ''} onChange={e => setEditing(p => ({ ...p, photo_url: e.target.value }))}
                         placeholder="https://…/photo.jpg" />
                </div>
                <div>
                  <label style={label}>Bio</label>
                  <RichTextarea
                    value={editing.bio ?? ''}
                    onChange={html => setEditing(p => ({ ...p, bio: html }))}
                    minHeight={90}
                    placeholder="Short professional background (optional)"
                  />
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 4 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: NAVY, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.is_default === true}
                           onChange={e => setEditing(p => ({ ...p, is_default: e.target.checked }))} />
                    Default instructor
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: NAVY, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.active !== false}
                           onChange={e => setEditing(p => ({ ...p, active: e.target.checked }))} />
                    Active
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                <button onClick={save} disabled={saving} style={{ ...btn(GREEN), opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : editing.id ? 'Save Changes' : 'Create Instructor'}
                </button>
                <button onClick={() => setEditing(null)} style={{ ...btn('#fff', '#6B7280'), border: `1px solid ${BORDER}` }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.type === 'ok' ? '#1A7A30' : DANGER,
          color: '#fff', fontWeight: 700, fontSize: 13,
          padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999,
        }}>
          {toast.type === 'ok' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
