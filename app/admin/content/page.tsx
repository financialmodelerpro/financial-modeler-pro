'use client';
import React, { useState, useEffect, useRef } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { RichTextEditor } from '@/src/components/admin/RichTextEditor';

type Tab = 'footer' | 'section_styles' | 'articles_page' | 'legal' | 'branding';

const TABS: { key: Tab; label: string; page: string }[] = [
  { key: 'footer',         label: 'Footer',           page: 'All Pages' },
  { key: 'section_styles', label: 'Section Styles',   page: 'All Pages' },
  { key: 'branding',       label: 'Logo & Branding',  page: 'All Pages' },
  { key: 'articles_page',  label: 'Articles',         page: 'Articles Page' },
  { key: 'legal',          label: 'Legal Pages',      page: 'Legal Pages' },
];

export default function AdminContentPage() {
  const [tab, setTab] = useState<Tab>('footer');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  type StatRow = { id: number; value: string; label: string };
  const [statItems, setStatItems] = useState<StatRow[]>([]);
  const [statsDirty, setStatsDirty] = useState(false);

  type CustomField = { label: string; value: string };
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const logoUploadRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [activeStyleSection, setActiveStyleSection] = useState('hero');

  useEffect(() => {
    fetch('/api/admin/content')
      .then(r => r.json())
      .then(j => {
        const map: Record<string, string> = {};
        for (const row of j.rows ?? []) map[`${row.section}__${row.key}`] = row.value;

        // Init stat items — try JSON array first, fall back to individual keys
        const statsJson = map['stats__stats_bar_items'] ?? '';
        let parsed: StatRow[] | null = null;
        if (statsJson) {
          try {
            const arr = JSON.parse(statsJson) as { value: string; label: string; order: number }[];
            parsed = arr.sort((a, b) => a.order - b.order).map((s, i) => ({ id: i + 1, value: s.value, label: s.label }));
          } catch { /* fall through */ }
        }
        if (!parsed) {
          const fb = [1,2,3,4].map((n, i) => ({ id: i+1, value: map[`stats__stat${n}_value`] ?? '', label: map[`stats__stat${n}_label`] ?? '' })).filter(s => s.value || s.label);
          parsed = fb.length ? fb : [
            { id: 1, value: '10+',       label: 'MODELING PLATFORMS'  },
            { id: 2, value: '100%',      label: 'FREE TRAINING'        },
            { id: 3, value: 'Excel+PDF', label: 'EXPORT FORMATS'       },
            { id: 4, value: '20+',       label: 'CURRENCIES SUPPORTED' },
          ];
        }
        setStatItems(parsed);

        // Init contact custom fields
        const cfRaw = map['contact__custom_fields'] ?? '';
        let cf: CustomField[] = [];
        try { if (cfRaw) cf = JSON.parse(cfRaw) as CustomField[]; } catch { /* ignore */ }
        setCustomFields(cf);

        // Init section_styles fields (parse JSON into individual _style_ keys)
        const STYLE_IDS = ['hero','stats','about','pillars','founder','articles','testimonials','pricing','cta'];
        const styleExtras: Record<string, string> = {};
        for (const sid of STYLE_IDS) {
          const raw = map[`section_styles__${sid}`] ?? '{}';
          let parsed: Record<string, string> = {};
          try { parsed = JSON.parse(raw) as Record<string, string>; } catch { /* ignore */ }
          styleExtras[`_style___${sid}_headingSize`]     = parsed.headingSize    ?? '';
          styleExtras[`_style___${sid}_headingColor`]    = parsed.headingColor   ?? '';
          styleExtras[`_style___${sid}_subheadingSize`]  = parsed.subheadingSize ?? '';
          styleExtras[`_style___${sid}_subheadingColor`] = parsed.subheadingColor?? '';
          styleExtras[`_style___${sid}_paddingY`]        = parsed.paddingY       ?? '';
        }
        setValues(prev => ({ ...prev, ...map, ...styleExtras }));

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function get(section: string, key: string, fallback = '') {
    return values[`${section}__${key}`] ?? fallback;
  }
  function set(section: string, key: string, val: string) {
    setValues(p => ({ ...p, [`${section}__${key}`]: val }));
  }

  async function saveSection(rows: Array<{ section: string; key: string }>) {
    setSaving(true);
    try {
      await Promise.all(rows.map(r =>
        fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: r.section, key: r.key, value: get(r.section, r.key) }),
        })
      ));
      setToast({ msg: 'Saved successfully', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function saveStats() {
    setSaving(true);
    try {
      const json = JSON.stringify(statItems.map((s, i) => ({ value: s.value, label: s.label, order: i + 1 })));
      const res = await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'stats', key: 'stats_bar_items', value: json }),
      });
      if (!res.ok) throw new Error('Failed');
      setStatsDirty(false);
      setToast({ msg: 'Stats saved', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function saveSectionStyle(sectionId: string) {
    setSaving(true);
    try {
      const raw = get('section_styles', sectionId, '{}');
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(raw) as Record<string, string>; } catch { /* ignore */ }
      // Build from individual values stored under _style_ keys
      const hs  = get('_style_', `${sectionId}_headingSize`,    '');
      const hc  = get('_style_', `${sectionId}_headingColor`,   '');
      const ss  = get('_style_', `${sectionId}_subheadingSize`, '');
      const sc  = get('_style_', `${sectionId}_subheadingColor`,'');
      const py  = get('_style_', `${sectionId}_paddingY`,       '');
      parsed = { ...(hs  ? {headingSize:    hs}  : {}),
                 ...(hc  ? {headingColor:   hc}  : {}),
                 ...(ss  ? {subheadingSize:  ss} : {}),
                 ...(sc  ? {subheadingColor: sc} : {}),
                 ...(py  ? {paddingY:        py} : {}) };
      const res = await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'section_styles', key: sectionId, value: JSON.stringify(parsed) }),
      });
      if (!res.ok) throw new Error('Failed');
      setToast({ msg: 'Section styles saved', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally { setSaving(false); }
  }

  // Initialise _style_ values from section_styles JSON when content loads
  function initStyleFields(sectionId: string) {
    const raw = get('section_styles', sectionId, '{}');
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(raw) as Record<string, string>; } catch { /* ignore */ }
    return {
      headingSize:     parsed.headingSize    ?? '',
      headingColor:    parsed.headingColor   ?? '',
      subheadingSize:  parsed.subheadingSize ?? '',
      subheadingColor: parsed.subheadingColor?? '',
      paddingY:        parsed.paddingY       ?? '',
    };
  }

  async function saveContactPage() {
    setSaving(true);
    try {
      const fixedRows = [
        { section: 'contact', key: 'email' },
        { section: 'contact', key: 'phone' },
        { section: 'contact', key: 'address' },
        { section: 'contact', key: 'maps_url' },
        { section: 'contact', key: 'hours' },
      ];
      await Promise.all([
        ...fixedRows.map(r =>
          fetch('/api/admin/content', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: r.section, key: r.key, value: get(r.section, r.key) }),
          })
        ),
        fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'contact', key: 'custom_fields', value: JSON.stringify(customFields) }),
        }),
      ]);
      setToast({ msg: 'Saved successfully', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: 'Save failed', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 2 * 1024 * 1024) {
      setToast({ msg: 'Logo must be under 2 MB', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', 'cms-assets');
      const res  = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      // Store the public URL — never the base64 DataURL
      set('branding', 'logo_url', data.url);
      await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'branding', key: 'logo_url', value: data.url }),
      });
      setToast({ msg: 'Logo uploaded', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: 'Logo upload failed. Please try again.', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLogoUploading(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 };
  const fieldStyle: React.CSSProperties = { marginBottom: 20 };

  const saveBtn = (rows: Array<{ section: string; key: string }>) => (
    <button disabled={saving} onClick={() => saveSection(rows)} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );

  // Group tabs by page
  const globalTabs   = TABS.filter(t => t.page === 'All Pages');
  const landingTabs  = TABS.filter(t => t.page === 'Landing Page');
  const trainingTabs = TABS.filter(t => t.page === 'Training Dashboard' || t.page === 'Training Page');
  const otherTabs    = TABS.filter(t => t.page !== 'Landing Page' && t.page !== 'All Pages' && t.page !== 'Training Dashboard' && t.page !== 'Training Page');
  const currentTab   = TABS.find(t => t.key === tab);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/content" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto', maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Content Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>Edit content for all public pages. Changes reflect on the site within 60 seconds (ISR cache).</p>

        {/* Tab groups */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Global (All Pages)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid #E8F0FB', marginBottom: 14, paddingBottom: 0 }}>
            {globalTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '9px 18px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#7C3AED' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #7C3AED' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Landing Page</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid #E8F0FB', paddingBottom: 0 }}>
            {landingTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '9px 18px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#1B4F8A' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #1B4F8A' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '18px 0 6px' }}>Training</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid #E8F0FB', paddingBottom: 0 }}>
            {trainingTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '9px 18px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#C9A84C' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #C9A84C' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '18px 0 6px' }}>Other Pages</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid #E8F0FB', paddingBottom: 0 }}>
            {otherTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '9px 18px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#1A7A30' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #1A7A30' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Page label */}
        {currentTab && (
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 16 }}>
            Editing: <strong style={{ color: '#374151' }}>{currentTab.page}</strong>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading content…</div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '28px 32px' }}>

            {/* ── Global: Branding ── */}
            {tab === 'branding' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 7 }}>
                  🎨 Header logo — appears in the navigation bar on <strong>all public pages</strong>. Upload PNG, SVG, or JPG (max 2 MB). Leave blank to use the default text logo.
                </p>

                {/* Current logo preview */}
                <div style={{ marginBottom: 20, padding: 16, background: '#0D2E5A', borderRadius: 10, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  {get('branding','logo_url','') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={get('branding','logo_url','')} alt="Current logo"
                      style={{ height: Math.min(Math.round(parseFloat(get('branding','logo_height_inches','0.4') || '0.4') * 96), 80), width: 'auto', maxWidth: 280, objectFit: 'contain', display: 'block' }} />
                  ) : (
                    <div style={{ width: 80, height: 40, background: 'rgba(255,255,255,0.1)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 24 }}>📐</span>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Preview on dark background</div>
                </div>

                {/* Upload button */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>Upload Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => !logoUploading && logoUploadRef.current?.click()} disabled={logoUploading}
                      style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, color: '#1B4F8A', background: '#E8F0FB', border: '1px solid #BDD0F0', borderRadius: 7, cursor: logoUploading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: logoUploading ? 0.6 : 1 }}>
                      {logoUploading ? 'Uploading…' : 'Upload New Logo'}
                    </button>
                    {get('branding','logo_url','') && (
                      <button type="button" onClick={() => set('branding','logo_url','')}
                        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#6B7280', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Clear Logo
                      </button>
                    )}
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>PNG, SVG, JPG — max 2 MB</span>
                  </div>
                  <input ref={logoUploadRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleLogoFile} />
                </div>

                {/* Alt text */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>Logo Alt Text</label>
                  <input style={inputStyle} value={get('branding','logo_alt','Financial Modeler Pro')} onChange={e => set('branding','logo_alt',e.target.value)} placeholder="Financial Modeler Pro" />
                </div>

                {/* Size */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                  <div>
                    <label style={labelStyle}>Logo Width (inches)</label>
                    <input style={inputStyle} type="number" step="0.01" min="0.2" max="8" value={get('branding','logo_width_inches','2.75')} onChange={e => set('branding','logo_width_inches',e.target.value)} placeholder="2.75" />
                    <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                      = {Math.round(parseFloat(get('branding','logo_width_inches','2.75') || '2.75') * 96)}px on screen
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Logo Height (inches)</label>
                    <input style={inputStyle} type="number" step="0.01" min="0.1" max="4" value={get('branding','logo_height_inches','1.17')} onChange={e => set('branding','logo_height_inches',e.target.value)} placeholder="1.17" />
                    <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                      = {Math.round(parseFloat(get('branding','logo_height_inches','1.17') || '1.17') * 96)}px on screen
                    </p>
                  </div>
                </div>

                {/* Position */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>Logo Position in Header</label>
                  <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
                    {(['top-left','top-center','top-right'] as const).map(pos => (
                      <label key={pos} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: get('branding','logo_position','top-left') === pos ? 700 : 400 }}>
                        <input type="radio" name="logo_position" value={pos}
                          checked={get('branding','logo_position','top-left') === pos}
                          onChange={() => set('branding','logo_position',pos)} />
                        {pos === 'top-left' ? 'Top Left' : pos === 'top-center' ? 'Top Center' : 'Top Right'}
                      </label>
                    ))}
                  </div>
                </div>

                {saveBtn([
                  {section:'branding',key:'logo_url'},
                  {section:'branding',key:'logo_alt'},
                  {section:'branding',key:'logo_width_inches'},
                  {section:'branding',key:'logo_height_inches'},
                  {section:'branding',key:'logo_position'},
                ])}
              </div>
            )}

            {/* ── Global: Section Styles ── */}
            {tab === 'section_styles' && (() => {
              const STYLE_SECTIONS = [
                { id: 'hero',         label: 'Hero Section' },
                { id: 'stats',        label: 'Stats Bar' },
                { id: 'about',        label: 'About FMP' },
                { id: 'pillars',      label: 'Two Pillars' },
                { id: 'founder',      label: 'Founder Section' },
                { id: 'articles',     label: 'Articles Preview' },
                { id: 'testimonials', label: 'Testimonials' },
                { id: 'pricing',      label: 'Pricing' },
                { id: 'cta',          label: 'CTA Banner' },
              ];
              const sid = activeStyleSection;
              const hs  = get('_style_', `${sid}_headingSize`,    '');
              const hc  = get('_style_', `${sid}_headingColor`,   '');
              const ss  = get('_style_', `${sid}_subheadingSize`, '');
              const sc  = get('_style_', `${sid}_subheadingColor`,'');
              const py  = get('_style_', `${sid}_paddingY`,       '');
              const colorInputStyle: React.CSSProperties = { ...inputStyle, background: '#fff', padding: '4px 8px', width: 40, height: 34, cursor: 'pointer' };
              return (
                <div>
                  <p style={{ fontSize:12, color:'#6B7280', marginBottom:20, padding:'10px 14px', background:'#F3F4F6', border:'1px solid #E5E7EB', borderRadius:7 }}>
                    🎨 Override font sizes, colors, and section padding. Leave blank to keep default styles. Applies to the Landing Page. Saves within 60 seconds.
                  </p>
                  {/* Section selector */}
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:24, borderBottom:'2px solid #E8F0FB', paddingBottom:12 }}>
                    {STYLE_SECTIONS.map(s2 => (
                      <button key={s2.id} onClick={() => setActiveStyleSection(s2.id)}
                        style={{ padding:'7px 14px', fontSize:12, fontWeight: sid===s2.id?700:500, background: sid===s2.id?'#1B4F8A':'#F9FAFB', color: sid===s2.id?'#fff':'#6B7280', border:'1px solid '+(sid===s2.id?'#1B4F8A':'#E5E7EB'), borderRadius:6, cursor:'pointer' }}>
                        {s2.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:24 }}>
                    <div>
                      <label style={labelStyle}>Heading Font Size</label>
                      <input style={inputStyle} value={hs} onChange={e => set('_style_', `${sid}_headingSize`, e.target.value)} placeholder="e.g. 36px or clamp(24px,3vw,42px)" />
                      <p style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Leave blank for default</p>
                    </div>
                    <div>
                      <label style={labelStyle}>Heading Color</label>
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <input type="color" style={colorInputStyle} value={hc || '#1B3A6B'} onChange={e => set('_style_', `${sid}_headingColor`, e.target.value)} />
                        <input style={{ ...inputStyle, flex:1 }} value={hc} onChange={e => set('_style_', `${sid}_headingColor`, e.target.value)} placeholder="#1B3A6B" />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Subheading Font Size</label>
                      <input style={inputStyle} value={ss} onChange={e => set('_style_', `${sid}_subheadingSize`, e.target.value)} placeholder="e.g. 15px" />
                    </div>
                    <div>
                      <label style={labelStyle}>Subheading Color</label>
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <input type="color" style={colorInputStyle} value={sc || '#6B7280'} onChange={e => set('_style_', `${sid}_subheadingColor`, e.target.value)} />
                        <input style={{ ...inputStyle, flex:1 }} value={sc} onChange={e => set('_style_', `${sid}_subheadingColor`, e.target.value)} placeholder="#6B7280" />
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Section Vertical Padding (height)</label>
                      <input style={inputStyle} value={py} onChange={e => set('_style_', `${sid}_paddingY`, e.target.value)} placeholder="e.g. 88px or clamp(48px,7vw,80px)" />
                      <p style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Applied as padding-top and padding-bottom</p>
                    </div>
                  </div>
                  <button disabled={saving} onClick={() => saveSectionStyle(sid)}
                    style={{ background: saving?'#6B7280':'#1B4F8A', color:'#fff', border:'none', borderRadius:8, padding:'10px 24px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    {saving ? 'Saving…' : `Save ${STYLE_SECTIONS.find(s2=>s2.id===sid)?.label} Styles`}
                  </button>
                </div>
              );
            })()}

            {/* Obsolete tabs (hero, stats, about, pillars, cta) removed — migrated to Page Builder */}

            {/* ── Landing: Footer ── */}
            {tab === 'footer' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Company Line</label><input style={inputStyle} value={get('footer','company_line','')} onChange={e => set('footer','company_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Company Line</label><input style={inputStyle} value={get('footer','company_line','')} onChange={e => set('footer','company_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Founder Line</label><input style={inputStyle} value={get('footer','founder_line','')} onChange={e => set('footer','founder_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Copyright Text</label><input style={inputStyle} value={get('footer','copyright','')} onChange={e => set('footer','copyright',e.target.value)} /></div>

                <div style={{ borderTop:'1px solid #E8F0FB', paddingTop:20, marginTop:4, marginBottom:20 }}>
                  <p style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:14 }}>FOOTER HEIGHT</p>
                  <div style={{ display:'flex', gap:16, marginBottom:16 }}>
                    {(['compact','standard','large'] as const).map(h => (
                      <label key={h} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', fontWeight: get('footer','height','standard') === h ? 700 : 400 }}>
                        <input type="radio" name="footer_height" value={h} checked={get('footer','height','standard') === h} onChange={() => set('footer','height',h)} />
                        {h.charAt(0).toUpperCase()+h.slice(1)} {h==='compact'?'(32px)':h==='standard'?'(40px)':'(64px)'}
                      </label>
                    ))}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <div>
                      <label style={labelStyle}>Padding Top (px)</label>
                      <input style={inputStyle} type="number" value={get('footer','padding_top','40')} onChange={e => set('footer','padding_top',e.target.value)} placeholder="40" />
                    </div>
                    <div>
                      <label style={labelStyle}>Padding Bottom (px)</label>
                      <input style={inputStyle} type="number" value={get('footer','padding_bottom','40')} onChange={e => set('footer','padding_bottom',e.target.value)} placeholder="40" />
                    </div>
                  </div>
                </div>

                <div style={{ borderTop:'1px solid #E8F0FB', paddingTop:20, marginBottom:20 }}>
                  <p style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:14 }}>SHOW / HIDE SECTIONS</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {[
                      { key:'show_description',    label:'Company description column' },
                      { key:'show_quick_links',     label:'Quick links column (Platform)' },
                      { key:'show_company_links',   label:'Company links column' },
                      { key:'show_privacy',         label:'Privacy Policy link in footer' },
                      { key:'show_confidentiality', label:'Confidentiality & Terms link in footer' },
                    ].map(item => (
                      <label key={item.key} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', fontSize:13 }}>
                        <input type="checkbox" checked={get('footer',item.key,'true') !== 'false'} onChange={e => set('footer',item.key, e.target.checked ? 'true' : 'false')} style={{ width:15, height:15, cursor:'pointer' }} />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>

                {saveBtn([
                  {section:'footer',key:'company_line'},
                  {section:'footer',key:'founder_line'},
                  {section:'footer',key:'copyright'},
                  {section:'footer',key:'height'},
                  {section:'footer',key:'padding_top'},
                  {section:'footer',key:'padding_bottom'},
                  {section:'footer',key:'show_description'},
                  {section:'footer',key:'show_quick_links'},
                  {section:'footer',key:'show_company_links'},
                  {section:'footer',key:'show_privacy'},
                  {section:'footer',key:'show_confidentiality'},
                ])}
              </div>
            )}

            {/* ── Articles Page ── */}
            {tab === 'articles_page' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 7 }}>
                  📰 Controls the header text on the public <strong>/articles</strong> listing page. Does not affect individual article posts.
                </p>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Page Badge</label>
                  <input style={inputStyle} value={get('articles_page','badge','Knowledge Hub')} onChange={e => set('articles_page','badge',e.target.value)} placeholder="Knowledge Hub" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Small label shown above the page title.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Page Title</label>
                  <input style={inputStyle} value={get('articles_page','title','Financial Modeling Insights')} onChange={e => set('articles_page','title',e.target.value)} placeholder="Financial Modeling Insights" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Main heading on the articles listing page.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Page Subtitle</label>
                  <textarea style={{...inputStyle, resize:'vertical'}} rows={2} value={get('articles_page','subtitle','Expert guides, tutorials and market analysis from corporate finance professionals')} onChange={e => set('articles_page','subtitle',e.target.value)} />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Supporting text below the title.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Featured Section Title</label>
                  <input style={inputStyle} value={get('articles_page','featured_title','Featured Articles')} onChange={e => set('articles_page','featured_title',e.target.value)} placeholder="Featured Articles" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Heading above the featured articles row (if any articles are marked featured).</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>All Articles Section Title</label>
                  <input style={inputStyle} value={get('articles_page','all_title','Latest Articles')} onChange={e => set('articles_page','all_title',e.target.value)} placeholder="Latest Articles" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Heading above the main articles grid.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Empty State Message</label>
                  <input style={inputStyle} value={get('articles_page','empty_message','No articles published yet. Check back soon.')} onChange={e => set('articles_page','empty_message',e.target.value)} placeholder="No articles published yet. Check back soon." />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Message shown when no articles are published yet.</p>
                </div>
                {saveBtn([
                  {section:'articles_page',key:'badge'},
                  {section:'articles_page',key:'title'},
                  {section:'articles_page',key:'subtitle'},
                  {section:'articles_page',key:'featured_title'},
                  {section:'articles_page',key:'all_title'},
                  {section:'articles_page',key:'empty_message'},
                ])}
              </div>
            )}

            {/* ── Legal Pages ── */}
            {tab === 'legal' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 7 }}>
                  ⚖️ Controls the content on <strong>/privacy-policy</strong> and <strong>/confidentiality</strong> pages. These pages are linked from the site footer.
                </p>

                {/* Privacy Policy */}
                <div style={{ borderBottom: '2px solid #E8F0FB', paddingBottom: 28, marginBottom: 28 }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Privacy Policy</p>
                  <div style={fieldStyle}><label style={labelStyle}>Page Title</label><input style={inputStyle} value={get('privacy_policy','title','Privacy Policy')} onChange={e => set('privacy_policy','title',e.target.value)} /></div>
                  <div style={fieldStyle}><label style={labelStyle}>Last Updated Date</label><input style={inputStyle} value={get('privacy_policy','updated','March 2026')} onChange={e => set('privacy_policy','updated',e.target.value)} placeholder="March 2026" /></div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Content</label>
                    <textarea style={{...inputStyle, resize:'vertical', minHeight:200}} rows={10}
                      value={get('privacy_policy','content','This Privacy Policy describes how Financial Modeler Pro collects, uses, and protects your personal information...')}
                      onChange={e => set('privacy_policy','content',e.target.value)} />
                    <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Use double line breaks to separate paragraphs. Paragraphs starting with a number (e.g. "1. TITLE") are styled as section headings.</p>
                  </div>
                  {saveBtn([{section:'privacy_policy',key:'title'},{section:'privacy_policy',key:'updated'},{section:'privacy_policy',key:'content'}])}
                </div>

                {/* Confidentiality */}
                <div>
                  <p style={{ fontSize: 13, fontWeight: 800, color: '#1B3A6B', marginBottom: 16 }}>Confidentiality &amp; Terms</p>
                  <div style={fieldStyle}><label style={labelStyle}>Page Title</label><input style={inputStyle} value={get('confidentiality','title','Confidentiality & Terms of Use')} onChange={e => set('confidentiality','title',e.target.value)} /></div>
                  <div style={fieldStyle}><label style={labelStyle}>Last Updated Date</label><input style={inputStyle} value={get('confidentiality','updated','March 2026')} onChange={e => set('confidentiality','updated',e.target.value)} placeholder="March 2026" /></div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Content</label>
                    <textarea style={{...inputStyle, resize:'vertical', minHeight:200}} rows={10}
                      value={get('confidentiality','content','By accessing Financial Modeler Pro platform and training materials, you agree to the following terms...')}
                      onChange={e => set('confidentiality','content',e.target.value)} />
                    <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Use double line breaks to separate paragraphs. Paragraphs starting with a number are styled as section headings.</p>
                  </div>
                  {saveBtn([{section:'confidentiality',key:'title'},{section:'confidentiality',key:'updated'},{section:'confidentiality',key:'content'}])}
                </div>
              </div>
            )}

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
