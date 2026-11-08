/**
 * A course's instructors, read LIVE from `instructors` (the records live
 * sessions use) on every view, in the course's order. An instructor's profile
 * edit therefore shows on every course page with no re-save. A deleted or
 * deactivated instructor is skipped.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CourseInstructor {
  id: string;
  name: string;
  title: string;
  credentials: string | null;
  bio: string | null;
  photoUrl: string | null;
  linkedinUrl: string | null;
  profileUrl: string | null;
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
      bio: s(r.bio),
      photoUrl: s(r.photo_url),
      linkedinUrl: s(r.linkedin_url),
      profileUrl: s(r.profile_url),
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
