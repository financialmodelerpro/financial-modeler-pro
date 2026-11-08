/**
 * THE eligibility rule for a live course, per student. Pure core plus a loader.
 *
 * Founder rules (2026-11-08):
 *   - Live route: at least the threshold (75%) of EVERY session, attended live.
 *   - Recording route: EVERY session's recording watched in full (the
 *     course's recording_complete_pct, 95%, of the video, counted on the server
 *     from skip-resistant watch seconds, never the client's 'completed' flag).
 *   - Mixed (allow_mixed_routes, default on): each session met live OR by its
 *     recording, so a live student who misses one session can complete it
 *     through that session's recording.
 *   - Model submission unlocks only when one route is complete. A session not
 *     yet held is not met, so nothing unlocks before the last session.
 * The student page, the admin progress view, the submission gate and the
 * certificate all call this; none of them restates the rule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveCourseSettings, CourseSession } from './courseSettings';
import { getLiveCourseSettings, isLiveCourseRow, listCourseSessions } from './courseSettings';
import { mergeIntervals, totalSeconds, attendedPct, type Interval } from './attendance';
import { effectiveSessionType } from './joinWindow';

export type SessionVia = 'live' | 'recording' | null;
export type RouteCompleted = 'live' | 'recording' | 'mixed' | null;

export interface SessionEligibility {
  sessionId: string;
  no: number | null;
  title: string;
  held: boolean;
  livePct: number;
  liveMet: boolean;
  hasRecording: boolean;
  recordingPct: number;
  recordingMet: boolean;
  met: boolean;
  via: SessionVia;
}

export interface Eligibility {
  courseCode: string;
  sessions: SessionEligibility[];
  sessionsMet: number;
  liveComplete: boolean;
  recordingComplete: boolean;
  routeCompleted: RouteCompleted;
  submissionUnlocked: boolean;
}

/** A student's attendance rows for one session (one per Teams identity). */
export interface AttendanceInput { intervals: [string, string][]; attended_pct: number; session_seconds: number; source: string }
/** A student's recording progress for one session. */
export interface WatchInput { watch_seconds: number | null; total_seconds: number | null; watch_percentage: number | null }

/**
 * Live share from every row matched to the student: intervals merged across
 * rows (two identities at once count once), and a hand-entered figure taken
 * as stated. The larger of the two stands.
 */
export function liveShare(rows: AttendanceInput[]): number {
  if (!rows.length) return 0;
  const iv: Interval[] = [];
  let denom = 0;
  let manual = 0;
  for (const r of rows) {
    denom = Math.max(denom, r.session_seconds || 0);
    if (r.source === 'manual') manual = Math.max(manual, Number(r.attended_pct) || 0);
    for (const [a, b] of r.intervals ?? []) iv.push([new Date(a).getTime(), new Date(b).getTime()]);
  }
  const merged = iv.length ? attendedPct(totalSeconds(mergeIntervals(iv)), denom) : 0;
  // A row with no intervals (a duration-only source) keeps its own share.
  const noInterval = rows.filter((r) => r.source !== 'manual' && !(r.intervals?.length)).reduce((m, r) => Math.max(m, Number(r.attended_pct) || 0), 0);
  return Math.max(merged, manual, noInterval);
}

/** Recording share from the server's merged watch seconds; the flag alone never counts. */
export function recordingShare(w: WatchInput | undefined): number {
  if (!w) return 0;
  const ws = Number(w.watch_seconds ?? 0), ts = Number(w.total_seconds ?? 0);
  if (ts > 0) return Math.min(100, Math.round((ws / ts) * 10000) / 100);
  return Math.min(100, Number(w.watch_percentage ?? 0) || 0);
}

export function computeEligibility(
  course: LiveCourseSettings,
  sessions: Pick<CourseSession, 'id' | 'course_session_no' | 'title' | 'scheduled_datetime' | 'duration_minutes' | 'session_type' | 'youtube_url'>[],
  attendanceBySession: Map<string, AttendanceInput[]>,
  watchBySession: Map<string, WatchInput>,
  now: number = Date.now(),
): Eligibility {
  const liveOn = course.certRoutes.includes('live');
  const recOn = course.certRoutes.includes('recording');
  const rows: SessionEligibility[] = sessions.map((s) => {
    const held = effectiveSessionType(s, now) === 'recorded';
    const livePct = liveShare(attendanceBySession.get(s.id) ?? []);
    const hasRecording = !!(s.youtube_url && s.youtube_url.trim());
    const recordingPct = hasRecording ? recordingShare(watchBySession.get(s.id)) : 0;
    const liveMet = liveOn && livePct >= course.attendanceThresholdPct;
    const recordingMet = recOn && hasRecording && recordingPct >= course.recordingCompletePct;
    return {
      sessionId: s.id, no: s.course_session_no ?? null, title: s.title, held,
      livePct, liveMet, hasRecording, recordingPct, recordingMet,
      met: liveMet || recordingMet,
      via: liveMet ? 'live' : recordingMet ? 'recording' : null,
    };
  });
  const any = rows.length > 0;
  const liveComplete = any && liveOn && rows.every((r) => r.liveMet);
  const recordingComplete = any && recOn && rows.every((r) => r.recordingMet);
  const mixedComplete = any && course.allowMixedRoutes && rows.every((r) => r.met);
  const routeCompleted: RouteCompleted = liveComplete ? 'live' : recordingComplete ? 'recording' : mixedComplete ? 'mixed' : null;
  return {
    courseCode: course.courseCode,
    sessions: rows,
    sessionsMet: rows.filter((r) => (course.allowMixedRoutes ? r.met : r.liveMet || r.recordingMet)).length,
    liveComplete,
    recordingComplete,
    routeCompleted,
    submissionUnlocked: routeCompleted !== null,
  };
}

/** Load and compute for one student. Null when the course is not a live course. */
export async function loadStudentEligibility(
  sb: SupabaseClient,
  email: string,
  courseCode: string,
  now: number = Date.now(),
): Promise<Eligibility | null> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course)) return null;
  const sessions = await listCourseSessions(sb, course.courseCode);
  const lower = email.trim().toLowerCase();
  // Watch rows may hold the email as the student typed it; ask for both forms.
  const map = await loadProgressMaps(sb, sessions.map((s) => s.id), [...new Set([lower, email.trim()])]);
  return computeEligibility(course, sessions, map.attendance.get(lower) ?? new Map(), map.watch.get(lower) ?? new Map(), now);
}

/** Attendance and watch rows for many students and sessions, keyed by student email. */
export async function loadProgressMaps(
  sb: SupabaseClient,
  sessionIds: string[],
  emails: string[] | null,
): Promise<{ attendance: Map<string, Map<string, AttendanceInput[]>>; watch: Map<string, Map<string, WatchInput>> }> {
  const attendance = new Map<string, Map<string, AttendanceInput[]>>();
  const watch = new Map<string, Map<string, WatchInput>>();
  if (!sessionIds.length) return { attendance, watch };
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('live_session_attendance').select('session_id, student_email, intervals, attended_pct, session_seconds, source').in('session_id', sessionIds).not('student_email', 'is', null);
    if (emails) q = q.in('student_email', emails);
    const { data } = await q.order('id').range(from, from + PAGE - 1);
    for (const r of data ?? []) {
      const e = String(r.student_email).toLowerCase();
      const m = attendance.get(e) ?? new Map<string, AttendanceInput[]>();
      m.set(r.session_id as string, [...(m.get(r.session_id as string) ?? []), r as unknown as AttendanceInput]);
      attendance.set(e, m);
    }
    if (!data || data.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('session_watch_history').select('session_id, student_email, watch_seconds, total_seconds, watch_percentage').in('session_id', sessionIds);
    if (emails) q = q.in('student_email', emails);
    const { data } = await q.order('id').range(from, from + PAGE - 1);
    for (const r of data ?? []) {
      const e = String(r.student_email).toLowerCase();
      const m = watch.get(e) ?? new Map<string, WatchInput>();
      // Two rows for one student (mixed-case email) keep the further one.
      const prev = m.get(r.session_id as string);
      if (!prev || Number(r.watch_seconds ?? 0) > Number(prev.watch_seconds ?? 0)) m.set(r.session_id as string, r as unknown as WatchInput);
      watch.set(e, m);
    }
    if (!data || data.length < PAGE) break;
  }
  return { attendance, watch };
}
