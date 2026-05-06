/**
 * module1-migrate.ts (v7 schema)
 *
 * Phase M2.0d (2026-05-06): bumps schema to v7 to absorb the M2.0d Costs
 * polish (AssetStrategy 'Hybrid' renamed 'Sell + Manage', Asset gains
 * managementAgreement + usefulLifeYears, default cost catalog goes from
 * 12 lines to the M2.0d 9-line standard, CostMethod gains
 * rate_per_parking_bay). Pre-v7 snapshots (v5 + v6) are NOT migrated.
 * Loading one returns an error so the UI can surface a clear "Schema
 * migrated to v7. Please recreate this project." message rather than
 * silently coercing legacy data into a different model.
 *
 * v7 snapshots are recognized by version === 7 OR by the bare-shape
 * fingerprint (assets[] with strategy === 'Sell + Manage' on at least
 * one row, OR an empty fresh snapshot).
 */

import type { HydrateSnapshot } from './module1-store';
import { DEFAULT_MODULE1_STATE } from './module1-store';

export interface NewV7Snapshot extends HydrateSnapshot {
  version: 7;
  savedAt?: string;
}

export function isV7Snapshot(s: unknown): s is NewV7Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as {
    version?: unknown;
    project?: unknown;
    phases?: unknown;
    assets?: unknown;
    costLines?: unknown;
    financingTranches?: unknown;
    landAllocationMode?: unknown;
  };
  if (o.version === 7) return true;
  if (
    o.version === undefined &&
    typeof o.project === 'object' && o.project !== null &&
    Array.isArray(o.phases) &&
    Array.isArray(o.assets) &&
    Array.isArray(o.costLines) &&
    Array.isArray(o.financingTranches) &&
    typeof o.landAllocationMode === 'string'
  ) {
    // Disambiguate v6 vs v7. v7 fingerprints:
    //   (a) any asset.strategy === 'Sell + Manage' (v6 used 'Hybrid'), OR
    //   (b) empty assets[] AND no costLines AND default-shape (treat as
    //       fresh v7), OR
    //   (c) any costLine.id is one of the 9 M2.0d standard ids that v6
    //       did NOT seed ('land-inkind', 'construction-bua',
    //       'construction-parking', 'pre-operating', 'professional-fee',
    //       'commission'). v6 catalog used 'site-prep', 'structural',
    //       'mep', 'finishing', 'professional-fees' (plural), etc.
    const assets = o.assets as Array<{ strategy?: unknown }>;
    if (assets.some((a) => a.strategy === 'Sell + Manage')) return true;
    const lines = o.costLines as Array<{ id?: unknown }>;
    if (lines.length === 0 && assets.length === 0) return true;
    const v7Markers = new Set([
      'land-inkind',
      'construction-bua',
      'construction-parking',
      'pre-operating',
      'professional-fee',
      'commission',
    ]);
    if (lines.some((l) => typeof l.id === 'string' && v7Markers.has(l.id))) return true;
    return false;
  }
  return false;
}

export function isPreV7Snapshot(s: unknown): boolean {
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
  // v2 / v3 / v4 / v5 / v6 by version stamp
  if (o.version === 2 || Array.isArray(o.residentialCosts)) return true;
  if ((o.version === 3 || o.version === 4 || o.version === 5 || o.version === 6) &&
      Array.isArray(o.assets) && Array.isArray(o.phases)) {
    return true;
  }
  // v3 by shape (assets + phases + costs)
  if (Array.isArray(o.assets) && Array.isArray(o.phases) && Array.isArray(o.costs)) {
    return true;
  }
  // v3+ Master Holding hierarchy
  if (o.masterHolding !== undefined || Array.isArray(o.plots) || Array.isArray(o.subProjects)) {
    return true;
  }
  // v5 by costLine.key (closed enum)
  if (Array.isArray(o.costLines) && o.costLines.length > 0) {
    const first = (o.costLines as unknown[])[0] as { key?: unknown; id?: unknown };
    if (first.key !== undefined && first.id === undefined) return true;
  }
  // v6 by costLine.id (open catalog) but with v6 ids not in v7 standard,
  // OR with any asset.strategy === 'Hybrid'.
  if (Array.isArray(o.assets)) {
    const assets = o.assets as Array<{ strategy?: unknown }>;
    if (assets.some((a) => a.strategy === 'Hybrid')) return true;
  }
  if (Array.isArray(o.costLines) && o.costLines.length > 0) {
    const v6Markers = new Set([
      'site-prep',
      'structural',
      'mep',
      'finishing',
      'professional-fees', // plural in v6
      'marketing',
      'project-management',
      'legal',
      'ffe',
    ]);
    const lines = o.costLines as Array<{ id?: unknown }>;
    if (lines.some((l) => typeof l.id === 'string' && v6Markers.has(l.id))) return true;
  }
  return false;
}

const stripWrapper = (s: NewV7Snapshot): HydrateSnapshot => {
  const out: Partial<NewV7Snapshot> = { ...s };
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
  if (isV7Snapshot(snapshot)) {
    return { snapshot: stripWrapper(snapshot), recognized: true };
  }
  if (isPreV7Snapshot(snapshot)) {
    return {
      snapshot: { ...DEFAULT_MODULE1_STATE },
      recognized: false,
      error: 'Schema migrated to v7. Please recreate this project.',
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
// the v5 / v6 names still resolve. The functions are aliased to the v7
// implementations; callers should migrate to isV7Snapshot /
// isPreV7Snapshot in due course.
export const isV5Snapshot = isV7Snapshot;
export const isPreV5Snapshot = isPreV7Snapshot;
export const isV6Snapshot = isV7Snapshot;
export const isPreV6Snapshot = isPreV7Snapshot;
