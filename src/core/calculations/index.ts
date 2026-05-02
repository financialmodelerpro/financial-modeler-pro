/**
 * core-calculations.ts
 * Pure calculation functions extracted from refm-platform.js Module 1.
 * No React state - all inputs passed explicitly as parameters.
 */

import {
  LandParcel,
  LandAggregates,
  AreaMetrics,
  CostItem,
  CostInputMode,
  ModelType,
  FinancingMode,
  FinancingResult,
} from '../types/project.types';

// ─── Area hierarchy context ────────────────────────────────────────────────

export interface AreaHierarchy {
  projectRoadsArea: number;
  projectNDA: number;
  totalProjectGFA: number;
  totalProjectBUA: number;
  residentialGFA: number;
  hospitalityGFA: number;
  retailGFA: number;
  residentialBUA: number;
  hospitalityBUA: number;
  retailBUA: number;
  residentialNetSaleable: number;
  hospitalityNetSaleable: number;
  retailNetSaleable: number;
  residentialLandValue: number;
  hospitalityLandValue: number;
  retailLandValue: number;
  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;
}

// ─── 1. calculateLandAggregates ────────────────────────────────────────────
// Lines ~390-397 of legacy refm-platform.js

export function calculateLandAggregates(parcels: LandParcel[]): LandAggregates {
  const totalLandArea = parcels.reduce((s, p) => s + (parseFloat(String(p.area)) || 0), 0);
  const totalLandValue = parcels.reduce(
    (s, p) => s + (parseFloat(String(p.area)) || 0) * (parseFloat(String(p.rate)) || 0),
    0,
  );
  const landValuePerSqm =
    totalLandArea > 0 ? totalLandValue / totalLandArea : 0;
  const cashValue = parcels.reduce(
    (s, p) =>
      s +
      (parseFloat(String(p.area)) || 0) *
        (parseFloat(String(p.rate)) || 0) *
        (parseFloat(String(p.cashPct)) || 0) /
        100,
    0,
  );
  const inKindValue = parcels.reduce(
    (s, p) =>
      s +
      (parseFloat(String(p.area)) || 0) *
        (parseFloat(String(p.rate)) || 0) *
        (parseFloat(String(p.inKindPct)) || 0) /
        100,
    0,
  );
  const cashPercent = totalLandValue > 0 ? (cashValue / totalLandValue) * 100 : 0;
  const inKindPercent = totalLandValue > 0 ? (inKindValue / totalLandValue) * 100 : 0;

  return {
    totalLandArea,
    landValuePerSqm,
    totalLandValue,
    cashValue,
    inKindValue,
    cashPercent,
    inKindPercent,
  };
}

// ─── 2. calculateProjectEndDate ────────────────────────────────────────────
// Lines ~400-413 of legacy refm-platform.js

export function calculateProjectEndDate(
  projectStart: string,
  constructionPeriods: number,
  operationsPeriods: number,
  overlapPeriods: number,
  modelType: ModelType,
): string {
  const startDate = new Date(projectStart);
  const effectivePeriods = constructionPeriods + operationsPeriods - overlapPeriods;
  const totalMonths = modelType === 'monthly' ? effectivePeriods : effectivePeriods * 12;

  // Add months and subtract 1 day to get end of last month
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + totalMonths);
  endDate.setDate(0); // Last day of previous month

  return endDate.toISOString().split('T')[0];
}

// ─── 3. calculateAreaHierarchy ─────────────────────────────────────────────
// Lines ~425-461 of legacy refm-platform.js

export interface AreaHierarchyParams {
  totalLandArea: number;
  landValuePerSqm: number;
  /** cashPercent and inKindPercent are passed through to consumers of AreaHierarchy (e.g. getAreas). */
  cashPercent: number;
  inKindPercent: number;
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
}

export function calculateAreaHierarchy(params: AreaHierarchyParams): AreaHierarchy {
  const {
    totalLandArea,
    landValuePerSqm,
    projectRoadsPct,
    projectFAR,
    projectNonEnclosedPct,
    residentialPercent,
    hospitalityPercent,
    retailPercent,
    residentialDeductPct,
    residentialEfficiency,
    hospitalityDeductPct,
    hospitalityEfficiency,
    retailDeductPct,
    retailEfficiency,
    showResidential,
    showHospitality,
    showRetail,
  } = params;
  // cashPercent and inKindPercent are exposed on LandAggregates for callers; not needed here.

  const projectRoadsArea = totalLandArea * (projectRoadsPct / 100);
  const projectNDA = totalLandArea - projectRoadsArea;
  const totalProjectGFA = projectNDA * projectFAR;
  const totalProjectBUA = totalProjectGFA * (1 - projectNonEnclosedPct / 100);

  // Asset GFA (zero for hidden assets)
  const residentialGFA = showResidential ? totalProjectGFA * (residentialPercent / 100) : 0;
  const hospitalityGFA = showHospitality ? totalProjectGFA * (hospitalityPercent / 100) : 0;
  const retailGFA = showRetail ? totalProjectGFA * (retailPercent / 100) : 0;

  // Asset BUA & Net Saleable
  const residentialBUA = residentialGFA * (1 - residentialDeductPct / 100);
  const residentialNetSaleable = residentialBUA * (residentialEfficiency / 100);

  const hospitalityBUA = hospitalityGFA * (1 - hospitalityDeductPct / 100);
  const hospitalityNetSaleable = hospitalityBUA * (hospitalityEfficiency / 100);

  const retailBUA = retailGFA * (1 - retailDeductPct / 100);
  const retailNetSaleable = retailBUA * (retailEfficiency / 100);

  // Legacy land value aliases (used in cost calculations downstream)
  const residentialLandValue = showResidential
    ? totalLandArea * (residentialPercent / 100) * landValuePerSqm
    : 0;
  const hospitalityLandValue = showHospitality
    ? totalLandArea * (hospitalityPercent / 100) * landValuePerSqm
    : 0;
  const retailLandValue = showRetail
    ? totalLandArea * (retailPercent / 100) * landValuePerSqm
    : 0;

  return {
    projectRoadsArea,
    projectNDA,
    totalProjectGFA,
    totalProjectBUA,
    residentialGFA,
    hospitalityGFA,
    retailGFA,
    residentialBUA,
    hospitalityBUA,
    retailBUA,
    residentialNetSaleable,
    hospitalityNetSaleable,
    retailNetSaleable,
    residentialLandValue,
    hospitalityLandValue,
    retailLandValue,
    showResidential,
    showHospitality,
    showRetail,
  };
}

// ─── 4. getAreas ──────────────────────────────────────────────────────────
// Line ~480-484 of legacy refm-platform.js

export interface GetAreasParams {
  hierarchy: AreaHierarchy;
  landAggregates: LandAggregates;
  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;
  projectNDA: number;
}

export function getAreas(
  assetType: string,
  params: GetAreasParams,
): AreaMetrics {
  const {
    hierarchy,
    landAggregates,
    residentialPercent,
    hospitalityPercent,
    retailPercent,
    projectNDA,
  } = params;

  const { totalLandArea, cashPercent, inKindPercent } = landAggregates;
  const {
    residentialGFA,
    hospitalityGFA,
    retailGFA,
    residentialBUA,
    hospitalityBUA,
    retailBUA,
    residentialNetSaleable,
    hospitalityNetSaleable,
    retailNetSaleable,
    residentialLandValue,
    hospitalityLandValue,
    retailLandValue,
  } = hierarchy;

  const areasMap: Record<string, AreaMetrics> = {
    residential: {
      totalAllocated: totalLandArea * (residentialPercent / 100),
      netDevelopable: projectNDA * (residentialPercent / 100),
      roadsArea: 0,
      gfa: residentialGFA,
      bua: residentialBUA,
      nsa: residentialNetSaleable,
      landValue: residentialLandValue,
      cashLandValue: residentialLandValue * (cashPercent / 100),
      inKindLandValue: residentialLandValue * (inKindPercent / 100),
    },
    hospitality: {
      totalAllocated: totalLandArea * (hospitalityPercent / 100),
      netDevelopable: projectNDA * (hospitalityPercent / 100),
      roadsArea: 0,
      gfa: hospitalityGFA,
      bua: hospitalityBUA,
      nsa: hospitalityNetSaleable,
      landValue: hospitalityLandValue,
      cashLandValue: hospitalityLandValue * (cashPercent / 100),
      inKindLandValue: hospitalityLandValue * (inKindPercent / 100),
    },
    retail: {
      totalAllocated: totalLandArea * (retailPercent / 100),
      netDevelopable: projectNDA * (retailPercent / 100),
      roadsArea: 0,
      gfa: retailGFA,
      bua: retailBUA,
      nsa: retailNetSaleable,
      landValue: retailLandValue,
      cashLandValue: retailLandValue * (cashPercent / 100),
      inKindLandValue: retailLandValue * (inKindPercent / 100),
    },
  };

  const result = areasMap[assetType];
  if (!result) {
    throw new Error(`Unknown assetType: ${assetType}`);
  }
  return result;
}

// ─── 5. getPhasingMode ────────────────────────────────────────────────────
// Lines ~581-586 of legacy refm-platform.js

export function getPhasingMode(cost: CostItem): 'even' | 'manual' {
  if (!cost.phasing) return 'even';
  if (typeof cost.phasing === 'object') return cost.phasing.type || 'even';
  if (cost.phasing.trim().toLowerCase() === 'even') return 'even';
  return 'manual';
}

// ─── 6. getPhasingValues ──────────────────────────────────────────────────
// Lines ~589-595 of legacy refm-platform.js

export function getPhasingValues(cost: CostItem): number[] {
  if (typeof cost.phasing === 'object' && cost.phasing.values) return cost.phasing.values;
  if (
    typeof cost.phasing === 'string' &&
    cost.phasing.trim().toLowerCase() !== 'even'
  ) {
    return cost.phasing
      .split(',')
      .map((v) => parseFloat(v.trim()))
      .filter((v) => !isNaN(v));
  }
  return [];
}

// ─── 7. validatePhasingValues ─────────────────────────────────────────────
// Lines ~598-603 of legacy refm-platform.js

export function validatePhasingValues(
  values: number[],
  startPeriod: number,
  endPeriod: number,
): { valid: boolean; sum?: number; error: string } {
  const periods = endPeriod - startPeriod + 1;
  if (values.length !== periods) return { valid: false, error: `Need ${periods} values` };
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) return { valid: false, sum, error: `Sum: ${sum.toFixed(1)}%` };
  return { valid: true, sum, error: '' };
}

// ─── Internal: getSelectedBase ─────────────────────────────────────────────
// Lines ~498-503 of legacy refm-platform.js
// Forward declaration needed since calculateItemTotal and getSelectedBase are mutually recursive.

function getSelectedBase(
  cost: CostItem,
  costsArr: CostItem[],
  assetType: string,
  areas: AreaMetrics,
  costInputMode: CostInputMode,
  assetPercents: Record<string, number>,
  showFlags: Record<string, boolean>,
): number {
  return (cost.selectedIds ?? [])
    .filter((sid) => sid !== cost.id)
    .map((sid) => costsArr.find((c) => c.id === sid))
    .filter((c): c is CostItem => c !== undefined)
    .reduce(
      (sum, c) =>
        sum +
        calculateItemTotal(c, assetType, areas, costsArr, costInputMode, assetPercents, showFlags),
      0,
    );
}

// ─── 8. calculateItemTotal ────────────────────────────────────────────────
// Lines ~505-535 of legacy refm-platform.js

export function calculateItemTotal(
  cost: CostItem,
  assetType: string,
  areas: AreaMetrics,
  costsArr: CostItem[],
  costInputMode: CostInputMode,
  assetPercents: Record<string, number>,
  showFlags: Record<string, boolean>,
): number {
  const val = parseFloat(String(cost.value)) || 0;
  const a = areas;

  // In same-for-all mode, fixed amounts are project-level totals and must be
  // proportioned by this asset's land allocation share.
  const getSameForAllFactor = (): number => {
    if (costInputMode !== 'same-for-all' || cost.canDelete === false) return 1;
    const totalAlloc =
      (showFlags['residential'] ? (assetPercents['residential'] ?? 0) : 0) +
      (showFlags['hospitality'] ? (assetPercents['hospitality'] ?? 0) : 0) +
      (showFlags['retail'] ? (assetPercents['retail'] ?? 0) : 0);
    if (totalAlloc <= 0) return 0;
    const thisAlloc = assetPercents[assetType] ?? 0;
    return thisAlloc / totalAlloc;
  };

  switch (cost.method) {
    case 'fixed':
      return val * getSameForAllFactor();
    case 'rate_total_allocated':
      return val * a.totalAllocated;
    case 'rate_net_developable':
      return val * a.netDevelopable;
    case 'rate_roads':
      return val * a.roadsArea;
    case 'rate_gfa':
      return val * a.gfa;
    case 'rate_bua':
      return val * a.bua;
    case 'percent_base':
      return (
        getSelectedBase(cost, costsArr, assetType, a, costInputMode, assetPercents, showFlags) *
        (val / 100)
      );
    case 'percent_total_land':
      return a.landValue * (val / 100);
    case 'percent_cash_land':
      return a.cashLandValue * (val / 100);
    case 'percent_inkind_land':
      return a.inKindLandValue * (val / 100);
    default:
      return 0;
  }
}

// ─── 8a. buildAssetFinancing ──────────────────────────────────────────────
// Phase M1.R/3: lifted verbatim from RealEstatePlatform.tsx and the
// snapshot pipeline's previously-inlined copy, so both consumers share
// one definition. The pipeline header at scripts/module1-pipeline.ts
// previously documented a "lockstep contract" that this extraction
// eliminates: the pure function below is now the single source of truth
// for asset-level financing math.
//
// Math is bit-identical to the prior inlined / closure forms; the
// snapshot baseline must match exactly after this commit.

export interface BuildAssetFinancingParams {
  assetType: string;
  areas: AreaMetrics;
  costs: CostItem[];
  constructionPeriods: number;
  operationsPeriods: number;
  interestRate: number;
  modelType: ModelType;
  repaymentPeriods: number;
  capitalizeInterest: boolean;
  costInputMode: CostInputMode;
  financingMode: FinancingMode;
  globalDebtPct: number;
  lineRatios: Record<string, number>;
  // Per-asset land allocation (% of project GFA) and visibility flags.
  // Used by both the same-for-all proportioning factor and the
  // financing layer's `bafTotalAllocPct` denominator.
  assetPercents: Record<string, number>;
  showFlags: Record<string, boolean>;
}

export function buildAssetFinancing(p: BuildAssetFinancingParams): FinancingResult {
  const {
    assetType, areas, costs,
    constructionPeriods, operationsPeriods,
    interestRate, modelType,
    repaymentPeriods, capitalizeInterest,
    costInputMode, financingMode, globalDebtPct, lineRatios,
    assetPercents, showFlags,
  } = p;

  const totalPeriods = constructionPeriods + operationsPeriods;
  const periodicRate = (interestRate / 100) / (modelType === 'monthly' ? 12 : 1);

  // Same-for-all proportioning: in same-for-all mode, locked rows
  // (canDelete=false, e.g. Land Cash) carry the project-level total and
  // must be split per-asset by allocation share. Enumerate visible
  // assets so the denominator is the sum of allocations actually shown.
  const visibleAssetIds = Object.keys(showFlags).filter(k => showFlags[k]);
  const totalAllocPct = visibleAssetIds.reduce((s, a) => s + (assetPercents[a] || 0), 0);

  const getProportionedDist = (cost: CostItem): number[] => {
    if (costInputMode === 'same-for-all' && cost.canDelete === false) {
      const fullDist = distributeCost(cost, assetType, constructionPeriods, areas, costs, costInputMode, assetPercents, showFlags);
      const factor = totalAllocPct > 0 ? (assetPercents[assetType] || 0) / totalAllocPct : 0;
      return fullDist.map(v => v * factor);
    }
    return distributeCost(cost, assetType, constructionPeriods, areas, costs, costInputMode, assetPercents, showFlags);
  };

  const getProportionedTotal = (cost: CostItem): number => {
    if (costInputMode === 'same-for-all' && cost.canDelete === false) {
      const fullTotal = calculateItemTotal(cost, assetType, areas, costs, costInputMode, assetPercents, showFlags);
      const factor = totalAllocPct > 0 ? (assetPercents[assetType] || 0) / totalAllocPct : 0;
      return fullTotal * factor;
    }
    return calculateItemTotal(cost, assetType, areas, costs, costInputMode, assetPercents, showFlags);
  };

  const getLineDebtPct = (name: string): number => {
    if (financingMode === 'fixed') return globalDebtPct;
    return lineRatios[name] !== undefined ? lineRatios[name] : globalDebtPct;
  };

  const lineItems = costs.map(c => {
    const total     = getProportionedTotal(c);
    const debtPct   = getLineDebtPct(c.name);
    const debtAmt   = total * (debtPct / 100);
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

  // Phase 1 - construction (no repayment, optional capitalized interest).
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

  // Phase 2 - operations (repay + charge interest on declining balance).
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

  // Equity balance.
  const eqOpen  = new Array(totalPeriods + 1).fill(0);
  const eqClose = new Array(totalPeriods + 1).fill(0);
  let eqBal = 0;
  for (let p = 0; p <= totalPeriods; p++) {
    eqOpen[p] = eqBal;
    eqBal += equityAdd[p] || 0;
    eqClose[p] = eqBal;
  }

  const totalInterest = interest.reduce((s, v) => s + v, 0);

  // operationsPeriods is unused inside this function but is part of the
  // input contract; explicitly void it so unused-parameter lints still
  // catch unrelated drift.
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

// ─── 9. distributeCost ────────────────────────────────────────────────────
// Lines ~564-578 of legacy refm-platform.js

export function distributeCost(
  cost: CostItem,
  assetType: string,
  constructionPeriods: number,
  areas: AreaMetrics,
  costsArr: CostItem[],
  costInputMode: CostInputMode,
  assetPercents: Record<string, number>,
  showFlags: Record<string, boolean>,
): number[] {
  const total = calculateItemTotal(
    cost,
    assetType,
    areas,
    costsArr,
    costInputMode,
    assetPercents,
    showFlags,
  );
  const distribution = Array<number>(constructionPeriods + 1).fill(0);

  if (cost.startPeriod === 0 && cost.endPeriod === 0) {
    distribution[0] = total;
    return distribution;
  }

  const phasingMode = getPhasingMode(cost);
  if (phasingMode === 'even') {
    const cnt = cost.endPeriod - cost.startPeriod + 1;
    const amt = cnt > 0 ? total / cnt : 0;
    for (let i = cost.startPeriod; i <= cost.endPeriod && i <= constructionPeriods; i++) {
      distribution[i] = amt;
    }
  } else {
    const pcts = getPhasingValues(cost);
    pcts.forEach((pct, idx) => {
      const p = cost.startPeriod + idx;
      if (p <= constructionPeriods) distribution[p] = total * (pct / 100);
    });
  }

  return distribution;
}

// ─── M1.7 Area Program calc engines ────────────────────────────────────────
// Pure functions used by the Area Program tab (M1.7/5) and the area-
// program cascade rollup. NOT consumed by the Module 1 financing /
// distribution math today, so they do NOT affect the M1.R / M1.5 /
// M1.6 snapshot baselines (single-phase 17.5 KB, multi-phase 23.0 KB).
//
// All inputs are scalars / plain objects; all outputs are plain objects.
// No store reads, no React, no side effects. The Plot / Sub-Unit
// shapes live in module1-types.ts; @core/calculations stays free of
// that import to keep the dependency direction one-way (REFM consumes
// @core, never the other way around).

// ── 1. Plot envelope ──────────────────────────────────────────────────────
// Derives all areas a plot's envelope produces from its inputs. Inputs
// are passed as a plain object so callers can mix-and-match without
// importing the Plot interface from REFM into core.
//
// Validation policy: the function never throws. Negative or zero inputs
// produce zero / clamped outputs (e.g. coverage > 100% clamps to 100%,
// landscape + hardscape sum > 100% clamps surfaceParkingArea to 0).
// The Area Program tab is the place to surface user-facing warnings
// (e.g. totalBuiltGFA > maxGFA — over-FAR — gets a yellow badge).

export interface PlotEnvelopeInputs {
  plotArea:              number;
  maxFAR:                number;
  coveragePct:           number;
  podiumFloors:          number;
  typicalFloors:         number;
  typicalCoveragePct:    number;
  landscapePct:          number;
  hardscapePct:          number;
  basementCount:         number;
  basementEfficiencyPct: number;
}

export interface PlotEnvelopeAreas {
  // Caps and footprints
  maxGFA:               number;   // plotArea * maxFAR
  footprint:            number;   // plotArea * coveragePct/100  (podium plate)
  typicalFootprint:     number;   // plotArea * typicalCoveragePct/100
  // Vertical buildup
  podiumGFA:            number;   // footprint * podiumFloors
  typicalGFA:           number;   // typicalFootprint * typicalFloors
  totalBuiltGFA:        number;   // podiumGFA + typicalGFA
  // Public-area allocation
  publicArea:           number;   // plotArea - footprint
  landscapeArea:        number;   // publicArea * landscapePct/100
  hardscapeArea:        number;   // publicArea * hardscapePct/100
  surfaceParkingArea:   number;   // publicArea - landscape - hardscape (clamped >= 0)
  // Basement (parking-usable)
  basementGrossArea:    number;   // footprint * basementCount  (incl. ramps / walls)
  basementUsableArea:   number;   // basementGrossArea * basementEfficiencyPct/100
  // Diagnostics (informational; the UI reads these to render warnings)
  utilizationPct:       number;   // totalBuiltGFA / maxGFA * 100  (0 when maxGFA = 0)
  isOverFAR:            boolean;  // utilizationPct > 100
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

export function computePlotEnvelope(input: PlotEnvelopeInputs): PlotEnvelopeAreas {
  const plotArea          = Math.max(0, input.plotArea);
  const maxFAR            = Math.max(0, input.maxFAR);
  const coveragePct       = clampPct(input.coveragePct);
  const podiumFloors      = Math.max(0, input.podiumFloors);
  const typicalFloors     = Math.max(0, input.typicalFloors);
  const typicalCoveragePct = clampPct(input.typicalCoveragePct);
  const landscapePct      = clampPct(input.landscapePct);
  const hardscapePct      = clampPct(input.hardscapePct);
  const basementCount     = Math.max(0, input.basementCount);
  const basementEffPct    = clampPct(input.basementEfficiencyPct);

  const maxGFA             = plotArea * maxFAR;
  const footprint          = plotArea * (coveragePct / 100);
  const typicalFootprint   = plotArea * (typicalCoveragePct / 100);
  const podiumGFA          = footprint * podiumFloors;
  const typicalGFA         = typicalFootprint * typicalFloors;
  const totalBuiltGFA      = podiumGFA + typicalGFA;

  const publicArea         = Math.max(0, plotArea - footprint);
  const landscapeArea      = publicArea * (landscapePct / 100);
  const hardscapeArea      = publicArea * (hardscapePct / 100);
  const surfaceParkingArea = Math.max(0, publicArea - landscapeArea - hardscapeArea);

  const basementGrossArea  = footprint * basementCount;
  const basementUsableArea = basementGrossArea * (basementEffPct / 100);

  const utilizationPct     = maxGFA > 0 ? (totalBuiltGFA / maxGFA) * 100 : 0;
  const isOverFAR          = utilizationPct > 100;

  return {
    maxGFA, footprint, typicalFootprint,
    podiumGFA, typicalGFA, totalBuiltGFA,
    publicArea, landscapeArea, hardscapeArea, surfaceParkingArea,
    basementGrossArea, basementUsableArea,
    utilizationPct, isOverFAR,
  };
}

// ── 2. Area cascade (per asset) ───────────────────────────────────────────
// Takes a single asset's allocated GFA and the breakdown percentages
// (typical industry ranges: MEP 8-15%, Back-of-House 5-10%, Other
// Technical 3-5%, Efficiency 75-90%) and produces the standard cascade:
//
//   GFA          (input)
//   MEP          = GFA * mepPct/100
//   backOfHouse  = GFA * backOfHousePct/100
//   otherTech    = GFA * otherTechnicalPct/100
//   netGFA       = GFA - MEP - backOfHouse - otherTech  (clamped >= 0)
//   GSA / GLA    = netGFA * efficiencyPct/100
//   BUAExcl      = GFA + backOfHouse + otherTech       ("BUA excluding MEP & Basement")
//   TBA          = BUAExcl + MEP + basementShare        ("Total Built Area")
//
// basementShare is per-asset basement parking allocation passed in from
// the parking allocator (M1.7/2.3) — typically the asset's pro-rata
// share of plot.basementUsableArea based on bay demand.

export interface AreaCascadeInputs {
  gfa:                number;
  mepPct:             number;  // % of GFA
  backOfHousePct:     number;  // % of GFA
  otherTechnicalPct:  number;  // % of GFA
  efficiencyPct:      number;  // % of net GFA -> GSA/GLA
  basementShare?:     number;  // sqm allocated to this asset's basement parking (default 0)
}

export interface AreaCascadeResult {
  gfa:           number;
  mep:           number;
  backOfHouse:   number;
  otherTechnical: number;
  netGFA:        number;
  gsaGla:        number;
  buaExcl:       number;  // BUA excluding MEP & Basement
  tba:           number;  // Total Built Area
}

export function computeAreaCascade(input: AreaCascadeInputs): AreaCascadeResult {
  const gfa             = Math.max(0, input.gfa);
  const mepPct          = clampPct(input.mepPct);
  const backOfHousePct  = clampPct(input.backOfHousePct);
  const otherTechPct    = clampPct(input.otherTechnicalPct);
  const efficiencyPct   = clampPct(input.efficiencyPct);
  const basementShare   = Math.max(0, input.basementShare ?? 0);

  const mep             = gfa * (mepPct / 100);
  const backOfHouse     = gfa * (backOfHousePct / 100);
  const otherTechnical  = gfa * (otherTechPct / 100);
  const netGFA          = Math.max(0, gfa - mep - backOfHouse - otherTechnical);
  const gsaGla          = netGFA * (efficiencyPct / 100);
  const buaExcl         = gfa + backOfHouse + otherTechnical;
  const tba             = buaExcl + mep + basementShare;

  return { gfa, mep, backOfHouse, otherTechnical, netGFA, gsaGla, buaExcl, tba };
}

// ── 3. Parking allocator ──────────────────────────────────────────────────
// Waterfall allocator: required bays land in Surface first (cheapest /
// most natural), then Vertical (podium), then Basement (most expensive).
// Capacities are caller-provided (typically derived from plot envelope
// in @core via computePlotEnvelope: surfaceCapacityBays =
// surfaceParkingArea / plot.surfaceBaySqm; basementCapacityBays =
// basementUsableArea / plot.basementBaySqm; verticalCapacityBays =
// (footprint * verticalParkingFloors) / plot.verticalBaySqm — the
// verticalParkingFloors input is a per-asset / per-plot decision the
// Area Program tab (M1.7/6) collects from the user).
//
// Returns a deficit when demand exceeds combined capacity. The Area
// Program tab surfaces deficit > 0 as a red warning.

export interface ParkingAllocationInputs {
  totalBaysRequired:    number;
  surfaceCapacityBays:  number;
  verticalCapacityBays: number;
  basementCapacityBays: number;
}

export interface ParkingAllocationResult {
  surfaceBays:    number;
  verticalBays:   number;
  basementBays:   number;
  totalAllocated: number;
  deficit:        number;  // > 0 when demand > capacity
}

export function allocateParking(input: ParkingAllocationInputs): ParkingAllocationResult {
  const required    = Math.max(0, Math.floor(input.totalBaysRequired));
  const surfaceCap  = Math.max(0, Math.floor(input.surfaceCapacityBays));
  const verticalCap = Math.max(0, Math.floor(input.verticalCapacityBays));
  const basementCap = Math.max(0, Math.floor(input.basementCapacityBays));

  const surfaceBays  = Math.min(required, surfaceCap);
  const remaining1   = required - surfaceBays;
  const verticalBays = Math.min(remaining1, verticalCap);
  const remaining2   = remaining1 - verticalBays;
  const basementBays = Math.min(remaining2, basementCap);
  const totalAllocated = surfaceBays + verticalBays + basementBays;
  const deficit      = required - totalAllocated;

  return { surfaceBays, verticalBays, basementBays, totalAllocated, deficit };
}

// ── 4. Plot-level capacities helper ────────────────────────────────────────
// Convenience wrapper: given a Plot's envelope output + bay-size config
// + the number of podium floors the Area Program tab dedicates to
// vertical parking, returns the three integer bay capacities the
// allocator above expects. Caller-passed verticalParkingFloors (default
// 0) is independent of plot.podiumFloors so the user can split podium
// between retail / amenity / parking explicitly.

export interface PlotCapacityInputs {
  envelope: PlotEnvelopeAreas;
  surfaceBaySqm:           number;
  verticalBaySqm:          number;
  basementBaySqm:          number;
  verticalParkingFloors?:  number;  // default 0
}

export interface PlotCapacityResult {
  surfaceCapacityBays:  number;
  verticalCapacityBays: number;
  basementCapacityBays: number;
}

export function computePlotParkingCapacity(input: PlotCapacityInputs): PlotCapacityResult {
  const envelope = input.envelope;
  const surfaceBaySqm  = Math.max(1, input.surfaceBaySqm);   // guard /0
  const verticalBaySqm = Math.max(1, input.verticalBaySqm);
  const basementBaySqm = Math.max(1, input.basementBaySqm);
  const vertFloors     = Math.max(0, input.verticalParkingFloors ?? 0);

  const surfaceCapacityBays  = Math.floor(envelope.surfaceParkingArea  / surfaceBaySqm);
  const verticalCapacityBays = Math.floor((envelope.footprint * vertFloors) / verticalBaySqm);
  const basementCapacityBays = Math.floor(envelope.basementUsableArea / basementBaySqm);

  return { surfaceCapacityBays, verticalCapacityBays, basementCapacityBays };
}
