/**
 * Unearned Revenue (deferred revenue) for the Sell-strategy stream.
 *
 * Pass 7m (2026-05-17): per-cohort roll-forward floored. Mirror of
 * [[accountsReceivable]]: each cohort (sale year) carries its own
 * Unearned balance because the contract-level cash-vs-recognition
 * offset lives at the contract level. Aggregating with an aggregate
 * floor (Pass 7k) loses early deficits and ends with a stuck balance
 * even when cumulative cash equals cumulative recognition.
 *
 *   For each cohort s:
 *     cumRec_s[t] = sum_{k<=t} recognitionMatrix[s][k]
 *     cumCash_s[t] = sum_{k<=t} cashMatrix[s][k]
 *     UR_s[t] = MAX(0, cumCash_s[t] - cumRec_s[t])
 *
 *   Aggregate:
 *     UR[t] = sum_s UR_s[t]
 *
 * The roll-forward arrays (opening, closing, change) are derived from
 * the per-period cohort sums so opening[i+1] = closing[i] holds and
 * change[i] = closing[i] - opening[i] still drives the CF
 * working-capital delta.
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
  recognitionVintageMatrix?: number[][],
  cashVintageMatrix?: number[][],
): UnearnedRevenueResult {
  const N = Math.max(0, axisLength);
  const cumRec = new Array<number>(N).fill(0);
  const cumCash = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  let rRunning = 0;
  let cRunning = 0;
  for (let i = 0; i < N; i++) {
    rRunning += Math.max(0, recognitionPerPeriod[i] ?? 0);
    cRunning += Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    cumRec[i] = rRunning;
    cumCash[i] = cRunning;
  }

  if (recognitionVintageMatrix && cashVintageMatrix) {
    for (let t = 0; t < N; t++) {
      let agg = 0;
      for (let s = 0; s < N; s++) {
        let cumRecS = 0;
        let cumCashS = 0;
        for (let k = 0; k <= t; k++) {
          cumRecS += Math.max(0, recognitionVintageMatrix[s]?.[k] ?? 0);
          cumCashS += Math.max(0, cashVintageMatrix[s]?.[k] ?? 0);
        }
        agg += Math.max(0, cumCashS - cumRecS);
      }
      closing[t] = agg;
      opening[t] = t === 0 ? 0 : closing[t - 1];
      change[t] = closing[t] - opening[t];
    }
  } else {
    for (let i = 0; i < N; i++) {
      closing[i] = Math.max(0, cumCash[i] - cumRec[i]);
      opening[i] = i === 0 ? 0 : closing[i - 1];
      change[i] = closing[i] - opening[i];
    }
  }

  return {
    perPeriod: closing,
    openingPerPeriod: opening,
    changePerPeriod: change,
    cumulativeRecognition: cumRec,
    cumulativeCash: cumCash,
  };
}
