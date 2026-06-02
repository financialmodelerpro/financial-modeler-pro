/**
 * M5 Returns resolver.
 *
 * Maps an M4 financials snapshot (computeFinancialsSnapshot) onto the pure
 * returns engine (src/core/calculations/returns). Builds the three signed
 * cash-flow streams, the terminal value, and the real-estate metric
 * feeders, then calls computeReturns. No engine (M1-M4) path is touched.
 *
 * SPONSOR-IRR / PROJECT-INCEPTION view (2026-06-02). Real-estate sponsors
 * measure returns from project inception, including existing operations
 * already in the ground at t=0, new investments going forward, and in-kind
 * contributions at their fair value when contributed. Every stream therefore
 * leads with an INCEPTION period (index 0 = projectStartYear − 1) carrying
 * the existing capital, then the axis years 2026..exit. Streams are E+1 long.
 *
 * Cash-flow definitions (documented so the UI + verifier agree):
 *   FCFF (unlevered / to all capital providers):
 *     inception: − existing pre-capex
 *     axis:      + CFO + CFI (new construction capex). NO in-kind land line
 *                (land is non-cash and already flows through CFO via CoS /
 *                depreciation; adding it would double-count).
 *     exit:      + terminal enterprise value
 *   FCFE (levered / to equity):
 *     inception: − existing pre-capex + existing debt opening (= − existing
 *                equity contribution)
 *     axis:      FCFF axis + debt drawdown − principal − interest − in-kind
 *                land (the landowner is an equity investor contributing in
 *                non-cash form; their IRR is measured against its fair value)
 *     exit:      + terminal equity value (EV − debt at exit)
 *   Dividends (realised equity cash):
 *     inception: − existing equity
 *     axis:      − (cash + in-kind equity contributed) + dividends distributed
 *     exit:      + terminal equity value
 *
 * Bridge identity per period: FCFE = FCFF + debt drawdown − principal −
 * interest − in-kind equity + terminal-equity adjustment (the in-kind +
 * existing-debt-opening lines appear on FCFE only, never on FCFF).
 *
 * IRR is the headline metric (sponsor equity IRR from inception); NPV at the
 * user-set discount rate is still computed for completeness.
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

/**
 * Per-period component lines that BUILD UP each stream, so the UI can show
 * the step-by-step derivation (not just the final signed number). All
 * arrays are truncated to the hold horizon (exit + 1).
 */
// All build-up arrays are length E+1: index 0 is the INCEPTION period
// (projectStartYear − 1, the "existing operations at t=0" column); indices
// 1..E are the project axis years through exit. The sponsor-IRR view starts
// the stream at inception so existing equity + existing debt + in-kind land
// appear as real capital movements (see the 2026-06-02 sponsor-IRR rework).
export interface ReturnsBuildup {
  // Inception (2025) capital already in the ground at project start.
  existingPreCapexPerPeriod: number[];  // (-) existing pre-capex (FCFF + FCFE)
  existingDebtOpeningPerPeriod: number[];// (+) existing debt opening drawdown (FCFE)
  existingEquityPerPeriod: number[];    // (-) existing equity = preCapex − debt (dividend)
  // FCFF (unlevered) build-up
  cfoPerPeriod: number[];               // (+) cash from operations
  cfiPerPeriod: number[];               // (+) cash from investing (= -capex)
  inKindLandPerPeriod: number[];        // (-) in-kind land contributed (FCFE only)
  terminalEnterprisePerPeriod: number[];// (+) terminal enterprise value (exit only)
  // FCFE (levered) extra lines on top of unlevered FCFF
  debtDrawPerPeriod: number[];          // (+) debt drawdown
  principalRepayPerPeriod: number[];    // (-) principal repaid (already negative)
  interestPaidPerPeriod: number[];      // (-) interest paid (already negative)
  terminalEquityPerPeriod: number[];    // (+) terminal equity value (exit only)
  // Dividend (realised equity) build-up
  equityCashPerPeriod: number[];        // (-) cash equity contributed
  equityInKindPerPeriod: number[];      // (-) in-kind equity contributed
  dividendsDistributedPerPeriod: number[]; // (+) dividends paid (cash-sweep waterfall)
}

export interface ReturnsSnapshot {
  axisLength: number;
  yearLabels: number[];
  config: ReturnsConfig;
  exitYearLabel: number;
  /** Year labels for the signed streams: index 0 = inception
   *  (projectStartYear − 1), indices 1..E = axis years through exit.
   *  Length matches the stream arrays (E+1). */
  streamYearLabels: number[];
  /** Signed per-period streams, sponsor-IRR view. Index 0 = inception
   *  (existing operations at t=0), indices 1..E = axis years through exit. */
  fcffPerPeriod: number[];
  fcfePerPeriod: number[];
  dividendStreamPerPeriod: number[];
  /** Step-by-step component lines for each stream. */
  buildup: ReturnsBuildup;
  /** NOI per period (recurring hospitality + lease income net of opex). */
  noiPerPeriod: number[];
  stabilisedNOI: number;
  exitNOI: number;
  terminalEnterpriseValue: number;
  terminalEquityValue: number;
  totalDevelopmentCost: number;
  totalEquityInvested: number;
  /** Total dividends distributed over the hold (cash-sweep waterfall). */
  totalDividendsDistributed: number;
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

  // ── Sponsor-IRR inception view (2026-06-02) ─────────────────────────
  // Existing operations already in the ground at project start (the prior
  // / inception column = projectStartYear − 1). These are real capital
  // movements that MUST appear in the streams or the equity IRR is inflated
  // / infinite. Existing equity = existing pre-capex funded by anything not
  // covered by existing debt opening (preCapex − debtOpening).
  const existingPreCapex = Math.max(0, fin.existing.preCapexTotal);
  const existingDebtOpening = Math.max(0, fin.existing.debtOutstandingTotal);
  // Existing equity = pre-capex NOT covered by existing debt opening. NOT
  // clamped at 0: the FCFE inception (−preCapex + debtOpening) and the
  // dividend inception (−existingEquity) must be the SAME number, and the
  // FCFE build-up's two lines (−preCapex, +debtOpening) must foot to it. An
  // over-levered existing asset (debt > pre-capex) is a real cash-out at
  // inception on BOTH streams (2026-06-02 audit fixed the divergence).
  const existingEquity = existingPreCapex - existingDebtOpening;
  const equityCash = fin.equity.cashPerPeriod;
  const equityInKind = fin.equity.inKindPerPeriod;
  const dividendsPaid = snap.dividends.totalDividendsPerPeriod;

  // Axis-period (2026 onward) component slices.
  const sliceE = (arr: number[]): number[] => arr.slice(0, E).map((v) => v ?? 0);
  const cfoAxis = sliceE(dcf.cashFromOperationsPerPeriod);
  const cfiAxis = sliceE(dcf.cashFromInvestmentPerPeriod);  // new construction capex (cash)
  const inKindAxis = sliceE(equityInKind);                  // in-kind land contributed
  const debtDrawAxis = sliceE(dcf.debtDrawdownPerPeriod);
  const principalAxis = sliceE(dcf.debtRepaymentPerPeriod); // already negative
  const interestAxis = sliceE(dcf.interestPaidPerPeriod);   // already negative
  const equityCashAxis = sliceE(equityCash);
  const divPaidAxis = sliceE(dividendsPaid);

  // ── Terminal value (exit-multiple on stabilised NOI; perpetuity on the
  // exit-year unlevered free cash flow = CFO + CFI, no in-kind). ─────────
  const exitFcff = (cfoAxis[exit] ?? 0) + (cfiAxis[exit] ?? 0);
  const tvEnterprise = terminalEnterpriseValue({
    method: cfg.terminalMethod,
    exitMetric: cfg.terminalMethod === 'perpetuity' ? exitFcff : stabilisedNOI,
    exitMultiple: cfg.exitMultiple,
    perpetuityGrowth: cfg.perpetuityGrowth,
    discountRate: cfg.discountRate,
  });
  const debtAtExit = bs.debtOutstandingPerPeriod[exit] ?? 0;
  // Terminal EQUITY value = sale proceeds (EV) net of the loan payoff at
  // exit. Cash on the balance sheet is deliberately NOT added (already
  // counted within the FCFE / dividend streams as it was earned).
  const tvEquity = terminalEquityValue(tvEnterprise, debtAtExit, 0);

  // Helper: build an (E+1)-length stream — index 0 = inception, 1..E = axis.
  const incep = (inceptionVal: number, axisArr: number[]): number[] => {
    const out = new Array<number>(E + 1).fill(0);
    out[0] = inceptionVal;
    for (let t = 0; t < E; t++) out[t + 1] = axisArr[t] ?? 0;
    return out;
  };
  const atExitAxis = (value: number): number[] => { const a = new Array<number>(E).fill(0); a[exit] = value; return a; };

  // ── Stream 1: FCFF (unlevered, to all capital providers) ────────────
  //   inception: − existing pre-capex
  //   axis:      + CFO + CFI (new capex). NO in-kind land (it is non-cash
  //              and already flows through CFO via CoS / depreciation).
  //   exit:      + terminal enterprise value
  const fcffAxis = cfoAxis.map((v, t) => v + (cfiAxis[t] ?? 0));
  fcffAxis[exit] = (fcffAxis[exit] ?? 0) + tvEnterprise;
  const fcff = incep(-existingPreCapex, fcffAxis);

  // ── Stream 2: FCFE (levered, free cash to equity) ───────────────────
  //   inception: − existing pre-capex + existing debt opening (= − existing equity)
  //   axis:      FCFF axis + debt drawdown − principal − interest − in-kind land
  //   exit:      + terminal equity value
  const fcfeAxis = cfoAxis.map((v, t) =>
    v + (cfiAxis[t] ?? 0)
    + (debtDrawAxis[t] ?? 0)
    + (principalAxis[t] ?? 0)   // already negative
    + (interestAxis[t] ?? 0)    // already negative
    - (inKindAxis[t] ?? 0));    // in-kind land is an equity outflow
  fcfeAxis[exit] = (fcfeAxis[exit] ?? 0) + tvEquity;
  const fcfe = incep(-existingPreCapex + existingDebtOpening, fcfeAxis);

  // ── Stream 3: Dividends (realised equity cash) ──────────────────────
  //   inception: − existing equity
  //   axis:      − (cash + in-kind equity contributed) + dividends distributed
  //   exit:      + terminal equity value
  const dividendAxis = equityCashAxis.map((v, t) =>
    -(v + (inKindAxis[t] ?? 0)) + (divPaidAxis[t] ?? 0));
  dividendAxis[exit] = (dividendAxis[exit] ?? 0) + tvEquity;
  const dividendStream = incep(-existingEquity, dividendAxis);

  // ── Step-by-step build-up components (E+1, index 0 = inception) ──────
  const buildup = {
    existingPreCapexPerPeriod: incep(-existingPreCapex, new Array<number>(E).fill(0)),
    existingDebtOpeningPerPeriod: incep(existingDebtOpening, new Array<number>(E).fill(0)),
    existingEquityPerPeriod: incep(-existingEquity, new Array<number>(E).fill(0)),
    cfoPerPeriod: incep(0, cfoAxis),
    cfiPerPeriod: incep(0, cfiAxis),
    inKindLandPerPeriod: incep(0, inKindAxis.map((v) => -v)),
    terminalEnterprisePerPeriod: incep(0, atExitAxis(tvEnterprise)),
    debtDrawPerPeriod: incep(0, debtDrawAxis),
    principalRepayPerPeriod: incep(0, principalAxis),
    interestPaidPerPeriod: incep(0, interestAxis),
    terminalEquityPerPeriod: incep(0, atExitAxis(tvEquity)),
    equityCashPerPeriod: incep(0, equityCashAxis.map((v) => -v)),
    equityInKindPerPeriod: incep(0, inKindAxis.map((v) => -v)),
    dividendsDistributedPerPeriod: incep(0, divPaidAxis),
  };

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
    axisLength: E + 1, // inception + axis through exit
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
    streamYearLabels: [snap.projectStartYear - 1, ...snap.yearLabels.slice(0, E)],
    fcffPerPeriod: fcff,
    fcfePerPeriod: fcfe,
    dividendStreamPerPeriod: dividendStream,
    buildup,
    noiPerPeriod,
    stabilisedNOI,
    exitNOI,
    terminalEnterpriseValue: tvEnterprise,
    terminalEquityValue: tvEquity,
    totalDevelopmentCost,
    totalEquityInvested,
    totalDividendsDistributed: totalDividends,
    result: computeReturns(input),
  };
}
