/**
 * POST /api/training/set-password
 * Allows a student to set (or reset) their password after verifying identity.
 * Identity is verified against Apps Script using Registration ID + Email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      registrationId?: string;
      email?: string;
      password?: string;
    };

    const regId    = body.registrationId?.trim() ?? '';
    const email    = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';

    if (!regId || !email) {
      return NextResponse.json({ success: false, error: 'Registration ID and email are required.' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    // Verify identity via Apps Script
    const result = await validateStudent(email, regId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'We could not verify your identity. Check your Registration ID and email.' },
        { status: 401 },
      );
    }

    // Save / update password hash in Supabase
    const sb = getServerClient();
    const hash = await bcrypt.hash(password, 10);

    await sb.from('training_passwords').upsert(
      { registration_id: regId, password_hash: hash },
      { onConflict: 'registration_id' },
    );

    // Also ensure the lookup table entry exists
    await sb.from('training_registrations_meta').upsert(
      { registration_id: regId, email },
      { onConflict: 'registration_id' },
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
