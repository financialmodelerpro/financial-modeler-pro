'use client';

/**
 * CategoryCombobox.tsx (admin, client)
 *
 * A type-or-pick combobox for the article category field, shared by the new +
 * edit article pages. Category is stored as free text (no enum, no migration):
 *   - Typing a brand-new value creates that category on save.
 *   - Existing categories (distinct values already used across articles, merged
 *     with a small set of built-in defaults) are offered as filtered suggestions.
 * There is no delete control; removing a category means no article uses it.
 *
 * No em dashes in this file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/** Seed categories so a fresh install still offers sensible picks. */
export const DEFAULT_CATEGORIES = [
  'Real Estate', 'Business Valuation', 'FP&A', 'Market Insights',
  'Career', 'Case Studies', 'Platform Tutorials',
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  inputStyle: React.CSSProperties;
}

export function CategoryCombobox({ value, onChange, inputStyle }: Props): React.JSX.Element {
  const [remote, setRemote] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/articles/categories')
      .then((r) => r.json())
      .then((j) => { if (active && Array.isArray(j.categories)) setRemote(j.categories as string[]); })
      .catch(() => { /* suggestions are best-effort; typing still works */ });
    return () => { active = false; };
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const c of [...DEFAULT_CATEGORIES, ...remote]) {
      const t = c.trim();
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); merged.push(t); }
    }
    return merged.sort((a, b) => a.localeCompare(b));
  }, [remote]);

  const q = value.trim().toLowerCase();
  const suggestions = useMemo(
    () => all.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q),
    [all, q],
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type or pick a category…"
        style={{ ...inputStyle, cursor: 'text' }}
        data-testid="article-category-combobox"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
            background: '#fff', border: '1px solid #D1D5DB', borderRadius: 7,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto',
          }}
        >
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                fontSize: 13, border: 'none', background: 'transparent', color: '#374151',
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F4F7FC'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
