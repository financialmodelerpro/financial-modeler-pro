/**
 * POST /api/auth/reset-password
 *
 * Verifies the reset token and sets a new password. REWRITTEN 2026-08-30:
 * the previous version ignored the token-select error, so with the token
 * table missing (mig 008 never ran) EVERY link answered "Invalid or expired
 * reset link" and the failure looked like user error.
 *
 * Contract now:
 *   - Infrastructure failure is a 503 that says so; "invalid link" is
 *     reserved for a token that genuinely does not verify.
 *   - EXPIRY is enforced (60 minutes, expires_at in the row).
 *   - SINGLE USE is enforced ATOMICALLY: redemption is one conditional
 *     UPDATE (used_at set only where it is still NULL) so two concurrent
 *     submissions of the same token cannot both pass.
 *   - A successful reset revokes the user's other unused tokens.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerClient } from '@/src/core/db/supabase';
import { hashPassword } from '@/src/shared/auth/password';

const UNAVAILABLE = 'Password reset is temporarily unavailable. Please try again later or contact support.';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: string; newPassword?: string };

  if (!body.token || !body.newPassword) {
    return NextResponse.json({ error: 'token and newPassword are required' }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const db = getServerClient();
  const tokenHash = createHash('sha256').update(body.token).digest('hex');

  // Look up the token; an ERRORED read is infrastructure, not a bad link.
  const { data: row, error: readErr } = await db
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (readErr) {
    console.error('[reset-password] token read failed:', readErr.code, readErr.message);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  if (!row)        return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  if (row.used_at) return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
  }

  // ATOMIC single-use claim: only the request that flips used_at from NULL
  // proceeds. A concurrent duplicate finds zero rows updated and is refused.
  const { data: claimed, error: claimErr } = await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id');
  if (claimErr) {
    console.error('[reset-password] token claim failed:', claimErr.message);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 });
  }

  const newHash = await hashPassword(body.newPassword);
  const { error: pwErr } = await db.from('users').update({ password_hash: newHash }).eq('id', row.user_id);
  if (pwErr) {
    console.error('[reset-password] password update failed:', pwErr.message);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  // Any other outstanding links for this user are now dead.
  await db.from('password_reset_tokens').delete().eq('user_id', row.user_id).is('used_at', null);

  return NextResponse.json({ ok: true });
}
