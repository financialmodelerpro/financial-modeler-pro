/**
 * Shared utility for rendering CMS text content.
 * Detects HTML and renders via dangerouslySetInnerHTML, or falls back to plain text paragraphs.
 */

const HTML_RE = /<[a-z][\s\S]*?>/i;

export function isHtml(text: string): boolean {
  return HTML_RE.test(text);
}

interface CmsTextProps {
  text: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Render CMS text: HTML-aware with fmp-rich-text class, or plain text split by newlines.
 */
export function CmsText({ text, style, className }: CmsTextProps) {
  if (!text) return null;

  if (isHtml(text)) {
    return (
      <div
        className={`fmp-rich-text ${className ?? ''}`}
        dangerouslySetInnerHTML={{ __html: text }}
        style={style}
      />
    );
  }

  // Plain text fallback: split by double or single newlines
  const paras = text.split(/\n\n|\n/).filter(Boolean);
  if (paras.length <= 1) {
    return <p style={style}>{text}</p>;
  }
  return (
    <div style={style}>
      {paras.map((para, i) => (
        <p key={i} style={{ margin: '0 0 14px' }}>{para}</p>
      ))}
    </div>
  );
}
