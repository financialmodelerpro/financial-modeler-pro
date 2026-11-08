/**
 * Admin check for the live-course admin routes. Same rule as the other
 * training admin routes: a NextAuth session whose role is 'admin'.
 * getServerSession can throw without a request scope (TRAPS 9.4), so a throw
 * is a refusal, never an error page.
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';

export async function adminEmail(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { role?: string; email?: string | null } | undefined;
    return user?.role === 'admin' ? (user.email ?? 'admin') : null;
  } catch {
    return null;
  }
}
