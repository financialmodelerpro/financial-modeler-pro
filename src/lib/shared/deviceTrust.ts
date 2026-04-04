import { getServerClient } from '@/src/lib/shared/supabase';
import crypto from 'crypto';

export const DEVICE_COOKIE_NAME = 'fmp-trusted-device';
const TRUST_DAYS     = 30;
export const COOKIE_MAX_AGE = 60 * 60 * 24 * TRUST_DAYS;

/**
 * Check if a device token (from cookie) is trusted for this identifier + hub.
 * Call from API routes — pass the raw cookie value from the request.
 */
export async function isDeviceTrusted(
  deviceToken: string | undefined,
  identifier: string,
  hub: 'training' | 'modeling',
): Promise<boolean> {
  if (!deviceToken) return false;
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('trusted_devices')
      .select('id')
      .eq('device_token', deviceToken)
      .eq('identifier', identifier)
      .eq('hub', hub)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Generate and persist a new device trust token for the given identifier.
 * Returns the plaintext token to set as a cookie.
 */
export async function trustDevice(
  identifier: string,
  hub: 'training' | 'modeling',
): Promise<string> {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TRUST_DAYS);

  const sb = getServerClient();
  await sb.from('trusted_devices').insert({
    hub,
    identifier,
    device_token: token,
    expires_at:   expiresAt.toISOString(),
  });

  return token;
}

/** Returns the Set-Cookie header value for a trust token. */
export function buildTrustCookieHeader(token: string, secure: boolean): string {
  return (
    `${DEVICE_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${COOKIE_MAX_AGE}; Path=/` +
    (secure ? '; Secure' : '')
  );
}

/** Returns a Set-Cookie header that clears the trust cookie. */
export function clearTrustCookieHeader(): string {
  return `${DEVICE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}
