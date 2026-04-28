/**
 * POST /api/auth/device-verify
 *
 * Action: "send"  → sends a 6-digit OTP to email for device verification
 * Action: "check" → verifies OTP; optionally trusts device for 30 days
 */

import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/core/db/supabase';
import { trustDevice, buildTrustCookieHeader } from '@/src/shared/auth/deviceTrust';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { deviceVerificationTemplate } from '@/src/shared/email/templates/deviceVerification';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'send' | 'check';
      email: string;
      userId?: string;
      code?: string;
      trustDevice?: boolean;
    };

    const { action, email, userId, code } = body;
    if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

    if (action === 'send') {
      const otp = String(crypto.randomInt(100000, 999999));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Invalidate previous unused OTPs for this email
      await serverClient
        .from('modeling_email_otps')
        .update({ used: true })
        .eq('email', email.toLowerCase())
        .is('used', false);

      await serverClient.from('modeling_email_otps').insert({
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

      const { data: otpRow } = await serverClient
        .from('modeling_email_otps')
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
      await serverClient.from('modeling_email_otps').update({ used: true }).eq('id', otpRow.id);

      const response = NextResponse.json({ success: true });

      // Always set a trust cookie so the subsequent signIn() call passes authorize().
      // 30-day persistent trust if user checked the box, otherwise 2-hour session trust.
      const isPersistent = !!body.trustDevice;
      const ttlMs        = isPersistent ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
      const cookieMaxAge = isPersistent ? 30 * 24 * 60 * 60         : 2 * 60 * 60;
      const identifier   = userId ?? email;
      const token        = await trustDevice(identifier, 'modeling', ttlMs);
      response.headers.append(
        'Set-Cookie',
        buildTrustCookieHeader(token, process.env.NODE_ENV === 'production', cookieMaxAge),
      );

      return response;
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[auth/device-verify]', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
