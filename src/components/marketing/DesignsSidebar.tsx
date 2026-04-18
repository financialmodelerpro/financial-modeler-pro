'use client';

import { useEffect, useRef, useState } from 'react';
import type { CanvasBackground, CanvasElement } from '@/src/lib/marketing/types';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

interface SavedDesignRow {
  id: string;
  name: string;
  template_type: string;
  dimensions?: { width: number; height: number };
  background?: CanvasBackground;
  elements?: CanvasElement[];
  ai_captions: Record<string, string>;
  updated_at: string;
}

interface Props {
  designs: SavedDesignRow[];
  currentDesignId: string | null;
  onLoad: (row: SavedDesignRow) => void;
  onDelete: (id: string) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  'fmp-youtube-thumbnail': '▶',
  'youtube-thumbnail':     '▶',
  'fmp-linkedin-post':     '💼',
  'linkedin-post':         '💼',
  'fmp-instagram-post':    '📷',
  'instagram-post':        '📷',
  'instagram-story':       '📱',
  'blank-custom':          '◻',
};

export function DesignsSidebar({ designs, currentDesignId, onLoad, onDelete }: Props) {
  const [filter, setFilter] = useState('all');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;

  const templateTypes = Array.from(new Set(designs.map(d => d.template_type))).sort();
  const filtered = filter === 'all' ? designs : designs.filter(d => d.template_type === filter);

  // Render thumbnails lazily — one at a time to avoid hammering the render endpoint.
  useEffect(() => {
    let cancelled = false;
    async function renderNext() {
      const pending = filtered.find(d => !thumbsRef.current[d.id] && d.elements && d.dimensions && d.background);
      if (!pending || cancelled) return;
      try {
        const res = await fetch('/api/admin/marketing-studio/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dimensions: pending.dimensions,
            background: pending.background,
            elements: pending.elements,
          }),
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setThumbs(prev => ({ ...prev, [pending.id]: url }));
      } catch { /* ignore */ }
    }
    renderNext();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, filter]);

  // Revoke object URLs on unmount
  useEffect(() => () => {
    Object.values(thumbsRef.current).forEach(u => URL.revokeObjectURL(u));
  }, []);

  if (designs.length === 0) return null;

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Saved Designs ({filtered.length})
        </span>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 11, padding: '4px 7px', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
          <option value="all">All templates</option>
          {templateTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
        {filtered.map(d => {
          const active = currentDesignId === d.id;
          const thumb = thumbs[d.id];
          const ratio = d.dimensions ? d.dimensions.width / d.dimensions.height : 16 / 9;
          return (
            <div
              key={d.id}
              style={{
                position: 'relative', borderRadius: 6, overflow: 'hidden',
                border: active ? `2px solid ${NAVY}` : `1px solid ${BORDER}`,
                background: '#F3F4F6',
              }}
            >
              <button
                onClick={() => onLoad(d)}
                style={{ width: '100%', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'block' }}
              >
                <div style={{ aspectRatio: `${ratio}`, background: '#1B4F72', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={thumb} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: '#fff', fontSize: 10, opacity: 0.6 }}>loading…</span>
                  )}
                </div>
                <div style={{ padding: '6px 8px', background: '#fff' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {CATEGORY_ICONS[d.template_type] ?? '◻'} {d.name}
                  </div>
                  <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 1 }}>
                    {d.template_type} · {new Date(d.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </button>
              <button
                onClick={() => onDelete(d.id)}
                title="Delete"
                style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'rgba(220,38,38,0.9)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 800, lineHeight: 1 }}
              >×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
