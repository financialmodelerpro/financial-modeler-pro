/**
 * M5 Returns engine, shared types.
 *
 * Pure data shapes. No store / snapshot coupling, no platform imports.
 * The refm resolver (returns-resolvers.ts) maps an M4 financials snapshot
 * onto these inputs; the UI reads the outputs.
 *
 * Sign convention for cash-flow streams: NEGATIVE = cash OUT (invested),
 * POSITIVE = cash IN (returned). period[0] is the first project year.
 */

export type TerminalMethod = 'none' | 'exit_multiple' | 'perpetuity';

/** One signed cash-flow stream (e.g. FCFF, FCFE, Dividends). */
export interface CashFlowStream {
  /** Signed per-period cash flow (negative = invested, positive = returned). */
  perPeriod: number[];
}

/** IRR / MOIC / NPV / Payback summary for a single stream. */
export interface StreamReturns {
  /** Annualised IRR as a decimal (0.184 = 18.4%); null if no sign change
   *  or the solver did not converge. */
  irr: number | null;
  /** Multiple on invested capital = total inflow / total outflow (x). */
  moic: number;
  /** Net present value at the supplied discount rate. */
  npv: number;
  /** Discount rate used for the NPV (decimal). */
  discountRate: number;
  /** Payback period in years (fractional, linearly interpolated); null if
   *  the cumulative cash flow never turns positive. */
  paybackPeriod: number | null;
  /** Sum of positive flows (cash returned). */
  totalInflow: number;
  /** Sum of |negative flows| (cash invested). */
  totalOutflow: number;
  /** totalInflow − totalOutflow (undiscounted profit). */
  netProfit: number;
  /** Largest cumulative cash invested at any point (peak exposure). */
  peakExposure: number;
}

/** Terminal-value inputs (exit-multiple or perpetuity). */
export interface TerminalValueInput {
  method: TerminalMethod;
  /** Exit-year metric the terminal value is built on:
   *   exit_multiple -> stabilised EBITDA / NOI at exit
   *   perpetuity    -> exit-year free cash flow (FCFF or FCFE) */
  exitMetric: number;
  /** Multiple applied to exitMetric (exit_multiple method). */
  exitMultiple?: number;
  /** Perpetuity growth rate g (perpetuity method, decimal). */
  perpetuityGrowth?: number;
  /** Discount rate r for the perpetuity (decimal). */
  discountRate?: number;
}

/** Real-estate point/period metrics derived from the snapshot. */
export interface RealEstateMetrics {
  /** Stabilised NOI / total development cost (going-in yield on cost). */
  yieldOnCost: number | null;
  /** Exit NOI / exit enterprise value (exit cap rate). */
  capRateAtExit: number | null;
  /** yieldOnCost − capRateAtExit (development spread, decimal). */
  developmentSpread: number | null;
  /** (total revenue − total cost) / total cost (profit on cost). */
  profitOnCost: number | null;
  /** total PAT / total revenue (net profit margin). */
  profitMargin: number | null;
  /** Average annual cash-on-cash = mean(distribution / cumulative equity). */
  cashOnCashAvg: number | null;
  /** Debt outstanding at exit / enterprise value at exit (LTV at exit). */
  ltvAtExit: number | null;
  /** Total equity distributions / total equity invested (equity multiple, x). */
  equityMultiple: number;
  /** Stabilised NOI / total debt outstanding (debt yield, decimal). */
  debtYield: number | null;
  /** Peak cumulative equity invested (max equity exposure). */
  peakEquity: number;
  /** Per-period Debt Service Coverage Ratio (NOI or CFADS / debt service). */
  dscrPerPeriod: number[];
  /** Minimum DSCR across operating periods with debt service. */
  dscrMin: number | null;
  /** Average DSCR across operating periods with debt service. */
  dscrAvg: number | null;
  /** Per-period Interest Coverage Ratio (EBITDA / interest). */
  icrPerPeriod: number[];
  /** Minimum ICR across periods with interest. */
  icrMin: number | null;
  /** Per-period cash-on-cash (distribution / cumulative equity). */
  cashOnCashPerPeriod: number[];
}

/** Full returns input (resolver -> engine). */
export interface ReturnsInput {
  axisLength: number;
  /** The three return streams. */
  fcff: CashFlowStream;
  fcfe: CashFlowStream;
  dividends: CashFlowStream;
  discountRate: number;
  /** Real-estate metric feeders. */
  metrics: {
    stabilisedNOI: number;
    totalDevelopmentCost: number;
    totalRevenue: number;
    totalCost: number;
    totalPAT: number;
    exitNOI: number;
    exitEnterpriseValue: number;
    debtOutstandingAtExit: number;
    totalEquityInvested: number;
    totalEquityDistributions: number;
    /** Per-period cash flow available for debt service (NOI/CFADS). */
    cfadsPerPeriod: number[];
    /** Per-period cash debt service (interest + principal). */
    debtServicePerPeriod: number[];
    /** Per-period EBITDA. */
    ebitdaPerPeriod: number[];
    /** Per-period interest expense. */
    interestPerPeriod: number[];
    /** Per-period equity distributions (dividends). */
    distributionPerPeriod: number[];
    /** Per-period cumulative equity invested. */
    cumulativeEquityPerPeriod: number[];
    /** Per-period equity invested (for peak equity). */
    equityInvestedPerPeriod: number[];
  };
}

// ── M5 Pass 1 analytics (2026-06-02) ──────────────────────────────────
// Development / exit / sources-uses / equity-exposure / stabilization /
// debt blocks. Pure functions in analytics.ts; the resolver maps the
// financials snapshot onto their primitive inputs.

/** Development economics (project profitability before/after financing). */
export interface DevelopmentEconomics {
  /** Gross Development Value = total project revenue over the hold. */
  gdv: number;
  totalDevelopmentCost: number;
  totalFinancingCost: number;
  /** GDV − total development cost (unlevered profit). */
  profitBeforeFinancing: number;
  /** GDV − total development cost − total financing cost (levered profit). */
  profitAfterFinancing: number;
  /** profitAfterFinancing / GDV (decimal); null if GDV ≤ 0. */
  developmentMargin: number | null;
  /** total development cost / GDV (decimal); null if GDV ≤ 0. */
  costToValue: number | null;
}

/** Exit-year snapshot (the values the terminal value is built on). */
export interface ExitAnalysis {
  exitYearLabel: number;
  exitNOI: number;
  exitEBITDA: number;
  exitEnterpriseValue: number;
  exitEquityValue: number;
  exitDebt: number;
  ltvAtExit: number | null;
  debtYield: number | null;
  capRate: number | null;
}

/** Sources & uses of capital over the hold, fully reconciled
 *  (totalSources === totalUses). */
export interface SourcesUses {
  existingEquity: number;
  newEquityCash: number;
  inKindEquity: number;
  existingDebt: number;
  newDebt: number;
  /** Customer collections / pre-sales cash received during the hold. */
  customerCollections: number;
  /** Operating cash generated during the hold that funds remaining uses
   *  (balancing source; 0 when other funding already covers the cost). */
  operatingCash: number;
  totalSources: number;
  land: number;
  construction: number;
  idc: number;
  /** Reserves / distributions: the balancing USE when total funding exceeds
   *  development cost (0 when funding is tight). */
  reservesDistributions: number;
  totalUses: number;
}

/** Capital-structure mix as fractions of total sources. */
export interface FundingMix {
  debtPct: number | null;
  cashEquityPct: number | null;
  inKindEquityPct: number | null;
  customerFundingPct: number | null;
}

/** Expanded equity-exposure detail. */
export interface EquityExposureDetail {
  totalEquityRequired: number;
  averageEquityInvested: number;
  /** Most-negative cumulative equity cash flow (peak FCFE exposure, ≥ 0). */
  maxNegativeCumulativeCF: number;
  /** Year label of the first period FCFE turns positive; null if never. */
  firstPositiveCFYear: number | null;
  /** Year label of the first dividend distribution; null if none. */
  firstDividendYear: number | null;
  /** Peak cumulative equity invested (equity at risk). */
  equityAtRisk: number;
}

/** Stabilization metrics for income-producing (Operate / Lease) assets. */
export interface StabilizationMetrics {
  stabilisedNOI: number;
  stabilisedYieldOnCost: number | null;
  /** First year NOI reaches the stabilisation threshold (≥ 95% of stabilised);
   *  null if there are no income assets. */
  stabilizationYear: number | null;
  hasIncomeAssets: boolean;
}

/** Debt analytics over the hold. */
export interface DebtAnalytics {
  peakDebt: number;
  averageDebtOutstanding: number;
  remainingDebtAtExit: number;
  /** (peak − remaining at exit) / peak (decimal); null if peak ≤ 0. */
  paydownPct: number | null;
  /** Years from first drawdown to fully repaid (or to exit if still
   *  outstanding); null if no debt. */
  tenorYears: number | null;
}

/** Full returns output (engine -> UI). */
export interface ReturnsResult {
  fcff: StreamReturns;
  fcfe: StreamReturns;
  dividends: StreamReturns;
  realEstate: RealEstateMetrics;
}
