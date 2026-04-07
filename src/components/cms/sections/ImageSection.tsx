interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function ImageSection({ content, styles }: Props) {
  const src     = content.src as string ?? '';
  const alt     = content.alt as string ?? '';
  const caption = content.caption as string ?? '';
  const width   = content.width as string ?? '100%';
  const align   = (styles.textAlign as string) ?? 'center';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? '40px';
  const maxW    = (styles.maxWidth as string) ?? '1000px';
  const rounded = (styles.borderRadius as string) ?? '12px';

  if (!src) return null;

  return (
    <section style={{
      background: bgColor,
      padding: `${py} 40px`,
      textAlign: align as React.CSSProperties['textAlign'],
    }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: width,
            width: '100%',
            height: 'auto',
            borderRadius: rounded,
            display: align === 'center' ? 'block' : 'inline-block',
            margin: align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : undefined,
          }}
        />
        {caption && (
          <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 10, lineHeight: 1.5 }}>
            {caption}
          </p>
        )}
      </div>
    </section>
  );
}
