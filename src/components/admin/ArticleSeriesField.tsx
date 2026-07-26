'use client';

/**
 * ArticleSeriesField.tsx (admin, client)
 *
 * Single-select series picker for the article editor (migration 200). Pick an
 * existing series, clear it (None = standalone article), or create one inline
 * (POST /api/admin/series). The precise reading order is set by drag-reorder in
 * the series manager (/admin/articles/series); this field only assigns membership.
 * The parent owns the selected series id.
 *
 * No em dashes in this file.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Series { id: string; title: string; slug: string }

interface Props {
  value: string;                                  // selected series id ('' = none)
  onChange: (seriesId: string) => void;
  inputStyle: React.CSSProperties;
  notify?: (msg: string, type: 'success' | 'error') => void;
}

export function ArticleSeriesField({ value, onChange, inputStyle, notify }: Props): React.JSX.Element {
  const [all, setAll] = useState<Series[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/series').then(r => r.json()).then(j => {
      if (Array.isArray(j.series)) setAll(j.series.map((s: Series) => ({ id: s.id, title: s.title, slug: s.slug })));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      const j = await res.json();
      if (!res.ok || !j.series) throw new Error(j.error || 'Create failed');
      const s: Series = j.series;
      setAll(prev => prev.some(x => x.id === s.id) ? prev : [...prev, s]);
      onChange(s.id);
      setNewTitle(''); setAdding(false);
      notify?.(`Series "${s.title}" created.`, 'success');
    } catch (e) {
      notify?.(e instanceof Error ? e.message : 'Create failed', 'error');
    } finally { setCreating(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Series</label>
        <Link href="/admin/articles/series" style={{ fontSize: 11, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Manage</Link>
      </div>
      {!adding ? (
        <>
          <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} data-testid="series-select">
            <option value="">None (standalone article)</option>
            {all.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <button type="button" onClick={() => setAdding(true)} style={{ marginTop: 8, fontSize: 12, color: '#1B4F8A', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            + New series
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void create(); } if (e.key === 'Escape') { setAdding(false); setNewTitle(''); } }}
            placeholder="New series title…"
            autoFocus
            style={{ ...inputStyle, flex: 1 }}
            data-testid="series-new-title"
          />
          <button type="button" onClick={create} disabled={creating || !newTitle.trim()} style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '0 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: creating || !newTitle.trim() ? 0.6 : 1 }}>
            {creating ? '…' : 'Add'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewTitle(''); }} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {value && (
        <p style={{ fontSize: 11, color: '#9CA3AF', margin: '8px 0 0', lineHeight: 1.5 }}>
          Reading order is set by drag in <Link href="/admin/articles/series" style={{ color: '#1B4F8A', textDecoration: 'none' }}>Manage Series</Link>.
        </p>
      )}
    </div>
  );
}
