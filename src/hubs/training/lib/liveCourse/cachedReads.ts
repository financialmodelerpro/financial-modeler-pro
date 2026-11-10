/**
 * Cached reads for the live course PAGES (2026-11-10). Every course page used
 * to read the course settings up to four times and the sessions twice, in
 * sequence, on every click, so moving between the overview and the sessions
 * took two to three seconds.
 *
 *   React cache()     one read per request (metadata, layout and page share it)
 *   unstable_cache    shared across requests for 60 seconds, tagged
 *
 * Only PUBLIC data: the course row and its published sessions (named columns,
 * never the meeting link). A student's own view (enrolment, join link,
 * progress) stays on the uncached course API. Every admin write that changes
 * these rows calls `invalidateLiveCourseCache()`, so an edit shows at once;
 * the 60 seconds only bound a write made outside the admin (a seed script, the
 * attendance cron).
 */
import { cache } from 'react';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getServerClient } from '@/src/core/db/supabase';
import { getLiveCourseSettings, listCourseSessions, normaliseCourseCode, type LiveCourseSettings, type CourseSession } from './courseSettings';

export const LIVE_COURSE_CACHE_TAG = 'live-course';
const REVALIDATE_SECONDS = 60;

const settingsShared = unstable_cache(
  async (code: string): Promise<LiveCourseSettings | null> => getLiveCourseSettings(getServerClient(), code),
  ['live-course-settings'],
  { revalidate: REVALIDATE_SECONDS, tags: [LIVE_COURSE_CACHE_TAG] },
);

const sessionsShared = unstable_cache(
  async (code: string): Promise<CourseSession[]> => listCourseSessions(getServerClient(), code),
  ['live-course-sessions'],
  { revalidate: REVALIDATE_SECONDS, tags: [LIVE_COURSE_CACHE_TAG] },
);

/** The course row (null for an exam course or an unknown code). */
export const getLiveCourseCached = cache(async (courseCode: string): Promise<LiveCourseSettings | null> => {
  const code = normaliseCourseCode(decodeURIComponent(courseCode));
  return code ? settingsShared(code) : null;
});

/** The course's published sessions, in order. */
export const listCourseSessionsCached = cache(async (courseCode: string): Promise<CourseSession[]> => {
  const code = normaliseCourseCode(courseCode);
  return code ? sessionsShared(code) : [];
});

/** Call after any admin write to a live course or one of its sessions. Never throws. */
export function invalidateLiveCourseCache(): void {
  try { revalidateTag(LIVE_COURSE_CACHE_TAG, { expire: 0 }); } catch (e) { console.warn('[liveCourse] cache invalidation failed', String(e)); }
}
