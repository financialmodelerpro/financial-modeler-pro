/**
 * Cost of Sales for the Sell-strategy revenue stream.
 *
 * The brief (2026-05-17): cost of sales is recognized in step with
 * revenue recognition, weighted by the recognition profile (so CoS is
 * matched to revenue under the accounting matching principle).
 *
 *   CoS[i] = totalCapex * (recognition[i] / totalRecognition)
 *   cumulative CoS at end of project = totalCapex
 *
 * When totalRecognition is zero (no sales modelled yet) every period
 * returns 0. CoS never exceeds totalCapex even if recognition slightly
 * overshoots due to indexation; we clamp the final cumulative to
 * totalCapex by re-scaling.
 *
 * Returns the per-period CoS plus the matching gross margin per period
 * (recognition - CoS) for convenience.
 */
export interface CostOfSalesResult {
  perPeriod: number[];
  cumulativePerPeriod: number[];
  grossMarginPerPeriod: number[];
  totalCapex: number;
  totalRecognition: number;
}

export function buildCostOfSales(
  recognitionPerPeriod: number[],
  totalCapex: number,
  axisLength: number,
): CostOfSalesResult {
  const N = Math.max(0, axisLength);
  const capex = Math.max(0, totalCapex);

  let totalRec = 0;
  for (let i = 0; i < N; i++) totalRec += Math.max(0, recognitionPerPeriod[i] ?? 0);

  const cos = new Array<number>(N).fill(0);
  const cumCos = new Array<number>(N).fill(0);
  const gm = new Array<number>(N).fill(0);

  if (totalRec <= 0 || capex <= 0) {
    return { perPeriod: cos, cumulativePerPeriod: cumCos, grossMarginPerPeriod: gm, totalCapex: capex, totalRecognition: totalRec };
  }

  let running = 0;
  for (let i = 0; i < N; i++) {
    const rec = Math.max(0, recognitionPerPeriod[i] ?? 0);
    const share = rec / totalRec;
    const slice = capex * share;
    cos[i] = slice;
    running += slice;
    cumCos[i] = running;
    gm[i] = rec - slice;
  }

  return { perPeriod: cos, cumulativePerPeriod: cumCos, grossMarginPerPeriod: gm, totalCapex: capex, totalRecognition: totalRec };
}
