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
import { terminalMetricIndex, type TerminalValueBasis } from '@/src/core/calculations/returns/disposal';

/** THE DEVELOPMENT-APPRAISAL SURPLUS, NAMED SO IT CANNOT BE READ AS PROFIT (2026-09-29, export review
 *  item 9). It is GDV less development cost (less finance cost, after): no operating cost, no fund fee,
 *  no tax. Called "Profit after Financing", it read 653.6m with the fund and 654.1m without, beside a PAT
 *  that moves 50m, so the fund looked nearly free. One label for every surface that prints it. */
export const METRIC_LABELS = {
  developmentSurplusBefore: 'Development Surplus before Finance',
  developmentSurplusAfter: 'Development Surplus after Finance',
  operatingExpenses: 'Operating Expenses',
  /** Each one's SHARE OF ALL SOURCES (2026-09-29, export review item 10), not a debt-to-equity ratio:
   *  called "Debt / Equity" it read 35.8% / 20.8% two rows above a capital stack of 63.3 / 25.6 / 11.1. */
  shareOfSources: 'Debt / equity, share of all sources',
} as const;

export const METRIC_CAPTIONS = {
  /** GDV less development cost and the operating expenses over the same years (2026-10-08: the GDV counts
   *  operating revenue, so the surplus deducts what earning it cost, selling and marketing included). */
  developmentSurplusBefore: 'GDV less development cost and operating expenses',
  developmentSurplusAfter: 'less finance cost; before fund fees and tax',
  operatingExpenses: 'to the exit, selling and marketing included',
  developmentMargin: 'surplus after finance / GDV',
  shareOfSources: 'not a D/E ratio; sales and operations fund the rest',
  /** MOIC on the levered free-cash-flow stream. */
  equityMultipleFcfe: 'equity out / equity in, at the selected exit',
  /** MOIC on what was actually distributed. */
  equityMultipleDistributions: 'distributions / invested',
  /** DSCR is measured on SCHEDULED debt service over OPERATING years only
   *  (2026-09-22), so the caption names both halves: a construction year is not
   *  measured, and neither is an operating year with nothing scheduled. */
  dscrAvg: 'mean over operating years with debt service',
  dscrMin: 'worst operating year with debt service',
  /** Both sides cover the HELD assets only (2026-09-22): dividing held NOI by
   *  the whole project's cost charged it with the for-sale units. */
  yieldOnCost: 'stabilised NOI / held-asset cost',
  developmentSpread: 'yield on cost less exit cap rate',
} as const;

/**
 * WHERE NPV IS (2026-09-30, export review item 13). The Returns tab said "NPV is intentionally omitted"
 * and then printed NPV (FCFF) in its own Case Comparison, which Module 6, the IC deck, the PPTX and
 * the PDF scenario table all read too. NPV is not omitted, it is not a HEADLINE; this sentence says
 * so on the screen and the workbook alike.
 */
export const RETURNS_NPV_NOTE = 'NPV is not a headline figure here: IRR / MOIC and the Development Economics lead, and NPV (FCFF, at the discount rate) is reported per case in the Case Comparison.';
/** Where NPV is, said without naming a Case Comparison a one-case project does
 *  not print (2026-10-05): a pointer must name a table the document prints. */
export const RETURNS_NPV_NOTE_ONE_CASE = 'NPV is not a headline figure here: IRR / MOIC and the Development Economics lead, and NPV (FCFF, at the discount rate) is reported per case once scenario cases are compared.';
export function returnsNpvNote(hasCaseComparison: boolean): string {
  return hasCaseComparison ? RETURNS_NPV_NOTE : RETURNS_NPV_NOTE_ONE_CASE;
}

/**
 * WHAT THE EXIT CAP RATE DIVIDES (2026-09-30, export review item 15). The caption said "exit NOI /
 * exit value", and 29.0m of exit-year NOI over a 328.3m value is 8.84%, not the 8.5% printed. The
 * figure is right: it is the CAPITALISED income over the value (`buildRealEstateMetrics`), which
 * under the default basis is the year BEFORE the exit, so it reads back the input. The caption names
 * that year through the same `terminalMetricIndex` the valuation uses, so it follows the basis.
 */
export function capRateAtExitCaption(rs: { config: { terminalValueBasis?: TerminalValueBasis }; exitYearLabel: number | string; yearLabels: ReadonlyArray<number | string> }): string {
  const exitIdx = rs.yearLabels.findIndex((y) => String(y) === String(rs.exitYearLabel));
  if (exitIdx < 0) return 'capitalised NOI / exit value';
  const year = rs.yearLabels[terminalMetricIndex(exitIdx, rs.config.terminalValueBasis)];
  return `capitalised NOI (${year}) / exit value`;
}

/**
 * WHAT THE EXIT-YEAR TABLE DEDUCTS (2026-09-30, export review item 16). Equity value is enterprise
 * value less the debt outstanding at the close of that year, so where the facility is repaid by
 * then the two columns are the same number, and a reader should be told so. MEASURED on the rows;
 * the first-row sentence is always true because the candidate list is built that way.
 */
export function exitYearAnalysisNote(rows: ReadonlyArray<{ debtAtExit: number }>): string {
  const first = 'The first year shown is the first whose capitalised income is positive; an earlier exit would value the scheme on no income.';
  if (rows.length && rows.every((r) => r.debtAtExit < 0.5)) {
    return `${first} Equity value equals enterprise value in every year shown because the facility is repaid by the close of each of them, so there is no debt to deduct.`;
  }
  return `${first} Equity value is enterprise value less the debt outstanding at the close of that year.`;
}
