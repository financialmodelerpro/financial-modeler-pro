import { getServerSession } from 'next-auth';
import { getModelingComingSoonState } from './comingSoon';
import { isEmailWhitelisted } from './access';
import { authOptions } from '@/src/shared/auth/nextauth';
import { shouldGateComingSoon } from '@/src/shared/comingSoon/guard';

/**
 * Modeling-Hub Coming Soon gate. Wraps the shared `shouldGateComingSoon`
 * primitive with Modeling-Hub-specific bypass logic:
 *
 *   - Reads the `modeling_hub_coming_soon` flag from `training_settings`.
 *   - NextAuth admin role bypasses the gate.
 *   - `modeling_access_whitelist` membership bypasses the gate (lets
 *     pre-authorized testers reach `/refm` and future Modeling segments
 *     while the hub is still in Coming Soon mode).
 *
 * Redirect target is `/signin?bypass=true` so a returning admin or
 * whitelisted user with an expired JWT lands on the actual signin form
 * instead of the launch countdown.
 *
 * Replaces the legacy `ensureNotComingSoon('modeling')` call from the
 * pre-2.6 `src/lib/shared/comingSoonGuard.ts`.
 */
export async function ensureNotComingSoon(): Promise<void> {
  const state = await getModelingComingSoonState();
  return shouldGateComingSoon({
    state,
    isAllowedThrough: async () => {
      const session = await getServerSession(authOptions);
      const role  = (session?.user as { role?: string } | undefined)?.role;
      const email = session?.user?.email ?? null;
      if (role === 'admin') return true;
      if (email && await isEmailWhitelisted(email)) return true;
      return false;
    },
    redirectTo: '/signin?bypass=true',
    // A SIGNED-IN USER MUST NEVER BE SENT TO /signin. That page sees the
    // session, finds its own coming-soon flag disabled, and redirects to
    // /dashboard, which is the platform selector the user just came from: a
    // loop with no explanation, and the entitlement gate below is never
    // reached. Measured live 2026-08-20 on a trial user with a valid plan.
    //
    // The dashboard is the honest destination for someone who IS signed in but
    // cannot enter the workspace yet: it is where the launch banner and their
    // plan state live, so the answer is on the page they land on.
    hasSession: async () => {
      const session = await getServerSession(authOptions);
      return Boolean(session?.user);
    },
    signedInRedirectTo: '/dashboard?hub=coming-soon',
  });
}
