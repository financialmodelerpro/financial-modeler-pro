/**
 * Accounts Receivable for the Sell-strategy revenue stream.
 *
 * Pass 7k (2026-05-17): roll-forward floored, mirrors MAAD v1.16
 * "BS Build" sheet, section 5 (Residential Sales Receivable):
 *
 *   Opening[i]   = Closing[i-1]    (Opening[0] = 0)
 *   Closing[i]   = MAX(0, Opening[i] + Recognised[i] - Cash[i])
 *   ChangeInAR[i]= Closing[i] - Opening[i]   (CF working-capital delta)
 *
 * This is mathematically different from a cumulative-netting formula
 * (max(0, cumRec - cumCash)): roll-forward applies the floor EACH
 * period, so once AR drops to 0 (cash overruns), it does not "remember"
 * the overhang. New recognition in a later period brings AR back up.
 *
 * Returns project-axis-indexed arrays (length N).
 */
export interface AccountsReceivableResult {
  perPeriod: number[];           // closing AR per period
  openingPerPeriod: number[];    // opening AR per period (Closing[i-1])
  changePerPeriod: number[];     // Closing - Opening, drives CF working-cap delta
  cumulativeRecognition: number[];
  cumulativeCash: number[];
}

export function buildAccountsReceivable(
  recognitionPerPeriod: number[],
  cashCollectedPerPeriod: number[],
  axisLength: number,
): AccountsReceivableResult {
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
    const close = Math.max(0, open + rec - cash);
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
