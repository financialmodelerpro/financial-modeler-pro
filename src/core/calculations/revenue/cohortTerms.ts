/**
 * cohortTerms.ts (2026-08-19)
 *
 * THE SALE COHORT PAYMENT RULE, AS ONE PURE FUNCTION.
 *
 * A cohort is one sale year. Under the reference model's rule it pays a
 * downpayment in the year it sells and the balance in EQUAL instalments over
 * the years that follow, and the instalment run is cut short by handover
 * because a buyer's payment plan ends when they get the keys. A cohort selling
 * at or after handover skips the schedule and pays in full.
 *
 * Written out, for a cohort selling in year s against a handover year H, with
 * downpayment share d and a maximum instalment run of m years:
 *
 *     s >= H            the whole cohort value in year s
 *     otherwise         d in year s, then (1 - d) / n in each of the next n
 *                       years, where n = min(m, H - s) when instalments must
 *                       stop at handover, and n = m when they may run past it
 *
 * Every row sums to exactly 1, which is the invariant that makes this a
 * re-timing of money rather than a change to how much there is.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ──────────────────────────────────────────
 *
 * The screen needs the same answers the engine will need: what downpayment
 * applies to a given sale year, and how many instalments that cohort gets. If
 * the screen worked those out for itself the caption could promise one thing
 * while the model did another, which is the failure this codebase has paid for
 * repeatedly. So the rule lives here, once, and both sides call it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT KNOW ───────────────────────────────────────
 *
 * It takes plain arrays and numbers and never names a stored field. That keeps
 * it free of the asset shape, and it keeps `verify-sale-cohort-inputs` able to
 * assert that no engine file reads the Step 1 input names while this file is
 * already in place.
 *
 * NOTHING CALLS `buildSaleCohortProfile` YET. Step 2 builds it; Step 3 wires it
 * into the sell engine.
 *
 * Pure. No em dashes in this file.
 */

import type { ProfileSpec } from './cohort';

/**
 * A downpayment entry that has never been set is NOT the same as one set to
 * zero. Zero is a legitimate term (no deposit taken), so the two must stay
 * distinguishable all the way from storage to the screen, or a half-filled
 * strip reads as a fully specified one.
 *
 * `null` in the stored array means "not set". A number means the user said so.
 */
export type DownpaymentEntry = number | null | undefined;

export type DownpaymentSource =
  /** The user set this year explicitly. */
  | 'set'
  /** Not set, carried forward from the most recent year that was. */
  | 'inherited'
  /** Not set, and no earlier year was either. There is nothing to carry. */
  | 'unset';

export interface ResolvedDownpayment {
  /** The share to use, as a fraction. Zero when nothing can be resolved. */
  value: number;
  source: DownpaymentSource;
  /** For 'inherited', the index the value came from. Otherwise undefined. */
  inheritedFrom?: number;
}

/**
 * The downpayment that applies to one sale year, by index into the phase-local
 * array.
 *
 * FORWARD FILL, deliberately. Lengthening a construction period extends the
 * sale-year window, and a new column appearing as a silent 0% would quietly
 * change the terms of every cohort added after it. Carrying the last set value
 * forward is the answer that does not surprise anyone, and marking it as
 * inherited is what stops it being mistaken for a decision.
 */
export function resolveDownpayment(
  values: ReadonlyArray<DownpaymentEntry> | undefined,
  index: number,
): ResolvedDownpayment {
  const arr = values ?? [];
  const own = arr[index];
  if (typeof own === 'number' && Number.isFinite(own)) {
    return { value: own, source: 'set' };
  }
  for (let i = Math.min(index - 1, arr.length - 1); i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { value: v, source: 'inherited', inheritedFrom: i };
    }
  }
  return { value: 0, source: 'unset' };
}

/** True when at least one year has been set. Used to tell "nothing entered
 *  yet" from "deliberately all zero", which read identically before. */
export function hasAnyDownpayment(values: ReadonlyArray<DownpaymentEntry> | undefined): boolean {
  return (values ?? []).some((v) => typeof v === 'number' && Number.isFinite(v));
}

export interface SaleCohortTerms {
  /** Sale year, as an index on the same axis as the handover year. */
  saleYear: number;
  /** The first period in which the asset is handed over. */
  handoverYear: number;
  /** Downpayment as a fraction of the cohort's own sale value. */
  downpayment: number;
  /** The instalment allowance in years. Named apart from the stored field on
   *  purpose: this is a plain number, not a read of the asset config, and the
   *  Step 1 guard proves no engine file reads that field by name. */
  instalmentYearsAllowed: number;
  /** When true, the run is capped so nothing falls after handover. */
  stopAtHandover: boolean;
}

/**
 * How many instalments this cohort actually gets.
 *
 * This is the number the screen quotes and the number the profile below is
 * built from, so a caption saying "two instalments" and a grid paying three is
 * not expressible.
 */
export function instalmentCount(terms: SaleCohortTerms): number {
  const { saleYear, handoverYear, instalmentYearsAllowed, stopAtHandover } = terms;
  const requested = Math.max(0, Math.floor(instalmentYearsAllowed));
  if (saleYear >= handoverYear) return 0;
  if (!stopAtHandover) return requested;
  return Math.max(0, Math.min(requested, handoverYear - saleYear));
}

/**
 * The payment profile for ONE cohort, expressed in the shape the existing
 * cohort matrix already understands: offsets FROM the sale year.
 *
 * Nothing new had to be invented for this. `relative_to_sale` has keyed
 * offsets from the sale year since the matrix was written, so the reference
 * rule is a profile, not a new mechanism.
 */
export function buildSaleCohortProfile(terms: SaleCohortTerms): ProfileSpec {
  const paidInFull: ProfileSpec = {
    percentages: [1],
    positions: [0],
    profileMode: 'relative_to_sale',
  };

  // Sold at or after handover: there is no build left to pay against.
  if (terms.saleYear >= terms.handoverYear) return paidInFull;

  const n = instalmentCount(terms);
  // No instalment years available means the whole amount falls due with the
  // downpayment. That is the honest reading of "nothing may fall after
  // handover" for a cohort with no room left, and it keeps the row summing
  // to 1 rather than losing the balance.
  if (n <= 0) return paidInFull;

  const d = Math.max(0, Math.min(1, terms.downpayment));
  const each = (1 - d) / n;
  const percentages = [d];
  const positions = [0];
  for (let k = 1; k <= n; k++) {
    percentages.push(each);
    positions.push(k);
  }
  return { percentages, positions, profileMode: 'relative_to_sale' };
}
