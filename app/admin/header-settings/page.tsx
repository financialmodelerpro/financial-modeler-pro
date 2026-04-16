'use client';

import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { MediaPickerButton } from '@/src/components/admin/MediaPicker';
import { RichTextEditor } from '@/src/components/admin/RichTextEditor';

const SECTION = 'header_settings';

const KEYS = [
  'logo_enabled', 'logo_url', 'logo_width_px', 'logo_height_px', 'logo_position',
  'show_brand_name', 'brand_name', 'show_tagline', 'tagline',
  'icon_url', 'icon_as_favicon', 'icon_in_header', 'icon_size_px',
  'header_height_px', 'header_padding_top_px', 'header_padding_bottom_px',
  'achievement_card_logo_height',
] as const;

type Vals = Record<string, string>;

export default function HeaderSettingsPage() {
  const [vals, setVals] = useState<Vals>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch('/api/admin/content')
      .then(r => r.json())
      .then(j => {
        const map: Vals = {};
        for (const row of (j.rows ?? []) as { section: string; key: string; value: string }[]) {
          if (row.section === SECTION) map[row.key] = row.value ?? '';
        }
        setVals(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function set(key: string, value: string) {
    setVals(prev => ({ ...prev, [key]: value }));
  }

  function bool(key: string): boolean {
    return vals[key] === 'true';
  }

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all(KEYS.map(k =>
        fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: SECTION, key: k, value: vals[k] ?? '' }),
        })
      ));
      setToast('Saved');
      setTimeout(() => setToast(''), 2500);
    } catch {
      setToast('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const IS: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
  const LS: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block' };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
        <CmsAdminNav active="/admin/header-settings" />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>Loading...</main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/header-settings" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Header Settings</h1>
              <p style={{ fontSize: 13, color: '#6B7280' }}>Configure logo, branding text, favicon, and header layout across all pages.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{toast}</span>}
              <button onClick={saveAll} disabled={saving} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save All'}
              </button>
            </div>
          </div>

          {/* ── Section A: Logo ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Logo</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 16 }}>
              <input type="checkbox" checked={bool('logo_enabled')} onChange={e => set('logo_enabled', e.target.checked ? 'true' : 'false')} style={{ width: 16, height: 16 }} />
              Enable Logo
            </label>
            <div style={{ marginBottom: 12 }}>
              <label style={LS}>Logo Image</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...IS, flex: 1 }} value={vals.logo_url ?? ''} onChange={e => set('logo_url', e.target.value)} placeholder="https://... or upload →" />
                <MediaPickerButton onSelect={url => set('logo_url', url)} />
              </div>
              {vals.logo_url && (
                <div style={{ marginTop: 8, padding: 12, background: '#0D2E5A', borderRadius: 8, display: 'inline-block' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={vals.logo_url} alt="Logo preview" style={{ height: parseInt(vals.logo_height_px || '36') || 36, width: vals.logo_width_px ? parseInt(vals.logo_width_px) : 'auto', objectFit: 'contain' }} />
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={LS}>Width (px)</label><input type="number" style={IS} value={vals.logo_width_px ?? ''} onChange={e => set('logo_width_px', e.target.value)} placeholder="auto" /></div>
              <div><label style={LS}>Height (px)</label><input type="number" style={IS} value={vals.logo_height_px ?? ''} onChange={e => set('logo_height_px', e.target.value)} placeholder="36" /></div>
              <div>
                <label style={LS}>Position</label>
                <select style={IS} value={vals.logo_position ?? 'left'} onChange={e => set('logo_position', e.target.value)}>
                  <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                </select>
              </div>
            </div>
            <div style={{ width: 200 }}>
              <label style={LS}>Achievement Card Logo Height (px)</label>
              <input type="number" style={IS} value={vals.achievement_card_logo_height ?? ''} onChange={e => set('achievement_card_logo_height', e.target.value)} placeholder="48" />
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>Logo height on the achievement share card. Width scales automatically. Default: 48</div>
            </div>
          </div>

          {/* ── Section B: Branding Text ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Branding Text</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
              <input type="checkbox" checked={bool('show_brand_name')} onChange={e => set('show_brand_name', e.target.checked ? 'true' : 'false')} style={{ width: 16, height: 16 }} />
              Show Brand Name (when no logo image)
            </label>
            <div style={{ marginBottom: 12 }}><label style={LS}>Brand Name</label><input style={IS} value={vals.brand_name ?? ''} onChange={e => set('brand_name', e.target.value)} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
              <input type="checkbox" checked={bool('show_tagline')} onChange={e => set('show_tagline', e.target.checked ? 'true' : 'false')} style={{ width: 16, height: 16 }} />
              Show Tagline
            </label>
            <div>
              <label style={LS}>Tagline</label>
              <RichTextEditor value={vals.tagline ?? ''} onChange={v => set('tagline', v)} compact />
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>Supports bold, italic, color, font size. HTML saved directly.</div>
            </div>
          </div>

          {/* ── Section C: Header Icon ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Header Icon</h2>
            <div style={{ marginBottom: 12 }}>
              <label style={LS}>Icon Image</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...IS, flex: 1 }} value={vals.icon_url ?? ''} onChange={e => set('icon_url', e.target.value)} placeholder="https://... or upload →" />
                <MediaPickerButton onSelect={url => set('icon_url', url)} />
              </div>
              {vals.icon_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vals.icon_url} alt="Icon preview" style={{ marginTop: 8, height: parseInt(vals.icon_size_px || '20'), width: 'auto', objectFit: 'contain', borderRadius: 4, border: '1px solid #E5E7EB' }} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                <input type="checkbox" checked={bool('icon_as_favicon')} onChange={e => set('icon_as_favicon', e.target.checked ? 'true' : 'false')} style={{ width: 16, height: 16 }} />
                Use as Favicon
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' }}>
                <input type="checkbox" checked={bool('icon_in_header')} onChange={e => set('icon_in_header', e.target.checked ? 'true' : 'false')} style={{ width: 16, height: 16 }} />
                Show in Header
              </label>
            </div>
            <div style={{ width: 120 }}><label style={LS}>Icon Size (px)</label><input type="number" style={IS} value={vals.icon_size_px ?? ''} onChange={e => set('icon_size_px', e.target.value)} placeholder="20" /></div>
          </div>

          {/* ── Section D: Header Layout ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Header Layout</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div><label style={LS}>Header Height (px)</label><input type="number" style={IS} value={vals.header_height_px ?? ''} onChange={e => set('header_height_px', e.target.value)} placeholder="auto" /></div>
              <div><label style={LS}>Padding Top (px)</label><input type="number" style={IS} value={vals.header_padding_top_px ?? ''} onChange={e => set('header_padding_top_px', e.target.value)} placeholder="0" /></div>
              <div><label style={LS}>Padding Bottom (px)</label><input type="number" style={IS} value={vals.header_padding_bottom_px ?? ''} onChange={e => set('header_padding_bottom_px', e.target.value)} placeholder="0" /></div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
