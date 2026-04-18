/**
 * Universal CMS field renderer.
 *
 * Handles visibility, alignment, width, and HTML detection uniformly for every
 * section renderer. Replaces hand-rolled dangerouslySetInnerHTML + paragraph
 * splitting across 20+ section components so admin VF controls (alignment,
 * width %, visibility) actually take effect on the frontend.
 */

import React from 'react';

export type CmsFieldTag = 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4';

interface CmsFieldProps {
  /** The section content JSONB, or an array-item object. Width/align/visibility
   *  are read from content[`${field}_visible`], content[`${field}_align`],
   *  content[`${field}_width`]. */
  content: Record<string, unknown> | null | undefined;
  field: string;
  as?: CmsFieldTag;
  className?: string;
  /** Skip HTML detection and render as plain text with paragraph splitting. */
  plainText?: boolean;
  /** Fallback text if the field is empty. */
  fallback?: string;
  /** Additional inline styles. Width/align from content override these. */
  style?: React.CSSProperties;
  /** When true, a missing/empty field is ignored (returns null) even if a
   *  fallback would otherwise apply. Defaults to false. */
  required?: boolean;
}

const HTML_RE = /<[a-z][\s\S]*?>/i;

function isHtmlString(s: string): boolean {
  return HTML_RE.test(s);
}

export function CmsField({
  content,
  field,
  as = 'div',
  className,
  plainText,
  fallback,
  style,
  required,
}: CmsFieldProps) {
  const rawValue = content?.[field];
  const value = (typeof rawValue === 'string' ? rawValue : '') || fallback || '';
  const visible = content?.[`${field}_visible`] !== false;
  const align = content?.[`${field}_align`] as string | undefined;
  const width = content?.[`${field}_width`] as string | undefined;

  if (!visible) return null;
  if (!value || (required && !rawValue)) return null;

  const combinedStyle: React.CSSProperties = { ...style };
  if (align) combinedStyle.textAlign = align as React.CSSProperties['textAlign'];
  if (width) {
    if (width === 'auto') {
      combinedStyle.maxWidth = 'none';
    } else if (width !== '100') {
      const num = String(width).replace('%', '');
      combinedStyle.maxWidth = `${num}%`;
    }
  }

  const Tag = as;
  const isHtml = !plainText && isHtmlString(value);

  if (isHtml) {
    return (
      <Tag
        className={['fmp-rich-text fmp-cms-content', className].filter(Boolean).join(' ')}
        style={combinedStyle}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }

  // Plain-text path: split on blank lines into paragraphs, keep single
  // newlines as <br /> within a paragraph.
  const paragraphs = String(value).split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;

  // Inline tags (span/p/h1-h4) cannot legally wrap multiple <p>; render a
  // single paragraph's text inside the tag in that case.
  if (as === 'span' || as === 'p' || as === 'h1' || as === 'h2' || as === 'h3' || as === 'h4') {
    const text = paragraphs.join('\n\n');
    const lines = text.split('\n');
    return (
      <Tag
        className={['fmp-cms-content', className].filter(Boolean).join(' ')}
        style={combinedStyle}
      >
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </Tag>
    );
  }

  return (
    <Tag
      className={['fmp-cms-content', className].filter(Boolean).join(' ')}
      style={combinedStyle}
    >
      {paragraphs.map((para, i) => {
        const lines = para.split('\n');
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {line}
                {j < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </Tag>
  );
}

/** Check if a field is visible per its `${field}_visible` key (default true). */
export function cmsVisible(content: Record<string, unknown> | null | undefined, field: string): boolean {
  return content?.[`${field}_visible`] !== false;
}
