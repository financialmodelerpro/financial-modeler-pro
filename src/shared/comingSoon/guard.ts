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
  /** Where a visitor with NO session goes. Usually the hub's sign-in page. */
  redirectTo:       string;
  /** True when the request carries a session. Optional: a caller that does not
   *  supply it keeps the single-target behaviour. */
  hasSession?:      () => Promise<boolean>;
  /** Where a SIGNED-IN user goes instead. Must not be the sign-in page: that
   *  page bounces an authenticated user straight back, which is a loop. */
  signedInRedirectTo?: string;
}

export async function shouldGateComingSoon(opts: ShouldGateComingSoonOpts): Promise<void> {
  if (!opts.state.enabled) return;
  if (await opts.isAllowedThrough()) return;
  // A SIGNED-IN USER IS NEVER SENT TO THE SIGN-IN PAGE (2026-08-20).
  //
  // The Modeling adapter's redirect target is `/signin?bypass=true`, which is
  // right for a visitor with no session and a LOOP for one who is already
  // signed in: `/signin` sees the session, finds its own (separate) coming-soon
  // flag disabled, and sends them to `/dashboard`, which is the platform
  // selector they just came from. Measured live: a trial user with a valid
  // entitlement clicked Open Platform and landed back on the selector, having
  // never reached the entitlement gate at all.
  //
  // `signedInRedirectTo` lets the caller name somewhere that EXPLAINS the
  // situation instead. Optional, so a caller that has no such page keeps
  // today's behaviour rather than being forced to invent one.
  if (opts.signedInRedirectTo && await opts.hasSession?.()) {
    redirect(opts.signedInRedirectTo);
  }
  redirect(opts.redirectTo);
}
