/**
 * financing-hooks.ts (M2.0M, 2026-05-11)
 *
 * Parameter-based data hooks for the Financing engine. Hook names
 * describe WHAT they return, not WHICH module produces them. When
 * upstream engines (Revenue / OpEx / Cash Flow / Tax) ship, this
 * file is the single place that swaps zero-stubs for real engine
 * calls. The Financing engine never imports from those engines
 * directly.
 *
 * PeriodArray semantics:
 *  - length = project total periods (annual today), aligned to
 *    project period 0 = Y0 = project.startDate.
 *  - Zeros (not undefined) for periods with no activity.
 *  - Currency = project.currency (no conversion).
 */

import type {
  Asset,
  CostLine,
  CostOverride,
  EquityContribution,
  FinancingTranche,
  LandAllocationMode,
  Parcel,
  Phase,
  Project,
  SubUnit,
} from './state/module1-types';
import {
  computeAssetCost,
  computeProjectTimeline,
  costLineProjectPeriodIndex,
} from '@/src/core/calculations';

export type PeriodArray = number[];

export interface FinancingDataHooks {
  /** Capex outflow per project period, EXCLUDING land-in-kind portion. */
  getCapexExclLandInKind(): PeriodArray;
  /** Capex outflow per project period, INCLUDING land-in-kind portion. */
  getCapexInclLandInKind(): PeriodArray;
  /** Capex outflow per project period, EXCLUDING all land (cash + in-kind). */
  getCapexExclTotalLand(): PeriodArray;
  /**
   * Capex outflow per project period for a specific asset (or aggregate
   * across all assets when assetId is omitted). Post Pass 7, asset-owned
   * cost lines are filtered via computeAssetCost; non-asset-tagged lines
   * (legacy) fall through to all assets. P3-Fix 2 (2026-05-12).
   */
  getCapexSchedule(assetId?: string): PeriodArray;
  /** Total imputed value of land contributed in-kind across the project. */
  getLandInKindValue(): number;
  /** Total cash land cost across all parcels. P3-Fix 2 (2026-05-12). */
  getLandCashValue(): number;
  /** Pre-sale cash collections per project period. */
  getPreSalesCollections(): PeriodArray;
  /** Net operating cash flow per project period. */
  getOperatingCashFlow(): PeriodArray;
  /** Project closing cash balance at end of period `prevPeriod`. */
  getClosingCashBalance(prevPeriod: number): number;
  /** Total depreciation expense per project period. */
  getDepreciationSchedule(): PeriodArray;
  /** Gross revenue per project period. */
  getRevenueSchedule(): PeriodArray;
  /** Operating expense per project period. */
  getOperatingExpenses(): PeriodArray;
  // P10-Fix 10 (2026-05-12): revenue-driven commission hooks. Two
  // bases because revenue commission is sometimes paid on cash
  // collections, sometimes on sale (recognition) timing. Cost engine
  // multiplies the cost line's value% against the corresponding
  // PeriodArray. Today: zero-stub until M2.1 Revenue ships.
  getTotalRevenueCashBasis(assetId?: string): PeriodArray;
  getTotalRevenueSaleBasis(assetId?: string): PeriodArray;
}

// Snapshot shape that the factory consumes. Mirrors HydrateSnapshot
// but kept local so this module does not depend on the Zustand layer
// directly.
export interface FinancingHooksSource {
  project: Project;
  phases: Phase[];
  parcels: Parcel[];
  landAllocationMode: LandAllocationMode;
  assets: Asset[];
  subUnits: SubUnit[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
  financingTranches: FinancingTranche[];
  equityContributions: EquityContribution[];
}

const zeros = (n: number): PeriodArray => Array(Math.max(0, n)).fill(0);

// Aggregate every visible asset's per-period cost breakdown into a
// project-period-aligned PeriodArray. `pick` chooses which slice of
// the breakdown to sum (full perPeriod, perPeriodLandTotal, or
// perPeriodLandInKind).
function aggregateProjectPeriodArray(
  src: FinancingHooksSource,
  totalPeriods: number,
  pick: (b: ReturnType<typeof computeAssetCost>) => number[],
): PeriodArray {
  const out = zeros(totalPeriods + 1);
  for (const phase of src.phases) {
    const phaseAssets = src.assets.filter((a) => a.phaseId === phase.id && a.visible);
    for (const asset of phaseAssets) {
      const breakdown = computeAssetCost(
        asset,
        src.project,
        phase,
        src.parcels,
        src.assets,
        src.subUnits,
        src.costLines,
        src.costOverrides,
        src.landAllocationMode,
        // M2.0 Pass 14 (2026-05-13): deferred-payment Land Cash spread.
        src.project.financing?.parcelFunding,
      );
      const series = pick(breakdown);
      for (let localPeriod = 0; localPeriod < series.length; localPeriod++) {
        const pp = costLineProjectPeriodIndex(src.project, phase, localPeriod);
        if (pp < 0 || pp >= out.length) continue;
        out[pp] += series[localPeriod];
      }
    }
  }
  return out;
}

// Cash-deficit local simulation. Walks period-by-period from t=0 up to
// `prevPeriod` accumulating capex outflows (excl. land in-kind), debt
// drawdowns (sameAsCost proxy), and interest paid (simple straight-line
// against ltvPct of cumulative capex). Stub until Cash Flow engine ships.
function simulateClosingCash(
  src: FinancingHooksSource,
  capexExclInKind: PeriodArray,
  prevPeriod: number,
): number {
  if (prevPeriod < 0) return src.project.financing?.cashDeficitConfig?.initialCash ?? 0;
  let cash = src.project.financing?.cashDeficitConfig?.initialCash ?? 0;
  const ratio = src.project.financing?.cashDeficitConfig
    ? src.project.financing.cashDeficitConfig.debtPct / 100
    : 0.7;
  const sumOutstandingDebt: PeriodArray = zeros(capexExclInKind.length);
  let cumDrawn = 0;
  for (let t = 0; t <= Math.min(prevPeriod, capexExclInKind.length - 1); t++) {
    const capex = capexExclInKind[t] ?? 0;
    const draw = capex * ratio;
    const equityCash = capex * (1 - ratio);
    cumDrawn += draw;
    sumOutstandingDebt[t] = cumDrawn;
    cash += equityCash + draw - capex;
    const weightedRate = avgInterestRate(src.financingTranches);
    const interest = sumOutstandingDebt[t] * weightedRate;
    cash -= interest;
  }
  return cash;
}

function avgInterestRate(tranches: FinancingTranche[]): number {
  if (tranches.length === 0) return 0.075;
  const ratesByTranche = tranches.map((t) => {
    if (t.interestRateType === 'floating' && typeof t.spreadBps === 'number') {
      return (4.0 + t.spreadBps / 100) / 100;
    }
    return Math.max(0, (t.interestRatePct ?? 0) / 100);
  });
  return ratesByTranche.reduce((a, b) => a + b, 0) / ratesByTranche.length;
}

export function createFinancingHooks(src: FinancingHooksSource): FinancingDataHooks {
  const timeline = computeProjectTimeline(src.project, src.phases);
  // perPeriod arrays are length constructionPeriods+1, so out array is
  // totalPeriods+1 to cover the latest possible bucket.
  const totalPeriods = Math.max(0, timeline.totalPeriods);

  let memoCapexIncl: PeriodArray | null = null;
  let memoCapexExclInKind: PeriodArray | null = null;
  let memoCapexExclTotalLand: PeriodArray | null = null;
  let memoLandInKindValue: number | null = null;

  const getCapexInclLandInKind = (): PeriodArray => {
    if (memoCapexIncl) return memoCapexIncl;
    memoCapexIncl = aggregateProjectPeriodArray(src, totalPeriods, (b) => b.perPeriod);
    return memoCapexIncl;
  };

  const getCapexExclLandInKind = (): PeriodArray => {
    if (memoCapexExclInKind) return memoCapexExclInKind;
    const incl = getCapexInclLandInKind();
    const inKindOnly = aggregateProjectPeriodArray(src, totalPeriods, (b) => b.perPeriodLandInKind);
    memoCapexExclInKind = incl.map((v, i) => Math.max(0, v - (inKindOnly[i] ?? 0)));
    return memoCapexExclInKind;
  };

  const getCapexExclTotalLand = (): PeriodArray => {
    if (memoCapexExclTotalLand) return memoCapexExclTotalLand;
    const incl = getCapexInclLandInKind();
    const landTotal = aggregateProjectPeriodArray(src, totalPeriods, (b) => b.perPeriodLandTotal);
    memoCapexExclTotalLand = incl.map((v, i) => Math.max(0, v - (landTotal[i] ?? 0)));
    return memoCapexExclTotalLand;
  };

  const getLandInKindValue = (): number => {
    if (memoLandInKindValue !== null) return memoLandInKindValue;
    const inKindPerPeriod = aggregateProjectPeriodArray(src, totalPeriods, (b) => b.perPeriodLandInKind);
    memoLandInKindValue = inKindPerPeriod.reduce((a, b) => a + b, 0);
    return memoLandInKindValue;
  };

  // P3-Fix 2 (2026-05-12): per-asset capex schedule. Walks one specific
  // asset and aggregates its breakdown.perPeriod across the project
  // timeline. When assetId is omitted, returns getCapexInclLandInKind
  // (project-wide).
  const getCapexSchedule = (assetId?: string): PeriodArray => {
    if (!assetId) return getCapexInclLandInKind();
    const out = zeros(totalPeriods + 1);
    const asset = src.assets.find((a) => a.id === assetId && a.visible);
    if (!asset) return out;
    const phase = src.phases.find((p) => p.id === asset.phaseId);
    if (!phase) return out;
    const breakdown = computeAssetCost(
      asset, src.project, phase, src.parcels, src.assets, src.subUnits,
      src.costLines, src.costOverrides, src.landAllocationMode,
      src.project.financing?.parcelFunding,
    );
    for (let localPeriod = 0; localPeriod < breakdown.perPeriod.length; localPeriod++) {
      const pp = costLineProjectPeriodIndex(src.project, phase, localPeriod);
      if (pp < 0 || pp >= out.length) continue;
      out[pp] += breakdown.perPeriod[localPeriod] ?? 0;
    }
    return out;
  };

  // P3-Fix 2 (2026-05-12): land cash value = parcels' total cash share.
  // Simple sum across parcels (project-wide), uses parcel.area x parcel.rate
  // x cashPct / 100.
  const getLandCashValue = (): number => {
    let total = 0;
    for (const p of src.parcels) {
      const cashPct = Math.max(0, Math.min(100, p.cashPct ?? 100));
      total += Math.max(0, p.area) * Math.max(0, p.rate) * (cashPct / 100);
    }
    return total;
  };

  const getPreSalesCollections = (): PeriodArray => zeros(totalPeriods + 1);
  const getOperatingCashFlow = (): PeriodArray => zeros(totalPeriods + 1);
  const getDepreciationSchedule = (): PeriodArray => zeros(totalPeriods + 1);
  const getRevenueSchedule = (): PeriodArray => zeros(totalPeriods + 1);
  const getOperatingExpenses = (): PeriodArray => zeros(totalPeriods + 1);
  // P10-Fix 10 (2026-05-12): commission revenue hooks. Zero-stub
  // until M2.1 Revenue ships. assetId is honored at the contract
  // level even though both bases return zero today (the M2.1
  // implementation will filter by assetId when set).
  const getTotalRevenueCashBasis = (_assetId?: string): PeriodArray => zeros(totalPeriods + 1);
  const getTotalRevenueSaleBasis = (_assetId?: string): PeriodArray => zeros(totalPeriods + 1);

  const getClosingCashBalance = (prevPeriod: number): number => {
    if (prevPeriod < 0) return src.project.financing?.cashDeficitConfig?.initialCash ?? 0;
    return simulateClosingCash(src, getCapexExclLandInKind(), prevPeriod);
  };

  return {
    getCapexExclLandInKind,
    getCapexInclLandInKind,
    getCapexExclTotalLand,
    getCapexSchedule,
    getLandInKindValue,
    getLandCashValue,
    getPreSalesCollections,
    getOperatingCashFlow,
    getClosingCashBalance,
    getDepreciationSchedule,
    getRevenueSchedule,
    getOperatingExpenses,
    getTotalRevenueCashBasis,
    getTotalRevenueSaleBasis,
  };
}

// Convenience: pass-through that some callers may use to share the
// same memoised hook bag across multiple components without re-
// computing capex per render.
export function createNoopHooks(totalPeriods: number): FinancingDataHooks {
  return {
    getCapexExclLandInKind: () => zeros(totalPeriods + 1),
    getCapexInclLandInKind: () => zeros(totalPeriods + 1),
    getCapexExclTotalLand: () => zeros(totalPeriods + 1),
    getCapexSchedule: () => zeros(totalPeriods + 1),
    getLandInKindValue: () => 0,
    getLandCashValue: () => 0,
    getPreSalesCollections: () => zeros(totalPeriods + 1),
    getOperatingCashFlow: () => zeros(totalPeriods + 1),
    getClosingCashBalance: () => 0,
    getDepreciationSchedule: () => zeros(totalPeriods + 1),
    getRevenueSchedule: () => zeros(totalPeriods + 1),
    getOperatingExpenses: () => zeros(totalPeriods + 1),
    getTotalRevenueCashBasis: () => zeros(totalPeriods + 1),
    getTotalRevenueSaleBasis: () => zeros(totalPeriods + 1),
  };
}
