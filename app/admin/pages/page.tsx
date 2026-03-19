'use client';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface SitePage { id: string; label: string; href: string; visible: boolean; display_order: number; can_toggle: boolean }

export default function PagesAdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [pages, setPages] = useState<SitePage[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<SitePage>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    fetch('/api/admin/pages').then(r => r.json()).then(j => setPages(j.pages ?? []));
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const setEdit = (id: string, field: keyof SitePage, value: unknown) =>
    setEdits(p => ({ ...p, [id]: { ...p[id], [field]: value } }));

  const save = async (id: string) => {
    const changes = edits[id];
    if (!changes || !Object.keys(changes).length) return;
    setSaving(s => ({ ...s, [id]: true }));
    const res = await fetch('/api/admin/pages', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...changes }),
    });
    setSaving(s => ({ ...s, [id]: false }));
    if (res.ok) {
      const { page } = await res.json();
      setPages(p => p.map(pg => pg.id === id ? page : pg));
      setEdits(p => { const e = { ...p }; delete e[id]; return e; });
      showToast('Saved');
    } else { showToast('Save failed'); }
  };

  const toggleVisible = async (page: SitePage) => {
    if (!page.can_toggle) return;
    const newVal = !page.visible;
    setEdit(page.id, 'visible', newVal);
    // Immediate save for toggles
    setSaving(s => ({ ...s, [page.id]: true }));
    const res = await fetch('/api/admin/pages', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: page.id, visible: newVal }),
    });
    setSaving(s => ({ ...s, [page.id]: false }));
    if (res.ok) {
      const { page: updated } = await res.json();
      setPages(p => p.map(pg => pg.id === page.id ? updated : pg));
      setEdits(p => { const e = { ...p }; delete e[page.id]; return e; });
      showToast(newVal ? 'Page shown in nav' : 'Page hidden from nav');
    }
  };

  return (
    <div style={{ display:'flex', minHeight:'100vh', fontFamily:"'Inter',sans-serif", background:'#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex:1, padding:40, overflowY:'auto' }}>
        <h1 style={{ fontSize:24, fontWeight:800, color:'#1B3A6B', marginBottom:4 }}>🗂️ Pages &amp; Navigation</h1>
        <p style={{ fontSize:13, color:'#6B7280', marginBottom:32 }}>
          Control which pages appear in the site navigation bar. Rename labels or hide pages without touching code.
        </p>
        <div style={{ background:'#fff', border:'1px solid #E8F0FB', borderRadius:12, overflow:'hidden' }}>
          {/* Header row */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 80px 80px 120px', gap:0, background:'#F8FAFC', borderBottom:'1px solid #E8F0FB', padding:'10px 20px' }}>
            {['Page Label (nav text)', 'URL / Href', 'Order', 'Visible', 'Action'].map(h => (
              <div key={h} style={{ fontSize:11, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</div>
            ))}
          </div>
          {pages.map((page) => {
            const draft = edits[page.id] ?? {};
            const label = draft.label ?? page.label;
            const order = draft.display_order ?? page.display_order;
            const visible = page.visible; // always from DB after save
            const dirty = !!edits[page.id] && Object.keys(edits[page.id]!).length > 0;

            return (
              <div key={page.id} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 80px 80px 120px', gap:0, borderBottom:'1px solid #F3F4F6', padding:'12px 20px', alignItems:'center' }}>
                {/* Label */}
                <div>
                  <input
                    value={label}
                    onChange={e => setEdit(page.id, 'label', e.target.value)}
                    style={{ width:'100%', padding:'6px 8px', fontSize:13, border:'1px solid #E5E7EB', borderRadius:5, fontFamily:'Inter,sans-serif', outline:'none', background:'#FFFBEB', boxSizing:'border-box' }}
                  />
                </div>
                {/* Href */}
                <div style={{ fontSize:12, color:'#9CA3AF', padding:'0 8px' }}>{page.href}</div>
                {/* Order */}
                <div>
                  <input
                    type="number"
                    value={order}
                    min={1}
                    onChange={e => setEdit(page.id, 'display_order', parseInt(e.target.value) || 1)}
                    style={{ width:56, padding:'6px 6px', fontSize:13, border:'1px solid #E5E7EB', borderRadius:5, textAlign:'center', fontFamily:'Inter,sans-serif', outline:'none' }}
                  />
                </div>
                {/* Visible toggle */}
                <div>
                  {page.can_toggle ? (
                    <button
                      onClick={() => toggleVisible(page)}
                      disabled={saving[page.id]}
                      style={{
                        width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
                        background: visible ? '#1A7A30' : '#D1D5DB',
                        position:'relative', transition:'background 0.2s',
                      }}
                    >
                      <span style={{
                        position:'absolute', top:3, left: visible ? 25 : 3,
                        width:20, height:20, borderRadius:'50%',
                        background:'#fff', transition:'left 0.2s',
                        boxShadow:'0 1px 4px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                  ) : (
                    <span style={{ fontSize:10, color:'#9CA3AF', fontStyle:'italic' }}>always on</span>
                  )}
                </div>
                {/* Save button */}
                <div>
                  <button
                    onClick={() => save(page.id)}
                    disabled={!dirty || saving[page.id]}
                    style={{
                      padding:'5px 14px', fontSize:12, fontWeight:700, borderRadius:6,
                      background: dirty ? '#1B4F8A' : '#F3F4F6',
                      color: dirty ? '#fff' : '#9CA3AF',
                      border:'none', cursor: dirty ? 'pointer' : 'default',
                      fontFamily:'Inter,sans-serif',
                    }}
                  >
                    {saving[page.id] ? '…' : dirty ? 'Save' : 'Saved'}
                  </button>
                </div>
              </div>
            );
          })}
          {pages.length === 0 && (
            <div style={{ padding:'48px 20px', textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
              No pages found. Run the SQL migration in Supabase to seed the pages table.
            </div>
          )}
        </div>

        <div style={{ marginTop:16, padding:'12px 16px', background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, fontSize:12, color:'#1E40AF' }}>
          💡 Changes to page labels and visibility take effect on the live site within 60 seconds (ISR revalidation).
        </div>
      </main>
      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, background:'#1B3A6B', color:'#fff', padding:'10px 20px', borderRadius:8, fontSize:13, fontWeight:600, zIndex:999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
