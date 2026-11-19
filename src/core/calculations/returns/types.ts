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

export type TerminalMethod = 'none' | 'exit_multiple' | 'perpetuity' | 'cap_rate';

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
  /** The exit cap rate (decimal), for `cap_rate`. Terminal EV = metric / rate. */
  capRate?: number;
  /** Multiply the exit metric by (1 + g) before capitalising. See
   *  `Project.returns.applyGrowthToTerminal` for why this is explicit. */
  applyGrowth?: boolean;
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
  /** Stabilised-year NOI / the held assets' cost including their capitalised interest (2026-11-19). */
  yieldOnCost: number | null;
  /** The exit cap rate: the INPUT where the method is a cap rate (2026-11-19, founder), else the implied yield. */
  capRateAtExit: number | null;
  /** The exit-year NOI over the gross exit value (the implied figure, named as such). */
  impliedExitYield?: number | null;
  /** The calendar year of the stabilised NOI (every held asset at the top of its occupancy ramp). */
  stabilisedYear?: number;
  /** The stabilised-year NOI the yield on cost reads. */
  stabilisedYearNOI?: number;
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
  /** How many periods the DSCR was measured over (operating periods with debt
   *  service). A surface counting "n of m years" reads this rather than
   *  filtering the series itself, which is how the headline came to say "1 of
   *  3" while the table showed six rows (2026-09-21). */
  dscrMeasuredCount: number;
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
  /** THE COST OF EQUITY (2026-11-18): the equity streams' NPV rate. Absent = discountRate. */
  costOfEquity?: number;
  /** Real-estate metric feeders. */
  metrics: {
    stabilisedNOI: number;
    /** The NOI of the first year every held asset is stabilised, and the held assets' cost with their IDC (2026-11-19). */
    stabilisedYearNOI?: number;
    stabilisedYear?: number;
    heldAssetCostInclIdc?: number;
    /** The cap rate typed (the cap rate method), shown as the exit cap rate. */
    capRateInput?: number | null;
    /** Development profit and total capitalised cost, profit on cost's two sides. */
    developmentProfit?: number;
    totalCapitalisedCost?: number;
    totalDevelopmentCost: number;
    totalRevenue: number;
    totalCost: number;
    totalPAT: number;
    exitNOI: number;
    /** The exit value before selling costs (2026-11-18), the cap rate's base. Absent = the enterprise value. */
    exitGrossValue?: number;
    exitEnterpriseValue: number;
    debtOutstandingAtExit: number;
    totalEquityInvested: number;
    totalEquityDistributions: number;
    /** Per-period cash flow available for debt service (NOI/CFADS). */
    cfadsPerPeriod: number[];
    /** True where the period is an OPERATING period for at least one phase.
     *  DSCR is measured only there: CFADS is EBITDA, which is negative while a
     *  project is building, so a construction year otherwise became the
     *  reported minimum (2026-09-21). */
    operatingPerPeriod?: boolean[];
    /** Development cost of the HELD assets only (Operate + Lease), the
     *  denominator of Yield on Cost. REQUIRED, so the compiler enumerates every
     *  place a returns input is assembled.
     *
     *  WHY NOT TOTAL DEVELOPMENT COST (2026-09-22). The numerator, stabilised
     *  NOI, is income-producing assets ONLY, so dividing it by the whole
     *  project charged the held assets with the cost of the units that are
     *  SOLD, and the ratio measured nothing: on the live project it read 2.09%
     *  against a 8.50% exit cap rate, for a development spread of -6.41% that
     *  said the scheme destroyed value when what it really said was that most
     *  of the cost belongs to villas which are sold and never produce NOI. On
     *  held cost the same project reads 6.76%.
     *
     *  Pass 0 where nothing is held; the metric then resolves to null rather
     *  than dividing by a cost that does not belong to it. */
    heldAssetCost: number;
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
  /**
   * ONE GDV (2026-11-19, founder, as the training model): the residential sales value plus the gross exit value of
   * the held assets. The revenue over the hold is a different figure, kept as `totalRevenueOverHold` and never
   * called GDV.
   */
  gdv: number;
  /** The residential (Sell) sales value, the first half of the GDV. */
  saleValue: number;
  /** The held assets' gross exit value (before selling costs at exit), the second half. */
  grossExitValue: number;
  /** Total revenue over the hold, for the surfaces that still show it under that name. */
  totalRevenueOverHold: number;
  /** Development profit = GDV less total development cost, IDC and selling costs (2026-11-19). */
  developmentProfit: number;
  /** Total development cost plus the capitalised interest. */
  totalCapitalisedCost: number;
  /** Development profit / total capitalised cost; null if that cost is not positive. */
  profitOnCost: number | null;
  /** Land, hard, soft, developer fee and contingency: no capitalised interest and no selling costs (2026-11-19). */
  totalDevelopmentCost: number;
  /** The finance cost capitalised (IDC) since 2026-11-19 (it was all interest charged). */
  totalFinancingCost: number;
  /** The selling costs since 2026-11-19: marketing and sales commission (it was the operating expenses over the hold). */
  operatingExpenses: number;
  /** GDV less total development cost less the selling costs (before the capitalised interest). */
  profitBeforeFinancing: number;
  /** The development profit (less the capitalised interest too). */
  profitAfterFinancing: number;
  /** Development profit / GDV (decimal); null if GDV ≤ 0. */
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

/**
 * SOURCES AND USES OVER THE CONSTRUCTION PERIOD (2026-11-03, founder): the cash that came in and
 * went out from the model start to the end of construction (the last construction or capex year),
 * read off the cash flow, so the two totals meet by the cash identity with no balancing row. Cash
 * still held at the end of construction is a named use.
 */
export interface SourcesUses {
  /** The last year the window covers: the last year any capex is spent (cash or land in kind). */
  constructionEndYear: number;
  existingEquity: number;
  newEquityCash: number;
  inKindEquity: number;
  existingDebt: number;
  /** Debt drawn for capex, plus debt drawn for capitalised interest (the two below). */
  newDebt: number;
  newDebtCapex: number;
  newDebtInterest: number;
  /** Cash held before the model starts (existing operations). */
  openingCash: number;
  /** Cash collected from customers during construction, net of escrow held and released. */
  customerCollections: number;
  /** Proceeds from a disposal inside the window (an exit during construction). */
  disposalProceeds: number;
  totalSources: number;
  /** The development already in the ground at the model start (existing operations). */
  existingInvestment: number;
  land: number;
  construction: number;
  /** Interest paid during construction (the cash interest, capitalised interest drawn as debt included). */
  interestPaid: number;
  /** Alias of interestPaid, for readers written before 2026-11-03. */
  idc: number;
  /** Operating costs paid during construction: what the collections fund before they reach cash (opex, selling and marketing, fund fees, zakat). */
  operatingCosts: number;
  debtRepaid: number;
  distributions: number;
  /** Cash held at the end of construction: the genuine surplus, never a plug. */
  cashHeldAtEnd: number;
  totalUses: number;
}

/** A sources or uses row as every surface prints it. */
export interface SourcesUsesRow { key: keyof SourcesUses; label: string; value: number }

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
