import type { ReactElement } from 'react';
import type { BrandPack, ArticleBannerContent, Instructor } from '../types';
import type { TemplateLayout } from '../layout';
import { mergeLayout, rectToStyle } from '../layout';
import { lighten, darken } from '../style-utils';

interface Args {
  brand: BrandPack;
  content: ArticleBannerContent;
  instructors: Instructor[];
  logoDataUri: string;
  instructorPhotos: Record<string, string>;
  backgroundDataUri: string;
}

export const ARTICLE_BANNER_LAYOUT: TemplateLayout = {
  canvas: { w: 1200, h: 630 },
  zones: {
    eyebrow:     { x: 60, y: 130, w: 400, h: 28 },
    title:       { x: 60, y: 180, w: 1080, h: 280 },
    authorBadge: { x: 0,  y: 540, w: 1200, h: 90 },
  },
  descriptors: [
    { key: 'eyebrow',     label: 'Eyebrow label', resizable: true },
    { key: 'title',       label: 'Headline',      resizable: true },
    { key: 'authorBadge', label: 'Author byline', resizable: true },
  ],
};

export function ArticleBannerTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const layout = mergeLayout(ARTICLE_BANNER_LAYOUT.zones, content.layout);
  const { w, h } = ARTICLE_BANNER_LAYOUT.canvas;

  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(160deg, ${brand.primaryColor} 0%, ${darken(brand.primaryColor, 0.2)} 100%)`;

  const author = instructors[0];
  const authorName = (content.author && content.author.trim()) || author?.name || brand.trainer.name;
  const authorPhoto = author ? instructorPhotos[author.id] : '';

  return (
    <div style={{
      width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Georgia, serif',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,46,90,0.65)', display: 'flex' }} />
      )}

      {/* Top accent bar (fixed) */}
      <div style={{ position: 'absolute', top: 0, left: 0, height: 6, width: '100%', background: accent, display: 'flex' }} />

      {/* Top: logo + category (fixed) */}
      <div style={{ position: 'absolute', top: 40, left: 60, right: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

      {/* Eyebrow zone */}
      <div style={{ ...rectToStyle(layout.eyebrow) }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', color: accent, textTransform: 'uppercase', fontFamily: 'Inter, Arial, sans-serif', display: 'flex' }}>
          ARTICLE
        </div>
      </div>

      {/* Title zone */}
      <div style={{ ...rectToStyle(layout.title) }}>
        <div style={{ fontSize: 50, fontWeight: 700, color: '#fff', lineHeight: 1.12, letterSpacing: '-0.015em', display: 'flex' }}>
          {content.title}
        </div>
      </div>

      {/* Author byline zone */}
      <div style={{ ...rectToStyle(layout.authorBadge), alignItems: 'center', gap: 14, padding: '0 60px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)' }}>
        {authorPhoto ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={authorPhoto} alt={authorName} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', fontWeight: 700 }}>
            {authorName.charAt(0)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Inter, Arial, sans-serif' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', display: 'flex' }}>By</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', display: 'flex' }}>{authorName}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 14, color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter, Arial, sans-serif', display: 'flex' }}>
          financialmodelerpro.com
        </div>
      </div>
    </div>
  );
}
