/**
 * module1-migrate.ts
 *
 * Bidirectional adapter between the legacy refm_v2 snapshot shape (3
 * hardcoded asset arrays + scalar per-asset metrics) and the new
 * normalized shape introduced in Phase M1.R (assets[], phases[],
 * costs[]).
 *
 * Two consumers depend on this module:
 *   1. RealEstatePlatform.handleLoadVersion calls migrateLegacyToNew on
 *      every loaded snapshot, so saved projects from before M1.R
 *      hydrate cleanly into the Zustand store.
 *   2. RealEstatePlatform.getSnapshot calls toLegacySnapshot before
 *      writing to localStorage. Storage schema bump (version: 3) lands
 *      in a separate phase; until then the on-disk shape stays v2 so
 *      partially-deployed clients can still read each other's exports.
 *
 * The 3 canonical legacy asset ids (residential / hospitality / retail)
 * survive both directions losslessly. Custom asset ids round-trip only
 * when storage is bumped to v3; the v2 reverse adapter drops them with
 * a console warning.
 */

import type { CostItem, LandParcel } from '@core/types/project.types';
import type { ProjectType, ModelType, CostInputMode, FinancingMode, RepaymentMethod } from '@core/types/project.types';
import type { AssetClass, Phase, CostLine } from './module1-types';
import {
  LEGACY_ASSET_IDS,
  DEFAULT_LEGACY_ASSETS,
  DEFAULT_SUB_PROJECT_ID,
  makeDefaultPhase,
  makeDefaultSubProject,
  makeDefaultMasterHolding,
} from './module1-types';
import type { HydrateSnapshot } from './module1-store';
import { DEFAULT_MODULE1_STATE } from './module1-store';

// ── Legacy snapshot shape (refm_v2) ─────────────────────────────────────────
// Mirrors the object returned by RealEstatePlatform.getSnapshot() prior to
// Phase M1.R. `version: 2` is the discriminator that routes a payload
// through the forward migrator.
export interface LegacyV2Snapshot {
  version: 2;
  savedAt?: string;

  projectName: string;
  projectType: ProjectType;
  country: string;
  currency: string;
  modelType: ModelType;
  projectStart: string;
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;

  landParcels: LandParcel[];
  projectRoadsPct: number;
  projectFAR: number;
  projectNonEnclosedPct?: number;

  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;

  residentialDeductPct: number;
  residentialEfficiency: number;
  hospitalityDeductPct: number;
  hospitalityEfficiency: number;
  retailDeductPct: number;
  retailEfficiency: number;

  residentialCosts: CostItem[];
  hospitalityCosts: CostItem[];
  retailCosts: CostItem[];
  costInputMode: CostInputMode;
  nextCostId: number;

  costStage?: Record<number, number>;
  costScope?: Record<number, string>;
  costDevFeeMode?: Record<number, string>;
  allocBasis?: 'direct_cost' | 'gfa';

  interestRate: number;
  financingMode: FinancingMode;
  globalDebtPct: number;
  capitalizeInterest: boolean;
  repaymentPeriods: number;
  repaymentMethod: RepaymentMethod;
  lineRatios: Record<string, number>;
}

export interface NewV3Snapshot extends HydrateSnapshot {
  version: 3;
  savedAt?: string;
}

// Discriminated union the load path can switch on.
export type AnySnapshot = LegacyV2Snapshot | NewV3Snapshot;

// ── Type guards ────────────────────────────────────────────────────────────
export function isLegacyV2(s: unknown): s is LegacyV2Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as { version?: unknown; residentialCosts?: unknown };
  // Either explicitly version: 2 or no version field but with the legacy
  // residentialCosts array (covers any pre-versioning snapshots).
  return o.version === 2 || (o.version === undefined && Array.isArray(o.residentialCosts));
}

export function isNewV3(s: unknown): s is NewV3Snapshot {
  if (!s || typeof s !== 'object') return false;
  const o = s as { version?: unknown; assets?: unknown; phases?: unknown; costs?: unknown };
  // Recognition is shape-based, not discriminator-based: any payload
  // carrying assets[] + phases[] + costs[] is treated as v3-shaped.
  // v2 snapshots have neither a flat assets[] nor a phases[] (the
  // legacy schema is residentialCosts/hospitalityCosts/retailCosts +
  // construction/operations/overlap scalars), so this never accidentally
  // mis-routes a v2 row.
  //
  // Why looser: every snapshot the system POSTs to /api/refm/projects
  // (wizard create, legacy create, auto-save) is bare HydrateSnapshot
  // without a `version: 3` discriminator. When `loadProject` returns
  // that payload to `hydrationFromAnySnapshot`, the strict version
  // check used to fall through to DEFAULT_MODULE1_STATE — silently
  // wiping the user's wizard-created Sub-Project / Plots / Assets /
  // Sub-Units on every page reload.
  //
  // The `version === 3` constant is preserved for the case where a
  // future writer DOES stamp the discriminator; it just isn't required.
  return (o.version === 3 || o.version === undefined)
      && Array.isArray(o.assets)
      && Array.isArray(o.phases)
      && Array.isArray(o.costs);
}

// ── M1.5 + M1.7 hierarchy enrichment ───────────────────────────────────────
// A v3 snapshot from before M1.5 will be missing masterHolding /
// subProjects / subUnits. A v3/v4 snapshot from before M1.7 will be
// missing plots / zones. enrichWithHierarchyDefaults pads all of these
// in place so the downstream HydrateSnapshot consumer sees a complete
// shape. This preserves the M1.R "storage stays at v2 on disk"
// decision: we never bumped the wrapper version, but if some future
// code path produced a bare snapshot, it still loads cleanly.
export function enrichWithHierarchyDefaults(snapshot: HydrateSnapshot): HydrateSnapshot {
  // The narrowed cast lets us check fields TS already considers
  // present; the runtime branch is only hit when an older payload
  // was de-serialized through `as HydrateSnapshot` without actually
  // carrying the M1.5 / M1.7 / M1.8 fields.
  const s = snapshot as Partial<HydrateSnapshot> & HydrateSnapshot;
  return {
    ...s,
    masterHolding: s.masterHolding ?? makeDefaultMasterHolding(),
    subProjects:   s.subProjects   ?? [makeDefaultSubProject(s.projectName, s.currency)],
    subUnits:      s.subUnits      ?? [],
    plots:         s.plots         ?? [],
    zones:         s.zones         ?? [],
    // M1.8: pre-M1.8 snapshots lack `hierarchyDisclosure`. Default them
    // to 'manual' so the Hierarchy tab keeps the legacy show-all-layers
    // behavior. Wizard-created projects ship 'progressive' explicitly.
    // Always emit a value (rather than leaving undefined) so subsequent
    // store hydrations don't carry over a previous project's value.
    hierarchyDisclosure: s.hierarchyDisclosure ?? 'manual',
  };
}

// ── Forward migration: legacy v2 -> new v3 ─────────────────────────────────
// Lossless for the 3 canonical assets. The 3 legacy show flags are
// derived from the legacy projectType + retailPercent semantics that
// RealEstatePlatform.tsx applied at runtime.
export function migrateLegacyToNew(legacy: LegacyV2Snapshot): NewV3Snapshot {
  const showResidential = legacy.projectType === 'residential' || legacy.projectType === 'mixed-use';
  const showHospitality = legacy.projectType === 'hospitality' || legacy.projectType === 'mixed-use';
  const showRetail      = legacy.retailPercent > 0;

  const assets: AssetClass[] = [
    {
      ...DEFAULT_LEGACY_ASSETS[0],
      allocationPct:  legacy.residentialPercent,
      deductPct:      legacy.residentialDeductPct,
      efficiencyPct:  legacy.residentialEfficiency,
      visible:        showResidential,
    },
    {
      ...DEFAULT_LEGACY_ASSETS[1],
      allocationPct:  legacy.hospitalityPercent,
      deductPct:      legacy.hospitalityDeductPct,
      efficiencyPct:  legacy.hospitalityEfficiency,
      visible:        showHospitality,
    },
    {
      ...DEFAULT_LEGACY_ASSETS[2],
      allocationPct:  legacy.retailPercent,
      deductPct:      legacy.retailDeductPct,
      efficiencyPct:  legacy.retailEfficiency,
      visible:        showRetail,
    },
  ];

  const phases: Phase[] = [
    makeDefaultPhase(DEFAULT_SUB_PROJECT_ID, legacy.constructionPeriods, legacy.operationsPeriods, legacy.overlapPeriods),
  ];

  const costs: CostLine[] = [
    ...legacy.residentialCosts.map(c => ({ ...c, assetId: LEGACY_ASSET_IDS.residential })),
    ...legacy.hospitalityCosts.map(c => ({ ...c, assetId: LEGACY_ASSET_IDS.hospitality })),
    ...legacy.retailCosts.map(c => ({ ...c, assetId: LEGACY_ASSET_IDS.retail })),
  ];

  return {
    version: 3,
    savedAt: legacy.savedAt,

    projectName:        legacy.projectName,
    projectType:        legacy.projectType,
    country:            legacy.country,
    currency:           legacy.currency,
    modelType:          legacy.modelType,
    projectStart:       legacy.projectStart,

    // M1.5 hierarchy fields. Legacy v2 had no concept of these, so we
    // wrap the project in a single sub-project (named after the
    // project) and seed an empty MH (disabled). Sub-units start
    // empty; users add inventory via the new Hierarchy tab.
    masterHolding: makeDefaultMasterHolding(),
    subProjects:   [makeDefaultSubProject(legacy.projectName, legacy.currency)],
    subUnits:      [],

    // M1.7 area-program fields. Legacy v2 had no concept of plots /
    // zones either, so they start empty; users add their first plot
    // via the new Area Program tab.
    plots: [],
    zones: [],

    phases,

    landParcels:           legacy.landParcels,
    projectRoadsPct:       legacy.projectRoadsPct,
    projectFAR:            legacy.projectFAR,
    projectNonEnclosedPct: legacy.projectNonEnclosedPct ?? 0,

    assets,
    costs,
    costInputMode:  legacy.costInputMode,
    nextCostId:     legacy.nextCostId,

    costStage:       legacy.costStage      ?? {},
    costScope:       legacy.costScope      ?? {},
    costDevFeeMode:  legacy.costDevFeeMode ?? {},
    allocBasis:      legacy.allocBasis     ?? 'direct_cost',

    interestRate:        legacy.interestRate,
    financingMode:       legacy.financingMode,
    globalDebtPct:       legacy.globalDebtPct,
    capitalizeInterest:  legacy.capitalizeInterest,
    repaymentPeriods:    legacy.repaymentPeriods,
    repaymentMethod:     legacy.repaymentMethod,
    lineRatios:          legacy.lineRatios,
  };
}

// ── Reverse adapter: new v3/v4 -> legacy v2 ───────────────────────────────
// Used while on-disk storage stays at v2 (per Ahmad's M1.R / M1.5
// scoping: storage v3+ bump deferred to M1.6 alongside Supabase
// migration). Anything in the in-memory shape that v2 cannot
// represent gets dropped here, with a warn-once-per-session surface
// so the user notices the data is about to lose fidelity.
let warnedAboutDroppedV4 = false;

export function toLegacySnapshot(s: HydrateSnapshot): LegacyV2Snapshot {
  const findAsset = (id: string): AssetClass =>
    s.assets.find(a => a.id === id) ?? {
      ...DEFAULT_LEGACY_ASSETS.find(a => a.id === id)!,
      visible: false,
    };
  const res  = findAsset(LEGACY_ASSET_IDS.residential);
  const hosp = findAsset(LEGACY_ASSET_IDS.hospitality);
  const ret  = findAsset(LEGACY_ASSET_IDS.retail);

  // Build a single warn message covering every v4 feature that v2
  // storage cannot represent: custom assets, Master Holding when
  // enabled, multi-sub-project layouts, sub-units. Fires at most once
  // per browser session (the latch resets only via the test-only
  // helper at file end).
  const customAssets        = s.assets.filter(a => !(Object.values(LEGACY_ASSET_IDS) as string[]).includes(a.id));
  const masterHoldingActive = (s.masterHolding as { enabled?: boolean } | undefined)?.enabled === true;
  const multiSubProject     = (s.subProjects ?? []).length > 1;
  const hasSubUnits         = (s.subUnits ?? []).length > 0;

  if (!warnedAboutDroppedV4 && (customAssets.length > 0 || masterHoldingActive || multiSubProject || hasSubUnits)) {
    warnedAboutDroppedV4 = true;
    if (typeof console !== 'undefined') {
      const reasons: string[] = [];
      if (customAssets.length > 0) reasons.push(`custom asset(s) [${customAssets.map(a => a.id).join(', ')}]`);
      if (masterHoldingActive)     reasons.push('Master Holding (enabled)');
      if (multiSubProject)         reasons.push(`${s.subProjects.length} sub-projects`);
      if (hasSubUnits)             reasons.push(`${s.subUnits.length} sub-unit(s)`);
      console.warn(
        `[REFM] The following v4 hierarchy data is not preserved by legacy v2 storage and will be ` +
        `dropped from this saved version: ${reasons.join(', ')}. ` +
        `Storage v3+ (which preserves them) is scheduled for M1.6 alongside Supabase migration.`
      );
    }
  }

  const phase = s.phases[0] ?? makeDefaultPhase(DEFAULT_SUB_PROJECT_ID, 0, 0, 0);

  const stripAssetId = (c: CostLine): CostItem => {
    const out: Partial<CostLine> = { ...c };
    delete out.assetId;
    delete out.phaseId;
    return out as CostItem;
  };

  const residentialCosts = s.costs.filter(c => c.assetId === LEGACY_ASSET_IDS.residential).map(stripAssetId);
  const hospitalityCosts = s.costs.filter(c => c.assetId === LEGACY_ASSET_IDS.hospitality).map(stripAssetId);
  const retailCosts      = s.costs.filter(c => c.assetId === LEGACY_ASSET_IDS.retail).map(stripAssetId);

  return {
    version: 2,

    projectName:        s.projectName,
    projectType:        s.projectType,
    country:            s.country,
    currency:           s.currency,
    modelType:          s.modelType,
    projectStart:       s.projectStart,
    constructionPeriods: phase.constructionPeriods,
    operationsPeriods:   phase.operationsPeriods,
    overlapPeriods:      phase.overlapPeriods,

    landParcels:           s.landParcels,
    projectRoadsPct:       s.projectRoadsPct,
    projectFAR:            s.projectFAR,
    projectNonEnclosedPct: s.projectNonEnclosedPct,

    residentialPercent:  res.allocationPct,
    hospitalityPercent:  hosp.allocationPct,
    retailPercent:       ret.allocationPct,

    residentialDeductPct:  res.deductPct,
    residentialEfficiency: res.efficiencyPct,
    hospitalityDeductPct:  hosp.deductPct,
    hospitalityEfficiency: hosp.efficiencyPct,
    retailDeductPct:       ret.deductPct,
    retailEfficiency:      ret.efficiencyPct,

    residentialCosts,
    hospitalityCosts,
    retailCosts,
    costInputMode:  s.costInputMode,
    nextCostId:     s.nextCostId,

    costStage:       s.costStage,
    costScope:       s.costScope,
    costDevFeeMode:  s.costDevFeeMode,
    allocBasis:      s.allocBasis,

    interestRate:       s.interestRate,
    financingMode:      s.financingMode,
    globalDebtPct:      s.globalDebtPct,
    capitalizeInterest: s.capitalizeInterest,
    repaymentPeriods:   s.repaymentPeriods,
    repaymentMethod:    s.repaymentMethod,
    lineRatios:         s.lineRatios,
  };
}

// ── Top-level entry: any-shape snapshot -> new v3 hydration payload ────────
const stripVersionAndSavedAt = (s: NewV3Snapshot): HydrateSnapshot => {
  const out: Partial<NewV3Snapshot> = { ...s };
  delete out.version;
  delete out.savedAt;
  return out as HydrateSnapshot;
};

export function hydrationFromAnySnapshot(snapshot: unknown): HydrateSnapshot {
  return hydrationFromAnySnapshotChecked(snapshot).snapshot;
}

// Recognition-aware variant. Same fall-back-to-defaults policy as the
// classic helper above (unrecognized data does not brick the app), but
// returns whether the input shape was actually recognized so callers
// like the M1.6 migrator can surface "we substituted defaults"
// warnings to the user instead of leaving them only in DevTools.
//
// `recognized: false` means the snapshot was neither v2 nor v3 shape
// AND `.snapshot` is DEFAULT_MODULE1_STATE — any fields the user had
// in the unrecognized blob are LOST. The migrator pushes a message to
// `result.errors[]` in that case so the post-migration toast tells
// the user which version of which project lost data.
export interface CheckedHydration {
  snapshot:   HydrateSnapshot;
  recognized: boolean;
}
export function hydrationFromAnySnapshotChecked(snapshot: unknown): CheckedHydration {
  if (isNewV3(snapshot)) {
    // A v3 snapshot from before M1.5 may be missing masterHolding /
    // subProjects / subUnits; enrich before returning so the store
    // hydrate always sees a complete v4-shaped payload.
    return {
      snapshot: enrichWithHierarchyDefaults(stripVersionAndSavedAt(snapshot)),
      recognized: true,
    };
  }
  if (isLegacyV2(snapshot)) {
    return {
      snapshot: enrichWithHierarchyDefaults(stripVersionAndSavedAt(migrateLegacyToNew(snapshot))),
      recognized: true,
    };
  }
  // Unrecognized shape: console.warn is preserved for parity with
  // pre-M1.6/7 callers, but the boolean is the real signal — wrap
  // callers should branch on it.
  if (typeof console !== 'undefined') {
    console.warn('[REFM] Unrecognized snapshot shape; falling back to defaults.');
  }
  return { snapshot: { ...DEFAULT_MODULE1_STATE }, recognized: false };
}

// ── Test-only: reset the warn-once latch so unit tests can re-trigger it ──
export function _resetWarnedAboutDroppedAssetsForTests(): void {
  warnedAboutDroppedV4 = false;
}
