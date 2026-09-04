/**
 * seats.ts
 *
 * SEATS. Module 10 Collaboration step 8; recounted by ACCOUNT MODEL step 3.
 *
 * A seat is A DISTINCT PERSON ON AN ACCOUNT. Since mig 239 an account is a
 * ROW (`accounts`, holder = `owner_user_id`), so the count is its people
 * DIRECTLY: `users.account_id = account`. Not per project, not per membership
 * row, and no longer inferred by walking projects.
 *
 * ── DECISION 2026-09-04: SEATS BECOME PER PLATFORM when a second platform
 * ships. Platforms are sold and paid for separately (user_platform_
 * subscriptions is already keyed by platform_slug), so a seat will be a
 * person on an account ON A PLATFORM. Account-wide is CORRECT today, with
 * REFM the only live platform, and the per-platform version is deliberately
 * NOT built. When it is: the person-platform fact does not exist yet (a new
 * table or a platform column on account_invites), the `seats` entitlement
 * key has no platform dimension, and the split must ride with per-platform
 * PLAN resolution (users.subscription_plan is one global key). Full
 * assessment in CHANGELOG 2026-09-04. ──────────────────────────────────────
 *
 * ── WHY THE PROJECT WALK IS GONE (step 3, 2026-09-04) ─────────────────────
 *
 * The step-8 counter collected whoever appeared in the membership rows of
 * every project the holder owned. That arithmetic was right over a set with
 * no boundary: it counted people REACHABLE THROUGH projects, which is why
 * adding another client's user consumed YOUR seat while their own account
 * was untouched. With the account boundary enforced (step 2), project
 * membership can only name people already on the account (or a platform
 * admin), so "who is on the account" is the whole question and the walk
 * answered a different one. It also makes the count platform-agnostic for
 * free: ERM and BVM projects can only ever be shared with account people,
 * who are counted here whether or not those platforms exist yet.
 *
 * A consequence, stated because it is the point: PROJECT membership never
 * creates a seat. A person occupies a seat by BEING ON THE ACCOUNT, and the
 * paths that put someone on an account (signup today, invites in a later
 * step) are where the limit will bite.
 *
 * ── THE OWNER CONSUMES A SEAT ─────────────────────────────────────────────
 *
 * Counted ALWAYS, added to the set unconditionally: "Pro is 1 seat, which
 * means no collaboration" only holds if the owner is that one, and an
 * account with no other people still uses its own seat.
 *
 * ── A MISSING SCHEMA REFUSES, NEVER UNDER-COUNTS ──────────────────────────
 *
 * On a pre-239 database there is no accounts table and the count THROWS,
 * naming the migration; the route turns that into a refusal with the reason.
 * Falling back to "just the owner" would quietly hand out seats, which is
 * the same wrong the project walk risked in the other direction.
 *
 * ── COMPUTED LIVE, NEVER STORED ───────────────────────────────────────────
 *
 * Two indexed reads against small tables. A stored counter would have to be
 * corrected on add, remove, account join and account deletion, and the first
 * one anybody forgets is a customer either blocked out of seats they paid
 * for or handed seats they did not.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEffectiveFeatures, type ResolveFeature, type PlanCell, type UserOverride } from '@/src/shared/entitlements/resolveOverrides';

/** The entitlement key. One spelling, shared with plan_permissions, the
 *  overrides table and the pricing page. */
export const SEATS_FEATURE_KEY = 'seats';

/** A limit of -1 means unlimited, matching every other limit in the platform. */
export const UNLIMITED = -1;

/**
 * Does a seat count fit inside a limit? PURE, so the route, the verifier and
 * any future surface answer identically.
 *
 * `-1` is unlimited. A limit of 0 or a missing one denies, which is the safe
 * direction: an account whose plan says nothing about seats does not get
 * unlimited collaborators by default.
 */
export function seatsAllow(used: number, limit: number | null): boolean {
  if (limit === UNLIMITED) return true;
  if (limit === null || limit === undefined || limit <= 0) return false;
  return used <= limit;
}

export interface SeatUsage {
  /** Distinct people on the account, INCLUDING the holder. */
  used: number;
  /** Their ids, so a caller can ask whether a candidate is already among them
   *  without a second query. */
  userIds: Set<string>;
}

/**
 * Every distinct person ON this holder's account: the holder plus every user
 * whose `account_id` points at the holder's `accounts` row. The account is
 * resolved through `accounts.owner_user_id`, the authoritative holder pointer
 * (mig 239), never through a project.
 */
export async function countAccountSeats(
  sb: SupabaseClient, holderId: string,
): Promise<SeatUsage> {
  // The holder, always, added to the set unconditionally.
  const userIds = new Set<string>([holderId]);

  const { data: acct, error: acctErr } = await sb
    .from('accounts').select('id').eq('owner_user_id', holderId).maybeSingle();
  if (acctErr) {
    // Pre-239 there is no denominator to count over; refusing loudly beats a
    // quiet owner-only number that hands out seats.
    throw new Error(`seat count failed: ${acctErr.message} (accounts needs migration 239)`);
  }
  if (!acct) {
    // Post-239 every user holds an account; a holder without one is a broken
    // invariant, and a count over half the facts must not decide anything.
    throw new Error('seat count failed: this holder has no accounts row (invariant broken, see verify-accounts)');
  }

  const { data: people, error: peopleErr } = await sb
    .from('users').select('id')
    .eq('account_id', (acct as { id: string }).id)
    .range(0, 4999);
  if (peopleErr) throw new Error(`seat count failed: ${peopleErr.message}`);
  for (const row of people ?? []) {
    const uid = (row as { id?: unknown }).id;
    if (typeof uid === 'string' && uid) userIds.add(uid);
  }

  return { used: userIds.size, userIds };
}

/**
 * The seat limit for one account: the plan's value, unless an admin override
 * says otherwise.
 *
 * REUSES `resolveEffectiveFeatures` rather than re-implementing the rule.
 * That function already decides "an active override with a value wins over the
 * plan value, an expired one does not", and a second copy of that sentence
 * here would be the divergence this codebase keeps finding. It is fed a
 * one-feature list because the answer needed is one feature.
 */
export async function resolveSeatLimit(
  sb: SupabaseClient, holderId: string, nowMs: number = Date.now(),
): Promise<{ limit: number | null; source: 'plan' | 'override' | 'none'; planKey: string | null; isPlatformAdmin: boolean }> {
  const { data: user, error: userErr } = await sb
    .from('users').select('subscription_plan, role').eq('id', holderId).maybeSingle();
  if (userErr) throw new Error(`seat limit failed: ${userErr.message}`);
  const planKey = (user as { subscription_plan?: string } | null)?.subscription_plan ?? null;
  const isPlatformAdmin = (user as { role?: string } | null)?.role === 'admin';

  const { data: planRow } = await sb
    .from('plan_permissions').select('included, limit_value')
    .eq('feature_key', SEATS_FEATURE_KEY).eq('plan_key', planKey ?? '').maybeSingle();
  const { data: ovRow } = await sb
    .from('user_permissions').select('mode, override_value, expires_at')
    .eq('feature_key', SEATS_FEATURE_KEY).eq('user_id', holderId).maybeSingle();

  const feature: ResolveFeature = {
    feature_key: SEATS_FEATURE_KEY, label: 'Team Seats', category: 'limits',
    feature_type: 'limit', display_order: 0,
  };
  const planCells = new Map<string, PlanCell>([[SEATS_FEATURE_KEY, {
    included: (planRow as { included?: boolean } | null)?.included ?? false,
    limit_value: (planRow as { limit_value?: number | null } | null)?.limit_value ?? null,
  }]]);
  const overrides: UserOverride[] = ovRow
    ? [{
        feature_key: SEATS_FEATURE_KEY,
        mode: (ovRow as { mode: 'grant' | 'revoke' }).mode,
        override_value: (ovRow as { override_value: number | null }).override_value,
        reason: null,
        expires_at: (ovRow as { expires_at: string | null }).expires_at ?? null,
      }]
    : [];

  const [resolved] = resolveEffectiveFeatures([feature], planCells, overrides, nowMs);
  return { limit: resolved.value ?? null, source: resolved.source, planKey, isPlatformAdmin };
}

export interface SeatDecision {
  allowed: boolean;
  /** Set when the candidate already holds a seat, so nothing is consumed. */
  alreadySeated: boolean;
  used: number;
  /** The count AFTER the change, which is what the limit is tested against. */
  wouldUse: number;
  limit: number | null;
  limitSource: 'plan' | 'override' | 'none';
  planKey: string | null;
  /** Operator-facing. Empty when allowed. */
  message: string;
}

/**
 * May this person be given access to this account's projects?
 *
 * ── A ROLE CHANGE IS NOT A NEW SEAT ───────────────────────────────────────
 *
 * The question asked is "does this user already hold a seat on this account",
 * NOT "will a row be inserted". The membership write is an UPSERT, so changing
 * someone from Viewer to Editor goes through the same call as adding them; a
 * check that counted rows-to-be-written would refuse to demote the tenth
 * member of a full Firm account. Since step 3 the seat set IS the account's
 * people, so anyone the boundary admits as same-account is already seated and
 * adding them to any number of projects is free; the limit bites where people
 * JOIN the account, not where projects are shared.
 *
 * ── THE LIMIT BELONGS TO THE ACCOUNT, NOT TO WHOEVER IS TYPING ────────────
 *
 * Only an admin can reach this route today, so testing the ACTOR would mean
 * the limit never fires at all. It is the account being modified that has a
 * plan, so that is what is measured. The one exemption is an account whose
 * holder is a PLATFORM ADMIN (`users.role === 'admin'`), which follows the
 * standing "admin is never blocked" rule that `resolveUserGate` applies
 * everywhere else: the operator's own workspace is not rationed.
 */
export async function checkSeatForMember(
  sb: SupabaseClient, holderId: string, candidateUserId: string, nowMs: number = Date.now(),
): Promise<SeatDecision> {
  const [{ used, userIds }, { limit, source, planKey, isPlatformAdmin }] = await Promise.all([
    countAccountSeats(sb, holderId),
    resolveSeatLimit(sb, holderId, nowMs),
  ]);

  const alreadySeated = userIds.has(candidateUserId);
  const wouldUse = alreadySeated ? used : used + 1;
  const base = { alreadySeated, used, wouldUse, limit, limitSource: source, planKey };

  // An existing member costs nothing, so a role change is never refused, even
  // on an account that is already at or over its limit.
  if (alreadySeated) return { ...base, allowed: true, message: '' };
  if (isPlatformAdmin) return { ...base, allowed: true, message: '' };
  if (seatsAllow(wouldUse, limit)) return { ...base, allowed: true, message: '' };

  return { ...base, allowed: false, message: '' };
}

/**
 * The refusal, in words, for the OPERATOR. It names the account, its limit and
 * how to raise it, because the only person who can see it is the admin doing
 * the adding, and "seat limit reached" alone would send them looking.
 *
 * Deliberately NOT the end-user "contact the team to increase seats" copy:
 * there is no non-admin caller that can reach this route, so that sentence has
 * no surface to appear on and writing it now would be writing it blind.
 */
export function seatBlockMessage(d: SeatDecision, holderEmail: string | null, candidateEmail: string | null): string {
  const who = holderEmail ?? 'this account';
  const cand = candidateEmail ? ` Adding ${candidateEmail}` : ' Adding another member';
  const plan = d.planKey ? ` on the ${d.planKey} plan` : '';
  const limitText = d.limit === null || d.limit <= 0 ? 'no seats' : `${d.limit} seat${d.limit === 1 ? '' : 's'}`;
  const via = d.limitSource === 'override' ? ' (already raised by an override)' : '';
  return (
    `Seat limit reached. ${who}${plan} has ${limitText}${via} and is using ${d.used} of them, counting the owner.` +
    `${cand} would need ${d.wouldUse}.` +
    ` Raise it in /admin/access: find ${who}, grant Team Seats and set a higher value. Extra seats are invoiced manually.` +
    ` Removing an existing member frees a seat immediately.`
  );
}
