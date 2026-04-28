import type { CourseConfig, Session } from '@/src/hubs/training/config/courses';
import type { SessionProgress } from '@/src/hubs/training/components/dashboard/types';

/**
 * Weighted course progress. Each session is weighted by its `questionCount`
 * (regular sessions default to 10, final exams carry ~50) so a course's
 * percentage reflects how much of the knowledge the student has demonstrated —
 * not just the share of boxes ticked. A 16 / 18 student is 89% by count but
 * only ~73% weighted because the 50-question final still hasn't been passed.
 *
 * Only applies to 3SFM / BVM (every `CourseConfig.sessions` entry has a
 * `questionCount`). Live sessions are deliberately not rolled into any
 * course's progress — they stand alone.
 */
export interface CourseProgress {
  earned: number;          // question-weighted points the student has banked
  total: number;           // question-weighted points available
  percentage: number;      // earned / total, 0–100, rounded
  passedCount: number;     // number of passed sessions (unweighted)
  totalCount: number;      // number of sessions in the course (unweighted)
}

const DEFAULT_REGULAR_WEIGHT = 10;
const DEFAULT_FINAL_WEIGHT   = 50;

function weightFor(session: Session): number {
  if (typeof session.questionCount === 'number' && session.questionCount > 0) {
    return session.questionCount;
  }
  return session.isFinal ? DEFAULT_FINAL_WEIGHT : DEFAULT_REGULAR_WEIGHT;
}

export function calculateCourseProgress(
  course: CourseConfig,
  progressMap: Map<string, SessionProgress>,
): CourseProgress {
  let earned = 0;
  let total = 0;
  let passedCount = 0;

  for (const s of course.sessions) {
    const weight = weightFor(s);
    total += weight;
    if (progressMap.get(s.id)?.passed === true) {
      earned += weight;
      passedCount++;
    }
  }

  return {
    earned,
    total,
    percentage: total > 0 ? Math.round((earned / total) * 100) : 0,
    passedCount,
    totalCount: course.sessions.length,
  };
}
