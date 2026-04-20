/**
 * POST /api/training/validate
 * Sign in with Registration ID OR Email + password (required).
 *
 * Body: { identifier, password, secondField? }
 *
 * Returns:
 *   { success: true, email, registrationId }           - fully authenticated
 *   { requiresDeviceVerification: true, email, registrationId } - new device
 *   { needsBoth: true, provide }                        - lookup needs both fields
 *   { needsPasswordSetup: true }                        - no password set
 *   { success: false, error }                           - auth failure
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateStudent } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';
import { isDeviceTrusted } from '@/src/lib/shared/deviceTrust';
import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { isTrainingIdentifierBypassed } from '@/src/lib/shared/hubBypassList';
import bcrypt from 'bcryptjs';

const SESSION_MAX_AGE = 60 * 60; // 1 hour

export async function POST(req: NextRequest) {
  let body: {
    identifier?: string;
    password?: string;
    secondField?: string;
    email?: string;
    registrationId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const rawIdentifier = (body.identifier ?? body.email ?? '').trim();
  const rawSecond     = (body.secondField ?? body.registrationId ?? '').trim();
  const password      = body.password ?? '';

  // Pre-launch gate: signin is blocked while Coming Soon is ON even though
  // registration stays open. Identifiers on the Training Hub bypass list
  // (platform owner + testers, seeded in migration 121, edit via the
  // `training_hub_bypass_list` key in training_settings) skip the gate so
  // pre-launch QA can proceed without flipping the hub state. Match is
  // case-insensitive against both the identifier field and the optional
  // second field (so logging in with an email + regId combo works even
  // if only one of them is listed).
  const comingSoon = await getTrainingComingSoonState();
  if (comingSoon.enabled) {
    const bypassed =
      (await isTrainingIdentifierBypassed(rawIdentifier)) ||
      (await isTrainingIdentifierBypassed(rawSecond));
    if (!bypassed) {
      return NextResponse.json(
        {
          success:    false,
          comingSoon: true,
          launchDate: comingSoon.launchDate,
          error:      'Sign-in opens at launch. You can register now and we\'ll have your account ready.',
        },
        { status: 403 },
      );
    }
  }

  try {

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

      // Block students who registered but haven't confirmed their email yet.
      // But first check if they already have a confirmed meta row - a stale pending row
      // can exist if a student tried to re-register after already being confirmed.
      const { data: pending } = await sb
        .from('training_pending_registrations')
        .select('email')
        .eq('email', email)
        .maybeSingle();
      if (pending) {
        // Check if they're already confirmed in meta - stale pending row
        const { data: metaConfirmed } = await sb
          .from('training_registrations_meta')
          .select('email_confirmed')
          .eq('email', email)
          .maybeSingle();
        if (metaConfirmed?.email_confirmed !== false) {
          // email_confirmed is true or null (pre-027 student) - treat as confirmed, clean up stale row
          await sb.from('training_pending_registrations').delete().eq('email', email);
        } else {
          return NextResponse.json({
            success: false,
            emailNotConfirmed: true,
            email,
            error: 'Please confirm your email address before signing in. Check your inbox for the confirmation link.',
          }, { status: 200 });
        }
      }

      if (rawSecond) {
        regId = rawSecond.toUpperCase();
      } else {
        const { data } = await sb
          .from('training_registrations_meta')
          .select('registration_id')
          .eq('email', email)
          .maybeSingle();
        if (!data?.registration_id) {
          return NextResponse.json({
            success: false, needsBoth: true, provide: 'registrationId',
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
        const { data } = await sb
          .from('training_registrations_meta')
          .select('email')
          .eq('registration_id', regId)
          .maybeSingle();
        if (!data?.email) {
          return NextResponse.json({
            success: false, needsBoth: true, provide: 'email',
            error: 'Please also provide your email address.',
          }, { status: 200 });
        }
        email = data.email;
      }
    }

    // Validate against Apps Script
    const result = await validateStudent(email, regId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials. Please check your details.' },
        { status: 401 },
      );
    }

    // Check blocked
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

    // Password check
    try {
      const { data: pwRow } = await sb
        .from('training_passwords')
        .select('password_hash')
        .eq('registration_id', regId)
        .maybeSingle();

      if (!pwRow) {
        return NextResponse.json({
          success: false, needsPasswordSetup: true,
          error: 'No password set for this account.',
          email, registrationId: regId,
        }, { status: 401 });
      }

      const match = await bcrypt.compare(password, pwRow.password_hash);
      if (!match) {
        return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ success: false, error: 'Authentication error. Please try again.' }, { status: 500 });
    }

    // Block if email_confirmed explicitly false (edge case - null means pre-027 confirmed user)
    const { data: metaRow } = await sb
      .from('training_registrations_meta')
      .select('email_confirmed')
      .eq('email', email)
      .maybeSingle();
    if (metaRow?.email_confirmed === false) {
      return NextResponse.json({
        success: false,
        emailNotConfirmed: true,
        email,
        error: 'Please confirm your email address before signing in. Check your inbox for the confirmation link.',
      }, { status: 200 });
    }

    // Device trust check - use email as identifier (matches how trustDevice stores it)
    const deviceCookie = req.cookies.get('fmp-trusted-device')?.value;
    const trusted = await isDeviceTrusted(deviceCookie, email, 'training');

    if (!trusted) {
      return NextResponse.json({
        success: false,
        requiresDeviceVerification: true,
        email,
        registrationId: regId,
      });
    }

    // Fully authenticated - set session cookie
    const response = NextResponse.json({ success: true, email, registrationId: regId });
    response.cookies.set(
      'training_session',
      JSON.stringify({ email, registrationId: regId }),
      { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE },
    );
    return response;

  } catch {
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
