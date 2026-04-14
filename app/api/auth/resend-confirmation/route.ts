/**
 * POST /api/auth/resend-confirmation
 * Resends the email confirmation link for a Modeling Hub account.
 * Body: { email }
 * Always returns 200 (don't reveal whether email exists).
 */

import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/lib/shared/supabase';
import { createConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { confirmEmailTemplate } from '@/src/lib/email/templates/confirmEmail';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { email?: string } | null;
    const email = body?.email?.toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }

    // Only resend if account exists and is unconfirmed
    const { data: user } = await serverClient
      .from('users')
      .select('id, email_confirmed')
      .eq('email', email)
      .maybeSingle();

    if (user && !user.email_confirmed) {
      const token      = await createConfirmationToken(email, 'modeling');
      const confirmUrl = `${APP_URL}/modeling/confirm-email?token=${token}`;
      const { subject, html } = await confirmEmailTemplate({ confirmUrl, hub: 'modeling' });
      await sendEmail({ to: email, subject, html, from: FROM.noreply }).catch(() => null);
    }

    // Always return success — don't reveal whether email exists
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // fail silently
  }
}
