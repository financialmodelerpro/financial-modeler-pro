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
          case 'fund_size':      basis[t] = terms.fundSize; break;
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
  };
}
