import { isHtml } from './renderCmsText';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface Testimonial {
  photo?: string;
  name: string;
  role?: string;
  quote: string;
}

export function TestimonialsSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const items   = (content.items as Testimonial[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#F5F7FA';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1100px';

  if (!items.length) return null;

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          {items.map((t, i) => (
            <div key={i} style={{
              background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
              padding: '28px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, fontStyle: 'italic', flex: 1 }}>
                {isHtml(t.quote) ? <span dangerouslySetInnerHTML={{ __html: `&ldquo;${t.quote}&rdquo;` }} /> : <>&ldquo;{t.quote}&rdquo;</>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {t.photo ? (
                  <img src={t.photo} alt={t.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#9CA3AF', fontWeight: 700 }}>
                    {t.name.charAt(0)}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>{t.name}</div>
                  {t.role && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{t.role}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
