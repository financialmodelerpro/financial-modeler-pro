/**
 * Live-course rules (mig 247, `training_course_settings`; status, details,
 * images and time zones since mig 249).
 *
 * A course with a row here is certified by live attendance or recordings plus
 * an approved model. A course with NO row (3SFM, BVM) is an exam course and
 * every caller must leave it on its existing path: `isLiveCourseRow(null)` is
 * the one test for that, so an exam course can never pick up a live-course
 * rule by accident.
 *
 * STATUS is the one visibility rule (mig 249, replacing is_public):
 *   draft      hidden publicly, registration closed, admin preview only
 *   published  public card and course page; Register follows enrolmentOpen
 *   archived   hidden publicly
 * Enrolled students keep access to their course in EVERY status.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type CertRoute = 'live' | 'recording';
export type CourseStatus = 'draft' | 'published' | 'archived';

export interface LiveCourseSettings {
  courseCode: string;
  title: string;
  shortTitle: string;
  description: string;
  isActive: boolean;
  status: CourseStatus;
  enrolmentOpen: boolean;
  tagline: string;
  whoFor: string;
  prerequisites: string;
  trainerName: string;
  trainerTitle: string;
  bannerUrl: string | null;
  bannerAlt: string;
  cardImageUrl: string | null;
  cardImageAlt: string;
  /** IANA zones for the time zone table; null = DEFAULT_TIME_ZONES. */
  timeZones: string[] | null;
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
  /** Per-session completion cards on or off (mig 249; absent = on). */
  sessionCertificates: boolean;
  /** Ordered instructors(id) shown on the course page (mig 250; absent = none). */
  instructorIds: string[];
}

/**
 * Reads use `*` so a column added by a later migration is picked up and a
 * column not yet applied is simply absent (settingsFromRow defaults it). A
 * named list would fail the whole read while a migration is pending.
 */
export const COURSE_SETTINGS_COLUMNS = '*';

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
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The status a row states, or (before mig 249) what its old is_public flag meant. */
export function statusOf(row: Record<string, unknown>): CourseStatus {
  if (row.status === 'draft' || row.status === 'published' || row.status === 'archived') return row.status;
  return row.is_public === true ? 'published' : 'draft';
}

/** Row to settings. Absent values fall back to the migration's defaults. */
export function settingsFromRow(row: Record<string, unknown>): LiveCourseSettings {
  const routes = Array.isArray(row.cert_routes)
    ? (row.cert_routes as unknown[]).filter((r): r is CertRoute => r === 'live' || r === 'recording')
    : [];
  const code = normaliseCourseCode(row.course_code) ?? String(row.course_code ?? '');
  const zones = Array.isArray(row.time_zones)
    ? (row.time_zones as unknown[]).filter((z): z is string => typeof z === 'string' && z.length > 0)
    : null;
  return {
    courseCode:             code,
    title:                  String(row.title ?? code),
    shortTitle:             String(row.short_title ?? code),
    description:            String(row.description ?? ''),
    isActive:               row.is_active !== false,
    status:                 statusOf(row),
    enrolmentOpen:          row.enrolment_open !== false,
    tagline:                str(row.tagline),
    whoFor:                 str(row.who_for),
    prerequisites:          str(row.prerequisites),
    trainerName:            str(row.trainer_name),
    trainerTitle:           str(row.trainer_title),
    bannerUrl:              str(row.banner_url) || null,
    bannerAlt:              str(row.banner_alt),
    cardImageUrl:           str(row.card_image_url) || null,
    cardImageAlt:           str(row.card_image_alt),
    timeZones:              zones && zones.length ? zones : null,
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
    sessionCertificates:    row.session_certificates !== false,
    instructorIds:          Array.isArray(row.instructor_ids) ? (row.instructor_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  };
}

/** The one test for "this course runs on live-course rules". */
export function isLiveCourseRow(s: LiveCourseSettings | null | undefined): s is LiveCourseSettings {
  return !!s && s.examsEnabled === false;
}

/** Shown on public surfaces (page, APIs, sitemap, newsletter). */
export function isPubliclyVisible(s: LiveCourseSettings | null | undefined): boolean {
  return isLiveCourseRow(s) && s.isActive && s.status === 'published';
}

/** A NEW student may register or enrol. */
export function canRegister(s: LiveCourseSettings | null | undefined): boolean {
  return isPubliclyVisible(s) && !!s && s.enrolmentOpen;
}

/** May this student open the course? Enrolled: always. Otherwise only when public. */
export function studentCanOpen(s: LiveCourseSettings | null | undefined, enrolled: boolean): boolean {
  return isLiveCourseRow(s) && (enrolled || isPubliclyVisible(s));
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

/**
 * Live courses. `publicOnly`: published ones only (the status rule, applied in
 * code so it holds before and after mig 249). `includeInactive`: admin lists.
 */
export async function listLiveCourses(
  sb: SupabaseClient,
  opts: { publicOnly?: boolean; includeInactive?: boolean } = {},
): Promise<LiveCourseSettings[]> {
  let q = sb.from('training_course_settings').select(COURSE_SETTINGS_COLUMNS);
  if (!opts.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q.order('course_code');
  if (error) {
    console.warn('[liveCourse] list failed', { error: error.message });
    return [];
  }
  const all = (data ?? []).map((r) => settingsFromRow(r as Record<string, unknown>)).filter(isLiveCourseRow);
  return opts.publicOnly ? all.filter(isPubliclyVisible) : all;
}

/**
 * Public columns of a course's sessions, ordered by session number. NAMED,
 * never `*`: these rows reach the public course page, and `*` would carry the
 * meeting link. The content and reschedule columns come from mig 251; until it
 * is applied the read falls back to the base list.
 */
const COURSE_SESSION_BASE_COLUMNS =
  'id, title, description, session_type, scheduled_datetime, timezone, duration_minutes, youtube_url, youtube_embed, banner_url, instructor_name, course_code, course_session_no, is_published, actual_start_at, actual_end_at';
export const COURSE_SESSION_COLUMNS =
  `${COURSE_SESSION_BASE_COLUMNS}, content_overview, content_learn, content_outcome, content_claude, rescheduled_from, rescheduled_at, ics_sequence`;

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
  /** Session content (mig 251). */
  content_overview?: string | null;
  content_learn?: string[] | null;
  content_outcome?: string | null;
  content_claude?: string | null;
  /** The start before the latest reschedule, and when it moved (mig 251). */
  rescheduled_from?: string | null;
  rescheduled_at?: string | null;
  /** Bumped on every move; the calendar SEQUENCE (mig 251). */
  ics_sequence?: number | null;
}

export async function listCourseSessions(
  sb: SupabaseClient,
  courseCode: string,
  opts: { publishedOnly?: boolean } = { publishedOnly: true },
): Promise<CourseSession[]> {
  const code = normaliseCourseCode(courseCode);
  if (!code) return [];
  const run = (cols: string) => {
    let q = sb.from('live_sessions').select(cols).eq('course_code', code);
    if (opts.publishedOnly !== false) q = q.eq('is_published', true);
    return q.order('course_session_no', { ascending: true, nullsFirst: false }).order('scheduled_datetime', { ascending: true });
  };
  let { data, error } = await run(COURSE_SESSION_COLUMNS);
  // Schema tolerance: before mig 251 the content columns do not exist.
  if (error && /does not exist|schema cache/i.test(error.message)) ({ data, error } = await run(COURSE_SESSION_BASE_COLUMNS));
  if (error) {
    console.warn('[liveCourse] sessions read failed', { code, error: error.message });
    return [];
  }
  return (data ?? []) as unknown as CourseSession[];
}
