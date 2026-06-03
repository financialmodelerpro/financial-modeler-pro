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
  computeReturns,
  developmentEconomics, exitAnalysis, sourcesUses, fundingMix,
  equityExposure, stabilizationMetrics, debtAnalytics, computePartnerReturns,
  buildSponsorStreamsForExit, exitYearAnalysis, computePerAssetReturns,
  computeSensitivity, defaultSensitivityValues,
} from '@/src/core/calculations/returns';
import type {
  ReturnsResult, ReturnsInput, TerminalMethod,
  DevelopmentEconomics, ExitAnalysis, SourcesUses, FundingMix,
  EquityExposureDetail, StabilizationMetrics, DebtAnalytics, PartnersSnapshot,
  ExitYearRow, PerAssetSnapshot, SensitivityGrid, SensitivityVariable, SponsorStreamInputs,
} from '@/src/core/calculations/returns';
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
  // ── M5 Pass 1 analytics (2026-06-02) ──
  developmentEconomics: DevelopmentEconomics;
  exitAnalysis: ExitAnalysis;
  sourcesUses: SourcesUses;
  fundingMix: FundingMix;
  equityExposure: EquityExposureDetail;
  stabilization: StabilizationMetrics;
  debtAnalytics: DebtAnalytics;
  /** M5 Pass 2: per-partner equity returns (empty .partners when none set). */
  partners: PartnersSnapshot;
  /** M5 Pass 2: hold-vs-sell exit-year analysis (one row per candidate exit). */
  exitYears: ExitYearRow[];
  /** M5 Pass 2: per-asset revenue / cost / profit / yield-on-cost breakdown. */
  perAsset: PerAssetSnapshot;
  /** M5 Pass 2: default two-way sensitivity grid (Exit Cap Rate x Sales Price).
   *  The UI re-runs computeReturnsSensitivity when the user picks variables. */
  sensitivity: SensitivityGrid;
}

/** M5 Pass 2: rebuild the sponsor stream inputs + exit + terminal config from
 *  a snapshot, for the sensitivity grid (resolver default + UI re-runs). */
function sponsorInputsFromSnap(snap: ProjectFinancialsSnapshot, project: Project): {
  inputs: SponsorStreamInputs; exitIdx: number; discountRate: number;
  terminal: { method: TerminalMethod; exitMultiple: number; perpetuityGrowth: number; discountRate: number };
} {
  const N = snap.axisLength;
  const cfg = resolveReturnsConfig(project, N);
  const dcf = snap.directCF, pl = snap.pl, fin = snap.financing, bs = snap.bs;
  const noi = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) {
    noi[t] = (pl.hospitalityRevenuePerPeriod[t] ?? 0) + (pl.retailRevenuePerPeriod[t] ?? 0)
      - (pl.hospitalityOpexPerPeriod[t] ?? 0) - (pl.retailOpexPerPeriod[t] ?? 0);
  }
  const sl = (a: number[]): number[] => a.slice(0, N).map((v) => v ?? 0);
  return {
    inputs: {
      cfoAxis: sl(dcf.cashFromOperationsPerPeriod),
      cfiAxis: sl(dcf.cashFromInvestmentPerPeriod),
      inKindAxis: sl(fin.equity.inKindPerPeriod),
      debtDrawAxis: sl(dcf.debtDrawdownPerPeriod),
      principalAxis: sl(dcf.debtRepaymentPerPeriod),
      interestAxis: sl(dcf.interestPaidPerPeriod),
      noiPerPeriod: noi,
      debtOutstandingPerPeriod: bs.debtOutstandingPerPeriod,
      existingPreCapex: Math.max(0, fin.existing.preCapexTotal),
      existingDebtOpening: Math.max(0, fin.existing.debtOutstandingTotal),
    },
    exitIdx: cfg.exitYearOffset,
    discountRate: cfg.discountRate,
    terminal: { method: cfg.terminalMethod, exitMultiple: cfg.exitMultiple, perpetuityGrowth: cfg.perpetuityGrowth, discountRate: cfg.discountRate },
  };
}

/** M5 Pass 2: re-run the sensitivity grid for a user-chosen variable pair. */
export function computeReturnsSensitivity(
  snap: ProjectFinancialsSnapshot,
  project: Project,
  xVar: SensitivityVariable,
  yVar: SensitivityVariable,
): SensitivityGrid {
  const s = sponsorInputsFromSnap(snap, project);
  return computeSensitivity({
    inputs: s.inputs,
    terminal: s.terminal,
    exitIdx: s.exitIdx,
    x: { variable: xVar, values: defaultSensitivityValues(xVar, s.discountRate) },
    y: { variable: yVar, values: defaultSensitivityValues(yVar, s.discountRate) },
  });
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
  // Terminal 100% payout (2026-06-02) is now booked in the FINANCING ENGINE
  // (computeCashWaterfall): the exit period retains no minimum cash and
  // distributes all cash above the opening-cash seed as a real liquidating
  // dividend. It is therefore ALREADY in dividendsPaid (= totalDividendsPerPeriod),
  // so divPaidAxis carries it through to the Distributed Equity stream and the
  // build-up, and it ties to the Direct CF + BS. No Returns-only adjustment.
  const divPaidAxis = sliceE(dividendsPaid);

  // Helper: build an (E+1)-length stream, index 0 = inception, 1..E = axis.
  const incep = (inceptionVal: number, axisArr: number[]): number[] => {
    const out = new Array<number>(E + 1).fill(0);
    out[0] = inceptionVal;
    for (let t = 0; t < E; t++) out[t + 1] = axisArr[t] ?? 0;
    return out;
  };
  const atExitAxis = (value: number): number[] => { const a = new Array<number>(E).fill(0); a[exit] = value; return a; };

  // ── FCFF + FCFE streams + terminal value (shared builder, also driving
  // the exit-year analysis loop so the selected-year row matches exactly).
  // Terminal value: exit-multiple on stabilised NOI; perpetuity on the
  // exit-year unlevered free cash flow (CFO + CFI). FCFF has NO in-kind land
  // line; FCFE carries it as an equity outflow. ─────────────────────────
  const sponsorInputs = {
    cfoAxis, cfiAxis, inKindAxis, debtDrawAxis, principalAxis, interestAxis,
    noiPerPeriod, debtOutstandingPerPeriod: bs.debtOutstandingPerPeriod,
    existingPreCapex, existingDebtOpening,
  };
  const terminalCfg = { method: cfg.terminalMethod, exitMultiple: cfg.exitMultiple, perpetuityGrowth: cfg.perpetuityGrowth, discountRate: cfg.discountRate };
  const streams = buildSponsorStreamsForExit(sponsorInputs, exit, terminalCfg);
  const tvEnterprise = streams.terminalEnterpriseValue;
  const tvEquity = streams.terminalEquityValue;
  const debtAtExit = bs.debtOutstandingPerPeriod[exit] ?? 0;
  const fcff = streams.fcff;
  const fcfe = streams.fcfe;

  // ── Stream 3: Distributed Equity (realized equity cash) ─────────────
  //   inception: − existing equity
  //   axis:      − (cash + in-kind equity contributed) + dividends distributed
  //   exit:      + terminal equity value + TERMINAL 100% PAYOUT of retained cash
  // The terminal 100% payout is already folded into divPaidAxis[exit] above,
  // so it flows through both the stream and the build-up consistently.
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

  const result = computeReturns(input);
  const exitYearLabel = snap.yearLabels[exit] ?? (snap.projectStartYear + exit);
  const streamYearLabels = [snap.projectStartYear - 1, ...snap.yearLabels.slice(0, E)];

  // ── M5 Pass 1 analytics (2026-06-02) ──────────────────────────────────
  const sum = (arr: number[], len = N): number => arr.slice(0, len).reduce((s, v) => s + (v ?? 0), 0);
  const gdv = totalRevenue; // total project revenue over the hold = GDV
  const totalFinancingCost = sum(fin.combined.totalInterestAccrued);
  const devEconomics = developmentEconomics(gdv, totalDevelopmentCost, totalFinancingCost);

  const exitAnalysisBlock = exitAnalysis({
    exitYearLabel,
    exitNOI,
    exitEBITDA: pl.ebitdaPerPeriod[exit] ?? 0,
    exitEnterpriseValue: tvEnterprise,
    exitEquityValue: tvEquity,
    exitDebt: debtAtExit,
  });

  // Customer collections = pre-sales cash received over the hold (net of
  // escrow held, plus escrow released): real funding from buyers.
  const customerCollections = Math.max(0,
    sum(snap.revenue.projectTotals.presalesCashPerPeriod)
    - sum(snap.escrow.projectTotals.heldPerPeriod)
    + sum(snap.escrow.projectTotals.releasePerPeriod));
  const sourcesUsesBlock = sourcesUses({
    existingEquity: fin.equity.totalExisting,
    newEquityCash: fin.equity.totalCash,
    inKindEquity: fin.equity.totalInKind,
    existingDebt: fin.existing.debtOutstandingTotal,
    newDebt: sum(fin.combined.totalDrawdown) + sum(fin.combined.totalInterestCapitalized),
    customerCollections,
    land: fin.capex.totals.inclAllLand - fin.capex.totals.exclAllLand,
    construction: fin.capex.totals.exclAllLand,
    idc: sum(fin.combined.totalInterestForAssetBasis),
  });
  const fundingMixBlock = fundingMix(sourcesUsesBlock);

  const equityExposureBlock = equityExposure({
    fcfePerPeriod: fcfe,
    streamYearLabels,
    cumulativeEquityPerPeriod: cumulativeEquity.slice(0, N),
    totalEquityRequired: totalEquityInvested,
    dividendsPerPeriod: dividendsPaid.slice(0, N),
    axisYearLabels: snap.yearLabels,
  });

  const stabilizationBlock = stabilizationMetrics({
    noiPerPeriod,
    stabilisedNOI,
    stabilisedYieldOnCost: result.realEstate.yieldOnCost,
    axisYearLabels: snap.yearLabels,
  });

  const debtAnalyticsBlock = debtAnalytics({
    debtOutstandingPerPeriod: bs.debtOutstandingPerPeriod.slice(0, N),
    exitIdx: exit,
    axisYearLabels: snap.yearLabels,
  });

  // ── M5 Pass 2: multi-partner equity returns ──────────────────────────
  // Partners share the operating distributions (divPaidAxis, which already
  // includes the terminal 100% payout) + the terminal equity value, by
  // shareholding. Reconciles against the project equity grand total.
  // Per-type equity TOTALS aligned with the Distributed-Equity stream so the
  // partner streams sum back to it: new cash + in-kind are the axis draw totals
  // through exit; existing equity is the inception amount (preCapex − debt).
  const totalCashEquity = equityCashAxis.reduce((s, v) => s + (v ?? 0), 0);
  const totalInKindEquity = inKindAxis.reduce((s, v) => s + (v ?? 0), 0);
  const totalExistingEquity = Math.max(0, existingEquity);
  // Partners hold a PERCENTAGE share of each equity type; derive the absolute
  // contribution (pct/100 x type total) here so the engine keeps working on
  // absolute amounts. Legacy snapshots with absolute *Contribution fields and
  // no *Pct fall back to the stored amount.
  const pctAmt = (pct: number | undefined, total: number, legacy: number | undefined): number =>
    pct != null && Number.isFinite(pct)
      ? Math.max(0, Math.min(100, pct)) / 100 * total
      : Math.max(0, legacy ?? 0);
  const partnersBlock = computePartnerReturns({
    partners: (project.partners ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      cashContribution: pctAmt(p.cashPct, totalCashEquity, p.cashContribution),
      inKindContribution: pctAmt(p.inKindPct, totalInKindEquity, p.inKindContribution),
      existingContribution: pctAmt(p.existingPct, totalExistingEquity, p.existingContribution),
    })),
    totalCash: totalCashEquity,
    totalInKind: totalInKindEquity,
    totalExisting: totalExistingEquity,
    cashAxisPerPeriod: equityCashAxis,
    inKindAxisPerPeriod: inKindAxis,
    dividendsPerPeriod: divPaidAxis,
    terminalEquityValue: tvEquity,
    exitIdx: exit,
    streamYearLabels,
    // No explicit partners => default a single 100% Sponsor holding the
    // project's full equity (new cash + in-kind + existing), reconciled per
    // type; the user then splits each type across partners.
    defaultToSponsor: true,
  });

  // ── M5 Pass 2: exit-year analysis (hold-vs-sell timing) ──────────────
  // Candidate exits run from the first operating year (first positive NOI,
  // else the model midpoint) through the last axis year; always include the
  // selected exit. Each row rebuilds the streams via the same shared builder.
  const firstOpsIdx = noiPerPeriod.findIndex((v) => (v ?? 0) > 0);
  const startIdx = firstOpsIdx >= 0 ? firstOpsIdx : Math.min(N - 1, Math.max(0, Math.floor(N / 2)));
  const candidateExitIdxs: number[] = [];
  for (let i = startIdx; i < N; i++) candidateExitIdxs.push(i);
  if (!candidateExitIdxs.includes(exit)) candidateExitIdxs.push(exit);
  const sponsorInputsFull: SponsorStreamInputs = {
    cfoAxis: dcf.cashFromOperationsPerPeriod.slice(0, N).map((v) => v ?? 0),
    cfiAxis: dcf.cashFromInvestmentPerPeriod.slice(0, N).map((v) => v ?? 0),
    inKindAxis: equityInKind.slice(0, N).map((v) => v ?? 0),
    debtDrawAxis: dcf.debtDrawdownPerPeriod.slice(0, N).map((v) => v ?? 0),
    principalAxis: dcf.debtRepaymentPerPeriod.slice(0, N).map((v) => v ?? 0),
    interestAxis: dcf.interestPaidPerPeriod.slice(0, N).map((v) => v ?? 0),
    noiPerPeriod,
    debtOutstandingPerPeriod: bs.debtOutstandingPerPeriod,
    existingPreCapex,
    existingDebtOpening,
  };
  const exitYears = exitYearAnalysis({
    inputs: sponsorInputsFull,
    terminal: terminalCfg,
    candidateExitIdxs,
    selectedExitIdx: exit,
    axisYearLabels: snap.yearLabels,
  });

  // ── M5 Pass 2: default sensitivity grid (Exit Cap Rate x Sales Price) ─
  const sensitivity = computeSensitivity({
    inputs: sponsorInputsFull,
    terminal: terminalCfg,
    exitIdx: exit,
    x: { variable: 'exit_cap_rate', values: defaultSensitivityValues('exit_cap_rate', cfg.discountRate) },
    y: { variable: 'sales_price_pct', values: defaultSensitivityValues('sales_price_pct', cfg.discountRate) },
  });

  // ── M5 Pass 2: per-asset breakdown (unlevered drivers; financing is
  // project-level so no per-asset IRR is attempted). Phase grouping is done
  // in the UI, which has the asset->phase map; rows carry only the asset id. ─
  const perAsset = computePerAssetReturns(
    [...snap.perAssetPL.values()].map((pl) => {
      const cf = snap.perAssetCF.get(pl.assetId);
      return {
        assetId: pl.assetId,
        assetName: pl.assetName,
        phaseId: '',
        phaseName: '',
        strategy: pl.strategy,
        revenuePerPeriod: pl.revenuePerPeriod,
        opexPerPeriod: pl.opexPerPeriod,
        capexPerPeriod: cf?.capexPerPeriod ?? new Array<number>(N).fill(0),
      };
    }),
  );

  return {
    axisLength: N,
    yearLabels: snap.yearLabels,
    config: cfg,
    exitYearLabel,
    streamYearLabels,
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
    result,
    developmentEconomics: devEconomics,
    exitAnalysis: exitAnalysisBlock,
    sourcesUses: sourcesUsesBlock,
    fundingMix: fundingMixBlock,
    equityExposure: equityExposureBlock,
    stabilization: stabilizationBlock,
    debtAnalytics: debtAnalyticsBlock,
    partners: partnersBlock,
    exitYears,
    perAsset,
    sensitivity,
  };
}
