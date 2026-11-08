import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { listLiveCourses, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { isEnrolled } from '@/src/hubs/training/lib/liveCourse/enrolment';

export const dynamic = 'force-dynamic';

/** GET /api/training/live-course: active live courses for the dashboard card. */
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
    // Offered to a student who is enrolled, or when it is open to the public.
    if (!enrolled && !c.isPublic) return null;
    const next = sessions.find((s) => s.scheduled_datetime && new Date(s.scheduled_datetime).getTime() > Date.now());
    return {
      courseCode: c.courseCode,
      title: c.title,
      description: c.description,
      sessionCount: sessions.length,
      nextSessionAt: next?.scheduled_datetime ?? null,
      enrolled,
    };
  }));
  return NextResponse.json({ courses: out.filter(Boolean) });
}
