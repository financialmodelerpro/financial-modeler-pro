import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getLiveCourseSettings, isLiveCourseRow, isPubliclyVisible, canRegister, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { CoursePageFrame } from '../../../live-course/CoursePageFrame';
import { CourseSessionClient } from './CourseSessionClient';

export const dynamic = 'force-dynamic';

/**
 * A live course session's page (2026-11-08): the course sidebar, the session
 * image, its content, the main button for the visitor or student, materials,
 * the session certificate and previous / next. The recording player is at
 * ./watch. The layout beside this checks the session belongs to the course.
 */
async function load(courseId: string, id: string) {
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, courseId);
  if (!isLiveCourseRow(course)) return null;
  const sessions = await listCourseSessions(sb, course.courseCode);
  const session = sessions.find((s) => s.id === id);
  return session ? { course, sessions, session, now: Date.now() } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ courseId: string; id: string }> }): Promise<Metadata> {
  const { courseId, id } = await params;
  const d = await load(courseId, id);
  if (!d) return { title: 'Session not found' };
  const no = d.session.course_session_no != null ? `Session ${d.session.course_session_no}: ` : '';
  return { title: `${no}${d.session.title} | ${d.course.title}`, description: d.session.content_overview || d.course.tagline || d.course.description };
}

export default async function CourseSessionPage({ params }: { params: Promise<{ courseId: string; id: string }> }) {
  const { courseId, id } = await params;
  const d = await load(courseId, id);
  if (!d) notFound();
  const sess = await getTrainingCookieSession();
  // A visitor sees a public course's sessions; a student's own access is checked by the course API.
  if (!sess && !isPubliclyVisible(d.course)) notFound();

  return (
    <CoursePageFrame signedIn={!!sess}>
      <CourseSessionClient
        course={d.course}
        sessions={d.sessions}
        sessionId={d.session.id}
        signedIn={!!sess}
        canRegister={canRegister(d.course)}
        now={d.now}
      />
    </CoursePageFrame>
  );
}
