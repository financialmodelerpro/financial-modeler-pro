/**
 * What the public certificate verification page (/verify/<id>) shows for a
 * LIVE COURSE certificate (founder, 2026-11-13): each session and how it was
 * completed (attended live or completed via recording, never a percentage),
 * the model submission status and the course's learning outcomes.
 *
 * The session routes come from THE eligibility rule (eligibility.ts), the
 * model status from the submission gate (getModelSubmissionStatus) and the
 * outcomes from the course page's "Skills you will gain" list, so the verify
 * page restates none of them. Wording rule: no claim of formal recognition by
 * any body; the CPD line below is the only professional-body statement.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow } from './courseSettings';
import { loadStudentEligibility, type SessionVia } from './eligibility';
import { getModelSubmissionStatus } from '../modelSubmission/checkApproval';

export const CPD_LINE = "Members may record this as CPD under their professional body's rules.";

export interface VerifySessionRow { no: number | null; title: string; route: string }
export interface LiveCourseVerifyRecord {
  sessions: VerifySessionRow[];
  model: string;
  outcomes: { title: string; text: string }[];
}

/** How one session was completed, in the card's words. Pure. */
export function verifyRouteLabel(via: SessionVia): string {
  return via === 'live' ? 'Attended live' : via === 'recording' ? 'Completed via recording' : 'Not completed';
}

/** The model submission status, in plain words. Pure. */
export function verifyModelLabel(m: { required: boolean; hasApproved: boolean; latestStatus: string }): string {
  if (m.hasApproved) return 'Submitted and approved';
  if (m.latestStatus === 'pending_review') return 'Submitted, under review';
  if (m.latestStatus === 'rejected') return 'Submitted, not yet approved';
  return m.required ? 'Not submitted' : 'Not required';
}

/** Null when the course is not a live course (an exam course's page is unchanged). */
export async function loadLiveCourseVerifyRecord(
  sb: SupabaseClient,
  email: string | null | undefined,
  courseCode: string | null | undefined,
): Promise<LiveCourseVerifyRecord | null> {
  if (!email || !courseCode) return null;
  const course = await getLiveCourseSettings(sb, courseCode).catch(() => null);
  if (!isLiveCourseRow(course)) return null;
  const [elig, model] = await Promise.all([
    loadStudentEligibility(sb, email, course.courseCode).catch(() => null),
    getModelSubmissionStatus(email, course.courseCode).catch(() => null),
  ]);
  return {
    sessions: (elig?.sessions ?? []).map((s) => ({ no: s.no, title: s.title, route: verifyRouteLabel(s.via) })),
    model: model ? verifyModelLabel(model) : 'Not available',
    outcomes: course.page.sections.skills.items.map((i) => ({ title: i.title, text: i.text })),
  };
}
