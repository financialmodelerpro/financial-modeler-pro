/**
 * GET /api/training/confirm-email?token=xxx
 *
 * 1. Verify the confirmation token
 * 2. Read pending registration data
 * 3. Call Apps Script to register (generates Registration ID)
 * 4. Store registration_id, city, country, email_confirmed in training_registrations_meta
 * 5. Store password in training_passwords
 * 6. Delete pending row
 * 7. Redirect to /signin?confirmed=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { getServerClient } from '@/src/lib/shared/supabase';
import { registerStudent } from '@/src/lib/training/sheets';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { registrationConfirmationTemplate } from '@/src/lib/email/templates/registrationConfirmation';
import bcrypt from 'bcryptjs';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!token) {
    console.error('[confirm-email] No token in request');
    return NextResponse.redirect(`${LEARN_URL}/signin?error=link-expired`);
  }

  const { valid, email } = await verifyConfirmationToken(token, 'training');
  if (!valid || !email) {
    console.error('[confirm-email] Token invalid or expired. token_prefix=', token.slice(0, 8));
    return NextResponse.redirect(`${LEARN_URL}/signin?error=link-expired`);
  }

  const sb = getServerClient();

  // Read pending registration
  const { data: pending } = await sb
    .from('training_pending_registrations')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (!pending) {
    // Existing student confirming email (no pending row) - mark confirmed and redirect to signin
    console.log('[confirm-email] No pending row for', email, '- marking existing meta row confirmed');
    await sb
      .from('training_registrations_meta')
      .update({ email_confirmed: true, confirmed_at: new Date().toISOString() })
      .eq('email', email)
      .is('email_confirmed', false); // only update if currently false - don't touch already-confirmed
    return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
  }

  // Call Apps Script to create the Google Sheets record and generate Registration ID
  const result = await registerStudent(pending.name, pending.email, pending.course);

  if (!result.success) {
    const errorLower = (result.error ?? '').toLowerCase();
    const isDuplicate =
      result.duplicate === true ||
      errorLower.includes('already') ||
      errorLower.includes('duplicate') ||
      errorLower.includes('exists');

    if (isDuplicate) {
      // Already in Sheets - look up existing regId
      const { data: meta } = await sb
        .from('training_registrations_meta')
        .select('registration_id')
        .eq('email', email)
        .maybeSingle();

      if (meta?.registration_id) {
        // Mark confirmed and clean up
        await sb.from('training_registrations_meta').update({
          email_confirmed: true,
          confirmed_at: new Date().toISOString(),
          city: pending.city ?? null,
          country: pending.country ?? null,
        }).eq('email', email);

        await sb.from('training_passwords').upsert({
          registration_id: meta.registration_id,
          password_hash: pending.password_hash,
        }, { onConflict: 'registration_id' });

        await sb.from('training_pending_registrations').delete().eq('email', email);
        return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
      }
    }
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  const registrationId: string = (result.data as { registrationId?: string })?.registrationId ?? '';

  if (registrationId) {
    // Store in lookup table as confirmed
    await sb.from('training_registrations_meta').upsert({
      registration_id: registrationId,
      email,
      phone:           pending.phone ?? null,
      city:            pending.city  ?? null,
      country:         pending.country ?? null,
      email_confirmed: true,
      confirmed_at:    new Date().toISOString(),
    }, { onConflict: 'registration_id' });

    // Store password
    await sb.from('training_passwords').upsert({
      registration_id: registrationId,
      password_hash:   pending.password_hash,
    }, { onConflict: 'registration_id' });

    // Send registration welcome email with RegID (fire-and-forget)
    const courseName = pending.course === 'bvm' ? 'Business Valuation Modeling'
      : pending.course === 'both' ? '3-Statement Financial Modeling & Business Valuation Modeling'
      : '3-Statement Financial Modeling';
    registrationConfirmationTemplate({ name: pending.name, registrationId, courseName })
      .then(({ subject, html, text }) => sendEmail({ to: email, subject, html, text, from: FROM.training }))
      .catch(err => console.error('[confirm-email] Welcome email failed:', err));
  }

  // Clean up pending row
  await sb.from('training_pending_registrations').delete().eq('email', email);

  return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
}
