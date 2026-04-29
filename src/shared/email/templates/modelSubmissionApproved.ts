import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ModelSubmissionApprovedData {
  name?: string;
  courseLabel: string;
  fileName: string;
  attemptNumber: number;
  reviewerNote?: string | null;
}

/**
 * Sent when an admin approves a student's model submission. Companion to
 * modelSubmissionRejectedTemplate. Both fire from
 * POST /api/admin/model-submissions/[id]/review.
 */
export async function modelSubmissionApprovedTemplate({
  name, courseLabel, fileName, attemptNumber, reviewerNote,
}: ModelSubmissionApprovedData) {
  const subject = `✓ Model approved — Final exam unlocked: ${courseLabel}`;

  const html = await baseLayoutBranded(`
    ${h1(`Model approved${name ? `, ${name}` : ''}!`)}
    ${name ? p(`Hi <strong>${name}</strong>,`) : ''}
    ${p(`Your financial model for <strong>${courseLabel}</strong> has been reviewed and <strong>approved</strong>. Great work.`)}

    <div style="background:#F0FDF4;border:2px solid #2EAA4A;border-radius:10px;padding:22px;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#166534;margin-bottom:8px;">APPROVED</div>
      <div style="font-size:14px;color:#14532D;line-height:1.55;">
        <strong>Submission:</strong> ${fileName}<br/>
        <strong>Attempt:</strong> ${attemptNumber}
      </div>
    </div>

    ${reviewerNote
      ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 16px;margin:16px 0;">
           <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Reviewer Note</div>
           <div style="font-size:13px;color:#374151;line-height:1.55;">${reviewerNote.replace(/\n/g, '<br/>')}</div>
         </div>`
      : ''}

    ${p('The Final Exam for this course is now unlocked on your dashboard. Pass it and your certificate is issued automatically.')}

    <div style="text-align:center;margin:24px 0;">
      ${button('Go to Dashboard', `${LEARN_URL}/training/dashboard`)}
    </div>

    ${divider()}
    ${p('Thanks for putting the work in. Your model showed the effort we were looking for.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Financial Modeler Pro — Model Approved\n\n`
    + `${name ? `Hi ${name},\n\n` : ''}`
    + `Your financial model for ${courseLabel} has been APPROVED.\n`
    + `Submission: ${fileName} (attempt ${attemptNumber})\n`
    + `${reviewerNote ? `\nReviewer note: ${reviewerNote}\n` : ''}`
    + `\nThe Final Exam is now unlocked on your dashboard.\n`
    + `\nDashboard: ${LEARN_URL}/training/dashboard`;

  return { subject, html, text };
}
