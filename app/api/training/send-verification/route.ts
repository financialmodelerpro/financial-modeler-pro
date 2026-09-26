/**
 * POST /api/training/send-verification
 * Emails a 6-digit password-reset code to a Training Hub student.
 *
 * Body: { email?: string, registrationId?: string }  (the email alone is enough
 * unless it is on more than one account)
 *
 * Rebuilt 2026-09-26 (studentLookup.ts has the measured reason): identity is
 * resolved through the ONE lookup rule, the code goes to the email ON FILE
 * (never a typed address), the answer names where it went (masked) or says
 * exactly what to do instead, every refusal is logged with its reason, and
 * sends are rate limited per student and per address.
 *
 * Returns:
 *   200 { success: true, sentTo }                  code sent
 *   400 { success: false, reason, error }          missing / not found
 *   409 { success: false, reason: 'ambiguous', needsRegistrationId: true, error }
 *   429 { success: false, reason: 'rate_limited', error }
 *   502 { success: false, reason: 'send_failed', error }  the email provider refused
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { otpVerificationTemplate } from '@/src/shared/email/templates/otpVerification';
import { rateLimited } from '@/src/shared/api/rateLimit';
import { lookupStudent, maskEmail, LOOKUP_MESSAGES } from '@/src/hubs/training/lib/auth/studentLookup';
import crypto from 'crypto';

const CODE_MINUTES = 10;

function generateOTP(): string {
  return Math.floor(100000 + crypto.randomInt(900000)).toString();
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  let body: { email?: string; registrationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 }); }

  // Per address: stops one client spraying codes at many students.
  if (rateLimited('training-reset-send-ip', clientIp(req), 20, 15 * 60_000)) {
    console.warn('[send-verification] refused: rate_limited (ip)');
    return NextResponse.json({ success: false, reason: 'rate_limited', error: 'Too many requests. Please wait a few minutes and try again.' }, { status: 429 });
  }

  try {
    const sb = getServerClient();
    const found = await lookupStudent(sb, body);
    if (!found.ok) {
      console.warn(`[send-verification] refused: ${found.reason} (accounts on email: ${found.accounts})`);
      return NextResponse.json(
        { success: false, reason: found.reason, needsRegistrationId: found.reason === 'ambiguous', error: LOOKUP_MESSAGES[found.reason] },
        { status: found.reason === 'ambiguous' ? 409 : 400 },
      );
    }
    const email = found.student.email.trim().toLowerCase();   // the email ON FILE

    // Per student: a resend button pressed repeatedly still gets through, a flood does not.
    if (rateLimited('training-reset-send-email', email, 5, 15 * 60_000)) {
      console.warn(`[send-verification] refused: rate_limited (student ${found.student.registration_id})`);
      return NextResponse.json({ success: false, reason: 'rate_limited', error: 'Several codes were sent in the last few minutes. Please check your inbox and spam folder, or wait 15 minutes and try again.' }, { status: 429 });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + CODE_MINUTES * 60 * 1000).toISOString();

    // One live code per email: older unused codes stop working.
    await sb.from('training_email_otps').update({ used: true }).eq('email', email).eq('used', false);
    const { error } = await sb.from('training_email_otps').insert({ email, code, expires_at: expiresAt });
    if (error) {
      console.error('[send-verification] could not store the code:', error.message);
      return NextResponse.json({ success: false, reason: 'store_failed', error: 'Could not create a code. Please try again.' }, { status: 500 });
    }

    try {
      const { subject, html, text } = await otpVerificationTemplate({ code, expiresMinutes: CODE_MINUTES, purpose: 'password_reset' });
      const sent = await sendEmail({ to: email, subject, html, text, from: FROM.training });
      console.info(`[send-verification] sent to student ${found.student.registration_id}, provider id ${sent.id ?? 'none'}`);
    } catch (emailErr) {
      console.error('[send-verification] email provider refused:', emailErr);
      // A code nobody received must not stay live.
      await sb.from('training_email_otps').update({ used: true }).eq('email', email).eq('code', code);
      return NextResponse.json(
        { success: false, reason: 'send_failed', error: 'We could not send the email just now. Please try again in a minute, or contact support@financialmodelerpro.com.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, sentTo: maskEmail(email) });
  } catch (e) {
    console.error('[send-verification] unexpected:', e);
    return NextResponse.json({ success: false, reason: 'error', error: 'An unexpected error occurred. Please try again.' }, { status: 500 });
  }
}
