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

/*
 * Course email links, by email type (2026-11-11, founder):
 *   announcement            -> coursePublicUrl: the public course page, no sign-in;
 *                              a visitor sees Register free, a signed-in student Enrol
 *   enrolment confirmation,
 *   session-day reminder,
 *   reschedule, calendar     -> courseDashboardUrl: the dashboard course view (Join live,
 *                              the current dates); signed out, sign-in lands back on it
 *   reminder / reschedule    -> courseSessionUrl as the secondary link to the session
 */
const base = (learnUrl: string) => learnUrl.replace(/\/$/, '');

/** The public course page (announcements). Never forces sign-in. */
export function coursePublicUrl(learnUrl: string, courseCode: string, opts: { anchor?: string } = {}): string {
  return `${base(learnUrl)}${coursePagePath(courseCode)}${opts.anchor ? `#${opts.anchor}` : ''}`;
}

/** The dashboard path of a live course's view. */
export function courseDashboardPath(courseCode: string): string {
  return `/training/dashboard?livecourse=${encodeURIComponent(courseCode)}`;
}

/** The dashboard course view (enrolment confirmation, reminders, reschedule, calendar). */
export function courseDashboardUrl(learnUrl: string, courseCode: string): string {
  return `${base(learnUrl)}${courseDashboardPath(courseCode)}`;
}

/** One course session's page (the secondary link in reminders and reschedule emails). */
export function courseSessionUrl(learnUrl: string, courseCode: string, sessionId: string): string {
  return `${base(learnUrl)}${courseSessionPath(courseCode, sessionId)}`;
}

export function courseSessionPath(courseCode: string, sessionId: string): string {
  return `${coursePagePath(courseCode)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** The line above a live course's title: "Live course · REFM · Microsoft Teams" (shown uppercase). */
export function courseEyebrow(shortTitle: string | null | undefined): string {
  const t = (shortTitle ?? '').trim();
  return t ? `Live course · ${t} · Microsoft Teams` : 'Live course · Microsoft Teams';
}
