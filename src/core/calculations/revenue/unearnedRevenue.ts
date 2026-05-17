/**
 * Unearned Revenue (deferred revenue) for the Sell-strategy stream.
 *
 * Pass 7n (2026-05-17, user request): literal accounting formula
 *
 *   Opening[i]  = Closing[i-1]    (Opening[0] = 0)
 *   Closing[i]  = Opening[i] + Pre-Sales Cash[i] - Recognised[i]
 *   Change[i]   = Closing[i] - Opening[i]
 *
 * Signed roll-forward, NO per-period floor. Closing reflects the
 * signed net position over the contract life:
 *   Closing > 0  => Unearned Revenue (deferred liability — cash held
 *                   ahead of recognition)
 *   Closing < 0  => Accounts Receivable position (recognition has
 *                   run ahead of cash; the gap is owed by customers)
 *   Closing = 0  => Settled
 *
 * By construction Closing[N-1] = 0 when total cash equals total
 * recognition over the asset's life. The stuck-balance pathology from
 * the per-period MAX(0, ...) floor cannot occur because deficits and
 * surpluses both accumulate signed.
 *
 * Returns project-axis-indexed arrays (length N).
 */
export interface UnearnedRevenueResult {
  perPeriod: number[];           // signed closing Unearned per period
  openingPerPeriod: number[];    // signed opening Unearned per period (Closing[i-1])
  changePerPeriod: number[];     // Closing - Opening, drives CF working-cap delta
  cumulativeRecognition: number[];
  cumulativeCash: number[];
}

export function buildUnearnedRevenue(
  recognitionPerPeriod: number[],
  cashCollectedPerPeriod: number[],
  axisLength: number,
  // Vintage matrices accepted for source-compat with Pass 7m callers;
  // the literal formula does not need them.
  _recognitionVintageMatrix?: number[][],
  _cashVintageMatrix?: number[][],
): UnearnedRevenueResult {
  const N = Math.max(0, axisLength);
  const cumRec = new Array<number>(N).fill(0);
  const cumCash = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  let prevClose = 0;
  for (let i = 0; i < N; i++) {
    const rec = Math.max(0, recognitionPerPeriod[i] ?? 0);
    const cash = Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    cumRec[i] = (i > 0 ? cumRec[i - 1] : 0) + rec;
    cumCash[i] = (i > 0 ? cumCash[i - 1] : 0) + cash;
    const open = prevClose;
    const close = open + cash - rec; // signed, no floor
    opening[i] = open;
    closing[i] = close;
    change[i] = close - open;
    prevClose = close;
  }

  return {
    perPeriod: closing,
    openingPerPeriod: opening,
    changePerPeriod: change,
    cumulativeRecognition: cumRec,
    cumulativeCash: cumCash,
  };
}
