import type { ReactElement } from 'react';
import type { BrandPack, LiveSessionBannerContent } from '../types';
import { lighten, darken, formatSessionDateTime } from '../image-utils';

interface Args {
  brand: BrandPack;
  content: LiveSessionBannerContent;
  logoDataUri: string;
  trainerPhotoDataUri: string;
  backgroundDataUri: string;
}

/** Live/recorded session announcement banner (1200x627). */
export function LiveSessionTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${darken(brand.primaryColor, 0.1)} 0%, ${brand.primaryColor} 60%, ${darken(brand.primaryColor, 0.05)} 100%)`;

  const { date, time } = formatSessionDateTime(content.scheduledAtISO, content.timezone);

  return (
    <div style={{
      width: 1200, height: 627, display: 'flex', flexDirection: 'column',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.65)', display: 'flex' }} />
      )}
      <div style={{ position: 'absolute', top: -100, right: -100, width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />

      {/* Top: logo + badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '32px 56px 0', position: 'relative', zIndex: 2 }}>
        {logoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoDataUri} alt="FMP" style={{ height: 38 }} />
        ) : <div style={{ display: 'flex' }} />}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#DC2626', color: '#fff', padding: '8px 18px', borderRadius: 999,
          fontSize: 14, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', display: 'flex' }} />
          {content.badge || 'LIVE SESSION'}
        </div>
      </div>

      {/* Middle: title + meta */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 56px', position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 50, fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em', maxWidth: 1080, marginBottom: 24, display: 'flex' }}>
          {content.title}
        </div>

        {/* Date/time/duration row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 18, color: 'rgba(255,255,255,0.85)' }}>
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

        {content.cta && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 28 }}>
            <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '12px 26px', borderRadius: 6, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
              {content.cta}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: instructor strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 56px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)', position: 'relative', zIndex: 2 }}>
        {trainerPhotoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={trainerPhotoDataUri} alt={content.instructorName} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff', fontWeight: 700 }}>
            {(content.instructorName || brand.trainer.name).charAt(0)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', display: 'flex' }}>Instructor</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', display: 'flex' }}>{content.instructorName || brand.trainer.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{content.instructorTitle || brand.trainer.title}</div>
        </div>
      </div>
    </div>
  );
}
