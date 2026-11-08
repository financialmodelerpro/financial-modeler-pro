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
import { joinStatusFrom } from './sessionAccess';
import { effectiveSessionType } from './joinWindow';
import { computeEligibility, loadProgressMaps, type Eligibility } from './eligibility';

export interface CourseSessionView extends CourseSession {
  state: 'upcoming' | 'live' | 'recorded';
  /** Logged join route, or null (not enrolled, or no meeting link yet). */
  joinUrl: string | null;
  joinOpensAt: string | null;
  joinClosesAt: string | null;
}

export interface CourseView {
  course: LiveCourseSettings;
  sessions: CourseSessionView[];
  enrolled: boolean;
  /** Per-session progress and whether submission is unlocked (eligibility.ts). */
  eligibility: Eligibility;
}

export async function loadCourseView(
  sb: SupabaseClient,
  student: { email: string; registrationId: string },
  courseCode: string,
  now: number = Date.now(),
): Promise<CourseView | null> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course) || !course.isActive) return null;
  const [sessions, enrolled] = await Promise.all([
    listCourseSessions(sb, course.courseCode),
    isEnrolled(sb, student.registrationId, course.courseCode),
  ]);

  // Which sessions have a meeting link (read server-side, never returned).
  const ids = sessions.map((s) => s.id);
  const links = new Map<string, string | null>();
  if (ids.length) {
    const { data } = await sb.from('live_sessions').select('id, live_url').in('id', ids);
    for (const r of data ?? []) links.set(r.id as string, (r.live_url as string | null) ?? null);
  }

  const lower = student.email.trim().toLowerCase();
  const maps = await loadProgressMaps(sb, ids, [...new Set([lower, student.email.trim()])]);
  const eligibility = computeEligibility(course, sessions, maps.attendance.get(lower) ?? new Map(), maps.watch.get(lower) ?? new Map(), now);

  return {
    course,
    enrolled,
    eligibility,
    sessions: sessions.map((s) => {
      const st = joinStatusFrom(enrolled, { ...s, live_url: links.get(s.id) ?? null }, course.joinOpensMinutesBefore, now);
      return {
        ...s,
        state: effectiveSessionType(s, now),
        joinUrl: st.joinUrl,
        joinOpensAt: st.window?.opensAt ?? null,
        joinClosesAt: st.window?.closesAt ?? null,
      };
    }),
  };
}
