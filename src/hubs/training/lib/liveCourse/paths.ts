/**
 * THE live course URLs (2026-11-08, founder): a course lives at
 * /training/<CODE> beside the exam courses, and its sessions under it at
 * /training/<CODE>/sessions/<id>. The old /training/live-course/<CODE> and
 * /training/live-sessions/<id> (for a course session) redirect here.
 * Pure, so client components and emails share it.
 */
export function coursePagePath(courseCode: string): string {
  return `/training/${encodeURIComponent(courseCode)}`;
}

/** The id of the course page's time zone table (the side card), linked from emails. */
export const COURSE_TIME_ZONES_ANCHOR = 'time-zones';

/**
 * THE course link in every course email (2026-11-10, founder): the course page
 * with ?enrol=1. A signed-in student is enrolled in one click (or simply lands,
 * if enrolled already); a signed-out one signs in, or registers with the
 * course, and lands back on the course page.
 */
export function courseEmailUrl(learnUrl: string, courseCode: string, opts: { anchor?: string; enrol?: boolean } = {}): string {
  // A link only to READ the page (the time zone table) carries no ?enrol=1, so a reader is not sent to sign in.
  const enrol = opts.enrol !== false;
  return `${learnUrl.replace(/\/$/, '')}${coursePagePath(courseCode)}${enrol ? '?enrol=1' : ''}${opts.anchor ? `#${opts.anchor}` : ''}`;
}

export function courseSessionPath(courseCode: string, sessionId: string): string {
  return `${coursePagePath(courseCode)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** The line above a live course's title: "Live course · REFM · Microsoft Teams" (shown uppercase). */
export function courseEyebrow(shortTitle: string | null | undefined): string {
  const t = (shortTitle ?? '').trim();
  return t ? `Live course · ${t} · Microsoft Teams` : 'Live course · Microsoft Teams';
}
