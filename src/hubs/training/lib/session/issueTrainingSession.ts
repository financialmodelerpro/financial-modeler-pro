/**
 * issueTrainingSession.ts (2026-09-26)
 *
 * The ONE place the Training Hub's server session cookie is issued, so the two
 * ways a student finishes signing in cannot disagree about it.
 *
 *   1. Password on a trusted device: /api/training/validate.
 *   2. Password on a NEW device, then the emailed code: /api/training/device-verify.
 *
 * Until 2026-09-26 only path 1 set the cookie. Path 2 stored the session in
 * localStorage alone, so the student looked signed in on every page while
 * every cookie-gated API (starting a timed assessment first of all) answered
 * 401, which the assessment page reported as "check your connection". That
 * hit every student's first sign-in on a new device, and for ever for a
 * student who never ticked "Trust this device".
 *
 * The code step must stay a SECOND factor, never a way around the password:
 * `validate` issues a short-lived signed PENDING cookie naming the email whose
 * password it just checked, and device-verify issues the session only when
 * that cookie is present, unexpired and names the same email.
 *
 * No em dashes in this file.
 */
import crypto from 'crypto';
import type { NextResponse } from 'next/server';

export const TRAINING_SESSION_COOKIE = 'training_session';
export const TRAINING_SESSION_MAX_AGE = 60 * 60; // 1 hour, as the client-side session
export const DEVICE_PENDING_COOKIE = 'training_device_pending';
export const DEVICE_PENDING_MAX_AGE = 15 * 60;   // the OTP lives 10 minutes

const secure = (): boolean => process.env.NODE_ENV === 'production';

/**
 * THE SESSION COOKIE IS SIGNED (2026-09-26). It was plain JSON
 * { email, registrationId }, httpOnly (so page script could not read it) but
 * trivially WRITABLE: anyone could send one naming another student and act as
 * them on every route that trusts it. It is now
 *   v1.<base64url {e, r, x}>.<HMAC-SHA256>
 * signed with the server secret under its own context string (so no other
 * signature in this codebase can be replayed as a session), carrying its own
 * expiry. This is the interim signature; a standard JWT is the follow-up.
 *
 * NOBODY IS SIGNED OUT: an unsigned cookie is still accepted until
 * LEGACY_UNSIGNED_ACCEPTED_UNTIL, and re-issued signed the first time a route
 * handler reads it. Every unsigned cookie was issued with a one-hour life
 * before this shipped and none is ever refreshed, so after that moment no
 * genuine unsigned cookie can exist; the acceptance code is then dead and is
 * removed with the JWT follow-up. Until that moment the old hole stays open,
 * which is the stated cost of not signing anyone out.
 */
export const LEGACY_UNSIGNED_ACCEPTED_UNTIL = Date.parse('2026-09-26T13:30:00Z');
const SESSION_CONTEXT = 'fmp.training_session.v1';

export interface TrainingSessionClaims { email: string; registrationId: string }

export function encodeTrainingSession(email: string, registrationId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    e: email.trim().toLowerCase(), r: registrationId, x: now + TRAINING_SESSION_MAX_AGE * 1000,
  })).toString('base64url');
  return `v1.${payload}.${sessionSign(payload)}`;
}

function sessionSign(payload: string): string {
  return crypto.createHmac('sha256', pendingSecret()).update(`${SESSION_CONTEXT}.${payload}`).digest('base64url');
}

/**
 * The ONE reader of a session cookie value. Signed: verified (constant-time)
 * and unexpired, or null. Unsigned: accepted only before the cutoff, and
 * flagged `legacy` so the caller re-issues it signed.
 */
export function readTrainingSession(
  value: string | undefined, now = Date.now(),
): { session: TrainingSessionClaims; legacy: boolean } | null {
  if (!value) return null;
  if (value.startsWith('v1.')) {
    const parts = value.split('.');
    if (parts.length !== 3) return null;
    const [, payload, sig] = parts;
    let expected: Buffer;
    try { expected = Buffer.from(sessionSign(payload)); } catch { return null; }
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: string; r?: string; x?: number };
      if (!p.e || typeof p.x !== 'number' || p.x < now) return null;
      return { session: { email: p.e, registrationId: String(p.r ?? '') }, legacy: false };
    } catch { return null; }
  }
  if (now >= LEGACY_UNSIGNED_ACCEPTED_UNTIL) return null;
  try {
    const p = JSON.parse(value) as { email?: string; registrationId?: string };
    if (!p.email) return null;
    return { session: { email: String(p.email).trim().toLowerCase(), registrationId: String(p.registrationId ?? '') }, legacy: true };
  } catch { return null; }
}

export const TRAINING_SESSION_COOKIE_OPTIONS = {
  httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: TRAINING_SESSION_MAX_AGE,
};

export function setTrainingSessionCookie(res: NextResponse, email: string, registrationId: string): void {
  res.cookies.set(TRAINING_SESSION_COOKIE, encodeTrainingSession(email, registrationId),
    { ...TRAINING_SESSION_COOKIE_OPTIONS, secure: secure() });
}

function pendingSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set; cannot sign a Training Hub cookie.');
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', pendingSecret()).update(payload).digest('base64url');
}

/** Called by validate when the password is right but the device is new. */
export function setDevicePendingCookie(res: NextResponse, email: string, registrationId: string, now = Date.now()): void {
  const payload = Buffer.from(JSON.stringify({
    e: email.toLowerCase(), r: registrationId, x: now + DEVICE_PENDING_MAX_AGE * 1000,
  })).toString('base64url');
  res.cookies.set(DEVICE_PENDING_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: secure(), sameSite: 'lax', path: '/api/training', maxAge: DEVICE_PENDING_MAX_AGE,
  });
}

/**
 * The email and registration id whose password `validate` checked, or null
 * when the cookie is missing, forged, expired, or names a different email.
 */
export function readDevicePending(
  cookieValue: string | undefined, email: string, now = Date.now(),
): { email: string; registrationId: string } | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const given = Buffer.from(cookieValue.slice(dot + 1));
  let expected: Buffer;
  try { expected = Buffer.from(sign(payload)); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: string; r?: string; x?: number };
    if (!p.e || !p.r || typeof p.x !== 'number' || p.x < now) return null;
    if (p.e !== email.toLowerCase()) return null;
    return { email: p.e, registrationId: p.r };
  } catch {
    return null;
  }
}

export function clearDevicePendingCookie(res: NextResponse): void {
  res.cookies.set(DEVICE_PENDING_COOKIE, '', { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/api/training', maxAge: 0 });
}
