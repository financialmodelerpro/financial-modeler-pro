'use client';

/**
 * CategoryMultiSelect.tsx (admin, client)
 *
 * Junction-backed category picker for the article form (Phase 2). Supports single
 * OR multiple assignment: pick existing categories, or type a new name and create
 * it in place (POST /api/admin/categories) which both creates the row and selects
 * it. The parent owns the selected category ids (value); the deprecated single
 * `articles.category` text is kept in sync server-side from the first selection.
 *
 * No em dashes in this file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

interface Cat { id: string; name: string; slug: string }

interface Props {
  value: string[];                         // selected category ids
  onChange: (ids: string[]) => void;
  inputStyle: React.CSSProperties;
  notify?: (msg: string, type: 'success' | 'error') => void;
}

export function CategoryMultiSelect({ value, onChange, inputStyle, notify }: Props): React.JSX.Element {
  const [all, setAll] = useState<Cat[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/categories').then(r => r.json()).then(j => {
      if (active && Array.isArray(j.categories)) setAll(j.categories.map((c: Cat) => ({ id: c.id, name: c.name, slug: c.slug })));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = useMemo(() => value.map(id => all.find(c => c.id === id)).filter((c): c is Cat => !!c), [value, all]);
  const q = query.trim().toLowerCase();
  const suggestions = useMemo(
    () => all.filter(c => !value.includes(c.id) && c.name.toLowerCase().includes(q)),
    [all, value, q],
  );
  const exactExists = all.some(c => c.name.toLowerCase() === q);

  function add(id: string) { if (!value.includes(id)) onChange([...value, id]); setQuery(''); }
  function remove(id: string) { onChange(value.filter(v => v !== id)); }

  async function createAndAdd() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const j = await res.json();
      if (!res.ok || !j.category) throw new Error(j.error || 'Create failed');
      const cat: Cat = j.category;
      setAll(prev => prev.some(c => c.id === cat.id) ? prev : [...prev, cat]);
      add(cat.id);
      notify?.(`Category "${cat.name}" created.`, 'success');
    } catch (e) {
      notify?.(e instanceof Error ? e.message : 'Create failed', 'error');
    } finally { setCreating(false); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {selected.map(c => (
            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#1B4F8A', background: '#E8F0FB', padding: '3px 6px 3px 10px', borderRadius: 20 }}>
              {c.name}
              <button type="button" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`} style={{ border: 'none', background: 'rgba(27,79,138,0.15)', color: '#1B4F8A', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', fontSize: 11, cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (suggestions.length === 1) add(suggestions[0].id); else if (q && !exactExists) void createAndAdd(); } }}
        placeholder="Search or type a new category…"
        style={{ ...inputStyle, cursor: 'text' }}
        data-testid="category-multiselect"
        autoComplete="off"
      />
      {open && (suggestions.length > 0 || (q && !exactExists)) && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 7, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto' }}>
          {suggestions.map(c => (
            <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); add(c.id); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, border: 'none', background: 'transparent', color: '#374151', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F4F7FC'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
              {c.name}
            </button>
          ))}
          {q && !exactExists && (
            <button type="button" onMouseDown={e => { e.preventDefault(); void createAndAdd(); }} disabled={creating}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, border: 'none', borderTop: suggestions.length ? '1px solid #F1F5F9' : 'none', background: 'transparent', color: '#1B4F8A', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              data-testid="category-create-option">
              {creating ? 'Creating…' : `+ Create "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
