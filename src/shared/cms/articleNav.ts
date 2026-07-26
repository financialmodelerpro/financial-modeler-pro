/**
 * articleNav.ts, PURE article reading-navigation logic (no DB, no React).
 *
 * The article detail page needs three things around the body: a series contents
 * list ("Part X of Y"), previous/next links, and a "more in this category" list.
 * The data fetching lives in src/shared/cms/index.ts; the selection/ordering rules
 * live here so they are unit-testable without a database (see
 * scripts/verify-article-series.ts).
 *
 * Rules:
 * - Series parts are ordered by series_order asc, then published_at asc (older
 *   first), then title, so drag-set order wins and ties fall back to chronology.
 * - Prev/Next inside a series follow that sequence (Part 1 -> Part 2 -> ...).
 * - Prev/Next outside a series follow the article's primary category in date
 *   order: "previous" = the older neighbour, "next" = the newer neighbour.
 *
 * No em dashes in this file.
 */

// A minimal shape shared by every helper. The page passes richer rows; only these
// fields are read here.
export interface NavArticle {
  id: string;
  title: string;
  slug: string;
  published_at: string | null;
  series_order?: number | null;
}

export interface NavLink { id: string; title: string; slug: string }

export interface SeriesNav {
  currentIndex: number;          // 0-based position of the current article
  total: number;                 // number of published parts
  parts: NavLink[];              // every part, in reading order
  prev: NavLink | null;          // previous part (null on the first)
  next: NavLink | null;          // next part (null on the last)
}

export interface CategoryNav {
  prev: NavLink | null;          // older neighbour in the category
  next: NavLink | null;          // newer neighbour in the category
}

function toLink(a: NavArticle): NavLink { return { id: a.id, title: a.title, slug: a.slug }; }

function publishedMs(a: NavArticle): number {
  const t = a.published_at ? Date.parse(a.published_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Order a series' parts for display / navigation: series_order asc, then
 * published_at asc (older first), then title asc as a final stable tiebreak.
 */
export function orderSeriesParts(parts: NavArticle[]): NavArticle[] {
  return [...parts].sort((a, b) => {
    const oa = a.series_order ?? 0;
    const ob = b.series_order ?? 0;
    if (oa !== ob) return oa - ob;
    const pa = publishedMs(a);
    const pb = publishedMs(b);
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Build the series navigation for the current article. `parts` is every PUBLISHED
 * article in the series (any order); the current article should be among them.
 * Returns null when there are fewer than two parts or the current is absent (a
 * lone or unfound part is not a meaningful "series" to render).
 */
export function buildSeriesNav(parts: NavArticle[], currentId: string): SeriesNav | null {
  const ordered = orderSeriesParts(parts);
  const idx = ordered.findIndex((p) => p.id === currentId);
  if (idx === -1 || ordered.length < 2) return null;
  return {
    currentIndex: idx,
    total: ordered.length,
    parts: ordered.map(toLink),
    prev: idx > 0 ? toLink(ordered[idx - 1]) : null,
    next: idx < ordered.length - 1 ? toLink(ordered[idx + 1]) : null,
  };
}

/**
 * Build category prev/next for the current article. `articles` is the PUBLISHED
 * set sharing the article's primary category (current included), any order.
 * Ordered oldest -> newest here; "prev" is the older neighbour, "next" the newer.
 * Returns null links when the current sits at an end or is the only one.
 */
export function buildCategoryNav(articles: NavArticle[], currentId: string): CategoryNav {
  const ordered = [...articles].sort((a, b) => {
    const pa = publishedMs(a);
    const pb = publishedMs(b);
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
  const idx = ordered.findIndex((a) => a.id === currentId);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? toLink(ordered[idx - 1]) : null,
    next: idx < ordered.length - 1 ? toLink(ordered[idx + 1]) : null,
  };
}

/**
 * The newest OTHER articles in the same category (current excluded), newest
 * first, capped at `limit`. Used for the "More in this category" strip.
 */
export function moreInCategory<T extends NavArticle>(articles: T[], currentId: string, limit = 6): T[] {
  return [...articles]
    .filter((a) => a.id !== currentId)
    .sort((a, b) => publishedMs(b) - publishedMs(a))
    .slice(0, limit);
}
