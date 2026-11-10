/**
 * Live course navigation rules (2026-11-08): the sidebar's status per
 * session, previous / next, and the session page's main button. One file,
 * shared by the sidebar, the overview's sessions table, the session page and
 * the verifier. Pure.
 */
import { effectiveSessionType } from './joinWindow';
import { coursePagePath, courseSessionPath } from './paths';

export type NavStatus = 'upcoming' | 'rescheduled' | 'live' | 'recorded' | 'ended';

export interface NavSession {
  id: string;
  title: string;
  course_session_no: number | null;
  scheduled_datetime: string | null;
  duration_minutes?: number | null;
  session_type?: string | null;
  youtube_url?: string | null;
  rescheduled_from?: string | null;
}

export const STATUS_LABEL: Record<NavStatus, string> = {
  upcoming: 'Upcoming',
  rescheduled: 'Rescheduled',
  live: 'Live now',
  recorded: 'Recorded',
  ended: 'Recording coming soon',
};

/** Live now inside the join window; after it, Recorded once a recording exists. */
export function navStatus(s: NavSession, now: number = Date.now()): NavStatus {
  const eff = effectiveSessionType({ session_type: s.session_type ?? 'upcoming', scheduled_datetime: s.scheduled_datetime ?? undefined, duration_minutes: s.duration_minutes ?? null } as Parameters<typeof effectiveSessionType>[0], now);
  if (eff === 'live') return 'live';
  if (eff === 'recorded') return s.youtube_url && s.youtube_url.trim() ? 'recorded' : 'ended';
  return s.rescheduled_from ? 'rescheduled' : 'upcoming';
}

/** Sessions in course order: session number, then date. */
export function orderSessions<T extends NavSession>(sessions: T[]): T[] {
  const t = (s: T) => (s.scheduled_datetime ? new Date(s.scheduled_datetime).getTime() : Number.MAX_SAFE_INTEGER);
  return [...sessions].sort((a, b) => (a.course_session_no ?? 1e9) - (b.course_session_no ?? 1e9) || t(a) - t(b));
}

/** The sessions either side of one, in course order. */
export function prevNext<T extends NavSession>(sessions: T[], id: string): { prev: T | null; next: T | null } {
  const list = orderSessions(sessions);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
}

/** "Session 3" or the title when unnumbered. */
export function sessionLabel(s: Pick<NavSession, 'course_session_no' | 'title'>): string {
  return s.course_session_no != null ? `Session ${s.course_session_no}` : s.title;
}

export type MainActionKind = 'register' | 'enrol' | 'closed' | 'join' | 'watch' | 'recording-soon' | 'locked';
export interface MainAction { kind: MainActionKind; label: string; href: string | null }

/**
 * The session page's main button.
 *   not enrolled: Register free (signed out) / Enrol (signed in) / Enrolment closed
 *   enrolled, before or during the session: Join live (the join button opens in its window)
 *   enrolled, after it: Watch recording, or Recording coming soon; a recording
 *   locked for this student (recordingAccess.ts) reads "Complete Session X to unlock"
 */
export function sessionMainAction(p: {
  courseCode: string; sessionId: string; status: NavStatus;
  enrolled: boolean; signedIn: boolean; canRegister: boolean;
  /** The lock message when the recording is locked for this student. */
  recordingLocked?: string | null;
}): MainAction {
  if (!p.enrolled) {
    if (!p.canRegister) return { kind: 'closed', label: 'Enrolment closed', href: null };
    if (p.signedIn) return { kind: 'enrol', label: 'Enrol', href: `${coursePagePath(p.courseCode)}?enrol=1` };
    return { kind: 'register', label: 'Register free', href: `/register?course=${encodeURIComponent(p.courseCode)}` };
  }
  if (p.status === 'recorded' && p.recordingLocked) return { kind: 'locked', label: p.recordingLocked, href: null };
  if (p.status === 'recorded') return { kind: 'watch', label: 'Watch recording', href: `${courseSessionPath(p.courseCode, p.sessionId)}/watch` };
  if (p.status === 'ended') return { kind: 'recording-soon', label: 'Recording coming soon', href: null };
  return { kind: 'join', label: 'Join live', href: null };
}
