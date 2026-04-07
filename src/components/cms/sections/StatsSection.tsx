interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface StatItem {
  value: string;
  label: string;
}

export function StatsSection({ content, styles }: Props) {
  const items   = (content.items as StatItem[]) ?? [];
  const bgColor = (styles.bgColor as string) ?? '#0D2E5A';
  const color   = (styles.textColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? '20px';

  if (!items.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{
        maxWidth: 1000, margin: '0 auto',
        display: 'flex', justifyContent: 'center',
        gap: 40, flexWrap: 'wrap',
      }}>
        {items.map((item, i) => (
          <div key={i} style={{ textAlign: 'center', minWidth: 100 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.2 }}>
              {item.value}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: 600 }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
