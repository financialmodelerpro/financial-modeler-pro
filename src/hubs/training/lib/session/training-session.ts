/**
 * training-session.ts - Client-side localStorage helper for training auth.
 * SSR-safe: all localStorage access is guarded by typeof window checks.
 *
 * Session expires after 24 hours.
 */

const STORAGE_KEY = 'training_session';
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface TrainingSession {
  email: string;
  registrationId: string;
  expiresAt: number; // Unix ms timestamp
}

/** Returns the current training session or null if missing/expired. */
export function getTrainingSession(): Omit<TrainingSession, 'expiresAt'> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrainingSession;
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { email: parsed.email, registrationId: parsed.registrationId };
  } catch {
    return null;
  }
}

/** Stores a training session with a 1-hour expiry. */
export function setTrainingSession(email: string, registrationId: string): void {
  if (typeof window === 'undefined') return;
  const session: TrainingSession = {
    email,
    registrationId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** Clears the training session from localStorage. */
export function clearTrainingSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
