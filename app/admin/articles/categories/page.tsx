'use client';

/**
 * Categories manage view (Phase 2). Lives inside the articles admin area
 * (/admin/articles/categories), not a new top-level admin route. Create, rename,
 * and delete categories (junction rows cascade on delete). Junction-backed.
 *
 * No em dashes in this file.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Cat { id: string; name: string; slug: string; count: number }

export default function AdminCategoriesPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2800);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch('/api/admin/categories')).json();
      setCats(Array.isArray(j.categories) ? j.categories : []);
    } catch { setCats([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error();
      setNewName(''); notify(`"${name}" created.`, 'success'); await load();
    } catch { notify('Create failed', 'error'); }
    finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/admin/categories', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
      if (!res.ok) throw new Error();
      setEditingId(null); notify('Renamed.', 'success'); await load();
    } catch { notify('Rename failed', 'error'); }
  }

  async function remove(c: Cat) {
    if (!confirm(`Delete category "${c.name}"?${c.count ? ` It is assigned to ${c.count} article(s); those associations will be removed.` : ''}`)) return;
    try {
      const res = await fetch(`/api/admin/categories?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      notify('Deleted.', 'success'); await load();
    } catch { notify('Delete failed', 'error'); }
  }

  const inputStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/articles" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Link href="/admin/articles" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none' }}>← Back to Articles</Link>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', margin: '10px 0 4px' }}>Manage Categories</h1>
          <p style={{ fontSize: 13, color: '#6B7280' }}>Create, rename, and delete categories. Deleting removes the category from any articles that use it.</p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, maxWidth: 480 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} placeholder="New category name…" style={{ ...inputStyle, flex: 1 }} data-testid="new-category-name" />
          <button onClick={create} disabled={busy || !newName.trim()} style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy || !newName.trim() ? 0.6 : 1 }}>Add</button>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden', maxWidth: 620 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Category', 'Slug', 'Articles', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Loading…</td></tr>
              ) : cats.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', color: '#6B7280', fontSize: 13 }}>No categories yet.</td></tr>
              ) : cats.map((c, i) => (
                <tr key={c.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                  <td style={{ padding: '10px 16px' }}>
                    {editingId === c.id ? (
                      <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveEdit(c.id); if (e.key === 'Escape') setEditingId(null); }} autoFocus style={{ ...inputStyle, fontSize: 13, width: '100%' }} data-testid="category-edit-input" />
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{c.name}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace' }}>{c.slug}</td>
                  <td style={{ padding: '10px 16px', fontSize: 12, color: '#6B7280' }}>{c.count}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {editingId === c.id ? (
                        <>
                          <button onClick={() => saveEdit(c.id)} style={{ fontSize: 12, color: '#1A7A30', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Save</button>
                          <button onClick={() => setEditingId(null)} style={{ fontSize: 12, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="category-edit">Edit</button>
                          <span style={{ color: '#E5E7EB' }}>|</span>
                          <button onClick={() => remove(c)} style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="category-delete">Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
