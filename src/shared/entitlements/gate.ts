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
}

/**
 * Compute the gate for one user. Admin and unknown-plan both grant full
 * access (the safety net never locks out). Otherwise resolve plan + overrides,
 * substituting an empty plan baseline when the trial has expired.
 */
export function computeGate(input: GateInput): GateResult {
  const fullAccess = input.isAdmin || !input.knownPlan;

  if (fullAccess) {
    const featureMap: Record<string, FeatureAccess> = {};
    for (const f of input.features) {
      featureMap[f.feature_key] = {
        included: true,
        value: f.feature_type === 'limit' ? -1 : null,
        feature_type: f.feature_type,
      };
    }
    return { featureMap, projectLimit: -1, archiveAllowed: true, fullAccess: true, trialExpired: input.trialExpired };
  }

  // Trial expiry: lose all trial-granted features (empty plan baseline).
  // Overrides still apply (resolveEffectiveFeatures ignores expired ones).
  const effectivePlanCells: ReadonlyMap<string, PlanCell> = input.trialExpired
    ? new Map<string, PlanCell>()
    : input.planCells;

  const resolved = resolveEffectiveFeatures(input.features, effectivePlanCells, input.overrides, input.nowMs);

  const featureMap: Record<string, FeatureAccess> = {};
  let projectLimit = 0;
  for (const r of resolved) {
    featureMap[r.feature_key] = { included: r.included, value: r.value, feature_type: r.feature_type };
    if (r.feature_key === PROJECTS_FEATURE) {
      projectLimit = r.included && r.value !== null ? r.value : 0;
    }
  }

  return {
    featureMap,
    projectLimit,
    archiveAllowed: input.planKey !== 'trial',
    fullAccess: false,
    trialExpired: input.trialExpired,
  };
}

/** True when a feature is accessible. fullAccess (admin / unknown-plan safety
 *  net) wins even if the feature map is empty, so an admin is never blocked,
 *  including when resolution failed and the map could not be built. */
export function featureAllowed(gate: Pick<GateResult, 'featureMap' | 'fullAccess'>, featureKey: string): boolean {
  if (gate.fullAccess) return true;
  return gate.featureMap[featureKey]?.included ?? false;
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
