interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

function getEmbedUrl(url: string): string {
  if (!url) return '';
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vmMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}`;
  // Already an embed URL or other
  return url;
}

export function VideoSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const url     = content.url as string ?? '';
  const caption = content.caption as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '800px';

  const embedUrl = getEmbedUrl(url);
  if (!embedUrl) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, color: textColor || undefined }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        <div style={{
          position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden',
          borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
        }}>
          <iframe
            src={embedUrl}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {v('caption') && caption && (
          <p style={{ textAlign: 'center', fontSize: 13, color: textColor || '#6B7280', marginTop: 16, lineHeight: 1.6 }}>
            {caption}
          </p>
        )}
      </div>
    </section>
  );
}
