interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function TextImageSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const html          = content.html as string ?? '';
  const heading       = content.heading as string ?? '';
  const imageSrc      = content.imageSrc as string ?? '';
  const imageAlt      = content.imageAlt as string ?? '';
  const imagePosition = (content.imagePosition as string) ?? 'right';
  const imageWidth    = (content.imageWidth as string) ?? '45%';
  const bgColor       = (styles.bgColor as string) ?? '#ffffff';
  const py            = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW          = (styles.maxWidth as string) ?? '1000px';

  const textBlock = (
    <div style={{ flex: 1, minWidth: 280 }}>
      {v('heading') && heading && (
        <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 16 }}>
          {heading}
        </h2>
      )}
      {v('html') && html && (
        <div dangerouslySetInnerHTML={{ __html: html }}
          style={{ fontSize: 15, color: '#374151', lineHeight: 1.7 }} />
      )}
    </div>
  );

  const imageBlock = imageSrc ? (
    <div style={{ flexShrink: 0, width: imageWidth, minWidth: 200 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSrc} alt={imageAlt}
        style={{ width: '100%', height: 'auto', borderRadius: 12, objectFit: 'cover' }} />
    </div>
  ) : null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{
        maxWidth: maxW, margin: '0 auto',
        display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap',
        flexDirection: imagePosition === 'left' ? 'row-reverse' : 'row',
      }}>
        {textBlock}
        {imageBlock}
      </div>
    </section>
  );
}
