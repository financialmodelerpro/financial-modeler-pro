import { CmsParagraphs } from './CmsParagraphs';
import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function TextImageSection({ content, styles }: Props) {
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

  // Background image support
  const bgImageUrl  = content.bgImageUrl as string ?? '';
  const bgOverlay   = (content.bgOverlay as string) || 'rgba(15,35,70,0.75)';
  const bgPadTop    = (content.bgImagePaddingTop as string) || '0px';
  const bgPadBottom = (content.bgImagePaddingBottom as string) || '0px';
  const bgPadLeft   = (content.bgImagePaddingLeft as string) || '0px';
  const bgPadRight  = (content.bgImagePaddingRight as string) || '0px';
  const bgRadius    = (content.bgImageRadius as string) || '0px';
  const bgPos       = (content.bgImagePosition as string) || 'center';
  const bgImgFit    = (content.bgImageFit as string) || 'contain';
  const bgColorBg   = (content.bgColor as string) || '#0D2E5A';
  const hasBg       = !!bgImageUrl;
  const textColor   = hasBg ? '#ffffff' : '#374151';
  const headColor   = hasBg ? '#ffffff' : '#0D2E5A';
  const badgeColor  = hasBg ? 'rgba(255,255,255,0.7)' : '#1B4F8A';

  // Legacy `body_align`/`body_width` fields stored directly on content are
  // supported by CmsField automatically (it reads body_align / body_width).
  const textBlock = (
    <div style={{ flex: 1, minWidth: 280, borderLeft: '4px solid #1ABC9C', paddingLeft: 24 }}>
      {cmsVisible(content, 'badge') && badge && badge.toUpperCase() !== heading.toUpperCase() && (
        <div style={{ fontSize: 12, fontWeight: 700, color: badgeColor, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
          {badge}
        </div>
      )}
      {cmsVisible(content, 'heading') && heading && (
        <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: headColor, marginBottom: 16, lineHeight: 1.2 }}>
          {heading}
        </h2>
      )}
      <CmsField
        content={content}
        field="body"
        style={{ fontSize: 15, color: textColor, lineHeight: 1.75 }}
      />
      <CmsParagraphs content={content} color={textColor} />
    </div>
  );

  const checklistBlock = items.length > 0 ? (
    <div style={{
      background: hasBg ? 'rgba(255,255,255,0.1)' : '#F8FAFF',
      border: hasBg ? '1px solid rgba(255,255,255,0.2)' : '1px solid #E2EBF6',
      borderRadius: 12, padding: 24,
    }}>
      {itemsHeading && (
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: hasBg ? '#fff' : '#1F3864', marginBottom: 16 }}>
          {itemsHeading}
        </h3>
      )}
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
          borderBottom: i < items.length - 1 ? `1px solid ${hasBg ? 'rgba(255,255,255,0.1)' : '#F3F4F6'}` : 'none',
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: hasBg ? 'rgba(255,255,255,0.15)' : '#E8F4FD',
            border: `1px solid ${hasBg ? 'rgba(255,255,255,0.3)' : '#2E75B6'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: hasBg ? '#fff' : '#1B4F8A', marginTop: 1,
          }}>✓</span>
          <span style={{ fontSize: '0.95rem', color: hasBg ? '#fff' : '#374151', lineHeight: 1.55, paddingTop: 3 }}>{item}</span>
        </div>
      ))}
    </div>
  ) : null;

  const sideImageBlock = !hasBg && imageSrc ? (
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

  const rightBlock = (sideImageBlock || checklistBlock) ? (
    <div style={{ flexShrink: 0, width: hasBg ? 'auto' : imageWidth, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 16, flex: checklistBlock && !sideImageBlock ? 1 : undefined }}>
      {sideImageBlock}
      {checklistBlock}
    </div>
  ) : !hasBg ? (
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
  ) : null;

  const innerContent = (
    <div style={{
      maxWidth: maxW, margin: '0 auto', position: 'relative', zIndex: 1,
      background: hasBg ? 'transparent' : '#FAFBFC', borderRadius: 12, padding: '40px 32px',
      boxShadow: hasBg ? 'none' : '0 2px 20px rgba(0,0,0,0.04)',
      display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap',
      flexDirection: imagePosition === 'left' ? 'row-reverse' : 'row',
    }}>
      {textBlock}
      {rightBlock}
    </div>
  );

  return (
    <section style={{ background: hasBg ? bgColorBg : bgColor, padding: `${py} 40px`, position: 'relative', overflow: 'hidden' }}>
      {hasBg && (
        <div style={{
          position: 'absolute',
          top: bgPadTop, bottom: bgPadBottom, left: bgPadLeft, right: bgPadRight,
          borderRadius: bgRadius, overflow: 'hidden', zIndex: 0,
          backgroundColor: bgColorBg,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bgImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: bgImgFit as React.CSSProperties['objectFit'], objectPosition: bgPos, display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: bgOverlay }} />
        </div>
      )}
      {innerContent}
    </section>
  );
}
