import Link from 'next/link';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function CtaSection({ content, styles }: Props) {
  const heading    = content.heading as string ?? '';
  const subtitle   = content.subtitle as string ?? '';
  const buttonText = content.buttonText as string ?? '';
  const buttonUrl  = content.buttonUrl as string ?? '';
  const button2Text = content.button2Text as string ?? '';
  const button2Url  = content.button2Url as string ?? '';
  const bgColor    = (styles.bgColor as string) ?? '#2EAA4A';
  const textColor  = (styles.textColor as string) ?? '#ffffff';
  const py         = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';

  return (
    <section style={{
      background: bgColor, padding: `${py} 40px`,
      textAlign: 'center', color: textColor,
    }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {heading && (
          <h2 style={{
            fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800,
            marginBottom: 12, lineHeight: 1.2,
          }}>
            {heading}
          </h2>
        )}
        {subtitle && (
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', marginBottom: 36, lineHeight: 1.6 }}>
            {subtitle}
          </p>
        )}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          {buttonText && buttonUrl && (
            <Link href={buttonUrl} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#fff', color: '#1A7A30', fontWeight: 800,
              fontSize: 16, padding: '14px 40px', borderRadius: 8,
              textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}>
              {buttonText}
            </Link>
          )}
          {button2Text && button2Url && (
            <Link href={button2Url} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: '#fff', fontWeight: 700,
              fontSize: 15, padding: '13px 32px', borderRadius: 8,
              textDecoration: 'none', border: '2px solid rgba(255,255,255,0.35)',
            }}>
              {button2Text}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
