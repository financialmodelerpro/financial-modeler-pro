import type { ReactElement } from 'react';
import type { BrandPack, LinkedInBannerContent } from '../types';
import { lighten, darken } from '../image-utils';

interface Args {
  brand: BrandPack;
  content: LinkedInBannerContent;
  logoDataUri: string;
  trainerPhotoDataUri: string;
  backgroundDataUri: string;
}

/** Profile cover (1584x396) - wide horizontal layout. */
export function LinkedInProfileTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${darken(brand.primaryColor, 0.15)} 0%, ${brand.primaryColor} 50%, ${darken(brand.primaryColor, 0.05)} 100%)`;

  return (
    <div style={{
      width: 1584, height: 396, display: 'flex',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.55)', display: 'flex' }} />
      )}
      <div style={{ position: 'absolute', top: -120, right: -120, width: 480, height: 480, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />

      {/* Left: branding + headline */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 80px', position: 'relative', zIndex: 2 }}>
        {logoDataUri && (
          <div style={{ display: 'flex', marginBottom: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoDataUri} alt="FMP" style={{ height: 44 }} />
          </div>
        )}
        <div style={{ fontSize: 52, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 800, marginBottom: 16, display: 'flex' }}>
          {content.title}
        </div>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.75)', maxWidth: 760, lineHeight: 1.4, display: 'flex' }}>
          {content.subtitle}
        </div>
        {content.cta && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 22 }}>
            <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '10px 22px', borderRadius: 6, fontSize: 17, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
              {content.cta}
            </div>
          </div>
        )}
      </div>

      {/* Right: trainer card */}
      <div style={{ width: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 50px 0 30px', position: 'relative', zIndex: 2 }}>
        {trainerPhotoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={trainerPhotoDataUri} alt={brand.trainer.name} style={{ width: 150, height: 150, borderRadius: '50%', objectFit: 'cover', border: `4px solid ${accent}`, marginBottom: 14 }} />
        ) : (
          <div style={{ width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `4px solid ${accent}`, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>
            {brand.trainer.name.charAt(0)}
          </div>
        )}
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', display: 'flex' }}>{brand.trainer.name}</div>
        <div style={{ fontSize: 13, color: accent, marginTop: 4, textAlign: 'center', maxWidth: 380, lineHeight: 1.3, display: 'flex' }}>{brand.trainer.title}</div>
      </div>
    </div>
  );
}

/** Post banner (1200x627) - balanced left/right with trainer at bottom. */
export function LinkedInPostTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.6);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${darken(brand.primaryColor, 0.1)} 0%, ${brand.primaryColor} 100%)`;

  return (
    <div style={{
      width: 1200, height: 627, display: 'flex', flexDirection: 'column',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.6)', display: 'flex' }} />
      )}

      {/* Top: logo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '36px 56px', position: 'relative', zIndex: 2 }}>
        {logoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoDataUri} alt="FMP" style={{ height: 38 }} />
        ) : <div style={{ display: 'flex' }} />}
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', display: 'flex' }}>financialmodelerpro.com</div>
      </div>

      {/* Middle: headline */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 56px', position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 1080, display: 'flex' }}>
          {content.title}
        </div>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.75)', maxWidth: 1000, lineHeight: 1.4, marginTop: 22, display: 'flex' }}>
          {content.subtitle}
        </div>
        {content.cta && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 28 }}>
            <div style={{ background: accent, color: darken(brand.primaryColor, 0.35), padding: '12px 26px', borderRadius: 6, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex' }}>
              {content.cta}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: trainer strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '24px 56px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)', position: 'relative', zIndex: 2 }}>
        {trainerPhotoDataUri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={trainerPhotoDataUri} alt={brand.trainer.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}` }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#fff', fontWeight: 700 }}>
            {brand.trainer.name.charAt(0)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex' }}>{brand.trainer.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{brand.trainer.title}</div>
        </div>
      </div>
    </div>
  );
}

/** Quote/insight post (1200x627) - centered card style with founder credentials. */
export function LinkedInQuoteTemplate({ brand, content, logoDataUri, trainerPhotoDataUri, backgroundDataUri }: Args): ReactElement {
  const accent = lighten(brand.primaryColor, 0.55);
  const bg = backgroundDataUri
    ? `url("${backgroundDataUri}")`
    : `linear-gradient(135deg, ${brand.primaryColor} 0%, ${darken(brand.primaryColor, 0.2)} 100%)`;

  return (
    <div style={{
      width: 1200, height: 627, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: bg, backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: 'Inter, Arial, Helvetica, sans-serif', position: 'relative', overflow: 'hidden', padding: '64px',
    }}>
      {backgroundDataUri && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13, 46, 90, 0.7)', display: 'flex' }} />
      )}

      {/* Big opening quote mark */}
      <div style={{ position: 'absolute', top: 32, left: 64, fontSize: 220, lineHeight: 0.8, color: accent, opacity: 0.35, fontWeight: 800, display: 'flex', zIndex: 1 }}>“</div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 980 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.18em', color: accent, textTransform: 'uppercase', marginBottom: 24, display: 'flex' }}>
          {content.cta || 'INSIGHT'}
        </div>
        <div style={{ fontSize: 44, fontWeight: 700, fontStyle: 'italic', color: '#fff', lineHeight: 1.25, textAlign: 'center', display: 'flex' }}>
          {content.title}
        </div>
        {content.subtitle && (
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.72)', maxWidth: 800, lineHeight: 1.45, marginTop: 24, textAlign: 'center', display: 'flex' }}>
            {content.subtitle}
          </div>
        )}

        {/* Founder line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 36, padding: '14px 22px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
          {trainerPhotoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={trainerPhotoDataUri} alt={brand.trainer.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', display: 'flex' }}>{brand.trainer.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{brand.trainer.title}</div>
          </div>
        </div>
      </div>

      {/* Bottom logo strip */}
      {logoDataUri && (
        <div style={{ position: 'absolute', bottom: 28, display: 'flex', justifyContent: 'center', width: '100%', zIndex: 2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri} alt="FMP" style={{ height: 28, opacity: 0.7 }} />
        </div>
      )}
    </div>
  );
}
