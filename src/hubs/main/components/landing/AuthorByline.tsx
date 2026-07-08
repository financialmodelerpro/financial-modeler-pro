/**
 * AuthorByline.tsx (public, server-safe presentational)
 *
 * Financial Modeler Pro is a single-author publication, so the author identity
 * lives in ONE place here (ARTICLE_AUTHOR) rather than joined per-row from the
 * users table. JSON-LD on the article page uses the same name, so the displayed
 * byline and the structured-data author stay consistent. No schema, no join.
 *
 * No em dashes in this file.
 */

export const ARTICLE_AUTHOR = {
  name: 'Ahmad Din',
  role: 'CEO & Founder',
} as const;

interface Props {
  /** 'page' = larger byline near the article title/meta; 'card' = compact listing line. */
  variant?: 'page' | 'card';
}

export function AuthorByline({ variant = 'page' }: Props): React.JSX.Element {
  if (variant === 'card') {
    return (
      <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>
        Written by {ARTICLE_AUTHOR.name}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        aria-hidden
        style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800,
        }}
      >
        {ARTICLE_AUTHOR.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
      </div>
      <div style={{ lineHeight: 1.3 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>
          Written by {ARTICLE_AUTHOR.name}
        </div>
        {ARTICLE_AUTHOR.role && (
          <div style={{ fontSize: 12, color: '#64748B' }}>{ARTICLE_AUTHOR.role}</div>
        )}
      </div>
    </div>
  );
}
