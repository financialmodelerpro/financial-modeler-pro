import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/lib/shared/supabase';
import { hashPassword } from '@/src/lib/shared/password';
import { verifyCaptcha } from '@/src/lib/shared/captcha';
import { createConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { confirmEmailTemplate } from '@/src/lib/email/templates/confirmEmail';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    email?: string;
    name?: string;
    password?: string;
    phone?: string;
    city?: string;
    country?: string;
    captchaToken?: string;
  } | null;

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
  }
  if (!body.captchaToken) {
    return NextResponse.json({ error: 'Captcha verification required' }, { status: 400 });
  }

  // Verify captcha
  const captchaValid = await verifyCaptcha(body.captchaToken);
  if (!captchaValid) {
    return NextResponse.json({ error: 'Captcha verification failed. Please try again.' }, { status: 400 });
  }

  const email = (body.email as string).toLowerCase().trim();

  // Check duplicate
  const { data: existing } = await serverClient
    .from('users')
    .select('id, email_confirmed')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    if (!existing.email_confirmed) {
      // Resend confirmation email
      const token      = await createConfirmationToken(email, 'modeling');
      const confirmUrl = `${APP_URL}/modeling/confirm-email?token=${token}`;
      const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'modeling' });
      await sendEmail({ to: email, subject, html, from: FROM.noreply }).catch(() => null);
      return NextResponse.json({
        message: 'Account pending confirmation. We\'ve resent the confirmation email - please check your inbox.',
      }, { status: 200 });
    }
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 409 });
  }

  const password_hash = await hashPassword(body.password as string);

  const { error: insertErr } = await serverClient
    .from('users')
    .insert({
      email,
      name:                body.name.trim(),
      password_hash,
      phone:               body.phone?.trim() || null,
      city:                body.city?.trim()  || null,
      country:             body.country?.trim() || null,
      role:                'user',
      subscription_plan:   'free',
      subscription_status: 'trial',
      projects_limit:      3,
      email_confirmed:     false,
    });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Send confirmation email
  const token      = await createConfirmationToken(email, 'modeling');
  const confirmUrl = `${APP_URL}/modeling/confirm-email?token=${token}`;
  const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'modeling' });
  await sendEmail({ to: email, subject, html, from: FROM.noreply });

  return NextResponse.json({
    message: 'Account created! Please check your email and click the confirmation link to activate your account.',
  }, { status: 201 });
}
