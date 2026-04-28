/**
 * Types for the model-submission gate (migration 148).
 *
 * Shipped as part of Phase A. Code that consumes these types is gated by
 * the per-course `model_submission_required_<course>` setting in
 * `training_settings` (default 'false'), so the gate is dormant at ship.
 */

export type ModelSubmissionStatus = 'pending_review' | 'approved' | 'rejected';

export interface ModelSubmissionRow {
  id: string;
  email: string;
  course_code: '3SFM' | 'BVM';
  attempt_number: 1 | 2 | 3;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  student_notes: string | null;
  status: ModelSubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_admin: string | null;
  review_note: string | null;
}

/**
 * Aggregate the student's model-submission state for a given course. The
 * shape this returns is the canonical input to:
 *   - cert engine: gates issueCertificateForPending
 *   - submit-assessment route: gates final-exam score recording
 *   - dashboard UI: drives the ModelSubmissionCard state machine
 */
export interface ModelSubmissionStatusResult {
  /** Per-course required flag (training_settings.model_submission_required_<course>). */
  required: boolean;
  /** Soft-launch banner mode (training_settings.model_submission_announcement_only). */
  announcementOnly: boolean;
  /** True iff the most-recent attempt is status='approved'. */
  hasApproved: boolean;
  /** 'none' when the student hasn't uploaded for this course yet. */
  latestStatus: ModelSubmissionStatus | 'none';
  /** Number of submissions on record (1, 2, 3). */
  attemptsUsed: number;
  /** max_attempts (3) minus attemptsUsed, floored at 0. */
  attemptsRemaining: number;
  /** Hard cap from training_settings.model_submission_max_attempts. */
  maxAttempts: number;
  /** Latest submission row (most-recent submitted_at), if any. */
  latest: ModelSubmissionRow | null;
}
