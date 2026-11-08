/**
 * Which live sessions the PUBLIC may see, and which may be announced to
 * newsletter subscribers. ONE rule:
 *
 *   a standalone session (no course_code), or a session of a PUBLISHED live
 *   course (courseSettings.isPubliclyVisible: status 'published', mig 249).
 *
 * A session of a draft or archived course is hidden from the public Training
 * Sessions page, the public APIs, the sitemap and the generic session lists,
 * and never triggers the newsletter. Its enrolled students still reach it from
 * their course page, which reads the course's sessions directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listLiveCourses } from './courseSettings';

/** Course codes whose sessions are public (published courses). */
export async function publicCourseCodes(sb: SupabaseClient): Promise<string[]> {
  return (await listLiveCourses(sb, { publicOnly: true }))
    .map((c) => c.courseCode)
    .filter((c) => /^[A-Z0-9]{2,12}$/.test(c));
}

/**
 * A PostgREST `.or()` filter keeping standalone sessions and public-course
 * sessions. Codes are validated upper-case tokens, so the filter is injection-safe.
 */
export function publicSessionOrFilter(codes: string[]): string {
  return codes.length ? `course_code.is.null,course_code.in.(${codes.join(',')})` : 'course_code.is.null';
}

export async function publicSessionFilter(sb: SupabaseClient): Promise<string> {
  return publicSessionOrFilter(await publicCourseCodes(sb));
}

/** True when a session may be announced publicly (newsletter). */
export async function isPublicSession(sb: SupabaseClient, courseCode: string | null | undefined): Promise<boolean> {
  if (!courseCode) return true;
  return (await publicCourseCodes(sb)).includes(courseCode.toUpperCase());
}
