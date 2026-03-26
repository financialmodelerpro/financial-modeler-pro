'use client';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface SitePage { id: string; label: string; href: string; visible: boolean; display_order: number; can_toggle: boolean }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 6,
  fontFamily: 'Inter,sans-serif', outline: 'none',
  background: '#FFFBEB', boxSizing: 'border-box', color: '#1B3A6B',
};

export default function PagesAdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [pages,   setPages]   = useState<SitePage[]>([]);
  const [edits,   setEdits]   = useState<Record<string, Partial<SitePage>>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast,   setToast]   = useState('');

  // New page form
  const [showAdd,  setShowAdd]  = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newHref,  setNewHref]  = useState('');
  const [newOrder, setNewOrder] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
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

  const deletePage = async (page: SitePage) => {
    if (!page.can_toggle) return; // protect fixed pages
    if (!confirm(`Remove "${page.label}" from navigation?`)) return;
    setDeleting(page.id);
    const res = await fetch(`/api/admin/pages?id=${page.id}`, { method: 'DELETE' });
    setDeleting(null);
    if (res.ok) {
      setPages(p => p.filter(pg => pg.id !== page.id));
      showToast('Page removed');
    } else { showToast('Delete failed'); }
  };

  const addPage = async () => {
    if (!newLabel.trim() || !newHref.trim()) { showToast('Label and URL are required'); return; }
    setAddSaving(true);
    const res = await fetch('/api/admin/pages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newLabel.trim(),
        href:  newHref.trim(),
        display_order: parseInt(newOrder) || pages.length + 1,
        visible: true,
        can_toggle: true,
      }),
    });
    setAddSaving(false);
    if (res.ok) {
      const { page } = await res.json();
      setPages(p => [...p, page].sort((a, b) => a.display_order - b.display_order));
      setNewLabel(''); setNewHref(''); setNewOrder(''); setShowAdd(false);
      showToast('Page added to navigation');
    } else { showToast('Add failed'); }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🗂️ Pages &amp; Navigation</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>
              Control which pages appear in the site navigation bar. Rename labels, reorder, show/hide, or add new entries.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {showAdd ? '✕ Cancel' : '+ Add Page'}
          </button>
        </div>

        {/* Add page form */}
        {showAdd && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>New Navigation Entry</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px auto', gap: 12, alignItems: 'end' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>Label (nav text)</div>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Contact" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>URL / Path</div>
                <input value={newHref} onChange={e => setNewHref(e.target.value)} placeholder="e.g. /contact" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>Order</div>
                <input type="number" value={newOrder} onChange={e => setNewOrder(e.target.value)} placeholder={String(pages.length + 1)} style={{ ...inputStyle, width: 80 }} />
              </div>
              <button
                onClick={addPage}
                disabled={addSaving}
                style={{ padding: '8px 20px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: addSaving ? 0.6 : 1, whiteSpace: 'nowrap' }}
              >
                {addSaving ? 'Adding…' : 'Add →'}
              </button>
            </div>
          </div>
        )}

        {/* Pages table */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 70px 80px 140px', gap: 0, background: '#1B4F8A', padding: '10px 20px' }}>
            {['Page Label (nav text)', 'URL / Href', 'Order', 'Visible', 'Actions'].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>

          {pages.map((page) => {
            const draft = edits[page.id] ?? {};
            const label  = draft.label         ?? page.label;
            const order  = draft.display_order ?? page.display_order;
            const visible = page.visible;
            const dirty  = !!edits[page.id] && Object.keys(edits[page.id]!).length > 0;

            const href = draft.href ?? page.href;

            return (
              <div key={page.id} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 70px 80px 140px', gap: 0, borderBottom: '1px solid #F3F4F6', padding: '12px 20px', alignItems: 'center', background: visible ? '#fff' : '#FAFAFA' }}>
                {/* Label */}
                <div>
                  <input
                    value={label}
                    onChange={e => setEdit(page.id, 'label', e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #E5E7EB', borderRadius: 5, fontFamily: 'Inter,sans-serif', outline: 'none', background: '#FFFBEB', boxSizing: 'border-box', color: '#1B3A6B' }}
                  />
                </div>
                {/* Href */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}>
                  <input
                    value={href}
                    onChange={e => setEdit(page.id, 'href', e.target.value)}
                    placeholder="/page-path"
                    style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 5, fontFamily: 'Inter,sans-serif', outline: 'none', background: '#FFFBEB', color: '#1B3A6B', minWidth: 0 }}
                  />
                  <a href={page.href} target="_blank" rel="noopener noreferrer" title="Visit page" style={{ fontSize: 14, color: '#6B7280', textDecoration: 'none', flexShrink: 0, lineHeight: 1 }}>↗</a>
                </div>
                {/* Order */}
                <div>
                  <input
                    type="number" value={order} min={1}
                    onChange={e => setEdit(page.id, 'display_order', parseInt(e.target.value) || 1)}
                    style={{ width: 52, padding: '6px 6px', fontSize: 13, border: '1px solid #E5E7EB', borderRadius: 5, textAlign: 'center', fontFamily: 'Inter,sans-serif', outline: 'none' }}
                  />
                </div>
                {/* Visible toggle */}
                <div>
                  {page.can_toggle ? (
                    <button
                      onClick={() => toggleVisible(page)}
                      disabled={!!saving[page.id]}
                      style={{ width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: visible ? '#1A7A30' : '#D1D5DB', position: 'relative', transition: 'background 0.2s' }}
                    >
                      <span style={{ position: 'absolute', top: 3, left: visible ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>always on</span>
                  )}
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => save(page.id)}
                    disabled={!dirty || !!saving[page.id]}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, background: dirty ? '#1B4F8A' : '#F3F4F6', color: dirty ? '#fff' : '#9CA3AF', border: 'none', cursor: dirty ? 'pointer' : 'default', fontFamily: 'Inter,sans-serif' }}
                  >
                    {saving[page.id] ? '…' : dirty ? 'Save' : 'Saved'}
                  </button>
                  {page.can_toggle && (
                    <button
                      onClick={() => deletePage(page)}
                      disabled={deleting === page.id}
                      style={{ padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 6, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}
                    >
                      {deleting === page.id ? '…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {pages.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              No pages yet. Click <strong>+ Add Page</strong> above to add your first navigation entry.
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, padding: '12px 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12, color: '#1E40AF' }}>
          💡 Changes take effect on the live site within 60 seconds. Use <strong>Remove</strong> to delete custom pages; core pages (Home) cannot be removed.
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
