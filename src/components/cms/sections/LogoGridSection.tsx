interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface LogoItem {
  src: string;
  alt?: string;
  url?: string;
}

export function LogoGridSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const logos   = (content.logos as LogoItem[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#F5F7FA';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(36px,5vw,60px)';
  const maxW    = (styles.maxWidth as string) ?? '1000px';
  const logoH   = content.logoHeight as string ?? '48px';

  if (!logos.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, color: textColor || undefined }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {v('badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {v('heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 700, color: textColor || '#6B7280', marginBottom: 32 }}>
            {heading}
          </h2>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          {logos.map((logo, i) => {
            const img = (
              <img
                key={i}
                src={logo.src}
                alt={logo.alt ?? `Logo ${i + 1}`}
                style={{ height: logoH, width: 'auto', objectFit: 'contain', opacity: 0.7, transition: 'opacity 0.2s' }}
                onMouseEnter={e => { (e.target as HTMLImageElement).style.opacity = '1'; }}
                onMouseLeave={e => { (e.target as HTMLImageElement).style.opacity = '0.7'; }}
              />
            );
            return logo.url ? (
              <a key={i} href={logo.url} target="_blank" rel="noopener noreferrer" style={{ lineHeight: 0 }}>{img}</a>
            ) : img;
          })}
        </div>
      </div>
    </section>
  );
}
