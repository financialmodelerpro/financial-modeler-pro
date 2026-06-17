/**
 * Exam-gate predicates for the model-submission flow.
 *
 * Single source of truth for the two decisions that changed when the gate was
 * corrected (subject: model submission unlocks exam, approval gates result):
 *
 *   - examUnlockedBySubmission: EXAM ACCESS is gated only by "has the candidate
 *     submitted a model" (any status), NOT by approval. A submitted model
 *     (pending / rejected / approved) unlocks the final exam immediately. When
 *     the per-course gate is not required, the exam is always open.
 *
 *   - resultWithheldUntilApproval: the exam RESULT (and certificate) is withheld
 *     from the candidate until an admin approves the model. This is only
 *     meaningful once a model has been submitted (otherwise the exam is locked).
 *
 * Both the server recording gate (/api/training/submit-assessment) and the
 * dashboard UI (CourseContent) read these so the two surfaces never diverge.
 * Tested by scripts/verify-training-exam-gate.ts across the full status matrix.
 *
 * NOTE: the Google Apps Script `getQuestions` action enforces its OWN
 * model-submission gate when serving final-exam questions (the Next layer only
 * forwards `isFinal`). For pending students to load the exam end-to-end, that
 * external gate must also key off "submitted" rather than "approved"; it cannot
 * be changed from this repository.
 */
import type { ModelSubmissionStatusResult } from './types';

type GateAccessInput = Pick<ModelSubmissionStatusResult, 'required' | 'latestStatus'>;
type GateResultInput = Pick<ModelSubmissionStatusResult, 'required' | 'hasApproved'>;

/** True when the candidate may take the final exam: the gate is not required,
 *  OR a model has been submitted (any status). */
export function examUnlockedBySubmission(status: GateAccessInput | null | undefined): boolean {
  if (!status || status.required !== true) return true;
  return status.latestStatus !== 'none';
}

/** Inverse helper: the exam is LOCKED only when the gate is required and the
 *  candidate has not submitted any model yet. */
export function examLockedNoSubmission(status: GateAccessInput | null | undefined): boolean {
  return !examUnlockedBySubmission(status);
}

/** True when the exam result + certificate must be withheld from the candidate:
 *  the gate is required and the candidate's model is not yet approved. Only
 *  reached once a model is submitted (the exam is otherwise locked). */
export function resultWithheldUntilApproval(status: GateResultInput | null | undefined): boolean {
  if (!status || status.required !== true) return false;
  return status.hasApproved !== true;
}
