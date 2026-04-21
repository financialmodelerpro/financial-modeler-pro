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
import { verifyConfirmationToken, markTokenUsed } from '@/src/lib/shared/emailConfirmation';
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

  // Verify-only. The token is consumed via markTokenUsed below, AFTER every
  // downstream write has succeeded. A failure in any of those writes leaves
  // the token live so the user can click the same link again once the
  // underlying issue is resolved. The prior eager-consume shape is what
  // turned transient write failures into permanent "Link Invalid or Expired"
  // pages for the user.
  const { valid, email, tokenId, reason } = await verifyConfirmationToken(token, 'training');
  if (!valid || !email || !tokenId) {
    console.error('[confirm-email] Token verification failed', { token_prefix: token.slice(0, 8), reason });
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
    await markTokenUsed(tokenId);
    return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
  }

  // Call Apps Script to create the Google Sheets record and generate Registration ID
  const result = await registerStudent(pending.name, pending.email, pending.course);

  if (!result.success) {
    // Capture the full response before we branch on it. Historical
    // assumptions about the Apps Script register response shape keep
    // biting us; logging result.data here tells us exactly whether the
    // RegID is recoverable from a duplicate response or whether we need
    // a separate "getStudentByEmail" action.
    console.log('[confirm-email] Apps Script non-success response detail', {
      email,
      success:   result.success,
      duplicate: result.duplicate,
      error:     result.error,
      data:      result.data,
    });

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
        // Mark confirmed; fail closed if either write errors so the pending
        // row survives for a retry.
        const { error: metaErr } = await sb.from('training_registrations_meta').update({
          email_confirmed: true,
          confirmed_at: new Date().toISOString(),
          city: pending.city ?? null,
          country: pending.country ?? null,
        }).eq('email', email);
        if (metaErr) {
          console.error('[confirm-email] duplicate-branch meta update failed', { email, error: metaErr.message });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
        }

        // SELECT-then-decide for password to match the shape in the main
        // success branch and sidestep any blind-upsert conflict on
        // training_passwords we haven't characterized yet.
        const { data: existingPw, error: pwLookupErr } = await sb
          .from('training_passwords')
          .select('registration_id')
          .eq('registration_id', meta.registration_id)
          .maybeSingle();
        if (pwLookupErr) {
          console.error('[confirm-email] duplicate-branch password lookup failed', {
            email, registration_id: meta.registration_id, error: pwLookupErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
        }

        let pwErr: { message: string } | null = null;
        if (existingPw) {
          const { error } = await sb
            .from('training_passwords')
            .update({ password_hash: pending.password_hash })
            .eq('registration_id', meta.registration_id);
          pwErr = error;
        } else {
          const { error } = await sb
            .from('training_passwords')
            .insert({ registration_id: meta.registration_id, password_hash: pending.password_hash });
          pwErr = error;
        }
        if (pwErr) {
          console.error('[confirm-email] duplicate-branch password write failed', {
            email, registration_id: meta.registration_id,
            mode: existingPw ? 'update' : 'insert',
            error: pwErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
        }

        // All writes succeeded. Consume the token + clean up pending.
        await markTokenUsed(tokenId);
        await sb.from('training_pending_registrations').delete().eq('email', email);
        return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
      }

      // Apps Script said duplicate but we couldn't find the matching meta
      // row by email. This is the "half-migrated student" state: they got
      // a RegID from Apps Script in an earlier (buggy) attempt but the
      // Supabase write never completed. If Apps Script returned the
      // existing student record in result.data (common shape for register
      // actions), recover them by writing meta + password using that
      // RegID. Otherwise fall through to the explicit error.
      const recoveredRegId = (result.data as { registrationId?: string } | undefined)?.registrationId ?? '';
      if (recoveredRegId) {
        console.log('[confirm-email] Recovering half-migrated student from Apps Script duplicate response', {
          email, recoveredRegId,
        });

        // Meta: SELECT-then-decide keyed on either registration_id or email
        // so a retry never hits a dual-UNIQUE collision.
        const { data: existingMeta, error: recoverMetaLookupErr } = await sb
          .from('training_registrations_meta')
          .select('registration_id, email')
          .or(`registration_id.eq.${recoveredRegId},email.eq.${email}`)
          .maybeSingle();
        if (recoverMetaLookupErr) {
          console.error('[confirm-email] half-migrated meta lookup failed', {
            email, registration_id: recoveredRegId, error: recoverMetaLookupErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
        }

        let metaErr: { message: string } | null = null;
        if (existingMeta) {
          const { error } = await sb
            .from('training_registrations_meta')
            .update({
              registration_id: recoveredRegId,
              email,
              phone:           pending.phone ?? null,
              city:            pending.city  ?? null,
              country:         pending.country ?? null,
              email_confirmed: true,
              confirmed_at:    new Date().toISOString(),
            })
            .eq('registration_id', existingMeta.registration_id);
          metaErr = error;
        } else {
          const { error } = await sb
            .from('training_registrations_meta')
            .insert({
              registration_id: recoveredRegId,
              email,
              phone:           pending.phone ?? null,
              city:            pending.city  ?? null,
              country:         pending.country ?? null,
              email_confirmed: true,
              confirmed_at:    new Date().toISOString(),
            });
          metaErr = error;
        }
        if (metaErr) {
          console.error('[confirm-email] half-migrated meta write failed', {
            email, registration_id: recoveredRegId,
            mode: existingMeta ? 'update' : 'insert',
            error: metaErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
        }

        // Password: same SELECT-then-decide shape.
        const { data: existingPw, error: recoverPwLookupErr } = await sb
          .from('training_passwords')
          .select('registration_id')
          .eq('registration_id', recoveredRegId)
          .maybeSingle();
        if (recoverPwLookupErr) {
          console.error('[confirm-email] half-migrated password lookup failed', {
            email, registration_id: recoveredRegId, error: recoverPwLookupErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
        }

        let pwErr: { message: string } | null = null;
        if (existingPw) {
          const { error } = await sb
            .from('training_passwords')
            .update({ password_hash: pending.password_hash })
            .eq('registration_id', recoveredRegId);
          pwErr = error;
        } else {
          const { error } = await sb
            .from('training_passwords')
            .insert({ registration_id: recoveredRegId, password_hash: pending.password_hash });
          pwErr = error;
        }
        if (pwErr) {
          console.error('[confirm-email] half-migrated password write failed', {
            email, registration_id: recoveredRegId,
            mode: existingPw ? 'update' : 'insert',
            error: pwErr.message,
          });
          return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
        }

        // Fire-and-forget welcome email using the recovered RegID.
        const courseName = pending.course === 'bvm' ? 'Business Valuation Modeling'
          : pending.course === 'both' ? '3-Statement Financial Modeling & Business Valuation Modeling'
          : '3-Statement Financial Modeling';
        registrationConfirmationTemplate({ name: pending.name, registrationId: recoveredRegId, courseName })
          .then(({ subject, html, text }) => sendEmail({ to: email, subject, html, text, from: FROM.training }))
          .catch(err => console.error('[confirm-email] Welcome email failed:', err));

        await markTokenUsed(tokenId);
        await sb.from('training_pending_registrations').delete().eq('email', email);
        return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
      }

      // Apps Script said duplicate, Supabase has no row, AND Apps Script
      // did not include a RegID in its response. Can't recover from here
      // without an external lookup; fall through to the explicit error
      // and log everything we got so the response shape is captured.
      console.error('[confirm-email] duplicate but no RegID recoverable', {
        email,
        dataFromScript: result.data,
        resultKeys:     result.data && typeof result.data === 'object' ? Object.keys(result.data) : [],
      });
    }
    console.error('[confirm-email] Apps Script returned non-success', {
      email, success: result.success, duplicate: result.duplicate, error: result.error,
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  const registrationId: string = (result.data as { registrationId?: string })?.registrationId ?? '';

  // Secondary-failure observability: Apps Script returned success but the
  // response shape didn't yield a registrationId. Previous code silently
  // skipped the Supabase write and deleted the pending row anyway, leaving
  // the student visible only in the Google Sheet. Now we fail-closed so a
  // retry is possible.
  if (!registrationId) {
    console.error('[confirm-email] Apps Script success but registrationId missing from response', {
      email,
      dataKeys: result.data && typeof result.data === 'object' ? Object.keys(result.data) : [],
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  // Store in lookup table as confirmed. training_registrations_meta has
  // UNIQUE constraints on BOTH registration_id (migration 129) and email
  // (pre-existing). A blind upsert with onConflict:'registration_id' can
  // still fail with "duplicate key violates unique constraint ..._email_key"
  // when the row actually collides on email (e.g., a retry after an earlier
  // partial failure, or Apps Script re-issuing a RegID for a known email).
  // SELECT-then-decide sidesteps Postgres's inability to catch two different
  // conflict targets in one statement.
  const { data: existingMeta, error: metaLookupErr } = await sb
    .from('training_registrations_meta')
    .select('registration_id, email')
    .or(`registration_id.eq.${registrationId},email.eq.${email}`)
    .maybeSingle();
  if (metaLookupErr) {
    console.error('[confirm-email] meta lookup failed', {
      email, registration_id: registrationId, error: metaLookupErr.message,
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  let metaErr: { message: string } | null = null;
  if (existingMeta) {
    // Re-sync registration_id onto the row we keyed off of, in case the
    // match came via email and the RegID drifted between attempts.
    const { error } = await sb
      .from('training_registrations_meta')
      .update({
        registration_id: registrationId,
        email,
        phone:           pending.phone ?? null,
        city:            pending.city  ?? null,
        country:         pending.country ?? null,
        email_confirmed: true,
        confirmed_at:    new Date().toISOString(),
      })
      .eq('registration_id', existingMeta.registration_id);
    metaErr = error;
  } else {
    const { error } = await sb
      .from('training_registrations_meta')
      .insert({
        registration_id: registrationId,
        email,
        phone:           pending.phone ?? null,
        city:            pending.city  ?? null,
        country:         pending.country ?? null,
        email_confirmed: true,
        confirmed_at:    new Date().toISOString(),
      });
    metaErr = error;
  }
  if (metaErr) {
    console.error('[confirm-email] meta write failed', {
      email, registration_id: registrationId,
      mode: existingMeta ? 'update' : 'insert',
      error: metaErr.message,
    });
    // Keep the pending row so a retry has something to work with. The Apps
    // Script row already exists and is idempotent under its own duplicate
    // check on re-register.
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=registration-failed`);
  }

  // Store password. Same SELECT-then-decide shape in case training_passwords
  // has other constraints beyond registration_id that could reject a blind
  // upsert.
  const { data: existingPw, error: pwLookupErr } = await sb
    .from('training_passwords')
    .select('registration_id')
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (pwLookupErr) {
    console.error('[confirm-email] password lookup failed', {
      email, registration_id: registrationId, error: pwLookupErr.message,
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
  }

  let pwErr: { message: string } | null = null;
  if (existingPw) {
    const { error } = await sb
      .from('training_passwords')
      .update({ password_hash: pending.password_hash })
      .eq('registration_id', registrationId);
    pwErr = error;
  } else {
    const { error } = await sb
      .from('training_passwords')
      .insert({ registration_id: registrationId, password_hash: pending.password_hash });
    pwErr = error;
  }
  if (pwErr) {
    console.error('[confirm-email] password write failed', {
      email, registration_id: registrationId,
      mode: existingPw ? 'update' : 'insert',
      error: pwErr.message,
    });
    return NextResponse.redirect(`${LEARN_URL}/training/confirm-email?error=password-failed`);
  }

  // Send registration welcome email with RegID (fire-and-forget)
  const courseName = pending.course === 'bvm' ? 'Business Valuation Modeling'
    : pending.course === 'both' ? '3-Statement Financial Modeling & Business Valuation Modeling'
    : '3-Statement Financial Modeling';
  registrationConfirmationTemplate({ name: pending.name, registrationId, courseName })
    .then(({ subject, html, text }) => sendEmail({ to: email, subject, html, text, from: FROM.training }))
    .catch(err => console.error('[confirm-email] Welcome email failed:', err));

  // All writes succeeded. Consume the token + clean up pending.
  await markTokenUsed(tokenId);
  await sb.from('training_pending_registrations').delete().eq('email', email);

  return NextResponse.redirect(`${LEARN_URL}/signin?confirmed=true`);
}
