import { getTrainingComingSoonState } from './comingSoon';
import { getTrainingCookieSession } from './session/trainingSessionCookie';
import { isTrainingIdentifierBypassed } from '@/src/shared/comingSoon/bypassList';
import { shouldGateComingSoon } from '@/src/shared/comingSoon/guard';

/**
 * Training-Hub Coming Soon gate. Wraps the shared `shouldGateComingSoon`
 * primitive with Training-Hub-specific bypass logic:
 *
 *   - Reads the `training_hub_coming_soon` flag from `training_settings`.
 *   - Bypass via the bypass list (`training_hub_bypass_list` setting):
 *     a student whose cookie session email or regId is on the list passes.
 *
 * Used by every authed `/training/*` segment's `layout.tsx` so gating
 * cascades across the whole hub without per-page boilerplate.
 *
 * Replaces the legacy `ensureNotComingSoon('training')` call from the
 * pre-2.6 `src/lib/shared/comingSoonGuard.ts`.
 */
export async function ensureNotComingSoon(): Promise<void> {
  const state = await getTrainingComingSoonState();
  return shouldGateComingSoon({
    state,
    isAllowedThrough: async () => {
      const sess = await getTrainingCookieSession();
      if (!sess) return false;
      if (await isTrainingIdentifierBypassed(sess.email))          return true;
      if (await isTrainingIdentifierBypassed(sess.registrationId)) return true;
      return false;
    },
    redirectTo: '/signin',
  });
}
