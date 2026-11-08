/**
 * Recordings for live-course sessions.
 *
 * Who is told a recording is available: every enrolled student who did not
 * meet the live threshold for that session (for them the recording is now
 * the way to complete it). Measured by the same live share eligibility uses.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow } from './courseSettings';
import { listEnrolledStudents } from './enrolledStudents';
import { liveShare, loadProgressMaps } from './eligibility';

export async function recordingRecipientsForCourseSession(
  sb: SupabaseClient,
  sessionId: string,
  courseCode: string,
): Promise<{ student_email: string; student_name: string }[]> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course)) return [];
  const [students, maps] = await Promise.all([
    listEnrolledStudents(sb, course.courseCode),
    loadProgressMaps(sb, [sessionId], null),
  ]);
  return students
    .filter((s) => liveShare(maps.attendance.get(s.email)?.get(sessionId) ?? []) < course.attendanceThresholdPct)
    .map((s) => ({ student_email: s.email, student_name: s.name }));
}
