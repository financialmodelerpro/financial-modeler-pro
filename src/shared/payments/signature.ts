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

/**
 * Parse a Paddle-Signature header ("ts=...;h1=...") into its parts. Returns null
 * when the header is missing or does not carry both ts and h1.
 */
export function parsePaddleSignatureHeader(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  let ts = '', h1 = '';
  for (const part of header.split(';')) {
    const [k, v] = part.split('=');
    if (k?.trim() === 'ts') ts = (v ?? '').trim();
    else if (k?.trim() === 'h1') h1 = (v ?? '').trim();
  }
  return ts && h1 ? { ts, h1 } : null;
}

/**
 * Verify a Paddle Billing webhook signature per Paddle docs: the signed payload
 * is `${ts}:${rawBody}` (the EXACT raw bytes, never reparsed), HMAC-SHA256 under
 * the notification destination secret key, compared in constant time to h1.
 *
 * Optional `toleranceSeconds` rejects a stale timestamp (replay protection at
 * the signature layer). Pass `nowMs` for testability. A value of 0 disables the
 * freshness check (the webhook route also enforces idempotency, the definitive
 * replay guard). Never throws; an unparseable header is an explicit failure.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string | null,
  toleranceSeconds = 0,
  nowMs = 0,
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'no_webhook_secret' };
  const parsed = parsePaddleSignatureHeader(header);
  if (!parsed) return { valid: false, reason: 'missing_signature' };
  const expected = hmacSha256Hex(`${parsed.ts}:${rawBody}`, secret);
  if (!timingSafeHexEqual(parsed.h1, expected)) return { valid: false, reason: 'signature_mismatch' };
  if (toleranceSeconds > 0) {
    const tsSec = Number(parsed.ts);
    const now = (nowMs > 0 ? nowMs : Date.now()) / 1000;
    if (!Number.isFinite(tsSec) || Math.abs(now - tsSec) > toleranceSeconds) {
      return { valid: false, reason: 'timestamp_out_of_tolerance' };
    }
  }
  return { valid: true };
}
