/*
 * ONE announcement for a whole live course (2026-11-10, founder): the course
 * title, tagline, start date, the full session schedule in KSA and the
 * Register / Enrol link to the course page. Course sessions never send their
 * own announcement. The greeting carries the {{name}} token, filled per
 * recipient by the announcement queue (announcements/queue.ts). Every value
 * is escaped.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

export interface LiveCourseAnnouncementData {
  courseTitle: string;
  tagline: string;
  /** Already formatted, e.g. "Tue 1 Dec 2026". */
  startDate: string;
  /** Already formatted, KSA first. */
  sessions: { label: string; title: string; when: string }[];
  courseUrl: string;
  /** "Enrol in the course" or "Register free" (the page decides for a visitor). */
  cta: string;
}

export async function liveCourseAnnouncementTemplate(d: LiveCourseAnnouncementData) {
  // plain-text-safe: subject line, not HTML.
  const subject = `New live course: ${d.courseTitle}${d.startDate ? `, starting ${d.startDate}` : ''}`;
  const rows = d.sessions.map((s) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#1B4F8A;font-weight:700;white-space:nowrap;">${escapeHtml(s.label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#0D2E5A;">${escapeHtml(s.title)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E8EEF7;color:#2A3440;white-space:nowrap;">${escapeHtml(s.when)}</td>
    </tr>`).join('');
  const html = await baseLayoutBranded(`
    ${h1(escapeHtml(d.courseTitle))}
    ${p('Hi <strong>{{name}}</strong>,')}
    ${d.tagline ? p(escapeHtml(d.tagline)) : ''}
    ${d.startDate ? p(`The course starts on <strong>${escapeHtml(d.startDate)}</strong>. Enrol once and you are registered for every session.`) : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0 20px;">
      <tr><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">Session</th><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">Topic</th><th align="left" style="padding:6px 10px;color:#5A6675;font-size:12px;">When (KSA)</th></tr>
      ${rows}
    </table>
    <div style="text-align:center;margin:28px 0;">${button(escapeHtml(d.cta), d.courseUrl)}</div>
    ${divider()}
    ${p('Every session is recorded, and the recordings count towards the certificate.', 'font-size:13px;color:#64748B;')}
  `);
  return { subject, html };
}
