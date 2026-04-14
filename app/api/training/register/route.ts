import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { verifyCaptcha } from '@/src/lib/shared/captcha';
import { createConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { confirmEmailTemplate } from '@/src/lib/email/templates/confirmEmail';
import bcrypt from 'bcryptjs';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      email?: string;
      course?: string;
      phone?: string;
      city?: string;
      country?: string;
      password?: string;
      captchaToken?: string;
    };
    const { name, email, course, phone, city, country, password, captchaToken } = body;

    if (!name || !email || !course) {
      return NextResponse.json({ success: false, error: 'name, email, and course are required' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (!captchaToken) {
      return NextResponse.json({ success: false, error: 'Captcha verification required.' }, { status: 400 });
    }

    // Verify captcha
    const captchaValid = await verifyCaptcha(captchaToken);
    if (!captchaValid) {
      return NextResponse.json({ success: false, error: 'Captcha verification failed. Please try again.' }, { status: 400 });
    }

    const normalEmail = email.trim().toLowerCase();
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

    // Upsert pending registration (replace any previous unconfirmed attempt)
    const password_hash = await bcrypt.hash(password, 10);
    const { error: pendingErr } = await sb.from('training_pending_registrations').upsert({
      email:         normalEmail,
      name:          name.trim(),
      course:        course.trim(),
      phone:         phone?.trim() || null,
      city:          city?.trim()  || null,
      country:       country?.trim() || null,
      password_hash,
    }, { onConflict: 'email' });

    if (pendingErr) {
      return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 500 });
    }

    // Create and send confirmation email
    const token      = await createConfirmationToken(normalEmail, 'training');
    const confirmUrl = `${LEARN_URL}/training/confirm-email?token=${token}`;
    const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'training' });

    await sendEmail({ to: normalEmail, subject, html, from: FROM.training });

    return NextResponse.json({ success: true, message: 'Please check your email to confirm your account.' });
  } catch (err) {
    console.error('[training/register]', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
