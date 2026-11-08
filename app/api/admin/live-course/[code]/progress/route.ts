import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { listEnrolledStudents } from '@/src/hubs/training/lib/liveCourse/enrolledStudents';
import { computeEligibility, loadProgressMaps } from '@/src/hubs/training/lib/liveCourse/eligibility';

export const dynamic = 'force-dynamic';

/** GET /api/admin/live-course/[code]/progress: every enrolled student's eligibility, by the one rule. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });
  const [sessions, students] = await Promise.all([listCourseSessions(sb, course.courseCode), listEnrolledStudents(sb, course.courseCode)]);
  const maps = await loadProgressMaps(sb, sessions.map((s) => s.id), null);
  const rows = students.map((st) => ({
    ...st,
    eligibility: computeEligibility(course, sessions, maps.attendance.get(st.email) ?? new Map(), maps.watch.get(st.email) ?? new Map()),
  }));
  return NextResponse.json({
    course,
    sessions: sessions.map((s) => ({ id: s.id, no: s.course_session_no, title: s.title })),
    students: rows,
  });
}
