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

export const dynamic = 'force-dynamic';

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
    redirect(`/signin?redirect=${encodeURIComponent(`/training/live-course/${encodeURIComponent(course.courseCode)}?enrol=1`)}`);
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

  const content = (
    <LiveCourseClient courseCode={course.courseCode} autoEnrol={enrol === '1'} signedIn={!!sess} publicData={publicData} />
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
