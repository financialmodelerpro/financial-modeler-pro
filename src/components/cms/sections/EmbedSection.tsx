interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function EmbedSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const html    = content.html as string ?? '';
  const heading = content.heading as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '900px';

  if (!html) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, color: textColor || undefined }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {v('heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: textColor || '#0D2E5A', marginBottom: 32 }}>
            {heading}
          </h2>
        )}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  );
}
