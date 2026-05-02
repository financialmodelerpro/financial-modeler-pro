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
} from '@core/types/project.types';

// ── Fixture shape ────────────────────────────────────────────────────────────
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
  const land = calculateLandAggregates(input.landParcels);

  const hierarchy = calculateAreaHierarchy({
    totalLandArea:        land.totalLandArea,
    landValuePerSqm:      land.landValuePerSqm,
    cashPercent:          land.cashPercent,
    inKindPercent:        land.inKindPercent,
    projectRoadsPct:      input.projectRoadsPct,
    projectFAR:           input.projectFAR,
    projectNonEnclosedPct: input.projectNonEnclosedPct,
    residentialPercent:   input.residentialPercent,
    hospitalityPercent:   input.hospitalityPercent,
    retailPercent:        input.retailPercent,
    residentialDeductPct: input.residentialDeductPct,
    residentialEfficiency: input.residentialEfficiency,
    hospitalityDeductPct: input.hospitalityDeductPct,
    hospitalityEfficiency: input.hospitalityEfficiency,
    retailDeductPct:      input.retailDeductPct,
    retailEfficiency:     input.retailEfficiency,
    showResidential:      input.showResidential,
    showHospitality:      input.showHospitality,
    showRetail:           input.showRetail,
  });

  const assetPercents: Record<string, number> = {
    residential: input.residentialPercent,
    hospitality: input.hospitalityPercent,
    retail:      input.retailPercent,
  };
  const showFlags: Record<string, boolean> = {
    residential: input.showResidential,
    hospitality: input.showHospitality,
    retail:      input.showRetail,
  };

  const buildAssetSnapshot = (assetType: AssetKey, costs: CostItem[]): AssetSnapshot => {
    const areas = getAreas(assetType, {
      hierarchy,
      landAggregates:     land,
      residentialPercent: input.residentialPercent,
      hospitalityPercent: input.hospitalityPercent,
      retailPercent:      input.retailPercent,
      projectNDA:         hierarchy.projectNDA,
    });

    const costItemTotals = costs.map(c => ({
      name:  c.name,
      total: calculateItemTotal(c, assetType, areas, costs, input.costInputMode, assetPercents, showFlags),
    }));

    const costDistributions = costs.map(c => ({
      name: c.name,
      dist: distributeCost(c, assetType, input.constructionPeriods, areas, costs, input.costInputMode, assetPercents, showFlags),
    }));

    const financing = buildAssetFinancing({
      assetType,
      areas,
      costs,
      constructionPeriods: input.constructionPeriods,
      operationsPeriods:   input.operationsPeriods,
      interestRate:        input.interestRate,
      modelType:           input.modelType,
      repaymentPeriods:    input.repaymentPeriods,
      capitalizeInterest:  input.capitalizeInterest,
      costInputMode:       input.costInputMode,
      financingMode:       input.financingMode,
      globalDebtPct:       input.globalDebtPct,
      lineRatios:          input.lineRatios,
      assetPercents,
      showFlags,
    });

    return { areas, costItemTotals, costDistributions, financing };
  };

  const perAsset = {
    residential: input.showResidential ? buildAssetSnapshot('residential', input.residentialCosts) : null,
    hospitality: input.showHospitality ? buildAssetSnapshot('hospitality', input.hospitalityCosts) : null,
    retail:      input.showRetail      ? buildAssetSnapshot('retail',      input.retailCosts)      : null,
  };

  const sumAssetTotals = (key: 'totalDebt' | 'totalEquity' | 'totalInterest') =>
    (perAsset.residential?.financing[key] ?? 0) +
    (perAsset.hospitality?.financing[key] ?? 0) +
    (perAsset.retail?.financing[key]      ?? 0);

  const totalDebt     = sumAssetTotals('totalDebt');
  const totalEquity   = sumAssetTotals('totalEquity');
  const totalInterest = sumAssetTotals('totalInterest');
  const totalCapex    = totalDebt + totalEquity;
  const totalPeriods  = input.constructionPeriods + input.operationsPeriods;

  return {
    fixtureLabel: input.projectName,
    landAggregates: land,
    areaHierarchy:  hierarchy,
    perAsset,
    summary: { totalCapex, totalDebt, totalEquity, totalInterest, totalPeriods },
  };
}
