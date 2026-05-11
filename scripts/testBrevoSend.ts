/**
 * scripts/testBrevoSend.ts
 *
 * One-off diagnostic for the Resend -> Brevo migration. Calls the same
 * `sendEmail()` wrapper a production route would call and prints the exact
 * Brevo response (or error). This is a DIAGNOSTIC tool, not part of the
 * runtime.
 *
 * Usage:
 *   BREVO_API_KEY=<real-key> \
 *   EMAIL_FROM_TRAINING=training@financialmodelerpro.com \
 *   EMAIL_FROM_NOREPLY=no-reply@financialmodelerpro.com \
 *   npx tsx scripts/testBrevoSend.ts <recipient@example.com>
 *
 * Without BREVO_API_KEY set, the script will still try and we'll observe
 * the SDK error (UnauthorizedError, etc.) to confirm Brevo's reply path.
 *
 * What this proves:
 *   - The `sendEmail()` wrapper actually awaits the Brevo HTTP request.
 *   - The Brevo SDK is reachable from this machine (network + auth).
 *   - The sender shape parsed from EMAIL_FROM_TRAINING is what Brevo expects.
 *   - Any 4xx/5xx Brevo returns gets surfaced rather than swallowed.
 */

// dotenv is not a project dep; pass env vars inline on the command line:
//   BREVO_API_KEY=<key> EMAIL_FROM_TRAINING=<addr> npx tsx scripts/testBrevoSend.ts <recipient>

import { sendEmail, FROM } from '../src/shared/email/sendEmail';

async function main(): Promise<void> {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error('Usage: npx tsx scripts/testBrevoSend.ts <recipient@example.com>');
    process.exit(2);
  }

  console.log('--- Brevo send diagnostic ---');
  console.log('BREVO_API_KEY present:', Boolean(process.env.BREVO_API_KEY));
  console.log('BREVO_API_KEY length :', process.env.BREVO_API_KEY?.length ?? 0);
  console.log('EMAIL_FROM_TRAINING  :', process.env.EMAIL_FROM_TRAINING ?? '(unset; using fallback)');
  console.log('EMAIL_FROM_NOREPLY   :', process.env.EMAIL_FROM_NOREPLY ?? '(unset; using fallback)');
  console.log('Resolved FROM.training:', FROM.training);
  console.log('Resolved FROM.noreply :', FROM.noreply);
  console.log('Recipient            :', recipient);
  console.log('');

  try {
    const result = await sendEmail({
      to:      recipient,
      subject: '[FMP Diagnostic] Brevo migration smoke test',
      html:    '<p>If you see this, the Brevo wrapper is working end-to-end.</p>',
      text:    'If you see this, the Brevo wrapper is working end-to-end.',
      from:    FROM.training,
    });
    console.log('OK: sendEmail returned', result);
  } catch (err) {
    console.error('FAIL: sendEmail threw');
    if (err instanceof Error) {
      console.error('  name   :', err.name);
      console.error('  message:', err.message);
      const anyErr = err as Error & { statusCode?: number; rawResponse?: { status?: number; headers?: Record<string, unknown>; body?: unknown } };
      if (anyErr.statusCode !== undefined) console.error('  status :', anyErr.statusCode);
      if (anyErr.rawResponse) {
        console.error('  raw HTTP status :', anyErr.rawResponse.status);
        console.error('  raw HTTP headers:', anyErr.rawResponse.headers);
        console.error('  raw HTTP body   :', anyErr.rawResponse.body);
      }
      if (err.stack) console.error('  stack  :', err.stack.split('\n').slice(0, 5).join('\n'));
    } else {
      console.error('  err  :', err);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Uncaught:', err);
  process.exit(1);
});
