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
  return migrateM20mPass3Financing(
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
  );
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
  // M2.0M Pass 6 display defaults flip, M2.0M Pass 2 / Pass 7 / Pass 3.
  return migrateM20mPass3Financing(
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
  );
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
  // apply Pass 4 / Pass 5 / M2.0M wrapper migrations, then Pass 6
  // display defaults.
  snap = migrateM20mPass3Financing(
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
  );
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

// Pick the most-recent banner that applies. Pass 3 (financing) is the
// newest; then Pass 7 (costs); then M20M; then Pass 5; then Pass 4;
// else the loose / M2.0h v7 -> v8 banner upstream.
function resolveBanner(s: unknown): string | undefined {
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
