/**
 * M2 Pass 8d (2026-05-18): DSO-driven AR roll-forward for operating
 * revenue (Hospitality / Lease).
 *
 * Unlike the milestone-driven AR used by Sell (built in
 * accountsReceivable.ts from explicit sale-value vs cash-collected
 * series), the operating-revenue AR uses Days Sales Outstanding as a
 * single driver:
 *
 *   AR_closing[y] = Revenue[y] × (dso / daysPerYear)
 *
 * That is: at the end of each year, AR balance equals the implied
 * "X days of revenue still outstanding" snapshot. The opening balance
 * for year y is the closing balance of year y-1 (opening[0] = 0).
 *
 * Cash received = Revenue - ΔAR (so cash lags revenue by the DSO
 * roll, settling to zero as revenue tails off).
 */

export interface AccountsReceivableDSOResult {
  /** Closing AR balance per period. */
  perPeriod: number[];
  /** Opening AR balance per period (= prior period closing). */
  openingPerPeriod: number[];
  /** Change in AR (closing - opening) per period. */
  changePerPeriod: number[];
  /** Implied cash received (revenue - change in AR) per period. */
  cashReceivedPerPeriod: number[];
}

export interface BuildAccountsReceivableDSOInputs {
  revenuePerPeriod: number[];
  dsoDays: number;
  daysPerYear?: number;
  axisLength: number;
}

export function buildAccountsReceivableDSO(
  inputs: BuildAccountsReceivableDSOInputs,
): AccountsReceivableDSOResult {
  const { revenuePerPeriod, dsoDays, daysPerYear = 365, axisLength } = inputs;
  const N = Math.max(0, axisLength);
  const dso = Math.max(0, dsoDays);
  const days = Math.max(1, daysPerYear);
  const ratio = dso / days;

  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);
  const cash = new Array<number>(N).fill(0);

  for (let y = 0; y < N; y++) {
    const rev = Math.max(0, revenuePerPeriod[y] ?? 0);
    closing[y] = rev * ratio;
    opening[y] = y === 0 ? 0 : closing[y - 1];
    change[y] = closing[y] - opening[y];
    cash[y] = rev - change[y];
  }

  return {
    perPeriod: closing,
    openingPerPeriod: opening,
    changePerPeriod: change,
    cashReceivedPerPeriod: cash,
  };
}
