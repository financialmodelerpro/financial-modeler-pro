/**
 * metricCaptions.ts (2026-09-22)
 *
 * ONE caption per headline metric, read by the PDF, the workbook and anything
 * else that prints a KPI tile, so the same figure is not explained two ways in
 * two documents a reader has open side by side.
 *
 * WHY THIS EXISTS. The labels were disambiguated on 2026-09-21 (an "Equity
 * Multiple" that meant two different things became "(FCFE)" and
 * "(distributions)"), but the SUB-CAPTIONS under them were left as each surface
 * had written them, so the same tile read "levered cash flow" in the report and
 * "equity out / equity in, at the selected exit" in the workbook. Avg DSCR was
 * worse than untidy: the workbook said "mean over debt-service years" and the
 * report "mean over operating years", and since 2026-09-22 the measure is
 * neither of those alone but the intersection of the two, so both were wrong.
 *
 * A caption states WHAT THE NUMBER IS, not how to feel about it. Keep them
 * short enough to sit under a tile without truncating (verify-report-readability
 * fails on a clipped line).
 *
 * No em dashes in this file.
 */

export const METRIC_CAPTIONS = {
  /** MOIC on the levered free-cash-flow stream. */
  equityMultipleFcfe: 'equity out / equity in, at the selected exit',
  /** MOIC on what was actually distributed. */
  equityMultipleDistributions: 'distributions / invested',
  /** DSCR is measured on SCHEDULED debt service over OPERATING years only
   *  (2026-09-22), so the caption names both halves: a construction year is not
   *  measured, and neither is an operating year with nothing scheduled. */
  dscrAvg: 'mean over operating years with debt service',
  dscrMin: 'worst operating year with debt service',
} as const;
