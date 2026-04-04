/**
 * POST /api/training/resend-confirmation
 * Resends the email confirmation link for a Training Hub account.
 * Body: { email }
 * Checks training_pending_registrations (new unconfirmed) and
 * training_registrations_meta (confirmed=false edge case).
 * Always returns 200 — don't reveal whether email exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { createConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { confirmEmailTemplate } from '@/src/lib/email/templates/confirmEmail';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { email?: string } | null;
    const email = body?.email?.toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }

    const sb = getServerClient();
    let shouldSend = false;

    // Check pending registrations first (new unconfirmed students)
    const { data: pending } = await sb
      .from('training_pending_registrations')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (pending) {
      shouldSend = true;
    } else {
      // Check if confirmed=false in meta table (edge case)
      const { data: meta } = await sb
        .from('training_registrations_meta')
        .select('email_confirmed')
        .eq('email', email)
        .maybeSingle();

      if (meta && meta.email_confirmed !== true) {
        // email_confirmed is false OR null (pre-027 users who may have been missed) — resend
        shouldSend = true;
      }
    }

    if (shouldSend) {
      const token      = await createConfirmationToken(email, 'training');
      const confirmUrl = `${LEARN_URL}/training/confirm-email?token=${token}`;
      const { subject, html } = confirmEmailTemplate({ confirmUrl, hub: 'training' });
      await sendEmail({ to: email, subject, html, from: FROM.training }).catch(() => null);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // fail silently
  }
}
