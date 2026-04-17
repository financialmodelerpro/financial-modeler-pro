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
