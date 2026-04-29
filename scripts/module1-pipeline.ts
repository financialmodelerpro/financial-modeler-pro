/**
 * Module 1 — pure calculation pipeline for regression-guard snapshots.
 *
 * Loads a fixture-shaped state and reproduces every output Module 1 derives
 * from it: land aggregates, area hierarchy, per-asset areas, per-asset cost
 * item totals, per-asset cost distributions per period, per-asset financing
 * schedules (debt + equity drawdowns, interest, repayments, balances), and
 * project-level summary totals.
 *
 * ─── Math source mapping ───
 *
 *   calculateLandAggregates   → @core/calculations  (pure export, exact)
 *   calculateAreaHierarchy    → @core/calculations  (pure export, exact)
 *   getAreas                  → @core/calculations  (pure export, exact)
 *   calculateItemTotal        → @core/calculations  (pure export, exact)
 *   distributeCost            → @core/calculations  (pure export, exact)
 *   buildAssetFinancing       → INLINED below       (verbatim copy from
 *                                RealEstatePlatform.tsx lines 547-684)
 *
 * Why is `buildAssetFinancing` inlined and not imported from a pure helper?
 * The live implementation lives inside a React `useCallback` in
 * `src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx` and
 * has not been extracted yet. This regression-guard prep step is explicitly
 * not allowed to touch Module 1, so the algorithm is mirrored here verbatim.
 *
 * ⚠️  Lockstep contract: if `buildAssetFinancing` in RealEstatePlatform.tsx
 * ever changes, the inlined copy below must change in the same commit.
 * Otherwise the snapshot baseline will silently diverge from what the live
 * UI computes. Phase 4 (component retrofit) is JSX/styling only — it must
 * not modify financing math, and therefore must not modify this file.
 */

import { readFileSync } from 'node:fs';
import {
  calculateLandAggregates,
  calculateAreaHierarchy,
  getAreas,
  calculateItemTotal,
  distributeCost,
} from '@core/calculations';
import type {
  CostItem,
  AreaMetrics,
  CostInputMode,
  ModelType,
  FinancingMode,
  RepaymentMethod,
  LandParcel,
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

export interface FinancingSnapshot {
  lineItems: { name: string; total: number; debtAmt: number; equityAmt: number; debtPct: number }[];
  lineDistributions: { name: string; dist: number[] }[];
  debtAdd: number[];
  debtOpen: number[];
  debtRep: number[];
  debtClose: number[];
  equityAdd: number[];
  eqOpen: number[];
  eqClose: number[];
  interest: number[];
  totalDebt: number;
  totalEquity: number;
  totalInterest: number;
  periodicRate: number;
  totalPeriods: number;
}

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

// ── buildAssetFinancing (inlined; see file header) ───────────────────────────
function buildAssetFinancing(
  input: Module1Input,
  assetType: AssetKey,
  areas: AreaMetrics,
  costs: CostItem[],
): FinancingSnapshot {
  const {
    constructionPeriods, operationsPeriods, interestRate, modelType,
    repaymentPeriods, capitalizeInterest, costInputMode,
    financingMode, globalDebtPct, lineRatios,
    residentialPercent, hospitalityPercent, retailPercent,
    showResidential, showHospitality, showRetail,
  } = input;

  const totalPeriods = constructionPeriods + operationsPeriods;
  const periodicRate = (interestRate / 100) / (modelType === 'monthly' ? 12 : 1);

  const assetPercents: Record<string, number> = {
    residential: residentialPercent,
    hospitality: hospitalityPercent,
    retail:      retailPercent,
  };
  const showFlags: Record<string, boolean> = {
    residential: showResidential,
    hospitality: showHospitality,
    retail:      showRetail,
  };

  // Same-for-all proportioning for canDelete=false rows.
  const bafAllocMap: Record<AssetKey, number> = {
    residential: residentialPercent,
    hospitality: hospitalityPercent,
    retail:      retailPercent,
  };
  const bafVisibleAssets: AssetKey[] = [
    ...((showResidential ? ['residential'] : []) as AssetKey[]),
    ...((showHospitality ? ['hospitality'] : []) as AssetKey[]),
    ...((showRetail      ? ['retail']      : []) as AssetKey[]),
  ];
  const bafTotalAllocPct = bafVisibleAssets.reduce((s, a) => s + (bafAllocMap[a] || 0), 0);

  const getProportionedDist = (cost: CostItem): number[] => {
    if (costInputMode === 'same-for-all' && cost.canDelete === false) {
      const fullDist = distributeCost(cost, assetType, constructionPeriods, areas, costs, costInputMode, assetPercents, showFlags);
      const factor = bafTotalAllocPct > 0 ? (bafAllocMap[assetType] || 0) / bafTotalAllocPct : 0;
      return fullDist.map(v => v * factor);
    }
    return distributeCost(cost, assetType, constructionPeriods, areas, costs, costInputMode, assetPercents, showFlags);
  };

  const getProportionedTotal = (cost: CostItem): number => {
    if (costInputMode === 'same-for-all' && cost.canDelete === false) {
      const fullTotal = calculateItemTotal(cost, assetType, areas, costs, costInputMode, assetPercents, showFlags);
      const factor = bafTotalAllocPct > 0 ? (bafAllocMap[assetType] || 0) / bafTotalAllocPct : 0;
      return fullTotal * factor;
    }
    return calculateItemTotal(cost, assetType, areas, costs, costInputMode, assetPercents, showFlags);
  };

  const getLineDebtPct = (name: string): number => {
    if (financingMode === 'fixed') return globalDebtPct;
    return lineRatios[name] !== undefined ? lineRatios[name] : globalDebtPct;
  };

  const lineItems = costs.map(c => {
    const total = getProportionedTotal(c);
    const debtPct = getLineDebtPct(c.name);
    const debtAmt = total * (debtPct / 100);
    const equityAmt = total - debtAmt;
    return { name: c.name, total, debtAmt, equityAmt, debtPct };
  });

  const lineDistributions = costs.map(c => ({
    name: c.name,
    dist: getProportionedDist(c).slice(0, constructionPeriods + 1),
  }));

  const totalDebtCalc   = lineItems.reduce((s, l) => s + l.debtAmt,   0);
  const totalEquityCalc = lineItems.reduce((s, l) => s + l.equityAmt, 0);

  const debtAdd   = new Array(totalPeriods + 1).fill(0);
  const equityAdd = new Array(totalPeriods + 1).fill(0);

  costs.forEach(cost => {
    const d       = getProportionedDist(cost);
    const debtPct = getLineDebtPct(cost.name);
    d.forEach((v, i) => {
      if (i <= constructionPeriods) {
        debtAdd[i]   += v * (debtPct / 100);
        equityAdd[i] += v * (1 - debtPct / 100);
      }
    });
  });

  // Phase 1 — construction (no repayment yet, optional capitalized interest)
  const debtOpen  = new Array(totalPeriods + 1).fill(0);
  const debtRep   = new Array(totalPeriods + 1).fill(0);
  const debtClose = new Array(totalPeriods + 1).fill(0);
  const interest  = new Array(totalPeriods + 1).fill(0);

  let debtBal = 0;
  for (let p = 0; p <= constructionPeriods; p++) {
    debtOpen[p] = debtBal;
    const draw = debtAdd[p] || 0;
    const inConstruction = p >= 1 && p <= constructionPeriods;
    const intCharge = debtBal * periodicRate
      + (inConstruction && capitalizeInterest ? draw * periodicRate / 2 : 0);
    interest[p] = intCharge;
    debtRep[p]  = 0;
    debtBal += draw + (capitalizeInterest && inConstruction ? intCharge : 0);
    debtClose[p] = Math.max(0, debtBal);
  }

  const repPerPeriod = repaymentPeriods > 0 ? debtClose[constructionPeriods] / repaymentPeriods : 0;

  // Phase 2 — operations (repay + charge interest on declining balance)
  for (let p = constructionPeriods + 1; p <= totalPeriods; p++) {
    debtOpen[p] = debtBal;
    const opIdx     = p - constructionPeriods;
    const intCharge = debtBal * periodicRate;
    interest[p] = intCharge;
    const repayment = opIdx <= repaymentPeriods ? repPerPeriod : 0;
    debtRep[p] = repayment;
    debtBal = Math.max(0, debtBal - repayment);
    debtClose[p] = debtBal;
  }

  // Equity balance
  const eqOpen  = new Array(totalPeriods + 1).fill(0);
  const eqClose = new Array(totalPeriods + 1).fill(0);
  let eqBal = 0;
  for (let p = 0; p <= totalPeriods; p++) {
    eqOpen[p] = eqBal;
    eqBal += equityAdd[p] || 0;
    eqClose[p] = eqBal;
  }

  const totalInterest = interest.reduce((s, v) => s + v, 0);

  // operationsPeriods is unused inside this function but is part of the input;
  // kept in the destructure for parity with the React component's closure.
  void operationsPeriods;

  return {
    lineItems,
    lineDistributions,
    debtAdd, debtOpen, debtRep, debtClose,
    equityAdd, eqOpen, eqClose,
    interest,
    totalDebt: totalDebtCalc,
    totalEquity: totalEquityCalc,
    totalInterest,
    periodicRate,
    totalPeriods,
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

    const financing = buildAssetFinancing(input, assetType, areas, costs);

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
