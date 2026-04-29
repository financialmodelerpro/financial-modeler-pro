import { baseLayoutBranded, h1, p, button, divider } from './_base';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

interface StaleDigestRow {
  submissionId: string;
  studentName: string | null;
  studentEmail: string;
  registrationId: string | null;
  courseCode: '3SFM' | 'BVM';
  fileName: string;
  attemptNumber: number;
  maxAttempts: number;
  submittedAt: string;
  daysWaiting: number;
}

interface ModelSubmissionStaleDigestData {
  rows: StaleDigestRow[];
  thresholdDays: number;
  reviewSlaDays: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Daily digest sent to the admin recipient when at least one model
 * submission has been pending review longer than the configured stale
 * threshold (default 2 days). Fired by /api/cron/model-submission-stale.
 *
 * Idempotency posture: the cron sends every day there's stuff to flag.
 * No per-row "reminder_sent" flag - the inbox surfacing is the point,
 * and admins can ignore the same digest twice without it costing
 * anything. When the queue is empty the cron skips email entirely.
 */
export async function modelSubmissionStaleDigestTemplate({
  rows, thresholdDays, reviewSlaDays,
}: ModelSubmissionStaleDigestData) {
  const reviewUrl = `${MAIN_URL}/admin/training-hub/model-submissions`;
  const oldest = rows.reduce((max, r) => Math.max(max, r.daysWaiting), 0);
  const subject = `[FMP] ${rows.length} model submission${rows.length === 1 ? '' : 's'} waiting > ${thresholdDays}d (oldest ${oldest}d)`;

  const tableRows = rows.map(r => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#1F3864;font-weight:600;">
        ${r.studentName ?? '(no name)'}<br/>
        <span style="font-weight:400;color:#64748B;">${r.studentEmail}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#374151;">
        ${r.courseCode}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#374151;">
        ${r.attemptNumber}/${r.maxAttempts}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#374151;">
        ${formatDate(r.submittedAt)}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;color:${r.daysWaiting >= reviewSlaDays ? '#991B1B' : '#92400E'};font-weight:700;">
        ${r.daysWaiting}d
      </td>
    </tr>
  `).join('');

  const textRows = rows.map(r =>
    `  - ${r.studentName ?? '(no name)'} <${r.studentEmail}> · ${r.courseCode} · attempt ${r.attemptNumber}/${r.maxAttempts} · waiting ${r.daysWaiting}d (submitted ${formatDate(r.submittedAt)})`
  ).join('\n');

  const html = await baseLayoutBranded(`
    ${h1('Pending model submissions')}
    ${p(`There ${rows.length === 1 ? 'is' : 'are'} <strong>${rows.length}</strong> model submission${rows.length === 1 ? '' : 's'} that ${rows.length === 1 ? 'has' : 'have'} been waiting longer than ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}. The published student SLA is ${reviewSlaDays} business days, so anything older than that is over the line.`)}

    <div style="overflow-x:auto;margin:18px 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Student</th>
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Course</th>
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Attempt</th>
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Submitted</th>
            <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">Waiting</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <div style="text-align:center;margin:24px 0;">
      ${button('Open Review Queue', reviewUrl)}
    </div>

    ${divider()}
    ${p(`This digest is triggered daily and only sent when at least one submission has been pending longer than the stale threshold. To change the threshold, edit <code style="font-family:monospace;color:#64748B;">model_submission_stale_threshold_days</code> in <em>Training Settings</em>. To stop the digest entirely, disable <strong>New-submission email alerts</strong> on the same page.`, 'font-size:11px;color:#94A3B8;')}
  `);

  const text = `Financial Modeler Pro - Pending Model Submissions\n\n`
    + `${rows.length} submission${rows.length === 1 ? '' : 's'} pending > ${thresholdDays} day${thresholdDays === 1 ? '' : 's'} (review SLA: ${reviewSlaDays} business days):\n\n`
    + `${textRows}\n\n`
    + `Queue: ${reviewUrl}\n`;

  return { subject, html, text };
}

export type { StaleDigestRow };
