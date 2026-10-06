/**
 * taxCharge.ts (2026-10-05, export review group 4, founder's decision)
 *
 * THE TAX CHARGE DEPENDS ON THE BASIS, AND THE BASIS IS STATED.
 *
 *   zakat   A charge on net worth, not an income tax: it is assessed each
 *           year on its own, so a loss year carries nothing forward. The
 *           engine's charge is the stated rate on the year's positive profit,
 *           as before.
 *   cit     Corporate income tax, the KSA rule: tax losses carry forward
 *           without limit of time, and the relief taken in any year is capped
 *           at 25% of that year's taxable profit.
 *
 * Absent means zakat, so every existing project charges exactly what it did.
 * Pure: arrays in, arrays out, no imports. The financials resolver is the one
 * caller, for the year's profit before tax and again, with the disposal gain
 * taken out, at the exit.
 */

export type TaxBasis = 'zakat' | 'cit';
export const DEFAULT_TAX_BASIS: TaxBasis = 'zakat';
/** KSA: losses brought forward may offset at most 25% of a year's taxable profit. */
export const CIT_LOSS_RELIEF_CAP = 0.25;

export interface TaxCharge {
  /** The charge per period. */
  tax: number[];
  /** Losses relieved against each period's profit (cit only; zeros on zakat). */
  lossReliefPerPeriod: number[];
  /** Unrelieved losses carried forward at each period's close (cit only). */
  lossCarriedForwardPerPeriod: number[];
  /** Losses arising per period (the negative taxable bases), on either basis. */
  lossesArisingPerPeriod: number[];
}

export function chargeTax(base: readonly number[], rate: number, basis: TaxBasis | undefined): TaxCharge {
  const r = Math.max(0, rate);
  const n = base.length;
  const tax = new Array<number>(n).fill(0);
  const relief = new Array<number>(n).fill(0);
  const pool = new Array<number>(n).fill(0);
  const arising = new Array<number>(n).fill(0);
  let carried = 0;
  for (let t = 0; t < n; t++) {
    const b = base[t] ?? 0;
    if (b < 0) {
      arising[t] = -b;
      if (basis === 'cit') carried += -b;
    } else if (basis === 'cit') {
      relief[t] = Math.min(carried, b * CIT_LOSS_RELIEF_CAP);
      carried -= relief[t];
      tax[t] = (b - relief[t]) * r;
    } else {
      tax[t] = b * r;
    }
    pool[t] = carried;
  }
  return { tax, lossReliefPerPeriod: relief, lossCarriedForwardPerPeriod: pool, lossesArisingPerPeriod: arising };
}
