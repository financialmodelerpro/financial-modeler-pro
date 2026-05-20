/**
 * M2 Pass 9e-2 (2026-05-18): Cost of Sales engine v2.
 *
 * The old (Pass 9a) costOfSales.ts applied a simple
 *   CoS[t] = totalCapex × recognition[t] / totalRecognition
 * which ignores the timing of pre-sales (cohort commitment). This
 * engine splits CoS into two streams:
 *
 *   1. CoS during construction (pre-sales cohort)
 *      Joint cumulative: cum_recognition × cum_pre_sales.
 *      CoS_construction[t] = ∆(cum_recognition × cum_pre_sales)_t × total_capex
 *      Sum over construction window = pre_sales_total_pct × total_capex.
 *
 *   2. CoS during operations (post-handover cohort)
 *      Operating-sales convention (already used for revenue + cash):
 *      CoS_operations[t] = (post_sales[t] / total_inventory) × total_capex
 *
 *   3. Vintage matrix (capex year × recognition year)
 *      For each capex spend year i, the recognized CoS at year t is:
 *        Cell(i, t) = 0                          if t < i
 *        Cell(i, t) = capex_i × cum_joint[i]     if t == i   (collapses missed years)
 *        Cell(i, t) = capex_i × ∆cum_joint[t]    if t > i
 *      Row sum (vintage i) = capex_i × pre_sales_total_pct.
 *
 * Why "joint cumulative" matters: a unit pre-sold in year Y can only
 * contribute to CoS once construction progress recognises it. By year
 * 2, 30% of construction is "done" but if only 5% of units are pre-sold,
 * CoS = 5% × 30% × capex (not 30% × capex). This matches IFRS-15 OTP /
 * POC matching at the cohort level.
 *
 * Pure function; no store coupling. Caller resolves per-period capex
 * (from M1 cost engine), pre-sales + post-sales counts (from
 * SellAssetResult), and the construction recognition profile.
 */
export interface CostOfSalesV2Inputs {
  /** Capex spend per project-axis period. Sum = totalCapex. */
  capexPerPeriod: number[];
  /** Pre-sales count (or area, same denominator as totalInventory) per period.
   *  Resolver passes presalesUnitsPerPeriod for units-metric assets,
   *  presalesAreaPerPeriod for area-metric assets. */
  presalesPerPeriod: number[];
  /** Post-handover sales count (same denominator). */
  postSalesPerPeriod: number[];
  /** Construction recognition profile per period. Engine normalises to
   *  sum=1 internally so callers can pass either fractional (0..1) or
   *  percentage (0..100) inputs, only the relative weights matter. */
  recognitionPerPeriod: number[];
  /** Total sellable inventory (units or area). Used as the denominator
   *  for cumulative pre-sales + post-sales %. When 0, engine falls back
   *  to sum(pre+post) as denominator. */
  totalInventory: number;
  /** Project-axis length (matches the M2 engine). */
  axisLength: number;
}

export interface CostOfSalesV2Result {
  totalCapex: number;
  /** Cumulative pre-sales as % of totalInventory per period. */
  cumPreSalesPerPeriod: number[];
  /** Cumulative recognition (sums to 1.0 at end of construction). */
  cumRecognitionPerPeriod: number[];
  /** Joint factor = cum_recognition × cum_pre_sales. */
  jointFactorPerPeriod: number[];
  /** Per-period delta of joint factor (drives construction CoS). */
  deltaJointPerPeriod: number[];
  /** CoS recognised during the construction window. */
  cosConstructionPerPeriod: number[];
  /** CoS recognised during operations (post-handover sales, same period). */
  cosOperationsPerPeriod: number[];
  /** Total CoS = construction + operations. */
  totalCosPerPeriod: number[];
  /** Cumulative total CoS. Settles to totalCapex × (cum_pre + cum_post). */
  cumulativeCosPerPeriod: number[];
  /** Vintage matrix [capex_year][recognition_year]. Row sum = capex_i ×
   *  pre_sales_total_pct. Cells where t < i are 0. */
  vintageMatrix: number[][];
}

export function buildCostOfSalesV2(inputs: CostOfSalesV2Inputs): CostOfSalesV2Result {
  const N = Math.max(0, inputs.axisLength);
  const capexPerPeriod = padArr(inputs.capexPerPeriod, N);
  const presales = padArr(inputs.presalesPerPeriod, N);
  const postSales = padArr(inputs.postSalesPerPeriod, N);
  const recognition = padArr(inputs.recognitionPerPeriod, N);

  const totalCapex = capexPerPeriod.reduce((s, v) => s + Math.max(0, v), 0);
  const totalPre = presales.reduce((s, v) => s + Math.max(0, v), 0);
  const totalPost = postSales.reduce((s, v) => s + Math.max(0, v), 0);
  // Denominator for cumulative % of inventory. Fall back to total sold
  // when totalInventory is missing or smaller than actual sales (which
  // can happen with fractional unit math).
  const denominator = Math.max(inputs.totalInventory, totalPre + totalPost, 1e-9);

  const cumPre = new Array<number>(N).fill(0);
  const cumRec = new Array<number>(N).fill(0);
  const sumRec = recognition.reduce((s, v) => s + Math.max(0, v), 0);
  const recBase = sumRec > 0 ? sumRec : 1;

  let rPre = 0;
  let rRec = 0;
  for (let t = 0; t < N; t++) {
    rPre += Math.max(0, presales[t]) / denominator;
    rRec += Math.max(0, recognition[t]) / recBase;
    cumPre[t] = Math.min(1, rPre);
    cumRec[t] = Math.min(1, rRec);
  }

  const joint = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) joint[t] = cumRec[t] * cumPre[t];

  const deltaJoint = new Array<number>(N).fill(0);
  let prev = 0;
  for (let t = 0; t < N; t++) {
    deltaJoint[t] = Math.max(0, joint[t] - prev);
    prev = joint[t];
  }

  // Per-period construction CoS uses CUMULATIVE capex spent up to t
  // (not total capex), because a capex dollar only starts contributing
  // to CoS once it's been spent. Equivalent formula:
  //   cosConstruction[t] = cumCapex[t] × joint[t] - cumCapex[t-1] × joint[t-1]
  // This collapses any "missed" recognition years for a vintage into
  // the year it's first spent, matching the per-period column sums.
  const cosConstruction = new Array<number>(N).fill(0);
  const cosOperations = new Array<number>(N).fill(0);
  const cosTotal = new Array<number>(N).fill(0);
  const cumCos = new Array<number>(N).fill(0);
  let cumCapexSoFar = 0;
  let prevCumProduct = 0;
  let runCum = 0;
  for (let t = 0; t < N; t++) {
    cumCapexSoFar += Math.max(0, capexPerPeriod[t]);
    const curProduct = cumCapexSoFar * joint[t];
    cosConstruction[t] = Math.max(0, curProduct - prevCumProduct);
    prevCumProduct = curProduct;
    cosOperations[t] = (Math.max(0, postSales[t]) / denominator) * totalCapex;
    cosTotal[t] = cosConstruction[t] + cosOperations[t];
    runCum += cosTotal[t];
    cumCos[t] = runCum;
  }

  // Vintage matrix: each capex_i is recognised over the construction
  // window per the joint factor. Cell(i, i) = capex_i × cum_joint[i]
  // (collapses any pre-i recognition into the spend year); Cell(i, t>i)
  // = capex_i × deltaJoint[t].
  const vintage: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    const cx = Math.max(0, capexPerPeriod[i]);
    if (cx <= 0) continue;
    vintage[i][i] = cx * joint[i];
    for (let t = i + 1; t < N; t++) {
      vintage[i][t] = cx * deltaJoint[t];
    }
  }

  return {
    totalCapex,
    cumPreSalesPerPeriod: cumPre,
    cumRecognitionPerPeriod: cumRec,
    jointFactorPerPeriod: joint,
    deltaJointPerPeriod: deltaJoint,
    cosConstructionPerPeriod: cosConstruction,
    cosOperationsPerPeriod: cosOperations,
    totalCosPerPeriod: cosTotal,
    cumulativeCosPerPeriod: cumCos,
    vintageMatrix: vintage,
  };
}

function padArr(src: number[] | undefined, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!src) return out;
  for (let i = 0; i < Math.min(src.length, n); i++) out[i] = src[i] ?? 0;
  return out;
}
