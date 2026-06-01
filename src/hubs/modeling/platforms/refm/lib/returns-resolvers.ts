/**
 * M5 Returns resolver.
 *
 * Maps an M4 financials snapshot (computeFinancialsSnapshot) onto the pure
 * returns engine (src/core/calculations/returns). Builds the three signed
 * cash-flow streams, the terminal value, and the real-estate metric
 * feeders, then calls computeReturns. No engine (M1-M4) path is touched.
 *
 * Cash-flow definitions (documented so the UI + verifier agree):
 *   FCFF (unlevered / project) = CFO + CFI - in-kind land, + terminal EV
 *     at exit. Pre-financing project cash flow to all capital providers.
 *     Tax is the modelled (levered) tax, the standard project-IRR
 *     convention for this kind of feasibility model.
 *   FCFE (levered / equity free cash flow) = FCFF + debt drawdown
 *     - principal repaid - interest paid, + terminal EQUITY value at exit.
 *     The negative periods are the equity actually required after debt.
 *   Dividends (realised distributions) = -(cash + in-kind equity
 *     contributed) + dividends distributed, + terminal equity at exit.
 *
 * Exit handling: cash flows are taken through the exit year (default last
 * active year). Periods AFTER exit are dropped and the terminal value is
 * added to the exit-year flow.
 */
import {
  computeReturns, terminalEnterpriseValue, terminalEquityValue,
} from '@/src/core/calculations/returns';
import type { ReturnsResult, ReturnsInput, TerminalMethod } from '@/src/core/calculations/returns';
import type { ProjectFinancialsSnapshot } from './financials-resolvers';
import type { Project } from './state/module1-types';

export interface ReturnsConfig {
  discountRate: number;
  /** 0-based axis index of the exit year. */
  exitYearOffset: number;
  terminalMethod: TerminalMethod;
  exitMultiple: number;
  perpetuityGrowth: number;
}

export const DEFAULT_RETURNS_CONFIG: Omit<ReturnsConfig, 'exitYearOffset'> = {
  discountRate: 0.10,
  terminalMethod: 'exit_multiple',
  exitMultiple: 8,
  perpetuityGrowth: 0.02,
};

/** Resolve the stored project config + defaults into a concrete config. */
export function resolveReturnsConfig(project: Project, axisLength: number): ReturnsConfig {
  const r = project.returns ?? {};
  const lastIdx = Math.max(0, axisLength - 1);
  let exit = r.exitYearOffset ?? lastIdx;
  if (!Number.isFinite(exit)) exit = lastIdx;
  exit = Math.max(0, Math.min(lastIdx, Math.round(exit)));
  return {
    discountRate: Math.max(0, r.discountRate ?? DEFAULT_RETURNS_CONFIG.discountRate),
    exitYearOffset: exit,
    terminalMethod: r.terminalMethod ?? DEFAULT_RETURNS_CONFIG.terminalMethod,
    exitMultiple: Math.max(0, r.exitMultiple ?? DEFAULT_RETURNS_CONFIG.exitMultiple),
    perpetuityGrowth: r.perpetuityGrowth ?? DEFAULT_RETURNS_CONFIG.perpetuityGrowth,
  };
}

export interface ReturnsSnapshot {
  axisLength: number;
  yearLabels: number[];
  config: ReturnsConfig;
  exitYearLabel: number;
  /** Signed per-period streams (truncated at exit), for display + audit. */
  fcffPerPeriod: number[];
  fcfePerPeriod: number[];
  dividendStreamPerPeriod: number[];
  /** NOI per period (recurring hospitality + lease income net of opex). */
  noiPerPeriod: number[];
  stabilisedNOI: number;
  exitNOI: number;
  terminalEnterpriseValue: number;
  terminalEquityValue: number;
  totalDevelopmentCost: number;
  totalEquityInvested: number;
  result: ReturnsResult;
}

function cumulative(arr: number[]): number[] {
  const out = new Array<number>(arr.length).fill(0);
  let run = 0;
  for (let i = 0; i < arr.length; i++) { run += arr[i] ?? 0; out[i] = run; }
  return out;
}

/** Build the full M5 returns snapshot from an M4 financials snapshot. */
export function computeReturnsSnapshot(snap: ProjectFinancialsSnapshot, project: Project): ReturnsSnapshot {
  const N = snap.axisLength;
  const cfg = resolveReturnsConfig(project, N);
  const exit = cfg.exitYearOffset;
  const E = exit + 1; // length of the truncated streams (through exit)

  const dcf = snap.directCF;
  const pl = snap.pl;
  const fin = snap.financing;
  const bs = snap.bs;

  // Recurring NOI per period (income-producing assets only).
  const noiPerPeriod = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) {
    noiPerPeriod[t] = (pl.hospitalityRevenuePerPeriod[t] ?? 0) + (pl.retailRevenuePerPeriod[t] ?? 0)
      - (pl.hospitalityOpexPerPeriod[t] ?? 0) - (pl.retailOpexPerPeriod[t] ?? 0);
  }
  const exitNOI = noiPerPeriod[exit] ?? 0;
  // Stabilised NOI = the larger of exit-year NOI and the max NOI achieved
  // (so an exit during a dip still reports a sensible stabilised figure).
  const stabilisedNOI = Math.max(exitNOI, ...noiPerPeriod.slice(0, E), 0);

  // Terminal value. Exit-multiple is applied to stabilised NOI; perpetuity
  // to the exit-year unlevered free cash flow.
  const fcffPreExit = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) {
    fcffPreExit[t] = (dcf.cashFromOperationsPerPeriod[t] ?? 0)
      + (dcf.cashFromInvestmentPerPeriod[t] ?? 0)
      - (dcf.equityInKindDrawdownPerPeriod[t] ?? 0);
  }
  const exitFcff = fcffPreExit[exit] ?? 0;
  const tvEnterprise = terminalEnterpriseValue({
    method: cfg.terminalMethod,
    exitMetric: cfg.terminalMethod === 'perpetuity' ? exitFcff : stabilisedNOI,
    exitMultiple: cfg.exitMultiple,
    perpetuityGrowth: cfg.perpetuityGrowth,
    discountRate: cfg.discountRate,
  });
  const debtAtExit = bs.debtOutstandingPerPeriod[exit] ?? 0;
  // Terminal EQUITY value = sale proceeds (EV) net of the loan payoff at
  // exit. Cash on the balance sheet is deliberately NOT added: it was
  // already counted within the FCFE / dividend streams as it was earned
  // (adding it again double-counts), and a 'none' terminal method then
  // correctly books zero residual.
  const tvEquity = terminalEquityValue(tvEnterprise, debtAtExit, 0);

  // ── Stream 1: FCFF (unlevered) ──────────────────────────────────────
  const fcff = fcffPreExit.slice(0, E);
  fcff[exit] = (fcff[exit] ?? 0) + tvEnterprise;

  // ── Stream 2: FCFE (levered) ────────────────────────────────────────
  const fcfe = new Array<number>(E).fill(0);
  for (let t = 0; t < E; t++) {
    fcfe[t] = (fcffPreExit[t] ?? 0)
      + (dcf.debtDrawdownPerPeriod[t] ?? 0)
      + (dcf.debtRepaymentPerPeriod[t] ?? 0)  // already negative
      + (dcf.interestPaidPerPeriod[t] ?? 0);  // already negative
  }
  fcfe[exit] = (fcfe[exit] ?? 0) + tvEquity;

  // ── Stream 3: Dividends (realised equity) ───────────────────────────
  const equityCash = fin.equity.cashPerPeriod;
  const equityInKind = fin.equity.inKindPerPeriod;
  const dividendsPaid = snap.dividends.totalDividendsPerPeriod;
  const dividendStream = new Array<number>(E).fill(0);
  for (let t = 0; t < E; t++) {
    dividendStream[t] = -((equityCash[t] ?? 0) + (equityInKind[t] ?? 0)) + (dividendsPaid[t] ?? 0);
  }
  dividendStream[exit] = (dividendStream[exit] ?? 0) + tvEquity;

  // ── Real-estate metric feeders ──────────────────────────────────────
  const totalDevelopmentCost = fin.capex.totals.inclAllLand;
  const totalRevenue = pl.totalRevenuePerPeriod.slice(0, E).reduce((s, v) => s + v, 0);
  const totalPAT = pl.patPerPeriod.slice(0, E).reduce((s, v) => s + v, 0);
  const totalEquityInvested = Math.max(0, fin.equity.grandTotal);
  const totalDividends = dividendsPaid.slice(0, E).reduce((s, v) => s + v, 0);
  const debtServicePerPeriod = fin.combined.debtServiceCash.slice(0, N);
  const cumulativeEquity = cumulative(
    fin.equity.cashPerPeriod.map((v, i) => (v ?? 0) + (equityInKind[i] ?? 0)),
  ).map((v, i) => v + fin.equity.totalExisting); // existing equity is in from t=0

  const input: ReturnsInput = {
    axisLength: E,
    fcff: { perPeriod: fcff },
    fcfe: { perPeriod: fcfe },
    dividends: { perPeriod: dividendStream },
    discountRate: cfg.discountRate,
    metrics: {
      stabilisedNOI,
      totalDevelopmentCost,
      totalRevenue,
      totalCost: totalDevelopmentCost,
      totalPAT,
      exitNOI,
      exitEnterpriseValue: tvEnterprise,
      debtOutstandingAtExit: debtAtExit,
      totalEquityInvested,
      totalEquityDistributions: totalDividends + tvEquity,
      cfadsPerPeriod: pl.ebitdaPerPeriod.slice(0, N),
      debtServicePerPeriod,
      ebitdaPerPeriod: pl.ebitdaPerPeriod.slice(0, N),
      interestPerPeriod: pl.interestExpensePerPeriod.slice(0, N),
      distributionPerPeriod: dividendsPaid.slice(0, N),
      cumulativeEquityPerPeriod: cumulativeEquity.slice(0, N),
      equityInvestedPerPeriod: fin.equity.totalPerPeriod.slice(0, N),
    },
  };

  return {
    axisLength: N,
    yearLabels: snap.yearLabels,
    config: cfg,
    exitYearLabel: snap.yearLabels[exit] ?? (snap.projectStartYear + exit),
    fcffPerPeriod: fcff,
    fcfePerPeriod: fcfe,
    dividendStreamPerPeriod: dividendStream,
    noiPerPeriod,
    stabilisedNOI,
    exitNOI,
    terminalEnterpriseValue: tvEnterprise,
    terminalEquityValue: tvEquity,
    totalDevelopmentCost,
    totalEquityInvested,
    result: computeReturns(input),
  };
}
