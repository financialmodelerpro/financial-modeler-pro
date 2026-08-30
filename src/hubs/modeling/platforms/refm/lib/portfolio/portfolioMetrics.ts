/**
 * portfolioMetrics.ts
 *
 * Portfolio figures across projects. TWO pure layers, deliberately separate:
 *
 *   1. projectPortfolioMetrics(state)  - runs the SAME engine the workspace
 *      runs (computeFinancialsSnapshot -> computeReturnsSnapshot) over ONE
 *      project's model and extracts the portfolio-relevant figures. It reads
 *      the engine; it computes no economics of its own, so a portfolio number
 *      can never disagree with the project that produced it.
 *
 *   2. aggregatePortfolio(metrics[])   - combines them. This is where the
 *      correctness rules live, and they are not obvious:
 *
 *      * CURRENCY: totals are per currency. Adding SAR to USD is silently
 *        wrong, so a mixed portfolio produces one group per currency and the
 *        UI states it rather than a single meaningless number.
 *      * CALENDAR YEARS: projects start in different years, so every series
 *        is aligned on the ABSOLUTE year (the engine's own year labels), never
 *        on period index. Summing index 0 with index 0 would add a 2026 to a
 *        2027.
 *      * IRR IS NOT AVERAGEABLE. There is no such thing as a blended IRR: an
 *        average (even weighted) of IRRs is not the IRR of anything. The
 *        portfolio IRR here is computed ONCE, on the SUM of the per-project
 *        signed cash-flow streams aligned by calendar year. The equity
 *        multiple, being a ratio of sums, IS aggregable and is summed.
 *      * PEAK DEBT is the maximum of the SUMMED debt series, not the sum of
 *        per-project peaks: two projects peaking in different years never owe
 *        their peaks at the same time.
 *      * A project with no model contributes nothing and is COUNTED OUT, so
 *        an empty project cannot drag a ratio towards zero. Every ratio is
 *        reported with "N of M modelled".
 *
 * Pure and IO-free: the route feeds it hydrated models, the verifier feeds it
 * fixtures.
 *
 * No em dashes in this file.
 */
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../financials-resolvers';
import { computeReturnsSnapshot } from '../returns-resolvers';
import { computeSubUnitArea } from '@/src/core/calculations';
import { irr } from '@/src/core/calculations/returns/irr';
import type { SubUnit } from '../state/module1-types';

export interface ProjectPortfolioMetrics {
  projectId: string;
  name: string;
  currency: string;
  /** False when the project carries no model worth aggregating (no assets or
   *  no sub-units). Such a project is listed but excluded from every total and
   *  every ratio. */
  modelled: boolean;
  gdv: number;
  totalDevelopmentCost: number;
  totalFinancingCost: number;
  fundingRequirement: number;
  saleableAreaSqm: number;
  saleableUnits: number;
  equityInvested: number;
  equityDistributions: number;
  /** Calendar year -> value, so aggregation never touches a period index.
   *  BOTH are load-bearing: debtByYear is summed across projects and its MAX
   *  taken for peak debt, fcfeByYear is summed and the portfolio IRR computed
   *  once over the combined stream. Neither exists for a chart.
   *  (A fundingByYear series lived here too until 2026-08-30 and fed only the
   *  portfolio chart; it went with the chart. The single-project funding series
   *  is defined once in ./fundingSeries.) */
  debtByYear: Record<number, number>;
  fcfeByYear: Record<number, number>;
  /** The project's own IRR, for the per-project list (never averaged). */
  projectIrr: number | null;
  equityIrr: number | null;
  error?: string;
}

/** Pair a per-period series with the engine's own year labels. */
function byYear(series: number[] | undefined, labels: number[] | undefined): Record<number, number> {
  const out: Record<number, number> = {};
  if (!series || !labels) return out;
  for (let i = 0; i < series.length; i++) {
    const y = labels[i];
    if (y == null || !Number.isFinite(y)) continue;
    out[y] = (out[y] ?? 0) + (series[i] ?? 0);
  }
  return out;
}

/**
 * Run the engine over ONE project's BASE model and extract its portfolio
 * figures. Never throws: a project whose model cannot be computed is returned
 * as un-modelled with its error, so one bad project cannot blank the
 * dashboard.
 */
export function projectPortfolioMetrics(
  projectId: string,
  name: string,
  state: FinancialsResolverState,
): ProjectPortfolioMetrics {
  const project = (state as { project?: { currency?: string } }).project ?? {};
  const subUnits = ((state as { subUnits?: SubUnit[] }).subUnits ?? []);
  const assets = ((state as { assets?: unknown[] }).assets ?? []);
  const base: ProjectPortfolioMetrics = {
    projectId, name,
    currency: (project.currency ?? '').trim() || 'n/a',
    modelled: false,
    gdv: 0, totalDevelopmentCost: 0, totalFinancingCost: 0, fundingRequirement: 0,
    saleableAreaSqm: 0, saleableUnits: 0, equityInvested: 0, equityDistributions: 0,
    debtByYear: {}, fcfeByYear: {},
    projectIrr: null, equityIrr: null,
  };
  // An empty project is not an error and not a zero: it is simply not modelled.
  if (assets.length === 0 || subUnits.length === 0) return base;

  try {
    const snap = computeFinancialsSnapshot(state);
    const rs = computeReturnsSnapshot(snap, (state as { project: Parameters<typeof computeReturnsSnapshot>[1] }).project);
    const de = rs.developmentEconomics;
    // The Method 3 waterfall is the canonical funding-requirement view, the
    // same one the Financing tab's Funding Gap sub-tab reports.
    const gap = computeFundingGap(snap).method3Waterfall;

    // Saleable area and units: the shared sub-unit rule, never a local copy.
    let areaSqm = 0; let units = 0;
    for (const u of subUnits) {
      if (u.category !== 'Sellable') continue;
      areaSqm += computeSubUnitArea(u);
      const isUnitMode = u.metric === 'units' || (u.metric as unknown as string) === 'count';
      units += isUnitMode ? Math.max(0, u.metricValue) : 0;
    }

    return {
      ...base,
      modelled: true,
      gdv: de.gdv,
      totalDevelopmentCost: de.totalDevelopmentCost,
      totalFinancingCost: de.totalFinancingCost,
      fundingRequirement: gap.totalNetCashRequired,
      saleableAreaSqm: areaSqm,
      saleableUnits: units,
      equityInvested: rs.equityExposure?.totalEquityRequired ?? 0,
      equityDistributions: rs.result?.dividends?.totalInflow ?? 0,
      debtByYear: byYear(snap.bs.debtOutstandingPerPeriod, snap.yearLabels),
      fcfeByYear: byYear(rs.fcfePerPeriod, rs.streamYearLabels),
      projectIrr: rs.result?.fcff?.irr ?? null,
      equityIrr: rs.result?.fcfe?.irr ?? null,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'Could not compute this project' };
  }
}

export interface PortfolioYearPoint {
  year: number;
  /** projectId -> value, so the chart can stack by project. */
  byProject: Record<string, number>;
  total: number;
}

export interface PortfolioCurrencyGroup {
  currency: string;
  /** Every project in this currency, modelled or not. */
  projects: Array<{ projectId: string; name: string; modelled: boolean; gdv: number; irr: number | null; error?: string }>;
  modelledCount: number;
  projectCount: number;
  gdv: number;
  totalDevelopmentCost: number;
  totalFinancingCost: number;
  fundingRequirement: number;
  saleableAreaSqm: number;
  saleableUnits: number;
  /** Max of the SUMMED debt series (not the sum of per-project peaks). */
  peakDebt: number;
  peakDebtYear: number | null;
  /** IRR of the SUMMED equity cash flows. Null when it cannot be solved
   *  (no sign change, or nothing modelled). Never an average. */
  portfolioEquityIrr: number | null;
  /** Sum of distributions / sum of equity invested. A ratio of sums, so this
   *  one IS aggregable. */
  portfolioEquityMultiple: number | null;
}

export interface PortfolioAggregate {
  groups: PortfolioCurrencyGroup[];
  /** True when projects span more than one currency: totals are NOT summed
   *  across groups and the UI must say so. */
  mixedCurrency: boolean;
  projectCount: number;
  modelledCount: number;
  markets: number;
}

function stackByYear(
  metrics: ProjectPortfolioMetrics[],
  pick: (m: ProjectPortfolioMetrics) => Record<number, number>,
): PortfolioYearPoint[] {
  const years = new Set<number>();
  for (const m of metrics) for (const y of Object.keys(pick(m))) years.add(Number(y));
  if (years.size === 0) return [];
  // DENSE calendar axis: every year from first to last, gaps zero-filled.
  // A sparse axis would compress time, and an IRR over a compressed axis is
  // simply wrong: a 2026 outflow returning in 2030 would be discounted as if
  // it returned in 2028. Measured on the fixture: 9.50% sparse vs 4.87% true.
  const lo = Math.min(...years), hi = Math.max(...years);
  const axis: number[] = [];
  for (let y = lo; y <= hi; y++) axis.push(y);
  return axis.map((year) => {
    const byProject: Record<string, number> = {};
    let total = 0;
    for (const m of metrics) {
      const v = pick(m)[year] ?? 0;
      if (v === 0) continue;
      byProject[m.projectId] = v;
      total += v;
    }
    return { year, byProject, total };
  });
}

export function aggregatePortfolio(
  metrics: ProjectPortfolioMetrics[],
  markets = 0,
): PortfolioAggregate {
  const currencies = [...new Set(metrics.map((m) => m.currency))].sort();
  const groups: PortfolioCurrencyGroup[] = currencies.map((currency) => {
    const all = metrics.filter((m) => m.currency === currency);
    const live = all.filter((m) => m.modelled);

    const sum = (f: (m: ProjectPortfolioMetrics) => number) => live.reduce((s, m) => s + f(m), 0);

    // Peak debt: sum the series by calendar year FIRST, then take the max.
    const debtYears = stackByYear(live, (m) => m.debtByYear);
    let peakDebt = 0; let peakDebtYear: number | null = null;
    for (const pt of debtYears) if (pt.total > peakDebt) { peakDebt = pt.total; peakDebtYear = pt.year; }

    // Portfolio IRR: ONE irr() over the summed equity stream, by calendar year.
    const fcfeYears = stackByYear(live, (m) => m.fcfeByYear);
    const stream = fcfeYears.map((p) => p.total);
    const hasSignChange = stream.some((v) => v > 0) && stream.some((v) => v < 0);
    const portfolioEquityIrr = live.length > 0 && hasSignChange ? irr(stream) : null;

    const invested = sum((m) => m.equityInvested);
    const distributions = sum((m) => m.equityDistributions);

    return {
      currency,
      projects: all.map((m) => ({ projectId: m.projectId, name: m.name, modelled: m.modelled, gdv: m.gdv, irr: m.equityIrr, error: m.error })),
      modelledCount: live.length,
      projectCount: all.length,
      gdv: sum((m) => m.gdv),
      totalDevelopmentCost: sum((m) => m.totalDevelopmentCost),
      totalFinancingCost: sum((m) => m.totalFinancingCost),
      fundingRequirement: sum((m) => m.fundingRequirement),
      saleableAreaSqm: sum((m) => m.saleableAreaSqm),
      saleableUnits: sum((m) => m.saleableUnits),
      peakDebt,
      peakDebtYear,
      portfolioEquityIrr,
      portfolioEquityMultiple: invested > 0 ? distributions / invested : null,
    };
  });

  return {
    groups,
    mixedCurrency: groups.length > 1,
    projectCount: metrics.length,
    modelledCount: metrics.filter((m) => m.modelled).length,
    markets,
  };
}
