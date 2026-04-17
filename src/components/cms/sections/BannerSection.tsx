import Link from 'next/link';
import { isHtml } from './renderCmsText';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function BannerSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const text    = v('text') ? (content.text as string ?? '') : '';
  const url     = v('url') ? (content.url as string ?? '') : '';
  const bgColor = (styles.bgColor as string) ?? '#2EAA4A';
  const textColor = (styles.textColor as string) ?? '#ffffff';
  const py      = (styles.paddingY as string) ?? '12px';

  if (!text) return null;

  const inner = (
    <div style={{
      maxWidth: 1200, margin: '0 auto', textAlign: 'center',
      fontSize: 14, fontWeight: 600, color: textColor, lineHeight: 1.4,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      {isHtml(text) ? <span dangerouslySetInnerHTML={{ __html: text }} /> : text}
      {url && <span style={{ fontSize: 16 }}>&rarr;</span>}
    </div>
  );

  return (
    <section style={{ background: bgColor, padding: `${py} 24px` }}>
      {url ? (
        <Link href={url} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          {inner}
        </Link>
      ) : inner}
    </section>
  );
}
