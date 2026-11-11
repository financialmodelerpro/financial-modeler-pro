import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getServerClient } from '@/src/core/db/supabase';
import { isLiveCourseRow, isPubliclyVisible, canRegister } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { getLiveCourseCached, listCourseSessionsCached, courseTemplateSamplesCached, courseEnrolledCountCached, pickedTestimonialsCached } from '@/src/hubs/training/lib/liveCourse/cachedReads';
import { getAllPageSectionsCached } from '@/src/shared/cms/cached';
import { isValidPreviewToken } from '@/src/hubs/training/lib/liveCourse/preview';
import { loadCourseInstructors } from '@/src/hubs/training/lib/liveCourse/courseInstructors';
import { CoursePageFrame } from '../CoursePageFrame';
import { LiveCourseClient, type PublicCourseData } from './LiveCourseClient';
import { FounderShortCard } from '@/src/hubs/main/components/landing/FounderShortCard';
import { TestimonialsCarousel } from '../../TestimonialsCarousel';

// Rendered at /training/<CODE> through app/training/[courseId]/page.tsx (paths.ts).

/** Server time for the session status labels (read outside render). */
async function serverNow(): Promise<number> { return Date.now(); }

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const course = await getLiveCourseCached(code);
  if (!isPubliclyVisible(course)) return { title: 'Live Course | FMP Training Hub', robots: { index: false } };
  return {
    title: `${course!.title} | FMP Training Hub`,
    description: course!.tagline || course!.description.slice(0, 160),
    openGraph: course!.cardImageUrl ? { images: [{ url: course!.cardImageUrl, alt: course!.cardImageAlt || course!.title }] } : undefined,
  };
}

/**
 * The live course page. Visibility (courseSettings status rule, mig 249):
 *   published       anyone
 *   draft/archived  only with a valid admin preview link, or an enrolled
 *                   student (the client's personal view decides that, since
 *                   enrolment is checked on the signed session)
 */
export default async function LiveCoursePage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ enrol?: string; preview?: string }>;
}) {
  const { code } = await params;
  const { enrol, preview } = await searchParams;
  const sb = getServerClient();
  const course = await getLiveCourseCached(code);
  if (!isLiveCourseRow(course)) notFound();

  const sess = await getTrainingCookieSession();
  const previewOk = isValidPreviewToken(course.courseCode, preview);
  const visible = isPubliclyVisible(course);

  // ?enrol=1 never forces sign-in (2026-11-11, founder): a signed-out visitor
  // sees the public page with Register free; only a signed-in student's own
  // click on Enrol (here, or on a page linking here with ?enrol=1) enrols.
  // A signed-out visitor sees only a public course, or one through a preview link.
  if (!sess && !visible && !previewOk) notFound();

  // In parallel: the sessions (cached) and the instructors (read live, so a profile edit shows).
  const [sessions, loadedInstructors] = await Promise.all([
    listCourseSessionsCached(course.courseCode),
    loadCourseInstructors(sb, course.instructorIds),
  ]);
  const publicData: PublicCourseData | null = visible || previewOk
    ? {
        course,
        sessions,
        instructors: loadedInstructors,
        preview: !visible && previewOk,
        canRegister: canRegister(course),
      }
    : null;

  const renderedAt = await serverNow();
  // ── Landing page data (mig 252 sections; nothing secret) ──
  const page = course.page;
  const instructors = loadedInstructors;
  // Cached for 60 s and cleared by every admin course write (cachedReads.ts); only the instructors above are read live.
  const [enrolledCount, samples, founderContent, testimonials] = await Promise.all([
    courseEnrolledCountCached(course.courseCode),
    courseTemplateSamplesCached(course.courseCode),
    // THE founder profile (the home page's one CMS record), only if the founder teaches this course.
    instructors.some((i) => i.isFounder)
      ? getAllPageSectionsCached('home').then((secs) => (secs.find((s) => s.section_type === 'team')?.content as Record<string, unknown> | undefined) ?? null).catch(() => null)
      : Promise.resolve(undefined),
    page.sections.testimonials.enabled ? pickedTestimonialsCached(page.sections.testimonials.ids) : Promise.resolve([]),
  ]);

  const content = (
    <LiveCourseClient
      courseCode={course.courseCode}
      autoEnrol={enrol === '1'}
      signedIn={!!sess}
      publicData={publicData}
      landing={{ page, enrolledCount: enrolledCount ?? 0, samples, testimonialCount: testimonials.length, now: renderedAt }}
      founderSlot={founderContent !== undefined
        ? <FounderShortCard content={founderContent} shortBio={page.sections.instructor.shortBio} heading={page.sections.instructor.heading} />
        : null}
      testimonialsSlot={testimonials.length
        ? <TestimonialsCarousel testimonials={testimonials} heading={page.sections.testimonials.heading} subheading="" />
        : null}
    />
  );

  return <CoursePageFrame signedIn={!!sess}>{content}</CoursePageFrame>;
}
