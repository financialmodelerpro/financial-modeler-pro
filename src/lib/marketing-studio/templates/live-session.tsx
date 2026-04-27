import type { ReactElement } from 'react';
import type { BrandPack, LiveSessionBannerContent, Instructor } from '../types';
import type { TemplateLayout } from '../layout';
import { mergeLayout, rectToStyle } from '../layout';
import { lighten, darken, formatSessionDateTime, richBrandBackground, richBrandHighlight } from '../style-utils';

interface Args {
  brand: BrandPack;
  content: LiveSessionBannerContent;
  instructors: Instructor[];
  logoDataUri: string;
  instructorPhotos: Record<string, string>;
  backgroundDataUri: string;
}

export const LIVE_SESSION_LAYOUT: TemplateLayout = {
  canvas: { w: 1200, h: 627 },
  zones: {
    logo:            { x: 56,  y: 28,  w: 200,  h: 64 },
    liveBadge:       { x: 920, y: 32,  w: 224,  h: 50 },
    headline:        { x: 56,  y: 130, w: 1088, h: 220 },
    metaRow:         { x: 56,  y: 360, w: 1088, h: 60 },
    cta:             { x: 56,  y: 440, w: 320,  h: 56 },
    instructorStrip: { x: 0,   y: 530, w: 1200, h: 97 },
  },
  descriptors: [
    { key: 'logo',            label: 'Logo',             resizable: true },
    { key: 'liveBadge',       label: 'LIVE / REC pill',  resizable: true },
    { key: 'headline',        label: 'Headline',         resizable: true },
    { key: 'metaRow',         label: 'Date / time row',  resizable: true },
    { key: 'cta',             label: 'CTA badge',        resizable: true },
    { key: 'instructorStrip', label: 'Instructor strip', resizable: true },
  ],
};

export function LiveSessionTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const layout = mergeLayout(LIVE_SESSION_LAYOUT.zones, content.layout);
  const { w, h } = LIVE_SESSION_LAYOUT.canvas;
  const hidden = new Set(content.hiddenZones ?? []);

  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : richBrandBackground(brand.primaryColor, 'banner');

  const { date, time } = formatSessionDateTime(content.scheduledAtISO, content.timezone);

  return (
    <div style={{
      width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif',
    }}>
      {backgroundDataUri ? (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,46,90,0.65)', display: 'flex' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: richBrandHighlight('banner'), display: 'flex' }} />
      )}
      {/* Decorative corner orb (anchored, not a content zone) */}
      <div style={{ position: 'absolute', top: -100, right: -100, width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />

      {!hidden.has('logo') && logoDataUri && (
        <div style={{ ...rectToStyle(layout.logo), alignItems: 'center', justifyContent: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri} alt="FMP" style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {!hidden.has('liveBadge') && (
        <div style={{ ...rectToStyle(layout.liveBadge), alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#DC2626', color: '#fff', padding: '8px 18px', borderRadius: 999,
            fontSize: 14, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
          }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', display: 'flex' }} />
            {content.badge || 'LIVE SESSION'}
          </div>
        </div>
      )}

      {!hidden.has('headline') && (
        <div style={{ ...rectToStyle(layout.headline) }}>
          <div style={{ fontSize: 50, fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em', display: 'flex' }}>
            {content.title}
          </div>
        </div>
      )}

      {!hidden.has('metaRow') && (
        <div style={{ ...rectToStyle(layout.metaRow), alignItems: 'center', gap: 28, fontSize: 18, color: 'rgba(255,255,255,0.85)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22, display: 'flex' }}>📅</span>
            <span style={{ display: 'flex' }}>{date}</span>
          </div>
          {time && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22, display: 'flex' }}>🕐</span>
              <span style={{ display: 'flex' }}>{time}</span>
            </div>
          )}
          {content.durationMinutes > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22, display: 'flex' }}>⏱</span>
              <span style={{ display: 'flex' }}>{content.durationMinutes} min</span>
            </div>
          )}
        </div>
      )}

      {!hidden.has('cta') && content.cta && (
        <div style={{ ...rectToStyle(layout.cta), alignItems: 'center' }}>
          <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '12px 26px', borderRadius: 6, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
            {content.cta}
          </div>
        </div>
      )}

      {!hidden.has('instructorStrip') && (
        <div style={{ ...rectToStyle(layout.instructorStrip), alignItems: 'center', gap: 18, padding: '0 56px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)' }}>
          {instructors.slice(0, 4).map((ins, i) => {
            const photo = instructorPhotos[ins.id];
            return (
              <div key={ins.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: i === 0 ? 0 : 8 }}>
                {photo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={photo} alt={ins.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', fontWeight: 700 }}>
                    {ins.name.charAt(0)}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', display: 'flex' }}>{ins.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{ins.title}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
