/**
 * M5 Returns engine, real-estate metric primitives.
 *
 * Pure ratio helpers. All return null when the denominator is non-positive
 * (undefined ratio) so the UI can render a dash rather than Infinity/NaN.
 */

/** Safe ratio: numerator / denominator, null when denominator <= 0. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/** Yield on Cost = stabilised NOI / total development cost. */
export function yieldOnCost(stabilisedNOI: number, totalDevelopmentCost: number): number | null {
  return safeRatio(stabilisedNOI, totalDevelopmentCost);
}

/** Cap Rate = NOI / property (enterprise) value. */
export function capRate(noi: number, enterpriseValue: number): number | null {
  return safeRatio(noi, enterpriseValue);
}

/** Profit on Cost = (revenue − cost) / cost. */
export function profitOnCost(totalRevenue: number, totalCost: number): number | null {
  if (!Number.isFinite(totalCost) || totalCost <= 0) return null;
  return (totalRevenue - totalCost) / totalCost;
}

/** Net Profit Margin = PAT / revenue. */
export function profitMargin(totalPAT: number, totalRevenue: number): number | null {
  return safeRatio(totalPAT, totalRevenue);
}

/** LTV = debt outstanding / enterprise value. */
export function loanToValue(debtOutstanding: number, enterpriseValue: number): number | null {
  return safeRatio(debtOutstanding, enterpriseValue);
}

/** Equity Multiple = total distributions / total equity invested (x). */
export function equityMultiple(totalDistributions: number, totalEquityInvested: number): number {
  return totalEquityInvested > 0 ? totalDistributions / totalEquityInvested : 0;
}

/** Debt Yield = stabilised NOI / total debt outstanding. */
export function debtYield(stabilisedNOI: number, debtOutstanding: number): number | null {
  return safeRatio(stabilisedNOI, debtOutstanding);
}

/**
 * Per-period Debt Service Coverage Ratio = CFADS / debt service.
 *
 * MEASURED OVER OPERATING PERIODS ONLY (2026-09-21). CFADS is EBITDA, which is
 * NEGATIVE while a project is building (opex and fees against no income), and
 * debt service is already being paid then, so a construction year produced a
 * negative ratio and became the reported minimum: FMP - MARINA GATE read a
 * minimum of -1.27x in 2027, four years before operations start in 2031, and
 * failed a 1.20x covenant on it. A ratio of income to debt service in a year
 * with no income is not a coverage reading.
 *
 * `operatingPerPeriod` is optional so a caller with no phase information keeps
 * the old behaviour; absent, every period with debt service is measured.
 * Periods that are not measured carry 0, so the displayed series, the minimum
 * and the count of years below 1.00x all come from one definition.
 */
export function dscrSeries(
  cfadsPerPeriod: number[],
  debtServicePerPeriod: number[],
  operatingPerPeriod?: readonly boolean[],
): { perPeriod: number[]; min: number | null; avg: number | null; measuredCount: number } {
  const N = cfadsPerPeriod.length;
  const perPeriod = new Array<number>(N).fill(0);
  const active: number[] = [];
  for (let t = 0; t < N; t++) {
    const ds = debtServicePerPeriod[t] ?? 0;
    const operating = operatingPerPeriod === undefined || operatingPerPeriod[t] === true;
    if (ds > 1e-6 && operating) {
      const ratio = (cfadsPerPeriod[t] ?? 0) / ds;
      perPeriod[t] = ratio;
      active.push(ratio);
    }
  }
  if (active.length === 0) return { perPeriod, min: null, avg: null, measuredCount: 0 };
  const min = Math.min(...active);
  const avg = active.reduce((s, v) => s + v, 0) / active.length;
  return { perPeriod, min, avg, measuredCount: active.length };
}

/** Per-period Interest Coverage Ratio = EBITDA / interest. */
export function icrSeries(
  ebitdaPerPeriod: number[],
  interestPerPeriod: number[],
): { perPeriod: number[]; min: number | null } {
  const N = ebitdaPerPeriod.length;
  const perPeriod = new Array<number>(N).fill(0);
  const active: number[] = [];
  for (let t = 0; t < N; t++) {
    const int = Math.abs(interestPerPeriod[t] ?? 0);
    if (int > 1e-6) {
      const ratio = (ebitdaPerPeriod[t] ?? 0) / int;
      perPeriod[t] = ratio;
      active.push(ratio);
    }
  }
  if (active.length === 0) return { perPeriod, min: null };
  return { perPeriod, min: Math.min(...active) };
}

/**
 * Per-period Cash-on-Cash = distribution / cumulative equity invested, and
 * the average across periods with positive cumulative equity AND a
 * distribution.
 */
export function cashOnCashSeries(
  distributionPerPeriod: number[],
  cumulativeEquityPerPeriod: number[],
): { perPeriod: number[]; avg: number | null } {
  const N = distributionPerPeriod.length;
  const perPeriod = new Array<number>(N).fill(0);
  const active: number[] = [];
  for (let t = 0; t < N; t++) {
    const eq = cumulativeEquityPerPeriod[t] ?? 0;
    if (eq > 1e-6) {
      const ratio = (distributionPerPeriod[t] ?? 0) / eq;
      perPeriod[t] = ratio;
      if ((distributionPerPeriod[t] ?? 0) > 0) active.push(ratio);
    }
  }
  if (active.length === 0) return { perPeriod, avg: null };
  return { perPeriod, avg: active.reduce((s, v) => s + v, 0) / active.length };
}
