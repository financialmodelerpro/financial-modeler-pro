import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ModelSubmissionNoticeBroadcastData {
  studentName?: string | null;
  /** Either '3SFM' | 'BVM' for a single-course notice, or 'all' for a unified broadcast. */
  scope: '3SFM' | 'BVM' | 'all';
  /** Days of warning before enforcement begins. Drives the headline copy. */
  noticeDays: number;
  reviewSlaDays: number;
  maxAttempts: number;
}

const SCOPE_COPY: Record<'3SFM' | 'BVM' | 'all', { headline: string; bodyIntro: string }> = {
  '3SFM': {
    headline: 'Important: A new requirement for the 3SFM Final Exam',
    bodyIntro: 'Before you can sit the Final Exam for the 3-Statement Financial Modeling course, you will soon need to submit the financial model you have built for an admin review.',
  },
  'BVM': {
    headline: 'Important: A new requirement for the BVM Final Exam',
    bodyIntro: 'Before you can sit the Final Exam for the Business Valuation Modeling course, you will soon need to submit the financial model you have built for an admin review.',
  },
  'all': {
    headline: 'Important: A new requirement before your Final Exams',
    bodyIntro: 'Before you can sit the Final Exam for either of our flagship courses (3SFM and BVM), you will soon need to submit the financial model you have built for an admin review.',
  },
};

/**
 * One-shot broadcast email to existing confirmed Training Hub students
 * announcing the model-submission requirement. Fired by
 * `scripts/model_submission_notice_broadcast.ts` and idempotency-guarded
 * by the `model_submission_notice_broadcast_<scope>_at` setting key.
 *
 * Tone: heads-up, not punitive. The point is to give students enough
 * runway to start building the model before the gate flips ON.
 */
export async function modelSubmissionNoticeBroadcastTemplate({
  studentName, scope, noticeDays, reviewSlaDays, maxAttempts,
}: ModelSubmissionNoticeBroadcastData) {
  const dashUrl = `${LEARN_URL}/training/dashboard`;
  const greeting = studentName?.trim() ? `Hi ${studentName.trim()},` : 'Hi,';
  const { headline, bodyIntro } = SCOPE_COPY[scope];
  const subject = `[FMP] ${headline}`;

  const html = await baseLayoutBranded(`
    ${h1(headline)}
    ${p(greeting)}
    ${p(bodyIntro)}
    ${p(`This is a heads-up so you have time to prepare. Enforcement begins in approximately <strong>${noticeDays} day${noticeDays === 1 ? '' : 's'}</strong>. Until that date, the Final Exam continues to unlock the way it does today; nothing changes for you immediately.`)}

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <div style="font-size:13px;font-weight:700;color:#1F3864;margin-bottom:10px;">What is changing</div>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.7;">
        <li>You will need to <strong>build and upload</strong> your own financial model for the course.</li>
        <li>An admin reviews each submission on an <strong>effort-based</strong> pass/reject basis (typically within ${reviewSlaDays} business days).</li>
        <li>You will get up to <strong>${maxAttempts} attempts</strong>; each rejection consumes one attempt and the reviewer leaves a note on what to address.</li>
        <li>The Final Exam unlocks automatically on approval.</li>
      </ul>
    </div>

    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 18px;margin:18px 0;">
      <div style="font-size:13px;font-weight:700;color:#92400E;margin-bottom:6px;">What you can do now</div>
      <div style="font-size:12.5px;color:#78350F;line-height:1.6;">
        Open your dashboard. The course view shows guidance on what the model should cover. If a downloadable sample is available you will see a "Download sample template" link beneath the guidance. Start building so you are ready when the gate flips.
      </div>
    </div>

    ${p('Already passed your Final Exam? Then this requirement does not apply to you - your existing certificate is unaffected.', 'font-size:12.5px;color:#475569;')}

    <div style="text-align:center;margin:24px 0;">
      ${button('Open My Dashboard', dashUrl)}
    </div>

    ${divider()}
    ${p('Questions? Reply to this email and we will get back to you. We are doing this to make the certificate worth more, not to put more friction in your path.', 'font-size:12px;color:#94A3B8;')}
  `);

  const text =
    `Financial Modeler Pro - ${headline}\n\n` +
    `${greeting}\n\n` +
    `${bodyIntro}\n\n` +
    `This is a heads-up so you have time to prepare. Enforcement begins in approximately ${noticeDays} day${noticeDays === 1 ? '' : 's'}.\n\n` +
    `What is changing:\n` +
    `  - You will need to build and upload your own financial model.\n` +
    `  - An admin reviews each submission on a pass/reject basis (within ${reviewSlaDays} business days).\n` +
    `  - You get up to ${maxAttempts} attempts; each rejection comes with a reviewer note.\n` +
    `  - The Final Exam unlocks automatically on approval.\n\n` +
    `What you can do now: open your dashboard, read the guidance for your course, and start building.\n\n` +
    `Already passed your Final Exam? This does not affect you.\n\n` +
    `Dashboard: ${dashUrl}\n`;

  return { subject, html, text };
}
