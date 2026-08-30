/**
 * POST /api/auth/forgot-password
 *
 * Generates a password-reset token and emails the reset link. REWRITTEN
 * 2026-08-30: the previous version ignored the token-insert error (the table
 * did not exist on prod, mig 008 never ran), so it reported success, sent a
 * real email carrying a token that verified against nothing, and the reset
 * page dead-ended on every click.
 *
 * Contract now:
 *   - INFRASTRUCTURE failure is TOLD to the user, never swallowed: the token
 *     store being unavailable is a 503, a failed email send is a 502 (and the
 *     just-created token is removed so a dead token never outlives its email).
 *   - The store's availability is checked BEFORE the user lookup, so the
 *     degraded state answers 503 for EVERY address and enumeration stays
 *     impossible (an existing-vs-unknown email must never answer differently).
 *   - An unknown email still gets the generic success (no enumeration).
 *   - Only a SHA-256 hash is stored, 60-minute expiry, and requesting a new
 *     link revokes the user's previous unused tokens (one live link at a time).
 *   - Every user-supplied value rendered into the email is escaped in the
 *     template (the recipient name).
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { passwordResetTemplate } from '@/src/shared/email/templates/passwordReset';

const TOKEN_TTL_MINUTES = 60;
const UNAVAILABLE = 'Password reset is temporarily unavailable. Please try again later or contact support.';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { email?: string };
  const email = (body.email ?? '').toLowerCase().trim();

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const db = getServerClient();

  // Token-store availability FIRST, before any user lookup: in a degraded
  // state every request must fail identically, or the 503-vs-200 difference
  // would leak which emails exist. Deliberately a GET select, NOT a HEAD one:
  // PostgREST answers a HEAD request on an ABSENT table with an empty 204 and
  // no error (observed live 2026-08-30), so a HEAD-based guard can never fire.
  {
    const { error } = await db.from('password_reset_tokens').select('id').limit(0);
    if (error) {
      console.error('[forgot-password] token store unavailable:', error.code, error.message);
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
  }

  const { data: user, error: userErr } = await db
    .from('users').select('id, name').eq('email', email).maybeSingle();
  if (userErr) {
    console.error('[forgot-password] user lookup failed:', userErr.message);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  if (user?.id) {
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash  = createHash('sha256').update(plainToken).digest('hex');
    const expiresAt  = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    // One live link at a time: revoke this user's previous unused tokens.
    await db.from('password_reset_tokens').delete().eq('user_id', user.id).is('used_at', null);

    // Store the hash only, and CHECK the write: a failed insert must never
    // let a dead-token email go out with a success message.
    const { error: insErr } = await db.from('password_reset_tokens').insert({
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error('[forgot-password] token insert failed:', insErr.code, insErr.message);
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/reset-password?token=${plainToken}`;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[forgot-password] Reset URL:', resetUrl);
    }

    try {
      const { subject, html, text } = await passwordResetTemplate({
        resetUrl, expiresMinutes: TOKEN_TTL_MINUTES, name: user.name ?? null,
      });
      await sendEmail({ to: email, subject, html, text, from: FROM.noreply });
    } catch (err) {
      // A failed send is TOLD to the user, and the token it belonged to is
      // removed: a link that was never delivered must not stay redeemable.
      console.error('[forgot-password] email send failed:', err instanceof Error ? err.message : String(err));
      await db.from('password_reset_tokens').delete().eq('token_hash', tokenHash);
      return NextResponse.json(
        { error: 'We could not send the reset email. Please try again in a few minutes.' },
        { status: 502 },
      );
    }
  }

  // Known and unknown emails answer identically from here (no enumeration).
  return NextResponse.json({ ok: true });
}
