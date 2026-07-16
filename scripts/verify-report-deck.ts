/**
 * verify-report-deck.ts (REFM Module 7, IC Presentation Builder)
 *
 * Pins the slide-deck layer WITHOUT the engine or the DOM. It reuses the exact
 * fixture verify-ic-report uses (the FMP RE HUB sentinel snapshot: GDV 14,055M,
 * Project IRR 11.9%, Equity IRR 8.3%, MOIC 2.40x, peak debt 2,834.1M, sources /
 * uses 10,440.0M), builds the IC model, and asserts:
 *
 *   - the binding registry resolves every metric / chart / table key to the SAME
 *     number the model carries (so a KPI tile can never disagree with the model),
 *   - a binding with no data resolves to the unlinked state rather than a
 *     fabricated figure ("no broken links" = live or loudly absent),
 *   - money scaling drives the axes (millions vs thousands), so a chart axis
 *     reads SAR m, not raw currency,
 *   - the templates seed a deck, number sections after auto-omit, honour
 *     available() (a no-debt / single-case / pure-Sell model drops the right
 *     slides), and bake NO literal numbers,
 *   - the server coercion rebuilds a deck from untrusted jsonb, clamps geometry,
 *     and drops unknown object types.
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import {
  makeDeckFmt, resolveMetric, resolveChart, resolveTable, resolveText,
  METRIC_KEYS, CHART_KEYS, TABLE_KEYS, METRIC_BINDINGS,
} from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { seedDeck, SLIDE_TEMPLATES, TEMPLATE_BY_ID } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { coerceDeck } from '../src/hubs/modeling/platforms/refm/lib/persistence/deck-server';
import { SLIDE_W, SLIDE_H, type Deck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

// ── Fixture (mirrors verify-ic-report, but money is in RAW currency) ────────
// verify-ic-report checks field MAPPING and uses milli-scaled sentinels it never
// formats. This verifier checks FORMATTING too, so its money values are in raw
// SAR (x1,000,000), exactly like the real snapshot: that is what lets a millions
// deck read "14,055.0" and proves the axis fix (SAR m, not raw currency).
const MM = 1_000_000;
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 },
    fcfe: { irr: 0.083, moic: 2.26 },
    dividends: { irr: 0.079 },
    realEstate: { equityMultiple: 2.404, yieldOnCost: 0.064, capRateAtExit: 0.0873, profitOnCost: 1.861, cashOnCashAvg: 0.104, dscrMin: 1.5, ltvAtExit: 0 },
  },
  developmentEconomics: {
    gdv: 14055 * MM, totalDevelopmentCost: 4912.2 * MM, totalFinancingCost: 820.4 * MM,
    profitBeforeFinancing: 9142.8 * MM, profitAfterFinancing: 8322.4 * MM, developmentMargin: 0.592, costToValue: 0.35,
  },
  sourcesUses: {
    existingEquity: 1282.1 * MM, newEquityCash: 0, inKindEquity: 1350.7 * MM, existingDebt: 2400 * MM, newDebt: 434.1 * MM,
    customerCollections: 4973.2 * MM, land: 1350.7 * MM, construction: 3561.5 * MM, idc: 104.4 * MM, reservesDistributions: 5423.5 * MM,
    totalSources: 10440 * MM, totalUses: 10440 * MM,
  },
  fundingMix: { debtPct: 0.27, cashEquityPct: 0.12, inKindEquityPct: 0.13, customerFundingPct: 0.48 },
  equityExposure: { equityAtRisk: 2632.7 * MM },
  debtAnalytics: { peakDebt: 2834.1 * MM, remainingDebtAtExit: 0, tenorYears: 4, paydownPct: 1.0, averageDebtOutstanding: 1500 * MM },
  totalEquityInvested: 2632.7 * MM,
  terminalEquityValue: 3602.8 * MM,
  noiPerPeriod: [0, 120.5 * MM, 240.9 * MM, 360.2 * MM],
  yearLabels: [2026, 2027, 2028, 2029],
  exitYearLabel: 2039,
  exitYears: [
    { exitYearLabel: 2038, equityValue: 3595.7 * MM, fcffIrr: 0.120, fcfeIrr: 0.083, equityMoic: 2.16, isSelected: false },
    { exitYearLabel: 2039, equityValue: 3602.8 * MM, fcffIrr: 0.119, fcfeIrr: 0.083, equityMoic: 2.26, isSelected: true },
  ],
  sensitivity: {
    xVariable: 'exit_cap_rate', yVariable: 'sales_price_pct',
    xValues: [0.07, 0.08], yValues: [-0.1, 0.1], irr: [[0.10, 0.12], [0.06, 0.08]],
    baseEquityIrr: 0.083, impliedExitCapRate: 0.0873,
  },
};
const snap: any = {
  projectStartYear: 2026,
  pl: { ebitdaPerPeriod: [0, 100.0 * MM, 210.0 * MM, 320.0 * MM] },
  perAssetCF: new Map<string, any>([
    ['a1', { capexPerPeriod: [-100 * MM, -200 * MM] }],
    ['a2', { capexPerPeriod: [-50 * MM] }],
  ]),
};
const project: any = { name: 'FMP RE HUB', location: 'Riyadh', country: 'KSA', currency: 'SAR', financing: { fundingMethod: 3, minimumCashReserve: 50 } };
const phases: any = [{ id: 'p1', name: 'Phase 1', startDate: '2026-01-01' }, { id: 'p2', name: 'Phase 2', constructionStart: 1 }];
const assets: any = [
  { id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, phaseId: 'p1', buaTotal: 12083, landAreaSqm: 5000 },
  { id: 'a2', name: 'Retail', strategy: 'Lease', visible: true, phaseId: 'p2', buaSqm: 2907, landAreaSqm: 3000 },
];
const subUnits: any = [{ assetId: 'a1' }, { assetId: 'a1' }, { assetId: 'a2' }];
const parties: any = [
  { id: '1', name: 'PaceMakers', identifier: null, roles: ['Sponsor', 'Developer'] },
  { id: '2', name: 'JV Investor Co', identifier: 'reg-1', roles: ['Investor/Equity Partner'] },
  { id: '3', name: 'Analyst', identifier: null, roles: ['Prepared-by', 'Contact'] },
];

const m: ICReportModel = buildICReportModel({ project, phases, assets, subUnits, rs, snap, parties, asOf: '2026-07-16', cases: [{ id: 'base' } as any] });
const fmtM = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));
const fmtK = makeDeckFmt(icMoneyScaleSpec('thousands', 'SAR'));

// ── Additive operating block on the model ───────────────────────────────────
console.log('\n== operating block ==');
check('operating.hasData true (NOI present)', m.operating.hasData === true);
check('operating.peakNoi = max NOI (360.2M raw)', near(m.operating.peakNoi, 360.2 * MM));
check('operating EBITDA sliced from pl', m.operating.ebitda.length === 4 && near(m.operating.ebitda[3], 320.0 * MM));

// ── Binding registry resolves to the model's own numbers ────────────────────
console.log('\n== metric bindings ==');
const gdv = resolveMetric('devEconomics.gdv', m, fmtM);
check('metric GDV resolves', gdv.available === true);
check('metric GDV value = 14,055.0 (millions)', gdv.available && gdv.value.value === '14,055.0');
check('metric GDV carries unit SAR m', gdv.available && gdv.value.sub === 'SAR m');
const irr = resolveMetric('headline.projectIrr', m, fmtM);
check('metric Project IRR = 11.9%', irr.available && irr.value.value === '11.9%');
const moic = resolveMetric('headline.equityMoic', m, fmtM);
check('metric Equity MOIC = 2.26x', moic.available && moic.value.value === '2.26x');
// Everything resolves EXCEPT metrics that are legitimately model-dependent:
// NPV needs a multi-case comparison, and debt-repaid-year needs a repayment year.
const unresolvedMetrics = METRIC_KEYS.filter((k) => !resolveMetric(k, m, fmtM).available);
check('only genuinely model-dependent metrics are unlinked (npv, debtRepaidYear)',
  unresolvedMetrics.every((k) => k === 'returns.npv' || k === 'programme.debtRepaidYear'));

// Thousands scaling drives the value.
const gdvK = resolveMetric('devEconomics.gdv', m, fmtK);
check('metric GDV re-scales to thousands', gdvK.available && gdvK.value.value === '14,055,000');
check('metric GDV unit is SAR 000 in thousands', gdvK.available && gdvK.value.sub === "SAR '000");

console.log('\n== chart bindings ==');
const costStack = resolveChart('chart.costStack', m, fmtM);
check('chart costStack resolves', costStack.available === true);
check('chart axis unit is SAR m, not raw currency', costStack.available && costStack.value.axisUnit === 'SAR m');
check('chart costStack scales raw currency to millions (land = 1,350.7)', costStack.available && near(costStack.value.series[0].values[0] as number, 1350.7)); // 1350.7M raw / 1e6
const debt = resolveChart('chart.debtBalance', m, fmtM);
check('chart debtBalance resolves (has debt)', debt.available === true);
const opNoi = resolveChart('chart.operatingNoi', m, fmtM);
check('chart operatingNoi resolves + has NOI and EBITDA series', opNoi.available && opNoi.value.series.length === 2);
check('every chart key resolves OR reports a clear reason', CHART_KEYS.every((k) => {
  const r = resolveChart(k, m, fmtM);
  return r.available || (typeof r.reason === 'string' && r.reason.length > 0);
}));

console.log('\n== table bindings ==');
const su = resolveTable('table.sources', m, fmtM);
check('table sources resolves', su.available === true);
check('table sources total row = 10,440.0', su.available && su.value.rows[su.value.rows.length - 1].cells[1].text === '10,440.0');
const assetTbl = resolveTable('table.assetMix', m, fmtM);
check('table assetMix has 2 assets + total row', assetTbl.available && assetTbl.value.rows.length === 3);
check('every table key resolves OR reports a clear reason', TABLE_KEYS.every((k) => {
  const r = resolveTable(k, m, fmtM);
  return r.available || (typeof r.reason === 'string' && r.reason.length > 0);
}));

// ── No broken links: absent data yields the unlinked state, not a number ────
console.log('\n== unlinked (no fabricated numbers) ==');
const mNoDebt = buildICReportModel({ project: { ...project, financing: { fundingMethod: 1 } }, phases, assets, subUnits, rs: { ...rs, debtAnalytics: { peakDebt: 0, remainingDebtAtExit: 0, tenorYears: null, paydownPct: null }, sourcesUses: { ...rs.sourcesUses, existingDebt: 0, newDebt: 0 } }, snap, parties, asOf: '2026-07-16', cases: [{ id: 'base' } as any] });
const debtNo = resolveChart('chart.debtBalance', mNoDebt, fmtM);
check('no-debt model: debt chart is unlinked (not a zero bar)', debtNo.available === false);
check('no-debt model: unlinked carries a human reason', debtNo.available === false && /debt/i.test(debtNo.reason));
const facNo = resolveTable('table.facilitySummary', mNoDebt, fmtM);
check('no-debt model: facility table is unlinked', facNo.available === false);
const scenNo = resolveChart('chart.scenarioIrr', m, fmtM);
check('single-case model: scenario chart is unlinked', scenNo.available === false);

// A resolver never invents: an unlinked result has no value field.
check('unlinked result exposes reason not value', debtNo.available === false && !('value' in debtNo));

// ── Templates seed a deck, number after omit, bake no literals ──────────────
console.log('\n== templates + seeding ==');
const deck = seedDeck('proj-1', m, { inputs: null }, { asOf: '2026-07-16' });
check('deck seeds 1 slide per available template', deck.slides.length === SLIDE_TEMPLATES.filter((t) => t.available(m, { inputs: null })).length);
check('deck has a cover as slide 1', deck.slides[0].chrome === 'cover');
check('deck default case is Management base', deck.settings.deckCase === 'management');
check('deck default scale is millions', deck.settings.moneyScale === 'millions');
check('cover carries no section number chip', !deck.slides[0].objects.some((o) => o.name === 'Section number'));

// Section numbering: the first content slide is 01, and numbers are gapless.
const firstContent = deck.slides.find((s) => s.chrome === 'content')!;
const chip = firstContent.objects.find((o) => o.name === 'Section number') as any;
check('first content slide chip reads 01', chip && chip.text === '01');

// available() drops the right slides on a reduced model.
const mSellOnly = buildICReportModel({ project, phases, assets: [{ id: 'a1', name: 'Plots', strategy: 'Sell', visible: true, phaseId: 'p1', buaTotal: 1000, landAreaSqm: 5000 }] as any, subUnits: [], rs: { ...rs, noiPerPeriod: [0, 0, 0, 0] }, snap: { ...snap, pl: { ebitdaPerPeriod: [0, 0, 0, 0] } }, parties, asOf: '2026-07-16', cases: [{ id: 'base' } as any] });
check('pure-Sell model: operating template is NOT available', TEMPLATE_BY_ID['operating_performance'].available(mSellOnly, { inputs: null }) === false);
check('single-case model: scenario template is NOT available', TEMPLATE_BY_ID['scenario_comparison'].available(m, { inputs: null }) === false);
check('no-debt model: financing template is NOT available', TEMPLATE_BY_ID['financing_structure'].available(mNoDebt, { inputs: null }) === false);

// No literal numbers baked into a data slide: KPI tiles carry a metric key only.
const returnsSlide = deck.slides.find((s) => s.templateId === 'returns')!;
const kpis = returnsSlide.objects.filter((o) => o.type === 'kpi') as any[];
check('returns slide KPIs carry metric keys, never literal values', kpis.length > 0 && kpis.every((k) => typeof k.metric === 'string' && !('value' in k)));
check('every KPI metric key is a known binding', deck.slides.flatMap((s) => s.objects).filter((o) => o.type === 'kpi').every((k: any) => (METRIC_BINDINGS as any)[k.metric] !== undefined));

// ── Seeding preserves existing narrative (non-destructive) ──────────────────
console.log('\n== narrative seeding ==');
const withNarrative = seedDeck('proj-1', m, { inputs: { executiveSummary: 'Point A\nPoint B\nPoint C', recommendation: 'Proceed to approval.', fontHeading: 'Georgia', fontBody: 'Verdana', icMoneyScale: 'thousands' } as any }, { asOf: '2026-07-16' });
check('seeded exec summary splits into bullet points', (() => {
  const es = withNarrative.slides.find((s) => s.templateId === 'executive_summary')!;
  const bl = es.objects.find((o) => o.type === 'bullets') as any;
  return bl && bl.items.length === 3 && bl.items[0] === 'Point A';
})());
check('seeded fonts flow into branding', withNarrative.branding.fontHeading === 'Georgia' && withNarrative.branding.fontBody === 'Verdana');
check('seeded money scale flows into settings', withNarrative.settings.moneyScale === 'thousands');

// ── Server coercion rebuilds from untrusted jsonb ───────────────────────────
console.log('\n== deck coercion (server) ==');
const round = coerceDeck(JSON.parse(JSON.stringify(deck)), 'proj-1', '2026-07-16');
check('coerceDeck round-trips a valid deck', round !== null && round!.slides.length === deck.slides.length);
check('coerceDeck pins projectId', round!.projectId === 'proj-1');

const dirty: any = JSON.parse(JSON.stringify(deck));
dirty.slides[1].objects.push({ id: 'x', type: 'malware', x: 1, y: 1, w: 10, h: 10, rot: 0 });
dirty.slides[1].objects.push({ id: 'nan', type: 'text', x: NaN, y: 5, w: 999999, h: 40, rot: 0, text: 'hi', style: {} });
const cleaned = coerceDeck(dirty, 'proj-1', '2026-07-16')!;
const s1 = cleaned.slides[1];
check('coerce drops unknown object types', !s1.objects.some((o) => o.type === ('malware' as any)));
const nanObj = s1.objects.find((o) => o.id === 'nan')!;
check('coerce clamps NaN geometry to a finite value', Number.isFinite(nanObj.x));
check('coerce clamps oversize width', nanObj.w <= SLIDE_W * 2);
check('coerce rejects a slideless deck', coerceDeck({ slides: [] }, 'p', '2026-07-16') === null);
check('coerce rejects a non-object', coerceDeck(null, 'p', '2026-07-16') === null);

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
