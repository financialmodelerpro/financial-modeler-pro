interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface ListItem {
  icon?: string;
  title: string;
  description: string;
}

export function ListSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const items   = (content.items as ListItem[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const layout  = (content.layout as string) ?? 'vertical';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1000px';

  if (!items.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {v('badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {v('heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 40 }}>
            {heading}
          </h2>
        )}
        {layout === 'horizontal' ? (
          <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap' }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: 160, padding: '0 8px' }}>
                  {item.icon && (
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%',
                      background: '#fff', border: '2px solid #D1FAE5',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 24, marginBottom: 12,
                    }}>
                      {item.icon}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>{item.title}</div>
                  <div style={{ fontSize: 11.5, color: '#6B7280', lineHeight: 1.5 }}>{item.description}</div>
                </div>
                {i < items.length - 1 && (
                  <div style={{ fontSize: 20, color: '#2EAA4A', fontWeight: 700, marginTop: 16, padding: '0 4px', flexShrink: 0 }}>→</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 16px', background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB' }}>
                {item.icon && <span style={{ fontSize: 24, flexShrink: 0 }}>{item.icon}</span>}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
