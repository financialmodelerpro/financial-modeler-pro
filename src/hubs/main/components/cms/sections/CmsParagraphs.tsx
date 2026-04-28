/**
 * Universal CMS paragraphs renderer.
 * Supports both string[] and {text, align}[] formats.
 * Uses CmsField internally so HTML detection / alignment / width are handled
 * consistently with every other CMS renderer.
 */

import { CmsField } from '../CmsField';

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
        <CmsField
          key={i}
          content={{ text: para.text, text_align: para.align }}
          field="text"
          style={{ fontSize: 15, color: color ?? 'inherit', lineHeight: 1.75, marginBottom: 14 }}
        />
      ))}
    </>
  );
}
