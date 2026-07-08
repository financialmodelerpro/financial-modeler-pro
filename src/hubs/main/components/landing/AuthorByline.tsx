/**
 * AuthorByline.tsx (public, server-safe presentational)
 *
 * Renders the article byline. An article can carry a per-article writer snapshot
 * (writer_name / writer_title from the instructors association, migration 188);
 * when present those are shown. When an article has no writer snapshot (older
 * content), it falls back to the single-author constant ARTICLE_AUTHOR, so every
 * article keeps a byline and JSON-LD stays consistent. No hooks: usable in both
 * server and client components.
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
  /** Per-article writer snapshot; falls back to ARTICLE_AUTHOR when absent. */
  name?: string | null;
  role?: string | null;
}

/**
 * Normalize a title for display: pipe-separated segments (e.g. instructor titles
 * like "A | B") render as a clean middot-joined line "A · B", matching the site's
 * "date · read-time" separator. Non-destructive: only the rendered string changes,
 * the stored writer_title keeps its original form.
 */
export function normalizeBylineTitle(role?: string | null): string | undefined {
  const t = role?.trim();
  if (!t) return undefined;
  return t.replace(/\s*\|\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim() || undefined;
}

/** Resolve the byline to the per-article writer, else the single-author fallback. */
export function resolveByline(name?: string | null, role?: string | null): { name: string; role?: string } {
  const w = name?.trim();
  if (w) return { name: w, role: normalizeBylineTitle(role) };
  return { name: ARTICLE_AUTHOR.name, role: normalizeBylineTitle(ARTICLE_AUTHOR.role) };
}

export function AuthorByline({ variant = 'page', name, role }: Props): React.JSX.Element {
  const byline = resolveByline(name, role);

  if (variant === 'card') {
    return (
      <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>
        Written by {byline.name}
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
        {byline.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
      </div>
      <div style={{ lineHeight: 1.3 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A' }}>
          Written by {byline.name}
        </div>
        {byline.role && (
          <div style={{ fontSize: 12, color: '#64748B' }}>{byline.role}</div>
        )}
      </div>
    </div>
  );
}
