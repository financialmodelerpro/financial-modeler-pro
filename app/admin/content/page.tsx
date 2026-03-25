'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type Tab = 'hero' | 'stats' | 'about' | 'pillars' | 'cta' | 'footer' | 'training_page' | 'modeling_hub';

const TABS: { key: Tab; label: string; page: string }[] = [
  { key: 'hero',          label: 'Hero',           page: 'Landing Page' },
  { key: 'stats',         label: 'Stats Bar',      page: 'Landing Page' },
  { key: 'about',         label: 'About FMP',      page: 'Landing Page' },
  { key: 'pillars',       label: 'Two Pillars',    page: 'Landing Page' },
  { key: 'cta',           label: 'CTA Banner',     page: 'Landing Page' },
  { key: 'footer',        label: 'Footer',         page: 'Landing Page' },
  { key: 'training_page', label: 'Training Hub',   page: 'Training Page' },
  { key: 'modeling_hub',  label: 'Modeling Hub',   page: 'Modeling Hub Page' },
];

export default function AdminContentPage() {
  const [tab, setTab] = useState<Tab>('hero');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch('/api/admin/content')
      .then(r => r.json())
      .then(j => {
        const map: Record<string, string> = {};
        for (const row of j.rows ?? []) map[`${row.section}__${row.key}`] = row.value;
        setValues(map);
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

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 };
  const fieldStyle: React.CSSProperties = { marginBottom: 20 };

  const saveBtn = (rows: Array<{ section: string; key: string }>) => (
    <button disabled={saving} onClick={() => saveSection(rows)} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
      {saving ? 'Saving…' : 'Save Changes'}
    </button>
  );

  // Group tabs by page
  const landingTabs = TABS.filter(t => t.page === 'Landing Page');
  const otherTabs   = TABS.filter(t => t.page !== 'Landing Page');
  const currentTab  = TABS.find(t => t.key === tab);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/content" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto', maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Content Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>Edit content for all public pages. Changes reflect on the site within 60 seconds (ISR cache).</p>

        {/* Tab groups */}
        <div style={{ marginBottom: 32 }}>
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

            {/* ── Landing: Hero ── */}
            {tab === 'hero' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Badge Text</label><input style={inputStyle} value={get('hero','badge_text','🚀 Now Live — Free to Use')} onChange={e => set('hero','badge_text',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={2} value={get('hero','headline','The Operating System\nfor Financial Modeling')} onChange={e => set('hero','headline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Sub-headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('hero','subheadline','')} onChange={e => set('hero','subheadline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA 1 Label</label><input style={inputStyle} value={get('hero','cta1','Launch Platform Free →')} onChange={e => set('hero','cta1',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA 2 Label</label><input style={inputStyle} value={get('hero','cta2','Explore Platforms ↓')} onChange={e => set('hero','cta2',e.target.value)} /></div>
                {saveBtn([{section:'hero',key:'badge_text'},{section:'hero',key:'headline'},{section:'hero',key:'subheadline'},{section:'hero',key:'cta1'},{section:'hero',key:'cta2'}])}
              </div>
            )}

            {/* ── Landing: Stats ── */}
            {tab === 'stats' && (
              <div>
                {[1,2,3,4].map(n => (
                  <div key={n} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                    <div><label style={labelStyle}>Stat {n} Value</label><input style={inputStyle} value={get('stats',`stat${n}_value`,'')} onChange={e => set('stats',`stat${n}_value`,e.target.value)} /></div>
                    <div><label style={labelStyle}>Stat {n} Label</label><input style={inputStyle} value={get('stats',`stat${n}_label`,'')} onChange={e => set('stats',`stat${n}_label`,e.target.value)} /></div>
                  </div>
                ))}
                {saveBtn([1,2,3,4].flatMap(n => [{section:'stats',key:`stat${n}_value`},{section:'stats',key:`stat${n}_label`}]))}
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
