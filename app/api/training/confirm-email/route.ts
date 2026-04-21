/**
 * GET /api/training/confirm-email?token=xxx
 *
 * Supabase-native confirmation flow. Apps Script is out of the critical
 * path entirely; RegIDs are allocated by the `next_training_reg_id` SQL
 * function (migration 133), and student identity + password land in
 * training_registrations_meta + training_passwords.
 *
 * Flow:
 *   1. Verify the confirmation token (does not consume it yet).
 *   2. Read the pending row for the token's email.
 *   3. If no pending row: existing student re-confirming; UPDATE their meta
 *      row to email_confirmed=true, mark token used, redirect to signin.
 *   4. Otherwise check whether meta already exists for this email.
 *      If yes (half-migrated state or a retry past an earlier partial
 *      failure), UPDATE that row in place.
 *      If no, allocate a fresh RegID and INSERT.
 *   5. Write the password hash to training_passwords (SELECT-then-decide).
 *   6. Fire welcome email (fire-and-forget).
 *   7. Mark the token used, delete pending, redirect to /signin?confirmed=true.
 *
 * If any write fails, we fail-closed WITHOUT consuming the token or
 * deleting the pending row, so the student can click the same link again
 * after the underlying issue is fixed.
 *
 * Course enrollment is NOT handled here. New students land in Supabase
 * without any course and pick one from the dashboard via POST
 * /api/training/enroll. Existing students are backfilled with their
 * original course(s) by scripts/backup_apps_script_students.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyConfirmationToken, markTokenUsed } from '@/src/lib/shared/emailConfirmation';
import { getServerClient } from '@/src/lib/shared/supabase';
import { allocateRegistrationId } from '@/src/lib/training/regIdAllocator';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { registrationConfirmationTemplate } from '@/src/lib/email/templates/registrationConfirmation';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

const MAX_REG_ID_RETRIES = 3;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!token) {
    console.error('[confirm-email] No token in request');
    return NextResponse.redirect(`${LEARN_URL}/signin?error=link-expired`);
  }

  const { valid, email, tokenId, reason } = await verifyConfirmationToken(token, 'training');
  if (!valid || !email || !tokenId) {
    console.error('[confirm-email] Token verification failed', { token_prefix: token.slice(0, 8), reason });
    return NextResponse.redirect(`${LEARN_URL}/signin?error=link-expired`);
  }

  const sb = getServerClient();

  // Read pending registration.
  const { data: pending, error: pendingErr } = await sb
    .from('training_pending_registrations')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (pendingErr) {
    console.error('[confirm-email] pending lookup failed', { email, error: pendingErr.message });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  if (!pending) {
    // Existing student re-confirming via a stale link. Just flip email_confirmed.
    console.log('[confirm-email] No pending row for', email, '- marking existing meta row confirmed');
    const { error } = await sb
      .from('training_registrations_meta')
      .update({ email_confirmed: true, confirmed_at: new Date().toISOString() })
      .eq('email', email)
      .is('email_confirmed', false);
    if (error) {
      console.error('[confirm-email] stale-link meta update failed', { email, error: error.message });
      return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
    }
    await markTokenUsed(tokenId);
    return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
  }

  // ── Main path: allocate RegID + INSERT meta (or UPDATE if row exists) ─────

  // Does a meta row already exist for this email? Covers the half-migrated
  // state (RegID already allocated in a prior attempt but meta write failed)
  // as well as any reconfirm-after-password-change scenario.
  const { data: existingMeta, error: metaLookupErr } = await sb
    .from('training_registrations_meta')
    .select('registration_id')
    .eq('email', email)
    .maybeSingle();
  if (metaLookupErr) {
    console.error('[confirm-email] meta lookup failed', { email, error: metaLookupErr.message });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  let registrationId: string;
  if (existingMeta?.registration_id) {
    registrationId = existingMeta.registration_id;
    const { error } = await sb
      .from('training_registrations_meta')
      .update({
        email,
        name:            pending.name ?? null,
        phone:           pending.phone ?? null,
        city:            pending.city  ?? null,
        country:         pending.country ?? null,
        email_confirmed: true,
        confirmed_at:    new Date().toISOString(),
      })
      .eq('registration_id', registrationId);
    if (error) {
      console.error('[confirm-email] meta update failed', { email, registration_id: registrationId, error: error.message });
      return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
    }
  } else {
    // Fresh student. Allocate a RegID via the Supabase function and INSERT.
    // Retry if a concurrent allocation raced past the advisory lock (extremely
    // rare; the UNIQUE index catches it and we ask for the next value).
    let insertedRegId: string | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < MAX_REG_ID_RETRIES && !insertedRegId; attempt++) {
      try {
        const candidate = await allocateRegistrationId(sb);
        const { error } = await sb
          .from('training_registrations_meta')
          .insert({
            registration_id: candidate,
            email,
            name:            pending.name ?? null,
            phone:           pending.phone ?? null,
            city:            pending.city  ?? null,
            country:         pending.country ?? null,
            email_confirmed: true,
            confirmed_at:    new Date().toISOString(),
          });
        if (error) {
          const isUniqueConflict =
            error.message.toLowerCase().includes('duplicate') ||
            error.message.toLowerCase().includes('unique');
          lastError = error.message;
          if (isUniqueConflict) {
            // Most commonly this hits on the email UNIQUE, not registration_id.
            // If email collides, there's a race with another concurrent
            // confirm-email for the same student; surface the error and
            // stop retrying since a new RegID won't help.
            console.error('[confirm-email] meta insert hit unique conflict', {
              email, candidate, error: error.message, attempt,
            });
            return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
          }
          console.error('[confirm-email] meta insert failed', {
            email, candidate, attempt, error: error.message,
          });
          continue;
        }
        insertedRegId = candidate;
      } catch (allocErr) {
        lastError = allocErr instanceof Error ? allocErr.message : String(allocErr);
        console.error('[confirm-email] RegID allocation failed', { email, attempt, error: lastError });
      }
    }
    if (!insertedRegId) {
      console.error('[confirm-email] meta insert exhausted retries', { email, lastError });
      return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
    }
    registrationId = insertedRegId;
  }

  // ── Password ──────────────────────────────────────────────────────────────
  // SELECT-then-decide. The password hash is already bcrypted at
  // /api/training/register time, so we just persist what's in pending.
  const { data: existingPw, error: pwLookupErr } = await sb
    .from('training_passwords')
    .select('registration_id')
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (pwLookupErr) {
    console.error('[confirm-email] password lookup failed', { email, registration_id: registrationId, error: pwLookupErr.message });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
  }

  let pwWriteErr: { message: string } | null = null;
  if (existingPw) {
    const { error } = await sb
      .from('training_passwords')
      .update({ password_hash: pending.password_hash })
      .eq('registration_id', registrationId);
    pwWriteErr = error;
  } else {
    const { error } = await sb
      .from('training_passwords')
      .insert({ registration_id: registrationId, password_hash: pending.password_hash });
    pwWriteErr = error;
  }
  if (pwWriteErr) {
    console.error('[confirm-email] password write failed', {
      email, registration_id: registrationId,
      mode: existingPw ? 'update' : 'insert',
      error: pwWriteErr.message,
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
  }

  // ── Welcome email (fire-and-forget) ───────────────────────────────────────
  // Course name is omitted from the generic welcome since we no longer
  // know at this point - enrollment happens post-login. Template accepts
  // empty courseName.
  registrationConfirmationTemplate({ name: pending.name ?? '', registrationId, courseName: '' })
    .then(({ subject, html, text }) => sendEmail({ to: email, subject, html, text, from: FROM.training }))
    .catch(err => console.error('[confirm-email] Welcome email failed:', err));

  // ── Final cleanup ─────────────────────────────────────────────────────────
  await markTokenUsed(tokenId);
  await sb.from('training_pending_registrations').delete().eq('email', email);

  return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
}
