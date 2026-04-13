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
  const itemsHeading  = content.itemsHeading as string ?? '';
  const bgColor       = (styles.bgColor as string) ?? '#ffffff';
  const py            = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW          = (styles.maxWidth as string) ?? '1100px';
  const items         = Array.isArray(content.items) ? (content.items as string[]).filter(Boolean) : [];

  const textBlock = (
    <div style={{ flex: 1, minWidth: 280, borderLeft: '4px solid #1ABC9C', paddingLeft: 24 }}>
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

  // Checklist card
  const checklistBlock = items.length > 0 ? (
    <div style={{ background: '#F8FAFF', border: '1px solid #E2EBF6', borderRadius: 12, padding: 24 }}>
      {itemsHeading && (
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1F3864', marginBottom: 16 }}>
          {itemsHeading}
        </h3>
      )}
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
          borderBottom: i < items.length - 1 ? '1px solid #F3F4F6' : 'none',
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: '#E8F4FD', border: '1px solid #2E75B6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#1B4F8A', marginTop: 1,
          }}>✓</span>
          <span style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.55, paddingTop: 3 }}>{item}</span>
        </div>
      ))}
    </div>
  ) : null;

  // Image block
  const imageBlock = imageSrc ? (
    <div>
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
  ) : null;

  // Right side: image + checklist, image only, checklist only, or placeholder
  const rightBlock = (imageBlock || checklistBlock) ? (
    <div style={{ flexShrink: 0, width: imageWidth, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {imageBlock}
      {checklistBlock}
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
        background: '#FAFBFC', borderRadius: 12, padding: '40px 32px',
        boxShadow: '0 2px 20px rgba(0,0,0,0.04)',
        display: 'flex', gap: 40, alignItems: 'flex-start', flexWrap: 'wrap',
        flexDirection: imagePosition === 'left' ? 'row-reverse' : 'row',
      }}>
        {textBlock}
        {rightBlock}
      </div>
    </section>
  );
}
