import { baseLayoutBranded, h1, p, button, divider } from './_base';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

interface ModelSubmissionAdminAlertData {
  studentName?: string | null;
  studentEmail: string;
  registrationId?: string | null;
  courseLabel: string;
  courseCode: '3SFM' | 'BVM';
  fileName: string;
  fileSize: number;
  attemptNumber: number;
  maxAttempts: number;
  studentNotes?: string | null;
  submissionId: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Sent to the admin recipient when a new student model submission arrives.
 * Fired fire-and-forget from POST /api/training/model-submission so the
 * student response never waits on it. Honors two settings:
 *   - model_submission_admin_notify_enabled (default 'true')
 *   - model_submission_admin_notify_email   (default '' = skip)
 *
 * Companion to modelSubmissionApproved + modelSubmissionRejected (which
 * email the student). This one targets the reviewer.
 */
export async function modelSubmissionAdminAlertTemplate({
  studentName, studentEmail, registrationId,
  courseLabel, courseCode, fileName, fileSize,
  attemptNumber, maxAttempts, studentNotes, submissionId,
}: ModelSubmissionAdminAlertData) {
  const reviewUrl = `${MAIN_URL}/admin/training-hub/model-submissions`;
  const subject = `New model submission: ${studentName || studentEmail} (${courseCode}, attempt ${attemptNumber}/${maxAttempts})`;

  const html = await baseLayoutBranded(`
    ${h1('New model submission to review')}
    ${p('A student has uploaded a financial model for admin review. The Final Exam stays locked for them until you approve or reject the submission.')}

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:13px;color:#374151;">
        <tr>
          <td style="padding:5px 0;color:#64748B;width:140px;">Student</td>
          <td style="padding:5px 0;font-weight:600;color:#1F3864;">${studentName ? studentName : '(no name on file)'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748B;">Email</td>
          <td style="padding:5px 0;"><a href="mailto:${studentEmail}" style="color:#2E75B6;">${studentEmail}</a></td>
        </tr>
        ${registrationId ? `
        <tr>
          <td style="padding:5px 0;color:#64748B;">Registration ID</td>
          <td style="padding:5px 0;font-family:monospace;color:#1F3864;">${registrationId}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:5px 0;color:#64748B;">Course</td>
          <td style="padding:5px 0;font-weight:600;">${courseLabel} (${courseCode})</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748B;">Attempt</td>
          <td style="padding:5px 0;font-weight:600;">${attemptNumber} of ${maxAttempts}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748B;">File</td>
          <td style="padding:5px 0;color:#1F3864;">${fileName} <span style="color:#94A3B8;">(${formatBytes(fileSize)})</span></td>
        </tr>
      </table>
    </div>

    ${studentNotes
      ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 14px;margin:14px 0;">
           <div style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Student note</div>
           <div style="font-size:13px;color:#78350F;line-height:1.55;">${studentNotes.replace(/\n/g, '<br/>')}</div>
         </div>`
      : ''}

    ${p(`Review SLA is 5 business days. The student is told the same window in their submission confirmation, so try to land a decision before that horizon.`, 'font-size:13px;color:#475569;')}

    <div style="text-align:center;margin:24px 0;">
      ${button('Open Review Queue', reviewUrl)}
    </div>

    ${divider()}
    ${p(`Submission ID: <code style="font-family:monospace;color:#64748B;">${submissionId}</code>`, 'font-size:11px;color:#94A3B8;')}
  `);

  const text = `Financial Modeler Pro — New Model Submission\n\n`
    + `Student: ${studentName || '(no name)'} <${studentEmail}>\n`
    + `${registrationId ? `Registration: ${registrationId}\n` : ''}`
    + `Course: ${courseLabel} (${courseCode})\n`
    + `Attempt: ${attemptNumber} of ${maxAttempts}\n`
    + `File: ${fileName} (${formatBytes(fileSize)})\n`
    + `${studentNotes ? `\nStudent note:\n${studentNotes}\n` : ''}`
    + `\nReview SLA: 5 business days.\n`
    + `\nQueue: ${reviewUrl}\n`
    + `Submission ID: ${submissionId}`;

  return { subject, html, text };
}
