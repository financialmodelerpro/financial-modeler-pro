/**
 * POST /api/training/validate
 * Sign in with Registration ID OR Email + password (required).
 *
 * Body: { identifier: string; password: string; secondField?: string }
 *   identifier  — Registration ID (e.g. FMP-2026-XXXX) OR email address
 *   password    — required for all accounts
 *   secondField — only needed when the first lookup couldn't resolve the other credential
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      identifier?: string;
      password?: string;
      secondField?: string;
      // Legacy fields kept for backwards-compat with any direct API callers
      email?: string;
      registrationId?: string;
    };

    // ── Resolve identifier & secondField (with legacy fallback) ───────────────
    const rawIdentifier = (body.identifier ?? body.email ?? '').trim();
    const rawSecond     = (body.secondField ?? body.registrationId ?? '').trim();
    const password      = body.password ?? '';

    if (!rawIdentifier) {
      return NextResponse.json({ success: false, error: 'Please enter your Registration ID or email.' }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ success: false, error: 'Password is required.' }, { status: 400 });
    }

    const isEmail = rawIdentifier.includes('@');
    const sb = getServerClient();

    let email: string;
    let regId: string;

    if (isEmail) {
      email = rawIdentifier.toLowerCase();
      if (rawSecond) {
        regId = rawSecond.toUpperCase();
      } else {
        // Look up Registration ID from Supabase lookup table
        const { data } = await sb
          .from('training_registrations_meta')
          .select('registration_id')
          .eq('email', email)
          .maybeSingle();
        if (!data?.registration_id) {
          return NextResponse.json({
            success: false,
            needsBoth: true,
            provide: 'registrationId',
            error: 'Please also provide your Registration ID.',
          }, { status: 200 });
        }
        regId = data.registration_id;
      }
    } else {
      regId = rawIdentifier.toUpperCase();
      if (rawSecond) {
        email = rawSecond.toLowerCase();
      } else {
        // Look up email from Supabase lookup table
        const { data } = await sb
          .from('training_registrations_meta')
          .select('email')
          .eq('registration_id', regId)
          .maybeSingle();
        if (!data?.email) {
          return NextResponse.json({
            success: false,
            needsBoth: true,
            provide: 'email',
            error: 'Please also provide your email address.',
          }, { status: 200 });
        }
        email = data.email;
      }
    }

    // ── Validate against Apps Script (source of truth) ────────────────────────
    const result = await validateStudent(email, regId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials. Please check your details.' },
        { status: 401 },
      );
    }

    // ── Check if account is blocked ───────────────────────────────────────────
    try {
      const { data: blockRecord } = await sb
        .from('training_admin_actions')
        .select('id')
        .eq('registration_id', regId)
        .eq('action_type', 'block')
        .eq('is_active', true)
        .maybeSingle();
      if (blockRecord) {
        return NextResponse.json(
          { success: false, error: 'Your account has been suspended. Please contact support@financialmodelerpro.com' },
          { status: 403 },
        );
      }
    } catch { /* fail open */ }

    // ── Password check (always required) ─────────────────────────────────────
    try {
      const { data: pwRow } = await sb
        .from('training_passwords')
        .select('password_hash')
        .eq('registration_id', regId)
        .maybeSingle();

      if (!pwRow) {
        // No password set — direct them to set one up
        return NextResponse.json({
          success: false,
          needsPasswordSetup: true,
          error: 'No password set for this account.',
          email,
          registrationId: regId,
        }, { status: 401 });
      }

      const match = await bcrypt.compare(password, pwRow.password_hash);
      if (!match) {
        return NextResponse.json(
          { success: false, error: 'Incorrect password.' },
          { status: 401 },
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Authentication error. Please try again.' },
        { status: 500 },
      );
    }

    // ── Success — set session cookie ──────────────────────────────────────────
    const response = NextResponse.json({ success: true, email, registrationId: regId });
    response.cookies.set(
      'training_session',
      JSON.stringify({ email, registrationId: regId }),
      { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 },
    );
    return response;

  } catch {
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
