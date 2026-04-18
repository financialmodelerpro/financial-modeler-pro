'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AutoFillSource } from '@/src/lib/marketing/autoFill';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

type SourceType = 'article' | 'live' | 'training';

interface DataSourceItem {
  id: string;
  title: string;
  subtitle?: string;
  session?: string;
  date?: string;
}

interface Props {
  onApply: (source: AutoFillSource) => void;
}

export function QuickFillPanel({ onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SourceType>('training');
  const [itemId, setItemId] = useState<string>('');
  const [items, setItems] = useState<Record<SourceType, DataSourceItem[]>>({ article: [], live: [], training: [] });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/marketing-studio/data-sources');
      const json = await res.json();
      setItems({
        article: json.articles ?? [],
        live: json.liveSessions ?? [],
        training: json.trainingSessions ?? [],
      });
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { if (open && items.training.length === 0) void load(); }, [open, items.training.length, load]);

  const picked = items[type].find(i => i.id === itemId);

  function apply() {
    if (!picked) return;
    onApply({
      title:    picked.title,
      subtitle: picked.subtitle ?? '',
      session:  picked.session ?? '',
      date:     picked.date ?? '',
    });
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: open ? 12 : '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: NAVY, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        <span>{open ? '▾' : '▸'}</span>
        ⚡ Quick Fill {open ? '' : '— populate canvas from articles / sessions / training'}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {([['training', '📚 Training'], ['live', '🎥 Live Session'], ['article', '📰 Article']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => { setType(val); setItemId(''); }}
                style={{
                  flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
                  border: type === val ? `1px solid ${NAVY}` : `1px solid ${BORDER}`,
                  background: type === val ? '#F0F5FA' : '#fff',
                  color: NAVY,
                }}
              >{label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={itemId}
              onChange={e => setItemId(e.target.value)}
              disabled={loading}
              style={{ flex: 1, fontSize: 12, padding: '7px 9px', border: `1px solid ${BORDER}`, borderRadius: 5, color: NAVY, background: '#fff' }}
            >
              <option value="">{loading ? 'Loading…' : `— pick a ${type === 'live' ? 'session' : type} —`}</option>
              {items[type].map(item => (
                <option key={item.id} value={item.id}>
                  {item.session ? `${item.session} · ` : ''}{item.title}
                </option>
              ))}
            </select>
            <button
              onClick={apply}
              disabled={!picked}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: 'none', background: picked ? NAVY : '#9CA3AF', color: '#fff' }}
            >
              Apply to Canvas
            </button>
          </div>

          {picked && (
            <div style={{ fontSize: 11, color: '#6B7280', background: '#F9FAFB', padding: 8, borderRadius: 5, border: `1px solid ${BORDER}` }}>
              {picked.session && <div><strong style={{ color: NAVY }}>Session:</strong> {picked.session}</div>}
              <div><strong style={{ color: NAVY }}>Title:</strong> {picked.title}</div>
              {picked.subtitle && <div style={{ marginTop: 2 }}><strong style={{ color: NAVY }}>Subtitle:</strong> {picked.subtitle.slice(0, 120)}{picked.subtitle.length > 120 ? '…' : ''}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
