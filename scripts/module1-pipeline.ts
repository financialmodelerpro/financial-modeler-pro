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
  computePlotEnvelope,
  computeAreaCascade,
  computePlotParkingCapacity,
  allocateParking,
  type PlotEnvelopeAreas,
  type AreaCascadeResult,
  type PlotCapacityResult,
  type ParkingAllocationResult,
} from '@core/calculations';
import {
  resolveAssetStrategy,
  resolveAssetCascadePcts,
  resolveSubUnitParkingBays,
  type AssetStrategy,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
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
import type { HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

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

  // 2. Single-phase guard. runPipeline is the legacy bit-identical
  //    path: the fixture collapses to exactly one phase. Multi-phase
  //    snapshots use runMultiPhasePipeline (added in M1.5/12) so the
  //    legacy baseline and multi-phase baseline stay in their own
  //    files and can each evolve at their own pace.
  if (v4.phases.length !== 1) {
    throw new Error(
      `Module1 pipeline (single-phase path): expected 1 phase, got ${v4.phases.length}. ` +
      `Use runMultiPhasePipeline for multi-phase fixtures.`,
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

// ── Multi-phase pipeline (Phase M1.5/12) ─────────────────────────────────────
// Operates on the v4 HydrateSnapshot directly (no v2 round-trip) so the
// fixture file can carry phases[].length > 1 explicitly. For each phase
// the pipeline iterates the assets bound to it (assets where
// asset.phaseId === phase.id) and runs the same per-asset calc as the
// single-phase path:
//
//   - Land aggregates + area hierarchy stay PROJECT-level (one
//     calculation). The legacy assetType-keyed area math
//     (residential/hospitality/retail) means area allocation percents
//     are project-wide regardless of which phase an asset lives in.
//   - costsFor(phase, assetId) filters to that phase's own cost lines:
//     either explicitly (cost.phaseId === phase.id) or implicitly
//     (cost.phaseId undefined = global to the sub-project, attributed
//     to whichever phase its asset lives in).
//   - Per-phase totals roll into a project-level summary.
//
// Multi-phase math correctness for non-canonical asset shapes is out of
// scope for M1.5; this commit ships the structural baseline so the
// regression-guard catches future calc-engine drift.

export interface MultiPhasePhaseSnapshot {
  phaseId: string;
  phaseName: string;
  subProjectId: string;
  constructionStart: number;
  constructionPeriods: number;
  operationsStart: number;
  operationsPeriods: number;
  overlapPeriods: number;
  // Per-asset entries are keyed by canonical legacy id so the JSON
  // shape stays stable even when phases gain / lose assets.
  perAsset: {
    residential: AssetSnapshot | null;
    hospitality: AssetSnapshot | null;
    retail:      AssetSnapshot | null;
  };
  summary: {
    totalCapex: number;
    totalDebt: number;
    totalEquity: number;
    totalInterest: number;
    totalPeriods: number;
  };
}

export interface MultiPhaseSnapshot {
  fixtureLabel: string;
  landAggregates: ReturnType<typeof calculateLandAggregates>;
  areaHierarchy: ReturnType<typeof calculateAreaHierarchy>;
  perPhase: MultiPhasePhaseSnapshot[];
  summary: {
    totalCapex: number;
    totalDebt: number;
    totalEquity: number;
    totalInterest: number;
    totalPhases: number;
  };
}

// Loader for the v4 fixture format (HydrateSnapshot serialized to JSON).
export function loadV4Fixture(path: string): HydrateSnapshot {
  const raw = readFileSync(path, 'utf-8');
  const obj = JSON.parse(raw) as Record<string, unknown>;
  // Strip any documentation field the fixture carries (mirrors the
  // legacy fixture's _comment passthrough).
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    cleaned[k] = v;
  }
  return cleaned as unknown as HydrateSnapshot;
}

export function runMultiPhasePipeline(v4: HydrateSnapshot): MultiPhaseSnapshot {
  // Project-level land + area hierarchy. Same calculation as the
  // single-phase path; legacy assetType-driven area math means these
  // stay project-wide.
  const land = calculateLandAggregates(v4.landParcels);

  const findAsset = (id: string) => v4.assets.find(a => a.id === id);
  const resAsset  = findAsset(LEGACY_ASSET_IDS.residential);
  const hospAsset = findAsset(LEGACY_ASSET_IDS.hospitality);
  const retAsset  = findAsset(LEGACY_ASSET_IDS.retail);

  // The legacy area helpers require all three canonical-asset percents;
  // a missing asset reads as 0% allocation / 0 visible.
  const residentialPercent  = resAsset?.allocationPct  ?? 0;
  const hospitalityPercent  = hospAsset?.allocationPct ?? 0;
  const retailPercent       = retAsset?.allocationPct  ?? 0;
  const residentialDeductPct  = resAsset?.deductPct     ?? 0;
  const residentialEfficiency = resAsset?.efficiencyPct ?? 0;
  const hospitalityDeductPct  = hospAsset?.deductPct    ?? 0;
  const hospitalityEfficiency = hospAsset?.efficiencyPct ?? 0;
  const retailDeductPct       = retAsset?.deductPct     ?? 0;
  const retailEfficiency      = retAsset?.efficiencyPct ?? 0;
  const showResidential = !!resAsset?.visible;
  const showHospitality = !!hospAsset?.visible;
  const showRetail      = !!retAsset?.visible;

  const hierarchy = calculateAreaHierarchy({
    totalLandArea:        land.totalLandArea,
    landValuePerSqm:      land.landValuePerSqm,
    cashPercent:          land.cashPercent,
    inKindPercent:        land.inKindPercent,
    projectRoadsPct:      v4.projectRoadsPct,
    projectFAR:           v4.projectFAR,
    projectNonEnclosedPct: v4.projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency,
    hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    showResidential, showHospitality, showRetail,
  });

  const assetPercents: Record<string, number> = { residential: residentialPercent, hospitality: hospitalityPercent, retail: retailPercent };
  const showFlags: Record<string, boolean> = { residential: showResidential, hospitality: showHospitality, retail: showRetail };

  // Per-phase iteration. Phases are emitted in store order so the
  // baseline is stable regardless of how the fixture happens to list
  // them.
  const perPhase: MultiPhasePhaseSnapshot[] = v4.phases.map(phase => {
    // Costs attributable to this phase: phase-specific cost lines (whose
    // phaseId matches), plus sub-project-global cost lines (phaseId
    // undefined) inherited by every phase under that sub-project.
    const phaseCostsForAsset = (assetId: string): CostItem[] => {
      const asset = findAsset(assetId);
      if (!asset || asset.phaseId !== phase.id) return [];
      return v4.costs.filter(c =>
        c.assetId === assetId &&
        (c.phaseId === undefined || c.phaseId === phase.id),
      );
    };

    const buildAssetSnapshot = (assetType: AssetKey, costs: CostItem[]): AssetSnapshot => {
      const areas = getAreas(assetType, {
        hierarchy,
        landAggregates:     land,
        residentialPercent, hospitalityPercent, retailPercent,
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

    // An asset contributes to a phase if it is bound to it AND visible.
    const resCosts  = phaseCostsForAsset(LEGACY_ASSET_IDS.residential);
    const hospCosts = phaseCostsForAsset(LEGACY_ASSET_IDS.hospitality);
    const retCosts  = phaseCostsForAsset(LEGACY_ASSET_IDS.retail);

    const phasePerAsset = {
      residential: (showResidential && resAsset?.phaseId  === phase.id) ? buildAssetSnapshot('residential', resCosts)  : null,
      hospitality: (showHospitality && hospAsset?.phaseId === phase.id) ? buildAssetSnapshot('hospitality', hospCosts) : null,
      retail:      (showRetail      && retAsset?.phaseId  === phase.id) ? buildAssetSnapshot('retail',      retCosts)  : null,
    };

    const sumAssetTotals = (key: 'totalDebt' | 'totalEquity' | 'totalInterest') =>
      (phasePerAsset.residential?.financing[key] ?? 0) +
      (phasePerAsset.hospitality?.financing[key] ?? 0) +
      (phasePerAsset.retail?.financing[key]      ?? 0);

    const totalDebt     = sumAssetTotals('totalDebt');
    const totalEquity   = sumAssetTotals('totalEquity');
    const totalInterest = sumAssetTotals('totalInterest');

    return {
      phaseId:             phase.id,
      phaseName:           phase.name,
      subProjectId:        phase.subProjectId,
      constructionStart:   phase.constructionStart,
      constructionPeriods: phase.constructionPeriods,
      operationsStart:     phase.operationsStart,
      operationsPeriods:   phase.operationsPeriods,
      overlapPeriods:      phase.overlapPeriods,
      perAsset:            phasePerAsset,
      summary: {
        totalCapex:    totalDebt + totalEquity,
        totalDebt,
        totalEquity,
        totalInterest,
        totalPeriods:  phase.constructionPeriods + phase.operationsPeriods,
      },
    };
  });

  // Project-level rollup: sum across phases.
  const projectTotalDebt     = perPhase.reduce((s, p) => s + p.summary.totalDebt,     0);
  const projectTotalEquity   = perPhase.reduce((s, p) => s + p.summary.totalEquity,   0);
  const projectTotalInterest = perPhase.reduce((s, p) => s + p.summary.totalInterest, 0);

  return {
    fixtureLabel:   v4.projectName,
    landAggregates: land,
    areaHierarchy:  hierarchy,
    perPhase,
    summary: {
      totalCapex:    projectTotalDebt + projectTotalEquity,
      totalDebt:     projectTotalDebt,
      totalEquity:   projectTotalEquity,
      totalInterest: projectTotalInterest,
      totalPhases:   perPhase.length,
    },
  };
}

// ── Area-program pipeline (Phase M1.7/4) ────────────────────────────────────
// Operates on a v4 HydrateSnapshot that carries plots[] / zones[] with
// assets bound to specific plots via plotId. For each plot the pipeline
// runs the M1.7/2 calc engines:
//
//   1. computePlotEnvelope(plot)              -> derived areas
//   2. for each asset.plotId === plot.id:
//        - GFA share = gfaOverrideSqm OR pro-rata allocationPct of
//          the plot's totalBuiltGFA across other plot assets
//        - basementShare placeholder (pro-rata of plot
//          basementUsableArea by GFA share — filled in after parking)
//        - computeAreaCascade(...) -> { mep, BoH, otherTech, gsaGla, BUA, TBA }
//        - sum sub-unit parking bays via resolveSubUnitParkingBays
//   3. computePlotParkingCapacity(envelope) + allocateParking(total demand)
//
// Output is keyed by plot id and stable across reruns (assets are
// processed in store order, NOT sorted, to mirror UI row order).
//
// Independent of the legacy single-phase / multi-phase pipelines —
// this one only fires when at least one plot exists. Pre-M1.7 fixtures
// produce an empty perPlot array.

export interface AreaProgramAssetSnapshot {
  assetId:        string;
  assetName:      string;
  category:       string;
  primaryStrategy: AssetStrategy;
  gfaShare:       number;
  cascade:        AreaCascadeResult;
  parkingBaysDemanded: number;
}

export interface AreaProgramPlotSnapshot {
  plotId:        string;
  plotName:      string;
  phaseId:       string;
  envelope:      PlotEnvelopeAreas;
  capacity:      PlotCapacityResult;
  parking:       ParkingAllocationResult;
  perAsset:      AreaProgramAssetSnapshot[];
  // Roll-ups (sums across perAsset for at-a-glance plot KPIs).
  totalAssetGFA: number;
  totalGSAGLA:   number;
  totalMEP:      number;
  totalTBA:      number;
  totalParkingBaysDemanded: number;
}

export interface AreaProgramSnapshot {
  fixtureLabel:   string;
  perPlot:        AreaProgramPlotSnapshot[];
  summary: {
    totalPlots:                 number;
    totalAssetGFAAcrossPlots:   number;
    totalGSAGLAAcrossPlots:     number;
    totalParkingBaysDemanded:   number;
    totalParkingBaysAllocated:  number;
    totalParkingDeficit:        number;
  };
}

export function runAreaProgramPipeline(v4: HydrateSnapshot): AreaProgramSnapshot {
  const verticalParkingFloors = 0;  // M1.7/4 fixture default; future per-plot field

  const perPlot: AreaProgramPlotSnapshot[] = v4.plots.map(plot => {
    const envelope = computePlotEnvelope({
      plotArea:              plot.plotArea,
      maxFAR:                plot.maxFAR,
      coveragePct:           plot.coveragePct,
      podiumFloors:          plot.podiumFloors,
      typicalFloors:         plot.typicalFloors,
      typicalCoveragePct:    plot.typicalCoveragePct,
      landscapePct:          plot.landscapePct,
      hardscapePct:          plot.hardscapePct,
      basementCount:         plot.basementCount,
      basementEfficiencyPct: plot.basementEfficiencyPct,
    });

    const capacity = computePlotParkingCapacity({
      envelope,
      surfaceBaySqm:         plot.surfaceBaySqm,
      verticalBaySqm:        plot.verticalBaySqm,
      basementBaySqm:        plot.basementBaySqm,
      verticalParkingFloors,
    });

    // Plot's assets in store order. allocPctSum is used for pro-rata
    // GFA when no gfaOverrideSqm is set; missing-allocation defaults
    // to equal weighting (1) so a plot with all-zero allocs still
    // splits area cleanly.
    const plotAssets = v4.assets.filter(a => a.plotId === plot.id);
    const allocPctSum = plotAssets.reduce((s, a) => s + (a.allocationPct > 0 ? a.allocationPct : 0), 0);

    // First pass: compute each asset's GFA share + parking demand.
    const firstPass = plotAssets.map(asset => {
      const gfaShare = asset.gfaOverrideSqm !== undefined
        ? Math.max(0, asset.gfaOverrideSqm)
        : (allocPctSum > 0
            ? envelope.totalBuiltGFA * ((asset.allocationPct > 0 ? asset.allocationPct : 0) / allocPctSum)
            : envelope.totalBuiltGFA / Math.max(1, plotAssets.length));
      const subUnitsForAsset = v4.subUnits.filter(u => u.assetId === asset.id);
      const parkingBaysDemanded = subUnitsForAsset.reduce((s, u) => s + resolveSubUnitParkingBays(u), 0);
      return { asset, gfaShare, parkingBaysDemanded };
    });

    const totalParkingBaysDemanded = firstPass.reduce((s, p) => s + p.parkingBaysDemanded, 0);
    const parking = allocateParking({
      totalBaysRequired:    totalParkingBaysDemanded,
      surfaceCapacityBays:  capacity.surfaceCapacityBays,
      verticalCapacityBays: capacity.verticalCapacityBays,
      basementCapacityBays: capacity.basementCapacityBays,
    });

    // Pro-rata basement share by GFA. Pure split — does NOT alter the
    // asset's GFA, just stamps how much basement belongs to the asset
    // for cascade.tba reporting.
    const totalGFA = firstPass.reduce((s, p) => s + p.gfaShare, 0);

    const perAsset: AreaProgramAssetSnapshot[] = firstPass.map(({ asset, gfaShare, parkingBaysDemanded }) => {
      const cascadePcts = resolveAssetCascadePcts(asset);
      const basementShare = totalGFA > 0
        ? envelope.basementUsableArea * (gfaShare / totalGFA)
        : 0;
      const cascade = computeAreaCascade({
        gfa: gfaShare,
        ...cascadePcts,
        efficiencyPct: asset.efficiencyPct,
        basementShare,
      });
      return {
        assetId:         asset.id,
        assetName:       asset.name,
        category:        asset.category,
        primaryStrategy: resolveAssetStrategy(asset),
        gfaShare,
        cascade,
        parkingBaysDemanded,
      };
    });

    const totalAssetGFA = perAsset.reduce((s, a) => s + a.cascade.gfa, 0);
    const totalGSAGLA   = perAsset.reduce((s, a) => s + a.cascade.gsaGla, 0);
    const totalMEP      = perAsset.reduce((s, a) => s + a.cascade.mep, 0);
    const totalTBA      = perAsset.reduce((s, a) => s + a.cascade.tba, 0);

    return {
      plotId:        plot.id,
      plotName:      plot.name,
      phaseId:       plot.phaseId,
      envelope,
      capacity,
      parking,
      perAsset,
      totalAssetGFA,
      totalGSAGLA,
      totalMEP,
      totalTBA,
      totalParkingBaysDemanded,
    };
  });

  const totalAssetGFAAcrossPlots = perPlot.reduce((s, p) => s + p.totalAssetGFA, 0);
  const totalGSAGLAAcrossPlots   = perPlot.reduce((s, p) => s + p.totalGSAGLA, 0);
  const totalParkingBaysDemanded = perPlot.reduce((s, p) => s + p.totalParkingBaysDemanded, 0);
  const totalParkingBaysAllocated = perPlot.reduce((s, p) => s + p.parking.totalAllocated, 0);
  const totalParkingDeficit       = perPlot.reduce((s, p) => s + p.parking.deficit, 0);

  return {
    fixtureLabel: v4.projectName,
    perPlot,
    summary: {
      totalPlots:                perPlot.length,
      totalAssetGFAAcrossPlots,
      totalGSAGLAAcrossPlots,
      totalParkingBaysDemanded,
      totalParkingBaysAllocated,
      totalParkingDeficit,
    },
  };
}
