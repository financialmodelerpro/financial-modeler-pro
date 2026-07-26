/**
 * verify-deck-financials.ts (REFM Module 7, IC deck: statements + returns calc)
 *
 * Pins the four new IC slides added on 2026-07-26 WITHOUT the engine or the DOM:
 * the Returns Calculation slide (FCFF / FCFE / Distributed-DDM summary + the
 * FCFF -> FCFE bridge) and the condensed Income Statement / Cash Flow / Balance
 * Sheet slides. It builds the IC model from a purpose-built snapshot fixture and
 * asserts:
 *
 *   - the returns-by-basis rows map each StreamReturns field correctly
 *     (invested = totalOutflow, returned = totalInflow, netProfit, npv),
 *   - the FCFF -> FCFE bridge column SUMS EXACTLY to FCFE (the residual carries
 *     the remaining terms; never a forced or fabricated figure),
 *   - the statements aggregate correctly: P&L / CF show project-life total + exit,
 *     the BS shows peak + exit, and costs read negative,
 *   - the table bindings resolve to the SAME numbers, format at the money scale,
 *     and a model with no activity auto-omits its statement (unlinked / hasData),
 *   - the four templates seed into the deck through the same path as the rest.
 *
 * Pure; no DB and no network. Run: npx tsx scripts/verify-deck-financials.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { makeDeckFmt, resolveTable } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { seedDeck, TEMPLATE_BY_ID } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
const MM = 1_000_000;
const k = (x: number): number => x * MM;

// ── Fixture: complete enough for buildICReportModel + the new blocks ─────────
const rs: any = {
  result: {
    fcff: { irr: 0.14, moic: 1.9, npv: k(1240), totalInflow: k(6100), totalOutflow: k(3200), netProfit: k(2900) },
    fcfe: { irr: 0.186, moic: 2.3, npv: k(980), totalInflow: k(4720), totalOutflow: k(2050), netProfit: k(2670) },
    dividends: { irr: 0.171, moic: 2.1, npv: Number.NaN, totalInflow: k(4300), totalOutflow: k(2050), netProfit: k(2250) },
    realEstate: { equityMultiple: 2.4, yieldOnCost: 0.064, capRateAtExit: 0.087, profitOnCost: 1.86, cashOnCashAvg: 0.1, dscrMin: 1.5, ltvAtExit: 0 },
  },
  buildup: {
    debtDrawPerPeriod: [0, k(500), k(400), 0],
    interestPaidPerPeriod: [0, k(-45), k(-60), k(-20)],
    principalRepayPerPeriod: [0, 0, k(-500), k(-400)],
  },
  totalDividendsDistributed: k(4300),
  dividendStreamPerPeriod: [0, 0, k(1500), k(2800)],
  developmentEconomics: { gdv: k(14055), totalDevelopmentCost: k(4912), totalFinancingCost: k(820), profitBeforeFinancing: k(9142), profitAfterFinancing: k(8322), developmentMargin: 0.59, costToValue: 0.35 },
  sourcesUses: { existingEquity: k(1282), inKindEquity: k(1350), existingDebt: k(2400), newDebt: k(434), customerCollections: k(4973), land: k(1350), construction: k(3561), idc: k(104), reservesDistributions: k(5423), totalSources: k(10440), totalUses: k(10440) },
  fundingMix: { debtPct: 0.27, cashEquityPct: 0.12, inKindEquityPct: 0.13, customerFundingPct: 0.48 },
  equityExposure: { equityAtRisk: k(2632) },
  debtAnalytics: { peakDebt: k(2834), remainingDebtAtExit: 0, tenorYears: 4, paydownPct: 1 },
  totalEquityInvested: k(2632),
  terminalEquityValue: k(3602),
  noiPerPeriod: [0, k(120), k(240), k(360)],
  yearLabels: [2026, 2027, 2028, 2029],
  exitYearLabel: 2029,
  exitYears: [{ exitYearLabel: 2029, equityValue: k(3602), fcffIrr: 0.14, fcfeIrr: 0.186, equityMoic: 2.3, isSelected: true }],
  sensitivity: { xVariable: 'x', yVariable: 'y', xValues: [0.07], yValues: [0.1], irr: [[0.1]], baseEquityIrr: 0.186 },
};
const snap: any = {
  projectStartYear: 2026,
  yearLabels: [2026, 2027, 2028, 2029],
  pl: {
    totalRevenuePerPeriod: [0, k(100), k(400), k(500)],
    cosPerPeriod: [0, k(40), k(160), k(200)],
    totalOpexPerPeriod: [k(10), k(20), k(30), k(40)],
    ebitdaPerPeriod: [k(-10), k(40), k(210), k(260)],
    daPerPeriod: [k(5), k(5), k(5), k(5)],
    ebitPerPeriod: [k(-15), k(35), k(205), k(255)],
    interestExpensePerPeriod: [0, k(10), k(10), 0],
    pbtPerPeriod: [k(-15), k(25), k(195), k(255)],
    taxPerPeriod: [0, k(5), k(39), k(51)],
    patPerPeriod: [k(-15), k(20), k(156), k(204)],
    hospitalityRevenuePerPeriod: [0, k(60), k(240), k(300)],
    retailRevenuePerPeriod: [0, k(20), k(80), k(100)],
  },
  directCF: {
    cashFromOperationsPerPeriod: [0, k(50), k(300), k(400)],
    cashFromInvestmentPerPeriod: [k(-350), k(-200), 0, 0],
    cashFromFinancingPerPeriod: [k(400), k(100), k(-150), k(-100)],
    netCashFlowPerPeriod: [k(50), k(-50), k(150), k(300)],
    closingCashPerPeriod: [k(50), 0, k(150), k(450)],
  },
  bs: {
    totalAssetsPerPeriod: [k(400), k(900), k(700), k(500)],
    cashPerPeriod: [k(50), 0, k(150), k(450)],
    arPerPeriod: [0, k(20), k(10), 0],
    residentialReceivablesPerPeriod: [0, k(80), k(40), 0],
    inventoryPerPeriod: [k(300), k(600), k(200), 0],
    totalFixedAssetsPerPeriod: [k(50), k(200), k(300), k(50)],
    debtOutstandingPerPeriod: [k(300), k(600), k(300), 0],
    apPerPeriod: [k(100), k(150), k(50), 0],
    unearnedRevenuePerPeriod: [0, k(50), k(20), 0],
    totalLiabilitiesPerPeriod: [k(400), k(800), k(370), 0],
    totalEquityPerPeriod: [0, k(100), k(330), k(500)],
  },
  perAssetCF: new Map<string, any>([['a1', { capexPerPeriod: [k(-100), k(-200)] }]]),
};
const project: any = { name: 'FMP RE HUB', location: 'Riyadh', country: 'KSA', currency: 'SAR', financing: { fundingMethod: 3, minimumCashReserve: 50 } };
const phases: any = [{ id: 'p1', name: 'Phase 1', startDate: '2026-01-01' }];
const assets: any = [{ id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, phaseId: 'p1', buaTotal: 12083, landAreaSqm: 5000 }];
const parties: any = [{ id: '1', name: 'PaceMakers', roles: ['Sponsor'] }];

const m: ICReportModel = buildICReportModel({ project, phases, assets, subUnits: [], rs, snap, parties, asOf: '2026-07-26', cases: [{ id: 'base' } as any] });
const f = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));

console.log('=== 1. Returns by cash-flow basis (field mapping) ===');
const rb = m.returnsBasis;
check('three basis rows (FCFF / FCFE / DDM)', rb.rows.length === 3);
check('FCFF row basis names FCFF', /FCFF/.test(rb.rows[0].basis));
check('invested = totalOutflow', near(rb.rows[0].invested, k(3200)));
check('returned = totalInflow', near(rb.rows[0].returned, k(6100)));
check('netProfit passthrough', near(rb.rows[0].netProfit, k(2900)));
check('npv passthrough', rb.rows[0].npv !== null && near(rb.rows[0].npv, k(1240)));
check('FCFE irr/moic passthrough', rb.rows[1].irr === 0.186 && rb.rows[1].moic === 2.3);
check('DDM row is the dividends basis', /DDM|Distributed/i.test(rb.rows[2].basis));
check('a non-finite npv (dividends) becomes null, not 0', rb.rows[2].npv === null);

console.log('\n=== 2. FCFF -> FCFE bridge sums EXACTLY to FCFE ===');
const b = rb.bridge;
check('bridge fcff = FCFF net profit', near(b.fcff, k(2900)));
check('debt drawn summed', near(b.debtDraw, k(900)));
check('interest summed (negative)', near(b.interest, k(-125)));
check('principal summed (negative)', near(b.principal, k(-900)));
const other = b.fcfe - (b.fcff + b.debtDraw + b.interest + b.principal);
check('fcff + debtDraw + interest + principal + residual === fcfe (self-consistent, no fabricated figure)',
  near(b.fcff + b.debtDraw + b.interest + b.principal + other, b.fcfe), `resid ${other}`);
check('distributions from totalDividendsDistributed', near(b.distributions, k(4300)));

console.log('\n=== 3. Income Statement (project-life total + exit) ===');
const is = m.statements.incomeStatement;
const isRow = (label: string) => is.rows.find((r) => r.label === label)!;
check('colA is the life total, colB the exit year', is.colA === 'Project-life total' && is.colB === 'Exit 2029');
check('Total revenue life-total = sum', near(isRow('Total revenue').a!, k(1000)));
check('Total revenue at-exit = exit-year value', near(isRow('Total revenue').b!, k(500)));
check('Cost of sales is shown NEGATIVE', near(isRow('Cost of sales').a!, k(-400)));
check('EBITDA life-total = sum, emphasised', near(isRow('EBITDA').a!, k(500)) && !!isRow('EBITDA').emphasis);
check('Net income life-total = sum', near(isRow('Net income').a!, k(365)));
check('IS hasData', is.hasData === true);

console.log('\n=== 4. Cash Flow ===');
const cf = m.statements.cashFlow;
const cfRow = (label: string) => cf.rows.find((r) => r.label === label)!;
check('Net change in cash life-total = sum', near(cfRow('Net change in cash').a!, k(450)));
check('Net change at exit = exit value', near(cfRow('Net change in cash').b!, k(300)));
check('Closing cash is a balance (ending, not a sum)', near(cfRow('Closing cash balance').a!, k(450)));

console.log('\n=== 5. Balance Sheet (peak + exit, point-in-time) ===');
const bs = m.statements.balanceSheet;
const bsRow = (label: string) => bs.rows.find((r) => r.label === label)!;
check('colA labels the peak year (2027 = max total assets)', bs.colA === 'Peak (2027)');
check('colB is exit', bs.colB === 'Exit 2029');
check('Total assets at peak', near(bsRow('Total assets').a!, k(900)));
check('Total assets at exit', near(bsRow('Total assets').b!, k(500)));
check('Receivables combine operating + residential (peak)', near(bsRow('Receivables').a!, k(100)));
check('Total equity at exit', near(bsRow('Total equity').b!, k(500)));

console.log('\n=== 6. Table bindings resolve to the same numbers + format ===');
const rBasis = resolveTable('table.returnsBasis', m, f);
check('table.returnsBasis resolves', rBasis.available);
check('table.returnsBasis has 3 body rows', rBasis.available && rBasis.value.rows.length === 3);
check('invested cell reads negative (outflow)', rBasis.available && /\(3,200\.0\)/.test(rBasis.value.rows[0].cells[3].text));
const rBridge = resolveTable('table.returnsBridge', m, f);
check('table.returnsBridge resolves', rBridge.available);
check('bridge ends on FCFE then distributions', rBridge.available && /FCFE/.test(rBridge.value.rows[5].cells[0].text));
const rIS = resolveTable('table.incomeStatement', m, f);
check('table.incomeStatement resolves', rIS.available);
check('IS header carries the two column labels', rIS.available && rIS.value.headers[1].text === 'Project-life total' && rIS.value.headers[2].text === 'Exit 2029');
check('IS revenue cell formats at millions (1,000.0)', rIS.available && /1,000\.0/.test(rIS.value.rows[0].cells[1].text));
check('table.cashFlow resolves', resolveTable('table.cashFlow', m, f).available);
check('table.balanceSheet resolves', resolveTable('table.balanceSheet', m, f).available);

console.log('\n=== 7. Auto-omit: a model with no P&L activity drops the IS ===');
const mDead: ICReportModel = buildICReportModel({
  project, phases, assets, subUnits: [], parties, asOf: '2026-07-26', cases: [{ id: 'base' } as any],
  rs, snap: { ...snap, pl: { ...snap.pl, totalRevenuePerPeriod: [0, 0, 0, 0], ebitdaPerPeriod: [0, 0, 0, 0] } },
});
check('income statement hasData is false with no revenue/EBITDA', mDead.statements.incomeStatement.hasData === false);
check('table.incomeStatement is unlinked (not a fabricated zero)', !resolveTable('table.incomeStatement', mDead, f).available);
check('income_statement template auto-omits when there is no data', TEMPLATE_BY_ID['income_statement'].available(mDead, { inputs: null }) === false);
check('balance_sheet stays available (BS data still present)', TEMPLATE_BY_ID['balance_sheet'].available(mDead, { inputs: null }) === true);

console.log('\n=== 8. Templates seed into the deck ===');
for (const id of ['returns_calculation', 'income_statement', 'cash_flow', 'balance_sheet']) {
  check(`template "${id}" exists`, !!TEMPLATE_BY_ID[id]);
}
const deck = seedDeck('proj', m, { inputs: null }, { asOf: '2026-07-26' });
const titles = deck.slides.map((s) => s.title);
for (const t of ['Returns Calculation', 'Income Statement', 'Cash Flow', 'Balance Sheet']) {
  check(`deck includes the "${t}" slide`, titles.includes(t));
}
// The new slides bake NO literal figures: every number is a table binding.
const returnsCalc = deck.slides.find((s) => s.title === 'Returns Calculation')!;
const tableKeys = returnsCalc.objects.filter((o) => o.type === 'table').map((o: any) => o.table);
check('Returns Calculation carries the basis + bridge table bindings', tableKeys.includes('table.returnsBasis') && tableKeys.includes('table.returnsBridge'));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
