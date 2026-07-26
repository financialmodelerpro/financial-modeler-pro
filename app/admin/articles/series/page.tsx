'use client';

/**
 * Series manage view (migration 200). Lives inside the articles admin area
 * (/admin/articles/series). Create, rename, describe, and delete series, and set
 * each series' reading order by dragging its articles into sequence. Reordering
 * PUTs to /api/admin/series which writes articles.series_order. Deleting a series
 * un-groups its articles (FK ON DELETE SET NULL), it never deletes them.
 *
 * No em dashes in this file.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface SeriesArticle { id: string; title: string; slug: string; status: string; series_order: number | null }
interface Series { id: string; title: string; slug: string; description: string | null; articles: SeriesArticle[] }

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const statusColor: Record<string, { bg: string; color: string }> = {
  published: { bg: '#E8F7EC', color: '#1A7A30' },
  draft:     { bg: '#F3F4F6', color: '#6B7280' },
  scheduled: { bg: '#FEF3C7', color: '#92400E' },
};

export default function AdminSeriesPage() {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const dragRef = useRef<{ seriesId: string; from: number } | null>(null);

  const notify = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2800);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch('/api/admin/series')).json();
      setSeries(Array.isArray(j.series) ? j.series : []);
    } catch { setSeries([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error();
      setNewTitle(''); notify(`"${title}" created.`, 'success'); await load();
    } catch { notify('Create failed', 'error'); }
    finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) return;
    try {
      const res = await fetch('/api/admin/series', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, title, description: editDesc }) });
      if (!res.ok) throw new Error();
      setEditingId(null); notify('Saved.', 'success'); await load();
    } catch { notify('Save failed', 'error'); }
  }

  async function remove(s: Series) {
    if (!confirm(`Delete series "${s.title}"?${s.articles.length ? ` Its ${s.articles.length} article(s) will be un-grouped (not deleted).` : ''}`)) return;
    try {
      const res = await fetch(`/api/admin/series?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      notify('Deleted.', 'success'); await load();
    } catch { notify('Delete failed', 'error'); }
  }

  async function persistOrder(seriesId: string, articles: SeriesArticle[]) {
    try {
      const res = await fetch('/api/admin/series', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId, orderedIds: articles.map(a => a.id) }) });
      if (!res.ok) throw new Error();
      notify('Order saved.', 'success');
    } catch { notify('Could not save order', 'error'); await load(); }
  }

  function onDrop(seriesId: string, to: number) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.seriesId !== seriesId || d.from === to) return;
    setSeries(prev => prev.map(s => {
      if (s.id !== seriesId) return s;
      const reordered = moveItem(s.articles, d.from, to);
      void persistOrder(seriesId, reordered);
      return { ...s, articles: reordered };
    }));
  }

  const inputStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/articles" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Link href="/admin/articles" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none' }}>← Back to Articles</Link>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', margin: '10px 0 4px' }}>Manage Series</h1>
          <p style={{ fontSize: 13, color: '#6B7280', maxWidth: 640, lineHeight: 1.6 }}>
            Group related articles into an ordered reading sequence. Drag the articles within a series to set the order readers see (Part 1, Part 2, ...). Assign an article to a series from its editor. Deleting a series un-groups its articles; it never deletes them.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 28, maxWidth: 480 }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} placeholder="New series title…" style={{ ...inputStyle, flex: 1 }} data-testid="new-series-title" />
          <button onClick={create} disabled={busy || !newTitle.trim()} style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy || !newTitle.trim() ? 0.6 : 1 }}>Add Series</button>
        </div>

        {loading ? (
          <div style={{ color: '#6B7280', fontSize: 13 }}>Loading…</div>
        ) : series.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', padding: '40px 24px', textAlign: 'center', color: '#6B7280', fontSize: 14, maxWidth: 720 }}>
            No series yet. Create one above, then assign articles to it from each article&apos;s editor.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
            {series.map(s => (
              <div key={s.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #EEF2F7' }}>
                  {editingId === s.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input value={editTitle} onChange={e => setEditTitle(e.target.value)} autoFocus style={{ ...inputStyle, fontSize: 15, fontWeight: 700 }} data-testid="series-edit-title" />
                      <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} placeholder="Short description (optional, shown on the series list)…" style={{ ...inputStyle, resize: 'vertical' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => saveEdit(s.id)} style={{ fontSize: 12, color: '#fff', background: '#1B4F8A', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ fontSize: 12, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B' }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', marginTop: 2 }}>/{s.slug} · {s.articles.length} article(s)</div>
                        {s.description && <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 6, lineHeight: 1.5 }}>{s.description}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                        <button onClick={() => { setEditingId(s.id); setEditTitle(s.title); setEditDesc(s.description ?? ''); }} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="series-edit">Edit</button>
                        <span style={{ color: '#E5E7EB' }}>|</span>
                        <button onClick={() => remove(s)} style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} data-testid="series-delete">Delete</button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ padding: '12px 16px' }}>
                  {s.articles.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: '#9CA3AF', padding: '8px 4px' }}>No articles yet. Assign articles to this series from each article&apos;s editor.</div>
                  ) : (
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.articles.map((a, i) => {
                        const sc = statusColor[a.status] ?? statusColor.draft;
                        return (
                          <li
                            key={a.id}
                            draggable
                            onDragStart={() => { dragRef.current = { seriesId: s.id, from: i }; }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => onDrop(s.id, i)}
                            data-testid="series-article-row"
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#F9FAFB', border: '1px solid #EEF2F7', borderRadius: 8, cursor: 'grab' }}
                          >
                            <span style={{ color: '#9CA3AF', fontSize: 15, cursor: 'grab' }} aria-hidden>⠿</span>
                            <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: '#1B4F8A', color: '#fff' }}>{i + 1}</span>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{a.title}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color, textTransform: 'uppercase' }}>{a.status}</span>
                            <Link href={`/admin/articles/${a.id}`} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Edit</Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </div>
            ))}
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
