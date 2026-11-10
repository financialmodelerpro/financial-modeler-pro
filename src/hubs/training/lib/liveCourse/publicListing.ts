/**
 * How a session is listed on the public Training Sessions page (2026-11-08).
 *
 * Single sessions are listed as before: upcoming or live in Upcoming,
 * finished in Recorded. A session of a live course is listed under its
 * course: in Upcoming until it ends, and in Recorded only once its recording
 * is added (an ended course session with no recording is not listed). Its
 * card's main button goes to COURSE enrolment, never single-session
 * registration, because a course session needs the course. Pure.
 */
import { effectiveSessionType } from './joinWindow';
import { coursePagePath, courseSessionPath } from './paths';

export type Listing = 'upcoming' | 'recorded' | 'hidden';

export interface ListableSession {
  session_type: string;
  scheduled_datetime?: string | null;
  duration_minutes?: number | null;
  youtube_url?: string | null;
  course_code?: string | null;
}

export function listingOf(s: ListableSession, now: number = Date.now()): Listing {
  const eff = effectiveSessionType(s as Parameters<typeof effectiveSessionType>[0], now);
  if (eff !== 'recorded') return 'upcoming';
  if (s.course_code && !(s.youtube_url && s.youtube_url.trim())) return 'hidden';
  return 'recorded';
}

/** The filter label for a course: "REFM Live Series". */
export function seriesLabel(shortTitle: string | null | undefined, courseCode: string): string {
  return `${(shortTitle ?? '').trim() || courseCode} Live Series`;
}

/** The filter value for a course (kept apart from playlist names). */
export const seriesValue = (courseCode: string) => `course:${courseCode}`;

export interface CourseCardAction { label: string; href: string; kind: 'view' | 'enrol' | 'register' | 'course' }

/**
 * The main button of a course session card.
 *   enrolled            -> View session (the session page, where the recording plays)
 *   signed in, open     -> Enrol (the course page enrols on arrival)
 *   signed out, open    -> Register free (account + enrolment in one step)
 *   enrolment closed    -> View course
 */
export function courseCardAction(p: {
  courseCode: string; sessionId: string; enrolled: boolean; signedIn: boolean; enrolmentOpen: boolean;
}): CourseCardAction {
  if (p.enrolled) return { kind: 'view', label: 'View session', href: courseSessionPath(p.courseCode, p.sessionId) };
  if (!p.enrolmentOpen) return { kind: 'course', label: 'View course', href: coursePagePath(p.courseCode) };
  if (p.signedIn) return { kind: 'enrol', label: 'Enrol in course', href: `${coursePagePath(p.courseCode)}?enrol=1` };
  return { kind: 'register', label: 'Enrol in course', href: `/register?course=${encodeURIComponent(p.courseCode)}` };
}

/** Playlists that hold course sessions (left out of the single-session screens). Pure. */
export function coursePlaylistIds(sessions: { course_code?: string | null; playlist_id?: string | null }[]): Set<string> {
  return new Set(sessions.filter((s) => s.course_code && s.playlist_id).map((s) => s.playlist_id as string));
}
