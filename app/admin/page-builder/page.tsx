'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface CmsPage {
  id: string;
  slug: string;
  title: string;
  status: string;
  is_system: boolean;
  created_at: string;
}

export default function PageBuilderListPage() {
  const [pages, setPages]     = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug]   = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast]       = useState('');

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  useEffect(() => {
    fetch('/api/admin/page-sections')
      .then(r => r.json())
      .then((d: { pages?: CmsPage[] }) => setPages(d.pages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function createPage() {
    if (!newTitle.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/page-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_page', title: newTitle.trim(), slug: newSlug.trim() }),
      });
      const d = await res.json() as { page?: CmsPage; error?: string };
      if (d.page) {
        setPages(prev => [...prev, d.page!]);
        setNewTitle(''); setNewSlug(''); setShowNew(false);
        showToast('Page created');
      } else {
        showToast(d.error ?? 'Failed');
      }
    } catch { showToast('Failed'); }
    finally { setCreating(false); }
  }

  async function deletePage(slug: string) {
    if (!confirm(`Delete page "/${slug}" and all its sections? This cannot be undone.`)) return;
    try {
      await fetch('/api/admin/page-sections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_page', slug }),
      });
      setPages(prev => prev.filter(p => p.slug !== slug));
      showToast('Page deleted');
    } catch { showToast('Delete failed'); }
  }

  async function toggleStatus(page: CmsPage) {
    const next = page.status === 'published' ? 'draft' : 'published';
    try {
      await fetch('/api/admin/page-sections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_page', id: page.id, status: next }),
      });
      setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: next } : p));
    } catch { showToast('Update failed'); }
  }

  // Auto-generate slug from title
  function handleTitleChange(val: string) {
    setNewTitle(val);
    setNewSlug(val.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-'));
  }

  const IS: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0D2E5A' }}>Page Builder</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>Create and manage CMS-driven pages with modular sections</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{toast}</span>}
            <button onClick={() => setShowNew(true)}
              style={{ padding: '8px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer' }}>
              + New Page
            </button>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* New page form */}
          {showNew && (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #BBF7D0', padding: 20, marginBottom: 20, maxWidth: 500 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 12 }}>Create New Page</div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 }}>Page Title</label>
                <input style={IS} value={newTitle} onChange={e => handleTitleChange(e.target.value)} placeholder="e.g. Our Services" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 }}>URL Slug</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <span style={{ padding: '8px 10px', fontSize: 13, background: '#E5E7EB', border: '1px solid #D1D5DB', borderRight: 'none', borderRadius: '6px 0 0 6px', color: '#6B7280' }}>/</span>
                  <input style={{ ...IS, borderRadius: '0 6px 6px 0' }} value={newSlug} onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="our-services" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={createPage} disabled={creating || !newTitle.trim() || !newSlug.trim()}
                  style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: creating ? '#9CA3AF' : '#2EAA4A', color: '#fff', border: 'none', cursor: creating ? 'not-allowed' : 'pointer' }}>
                  {creating ? 'Creating...' : 'Create Page'}
                </button>
                <button onClick={() => { setShowNew(false); setNewTitle(''); setNewSlug(''); }}
                  style={{ padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Page list */}
          {loading ? (
            <div style={{ color: '#9CA3AF', padding: 40, textAlign: 'center' }}>Loading pages...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {pages.map(page => (
                <div key={page.id} style={{
                  background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB',
                  padding: 20, display: 'flex', flexDirection: 'column', gap: 10,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#0D2E5A' }}>{page.title}</div>
                      <div style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace', marginTop: 2 }}>/{page.slug}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {page.is_system && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#EFF6FF', color: '#1B4F8A', border: '1px solid #BFDBFE' }}>System</span>
                      )}
                      <button onClick={() => toggleStatus(page)}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid', cursor: 'pointer',
                          background: page.status === 'published' ? '#F0FFF4' : '#FEF2F2',
                          borderColor: page.status === 'published' ? '#BBF7D0' : '#FECACA',
                          color: page.status === 'published' ? '#15803D' : '#DC2626',
                        }}>
                        {page.status === 'published' ? 'Published' : 'Draft'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <Link href={`/admin/page-builder/${page.slug}`}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: 'center', background: '#1B4F8A', color: '#fff', textDecoration: 'none' }}>
                      Edit Sections
                    </Link>
                    {!page.is_system && (
                      <button onClick={() => deletePage(page.slug)}
                        style={{ padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', cursor: 'pointer' }}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
