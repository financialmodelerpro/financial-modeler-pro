interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface Column {
  heading?: string;
  html?: string;
  icon?: string;
}

export function ColumnsSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const columns = (content.columns as Column[]) ?? [];
  const count   = (content.count as number) ?? columns.length ?? 2;
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1000px';
  const gap     = (styles.gap as string) ?? '28px';

  if (!columns.length) return null;

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
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(count, 4)}, 1fr)`,
          gap,
        }}>
          {columns.map((col, i) => (
            <div key={i} style={{
              background: '#F9FAFB', borderRadius: 12,
              border: '1px solid #E5E7EB',
              padding: '28px 22px', textAlign: 'center',
            }}>
              {col.icon && <div style={{ fontSize: 32, marginBottom: 14 }}>{col.icon}</div>}
              {col.heading && (
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>
                  {col.heading}
                </div>
              )}
              {col.html && (
                <div dangerouslySetInnerHTML={{ __html: col.html }}
                  style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
