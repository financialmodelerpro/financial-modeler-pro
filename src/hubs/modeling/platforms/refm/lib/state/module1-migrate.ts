/**
 * module1-migrate.ts (v6 schema)
 *
 * Phase M2.0c (2026-05-06): bumps schema to v6 to absorb the open-ended
 * cost-line catalog (12 default lines + custom), 13-method calc engine,
 * and 5×5 financing matrix. Pre-v6 snapshots (including v5) are NOT
 * migrated. Loading one returns an error so the UI can surface a clear
 * "Schema migrated to v6. Please recreate this project." message rather
 * than silently coercing legacy data into a different model.
 *
 * v6 snapshots are recognized via shape: each costLine carries an
 * open-ended `id` field plus `stage` / `scope` / `allocationBasis`
 * (the v5 closed `key` enum is gone).
 */

import type { HydrateSnapshot } from './module1-store';
import { DEFAULT_MODULE1_STATE } from './module1-store';

export interface NewV6Snapshot extends HydrateSnapshot {
  version: 6;
  savedAt?: string;
}

export function isV6Snapshot(s: unknown): s is NewV6Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as {
    version?: unknown;
    project?: unknown;
    phases?: unknown;
    costLines?: unknown;
    financingTranches?: unknown;
    landAllocationMode?: unknown;
  };
  if (o.version === 6) return true;
  if (
    o.version === undefined &&
    typeof o.project === 'object' && o.project !== null &&
    Array.isArray(o.phases) &&
    Array.isArray(o.costLines) &&
    Array.isArray(o.financingTranches) &&
    typeof o.landAllocationMode === 'string'
  ) {
    // Disambiguate v5 vs v6 by checking the cost line shape: v6
    // costLines carry `id` + `stage` + `allocationBasis`; v5 had `key`.
    const cl = o.costLines as unknown[];
    if (cl.length === 0) return true; // empty array, treat as v6 default
    const first = cl[0] as { id?: unknown; key?: unknown; stage?: unknown };
    return typeof first.id === 'string' && typeof first.stage === 'string' && first.key === undefined;
  }
  return false;
}

export function isPreV6Snapshot(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as {
    version?: unknown;
    residentialCosts?: unknown;
    masterHolding?: unknown;
    plots?: unknown;
    subProjects?: unknown;
    assets?: unknown;
    phases?: unknown;
    costs?: unknown;
    costLines?: unknown;
  };
  if (o.version === 2 || Array.isArray(o.residentialCosts)) return true;
  if ((o.version === 3 || o.version === 4 || o.version === 5) &&
      Array.isArray(o.assets) && Array.isArray(o.phases)) {
    return true;
  }
  if (Array.isArray(o.assets) && Array.isArray(o.phases) && Array.isArray(o.costs)) {
    return true;
  }
  if (o.masterHolding !== undefined || Array.isArray(o.plots) || Array.isArray(o.subProjects)) {
    return true;
  }
  // v5 detection by cost-line shape: v5 had `key` field, v6 has `id`
  if (Array.isArray(o.costLines) && o.costLines.length > 0) {
    const first = (o.costLines as unknown[])[0] as { key?: unknown; id?: unknown };
    if (first.key !== undefined && first.id === undefined) return true;
  }
  return false;
}

const stripWrapper = (s: NewV6Snapshot): HydrateSnapshot => {
  const out: Partial<NewV6Snapshot> = { ...s };
  delete out.version;
  delete out.savedAt;
  return out as HydrateSnapshot;
};

export interface CheckedHydration {
  snapshot: HydrateSnapshot;
  recognized: boolean;
  error?: string;
}

export function hydrationFromAnySnapshotChecked(snapshot: unknown): CheckedHydration {
  if (isV6Snapshot(snapshot)) {
    return { snapshot: stripWrapper(snapshot), recognized: true };
  }
  if (isPreV6Snapshot(snapshot)) {
    return {
      snapshot: { ...DEFAULT_MODULE1_STATE },
      recognized: false,
      error: 'Schema migrated to v6. Please recreate this project.',
    };
  }
  if (typeof console !== 'undefined') {
    console.warn('[REFM] Unrecognized snapshot shape; falling back to defaults.');
  }
  return {
    snapshot: { ...DEFAULT_MODULE1_STATE },
    recognized: false,
    error: 'Unrecognized project shape. Please recreate this project.',
  };
}

export function hydrationFromAnySnapshot(snapshot: unknown): HydrateSnapshot {
  return hydrationFromAnySnapshotChecked(snapshot).snapshot;
}

// Backward-compat re-exports so any existing call sites referencing
// the v5 names still resolve. The functions are aliased to the v6
// implementations; callers should migrate to isV6Snapshot /
// isPreV6Snapshot in due course.
export const isV5Snapshot = isV6Snapshot;
export const isPreV5Snapshot = isPreV6Snapshot;
