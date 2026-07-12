/**
 * AuthorAbout.tsx (public, server-safe presentational)
 *
 * "About the author" block rendered at the END of an article: the writer photo,
 * name, title, a bio, and an optional link to the author's full profile page on
 * the site (author_profile_url, e.g. /about/ahmad-din). Content is the per-article
 * snapshot (writer_name / writer_title / writer_avatar_url from migs 188 + 194,
 * author_bio / author_profile_url from mig 195). Renders nothing when there is no
 * bio, so the block never appears empty. No hooks: usable server-side.
 *
 * No em dashes in this file.
 */

import { resolveByline } from './AuthorByline';

interface Props {
  name?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  profileUrl?: string | null;
}

export function AuthorAbout({ name, title, avatarUrl, bio, profileUrl }: Props): React.JSX.Element | null {
  const text = bio?.trim();
  if (!text) return null; // no bio => no block (never render an empty card)

  const byline = resolveByline(name, title);
  const initials = byline.name.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const photo = avatarUrl?.trim();
  const link = profileUrl?.trim();

  return (
    <section
      aria-label="About the author"
      style={{
        display: 'flex', gap: 16, alignItems: 'flex-start',
        background: '#F7FAFE', border: '1px solid #E3ECF8', borderRadius: 14,
        padding: '22px 24px', marginTop: 8,
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={byline.name} style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', background: '#E8F0FB' }} />
      ) : (
        <div aria-hidden style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800 }}>
          {initials}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>About the author</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A' }}>{byline.name}</div>
        {byline.role && <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>{byline.role}</div>}
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#334155', whiteSpace: 'pre-wrap' }}>{text}</p>
        {link && (
          <a href={link} style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
            View full profile &rarr;
          </a>
        )}
      </div>
    </section>
  );
}
