import type { Metadata } from 'next';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { getServerClient } from '@/src/core/db/supabase';
import { getAllPageSections } from '@/src/shared/cms';
import { getSitePagesCached, getCmsContentCached, getFooterLegalLinksCached } from '@/src/shared/cms/cached';
import { unstable_cache } from 'next/cache';
import { LIVE_COURSE_CACHE_TAG } from '@/src/hubs/training/lib/liveCourse/cachedReads';
import { canonicalUrl } from '@/src/shared/seo/canonical';
import { SessionsClient, type PublicSession, type HeroContent } from './SessionsClient';
import type { PublicCourseOffer } from './PublicCourseOffers';
import { listLiveCourses, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { applyCourseMedia } from '@/src/hubs/training/lib/liveCourse/courseMedia';
import { publicSessionFilter } from '@/src/hubs/training/lib/liveCourse/publicVisibility';
import { withoutCourseRecordingLink } from '@/src/hubs/training/lib/liveCourse/recordingAccess';

// Canonical lives on the learn subdomain because main-domain hits are 307'd to
// learn (next.config.ts /training-sessions redirect). Pointing canonical at
// MAIN would tell Google the canonical is itself a redirect, causing the
// "Page with redirect" Search Console warning.
export const metadata: Metadata = {
  title: 'Live Sessions | FMP Real-World Financial Modeling',
  description: 'Join live training sessions and access recorded content from Financial Modeler Pro. Practitioner-led courses on financial modeling, deal structuring, and corporate finance.',
  alternates: { canonical: canonicalUrl('/training-sessions', 'learn') },
  openGraph: {
    url: canonicalUrl('/training-sessions', 'learn'),
    title: 'Live Sessions | FMP Real-World Financial Modeling',
    description: 'Join live training sessions and access recorded content from Financial Modeler Pro.',
  },
};

export const dynamic = 'force-dynamic';

async function getSessions(): Promise<PublicSession[]> {
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('live_sessions')
      .select('id, title, description, session_type, scheduled_datetime, timezone, category, banner_url, duration_minutes, max_attendees, difficulty_level, instructor_name, instructor_title, tags, is_featured, youtube_url, youtube_embed, playlist_id, course_code, course_session_no, rescheduled_from, live_playlists(id, name)')
      .eq('is_published', true)
      .or(await publicSessionFilter(sb))
      .order('scheduled_datetime', { ascending: true });

    if (error) {
      console.error('[training-sessions] Supabase error:', error.message);
      return [];
    }

    // Get registration counts
    const sessionIds = (data ?? []).map(s => s.id);
    const regCounts: Record<string, number> = {};
    if (sessionIds.length > 0) {
      try {
        const { data: regs } = await sb
          .from('session_registrations')
          .select('session_id')
          .in('session_id', sessionIds);
        for (const r of regs ?? []) {
          regCounts[r.session_id] = (regCounts[r.session_id] ?? 0) + 1;
        }
      } catch { /* optional */ }
    }

    // A course session with no banner shows the course banner.
    const withMedia = await applyCourseMedia(sb, data ?? []);
    return withMedia.map(s => ({
      id: s.id,
      title: s.title,
      description: s.description,
      session_type: s.session_type,
      scheduled_datetime: s.scheduled_datetime,
      timezone: s.timezone,
      category: s.category,
      banner_url: s.banner_url,
      duration_minutes: s.duration_minutes,
      max_attendees: s.max_attendees,
      difficulty_level: s.difficulty_level,
      instructor_name: s.instructor_name,
      tags: s.tags,
      is_featured: s.is_featured,
      // A course recording link is never public (recordingAccess.ts).
      youtube_url: withoutCourseRecordingLink({ course_code: (s.course_code as string | null) ?? null, youtube_url: s.youtube_url ?? null }).youtube_url,
      youtube_embed: s.youtube_embed ?? false,
      instructor_title: s.instructor_title ?? null,
      playlist: (Array.isArray(s.live_playlists) ? s.live_playlists[0] : s.live_playlists) as PublicSession['playlist'],
      // A course session has no per-session registration, so no count.
      registration_count: s.course_code ? 0 : regCounts[s.id] ?? 0,
      course_code: (s.course_code as string | null) ?? null,
      course_session_no: (s.course_session_no as number | null) ?? null,
      course_short_title: s.course_short_title ?? null,
      rescheduled_from: (s.rescheduled_from as string | null) ?? null,
      banner_alt: s.banner_alt ?? null,
    }));
  } catch (err) {
    console.error('[training-sessions] Error:', err);
    return [];
  }
}

// Live courses open for public registration, with their published schedule.
async function getCourseOffers(): Promise<PublicCourseOffer[]> {
  try {
    const sb = getServerClient();
    const courses = await listLiveCourses(sb, { publicOnly: true });
    return await Promise.all(courses.map(async (c) => ({
      courseCode: c.courseCode,
      title: c.title,
      shortTitle: c.shortTitle,
      tagline: c.tagline,
      description: c.description,
      cardImageUrl: c.cardImageUrl,
      cardImageAlt: c.cardImageAlt,
      enrolmentOpen: c.enrolmentOpen,
      timeZones: c.timeZones,
      sessions: (await listCourseSessions(sb, c.courseCode)).map((s) => ({
        no: s.course_session_no, title: s.title, scheduled_datetime: s.scheduled_datetime,
      })),
    })));
  } catch (err) {
    console.error('[training-sessions] course offers failed', err);
    return [];
  }
}

/**
 * The page's data, shared across requests for 60 seconds (2026-11-10). Every
 * render made several SEQUENTIAL reads from a database on another continent
 * (Tokyo, from functions in Virginia), 3 to 8 seconds in all. The page is the
 * same for every visitor (a student's enrolment is fetched in the browser), so
 * one copy serves everyone; an admin session or course save clears it at once
 * (tag `live-course`, invalidateLiveCourseCache), and registration counts and
 * CMS edits show within 60 seconds. Whole-page caching is not possible: the
 * root layout reads per-request data, so every route renders dynamically.
 */
const getPageDataCached = unstable_cache(
  async () => {
    const [sessions, cmsSections, courses] = await Promise.all([getSessions(), getAllPageSections('training-sessions'), getCourseOffers()]);
    return { sessions, cmsSections, courses };
  },
  ['training-sessions-page'],
  { revalidate: 60, tags: [LIVE_COURSE_CACHE_TAG] },
);

export default async function TrainingSessionsPage() {
  const [{ sessions, cmsSections, courses }, sitePages, content, legalLinks] = await Promise.all([
    getPageDataCached(),
    getSitePagesCached(),
    getCmsContentCached(),
    getFooterLegalLinksCached(),
  ]);

  // Extract hero from CMS
  const heroRaw = cmsSections.find(s => s.section_type === 'hero');
  const heroContent: HeroContent | undefined = heroRaw?.visible !== false
    ? heroRaw?.content as HeroContent | undefined
    : undefined;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer preloaded={{ sitePages, content }} />
      <div style={{ height: 64 }} />

      <SessionsClient sessions={sessions} hero={heroContent} courses={courses} />

      <SharedFooter
        company="Financial Modeler Pro"
        founder="Financial Modeler Pro Team"
        copyright={`\u00A9 ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
        legalLinks={legalLinks}
      />
    </div>
  );
}
