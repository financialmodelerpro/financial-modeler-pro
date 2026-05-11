/**
 * POST /api/training/send-verification
 * Generates a 6-digit OTP, stores it in Supabase, then emails it via Resend.
 *
 * Supabase table required:
 * CREATE TABLE IF NOT EXISTS training_email_otps (
 *   id         uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
 *   email      text    NOT NULL,
 *   code       text    NOT NULL,
 *   expires_at timestamptz NOT NULL,
 *   used       boolean DEFAULT false,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE INDEX IF NOT EXISTS idx_email_otps_email ON training_email_otps(email);
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { otpVerificationTemplate } from '@/src/shared/email/templates/otpVerification';
import crypto from 'crypto';

function generateOTP(): string {
  // 6-digit numeric code
  return Math.floor(100000 + crypto.randomInt(900000)).toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; registrationId?: string };
    const email  = body.email?.trim().toLowerCase();
    const regId  = body.registrationId?.trim();

    if (!email) {
      return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    }

    const sb = getServerClient();

    // If a registration ID is supplied (password-reset flow), verify
    // identity against Supabase before issuing an OTP.
    if (regId) {
      const { data: match } = await sb
        .from('training_registrations_meta')
        .select('registration_id')
        .eq('registration_id', regId)
        .eq('email', email)
        .maybeSingle();
      if (!match) {
        return NextResponse.json(
          { success: false, error: 'We could not verify your identity. Check your Registration ID and email.' },
          { status: 401 },
        );
      }
    }

    const code      = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Invalidate any previous unused OTPs for this email
    await sb.from('training_email_otps')
      .update({ used: true })
      .eq('email', email)
      .eq('used', false);

    // Insert new OTP
    const { error } = await sb.from('training_email_otps').insert({
      email,
      code,
      expires_at: expiresAt,
    });

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to generate code' }, { status: 500 });
    }

    // Send OTP via Brevo. The previous version swallowed errors silently
    // (empty catch + always returned success:true), which let the UI advance
    // to "check your email" over an OTP that was never delivered. Now we
    // log the underlying SDK error and surface a failure to the form so the
    // student gets a real signal instead of waiting indefinitely.
    try {
      const { subject, html, text } = await otpVerificationTemplate({ code, expiresMinutes: 10 });
      await sendEmail({ to: email, subject, html, text, from: FROM.training });
    } catch (emailErr) {
      console.error('[send-verification] Brevo send failed:', emailErr);
      return NextResponse.json(
        { success: false, error: 'Failed to send verification code. Please try again or contact support.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
