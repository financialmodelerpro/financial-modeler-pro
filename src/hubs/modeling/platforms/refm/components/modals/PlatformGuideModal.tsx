'use client';

/**
 * PlatformGuideModal.tsx
 *
 * In-platform viewer for the auto-updating walkthrough guide. Renders the same
 * GuideDoc that the Markdown + PDF downloads use, so the on-screen guide and the
 * downloadable document never diverge. The GuideDoc is built from the live
 * module + tab registries (see platformGuide.ts), so this view auto-updates as
 * the platform's structure changes.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideDoc, GuideSection } from '../../lib/guide/platformGuide';
import { guideToMarkdown } from '../../lib/guide/platformGuide';

function download(filename: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Section({ s, depth }: { s: GuideSection; depth: number }): React.JSX.Element {
  const titleSize = depth <= 2 ? 17 : depth === 3 ? 14 : 12.5;
  return (
    <section style={{ marginTop: depth <= 2 ? 22 : 14 }}>
      <h3 style={{ fontSize: titleSize, fontWeight: 800, color: 'var(--color-heading)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {depth <= 2 && <span style={{ display: 'inline-block', width: 22, height: 3, background: 'var(--color-navy)', borderRadius: 2 }} />}
        {s.title}
      </h3>
      {s.paragraphs.map((p, i) => (
        <p key={i} style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text)', margin: '0 0 8px' }}>{p}</p>
      ))}
      {!!s.steps?.length && (
        <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
          {s.steps.map((st, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text)', marginBottom: 4 }}>{st}</li>
          ))}
        </ol>
      )}
      {!!s.bullets?.length && (
        <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
          {s.bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text)', marginBottom: 3 }}>{b}</li>
          ))}
        </ul>
      )}
      {s.children?.map((c) => <Section key={c.id} s={c} depth={depth + 1} />)}
    </section>
  );
}

export default function PlatformGuideModal({
  open,
  onClose,
  doc,
  dateLabel,
}: {
  open: boolean;
  onClose: () => void;
  doc: GuideDoc;
  dateLabel?: string;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (!open || typeof document === 'undefined') return null;

  const downloadMarkdown = (): void => {
    download('Platform-Guide.md', guideToMarkdown(doc, dateLabel), 'text/markdown');
  };
  const downloadPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const { generateGuidePdf } = await import('../../lib/guide/guidePdf');
      const bytes = await generateGuidePdf(doc, dateLabel);
      download('Platform-Guide.pdf', bytes as BlobPart, 'application/pdf');
    } finally {
      setBusy(false);
    }
  };

  const btn = (primary: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
    border: primary ? 'none' : '1px solid var(--color-border)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
    opacity: busy ? 0.7 : 1,
  });

  const content = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'color-mix(in srgb, var(--color-heading) 55%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="platform-guide-modal"
    >
      <div
        style={{ background: 'var(--color-surface)', borderRadius: 14, boxShadow: 'var(--shadow-modal)', width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px 14px', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)' }}>{doc.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-meta)', marginTop: 2 }}>{doc.subtitle}{dateLabel ? ` · Updated ${dateLabel}` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" style={btn(false)} onClick={downloadMarkdown} data-testid="guide-download-md">Download .md</button>
            <button type="button" style={btn(true)} onClick={() => void downloadPdf()} disabled={busy} data-testid="guide-download-pdf">{busy ? 'Generating…' : 'Download PDF'}</button>
            <button type="button" onClick={onClose} data-testid="platform-guide-close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 24px 24px' }}>
          <p style={{ fontSize: 11.5, color: 'var(--color-meta)', fontStyle: 'italic', margin: '10px 0 0' }}>{doc.generatedNote}</p>
          {doc.sections.map((s) => <Section key={s.id} s={s} depth={2} />)}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
