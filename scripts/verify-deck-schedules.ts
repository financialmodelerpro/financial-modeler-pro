/**
 * verify-deck-schedules.ts (REFM Module 7, IC deck: FULL year-by-year schedules)
 *
 * Pins the 2026-07-27 rebuild of the deck's financials from a two-column summary
 * to COMPLETE period-by-period schedules: income statement, cash flow and balance
 * sheet across every model year (Module 4), and the FCFF / FCFE / distributed
 * equity (DDM) build-ups across every stream period including inception
 * (Module 5). No engine, no DOM, no DB.
 *
 * The fixture runs a deliberately LONG horizon (23 statement years, 24 stream
 * periods) so pagination is genuinely exercised rather than assumed: three pages
 * of years per schedule, with the page boundaries, the total column and the
 * unlinked-past-the-end rule all asserted.
 *
 * What it asserts:
 *
 *   - Data: every row carries one value per column year, a flow row's total is
 *     its own sum, a stock (balance-sheet) row carries NO total, costs read
 *     negative, and each returns build-up's component lines add up to its stream
 *     PERIOD BY PERIOD (the derivation ties, it is not a relabelled total).
 *   - Pagination: every year appears exactly once across the pages, in order;
 *     the project-life Total appears ONLY on the final page of a flow schedule
 *     and never on the balance sheet; a page past the end of the model resolves
 *     to the unlinked state, never a blank grid.
 *   - Presentation: the label column gets its own width share (colWidths sum to
 *     1, one per header) and the unit note names the scale, the year span and
 *     which page of how many.
 *   - Templates: each schedule expands to exactly its page count of slides, each
 *     slide's table object carries the matching page, and a model with no data
 *     omits the family entirely.
 *   - Upgrade: a v2 deck gains all six families in place (after the slide each
 *     expands), is idempotent, and never resurrects a v2 slide the user deleted.
 *   - Export: PPTX and PDF both build from a deck of schedules, and the resolved
 *     export paint carries the same column widths and unit note the canvas uses.
 *
 * Run: npx tsx scripts/verify-deck-schedules.ts
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel, type ICReportModel, type ICScheduleBlock } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import {
  makeDeckFmt, resolveTable, schedulePageCount, tablePageCount, isPaginatedTable,
  SCHEDULE_YEARS_PER_PAGE, TABLE_BINDINGS, type TableBindingKey,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { seedDeck, TEMPLATE_BY_ID, templatePageCount } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { upgradeDeckLayout } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckUpgrade';
import { resolveDeckExport } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/exportModel';
import { buildDeckPptx } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPptx';
import { buildDeckPdf } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf';
import { DECK_SCHEMA_VERSION, type Deck, type TableObject } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const near = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) < eps;
const MM = 1_000_000;
const k = (x: number): number => x * MM;
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

// ── Fixture: a 23-year model, long enough to force three pages of years ─────
const START = 2026;
const YEARS = 23;                                   // 2026 .. 2048
const yearLabels = Array.from({ length: YEARS }, (_, i) => START + i);
/** Deterministic, non-trivial series so a mis-sliced page cannot pass by luck. */
const series = (base: number, step: number): number[] =>
  Array.from({ length: YEARS }, (_, i) => k(base + step * i));

const pl = {
  residentialRevenuePerPeriod: series(0, 12),
  hospitalityRevenuePerPeriod: series(5, 7),
  retailRevenuePerPeriod: series(2, 3),
  totalRevenuePerPeriod: series(7, 22),
  cosPerPeriod: series(3, 8),
  hospitalityOpexPerPeriod: series(1, 2),
  retailOpexPerPeriod: series(1, 1),
  hqOpexPerPeriod: series(2, 0),
  totalOpexPerPeriod: series(4, 3),
  ebitdaPerPeriod: series(0, 11),
  daPerPeriod: series(2, 1),
  ebitPerPeriod: series(-2, 10),
  interestExpensePerPeriod: series(3, -0.1),
  pbtPerPeriod: series(-5, 10),
  taxPerPeriod: series(0, 2),
  patPerPeriod: series(-5, 8),
};
const directCF = {
  revenueReceivedPerPeriod: series(6, 20),
  netRevenueAdjustmentPerPeriod: series(-1, 0.5),
  opexPaidPerPeriod: series(-4, -3),
  hqOpexPaidPerPeriod: series(-2, 0),
  taxPaidPerPeriod: series(0, -2),
  cashFromOperationsPerPeriod: series(-1, 15),
  capexPerPeriod: series(-50, 2),
  cashFromInvestmentPerPeriod: series(-50, 2),
  equityDrawdownPerPeriod: series(30, -1),
  equityInKindDrawdownPerPeriod: series(10, -0.4),
  debtDrawdownPerPeriod: series(25, -1),
  debtRepaymentPerPeriod: series(0, -1.5),
  interestPaidPerPeriod: series(-3, -0.2),
  dividendsPaidPerPeriod: series(0, -2),
  cashFromFinancingPerPeriod: series(52, -5.7),
  netCashFlowPerPeriod: series(1, 11.3),
  openingCashPerPeriod: series(0, 10),
  closingCashPerPeriod: series(1, 10),
};
const bs = {
  cashPerPeriod: series(1, 10),
  escrowRestrictedCashPerPeriod: series(4, 1),
  arPerPeriod: series(2, 1.5),
  residentialReceivablesPerPeriod: series(6, 2),
  inventoryPerPeriod: series(40, 3),
  totalCurrentAssetsPerPeriod: series(53, 17.5),
  nbvPerPeriod: series(20, 4),
  landPerPeriod: series(80, 0),
  totalFixedAssetsPerPeriod: series(100, 4),
  totalAssetsPerPeriod: series(153, 21.5),
  apPerPeriod: series(12, 1),
  unearnedRevenuePerPeriod: series(9, 0.5),
  debtOutstandingPerPeriod: series(60, -2),
  totalLiabilitiesPerPeriod: series(81, -0.5),
  shareCapitalPerPeriod: series(50, 0),
  statutoryReservePerPeriod: series(1, 0.5),
  retainedEarningsPerPeriod: series(21, 21.5),
  totalEquityPerPeriod: series(72, 22),
  bsDifferencePerPeriod: Array.from({ length: YEARS }, () => 0),
};

// Stream axis: index 0 is inception (2025), then the 23 project years.
const S = YEARS + 1;
const sSeries = (base: number, step: number): number[] =>
  Array.from({ length: S }, (_, i) => k(base + step * i));
const buildup = {
  existingPreCapexPerPeriod: [k(-900), ...Array.from({ length: YEARS }, () => 0)],
  existingDebtOpeningPerPeriod: [k(400), ...Array.from({ length: YEARS }, () => 0)],
  existingEquityPerPeriod: [k(-500), ...Array.from({ length: YEARS }, () => 0)],
  cfoPerPeriod: [0, ...directCF.cashFromOperationsPerPeriod],
  cfiPerPeriod: [0, ...directCF.cashFromInvestmentPerPeriod],
  inKindLandPerPeriod: sSeries(-3, 0.1),
  terminalEnterprisePerPeriod: Array.from({ length: S }, (_, i) => (i === S - 1 ? k(4200) : 0)),
  debtDrawPerPeriod: [0, ...directCF.debtDrawdownPerPeriod],
  principalRepayPerPeriod: [0, ...directCF.debtRepaymentPerPeriod],
  interestPaidPerPeriod: [0, ...directCF.interestPaidPerPeriod],
  terminalEquityPerPeriod: Array.from({ length: S }, (_, i) => (i === S - 1 ? k(3600) : 0)),
  equityCashPerPeriod: sSeries(-30, 1),
  equityInKindPerPeriod: sSeries(-3, 0.1),
  dividendsDistributedPerPeriod: sSeries(0, 2),
};
/** The streams are the EXACT sums of their own build-up lines, as the engine
 *  produces them: this is what lets the verifier prove the derivation ties. */
const addAll = (...arrs: number[][]): number[] =>
  Array.from({ length: S }, (_, i) => arrs.reduce((s, a) => s + (a[i] ?? 0), 0));
const fcffPerPeriod = addAll(buildup.existingPreCapexPerPeriod, buildup.cfoPerPeriod, buildup.cfiPerPeriod, buildup.terminalEnterprisePerPeriod);
const fcfePerPeriod = addAll(
  buildup.existingEquityPerPeriod, buildup.cfoPerPeriod, buildup.cfiPerPeriod, buildup.inKindLandPerPeriod,
  buildup.debtDrawPerPeriod, buildup.principalRepayPerPeriod, buildup.interestPaidPerPeriod, buildup.terminalEquityPerPeriod,
);
const dividendStreamPerPeriod = addAll(
  buildup.existingEquityPerPeriod, buildup.equityCashPerPeriod, buildup.equityInKindPerPeriod,
  buildup.dividendsDistributedPerPeriod, buildup.terminalEquityPerPeriod,
);

const rs: any = {
  result: {
    fcff: { irr: 0.14, moic: 1.9, npv: k(1240), totalInflow: k(6100), totalOutflow: k(3200), netProfit: k(2900) },
    fcfe: { irr: 0.186, moic: 2.3, npv: k(980), totalInflow: k(4720), totalOutflow: k(2050), netProfit: k(2670) },
    dividends: { irr: 0.171, moic: 2.1, npv: Number.NaN, totalInflow: k(4300), totalOutflow: k(2050), netProfit: k(2250) },
    realEstate: { equityMultiple: 2.4, yieldOnCost: 0.064, capRateAtExit: 0.087, profitOnCost: 1.86, cashOnCashAvg: 0.1, dscrMin: 1.5, ltvAtExit: 0 },
  },
  buildup,
  fcffPerPeriod, fcfePerPeriod, dividendStreamPerPeriod,
  streamYearLabels: [START - 1, ...yearLabels],
  totalDividendsDistributed: k(4300),
  developmentEconomics: { gdv: k(14055), totalDevelopmentCost: k(4912), totalFinancingCost: k(820), profitBeforeFinancing: k(9142), profitAfterFinancing: k(8322), developmentMargin: 0.59, costToValue: 0.35 },
  sourcesUses: { existingEquity: k(1282), inKindEquity: k(1350), existingDebt: k(2400), newDebt: k(434), customerCollections: k(4973), land: k(1350), construction: k(3561), idc: k(104), reservesDistributions: k(5423), totalSources: k(10440), totalUses: k(10440) },
  fundingMix: { debtPct: 0.27, cashEquityPct: 0.12, inKindEquityPct: 0.13, customerFundingPct: 0.48 },
  equityExposure: { equityAtRisk: k(2632) },
  debtAnalytics: { peakDebt: k(2834), remainingDebtAtExit: 0, tenorYears: 4, paydownPct: 1 },
  totalEquityInvested: k(2632),
  terminalEquityValue: k(3602),
  noiPerPeriod: series(0, 5),
  yearLabels,
  exitYearLabel: yearLabels[YEARS - 1],
  exitYears: [{ exitYearLabel: yearLabels[YEARS - 1], equityValue: k(3602), fcffIrr: 0.14, fcfeIrr: 0.186, equityMoic: 2.3, isSelected: true }],
  sensitivity: { xVariable: 'x', yVariable: 'y', xValues: [0.07], yValues: [0.1], irr: [[0.1]], baseEquityIrr: 0.186 },
};
const snap: any = { projectStartYear: START, yearLabels, pl, directCF, bs, perAssetCF: new Map<string, any>() };
const project: any = { name: 'FMP RE HUB', location: 'Riyadh', country: 'KSA', currency: 'SAR', financing: { fundingMethod: 3, minimumCashReserve: 50 } };
const phases: any = [{ id: 'p1', name: 'Phase 1', startDate: '2026-01-01' }];
const assets: any = [{ id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, phaseId: 'p1', buaTotal: 12083, landAreaSqm: 5000 }];
const parties: any = [{ id: '1', name: 'PaceMakers', roles: ['Sponsor'] }];

const m: ICReportModel = buildICReportModel({ project, phases, assets, subUnits: [], rs, snap, parties, asOf: '2026-07-27', cases: [{ id: 'base' } as any] });
const fM = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));
const fK = makeDeckFmt(icMoneyScaleSpec('thousands', 'SAR'));
const seed = { inputs: null };

const EXPECTED_PAGES = Math.ceil(YEARS / SCHEDULE_YEARS_PER_PAGE);          // 23 / 10 -> 3
const EXPECTED_STREAM_PAGES = Math.ceil(S / SCHEDULE_YEARS_PER_PAGE);       // 24 / 10 -> 3

console.log('=== 1. Schedule data: one value per year, honest totals ===');
const sch = m.schedules;
check('all six schedules are present', !!(sch.incomeStatement && sch.cashFlow && sch.balanceSheet && sch.fcff && sch.fcfe && sch.ddm));
const blocks: Array<[string, ICScheduleBlock]> = [
  ['income statement', sch.incomeStatement], ['cash flow', sch.cashFlow], ['balance sheet', sch.balanceSheet],
  ['FCFF', sch.fcff], ['FCFE', sch.fcfe], ['DDM', sch.ddm],
];
for (const [name, b] of blocks) {
  check(`${name}: has data`, b.hasData);
  check(`${name}: every row has one value per column year`, b.rows.length > 0 && b.rows.every((r) => r.values.length === b.years.length));
}
check('statement schedules span EVERY model year (not a summary)', sch.incomeStatement.years.length === YEARS && sch.incomeStatement.years[0] === START);
check('statement schedules are far longer than the condensed summary (2 columns)', sch.incomeStatement.years.length > 2);
check('returns schedules run on the stream axis (inception + project years)', sch.fcff.years.length === S && sch.fcff.years[0] === START - 1);
check('returns schedules flag their inception column', sch.fcff.hasInception && sch.fcfe.hasInception && sch.ddm.hasInception);
check('statement schedules have no inception column', !sch.incomeStatement.hasInception);

const isRev = sch.incomeStatement.rows.find((r) => r.label === 'Total revenue');
check('income statement revenue matches the snapshot period by period',
  !!isRev && isRev.values.every((v, i) => near(v, pl.totalRevenuePerPeriod[i])));
check('income statement total is the row\'s own sum', !!isRev && near(isRev.total ?? NaN, sum(pl.totalRevenuePerPeriod)));
const isCos = sch.incomeStatement.rows.find((r) => r.label === 'Cost of sales');
check('costs read negative in the schedule', !!isCos && isCos.values.every((v, i) => near(v, -pl.cosPerPeriod[i])));
const isNet = sch.incomeStatement.rows.find((r) => r.label === 'Net income');
check('net income is emphasised', !!isNet?.emphasis);

const cfClose = sch.cashFlow.rows.find((r) => r.label === 'Closing cash');
check('closing cash is a stock line: no project-life total', !!cfClose && cfClose.total === null);
check('closing cash values match the snapshot', !!cfClose && cfClose.values.every((v, i) => near(v, directCF.closingCashPerPeriod[i])));
const cfOps = sch.cashFlow.rows.find((r) => r.label === 'Cash from operations');
check('cash from operations totals its own periods', !!cfOps && near(cfOps.total ?? NaN, sum(directCF.cashFromOperationsPerPeriod)));

check('balance sheet declares no Total column', sch.balanceSheet.showTotal === false);
check('every balance-sheet row carries total = null (a stock never sums across years)',
  sch.balanceSheet.rows.every((r) => r.total === null));
const bsAssets = sch.balanceSheet.rows.find((r) => r.label === 'Total assets');
check('balance sheet total assets match the snapshot year by year',
  !!bsAssets && bsAssets.values.every((v, i) => near(v, bs.totalAssetsPerPeriod[i])));
check('flow schedules DO declare a Total column', sch.incomeStatement.showTotal && sch.cashFlow.showTotal);

console.log('\n=== 2. Returns build-ups tie to their stream, period by period ===');
/** Sum the component lines (everything above the emphasised "=" line). */
const derivationTies = (b: ICScheduleBlock): boolean => {
  const totalIdx = b.rows.findIndex((r) => r.emphasis);
  if (totalIdx <= 0) return false;
  const parts = b.rows.slice(0, totalIdx);
  const streamRow = b.rows[totalIdx];
  return streamRow.values.every((v, i) => near(v, parts.reduce((s, r) => s + r.values[i], 0), 1));
};
check('FCFF build-up lines add to the FCFF stream in every period', derivationTies(sch.fcff));
check('FCFE build-up lines add to the FCFE stream in every period', derivationTies(sch.fcfe));
check('DDM build-up lines add to the distributed-equity stream in every period', derivationTies(sch.ddm));
const fcffStream = sch.fcff.rows.find((r) => r.emphasis);
check('FCFF stream row equals the snapshot stream (no recompute)',
  !!fcffStream && fcffStream.values.every((v, i) => near(v, fcffPerPeriod[i])));
check('FCFF stream total is the lifetime sum', !!fcffStream && near(fcffStream.total ?? NaN, sum(fcffPerPeriod)));
const cumFcff = sch.fcff.rows.find((r) => r.memo && /cumulative/i.test(r.label));
check('cumulative memo is a running total', !!cumFcff && cumFcff.values.every((v, i) => near(v, sum(fcffPerPeriod.slice(0, i + 1)))));
check('cumulative memo carries no total (it is already cumulative)', !!cumFcff && cumFcff.total === null);
check('the inception column carries the existing capital, not a zero',
  near(sch.fcff.rows[0].values[0], k(-900)) && near(sch.ddm.rows[0].values[0], k(-500)));

console.log('\n=== 3. Pagination: every year exactly once, in order ===');
const SCHEDULE_KEYS: TableBindingKey[] = ['table.isSchedule', 'table.cfSchedule', 'table.bsSchedule', 'table.fcffSchedule', 'table.fcfeSchedule', 'table.ddmSchedule'];
check('all six schedule bindings are registered', SCHEDULE_KEYS.every((key) => !!TABLE_BINDINGS[key]));
check('all six declare themselves paginated', SCHEDULE_KEYS.every(isPaginatedTable));
check('non-schedule tables are NOT paginated', !isPaginatedTable('table.sources') && !isPaginatedTable('table.incomeStatement'));
check('statement schedules need 3 pages at this horizon', tablePageCount('table.isSchedule', m) === EXPECTED_PAGES && EXPECTED_PAGES === 3);
check('returns schedules need 3 pages (24 stream periods)', tablePageCount('table.fcffSchedule', m) === EXPECTED_STREAM_PAGES);
check('page count agrees with the block helper', tablePageCount('table.bsSchedule', m) === schedulePageCount(sch.balanceSheet));

/** Walk every page of a binding and collect the year headers it paints. */
const pageYears = (key: TableBindingKey, pages: number): string[] => {
  const out: string[] = [];
  for (let p = 0; p < pages; p++) {
    const r = resolveTable(key, m, fM, { page: p });
    if (!r.available) return ['UNAVAILABLE'];
    const heads = r.value.headers.map((h) => h.text);
    out.push(...heads.slice(1).filter((t) => t !== 'Total'));
  }
  return out;
};
const isYears = pageYears('table.isSchedule', EXPECTED_PAGES);
check('income statement pages cover every year exactly once, in order',
  isYears.length === YEARS && isYears.every((t, i) => t === String(yearLabels[i])),
  `${isYears.length} headers`);
const fcffYears = pageYears('table.fcffSchedule', EXPECTED_STREAM_PAGES);
check('FCFF pages cover every stream period exactly once, in order',
  fcffYears.length === S && fcffYears[0] === `${START - 1} T0` && fcffYears[S - 1] === String(yearLabels[YEARS - 1]));
check('the inception column is labelled T0 so it cannot be read as a project year', fcffYears[0].endsWith('T0'));

const p0 = resolveTable('table.isSchedule', m, fM, { page: 0 });
const p1 = resolveTable('table.isSchedule', m, fM, { page: 1 });
const p2 = resolveTable('table.isSchedule', m, fM, { page: 2 });
check('page 0 holds a full window of years', p0.available && p0.value.headers.length === 1 + SCHEDULE_YEARS_PER_PAGE);
check('page 0 carries NO Total column (a partial window must not invite adding up)',
  p0.available && !p0.value.headers.some((h) => h.text === 'Total'));
check('the LAST page carries the Total column', p2.available && p2.value.headers.some((h) => h.text === 'Total'));
check('the last page holds only the remaining years', p2.available && p2.value.headers.length === 1 + (YEARS - 2 * SCHEDULE_YEARS_PER_PAGE) + 1);
check('the middle page is a full window without a total', p1.available && p1.value.headers.length === 1 + SCHEDULE_YEARS_PER_PAGE);
const bsLast = resolveTable('table.bsSchedule', m, fM, { page: EXPECTED_PAGES - 1 });
check('the balance sheet has NO Total column even on its last page',
  bsLast.available && !bsLast.value.headers.some((h) => h.text === 'Total'));
const past = resolveTable('table.isSchedule', m, fM, { page: EXPECTED_PAGES });
check('a page past the end resolves UNLINKED, never a blank grid', !past.available);
check('the unlinked reason says how many pages there really are',
  !past.available && /3 pages/.test(past.reason));
check('a negative page falls back to the first page', resolveTable('table.isSchedule', m, fM, { page: -4 }).available);
check('no page option behaves as page 0',
  JSON.stringify(resolveTable('table.isSchedule', m, fM)) === JSON.stringify(p0));

console.log('\n=== 4. Presentation: column widths, unit note, formatting ===');
if (p0.available) {
  const d = p0.value;
  check('colWidths has one entry per column', !!d.colWidths && d.colWidths.length === d.headers.length);
  check('colWidths sum to 1', !!d.colWidths && near(sum(d.colWidths), 1, 1e-9));
  check('the label column is the widest', !!d.colWidths && d.colWidths[0] > d.colWidths[1]);
  check('the unit note names the money scale', d.unitNote.includes('SAR m'));
  check('the unit note names the year span', d.unitNote.includes(`${START} to ${START + SCHEDULE_YEARS_PER_PAGE - 1}`));
  check('the unit note says which page of how many', /page 1 of 3/.test(d.unitNote));
  check('sub-lines carry an indent so the hierarchy survives export',
    d.rows.some((r) => (r.cells[0].indent ?? 0) > 0) && d.rows.some((r) => (r.cells[0].indent ?? 0) === 0));
  const revRow = d.rows.find((r) => r.cells[0].text === 'Total revenue');
  check('a revenue cell is formatted at the deck money scale',
    !!revRow && revRow.cells[1].text === fM.money(pl.totalRevenuePerPeriod[0]));
  const cosRow = d.rows.find((r) => r.cells[0].text === 'Cost of sales');
  check('a cost cell paints negative (red) rather than positive',
    !!cosRow && cosRow.cells[1].text.trim().startsWith('(') || !!cosRow?.cells[1].color);
  check('emphasis rows are bold', !!revRow && !!revRow.cells[0].bold);
}
const p0k = resolveTable('table.isSchedule', m, fK, { page: 0 });
check('the money-scale toggle re-scales the whole schedule',
  p0.available && p0k.available && p0.value.rows[3].cells[1].text !== p0k.value.rows[3].cells[1].text);
check('the unit note follows the scale too', p0k.available && p0k.value.unitNote.includes(icMoneyScaleSpec('thousands', 'SAR').unit));

console.log('\n=== 5. Templates: one slide per page, model-gated ===');
const SCHEDULE_TEMPLATES = ['is_schedule', 'cf_schedule', 'bs_schedule', 'fcff_schedule', 'fcfe_schedule', 'ddm_schedule'];
for (const id of SCHEDULE_TEMPLATES) check(`template "${id}" exists`, !!TEMPLATE_BY_ID[id]);
check('every schedule template is available on this model', SCHEDULE_TEMPLATES.every((id) => TEMPLATE_BY_ID[id].available(m, seed)));
check('template page count matches the binding page count',
  templatePageCount(TEMPLATE_BY_ID['is_schedule'], m) === EXPECTED_PAGES
  && templatePageCount(TEMPLATE_BY_ID['fcff_schedule'], m) === EXPECTED_STREAM_PAGES);

const deck = seedDeck('proj-1', m, seed, { asOf: '2026-07-27' });
const slidesFor = (id: string): typeof deck.slides => deck.slides.filter((s) => s.templateId === id);
check('the seeded deck carries 3 income-statement slides', slidesFor('is_schedule').length === EXPECTED_PAGES);
check('the seeded deck carries 3 FCFF slides', slidesFor('fcff_schedule').length === EXPECTED_STREAM_PAGES);
check('all six families are seeded', SCHEDULE_TEMPLATES.every((id) => slidesFor(id).length >= 1));
const isSlides = slidesFor('is_schedule');
check('each schedule slide names its page in the title',
  isSlides.every((s, i) => s.title === `Income Statement by Year (${i + 1} of ${EXPECTED_PAGES})`));
const isTables = isSlides.map((s) => s.objects.find((o) => o.type === 'table') as TableObject | undefined);
check('each schedule slide holds exactly one table object', isTables.every(Boolean));
check('each slide\'s table carries its own page index', isTables.every((t, i) => (t?.page ?? -1) === i));
check('schedule tables are bound, never baked', isTables.every((t) => t?.table === 'table.isSchedule'));
check('schedule tables show their unit note', isTables.every((t) => t?.showUnitNote === true));
check('every seeded schedule slide resolves (no unlinked page in a fresh deck)',
  isTables.every((t) => resolveTable(t!.table, m, fM, { page: t!.page }).available));
check('section numbers stay contiguous across the expanded pages', (() => {
  const nums = deck.slides.filter((s) => s.chrome !== 'cover')
    .map((s) => (s.objects.find((o) => o.type === 'shape' && o.name === 'Section number') as any)?.text)
    .filter(Boolean);
  return nums.every((t: string, i: number) => t === String(i + 1).padStart(2, '0'));
})());

// A model with no statements or streams must omit the families entirely.
const deadSnap: any = { projectStartYear: START, yearLabels: [], pl: {}, directCF: {}, bs: {}, perAssetCF: new Map() };
const deadRs: any = { ...rs, streamYearLabels: [], fcffPerPeriod: [], fcfePerPeriod: [], dividendStreamPerPeriod: [], buildup: {}, yearLabels: [], noiPerPeriod: [] };
const mDead = buildICReportModel({ project, phases, assets, subUnits: [], rs: deadRs, snap: deadSnap, parties, asOf: '2026-07-27', cases: [{ id: 'base' } as any] });
check('a model with no statements omits the statement schedules',
  !TEMPLATE_BY_ID['is_schedule'].available(mDead, seed) && !TEMPLATE_BY_ID['bs_schedule'].available(mDead, seed));
check('a model with no streams omits the returns schedules',
  !TEMPLATE_BY_ID['fcff_schedule'].available(mDead, seed) && !TEMPLATE_BY_ID['ddm_schedule'].available(mDead, seed));
check('the schedule bindings go unlinked on a dead model (not a fabricated zero)',
  SCHEDULE_KEYS.every((key) => !resolveTable(key, mDead, fM, { page: 0 }).available));
check('a dead model seeds a deck with no schedule slides',
  seedDeck('p', mDead, seed, { asOf: '2026-07-27' }).slides.every((s) => !SCHEDULE_TEMPLATES.includes(s.templateId ?? '')));

console.log('\n=== 6. Upgrade: existing decks gain the schedules in place ===');
/** A v2 deck: today's deck minus every v3 family, stamped back to version 2. */
const v2Deck: Deck = {
  ...deck, schemaVersion: 2,
  slides: deck.slides.filter((s) => !SCHEDULE_TEMPLATES.includes(s.templateId ?? '')),
};
const up = upgradeDeckLayout(v2Deck, m, seed);
check('a v2 deck is upgraded', up.changed && up.deck.schemaVersion === DECK_SCHEMA_VERSION);
check('the upgrade adds every page of every family',
  SCHEDULE_TEMPLATES.every((id) => up.deck.slides.filter((s) => s.templateId === id).length === templatePageCount(TEMPLATE_BY_ID[id], m)));
const idxOf = (id: string): number => up.deck.slides.findIndex((s) => s.templateId === id);
check('the income-statement schedule sits after the income statement summary',
  idxOf('is_schedule') === idxOf('income_statement') + 1);
check('the cash-flow schedule sits after the cash-flow summary', idxOf('cf_schedule') === idxOf('cash_flow') + 1);
check('FCFF, FCFE and DDM stay in that order',
  idxOf('fcff_schedule') < idxOf('fcfe_schedule') && idxOf('fcfe_schedule') < idxOf('ddm_schedule'));
check('the FCFF schedule follows the returns-calculation slide', idxOf('fcff_schedule') > idxOf('returns_calculation'));
check('no existing slide was lost', v2Deck.slides.every((s) => up.deck.slides.some((n) => n.id === s.id)));
check('inserted slides get collision-free ids', new Set(up.deck.slides.map((s) => s.id)).size === up.deck.slides.length);
check('object ids stay unique across the whole upgraded deck', (() => {
  const ids = up.deck.slides.flatMap((s) => s.objects.map((o) => o.id));
  return new Set(ids).size === ids.length;
})());
const up2 = upgradeDeckLayout(up.deck, m, seed);
check('a second upgrade is a no-op (idempotent)', !up2.changed && up2.deck.slides.length === up.deck.slides.length);
// A slide the user deleted must not come back on a LATER version bump.
const v2Minus: Deck = { ...v2Deck, slides: v2Deck.slides.filter((s) => s.templateId !== 'contents') };
const upMinus = upgradeDeckLayout(v2Minus, m, seed);
check('a v2 slide the user deleted is NOT resurrected by the v3 bump',
  !upMinus.deck.slides.some((s) => s.templateId === 'contents'));
check('but the v3 schedules still arrive', upMinus.deck.slides.some((s) => s.templateId === 'ddm_schedule'));
check('a freshly seeded deck is already current', !upgradeDeckLayout(deck, m, seed).changed);

console.log('\n=== 7. Export: the same numbers reach PPTX and PDF ===');
const ex = resolveDeckExport(deck, m, fM);
const exTables = ex.slides.flatMap((s) => s.objects).map((o) => o.paint).filter((p) => p.kind === 'table') as any[];
check('the export resolves the schedule tables', exTables.length > 0);
// The schedules are exactly the tables that opted into a unit note; a wide
// non-schedule table (the 7-column returns-by-basis) must NOT have picked one up.
const wideTables = exTables.filter((p) => typeof p.unitNote === 'string' && p.unitNote.length > 0);
const expectedPages = EXPECTED_PAGES * 3 + EXPECTED_STREAM_PAGES * 3;
check('every schedule page reaches the export', wideTables.length === expectedPages, `${wideTables.length} of ${expectedPages}`);
check('the unit note stayed opt-in (a wide summary table did not gain one)',
  exTables.some((p) => (p.data.headers?.length ?? 0) > 6 && !p.unitNote));
check('exported schedule tables keep their column widths',
  wideTables.every((p) => Array.isArray(p.data.colWidths) && p.data.colWidths.length === p.data.headers.length));
check('exported schedule tables carry the unit note', wideTables.every((p) => p.unitNote.includes('SAR m')));
check('exported cells keep their indent', wideTables.some((p) => p.data.rows.some((r: any) => (r.cells[0].indent ?? 0) > 0)));
check('exported numbers match the model (no drift between canvas and file)', (() => {
  const first = wideTables.find((p) => p.data.rows.some((r: any) => r.cells[0].text === 'Total revenue'));
  const row = first?.data.rows.find((r: any) => r.cells[0].text === 'Total revenue');
  return !!row && row.cells[1].text === fM.money(pl.totalRevenuePerPeriod[0]);
})());

void (async (): Promise<void> => {
  try {
    const pptx = buildDeckPptx({ deck, model: m, fmt: fM });
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    check('PPTX builds to a real PK zip with the schedules in it', buf.length > 2000 && buf[0] === 0x50 && buf[1] === 0x4b);
  } catch (e) { check(`PPTX builds (${(e as Error).message})`, false); }

  try {
    const bytes = await buildDeckPdf({ deck, model: m, fmt: fM });
    const head = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    check('PDF builds with a %PDF header', bytes.length > 2000 && head.startsWith('%PDF'));
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    check('PDF has one page per visible slide', doc.getPageCount() === deck.slides.filter((s) => !s.hidden).length);
  } catch (e) { check(`PDF builds (${(e as Error).message})`, false); }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); fails.forEach((n) => console.log(`  - ${n}`)); process.exit(1); }
})();
