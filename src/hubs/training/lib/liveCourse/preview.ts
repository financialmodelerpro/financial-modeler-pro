/**
 * Admin preview link for a course that is not public (draft or archived).
 * Stateless: an HMAC of the course code with the server secret, so the link
 * works on the learn subdomain without an admin session there, and changing
 * the secret revokes every link. Never stored.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || '';
}

export function previewToken(courseCode: string): string {
  const s = secret();
  if (!s) return '';
  return createHmac('sha256', s).update(`live-course-preview:${courseCode.toUpperCase()}`).digest('hex').slice(0, 32);
}

export function isValidPreviewToken(courseCode: string, token: string | null | undefined): boolean {
  const want = previewToken(courseCode);
  if (!want || !token || token.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(token));
}
