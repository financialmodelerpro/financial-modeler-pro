/**
 * Model-submission status reader (migration 148; any course and resets since 248).
 *
 * Pure read. Used by:
 *   - certificateEngine.issueCertificateForPending (server-side cert gate)
 *   - /api/training/submit-assessment (final-exam score gate)
 *   - dashboard UI and the live-course page via /api/training/model-submission
 *   - the admin review route (attempts left, for the rejection email)
 *
 * Design choices:
 *   - Exam courses (3SFM, BVM): per-course flags in training_settings, exactly
 *     as before. A live course (training_course_settings, no exam) takes its
 *     rules from its own row: approval always required, its own attempt cap,
 *     and uploads gated on eligibility (attendance or recordings).
 *   - Only ACTIVE rows count. A row an admin reset superseded (mig 248) is
 *     history: it is neither an attempt nor an approval.
 *   - The "approved" answer is sticky among active rows: once a student has an
 *     approved row, later rejections don't revoke access.
 *   - `locked` is explicit: every attempt used, none approved.
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
import { getLiveCourseSettings, isLiveCourseRow, normaliseCourseCode } from '@/src/hubs/training/lib/liveCourse/courseSettings';

const EXAM_COURSES = new Set(['3SFM', 'BVM']);

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

/** Attempts and approval from a student's rows. Pure; superseded rows ignored. */
export function submissionState(rows: Pick<ModelSubmissionRow, 'status' | 'submitted_at' | 'superseded_at'>[], maxAttempts: number) {
  const active = rows
    .filter((r) => !r.superseded_at)
    .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  const attemptsUsed = active.length;
  const hasApproved = active.some((r) => r.status === 'approved');
  // `active` can be empty; the cast stops TypeScript assuming index 0 exists.
  const latestStatus = (active[0]?.status ?? 'none') as ModelSubmissionStatus | 'none';
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
  return {
    active,
    attemptsUsed,
    hasApproved,
    latestStatus,
    attemptsRemaining,
    locked: !hasApproved && attemptsUsed >= maxAttempts && latestStatus !== 'pending_review',
  };
}

/**
 * Resolve the model-submission gate state for a single (student, course).
 */
export async function getModelSubmissionStatus(
  email: string,
  courseCode: string,
): Promise<ModelSubmissionStatusResult> {
  const code = normaliseCourseCode(courseCode);
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
    locked: false,
    liveCourse: false,
    eligibleToSubmit: null,
  };
  if (!code) return baseDefaults;

  const sb = getServerClient();
  const live = EXAM_COURSES.has(code) ? null : await getLiveCourseSettings(sb, code);
  const liveCourse = isLiveCourseRow(live);
  if (!EXAM_COURSES.has(code) && !liveCourse) return baseDefaults;

  const lc = code.toLowerCase();
  const settings = await readSettings([
    `model_submission_required_${lc}`,
    'model_submission_max_attempts',
    'model_submission_announcement_only',
    `model_submission_guidance_${lc}`,
    `model_submission_sample_url_${lc}`,
  ]);
  const required = liveCourse
    ? live!.modelApprovalRequired
    : settings[`model_submission_required_${lc}`] === 'true';
  const announcementOnly = liveCourse ? false : settings.model_submission_announcement_only !== 'false';
  const maxAttempts = liveCourse
    ? live!.maxSubmissionAttempts
    : Math.max(1, Math.min(10, parseInt(settings.model_submission_max_attempts ?? '3', 10) || 3));
  const guidance = (settings[`model_submission_guidance_${lc}`] ?? '').trim();
  const rawSampleUrl = (settings[`model_submission_sample_url_${lc}`] ?? '').trim();
  // Sanity-check the URL: only http(s) schemes allowed, otherwise null. The
  // student card renders this as a clickable anchor so a `javascript:` or
  // similar opaque scheme is a real XSS hazard.
  const sampleUrl = /^https?:\/\//i.test(rawSampleUrl) ? rawSampleUrl : null;

  // Postgres ilike on `LOWER(email)`-indexed column. Matches the index
  // `idx_model_submissions_email_course` so this stays cheap.
  const { data: rows } = await sb
    .from('model_submissions')
    .select('*')
    .ilike('email', cleanEmail)
    .eq('course_code', code)
    .order('submitted_at', { ascending: false });

  const st = submissionState((rows ?? []) as ModelSubmissionRow[], maxAttempts);

  let eligibleToSubmit: boolean | null = null;
  if (liveCourse) {
    const { loadStudentEligibility } = await import('@/src/hubs/training/lib/liveCourse/eligibility');
    eligibleToSubmit = (await loadStudentEligibility(sb, cleanEmail, code))?.submissionUnlocked ?? false;
  }

  return {
    required,
    announcementOnly,
    hasApproved: st.hasApproved,
    latestStatus: st.latestStatus,
    attemptsUsed: st.attemptsUsed,
    attemptsRemaining: st.attemptsRemaining,
    maxAttempts,
    latest: (st.active[0] as ModelSubmissionRow | undefined) ?? null,
    guidance,
    sampleUrl,
    locked: st.locked,
    liveCourse,
    eligibleToSubmit,
  };
}
