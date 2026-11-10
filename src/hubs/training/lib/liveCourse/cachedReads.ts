/**
 * Cached reads for the live course PAGES (2026-11-10). Every course page used
 * to read the course settings up to four times and the sessions twice, in
 * sequence, on every click, so moving between the overview and the sessions
 * took two to three seconds.
 *
 *   React cache()     one read per request (metadata, layout and page share it)
 *   unstable_cache    shared across requests for 60 seconds, tagged
 *
 * The same tag also clears the public Training Sessions page data.
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
import { loadPickedTestimonials } from './courseTestimonials';
import type { Testimonial } from '@/src/shared/cms';

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

// ── The overview's landing data (2026-11-10): each was a Tokyo round trip per view ──

/**
 * The course's uploaded certificate and badge templates, as samples for the
 * certification section; null until each exists (the section then hides it).
 */
export const courseTemplateSamplesCached = unstable_cache(
  async (code: string): Promise<{ certificateUrl: string | null; badgeUrl: string | null }> => {
    const sb = getServerClient();
    const c = code.toLowerCase();
    const has = async (bucket: string, name: string) => {
      const { data } = await sb.storage.from(bucket).list('templates', { search: name, limit: 5 });
      return (data ?? []).some((f) => f.name === name) ? sb.storage.from(bucket).getPublicUrl(`templates/${name}`).data.publicUrl : null;
    };
    try {
      const [certificateUrl, badgeUrl] = await Promise.all([has('certificates', `${c}-template.pdf`), has('badges', `${c}-badge.png`)]);
      return { certificateUrl, badgeUrl };
    } catch {
      return { certificateUrl: null, badgeUrl: null };
    }
  },
  ['live-course-template-samples'],
  { revalidate: REVALIDATE_SECONDS, tags: [LIVE_COURSE_CACHE_TAG] },
);

/** How many students are enrolled (the side card shows it above a threshold). */
export const courseEnrolledCountCached = unstable_cache(
  async (code: string): Promise<number> => {
    const { count } = await getServerClient().from('training_enrollments').select('id', { count: 'exact', head: true }).eq('course_code', code);
    return count ?? 0;
  },
  ['live-course-enrolled-count'],
  { revalidate: REVALIDATE_SECONDS, tags: [LIVE_COURSE_CACHE_TAG] },
);

/** The testimonials the admin picked for the course page. */
export const pickedTestimonialsCached = unstable_cache(
  async (picks: string[]): Promise<Testimonial[]> => loadPickedTestimonials(getServerClient(), picks),
  ['live-course-testimonials'],
  { revalidate: REVALIDATE_SECONDS, tags: [LIVE_COURSE_CACHE_TAG] },
);

/** Call after any admin write to a live course or one of its sessions. Never throws. */
export function invalidateLiveCourseCache(): void {
  try { revalidateTag(LIVE_COURSE_CACHE_TAG, { expire: 0 }); } catch (e) { console.warn('[liveCourse] cache invalidation failed', String(e)); }
}
