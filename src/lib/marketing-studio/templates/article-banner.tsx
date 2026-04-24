import type { ReactElement } from 'react';
import type { BrandPack, ArticleBannerContent } from '../types';
import { lighten, darken } from '../image-utils';

interface Args {
  brand: BrandPack;
  content: ArticleBannerContent;
  logoDataUri: string;
  trainerPhotoDataUri: string;
  backgroundDataUri: string;
}

/** Article banner (1200x630) - editorial layout with category tag + author byline. */
export function ArticleBannerTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(160deg, ${brand.primaryColor} 0%, ${darken(brand.primaryColor, 0.2)} 100%)`;

  return (
    <div style={{
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Georgia, serif', position: 'relative', overflow: 'hidden',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.65)', display: 'flex' }} />
      )}

      {/* Top accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, height: 6, width: '100%', background: accent, display: 'flex' }} />

      {/* Top: logo + category */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '40px 60px 0', position: 'relative', zIndex: 2 }}>
        {logoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoDataUri} alt="FMP" style={{ height: 36 }} />
        ) : <div style={{ display: 'flex' }} />}
        {content.category && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', borderRadius: 4, background: accent, color: darken(brand.primaryColor, 0.4), fontSize: 13, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            {content.category}
          </div>
        )}
      </div>

      {/* Middle: article title */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 60px', position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', color: accent, textTransform: 'uppercase', marginBottom: 18, fontFamily: 'Inter, Arial, sans-serif', display: 'flex' }}>
          ARTICLE
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: '#fff', lineHeight: 1.12, letterSpacing: '-0.015em', maxWidth: 1080, display: 'flex' }}>
          {content.title}
        </div>
      </div>

      {/* Bottom: author byline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '24px 60px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)', position: 'relative', zIndex: 2 }}>
        {trainerPhotoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={trainerPhotoDataUri} alt={content.author} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', fontWeight: 700 }}>
            {(content.author || brand.trainer.name).charAt(0)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Inter, Arial, sans-serif' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', display: 'flex' }}>By</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', display: 'flex' }}>{content.author || brand.trainer.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 14, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter, Arial, sans-serif', display: 'flex' }}>
          financialmodelerpro.com
        </div>
      </div>
    </div>
  );
}
