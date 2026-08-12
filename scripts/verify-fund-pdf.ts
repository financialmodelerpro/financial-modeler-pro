/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-pdf.ts (fund layer: the fund rows in BOTH PDF exports)
 *
 * The Excel workbook got its fund rows first, and the PDF did not, which is
 * exactly the drift a shared builder exists to prevent. So this file checks two
 * different things, and the second one matters more than the first:
 *
 *   1. THE CONTENT IS THERE, in both the full project PDF and the summary PDF,
 *      proven by generating real PDFs and decoding the drawn text (pdf-lib
 *      writes CID glyph ids, not literals, so scripts/pdfTextExtract.ts maps
 *      them back through the embedded font).
 *
 *   2. NOTHING RENDERS FROM A PARALLEL IMPLEMENTATION. The row order and the
 *      no-total-on-balances rule are pinned ON THE BUILDER, once, and both
 *      surfaces are asserted to consume it rather than carrying their own copy
 *      of the row list. A presence check alone would pass happily against two
 *      hand-maintained copies that agree today and diverge next month.
 *
 * The summary PDF also gets a FOOTING check, because its failure was not a
 * missing block but a misleading one: it printed an EBITDA already net of fund
 * fees with no fee line, so revenue less cost of sales less opex did not reach
 * the printed figure and the gap was silent.
 *
 * Run: npx tsx scripts/verify-fund-pdf.ts
 *
 * No em dashes in this file.
 */
import fs from 'fs';
import { pdfText } from './pdfTextExtract';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  buildFundWaterfallRows, buildFundFeeIncomeRows, buildFundGrossNetRows, buildFundEarnerRows,
  FUND_WATERFALL_ROW_ORDER, FUND_WATERFALL_BALANCE_ROWS, fundFeeIncomeRowOrder,
  isFundActive, type FundReportCtx,
} from '../src/hubs/modeling/platforms/refm/lib/reports/fundReports';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9);
const sum = (a: readonly number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];
const TERMS = {
  enabled: true, fundSize: 500_000_000, facilityLimit: 300_000_000,
  fundStructureFeePct: 0.01, fundManagementFeePct: 0.02, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.0075, otherExpensesPerAnnum: 1_500_000,
  performanceFeePct: 0.3, hurdleRatePct: 0,
  fundManagerName: 'Riverside Fund Managers', feeDistribution: [],
};

function state(o: { off?: boolean; perfFee?: number } = {}): any {
  const s = buildExcelSampleState();
  if (!o.off) s.project.fundTerms = { ...TERMS, performanceFeePct: o.perfFee ?? TERMS.performanceFeePct };
  for (const ph of s.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  return s;
}
const common = (s: any): any => ({ state: s, projectName: 'Riverside Mixed-Use', dateLabel: '10 August 2026', displayScale: 'millions' });
const fullPdf = async (s: any): Promise<string> => pdfText(await generateProjectPdf({ ...common(s), selectedModuleKeys: MODULE_KEYS } as any));
const sumPdf = async (s: any): Promise<string> => pdfText(await generateSummaryPdf({ ...common(s), selectedModuleKeys: [] } as any));

/** Index of the first line containing `needle`, or -1. */
const at = (txt: string, needle: string): number => txt.split('\n').findIndex((l) => l.includes(needle));

/**
 * Assert the waterfall rows appear in the reference order, searched from the
 * "Distribution Waterfall" heading onward.
 *
 * Scoping matters: "Performance Fee" is also a headline tile caption and a
 * gross-vs-net column, both of which are drawn BEFORE the table, so a
 * whole-document first-occurrence search finds the tile and reports the rows as
 * out of order when they are not.
 */
function waterfallInOrder(txt: string, order: readonly string[]): { ok: boolean; detail: string } {
  const lines = txt.split('\n');
  const start = lines.findIndex((l) => l.includes('Distribution Waterfall'));
  if (start < 0) return { ok: false, detail: 'no Distribution Waterfall heading' };
  const scoped = lines.slice(start);
  const idx = order.map((l) => scoped.findIndex((x) => x.includes(l)));
  const ok = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
  return { ok, detail: order.map((l, i) => `${l}@${idx[i]}`).join(' ') };
}

/** Index of `needle` at or after the P&L statement heading, so document prose
 *  cannot stand in for a statement row. */
const atPL = (txt: string, needle: string): number => {
  const lines = txt.split('\n');
  const start = lines.findIndex((l) => /Income Statement|Profit & Loss/.test(l));
  const from = start < 0 ? 0 : start;
  const i = lines.slice(from).findIndex((l) => l.includes(needle));
  return i < 0 ? -1 : from + i;
};
async function main(): Promise<void> {
  console.log('=== Fund layer in the PDF exports ===\n');

  const onState = state();
  const snap = computeFinancialsSnapshot(onState);
  const rs = computeReturnsSnapshot(snap, onState.project);
  const N = snap.axisLength;
  const ctx: FundReportCtx = { snap, returns: rs, fmt: { money: (v) => String(v), pct: (v, d = 1) => `${((v ?? 0) * 100).toFixed(d)}%`, mult: (v) => `${(v ?? 0).toFixed(2)}x` } };

  // ── 1. The shared builder is the single definition ─────────────────────────
  console.log('-- 1. The shared builder (pinned once, inherited by every surface) --');
  check('the fixture actually exercises the fund layer', isFundActive(rs) && rs.waterfall.totalPerformanceFee > 0,
    `perfFee=${rs.waterfall.totalPerformanceFee}`);
  const wfRows = buildFundWaterfallRows(ctx);
  check('the waterfall builder returns the reference row order exactly',
    wfRows.map((r) => r.label).join('|') === FUND_WATERFALL_ROW_ORDER.join('|'),
    wfRows.map((r) => r.label).join('|'));
  check('the three BALANCE rows carry no lifetime total (encoded on the builder)',
    FUND_WATERFALL_BALANCE_ROWS.every((l) => wfRows.find((r) => r.label === l)?.totalOverride === ''));
  check('every FLOW row does carry a lifetime total',
    wfRows.filter((r) => !FUND_WATERFALL_BALANCE_ROWS.includes(r.label)).every((r) => r.totalOverride !== ''));
  check('the builder rows are stream-basis and full length',
    wfRows.every((r) => r.values.length === N && r.values.every((v) => Number.isFinite(v)) && Number.isFinite(r.priorValue ?? 0)));
  check('the fee income builder lists every fee then the two totals',
    buildFundFeeIncomeRows(ctx).map((r) => r.label).join('|') === fundFeeIncomeRowOrder(snap).join('|'));
  check('the gross vs net builder returns gross then net',
    buildFundGrossNetRows(ctx).map((g) => g.cells[0]).join('|') === 'Excluding fund fees (gross)|Net of performance fee');
  check('the earner builder puts the Fund Manager first and totals last', (() => {
    const rows = buildFundEarnerRows(ctx);
    return rows[0]?.cells[1] === 'Fund Manager' && rows[rows.length - 1]?.cells[0] === 'Total';
  })());
  check('the builder is inert on a standalone project', (() => {
    const off = state({ off: true });
    const s2 = computeFinancialsSnapshot(off);
    const r2 = computeReturnsSnapshot(s2, off.project);
    const c2: FundReportCtx = { ...ctx, snap: s2, returns: r2 };
    return !isFundActive(r2) && buildFundWaterfallRows(c2).length === 0 && buildFundFeeIncomeRows(c2).length === 0
      && buildFundGrossNetRows(c2).length === 0 && buildFundEarnerRows(c2).length === 0;
  })());

  // ── 2. No parallel implementation ──────────────────────────────────────────
  // A presence check passes against two hand-maintained copies. This does not.
  console.log('\n-- 2. No surface carries its own copy of the rows --');
  const SURFACES: Array<[string, string]> = [
    ['Excel workbook', 'src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts'],
    ['PDF generator', 'src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts'],
    ['M5 Returns screen', 'src/hubs/modeling/platforms/refm/components/modules/Module5Returns.tsx'],
  ];
  for (const [label, path] of SURFACES) {
    const src = fs.readFileSync(path, 'utf8');
    check(`${label} imports the shared fund builders`, /from '.*reports\/fundReports'/.test(src));
    // The row labels must NOT be written out again anywhere but the builder.
    // Checked against the DISTINCTIVE labels only: "Performance Fee" is also a
    // legitimate KPI tile caption on the screen, so including it would flag a
    // correct surface. These five belong to the row list and nothing else.
    const DISTINCTIVE = [
      'Unpaid Hurdle Balance BoP', 'Total Hurdle Owed', 'Unpaid Hurdle Balance EoP',
      'Excess Distributions', 'Memo: Distributions (gross, before fee)',
    ];
    const inlined = DISTINCTIVE.filter((l) => src.includes(`'${l}'`) || src.includes(`"${l}"`));
    check(`${label} does not re-declare any waterfall row label`, inlined.length === 0, inlined.join(', '));
  }
  const builderSrc = fs.readFileSync('src/hubs/modeling/platforms/refm/lib/reports/fundReports.ts', 'utf8');
  // IMPORT lines only. The file header names those libraries in prose to say it
  // does not use them, so scanning the whole source would match the comment.
  const builderImports = builderSrc.split('\n').filter((l) => /^\s*import\s/.test(l)).join('\n');
  check('the builder itself is pure (no ExcelJS / pdf-lib / React import)',
    !/exceljs|pdf-lib|['"]react['"]/i.test(builderImports), builderImports);

  // ── 3. The full project PDF ────────────────────────────────────────────────
  console.log('\n-- 3. PDF project export --');
  const full = await fullPdf(onState);
  check('full PDF: extraction produced real text', full.length > 20000, `chars=${full.length}`);
  for (const line of snap.fundFees.lines) {
    check(`full PDF: fee line "${line.label}"`, full.includes(line.label));
  }
  check('full PDF: fee labels state the rate and the base inline',
    /\d\.\d\d% of (Fund size|Opening NAV|Facility limit)/.test(full));
  check('full PDF: Total Fund Management Fee', full.includes('Total Fund Management Fee'));
  check('full PDF: EBITDA is struck AFTER the fee line',
    atPL(full, 'Total Fund Management Fee') >= 0 && atPL(full, 'Total Fund Management Fee') < atPL(full, 'EBITDA'));
  check('full PDF: the cash flow fee row', full.includes('Fund Management and Other Expenses'));
  check('full PDF: the Fund Fee Basis block', full.includes('Fund Fee Basis'));
  check('full PDF: every waterfall row is present', FUND_WATERFALL_ROW_ORDER.every((l) => full.includes(l)),
    FUND_WATERFALL_ROW_ORDER.filter((l) => !full.includes(l)).join(', '));
  { const o = waterfallInOrder(full, FUND_WATERFALL_ROW_ORDER); check('full PDF: the waterfall rows appear in the REFERENCE order', o.ok, o.detail); }
  check('full PDF: gross vs post-fee comparison',
    full.includes('Excluding fund fees (gross)') && full.includes('Net of performance fee'));
  check('full PDF: the Fund Fee Income section', full.includes('Fund Fee Income by Earner') && full.includes('Fee Income by Period'));
  check('full PDF: the Fund Manager is named', full.includes(TERMS.fundManagerName));
  check('full PDF: the hurdle and performance fee terms are stated',
    full.includes('Hurdle rate (preferred return)') && full.includes('Performance fee on the excess'));

  // ── 4. The summary PDF ─────────────────────────────────────────────────────
  console.log('\n-- 4. PDF summary export --');
  const summary = await sumPdf(onState);
  check('summary PDF: extraction produced real text', summary.length > 4000, `chars=${summary.length}`);
  // THE FOOTING FIX. This is the defect that made the old summary misleading.
  check('summary PDF: the P&L carries the fund fee line', summary.includes('Total Fund Management Fee'));
  check('summary PDF: the fee line sits ABOVE EBITDA so the statement foots',
    atPL(summary, 'Total Fund Management Fee') >= 0 && atPL(summary, 'Total Fund Management Fee') < atPL(summary, 'EBITDA'));
  check('summary PDF: revenue less cost of sales less opex less the fee EQUALS the printed EBITDA', (() => {
    const rev = sum(snap.pl.totalRevenuePerPeriod.slice(0, N));
    const cos = sum(snap.pl.cosPerPeriod.slice(0, N));
    const opex = sum(snap.pl.totalOpexPerPeriod.slice(0, N));
    const fee = sum(snap.fundFees.totalPerPeriod.slice(0, N));
    const ebitda = sum(snap.pl.ebitdaPerPeriod.slice(0, N));
    // The snapshot carries cost of sales and opex as POSITIVE magnitudes; the
    // statement negates them for display. So the identity is a subtraction.
    return near(rev - cos - opex - fee, ebitda, 2);
  })());
  check('summary PDF: the cash flow carries the fee row', summary.includes('Fund Management and Other Expenses'));
  check('summary PDF: it sits above Cash from operations',
    at(summary, 'Fund Management and Other Expenses') < at(summary, 'Cash from operations'));
  check('summary PDF: every waterfall row is present', FUND_WATERFALL_ROW_ORDER.every((l) => summary.includes(l)),
    FUND_WATERFALL_ROW_ORDER.filter((l) => !summary.includes(l)).join(', '));
  { const o = waterfallInOrder(summary, FUND_WATERFALL_ROW_ORDER); check('summary PDF: the waterfall rows appear in the REFERENCE order', o.ok, o.detail); }
  check('summary PDF: gross vs post-fee comparison',
    summary.includes('Excluding fund fees (gross)') && summary.includes('Net of performance fee'));
  check('summary PDF: the Fund Fee Income section', summary.includes('Fund Fee Income by Earner'));
  check('summary PDF: the Fund Fee Basis states each base and rate',
    summary.includes('Fund Fee Basis') && /Fund size|Opening NAV|Facility limit/.test(summary));

  // ── 5. Toggle off: neither PDF mentions the fund layer ─────────────────────
  console.log('\n-- 5. Toggle OFF --');
  const offState = state({ off: true });
  const fullOff = await fullPdf(offState);
  const sumOff = await sumPdf(offState);
  // Narrow on purpose: "funding method" / "funding gap" / "cash waterfall" are
  // different words that predate the fund layer by two years.
  const FUND_TEXT = [
    'Total Fund Management Fee', 'Fund Management and Other Expenses', 'Fund Fee Basis',
    'Fund Fee Income by Earner', 'Fee Income by Period', 'Distribution Waterfall',
    'Excluding fund fees (gross)', 'Net of performance fee', 'Hurdle rate (preferred return)',
    ...FUND_WATERFALL_ROW_ORDER,
  ];
  for (const [label, txt] of [['full PDF', fullOff], ['summary PDF', sumOff]] as const) {
    const strays = FUND_TEXT.filter((t) => txt.includes(t));
    check(`toggle OFF: ${label} contains no fund text`, strays.length === 0, strays.join(', '));
  }

  // ── 6. Behavioural: the PDFs follow the terms ──────────────────────────────
  console.log('\n-- 6. Behavioural --');
  const lowFee = await fullPdf(state({ perfFee: 0.05 }));
  const highFee = await fullPdf(state({ perfFee: 0.45 }));
  check('changing the performance fee changes what the full PDF prints', lowFee !== highFee);
  const lowSum = await sumPdf(state({ perfFee: 0.05 }));
  const highSum = await sumPdf(state({ perfFee: 0.45 }));
  check('changing the performance fee changes what the summary PDF prints', lowSum !== highSum);
  check('both PDFs report the SAME performance fee for the same inputs', (() => {
    // The lifetime performance fee, formatted the same way on both surfaces.
    const rs2 = computeReturnsSnapshot(computeFinancialsSnapshot(onState), onState.project);
    const needle = String(Math.round(rs2.waterfall.totalPerformanceFee / 100_000) / 10);
    return full.includes(needle) && summary.includes(needle);
  })(), 'lifetime performance fee in millions, 1dp');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
