/**
 * Model-submission status reader (migration 148).
 *
 * Pure read. Used by:
 *   - certificateEngine.issueCertificateForPending (server-side cert gate)
 *   - /api/training/submit-assessment (final-exam score gate)
 *   - dashboard UI via /api/training/model-submission?courseCode= (Phase C)
 *
 * Design choices:
 *   - Per-course flags. 3SFM and BVM are independent; flipping one ON does
 *     not affect the other. Mirrors how watch_enforcement_bypass_<TABKEY>
 *     scopes per-session.
 *   - `announcementOnly` is surfaced even when `required=false` so the
 *     dashboard can render the soft-launch banner without a second round-trip.
 *   - The "approved" answer is sticky: once a student has an approved row
 *     for a course, subsequent rejected re-submissions don't revoke access.
 *     This matches the human-review intent (admin already saw the work).
 *     If the admin needs to revoke they delete the approved row by hand.
 *
 * Returns { required: false } early when the gate isn't on for this course.
 * Cert engine + submit-assessment treat that as "no gate, allow".
 */

import { getServerClient } from '@/src/core/db/supabase';
import type {
  ModelSubmissionRow,
  ModelSubmissionStatusResult,
  ModelSubmissionStatus,
} from '@/src/hubs/training/lib/modelSubmission/types';

type CourseCode = '3SFM' | 'BVM';

function normalizeCourseCode(input: string): CourseCode | null {
  const upper = input.trim().toUpperCase();
  return upper === '3SFM' || upper === 'BVM' ? (upper as CourseCode) : null;
}

async function readSettings(keys: string[]): Promise<Record<string, string>> {
  const sb = getServerClient();
  const { data } = await sb
    .from('training_settings')
    .select('key, value')
    .in('key', keys);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) out[r.key] = r.value;
  return out;
}

/**
 * Resolve the model-submission gate state for a single (student, course).
 *
 * Cheap: one settings query (3 keys) + one model_submissions query
 * (filtered by partial index `idx_model_submissions_email_course`).
 * Safe to call on every dashboard render once the gate is on.
 */
export async function getModelSubmissionStatus(
  email: string,
  courseCode: string,
): Promise<ModelSubmissionStatusResult> {
  const code = normalizeCourseCode(courseCode);
  const cleanEmail = email.trim().toLowerCase();

  // Default closed-loop response when the course code is unknown. The
  // cert engine + submit-assessment treat `required=false` as
  // "no gate" so an unknown course never blocks issuance.
  const baseDefaults: ModelSubmissionStatusResult = {
    required: false,
    announcementOnly: false,
    hasApproved: false,
    latestStatus: 'none',
    attemptsUsed: 0,
    attemptsRemaining: 3,
    maxAttempts: 3,
    latest: null,
    guidance: '',
    sampleUrl: null,
  };
  if (!code) return baseDefaults;

  const settings = await readSettings([
    `model_submission_required_${code.toLowerCase()}`,
    'model_submission_max_attempts',
    'model_submission_announcement_only',
    `model_submission_guidance_${code.toLowerCase()}`,
    `model_submission_sample_url_${code.toLowerCase()}`,
  ]);
  const required = settings[`model_submission_required_${code.toLowerCase()}`] === 'true';
  const announcementOnly = settings.model_submission_announcement_only !== 'false';
  const maxAttempts = Math.max(
    1,
    Math.min(10, parseInt(settings.model_submission_max_attempts ?? '3', 10) || 3),
  );
  const guidance = (settings[`model_submission_guidance_${code.toLowerCase()}`] ?? '').trim();
  const rawSampleUrl = (settings[`model_submission_sample_url_${code.toLowerCase()}`] ?? '').trim();
  // Sanity-check the URL: only http(s) schemes allowed, otherwise null. The
  // student card renders this as a clickable anchor so a `javascript:` or
  // similar opaque scheme is a real XSS hazard.
  const sampleUrl = /^https?:\/\//i.test(rawSampleUrl) ? rawSampleUrl : null;

  const sb = getServerClient();
  // Postgres ilike on `LOWER(email)`-indexed column. Matches the index
  // `idx_model_submissions_email_course` so this stays cheap.
  const { data: rows } = await sb
    .from('model_submissions')
    .select('*')
    .ilike('email', cleanEmail)
    .eq('course_code', code)
    .order('submitted_at', { ascending: false });

  const all = (rows ?? []) as ModelSubmissionRow[];
  const attemptsUsed = all.length;
  const latest = all[0] ?? null;
  const hasApproved = all.some(r => r.status === 'approved');
  const latestStatus: ModelSubmissionStatus | 'none' = latest ? latest.status : 'none';
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);

  return {
    required,
    announcementOnly,
    hasApproved,
    latestStatus,
    attemptsUsed,
    attemptsRemaining,
    maxAttempts,
    latest,
    guidance,
    sampleUrl,
  };
}
