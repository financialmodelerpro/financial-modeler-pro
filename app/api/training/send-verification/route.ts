/**
 * POST /api/training/send-verification
 * Generates a 6-digit OTP, stores it in Supabase, then emails it via Apps Script.
 *
 * Run this migration in Supabase before use:
 * ─────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS training_email_otps (
 *   id         uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
 *   email      text    NOT NULL,
 *   code       text    NOT NULL,
 *   expires_at timestamptz NOT NULL,
 *   used       boolean DEFAULT false,
 *   created_at timestamptz DEFAULT now()
 * );
 * CREATE INDEX IF NOT EXISTS idx_email_otps_email ON training_email_otps(email);
 * ─────────────────────────────────────────
 *
 * Apps Script — add this handler to Code.gs:
 * ─────────────────────────────────────────
 * function sendVerificationCode(email, code) {
 *   var subject = 'Your FMP Email Verification Code';
 *   var body = 'Your verification code is: ' + code + '\n\nThis code expires in 10 minutes.';
 *   GmailApp.sendEmail(email, subject, body);
 *   return { success: true };
 * }
 * // In doPost, add case 'sendVerificationCode':
 * //   return ContentService.createTextOutput(
 * //     JSON.stringify(sendVerificationCode(e.parameter.email, e.parameter.code))
 * //   ).setMimeType(ContentService.MimeType.JSON);
 * ─────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';
import crypto from 'crypto';

function generateOTP(): string {
  // 6-digit numeric code
  return Math.floor(100000 + crypto.randomInt(900000)).toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    }

    const code      = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    const sb = getServerClient();

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

    // Send via Apps Script
    try {
      const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
      let scriptUrl = APPS_SCRIPT_URL;
      if (!scriptUrl) {
        const { data } = await sb.from('training_settings').select('value').eq('key', 'apps_script_url').single();
        scriptUrl = data?.value ?? '';
      }
      if (scriptUrl) {
        const url = new URL(scriptUrl);
        url.searchParams.set('action', 'sendVerificationCode');
        url.searchParams.set('email', email);
        url.searchParams.set('code', code);
        await fetch(url.toString(), { cache: 'no-store' });
      }
    } catch {
      // Email sending failed — code still generated; UI will show error
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
