import { cookies } from 'next/headers';
import {
  TRAINING_SESSION_COOKIE, TRAINING_SESSION_COOKIE_OPTIONS, readTrainingSession, encodeTrainingSession,
} from './issueTrainingSession';

export interface TrainingCookieSession {
  email: string;
  registrationId: string;
}

/**
 * The ONE server-side reader of the Training Hub session (2026-09-26: the
 * cookie is SIGNED; see issueTrainingSession.ts). Returns null when the cookie
 * is missing, forged, tampered with or expired. An unsigned cookie from before
 * the change is accepted until the cutoff and re-issued signed here the first
 * time a route handler reads it, so no student is signed out. (A server
 * component cannot set cookies; there the re-issue is skipped and the next
 * route handler does it.)
 */
export async function getTrainingCookieSession(): Promise<TrainingCookieSession | null> {
  try {
    const cookieStore = await cookies();
    const read = readTrainingSession(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);
    if (!read) return null;
    if (read.legacy) {
      try {
        cookieStore.set(TRAINING_SESSION_COOKIE, encodeTrainingSession(read.session.email, read.session.registrationId), {
          ...TRAINING_SESSION_COOKIE_OPTIONS, secure: process.env.NODE_ENV === 'production',
        });
      } catch { /* a server component: the next route handler re-issues it */ }
    }
    return { email: read.session.email, registrationId: read.session.registrationId };
  } catch {
    return null;
  }
}
