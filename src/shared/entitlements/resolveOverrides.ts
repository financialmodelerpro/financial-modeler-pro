/**
 * resolveOverrides.ts
 *
 * Pure resolver for a single user's EFFECTIVE entitlements: start from the
 * plan's coverage (plan_permissions), then apply that user's per-user overrides
 * (user_permissions). Override wins. Expired overrides are ignored.
 *
 * This is DISPLAY logic only. It does not touch canAccess or any gate. The
 * admin override screen and the verifier both consume this, so the resolved
 * view shown to the admin is exactly what the verifier proves. Isomorphic (no
 * client/server-only imports), and `nowMs` is passed in so expiry is testable.
 *
 * No em dashes in this file.
 */

export type FeatureType = 'gate' | 'limit' | 'metered';
export type ModuleStatus = 'live' | 'coming_soon' | 'pro' | 'enterprise';

/** Minimal feature shape this resolver needs (from the merged catalog). */
export interface ResolveFeature {
  feature_key: string;
  label: string;
  category: string;
  feature_type: FeatureType;
  display_order: number;
  moduleStatus?: ModuleStatus;
}

/** A plan coverage cell for one feature (from plan_permissions). */
export interface PlanCell {
  included: boolean;
  limit_value: number | null;
}

/** One per-user override row (from user_permissions). */
export interface UserOverride {
  feature_key: string;
  mode: 'grant' | 'revoke';
  override_value: number | null;
  reason: string | null;
  expires_at: string | null;
}

/** An override after expiry evaluation, attached to its resolved feature. */
export interface AppliedOverride {
  mode: 'grant' | 'revoke';
  override_value: number | null;
  reason: string | null;
  expires_at: string | null;
  expired: boolean;
}

/** The resolved effective entitlement for one feature. */
export interface ResolvedFeature {
  feature_key: string;
  label: string;
  category: string;
  feature_type: FeatureType;
  display_order: number;
  moduleStatus?: ModuleStatus;
  /** Plan baseline before overrides. */
  planIncluded: boolean;
  planValue: number | null;
  /** Effective result after applying any active override. */
  included: boolean;
  value: number | null;
  /** Where the effective value came from. */
  source: 'plan' | 'override' | 'none';
  /** The user's override on this feature, if any (active or expired). */
  override?: AppliedOverride;
}

/** True when an override has no expiry or its expiry is still in the future. */
export function isOverrideActive(o: { expires_at: string | null }, nowMs: number): boolean {
  if (!o.expires_at) return true;
  const t = new Date(o.expires_at).getTime();
  if (Number.isNaN(t)) return true; // unparseable expiry is treated as no expiry
  return t > nowMs;
}

/**
 * Resolve effective entitlements for one user across the full feature list.
 * Returns one ResolvedFeature per input feature (in display order), so the UI
 * can render the complete grid and the caller can filter to the included set.
 *
 * Rules:
 *  - Gate feature: effective = active override ? (mode === 'grant') : plan.included.
 *  - Limit feature: effective value = active override with override_value set
 *    ? override_value : plan.limit_value. included follows whether a value exists.
 *  - Expired overrides are ignored entirely (the plan baseline shows through).
 */
export function resolveEffectiveFeatures(
  features: readonly ResolveFeature[],
  planCells: ReadonlyMap<string, PlanCell>,
  overrides: readonly UserOverride[],
  nowMs: number,
): ResolvedFeature[] {
  const overrideByKey = new Map<string, UserOverride>();
  for (const o of overrides) overrideByKey.set(o.feature_key, o);

  return [...features]
    .sort((a, b) => a.display_order - b.display_order)
    .map((f) => {
      const plan = planCells.get(f.feature_key) ?? { included: false, limit_value: null };
      const ov = overrideByKey.get(f.feature_key);
      const active = ov ? isOverrideActive(ov, nowMs) : false;

      const applied: AppliedOverride | undefined = ov
        ? {
            mode: ov.mode,
            override_value: ov.override_value,
            reason: ov.reason,
            expires_at: ov.expires_at,
            expired: !active,
          }
        : undefined;

      const base: Omit<ResolvedFeature, 'included' | 'value' | 'source'> = {
        feature_key: f.feature_key,
        label: f.label,
        category: f.category,
        feature_type: f.feature_type,
        display_order: f.display_order,
        moduleStatus: f.moduleStatus,
        planIncluded: plan.included,
        planValue: plan.limit_value,
        override: applied,
      };

      if (f.feature_type === 'limit') {
        if (active && ov!.override_value !== null && ov!.override_value !== undefined) {
          return { ...base, included: true, value: ov!.override_value, source: 'override' as const };
        }
        const value = plan.limit_value;
        return {
          ...base,
          included: value !== null && value !== undefined,
          value,
          source: value !== null && value !== undefined ? ('plan' as const) : ('none' as const),
        };
      }

      // Gate feature.
      if (active) {
        const included = ov!.mode === 'grant';
        return { ...base, included, value: null, source: 'override' as const };
      }
      return {
        ...base,
        included: plan.included,
        value: null,
        source: plan.included ? ('plan' as const) : ('none' as const),
      };
    });
}
