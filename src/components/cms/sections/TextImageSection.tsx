interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function TextImageSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const html          = content.html as string ?? '';
  const heading       = content.heading as string ?? '';
  const badge         = content.badge as string ?? '';
  const imageSrc      = content.imageSrc as string ?? '';
  const imageAlt      = content.imageAlt as string ?? '';
  const imagePosition = (content.imagePosition as string) ?? 'right';
  const imageWidth    = (content.imageWidth as string) ?? '45%';
  const imageHeight   = (content.imageHeight as string) ?? 'auto';
  const imageFit      = (content.imageFit as string) ?? 'cover';
  const imageRadius   = (content.imageRadius as string) ?? '12px';
  const placeholder   = (content.imagePlaceholder as string) ?? 'Image';
  const bgColor       = (styles.bgColor as string) ?? '#ffffff';
  const py            = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW          = (styles.maxWidth as string) ?? '1000px';

  const textBlock = (
    <div style={{ flex: 1, minWidth: 280 }}>
      {v('badge') && badge && badge.toUpperCase() !== heading.toUpperCase() && (
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
          {badge}
        </div>
      )}
      {v('heading') && heading && (
        <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 16, lineHeight: 1.2 }}>
          {heading}
        </h2>
      )}
      {v('html') && html && (
        <div dangerouslySetInnerHTML={{ __html: html }}
          style={{ fontSize: 15, color: '#374151', lineHeight: 1.75 }} />
      )}
    </div>
  );

  const items = Array.isArray(content.items) ? (content.items as string[]).filter(Boolean) : [];

  const rightBlock = imageSrc ? (
    <div style={{ flexShrink: 0, width: imageWidth, minWidth: 200 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSrc} alt={imageAlt}
        style={{
          width: '100%',
          height: imageHeight === 'auto' ? 'auto' : imageHeight,
          borderRadius: imageRadius,
          objectFit: imageFit as React.CSSProperties['objectFit'],
          display: 'block',
        }} />
    </div>
  ) : items.length > 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minWidth: 280 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: '#E8F0FB', border: '1px solid #C7D9F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#1B4F8A', marginTop: 1 }}>✓</span>
          <span style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.55 }}>{item}</span>
        </div>
      ))}
    </div>
  ) : (
    <div style={{
      flexShrink: 0, width: imageWidth, minWidth: 200,
      minHeight: imageHeight === 'auto' ? 220 : imageHeight,
      borderRadius: imageRadius,
      background: '#F3F4F6', border: '2px solid #E5E7EB',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#9CA3AF', fontSize: 15, fontWeight: 500,
    }}>
      {placeholder}
    </div>
  );

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{
        maxWidth: maxW, margin: '0 auto',
        display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap',
        flexDirection: imagePosition === 'left' ? 'row-reverse' : 'row',
      }}>
        {textBlock}
        {rightBlock}
      </div>
    </section>
  );
}
