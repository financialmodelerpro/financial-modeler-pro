/**
 * POST /api/email/send
 * Thin wrapper around the Resend email utility.
 * Used by Apps Script via UrlFetchApp to send branded emails from Next.js.
 *
 * Auth: Bearer token via RESEND_WEBHOOK_SECRET env var (optional but recommended).
 *
 * Body:
 *   template  — one of: otpVerification | registrationConfirmation | resendRegistrationId |
 *               quizResult | certificateIssued | lockedOut | passwordReset | accountConfirmation
 *   to        — recipient email address
 *   data      — template-specific payload (see each template file for fields)
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { otpVerificationTemplate }          from '@/src/lib/email/templates/otpVerification';
import { registrationConfirmationTemplate } from '@/src/lib/email/templates/registrationConfirmation';
import { resendRegistrationIdTemplate }     from '@/src/lib/email/templates/resendRegistrationId';
import { quizResultTemplate }               from '@/src/lib/email/templates/quizResult';
import { certificateIssuedTemplate }        from '@/src/lib/email/templates/certificateIssued';
import { lockedOutTemplate }                from '@/src/lib/email/templates/lockedOut';
import { passwordResetTemplate }            from '@/src/lib/email/templates/passwordReset';
import { accountConfirmationTemplate }      from '@/src/lib/email/templates/accountConfirmation';

// Training templates send from training@; system templates from no-reply@
const NOREPLY_TEMPLATES = new Set(['passwordReset', 'accountConfirmation']);

export async function POST(req: NextRequest) {
  // Optional bearer-token auth to prevent abuse
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: { template?: string; to?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { template, to, data = {} } = body;

  if (!template || !to) {
    return NextResponse.json({ error: 'template and to are required' }, { status: 400 });
  }

  let result: { subject: string; html: string; text: string };

  // data is untrusted JSON — cast via unknown so templates can validate at runtime
  const d = data as unknown;

  try {
    switch (template) {
      case 'otpVerification':
        result = otpVerificationTemplate(d as Parameters<typeof otpVerificationTemplate>[0]);
        break;
      case 'registrationConfirmation':
        result = registrationConfirmationTemplate(d as Parameters<typeof registrationConfirmationTemplate>[0]);
        break;
      case 'resendRegistrationId':
        result = resendRegistrationIdTemplate(d as Parameters<typeof resendRegistrationIdTemplate>[0]);
        break;
      case 'quizResult':
        result = quizResultTemplate(d as Parameters<typeof quizResultTemplate>[0]);
        break;
      case 'certificateIssued':
        result = certificateIssuedTemplate(d as Parameters<typeof certificateIssuedTemplate>[0]);
        break;
      case 'lockedOut':
        result = lockedOutTemplate(d as Parameters<typeof lockedOutTemplate>[0]);
        break;
      case 'passwordReset':
        result = passwordResetTemplate(d as Parameters<typeof passwordResetTemplate>[0]);
        break;
      case 'accountConfirmation':
        result = accountConfirmationTemplate(d as Parameters<typeof accountConfirmationTemplate>[0]);
        break;
      default:
        return NextResponse.json({ error: `Unknown template: ${template}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: `Template error: ${String(err)}` }, { status: 400 });
  }

  const from = NOREPLY_TEMPLATES.has(template) ? FROM.noreply : FROM.training;

  try {
    await sendEmail({ to, subject: result.subject, html: result.html, text: result.text, from });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: `Send failed: ${String(err)}` }, { status: 500 });
  }
}
