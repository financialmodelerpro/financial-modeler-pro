import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getLiveCourseSettings, isLiveCourseRow, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { isEnrolled } from '@/src/hubs/training/lib/liveCourse/enrolment';
import { buildCourseIcs } from '@/src/hubs/training/lib/liveCourse/calendar';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/live-course/[code]/calendar: every session of the course
 * as one .ics, for an enrolled student ("Add to calendar"). Same event IDs as
 * the enrolment and reschedule emails, so re-adding updates rather than duplicates.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!await isEnrolled(sb, sess.registrationId, course.courseCode)) return NextResponse.json({ error: 'Enrol in the course first.' }, { status: 403 });
  const ics = buildCourseIcs(course, await listCourseSessions(sb, course.courseCode));
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${course.courseCode}-live-sessions.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
