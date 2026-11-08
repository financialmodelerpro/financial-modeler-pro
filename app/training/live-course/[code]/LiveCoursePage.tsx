import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getServerClient } from '@/src/core/db/supabase';
import {
  getLiveCourseSettings, isLiveCourseRow, isPubliclyVisible, canRegister, listCourseSessions,
} from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { isValidPreviewToken } from '@/src/hubs/training/lib/liveCourse/preview';
import { loadCourseInstructors } from '@/src/hubs/training/lib/liveCourse/courseInstructors';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { LiveCourseClient, type PublicCourseData } from './LiveCourseClient';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { getAllPageSections } from '@/src/shared/cms';
import { FounderProfileBlock } from '@/src/hubs/main/components/landing/FounderProfileBlock';
import { loadPickedTestimonials } from '@/src/hubs/training/lib/liveCourse/courseTestimonials';
import { TestimonialsCarousel } from '../../TestimonialsCarousel';

// Rendered at /training/<CODE> through app/training/[courseId]/page.tsx (paths.ts).

/**
 * The course's uploaded certificate and badge templates, as samples for the
 * certification section; null until each exists (the section then hides it).
 */
async function templateSamples(sb: ReturnType<typeof getServerClient>, code: string): Promise<{ certificateUrl: string | null; badgeUrl: string | null }> {
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
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const course = await getLiveCourseSettings(getServerClient(), code);
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
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) notFound();

  const sess = await getTrainingCookieSession();
  const previewOk = isValidPreviewToken(course.courseCode, preview);
  const visible = isPubliclyVisible(course);

  if (!sess && enrol === '1') {
    // Keep the course (and the enrol intent) through sign-in.
    redirect(`/signin?redirect=${encodeURIComponent(`${coursePagePath(course.courseCode)}?enrol=1`)}`);
  }
  // A signed-out visitor sees only a public course, or one through a preview link.
  if (!sess && !visible && !previewOk) notFound();

  const publicData: PublicCourseData | null = visible || previewOk
    ? {
        course,
        sessions: await listCourseSessions(sb, course.courseCode),
        instructors: await loadCourseInstructors(sb, course.instructorIds),
        preview: !visible && previewOk,
        canRegister: canRegister(course),
      }
    : null;

  // ── Landing page data (mig 252 sections; nothing secret) ──
  const page = course.page;
  const instructors = publicData?.instructors ?? await loadCourseInstructors(sb, course.instructorIds);
  const [{ count: enrolledCount }, samples, founderContent, testimonials] = await Promise.all([
    sb.from('training_enrollments').select('id', { count: 'exact', head: true }).eq('course_code', course.courseCode),
    templateSamples(sb, course.courseCode),
    // THE founder profile (the home page's one CMS record), only if the founder teaches this course.
    instructors.some((i) => i.isFounder)
      ? getAllPageSections('home').then((secs) => (secs.find((s) => s.section_type === 'team')?.content as Record<string, unknown> | undefined) ?? null).catch(() => null)
      : Promise.resolve(undefined),
    page.sections.testimonials.enabled ? loadPickedTestimonials(sb, page.sections.testimonials.ids) : Promise.resolve([]),
  ]);

  const content = (
    <LiveCourseClient
      courseCode={course.courseCode}
      autoEnrol={enrol === '1'}
      signedIn={!!sess}
      publicData={publicData}
      landing={{ page, enrolledCount: enrolledCount ?? 0, samples, testimonialCount: testimonials.length }}
      founderSlot={founderContent !== undefined
        ? <FounderProfileBlock content={founderContent} badgeOverride={page.sections.instructor.heading} />
        : null}
      testimonialsSlot={testimonials.length
        ? <TestimonialsCarousel testimonials={testimonials} heading={page.sections.testimonials.heading} subheading="" />
        : null}
    />
  );

  if (sess) return <TrainingShell activeNav="dashboard">{content}</TrainingShell>;
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />
      {content}
      <SharedFooter
        company="Financial Modeler Pro"
        founder="Financial Modeler Pro Team"
        copyright={`© ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
      />
    </div>
  );
}
