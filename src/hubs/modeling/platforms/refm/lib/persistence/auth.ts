/**
 * REFM persistence: NextAuth session helper.
 *
 * Wraps `getServerSession(authOptions)` so the REFM API routes don't
 * each repeat the cast-to-extract-id boilerplate. Returns the user id
 * (NextAuth `users.id`) when an authenticated session exists, or null
 * otherwise.
 *
 * The id is the FK target for `refm_projects.user_id`. Server routes
 * MUST pass it into every `.eq('user_id', ...)` filter, RLS is
 * defense-in-depth (the SERVICE_ROLE client bypasses it), so the
 * application layer is the actual access boundary.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';

export async function getRefmUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  return id ?? null;
}

/**
 * Returns the user id plus whether the session role is admin. The admin flag
 * lets entitlement choke points bypass the gate even if a later DB resolution
 * fails (an admin is never blocked). Role comes from the JWT (set at sign in).
 */
export async function getRefmUserContext(): Promise<{ userId: string | null; isAdmin: boolean }> {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; role?: string } | undefined;
  return { userId: u?.id ?? null, isAdmin: u?.role === 'admin' };
}
