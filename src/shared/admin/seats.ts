/**
 * seats.ts
 *
 * SEATS. Module 10 Collaboration, step 8.
 *
 * A seat is A DISTINCT PERSON ON AN ACCOUNT, counted across every project that
 * account owns, on every platform. Not per project, and not per membership
 * row: one colleague added to four projects is one seat.
 *
 * ── IT LIVES HERE, NOT IN REFM, AND THAT IS THE POINT ─────────────────────
 *
 * The count iterates `PROJECT_SOURCES`. REFM is one entry today; ERM and BVM
 * join by declaring their membership columns, exactly as they do for card
 * ordering and the projects browser. A counter that read `refm_project_members`
 * directly would keep returning a correct-looking number and start UNDER
 * counting on the day a second platform shipped, which is the worst kind of
 * wrong: quiet, plausible, and in the customer's favour until someone notices.
 *
 * ── WHAT AN ACCOUNT IS ────────────────────────────────────────────────────
 *
 * The PLAN HOLDER, which today is `refm_projects.user_id`, the project owner.
 * There is no organisation table: plans live on `users.subscription_plan`, so
 * the person who owns the project is the person whose plan pays for it. When
 * an accounts concept arrives this is the one function that has to learn about
 * it.
 *
 * ── THE OWNER CONSUMES A SEAT ─────────────────────────────────────────────
 *
 * Counted ALWAYS, whether or not a membership row happens to exist for them.
 * Migration 231 seeded one per project, but a project created before that seed
 * or through a path that does not write membership would otherwise make the
 * owner free, and "Pro is 1 seat, which means no collaboration" only holds if
 * the owner is that one. So the holder is added to the set unconditionally and
 * an account with no projects at all still uses its own seat.
 *
 * ── A SOFT-DELETED PROJECT'S MEMBERS DO NOT COUNT ─────────────────────────
 *
 * `deleted_at` makes a project unopenable (getProject filters on it), so its
 * members cannot reach anything and charging a seat for them would bill for
 * access that does not exist. ARCHIVED projects DO count: archiving is
 * visible, reversible and leaves the project openable, so its members still
 * have real access.
 *
 * ── COMPUTED LIVE, NEVER STORED ───────────────────────────────────────────
 *
 * Two indexed reads against small tables. A stored counter would have to be
 * corrected on add, remove, project delete, project purge, project transfer
 * and account deletion, and the first one anybody forgets is a customer either
 * blocked out of seats they paid for or handed seats they did not.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROJECT_SOURCES, hasMembership, type ProjectSource } from './projectSources';
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

/** Project ids owned by this account on one source, excluding soft-deleted. */
async function ownedProjectIds(
  sb: SupabaseClient, source: ProjectSource, holderId: string,
): Promise<string[]> {
  let q = sb.from(source.table).select('id').eq(source.ownerColumn, holderId);
  if (source.deletedColumn) q = q.is(source.deletedColumn, null);
  const { data, error } = await q;
  if (error) {
    // A platform whose table or soft-delete column is not there yet must not
    // silently contribute zero: that would under-count and let a seat through.
    throw new Error(`seat count failed on ${source.shortLabel}: ${error.message}`);
  }
  return (data ?? []).map((r) => String((r as { id: unknown }).id));
}

export interface SeatUsage {
  /** Distinct people with access, INCLUDING the account owner. */
  used: number;
  /** Their ids, so a caller can ask whether a candidate is already among them
   *  without a second query. */
  userIds: Set<string>;
  /** Platforms actually counted, for the operator-facing message. */
  sources: string[];
}

/**
 * Every distinct person who can reach anything this account owns.
 *
 * Iterates the registry, so a platform that declares membership is counted the
 * day it ships and one that does not is skipped without pretending it
 * contributed zero members (it genuinely has none: no membership table means
 * owner-only access, which the holder already occupies).
 */
export async function countAccountSeats(
  sb: SupabaseClient, holderId: string,
): Promise<SeatUsage> {
  // The owner, always, whether or not a membership row exists for them.
  const userIds = new Set<string>([holderId]);
  const sources: string[] = [];

  for (const source of PROJECT_SOURCES) {
    if (!hasMembership(source)) continue;
    sources.push(source.shortLabel);
    const ids = await ownedProjectIds(sb, source, holderId);
    if (ids.length === 0) continue;
    const { data, error } = await sb
      .from(source.membersTable!)
      .select(source.membersUserColumn!)
      .in(source.membersProjectColumn!, ids);
    if (error) throw new Error(`seat count failed on ${source.shortLabel}: ${error.message}`);
    for (const row of data ?? []) {
      const uid = (row as unknown as Record<string, unknown>)[source.membersUserColumn!];
      if (typeof uid === 'string' && uid) userIds.add(uid);
    }
  }

  return { used: userIds.size, userIds, sources };
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
 * member of a full Firm account. Adding an existing collaborator to a SECOND
 * project is free for the same reason, which is what "counted across all
 * projects" means.
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
