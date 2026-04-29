import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ModelSubmissionRejectedData {
  name?: string;
  courseLabel: string;
  fileName: string;
  attemptNumber: number;
  attemptsRemaining: number;
  maxAttempts: number;
  reviewerNote: string;
}

/**
 * Sent when an admin rejects a student's model submission. Companion to
 * modelSubmissionApprovedTemplate. Both fire from
 * POST /api/admin/model-submissions/[id]/review. The admin route requires a
 * non-empty review_note on reject; this template assumes it is present.
 */
export async function modelSubmissionRejectedTemplate({
  name, courseLabel, fileName, attemptNumber,
  attemptsRemaining, maxAttempts, reviewerNote,
}: ModelSubmissionRejectedData) {
  const exhausted = attemptsRemaining <= 0;
  const subject = exhausted
    ? `Model needs work — Please contact the administrator: ${courseLabel}`
    : `Model needs work — ${attemptsRemaining} resubmission${attemptsRemaining === 1 ? '' : 's'} left: ${courseLabel}`;

  const html = await baseLayoutBranded(`
    ${h1('Your model needs more work')}
    ${name ? p(`Hi <strong>${name}</strong>,`) : ''}
    ${p(`We have reviewed your financial model submission for <strong>${courseLabel}</strong>. It is not quite ready yet, so we are sending it back for another pass.`)}

    <div style="background:#FEF2F2;border:2px solid #EF4444;border-radius:10px;padding:22px;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#991B1B;margin-bottom:8px;">NOT APPROVED</div>
      <div style="font-size:14px;color:#7F1D1D;line-height:1.55;">
        <strong>Submission:</strong> ${fileName}<br/>
        <strong>Attempt:</strong> ${attemptNumber} of ${maxAttempts}<br/>
        <strong>Resubmissions remaining:</strong> ${attemptsRemaining} of ${maxAttempts}
      </div>
    </div>

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 16px;margin:16px 0;">
      <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Reviewer Note</div>
      <div style="font-size:13px;color:#374151;line-height:1.55;">${reviewerNote.replace(/\n/g, '<br/>')}</div>
    </div>

    ${exhausted
      ? p('You have used all of your model submission attempts. Please reply to this email so we can talk through next steps and unlock your Final Exam manually.')
      : p(`Use the reviewer note above to refine your model and upload a new version when you are ready. You have <strong>${attemptsRemaining}</strong> resubmission${attemptsRemaining === 1 ? '' : 's'} left.`)
    }

    <div style="text-align:center;margin:24px 0;">
      ${button(exhausted ? 'Open Dashboard' : 'Resubmit Your Model', `${LEARN_URL}/training/dashboard`)}
    </div>

    ${divider()}
    ${p('Reach out if anything in the reviewer note is unclear. We would rather pause and talk it through than have you keep guessing.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Financial Modeler Pro — Model Needs Work\n\n`
    + `${name ? `Hi ${name},\n\n` : ''}`
    + `Your financial model for ${courseLabel} is not approved yet.\n`
    + `Submission: ${fileName} (attempt ${attemptNumber} of ${maxAttempts})\n`
    + `Resubmissions remaining: ${attemptsRemaining} of ${maxAttempts}\n\n`
    + `Reviewer note:\n${reviewerNote}\n\n`
    + `${exhausted
        ? 'You have used all attempts. Please reply to this email to discuss next steps.'
        : 'Use the reviewer note to refine your model and upload again when ready.'}\n\n`
    + `Dashboard: ${LEARN_URL}/training/dashboard`;

  return { subject, html, text };
}
