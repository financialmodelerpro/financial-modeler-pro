/**
 * Accounts Receivable for the Sell-strategy revenue stream.
 *
 * Pass 7m (2026-05-17): per-cohort roll-forward floored. Aggregate
 * roll-forward (the Pass 7k implementation) loses early-period
 * deficits to the per-period floor and ends up with a stuck closing
 * balance even when cumulative cash equals cumulative recognition.
 *
 * The IFRS-15 correct approach: each cohort (sale year) carries its
 * own AR balance because the contract-level offset between revenue
 * recognised and cash collected lives at the contract level. We
 * compute AR per cohort using the vintage matrices, then sum.
 *
 *   For each cohort s:
 *     cumRec_s[t] = sum_{k<=t} recognitionMatrix[s][k]
 *     cumCash_s[t] = sum_{k<=t} cashMatrix[s][k]
 *     AR_s[t] = MAX(0, cumRec_s[t] - cumCash_s[t])
 *
 *   Aggregate:
 *     AR[t] = sum_s AR_s[t]
 *
 * For the common case (single recognition profile + single cash
 * profile across all cohorts where recognition leads cash in every
 * cohort) this equals the aggregate cumulative-netting result. For
 * mixed cohorts (PIT-at-handover where cash leads early then rec
 * lumps later, etc.) it captures the gross AR + UR positions
 * correctly (AR can be > 0 from one cohort while UR > 0 from another
 * in the same period, instead of netting to zero).
 *
 * The roll-forward arrays (opening, closing, change) are derived from
 * the per-period cohort sums, so opening[i+1] = closing[i] holds and
 * change[i] = closing[i] - opening[i] still drives the CF
 * working-capital delta.
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
  recognitionVintageMatrix?: number[][],
  cashVintageMatrix?: number[][],
): AccountsReceivableResult {
  const N = Math.max(0, axisLength);
  const cumRec = new Array<number>(N).fill(0);
  const cumCash = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  // Per-period cumulative sums (informational + used by aggregate path)
  let rRunning = 0;
  let cRunning = 0;
  for (let i = 0; i < N; i++) {
    rRunning += Math.max(0, recognitionPerPeriod[i] ?? 0);
    cRunning += Math.max(0, cashCollectedPerPeriod[i] ?? 0);
    cumRec[i] = rRunning;
    cumCash[i] = cRunning;
  }

  if (recognitionVintageMatrix && cashVintageMatrix) {
    // Per-cohort closing balance, then summed and derived back into
    // opening + change so the CF delta is computed off the rolled
    // aggregate (not lost to per-period floor mid-life).
    for (let t = 0; t < N; t++) {
      let agg = 0;
      for (let s = 0; s < N; s++) {
        let cumRecS = 0;
        let cumCashS = 0;
        for (let k = 0; k <= t; k++) {
          cumRecS += Math.max(0, recognitionVintageMatrix[s]?.[k] ?? 0);
          cumCashS += Math.max(0, cashVintageMatrix[s]?.[k] ?? 0);
        }
        agg += Math.max(0, cumRecS - cumCashS);
      }
      closing[t] = agg;
      opening[t] = t === 0 ? 0 : closing[t - 1];
      change[t] = closing[t] - opening[t];
    }
  } else {
    // Backwards-compatible path: aggregate cumulative netting. This is
    // mathematically equivalent to the per-cohort sum when recognition
    // never leads cash for any cohort (or vice versa) across the entire
    // life, which covers the simple Over-Time matched case.
    for (let i = 0; i < N; i++) {
      closing[i] = Math.max(0, cumRec[i] - cumCash[i]);
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
