'use client';

import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Shared styles ──────────────────────────────────────────────────────────────
const IS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none', boxSizing: 'border-box' };
const LS: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 };
const TA: React.CSSProperties = { ...IS, resize: 'vertical' as const, minHeight: 60, fontFamily: 'inherit' };
const BTN: React.CSSProperties = { padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer' };
const DEL: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11 };

type TabKey = 'header' | 'footer' | 'colors' | 'seo';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'header', label: 'Header' },
  { key: 'footer', label: 'Footer' },
  { key: 'colors', label: 'Colors & Typography' },
  { key: 'seo',    label: 'SEO & Analytics' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Settings = Record<string, any>;

export default function SiteSettingsPage() {
  const [tab, setTab] = useState<TabKey>('header');
  const [settings, setSettings] = useState<Record<TabKey, Settings>>({ header: {}, footer: {}, colors: {}, seo: {} });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [uploading, setUploading] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/site-settings');
    const { settings: rows } = await res.json();
    const map: Record<string, Settings> = {};
    for (const row of rows ?? []) map[row.key] = row.value;
    setSettings({
      header: map.header ?? {},
      footer: map.footer ?? {},
      colors: map.colors ?? {},
      seo:    map.seo ?? {},
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (key: TabKey) => {
    setSaving(true);
    try {
      await fetch('/api/admin/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: settings[key] }),
      });
      showToast('Saved!');
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const uploadFile = async (folder: string): Promise<string | null> => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg,.ico';
    return new Promise(resolve => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('folder', folder);
        try {
          const res = await fetch('/api/admin/site-settings', { method: 'POST', body: fd });
          const { url } = await res.json();
          resolve(url ?? null);
        } catch { resolve(null); }
        finally { setUploading(false); }
      };
      input.click();
    });
  };

  const cur = settings[tab];
  const set = (k: string, v: unknown) => setSettings(prev => ({ ...prev, [tab]: { ...prev[tab], [k]: v } }));

  // ── Render helpers ───────────────────────────────────────────────────────────
  const colorField = (label: string, key: string, placeholder: string) => (
    <div>
      <label style={LS}>{label}</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="color" value={(cur[key] as string) ?? '#ffffff'} onChange={e => set(key, e.target.value)} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
        <input style={IS} value={(cur[key] as string) ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
      </div>
    </div>
  );

  const textField = (label: string, key: string, placeholder?: string) => (
    <div>
      <label style={LS}>{label}</label>
      <input style={IS} value={(cur[key] as string) ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
    </div>
  );

  const numField = (label: string, key: string, placeholder?: string) => (
    <div>
      <label style={LS}>{label}</label>
      <input style={IS} type="number" value={(cur[key] as number) ?? ''} onChange={e => set(key, Number(e.target.value))} placeholder={placeholder} />
    </div>
  );

  const toggleField = (label: string, key: string) => (
    <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!cur[key]} onChange={e => set(key, e.target.checked)} />
      {label}
    </label>
  );

  const logoUpload = (label: string, key: string) => (
    <div>
      <label style={LS}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input style={{ ...IS, flex: 1 }} value={(cur[key] as string) ?? ''} onChange={e => set(key, e.target.value)} placeholder="https://..." />
        <button disabled={uploading} onClick={async () => { const url = await uploadFile('logos'); if (url) set(key, url); }}
          style={{ ...BTN, background: '#0D2E5A', fontSize: 11, padding: '7px 12px', whiteSpace: 'nowrap' }}>
          {uploading ? '...' : 'Upload'}
        </button>
      </div>
      {cur[key] && (
        <div style={{ marginTop: 8, padding: 8, background: '#F9FAFB', borderRadius: 6, border: '1px solid #E5E7EB', display: 'inline-block' }}>
          <img src={cur[key] as string} alt="Preview" style={{ maxHeight: 60, maxWidth: 200, objectFit: 'contain' }} />
        </div>
      )}
    </div>
  );

  // ── Tab content renderers ───────────────────────────────────────────────────
  function renderHeader() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {logoUpload('Logo', 'logo_url')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {numField('Logo Width (px)', 'logo_width', '140')}
          <div>
            <label style={LS}>Logo Position</label>
            <select style={IS} value={(cur.logo_position as string) ?? 'left'} onChange={e => set('logo_position', e.target.value)}>
              <option value="left">Left</option><option value="center">Center</option>
            </select>
          </div>
          {textField('Logo Link URL', 'logo_link_url', '/')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
          {textField('Tagline Text', 'tagline_text', 'Structured Modeling. Real-World Finance.')}
          {numField('Tagline Font Size', 'tagline_size', '12')}
          {colorField('Tagline Color', 'tagline_color', '#6B7280')}
        </div>
        <div>
          <label style={LS}>Tagline Position</label>
          <select style={IS} value={(cur.tagline_position as string) ?? 'beside'} onChange={e => set('tagline_position', e.target.value)}>
            <option value="beside">Beside Logo</option><option value="below">Below Logo</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {colorField('Header Background', 'bg_color', '#ffffff')}
          {colorField('Header Text Color', 'text_color', '#0D2E5A')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {textField('CTA Button Text', 'cta_text', 'Get Started')}
          {textField('CTA Button URL', 'cta_url', '/register')}
          {colorField('CTA Button Color', 'cta_color', '#2EAA4A')}
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {toggleField('Show CTA Button', 'cta_visible')}
          {toggleField('Sticky Header', 'sticky')}
        </div>
        {numField('Header Height (px)', 'height', '64')}
        {/* Navigation Links */}
        <div style={{ marginTop: 8, padding: 12, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Navigation Links</div>
          {((cur.nav_links as { label: string; url: string; new_tab: boolean }[]) ?? []).map((link, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input style={{ ...IS, flex: 1 }} value={link.label} onChange={e => {
                const n = [...(cur.nav_links as typeof link[])]; n[i] = { ...n[i], label: e.target.value }; set('nav_links', n);
              }} placeholder="Label" />
              <input style={{ ...IS, flex: 2 }} value={link.url} onChange={e => {
                const n = [...(cur.nav_links as typeof link[])]; n[i] = { ...n[i], url: e.target.value }; set('nav_links', n);
              }} placeholder="URL" />
              <label style={{ fontSize: 10, whiteSpace: 'nowrap', display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="checkbox" checked={link.new_tab} onChange={e => {
                  const n = [...(cur.nav_links as typeof link[])]; n[i] = { ...n[i], new_tab: e.target.checked }; set('nav_links', n);
                }} /> New tab
              </label>
              <button onClick={() => { const n = [...(cur.nav_links as typeof link[])]; n.splice(i, 1); set('nav_links', n); }} style={DEL}>X</button>
            </div>
          ))}
          <button onClick={() => set('nav_links', [...((cur.nav_links as unknown[]) ?? []), { label: '', url: '/', new_tab: false }])}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add Link</button>
        </div>
      </div>
    );
  }

  function renderFooter() {
    const columns = (cur.columns as { heading: string; links: { label: string; url: string }[] }[]) ?? [];
    const social = (cur.social as Record<string, string>) ?? {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {logoUpload('Footer Logo', 'logo_url')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {colorField('Footer Background', 'bg_color', '#0A1F3D')}
          {colorField('Footer Text Color', 'text_color', '#ffffff')}
        </div>
        <div>
          <label style={LS}>Copyright Text</label>
          <input style={IS} value={(cur.copyright as string) ?? ''} onChange={e => set('copyright', e.target.value)} placeholder={'Use {year} for current year'} />
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{'{year}'} will be replaced with the current year</div>
        </div>

        {/* Footer Columns */}
        <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Footer Columns</div>
          {columns.map((col, ci) => (
            <div key={ci} style={{ marginBottom: 12, padding: 10, background: '#fff', borderRadius: 6, border: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input style={{ ...IS, flex: 1, fontWeight: 700 }} value={col.heading} onChange={e => {
                  const n = [...columns]; n[ci] = { ...n[ci], heading: e.target.value }; set('columns', n);
                }} placeholder="Column Heading" />
                <button onClick={() => { const n = [...columns]; n.splice(ci, 1); set('columns', n); }} style={DEL}>X</button>
              </div>
              {col.links.map((link, li) => (
                <div key={li} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', paddingLeft: 8 }}>
                  <input style={{ ...IS, flex: 1 }} value={link.label} onChange={e => {
                    const n = [...columns]; const links = [...n[ci].links]; links[li] = { ...links[li], label: e.target.value }; n[ci] = { ...n[ci], links }; set('columns', n);
                  }} placeholder="Label" />
                  <input style={{ ...IS, flex: 2 }} value={link.url} onChange={e => {
                    const n = [...columns]; const links = [...n[ci].links]; links[li] = { ...links[li], url: e.target.value }; n[ci] = { ...n[ci], links }; set('columns', n);
                  }} placeholder="URL" />
                  <button onClick={() => {
                    const n = [...columns]; const links = [...n[ci].links]; links.splice(li, 1); n[ci] = { ...n[ci], links }; set('columns', n);
                  }} style={DEL}>X</button>
                </div>
              ))}
              <button onClick={() => {
                const n = [...columns]; n[ci] = { ...n[ci], links: [...n[ci].links, { label: '', url: '/' }] }; set('columns', n);
              }} style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, marginLeft: 8 }}>+ Link</button>
            </div>
          ))}
          <button onClick={() => set('columns', [...columns, { heading: 'Column', links: [{ label: 'Link', url: '/' }] }])}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add Column</button>
        </div>

        {/* Social */}
        <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Social Media Links</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['twitter', 'linkedin', 'youtube', 'instagram', 'facebook'] as const).map(platform => (
              <div key={platform}>
                <label style={LS}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</label>
                <input style={IS} value={social[platform] ?? ''} onChange={e => set('social', { ...social, [platform]: e.target.value })} placeholder={`https://${platform}.com/...`} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          {toggleField('Show Footer Logo', 'show_logo')}
          {toggleField('Show Social Links', 'show_social')}
          {toggleField('Show Copyright', 'show_copyright')}
        </div>
      </div>
    );
  }

  function renderColors() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {colorField('Primary Color', 'primary', '#2EAA4A')}
          {colorField('Secondary Color', 'secondary', '#0D2E5A')}
        </div>
        <div>
          <label style={LS}>Font Family</label>
          <select style={IS} value={(cur.font_family as string) ?? 'Inter'} onChange={e => set('font_family', e.target.value)}>
            <option value="Inter">Inter</option>
            <option value="Poppins">Poppins</option>
            <option value="Roboto">Roboto</option>
            <option value="Montserrat">Montserrat</option>
            <option value="Playfair Display">Playfair Display</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {numField('Base Font Size (px)', 'base_font_size', '16')}
          <div>
            <label style={LS}>Heading Font Weight</label>
            <select style={IS} value={(cur.heading_font_weight as number) ?? 800} onChange={e => set('heading_font_weight', Number(e.target.value))}>
              <option value={400}>400 (Normal)</option>
              <option value={500}>500 (Medium)</option>
              <option value={600}>600 (Semi-Bold)</option>
              <option value={700}>700 (Bold)</option>
              <option value={800}>800 (Extra-Bold)</option>
              <option value={900}>900 (Black)</option>
            </select>
          </div>
        </div>
        {/* Preview */}
        <div style={{ padding: 16, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Preview</div>
          <div style={{ fontFamily: (cur.font_family as string) ?? 'Inter', fontSize: (cur.base_font_size as number) ?? 16 }}>
            <h3 style={{ fontWeight: (cur.heading_font_weight as number) ?? 800, color: (cur.secondary as string) ?? '#0D2E5A', marginBottom: 8 }}>Heading Preview</h3>
            <p style={{ color: '#374151', lineHeight: 1.6 }}>Body text preview with the selected font family and size.</p>
            <button style={{ ...BTN, background: (cur.primary as string) ?? '#2EAA4A', marginTop: 8 }}>Button Preview</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSeo() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {textField('Title Template', 'title_template', '{page} | Financial Modeler Pro')}
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: -8 }}>{'{page}'} is replaced with the page title, {'{site}'} with site name</div>
        <div><label style={LS}>Default Meta Description</label><textarea style={TA} value={(cur.default_description as string) ?? ''} onChange={e => set('default_description', e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {textField('Google Analytics ID', 'google_analytics_id', 'G-XXXXXXXXXX')}
          {textField('Google Tag Manager ID', 'google_tag_manager_id', 'GTM-XXXXXXX')}
          {textField('Facebook Pixel ID', 'facebook_pixel_id', '123456789')}
        </div>
        <div>
          <label style={LS}>Custom {'<head>'} Code</label>
          <textarea style={{ ...TA, minHeight: 80, fontFamily: 'monospace', fontSize: 12 }} value={(cur.head_code as string) ?? ''} onChange={e => set('head_code', e.target.value)} placeholder="<!-- Custom scripts, meta tags -->" />
        </div>
        <div>
          <label style={LS}>Custom {'<body>'} Code</label>
          <textarea style={{ ...TA, minHeight: 60, fontFamily: 'monospace', fontSize: 12 }} value={(cur.body_code as string) ?? ''} onChange={e => set('body_code', e.target.value)} placeholder="<!-- Analytics, chat widgets -->" />
        </div>
        <div>
          <label style={LS}>Favicon</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...IS, flex: 1 }} value={(cur.favicon_url as string) ?? ''} onChange={e => set('favicon_url', e.target.value)} placeholder="https://..." />
            <button disabled={uploading} onClick={async () => { const url = await uploadFile('favicon'); if (url) set('favicon_url', url); }}
              style={{ ...BTN, background: '#0D2E5A', fontSize: 11, padding: '7px 12px', whiteSpace: 'nowrap' }}>
              {uploading ? '...' : 'Upload'}
            </button>
          </div>
          {cur.favicon_url && (
            <div style={{ marginTop: 6 }}>
              <img src={cur.favicon_url as string} alt="Favicon" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const TAB_RENDERERS: Record<TabKey, () => React.ReactNode> = {
    header: renderHeader,
    footer: renderFooter,
    colors: renderColors,
    seo:    renderSeo,
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0D2E5A', flex: 1 }}>Site Settings</h1>
          {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{toast}</span>}
          <button onClick={() => save(tab)} disabled={saving} style={{ ...BTN, background: saving ? '#9CA3AF' : '#2EAA4A' }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', background: '#fff', padding: '0 24px' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none', background: 'transparent',
                borderBottom: tab === t.key ? '2px solid #0D2E5A' : '2px solid transparent',
                color: tab === t.key ? '#0D2E5A' : '#9CA3AF',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 800, background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            {TAB_RENDERERS[tab]()}
          </div>
        </div>
      </main>
    </div>
  );
}
