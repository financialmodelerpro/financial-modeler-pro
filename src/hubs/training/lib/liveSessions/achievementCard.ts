/**
 * THE per-session achievement card (the small system-made certificate a
 * student downloads and shares after a live session). One builder for every
 * surface: the live session card, and a live course's session list.
 *
 * The image itself is rendered by /api/training/achievement-image from these
 * query parameters ("Session Completed" when the session has no assessment,
 * "Assessment Passed" with a score when it has one). It carries the student's
 * name and registration ID; it is not stored and has no verify page of its
 * own (that belongs to the course certificate).
 */

export interface AchievementSession {
  title: string;
  has_assessment?: boolean | null;
  duration_minutes?: number | null;
}

export function achievementCardUrl(
  session: AchievementSession,
  studentName?: string,
  regId?: string,
  score?: number,
  dateIso?: string | null,
  course = 'FMP Real-World Financial Modeling',
  /** A live-course session card (2026-11-10): "Completed", no duration, no percentage, no ID. */
  opts: { completed?: boolean } = {},
): string {
  const hasAssessment = !!session.has_assessment;
  const params = new URLSearchParams({
    session: session.title,
    date: dateIso ? new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    course,
    name: studentName ?? '',
    regId: regId ?? '',
    has_assessment: hasAssessment ? 'true' : 'false',
  });
  if (hasAssessment && score != null) {
    params.set('score', String(score));
  }
  if (opts.completed) {
    params.set('completed', '1');
    params.delete('regId');
  } else if (session.duration_minutes != null && session.duration_minutes > 0) {
    params.set('duration', String(session.duration_minutes));
  }
  return `/api/training/achievement-image?${params.toString()}`;
}
