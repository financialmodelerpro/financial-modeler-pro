import { CmsParagraphs } from './CmsParagraphs';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function TextSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const body    = content.body as string ?? '';
  const heading = content.heading as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const color   = (styles.textColor as string) ?? '#374151';
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
        {v('heading') && heading && (
          <h2 style={{
            fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800,
            color: '#0D2E5A', marginBottom: 16,
          }}>
            {heading}
          </h2>
        )}
        {v('body') && body && (
          body.includes('<p>') || body.includes('<h') || body.includes('<strong>') || body.includes('<ul>') ? (
            <div className="fmp-rich-text" dangerouslySetInnerHTML={{ __html: body }}
              style={{ fontSize: 15, color, lineHeight: 1.7 }} />
          ) : (
            <div style={{ fontSize: 15, color, lineHeight: 1.7 }}>
              {body.split(/\n\n|\n/).filter(Boolean).map((para, i) => (
                <p key={i} style={{ margin: '0 0 14px' }}>{para}</p>
              ))}
            </div>
          )
        )}
        <CmsParagraphs content={content} color={color} />
      </div>
    </section>
  );
}
