import { redirect } from 'next/navigation';
import { getTrainingComingSoonState } from './trainingComingSoon';
import { getModelingComingSoonState } from './modelingComingSoon';

/**
 * Server-side guard for authed pages and any other surface that should be
 * hidden while a hub is in Coming Soon mode.
 *
 * Behavior while Coming Soon is ON: redirect to `/signin`. The signin page
 * is itself Coming-Soon-gated and renders the launch countdown, so this
 * turns into "show the student the launch clock" instead of leaking the
 * authed UI to anyone with a stale cookie / direct link / admin bypass.
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
  if (state.enabled) {
    redirect('/signin');
  }
}
