/**
 * Which live sessions the PUBLIC may see, and which may be announced to
 * newsletter subscribers. ONE rule:
 *
 *   a standalone session (no course_code), or a session of a live course that
 *   is offered publicly (training_course_settings.is_public = true).
 *
 * A session of a PRIVATE live course (is_public = false, e.g. a TEST course
 * or a closed cohort) is hidden from the public Training Sessions page, the
 * public APIs, the sitemap and the generic session lists, and never triggers
 * the newsletter. Its enrolled students still reach it from their course page,
 * which reads the course's sessions directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Course codes whose sessions are public. */
export async function publicCourseCodes(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('training_course_settings').select('course_code').eq('is_public', true);
  if (error) return []; // schema tolerance: no table means no public course sessions
  return (data ?? []).map((r) => String(r.course_code)).filter((c) => /^[A-Z0-9]{2,12}$/.test(c));
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
