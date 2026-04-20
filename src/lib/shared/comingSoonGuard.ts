import { redirect } from 'next/navigation';
import { getTrainingComingSoonState } from './trainingComingSoon';
import { getModelingComingSoonState } from './modelingComingSoon';
import { isTrainingIdentifierBypassed } from './hubBypassList';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';

/**
 * Server-side guard for authed pages and any other surface that should be
 * hidden while a hub is in Coming Soon mode.
 *
 * Behavior while Coming Soon is ON: redirect to `/signin`. The signin page
 * is itself Coming-Soon-gated and renders the launch countdown, so this
 * turns into "show the student the launch clock" instead of leaking the
 * authed UI to anyone with a stale cookie / direct link / admin bypass.
 *
 * Bypass path (Training Hub only): if the student's training_session cookie
 * email or regId is on the `training_hub_bypass_list` setting, they pass
 * through even while CS is on. This mirrors the same allowlist the
 * /api/training/validate endpoint checks, so end-to-end testing by the
 * platform owner works without flipping the hub state. Modeling Hub uses
 * NextAuth's admin role for the equivalent check (handled in auth.ts).
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
  }

  redirect('/signin');
}
