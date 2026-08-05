/**
 * M5 Returns engine, the distribution waterfall (fund layer Step 4).
 *
 * REBUILT 2026-08-05 to match the reference model exactly. The first cut had a
 * conventional three-tier private-equity waterfall (return of capital, then a
 * preferred return, then a residual split). The reference is simpler, and the
 * difference is structural rather than cosmetic, so the old shape is gone
 * rather than wrapped.
 *
 * ── THE MECHANIC, PER PERIOD ───────────────────────────────────────────────
 *
 *   unpaidHurdleBoP    carried from the prior period's EoP
 *   hurdleAccrued    = (unpaidHurdleBoP + equityDrawn) x hurdleRate
 *   totalHurdleOwed  = equityDrawn + unpaidHurdleBoP + hurdleAccrued
 *   hurdlePaid       = MIN(distributions, totalHurdleOwed)
 *   unpaidHurdleEoP  = totalHurdleOwed - hurdlePaid
 *   excess           = distributions - hurdlePaid
 *   performanceFee   = excess x performanceFeePct
 *   netDistributions = distributions - performanceFee
 *
 * ── THREE THINGS THIS IS NOT, NAMED SO THEY ARE NOT RE-ADDED ───────────────
 *
 *   NO RETURN-OF-CAPITAL TIER. Equity drawn is folded straight into the hurdle
 *   owed and settled by the single `hurdlePaid` line. So `unpaidHurdle` is ONE
 *   balance carrying unreturned capital AND accrued preferred together, not a
 *   pure preferred-return balance. That naming is the reference's and is kept,
 *   but it is the single most misreadable thing in this file, which is why it
 *   is said here in capitals.
 *
 *   NO GP CATCH-UP TIER.
 *
 *   NO RESIDUAL SPLIT. The performance fee is a FLAT PERCENTAGE of everything
 *   above the hurdle. What is left of the excess after the fee is simply what
 *   is left; it is not a second party's share of a split.
 *
 * ── THE ACCRUAL COMPOUNDS, AND IT CHARGES THE SAME-PERIOD DRAW ─────────────
 *
 * The accrual base is the opening balance PLUS the equity drawn in this same
 * period, so capital earns a full period of hurdle in the period it is called.
 * Substituting, the whole mechanic collapses to one identity:
 *
 *   totalHurdleOwed = (unpaidHurdleBoP + equityDrawn) x (1 + hurdleRate)
 *
 * which is to say the balance compounds at exactly (1 + r) per period. A single
 * draw C held for n periods therefore owes C x (1+r)^(n+1), one power more than
 * an opening-balance-only convention would give.
 *
 * A CONSEQUENCE WORTH KNOWING RATHER THAN REDISCOVERING: because of that extra
 * power, an investor paid exactly the hurdle balance earns MORE than the hurdle
 * rate as an IRR (16.64% on an 8% hurdle over one period, 8.83% over ten,
 * converging down towards the rate as the horizon lengthens). The hurdle here
 * is a stated accrual convention, not an IRR the payment reproduces. That is
 * the reference's behaviour and it is deliberate; the verifier pins the
 * compounding identity above rather than an IRR equality that does not hold.
 *
 * ── WHY THIS IS NOT INSIDE THE CIRCULAR SOLVE ──────────────────────────────
 *
 * Step 3 had to freeze the fee schedule before `computeFinancialsSnapshot`'s
 * fixed point, because a fund fee is a real cash outflow: it raises the funding
 * requirement, and a fee charged on anything the solver moves would feed its
 * own base. The guideline flags the hurdle as carrying the same exposure.
 *
 * It does not, and the reason is structural rather than careful. THE
 * PERFORMANCE FEE IS A SPLIT OF CASH THAT HAS ALREADY LEFT THE PROJECT. The
 * distributions this module allocates are outputs of a converged snapshot;
 * deciding that a percentage of the excess goes to the manager instead of the
 * investors moves no project cash, touches no `cashFromOps`, and so never
 * reaches `computeFundingGap`. M5 runs after M4 has converged, so the schedule
 * this module consumes is frozen by construction: there is no loop to re-enter
 * and nothing here to thread back.
 *
 * That is a claim, so it is tested rather than asserted: verify-fund-waterfall
 * asserts the FULL financials snapshot is identical with the waterfall live.
 *
 * ── SIGN AND SHAPE ────────────────────────────────────────────────────────
 *
 * Equity drawn and distributions arrive as SEPARATE non-negative series, not as
 * one netted stream. A period can carry both (an equity draw in the same year
 * as a dividend), and netting them first would hide a distribution behind a
 * draw and mis-state the hurdle payment below it.
 *
 * PURE: primitives in, primitives out. No platform import, no fund-terms
 * import, so the `@core` boundary holds and the resolver does the mapping.
 *
 * No em dashes in this file.
 */

/** One period of the waterfall, in the reference's row order. */
export interface WaterfallPeriod {
  /** Equity drawn this period (>= 0). Accrues hurdle in THIS period. */
  equityDrawn: number;
  /** Cash available to distribute this period (>= 0). */
  distribution: number;
  /**
   * Unpaid hurdle balance brought forward. INCLUDES UNRETURNED CAPITAL: there
   * is no separate return-of-capital tier, so this one balance carries both.
   */
  openingUnpaidHurdle: number;
  /** (openingUnpaidHurdle + equityDrawn) x hurdleRate. */
  hurdleAccrued: number;
  /** equityDrawn + openingUnpaidHurdle + hurdleAccrued. */
  totalHurdleOwed: number;
  /** MIN(distribution, totalHurdleOwed). Settles capital and preferred as one. */
  hurdlePaid: number;
  /** totalHurdleOwed - hurdlePaid. Carried to the next period's opening. */
  closingUnpaidHurdle: number;
  /** distribution - hurdlePaid. Zero until the hurdle is fully settled. */
  excessDistributions: number;
  /** excessDistributions x performanceFeePct. A flat rate, not a split. */
  performanceFee: number;
  /** What is left of the excess after the fee. */
  excessAfterFee: number;
  /** distribution - performanceFee. What the investors actually receive. */
  netDistribution: number;
  /** netDistribution - equityDrawn. The signed post-fee investor cash flow. */
  netCashflow: number;
}

export interface WaterfallSnapshot {
  /** False when the fund layer is off. Every number below is then zero. */
  active: boolean;
  /** The hurdle applied, as a decimal fraction. */
  hurdleRate: number;
  /** The performance fee applied to the excess, as a decimal fraction. */
  performanceFeePct: number;
  /** Per-period detail, same length and index basis as the streams it was built from. */
  periods: WaterfallPeriod[];
  // Per-period series, for consumers that want a line rather than a row.
  equityDrawnPerPeriod: number[];
  distributionPerPeriod: number[];
  hurdleAccruedPerPeriod: number[];
  totalHurdleOwedPerPeriod: number[];
  hurdlePaidPerPeriod: number[];
  /** CLOSING unpaid hurdle per period (capital plus preferred, see above). */
  unpaidHurdlePerPeriod: number[];
  excessDistributionsPerPeriod: number[];
  performanceFeePerPeriod: number[];
  excessAfterFeePerPeriod: number[];
  netDistributionPerPeriod: number[];
  /**
   * The signed post-fee investor stream: net distributions less equity drawn.
   * This is the cash flow the post-fee IRR and MOIC are computed on, defined
   * here so there is one definition rather than one per consumer.
   */
  netCashflowPerPeriod: number[];
  // Totals over the whole hold. There is deliberately no total of
  // `totalHurdleOwed`: it is a BALANCE, and summing balances across periods is
  // a number with no meaning.
  totalEquityDrawn: number;
  totalDistributions: number;
  totalHurdleAccrued: number;
  totalHurdlePaid: number;
  totalExcessDistributions: number;
  totalPerformanceFee: number;
  totalExcessAfterFee: number;
  /** totalDistributions - totalPerformanceFee. */
  totalNetDistributions: number;
  /**
   * The unpaid hurdle balance still outstanding at the end: capital never
   * returned plus preferred never paid. Positive on a project that does not
   * clear its hurdle, which is a real outcome and not an error.
   */
  hurdleShortfall: number;
  /** True when the project cleared the hurdle and a fee was earned. */
  performanceFeeEarned: boolean;
  /**
   * Distributions allocated to nothing. ZERO BY CONSTRUCTION: every period
   * splits into hurdle paid, fee, and excess after fee. Reported so the
   * invariant is a number a reader can see rather than a promise.
   */
  unallocated: number;
}

const zeros = (n: number): number[] => new Array<number>(Math.max(0, n)).fill(0);

export interface WaterfallInputs {
  /**
   * Equity drawn, per period, NON-NEGATIVE. Index basis is the caller's; the M5
   * resolver passes inception-prefixed series (index 0 = inception).
   */
  equityDrawnPerPeriod: readonly number[];
  /** Cash out to equity, per period, NON-NEGATIVE. Same index basis. */
  distributionsPerPeriod: readonly number[];
  /** The hurdle, decimal fraction, accrued per period. */
  hurdleRate: number;
  /** Performance fee on the excess, decimal fraction. */
  performanceFeePct: number;
  /**
   * False (the fund toggle off) returns an all-zero inactive snapshot. A caller
   * can then run this unconditionally: an inactive waterfall charges a zero
   * fee, so the net stream is the gross stream and a standalone project is
   * provably unchanged. Same shape as emptyFundFeeSchedule in Step 3.
   */
  active: boolean;
}

/**
 * Run the waterfall.
 *
 * `hurdlePaid` is a MIN, so it can never exceed either the cash available or
 * the amount owed, and `excess` is what the MIN did not take. Everything below
 * is a subtraction from that excess. Nothing is created and nothing is lost,
 * which the verifier asserts period by period rather than on the totals alone
 * (an over-payment in one period and an under-payment in another would net out
 * of a totals-only check).
 */
export function computeDistributionWaterfall(input: WaterfallInputs): WaterfallSnapshot {
  const len = Math.max(input.equityDrawnPerPeriod.length, input.distributionsPerPeriod.length);
  const hurdleRate = Number.isFinite(input.hurdleRate) ? Math.max(0, input.hurdleRate) : 0;
  const performanceFeePct = Number.isFinite(input.performanceFeePct)
    ? Math.max(0, Math.min(1, input.performanceFeePct)) : 0;

  if (!input.active) return emptyWaterfall(len);

  const periods: WaterfallPeriod[] = [];
  let unpaidHurdle = 0;

  for (let t = 0; t < len; t++) {
    // Negative inputs are not a shape this waterfall has a line for, so they
    // are clamped rather than silently flowing through as a negative payment.
    // The resolver splits any negative capital movement onto the correct side
    // before it gets here, so nothing is lost by the clamp.
    const equityDrawn = Math.max(0, input.equityDrawnPerPeriod[t] ?? 0);
    const distribution = Math.max(0, input.distributionsPerPeriod[t] ?? 0);

    const openingUnpaidHurdle = unpaidHurdle;

    // Accrue on the opening balance PLUS this period's draw, so capital earns a
    // full period of hurdle in the period it is called. Equivalent to
    // (opening + drawn) x (1 + rate), which is the compounding identity the
    // verifier pins.
    const hurdleAccrued = (openingUnpaidHurdle + equityDrawn) * hurdleRate;
    const totalHurdleOwed = equityDrawn + openingUnpaidHurdle + hurdleAccrued;

    // One line settles capital and preferred together. There is no separate
    // return-of-capital tier to run first.
    const hurdlePaid = Math.min(distribution, totalHurdleOwed);
    unpaidHurdle = totalHurdleOwed - hurdlePaid;

    // Whatever the MIN did not take is above the hurdle by definition, which is
    // the only place a performance fee is ever charged.
    const excessDistributions = distribution - hurdlePaid;
    const performanceFee = excessDistributions * performanceFeePct;

    periods.push({
      equityDrawn,
      distribution,
      openingUnpaidHurdle,
      hurdleAccrued,
      totalHurdleOwed,
      hurdlePaid,
      closingUnpaidHurdle: unpaidHurdle,
      excessDistributions,
      performanceFee,
      excessAfterFee: excessDistributions - performanceFee,
      netDistribution: distribution - performanceFee,
      netCashflow: (distribution - performanceFee) - equityDrawn,
    });
  }

  return summarise(periods, hurdleRate, performanceFeePct, true);
}

/** An all-zero inactive waterfall, for the toggle-off path. */
export function emptyWaterfall(len: number): WaterfallSnapshot {
  const n = Math.max(0, len);
  const periods: WaterfallPeriod[] = Array.from({ length: n }, () => ({
    equityDrawn: 0, distribution: 0,
    openingUnpaidHurdle: 0, hurdleAccrued: 0, totalHurdleOwed: 0,
    hurdlePaid: 0, closingUnpaidHurdle: 0,
    excessDistributions: 0, performanceFee: 0, excessAfterFee: 0,
    netDistribution: 0, netCashflow: 0,
  }));
  return summarise(periods, 0, 0, false);
}

function summarise(
  periods: WaterfallPeriod[], hurdleRate: number, performanceFeePct: number, active: boolean,
): WaterfallSnapshot {
  const n = periods.length;
  const pick = (f: (p: WaterfallPeriod) => number): number[] => periods.map(f);
  const total = (f: (p: WaterfallPeriod) => number): number => periods.reduce((s, p) => s + f(p), 0);

  const totalDistributions = total((p) => p.distribution);
  const totalHurdlePaid = total((p) => p.hurdlePaid);
  const totalPerformanceFee = total((p) => p.performanceFee);
  const totalExcessAfterFee = total((p) => p.excessAfterFee);

  return {
    active,
    hurdleRate,
    performanceFeePct,
    periods,
    equityDrawnPerPeriod: n ? pick((p) => p.equityDrawn) : zeros(0),
    distributionPerPeriod: pick((p) => p.distribution),
    hurdleAccruedPerPeriod: pick((p) => p.hurdleAccrued),
    totalHurdleOwedPerPeriod: pick((p) => p.totalHurdleOwed),
    hurdlePaidPerPeriod: pick((p) => p.hurdlePaid),
    unpaidHurdlePerPeriod: pick((p) => p.closingUnpaidHurdle),
    excessDistributionsPerPeriod: pick((p) => p.excessDistributions),
    performanceFeePerPeriod: pick((p) => p.performanceFee),
    excessAfterFeePerPeriod: pick((p) => p.excessAfterFee),
    netDistributionPerPeriod: pick((p) => p.netDistribution),
    netCashflowPerPeriod: pick((p) => p.netCashflow),
    totalEquityDrawn: total((p) => p.equityDrawn),
    totalDistributions,
    totalHurdleAccrued: total((p) => p.hurdleAccrued),
    totalHurdlePaid,
    totalExcessDistributions: total((p) => p.excessDistributions),
    totalPerformanceFee,
    totalExcessAfterFee,
    totalNetDistributions: totalDistributions - totalPerformanceFee,
    hurdleShortfall: n > 0 ? periods[n - 1].closingUnpaidHurdle : 0,
    performanceFeeEarned: totalPerformanceFee > 0,
    unallocated: totalDistributions - (totalHurdlePaid + totalPerformanceFee + totalExcessAfterFee),
  };
}
