interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function RichTextSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const html    = content.html as string ?? '';
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const align   = (styles.textAlign as string) ?? 'left';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '800px';

  return (
    <section style={{
      background: bgColor,
      padding: `${py} 40px`,
      textAlign: align as React.CSSProperties['textAlign'],
    }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {v('badge') && badge && (
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {v('heading') && heading && (
          <h2 style={{
            fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800,
            color: '#0D2E5A', marginBottom: 20,
          }}>
            {heading}
          </h2>
        )}
        {v('html') && html && (
          <div
            className="fmp-rich-text"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      <style>{`
        .fmp-rich-text { font-size: 15px; color: #374151; line-height: 1.7; }
        .fmp-rich-text h2 { font-size: 22px; font-weight: 800; color: #0D2E5A; margin: 32px 0 12px; }
        .fmp-rich-text h3 { font-size: 18px; font-weight: 700; color: #1B3A6B; margin: 28px 0 10px; }
        .fmp-rich-text h4 { font-size: 16px; font-weight: 700; color: #374151; margin: 20px 0 8px; }
        .fmp-rich-text p { margin: 0 0 14px; }
        .fmp-rich-text ul, .fmp-rich-text ol { margin: 0 0 16px; padding-left: 24px; }
        .fmp-rich-text li { margin-bottom: 6px; }
        .fmp-rich-text a { color: #1B4F8A; text-decoration: underline; }
        .fmp-rich-text a:hover { color: #0D2E5A; }
        .fmp-rich-text strong { font-weight: 700; color: #111827; }
        .fmp-rich-text blockquote { border-left: 3px solid #E5E7EB; padding-left: 16px; margin: 16px 0; color: #6B7280; font-style: italic; }
        .fmp-rich-text hr { border: none; border-top: 1px solid #E5E7EB; margin: 24px 0; }
      `}</style>
    </section>
  );
}
