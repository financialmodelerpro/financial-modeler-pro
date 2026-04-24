import type { ReactElement } from 'react';
import type { BrandPack, LinkedInBannerContent, Instructor } from '../types';
import type { TemplateLayout } from '../layout';
import { mergeLayout, rectToStyle } from '../layout';
import { lighten, darken } from '../image-utils';

interface Args {
  brand: BrandPack;
  content: LinkedInBannerContent;
  instructors: Instructor[];
  logoDataUri: string;
  instructorPhotos: Record<string, string>; // id -> base64
  backgroundDataUri: string;
}

/* ── Layouts ─────────────────────────────────────────────────────────── */

export const LINKEDIN_PROFILE_LAYOUT: TemplateLayout = {
  canvas: { w: 1584, h: 396 },
  zones: {
    headline:    { x: 80,   y: 100, w: 1000, h: 130 },
    subtitle:    { x: 80,   y: 240, w: 1000, h: 60 },
    cta:         { x: 80,   y: 310, w: 320,  h: 56 },
    trainerCard: { x: 1144, y: 60,  w: 380,  h: 280 },
  },
  descriptors: [
    { key: 'headline',    label: 'Headline',     resizable: true },
    { key: 'subtitle',    label: 'Subtitle',     resizable: true },
    { key: 'cta',         label: 'CTA badge',    resizable: false },
    { key: 'trainerCard', label: 'Trainer card', resizable: true },
  ],
};

export const LINKEDIN_POST_LAYOUT: TemplateLayout = {
  canvas: { w: 1200, h: 627 },
  zones: {
    headline:     { x: 56,  y: 130, w: 1088, h: 240 },
    subtitle:     { x: 56,  y: 380, w: 1000, h: 100 },
    cta:          { x: 56,  y: 490, w: 320,  h: 56 },
    trainerStrip: { x: 0,   y: 555, w: 1200, h: 72 },
  },
  descriptors: [
    { key: 'headline',     label: 'Headline',      resizable: true },
    { key: 'subtitle',     label: 'Subtitle',      resizable: true },
    { key: 'cta',          label: 'CTA badge',     resizable: false },
    { key: 'trainerStrip', label: 'Trainer strip', resizable: true },
  ],
};

export const LINKEDIN_QUOTE_LAYOUT: TemplateLayout = {
  canvas: { w: 1200, h: 627 },
  zones: {
    quoteBlock:   { x: 110, y: 110, w: 980, h: 350 },
    trainerBadge: { x: 360, y: 480, w: 480, h: 88 },
  },
  descriptors: [
    { key: 'quoteBlock',   label: 'Quote block',   resizable: true },
    { key: 'trainerBadge', label: 'Trainer badge', resizable: true },
  ],
};

/* ── Shared bits ─────────────────────────────────────────────────────── */

function backgroundLayer(brand: BrandPack, backgroundDataUri: string, scrim: string): ReactElement {
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${darken(brand.primaryColor, 0.15)} 0%, ${brand.primaryColor} 50%, ${darken(brand.primaryColor, 0.05)} 100%)`;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      display: 'flex',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: scrim, display: 'flex' }} />
      )}
    </div>
  );
}

function TrainerCard({ instructors, instructorPhotos, accent, layout }: {
  instructors: Instructor[];
  instructorPhotos: Record<string, string>;
  accent: string;
  layout: 'wide' | 'strip' | 'badge';
}) {
  const isMulti = instructors.length > 1;

  if (layout === 'wide') {
    // Big card for profile banner — single instructor centred
    const ins = instructors[0];
    const photo = instructorPhotos[ins.id];
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt={ins.name} style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', border: `4px solid ${accent}` }} />
        ) : (
          <div style={{ width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `4px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>
            {ins.name.charAt(0)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', display: 'flex' }}>{ins.name}</div>
          <div style={{ fontSize: 12, color: accent, marginTop: 2, textAlign: 'center', maxWidth: 360, lineHeight: 1.3, display: 'flex' }}>{ins.title}</div>
        </div>
        {isMulti && instructors.slice(1, 4).map(extra => {
          const xp = instructorPhotos[extra.id];
          return (
            <div key={extra.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {xp ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={xp} alt={extra.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
              ) : null}
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', display: 'flex' }}>+ {extra.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (layout === 'strip') {
    // Horizontal strip across the bottom of post banner
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 18, padding: '0 56px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)' }}>
        {instructors.slice(0, 4).map((ins, i) => {
          const photo = instructorPhotos[ins.id];
          return (
            <div key={ins.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: i === 0 ? 0 : 8 }}>
              {photo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={photo} alt={ins.name} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700 }}>
                  {ins.name.charAt(0)}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', display: 'flex' }}>{ins.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{ins.title}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 'badge' layout: pill row centred (used by quote template)
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '14px 22px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
      {instructors.slice(0, 3).map(ins => {
        const photo = instructorPhotos[ins.id];
        return (
          <div key={ins.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {photo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={photo} alt={ins.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', display: 'flex' }}>{ins.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{ins.title}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Templates ───────────────────────────────────────────────────────── */

export function LinkedInProfileTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const layout = mergeLayout(LINKEDIN_PROFILE_LAYOUT.zones, content.layout);
  const { w, h } = LINKEDIN_PROFILE_LAYOUT.canvas;

  return (
    <div style={{ width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden', fontFamily: 'Inter, Arial, Helvetica, sans-serif' }}>
      {backgroundLayer(brand, backgroundDataUri, 'rgba(13,46,90,0.55)')}

      {/* Logo (anchored top-left, not movable) */}
      {logoDataUri && (
        <div style={{ position: 'absolute', top: 36, left: 80, display: 'flex' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri} alt="FMP" style={{ height: 44 }} />
        </div>
      )}

      {/* Headline zone */}
      <div style={{ ...rectToStyle(layout.headline) }}>
        <div style={{ fontSize: 50, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.02em', display: 'flex' }}>
          {content.title}
        </div>
      </div>

      {/* Subtitle zone */}
      <div style={{ ...rectToStyle(layout.subtitle) }}>
        <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.78)', lineHeight: 1.4, display: 'flex' }}>
          {content.subtitle}
        </div>
      </div>

      {/* CTA zone */}
      {content.cta && (
        <div style={{ ...rectToStyle(layout.cta), alignItems: 'center' }}>
          <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '10px 22px', borderRadius: 6, fontSize: 17, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
            {content.cta}
          </div>
        </div>
      )}

      {/* Trainer card zone */}
      <div style={{ ...rectToStyle(layout.trainerCard) }}>
        <TrainerCard instructors={instructors} instructorPhotos={instructorPhotos} accent={accent} layout="wide" />
      </div>
    </div>
  );
}

export function LinkedInPostTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const layout = mergeLayout(LINKEDIN_POST_LAYOUT.zones, content.layout);
  const { w, h } = LINKEDIN_POST_LAYOUT.canvas;

  return (
    <div style={{ width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden', fontFamily: 'Inter, Arial, Helvetica, sans-serif' }}>
      {backgroundLayer(brand, backgroundDataUri, 'rgba(13,46,90,0.6)')}

      {/* Top bar: logo + url */}
      <div style={{ position: 'absolute', top: 36, left: 56, right: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {logoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoDataUri} alt="FMP" style={{ height: 38 }} />
        ) : <div style={{ display: 'flex' }} />}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', display: 'flex' }}>financialmodelerpro.com</div>
      </div>

      {/* Headline zone */}
      <div style={{ ...rectToStyle(layout.headline) }}>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.02em', display: 'flex' }}>
          {content.title}
        </div>
      </div>

      {/* Subtitle zone */}
      <div style={{ ...rectToStyle(layout.subtitle) }}>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4, display: 'flex' }}>
          {content.subtitle}
        </div>
      </div>

      {/* CTA zone */}
      {content.cta && (
        <div style={{ ...rectToStyle(layout.cta), alignItems: 'center' }}>
          <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '12px 26px', borderRadius: 6, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
            {content.cta}
          </div>
        </div>
      )}

      {/* Trainer strip zone */}
      <div style={{ ...rectToStyle(layout.trainerStrip) }}>
        <TrainerCard instructors={instructors} instructorPhotos={instructorPhotos} accent={accent} layout="strip" />
      </div>
    </div>
  );
}

export function LinkedInQuoteTemplate({ brand, content, instructors, logoDataUri, instructorPhotos, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.55);
  const layout = mergeLayout(LINKEDIN_QUOTE_LAYOUT.zones, content.layout);
  const { w, h } = LINKEDIN_QUOTE_LAYOUT.canvas;

  return (
    <div style={{ width: w, height: h, position: 'relative', display: 'flex', overflow: 'hidden', fontFamily: 'Inter, Arial, Helvetica, sans-serif' }}>
      {backgroundLayer(brand, backgroundDataUri, 'rgba(13,46,90,0.7)')}

      {/* Decorative quote mark (fixed) */}
      <div style={{ position: 'absolute', top: 32, left: 64, fontSize: 220, lineHeight: 0.8, color: accent, opacity: 0.35, fontWeight: 800, display: 'flex' }}>"</div>

      {/* Quote zone */}
      <div style={{ ...rectToStyle(layout.quoteBlock), flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.18em', color: accent, textTransform: 'uppercase', marginBottom: 18, display: 'flex' }}>
          {content.cta || 'INSIGHT'}
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, fontStyle: 'italic', color: '#fff', lineHeight: 1.25, textAlign: 'center', display: 'flex' }}>
          {content.title}
        </div>
        {content.subtitle && (
          <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45, marginTop: 18, textAlign: 'center', display: 'flex' }}>
            {content.subtitle}
          </div>
        )}
      </div>

      {/* Trainer badge zone */}
      <div style={{ ...rectToStyle(layout.trainerBadge) }}>
        <TrainerCard instructors={instructors} instructorPhotos={instructorPhotos} accent={accent} layout="badge" />
      </div>

      {/* Bottom logo (fixed) */}
      {logoDataUri && (
        <div style={{ position: 'absolute', bottom: 28, left: 0, width: '100%', display: 'flex', justifyContent: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri} alt="FMP" style={{ height: 28, opacity: 0.7 }} />
        </div>
      )}
    </div>
  );
}
