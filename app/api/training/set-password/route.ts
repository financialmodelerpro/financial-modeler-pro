/**
 * POST /api/training/set-password
 * Allows a student to set (or reset) their password.
 * Identity is confirmed by verifying a one-time code that was emailed to them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      registrationId?: string;
      email?: string;
      code?: string;
      password?: string;
    };

    const regId    = body.registrationId?.trim() ?? '';
    const email    = body.email?.trim().toLowerCase() ?? '';
    const code     = body.code?.trim() ?? '';
    const password = body.password ?? '';

    if (!regId || !email) {
      return NextResponse.json({ success: false, error: 'Registration ID and email are required.' }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ success: false, error: 'Verification code is required.' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    const sb = getServerClient();

    // ── Verify OTP ────────────────────────────────────────────────────────────
    const { data: otp } = await sb
      .from('training_email_otps')
      .select('id, code, expires_at, used')
      .eq('email', email)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      return NextResponse.json(
        { success: false, error: 'No active verification code found. Please request a new one.' },
        { status: 400 },
      );
    }
    if (new Date(otp.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Verification code has expired. Please request a new one.' },
        { status: 400 },
      );
    }
    if (otp.code !== code) {
      return NextResponse.json(
        { success: false, error: 'Incorrect verification code. Please try again.' },
        { status: 400 },
      );
    }

    // Mark OTP as used (consume it)
    await sb.from('training_email_otps').update({ used: true }).eq('id', otp.id);

    // ── Save new password ─────────────────────────────────────────────────────
    const hash = await bcrypt.hash(password, 10);

    await sb.from('training_passwords').upsert(
      { registration_id: regId, password_hash: hash },
      { onConflict: 'registration_id' },
    );

    // Ensure lookup table entry exists
    await sb.from('training_registrations_meta').upsert(
      { registration_id: regId, email },
      { onConflict: 'registration_id' },
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
