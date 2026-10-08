/**
 * M5 Returns, Pass 1 analytics (2026-06-02).
 *
 * Pure functions producing the Development Economics / Exit Analysis /
 * Sources & Uses / Equity Exposure / Stabilization / Debt Analytics blocks.
 * No snapshot or store coupling: the refm resolver extracts the primitive
 * inputs from the financials snapshot and calls these.
 *
 * Sign convention for cash-flow streams matches the rest of the returns
 * engine: NEGATIVE = invested, POSITIVE = returned.
 */
import { safeRatio } from './metrics';
import type {
  DevelopmentEconomics, ExitAnalysis, SourcesUses,
  EquityExposureDetail, StabilizationMetrics, DebtAnalytics,
} from './types';

/** Development economics: GDV vs cost, profit before/after financing. */
export function developmentEconomics(
  gdv: number,
  totalDevelopmentCost: number,
  totalFinancingCost: number,
  /**
   * THE OPERATING EXPENSES OVER THE SAME YEARS AS THE GDV (2026-10-08, founder). The GDV is the revenue
   * over the hold, hotel and lease income included, so the surplus deducts what earning it cost: the
   * operating expenses and the selling and marketing expensed as incurred. Without it the surplus counted
   * operating revenue and none of its cost, and expensing marketing made that cost vanish from the summary.
   * Fund fees are not here; the summary states them beside the surplus. Defaults to 0 for a caller with none.
   */
  operatingExpenses = 0,
): DevelopmentEconomics {
  const profitBeforeFinancing = gdv - totalDevelopmentCost - operatingExpenses;
  const profitAfterFinancing = profitBeforeFinancing - totalFinancingCost;
  return {
    gdv,
    totalDevelopmentCost,
    totalFinancingCost,
    operatingExpenses,
    profitBeforeFinancing,
    profitAfterFinancing,
    developmentMargin: safeRatio(profitAfterFinancing, gdv),
    costToValue: safeRatio(totalDevelopmentCost, gdv),
  };
}

/** Exit-year snapshot (mostly a structured passthrough + ratio guards). */
export function exitAnalysis(args: {
  exitYearLabel: number;
  exitNOI: number;
  exitEBITDA: number;
  exitEnterpriseValue: number;
  exitEquityValue: number;
  exitDebt: number;
}): ExitAnalysis {
  const { exitYearLabel, exitNOI, exitEBITDA, exitEnterpriseValue, exitEquityValue, exitDebt } = args;
  return {
    exitYearLabel,
    exitNOI,
    exitEBITDA,
    exitEnterpriseValue,
    exitEquityValue,
    exitDebt,
    ltvAtExit: safeRatio(exitDebt, exitEnterpriseValue),
    debtYield: safeRatio(exitNOI, exitDebt),
    capRate: safeRatio(exitNOI, exitEnterpriseValue),
  };
}

/** Sources & uses of capital over the hold, fully reconciled. Sources =
 *  equity (existing / cash / in-kind) + debt (existing / new) + customer
 *  collections (pre-sales) + operating cash. Uses = land + construction + IDC
 *  + reserves/distributions (the balancing line when funding exceeds cost).
 *  Operating cash is the balancing SOURCE when cost exceeds the other funding;
 *  reserves/distributions is the balancing USE when funding exceeds cost, so
 *  totalSources === totalUses always. */
export function sourcesUses(args: {
  existingEquity: number;
  newEquityCash: number;
  inKindEquity: number;
  existingDebt: number;
  newDebt: number;
  customerCollections: number;
  land: number;
  construction: number;
  idc: number;
}): SourcesUses {
  const { existingEquity, newEquityCash, inKindEquity, existingDebt, newDebt, customerCollections, land, construction, idc } = args;
  const baseUses = land + construction + idc;
  const nonOpSources = existingEquity + newEquityCash + inKindEquity + existingDebt + newDebt + customerCollections;
  const operatingCash = Math.max(0, baseUses - nonOpSources);        // funds the gap if cost > funding
  const reservesDistributions = Math.max(0, nonOpSources - baseUses); // excess funding goes to reserves/distributions
  const totalSources = nonOpSources + operatingCash;
  const totalUses = baseUses + reservesDistributions;
  return {
    existingEquity,
    newEquityCash,
    inKindEquity,
    existingDebt,
    newDebt,
    customerCollections,
    operatingCash,
    totalSources,
    land,
    construction,
    idc,
    reservesDistributions,
    totalUses,
  };
}

/** Capital-structure mix as fractions of total sources (decimals). */
export function fundingMix(su: SourcesUses): {
  debtPct: number | null;
  cashEquityPct: number | null;
  inKindEquityPct: number | null;
  customerFundingPct: number | null;
} {
  const total = su.totalSources;
  return {
    debtPct: safeRatio(su.existingDebt + su.newDebt, total),
    cashEquityPct: safeRatio(su.existingEquity + su.newEquityCash, total),
    inKindEquityPct: safeRatio(su.inKindEquity, total),
    customerFundingPct: safeRatio(su.customerCollections, total),
  };
}

/** Expanded equity-exposure detail from the FCFE stream + equity series. */
export function equityExposure(args: {
  /** Signed FCFE per period (neg = invested), inception-prefixed. */
  fcfePerPeriod: number[];
  /** Year label per FCFE index (same length as fcfePerPeriod). */
  streamYearLabels: number[];
  /** Cumulative equity invested per period (axis-indexed). */
  cumulativeEquityPerPeriod: number[];
  /** Total equity required (cash + in-kind + existing). */
  totalEquityRequired: number;
  /** Dividends distributed per period (axis-indexed). */
  dividendsPerPeriod: number[];
  /** Year label per axis index. */
  axisYearLabels: number[];
}): EquityExposureDetail {
  const { fcfePerPeriod, streamYearLabels, cumulativeEquityPerPeriod, totalEquityRequired, dividendsPerPeriod, axisYearLabels } = args;

  // Peak negative cumulative FCFE (peak equity outflow exposure).
  let run = 0;
  let maxNeg = 0;
  let firstPositiveCFYear: number | null = null;
  for (let i = 0; i < fcfePerPeriod.length; i++) {
    run += fcfePerPeriod[i] ?? 0;
    if (run < -maxNeg) maxNeg = -run;
    if (firstPositiveCFYear === null && (fcfePerPeriod[i] ?? 0) > 0) {
      firstPositiveCFYear = streamYearLabels[i] ?? null;
    }
  }

  // Average equity invested across the periods where equity is committed.
  const invested = cumulativeEquityPerPeriod.filter((v) => v > 0);
  const averageEquityInvested = invested.length > 0
    ? invested.reduce((s, v) => s + v, 0) / invested.length
    : 0;
  const equityAtRisk = cumulativeEquityPerPeriod.reduce((m, v) => Math.max(m, v), 0);

  let firstDividendYear: number | null = null;
  for (let i = 0; i < dividendsPerPeriod.length; i++) {
    if ((dividendsPerPeriod[i] ?? 0) > 0) { firstDividendYear = axisYearLabels[i] ?? null; break; }
  }

  return {
    totalEquityRequired,
    averageEquityInvested,
    maxNegativeCumulativeCF: maxNeg,
    firstPositiveCFYear,
    firstDividendYear,
    equityAtRisk,
  };
}

/** Half a point of growth above the steady rate still counts as steady. */
export const STABILISATION_GROWTH_TOLERANCE = 0.005;

/** Stabilization metrics for income-producing assets. */
export function stabilizationMetrics(args: {
  noiPerPeriod: number[];
  stabilisedNOI: number;
  stabilisedYieldOnCost: number | null;
  axisYearLabels: number[];
  /** Axis index of the capitalised year (the steady growth is read into it). */
  metricIdx?: number;
  /** Fallback only: fraction of stabilised NOI that counts as "stabilised" (default 0.95). */
  threshold?: number;
}): StabilizationMetrics {
  const { noiPerPeriod, stabilisedNOI, stabilisedYieldOnCost, axisYearLabels } = args;
  const threshold = args.threshold ?? 0.95;
  const hasIncomeAssets = noiPerPeriod.some((v) => (v ?? 0) > 0) && stabilisedNOI > 0;
  let stabilizationYear: number | null = null;
  // STABILISED = THE RAMP IS OVER (2026-10-05, export review). The year NOI
  // stops growing faster than it grows into the capitalised year, i.e. the
  // first year after which every year's growth is at most that steady growth
  // (plus half a point), which is indexation alone once a scheme is let and
  // open. It needs no indexation rate (they differ by asset and by ADR, rent
  // and opex), and it holds at any rate and any exit year. The old test, the
  // first year at 95% of the capitalised NOI, named the year before the
  // capitalised one whenever indexation ran under about 5%, ramp or no ramp.
  // PREMISE: growth into the capitalised year is the steady rate, which is what
  // a cap-rate exit already assumes of that year's income. Where NOI still
  // ramps into it, the measure inherits that assumption.
  const m = args.metricIdx;
  const growth = (t: number): number | null => {
    const prev = noiPerPeriod[t - 1] ?? 0, cur = noiPerPeriod[t] ?? 0;
    return t > 0 && prev > 0 ? cur / prev - 1 : null;
  };
  const steady = m !== undefined ? growth(m) : null;
  if (hasIncomeAssets && m !== undefined && steady !== null) {
    const ceiling = steady + STABILISATION_GROWTH_TOLERANCE;
    let year = m;
    while (year - 1 >= 0 && (noiPerPeriod[year - 1] ?? 0) > 0 && (growth(year) ?? Infinity) <= ceiling) year -= 1;
    stabilizationYear = axisYearLabels[year] ?? null;
  } else if (hasIncomeAssets) {
    // No growth to read (the capitalised year is the first with income, or
    // none was given): the first year at 95% of the capitalised NOI.
    const target = stabilisedNOI * threshold;
    for (let i = 0; i < noiPerPeriod.length; i++) {
      if ((noiPerPeriod[i] ?? 0) >= target) { stabilizationYear = axisYearLabels[i] ?? null; break; }
    }
  }
  return {
    stabilisedNOI,
    stabilisedYieldOnCost,
    stabilizationYear,
    hasIncomeAssets,
  };
}

/** Debt analytics over the hold (axis-indexed outstanding balance). */
export function debtAnalytics(args: {
  debtOutstandingPerPeriod: number[];
  exitIdx: number;
  axisYearLabels: number[];
}): DebtAnalytics {
  const { debtOutstandingPerPeriod, exitIdx, axisYearLabels } = args;
  const peakDebt = debtOutstandingPerPeriod.reduce((m, v) => Math.max(m, v ?? 0), 0);
  const withDebt = debtOutstandingPerPeriod.filter((v) => (v ?? 0) > 0);
  const averageDebtOutstanding = withDebt.length > 0
    ? withDebt.reduce((s, v) => s + v, 0) / withDebt.length
    : 0;
  const remainingDebtAtExit = Math.max(0, debtOutstandingPerPeriod[exitIdx] ?? 0);
  const paydownPct = peakDebt > 0 ? (peakDebt - remainingDebtAtExit) / peakDebt : null;

  // Tenor: first year debt > 0 to the year it is fully repaid (or exit).
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < debtOutstandingPerPeriod.length; i++) {
    if ((debtOutstandingPerPeriod[i] ?? 0) > 0) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  let tenorYears: number | null = null;
  if (firstIdx >= 0) {
    const firstYr = axisYearLabels[firstIdx] ?? firstIdx;
    const endYr = axisYearLabels[lastIdx] ?? lastIdx;
    tenorYears = endYr - firstYr + 1;
  }
  return { peakDebt, averageDebtOutstanding, remainingDebtAtExit, paydownPct, tenorYears };
}
