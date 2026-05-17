/**
 * Unearned Revenue (deferred revenue) for the Sell-strategy stream.
 *
 * Pass 7k (2026-05-17): roll-forward floored, mirrors MAAD v1.16
 * "BS Build" sheet, section 4 (Unearned Revenue / off-plan):
 *
 *   Opening[i]   = Closing[i-1]    (Opening[0] = 0)
 *   Closing[i]   = MAX(0, Opening[i] + Cash[i] - Recognised[i])
 *   ChangeInUR[i]= Closing[i] - Opening[i]   (CF working-capital delta)
 *
 * Mirror of [[accountsReceivable]]: when the customer has paid more than
 * the developer has earned, the gap sits as a liability on the balance
 * sheet. Roll-forward applies the floor EACH period so once Unearned
 * unwinds to 0, new cash overruns build it back up.
 *
 * Returns project-axis-indexed arrays (length N).
 */
export interface UnearnedRevenueResult {
  perPeriod: number[];           // closing Unearned per period
  openingPerPeriod: number[];    // opening Unearned per period (Closing[i-1])
  changePerPeriod: number[];     // Closing - Opening, drives CF working-cap delta
  cumulativeRecognition: number[];
  cumulativeCash: number[];
}

export function buildUnearnedRevenue(
  recognitionPerPeriod: number[],
  cashCollectedPerPeriod: number[],
  axisLength: number,
): UnearnedRevenueResult {
  const N = Math.max(0, axisLength);
  const cumRec = new Array<number>(N).fill(0);
  const cumCash = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  let rRunning = 0;
  let cRunning = 0;
  let prevClose = 0;
  for (let i = 0; i < N; i++) {
    const rec = Math.max(0, recognitionPerPeriod[i] ?? 0);
    const cash = Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    rRunning += rec;
    cRunning += cash;
    cumRec[i] = rRunning;
    cumCash[i] = cRunning;
    const open = prevClose;
    const close = Math.max(0, open + cash - rec);
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
