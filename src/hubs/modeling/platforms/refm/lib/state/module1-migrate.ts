/**
 * module1-migrate.ts (v5 schema)
 *
 * Phase M2.0 (2026-05-06): hard cut. Pre-v5 snapshots (v2 / v3 / v4) are
 * NOT migrated. Loading one returns an error so the UI can surface a
 * clear "Schema migrated to v5. Please recreate this project." message
 * rather than silently coercing legacy data into a different model.
 *
 * v5 snapshots are recognized via shape (carries v5-specific keys like
 * landAllocationMode, costOverrides, financingTranches, equityContributions).
 */

import type { HydrateSnapshot } from './module1-store';
import { DEFAULT_MODULE1_STATE } from './module1-store';

export interface NewV5Snapshot extends HydrateSnapshot {
  version: 5;
  savedAt?: string;
}

// Recognition: payload must have v5-shape keys. We accept either an
// explicit `version: 5` discriminator or the structural fingerprint
// (project + phases + costLines + financingTranches all present).
export function isV5Snapshot(s: unknown): s is NewV5Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as {
    version?: unknown;
    project?: unknown;
    phases?: unknown;
    costLines?: unknown;
    financingTranches?: unknown;
    landAllocationMode?: unknown;
  };
  if (o.version === 5) return true;
  return (
    o.version === undefined &&
    typeof o.project === 'object' && o.project !== null &&
    Array.isArray(o.phases) &&
    Array.isArray(o.costLines) &&
    Array.isArray(o.financingTranches) &&
    typeof o.landAllocationMode === 'string'
  );
}

// Pre-v5 detection: anything that LOOKS like an old snapshot. Used to
// produce a more helpful error than the generic unrecognized fallback.
export function isPreV5Snapshot(s: unknown): boolean {
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
  };
  // Legacy v2 marker
  if (o.version === 2 || Array.isArray(o.residentialCosts)) return true;
  // v3 / v4 markers (assets[] + phases[] + costs[] without v5-specific keys)
  if ((o.version === 3 || o.version === 4) &&
      Array.isArray(o.assets) && Array.isArray(o.phases)) {
    return true;
  }
  // Bare v3-shape (assets + phases + costs but no v5 keys)
  if (Array.isArray(o.assets) && Array.isArray(o.phases) && Array.isArray(o.costs)) {
    return true;
  }
  // Master Holding / Plot / SubProject sentinels
  if (o.masterHolding !== undefined || Array.isArray(o.plots) || Array.isArray(o.subProjects)) {
    return true;
  }
  return false;
}

const stripWrapper = (s: NewV5Snapshot): HydrateSnapshot => {
  const out: Partial<NewV5Snapshot> = { ...s };
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
  if (isV5Snapshot(snapshot)) {
    return { snapshot: stripWrapper(snapshot), recognized: true };
  }
  if (isPreV5Snapshot(snapshot)) {
    return {
      snapshot: { ...DEFAULT_MODULE1_STATE },
      recognized: false,
      error: 'Schema migrated to v5. Please recreate this project.',
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
