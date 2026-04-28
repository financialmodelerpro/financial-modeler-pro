import { cookies } from 'next/headers';

export interface TrainingCookieSession {
  email: string;
  registrationId: string;
}

/**
 * Read the httpOnly `training_session` cookie set by `/api/training/validate`.
 * Returns null when the cookie is missing or malformed. Server-side only.
 */
export async function getTrainingCookieSession(): Promise<TrainingCookieSession | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrainingCookieSession>;
    if (!parsed.email) return null;
    return {
      email: String(parsed.email).toLowerCase(),
      registrationId: String(parsed.registrationId ?? ''),
    };
  } catch {
    return null;
  }
}
