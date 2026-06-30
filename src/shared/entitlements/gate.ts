/**
 * gate.ts
 *
 * Pure gate logic on top of the Phase C resolver. Turns a user's plan
 * coverage + overrides + (live) trial/admin/plan facts into:
 *   - a per-feature access map (the live gate reads this)
 *   - a resolved project limit (the cap reads this)
 *   - whether archive is allowed (trial: never)
 *
 * It REUSES resolveEffectiveFeatures verbatim (does not reimplement it) and
 * adds three orthogonal rules the brief specifies:
 *   1. Admin bypass: an admin resolves to full access, never blocked.
 *   2. Trial expiry: when the trial window has passed, the plan baseline is
 *      replaced with an EMPTY baseline (loses all trial-granted features);
 *      overrides still apply (the resolver handles their own expiry).
 *   3. Safety net: an unknown plan key (not one of the four known plans)
 *      resolves to full access (access-preserving), never a silent lockout.
 *      The CALLER logs the unknown value; this pure layer just preserves access.
 *
 * Isomorphic (no client/server-only imports), nowMs passed in for testability.
 * No em dashes in this file.
 */
import {
  resolveEffectiveFeatures,
  type ResolveFeature,
  type PlanCell,
  type UserOverride,
} from './resolveOverrides';

/** The four canonical plan keys after reconciliation (mig 160). */
export const KNOWN_PLAN_KEYS = ['trial', 'solo', 'pro', 'firm'] as const;
export type KnownPlanKey = typeof KNOWN_PLAN_KEYS[number];
export function isKnownPlanKey(k: string): k is KnownPlanKey {
  return (KNOWN_PLAN_KEYS as readonly string[]).includes(k);
}

/**
 * The deliberate NO-ACCESS plan. A user on 'none' has zero entitlements (no
 * modules, exports, scenarios, or projects). This is the signup default and is
 * STRICTLY DIFFERENT from an unknown plan key: 'none' is intentional no-access,
 * an unknown key is the anti-lockout safety net that PRESERVES access. The gate
 * checks 'none' before the safety net so a none user can never fall through to
 * access. Admin always bypasses, even on 'none'.
 */
export const NONE_PLAN_KEY = 'none';
export function isNonePlan(k: string): boolean {
  return k === NONE_PLAN_KEY;
}

/**
 * The three access states a known plan can be in, derived purely from the plan's
 * expiry date (the lapse anchor) and now:
 *   - 'active': now is before the expiry. Full access per plan.
 *   - 'grace':  the expiry has passed but the 1-month grace window has NOT.
 *               READ-ONLY: the user can log in and VIEW existing projects, but
 *               edit / export / create are denied. A renew banner is shown.
 *   - 'lapsed': the grace month has also passed. NO platform access (treated like
 *               the deliberate 'none' state, sent to choose-plan), but the account
 *               still logs in and data / projects are NEVER deleted.
 * Applies equally to expired paid (manual) plans, ended trials, and canceled
 * subscriptions past their period end. Admin always bypasses.
 */
export type LapseState = 'active' | 'grace' | 'lapsed';

/** The read-only grace window length after a plan's expiry, in calendar months. */
export const GRACE_PERIOD_MONTHS = 1;

/**
 * Add N calendar months to a ms timestamp, clamping day overflow (e.g. Jan 31 +
 * 1 month lands on the last day of February, not early March). Pure + UTC-based
 * so the result is deterministic regardless of server locale.
 */
export function addCalendarMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const targetDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth));
  return d.getTime();
}

/**
 * The raw fields needed to resolve a user's access-expiry anchor, pulled from the
 * users row + the per-platform subscription row. All times are ms (null = absent).
 */
export interface LapseAnchorInput {
  /** The user's plan key (post-reconciliation). */
  planKey: string;
  /** users.trial_ends_at in ms, or null. */
  trialEndsAtMs: number | null;
  /** user_platform_subscriptions.expires_at in ms (manual access expiry), or null. */
  subExpiresAtMs: number | null;
  /** user_platform_subscriptions.current_period_end in ms (Paddle period end), or null. */
  subPeriodEndMs: number | null;
  /** user_platform_subscriptions.status (lowercased internally), or null. */
  subStatus: string | null;
}

/** Subscription statuses that mean the plan will not renew, so its period end is
 *  the access-lapse anchor. */
const NON_RENEWING_STATUSES = ['canceled', 'cancelled', 'expired', 'paused', 'past_due'];

/**
 * Resolve the single access-expiry anchor (ms) that drives the lapse state, or
 * null when the plan does not expire (active / renewing). Priority:
 *   1. trial plan -> trial_ends_at
 *   2. a stamped subscription expires_at (manual access expiry) -> that date
 *   3. a non-renewing (canceled / expired) subscription -> current_period_end
 *   4. otherwise null (active, renewing). Pure + shared by the live gate AND the
 *      admin user list so both compute the same expiry + status.
 */
export function resolveLapseAnchorMs(i: LapseAnchorInput): number | null {
  if (i.planKey === 'trial') return i.trialEndsAtMs;
  if (i.subExpiresAtMs != null) return i.subExpiresAtMs;
  const nonRenewing = NON_RENEWING_STATUSES.includes((i.subStatus ?? '').toLowerCase());
  if (nonRenewing && i.subPeriodEndMs != null) return i.subPeriodEndMs;
  return null;
}

/**
 * Compute the lapse state from the access-expiry anchor and now. A null anchor
 * means "never expires" (an active / renewing subscription, or no expiry set),
 * which is always 'active'. Pure + testable; the grace end is expiry + 1 month.
 */
export function computeLapseState(
  accessExpiresAtMs: number | null | undefined,
  nowMs: number,
): { state: LapseState; graceEndsAtMs: number | null } {
  if (accessExpiresAtMs == null || nowMs < accessExpiresAtMs) {
    return { state: 'active', graceEndsAtMs: null };
  }
  const graceEndsAtMs = addCalendarMonths(accessExpiresAtMs, GRACE_PERIOD_MONTHS);
  return { state: nowMs < graceEndsAtMs ? 'grace' : 'lapsed', graceEndsAtMs };
}

/**
 * Whether a user must be blocked from the workspace and sent to get-access
 * (choose-plan). True for a non-admin on the deliberate 'none' state OR a
 * non-admin whose plan has LAPSED (grace month elapsed). Admin always bypasses;
 * a real ACTIVE plan, a plan in its read-only GRACE window, or the unknown-plan
 * safety net all pass (grace users can still log in and VIEW). This is the single
 * decision the /refm server gate and the dashboard cards both use, so direct-URL
 * access and card routing agree. Pure + testable. lapseState is optional so
 * legacy 2-arg callers are unchanged.
 */
export function isNoPlanLockedOut(planKey: string, isAdmin: boolean, lapseState?: LapseState): boolean {
  if (isAdmin) return false;
  if (isNonePlan(planKey)) return true;
  return lapseState === 'lapsed';
}

/** The limit feature key the project cap is driven by. */
export const PROJECTS_FEATURE = 'projects';

export interface FeatureAccess {
  included: boolean;
  value: number | null;
  feature_type: 'gate' | 'limit' | 'metered';
}

export interface GateInput {
  /** True when the signed-in user is an admin (from the session role). */
  isAdmin: boolean;
  /** The user's plan key (post-reconciliation). */
  planKey: string;
  /** False when planKey is not one of the four known plans (safety net). */
  knownPlan: boolean;
  /** True when planKey is 'trial' AND trial_ends_at has passed. */
  trialExpired: boolean;
  /** True when the plan carries an expires_at (manual plans, mig 179) that has
   *  passed. Treated like trial expiry: the plan baseline becomes empty, so an
   *  expired manual plan loses access. Additive; defaults to false. */
  planExpired?: boolean;
  /** The authoritative three-state lapse state, computed by the server from the
   *  plan's expiry date (see computeLapseState). When provided it DRIVES the
   *  gate. When omitted, the gate falls back to the legacy boolean behavior
   *  (trialExpired || planExpired => 'lapsed'), so existing callers are
   *  unchanged: 'active' = full access, 'grace' = read-only (features still
   *  resolve so projects can be VIEWED), 'lapsed' = no access (like 'none'). */
  lapseState?: LapseState;
  features: readonly ResolveFeature[];
  planCells: ReadonlyMap<string, PlanCell>;
  overrides: readonly UserOverride[];
  nowMs: number;
}

export interface GateResult {
  /** Per-feature access keyed by feature_key. */
  featureMap: Record<string, FeatureAccess>;
  /** Resolved project cap: -1 unlimited, 0 none, N a finite cap. */
  projectLimit: number;
  /** Trial users can never archive. */
  archiveAllowed: boolean;
  /** True when access was granted wholesale (admin or unknown-plan safety net). */
  fullAccess: boolean;
  /** Echoed so callers can show a "trial expired" message. */
  trialExpired: boolean;
  /** The computed three-state lapse state (see LapseState). 'active' for admin /
   *  none / unknown / a live plan; 'grace' = read-only; 'lapsed' = no access. */
  lapseState: LapseState;
  /** True ONLY in the grace window: the user can VIEW but every write action
   *  (edit / save / export / create / archive) is denied. The server choke
   *  points and the UI both read this. Never true for admin. */
  readOnly: boolean;
}

/**
 * A wholesale gate: every feature granted (or every feature denied). Used for
 * the three non-plan-resolved outcomes: admin / unknown-plan (granted), and the
 * deliberate 'none' no-access state (denied).
 */
function wholesaleGate(
  features: readonly ResolveFeature[], granted: boolean, trialExpired: boolean,
): GateResult {
  const featureMap: Record<string, FeatureAccess> = {};
  for (const f of features) {
    featureMap[f.feature_key] = {
      included: granted,
      value: granted && f.feature_type === 'limit' ? -1 : null,
      feature_type: f.feature_type,
    };
  }
  return {
    featureMap,
    projectLimit: granted ? -1 : 0,
    archiveAllowed: granted,
    fullAccess: granted,
    trialExpired,
    lapseState: 'active',
    readOnly: false,
  };
}

/**
 * Compute the gate for one user. Order matters:
 *   1. Admin -> full access (bypass, even on 'none').
 *   2. 'none' -> NO access (zero entitlements). Checked BEFORE the safety net so
 *      a none user can never fall through to access.
 *   3. Unknown plan -> full access (anti-lockout safety net; caller logs it).
 *   4. Known plan -> resolve plan coverage + overrides (empty baseline if the
 *      trial has expired).
 */
export function computeGate(input: GateInput): GateResult {
  // 1. Admin bypass (never blocked, even when their plan is 'none').
  if (input.isAdmin) return wholesaleGate(input.features, true, input.trialExpired);

  // 2. Deliberate no-access. Distinct from the unknown-plan safety net below.
  if (isNonePlan(input.planKey)) return wholesaleGate(input.features, false, input.trialExpired);

  // 3. Unknown-plan safety net: preserve access (never a silent lockout).
  if (!input.knownPlan) return wholesaleGate(input.features, true, input.trialExpired);

  // 4. Known plan. Resolve the three-state lapse state. The server passes
  // lapseState (computed from the plan's expiry date); when omitted we fall back
  // to the legacy boolean meaning so existing callers are unchanged: an expired
  // trial / manual plan maps straight to 'lapsed' (empty baseline, no access).
  const lapseState: LapseState =
    input.lapseState ?? ((input.trialExpired || (input.planExpired ?? false)) ? 'lapsed' : 'active');

  // 4a. Lapsed: the grace month has elapsed. NO access (same shape as 'none').
  // Data / projects are untouched, this layer only governs access, not storage.
  if (lapseState === 'lapsed') {
    return { ...wholesaleGate(input.features, false, input.trialExpired), lapseState, readOnly: false };
  }

  // 4b. Active OR grace: resolve plan coverage + overrides normally, so a GRACE
  // user keeps a populated feature map and CAN view the modules their plan
  // includes. Read-only is a separate cross-cutting flag (below) that the write
  // choke points (create / save / export / archive) enforce; grace never strips
  // the feature map (which would block viewing too).
  const resolved = resolveEffectiveFeatures(input.features, input.planCells, input.overrides, input.nowMs);

  const featureMap: Record<string, FeatureAccess> = {};
  let projectLimit = 0;
  for (const r of resolved) {
    featureMap[r.feature_key] = { included: r.included, value: r.value, feature_type: r.feature_type };
    if (r.feature_key === PROJECTS_FEATURE) {
      projectLimit = r.included && r.value !== null ? r.value : 0;
    }
  }

  const readOnly = lapseState === 'grace';
  return {
    featureMap,
    projectLimit,
    // Grace is read-only, so archiving (a write) is denied even on a plan that
    // would otherwise allow it. Trial never archives regardless.
    archiveAllowed: input.planKey !== 'trial' && !readOnly,
    fullAccess: false,
    trialExpired: input.trialExpired,
    lapseState,
    readOnly,
  };
}

/** True when a feature is accessible. fullAccess (admin / unknown-plan safety
 *  net) wins even if the feature map is empty, so an admin is never blocked,
 *  including when resolution failed and the map could not be built. */
export function featureAllowed(gate: Pick<GateResult, 'featureMap' | 'fullAccess'>, featureKey: string): boolean {
  if (gate.fullAccess) return true;
  return gate.featureMap[featureKey]?.included ?? false;
}

/**
 * Whether a WRITE action (create / save / export / archive) must be blocked by
 * the lapse state, and why. Returns a stable code the API returns and the UI
 * maps to a message, or null when the write is allowed by the lapse state.
 * fullAccess (admin / unknown-plan safety net) is never write-blocked. This is
 * the single server-side read-only / lapsed decision the choke points share.
 *   - 'LAPSED'         : grace month elapsed, no platform access.
 *   - 'READ_ONLY_GRACE': in the 1-month read-only grace window (view only).
 */
export type WriteBlockCode = 'LAPSED' | 'READ_ONLY_GRACE';
export function writeBlockReason(
  gate: Pick<GateResult, 'fullAccess' | 'lapseState' | 'readOnly'>,
): WriteBlockCode | null {
  if (gate.fullAccess) return null;
  if (gate.lapseState === 'lapsed') return 'LAPSED';
  if (gate.readOnly) return 'READ_ONLY_GRACE';
  return null;
}

/** Whether a new active project may be created/unarchived under the cap. */
export function canAddActiveProject(activeCount: number, projectLimit: number): boolean {
  if (projectLimit === -1) return true;        // unlimited bypasses entirely
  if (projectLimit <= 0) return false;         // no project entitlement
  return activeCount < projectLimit;
}

/** Cap-check result: a stable code the API returns and the UI maps to a prompt. */
export type CapCode = 'OK' | 'CAP_REACHED';
export function capCheck(activeCount: number, projectLimit: number): CapCode {
  return canAddActiveProject(activeCount, projectLimit) ? 'OK' : 'CAP_REACHED';
}
