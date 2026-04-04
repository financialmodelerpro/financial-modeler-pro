import { getServerClient } from '@/src/lib/shared/supabase';
import crypto from 'crypto';

const TOKEN_TTL_HOURS = 24;

/** Generate and store an email confirmation token. Returns the plaintext token. */
export async function createConfirmationToken(
  email: string,
  hub: 'training' | 'modeling',
): Promise<string> {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_TTL_HOURS);

  const sb = getServerClient();
  await sb.from('email_confirmations').insert({
    hub,
    email: email.toLowerCase().trim(),
    token,
    expires_at: expiresAt.toISOString(),
  });

  return token;
}

/** Verify a confirmation token. Returns { valid, email } or { valid: false }. */
export async function verifyConfirmationToken(
  token: string,
  hub: 'training' | 'modeling',
): Promise<{ valid: boolean; email?: string }> {
  const sb = getServerClient();
  const { data } = await sb
    .from('email_confirmations')
    .select('id, email')
    .eq('token', token)
    .eq('hub', hub)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!data) return { valid: false };

  await sb
    .from('email_confirmations')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { valid: true, email: data.email };
}
