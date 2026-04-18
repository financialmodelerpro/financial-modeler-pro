'use client';

import { useState } from 'react';
import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface FaqItem {
  question: string;
  answer: string;
}

export function FaqSection({ content, styles }: Props) {
  const items   = (content.items as FaqItem[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '800px';

  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (!items.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {cmsVisible(content, 'badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {cmsVisible(content, 'heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 32 }}>
            {heading}
          </h2>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item, i) => {
            const isOpen = openIdx === i;
            return (
              <div key={i} style={{
                border: '1px solid #E5E7EB', borderRadius: 10,
                overflow: 'hidden', background: '#fff',
              }}>
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  style={{
                    width: '100%', padding: '16px 20px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: 600, color: '#0D2E5A', textAlign: 'left',
                  }}
                >
                  {item.question}
                  <span style={{ fontSize: 18, color: '#9CA3AF', flexShrink: 0, marginLeft: 12 }}>
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <CmsField
                    content={item as unknown as Record<string, unknown>}
                    field="answer"
                    style={{ padding: '0 20px 16px', fontSize: 14, color: '#6B7280', lineHeight: 1.7 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
