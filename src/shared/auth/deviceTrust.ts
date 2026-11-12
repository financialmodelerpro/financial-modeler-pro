import { getServerClient } from '@/src/core/db/supabase';
import crypto from 'crypto';

/*
 * DEVICE TRUST RULES (founder, 2026-11-12; verify-device-trust):
 *   1. Trust lasts 30 days PER DEVICE, and a user may have any number of
 *      trusted devices at once. A sign-in or a new verification only ADDS a
 *      row; nothing here deletes another device's row.
 *   2. ONE verification covers every FMP site on that device: on the
 *      production domain the cookie carries Domain=.financialmodelerpro.com,
 *      so www (admin), app. (Modeling Hub) and learn. (Training Hub) all send
 *      it. Elsewhere (localhost, preview URLs) it stays host-only.
 *   3. Trust is keyed on the device token plus the lowercased email, NOT the
 *      hub: with one shared cookie a Training verification would otherwise
 *      replace the Modeling Hub token and break it. `hub` is still WRITTEN
 *      (it records where the verification happened; announcements read it).
 *   4. A request can carry the old host-only cookie AND the new domain cookie
 *      under the same name; Next's cookie map keeps only one, so the raw
 *      Cookie header is parsed and EVERY value is checked.
 *   5. Only an explicit "sign out everywhere" or a password change/reset
 *      revokes (revokeTrustedDevices).
 * The token is 32 random bytes checked against the database together with the
 * password; it is never a sign-in on its own, which is why sharing it across
 * the FMP subdomains is safe.
 */
export const DEVICE_COOKIE_NAME = 'fmp-trusted-device';
export const TRUST_DAYS     = 30;
export const COOKIE_MAX_AGE = 60 * 60 * 24 * TRUST_DAYS;
export const TRUST_TTL_MS   = COOKIE_MAX_AGE * 1000;
/** The short trust a user gets when they untick "trust this device". */
export const SESSION_TRUST_MAX_AGE = 2 * 60 * 60;
export const FMP_COOKIE_DOMAIN = '.financialmodelerpro.com';

/** The ONE identifier rule: a trimmed, lowercased email. */
export function normaliseTrustIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

/** The Domain a trust cookie is set on for this request host, or null for host-only. */
export function trustCookieDomain(host: string | null | undefined): string | null {
  const h = (host ?? '').split(':')[0].trim().toLowerCase();
  if (h === 'financialmodelerpro.com' || h.endsWith('.financialmodelerpro.com')) return FMP_COOKIE_DOMAIN;
  return null;
}

/** Every value of the trust cookie in a raw Cookie header (old host-only and new domain cookie both). */
export function readTrustTokens(cookieHeader: string | null | undefined): string[] {
  if (!cookieHeader) return [];
  const out: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== DEVICE_COOKIE_NAME) continue;
    const v = part.slice(eq + 1).trim();
    if (/^[0-9a-f]{16,128}$/i.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Whether ANY of the device's trust tokens is a live trust for this email,
 * on any hub. Pass every token from readTrustTokens.
 */
export async function isDeviceTrusted(
  deviceTokens: string[] | string | undefined | null,
  identifier: string,
): Promise<boolean> {
  const tokens = (Array.isArray(deviceTokens) ? deviceTokens : deviceTokens ? [deviceTokens] : []).filter(Boolean);
  if (tokens.length === 0 || !identifier) return false;
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('trusted_devices')
      .select('id')
      .in('device_token', tokens)
      .eq('identifier', normaliseTrustIdentifier(identifier))
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Generate and persist a new device trust token for the given email. Adds a
 * row and never removes one (rule 1).
 * @param ttlMs - TTL in milliseconds. Defaults to 30 days.
 */
export async function trustDevice(
  identifier: string,
  hub: 'training' | 'modeling',
  ttlMs: number = TRUST_TTL_MS,
): Promise<string> {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);

  const sb = getServerClient();
  const { error } = await sb.from('trusted_devices').insert({
    hub,
    identifier:   normaliseTrustIdentifier(identifier),
    device_token: token,
    expires_at:   expiresAt.toISOString(),
  });
  if (error) throw new Error(`trusted_devices insert failed: ${error.message}`);

  return token;
}

/**
 * Revoke every trusted device for an email (rule 5): "sign out everywhere",
 * a password change and a password reset. Returns the number removed.
 */
export async function revokeTrustedDevices(email: string): Promise<number> {
  if (!email) return 0;
  const sb = getServerClient();
  const { count, error } = await sb
    .from('trusted_devices')
    .delete({ count: 'exact' })
    .eq('identifier', normaliseTrustIdentifier(email));
  if (error) throw new Error(`trusted_devices revoke failed: ${error.message}`);
  return count ?? 0;
}

/** Returns the Set-Cookie header value for a trust token.
 *  @param opts.host   - the request Host; decides the shared domain (rule 2).
 *  @param opts.maxAge - Cookie Max-Age in seconds. Defaults to 30 days. */
export function buildTrustCookieHeader(
  token: string,
  opts: { host: string | null | undefined; secure: boolean; maxAge?: number },
): string {
  const domain = trustCookieDomain(opts.host);
  return (
    `${DEVICE_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${opts.maxAge ?? COOKIE_MAX_AGE}; Path=/` +
    (domain ? `; Domain=${domain}` : '') +
    (opts.secure ? '; Secure' : '')
  );
}

/** Set-Cookie headers that clear this device's trust cookie: the shared-domain one AND any old host-only one. */
export function clearTrustCookieHeaders(host: string | null | undefined, secure: boolean): string[] {
  const base = `${DEVICE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/` + (secure ? '; Secure' : '');
  const domain = trustCookieDomain(host);
  return domain ? [`${base}; Domain=${domain}`, base] : [base];
}

/** training_settings key for the admin "device verification required" switch. */
export const DEVICE_VERIFICATION_SETTING_KEY = 'device_verification_required';

/**
 * training_settings key for the admin "Training Hub device verification"
 * switch (founder, 2026-11-10). Read ONLY by the Training Hub sign-in
 * (isTrainingDeviceVerificationRequired): Modeling Hub and admin sign-in never
 * read it, so it can never relax their device check.
 */
export const TRAINING_DEVICE_VERIFICATION_SETTING_KEY = 'training_device_verification';

/**
 * Whether new-device verification (the emailed one-time code) is enforced at
 * sign-in. Controlled by an admin toggle stored in training_settings as the
 * string 'true' / 'false'. Shared by both auth stacks (Modeling NextAuth +
 * Training validate).
 *
 * Defaults to TRUE when the row is absent OR the read fails, so verification
 * stays ON unless an admin explicitly turns it off. That keeps the historical
 * always-on behaviour and is fail-secure: a flaky settings read never silently
 * drops the device check.
 */
/**
 * The Training Hub sign-in's rule: its own switch must be On (default On when
 * the row is absent or unreadable, fail-secure), and then the existing flow
 * applies unchanged (isDeviceVerificationRequired). Off: a Training Hub
 * student signs in without a new-device code; the password lockout and the
 * email confirmation at signup are untouched.
 */
export async function isTrainingDeviceVerificationRequired(): Promise<boolean> {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('training_settings').select('value').eq('key', TRAINING_DEVICE_VERIFICATION_SETTING_KEY).maybeSingle();
    if ((data?.value ?? 'true') === 'false') return false;
  } catch { /* fail-secure: fall through to the shared rule */ }
  return isDeviceVerificationRequired();
}

export async function isDeviceVerificationRequired(): Promise<boolean> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', DEVICE_VERIFICATION_SETTING_KEY)
      .maybeSingle();
    return (data?.value ?? 'true') !== 'false';
  } catch {
    return true;
  }
}
