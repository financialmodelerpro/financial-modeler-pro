'use client';

import { useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

/* ─── types ─── */
interface Setting { section: string; key: string; label: string; type: 'text' | 'toggle' | 'color' | 'url' | 'textarea' }

const SETTINGS: Setting[] = [
  // Platform Identity
  { section: 'platform', key: 'name',              label: 'Platform Name',         type: 'text' },
  { section: 'platform', key: 'tagline',            label: 'Tagline',               type: 'text' },
  { section: 'platform', key: 'logo_url',           label: 'Logo URL',              type: 'url' },
  { section: 'platform', key: 'favicon_url',        label: 'Favicon URL',           type: 'url' },
  { section: 'platform', key: 'primary_color',      label: 'Primary Color',         type: 'color' },
  // Navbar
  { section: 'navbar',   key: 'beta_badge_visible', label: 'Show BETA Badge',       type: 'toggle' },
  // Site Status
  { section: 'site',     key: 'maintenance_mode',   label: 'Maintenance Mode',      type: 'toggle' },
  { section: 'site',     key: 'maintenance_message',label: 'Maintenance Message',   type: 'textarea' },
  // SEO
  { section: 'seo',      key: 'meta_title',         label: 'Default Meta Title',    type: 'text' },
  { section: 'seo',      key: 'meta_description',   label: 'Default Meta Description', type: 'textarea' },
  { section: 'seo',      key: 'og_image_url',        label: 'Default OG Image URL',  type: 'url' },
];

const GROUPS = [
  { id: 'platform', label: 'Platform Identity',  keys: ['name', 'tagline', 'logo_url', 'favicon_url', 'primary_color'] },
  { id: 'navbar',   label: 'Navigation',          keys: ['beta_badge_visible'] },
  { id: 'site',     label: 'Site Status',          keys: ['maintenance_mode', 'maintenance_message'] },
  { id: 'seo',      label: 'SEO Defaults',         keys: ['meta_title', 'meta_description', 'og_image_url'] },
];

export default function AdminSettingsPage() {
  const [values,  setValues]  = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [saved,   setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  useEffect(() => {
    fetch('/api/admin/content')
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string> = {};
        for (const row of j.rows ?? []) map[`${row.section}__${row.key}`] = row.value ?? '';
        setValues(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function skey(s: Setting) { return `${s.section}__${s.key}`; }

  async function saveField(s: Setting) {
    const k = skey(s);
    setSaving((p) => ({ ...p, [k]: true }));
    try {
      await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ section: s.section, key: s.key, value: values[k] ?? '' }]),
      });
      setSaved((p) => ({ ...p, [k]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [k]: false })), 2500);
      showToast('Saved');
    } finally {
      setSaving((p) => ({ ...p, [k]: false }));
    }
  }

  async function saveGroup(groupId: string) {
    const groupSettings = SETTINGS.filter((s) => s.section === groupId);
    for (const s of groupSettings) await saveField(s);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
        <CmsAdminNav />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#6B7280', fontSize: 14 }}>Loading settings…</div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ maxWidth: 720 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Platform Settings</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>
            Configure platform identity, navigation, maintenance mode, and SEO defaults.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {GROUPS.map((group) => {
              const groupSettings = SETTINGS.filter((s) => group.keys.includes(s.key) && s.section === group.id);
              return (
                <div key={group.id} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
                  {/* Group header */}
                  <div style={{ padding: '12px 20px', background: '#1B4F8A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {group.label}
                    </span>
                    <button
                      onClick={() => saveGroup(group.id)}
                      style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.8)', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5, padding: '4px 12px', cursor: 'pointer' }}
                    >
                      Save All
                    </button>
                  </div>

                  <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {groupSettings.map((s) => {
                      const k = skey(s);
                      const val = values[k] ?? '';
                      return (
                        <div key={k}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                            {s.label}
                          </label>

                          {s.type === 'toggle' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <button
                                onClick={() => {
                                  setValues((p) => ({ ...p, [k]: val === 'true' ? 'false' : 'true' }));
                                }}
                                style={{
                                  width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                                  background: val === 'true' ? '#2EAA4A' : '#D1D5DB',
                                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                                }}
                              >
                                <span style={{
                                  position: 'absolute', top: 3, left: val === 'true' ? 24 : 3,
                                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                }} />
                              </button>
                              <span style={{ fontSize: 13, color: val === 'true' ? '#1A7A30' : '#6B7280', fontWeight: 600 }}>
                                {val === 'true' ? 'Enabled' : 'Disabled'}
                              </span>
                              <button
                                onClick={() => saveField(s)}
                                disabled={saving[k]}
                                style={{ marginLeft: 'auto', padding: '6px 16px', fontSize: 12, fontWeight: 700, background: saved[k] ? '#1A7A30' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: saving[k] ? 0.7 : 1 }}
                              >
                                {saving[k] ? '…' : saved[k] ? '✓' : 'Save'}
                              </button>
                            </div>

                          ) : s.type === 'color' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input
                                type="color"
                                value={val || '#1B4F8A'}
                                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                                style={{ width: 44, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 2 }}
                              />
                              <input
                                value={val}
                                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                                placeholder="#1B4F8A"
                                style={{ ...inputStyle, flex: 1 }}
                              />
                              {val && (
                                <div style={{ width: 32, height: 32, borderRadius: 6, background: val, border: '1px solid #E5E7EB', flexShrink: 0 }} />
                              )}
                              <button
                                onClick={() => saveField(s)}
                                disabled={saving[k]}
                                style={btnStyle(saving[k], saved[k])}
                              >
                                {saving[k] ? '…' : saved[k] ? '✓' : 'Save'}
                              </button>
                            </div>

                          ) : s.type === 'textarea' ? (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                              <textarea
                                value={val}
                                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                                rows={3}
                                style={inputStyle}
                              />
                              <button
                                onClick={() => saveField(s)}
                                disabled={saving[k]}
                                style={btnStyle(saving[k], saved[k])}
                              >
                                {saving[k] ? '…' : saved[k] ? '✓' : 'Save'}
                              </button>
                            </div>

                          ) : (
                            <div style={{ display: 'flex', gap: 10 }}>
                              <input
                                value={val}
                                type={s.type === 'url' ? 'url' : 'text'}
                                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && saveField(s)}
                                style={inputStyle}
                              />
                              {s.type === 'url' && val && (
                                <a href={val} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: '#1B4F8A', textDecoration: 'none', flexShrink: 0 }}>↗</a>
                              )}
                              <button
                                onClick={() => saveField(s)}
                                disabled={saving[k]}
                                style={btnStyle(saving[k], saved[k])}
                              >
                                {saving[k] ? '…' : saved[k] ? '✓' : 'Save'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Danger zone */}
          <div style={{ marginTop: 32, background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#DC2626', marginBottom: 8 }}>Danger Zone</div>
            <div style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 1.6 }}>
              To reset content to seed defaults, re-run the SQL migration <code>supabase/migrations/002_phase1_cms.sql</code> in the Supabase SQL Editor. This will restore all CMS content to the original seed values using <code>ON CONFLICT … DO UPDATE</code>.
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1A7A30', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 20px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '8px 12px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 7,
  background: '#FFFBEB', fontFamily: 'Inter, sans-serif',
  outline: 'none', color: '#374151', boxSizing: 'border-box',
  resize: 'vertical',
};

function btnStyle(saving: boolean, saved: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', fontSize: 12, fontWeight: 700,
    borderRadius: 7, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', flexShrink: 0,
    background: saved ? '#1A7A30' : '#1B4F8A', color: '#fff',
    opacity: saving ? 0.7 : 1, transition: 'background 0.2s',
  };
}
