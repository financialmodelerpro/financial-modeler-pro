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
import type {
  SubUnit, Asset, Project, Phase, Parcel,
  CostLine, CostOverride, FinancingTranche, EquityContribution,
  LandAllocationMode, ProjectFinancingConfig,
} from './module1-types';
import {
  STANDARD_COST_LINE_IDS,
  composeLineId,
  deriveLineBaseId,
  makeDefaultProject,
  makeDefaultPhase,
  makeDefaultParcel,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  makeCompanionSubUnit,
  DEFAULT_PHASE_ID,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  PHASE_FILTER_ALL,
} from './module1-types';
import type { RepaymentMethod } from './module1-types';

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
  // M2.0j Fix 9: fold any legacy phasing values to 'even'.
  // M2.0L: dedupe cost line ids across phases by composing with phaseId.
  // M2.0L Pass 4: flag legacy CostOverride entries as overridden=true;
  // strip deprecated Project.costInputMode.
  // M2.0L Pass 5: default every CostLine.costCategory to 'direct' when
  // unset.
  // T2-Fix 5c (2026-05-12): reconcile companion sub-units against parent
  // Sellable list (preserve ADR, drop orphans, mirror new parent rows).
  return migrateT3DefaultCostLineSeed(migrateT3StripCompanionAndDedup(migrateT2P3CompanionType(migrateT2CompanionSubUnits(migrateM20costsPass10Hybrid(migrateM20mPass4Financing(migrateM20costsPass8(migrateM20mPass3Financing(
    migrateM20costsPass7PerAsset(
      migrateM20mPass2Financing(
        migrateM20mPass6NdaToProject(
          migrateM20mPass6DisplayDefaults(
            migrateM20MFinancing(
              migrateM20Pass5Categories(
                migrateM20Pass4Inheritance(
                  migrateM20lDedupeCostLineIds(
                    migrateM20jPhasing(migrateM20gParkingSubUnits(out as HydrateSnapshot)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ))))))));
};

const stripWrapper = (s: NewV7Snapshot): HydrateSnapshot => {
  const out: Partial<NewV7Snapshot> = { ...s };
  delete out.version;
  delete out.savedAt;
  // M2.0g v8: v7 -> v8 migration runs first (aggregate monthly,
  // stamp outputGranularity), then the M2.0g Parking-subunit fold,
  // then the M2.0j phasing fold, then the M2.0L id dedupe, then the
  // M2.0L Pass 4 inheritance migration, then the M2.0L Pass 5
  // category defaulting, then the M2.0M financing wrapper, then the
  // M2.0M Pass 6 display defaults flip, M2.0M Pass 2 / Pass 7 / Pass 3 / Pass 8,
  // then T2-Fix 5c companion sub-unit mirror.
  return migrateT3DefaultCostLineSeed(migrateT3StripCompanionAndDedup(migrateT2P3CompanionType(migrateT2CompanionSubUnits(migrateM20costsPass10Hybrid(migrateM20mPass4Financing(migrateM20costsPass8(migrateM20mPass3Financing(
    migrateM20costsPass7PerAsset(
      migrateM20mPass2Financing(
        migrateM20mPass6NdaToProject(
          migrateM20mPass6DisplayDefaults(
            migrateM20MFinancing(
              migrateM20Pass5Categories(
                migrateM20Pass4Inheritance(
                  migrateM20lDedupeCostLineIds(
                    migrateM20jPhasing(migrateM20gParkingSubUnits(migrateV7ToV8(out as HydrateSnapshot))),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ))))))));
};

// M2.0M Pass 7 (2026-05-11): Costs Architecture rewrite. Pass 4
// introduced the master + replica inheritance surface; Pass 7 drops
// it. Every cost line becomes asset-owned (targetAssetId required in
// the post-Pass-7 surface). Migration flattens any legacy master line
// (targetAssetId undefined) into one replica per visible asset in the
// same phase, folding matching CostOverride values onto each replica.
// CostOverride[] entries are dropped after the walk (schema retained
// for snapshot compat, UI no longer reads or writes).
function migrateM20costsPass7PerAsset(snap: HydrateSnapshot): HydrateSnapshot {
  const lines = (snap.costLines as CostLine[]) ?? [];
  const overrides = (snap.costOverrides as CostOverride[]) ?? [];
  const assets = (snap.assets as Asset[]) ?? [];

  // Detect work: any master line (targetAssetId undefined) OR any
  // override entry OR any orphan per-asset line (targetAssetId points
  // to a missing asset). If none of these, snapshot is already Pass 7-shaped.
  const hasMaster = lines.some((c) => !c.targetAssetId);
  const hasOverrides = overrides.length > 0;
  const assetIdSet = new Set(assets.map((a) => a.id));
  const hasOrphan = lines.some((c) => c.targetAssetId && !assetIdSet.has(c.targetAssetId));
  if (!hasMaster && !hasOverrides && !hasOrphan) return snap;

  // Build asset-by-phase index for replication.
  const assetsByPhase = new Map<string, Asset[]>();
  for (const a of assets) {
    if (!a.visible) continue;
    if (!assetsByPhase.has(a.phaseId)) assetsByPhase.set(a.phaseId, []);
    assetsByPhase.get(a.phaseId)!.push(a);
  }

  // Walk master lines and emit per-asset replicas.
  const newLines: CostLine[] = [];
  // Map old-base-id -> per-asset-id rewrite for selectedLineIds
  // resolution. Key: `${phaseId}:${baseId}:${assetId}` -> new line id.
  const idRewrite = new Map<string, string>();
  for (const line of lines) {
    if (line.targetAssetId) {
      // Already per-asset, but the original asset might no longer exist
      // (orphan) -> drop.
      const ownerOk = assets.some((a) => a.id === line.targetAssetId);
      if (ownerOk) newLines.push(line);
      continue;
    }
    // Master line. Replicate per visible asset in the same phase.
    const phaseAssets = assetsByPhase.get(line.phaseId) ?? [];
    if (phaseAssets.length === 0) continue; // no assets, drop.
    const baseId = deriveLineBaseId(line.id);
    for (const a of phaseAssets) {
      const newId = `${baseId}__${line.phaseId}__${a.id}`;
      idRewrite.set(`${line.phaseId}:${baseId}:${a.id}`, newId);
      const ov = overrides.find((o) => o.assetId === a.id && o.lineId === line.id);
      const isActive = ov !== undefined && ov.overridden !== false;
      const replica: CostLine = {
        ...line,
        id: newId,
        targetAssetId: a.id,
      };
      if (isActive && ov) {
        if (ov.method !== undefined) replica.method = ov.method;
        if (ov.value !== undefined) replica.value = ov.value;
        if (ov.phasing !== undefined) replica.phasing = ov.phasing;
        if (ov.distribution !== undefined) replica.distribution = ov.distribution;
        if (ov.startPeriod !== undefined) replica.startPeriod = ov.startPeriod;
        if (ov.endPeriod !== undefined) replica.endPeriod = ov.endPeriod;
        if (ov.perSubUnitRates !== undefined) replica.perSubUnitRates = ov.perSubUnitRates;
        if (ov.disabled !== undefined) replica.disabled = ov.disabled;
      }
      newLines.push(replica);
    }
  }

  // Rewrite selectedLineIds: master selectedLineIds[X] -> the same
  // asset's replica of X. For lines that referenced master ids,
  // remap to the per-asset replica id within the same phase + asset.
  const rewriteSelected = (assetId: string, phaseId: string, ids?: string[]): string[] | undefined => {
    if (!Array.isArray(ids) || ids.length === 0) return ids;
    return ids.map((ref) => {
      const baseRef = deriveLineBaseId(ref);
      const mapped = idRewrite.get(`${phaseId}:${baseRef}:${assetId}`);
      return mapped ?? ref;
    });
  };
  const finalLines = newLines.map((c) => {
    if (!Array.isArray(c.selectedLineIds) || c.selectedLineIds.length === 0) return c;
    const assetId = c.targetAssetId;
    if (!assetId) return c;
    const next = rewriteSelected(assetId, c.phaseId, c.selectedLineIds);
    if (next === c.selectedLineIds) return c;
    return { ...c, selectedLineIds: next };
  });

  return {
    ...snap,
    costLines: finalLines,
    costOverrides: [],
  };
}

export const M20COSTS_PASS7_NOTICE =
  "Costs UI simplified to per-asset inputs. Existing cost lines flattened so each asset owns its values. Review in Tab 3.";

// M2.0M Pass 3 (2026-05-12): Financing simplification.
//   Fix 1: viewMode='single_asset' -> 'combined' + clear selectedAssetId.
//   Fix 3: deprecate per-facility debtPct + principal (kept on schema; UI no
//          longer surfaces; calc engine ignores in favor of method-derived).
//   Fix 5: deprecate drawdownMethod (auto-follows funding method).
//   Fix 6: deprecate equalRepaymentSubMethod + sweepRatio (single Equal
//          Repayment mode; cash sweep defaults to 100%).
//   Fix 7: clear equityTranches (auto-computed from method + Land In-Kind).
//   Fix 3 multi-facility: default facilitySharePct to even split when
//          missing across multiple facilities; single facility -> 100.
// Idempotent: a Pass-3-shaped snapshot returns unchanged.
function migrateM20mPass3Financing(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  let nextProject = project;
  let touched = false;

  // Fix 1: view mode.
  if (project.financing) {
    const f = project.financing;
    if (f.viewMode === 'single_asset' || f.selectedAssetId !== undefined) {
      nextProject = {
        ...project,
        financing: { ...f, viewMode: 'combined', selectedAssetId: undefined },
      };
      touched = true;
    }
  }

  // Fix 7: clear stale equity contributions when auto-computation owns them.
  // We keep the array on schema for back-compat but drop the data so the UI
  // does not surface stale rows.
  const equityContributions = (snap.equityContributions ?? []) as EquityContribution[];
  let nextEquity = equityContributions;
  if (equityContributions.length > 0) {
    nextEquity = [];
    touched = true;
  }

  // Fix 3 multi-facility split: default facilitySharePct.
  const tranches = (snap.financingTranches ?? []) as FinancingTranche[];
  let nextTranches = tranches;
  if (tranches.length > 0) {
    type T = FinancingTranche & { facilitySharePct?: number };
    const missing = tranches.filter((t) => (t as T).facilitySharePct === undefined);
    if (missing.length > 0) {
      const evenShare = tranches.length > 0 ? 100 / tranches.length : 100;
      nextTranches = tranches.map((t) => {
        const tt = t as T;
        if (tt.facilitySharePct === undefined) {
          return { ...t, facilitySharePct: tranches.length === 1 ? 100 : evenShare } as FinancingTranche;
        }
        return t;
      });
      touched = true;
    }
  }

  if (!touched) return snap;
  return {
    ...snap,
    project: nextProject,
    equityContributions: nextEquity,
    financingTranches: nextTranches,
  };
}

export const M20M_PASS3_NOTICE =
  "Financing simplified, facility ratios now auto-compute from chosen funding method. Equity tranches auto-computed from method and Land In-Kind cost line.";

// M2.0 Pass 8 (2026-05-12): Costs Cleanup Pass 8 migration.
//   Fix 1: projectNdaScope defaults to 'project' when projectNdaEnabled is on.
//   Fix 2c: asset.subUnitMetric backfilled from first sub-unit's metric.
//   Fix 5: clamp cost lines whose endPeriod exceeds maxCp + 1.
//   Fix 8: project.resultsViewMode defaults to 'combined'.
// Idempotent.
function migrateM20costsPass8(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  let nextProject = project;
  const projectPatch: Partial<Project> = {};
  if (project.projectNdaEnabled === true && project.projectNdaScope === undefined) {
    projectPatch.projectNdaScope = 'project';
  }
  if (project.resultsViewMode === undefined) {
    projectPatch.resultsViewMode = 'combined';
  }
  if (Object.keys(projectPatch).length > 0) {
    nextProject = { ...project, ...projectPatch };
  }

  // Fix 2c: stamp asset.subUnitMetric from first sub-unit when missing.
  const subUnits = (snap.subUnits ?? []) as SubUnit[];
  const assets = (snap.assets ?? []) as Asset[];
  const subsByAsset = new Map<string, SubUnit[]>();
  for (const u of subUnits) {
    const list = subsByAsset.get(u.assetId);
    if (list) list.push(u); else subsByAsset.set(u.assetId, [u]);
  }
  let assetsTouched = false;
  const nextAssets = assets.map((a) => {
    if (a.subUnitMetric !== undefined) return a;
    const list = subsByAsset.get(a.id) ?? [];
    if (list.length === 0) return a;
    const first = list[0];
    const metric: 'area' | 'units' = (first.metric === 'units' || (first.metric as unknown as string) === 'count')
      ? 'units' : 'area';
    assetsTouched = true;
    return { ...a, subUnitMetric: metric };
  });

  // Fix 5: clamp endPeriod when it exceeds maxCp + 1.
  const phases = (snap.phases ?? []) as Phase[];
  const maxCp = phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0);
  const maxAllowedEnd = maxCp + 1;
  const lines = (snap.costLines ?? []) as CostLine[];
  let linesTouched = false;
  const nextLines = lines.map((c) => {
    if (typeof c.endPeriod === 'number' && c.endPeriod > maxAllowedEnd) {
      linesTouched = true;
      return { ...c, endPeriod: maxAllowedEnd };
    }
    return c;
  });

  const projectTouched = Object.keys(projectPatch).length > 0;
  if (!projectTouched && !assetsTouched && !linesTouched) return snap;
  return {
    ...snap,
    project: nextProject,
    assets: assetsTouched ? nextAssets : snap.assets,
    costLines: linesTouched ? nextLines : snap.costLines,
  };
}

export const M20_PASS8_NOTICE =
  "Costs UI refined, sub-unit metric now per-asset and NDA placement updated. Review Tab 2 + Tab 3.";

// M2.0M Pass 4 (2026-05-12): Financing Pass 4 migration.
//   Fix 9: phaseFilter -> assetFilter (defaults '__combined__').
// Idempotent.
function migrateM20mPass4Financing(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  if (!project.financing) return snap;
  const f = project.financing;
  if (f.assetFilter !== undefined) return snap;
  return {
    ...snap,
    project: {
      ...project,
      financing: { ...f, assetFilter: '__combined__' },
    },
  };
}

export const M20M_PASS4_NOTICE =
  "Financing Pass 4: project-wide capex feeds the Capital Structure Overview + schedules; phase filter replaced by asset filter.";

// M2.0 Pass 10 Fix 3 (2026-05-12): hybrid project-wide + per-asset
// override architecture. Walks back Pass 7's per-asset CostLine
// architecture (composed id `${baseId}__${phaseId}__${assetId}`)
// to a single project-wide master per (phaseId, baseId) plus
// optional CostOverride[] entries for assets whose value, method,
// phasing, distribution, perSubUnitRates, startPeriod, endPeriod
// or selectedLineIds differ from the master.
//
// First-asset-wins on conflict: when multiple per-asset replicas in
// the same phase share the same baseId but different values, the
// first asset (by current assets[] order) becomes the master and
// the rest are stamped as CostOverride entries.
//
// id rewrite: each surviving line's id is recomposed as
// `${baseId}__${phaseId}` (drop the asset suffix). selectedLineIds
// cross-references are rewritten in the same sweep so percent_of_
// selected lines continue to resolve.
//
// Companion assets (Pass 10 Fix 4, isCompanion=true) keep their
// targetAssetId so any hospitality-specific cost line stays bound
// to that companion. Migration does NOT collapse companions into
// the master surface.
//
// Idempotent: a snapshot that has no targetAssetId on any non-
// companion cost line is already Pass 10-shaped and returns
// unchanged.
function migrateM20costsPass10Hybrid(snap: HydrateSnapshot): HydrateSnapshot {
  const lines = (snap.costLines as CostLine[]) ?? [];
  const overrides = (snap.costOverrides as CostOverride[]) ?? [];
  const assets = (snap.assets as Asset[]) ?? [];
  const companionIds = new Set(assets.filter((a) => a.isCompanion === true).map((a) => a.id));

  // Detect work: any non-companion line with targetAssetId set.
  // Pass 7 stamped this on every line. Pass 10 strips it on the master.
  const needsWork = lines.some((c) => c.targetAssetId !== undefined && !companionIds.has(c.targetAssetId));
  if (!needsWork) return snap;

  // Group non-companion lines by (phaseId, baseId).
  type Group = { phaseId: string; baseId: string; replicas: CostLine[] };
  const groups = new Map<string, Group>();
  const passThrough: CostLine[] = [];
  for (const line of lines) {
    if (line.targetAssetId !== undefined && companionIds.has(line.targetAssetId)) {
      passThrough.push(line);
      continue;
    }
    if (line.targetAssetId === undefined) {
      // Already master-shaped (rare). Pass through directly; later we
      // dedupe by re-emitting if no replica fights.
      passThrough.push(line);
      continue;
    }
    const baseId = deriveLineBaseId(line.id);
    const key = `${line.phaseId}::${baseId}`;
    let g = groups.get(key);
    if (!g) {
      g = { phaseId: line.phaseId, baseId, replicas: [] };
      groups.set(key, g);
    }
    g.replicas.push(line);
  }

  // Walk groups: pick first replica as master, stamp overrides for
  // diverging replicas, recompose master id.
  const phaseAssetOrder = new Map<string, string[]>();
  for (const a of assets) {
    if (a.isCompanion === true) continue;
    const list = phaseAssetOrder.get(a.phaseId) ?? [];
    list.push(a.id);
    phaseAssetOrder.set(a.phaseId, list);
  }

  const newMasters: CostLine[] = [];
  const newOverrides: CostOverride[] = [...overrides];
  const oldIdToNewId = new Map<string, string>();
  for (const g of groups.values()) {
    const phaseOrder = phaseAssetOrder.get(g.phaseId) ?? [];
    // Pick the FIRST asset's replica (by phase asset order) as canonical.
    let canonical: CostLine | undefined;
    for (const aid of phaseOrder) {
      const replica = g.replicas.find((r) => r.targetAssetId === aid);
      if (replica) { canonical = replica; break; }
    }
    if (!canonical) canonical = g.replicas[0];
    const masterId = `${g.baseId}__${g.phaseId}`;
    const master: CostLine = {
      ...canonical,
      id: masterId,
      targetAssetId: undefined,
    };
    newMasters.push(master);
    for (const r of g.replicas) {
      oldIdToNewId.set(r.id, masterId);
      if (!r.targetAssetId || r.targetAssetId === canonical.targetAssetId) continue;
      // Compare replica vs master. Stamp an override for any field
      // that differs. Skip fields the resolver inherits from master
      // when unset.
      const diffMethod = r.method !== master.method;
      const diffValue = (r.value ?? 0) !== (master.value ?? 0);
      const diffPhasing = r.phasing !== master.phasing;
      const diffDist = JSON.stringify(r.distribution ?? null) !== JSON.stringify(master.distribution ?? null);
      const diffPerSub = JSON.stringify(r.perSubUnitRates ?? null) !== JSON.stringify(master.perSubUnitRates ?? null);
      const diffStart = (r.startPeriod ?? 0) !== (master.startPeriod ?? 0);
      const diffEnd = (r.endPeriod ?? 0) !== (master.endPeriod ?? 0);
      const diffDisabled = (r.disabled === true) !== (master.disabled === true);
      if (!diffMethod && !diffValue && !diffPhasing && !diffDist && !diffPerSub && !diffStart && !diffEnd && !diffDisabled) {
        continue;
      }
      newOverrides.push({
        assetId: r.targetAssetId,
        lineId: masterId,
        method: r.method,
        value: r.value,
        phasing: r.phasing,
        distribution: r.distribution,
        perSubUnitRates: r.perSubUnitRates,
        startPeriod: r.startPeriod,
        endPeriod: r.endPeriod,
        disabled: r.disabled === true ? true : undefined,
        overridden: true,
      });
    }
  }

  // Add pass-through masters (any line that was already master-shaped
  // or companion-bound). Dedupe by (phaseId, baseId) so we do not
  // emit two masters when a snapshot already had a master + replicas.
  for (const line of passThrough) {
    if (line.targetAssetId !== undefined && companionIds.has(line.targetAssetId)) {
      newMasters.push(line);
      continue;
    }
    // master-shaped (untargeted) line: only keep if not already
    // produced by the group walk.
    const baseId = deriveLineBaseId(line.id);
    const masterId = `${baseId}__${line.phaseId}`;
    if (newMasters.some((m) => m.id === masterId)) continue;
    newMasters.push({ ...line, id: masterId, targetAssetId: undefined });
  }

  // Rewrite selectedLineIds: each old per-asset id maps to its
  // master id. selectedLineIds that point at base ids in the same
  // phase (rare in practice) collapse identically.
  const rewriteSelected = (ids: string[] | undefined): string[] | undefined => {
    if (!ids || ids.length === 0) return ids;
    return ids.map((id) => oldIdToNewId.get(id) ?? id);
  };

  const finalMasters = newMasters.map((m) => ({
    ...m,
    selectedLineIds: rewriteSelected(m.selectedLineIds),
  }));

  // Also rewrite selectedLineIds in any override entry that carries them.
  // (Override schema does NOT include selectedLineIds today, but defensive.)
  const finalOverrides = newOverrides;

  return {
    ...snap,
    costLines: finalMasters,
    costOverrides: finalOverrides,
  };
}

export const M20_PASS10_NOTICE =
  "Cost lines simplified to project-wide. Where assets carried different rates, the first asset's rate was used as the master; per-asset overrides preserved. Check Tab 3 and re-enter overrides where needed.";

// T3-companion strip + dedup Fix 3 (2026-05-12): defensive migration
// that runs ahead of the default-seed pass. Two passes:
//   (a) Strip any cost line whose targetAssetId points at an asset
//       flagged isCompanion === true. Companions carry no cost lines
//       by absolute rule; legacy snapshots from before the rule was
//       enforced (Pass 4 / Pass 7 era) may have accumulated such
//       lines. Engine short-circuit at computeAssetCost handles the
//       runtime case, but stripping them from storage keeps the
//       snapshot clean and rules out future drift.
//   (b) Dedup lines by (phaseId, baseId) keeping the FIRST occurrence.
//       Pass 10 hybrid already dedupes within its own grouping; this
//       defensive sweep catches edge cases (manual edits, partial
//       migration runs).
// Idempotent. Logs the dedup count to console for diagnostic.
function migrateT3StripCompanionAndDedup(snap: HydrateSnapshot): HydrateSnapshot {
  const lines = (snap.costLines as CostLine[]) ?? [];
  const assets = (snap.assets as Asset[]) ?? [];
  if (lines.length === 0) return snap;
  const companionIds = new Set(assets.filter((a) => a.isCompanion === true).map((a) => a.id));
  // Pass (a): strip companion-targeted lines.
  const afterStrip = lines.filter((c) => !(c.targetAssetId && companionIds.has(c.targetAssetId)));
  // Pass (b): dedup by (phaseId, baseId).
  const seen = new Set<string>();
  const afterDedup: CostLine[] = [];
  for (const c of afterStrip) {
    const baseId = deriveLineBaseId(c.id);
    const key = `${c.phaseId}::${baseId}::${c.targetAssetId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    afterDedup.push(c);
  }
  const stripped = lines.length - afterStrip.length;
  const deduped = afterStrip.length - afterDedup.length;
  if (stripped === 0 && deduped === 0) return snap;
  if (typeof console !== 'undefined' && (stripped + deduped) > 0) {
    // eslint-disable-next-line no-console
    console.log(`[REFM] T3 companion strip + dedup: removed ${stripped} companion-targeted line(s), ${deduped} duplicate(s)`);
  }
  return { ...snap, costLines: afterDedup };
}

// T3-defaults Fix (2026-05-12): Pass 10 hybrid short-circuits when no
// line carries a non-companion targetAssetId (needsWork === false).
// Snapshots whose costLines array landed empty for any reason
// (legacy migration drop, user added a phase but never added an
// asset, etc.) re-hydrate with that phase still empty and the user
// sees Tab 3 with no cost lines + 0 totals. This migration runs at
// the tail of every hydrate chain and seeds the 10-line default
// catalog (Land Cash, Land In-Kind, Construction BUA, Construction
// Parking, Infrastructure, Landscaping, Pre-operating, Professional
// Fee, Commission, Contingency) for every phase whose slice is
// empty post-migration. Idempotent: a phase that already has any
// cost lines is left untouched (user edits + custom lines preserved).
function migrateT3DefaultCostLineSeed(snap: HydrateSnapshot): HydrateSnapshot {
  const phases = (snap.phases as Phase[]) ?? [];
  const existing = (snap.costLines as CostLine[]) ?? [];
  if (phases.length === 0) return snap;
  const phaseHasLines = (phaseId: string): boolean =>
    existing.some((c) => c.phaseId === phaseId);
  const seeded: CostLine[] = [];
  for (const phase of phases) {
    if (phaseHasLines(phase.id)) continue;
    const cp = Math.max(1, phase.constructionPeriods ?? 24);
    seeded.push(...makeDefaultCostLines(phase.id, cp));
  }
  if (seeded.length === 0) return snap;
  return { ...snap, costLines: [...existing, ...seeded] };
}

// T2P3 Fix 2 (2026-05-12): companion type inheritance migration. Walks
// every companion asset (isCompanion === true with parentAssetId set)
// and copies the parent's `type` onto the companion when the two
// diverge. Idempotent: a snapshot whose companions already match the
// parent.type returns unchanged.
function migrateT2P3CompanionType(snap: HydrateSnapshot): HydrateSnapshot {
  const assets = (snap.assets as Asset[]) ?? [];
  const companions = assets.filter((a) => a.isCompanion === true && a.parentAssetId);
  if (companions.length === 0) return snap;
  let changed = false;
  const next = assets.map((a) => {
    if (a.isCompanion !== true || !a.parentAssetId) return a;
    const parent = assets.find((p) => p.id === a.parentAssetId);
    if (!parent) return a;
    const parentType = parent.type ?? '';
    if ((a.type ?? '') === parentType) return a;
    changed = true;
    return { ...a, type: parentType };
  });
  return changed ? { ...snap, assets: next } : snap;
}

// T2-Fix 5c (2026-05-12): companion sub-unit mirror migration. Walks
// every companion (Operate) asset and reconciles its sub-units against
// the parent's Sellable list. Existing companion sub-units are matched
// to parent rows by type name (case-insensitive) when parentSubUnitId
// is missing, so legacy snapshots whose companions were edited by hand
// pre-T2 carry their ADR forward. Sub-units on the companion whose
// parent has been deleted are dropped. New parent Sellables get fresh
// companion shadows with ADR=0. Idempotent: a snapshot already in
// T2-Fix 5c shape returns unchanged.
function migrateT2CompanionSubUnits(snap: HydrateSnapshot): HydrateSnapshot {
  const assets = (snap.assets as Asset[]) ?? [];
  const subUnits = (snap.subUnits as SubUnit[]) ?? [];
  const companions = assets.filter((a) => a.isCompanion === true && a.parentAssetId);
  if (companions.length === 0) return snap;
  let working: SubUnit[] = subUnits;
  let changed = false;
  for (const companion of companions) {
    const parentSellables = subUnits.filter(
      (u) => u.assetId === companion.parentAssetId && u.category === 'Sellable',
    );
    const existing = working.filter((u) => u.assetId === companion.id);
    // Index ADR by parentSubUnitId, then by name (lowercased) as fallback.
    const adrByParentId = new Map<string, number>();
    const adrByName = new Map<string, number>();
    for (const cs of existing) {
      const adr = cs.startingAdr !== undefined ? cs.startingAdr : cs.unitPrice;
      if (cs.parentSubUnitId) adrByParentId.set(cs.parentSubUnitId, adr);
      if (cs.name) adrByName.set(cs.name.toLowerCase(), adr);
    }
    const target = parentSellables.map((parentSub) => {
      const preserved = adrByParentId.get(parentSub.id) ?? adrByName.get((parentSub.name ?? '').toLowerCase());
      return makeCompanionSubUnit(parentSub, companion.id, preserved);
    });
    const sameLen = existing.length === target.length;
    const sameContents = sameLen && existing.every((b, i) => {
      const t = target[i]!;
      return b.id === t.id && b.parentSubUnitId === t.parentSubUnitId
        && b.metricValue === t.metricValue && (b.startingAdr ?? 0) === (t.startingAdr ?? 0);
    });
    if (sameContents) continue;
    changed = true;
    working = [
      ...working.filter((u) => u.assetId !== companion.id),
      ...target,
    ];
  }
  return changed ? { ...snap, subUnits: working } : snap;
}

export function snapshotNeedsPass10Migration(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const snap = s as Partial<HydrateSnapshot>;
  const lines = (snap.costLines as CostLine[] | undefined) ?? [];
  const assets = (snap.assets as Asset[] | undefined) ?? [];
  const companionIds = new Set(assets.filter((a) => a.isCompanion === true).map((a) => a.id));
  return lines.some((c) => c.targetAssetId !== undefined && !companionIds.has(c.targetAssetId));
}

export function snapshotNeedsPass4FinancingMigration(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const snap = s as Partial<HydrateSnapshot>;
  const project = snap.project as Project | undefined;
  if (!project?.financing) return false;
  return project.financing.assetFilter === undefined;
}

export function snapshotNeedsPass8Migration(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const snap = s as Partial<HydrateSnapshot>;
  const project = snap.project as Project | undefined;
  if (project?.projectNdaEnabled === true && project.projectNdaScope === undefined) return true;
  if (project && project.resultsViewMode === undefined) return true;
  const subUnits = (snap.subUnits as SubUnit[] | undefined) ?? [];
  const assets = (snap.assets as Asset[] | undefined) ?? [];
  for (const a of assets) {
    if (a.subUnitMetric === undefined && subUnits.some((u) => u.assetId === a.id)) return true;
  }
  const phases = (snap.phases as Phase[] | undefined) ?? [];
  const maxCp = phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0);
  const lines = (snap.costLines as CostLine[] | undefined) ?? [];
  if (lines.some((c) => typeof c.endPeriod === 'number' && c.endPeriod > maxCp + 1)) return true;
  return false;
}

export function snapshotNeedsPass3Migration(s: unknown): boolean {
  if (s === null || typeof s !== 'object') return false;
  const snap = s as Partial<HydrateSnapshot>;
  const project = snap.project as Project | undefined;
  if (project?.financing?.viewMode === 'single_asset') return true;
  if ((snap.equityContributions as EquityContribution[] | undefined)?.length) return true;
  const tranches = (snap.financingTranches as FinancingTranche[] | undefined) ?? [];
  if (tranches.length > 1 && tranches.some((t) => (t as FinancingTranche & { facilitySharePct?: number }).facilitySharePct === undefined)) {
    return true;
  }
  return false;
}

// M2.0M Pass 2 (2026-05-11): consolidate Tab 4 Financing schema.
// Handles 5 concerns in one pass:
//   (Fix 6) lift legacy cashDeficitConfig.minimumCashReserve into
//           project.financing.minimumCashReserve when top-level absent.
//   (Fix 7) map deprecated IDC treatment 'mixed' -> 'capitalize'.
//   (Fix 8) map facility scope='asset' -> 'phase' using parent phase.
//   (Fix 10) stamp phaseFilter='__all__' default when missing.
//   (Fix 5) map deprecated repayment methods to the new 3-method enum.
// Idempotent: re-running on a Pass-2-shaped snapshot is a no-op.
function migrateM20mPass2Financing(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  let nextProject = project;
  let touched = false;

  if (project.financing) {
    const f = project.financing;
    const patch: Partial<typeof f> = {};
    // Fix 6: lift minimumCashReserve from cashDeficitConfig.
    if (f.minimumCashReserve === undefined) {
      const cd = f.cashDeficitConfig;
      const fromCd = cd ? cd.minimumCashReserve : undefined;
      const scalar = typeof fromCd === 'number' ? fromCd : (Array.isArray(fromCd) && fromCd.length > 0 ? fromCd[0] : 0);
      patch.minimumCashReserve = scalar;
      touched = true;
    }
    // Fix 10: default phaseFilter to '__all__'.
    if (f.phaseFilter === undefined) {
      patch.phaseFilter = PHASE_FILTER_ALL;
      touched = true;
    }
    if (Object.keys(patch).length > 0) {
      nextProject = { ...project, financing: { ...f, ...patch } };
    }
  }

  // Fix 7 + Fix 8 + Fix 5: per-facility migrations.
  const repaymentMap: Record<string, RepaymentMethod> = {
    straight_line: 'equal_repayment',
    equal_periodic_amortization: 'equal_repayment',
    cashsweep_continuous: 'cash_sweep',
    cashsweep_from_period: 'cash_sweep',
    cashsweep_min_cash: 'cash_sweep',
    bullet: 'equal_repayment',
    balloon: 'year_on_year_pct',
    manual: 'year_on_year_pct',
    custom_schedule: 'year_on_year_pct',
  };
  const assets = (snap.assets ?? []) as Asset[];
  const tranches = (snap.financingTranches ?? []) as FinancingTranche[];
  const newTranches: FinancingTranche[] = tranches.map((t) => {
    let nt: FinancingTranche = t;
    // Fix 7: IDC mixed -> capitalize.
    if ((nt.idcTreatment as unknown) === 'mixed') {
      nt = { ...nt, idcTreatment: 'capitalize' };
      touched = true;
    }
    // Fix 8: scope='asset' -> 'phase' using parent phase of scopeId/assetId.
    const tt = nt as FinancingTranche & { scope?: string; scopeId?: string };
    if (tt.scope === 'asset') {
      const targetAssetId = tt.scopeId ?? nt.assetId;
      const parentPhaseId = targetAssetId
        ? assets.find((a) => a.id === targetAssetId)?.phaseId
        : undefined;
      const replacement = { ...nt } as FinancingTranche & { scope?: string; scopeId?: string };
      replacement.scope = 'phase';
      replacement.scopeId = parentPhaseId ?? nt.phaseId;
      nt = replacement as FinancingTranche;
      touched = true;
    }
    // Fix 5: repayment method migration.
    const oldMethod = nt.repaymentMethod as string;
    if (oldMethod in repaymentMap) {
      const newMethod = repaymentMap[oldMethod];
      const patch: Partial<FinancingTranche> = { repaymentMethod: newMethod };
      if (newMethod === 'equal_repayment') {
        // Pick sub-method.
        const sub = oldMethod === 'straight_line' ? 'equal_principal' : 'equal_total';
        patch.equalRepaymentSubMethod = nt.equalRepaymentSubMethod ?? sub;
        if (oldMethod === 'bullet' && (nt.tenorPeriods ?? 0) <= 0) {
          patch.tenorPeriods = 1;
        }
      } else if (newMethod === 'year_on_year_pct') {
        // Carry over manual distribution where present.
        if (!nt.yearOnYearPctSchedule && Array.isArray(nt.repaymentManualDistribution)) {
          patch.yearOnYearPctSchedule = [...nt.repaymentManualDistribution];
        }
      } else if (newMethod === 'cash_sweep') {
        if (!nt.cashSweepConfig) {
          patch.cashSweepConfig = {
            startingYear: nt.sweepStartPeriod ?? 1,
            sweepRatio: nt.sweepRatio ?? 75,
          };
        }
      }
      nt = { ...nt, ...patch };
      touched = true;
    } else if (nt.repaymentMethod === 'equal_repayment' && !nt.equalRepaymentSubMethod) {
      // Fresh facilities created post-P2 already on equal_repayment need
      // a sub-method defaulted.
      nt = { ...nt, equalRepaymentSubMethod: 'equal_total' };
      touched = true;
    }
    return nt;
  });

  if (!touched) return snap;
  return {
    ...snap,
    project: nextProject,
    financingTranches: newTranches,
  };
}

// M2.0M Pass 6 Fix 3 (2026-05-11): roll up legacy per-parcel NDA
// toggles into the new project-level fields (projectNdaEnabled +
// projectRoadsPct + projectParksPct). When at least one parcel has
// hasNdaDeduction=true, compute the area-weighted average roads%
// and parks% across NDA-enabled parcels and stamp them on the
// project; flip projectNdaEnabled=true. Per-parcel fields are kept
// for back-compat but stop influencing the calc engine once the
// project flag is on. Idempotent: if projectNdaEnabled is already
// defined, the migration is a no-op.
function migrateM20mPass6NdaToProject(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  if (project.projectNdaEnabled !== undefined) return snap;
  const parcels = snap.parcels as Parcel[];
  const ndaParcels = parcels.filter((p) => p.hasNdaDeduction === true);
  if (ndaParcels.length === 0) {
    return {
      ...snap,
      project: { ...project, projectNdaEnabled: false },
    };
  }
  let weightedRoads = 0;
  let weightedParks = 0;
  let totalArea = 0;
  for (const p of ndaParcels) {
    const a = Math.max(0, p.area);
    if (a <= 0) continue;
    totalArea += a;
    weightedRoads += a * Math.max(0, Math.min(100, p.roadsPct ?? 0));
    weightedParks += a * Math.max(0, Math.min(100, p.parksPct ?? 0));
  }
  const roadsPct = totalArea > 0 ? weightedRoads / totalArea : (project.projectRoadsPct ?? 0);
  const parksPct = totalArea > 0 ? weightedParks / totalArea : (project.projectParksPct ?? 0);
  return {
    ...snap,
    project: {
      ...project,
      projectNdaEnabled: true,
      projectRoadsPct: Math.round(roadsPct * 100) / 100,
      projectParksPct: Math.round(parksPct * 100) / 100,
    },
  };
}

// M2.0M Pass 6 Fix 2 (2026-05-11): smart migration of display defaults.
// The pre-Pass-6 defaults were displayScale='full' + displayDecimals=2.
// Pass 6 changes the new-project defaults to 'thousands' + 0. To avoid
// blowing away explicit user customisation, this migration only flips
// snapshots that carry the EXACT prior default combo (full + 2). Any
// other pairing is preserved verbatim. Idempotent.
function migrateM20mPass6DisplayDefaults(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  if (project.displayScale === 'full' && project.displayDecimals === 2) {
    return {
      ...snap,
      project: { ...project, displayScale: 'thousands', displayDecimals: 0 },
    };
  }
  return snap;
}

// M2.0M (2026-05-11): project-level financing wrapper migration.
// Stamps a default ProjectFinancingConfig (Method 1, 70/30, no parcel
// configs, viewMode='combined') onto Project.financing when missing.
// Pre-existing FinancingTranche[] + EquityContribution[] are preserved
// AS-IS; this migration only adds the wrapper that selects HOW the
// funding gap is computed before tranches absorb it. Idempotent.
function migrateM20MFinancing(snap: HydrateSnapshot): HydrateSnapshot {
  const project = snap.project as Project;
  if (project.financing !== undefined) return snap;
  // Deep-clone the default so the migrated config is not shared by
  // reference across multiple projects that all hit this branch.
  const cloned: ProjectFinancingConfig = {
    ...DEFAULT_PROJECT_FINANCING_CONFIG,
    fixedRatio: DEFAULT_PROJECT_FINANCING_CONFIG.fixedRatio
      ? { ...DEFAULT_PROJECT_FINANCING_CONFIG.fixedRatio }
      : undefined,
    parcelFunding: [],
  };
  return {
    ...snap,
    project: { ...project, financing: cloned },
  };
}

// M2.0L Pass 5 (2026-05-11): default every master CostLine to
// costCategory='direct' when unset, preserving the Pass-3+ asset-
// specific compute path. Idempotent.
function migrateM20Pass5Categories(snap: HydrateSnapshot): HydrateSnapshot {
  let touched = false;
  const newCostLines = (snap.costLines as CostLine[]).map((c) => {
    if (c.costCategory !== undefined) return c;
    touched = true;
    return { ...c, costCategory: 'direct' as const };
  });
  if (!touched) return snap;
  return { ...snap, costLines: newCostLines };
}

// M2.0L Pass 4 (2026-05-11): inheritance model migration. Two effects:
//   1. Stamp `overridden = true` on every CostOverride entry that
//      doesn't carry the flag yet. Legacy overrides were ALL
//      intentional (the previous data model had no toggle), so we
//      preserve their behaviour by marking them active.
//   2. Strip deprecated `Project.costInputMode`. The Same vs
//      Individual mode UX is gone; both surface views are now always
//      rendered (master template + per-asset resolved replicas).
// Idempotent: re-running on a Pass-4-shaped snapshot is a no-op.
function migrateM20Pass4Inheritance(snap: HydrateSnapshot): HydrateSnapshot {
  let touched = false;
  const overrides = (snap.costOverrides ?? []) as CostOverride[];
  const newOverrides = overrides.map((o) => {
    if (o.overridden === undefined) {
      touched = true;
      return { ...o, overridden: true };
    }
    return o;
  });
  const project = snap.project as Project & { costInputMode?: unknown };
  let newProject = project;
  if (project && 'costInputMode' in project && project.costInputMode !== undefined) {
    const stripped: Partial<Project & { costInputMode?: unknown }> = { ...project };
    delete stripped.costInputMode;
    newProject = stripped as Project;
    touched = true;
  }
  if (!touched) return snap;
  return { ...snap, costOverrides: newOverrides, project: newProject };
}

// M2.0L (2026-05-11): legacy snapshots seeded cost lines with hardcoded
// ids ('land-cash', 'construction-bua', etc.) per phase, so a 2-phase
// project produced 20 lines whose ids collided across phases. This
// migration rescopes every standard-catalog id with `__${phaseId}` and
// rewrites cross-references (selectedLineIds, costOverrides.lineId) to
// match. Idempotent: lines whose ids already contain `__` are left
// alone. Custom user lines (id starts with 'custom-') are untouched.
function migrateM20lDedupeCostLineIds(snap: HydrateSnapshot): HydrateSnapshot {
  const standardIdSet = new Set<string>(STANDARD_COST_LINE_IDS as readonly string[]);
  // Build per-phase rename map: baseId -> composed id
  const renameByPhase = new Map<string, Map<string, string>>();
  const costLines = snap.costLines as CostLine[];
  let touched = false;
  for (const c of costLines) {
    const baseId = deriveLineBaseId(c.id);
    // Only rescope STANDARD catalog ids; custom-${timestamp} stays alone.
    if (!standardIdSet.has(baseId)) continue;
    // Already scoped (contains '__')? Skip.
    if (c.id !== baseId) continue;
    if (!renameByPhase.has(c.phaseId)) {
      renameByPhase.set(c.phaseId, new Map());
    }
    const m = renameByPhase.get(c.phaseId)!;
    m.set(c.id, composeLineId(c.id, c.phaseId));
    touched = true;
  }
  if (!touched) return snap;
  const rewriteId = (lineId: string, phaseId: string): string => {
    const m = renameByPhase.get(phaseId);
    if (!m) return lineId;
    return m.get(lineId) ?? lineId;
  };
  const newCostLines: CostLine[] = costLines.map((c) => {
    const id = rewriteId(c.id, c.phaseId);
    if (id === c.id && !c.selectedLineIds) return c;
    const next: CostLine = { ...c, id };
    if (next.selectedLineIds && next.selectedLineIds.length > 0) {
      next.selectedLineIds = next.selectedLineIds.map((ref) => rewriteId(ref, c.phaseId));
    }
    return next;
  });
  const newCostOverrides: CostOverride[] = (snap.costOverrides as CostOverride[]).map((o) => {
    // Override.lineId refers to the cost line. We need to know which
    // phase the override targeted; look it up via the original (pre-
    // rename) line in costLines whose id matches o.lineId and whose
    // asset is in any phase. Since overrides are scoped by asset and
    // the asset has a phaseId, derive phase from o.assetId.
    const asset = (snap.assets as Asset[]).find((a) => a.id === o.assetId);
    if (!asset) return o;
    const id = rewriteId(o.lineId, asset.phaseId);
    return id === o.lineId ? o : { ...o, lineId: id };
  });
  return { ...snap, costLines: newCostLines, costOverrides: newCostOverrides };
}

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

// M2.0j Fix 9 (2026-05-07): phasing simplified to Even + Manual %. Any
// cost line carrying a deprecated phasing value ('frontloaded' /
// 'backloaded' / 'sCurve' / 'phase_aligned') folds to 'even'. The calc
// engine's distribute() helper still recognises the deprecated values
// (treats them as even) so this migration is purely for snapshot
// hygiene; behaviour is bit-identical pre and post.
function migrateM20jPhasing(snap: HydrateSnapshot): HydrateSnapshot {
  const DEPRECATED = new Set(['frontloaded', 'backloaded', 'sCurve', 'phase_aligned']);
  let touched = false;
  const costLines = snap.costLines.map((c) => {
    if (DEPRECATED.has(c.phasing as string)) {
      touched = true;
      return { ...c, phasing: 'even' as const };
    }
    return c;
  });
  const costOverrides = snap.costOverrides.map((o) => {
    if (o.phasing && DEPRECATED.has(o.phasing as string)) {
      touched = true;
      return { ...o, phasing: 'even' as const };
    }
    return o;
  });
  return touched ? { ...snap, costLines, costOverrides } : snap;
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

// M2.0L Fix 1 (2026-05-11): generic banner shown when a legacy snapshot
// was migrated through the loose-shape recovery path. Surfaced once so
// the user verifies their inputs after the schema update.
export const LEGACY_MIGRATION_NOTICE =
  "Project updated to latest schema, please verify your inputs.";

// M2.0L Pass 4 (2026-05-11): banner shown when the snapshot carried
// either deprecated costInputMode OR un-flagged CostOverride entries.
// Indicates the cost engine surface has changed from Same/Individual
// toggle to the parent/child inheritance view.
export const PASS4_MIGRATION_NOTICE =
  "Cost engine upgraded to inheritance model. Review master template and per-asset overrides in Tab 3.";

// M2.0L Pass 5 (2026-05-11): banner shown when CostLines were stamped
// with a default costCategory='direct'. Prompts user to review pools
// that should be reclassified as Allocated.
export const PASS5_MIGRATION_NOTICE =
  "Cost lines now carry Category + Driver. Existing lines default to Direct; review Tab 3 to mark project-wide pools as Allocated.";

// M2.0M (2026-05-11): banner shown when Project.financing wrapper was
// stamped onto a legacy snapshot. The user lands on Method 1 (70/30
// debt/equity) by default; the brief prompts them to revisit Tab 4 to
// confirm method choice + per-parcel land funding.
export const M20M_FINANCING_NOTICE =
  "Financing module upgraded. Configure your funding method and capital stack in Tab 4.";

// M2.0L Fix 1 (2026-05-11): loose shape detector. Anything with a
// `project` object that can plausibly map to v8. Catches legacy
// snapshots that fall outside the strict v7 fingerprint (e.g. saves
// from earlier code paths that omitted landAllocationMode, costLines,
// or financingTranches arrays).
function isLooseSnapshot(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  // Any of: project object, phases array, assets array, or costLines.
  if (typeof o.project === 'object' && o.project !== null) return true;
  if (Array.isArray(o.phases) && o.phases.length > 0) return true;
  if (Array.isArray(o.assets) && o.assets.length > 0) return true;
  if (Array.isArray(o.costLines) && o.costLines.length > 0) return true;
  return false;
}

// M2.0L Fix 1 (2026-05-11): permissive legacy migration. Accepts any
// shape and backfills every missing optional field with safe defaults
// so existing projects never error out post-deployment. Pipes through
// the full migration chain (v7 -> v8, parking fold, phasing normalize,
// id dedupe) so the result is bit-identical to a freshly saved v8
// snapshot for fields the user did populate.
function migrateLegacyToV8(input: unknown): HydrateSnapshot {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  // Project: spread defaults under the legacy values so any field the
  // user did set survives, and any missing optional field gets a
  // sensible default.
  const legacyProject = (typeof o.project === 'object' && o.project !== null
    ? o.project
    : {}) as Partial<Project>;
  const project: Project = {
    ...makeDefaultProject(),
    ...legacyProject,
    // Force a couple of v8 invariants while preserving the user's
    // selection where it makes sense.
    currency: legacyProject.currency ?? 'SAR',
    modelType: legacyProject.modelType === 'monthly' ? 'monthly' : 'annual',
  } as Project;

  // Phases: must have at least one. Backfill timing fields per phase.
  const rawPhases = Array.isArray(o.phases) ? (o.phases as Partial<Phase>[]) : [];
  const phases: Phase[] = (rawPhases.length > 0 ? rawPhases : [makeDefaultPhase()]).map((p, idx) => ({
    id: p.id ?? (idx === 0 ? DEFAULT_PHASE_ID : `phase_${idx + 1}`),
    name: p.name ?? `Phase ${idx + 1}`,
    constructionStart: typeof p.constructionStart === 'number' ? p.constructionStart : 1,
    constructionPeriods: typeof p.constructionPeriods === 'number' ? p.constructionPeriods : 24,
    operationsPeriods: typeof p.operationsPeriods === 'number' ? p.operationsPeriods : 60,
    overlapPeriods: typeof p.overlapPeriods === 'number' ? p.overlapPeriods : 0,
    startDate: p.startDate,
    status: p.status,
    historicalBaseline: p.historicalBaseline,
  }));

  const firstPhaseId = phases[0].id;

  // Land allocation. Default 'autoByBua' is the safest fallback because
  // it derives from BUA share without needing explicit sqm/pct inputs.
  const landAllocationMode: LandAllocationMode =
    o.landAllocationMode === 'sqm' || o.landAllocationMode === 'percent' || o.landAllocationMode === 'autoByBua'
      ? o.landAllocationMode
      : 'autoByBua';

  // Parcels: at least one, so the Land tab has something to render.
  const rawParcels = Array.isArray(o.parcels) ? (o.parcels as Partial<Parcel>[]) : [];
  const parcels: Parcel[] = rawParcels.length > 0
    ? rawParcels.map((p, idx) => ({
        id: p.id ?? (idx === 0 ? 'parcel_1' : `parcel_${idx + 1}`),
        phaseId: p.phaseId ?? firstPhaseId,
        name: p.name ?? `Land ${idx + 1}`,
        area: typeof p.area === 'number' ? p.area : 0,
        rate: typeof p.rate === 'number' ? p.rate : 0,
        cashPct: typeof p.cashPct === 'number' ? p.cashPct : 100,
        inKindPct: typeof p.inKindPct === 'number' ? p.inKindPct : 0,
        hasNdaDeduction: p.hasNdaDeduction,
        roadsPct: p.roadsPct,
        parksPct: p.parksPct,
      }))
    : [makeDefaultParcel(undefined, firstPhaseId)];

  // Assets: rename legacy 'Hybrid' strategy to 'Sell + Manage'.
  const rawAssets = Array.isArray(o.assets) ? (o.assets as Partial<Asset>[]) : [];
  const assets: Asset[] = rawAssets.map((a) => ({
    id: a.id ?? `asset_${Math.random().toString(36).slice(2, 8)}`,
    phaseId: a.phaseId ?? firstPhaseId,
    name: a.name ?? 'Asset',
    type: a.type ?? '',
    strategy: (a.strategy as string) === 'Hybrid' ? 'Sell + Manage' : (a.strategy ?? 'Sell'),
    visible: a.visible !== false,
    landAreaSqm: a.landAreaSqm,
    landAreaPct: a.landAreaPct,
    landAllocation: a.landAllocation,
    gfaSqm: typeof a.gfaSqm === 'number' ? a.gfaSqm : 0,
    buaSqm: typeof a.buaSqm === 'number' ? a.buaSqm : 0,
    sellableBuaSqm: typeof a.sellableBuaSqm === 'number' ? a.sellableBuaSqm : 0,
    buaTotal: a.buaTotal,
    supportArea: a.supportArea,
    parkingArea: a.parkingArea,
    parkingBaysRequired: typeof a.parkingBaysRequired === 'number' ? a.parkingBaysRequired : 0,
    managementAgreement: a.managementAgreement,
    usefulLifeYears: a.usefulLifeYears,
    status: a.status,
    historicalBaseline: a.historicalBaseline,
  })) as Asset[];

  const subUnits: SubUnit[] = Array.isArray(o.subUnits) ? (o.subUnits as SubUnit[]) : [];

  // Cost lines: rename legacy v6 ids to closest v7 standard so the
  // calc engine's stage/scope derivation still works. Anything else
  // passes through unchanged.
  const V6_TO_V7_LINE_ID: Record<string, string> = {
    'site-prep':          'infrastructure',
    'structural':         'construction-bua',
    'mep':                'construction-bua',
    'finishing':          'construction-bua',
    'professional-fees':  'professional-fee',
    'project-management': 'professional-fee',
    'legal':              'professional-fee',
    'ffe':                'pre-operating',
    'marketing':          'commission',
  };
  const rawCostLines = Array.isArray(o.costLines) ? (o.costLines as Partial<CostLine>[]) : [];
  let costLines: CostLine[] = rawCostLines.map((c) => {
    const baseId = deriveLineBaseId(c.id ?? '');
    const renamed = V6_TO_V7_LINE_ID[baseId] ?? baseId;
    return {
      id: c.id ? (V6_TO_V7_LINE_ID[baseId] ? renamed : c.id) : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      phaseId: c.phaseId ?? firstPhaseId,
      name: c.name ?? 'Cost Line',
      method: c.method ?? 'fixed',
      value: typeof c.value === 'number' ? c.value : 0,
      stage: c.stage ?? 'hard',
      scope: c.scope ?? 'direct',
      allocationBasis: c.allocationBasis ?? 'per_asset',
      startPeriod: typeof c.startPeriod === 'number' ? c.startPeriod : 0,
      endPeriod: typeof c.endPeriod === 'number' ? c.endPeriod : 1,
      phasing: c.phasing ?? 'even',
      distribution: c.distribution,
      selectedLineIds: c.selectedLineIds,
      isLocked: c.isLocked,
      requiresCountry: c.requiresCountry,
      disabled: c.disabled,
      targetAssetId: c.targetAssetId,
      subUnitId: c.subUnitId,
      perSubUnitRates: c.perSubUnitRates,
    };
  });
  // If after all that the project still has zero cost lines, seed the
  // M2.0d standard catalog for the first phase so the user sees something.
  if (costLines.length === 0) {
    costLines = makeDefaultCostLines(firstPhaseId, phases[0].constructionPeriods);
  }

  const costOverrides: CostOverride[] = Array.isArray(o.costOverrides) ? (o.costOverrides as CostOverride[]) : [];

  const rawTranches = Array.isArray(o.financingTranches) ? (o.financingTranches as Partial<FinancingTranche>[]) : [];
  const financingTranches: FinancingTranche[] = rawTranches.length > 0
    ? rawTranches.map((t, idx) => ({
        id: t.id ?? `tranche_${idx + 1}`,
        phaseId: t.phaseId ?? firstPhaseId,
        name: t.name ?? 'Senior debt',
        ltvPct: typeof t.ltvPct === 'number' ? t.ltvPct : 60,
        interestRatePct: typeof t.interestRatePct === 'number' ? t.interestRatePct : 7.5,
        drawdownMethod: t.drawdownMethod ?? 'capex_basis',
        repaymentMethod: t.repaymentMethod ?? 'straight_line',
        repaymentPeriods: typeof t.repaymentPeriods === 'number' ? t.repaymentPeriods : 60,
        idcCapitalize: t.idcCapitalize !== false,
        ...t,
      } as FinancingTranche))
    : [makeDefaultFinancingTranche('tranche_1', firstPhaseId)];

  const equityContributions: EquityContribution[] = Array.isArray(o.equityContributions)
    ? (o.equityContributions as EquityContribution[])
    : [];

  let snap: HydrateSnapshot = {
    project,
    phases,
    parcels,
    landAllocationMode,
    assets,
    subUnits,
    costLines,
    costOverrides,
    financingTranches,
    equityContributions,
  };

  // Run the full migration chain so the loose result is identical to
  // a v7 -> v8 hydration: aggregate monthly to annual, fold legacy
  // Parking sub-units, normalise phasing, dedupe phase-scoped ids,
  // apply Pass 4 / Pass 5 / M2.0M wrapper migrations, Pass 6
  // display defaults, then T2-Fix 5c companion sub-unit mirror.
  snap = migrateT3DefaultCostLineSeed(migrateT3StripCompanionAndDedup(migrateT2P3CompanionType(migrateT2CompanionSubUnits(migrateM20costsPass10Hybrid(migrateM20mPass4Financing(migrateM20costsPass8(migrateM20mPass3Financing(
    migrateM20costsPass7PerAsset(
      migrateM20mPass2Financing(
        migrateM20mPass6NdaToProject(
          migrateM20mPass6DisplayDefaults(
            migrateM20MFinancing(
              migrateM20Pass5Categories(
                migrateM20Pass4Inheritance(
                  migrateM20lDedupeCostLineIds(
                    migrateM20jPhasing(migrateM20gParkingSubUnits(migrateV7ToV8(snap))),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ))))))));
  return snap;
}

// M2.0L Pass 4 (2026-05-11): true if the raw snapshot carries
// costInputMode OR any CostOverride without the overridden flag.
// Surfaced as the Pass 4 banner so the user knows the input surface
// changed even when the on-disk version stays v8.
function snapshotNeedsPass4Migration(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as { project?: { costInputMode?: unknown }; costOverrides?: unknown[] };
  if (o.project && typeof o.project === 'object' && o.project.costInputMode !== undefined) return true;
  if (Array.isArray(o.costOverrides)) {
    for (const ov of o.costOverrides) {
      if (ov && typeof ov === 'object' && (ov as Record<string, unknown>).overridden === undefined) {
        return true;
      }
    }
  }
  return false;
}

// M2.0L Pass 5 (2026-05-11): true if any CostLine lacks costCategory.
function snapshotNeedsPass5Migration(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as { costLines?: unknown[] };
  if (!Array.isArray(o.costLines)) return false;
  for (const c of o.costLines) {
    if (c && typeof c === 'object' && (c as Record<string, unknown>).costCategory === undefined) {
      return true;
    }
  }
  return false;
}

// M2.0M Pass 7 (2026-05-11): true if any cost line is missing
// targetAssetId (legacy master) or any CostOverride entry exists.
// Triggers M20COSTS_PASS7_NOTICE once on first hydrate.
function snapshotNeedsPass7Migration(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as { costLines?: unknown[]; costOverrides?: unknown[] };
  if (Array.isArray(o.costLines)) {
    for (const c of o.costLines) {
      if (c && typeof c === 'object' && (c as Record<string, unknown>).targetAssetId === undefined) {
        return true;
      }
    }
  }
  if (Array.isArray(o.costOverrides) && o.costOverrides.length > 0) return true;
  return false;
}

// M2.0M (2026-05-11): true if the snapshot's project lacks a
// `financing` wrapper. Surfaced as the M20M banner so the user knows
// the new funding-method selector + per-parcel funding config is now
// available.
function snapshotNeedsM20MMigration(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as { project?: { financing?: unknown } };
  if (!o.project || typeof o.project !== 'object') return false;
  return o.project.financing === undefined;
}

// Pick the most-recent banner that applies. Pass 8 (costs) is the
// newest; then Pass 3 (financing); then Pass 7 (costs); then M20M;
// then Pass 5; then Pass 4; else the loose / M2.0h v7 -> v8 banner
// upstream.
function resolveBanner(s: unknown): string | undefined {
  // P10-Fix 3 (2026-05-12): Pass 10 hybrid migration takes priority
  // over older banners. When a snapshot carries per-asset cost line
  // targetAssetId, Pass 10 collapses to project-wide masters +
  // overrides on first hydrate; surface the notice so the user
  // knows where to look (Tab 3 + any per-asset rate divergence).
  if (snapshotNeedsPass10Migration(s)) return M20_PASS10_NOTICE;
  if (snapshotNeedsPass4FinancingMigration(s)) return M20M_PASS4_NOTICE;
  if (snapshotNeedsPass8Migration(s)) return M20_PASS8_NOTICE;
  if (snapshotNeedsPass3Migration(s)) return M20M_PASS3_NOTICE;
  if (snapshotNeedsPass7Migration(s)) return M20COSTS_PASS7_NOTICE;
  if (snapshotNeedsM20MMigration(s)) return M20M_FINANCING_NOTICE;
  if (snapshotNeedsPass5Migration(s)) return PASS5_MIGRATION_NOTICE;
  if (snapshotNeedsPass4Migration(s)) return PASS4_MIGRATION_NOTICE;
  return undefined;
}

export function hydrationFromAnySnapshotChecked(snapshot: unknown): CheckedHydration {
  if (isV8Snapshot(snapshot)) {
    return {
      snapshot: stripV8Wrapper(snapshot),
      recognized: true,
      migrationNotice: resolveBanner(snapshot),
    };
  }
  if (isV7Snapshot(snapshot)) {
    const notice = snapshotNeedsV8Migration(snapshot)
      ? M20H_MIGRATION_NOTICE
      : resolveBanner(snapshot);
    return { snapshot: stripWrapper(snapshot), recognized: true, migrationNotice: notice };
  }
  // M2.0L Fix 1 (2026-05-11): pre-v7 and unrecognized shapes flow
  // through migrateLegacyToV8 instead of failing with a "recreate
  // this project" error. The loose path backfills every missing
  // optional field with safe defaults and pipes through the full
  // migration chain so the user keeps their data.
  if (isPreV7Snapshot(snapshot) || isLooseSnapshot(snapshot)) {
    return {
      snapshot: migrateLegacyToV8(snapshot),
      recognized: true,
      migrationNotice: LEGACY_MIGRATION_NOTICE,
    };
  }
  // Last-resort: nothing usable. Fall back to defaults but still
  // surface the banner so the user knows something happened.
  if (typeof console !== 'undefined') {
    console.warn('[REFM] Empty / unparseable snapshot; falling back to defaults.');
  }
  return {
    snapshot: { ...DEFAULT_MODULE1_STATE },
    recognized: true,
    migrationNotice: LEGACY_MIGRATION_NOTICE,
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
