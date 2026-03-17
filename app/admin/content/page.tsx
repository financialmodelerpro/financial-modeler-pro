'use client';
import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type Tab = 'hero' | 'stats' | 'about' | 'footer';

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
  const TABS: { key: Tab; label: string }[] = [
    { key: 'hero',   label: 'Hero' },
    { key: 'stats',  label: 'Stats Bar' },
    { key: 'about',  label: 'About FMP' },
    { key: 'footer', label: 'Footer' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/content" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto', maxWidth: 900 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 6 }}>Content Manager</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>Edit landing page content. Changes reflect on the site within 60 seconds.</p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E8F0FB', marginBottom: 32 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '10px 20px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? '#1B4F8A' : '#6B7280', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid #1B4F8A' : '2px solid transparent', marginBottom: -2, cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading content…</div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '28px 32px' }}>
            {tab === 'hero' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Headline</label><input style={inputStyle} value={get('hero','headline','The Professional Hub\nfor Financial Modeling')} onChange={e => set('hero','headline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Sub-headline</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={3} value={get('hero','subheadline','')} onChange={e => set('hero','subheadline',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Primary Label</label><input style={inputStyle} value={get('hero','cta_primary_label','Launch Platform Free →')} onChange={e => set('hero','cta_primary_label',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>CTA Secondary Label</label><input style={inputStyle} value={get('hero','cta_secondary_label','Explore Platforms ↓')} onChange={e => set('hero','cta_secondary_label',e.target.value)} /></div>
                <button disabled={saving} onClick={() => saveSection([{section:'hero',key:'headline'},{section:'hero',key:'subheadline'},{section:'hero',key:'cta_primary_label'},{section:'hero',key:'cta_secondary_label'}])} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
            {tab === 'stats' && (
              <div>
                {[1,2,3,4].map(n => (
                  <div key={n} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                    <div><label style={labelStyle}>Stat {n} Value</label><input style={inputStyle} value={get('stats',`stat${n}_value`,['10+','100%','Excel + PDF','20+'][n-1])} onChange={e => set('stats',`stat${n}_value`,e.target.value)} /></div>
                    <div><label style={labelStyle}>Stat {n} Label</label><input style={inputStyle} value={get('stats',`stat${n}_label`,['Modeling Platforms','Free Training','Export Formats','Currencies Supported'][n-1])} onChange={e => set('stats',`stat${n}_label`,e.target.value)} /></div>
                  </div>
                ))}
                <button disabled={saving} onClick={() => saveSection([1,2,3,4].flatMap(n => [{section:'stats',key:`stat${n}_value`},{section:'stats',key:`stat${n}_label`}]))} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
            {tab === 'about' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>What is FMP (paragraph 1)</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={4} value={get('about','what_is_fmp','')} onChange={e => set('about','what_is_fmp',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>What is FMP (paragraph 2)</label><textarea style={{...inputStyle, resize: 'vertical'}} rows={4} value={get('about','what_is_fmp_2','')} onChange={e => set('about','what_is_fmp_2',e.target.value)} /></div>
                <button disabled={saving} onClick={() => saveSection([{section:'about',key:'what_is_fmp'},{section:'about',key:'what_is_fmp_2'}])} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
            {tab === 'footer' && (
              <div>
                <div style={fieldStyle}><label style={labelStyle}>Company Line</label><input style={inputStyle} value={get('footer','company_line','')} onChange={e => set('footer','company_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Founder Line</label><input style={inputStyle} value={get('footer','founder_line','')} onChange={e => set('footer','founder_line',e.target.value)} /></div>
                <div style={fieldStyle}><label style={labelStyle}>Copyright Text</label><input style={inputStyle} value={get('footer','copyright','')} onChange={e => set('footer','copyright',e.target.value)} /></div>
                <button disabled={saving} onClick={() => saveSection([{section:'footer',key:'company_line'},{section:'footer',key:'founder_line'},{section:'footer',key:'copyright'}])} style={{ background: saving ? '#6B7280' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
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
