/**
 * Who may join a live session, and when. Server-side, ONE rule used by the
 * join route and both registration-status routes.
 *
 * A student may join a session they registered for, or any session of a live
 * course they are enrolled in (enrolment registers them for every session,
 * including ones added later).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow } from './courseSettings';
import { joinWindowFor, joinStateAt, DEFAULT_OPENS_MINUTES_BEFORE, type JoinWindow, type JoinState } from './joinWindow';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

/** The logged join route: the only link a browser ever gets to a meeting. */
export function joinRoutePath(sessionId: string): string {
  return `/api/training/live-sessions/${encodeURIComponent(sessionId)}/join`;
}
export function joinRouteUrl(sessionId: string): string {
  return `${LEARN_URL}${joinRoutePath(sessionId)}`;
}

export interface SessionForAccess {
  id: string;
  live_url?: string | null;
  scheduled_datetime?: string | null;
  duration_minutes?: number | null;
  show_join_link_minutes_before?: number | null;
  course_code?: string | null;
}

export const SESSION_ACCESS_COLUMNS = 'id, live_url, scheduled_datetime, duration_minutes, show_join_link_minutes_before, course_code';

/** Minutes before the start that Join opens: the course's rule, else the session's. */
export async function opensMinutesBeforeFor(sb: SupabaseClient, s: SessionForAccess): Promise<number> {
  if (s.course_code) {
    const course = await getLiveCourseSettings(sb, s.course_code);
    if (isLiveCourseRow(course)) return course.joinOpensMinutesBefore;
  }
  return s.show_join_link_minutes_before ?? DEFAULT_OPENS_MINUTES_BEFORE;
}

/** Registered for this session, or enrolled in its live course. */
export async function studentHasSessionAccess(
  sb: SupabaseClient,
  student: { email: string; registrationId?: string | null },
  s: SessionForAccess,
): Promise<boolean> {
  const email = student.email.trim().toLowerCase();
  // A COURSE session has no registration of its own (founder, 2026-11-10):
  // enrolment in the course is the access, for every session including ones
  // added or rescheduled later. Old per-session rows on course sessions are ignored.
  if (s.course_code) {
    if (!student.registrationId) return false;
    const { data: enr } = await sb
      .from('training_enrollments')
      .select('id')
      .eq('registration_id', student.registrationId)
      .eq('course_code', s.course_code)
      .maybeSingle();
    return !!enr;
  }
  const { data: reg } = await sb
    .from('session_registrations')
    .select('id')
    .eq('session_id', s.id)
    .in('student_email', [email, student.email])
    .limit(1)
    .maybeSingle();
  if (reg) return true;
  if (s.course_code && student.registrationId) {
    const { data: enr } = await sb
      .from('training_enrollments')
      .select('id')
      .eq('registration_id', student.registrationId)
      .eq('course_code', s.course_code)
      .maybeSingle();
    if (enr) return true;
  }
  return false;
}

export interface JoinStatus {
  hasAccess: boolean;
  window: JoinWindow | null;
  state: JoinState;
  /** True when the student may click Join right now. */
  canJoinNow: boolean;
  /** The logged join route (absolute), for a student with access to a session with a link. */
  joinUrl: string | null;
}

export function joinStatusFrom(hasAccess: boolean, s: SessionForAccess, opensBefore: number, now: Date | number = Date.now()): JoinStatus {
  const window = joinWindowFor(s, opensBefore);
  const state = joinStateAt(now, window);
  const hasLink = typeof s.live_url === 'string' && s.live_url.trim().length > 0;
  return {
    hasAccess,
    window,
    state,
    canJoinNow: hasAccess && hasLink && state === 'open',
    joinUrl: hasAccess && hasLink ? joinRouteUrl(s.id) : null,
  };
}
