import { getServerClient } from '@/src/core/db/supabase';
import crypto from 'crypto';

export const DEVICE_COOKIE_NAME = 'fmp-trusted-device';
const TRUST_DAYS     = 30;
export const COOKIE_MAX_AGE = 60 * 60 * 24 * TRUST_DAYS;

/**
 * Check if a device token (from cookie) is trusted for this identifier + hub.
 * Call from API routes - pass the raw cookie value from the request.
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
 * @param ttlMs - TTL in milliseconds. Defaults to 30 days. Pass a shorter value
 *                for session-level trust (e.g. 2 * 60 * 60 * 1000 for 2 hours).
 */
export async function trustDevice(
  identifier: string,
  hub: 'training' | 'modeling',
  ttlMs: number = TRUST_DAYS * 24 * 60 * 60 * 1000,
): Promise<string> {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);

  const sb = getServerClient();
  await sb.from('trusted_devices').insert({
    hub,
    identifier,
    device_token: token,
    expires_at:   expiresAt.toISOString(),
  });

  return token;
}

/** Returns the Set-Cookie header value for a trust token.
 *  @param maxAge - Cookie Max-Age in seconds. Defaults to 30 days. */
export function buildTrustCookieHeader(token: string, secure: boolean, maxAge: number = COOKIE_MAX_AGE): string {
  return (
    `${DEVICE_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAge}; Path=/` +
    (secure ? '; Secure' : '')
  );
}

/** Returns a Set-Cookie header that clears the trust cookie. */
export function clearTrustCookieHeader(): string {
  return `${DEVICE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}
