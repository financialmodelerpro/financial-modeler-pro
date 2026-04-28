'use client';
import { useState } from 'react';

interface FAQ { question: string; answer: string }

export function PricingAccordion({ faqs, dark = false }: { faqs: FAQ[]; dark?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!faqs.length) return null;

  const textColor  = dark ? '#fff'                    : '#1B3A6B';
  const bodyColor  = dark ? 'rgba(255,255,255,0.65)'  : '#6B7280';
  const borderColor = dark ? 'rgba(255,255,255,0.1)'  : '#E5E7EB';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      {faqs.map((faq, i) => (
        <div key={i} style={{ borderBottom: `1px solid ${borderColor}` }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{
              width: '100%', textAlign: 'left', padding: '18px 0', background: 'none',
              border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 16,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: textColor }}>{faq.question}</span>
            <span style={{
              fontSize: 20, color: bodyColor, flexShrink: 0,
              transition: 'transform 0.2s',
              transform: open === i ? 'rotate(45deg)' : 'none',
              display: 'inline-block',
            }}>+</span>
          </button>
          {open === i && (
            <div style={{ paddingBottom: 18, paddingRight: 24 }}>
              <p style={{ fontSize: 14, color: bodyColor, lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
