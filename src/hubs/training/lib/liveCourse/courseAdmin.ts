/**
 * Admin writes for live courses: create, update details and rules, change
 * status. Pure validation (`courseUpdateFromBody`) plus thin database calls,
 * so the verifier runs the rules with no production writes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseCourseCode, type CourseStatus } from './courseSettings';
import { isValidTimeZone } from './timeZones';

const TEXT_FIELDS: Record<string, string> = {
  title: 'title', shortTitle: 'short_title', tagline: 'tagline', description: 'description',
  whoFor: 'who_for', prerequisites: 'prerequisites', trainerName: 'trainer_name', trainerTitle: 'trainer_title',
  bannerAlt: 'banner_alt', cardImageAlt: 'card_image_alt', certificateGradeLabel: 'certificate_grade_label',
};

export interface UpdateResult { ok: boolean; update: Record<string, unknown>; errors: string[] }

/** Body (camelCase) to a column update; every value validated, unknown keys ignored. */
export function courseUpdateFromBody(body: Record<string, unknown>): UpdateResult {
  const update: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [k, col] of Object.entries(TEXT_FIELDS)) {
    if (body[k] === undefined) continue;
    const v = typeof body[k] === 'string' ? (body[k] as string).trim() : '';
    if (k === 'title' && !v) { errors.push('Title is required.'); continue; }
    if (v.length > 5000) { errors.push(`${k} is too long.`); continue; }
    update[col] = v || null;
  }
  if (body.enrolmentOpen !== undefined) update.enrolment_open = body.enrolmentOpen === true;
  if (body.allowMixedRoutes !== undefined) update.allow_mixed_routes = body.allowMixedRoutes === true;
  if (body.sessionDayReminder !== undefined) update.session_day_reminder = body.sessionDayReminder === true;
  if (body.sessionCertificates !== undefined) update.session_certificates = body.sessionCertificates === true;
  const pct = (k: string, col: string) => {
    if (body[k] === undefined) return;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n <= 0 || n > 100) errors.push(`${k} must be between 1 and 100.`);
    else update[col] = Math.round(n * 100) / 100;
  };
  pct('attendanceThresholdPct', 'attendance_threshold_pct');
  pct('recordingCompletePct', 'recording_complete_pct');
  if (body.maxSubmissionAttempts !== undefined) {
    const n = Number(body.maxSubmissionAttempts);
    if (!Number.isInteger(n) || n < 1 || n > 10) errors.push('Attempts must be a whole number from 1 to 10.');
    else update.max_submission_attempts = n;
  }
  if (body.joinOpensMinutesBefore !== undefined) {
    const n = Number(body.joinOpensMinutesBefore);
    if (!Number.isInteger(n) || n < 0 || n > 240) errors.push('Join opens must be 0 to 240 minutes before.');
    else update.join_opens_minutes_before = n;
  }
  if (body.certRoutes !== undefined) {
    const r = Array.isArray(body.certRoutes) ? (body.certRoutes as unknown[]).filter((x) => x === 'live' || x === 'recording') : [];
    if (!r.length) errors.push('Choose at least one certification route.');
    else update.cert_routes = [...new Set(r)];
  }
  if (body.timeZones !== undefined) {
    if (body.timeZones === null) update.time_zones = null;
    else if (Array.isArray(body.timeZones)) {
      const z = (body.timeZones as unknown[]).filter((x): x is string => typeof x === 'string');
      const bad = z.filter((x) => !isValidTimeZone(x));
      if (bad.length) errors.push(`Unknown time zone: ${bad.join(', ')}`);
      else update.time_zones = z.length ? [...new Set(z)] : null;
    }
  }
  return { ok: errors.length === 0, update, errors };
}

/** The columns a status change writes. */
export function statusUpdate(status: CourseStatus, now: Date = new Date()): Record<string, unknown> {
  const u: Record<string, unknown> = { status, is_public: status === 'published' };
  if (status === 'published') u.published_at = now.toISOString();
  if (status === 'archived') u.archived_at = now.toISOString();
  return u;
}

export function isCourseStatus(v: unknown): v is CourseStatus {
  return v === 'draft' || v === 'published' || v === 'archived';
}

export async function createCourse(
  sb: SupabaseClient,
  p: { courseCode: string; title: string },
): Promise<{ ok: boolean; error?: string; courseCode?: string }> {
  const code = normaliseCourseCode(p.courseCode);
  if (!code) return { ok: false, error: 'The course code must be 2 to 12 letters or digits (e.g. REFM2).' };
  if (code === '3SFM' || code === 'BVM') return { ok: false, error: 'That code belongs to an exam course.' };
  if (!p.title?.trim()) return { ok: false, error: 'A title is required.' };
  const { error } = await sb.from('training_course_settings').insert({
    course_code: code, title: p.title.trim(), short_title: code, exams_enabled: false,
    status: 'draft', is_public: false, is_active: true,
  });
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'A course with that code already exists.' : error.message };
  return { ok: true, courseCode: code };
}
