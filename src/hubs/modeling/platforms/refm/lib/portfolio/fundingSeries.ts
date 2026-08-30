/**
 * fundingSeries.ts (2026-08-30)
 *
 * ONE definition of "funding requirement by calendar year" for a single
 * project, plus the display trim the chart applies to it. Pure: no React, no
 * store, no I/O, so it is testable directly and the screen cannot hold a
 * second opinion about either rule.
 *
 * WHICH SERIES. The funding requirement is the Method 3 waterfall's
 * netCashRequiredPerPeriod, which is the same figure the Financing tab's
 * Funding Gap sub-tab reports and the same one the portfolio tile totals. It
 * is floored at zero at source (R116's gate: a development funding need exists
 * only in a period that is spending on construction), so a point is never
 * negative and a bar never has to represent one.
 *
 * WHICH AXIS. Periods are paired with the engine's OWN yearLabels and summed
 * into calendar years, so a monthly model and an annual one produce the same
 * shape and no caller ever touches a period index.
 *
 * THE TRIM (display only, and the distinction matters). Funding is front
 * loaded, so the model's axis carries a long tail of empty years. Only the
 * empty HEAD and TAIL are dropped. An INTERIOR empty year is KEPT: it is real
 * information (a pause in funding), and removing it would compress the time
 * axis. That compression is not cosmetic anywhere it reaches arithmetic, which
 * is why it is confined here to presentation: the portfolio IRR was overstated
 * 9.50% against a true 4.87% by exactly that mistake before its axis was made
 * dense. Trimming edges cannot compress anything, because nothing lies outside
 * them.
 *
 * No em dashes in this file.
 */
import { computeFundingGap, type ProjectFinancialsSnapshot } from '../financials-resolvers';

export interface FundingYearPoint {
  year: number;
  value: number;
}

/**
 * The funding requirement, per calendar year, for ONE project. Dense across
 * the model's own span: every year from first to last, gaps carried as zero.
 */
export function fundingRequirementByYear(snap: ProjectFinancialsSnapshot): FundingYearPoint[] {
  const gap = computeFundingGap(snap).method3Waterfall;
  const series = gap.netCashRequiredPerPeriod ?? [];
  const labels = snap.yearLabels ?? [];
  const byYear = new Map<number, number>();
  for (let i = 0; i < series.length; i++) {
    const y = labels[i];
    if (y == null || !Number.isFinite(y)) continue;
    byYear.set(y, (byYear.get(y) ?? 0) + (series[i] ?? 0));
  }
  if (byYear.size === 0) return [];
  const years = [...byYear.keys()];
  const lo = Math.min(...years), hi = Math.max(...years);
  const out: FundingYearPoint[] = [];
  for (let y = lo; y <= hi; y++) out.push({ year: y, value: byYear.get(y) ?? 0 });
  return out;
}

/**
 * Drop the empty leading and trailing years, keeping every interior one.
 * An all-empty series trims to nothing, which is a chart that should not
 * render rather than a row of zero bars.
 */
export function trimEmptyEdges(points: FundingYearPoint[]): FundingYearPoint[] {
  const first = points.findIndex((p) => p.value !== 0);
  if (first === -1) return [];
  let last = points.length - 1;
  while (last > first && points[last].value === 0) last--;
  return points.slice(first, last + 1);
}

/** The series a chart renders: by year, then trimmed at the edges. */
export function fundingChartPoints(snap: ProjectFinancialsSnapshot): FundingYearPoint[] {
  return trimEmptyEdges(fundingRequirementByYear(snap));
}
