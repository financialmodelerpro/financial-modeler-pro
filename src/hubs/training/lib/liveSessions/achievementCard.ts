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
  opts: {
    completed?: boolean;
    /**
     * The live-course card's own facts (founder, 2026-11-13), all optional so
     * a card without them is unchanged: "Session N of M", the session's
     * structured learning ("2.5 hours of structured learning"), the route the
     * session was completed by, and the page its QR code opens. Never a
     * percentage.
     */
    sessionNo?: number | null;
    sessionCount?: number | null;
    learning?: string | null;
    via?: 'live' | 'recording' | null;
    qrUrl?: string | null;
  } = {},
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
    if (opts.sessionNo != null && opts.sessionCount) { params.set('no', String(opts.sessionNo)); params.set('of', String(opts.sessionCount)); }
    if (opts.learning) params.set('learning', opts.learning);
    if (opts.via === 'live' || opts.via === 'recording') params.set('via', opts.via);
    if (opts.qrUrl) params.set('qr', opts.qrUrl);
  } else if (session.duration_minutes != null && session.duration_minutes > 0) {
    params.set('duration', String(session.duration_minutes));
  }
  return `/api/training/achievement-image?${params.toString()}`;
}
