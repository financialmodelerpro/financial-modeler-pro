import { redirect } from 'next/navigation';

/**
 * Generic Coming Soon gate (dependency-inverted shared primitive).
 *
 * Pure shared code: zero hub-specific imports. Each hub composes this with
 * its own state-getter, its own bypass-check, and its own redirect URL via
 * a thin per-hub adapter (see `src/hubs/training/lib/ensureNotComingSoon.ts`
 * and `src/hubs/modeling/lib/ensureNotComingSoon.ts`).
 *
 * Semantics:
 *   - state.enabled === false  -> no-op (hub is live, normal flow continues)
 *   - state.enabled === true   -> consult `isAllowedThrough()`
 *       - returns true  -> caller passes (admin / whitelisted / cookie-bypassed)
 *       - returns false -> redirect to `redirectTo`
 *
 * This file replaces the old `src/lib/shared/comingSoonGuard.ts`, which had
 * direct imports of `getTrainingCookieSession`, `getServerSession`, the
 * NextAuth options, and both hub state-getters. Those have all been pushed
 * down into per-hub adapter files so this file stays pure.
 */

export interface ComingSoonState {
  enabled: boolean;
}

/** Returns true when the request should bypass the gate (admin, allowlisted, etc). */
export type BypassCheck = () => Promise<boolean>;

export interface ShouldGateComingSoonOpts {
  state:            ComingSoonState;
  isAllowedThrough: BypassCheck;
  redirectTo:       string;
}

export async function shouldGateComingSoon(opts: ShouldGateComingSoonOpts): Promise<void> {
  if (!opts.state.enabled) return;
  if (await opts.isAllowedThrough()) return;
  redirect(opts.redirectTo);
}
