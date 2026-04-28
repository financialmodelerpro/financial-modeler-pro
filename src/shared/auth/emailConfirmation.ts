import { getServerClient } from '@/src/core/db/supabase';
import crypto from 'crypto';

const TOKEN_TTL_HOURS = 24;

/** Generate and store an email confirmation token. Returns the plaintext token. */
export async function createConfirmationToken(
  email: string,
  hub: 'training' | 'modeling',
): Promise<string> {
  const normalEmail = email.toLowerCase().trim();
  const token       = crypto.randomBytes(32).toString('hex');
  const expiresAt   = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_TTL_HOURS);

  const sb = getServerClient();

  // Remove any existing unused tokens for this email+hub to prevent stale tokens
  await sb
    .from('email_confirmations')
    .delete()
    .eq('email', normalEmail)
    .eq('hub', hub)
    .is('used_at', null);

  const { error } = await sb.from('email_confirmations').insert({
    hub,
    email:      normalEmail,
    token,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error('[createConfirmationToken] insert failed:', error);
    throw new Error('Failed to create confirmation token');
  }

  return token;
}

/**
 * Verify a confirmation token. Does NOT consume it by default - callers are
 * expected to invoke `markTokenUsed(tokenId)` after every downstream write
 * has succeeded, so a failure in those writes leaves the token live for the
 * user to retry the same link. Previously this function marked used_at
 * eagerly, which caused tokens to become dead whenever any Supabase write
 * below it errored.
 *
 * Logs a specific reason on verification failure so Vercel logs can
 * distinguish "token not found" / "already used" / "expired".
 */
export async function verifyConfirmationToken(
  token: string,
  hub:   'training' | 'modeling',
): Promise<{ valid: boolean; email?: string; tokenId?: string; reason?: 'not_found' | 'already_used' | 'expired' }> {
  const sb = getServerClient();
  const { data } = await sb
    .from('email_confirmations')
    .select('id, email, used_at, expires_at')
    .eq('token', token)
    .eq('hub', hub)
    .maybeSingle();

  const tokenPrefix = token.slice(0, 8);

  if (!data) {
    console.error('[token-verify] Token not found', { token_prefix: tokenPrefix, hub });
    return { valid: false, reason: 'not_found' };
  }

  if (data.used_at) {
    console.error('[token-verify] Token already used', { token_prefix: tokenPrefix, hub, used_at: data.used_at });
    return { valid: false, reason: 'already_used' };
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt <= Date.now()) {
    console.error('[token-verify] Token expired', { token_prefix: tokenPrefix, hub, expires_at: data.expires_at });
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, email: data.email as string, tokenId: data.id as string };
}

/**
 * Mark a confirmation token as consumed. Idempotent: calling twice is a
 * benign overwrite. Call this only after every dependent write has
 * succeeded so a mid-flow failure can be retried against the same link.
 */
export async function markTokenUsed(tokenId: string): Promise<void> {
  const sb = getServerClient();
  const { error } = await sb
    .from('email_confirmations')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenId);
  if (error) {
    console.error('[markTokenUsed] update failed', { tokenId, error: error.message });
  }
}
