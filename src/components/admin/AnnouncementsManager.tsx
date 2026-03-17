'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'success' | 'maintenance';
  active: boolean;
  starts_at: string | null;
  ends_at:   string | null;
  created_at: string;
}

type AnnType = Announcement['type'];

const TYPE_COLOR: Record<AnnType, string> = { info: 'var(--color-navy-mid)', warning: '#92400e', success: 'var(--color-green-dark)', maintenance: '#7c3aed' };
const TYPE_BG:    Record<AnnType, string> = { info: 'var(--color-navy-pale)', warning: '#fef3c7', success: 'var(--color-green-light)', maintenance: '#ede9fe' };
const TYPE_ICON:  Record<AnnType, string> = { info: 'ℹ️', warning: '⚠️', success: '✅', maintenance: '🔧' };

const BLANK = { title: '', body: '', type: 'info' as AnnType, active: true, starts_at: '', ends_at: '' };

export default function AnnouncementsManager() {
  const [anns,    setAnns]    = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(BLANK);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/announcements');
    if (res.ok) setAnns((await res.json()).announcements ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.title || !form.body) { showToast('Title and body are required'); return; }
    setSaving(true);
    const res = await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, starts_at: form.starts_at || null, ends_at: form.ends_at || null }),
    });
    if (res.ok) {
      const json = await res.json();
      setAnns((a) => [json.announcement, ...a]);
      setForm(BLANK);
      showToast('Announcement created');
    } else {
      showToast('Failed to create');
    }
    setSaving(false);
  };

  const toggle = async (a: Announcement) => {
    const res = await fetch('/api/admin/announcements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, active: !a.active }),
    });
    if (res.ok) {
      setAnns((prev) => prev.map((x) => x.id === a.id ? { ...x, active: !a.active } : x));
      showToast(a.active ? 'Announcement hidden' : 'Announcement published');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    const res = await fetch('/api/admin/announcements', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setAnns((a) => a.filter((x) => x.id !== id));
      showToast('Deleted');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--color-warning-bg)', fontFamily: 'Inter,sans-serif',
    boxSizing: 'border-box', outline: 'none',
  };

  return (
    <div style={{ fontFamily: 'Inter,sans-serif' }}>

      {/* ── Create form ── */}
      <div style={{ background: '#fafafa', border: '1px solid var(--color-border)', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 14 }}>
          📢 New Announcement
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Scheduled maintenance on Friday" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Message</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Describe the announcement…"
            />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select style={{ ...inputStyle }} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AnnType }))}>
              <option value="info">ℹ️ Info</option>
              <option value="warning">⚠️ Warning</option>
              <option value="success">✅ Success / New Feature</option>
              <option value="maintenance">🔧 Maintenance</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 20 }}>
            <input type="checkbox" id="ann-active" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            <label htmlFor="ann-active" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', cursor: 'pointer' }}>
              Publish immediately
            </label>
          </div>
          <div>
            <label style={labelStyle}>Show from (optional)</label>
            <input type="datetime-local" style={inputStyle} value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Hide after (optional)</label>
            <input type="datetime-local" style={inputStyle} value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={create}
              disabled={saving}
              style={{ padding: '8px 24px', background: 'var(--color-primary)', color: 'var(--color-grey-white)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}
            >
              {saving ? '…' : '📢 Publish Announcement'}
            </button>
          </div>
        </div>
      </div>

      {/* ── List ── */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)' }}>Loading…</div>
      ) : anns.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-meta)', background: '#fafafa', borderRadius: 8, border: '2px dashed var(--color-border)' }}>
          No announcements yet. Create one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {anns.map((a) => (
            <div key={a.id} style={{
              border: `1px solid ${TYPE_COLOR[a.type]}30`,
              borderLeft: `4px solid ${TYPE_COLOR[a.type]}`,
              borderRadius: 8, padding: '12px 16px',
              background: a.active ? 'var(--color-grey-white)' : '#fafafa',
              opacity: a.active ? 1 : 0.65,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{TYPE_ICON[a.type]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-heading)' }}>{a.title}</span>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: TYPE_BG[a.type], color: TYPE_COLOR[a.type] }}>
                    {a.type.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: a.active ? 'var(--color-green-light)' : '#fee2e2', color: a.active ? 'var(--color-green-dark)' : 'var(--color-negative)' }}>
                    {a.active ? 'LIVE' : 'HIDDEN'}
                  </span>
                </div>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-meta)', lineHeight: 1.5 }}>{a.body}</p>
                <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                  Created {new Date(a.created_at).toLocaleString()}
                  {a.starts_at && <> · From {new Date(a.starts_at).toLocaleString()}</>}
                  {a.ends_at   && <> · Until {new Date(a.ends_at).toLocaleString()}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => toggle(a)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, color: 'var(--color-heading)' }}>
                  {a.active ? 'Hide' : 'Publish'}
                </button>
                <button onClick={() => remove(a.id)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 10, border: '1px solid #fca5a5', background: '#fee2e2', cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: 600, color: 'var(--color-negative)' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, background: 'var(--color-green-dark)', color: 'var(--color-grey-white)', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', fontFamily: 'Inter,sans-serif' }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--color-muted)', marginBottom: 4,
};
