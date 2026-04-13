interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface Member {
  photo?: string;
  name: string;
  role?: string;
  bio?: string;
}

export function TeamSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const members = (content.members as Member[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1100px';

  if (!members.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, color: textColor || undefined }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {v('badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {v('heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: textColor || '#0D2E5A', marginBottom: 40 }}>
            {heading}
          </h2>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32 }}>
          {members.map((m, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              {m.photo ? (
                <img src={m.photo} alt={m.name} style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', marginBottom: 16, border: '3px solid #E5E7EB' }} />
              ) : (
                <div style={{ width: 120, height: 120, borderRadius: '50%', background: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#9CA3AF', fontWeight: 700, margin: '0 auto 16px' }}>
                  {m.name.charAt(0)}
                </div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700, color: textColor || '#0D2E5A', marginBottom: 4 }}>{m.name}</div>
              {m.role && <div style={{ fontSize: 13, color: '#2EAA4A', fontWeight: 600, marginBottom: 8 }}>{m.role}</div>}
              {m.bio && <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>{m.bio}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
