/**
 * scripts/testEmails.ts
 * Sends one test email for each template/sender combination to verify
 * Resend delivery and domain verification.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json -e "require('./scripts/testEmails.ts')"
 *   OR via the API route (recommended):
 *   curl -X POST http://localhost:3000/api/email/send \
 *     -H "Content-Type: application/json" \
 *     -d '{"template":"otpVerification","to":"your@email.com","data":{"code":"123456"}}'
 *
 * Requires .env.local with RESEND_API_KEY set.
 */

// Load env vars (run from project root)
import 'dotenv/config';

import { sendEmail, FROM } from '../src/lib/email/sendEmail';
import { otpVerificationTemplate }          from '../src/lib/email/templates/otpVerification';
import { registrationConfirmationTemplate } from '../src/lib/email/templates/registrationConfirmation';
import { resendRegistrationIdTemplate }     from '../src/lib/email/templates/resendRegistrationId';
import { quizResultTemplate }               from '../src/lib/email/templates/quizResult';
import { certificateIssuedTemplate }        from '../src/lib/email/templates/certificateIssued';
import { lockedOutTemplate }                from '../src/lib/email/templates/lockedOut';
import { passwordResetTemplate }            from '../src/lib/email/templates/passwordReset';
import { accountConfirmationTemplate }      from '../src/lib/email/templates/accountConfirmation';

// ── Change this to your test inbox ───────────────────────────────────────────
const TEST_TO = process.env.TEST_EMAIL ?? 'your-test@email.com';

async function run() {
  console.log(`\nSending test emails to: ${TEST_TO}\n`);

  const tests: Array<{ label: string; fn: () => Promise<unknown> }> = [
    {
      label: '[training@] OTP Verification',
      fn: async () => {
        const t = await otpVerificationTemplate({ code: '847291', expiresMinutes: 10 });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Registration Confirmation',
      fn: async () => {
        const t = await registrationConfirmationTemplate({
          name: 'Test User',
          registrationId: 'FMP-2026-TEST',
          courseName: '3-Statement Financial Modeling',
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Resend Registration ID',
      fn: async () => {
        const t = await resendRegistrationIdTemplate({ name: 'Test User', registrationId: 'FMP-2026-TEST' });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Quiz Result — Passed',
      fn: async () => {
        const t = await quizResultTemplate({
          name: 'Test User', sessionName: 'Session 3 — Income Statement',
          score: 85, passMark: 70, passed: true, attemptsUsed: 1, maxAttempts: 3,
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Quiz Result — Failed',
      fn: async () => {
        const t = await quizResultTemplate({
          name: 'Test User', sessionName: 'Session 3 — Income Statement',
          score: 55, passMark: 70, passed: false, attemptsUsed: 2, maxAttempts: 3,
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Certificate Issued',
      fn: async () => {
        const t = await certificateIssuedTemplate({
          studentName: 'Test User',
          courseName: '3-Statement Financial Modeling',
          verificationUrl: 'https://financialmodelerpro.com/verify/test-uuid',
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[training@] Locked Out',
      fn: async () => {
        const t = await lockedOutTemplate({
          name: 'Test User', sessionName: 'Final Exam',
          attemptsUsed: 3, maxAttempts: 3,
          reason: 'Maximum attempts reached.',
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.training });
      },
    },
    {
      label: '[no-reply@] Password Reset',
      fn: async () => {
        const t = await passwordResetTemplate({
          resetUrl: 'https://financialmodelerpro.com/reset-password?token=test-token-123',
          expiresMinutes: 60,
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.noreply });
      },
    },
    {
      label: '[no-reply@] Account Confirmation',
      fn: async () => {
        const t = await accountConfirmationTemplate({
          name: 'Test User',
          email: TEST_TO,
          confirmUrl: 'https://financialmodelerpro.com/confirm-email?token=test-token-456',
        });
        return sendEmail({ to: TEST_TO, ...t, from: FROM.noreply });
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`  ✓ ${test.label}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${test.label}`);
      console.error(`    Error: ${String(err)}`);
      failed++;
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone: ${passed} passed, ${failed} failed\n`);
}

run().catch(console.error);
