/**
 * fundFees.ts (REFM fund layer Step 3: the fee schedule)
 *
 * Turns the M1 Fund Terms inputs into a per-period fee schedule the M4
 * composer books as an expense and a cash outflow. See
 * docs/FUND_LAYER_GUIDELINE.md.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO PROTECT ───────────────────────────────
 *
 * A fee is a cash outflow, so paying it RAISES the funding requirement. The
 * funding requirement is solved iteratively in `computeFinancialsSnapshot`
 * (gap sizing, conditional IDC and the cash sweep are fed back until they
 * converge). If a fee were computed INSIDE that loop from anything the solver
 * moves, the fee would drift every iteration and, with a NAV that includes
 * funded cash, more funding would mean a bigger fee. That is the circular
 * dependency the guideline forbids.
 *
 * So this module is PURE and is called ONCE, BEFORE the loop, from a fee-free
 * snapshot. The schedule it returns is then a FROZEN INPUT to every iteration.
 * Fees raise funding; funding cannot raise fees, because by the time the
 * solver runs the fee numbers are already constants.
 *
 * Two further belts on the same braces:
 *   - Every base comes from FUND_FEE_SPECS, which the verifier polices against
 *     LINEAR_FEE_BASES, so a fee cannot even DECLARE a circular base.
 *   - NAV is NET assets (assets minus liabilities), so drawing more debt does
 *     not move it: cash and debt rise together. Only equity moves NAV, and
 *     equity contributions are user inputs, not solver outputs.
 *
 * ── TIMING ────────────────────────────────────────────────────────────────
 *
 *   one_time  charged once, in the FIRST period of the project axis. The fund
 *             is established and the facility is arranged at the start; there
 *             is no later event in the model to hang them off.
 *   annual    charged every period of the axis.
 *
 * ── OPENING NAV ───────────────────────────────────────────────────────────
 *
 * An annual NAV fee for period t charges NAV at the START of t, which is the
 * CLOSE of t-1. At t = 0 there is no prior period, so opening NAV is zero and
 * the first period carries no NAV fee. That is deliberate: the fund holds no
 * net assets before its first period, and inventing a base (this period's
 * closing NAV, say) is exactly the circular shortcut this design refuses.
 *
 * PURE: no I/O, no state, no engine import. Everything arrives as arguments.
 *
 * No em dashes in this file.
 */

import { FUND_FEE_SPECS, type FeeSpec, type FundTerms } from './fundTerms';

/** One fee's resolved schedule. */
export interface FundFeeLine {
  key: FeeSpec['key'];
  label: string;
  timing: FeeSpec['timing'];
  base: FeeSpec['base'];
  /** The rate applied (decimal fraction), or 0 for a flat-amount fee. */
  rate: number;
  /** The base amount used in each period. Zero where the fee does not apply. */
  basisPerPeriod: number[];
  /** The fee charged in each period. */
  amountPerPeriod: number[];
  total: number;
}

export interface FundFeeSchedule {
  /** True when the fund toggle is on. False means every array is zeros. */
  active: boolean;
  axisLength: number;
  /** Per-fee detail, in FUND_FEE_SPECS order. */
  lines: FundFeeLine[];
  /** Sum of every fee, per period. This is the number M4 books. */
  totalPerPeriod: number[];
  total: number;
  /** The opening-NAV series the NAV fees charged on, surfaced so the UI and
   *  the verifier can show WHAT was charged rather than only how much. */
  openingNavPerPeriod: number[];
  /** The facility limit the arranging fee charged on, and where it came from,
   *  so the tab can show the source rather than an unexplained number. */
  facilityLimit: ResolvedFacilityLimit;
  /** The fund size the structure fee charged on, and where it came from. */
  fundSize: ResolvedFundSize;
  /**
   * The two components of the fund size, resolved as bases in their own right
   * (2026-08-10) because the annual fees charge on equity alone and the
   * arranging fee on debt alone.
   *
   * Resolved INDEPENDENTLY of `fundSize` rather than read off its
   * `equityTotal` / `debtTotal`, because a `fundSizeOverride` replaces the
   * fund size with a typed target and zeroes those components. The equity and
   * debt bases must keep reporting what the model actually raised even then.
   *
   * `totalEquity.amount + debtFacility.amount == fundSize.amount` whenever the
   * fund size is model-derived, which is what lets the basis table show the
   * three figures and have a reader add the first two to get the third.
   */
  totalEquity: ResolvedCapital;
  debtFacility: ResolvedCapital;
}

/** A lifetime capital total used as a fee base, with its provenance. */
export interface ResolvedCapital {
  amount: number;
  source: 'model' | 'none';
  explanation: string;
}

const zeros = (n: number): number[] => new Array<number>(Math.max(0, n)).fill(0);

// ── Facility limit, resolved from the model ────────────────────────────────

/** Where the facility limit used as a fee base came from. */
export type FacilityLimitSource = 'stated_principal' | 'ltv_cap' | 'manual' | 'none';

export interface ResolvedFacilityLimit {
  amount: number;
  source: FacilityLimitSource;
  /** Human sentence for the tab, so the user can see WHY the number is what it is. */
  explanation: string;
  /**
   * False when the SOURCE was determined but the amount could not be computed
   * here, which happens only in the UI: the LTV cap needs a capex total, and
   * the Fund Terms tab has no cheap way to get one. Re-implementing capex in
   * the tab would be a second implementation free to drift from the engine's,
   * so instead the tab shows the percentage and says the amount comes from the
   * model. The engine always passes a capex total, so it always gets an amount.
   */
  amountKnown: boolean;
}

/** The tranche fields this resolver reads. Structural, so no engine import. */
export interface FacilityLimitTranche {
  principal?: number;
  ltvPct?: number;
}

/**
 * The facility LIMIT the debt arranging fee charges on.
 *
 * Read from the model where the model states one, because asking a user to
 * retype a number the model already holds is how the two drift apart.
 *
 * ONLY INPUTS ARE CONSIDERED, in this order:
 *
 *   1. stated principal  Sigma tranche.principal where set. An absolute
 *                        facility amount the user typed. (Note: this field is
 *                        currently inert in the financing engine, but it is
 *                        still the user's stated facility size, and it is an
 *                        input, which is all the fee base requires.)
 *   2. LTV cap           Sigma (tranche.ltvPct% x capex). ltvPct is deprecated
 *                        for per-facility drawdown scaling but is still the
 *                        only stated LTV cap in the model. Capex comes from the
 *                        cost lines and carries no IDC, so it does NOT move
 *                        with the funding solve.
 *   3. manual            the figure typed on the Fund Terms tab.
 *
 * THE DRAWN BALANCE IS NEVER USED. `FacilityResult.outstanding` and
 * `drawSchedule` are SOLVED OUTPUTS: under Methods 2 and 3 they come straight
 * from the funding gap, which the fees themselves raise. Charging the arranging
 * fee on drawn debt would be the exact circularity this layer forbids, which is
 * why this function takes tranche INPUTS and a capex total, and has no access
 * to a computed facility result at all.
 */
export function resolveFacilityLimit(args: {
  tranches: readonly FacilityLimitTranche[];
  /** Total capex, excluding in-kind land. An input-driven aggregate. `null`
   *  means the caller cannot compute it (the UI); see `amountKnown`. */
  capexTotal: number | null;
  /** The figure typed on the Fund Terms tab. */
  manualLimit: number;
  /** When true the typed figure wins, whatever the model says. */
  override: boolean;
}): ResolvedFacilityLimit {
  const manual = Math.max(0, args.manualLimit || 0);
  if (args.override) {
    return { amount: manual, source: 'manual', amountKnown: true, explanation: 'Using the amount you entered (override is on).' };
  }

  const statedPrincipal = (args.tranches ?? [])
    .reduce((s, t) => s + Math.max(0, Number(t.principal) || 0), 0);
  if (statedPrincipal > 0) {
    return {
      amount: statedPrincipal,
      source: 'stated_principal',
      amountKnown: true,
      explanation: 'From your facilities: the stated principal on the debt tranches in Module 1 Financing.',
    };
  }

  const ltvSum = (args.tranches ?? [])
    .reduce((s, t) => s + Math.max(0, Number(t.ltvPct) || 0), 0);
  if (ltvSum > 0) {
    if (args.capexTotal === null) {
      return {
        amount: 0, source: 'ltv_cap', amountKnown: false,
        explanation: `From your facilities: the LTV cap (${ltvSum.toFixed(2)}% of project capex). The amount is computed in the model, not here. Never the drawn balance.`,
      };
    }
    const capex = Math.max(0, args.capexTotal || 0);
    if (capex > 0) {
      return {
        amount: (ltvSum / 100) * capex,
        source: 'ltv_cap',
        amountKnown: true,
        explanation: `From your facilities: the LTV cap (${ltvSum.toFixed(2)}% of project capex). Not the drawn balance.`,
      };
    }
  }

  if (manual > 0) {
    return { amount: manual, source: 'manual', amountKnown: true, explanation: 'Your facilities state no limit, so the amount you entered is used.' };
  }
  return { amount: 0, source: 'none', amountKnown: true, explanation: 'No facility limit found in your model, and none entered, so this fee is zero.' };
}

// ── Fund size, resolved from the model ─────────────────────────────────────

/** Where the fund size used as a fee base came from. */
export type FundSizeSource = 'model' | 'manual' | 'none';

export interface ResolvedFundSize {
  amount: number;
  source: FundSizeSource;
  /** Human sentence for the tab, so the user can see WHY the number is what
   *  it is rather than being handed an unexplained total. */
  explanation: string;
  /** The parts the model figure was built from, surfaced so a reader can check
   *  the arithmetic instead of trusting it. Zero on the manual path. */
  equityTotal: number;
  debtTotal: number;
  /** False when the source was determined but the amount cannot be computed
   *  here, which happens only in the UI: the model figure needs a computed
   *  snapshot, and the Fund Terms tab has none. Re-implementing the funding
   *  solve in the tab would be a second implementation free to drift, so the
   *  tab says where the number comes from and the engine supplies it. */
  amountKnown: boolean;
}

/**
 * The FUND SIZE the structure fee charges on.
 *
 * ── THIS CHANGED ON 2026-08-05, AND THE CHANGE IS THE DANGEROUS KIND ───────
 *
 * Fund size used to be a TYPED input, deliberately, because fund size is
 * equity plus debt, debt is solved by the funding requirement, and the fees
 * raise that requirement. Reading it from the model makes the fee feed its own
 * base, which is the exact circularity this whole layer is built to avoid.
 * `fund_size_solved` is named in CIRCULAR_FEE_BASES for precisely this reason
 * and STAYS FORBIDDEN: no fee may ever declare it.
 *
 * What makes the model-derived figure safe is not that the danger went away.
 * It is the FREEZE. This function is called ONCE, from the fee-free pass,
 * before the iterative solver runs, and the number it returns is then a
 * constant for every iteration. That is the identical treatment opening NAV
 * gets in Step 3, and it is the only reason a solved aggregate can be a base
 * at all.
 *
 * So the invariant to hold on to is narrow and precise:
 *
 *   the BASE KIND is `fund_size`, which is linear and allowed;
 *   the VALUE is resolved once, from a fee-free snapshot, and frozen;
 *   `fund_size_solved` (reading a live solved figure inside the loop) is
 *   still forbidden and still unimplementable.
 *
 * ── WHICH FIGURE ──────────────────────────────────────────────────────────
 *
 * Since 2026-08-19: THE SELECTED FUNDING METHOD'S REQUIREMENT, split at its
 * base debt / equity ratio (the reference charges its fees on "Base
 * Requirement" x the debt or equity share). The caller passes the two shares;
 * this function adds them. IDC drawdowns, the fee's own equity draw, land in
 * kind and pre-existing capital are outside the base: the fee is charged on
 * the capital the development REQUIRES, not on what the solve happened to draw.
 * Before that date the figure was every draw the model made over its life.
 */
export function resolveFundSize(args: {
  /** The equity share of the selected method's requirement (base, no in-kind,
   *  no existing, no fee draw). */
  equityTotal: number | null;
  /** The debt share of the selected method's requirement (base, no IDC
   *  drawdown, no existing debt). */
  debtTotal: number | null;
  /** The figure typed on the Fund Terms tab. */
  manualSize: number;
  /** When true the typed figure wins, whatever the model says. */
  override: boolean;
}): ResolvedFundSize {
  const manual = Math.max(0, args.manualSize || 0);
  if (args.override) {
    return {
      amount: manual, source: 'manual', amountKnown: true, equityTotal: 0, debtTotal: 0,
      explanation: 'Using the target fund size you entered (override is on).',
    };
  }
  if (args.equityTotal === null || args.debtTotal === null) {
    return {
      amount: 0, source: 'model', amountKnown: false, equityTotal: 0, debtTotal: 0,
      explanation: 'From your model: the selected funding method requirement (base debt plus base equity). The amount is computed in the model, not here.',
    };
  }
  const equity = Math.max(0, args.equityTotal || 0);
  const debt = Math.max(0, args.debtTotal || 0);
  const total = equity + debt;
  if (total > 0) {
    return {
      amount: total, source: 'model', amountKnown: true, equityTotal: equity, debtTotal: debt,
      explanation: 'From your model: the selected funding method requirement, base debt plus base equity, frozen before the funding solve so the fee cannot feed its own base.',
    };
  }
  if (manual > 0) {
    return {
      amount: manual, source: 'manual', amountKnown: true, equityTotal: 0, debtTotal: 0,
      explanation: 'Your model raises no capital yet, so the amount you entered is used.',
    };
  }
  return {
    amount: 0, source: 'none', amountKnown: true, equityTotal: 0, debtTotal: 0,
    explanation: 'No capital in the model and no target entered, so this fee is zero.',
  };
}

/**
 * Opening NAV per period from a closing-NAV series.
 *
 * opening[t] = closing[t-1], and opening[0] = 0. Exported because the rule is
 * the whole reason NAV fees are linear, so it is worth testing on its own
 * rather than only through the schedule.
 */
export function openingFromClosing(closingPerPeriod: readonly number[] | undefined, axisLength: number): number[] {
  const out = zeros(axisLength);
  if (!closingPerPeriod) return out;
  for (let t = 1; t < axisLength; t++) out[t] = closingPerPeriod[t - 1] ?? 0;
  return out;
}

export interface FundFeeInputs {
  terms: FundTerms;
  axisLength: number;
  /**
   * NAV at the CLOSE of each period, from a snapshot computed WITHOUT fees.
   * Net assets (assets minus liabilities), so funding does not move it.
   */
  closingNavPerPeriod: readonly number[];
  /**
   * The facility limit, already resolved from the model by
   * `resolveFacilityLimit`. Passed in rather than read off `terms` so the fee
   * base is whatever the model actually states, with the typed figure as the
   * fallback. Omit to fall back to the typed figure alone.
   */
  facilityLimit?: ResolvedFacilityLimit;
  /**
   * The fund size, already resolved from the model by `resolveFundSize`.
   * Passed in rather than read off `terms` so the base is what the model
   * actually raises, with the typed figure as the override and the fallback.
   * FROZEN: resolved once from a fee-free snapshot, never re-derived here.
   */
  fundSize?: ResolvedFundSize;
  /**
   * Total equity and the debt facility, each a lifetime total resolved from the
   * FEE-FREE pass and frozen. Omit on the pure-unit-test path and they fall
   * back to the fund size's own components.
   */
  totalEquity?: ResolvedCapital;
  debtFacility?: ResolvedCapital;
}

/**
 * Build the fee schedule.
 *
 * Returns an all-zero schedule when the fund toggle is off, so a caller can
 * book the result unconditionally and a standalone project is provably
 * unchanged: adding zero to a line is not the same as skipping the line, and
 * the zero path is what the regression guard exercises.
 */
export function computeFundFeeSchedule(input: FundFeeInputs): FundFeeSchedule {
  const { terms, axisLength } = input;
  const N = Math.max(0, axisLength);
  const openingNav = openingFromClosing(input.closingNavPerPeriod, N);
  // The resolved limit, or the typed figure when no resolution was supplied
  // (the pure-unit-test path).
  const facilityLimit: ResolvedFacilityLimit = input.facilityLimit
    ?? { amount: terms.facilityLimit, source: 'manual', amountKnown: true, explanation: 'Using the amount entered on the Fund Terms tab.' };
  const fundSize: ResolvedFundSize = input.fundSize
    ?? { amount: terms.fundSize, source: 'manual', amountKnown: true, equityTotal: 0, debtTotal: 0, explanation: 'Using the amount entered on the Fund Terms tab.' };
  // The equity and debt bases. Supplied by the resolver from the fee-free pass;
  // the fallback keeps the pure-unit-test path working off the fund size's own
  // components.
  const totalEquity: ResolvedCapital = input.totalEquity
    ?? { amount: Math.max(0, fundSize.equityTotal), source: fundSize.equityTotal > 0 ? 'model' : 'none', explanation: 'All equity injected over the life of the fund.' };
  const debtFacility: ResolvedCapital = input.debtFacility
    ?? { amount: Math.max(0, fundSize.debtTotal), source: fundSize.debtTotal > 0 ? 'model' : 'none', explanation: 'Total debt raised over the life of the fund.' };

  const lines: FundFeeLine[] = FUND_FEE_SPECS.map((spec) => {
    const rate = spec.kind === 'rate' ? (terms[spec.key] as number) : 0;
    const flat = spec.kind === 'amount' ? (terms[spec.key] as number) : 0;
    const basis = zeros(N);
    const amount = zeros(N);

    if (terms.enabled && N > 0) {
      // The base per period, read from the SPEC rather than decided here, so
      // adding a fee is a data change and Step 3 cannot disagree with the tab
      // about what a fee charges on.
      for (let t = 0; t < N; t++) {
        switch (spec.base) {
          case 'fund_size':      basis[t] = fundSize.amount; break;
          case 'total_equity':   basis[t] = totalEquity.amount; break;
          case 'debt_facility':  basis[t] = debtFacility.amount; break;
          case 'facility_limit': basis[t] = facilityLimit.amount; break;
          case 'opening_nav':    basis[t] = Math.max(0, openingNav[t] ?? 0); break;
          case 'flat_amount':    basis[t] = flat; break;
        }
      }
      // Timing decides WHICH periods actually carry the charge.
      if (spec.timing === 'one_time') {
        // Charged once, at the start. Later periods keep a zero basis so a
        // reader cannot mistake the constant base for a recurring charge.
        amount[0] = spec.kind === 'rate' ? basis[0] * rate : flat;
        for (let t = 1; t < N; t++) basis[t] = 0;
      } else {
        for (let t = 0; t < N; t++) amount[t] = spec.kind === 'rate' ? basis[t] * rate : flat;
      }
    } else {
      // Toggle off: no basis, no charge. Not even the constant bases, so a
      // disabled fund shows nothing rather than a fee of zero on a real base.
      for (let t = 0; t < N; t++) basis[t] = 0;
    }

    return {
      key: spec.key, label: spec.label, timing: spec.timing, base: spec.base, rate,
      basisPerPeriod: basis,
      amountPerPeriod: amount,
      total: amount.reduce((s, v) => s + v, 0),
    };
  });

  const totalPerPeriod = zeros(N);
  for (const line of lines) {
    for (let t = 0; t < N; t++) totalPerPeriod[t] += line.amountPerPeriod[t] ?? 0;
  }

  return {
    active: terms.enabled,
    axisLength: N,
    lines,
    totalPerPeriod,
    total: totalPerPeriod.reduce((s, v) => s + v, 0),
    openingNavPerPeriod: terms.enabled ? openingNav : zeros(N),
    facilityLimit,
    fundSize,
    totalEquity,
    debtFacility,
  };
}

/** An all-zero schedule, for the toggle-off path and for callers with no terms. */
export function emptyFundFeeSchedule(axisLength: number): FundFeeSchedule {
  const N = Math.max(0, axisLength);
  return {
    active: false,
    axisLength: N,
    lines: FUND_FEE_SPECS.map((spec) => ({
      key: spec.key, label: spec.label, timing: spec.timing, base: spec.base, rate: 0,
      basisPerPeriod: zeros(N), amountPerPeriod: zeros(N), total: 0,
    })),
    totalPerPeriod: zeros(N),
    total: 0,
    openingNavPerPeriod: zeros(N),
    facilityLimit: { amount: 0, source: 'none', amountKnown: true, explanation: 'The fund layer is off.' },
    fundSize: { amount: 0, source: 'none', amountKnown: true, equityTotal: 0, debtTotal: 0, explanation: 'The fund layer is off.' },
    totalEquity: { amount: 0, source: 'none', explanation: 'The fund layer is off.' },
    debtFacility: { amount: 0, source: 'none', explanation: 'The fund layer is off.' },
  };
}
