import Link from 'next/link';
import { CmsParagraphs } from './CmsParagraphs';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function HeroSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const badge     = content.badge as string ?? '';
  const headline  = content.headline as string ?? '';
  const subtitle  = content.subtitle as string ?? '';
  const cta1Text  = content.cta1Text as string ?? '';
  const cta1Url   = content.cta1Url as string ?? '';
  const cta2Text  = content.cta2Text as string ?? '';
  const cta2Url   = content.cta2Url as string ?? '';
  const bgColor   = (styles.bgColor as string) ?? 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)';
  const textColor = (styles.textColor as string) ?? '#ffffff';
  const align     = (styles.textAlign as string) ?? 'center';
  const py        = (styles.paddingY as string) ?? 'clamp(56px,8vw,96px)';

  return (
    <section style={{
      background: bgColor,
      padding: `${py} 40px`,
      textAlign: align as React.CSSProperties['textAlign'],
      color: textColor,
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {v('badge') && badge && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(46,170,74,0.18)', border: '1px solid rgba(46,170,74,0.45)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: '#6EE589', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
          }}>
            {badge}
          </div>
        )}
        {v('headline') && headline && (
          <h1 style={{
            fontSize: 'clamp(28px,5vw,52px)', fontWeight: 800,
            lineHeight: 1.15, marginBottom: 20, letterSpacing: '-0.02em',
          }}>
            {headline}
          </h1>
        )}
        {v('subtitle') && subtitle && (
          <div style={{
            fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.7, maxWidth: 560, margin: '0 auto 36px',
          }}>
            {subtitle.split(/\n\n|\n/).filter(Boolean).map((para, i) => (
              <p key={i} style={{ margin: '0 0 14px' }}>{para}</p>
            ))}
          </div>
        )}
        <CmsParagraphs content={content} color="rgba(255,255,255,0.6)" />
        {(v('cta1') && cta1Text.trim() && cta1Url) || (v('cta2') && cta2Text.trim() && cta2Url) ? (
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            {v('cta1') && cta1Text.trim() && cta1Url && (
              <Link href={cta1Url} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#2EAA4A', color: '#fff',
                fontWeight: 700, fontSize: 15, padding: '13px 32px',
                borderRadius: 8, textDecoration: 'none',
                boxShadow: '0 4px 20px rgba(46,170,74,0.4)',
              }}>
                {cta1Text}
              </Link>
            )}
            {v('cta2') && cta2Text.trim() && cta2Url && (
              <Link href={cta2Url} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: '#fff',
                fontWeight: 700, fontSize: 15, padding: '13px 32px',
                borderRadius: 8, textDecoration: 'none',
                border: '2px solid rgba(255,255,255,0.35)',
              }}>
                {cta2Text}
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
