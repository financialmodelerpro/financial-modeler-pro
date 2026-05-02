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
  makeDefaultPhase,
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
  return o.version === 3 && Array.isArray(o.assets) && Array.isArray(o.phases) && Array.isArray(o.costs);
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
    makeDefaultPhase(legacy.constructionPeriods, legacy.operationsPeriods, legacy.overlapPeriods),
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

// ── Reverse adapter: new v3 -> legacy v2 ───────────────────────────────────
// Used while on-disk storage stays at v2. Custom assets (any id outside
// the 3 canonical legacy ids) are dropped with a one-time console warn so
// the user notices when their data is about to lose fidelity.
let warnedAboutDroppedAssets = false;

export function toLegacySnapshot(s: HydrateSnapshot): LegacyV2Snapshot {
  const findAsset = (id: string): AssetClass =>
    s.assets.find(a => a.id === id) ?? {
      ...DEFAULT_LEGACY_ASSETS.find(a => a.id === id)!,
      visible: false,
    };
  const res  = findAsset(LEGACY_ASSET_IDS.residential);
  const hosp = findAsset(LEGACY_ASSET_IDS.hospitality);
  const ret  = findAsset(LEGACY_ASSET_IDS.retail);

  // Surface the lossy case the first time it happens in a session so the
  // user does not silently lose configured custom assets.
  const customAssets = s.assets.filter(a => !(Object.values(LEGACY_ASSET_IDS) as string[]).includes(a.id));
  if (customAssets.length > 0 && !warnedAboutDroppedAssets) {
    warnedAboutDroppedAssets = true;
    if (typeof console !== 'undefined') {
      console.warn(
        `[REFM] Custom asset(s) [${customAssets.map(a => a.id).join(', ')}] not yet supported by ` +
        `legacy v2 storage; they are not included in this saved version. ` +
        `Storage v3 (which preserves them) lands in a future phase.`
      );
    }
  }

  const phase = s.phases[0] ?? makeDefaultPhase(0, 0, 0);

  const stripAssetId = (c: CostLine): CostItem => {
    const { assetId: _assetId, phaseId: _phaseId, ...rest } = c;
    return rest;
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
export function hydrationFromAnySnapshot(snapshot: unknown): HydrateSnapshot {
  if (isNewV3(snapshot)) {
    const { version: _v, savedAt: _s, ...rest } = snapshot;
    return rest;
  }
  if (isLegacyV2(snapshot)) {
    const v3 = migrateLegacyToNew(snapshot);
    const { version: _v, savedAt: _s, ...rest } = v3;
    return rest;
  }
  // Unrecognized shape: fall back to defaults rather than throw, so a
  // hand-edited or corrupted localStorage entry does not brick the app.
  if (typeof console !== 'undefined') {
    console.warn('[REFM] Unrecognized snapshot shape; falling back to defaults.');
  }
  return { ...DEFAULT_MODULE1_STATE };
}

// ── Test-only: reset the warn-once latch so unit tests can re-trigger it ──
export function _resetWarnedAboutDroppedAssetsForTests(): void {
  warnedAboutDroppedAssets = false;
}
