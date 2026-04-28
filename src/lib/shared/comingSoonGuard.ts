import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getTrainingComingSoonState } from '@/src/hubs/training/lib/comingSoon';
import { getModelingComingSoonState } from './modelingComingSoon';
import { isTrainingIdentifierBypassed } from '@/src/shared/comingSoon/bypassList';
import { isEmailWhitelisted } from './modelingAccess';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

/**
 * Server-side guard for authed pages and any other surface that should be
 * hidden while a hub is in Coming Soon mode.
 *
 * Behavior while Coming Soon is ON: redirect to `/signin`. The signin page
 * is itself Coming-Soon-gated and renders the launch countdown for the
 * non-bypassed visitor. For Modeling Hub the redirect appends
 * `?bypass=true` so a returning admin / whitelisted user lands on the
 * actual signin form (not the launch clock) when their JWT has expired.
 *
 * Bypass paths:
 *   - Training Hub: if the student's training_session cookie email or
 *     regId is on the `training_hub_bypass_list` setting, they pass
 *     through even while CS is on. Same allowlist used by
 *     /api/training/validate so end-to-end testing works without flipping
 *     the hub state.
 *   - Modeling Hub: NextAuth admin role OR membership in the
 *     `modeling_access_whitelist` table. Mirrors the gating in auth.ts so
 *     a fresh admin login + a pre-authorized whitelisted user can browse
 *     the authed surface (/refm, future /modeling/* segments) while CS
 *     is on, without being bounced back to the launch countdown.
 *
 * Behavior while Coming Soon is OFF: no-op. Normal auth flow takes over.
 *
 * Used by per-segment `layout.tsx` files under `/training/*` + `/refm/*`
 * so gating cascades across every page inside an authed segment without
 * having to touch each page's render path.
 */
export async function ensureNotComingSoon(hub: 'training' | 'modeling'): Promise<void> {
  const state = hub === 'training'
    ? await getTrainingComingSoonState()
    : await getModelingComingSoonState();
  if (!state.enabled) return;

  if (hub === 'training') {
    const sess = await getTrainingCookieSession();
    if (sess) {
      // Try email first, then the regId — the allowlist accepts either
      // form. `isTrainingIdentifierBypassed` is case-insensitive.
      if (await isTrainingIdentifierBypassed(sess.email))           return;
      if (await isTrainingIdentifierBypassed(sess.registrationId))  return;
    }
    redirect('/signin');
  }

  // hub === 'modeling'
  const session = await getServerSession(authOptions);
  const role  = (session?.user as { role?: string } | undefined)?.role;
  const email = session?.user?.email ?? null;
  if (role === 'admin') return;
  if (email && await isEmailWhitelisted(email)) return;

  redirect('/signin?bypass=true');
}
