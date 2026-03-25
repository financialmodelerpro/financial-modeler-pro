'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type Tab = 'branding' | 'hero' | 'stats' | 'about' | 'pillars' | 'cta' | 'footer' | 'training_page' | 'modeling_hub' | 'contact_page';

const TABS: { key: Tab; label: string; page: string }[] = [
  { key: 'branding',      label: 'Logo & Branding', page: 'All Pages' },
  { key: 'hero',          label: 'Hero',           page: 'Landing Page' },
  { key: 'stats',         label: 'Stats Bar',      page: 'Landing Page' },
  { key: 'about',         label: 'About FMP',      page: 'Landing Page' },
  { key: 'pillars',       label: 'Two Pillars',    page: 'Landing Page' },
  { key: 'cta',           label: 'CTA Banner',     page: 'Landing Page' },
  { key: 'footer',        label: 'Footer',         page: 'Landing Page' },
  { key: 'training_page', label: 'Training Hub',   page: 'Training Page' },
  { key: 'modeling_hub',  label: 'Modeling Hub',   page: 'Modeling Hub Page' },
  { key: 'contact_page',  label: 'Contact Page',   page: 'Contact Page' },
];

export default function AdminContentPage() {
  const [tab, setTab] = useState<Tab>('hero');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  type StatRow = { id: number; value: string; label: string };
  const [statItems, setStatItems] = useState<StatRow[]>([]);
  const [statsDirty, setStatsDirty] = useState(false);

  useEffect(() => {
    fetch('/api/admin/content')
      .then(r => r.json())
      .then(j => {
        const map: Record<string, string> = {};
        for (const row of j.rows ?? []) map[`${row.section}__${row.key}`] = row.value;
        setValues(map);

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

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 };
  const fieldStyle: React.CSSProperties = { marginBottom: 20 };

  const saveBtn = (rows: Array<{ section: string; key: string }>) => (
    <button disabled={saving} onClick={() => saveSection(rows)} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );

  // Group tabs by page
  const globalTabs  = TABS.filter(t => t.page === 'All Pages');
  const landingTabs = TABS.filter(t => t.page === 'Landing Page');
  const otherTabs   = TABS.filter(t => t.page !== 'Landing Page' && t.page !== 'All Pages');
  const currentTab  = TABS.find(t => t.key === tab);

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
                  🎨 Logo appears in the navigation bar on <strong>all public pages</strong>. Upload your logo to the Media Library first, then paste the URL here. Recommended: PNG with transparent background, height ~40px.
                </p>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Logo URL</label>
                  <input style={inputStyle} value={get('branding','logo_url','')} onChange={e => set('branding','logo_url',e.target.value)} placeholder="https://… or paste from Media Library" />
                </div>
                {get('branding','logo_url','') && (
                  <div style={{ marginBottom: 20, padding: '16px', background: '#0D2E5A', borderRadius: 8, display: 'inline-block' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={get('branding','logo_url','')} alt="Logo preview" style={{ height: 36, width: 'auto', objectFit: 'contain', display: 'block' }} />
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>Preview on dark background</div>
                  </div>
                )}
                <div style={{ ...fieldStyle }}>
                  <label style={labelStyle}>Logo Alt Text</label>
                  <input style={inputStyle} value={get('branding','logo_alt','Financial Modeler Pro')} onChange={e => set('branding','logo_alt',e.target.value)} placeholder="Financial Modeler Pro" />
                </div>
                {saveBtn([{section:'branding',key:'logo_url'},{section:'branding',key:'logo_alt'}])}
                <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 12 }}>Leave Logo URL blank to use the default text logo.</p>
              </div>
            )}

            {/* ── Landing: Hero ── */}
            {tab === 'hero' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Badge Text</label><input style={inputStyle} value={get('hero','badge_text','🚀 Now Live — Free to Use')} onChange={e => set('hero','badge_text',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={2} value={get('hero','headline','Build Institutional-Grade Financial Models — Without Starting From Scratch')} onChange={e => set('hero','headline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Sub-headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('hero','subheadline','')} onChange={e => set('hero','subheadline',e.target.value)} /></div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Power Statement</label>
                  <input style={inputStyle} value={get('hero','power_statement','No more rebuilding models. No more broken Excel files. No more wasted hours.')} onChange={e => set('hero','power_statement',e.target.value)} placeholder="No more rebuilding models. No more broken Excel files." />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Short punchy line shown below the subheading with a green left accent.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Soft CTA Text</label>
                  <input style={inputStyle} value={get('hero','soft_cta','Explore the platform')} onChange={e => set('hero','soft_cta',e.target.value)} placeholder="Explore the platform" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Subtle text link with a down arrow. Scrolls to the platforms section on click.</p>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Trust Line</label>
                  <input style={inputStyle} value={get('hero','trust_line','Designed by Investment & Corporate Finance Experts  |  12+ Years Experience  |  Used Across KSA & Pakistan')} onChange={e => set('hero','trust_line',e.target.value)} />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Specialty Tags</label>
                  <input style={inputStyle} value={get('hero','tags','Real Estate Models, Business Valuation, Project Finance, Fund Models')} onChange={e => set('hero','tags',e.target.value)} placeholder="Real Estate Models, Business Valuation, Project Finance" />
                  <p style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>Comma-separated. Rendered as pill badges below the trust line.</p>
                </div>
                <div style={{ padding:'10px 14px', background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:7, marginBottom:20 }}>
                  <p style={{ fontSize:12, color:'#92400E', margin:0 }}>&#9432; <strong>Button CTAs (below) are hidden in the current hero design.</strong> Edit &ldquo;Soft CTA Text&rdquo; above instead.</p>
                </div>
                <div style={fieldStyle}><label style={{ ...labelStyle, color:'#9CA3AF' }}>CTA 1 Label (hidden)</label><input style={{...inputStyle, opacity:0.6}} value={get('hero','cta1','Launch Platform Free →')} onChange={e => set('hero','cta1',e.target.value)} /></div>
                <div style={fieldStyle}><label style={{ ...labelStyle, color:'#9CA3AF' }}>CTA 2 Label (hidden)</label><input style={{...inputStyle, opacity:0.6}} value={get('hero','cta2','Explore Platforms ↓')} onChange={e => set('hero','cta2',e.target.value)} /></div>
                {saveBtn([
                  {section:'hero',key:'badge_text'},
                  {section:'hero',key:'headline'},
                  {section:'hero',key:'subheadline'},
                  {section:'hero',key:'power_statement'},
                  {section:'hero',key:'soft_cta'},
                  {section:'hero',key:'trust_line'},
                  {section:'hero',key:'tags'},
                  {section:'hero',key:'cta1'},
                  {section:'hero',key:'cta2'},
                ])}
              </div>
            )}

            {/* ── Landing: Stats ── */}
            {tab === 'stats' && (
              <div>
                <p style={{ fontSize:13, fontWeight:700, color:'#1B3A6B', marginBottom:6 }}>Stats Bar Management</p>
                <p style={{ fontSize:12, color:'#6B7280', marginBottom:20 }}>Manage the stats displayed below the hero section. Use the arrows to reorder.</p>

                {statItems.map((stat, idx) => (
                  <div key={stat.id} style={{ display:'flex', alignItems:'flex-end', gap:10, marginBottom:12, padding:'12px 14px', background:'#F9FAFB', borderRadius:8, border:'1px solid #E5E7EB' }}>
                    {/* Reorder */}
                    <div style={{ display:'flex', flexDirection:'column', gap:3, paddingBottom:2 }}>
                      <button
                        disabled={idx === 0}
                        onClick={() => { const a=[...statItems]; [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; setStatItems(a); setStatsDirty(true); }}
                        style={{ background:'none', border:'1px solid #D1D5DB', borderRadius:4, cursor:idx===0?'default':'pointer', padding:'1px 7px', fontSize:10, color:idx===0?'#D1D5DB':'#374151' }}
                      >&#9650;</button>
                      <button
                        disabled={idx===statItems.length-1}
                        onClick={() => { const a=[...statItems]; [a[idx],a[idx+1]]=[a[idx+1],a[idx]]; setStatItems(a); setStatsDirty(true); }}
                        style={{ background:'none', border:'1px solid #D1D5DB', borderRadius:4, cursor:idx===statItems.length-1?'default':'pointer', padding:'1px 7px', fontSize:10, color:idx===statItems.length-1?'#D1D5DB':'#374151' }}
                      >&#9660;</button>
                    </div>
                    {/* Value */}
                    <div style={{ flex:'0 0 120px' }}>
                      <label style={{ ...labelStyle, marginBottom:4 }}>Value</label>
                      <input style={inputStyle} value={stat.value} placeholder="e.g. 10+" onChange={e => { setStatItems(statItems.map((s,i)=>i===idx?{...s,value:e.target.value}:s)); setStatsDirty(true); }} />
                    </div>
                    {/* Label */}
                    <div style={{ flex:1 }}>
                      <label style={{ ...labelStyle, marginBottom:4 }}>Label</label>
                      <input style={inputStyle} value={stat.label} placeholder="e.g. MODELING PLATFORMS" onChange={e => { setStatItems(statItems.map((s,i)=>i===idx?{...s,label:e.target.value}:s)); setStatsDirty(true); }} />
                    </div>
                    {/* Delete */}
                    <button
                      onClick={() => {
                        if (statItems.length === 1 && !confirm('Remove the last stat?')) return;
                        setStatItems(statItems.filter((_,i)=>i!==idx));
                        setStatsDirty(true);
                      }}
                      style={{ background:'none', border:'1px solid #FCA5A5', borderRadius:6, color:'#EF4444', cursor:'pointer', padding:'6px 10px', fontSize:12, marginBottom:1 }}
                      title="Delete stat"
                    >&#10005;</button>
                  </div>
                ))}

                {statItems.length < 8 ? (
                  <button
                    onClick={() => { setStatItems([...statItems, { id: Date.now(), value: '', label: '' }]); setStatsDirty(true); }}
                    style={{ background:'none', border:'1px dashed #9CA3AF', borderRadius:8, color:'#6B7280', cursor:'pointer', padding:'10px 20px', fontSize:13, width:'100%', marginBottom:20 }}
                  >+ Add Stat</button>
                ) : (
                  <p style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', marginBottom:20 }}>Maximum 8 stats reached.</p>
                )}

                <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                  <button
                    disabled={saving}
                    onClick={saveStats}
                    style={{ background:saving?'#6B7280':'#1B4F8A', color:'#fff', border:'none', borderRadius:8, padding:'10px 24px', fontSize:13, fontWeight:700, cursor:'pointer' }}
                  >{saving ? 'Saving…' : 'Save Changes'}</button>
                  {statsDirty && <span style={{ fontSize:12, color:'#D97706', fontWeight:600 }}>&#9679; Unsaved changes</span>}
                </div>
                <p style={{ fontSize:11, color:'#9CA3AF', marginTop:10 }}>Changes reflect on the live site within 60 seconds.</p>
              </div>
            )}

            {/* ── Landing: About ── */}
            {tab === 'about' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Section Badge</label><input style={inputStyle} value={get('about','badge','The Platform')} onChange={e => set('about','badge',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Section Heading</label><input style={inputStyle} value={get('about','heading','What is Financial Modeler Pro?')} onChange={e => set('about','heading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Body Paragraph 1</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={4} value={get('about','what_is_fmp','')} onChange={e => set('about','what_is_fmp',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Body Paragraph 2</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={4} value={get('about','what_is_fmp_2','')} onChange={e => set('about','what_is_fmp_2',e.target.value)} /></div>
                {saveBtn([{section:'about',key:'badge'},{section:'about',key:'heading'},{section:'about',key:'what_is_fmp'},{section:'about',key:'what_is_fmp_2'}])}
              </div>
            )}

            {/* ── Landing: Pillars ── */}
            {tab === 'pillars' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Section Heading</label><input style={inputStyle} value={get('pillars','heading','Two Platforms. One Destination.')} onChange={e => set('pillars','heading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Section Sub-heading</label><input style={inputStyle} value={get('pillars','subheading','Modeling + Training — everything a financial professional needs in one place.')} onChange={e => set('pillars','subheading',e.target.value)} /></div>
                <div style={{ borderTop: '1px solid #E8F0FB', paddingTop: 20, marginTop: 8, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', marginBottom: 14 }}>MODELING CARD</p>
                  <div style={fieldStyle}><label style={labelStyle}>Title</label><input style={inputStyle} value={get('pillars','model_title','Modeling Platform')} onChange={e => set('pillars','model_title',e.target.value)} /></div>
                  <div style={fieldStyle}><label style={labelStyle}>Description</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('pillars','model_desc','')} onChange={e => set('pillars','model_desc',e.target.value)} /></div>
                </div>
                <div style={{ borderTop: '1px solid #E8F0FB', paddingTop: 20, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#1A7A30', marginBottom: 14 }}>TRAINING CARD</p>
                  <div style={fieldStyle}><label style={labelStyle}>Title</label><input style={inputStyle} value={get('pillars','training_title','Training Hub')} onChange={e => set('pillars','training_title',e.target.value)} /></div>
                  <div style={fieldStyle}><label style={labelStyle}>Description</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('pillars','training_desc','')} onChange={e => set('pillars','training_desc',e.target.value)} /></div>
                </div>
                {saveBtn([{section:'pillars',key:'heading'},{section:'pillars',key:'subheading'},{section:'pillars',key:'model_title'},{section:'pillars',key:'model_desc'},{section:'pillars',key:'training_title'},{section:'pillars',key:'training_desc'}])}
              </div>
            )}

            {/* ── Landing: CTA Banner ── */}
            {tab === 'cta' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Heading</label><input style={inputStyle} value={get('cta','heading','Ready to build your first model?')} onChange={e => set('cta','heading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Sub-heading</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={2} value={get('cta','subheading','')} onChange={e => set('cta','subheading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Button Label</label><input style={inputStyle} value={get('cta','button','Get Started Free →')} onChange={e => set('cta','button',e.target.value)} /></div>
                {saveBtn([{section:'cta',key:'heading'},{section:'cta',key:'subheading'},{section:'cta',key:'button'}])}
              </div>
            )}

            {/* ── Landing: Footer ── */}
            {tab === 'footer' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Company Line</label><input style={inputStyle} value={get('footer','company_line','')} onChange={e => set('footer','company_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Founder Line</label><input style={inputStyle} value={get('footer','founder_line','')} onChange={e => set('footer','founder_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Copyright Text</label><input style={inputStyle} value={get('footer','copyright','')} onChange={e => set('footer','copyright',e.target.value)} /></div>
                {saveBtn([{section:'footer',key:'company_line'},{section:'footer',key:'founder_line'},{section:'footer',key:'copyright'}])}
              </div>
            )}

            {/* ── Training Hub Page ── */}
            {tab === 'training_page' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 7 }}>
                  📍 Controls text on the public <strong>/training</strong> page. Leave blank to use the default text.
                </p>
                <div style={fieldStyle}><label style={labelStyle}>Hero Badge Text</label><input style={inputStyle} value={get('training_page','hero_badge','🎓 Free Certification Program')} onChange={e => set('training_page','hero_badge',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Hero Headline</label><input style={inputStyle} value={get('training_page','hero_headline','Get Certified in Financial Modeling — Free')} onChange={e => set('training_page','hero_headline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Hero Sub-headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('training_page','hero_sub','Professional certification backed by real practitioner training. 100% free. Always.')} onChange={e => set('training_page','hero_sub',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Primary Label</label><input style={inputStyle} value={get('training_page','cta_primary','Register Free →')} onChange={e => set('training_page','cta_primary',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Secondary Label</label><input style={inputStyle} value={get('training_page','cta_secondary','Login to Dashboard →')} onChange={e => set('training_page','cta_secondary',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Bottom CTA Heading</label><input style={inputStyle} value={get('training_page','bottom_cta_heading','Ready to get certified?')} onChange={e => set('training_page','bottom_cta_heading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Bottom CTA Sub-text</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={2} value={get('training_page','bottom_cta_sub','Join hundreds of finance professionals building verified skills — completely free.')} onChange={e => set('training_page','bottom_cta_sub',e.target.value)} /></div>
                {saveBtn([
                  {section:'training_page',key:'hero_badge'},
                  {section:'training_page',key:'hero_headline'},
                  {section:'training_page',key:'hero_sub'},
                  {section:'training_page',key:'cta_primary'},
                  {section:'training_page',key:'cta_secondary'},
                  {section:'training_page',key:'bottom_cta_heading'},
                  {section:'training_page',key:'bottom_cta_sub'},
                ])}
              </div>
            )}

            {/* ── Contact Page ── */}
            {tab === 'contact_page' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 7 }}>
                  📬 Controls the contact information displayed on the public <strong>/contact</strong> page.
                </p>
                <div style={fieldStyle}><label style={labelStyle}>Contact Email</label><input style={inputStyle} value={get('contact','email','')} onChange={e => set('contact','email',e.target.value)} placeholder="info@example.com" /></div>
                <div style={fieldStyle}><label style={labelStyle}>Phone Number</label><input style={inputStyle} value={get('contact','phone','')} onChange={e => set('contact','phone',e.target.value)} placeholder="+1 (555) 000-0000" /></div>
                <div style={fieldStyle}><label style={labelStyle}>Address</label><textarea style={{...inputStyle, resize:'vertical'}} rows={3} value={get('contact','address','')} onChange={e => set('contact','address',e.target.value)} placeholder="123 Main St, City, Country" /></div>
                <div style={fieldStyle}><label style={labelStyle}>Google Maps Embed URL</label><input style={inputStyle} value={get('contact','maps_url','')} onChange={e => set('contact','maps_url',e.target.value)} placeholder="https://maps.google.com/…" /></div>
                <div style={fieldStyle}><label style={labelStyle}>Office Hours</label><input style={inputStyle} value={get('contact','hours','Monday – Friday, 9am – 6pm')} onChange={e => set('contact','hours',e.target.value)} /></div>
                {saveBtn([{section:'contact',key:'email'},{section:'contact',key:'phone'},{section:'contact',key:'address'},{section:'contact',key:'maps_url'},{section:'contact',key:'hours'}])}
              </div>
            )}

            {/* ── Modeling Hub Page ── */}
            {tab === 'modeling_hub' && (
              <div>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 7 }}>
                  📍 Controls text on the public <strong>/modeling-hub</strong> page. Leave blank to use the default text.
                </p>
                <div style={fieldStyle}><label style={labelStyle}>Hero Badge Text</label><input style={inputStyle} value={get('modeling_hub','hero_badge','📐 Professional Modeling Platform')} onChange={e => set('modeling_hub','hero_badge',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Hero Headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={2} value={get('modeling_hub','hero_headline','Build Institutional-Grade\nFinancial Models')} onChange={e => set('modeling_hub','hero_headline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Hero Sub-headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('modeling_hub','hero_sub','Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.')} onChange={e => set('modeling_hub','hero_sub',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Primary Label</label><input style={inputStyle} value={get('modeling_hub','cta_primary','Launch Platform Free →')} onChange={e => set('modeling_hub','cta_primary',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Secondary Label</label><input style={inputStyle} value={get('modeling_hub','cta_secondary','Login to Dashboard →')} onChange={e => set('modeling_hub','cta_secondary',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>"What is Modeling Hub" Heading</label><input style={inputStyle} value={get('modeling_hub','what_heading','What is the Modeling Hub?')} onChange={e => set('modeling_hub','what_heading',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>"What is Modeling Hub" Body</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={4} value={get('modeling_hub','what_body','A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast.')} onChange={e => set('modeling_hub','what_body',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Bottom CTA Heading</label><input style={inputStyle} value={get('modeling_hub','bottom_cta_heading','Ready to build your first model?')} onChange={e => set('modeling_hub','bottom_cta_heading',e.target.value)} /></div>
                {saveBtn([
                  {section:'modeling_hub',key:'hero_badge'},
                  {section:'modeling_hub',key:'hero_headline'},
                  {section:'modeling_hub',key:'hero_sub'},
                  {section:'modeling_hub',key:'cta_primary'},
                  {section:'modeling_hub',key:'cta_secondary'},
                  {section:'modeling_hub',key:'what_heading'},
                  {section:'modeling_hub',key:'what_body'},
                  {section:'modeling_hub',key:'bottom_cta_heading'},
                ])}
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
