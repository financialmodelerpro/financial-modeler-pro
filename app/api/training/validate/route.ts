/**
 * POST /api/training/validate
 * Validates Registration ID + Email (via Apps Script), then optionally checks password.
 *
 * Password is stored in Supabase training_passwords table.
 * Run this migration if not already done:
 * ─────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS training_passwords (
 *   registration_id text PRIMARY KEY,
 *   password_hash   text NOT NULL,
 *   created_at      timestamptz DEFAULT now()
 * );
 * ─────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; registrationId?: string; password?: string };
    const { email, registrationId, password } = body;

    if (!email || !registrationId) {
      return NextResponse.json(
        { success: false, error: 'email and registrationId are required' },
        { status: 400 },
      );
    }

    const result = await validateStudent(
      email.trim().toLowerCase(),
      registrationId.trim(),
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or Registration ID.' },
        { status: 401 },
      );
    }

    const sb = getServerClient();

    // Check if student is blocked by admin
    try {
      const { data: blockRecord } = await sb
        .from('training_admin_actions')
        .select('id')
        .eq('registration_id', registrationId.trim())
        .eq('action_type', 'block')
        .eq('is_active', true)
        .maybeSingle();
      if (blockRecord) {
        return NextResponse.json(
          { success: false, error: 'Your account has been suspended. Please contact support@financialmodelerpro.com' },
          { status: 403 },
        );
      }
    } catch {
      // Fail open — don't lock out students due to DB issues
    }

    // Password check (if password is set for this registration)
    try {
      const { data: pwRow } = await sb
        .from('training_passwords')
        .select('password_hash')
        .eq('registration_id', registrationId.trim())
        .maybeSingle();

      if (pwRow) {
        // A password has been set — must validate it
        if (!password) {
          return NextResponse.json(
            { success: false, error: 'Password is required for this account.', requiresPassword: true },
            { status: 401 },
          );
        }
        const match = await bcrypt.compare(password, pwRow.password_hash);
        if (!match) {
          return NextResponse.json(
            { success: false, error: 'Incorrect password.' },
            { status: 401 },
          );
        }
      }
    } catch {
      // If password table doesn't exist yet, skip check — fail open
    }

    // Set an httpOnly cookie so the server-side progress API can read the session
    const response = NextResponse.json({ success: true, data: result.data });
    response.cookies.set('training_session', JSON.stringify({ email: email.trim().toLowerCase(), registrationId: registrationId.trim() }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
