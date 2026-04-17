/**
 * Universal CMS paragraphs renderer.
 * Supports both string[] and {text, align}[] formats.
 * HTML-aware: renders via dangerouslySetInnerHTML if tags detected.
 */

import { isHtml } from './renderCmsText';

interface ParagraphItem { text: string; align?: string }

export function CmsParagraphs({ content, color }: { content: Record<string, unknown>; color?: string }) {
  const raw = Array.isArray(content.paragraphs) ? content.paragraphs as (string | ParagraphItem)[] : [];
  const paragraphs = raw
    .map(p => typeof p === 'string' ? { text: p, align: 'left' } : { text: p.text ?? '', align: p.align ?? 'left' })
    .filter(p => p.text);

  if (paragraphs.length === 0) return null;

  return (
    <>
      {paragraphs.map((para, i) => (
        isHtml(para.text) ? (
          <div key={i} className="fmp-rich-text" dangerouslySetInnerHTML={{ __html: para.text }}
            style={{ fontSize: 15, color: color ?? 'inherit', lineHeight: 1.75, marginBottom: 14, textAlign: para.align as React.CSSProperties['textAlign'] }} />
        ) : (
          <p key={i} style={{ fontSize: 15, color: color ?? 'inherit', lineHeight: 1.75, margin: '0 0 14px', textAlign: para.align as React.CSSProperties['textAlign'] }}>
            {para.text}
          </p>
        )
      ))}
    </>
  );
}
