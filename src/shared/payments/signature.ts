/**
 * payments/signature.ts
 *
 * Real, shared webhook signature-verification primitive: HMAC-SHA256 over the
 * raw request body, compared in constant time against the signature header,
 * keyed by the provider's stored webhook secret.
 *
 * Each provider stub calls this so the verification CODE PATH is genuinely
 * exercised today (a tampered body or wrong secret is rejected). The EXACT
 * header name + encoding + any provider-specific signed payload prefix differ
 * per provider and must be confirmed against the provider docs when an adapter
 * is implemented; until then this conservative HMAC scheme stands in.
 *
 * No em dashes in this file.
 */
import crypto from 'crypto';

/** Compute the hex HMAC-SHA256 of `body` under `secret`. */
export function hmacSha256Hex(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/** Constant-time compare of two hex strings of equal length. */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a webhook signature. A missing secret or missing signature is an
 * explicit failure (never a silent pass). The signature header may carry an
 * algorithm prefix (for example "sha256="), which is stripped before compare.
 */
export function verifyHmacSignature(
  rawBody: string,
  signature: string | null,
  secret: string | null,
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'no_webhook_secret' };
  if (!signature) return { valid: false, reason: 'missing_signature' };
  const provided = signature.includes('=') ? signature.split('=').pop() ?? '' : signature;
  const expected = hmacSha256Hex(rawBody, secret);
  return timingSafeHexEqual(provided.trim(), expected)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}
