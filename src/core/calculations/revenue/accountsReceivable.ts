/**
 * Accounts Receivable (Sales Receivable) for the Sell-strategy
 * revenue stream.
 *
 * Pass 7q (2026-05-17, user direction): sale-value driven formula.
 *
 *   Closing[y] = Opening[y] + Pre-Sales Sale Value[y] - Cash Received[y]
 *   Opening[y] = Closing[y-1]                          (Opening[0] = 0)
 *
 * AR represents the gross contract value sold to customers, less the
 * cash received against it. At sale, the full sale value lands as a
 * receivable; as cash arrives via the milestone payment profile, AR
 * unwinds. By the end of cash collection (when total cash = total
 * sale value) AR settles to 0.
 *
 * Sale value drives BOTH AR and Unearned (mirror "credit" lines) so
 * the two schedules share a common gross obligation. AR decomposes
 * the contract via cash; Unearned decomposes the same contract via
 * revenue recognised.
 *
 * Note: this is the "Sales Receivable" presentation used in
 * residential pre-sales models, not the traditional book AR
 * (revenue earned - cash collected). The accounting interpretation
 * is: at signing of the pre-sale contract, the full contract value
 * is booked as a receivable from the customer regardless of when the
 * developer earns it on the P&L.
 *
 * Returns project-axis-indexed arrays (length N). The second
 * parameter is now Pre-Sales Cash Received per period. The
 * "Recognition" field on the result is kept for source compatibility
 * but reports cumulative sale value running sum.
 */
export interface AccountsReceivableResult {
  perPeriod: number[];           // closing AR per period (>= 0)
  openingPerPeriod: number[];    // opening AR per period (Closing[i-1])
  changePerPeriod: number[];     // Closing - Opening, drives CF working-cap delta
  cumulativeRecognition: number[]; // legacy field; reports cumulative sale value
  cumulativeCash: number[];        // cumulative cash received
}

export function buildAccountsReceivable(
  presalesSaleValuePerPeriod: number[],
  cashReceivedPerPeriod: number[],
  axisLength: number,
  // Vintage matrices accepted for source-compat; not used.
  _saleValueVintageMatrix?: number[][],
  _cashVintageMatrix?: number[][],
): AccountsReceivableResult {
  const N = Math.max(0, axisLength);
  const cumSale = new Array<number>(N).fill(0);
  const cumCash = new Array<number>(N).fill(0);
  const closing = new Array<number>(N).fill(0);
  const opening = new Array<number>(N).fill(0);
  const change = new Array<number>(N).fill(0);

  let prevClose = 0;
  for (let i = 0; i < N; i++) {
    const sale = Math.max(0, presalesSaleValuePerPeriod[i] ?? 0);
    const cash = Math.max(0, cashReceivedPerPeriod[i] ?? 0);
    cumSale[i] = (i > 0 ? cumSale[i - 1] : 0) + sale;
    cumCash[i] = (i > 0 ? cumCash[i - 1] : 0) + cash;
    const open = prevClose;
    const close = open + sale - cash;
    opening[i] = open;
    closing[i] = close;
    change[i] = close - open;
    prevClose = close;
  }

  return {
    perPeriod: closing,
    openingPerPeriod: opening,
    changePerPeriod: change,
    cumulativeRecognition: cumSale,
    cumulativeCash: cumCash,
  };
}
