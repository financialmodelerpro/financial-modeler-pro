/*
 * Sent once when a student enrols in a live course (public page or dashboard).
 * Every interpolated value is escaped below.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

export interface CourseEnrolmentConfirmationData {
  name: string;
  courseTitle: string;
  /** Already formatted in KSA, e.g. "Tue, 1 Dec 2026, 7:00 PM KSA". */
  sessions: { no: number | null; title: string; when: string }[];
  courseUrl: string;
  joinOpensMinutesBefore: number;
}

export async function courseEnrolmentConfirmationTemplate(d: CourseEnrolmentConfirmationData) {
  const displayName = d.name && d.name.trim() ? d.name.trim() : 'Student';
  // plain-text-safe: subject line, not HTML.
  const subject = `You're enrolled: ${d.courseTitle}`;

  const rows = d.sessions.length
    ? d.sessions.map((s) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#1B4F8A;font-weight:700;white-space:nowrap;">${s.no != null ? `Session ${escapeHtml(String(s.no))}` : ''}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#2A3440;">${escapeHtml(s.title)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#5A6675;white-space:nowrap;">${escapeHtml(s.when)}</td>
        </tr>`).join('')
    : `<tr><td style="padding:8px 10px;color:#5A6675;">The schedule will appear on your dashboard as sessions are announced.</td></tr>`;

  const html = await baseLayoutBranded(`
    ${h1('You are enrolled')}
    ${p(`Hi <strong>${escapeHtml(displayName)}</strong>,`)}
    ${p(`You are enrolled in <strong>${escapeHtml(d.courseTitle)}</strong>. Here is the schedule:`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0 20px;">${rows}</table>
    ${p('<strong>How to join:</strong> sign in to your Training Hub dashboard and open the course. The <strong>Join live</strong> button on each session opens ' + escapeHtml(String(d.joinOpensMinutesBefore)) + ' minutes before the start and takes you straight into Microsoft Teams. Please join with the same email you registered with, so your attendance is counted.')}
    ${p('Missed a session? Its recording appears on the course page after the session, and watching it in full counts towards your certificate.')}
    <div style="text-align:center;margin:28px 0;">${button('Open the course', d.courseUrl)}</div>
    ${divider()}
    ${p('If you have any questions, reply to this email.', 'font-size:13px;color:#64748B;')}
  `);

  // plain-text-safe: the text half must not be escaped.
  const text = [
    `Hi ${displayName},`,
    '',
    `You are enrolled in ${d.courseTitle}.`,
    '',
    ...d.sessions.map((s) => `${s.no != null ? `Session ${s.no}: ` : ''}${s.title} - ${s.when}`),
    '',
    `How to join: sign in to your Training Hub dashboard and open the course. The Join live button opens ${d.joinOpensMinutesBefore} minutes before each session.`,
    `Course page: ${d.courseUrl}`,
  ].join('\n');

  return { subject, html, text };
}
