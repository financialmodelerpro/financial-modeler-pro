/**
 * What the student's course page shows, assembled in ONE place on the server
 * so the page, the dashboard card and the verifier read the same answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLiveCourseSettings, isLiveCourseRow, listCourseSessions,
  type LiveCourseSettings, type CourseSession,
} from './courseSettings';
import { isEnrolled } from './enrolment';

export interface CourseView {
  course: LiveCourseSettings;
  sessions: CourseSession[];
  enrolled: boolean;
}

export async function loadCourseView(
  sb: SupabaseClient,
  student: { email: string; registrationId: string },
  courseCode: string,
): Promise<CourseView | null> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course) || !course.isActive) return null;
  const [sessions, enrolled] = await Promise.all([
    listCourseSessions(sb, course.courseCode),
    isEnrolled(sb, student.registrationId, course.courseCode),
  ]);
  return { course, sessions, enrolled };
}
