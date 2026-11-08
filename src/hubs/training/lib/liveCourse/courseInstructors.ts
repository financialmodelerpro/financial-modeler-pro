/**
 * A course's instructors, read LIVE from `instructors` (the records live
 * sessions use) on every view, in the course's order. An instructor's profile
 * edit therefore shows on every course page with no re-save. A deleted or
 * deactivated instructor is skipped.
 *
 * The founder (the default instructor, whose profile is /about/ahmad-din) is
 * flagged: the course page shows THE founder profile block for them (the home
 * page's one CMS record), so the founder renders the same way everywhere.
 * Every other instructor's bio is sanitised here, once.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeArticleHtml } from '@/src/shared/cms/sanitizeArticle';

export interface CourseInstructor {
  id: string;
  name: string;
  title: string;
  credentials: string | null;
  /** Plain text, or SANITISED HTML when the bio was written in a rich-text box. */
  bio: string | null;
  photoUrl: string | null;
  linkedinUrl: string | null;
  profileUrl: string | null;
  /** The founder: shown with the founder profile block, not an instructor card. */
  isFounder: boolean;
}

const HTML = /<[a-z][\s\S]*?>/i;

/** A bio safe to render: HTML sanitised, plain text unchanged (pure). */
export function safeBio(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return HTML.test(v) ? sanitizeArticleHtml(v) : v;
}

/** Rows to instructors in `ids` order; missing or inactive rows dropped (pure). */
export function orderInstructors(ids: string[], rows: Record<string, unknown>[]): CourseInstructor[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const out: CourseInstructor[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || r.active === false) continue;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    out.push({
      id,
      name: String(r.name ?? ''),
      title: String(r.title ?? ''),
      credentials: s(r.credentials),
      bio: safeBio(r.bio),
      photoUrl: s(r.photo_url),
      linkedinUrl: s(r.linkedin_url),
      profileUrl: s(r.profile_url),
      isFounder: r.is_default === true || /\/about\/ahmad-din\/?$/i.test(String(r.profile_url ?? '')),
    });
  }
  return out;
}

export async function loadCourseInstructors(sb: SupabaseClient, ids: string[]): Promise<CourseInstructor[]> {
  if (!ids.length) return [];
  // `*` so a column added to instructors later (or one not yet migrated) never fails the read.
  const { data, error } = await sb.from('instructors').select('*').in('id', ids);
  if (error) { console.warn('[liveCourse] instructors read failed', error.message); return []; }
  return orderInstructors(ids, (data ?? []) as Record<string, unknown>[]);
}
