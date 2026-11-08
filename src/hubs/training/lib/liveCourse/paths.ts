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

export function courseSessionPath(courseCode: string, sessionId: string): string {
  return `${coursePagePath(courseCode)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** The line above a live course's title: "Live course · REFM · Microsoft Teams" (shown uppercase). */
export function courseEyebrow(shortTitle: string | null | undefined): string {
  const t = (shortTitle ?? '').trim();
  return t ? `Live course · ${t} · Microsoft Teams` : 'Live course · Microsoft Teams';
}
