/**
 * Module 1 — pure calculation pipeline for regression-guard snapshots.
 *
 * Loads a fixture-shaped state and reproduces every output Module 1 derives
 * from it: land aggregates, area hierarchy, per-asset areas, per-asset cost
 * item totals, per-asset cost distributions per period, per-asset financing
 * schedules (debt + equity drawdowns, interest, repayments, balances), and
 * project-level summary totals.
 *
 * ─── Math source mapping (post Phase M1.R/3) ───
 *
 *   calculateLandAggregates   → @core/calculations  (pure export, exact)
 *   calculateAreaHierarchy    → @core/calculations  (pure export, exact)
 *   getAreas                  → @core/calculations  (pure export, exact)
 *   calculateItemTotal        → @core/calculations  (pure export, exact)
 *   distributeCost            → @core/calculations  (pure export, exact)
 *   buildAssetFinancing       → @core/calculations  (pure export, exact)
 *
 * The previous "lockstep contract" between RealEstatePlatform.tsx's
 * useCallback closure and an inlined copy of buildAssetFinancing in this
 * file no longer exists: Phase M1.R/3 lifted the function into
 * @core/calculations so the React component, the snapshot pipeline, and
 * any future consumer (Excel formula export, M11 dashboard) all import
 * from a single source of truth.
 *
 * ─── M1.5/4: v4 hierarchy on the read path ───
 *
 * The fixture file on disk is still legacy v2 (3 hardcoded asset arrays
 * + scalar per-asset metrics). M1.5/4 routes that v2 payload through
 * `hydrationFromAnySnapshot` so the pipeline runs against the same v4
 * `HydrateSnapshot` shape the React store consumes in production. The
 * canonical 3-asset / single-phase fixture round-trips bit-identical
 * because:
 *   - the migrator preserves cost line ids and concatenation order,
 *   - it preserves the 3 canonical asset ids (residential / hospitality
 *     / retail) with their allocation / deduct / efficiency scalars,
 *   - we iterate visible canonical assets in the same residential →
 *     hospitality → retail order,
 *   - phase[0] supplies the legacy
 *     constructionPeriods/operationsPeriods/overlapPeriods scalars
 *     unchanged.
 *
 * Multi-phase iteration is intentionally stubbed: when the v4 snapshot
 * contains more than one Phase, the pipeline throws so the silent-wrong-
 * output trap stays visible until the M1.5/12 multi-phase fixture +
 * baseline land.
 */

import { readFileSync } from 'node:fs';
import {
  calculateLandAggregates,
  calculateAreaHierarchy,
  getAreas,
  calculateItemTotal,
  distributeCost,
  buildAssetFinancing,
} from '@core/calculations';
import type {
  CostItem,
  AreaMetrics,
  CostInputMode,
  ModelType,
  FinancingMode,
  RepaymentMethod,
  LandParcel,
  FinancingResult,
  ProjectType,
} from '@core/types/project.types';
import {
  hydrationFromAnySnapshot,
  type LegacyV2Snapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { LEGACY_ASSET_IDS } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

// ── Fixture shape ────────────────────────────────────────────────────────────
// Mirrors the on-disk fixture (`tests/fixtures/module1-reference.json`),
// which is still the legacy v2 shape. The pipeline immediately lifts
// this into the v4 HydrateSnapshot via the production migrator so all
// downstream calc reads from the same shape the React store sees.
export interface Module1Input {
  projectName: string;
  projectType: string;
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
  projectNonEnclosedPct: number;

  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;

  residentialDeductPct: number;
  residentialEfficiency: number;
  hospitalityDeductPct: number;
  hospitalityEfficiency: number;
  retailDeductPct: number;
  retailEfficiency: number;

  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;

  costInputMode: CostInputMode;
  nextCostId: number;
  residentialCosts: CostItem[];
  hospitalityCosts: CostItem[];
  retailCosts: CostItem[];

  interestRate: number;
  financingMode: FinancingMode;
  globalDebtPct: number;
  capitalizeInterest: boolean;
  repaymentPeriods: number;
  repaymentMethod: RepaymentMethod;
  lineRatios: Record<string, number>;
}

// ── Snapshot shape ───────────────────────────────────────────────────────────
type AssetKey = 'residential' | 'hospitality' | 'retail';

// Re-export the canonical FinancingResult under the historical name so
// any downstream consumer of this module stays source-compatible.
export type FinancingSnapshot = FinancingResult;

export interface AssetSnapshot {
  areas: AreaMetrics;
  costItemTotals: { name: string; total: number }[];
  costDistributions: { name: string; dist: number[] }[];
  financing: FinancingSnapshot;
}

export interface Module1Snapshot {
  fixtureLabel: string;
  landAggregates: ReturnType<typeof calculateLandAggregates>;
  areaHierarchy: ReturnType<typeof calculateAreaHierarchy>;
  perAsset: {
    residential: AssetSnapshot | null;
    hospitality: AssetSnapshot | null;
    retail: AssetSnapshot | null;
  };
  summary: {
    totalCapex: number;
    totalDebt: number;
    totalEquity: number;
    totalInterest: number;
    totalPeriods: number;
  };
}


// ── Fixture loader ───────────────────────────────────────────────────────────
export function loadFixture(path: string): Module1Input {
  const raw = readFileSync(path, 'utf-8');
  const obj = JSON.parse(raw) as Module1Input;
  return obj;
}

// ── Pipeline runner ──────────────────────────────────────────────────────────
export function runPipeline(input: Module1Input): Module1Snapshot {
  // 1. Lift the v2 fixture into the v4 HydrateSnapshot shape via the
  //    same path the React store uses in production. This is the SUT
  //    for "how does a saved project become live store state" — the
  //    snapshot pipeline must exercise it so a regression in either
  //    the migrator or the calc engine surfaces here.
  const legacyV2: LegacyV2Snapshot = {
    version:               2,
    projectName:           input.projectName,
    projectType:           input.projectType as ProjectType,
    country:               input.country,
    currency:              input.currency,
    modelType:             input.modelType,
    projectStart:          input.projectStart,
    constructionPeriods:   input.constructionPeriods,
    operationsPeriods:     input.operationsPeriods,
    overlapPeriods:        input.overlapPeriods,
    landParcels:           input.landParcels,
    projectRoadsPct:       input.projectRoadsPct,
    projectFAR:            input.projectFAR,
    projectNonEnclosedPct: input.projectNonEnclosedPct,
    residentialPercent:    input.residentialPercent,
    hospitalityPercent:    input.hospitalityPercent,
    retailPercent:         input.retailPercent,
    residentialDeductPct:  input.residentialDeductPct,
    residentialEfficiency: input.residentialEfficiency,
    hospitalityDeductPct:  input.hospitalityDeductPct,
    hospitalityEfficiency: input.hospitalityEfficiency,
    retailDeductPct:       input.retailDeductPct,
    retailEfficiency:      input.retailEfficiency,
    residentialCosts:      input.residentialCosts,
    hospitalityCosts:      input.hospitalityCosts,
    retailCosts:           input.retailCosts,
    costInputMode:         input.costInputMode,
    nextCostId:            input.nextCostId,
    interestRate:          input.interestRate,
    financingMode:         input.financingMode,
    globalDebtPct:         input.globalDebtPct,
    capitalizeInterest:    input.capitalizeInterest,
    repaymentPeriods:      input.repaymentPeriods,
    repaymentMethod:       input.repaymentMethod,
    lineRatios:            input.lineRatios,
  };
  const v4 = hydrationFromAnySnapshot(legacyV2);

  // 2. Multi-phase guard. The legacy fixture must collapse to exactly
  //    one Phase (the migrator emits one). Multi-phase aggregation is
  //    intentionally not built yet — it lands in M1.5/12 alongside the
  //    multi-phase fixture and a separate baseline. Throwing here keeps
  //    accidental wiring from silently producing wrong totals.
  if (v4.phases.length !== 1) {
    throw new Error(
      `Module1 pipeline: multi-phase aggregation is stubbed (got ${v4.phases.length} phases). ` +
      `M1.5/12 will introduce the multi-phase fixture + per-phase rollup logic.`,
    );
  }
  const phase = v4.phases[0];

  // 3. Look up the 3 canonical assets from the v4 shape. The migrator
  //    always emits them in residential / hospitality / retail order,
  //    but we look them up by id so a future fixture that reorders the
  //    visible flag still produces a stable per-asset snapshot.
  const findAsset = (id: string) => {
    const a = v4.assets.find(x => x.id === id);
    if (!a) throw new Error(`Module1 pipeline: migrated v4 snapshot missing canonical asset id "${id}"`);
    return a;
  };
  const resAsset  = findAsset(LEGACY_ASSET_IDS.residential);
  const hospAsset = findAsset(LEGACY_ASSET_IDS.hospitality);
  const retAsset  = findAsset(LEGACY_ASSET_IDS.retail);

  // 4. Land + area hierarchy. All scalars come from the v4 store
  //    (sub-project-level after M1.5; project-level pre-M1.5 — the
  //    migrator carries them forward 1:1).
  const land = calculateLandAggregates(v4.landParcels);

  const hierarchy = calculateAreaHierarchy({
    totalLandArea:        land.totalLandArea,
    landValuePerSqm:      land.landValuePerSqm,
    cashPercent:          land.cashPercent,
    inKindPercent:        land.inKindPercent,
    projectRoadsPct:      v4.projectRoadsPct,
    projectFAR:           v4.projectFAR,
    projectNonEnclosedPct: v4.projectNonEnclosedPct,
    residentialPercent:   resAsset.allocationPct,
    hospitalityPercent:   hospAsset.allocationPct,
    retailPercent:        retAsset.allocationPct,
    residentialDeductPct: resAsset.deductPct,
    residentialEfficiency: resAsset.efficiencyPct,
    hospitalityDeductPct: hospAsset.deductPct,
    hospitalityEfficiency: hospAsset.efficiencyPct,
    retailDeductPct:      retAsset.deductPct,
    retailEfficiency:     retAsset.efficiencyPct,
    showResidential:      resAsset.visible,
    showHospitality:      hospAsset.visible,
    showRetail:           retAsset.visible,
  });

  const assetPercents: Record<string, number> = {
    residential: resAsset.allocationPct,
    hospitality: hospAsset.allocationPct,
    retail:      retAsset.allocationPct,
  };
  const showFlags: Record<string, boolean> = {
    residential: resAsset.visible,
    hospitality: hospAsset.visible,
    retail:      retAsset.visible,
  };

  // Per-asset cost lookup against the flat v4 costs[] keyed by assetId.
  // Array.filter preserves order, and the migrator concatenates the
  // three legacy arrays in residential / hospitality / retail order, so
  // each asset's CostItem[] equals the original {asset}Costs array.
  // The CostLine -> CostItem assignment is structural (CostLine extends
  // CostItem with optional assetId/phaseId/subProjectId); the calc
  // helpers ignore the extra fields.
  const costsFor = (assetId: string): CostItem[] =>
    v4.costs.filter(c => c.assetId === assetId);

  const buildAssetSnapshot = (assetType: AssetKey, costs: CostItem[]): AssetSnapshot => {
    const areas = getAreas(assetType, {
      hierarchy,
      landAggregates:     land,
      residentialPercent: resAsset.allocationPct,
      hospitalityPercent: hospAsset.allocationPct,
      retailPercent:      retAsset.allocationPct,
      projectNDA:         hierarchy.projectNDA,
    });

    const costItemTotals = costs.map(c => ({
      name:  c.name,
      total: calculateItemTotal(c, assetType, areas, costs, v4.costInputMode, assetPercents, showFlags),
    }));

    const costDistributions = costs.map(c => ({
      name: c.name,
      dist: distributeCost(c, assetType, phase.constructionPeriods, areas, costs, v4.costInputMode, assetPercents, showFlags),
    }));

    const financing = buildAssetFinancing({
      assetType,
      areas,
      costs,
      constructionPeriods: phase.constructionPeriods,
      operationsPeriods:   phase.operationsPeriods,
      interestRate:        v4.interestRate,
      modelType:           v4.modelType,
      repaymentPeriods:    v4.repaymentPeriods,
      capitalizeInterest:  v4.capitalizeInterest,
      costInputMode:       v4.costInputMode,
      financingMode:       v4.financingMode,
      globalDebtPct:       v4.globalDebtPct,
      lineRatios:          v4.lineRatios,
      assetPercents,
      showFlags,
    });

    return { areas, costItemTotals, costDistributions, financing };
  };

  const perAsset = {
    residential: resAsset.visible  ? buildAssetSnapshot('residential', costsFor(LEGACY_ASSET_IDS.residential)) : null,
    hospitality: hospAsset.visible ? buildAssetSnapshot('hospitality', costsFor(LEGACY_ASSET_IDS.hospitality)) : null,
    retail:      retAsset.visible  ? buildAssetSnapshot('retail',      costsFor(LEGACY_ASSET_IDS.retail))      : null,
  };

  const sumAssetTotals = (key: 'totalDebt' | 'totalEquity' | 'totalInterest') =>
    (perAsset.residential?.financing[key] ?? 0) +
    (perAsset.hospitality?.financing[key] ?? 0) +
    (perAsset.retail?.financing[key]      ?? 0);

  const totalDebt     = sumAssetTotals('totalDebt');
  const totalEquity   = sumAssetTotals('totalEquity');
  const totalInterest = sumAssetTotals('totalInterest');
  const totalCapex    = totalDebt + totalEquity;
  const totalPeriods  = phase.constructionPeriods + phase.operationsPeriods;

  return {
    fixtureLabel: v4.projectName,
    landAggregates: land,
    areaHierarchy:  hierarchy,
    perAsset,
    summary: { totalCapex, totalDebt, totalEquity, totalInterest, totalPeriods },
  };
}
