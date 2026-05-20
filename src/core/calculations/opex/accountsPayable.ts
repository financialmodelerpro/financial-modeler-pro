/**
 * M4 Pass 2a (2026-05-20): DPO-driven Accounts Payable roll-forward
 * for operating expenses.
 *
 * Mirrors the DSO-driven AR builder in revenue/accountsReceivableDSO.ts
 * but on the cost side: how much of each period's opex stays unpaid at
 * year-end, rolling forward as opening AP next period.
 *
 *   AP_closing[y] = OpexIncurred[y] × (dpo / daysPerYear)
 *   AP_opening[y] = AP_closing[y - 1]    (opening[0] = 0)
 *   ΔAP[y]        = closing - opening
 *   CashPaid[y]   = OpexIncurred[y] - ΔAP[y]
 *
 * Reading: at year-end, AP balance = "DPO days' worth of this year's
 * opex" still owed. Cash paid lags by the DPO roll, settling to zero
 * once opex ramps to a steady state.
 *
 * Sign convention: opexIncurred and cashPaid are non-negative; AP
 * balance is non-negative.
 */

export interface AccountsPayableResult {
  /** Closing AP balance per period. */
  perPeriod: number[];
  /** Opening AP balance per period (= prior period closing; opening[0] = 0). */
  openingPerPeriod: number[];
  /** Change in AP (closing - opening) per period. */
  changePerPeriod: number[];
  /** Cash paid (opex incurred - change in AP) per period. */
  cashPaidPerPeriod: number[];
}

export interface BuildAccountsPayableInputs {
  opexIncurredPerPeriod: number[];
  dpoDays: number;
  daysPerYear?: number;
  axisLength: number;
}

export function buildAccountsPayable(
  inputs: BuildAccountsPayableInputs,
): AccountsPayableResult {
  const { opexIncurredPerPeriod, dpoDays, daysPerYear = 365, axisLength } = inputs;
  const N = Math.max(0, axisLength);
  const dpo = Math.max(0, dpoDays);
  const days = Math.max(1, daysPerYear);
  const ratio = dpo / days;

  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);
  const paid = new Array<number>(N).fill(0);

  for (let y = 0; y < N; y++) {
    const opex = Math.max(0, opexIncurredPerPeriod[y] ?? 0);
    closing[y] = opex * ratio;
    opening[y] = y === 0 ? 0 : closing[y - 1];
    change[y] = closing[y] - opening[y];
    paid[y] = opex - change[y];
  }

  return {
    perPeriod: closing,
    openingPerPeriod: opening,
    changePerPeriod: change,
    cashPaidPerPeriod: paid,
  };
}
