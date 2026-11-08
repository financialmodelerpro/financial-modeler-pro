/**
 * Course-level media and time zones applied to session rows, in ONE place.
 *
 * A session of a live course with no image of its own shows the course CARD
 * image (16:9, the same shape as a session image, 2026-11-08), else the
 * course banner; every session of a course carries the course's time zone list for
 * its table. Standalone sessions (no course_code) are returned unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listLiveCourses, type LiveCourseSettings } from './courseSettings';

export interface CourseMediaFields {
  banner_url?: string | null;
  banner_alt?: string | null;
  course_time_zones?: string[] | null;
  course_title?: string | null;
  course_short_title?: string | null;
}

interface MediaRow { course_code?: string | null; banner_url?: string | null; banner_alt?: string | null }

/** The course banner when the session has none (pure). */
export function withCourseMedia<T extends object>(row: T, course: LiveCourseSettings | undefined): T & CourseMediaFields {
  const r = row as T & MediaRow;
  if (!r.course_code || !course) return r;
  const own = typeof r.banner_url === 'string' && r.banner_url.trim().length > 0;
  return {
    ...r,
    banner_url: own ? r.banner_url : (course.cardImageUrl || course.bannerUrl),
    banner_alt: own ? (r.banner_alt ?? null) : ((course.cardImageUrl ? course.cardImageAlt : course.bannerAlt) || null),
    course_time_zones: course.timeZones,
    course_title: course.title,
    course_short_title: course.shortTitle,
  };
}

/** Apply to many rows with one course read. */
export async function applyCourseMedia<T extends object>(sb: SupabaseClient, rows: T[]): Promise<(T & CourseMediaFields)[]> {
  const codeOf = (r: T) => (r as T & MediaRow).course_code ?? null;
  if (!rows.some((r) => codeOf(r))) return rows;
  const byCode = new Map((await listLiveCourses(sb, { includeInactive: true })).map((c) => [c.courseCode, c]));
  return rows.map((r) => withCourseMedia(r, codeOf(r) ? byCode.get(codeOf(r)!) : undefined));
}
