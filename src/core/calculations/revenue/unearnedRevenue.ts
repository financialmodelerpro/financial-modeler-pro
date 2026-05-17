/**
 * Unearned Revenue (deferred revenue) for the Sell-strategy stream.
 *
 * Unearned identity (per period i):
 *   Unearned[i] = max(0, cumCash[i] - cumRecognition[i])
 *
 * The mirror of [[accountsReceivable]]: when the customer has paid more
 * than the developer has earned (typical in pre-sales escrow-heavy markets
 * before construction milestones land), the gap sits as a liability on
 * the balance sheet. When recognition catches up the liability unwinds.
 *
 * Returns project-axis-indexed arrays (length N).
 */
export interface UnearnedRevenueResult {
  perPeriod: number[];
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
  const ur = new Array<number>(N).fill(0);

  let rRunning = 0;
  let cRunning = 0;
  for (let i = 0; i < N; i++) {
    rRunning += Math.max(0, recognitionPerPeriod[i] ?? 0);
    cRunning += Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    cumRec[i] = rRunning;
    cumCash[i] = cRunning;
    ur[i] = Math.max(0, cRunning - rRunning);
  }

  return { perPeriod: ur, cumulativeRecognition: cumRec, cumulativeCash: cumCash };
}
