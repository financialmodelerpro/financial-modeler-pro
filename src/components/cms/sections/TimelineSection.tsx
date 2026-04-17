import { isHtml } from './renderCmsText';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface TimelineItem {
  date?: string;
  title: string;
  description?: string;
}

export function TimelineSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const items   = (content.items as TimelineItem[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '700px';

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
        <div style={{ position: 'relative', paddingLeft: 32 }}>
          {/* Vertical line */}
          <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: '#E5E7EB' }} />
          {items.map((item, i) => (
            <div key={i} style={{ position: 'relative', marginBottom: i < items.length - 1 ? 32 : 0 }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -28, top: 6, width: 16, height: 16,
                borderRadius: '50%', background: '#2EAA4A', border: '3px solid #fff',
                boxShadow: '0 0 0 2px #2EAA4A',
              }} />
              {item.date && (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', marginBottom: 4, letterSpacing: '0.02em' }}>
                  {item.date}
                </div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700, color: textColor || '#0D2E5A', marginBottom: 6 }}>
                {item.title}
              </div>
              {item.description && (
                isHtml(item.description) ? (
                  <div className="fmp-rich-text" dangerouslySetInnerHTML={{ __html: item.description }}
                    style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }} />
                ) : (
                  <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
                    {item.description}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
