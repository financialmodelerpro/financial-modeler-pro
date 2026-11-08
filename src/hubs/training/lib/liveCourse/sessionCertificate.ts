/**
 * When a live-course session issues its achievement card (the same card a
 * single live session issues, liveSessions/achievementCard.ts): the course
 * has per-session cards on, and the student met THAT session's rule, live
 * attendance at or above the threshold or its recording watched in full
 * (eligibility.ts). Pure; one rule for the course page and the verifier.
 */
import type { LiveCourseSettings } from './courseSettings';
import type { SessionEligibility } from './eligibility';

export function sessionCertificateAvailable(
  course: Pick<LiveCourseSettings, 'sessionCertificates'>,
  e: Pick<SessionEligibility, 'met'> | undefined,
): boolean {
  return course.sessionCertificates && !!e?.met;
}
