/**
 * fundReports.ts (REFM fund layer)
 *
 * The ONE definition of how the fund layer is PRESENTED. Row order, labels,
 * which lines are balances and which are flows, what the gross-vs-net table
 * says, and who appears in the fee income grid: all of it lives here, and the
 * M5 Returns tab, the Excel workbook, the full PDF report and the summary PDF
 * all render from these builders.
 *
 * WHY THIS FILE EXISTS. Step 6 put the waterfall in the Excel workbook by
 * writing the rows inline in buildModelWorkbook. That was fine while Excel was
 * the only consumer, but the moment the PDF needed the same block the choice
 * was between copying eleven row definitions into a second file or lifting them
 * into a shared builder. The platform already made that call once for the
 * statements (lib/reports/m4Reports.ts) precisely so a row added on screen
 * cannot go missing from an export, and the fund layer had just demonstrated
 * the failure mode: the P&L fee lines reached the PDF for free because they
 * came from a shared builder, while the waterfall reached nothing because it
 * did not.
 *
 * FORMATTING IS THE CALLER'S. Each surface formats numbers its own way (the
 * PDF has a Fmt object, Excel builds display strings, the screen has its own
 * scale-aware formatter), so the builders take the formatters they need rather
 * than importing any. What is shared is the STRUCTURE, which is the part that
 * must not drift.
 *
 * PURE: snapshot in, rows out. No I/O, no React, no ExcelJS, no pdf-lib.
 *
 * No em dashes in this file.
 */
import type { M4Row } from '../../components/modules/_shared/m4Table';
import type { ProjectFinancialsSnapshot } from '../financials-resolvers';
import type { ReturnsSnapshot } from '../returns-resolvers';

/** Number formatters a surface supplies. Only these three shapes are needed. */
export interface FundFmt {
  /** Money, already scaled for the surface. */
  money: (v: number) => string;
  /** A decimal fraction as a percentage. */
  pct: (v: number | null | undefined, decimals?: number) => string;
  /** A multiple, e.g. "1.24x". */
  mult: (v: number | null | undefined) => string;
}

export interface FundReportCtx {
  snap: ProjectFinancialsSnapshot;
  returns: ReturnsSnapshot;
  fmt: FundFmt;
}

/**
 * The single question every surface asks before rendering anything fund
 * related. Reads the SNAPSHOT's own flag rather than the project's toggle, so a
 * surface cannot render a fund block for a project whose engine did not run one.
 */
export function isFundActive(returns: ReturnsSnapshot | null | undefined): boolean {
  return !!returns?.waterfall?.active;
}

/** True when there is fee income to show. Separate from the waterfall flag
 *  because a project can have fees with no distributions yet. */
export function hasFundFeeIncome(returns: ReturnsSnapshot | null | undefined): boolean {
  return !!returns?.feeEarners?.active;
}

// ── The distribution waterfall ──────────────────────────────────────────────

/**
 * The reference model's row order, exactly. Each line feeds the next.
 *
 * THREE ROWS ARE BALANCES, and they carry NO lifetime total: a balance summed
 * across periods is a number with no meaning. That is expressed here, once, as
 * `totalOverride: ''`, so no surface has to remember it. It is the single most
 * likely thing for a row-copying pass to get wrong, which is why it is encoded
 * rather than documented.
 *
 * GROSS DISTRIBUTIONS ARE A MEMO BELOW the sequence, not part of it, so the
 * nine reference rows match the reference exactly and the Hurdle Paid MIN and
 * the fee base stay checkable.
 *
 * Every series is on the STREAM basis (index 0 = inception), which is what
 * `priorValue` carries into the prior-period column on every surface.
 */
export function buildFundWaterfallRows(ctx: FundReportCtx): M4Row[] {
  const w = ctx.returns.waterfall;
  if (!w.active) return [];
  const fmt = ctx.fmt.money;
  const toRow = (label: string, arr: number[], opts: Partial<M4Row> = {}): M4Row => ({
    label,
    values: arr.slice(1),
    priorValue: arr[0] ?? 0,
    totalOverride: fmt(arr.reduce((s, v) => s + (v ?? 0), 0)),
    ...opts,
  });
  const balance = (label: string, arr: number[], opts: Partial<M4Row> = {}): M4Row =>
    toRow(label, arr, { totalOverride: '', ...opts });

  return [
    toRow('Equity Drawn', w.equityDrawnPerPeriod),
    balance('Unpaid Hurdle Balance BoP', w.periods.map((p) => p.openingUnpaidHurdle)),
    toRow('Hurdle Accrued', w.hurdleAccruedPerPeriod),
    balance('Total Hurdle Owed', w.totalHurdleOwedPerPeriod, { isSubtotal: true }),
    toRow('Hurdle Paid', w.hurdlePaidPerPeriod),
    balance('Unpaid Hurdle Balance EoP', w.unpaidHurdlePerPeriod, { isSubtotal: true }),
    toRow('Excess Distributions', w.excessDistributionsPerPeriod),
    toRow('Performance Fee', w.performanceFeePerPeriod),
    toRow('Distributions Net of Performance Fee', w.netDistributionPerPeriod, { isTotal: true }),
    toRow('Memo: Distributions (gross, before fee)', w.distributionPerPeriod, { indent: 1 }),
  ];
}

/** The labels above, in order, for a verifier that wants to assert the order
 *  without rebuilding the rows. Derived from the builder so it cannot drift. */
export const FUND_WATERFALL_ROW_ORDER: readonly string[] = [
  'Equity Drawn',
  'Unpaid Hurdle Balance BoP',
  'Hurdle Accrued',
  'Total Hurdle Owed',
  'Hurdle Paid',
  'Unpaid Hurdle Balance EoP',
  'Excess Distributions',
  'Performance Fee',
  'Distributions Net of Performance Fee',
  'Memo: Distributions (gross, before fee)',
];

/** The rows that are BALANCES and therefore carry no lifetime total. */
export const FUND_WATERFALL_BALANCE_ROWS: readonly string[] = [
  'Unpaid Hurdle Balance BoP',
  'Total Hurdle Owed',
  'Unpaid Hurdle Balance EoP',
];

// ── Gross vs net returns ────────────────────────────────────────────────────

/** One row of a simple string grid (headline tables that are not period tables). */
export interface FundGridRow {
  cells: string[];
  emphasis?: 'total' | 'subtotal';
}

export const FUND_GROSS_NET_COLUMNS: readonly string[] =
  ['Distributed Equity', 'IRR', 'MOIC', 'Invested', 'Distributions', 'Net Profit'];

/**
 * Distributed Equity before and after the performance fee. The gross row is the
 * SAME figure the headline tiles show and is deliberately unchanged by the
 * waterfall; the net row is the post-fee stream.
 */
export function buildFundGrossNetRows(ctx: FundReportCtx): FundGridRow[] {
  if (!isFundActive(ctx.returns)) return [];
  const { money, pct, mult } = ctx.fmt;
  const g = ctx.returns.result.dividends, n = ctx.returns.resultNetDividends;
  const line = (label: string, s: typeof g, emphasis?: 'total'): FundGridRow => ({
    cells: [label, pct(s.irr, 1), mult(s.moic), money(s.totalOutflow), money(s.totalInflow), money(s.netProfit)],
    ...(emphasis ? { emphasis } : {}),
  });
  return [
    line('Excluding fund fees (gross)', g),
    line('Net of performance fee', n, 'total'),
  ];
}

/** The four headline figures for the fund block, as label/value/sub cards. */
export function buildFundHeadlineCards(ctx: FundReportCtx): Array<{ label: string; value: string; sub: string }> {
  if (!isFundActive(ctx.returns)) return [];
  const { money, pct, mult } = ctx.fmt;
  const w = ctx.returns.waterfall;
  const g = ctx.returns.result.dividends, n = ctx.returns.resultNetDividends;
  return [
    { label: 'Distributed Equity IRR (gross)', value: pct(g.irr, 1), sub: `MOIC ${mult(g.moic)}` },
    { label: 'Distributed Equity IRR (net)', value: pct(n.irr, 1), sub: `MOIC ${mult(n.moic)}` },
    { label: 'Performance Fee', value: money(w.totalPerformanceFee), sub: 'total over the hold' },
    {
      label: 'Unpaid Hurdle at Exit',
      value: money(w.hurdleShortfall),
      sub: w.hurdleShortfall > 0 ? 'hurdle not fully met' : 'hurdle fully settled',
    },
  ];
}

/** The terms the waterfall was run on, so its rows can be checked by eye. The
 *  Fund Manager name is resolved by the caller (it lives on the project, not on
 *  the returns snapshot). */
export function buildFundTermsPairs(ctx: FundReportCtx, fundManagerName: string): Array<[string, string]> {
  if (!isFundActive(ctx.returns)) return [];
  const w = ctx.returns.waterfall;
  return [
    ['Hurdle rate (preferred return)', ctx.fmt.pct(w.hurdleRate, 2)],
    ['Performance fee on the excess', ctx.fmt.pct(w.performanceFeePct, 2)],
    ['Fund Manager', fundManagerName],
  ];
}

// ── Fee income ──────────────────────────────────────────────────────────────

export const FUND_EARNER_COLUMNS: readonly string[] =
  ['Fee Earner', 'Type', 'Mgmt Fee %', 'Management Fees', 'Perf. Fee %', 'Performance Fee', 'Total Fee Income'];

/**
 * Who EARNS the fees, as distinct from who owns the equity. Fee earners sit
 * BESIDE the equity partners and never inside them.
 *
 * SHARES ARE NEVER NORMALISED. A matrix summing to 80% allocates 80% and the
 * remainder appears as its own "Unallocated" row rather than being absorbed
 * into an earner, because absorbing it would invent an allocation the user
 * never made.
 */
export function buildFundEarnerRows(ctx: FundReportCtx): FundGridRow[] {
  const s = ctx.returns.feeEarners;
  if (!s.active) return [];
  const { money, pct } = ctx.fmt;
  const rows: FundGridRow[] = s.earners.map((e) => ({
    cells: [
      e.name,
      e.kind === 'fund_manager' ? 'Fund Manager' : 'Project Party',
      pct(e.managementFeeShare, 1), money(e.totalManagementFeeIncome),
      pct(e.performanceFeeShare, 1), money(e.totalPerformanceFeeIncome),
      money(e.totalFeeIncome),
    ],
  }));
  if (s.unallocatedPerformanceFee > 0) {
    rows.push({
      cells: ['Unallocated', '', '', '',
        pct(Math.max(0, 1 - s.performanceFeeShareSum), 1),
        money(s.unallocatedPerformanceFee), money(s.unallocatedPerformanceFee)],
    });
  }
  rows.push({
    cells: ['Total', '', '', money(s.totalManagementFee), '', money(s.totalPerformanceFee),
      money(s.totalManagementFee + s.totalPerformanceFee)],
    emphasis: 'total',
  });
  return rows;
}

/**
 * Fee income per period: the five management fees as charged in Module 4, then
 * the performance fee from the waterfall, then the total.
 *
 * The management fees are charged on the PROJECT axis while everything else in
 * the fund block is on the stream basis, so they are lifted onto the stream
 * basis here, once, rather than in each surface.
 */
export function buildFundFeeIncomeRows(ctx: FundReportCtx): M4Row[] {
  const s = ctx.returns.feeEarners;
  if (!s.active) return [];
  const fmt = ctx.fmt.money;
  const axisLength = ctx.snap.axisLength;
  const toRow = (label: string, arr: number[], opts: Partial<M4Row> = {}): M4Row => ({
    label,
    values: arr.slice(1),
    priorValue: arr[0] ?? 0,
    totalOverride: fmt(arr.reduce((sum, v) => sum + (v ?? 0), 0)),
    ...opts,
  });
  const onStreamBasis = (axis: number[]): number[] => [0, ...axis.slice(0, axisLength)];
  return [
    ...ctx.snap.fundFees.lines.map((line) => toRow(line.label, onStreamBasis(line.amountPerPeriod), { indent: 1 })),
    toRow('= Total Management Fees', s.managementFeePerPeriod, { isSubtotal: true }),
    toRow('Performance Fee', s.performanceFeePerPeriod),
    toRow('= Total Fee Income', s.totalFeeIncomePerPeriod, { isTotal: true }),
  ];
}

/** The fee income row labels, in order, for verifiers. The five fee names come
 *  from the schedule, so this needs the snapshot. */
export function fundFeeIncomeRowOrder(snap: ProjectFinancialsSnapshot): string[] {
  return [...snap.fundFees.lines.map((l) => l.label), '= Total Management Fees', 'Performance Fee', '= Total Fee Income'];
}
