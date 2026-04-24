import type { ReactElement } from 'react';
import type { BrandPack, YouTubeThumbnailContent } from '../types';
import { lighten, darken } from '../image-utils';

interface Args {
  brand: BrandPack;
  content: YouTubeThumbnailContent;
  logoDataUri: string;
  trainerPhotoDataUri: string;
  backgroundDataUri: string;
}

/** YouTube thumbnail (1280x720). Punchy, high-contrast, big readable type. */
export function YouTubeThumbnailTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.55);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${brand.primaryColor} 0%, ${darken(brand.primaryColor, 0.25)} 100%)`;

  return (
    <div style={{
      width: 1280, height: 720, display: 'flex',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.7)', display: 'flex' }} />
      )}

      {/* Decorative accent stripe down the right edge */}
      <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: '100%', background: accent, display: 'flex' }} />
      <div style={{ position: 'absolute', bottom: -180, left: -180, width: 540, height: 540, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex' }} />

      {/* Left: text */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '52px 60px', position: 'relative', zIndex: 2 }}>
        {/* Top: logo + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoDataUri && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoDataUri} alt="FMP" style={{ height: 44 }} />
          )}
          {content.badge && (
            <div style={{ background: accent, color: darken(brand.primaryColor, 0.4), padding: '7px 16px', borderRadius: 4, fontSize: 16, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', display: 'flex' }}>
              {content.badge}
            </div>
          )}
        </div>

        {/* Middle: massive title */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 900, color: '#fff', lineHeight: 1.0, letterSpacing: '-0.025em', display: 'flex' }}>
            {content.title}
          </div>
          {content.subtitle && (
            <div style={{ fontSize: 28, color: accent, lineHeight: 1.3, marginTop: 18, fontWeight: 600, display: 'flex' }}>
              {content.subtitle}
            </div>
          )}
        </div>

        {/* Bottom: brand strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', display: 'flex' }}>{brand.trainer.name}</div>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'flex' }} />
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', display: 'flex' }}>financialmodelerpro.com</div>
        </div>
      </div>

      {/* Right: trainer photo (1/3 width) */}
      <div style={{ width: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
        {trainerPhotoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={trainerPhotoDataUri} alt={brand.trainer.name} style={{ width: 280, height: 280, borderRadius: '50%', objectFit: 'cover', border: `6px solid ${accent}`, boxShadow: '0 0 0 12px rgba(255,255,255,0.06)' }} />
        ) : (
          <div style={{ width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `6px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 110, color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>
            {brand.trainer.name.charAt(0)}
          </div>
        )}
      </div>
    </div>
  );
}
