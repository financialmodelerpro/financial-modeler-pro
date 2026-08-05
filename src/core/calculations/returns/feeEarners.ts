/**
 * M5 Returns engine, fee-earner income (fund layer Step 5).
 *
 * Who EARNS the fund's fees, as opposed to who owns its equity.
 *
 * ── WHY THIS IS NOT computePartnerReturns ─────────────────────────────────
 *
 * An M5 equity partner is defined by the equity it contributed and earns
 * `agreedShare x the consolidated stream`. Because the auto shares are
 * time-weighted dollar-years that always sum to 1, `Sigma partners ==
 * consolidated` holds per period BY CONSTRUCTION, and that identity is the
 * whole reason the partner table can be trusted.
 *
 * A fee earner contributes NO equity. Dropping the Fund Manager into
 * `PartnerInput` would give it a zero shareholding, a zero invested base and an
 * undefined IRR, and would put a non-equity claim inside a table whose only
 * guarantee is that it sums to the equity total. So fee earners sit ALONGSIDE
 * the equity partners, in their own snapshot, computed by their own function.
 * Nothing in this file touches partners.ts, and nothing in partners.ts knows
 * this file exists.
 *
 * ── TWO INCOME SOURCES, TWO DIFFERENT RULES ───────────────────────────────
 *
 *   MANAGEMENT FEES (the five fund fees from Step 3) are the Fund Manager's by
 *   definition and are NEVER split. The share is a constant 1 for the manager
 *   and 0 for everyone else, which is why it is not a stored input.
 *
 *   THE PERFORMANCE FEE (from the Step 4 waterfall) IS split, across whatever
 *   the M1 fee distribution matrix says, which may include real project parties
 *   as well as the manager.
 *
 * ── SHARES ARE NEVER NORMALISED, AND THAT IS DELIBERATE ───────────────────
 *
 * The distribution matrix is allowed to be half entered: `feeColumnBalanced`
 * treats a column summing to zero as "nothing to reconcile" rather than an
 * error, because a partially filled split is a normal intermediate state.
 *
 * So this module does NOT scale the shares up to 100%. If the column sums to
 * 0.8, exactly 80% of the performance fee is allocated and the remaining 20%
 * is reported as `unallocatedPerformanceFee` for the UI to surface. Silently
 * normalising would invent an allocation the user never entered and would hide
 * the very thing they need to see. `noneAllocated` separates "nobody has filled
 * this in yet" (neutral) from "this is filled in wrong" (a warning).
 *
 * PURE: primitives in, primitives out. No platform import, so the `@core`
 * boundary holds and the resolver maps FundTerms / FeeEarner onto this shape.
 *
 * No em dashes in this file.
 */

/** One entity entitled to fee income. Mapped from the platform's `FeeEarner`. */
export interface FeeEarnerInput {
  /** Stable id: the reserved fund-manager id, or a project party id. */
  entityId: string;
  name: string;
  kind: 'fund_manager' | 'party';
  /** Share of the five management fees. 1 for the manager, 0 for everyone else. */
  managementFeeShare: number;
  /** Share of the performance fee, from the distribution matrix (0 to 1). */
  performanceFeeShare: number;
}

export interface FeeEarnerResult {
  entityId: string;
  name: string;
  kind: 'fund_manager' | 'party';
  managementFeeShare: number;
  performanceFeeShare: number;
  /** Per period, same index basis as the streams (index 0 = inception). */
  managementFeeIncomePerPeriod: number[];
  performanceFeeIncomePerPeriod: number[];
  /** The two above, added. */
  totalFeeIncomePerPeriod: number[];
  totalManagementFeeIncome: number;
  totalPerformanceFeeIncome: number;
  totalFeeIncome: number;
}

export interface FeeEarnersSnapshot {
  /** False when the fund layer is off. Nothing renders, every number is zero. */
  active: boolean;
  earners: FeeEarnerResult[];
  /** Project-level fee totals per period, the amounts being shared out. */
  managementFeePerPeriod: number[];
  performanceFeePerPeriod: number[];
  totalManagementFee: number;
  totalPerformanceFee: number;
  /** What the earners actually take, which is not the total when the matrix
   *  is half filled. */
  allocatedManagementFee: number;
  allocatedPerformanceFee: number;
  /** Sigma earner income per period. */
  totalFeeIncomePerPeriod: number[];
  totalFeeIncome: number;
  // ── Reconciliation, mirroring the partner chip ──
  /** Sigma managementFeeShare. Exactly 1 whenever the fund layer is on. */
  managementFeeShareSum: number;
  managementFeeReconciles: boolean;
  /** Sigma performanceFeeShare across the matrix. */
  performanceFeeShareSum: number;
  /** True when the shares sum to 100 percent within a rounding whisker. */
  performanceFeeReconciles: boolean;
  /** performanceFeeShareSum - 1, signed, for the chip. */
  performanceFeeShareDelta: number;
  /** Nobody has allocated the performance fee yet. A normal starting state,
   *  distinct from an allocation that is filled in wrong. */
  noneAllocated: boolean;
  /** The performance fee no earner is entitled to. Surfaced, never absorbed. */
  unallocatedPerformanceFee: number;
}

const zeros = (n: number): number[] => new Array<number>(Math.max(0, n)).fill(0);
const sum = (a: readonly number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

export interface FeeEarnerInputs {
  earners: readonly FeeEarnerInput[];
  /** The five management fees, per period, project total. */
  managementFeePerPeriod: readonly number[];
  /** The waterfall's performance fee, per period, project total. */
  performanceFeePerPeriod: readonly number[];
  /** False (the fund toggle off) returns an empty inactive snapshot. */
  active: boolean;
}

/**
 * Share the fund's fees across the entities entitled to them.
 *
 * Returns an EMPTY inactive snapshot when the fund layer is off, so a caller
 * can run this unconditionally and a standalone project provably renders
 * nothing. Same shape as `emptyFundFeeSchedule` and `emptyWaterfall`.
 */
export function computeFeeEarnerReturns(input: FeeEarnerInputs): FeeEarnersSnapshot {
  const len = Math.max(input.managementFeePerPeriod.length, input.performanceFeePerPeriod.length);
  if (!input.active) return emptyFeeEarners(len);

  const mgmt = Array.from({ length: len }, (_, t) => input.managementFeePerPeriod[t] ?? 0);
  const perf = Array.from({ length: len }, (_, t) => input.performanceFeePerPeriod[t] ?? 0);

  const earners: FeeEarnerResult[] = input.earners.map((e) => {
    const mShare = Number.isFinite(e.managementFeeShare) ? Math.max(0, e.managementFeeShare) : 0;
    const pShare = Number.isFinite(e.performanceFeeShare) ? Math.max(0, e.performanceFeeShare) : 0;
    const mIncome = mgmt.map((v) => v * mShare);
    const pIncome = perf.map((v) => v * pShare);
    return {
      entityId: e.entityId,
      name: e.name,
      kind: e.kind,
      managementFeeShare: mShare,
      performanceFeeShare: pShare,
      managementFeeIncomePerPeriod: mIncome,
      performanceFeeIncomePerPeriod: pIncome,
      totalFeeIncomePerPeriod: mIncome.map((v, t) => v + (pIncome[t] ?? 0)),
      totalManagementFeeIncome: sum(mIncome),
      totalPerformanceFeeIncome: sum(pIncome),
      totalFeeIncome: sum(mIncome) + sum(pIncome),
    };
  });

  const totalFeeIncomePerPeriod = zeros(len);
  for (const e of earners) {
    for (let t = 0; t < len; t++) totalFeeIncomePerPeriod[t] += e.totalFeeIncomePerPeriod[t] ?? 0;
  }

  const totalManagementFee = sum(mgmt);
  const totalPerformanceFee = sum(perf);
  const allocatedManagementFee = earners.reduce((s, e) => s + e.totalManagementFeeIncome, 0);
  const allocatedPerformanceFee = earners.reduce((s, e) => s + e.totalPerformanceFeeIncome, 0);
  const managementFeeShareSum = earners.reduce((s, e) => s + e.managementFeeShare, 0);
  const performanceFeeShareSum = earners.reduce((s, e) => s + e.performanceFeeShare, 0);

  return {
    active: true,
    earners,
    managementFeePerPeriod: mgmt,
    performanceFeePerPeriod: perf,
    totalManagementFee,
    totalPerformanceFee,
    allocatedManagementFee,
    allocatedPerformanceFee,
    totalFeeIncomePerPeriod,
    totalFeeIncome: sum(totalFeeIncomePerPeriod),
    managementFeeShareSum,
    managementFeeReconciles: Math.abs(managementFeeShareSum - 1) <= 1e-6,
    performanceFeeShareSum,
    performanceFeeReconciles: Math.abs(performanceFeeShareSum - 1) <= 1e-6,
    performanceFeeShareDelta: performanceFeeShareSum - 1,
    noneAllocated: performanceFeeShareSum === 0,
    // Never negative: an over-allocated matrix (shares above 100%) would
    // otherwise report a negative "unallocated", which reads as the fund owing
    // itself money rather than as the over-allocation the chip already flags.
    unallocatedPerformanceFee: Math.max(0, totalPerformanceFee - allocatedPerformanceFee),
  };
}

/** An empty inactive snapshot, for the toggle-off path. */
export function emptyFeeEarners(len: number): FeeEarnersSnapshot {
  const n = Math.max(0, len);
  return {
    active: false,
    earners: [],
    managementFeePerPeriod: zeros(n),
    performanceFeePerPeriod: zeros(n),
    totalManagementFee: 0,
    totalPerformanceFee: 0,
    allocatedManagementFee: 0,
    allocatedPerformanceFee: 0,
    totalFeeIncomePerPeriod: zeros(n),
    totalFeeIncome: 0,
    managementFeeShareSum: 0,
    managementFeeReconciles: true,
    performanceFeeShareSum: 0,
    performanceFeeReconciles: true,
    performanceFeeShareDelta: 0,
    noneAllocated: true,
    unallocatedPerformanceFee: 0,
  };
}
