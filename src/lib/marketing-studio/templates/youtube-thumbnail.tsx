import type { ReactElement } from 'react';
import type { BrandPack, YouTubeThumbnailContent, Instructor } from '../types';
import type { TemplateLayout } from '../layout';
import { mergeLayout, rectToStyle } from '../layout';
import { lighten, darken, richBrandBackground, richBrandHighlight } from '../style-utils';

interface Args {
  brand: BrandPack;
  content: YouTubeThumbnailContent;
  instructors: Instructor[];
  logoDataUri: string;
  instructorPhotos: Record<string, string>;
  backgroundDataUri: string;
}

export const YOUTUBE_THUMB_LAYOUT: TemplateLayout = {
  canvas: { w: 1280, h: 720 },
  zones: {
    logo:          { x: 60,  y: 50,  w: 240, h: 80 },
    badge:         { x: 60,  y: 150, w: 240, h: 56 },
    title:         { x: 60,  y: 230, w: 800, h: 280 },
    subtitle:      { x: 60,  y: 520, w: 800, h: 70 },
    trainerCircle: { x: 920, y: 200, w: 320, h: 320 },
    brandByline:   { x: 60,  y: 640, w: 700, h: 40 },
  },
  descriptors: [
    { key: 'logo',          label: 'Logo',           resizable: true },
    { key: 'badge',         label: 'Badge',          resizable: true },
    { key: 'title',         label: 'Title (large)',  resizable: true },
    { key: 'subtitle',      label: 'Subtitle',       resizable: true },
    { key: 'trainerCircle', label: 'Trainer circle', resizable: true },
    { key: 'brandByline',   label: 'Brand byline',   resizable: true },
  ],
};

export function YouTubeThumbnailTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.55);
  const layout = mergeLayout(YOUTUBE_THUMB_LAYOUT.zones, content.layout);
  const { w, h } = YOUTUBE_THUMB_LAYOUT.canvas;
  const hidden = new Set(content.hiddenZones ?? []);

  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : richBrandBackground(brand.primaryColor, 'thumbnail');
  const ins = instructors[0];

  return (
    <div style={{
      width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif',
    }}>
      {backgroundDataUri ? (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,46,90,0.7)', display: 'flex' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: richBrandHighlight('thumbnail'), display: 'flex' }} />
      )}
      {/* Decorative right accent strip + bottom-left orb (anchored, not zones) */}
      <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: '100%', background: accent, display: 'flex' }} />
      <div style={{ position: 'absolute', bottom: -180, left: -180, width: 540, height: 540, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex' }} />

      {!hidden.has('logo') && logoDataUri && (
        <div style={{ ...rectToStyle(layout.logo) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri} alt="FMP" width={layout.logo.w} height={layout.logo.h} style={{ width: layout.logo.w, height: layout.logo.h, objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {!hidden.has('badge') && content.badge && (
        <div style={{ ...rectToStyle(layout.badge), alignItems: 'center' }}>
          <div style={{ background: accent, color: darken(brand.primaryColor, 0.4), padding: '7px 16px', borderRadius: 4, fontSize: 16, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', display: 'flex' }}>
            {content.badge}
          </div>
        </div>
      )}

      {!hidden.has('title') && (
        <div style={{ ...rectToStyle(layout.title) }}>
          <div style={{ fontSize: 70, fontWeight: 900, color: '#fff', lineHeight: 1.0, letterSpacing: '-0.025em', display: 'flex' }}>
            {content.title}
          </div>
        </div>
      )}

      {!hidden.has('subtitle') && content.subtitle && (
        <div style={{ ...rectToStyle(layout.subtitle) }}>
          <div style={{ fontSize: 26, color: accent, lineHeight: 1.3, fontWeight: 600, display: 'flex' }}>
            {content.subtitle}
          </div>
        </div>
      )}

      {!hidden.has('trainerCircle') && ins && (
        <div style={{ ...rectToStyle(layout.trainerCircle), alignItems: 'center', justifyContent: 'center' }}>
          {instructorPhotos[ins.id] ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={instructorPhotos[ins.id]} alt={ins.name} style={{ width: '88%', height: '88%', borderRadius: '50%', objectFit: 'cover', border: `6px solid ${accent}`, boxShadow: '0 0 0 12px rgba(255,255,255,0.06)' }} />
          ) : (
            <div style={{ width: '88%', height: '88%', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `6px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 110, color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>
              {ins.name.charAt(0)}
            </div>
          )}
        </div>
      )}

      {!hidden.has('brandByline') && (
        <div style={{ ...rectToStyle(layout.brandByline), alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', display: 'flex' }}>{ins?.name ?? brand.trainer.name}</div>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'flex' }} />
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', display: 'flex' }}>financialmodelerpro.com</div>
        </div>
      )}
    </div>
  );
}
