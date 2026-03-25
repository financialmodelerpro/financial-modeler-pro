/**
 * CMS Data Fetching Utilities
 * Used by server components (ISR) to fetch content from Supabase
 */

import { getServerClient } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CmsRow    { section: string; key: string; value: string }
export interface Module    { id: string; name: string; slug: string; description: string; icon: string; status: 'live' | 'coming_soon' | 'hidden'; display_order: number; launch_date: string | null }
export interface AssetType { id: string; module_id: string; name: string; description: string; icon: string; visible: boolean; display_order: number }
export interface Article   { id: string; title: string; slug: string; body: string; cover_url: string | null; category: string; status: string; featured: boolean; published_at: string | null; seo_title: string | null; seo_description: string | null; author_id: string | null; created_at: string; updated_at: string }
export interface Course    { id: string; title: string; description: string; thumbnail_url: string | null; category: string; status: string; display_order: number; created_at: string; _lesson_count?: number }
export interface Lesson    { id: string; course_id: string; title: string; youtube_url: string; description: string; file_url: string | null; duration_minutes: number; display_order: number }
export interface FounderRow { section: string; key: string; value: string }

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

export async function getPublishedArticles(limit?: number): Promise<Article[]> {
  try {
    const sb = getServerClient();
    let q = sb
      .from('articles')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (limit) q = q.limit(limit);
    const { data } = await q;
    return (data as Article[]) ?? [];
  } catch {
    return [];
  }
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('articles')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();
    return data as Article | null;
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

// ── Founder Profile ───────────────────────────────────────────────────────────

export async function getFounderProfile(): Promise<Record<string, Record<string, string>>> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('founder_profile').select('section,key,value');
    if (!data) return {};
    const out: Record<string, Record<string, string>> = {};
    for (const row of data as FounderRow[]) {
      if (!out[row.section]) out[row.section] = {};
      out[row.section][row.key] = row.value;
    }
    return out;
  } catch {
    return {};
  }
}

// ── Site Pages ────────────────────────────────────────────────────────────────

export interface SitePage { id: string; label: string; href: string; visible: boolean; display_order: number; can_toggle: boolean }

export async function getSitePages(): Promise<SitePage[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('site_pages').select('*').eq('visible', true).order('display_order');
    return (data as SitePage[]) ?? [];
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

export function extractYouTubeId(url: string): string | null {
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

// ── Testimonials ──────────────────────────────────────────────────────────────

export interface Testimonial {
  id: string;
  name: string;
  role: string;
  company: string;
  text: string;
  rating: number;
  created_at: string;
}

export async function getApprovedTestimonials(): Promise<Testimonial[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('testimonials')
      .select('id,name,role,company,text,rating,created_at')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(6);
    return (data ?? []) as Testimonial[];
  } catch {
    return [];
  }
}
