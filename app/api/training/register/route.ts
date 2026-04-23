import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { verifyCaptcha } from '@/src/lib/shared/captcha';
import { createConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { confirmEmailTemplate } from '@/src/lib/email/templates/confirmEmail';
import { getTrainingRegisterComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { isTrainingIdentifierBypassed } from '@/src/lib/shared/hubBypassList';
import bcrypt from 'bcryptjs';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      email?: string;
      course?: string; // optional, retained for backward compat; new form doesn't send it
      phone?: string;
      city?: string;
      country?: string;
      password?: string;
      captchaToken?: string;
      redirect?: string;
    };
    const { name, email, course, phone, city, country, password, captchaToken, redirect } = body;

    if (!name || !email) {
      return NextResponse.json({ success: false, error: 'name and email are required' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (!captchaToken) {
      return NextResponse.json({ success: false, error: 'Captcha verification required.' }, { status: 400 });
    }

    // Phone is required for new signups (FIX 2). Format check mirrors the
    // client: E.164, '+' followed by 7 to 15 digits, leading non-zero.
    // Pre-existing rows with phone IS NULL keep working because that path
    // never re-runs through this endpoint; sign-in does not re-validate
    // the phone column.
    const phoneClean = (phone ?? '').replace(/\s+/g, '');
    if (!phoneClean) {
      return NextResponse.json({ success: false, error: 'Phone number is required.' }, { status: 400 });
    }
    if (!/^\+[1-9]\d{6,14}$/.test(phoneClean)) {
      return NextResponse.json({ success: false, error: 'Phone number must be in international format (e.g. +12025550123).' }, { status: 400 });
    }

    // Verify captcha
    const captchaValid = await verifyCaptcha(captchaToken);
    if (!captchaValid) {
      return NextResponse.json({ success: false, error: 'Captcha verification failed. Please try again.' }, { status: 400 });
    }

    const normalEmail = email.trim().toLowerCase();

    // Pre-launch gate: registration uses its OWN Coming Soon toggle
    // (migration 135), independent from signin. Identifiers on the
    // Training Hub bypass list (migration 121) skip the gate so
    // pre-launch QA can register test accounts even while the register
    // page is closed to the public. Matches the triple-defence shape on
    // the signin page: server-gated page renders the countdown, client
    // wrapper accepts ?bypass=true, API rejects direct POSTs with a
    // comingSoon flag.
    const comingSoon = await getTrainingRegisterComingSoonState();
    if (comingSoon.enabled) {
      const bypassed = await isTrainingIdentifierBypassed(normalEmail);
      if (!bypassed) {
        return NextResponse.json(
          {
            success:    false,
            comingSoon: true,
            launchDate: comingSoon.launchDate,
            error:      'Registration opens at launch. Join the waitlist from the launch page and we\'ll notify you.',
          },
          { status: 403 },
        );
      }
    }

    const sb = getServerClient();

    // Check if already confirmed (existing account)
    const { data: existing } = await sb
      .from('training_registrations_meta')
      .select('registration_id, email_confirmed')
      .eq('email', normalEmail)
      .maybeSingle();

    if (existing?.email_confirmed) {
      return NextResponse.json({ success: false, duplicate: true });
    }

    // Upsert pending registration (replace any previous unconfirmed attempt).
    // Course is nullable (migration 131); the new form doesn't collect it
    // but we persist whatever the client sent for backward compat with any
    // old cached form.
    const password_hash = await bcrypt.hash(password, 10);
    const { error: pendingErr } = await sb.from('training_pending_registrations').upsert({
      email:         normalEmail,
      name:          name.trim(),
      course:        course?.trim() || null,
      phone:         phoneClean,
      city:          city?.trim()   || null,
      country:       country?.trim() || null,
      password_hash,
    }, { onConflict: 'email' });

    if (pendingErr) {
      return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 500 });
    }

    // Create and send confirmation email. Preserve a same-origin
    // `redirect` so the post-confirm signin lands on the originating
    // page (FIX 3, 2026-04-23). Reject anything that isn't a plain
    // path - protocol-relative or absolute URLs are dropped to prevent
    // open-redirect via the email link.
    const safeRedirect = (() => {
      if (!redirect) return '';
      if (redirect.startsWith('//') || /^https?:/i.test(redirect)) return '';
      if (!redirect.startsWith('/')) return '';
      return redirect;
    })();
    const token      = await createConfirmationToken(normalEmail, 'training');
    const confirmUrl = safeRedirect
      ? `${LEARN_URL}/training/confirm-email?token=${token}&redirect=${encodeURIComponent(safeRedirect)}`
      : `${LEARN_URL}/training/confirm-email?token=${token}`;
    const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'training' });

    await sendEmail({ to: normalEmail, subject, html, from: FROM.training });

    return NextResponse.json({ success: true, message: 'Please check your email to confirm your account.' });
  } catch (err) {
    console.error('[training/register]', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
