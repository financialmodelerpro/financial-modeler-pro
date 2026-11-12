/**
 * POST /api/auth/device-verify
 *
 * Action: "send"  → sends a 6-digit OTP to email for device verification
 * Action: "check" → verifies OTP; trusts the device for 30 days (2 hours if
 *                   the user unticked "trust this device"). The cookie is
 *                   shared across every FMP site (deviceTrust.ts rule 2).
 */

import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/core/db/supabase';
import {
  trustDevice, buildTrustCookieHeader, normaliseTrustIdentifier,
  TRUST_TTL_MS, COOKIE_MAX_AGE, SESSION_TRUST_MAX_AGE,
} from '@/src/shared/auth/deviceTrust';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { deviceVerificationTemplate } from '@/src/shared/email/templates/deviceVerification';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'send' | 'check';
      email: string;
      code?: string;
      trustDevice?: boolean;
    };

    const { action, code } = body;
    if (!body.email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
    const email = normaliseTrustIdentifier(body.email);

    if (action === 'send') {
      const otp = String(crypto.randomInt(100000, 999999));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Invalidate previous unused OTPs for this email
      await serverClient
        .from('modeling_email_otps')
        .update({ used: true })
        .eq('email', email)
        .is('used', false);

      await serverClient.from('modeling_email_otps').insert({
        email,
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
        .eq('email', email)
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
      // 30-day trust unless the user unticked the box, then 2-hour trust.
      // Absent means trusted (the box defaults to ticked on every form).
      const isPersistent = body.trustDevice !== false;
      const ttlMs        = isPersistent ? TRUST_TTL_MS : SESSION_TRUST_MAX_AGE * 1000;
      const cookieMaxAge = isPersistent ? COOKIE_MAX_AGE : SESSION_TRUST_MAX_AGE;
      // The identifier is ALWAYS the lowercased email: the sign-in check
      // compares against the email on file, so a user id or a typed capital
      // would be a trust that never matches.
      const token        = await trustDevice(email, 'modeling', ttlMs);
      response.headers.append(
        'Set-Cookie',
        buildTrustCookieHeader(token, { host: req.headers.get('host'), secure: process.env.NODE_ENV === 'production', maxAge: cookieMaxAge }),
      );

      return response;
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[auth/device-verify]', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
