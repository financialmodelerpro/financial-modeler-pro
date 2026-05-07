/**
 * module1-migrate.ts (v8 schema)
 *
 * Phase M2.0g v8 (Addendum 3, 2026-05-06): bumps to v8. Inputs are
 * always entered at ANNUAL granularity. v7 monthly snapshots migrate
 * by aggregating periods 12->1 (constructionPeriods, operationsPeriods,
 * overlapPeriods all divide by 12, rounded up). Project.modelType
 * forced to 'annual'; new outputGranularity field defaults to 'annual'
 * (or 'monthly' if the source v7 snapshot was monthly). v7 annual
 * snapshots stamp version=8 and gain outputGranularity='annual'.
 *
 * Phase M2.0g (2026-05-06): in-place v7 migration that folds legacy
 * 'Parking' sub-units (M2.0f-only category) into asset.parkingArea
 * and drops the sub-unit. Schema stays v7 because the additive
 * Asset.buaTotal / supportArea / parkingArea fields don't break v7
 * snapshots that were written without them.
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
 * v8 snapshots are recognized by version === 8. Runtime accepts v7
 * shapes by fingerprint (per the original v7 detector) and migrates
 * them in place.
 */

import type { HydrateSnapshot } from './module1-store';
import { DEFAULT_MODULE1_STATE } from './module1-store';
import { computeSubUnitArea } from '@/src/core/calculations';
import type { SubUnit, Asset, Project, Phase } from './module1-types';

export const SCHEMA_VERSION = 8;

export interface NewV8Snapshot extends HydrateSnapshot {
  version: 8;
  savedAt?: string;
}

// Backward compat alias - same shape, just version=7. v7 snapshots
// flow through migrateV7ToV8 to land at v8.
export interface NewV7Snapshot extends HydrateSnapshot {
  version: 7;
  savedAt?: string;
}

export function isV8Snapshot(s: unknown): s is NewV8Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as { version?: unknown };
  return o.version === 8;
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
  // M2.0g v8: bare-shape fingerprint without explicit version still
  // counts as v7 (will then migrate to v8 in stripWrapper). v8
  // snapshots ALWAYS carry version=8.
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

const stripV8Wrapper = (s: NewV8Snapshot): HydrateSnapshot => {
  const out: Partial<NewV8Snapshot> = { ...s };
  delete out.version;
  delete out.savedAt;
  return migrateM20gParkingSubUnits(out as HydrateSnapshot);
};

const stripWrapper = (s: NewV7Snapshot): HydrateSnapshot => {
  const out: Partial<NewV7Snapshot> = { ...s };
  delete out.version;
  delete out.savedAt;
  // M2.0g v8: v7 -> v8 migration runs first (aggregate monthly,
  // stamp outputGranularity), then the M2.0g Parking-subunit fold.
  return migrateM20gParkingSubUnits(migrateV7ToV8(out as HydrateSnapshot));
};

// M2.0h Fix 1 (2026-05-07): v7 -> v8 migration detector. Returns true
// when stripWrapper would actually transform the input (i.e. source
// modelType was 'monthly' OR outputGranularity was missing). The
// hydration path uses this to emit a one-time banner so the user knows
// their project was upgraded in place.
function snapshotNeedsV8Migration(s: NewV7Snapshot): boolean {
  if (!s || typeof s !== 'object') return false;
  const project = (s as { project?: { modelType?: string; outputGranularity?: string } }).project;
  if (!project) return false;
  if (project.modelType === 'monthly') return true;
  if (!project.outputGranularity) return true;
  return false;
}

// M2.0g v8 (Addendum 3): v7 -> v8 migration. When the source
// project.modelType === 'monthly', aggregate phase periods 12 -> 1
// (rounded UP so partial years still count) and switch modelType to
// 'annual'. outputGranularity defaults to the source modelType so the
// user keeps their preferred reporting view ('monthly' becomes
// outputGranularity='monthly'; 'annual' becomes 'annual'). Cost line
// startPeriod / endPeriod scale 12->1 for monthly sources too.
function migrateV7ToV8(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  const wasMonthly = project.modelType === 'monthly';
  const outputGranularity = project.outputGranularity ?? (wasMonthly ? 'monthly' : 'annual');
  if (!wasMonthly) {
    // Already annual - just stamp outputGranularity if missing.
    if (project.outputGranularity) return snap;
    return { ...snap, project: { ...project, outputGranularity } };
  }
  const ceilDiv = (n: number): number => Math.max(0, Math.ceil(n / 12));
  const phases = (snap.phases as Phase[]).map((p) => ({
    ...p,
    constructionPeriods: Math.max(1, ceilDiv(p.constructionPeriods)),
    operationsPeriods:   ceilDiv(p.operationsPeriods),
    overlapPeriods:      ceilDiv(p.overlapPeriods),
  }));
  const costLines = snap.costLines.map((c) => ({
    ...c,
    startPeriod: ceilDiv(c.startPeriod),
    endPeriod:   Math.max(1, ceilDiv(c.endPeriod)),
  }));
  return {
    ...snap,
    project: { ...project, modelType: 'annual', outputGranularity },
    phases,
    costLines,
  };
}

// M2.0g (2026-05-06): the M2.0f 'Parking' SubUnitCategory was removed.
// Any snapshot that still carries Parking sub-units folds their area
// sum into asset.parkingArea (per asset) and drops the sub-unit row.
// Idempotent: running on a snapshot that has no Parking sub-units
// returns it unchanged.
function migrateM20gParkingSubUnits(snap: HydrateSnapshot): HydrateSnapshot {
  const subUnits = snap.subUnits as SubUnit[] | undefined;
  if (!Array.isArray(subUnits) || subUnits.length === 0) return snap;
  const parkingAreaByAsset = new Map<string, number>();
  let hasParkingSubUnits = false;
  for (const u of subUnits) {
    // Cast safely: M2.0f had 'Parking'; M2.0g removes it. Detect by
    // string equality regardless of TS type.
    if ((u.category as unknown as string) === 'Parking') {
      hasParkingSubUnits = true;
      const area = computeSubUnitArea(u);
      parkingAreaByAsset.set(u.assetId, (parkingAreaByAsset.get(u.assetId) ?? 0) + area);
    }
  }
  if (!hasParkingSubUnits) return snap;
  const filteredSubUnits = subUnits.filter((u) => (u.category as unknown as string) !== 'Parking');
  const assets = (snap.assets as Asset[]).map((a) => {
    const folded = parkingAreaByAsset.get(a.id);
    if (folded === undefined) return a;
    return { ...a, parkingArea: Math.max(0, (a.parkingArea ?? 0) + folded) };
  });
  return { ...snap, subUnits: filteredSubUnits, assets };
}

export interface CheckedHydration {
  snapshot: HydrateSnapshot;
  recognized: boolean;
  error?: string;
  // M2.0h Fix 1 (2026-05-07): set when the source snapshot was v7 and
  // got upgraded to v8 in flight. UI surfaces this once as a banner so
  // the user knows their project was upgraded in place.
  migrationNotice?: string;
}

export const M20H_MIGRATION_NOTICE =
  "Project upgraded from monthly inputs to annual inputs (M2.0g architecture). Display Scale defaulted to Full Numbers; set in Tab 1 Project Identity if you want thousands or millions view.";

export function hydrationFromAnySnapshotChecked(snapshot: unknown): CheckedHydration {
  if (isV8Snapshot(snapshot)) {
    return { snapshot: stripV8Wrapper(snapshot), recognized: true };
  }
  if (isV7Snapshot(snapshot)) {
    const notice = snapshotNeedsV8Migration(snapshot) ? M20H_MIGRATION_NOTICE : undefined;
    return { snapshot: stripWrapper(snapshot), recognized: true, migrationNotice: notice };
  }
  if (isPreV7Snapshot(snapshot)) {
    return {
      snapshot: { ...DEFAULT_MODULE1_STATE },
      recognized: false,
      error: 'Project schema older than v8. Please contact support to migrate manually.',
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
