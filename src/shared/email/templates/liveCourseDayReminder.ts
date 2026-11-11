/*
 * Same-day reminder for a live-course session, sent at 9:00 AM KSA on the
 * session day by the daily reminder cron. Every interpolated value is escaped.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

export interface LiveCourseDayReminderData {
  name: string;
  courseTitle: string;
  sessionTitle: string;
  sessionNo: number | null;
  /** Already formatted, e.g. "Tue, 1 Dec 2026, 7:00 PM KSA". */
  when: string;
  /** The dashboard course view (Join live). */
  courseUrl: string;
  /** The session's own page (secondary link). */
  sessionUrl?: string;
  joinOpensMinutesBefore: number;
}

export async function liveCourseDayReminderTemplate(d: LiveCourseDayReminderData) {
  const displayName = d.name && d.name.trim() ? d.name.trim() : 'Student';
  // plain-text-safe: label is plain text here and escapeHtml(label) wherever it reaches HTML.
  const label = d.sessionNo != null ? `Session ${d.sessionNo}: ${d.sessionTitle}` : d.sessionTitle;
  // plain-text-safe: subject line, not HTML.
  const subject = `Today: ${label}`;

  const html = await baseLayoutBranded(`
    ${h1('Your live session is today')}
    ${p(`Hi <strong>${escapeHtml(displayName)}</strong>,`)}
    ${p(`<strong>${escapeHtml(label)}</strong> of <strong>${escapeHtml(d.courseTitle)}</strong> is today at <strong>${escapeHtml(d.when)}</strong>.`)}
    ${p('Open the course on your dashboard. The <strong>Join live</strong> button opens ' + escapeHtml(String(d.joinOpensMinutesBefore)) + ' minutes before the start and takes you into Microsoft Teams. Please join with the email you registered with, so your attendance is counted.')}
    <div style="text-align:center;margin:28px 0;">${button('Open your course', d.courseUrl)}</div>
    ${d.sessionUrl ? `<p style="margin:-12px 0 18px;text-align:center;font-size:13px;"><a href="${escapeHtml(d.sessionUrl)}" style="color:#2E75B6;">View the session page</a></p>` : ''}
    ${divider()}
    ${p('Cannot make it? The recording will be on the course page after the session.', 'font-size:13px;color:#64748B;')}
  `);

  // plain-text-safe: the text half must not be escaped.
  const text = `Hi ${displayName},\n\n${label} of ${d.courseTitle} is today at ${d.when}.\n\nOpen your course: ${d.courseUrl}${d.sessionUrl ? `\nSession page: ${d.sessionUrl}` : ''}\nThe Join live button opens ${d.joinOpensMinutesBefore} minutes before the start.`;

  return { subject, html, text };
}
