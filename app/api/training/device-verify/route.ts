/**
 * POST /api/training/device-verify
 *
 * Action: "send"  → sends a 6-digit OTP to email for device verification
 * Action: "check" → verifies OTP; optionally trusts device
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { trustDevice, buildTrustCookieHeader } from '@/src/lib/shared/deviceTrust';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { deviceVerificationTemplate } from '@/src/lib/email/templates/deviceVerification';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'send' | 'check';
      email: string;
      registrationId?: string;
      code?: string;
      trustDevice?: boolean;
    };

    const { action, email, registrationId, code } = body;
    if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

    const sb = getServerClient();

    if (action === 'send') {
      // Generate 6-digit OTP and store in training_email_otps
      const otp = String(crypto.randomInt(100000, 999999));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Invalidate previous unused device OTPs for this email
      await sb
        .from('training_email_otps')
        .update({ used: true })
        .eq('email', email.toLowerCase())
        .is('used', false);

      await sb.from('training_email_otps').insert({
        email: email.toLowerCase(),
        code: otp,
        expires_at: expiresAt,
        used: false,
      });

      const { subject, html } = await deviceVerificationTemplate({ code: otp });
      await sendEmail({ to: email, subject, html, from: FROM.noreply });

      return NextResponse.json({ success: true });
    }

    if (action === 'check') {
      if (!code) return NextResponse.json({ success: false, error: 'code required' }, { status: 400 });

      const { data: otpRow } = await sb
        .from('training_email_otps')
        .select('id')
        .eq('email', email.toLowerCase())
        .eq('code', code)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (!otpRow) {
        return NextResponse.json({ success: false, error: 'Invalid or expired code.' }, { status: 401 });
      }

      // Mark OTP as used
      await sb.from('training_email_otps').update({ used: true }).eq('id', otpRow.id);

      const response = NextResponse.json({ success: true });

      // Trust device if requested - always use email as identifier (consistent with isDeviceTrusted)
      if (body.trustDevice && email) {
        const token = await trustDevice(email.toLowerCase(), 'training');
        response.headers.append(
          'Set-Cookie',
          buildTrustCookieHeader(token, process.env.NODE_ENV === 'production'),
        );
      }

      return response;
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[training/device-verify]', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
