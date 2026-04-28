import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function RichTextSection({ content, styles }: Props) {
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const align   = (styles.textAlign as string) ?? 'left';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '800px';

  return (
    <section style={{
      background: bgColor,
      padding: `${py} 40px`,
      textAlign: align as React.CSSProperties['textAlign'],
    }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {cmsVisible(content, 'badge') && badge && (
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {cmsVisible(content, 'heading') && heading && (
          <h2 style={{
            fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800,
            color: '#0D2E5A', marginBottom: 20,
          }}>
            {heading}
          </h2>
        )}
        <CmsField content={content} field="html" />
      </div>
    </section>
  );
}
