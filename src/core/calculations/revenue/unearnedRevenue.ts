/**
 * Unearned Revenue (deferred revenue / contract liability) for the
 * Sell-strategy stream.
 *
 * Pass 7q (2026-05-17, user direction): sale-value driven formula.
 *
 *   Closing[y] = Opening[y] + Pre-Sales Sale Value[y] - Revenue Recognised[y]
 *   Opening[y] = Closing[y-1]                            (Opening[0] = 0)
 *
 * Treats the gross contract value at sale as the credit that creates
 * an obligation to deliver the asset; revenue recognised drains the
 * obligation over time per the recognition profile. Cash collection
 * is irrelevant to Unearned in this view (it lives on AR).
 *
 * By construction Closing stays >= 0: cumulative recognition cannot
 * exceed cumulative sale value at any point in a cohort's life
 * (recognition profile sums to 100% of cohort value). Closing settles
 * to 0 once each cohort's recognition profile finishes.
 *
 * Note: this differs from the pure IFRS 15 contract-liability view
 * (which uses cash on the credit side). The user has chosen the
 * obligation-driven presentation so the AR and Unearned schedules
 * share a common gross credit (Pre-Sales Sale Value) and decompose
 * the contract into two independent unwind paths: cash on one side,
 * recognition on the other.
 *
 * Returns project-axis-indexed arrays (length N). The second
 * parameter is now Pre-Sales Sale Value per period (presalesRevenue
 * from the engine). The Cash field on the result is kept for source
 * compatibility but reports cumulative sale value running sum.
 */
export interface UnearnedRevenueResult {
  perPeriod: number[];           // closing Unearned per period (>= 0)
  openingPerPeriod: number[];    // opening Unearned per period (Closing[i-1])
  changePerPeriod: number[];     // Closing - Opening, drives CF working-cap delta
  cumulativeRecognition: number[];
  cumulativeCash: number[];      // legacy field name; reports cumulative sale value
}

export function buildUnearnedRevenue(
  recognitionPerPeriod: number[],
  presalesSaleValuePerPeriod: number[],
  axisLength: number,
  // Vintage matrices accepted for source-compat; not used.
  _recognitionVintageMatrix?: number[][],
  _saleValueVintageMatrix?: number[][],
): UnearnedRevenueResult {
  const N = Math.max(0, axisLength);
  const cumRec = new Array<number>(N).fill(0);
  const cumSale = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  let prevClose = 0;
  for (let i = 0; i < N; i++) {
    const rec = Math.max(0, recognitionPerPeriod[i] ?? 0);
    const sale = Math.max(0, presalesSaleValuePerPeriod[i] ?? 0);
    cumRec[i] = (i > 0 ? cumRec[i - 1] : 0) + rec;
    cumSale[i] = (i > 0 ? cumSale[i - 1] : 0) + sale;
    const open = prevClose;
    const close = open + sale - rec;
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
    cumulativeCash: cumSale,
  };
}
