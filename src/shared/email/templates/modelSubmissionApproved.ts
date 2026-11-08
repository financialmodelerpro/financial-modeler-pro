/*
 * html-safe: attemptNumber
 * html-safe: noExam (a boolean that picks between two fixed sentences)
 *
 * A count, not text. Every value that can carry markup is escaped.
 */
import { baseLayoutBranded, h1, p, button, divider , escapeHtml, escapeHtmlMultiline } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ModelSubmissionApprovedData {
  name?: string;
  courseLabel: string;
  fileName: string;
  attemptNumber: number;
  reviewerNote?: string | null;
  /** Absolute link to download the admin-returned reviewed model (mig 185). A
   *  LINK, never an attachment. Null when the admin approved without a file. */
  reviewedFileUrl?: string | null;
  reviewedFileName?: string | null;
  /** A course with no exam (live course): approval issues the certificate. */
  noExam?: boolean;
  /** Where the student's button goes; the dashboard's My Model tab by default. */
  dashboardUrl?: string;
}

/**
 * Sent when an admin approves a student's model submission. Companion to
 * modelSubmissionRejectedTemplate. Both fire from
 * POST /api/admin/model-submissions/[id]/review.
 */
export async function modelSubmissionApprovedTemplate({
  name, courseLabel, fileName, attemptNumber, reviewerNote, reviewedFileUrl, reviewedFileName, noExam, dashboardUrl,
}: ModelSubmissionApprovedData) {
  const goUrl = dashboardUrl || `${LEARN_URL}/training/dashboard?tab=my-model`;
  const subject = noExam
    ? `✓ Model approved, your certificate is on its way: ${escapeHtml(courseLabel)}`
    : `✓ Model approved, Final exam unlocked: ${escapeHtml(courseLabel)}`;

  const html = await baseLayoutBranded(`
    ${h1(`Model approved${name ? `, ${escapeHtml(name)}` : ''}!`)}
    ${name ? p(`Hi <strong>${escapeHtml(name)}</strong>,`) : ''}
    ${p(`Your financial model for <strong>${escapeHtml(courseLabel)}</strong> has been reviewed and <strong>approved</strong>. Great work.`)}

    <div style="background:#F0FDF4;border:2px solid #2EAA4A;border-radius:10px;padding:22px;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#166534;margin-bottom:8px;">APPROVED</div>
      <div style="font-size:14px;color:#14532D;line-height:1.55;">
        <strong>Submission:</strong> ${escapeHtml(fileName)}<br/>
        <strong>Attempt:</strong> ${attemptNumber}
      </div>
    </div>

    ${reviewerNote
      ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 16px;margin:16px 0;">
           <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Reviewer Note</div>
           <div style="font-size:13px;color:#374151;line-height:1.55;">${escapeHtmlMultiline(reviewerNote)}</div>
         </div>`
      : ''}

    ${reviewedFileUrl
      ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px 18px;margin:16px 0;">
           <div style="font-size:11px;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Your reviewed model</div>
           <div style="font-size:13px;color:#374151;line-height:1.55;margin-bottom:12px;">Your reviewer returned a marked-up copy of your model${reviewedFileName ? ` (<strong>${escapeHtml(reviewedFileName)}</strong>)` : ''}. Download it to see their feedback in context. It is also available in your dashboard.</div>
           <div>${button('Download reviewed model', reviewedFileUrl)}</div>
         </div>`
      : ''}

    ${noExam
      ? p('This completes the course. Your certificate is being issued now and will arrive in a separate email, with a link anyone can use to verify it.')
      : p('The Final Exam for this course is now unlocked on your dashboard. Pass it and your certificate is issued automatically.')}

    <div style="text-align:center;margin:24px 0;">
      ${button('Go to Dashboard', goUrl)}
    </div>

    ${divider()}
    ${p('Thanks for putting the work in. Your model showed the effort we were looking for.', 'font-size:13px;color:#64748B;')}
  `);

  // plain-text-safe: the text half must not be escaped.
  const text = `Financial Modeler Pro, Model Approved\n\n`
    + `${name ? `Hi ${escapeHtml(name)},\n\n` : ''}`
    + `Your financial model for ${escapeHtml(courseLabel)} has been APPROVED.\n`
    + `Submission: ${escapeHtml(fileName)} (attempt ${attemptNumber})\n`
    + `${reviewerNote ? `\nReviewer note: ${reviewerNote}\n` : ''}`
    + `${reviewedFileUrl ? `\nYour reviewer returned a marked-up model${reviewedFileName ? ` (${escapeHtml(reviewedFileName)})` : ''}.\nDownload: ${reviewedFileUrl}\n` : ''}`
    + (noExam ? `\nYour certificate is being issued and will arrive in a separate email.\n` : `\nThe Final Exam is now unlocked on your dashboard.\n`)
    + `\nYour models: ${goUrl}`;

  return { subject, html, text };
}
