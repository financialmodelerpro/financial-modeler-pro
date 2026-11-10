/**
 * Live-course recordings (2026-11-10, founder): who may open which recording,
 * where a course session is listed, and the student's course progress. Pure
 * rules first; the loader at the bottom is the ONE server check, used by the
 * session API (the player), the watch-progress route and the materials route.
 *
 * UNLOCK, per student, per session:
 *   - the student met the live threshold for THAT session (attended live), or
 *   - every earlier session of the course is complete (attended live at the
 *     threshold, or its recording watched in full);
 *   - otherwise locked: "Complete Session X to unlock" (X = the first earlier
 *     session not complete).
 * So a recording-only student goes in order, and a live attendee opens the
 * recording of any session they qualified for as soon as it is available.
 *
 * Course recording LINKS never travel in a list or a page: every surface but
 * the checked session API gets a marker instead (`withoutCourseRecordingLink`),
 * so a locked recording cannot be fetched from somewhere else.
 *
 * Single sessions (no course_code) are untouched by all of this.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveSessionType } from './joinWindow';
import { loadStudentEligibility, type Eligibility, type SessionEligibility } from './eligibility';
import { studentHasSessionAccess, type SessionForAccess } from './sessionAccess';

export { RECORDING_MARKER, withoutCourseRecordingLink } from './recordingLink';

export interface RecordingUnlock { unlocked: boolean; blockedBy: number | null; message: string | null }

type UnlockInput = Pick<SessionEligibility, 'sessionId' | 'no' | 'liveMet' | 'met'>;

/** THE unlock rule. Pure. */
export function recordingUnlock(sessions: UnlockInput[], sessionId: string): RecordingUnlock {
  const ordered = [...sessions].sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9));
  const i = ordered.findIndex((s) => s.sessionId === sessionId);
  if (i < 0) return { unlocked: false, blockedBy: null, message: 'This recording is not part of your course.' };
  if (ordered[i].liveMet) return { unlocked: true, blockedBy: null, message: null };
  const gap = ordered.slice(0, i).find((s) => !s.met);
  if (!gap) return { unlocked: true, blockedBy: null, message: null };
  const no = gap.no ?? i;
  return { unlocked: false, blockedBy: no, message: `Complete Session ${no} to unlock` };
}

/** Every session's unlock, keyed by session id (the course page and the session page). */
export function unlockMap(e: Eligibility): Map<string, RecordingUnlock> {
  return new Map(e.sessions.map((s) => [s.sessionId, recordingUnlock(e.sessions, s.sessionId)]));
}

/**
 * Listed under Live Sessions (quick joining): a single session always
 * (unchanged); a COURSE session only while upcoming or live with no recording
 * yet. Every course session is listed in its course (My Courses) from the
 * start, and its recording appears on it there once uploaded (2026-11-10).
 */
export function showInLiveSessions(
  row: { course_code?: string | null; youtube_url?: string | null; session_type?: string | null; scheduled_datetime?: string | null; duration_minutes?: number | null },
  now: number = Date.now(),
): boolean {
  if (!row.course_code) return true;
  if (row.youtube_url && String(row.youtube_url).trim()) return false;
  const eff = effectiveSessionType({ session_type: row.session_type ?? 'upcoming', scheduled_datetime: row.scheduled_datetime ?? undefined, duration_minutes: row.duration_minutes ?? null } as Parameters<typeof effectiveSessionType>[0], now);
  return eff !== 'recorded';
}

/** "3/8": sessions complete (live at the threshold, or recording watched in full) over the course's sessions. */
export function courseProgress(e: Eligibility): { completed: number; total: number } {
  return { completed: e.sessions.filter((s) => s.met).length, total: e.sessions.length };
}

/**
 * THE server check for one course session's recording and materials: the
 * student must have access to the course (enrolled) and the unlock rule must
 * pass. A single session returns unlocked (its own rules apply elsewhere).
 */
export async function loadRecordingUnlock(
  sb: SupabaseClient,
  student: { email: string; registrationId?: string | null } | null,
  session: SessionForAccess & { course_code?: string | null },
): Promise<RecordingUnlock> {
  if (!session.course_code) return { unlocked: true, blockedBy: null, message: null };
  if (!student) return { unlocked: false, blockedBy: null, message: 'Sign in and enrol in the course to watch its recordings.' };
  if (!await studentHasSessionAccess(sb, student, session)) return { unlocked: false, blockedBy: null, message: 'Enrol in the course to watch its recordings.' };
  const e = await loadStudentEligibility(sb, student.email, session.course_code);
  if (!e) return { unlocked: false, blockedBy: null, message: 'Course not found.' };
  return recordingUnlock(e.sessions, session.id);
}
