/*
 * Sent to every enrolled student when live-course sessions move. Lists each
 * moved session with its old and new time; an updated calendar file (same
 * event IDs, higher SEQUENCE) is attached by the caller. Every value escaped.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

export interface LiveCourseRescheduleData {
  name: string;
  courseTitle: string;
  /** Already formatted, e.g. "Tue, 1 Dec 2026, 7:00 PM KSA". */
  /** url: the session's own page (secondary link). */
  moves: { label: string; oldWhen: string; newWhen: string; url?: string }[];
  /** The dashboard course view (Join live, the updated dates). */
  courseUrl: string;
}

export async function liveCourseRescheduleTemplate(d: LiveCourseRescheduleData) {
  const displayName = d.name && d.name.trim() ? d.name.trim() : 'Student';
  const one = d.moves.length === 1;
  // plain-text-safe: subject line, not HTML.
  const subject = one ? `Rescheduled: ${d.moves[0].label}` : `Rescheduled: ${d.moves.length} sessions of ${d.courseTitle}`;
  const rows = d.moves.map((m) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#1B4F8A;font-weight:700;">${m.url ? `<a href="${escapeHtml(m.url)}" style="color:#1B4F8A;">${escapeHtml(m.label)}</a>` : escapeHtml(m.label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#5A6675;text-decoration:line-through;white-space:nowrap;">${escapeHtml(m.oldWhen)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#2E7D52;font-weight:700;white-space:nowrap;">${escapeHtml(m.newWhen)}</td>
    </tr>`).join('');

  const html = await baseLayoutBranded(`
    ${h1(one ? 'A session has moved' : 'Sessions have moved')}
    ${p(`Hi <strong>${escapeHtml(displayName)}</strong>,`)}
    ${p(`${one ? 'A session' : 'Some sessions'} of <strong>${escapeHtml(d.courseTitle)}</strong> ${one ? 'has' : 'have'} a new date. Nothing else changes: the session${one ? '' : 's'} still count${one ? 's' : ''} towards your certificate.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0 20px;">
      <tr><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">Session</th><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">Was</th><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">Now</th></tr>
      ${rows}
    </table>
    ${p('The attached calendar file updates the events already in your calendar. The Join live button on your course opens shortly before the new start.')}
    <div style="text-align:center;margin:28px 0;">${button('Open your course', d.courseUrl)}</div>
    ${one && d.moves[0].url ? `<p style="margin:-12px 0 18px;text-align:center;font-size:13px;"><a href="${escapeHtml(d.moves[0].url)}" style="color:#2E75B6;">View the session page</a></p>` : ''}
    ${divider()}
    ${p('If the new time does not work for you, the recording will be on the course page after the session.', 'font-size:13px;color:#64748B;')}
  `);

  // plain-text-safe: the text half must not be escaped.
  const text = [
    `Hi ${displayName},`, '',
    `${d.courseTitle}: ${one ? 'a session has' : 'sessions have'} a new date.`, '',
    ...d.moves.map((m) => `${m.label}: was ${m.oldWhen}, now ${m.newWhen}${m.url ? ` (${m.url})` : ''}`), '',
    `Your course: ${d.courseUrl}`,
  ].join('\n');

  return { subject, html, text };
}
