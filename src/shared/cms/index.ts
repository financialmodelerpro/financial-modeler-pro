/**
 * CMS Data Fetching Utilities
 * Used by server components (ISR) to fetch content from Supabase
 */

import { getServerClient } from '@/src/core/db/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CmsRow    { section: string; key: string; value: string }
export interface Module    { id: string; name: string; slug: string; description: string; icon: string; status: 'live' | 'coming_soon' | 'hidden'; display_order: number; launch_date: string | null }
export interface AssetType { id: string; module_id: string; name: string; description: string; icon: string; visible: boolean; display_order: number }
export interface Article   { id: string; title: string; slug: string; body: string; cover_url: string | null; category: string; status: string; featured: boolean; published_at: string | null; seo_title: string | null; seo_description: string | null; author_id: string | null; created_at: string; updated_at: string;
  // Additive (migration 187, schema-tolerant): present only after the migration is applied.
  mid_image_url?: string | null; mid_image_caption?: string | null; og_image_url?: string | null; tags?: string[] | null;
  // Junction-backed categories (Phase 2), flattened from article_categories. Empty when none assigned.
  categories?: { id: string; name: string; slug: string }[];
  // Writer/instructor association (migration 188): writer_id links the instructor row;
  // writer_name/writer_title are the snapshot taken at save time (stable byline).
  writer_id?: string | null; writer_name?: string | null; writer_title?: string | null }
export interface Course    { id: string; title: string; description: string; thumbnail_url: string | null; category: string; status: string; display_order: number; created_at: string; _lesson_count?: number }
export interface Lesson    { id: string; course_id: string; title: string; youtube_url: string; description: string; file_url: string | null; duration_minutes: number; display_order: number }
// ── CMS Content helpers ────────────────────────────────────────────────────────

/**
 * Fetch all cms_content rows and return as a nested object:
 * { hero: { headline: '...', subheadline: '...' }, stats: { ... } }
 */
export async function getCmsContent(): Promise<Record<string, Record<string, string>>> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('cms_content').select('section,key,value');
    if (!data) return {};
    const out: Record<string, Record<string, string>> = {};
    for (const row of data as CmsRow[]) {
      if (!out[row.section]) out[row.section] = {};
      out[row.section][row.key] = row.value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Resolve a content value with a fallback */
export function cms(
  content: Record<string, Record<string, string>>,
  section: string,
  key: string,
  fallback = ''
): string {
  return content?.[section]?.[key] ?? fallback;
}

// ── Modules ───────────────────────────────────────────────────────────────────

export async function getModules(): Promise<Module[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('modules')
      .select('*')
      .neq('status', 'hidden')
      .order('display_order');
    return (data as Module[]) ?? [];
  } catch {
    return [];
  }
}

export async function getAssetTypes(moduleId?: string): Promise<AssetType[]> {
  try {
    const sb = getServerClient();
    let q = sb.from('asset_types').select('*').order('display_order');
    if (moduleId) q = q.eq('module_id', moduleId);
    const { data } = await q;
    return (data as AssetType[]) ?? [];
  } catch {
    return [];
  }
}

// ── Articles ──────────────────────────────────────────────────────────────────

// Junction-embed select (migration 187). Flattened by normalizeArticleCategories.
const ARTICLE_WITH_CATEGORIES = '*, article_categories(categories(id,name,slug))';

/** Flatten the embedded article_categories -> categories into Article.categories. */
function normalizeArticleCategories<T extends Record<string, unknown>>(row: T): Article {
  const raw = (row as { article_categories?: Array<{ categories?: { id: string; name: string; slug: string } | null }> }).article_categories;
  const categories = Array.isArray(raw)
    ? raw.map((r) => r.categories).filter((c): c is { id: string; name: string; slug: string } => !!c)
    : [];
  const { article_categories, ...rest } = row as Record<string, unknown>;
  return { ...(rest as unknown as Article), categories };
}

/**
 * Dual-read: an article's category names come from the junction when present,
 * otherwise from the deprecated single `category` text column (kept for back-compat).
 */
export function articleCategoryNames(a: Article): string[] {
  if (a.categories && a.categories.length) return a.categories.map((c) => c.name);
  return a.category ? [a.category] : [];
}

export async function getPublishedArticles(limit?: number): Promise<Article[]> {
  try {
    const sb = getServerClient();
    const build = (sel: string) => {
      let q = sb.from('articles').select(sel).eq('status', 'published').order('published_at', { ascending: false });
      if (limit) q = q.limit(limit);
      return q;
    };
    let { data, error } = await build(ARTICLE_WITH_CATEGORIES);
    if (error) ({ data } = await build('*')); // fallback if junction not yet present
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => normalizeArticleCategories(r));
  } catch {
    return [];
  }
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  try {
    const sb = getServerClient();
    const build = (sel: string) => sb.from('articles').select(sel).eq('slug', slug).eq('status', 'published').single();
    let { data, error } = await build(ARTICLE_WITH_CATEGORIES);
    if (error) ({ data } = await build('*')); // fallback if junction not yet present
    return data ? normalizeArticleCategories(data as unknown as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Courses & Lessons ─────────────────────────────────────────────────────────

export async function getPublishedCourses(): Promise<Course[]> {
  try {
    const sb = getServerClient();
    const { data: courses } = await sb
      .from('courses')
      .select('*')
      .eq('status', 'published')
      .order('display_order');
    if (!courses) return [];
    // Attach lesson counts
    const ids = (courses as Course[]).map((c) => c.id);
    const { data: counts } = await sb
      .from('lessons')
      .select('course_id')
      .in('course_id', ids);
    const countMap: Record<string, number> = {};
    if (counts) for (const l of counts as { course_id: string }[]) {
      countMap[l.course_id] = (countMap[l.course_id] ?? 0) + 1;
    }
    return (courses as Course[]).map((c) => ({ ...c, _lesson_count: countMap[c.id] ?? 0 }));
  } catch {
    return [];
  }
}

export async function getCourseWithLessons(courseId: string): Promise<{ course: Course; lessons: Lesson[] } | null> {
  try {
    const sb = getServerClient();
    const { data: course } = await sb
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .eq('status', 'published')
      .single();
    if (!course) return null;
    const { data: lessons } = await sb
      .from('lessons')
      .select('*')
      .eq('course_id', courseId)
      .order('display_order');
    return { course: course as Course, lessons: (lessons as Lesson[]) ?? [] };
  } catch {
    return null;
  }
}

// ── Site Pages ────────────────────────────────────────────────────────────────

export interface SitePage { id: string; label: string; href: string; visible: boolean; display_order: number; can_toggle: boolean }

// Normalise stale hrefs / labels from old seed data (avoids needing a DB migration on every rename)
const HREF_MIGRATIONS: Record<string, string> = {
  '#modules':  '/modeling',
  '/#modules': '/modeling',
  '#pricing':  '/pricing',
  '/#pricing': '/pricing',
};
const LABEL_MIGRATIONS: Record<string, string> = {
  'Training Academy': 'Training Hub',
};

export async function getSitePages(): Promise<SitePage[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('site_pages').select('*').eq('visible', true).order('display_order');
    const pages = (data as SitePage[]) ?? [];
    return pages.map(p => ({
      ...p,
      href:  HREF_MIGRATIONS[p.href]   ?? p.href,
      label: LABEL_MIGRATIONS[p.label] ?? p.label,
    }));
  } catch {
    return [];
  }
}

export async function getAllSitePages(): Promise<SitePage[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('site_pages').select('*').order('display_order');
    return (data as SitePage[]) ?? [];
  } catch {
    return [];
  }
}

// ── YouTube URL parser ────────────────────────────────────────────────────────

export function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Read time estimate ────────────────────────────────────────────────────────

export function estimateReadTime(body: string): string {
  const words = body.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

// ── Mid-image marker injection ────────────────────────────────────────────────

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build the captioned <figure> for a mid-article image, or '' when no URL. */
export function midImageFigureHtml(url?: string | null, caption?: string | null): string {
  if (!url || !url.trim()) return '';
  const cap = caption && caption.trim()
    ? `\n  <figcaption>${escapeHtmlText(caption.trim())}</figcaption>`
    : '';
  return `<figure>\n  <img src="${escapeHtmlAttr(url.trim())}" alt="${caption ? escapeHtmlAttr(caption.trim()) : ''}" />${cap}\n</figure>`;
}

/**
 * Replace the {{MID_IMAGE}} marker in a body with the mid-image figure. When no
 * mid image is set, the marker is removed cleanly. Bodies without the marker are
 * returned unchanged (the mid image is simply not injected).
 */
export function renderBodyWithMidImage(body: string, url?: string | null, caption?: string | null): string {
  const MARKER = '{{MID_IMAGE}}';
  if (!body.includes(MARKER)) return body;
  return body.split(MARKER).join(midImageFigureHtml(url, caption));
}

// ── Plain-text excerpt ────────────────────────────────────────────────────────

/** Decode the handful of HTML entities that show up in article bodies. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // last, so &amp;lt; unwinds one layer per pass
}

/**
 * Build a clean plain-text excerpt from an article body for cards/listings.
 * Strips tags and decodes entities iteratively so even bodies that were stored
 * entity-encoded (e.g. a literal "&lt;p&gt;...") render as clean text, never raw
 * markup or entities. Truncates on a word boundary with an ellipsis.
 */
export function articleExcerpt(body: string | null | undefined, maxLen = 180): string {
  let s = body ?? '';
  // Alternate strip + decode until stable (survives a stored double-encoded layer).
  for (let i = 0; i < 4; i++) {
    const next = decodeEntities(s.replace(/<[^>]*>/g, ' '));
    if (next === s) break;
    s = next;
  }
  // Drop template markers like {{MID_IMAGE}} so they never leak into a preview.
  s = s.replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// ── Testimonials ──────────────────────────────────────────────────────────────

export interface Testimonial {
  id: string;
  name: string;
  role: string;
  company: string;
  text: string;
  rating: number;
  created_at: string;
  // extended fields from student_testimonials
  source?: 'manual' | 'student';
  testimonial_type?: 'written' | 'video' | 'manual';
  location?: string;
  linkedin_url?: string;
  video_url?: string;
  course_name?: string;
  is_featured?: boolean;
}

export async function getApprovedTestimonials(): Promise<Testimonial[]> {
  return getTestimonialsForPage('landing');
}

/**
 * Fetch approved testimonials for a specific page:
 * - 'landing'   → show_on_landing = true (admin-selected mix)
 * - 'modeling'  → hub = 'modeling'
 * - 'training'  → hub = 'training'
 */
export async function getTestimonialsForPage(page: 'landing' | 'modeling' | 'training'): Promise<Testimonial[]> {
  try {
    const sb = getServerClient();

    let manualQ = sb.from('testimonials')
      .select('id,name,role,company,text,rating,created_at,hub,show_on_landing,linkedin_url')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(12);

    let studentQ = sb.from('student_testimonials')
      .select('id,student_name,job_title,company,location,written_content,video_url,linkedin_url,course_name,rating,created_at,is_featured,testimonial_type,hub,show_on_landing')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(24);

    if (page === 'landing') {
      manualQ  = manualQ.eq('show_on_landing', true);
      studentQ = studentQ.eq('show_on_landing', true);
    } else {
      manualQ  = manualQ.eq('hub', page);
      studentQ = studentQ.eq('hub', page);
    }

    const [{ data: manual }, { data: students }] = await Promise.all([manualQ, studentQ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manualFmt: Testimonial[] = (manual ?? []).map((t: any) => ({
      id: t.id, name: t.name, role: t.role ?? '', company: t.company ?? '',
      text: t.text ?? '', rating: t.rating ?? 5, created_at: t.created_at,
      source: 'manual' as const, testimonial_type: 'manual' as const,
      linkedin_url: t.linkedin_url,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const studentFmt: Testimonial[] = (students ?? []).map((t: any) => ({
      id: t.id, name: t.student_name, role: t.job_title ?? '', company: t.company ?? '',
      text: t.written_content ?? '', rating: t.rating ?? 5, created_at: t.created_at,
      source: 'student' as const, testimonial_type: t.testimonial_type,
      location: t.location, linkedin_url: t.linkedin_url,
      video_url: t.video_url, course_name: t.course_name, is_featured: t.is_featured,
    }));

    return [...manualFmt, ...studentFmt]
      .sort((a, b) => {
        if (a.is_featured && !b.is_featured) return -1;
        if (!a.is_featured && b.is_featured) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

// ── Section style overrides ───────────────────────────────────────────────────

export interface SectionStyles {
  headingSize?:    string;
  headingColor?:   string;
  subheadingSize?: string;
  subheadingColor?:string;
  paddingY?:       string;
}

export function getSectionStyles(
  content: Record<string, Record<string, string>>,
  sectionId: string,
): SectionStyles {
  const raw = content?.section_styles?.[sectionId];
  if (!raw) return {};
  try { return JSON.parse(raw) as SectionStyles; } catch { return {}; }
}

// ── Dynamic CMS Pages ────────────────────────────────────────────────────────

export interface PageSection {
  id: string;
  page_slug: string;
  section_type: string;
  content: Record<string, unknown>;
  display_order: number;
  visible: boolean;
  styles: Record<string, unknown>;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  seo_title: string;
  seo_description: string;
  status: string;
  is_system: boolean;
}

/** Fetch all visible sections for a page slug, ordered by display_order */
export async function getPageSections(slug: string): Promise<PageSection[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('page_sections')
      .select('*')
      .eq('page_slug', slug)
      .eq('visible', true)
      .order('display_order');
    return (data as PageSection[]) ?? [];
  } catch {
    return [];
  }
}

/** Fetch ALL page sections for a slug (including hidden ones). Used by pages that need to distinguish "hidden" from "not seeded". */
export async function getAllPageSections(slug: string): Promise<PageSection[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('page_sections')
      .select('*')
      .eq('page_slug', slug)
      .order('display_order');
    return (data as PageSection[]) ?? [];
  } catch {
    return [];
  }
}

/** Fetch page metadata by slug */
export async function getCmsPage(slug: string): Promise<CmsPage | null> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_pages')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    return (data as CmsPage) ?? null;
  } catch {
    return null;
  }
}

// Legal pages shown in the footer bottom row, in display order. Each links to
// /<slug> (served by app/(cms)/[slug]). Only PUBLISHED ones appear; a page set
// to draft in the Page Builder disappears from the footer automatically (and
// the page itself already 404s via getCmsPage's status='published' filter).
export const FOOTER_LEGAL_SLUGS = [
  'privacy-policy',
  'terms-of-service',
  'confidentiality',
  'refund-policy',
] as const;

export interface FooterLegalLink { slug: string; label: string }

const FOOTER_LEGAL_DEFAULT_LABELS: Record<string, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-of-service': 'Terms of Service',
  'confidentiality': 'Confidentiality & Terms',
  'refund-policy': 'Refund Policy',
};

/**
 * Pure: pick the footer legal links from the set of PUBLISHED legal pages,
 * preserving FOOTER_LEGAL_SLUGS order and labelling each with its title (or the
 * default label). Drafts (absent from `published`) are excluded. Extracted so
 * the publish-driven behavior is unit-testable without a DB.
 */
export function selectFooterLegalLinks(published: { slug: string; title?: string | null }[]): FooterLegalLink[] {
  const titleBySlug = new Map(published.map((p) => [p.slug, p.title]));
  return FOOTER_LEGAL_SLUGS
    .filter((s) => titleBySlug.has(s))
    .map((s) => ({ slug: s, label: titleBySlug.get(s) || FOOTER_LEGAL_DEFAULT_LABELS[s] }));
}

/**
 * The published legal pages for the footer, in FOOTER_LEGAL_SLUGS order, labelled
 * with each page's cms_pages.title. On a query error, falls back to the default
 * three (privacy/terms/confidentiality) so the footer is never legally bare.
 */
export async function getFooterLegalLinks(): Promise<FooterLegalLink[]> {
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('cms_pages')
      .select('slug, title, status')
      .in('slug', FOOTER_LEGAL_SLUGS as unknown as string[])
      .eq('status', 'published');
    if (error) throw error;
    return selectFooterLegalLinks((data ?? []) as { slug: string; title?: string | null }[]);
  } catch {
    // Conservative fallback: the three pages that have always been published.
    return ['privacy-policy', 'terms-of-service', 'confidentiality'].map((s) => ({ slug: s, label: FOOTER_LEGAL_DEFAULT_LABELS[s] }));
  }
}

/** Fetch all published CMS page slugs (for generateStaticParams / sitemap) */
export async function getAllCmsPageSlugs(): Promise<string[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_pages')
      .select('slug')
      .eq('status', 'published');
    return (data ?? []).map((r: { slug: string }) => r.slug);
  } catch {
    return [];
  }
}

