import { CmsParagraphs } from './CmsParagraphs';
import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function TextSection({ content, styles }: Props) {
  const heading = content.heading as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const color   = (styles.textColor as string) ?? '#374151';
  const align   = (styles.textAlign as string) ?? 'left';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '800px';
  const bodyAlign = (content.body_align as string) || align;

  return (
    <section style={{
      background: bgColor,
      padding: `${py} 40px`,
      textAlign: align as React.CSSProperties['textAlign'],
    }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {cmsVisible(content, 'heading') && heading && (
          <h2 style={{
            fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800,
            color: '#0D2E5A', marginBottom: 16,
          }}>
            {heading}
          </h2>
        )}
        <CmsField
          content={content}
          field="body"
          style={{ fontSize: 15, color, lineHeight: 1.7, textAlign: bodyAlign as React.CSSProperties['textAlign'] }}
        />
        <CmsParagraphs content={content} color={color} />
      </div>
    </section>
  );
}
