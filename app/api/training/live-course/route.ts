import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { listLiveCourses, listCourseSessions, isPubliclyVisible, canRegister } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { isEnrolled } from '@/src/hubs/training/lib/liveCourse/enrolment';
import { loadStudentEligibility } from '@/src/hubs/training/lib/liveCourse/eligibility';
import { courseProgress } from '@/src/hubs/training/lib/liveCourse/recordingAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/live-course: active live courses for the dashboard card
 * and My Courses (with `progress`, sessions complete / total, for an enrolled student).
 */
export async function GET() {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const sb = getServerClient();
  const courses = await listLiveCourses(sb);
  const out = await Promise.all(courses.map(async (c) => {
    const [sessions, enrolled] = await Promise.all([
      listCourseSessions(sb, c.courseCode),
      isEnrolled(sb, sess.registrationId, c.courseCode),
    ]);
    // Offered to a student who is enrolled (any status), or when a new student may join.
    if (!enrolled && !isPubliclyVisible(c)) return null;
    const next = sessions.find((s) => s.scheduled_datetime && new Date(s.scheduled_datetime).getTime() > Date.now());
    // "3/8": the same eligibility rule the course page and the certificate read.
    const elig = enrolled ? await loadStudentEligibility(sb, sess.email, c.courseCode) : null;
    return {
      courseCode: c.courseCode,
      title: c.title,
      description: c.description,
      sessionCount: sessions.length,
      nextSessionAt: next?.scheduled_datetime ?? null,
      enrolled,
      enrolmentOpen: canRegister(c),
      progress: elig ? courseProgress(elig) : null,
    };
  }));
  return NextResponse.json({ courses: out.filter(Boolean) });
}
