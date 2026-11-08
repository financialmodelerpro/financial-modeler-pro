/**
 * Live-course rules (mig 247, `training_course_settings`).
 *
 * A course with a row here is certified by live attendance or recordings plus
 * an approved model. A course with NO row (3SFM, BVM) is an exam course and
 * every caller must leave it on its existing path: `isLiveCourseRow(null)` is
 * the one test for that, so an exam course can never pick up a live-course
 * rule by accident.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type CertRoute = 'live' | 'recording';

export interface LiveCourseSettings {
  courseCode: string;
  title: string;
  shortTitle: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  examsEnabled: boolean;
  certRoutes: CertRoute[];
  allowMixedRoutes: boolean;
  attendanceThresholdPct: number;
  recordingCompletePct: number;
  modelApprovalRequired: boolean;
  maxSubmissionAttempts: number;
  joinOpensMinutesBefore: number;
  sessionDayReminder: boolean;
  certificateGradeLabel: string;
}

export const COURSE_SETTINGS_COLUMNS =
  'course_code, title, short_title, description, is_active, is_public, exams_enabled, cert_routes, allow_mixed_routes, attendance_threshold_pct, recording_complete_pct, model_approval_required, max_submission_attempts, join_opens_minutes_before, session_day_reminder, certificate_grade_label';

/** Course codes are short upper-case tokens everywhere (3SFM, BVM, REFM). */
export function normaliseCourseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(c) ? c : null;
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Row to settings. Absent values fall back to the migration's defaults. */
export function settingsFromRow(row: Record<string, unknown>): LiveCourseSettings {
  const routes = Array.isArray(row.cert_routes)
    ? (row.cert_routes as unknown[]).filter((r): r is CertRoute => r === 'live' || r === 'recording')
    : [];
  const code = normaliseCourseCode(row.course_code) ?? String(row.course_code ?? '');
  return {
    courseCode:             code,
    title:                  String(row.title ?? code),
    shortTitle:             String(row.short_title ?? code),
    description:            String(row.description ?? ''),
    isActive:               row.is_active !== false,
    isPublic:               row.is_public === true,
    examsEnabled:           row.exams_enabled === true,
    certRoutes:             routes.length ? routes : ['live', 'recording'],
    allowMixedRoutes:       row.allow_mixed_routes !== false,
    attendanceThresholdPct: num(row.attendance_threshold_pct, 75),
    recordingCompletePct:   num(row.recording_complete_pct, 95),
    modelApprovalRequired:  row.model_approval_required !== false,
    maxSubmissionAttempts:  Math.min(10, Math.max(1, Math.round(num(row.max_submission_attempts, 3)))),
    joinOpensMinutesBefore: Math.min(240, Math.max(0, Math.round(num(row.join_opens_minutes_before, 15)))),
    sessionDayReminder:     row.session_day_reminder !== false,
    certificateGradeLabel:  String(row.certificate_grade_label ?? 'Completed'),
  };
}

/** The one test for "this course runs on live-course rules". */
export function isLiveCourseRow(s: LiveCourseSettings | null | undefined): s is LiveCourseSettings {
  return !!s && s.examsEnabled === false;
}

/** Settings for one course, or null for an exam course / unknown code. */
export async function getLiveCourseSettings(
  sb: SupabaseClient,
  courseCode: string,
): Promise<LiveCourseSettings | null> {
  const code = normaliseCourseCode(courseCode);
  if (!code) return null;
  const { data, error } = await sb
    .from('training_course_settings')
    .select(COURSE_SETTINGS_COLUMNS)
    .eq('course_code', code)
    .maybeSingle();
  if (error) {
    // Schema tolerance: a missing table means no live courses, never a crash.
    console.warn('[liveCourse] settings read failed', { code, error: error.message });
    return null;
  }
  return data ? settingsFromRow(data as Record<string, unknown>) : null;
}

/** Every active live course; `publicOnly` limits to the ones offered publicly. */
export async function listLiveCourses(
  sb: SupabaseClient,
  opts: { publicOnly?: boolean } = {},
): Promise<LiveCourseSettings[]> {
  let q = sb.from('training_course_settings').select(COURSE_SETTINGS_COLUMNS).eq('is_active', true);
  if (opts.publicOnly) q = q.eq('is_public', true);
  const { data, error } = await q.order('course_code');
  if (error) {
    console.warn('[liveCourse] list failed', { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => settingsFromRow(r as Record<string, unknown>)).filter(isLiveCourseRow);
}

/** Public columns of a course's sessions, ordered by session number. */
export const COURSE_SESSION_COLUMNS =
  'id, title, description, session_type, scheduled_datetime, timezone, duration_minutes, youtube_url, youtube_embed, banner_url, instructor_name, course_code, course_session_no, is_published, actual_start_at, actual_end_at';

export interface CourseSession {
  id: string;
  title: string;
  description: string | null;
  session_type: 'upcoming' | 'live' | 'recorded';
  scheduled_datetime: string | null;
  timezone: string | null;
  duration_minutes: number | null;
  youtube_url: string | null;
  youtube_embed: boolean | null;
  banner_url: string | null;
  instructor_name: string | null;
  course_code: string;
  course_session_no: number | null;
  is_published: boolean;
  actual_start_at: string | null;
  actual_end_at: string | null;
}

export async function listCourseSessions(
  sb: SupabaseClient,
  courseCode: string,
  opts: { publishedOnly?: boolean } = { publishedOnly: true },
): Promise<CourseSession[]> {
  const code = normaliseCourseCode(courseCode);
  if (!code) return [];
  let q = sb.from('live_sessions').select(COURSE_SESSION_COLUMNS).eq('course_code', code);
  if (opts.publishedOnly !== false) q = q.eq('is_published', true);
  const { data, error } = await q
    .order('course_session_no', { ascending: true, nullsFirst: false })
    .order('scheduled_datetime', { ascending: true });
  if (error) {
    console.warn('[liveCourse] sessions read failed', { code, error: error.message });
    return [];
  }
  return (data ?? []) as CourseSession[];
}
