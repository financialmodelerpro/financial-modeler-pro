'use client';

/**
 * ArticleSidebar.tsx (article detail page, client)
 *
 * The sticky right-hand sidebar. Two blocks:
 *  1. Series, an accordion of every series. The series the current article belongs
 *     to is EXPANDED by default with a "You are here" marker on the current part;
 *     every other series is collapsed and opens on click. Each part is a link, so
 *     a reader can jump anywhere in a sequence, or open another series to browse it.
 *  2. Browse by category, every category linked to the filtered listing.
 *
 * Interactive (collapse / expand), so this is a client component; the data is
 * fetched server-side and passed in as props.
 *
 * No em dashes in this file.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { CategoryBrowse, SeriesBrowse } from '@/src/shared/cms';

interface Props {
  series: SeriesBrowse[];
  categories: CategoryBrowse[];
  currentSeriesId: string | null;
  currentArticleId: string;
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '16px 16px 18px',
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#9EC3E8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12,
};

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-block', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none', color: '#9EC3E8', fontSize: 12, flexShrink: 0 }}>
      ▶
    </span>
  );
}

export function ArticleSidebar({ series, categories, currentSeriesId, currentArticleId }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentSeriesId ? [currentSeriesId] : []));
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!series.length && !categories.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Series accordion */}
      {series.length > 0 && (
        <section style={cardStyle}>
          <div style={sectionLabel}>Series</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {series.map((s) => {
              const isOpen = open.has(s.id);
              const isCurrent = s.id === currentSeriesId;
              return (
                <div key={s.id} style={{ borderRadius: 10, overflow: 'hidden', border: isCurrent ? '1px solid rgba(158,195,232,0.35)' : '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: isCurrent ? 'rgba(78,124,176,0.22)' : 'rgba(255,255,255,0.03)', border: 'none',
                      padding: '11px 12px', color: '#fff', fontFamily: 'inherit',
                    }}
                  >
                    <Chevron open={isOpen} />
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{s.title}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>{s.parts.length}</span>
                  </button>
                  {isOpen && (
                    <ol style={{ listStyle: 'none', margin: 0, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {s.parts.map((p, i) => {
                        const here = p.id === currentArticleId;
                        return (
                          <li key={p.id}>
                            <Link
                              href={`/articles/${p.slug}`}
                              aria-current={here ? 'true' : undefined}
                              style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 8px', borderRadius: 8, textDecoration: 'none',
                                background: here ? 'rgba(158,195,232,0.16)' : 'transparent',
                              }}
                            >
                              <span style={{
                                flexShrink: 0, width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 800, background: here ? '#9EC3E8' : 'rgba(255,255,255,0.1)', color: here ? '#0D2E5A' : 'rgba(255,255,255,0.75)',
                              }}>{i + 1}</span>
                              <span style={{ flex: 1, fontSize: 12.5, fontWeight: here ? 700 : 500, color: here ? '#fff' : 'rgba(255,255,255,0.78)', lineHeight: 1.4 }}>
                                {p.title}
                                {here && <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, color: '#9EC3E8', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>You are here</span>}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section style={cardStyle}>
          <div style={sectionLabel}>Browse by category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {categories.map((c) => (
              <Link
                key={c.name}
                href={`/articles?category=${encodeURIComponent(c.name)}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, textDecoration: 'none', color: 'rgba(255,255,255,0.82)', fontSize: 13 }}
              >
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: '1px 9px' }}>{c.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
