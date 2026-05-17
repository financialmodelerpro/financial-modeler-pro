/**
 * Accounts Receivable for the Sell-strategy revenue stream.
 *
 * AR identity (per period i):
 *   AR[i] = max(0, cumRecognition[i] - cumCash[i])
 *
 * Why max(0): when cumulative cash overruns cumulative recognition (common
 * in MAAD-style milestone schedules where escrow lands before revenue is
 * earned), the gap flows to Unearned Revenue instead, NOT to negative AR.
 *
 * Returns project-axis-indexed arrays (length N).
 */
export interface AccountsReceivableResult {
  perPeriod: number[];
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
  const ar = new Array<number>(N).fill(0);

  let rRunning = 0;
  let cRunning = 0;
  for (let i = 0; i < N; i++) {
    rRunning += Math.max(0, recognitionPerPeriod[i] ?? 0);
    cRunning += Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    cumRec[i] = rRunning;
    cumCash[i] = cRunning;
    ar[i] = Math.max(0, rRunning - cRunning);
  }

  return { perPeriod: ar, cumulativeRecognition: cumRec, cumulativeCash: cumCash };
}
