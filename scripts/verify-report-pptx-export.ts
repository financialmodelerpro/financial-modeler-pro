/**
 * verify-report-pptx-export.ts (REFM Module 7 Reports, Phase 3a)
 *
 * Generates the IC / Lender / One-Pager .pptx from mock report models, unzips the
 * result (a .pptx is a zip of XML) and asserts the deck STRUCTURE: slide count,
 * cover + ToC + per-section divider/content layout, section titles, key snapshot
 * values, ToC internal slide links, divider "Back to contents" links, the applied
 * fonts, and header/footer text. Also asserts show/hide + reorder are respected.
 *
 * The REAL canonical numbers (GDV 14,055 / IRR 11.9% / Equity IRR 8.3% / MOIC
 * 2.40x / peak debt 2,834.1m) were separately confirmed by generating the decks
 * from FMP RE HUB's live snapshot. Ahmad opens the decks in PowerPoint to eyeball
 * layout + edit-ability (the point of PPT-as-master).
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import JSZip from 'jszip';
import { buildICReportModel, icVisibleSections } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildLenderReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/lenderReport';
import { buildOnePagerReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/onePagerReport';
import { buildReportPptx } from '../src/hubs/modeling/platforms/refm/lib/pptx/buildReportPptx';
import { defaultReportInputs, type ReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
// The snapshot holds RAW currency; the IC deck presents money in millions. Mock
// money values are raw-magnitude (x M) so the millions formatter yields the
// canonical figures (GDV 14,055.0, peak debt 2,834.1, land 1,350.7).
const M = 1_000_000;

// ── Mock snapshot (sentinels chosen to format to known strings) ──
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 }, fcfe: { irr: 0.083, moic: 2.26 }, dividends: { irr: 0.081 },
    realEstate: { equityMultiple: 2.40, yieldOnCost: 0.064, capRateAtExit: 0.0873, profitOnCost: 1.861, cashOnCashAvg: 0.104, dscrMin: 1.5, dscrPerPeriod: [0, 1.5, 1.5], icrPerPeriod: [0, 3, 3], ltvAtExit: 0.1 },
  },
  noiPerPeriod: [0, 100 * M, 100 * M],
  developmentEconomics: { gdv: 14055 * M, totalDevelopmentCost: 9000 * M, totalFinancingCost: 500 * M, profitBeforeFinancing: 5055 * M, profitAfterFinancing: 4555 * M, developmentMargin: 0.324, costToValue: 0.64 },
  sourcesUses: { existingEquity: 300 * M, newEquityCash: 300 * M, inKindEquity: 200 * M, existingDebt: 0, newDebt: 2834 * M, customerCollections: 100 * M, operatingCash: 0, land: 1350.7 * M, construction: 3561.5 * M, idc: 100 * M, reservesDistributions: 0, totalSources: 5000 * M, totalUses: 5000 * M },
  fundingMix: { debtPct: 0.6, cashEquityPct: 0.3, inKindEquityPct: 0.05, customerFundingPct: 0.05 },
  debtAnalytics: { peakDebt: 2834065875, remainingDebtAtExit: 0, tenorYears: 5, paydownPct: 1 },
  equityExposure: { equityAtRisk: 500 * M },
  totalEquityInvested: 500 * M,
  terminalEquityValue: 1200 * M,
  yearLabels: [2024, 2025, 2026], exitYearLabel: 2026,
  exitYears: [
    { exitYearLabel: 2025, equityValue: 1000 * M, fcffIrr: 0.10, fcfeIrr: 0.08, equityMoic: 1.5, isSelected: false },
    { exitYearLabel: 2026, equityValue: 1200 * M, fcffIrr: 0.119, fcfeIrr: 0.083, equityMoic: 2.40, isSelected: true },
  ],
  sensitivity: { xVariable: 'exit_cap_rate', yVariable: 'sales_price_pct', xValues: [0.07, 0.08], yValues: [-0.1, 0.1], irr: [[0.10, 0.12], [0.06, 0.08]], baseEquityIrr: 0.083, impliedExitCapRate: 0.0873 },
};
const snap: any = {
  projectStartYear: 2024,
  // Revenue recognition (Phase C): sales = residual = total - hospitality - retail => [0, 500, 700] (x M).
  pl: { totalRevenuePerPeriod: [0, 900 * M, 1100 * M], hospitalityRevenuePerPeriod: [0, 300 * M, 300 * M], retailRevenuePerPeriod: [0, 100 * M, 100 * M] },
  bs: { debtOutstandingPerPeriod: [2834 * M, 1400 * M, 0] },
  directCF: { debtDrawdownPerPeriod: [600, 0, 0], interestPaidPerPeriod: [0, -38, -19], debtRepaymentPerPeriod: [0, -300, -300], cashFromOperationsPerPeriod: [0, 100, 100], cashFromInvestmentPerPeriod: [-900, 0, 0], cashFromFinancingPerPeriod: [600, -338, -319], closingCashPerPeriod: [0, 50, 80] },
  cashSweep: { totalSweepPerPeriod: [0, 100, 50] },
};
const project: any = { name: 'Test Project', location: 'Riyadh', country: 'KSA', covenants: [{ id: 'd', metric: 'dscr', operator: 'min', threshold: 1.2, label: 'DSCR' }, { id: 'l', metric: 'ltv', operator: 'max', threshold: 0.6, label: 'LTV' }, { id: 'y', metric: 'debt_yield', operator: 'min', threshold: 0.5, label: 'Debt Yield' }] };
const tranches: any = [{ name: 'Senior', interestRatePct: 6.3, ltvPct: 60, facilitySharePct: 100, sweepRatio: 100 }];
const assets: any = [
  { id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, buaTotal: 5000, phaseId: 'p1' },
  { id: 'a2', name: 'Villas', strategy: 'Sell', visible: true, buaTotal: 3000, phaseId: 'p2' },
];
const phases: any = [
  { id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 1, operationsPeriods: 2, overlapPeriods: 0 },
  { id: 'p2', name: 'P2', constructionStart: 2, constructionPeriods: 1, operationsPeriods: 0, overlapPeriods: 0 },
];
// Scenario mock (Phase C scenario charts): the FMP RE HUB canonical case set.
// Equity IRR 8.3 / 5.7 / 8.7; NPV 507.6 / -132.2 / 621.0.
const scenariosMock: any = {
  columns: [
    { id: 'base', name: 'Management', role: 'base', drivers: [], values: { 'Equity IRR (FCFE)': 0.083, 'Project IRR (FCFF)': 0.087, 'Equity MOIC': 2.40, 'Development Margin': 0.324, 'NPV (FCFF)': 507.6 * M } },
    { id: 'c1', name: 'Downside', role: 'override', drivers: [{ label: 'Sales price', base: '100%', value: '90%' }], values: { 'Equity IRR (FCFE)': 0.057, 'Project IRR (FCFF)': 0.057, 'Equity MOIC': 1.90, 'Development Margin': 0.210, 'NPV (FCFF)': -132.2 * M } },
    { id: 'c2', name: 'Upside', role: 'override', drivers: [], values: { 'Equity IRR (FCFE)': 0.087, 'Project IRR (FCFF)': 0.090, 'Equity MOIC': 2.55, 'Development Margin': 0.360, 'NPV (FCFF)': 621.0 * M } },
  ],
  kpis: [
    { label: 'Equity IRR (FCFE)', kind: 'pct' }, { label: 'Project IRR (FCFF)', kind: 'pct' }, { label: 'Equity MOIC', kind: 'mult' },
    { label: 'Development Margin', kind: 'pct' }, { label: 'NPV (FCFF)', kind: 'money' },
  ],
};
const parties: any = [{ id: '1', name: 'PaceMakers', identifier: null, roles: ['Sponsor', 'Prepared-by', 'Contact'] }];

const asOf = '2026-07-09';
function makeInputs(): ReportInputs {
  const d = defaultReportInputs();
  return { ...d, executiveSummary: 'Prime asset with strong yield.', securityCollateral: 'First-ranking mortgage.', covenantCommentary: 'Headroom on LTV.', thesisLine: 'Buy: yield beats cost of debt.', recommendation: 'Approve the investment.', disclaimers: 'Model outputs only.', headerText: 'TEST HEADER BAND', footerText: 'TEST FOOTER LINE', fontBody: 'Verdana', fontHeading: 'Georgia' };
}

const ic = buildICReportModel({ project, phases, assets, rs, snap, parties, asOf, scenarios: null, cases: [{ id: 'base' } as any] });
const lender = buildLenderReportModel({ project, financingTranches: tranches, rs, snap, parties, asOf });
const onePager = buildOnePagerReportModel({ project, phases, assets, rs, snap, parties, thesisLine: 'Buy: yield beats cost of debt.', asOf });

async function unzip(buf: Buffer): Promise<{ slideCount: number; allXml: string; tocRels: string }> {
  const z = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(z.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f));
  const xmlFiles = Object.keys(z.files).filter((f) => /ppt\/.*\.xml$/.test(f));
  const parts = await Promise.all(xmlFiles.map((f) => z.file(f)!.async('string')));
  const tocRelsFile = z.file('ppt/slides/_rels/slide2.xml.rels');
  const tocRels = tocRelsFile ? await tocRelsFile.async('string') : '';
  return { slideCount: slideFiles.length, allXml: parts.join('\n'), tocRels };
}
const slideRelCount = (rels: string): number => (rels.match(/relationships\/slide"/g) ?? []).length;

async function main() {
  const inputs = makeInputs();

  // ── IC ── (A+B structure; empty FORM + no-scenario sections auto-omit).
  {
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, ic, scenarios: null });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    // Deck = cover + ToC + (visible non-omitted nav sections) x 2. Computed from
    // the SAME predicate the deck uses, so the count stays in lockstep with omit.
    const navCount = icVisibleSections(ic, inputs).filter((k) => k !== 'cover').length;
    // Composed layout: ONE content slide per section, NO number-divider slides.
    check(`IC slide count = 2 + navCount (${2 + navCount}), i.e. no divider slides`, slideCount === 2 + navCount);
    check('IC no standalone number-divider slides ("Back to contents" removed)', !allXml.includes('Back to contents'));
    check('IC new section titles present (Asset Mix, Sources & Uses, Returns Analysis, Exit-Year Optionality)',
      allXml.includes('Asset Mix') && allXml.includes('Sources &amp; Uses') && allXml.includes('Returns Analysis') && allXml.includes('Exit-Year Optionality'));
    check('IC value bridge + development costs present', allXml.includes('Value &amp; Development Economics') && allXml.includes('Development Costs'));
    check('IC key values present (11.9% / 8.3% / 2.40x)', allXml.includes('11.9%') && allXml.includes('8.3%') && allXml.includes('2.40x'));
    // Money presented in SAR millions (fixes the raw-currency bug): GDV 14,055.0,
    // peak debt 2,834.1, land 1,350.7, with a single "SAR m" unit note.
    check('IC money in millions (GDV 14,055.0 / peak debt 2,834.1 / land 1,350.7)', allXml.includes('14,055.0') && allXml.includes('2,834.1') && allXml.includes('1,350.7'));
    check('IC unit note is "SAR m" (not a subtitle units note)', allXml.includes('SAR m'));
    check('IC finding-as-subtitle bug gone (no "Figures in All figures")', !allXml.includes('Figures in All figures'));
    check('IC finding subtitles present (data-driven findings, not unit notes)', allXml.includes('development margin.') && allXml.includes('to target a'));
    // KPI tiles for headline numbers (uppercase tile labels).
    check('IC KPI tiles present (EQUITY COMMITMENT / PROJECT IRR tile labels)', allXml.includes('EQUITY COMMITMENT') && allXml.includes('PROJECT IRR'));
    // Cover transaction-summary KPI wall.
    check('IC cover KPI wall present (DISTRIBUTED IRR + DEVELOPMENT MARGIN tiles)', allXml.includes('DISTRIBUTED IRR') && allXml.includes('DEVELOPMENT MARGIN'));
    // Every chart pairs with a captioned analysis block (spec rule 5).
    check('IC chart+caption blocks present (Cost efficiency / De-levering profile / How the funding works + mix reading)',
      allXml.includes('Cost efficiency') && allXml.includes('De-levering profile') && allXml.includes('How the funding works') && allXml.includes('balances near-term sales cash'));
    // Two-column Sources & Uses (two tables, both totalling).
    check('IC Sources & Uses is two tables (Total sources + Total uses)', allXml.includes('Total sources') && allXml.includes('Total uses'));
    // AUTO-OMIT proof: empty-form + no-scenario sections must be ABSENT.
    check('IC auto-omit: Market Context absent (empty form)', !allXml.includes('Market Context'));
    check('IC auto-omit: Scenario Analysis absent (no scenarios)', !allXml.includes('Scenario Analysis'));
    check('IC auto-omit: Regulatory &amp; Tax absent (empty form)', !allXml.includes('Regulatory'));
    check('IC ToC internal slide links = navCount', slideRelCount(tocRels) === navCount);
    check('IC applied fonts present (Verdana body + Georgia heading)', allXml.includes('Verdana') && allXml.includes('Georgia'));
    check('IC header + footer text applied', allXml.includes('TEST HEADER BAND') && allXml.includes('TEST FOOTER LINE'));
    check('IC narrative from form present (recommendation text)', allXml.includes('Approve the investment.'));
    // ── Phase C: native (editable) Office charts present + correct type ──
    check('IC charts are native Office charts (doughnut + bar + line XML)',
      allXml.includes('c:doughnutChart') && allXml.includes('c:barChart') && allXml.includes('c:lineChart'));
    check('IC asset-mix doughnut carries a strategy slice (Operate / Sell)', allXml.includes('Operate') && allXml.includes('Sell'));
    check('IC cost-stack chart values present (land 1,350.7 / construction 3,561.5)', allXml.includes('1350.7') && allXml.includes('3561.5'));
    check('IC revenue-recognition chart series present (Sales / Hospitality / Retail)', allXml.includes('Sales') && allXml.includes('Hospitality') && allXml.includes('Retail'));
    check('IC debt-balance chart series present (Debt outstanding)', allXml.includes('Debt outstanding'));
    check('IC exit-MOIC line series present (Equity MOIC)', allXml.includes('Equity MOIC'));
    // ── Phase D: development-programme Gantt (positioned shapes + markers) ──
    check('IC Gantt legend present (Construction + Operations)', allXml.includes('Construction') && allXml.includes('Operations'));
    check('IC Gantt markers present (debt repaid + exit year)', allXml.includes('Debt repaid 2026') && allXml.includes('Exit 2026'));
    // AUTO-OMIT proof: no scenarios => scenario charts + case categories absent.
    check('IC auto-omit: scenario charts absent (no case categories Downside/Upside)', !allXml.includes('Downside') && !allXml.includes('Upside'));
  }

  // ── IC with scenarios: scenario charts appear with the correct values ──
  {
    const icS = buildICReportModel({ project, phases, assets, rs, snap, parties, asOf, scenarios: scenariosMock, cases: [{ id: 'base' }, { id: 'c1' }, { id: 'c2' }] as any });
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, ic: icS, scenarios: scenariosMock });
    const { allXml } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('IC scenario sections now render (Cases + Economics)', allXml.includes('Scenario Analysis: Cases') && allXml.includes('Scenario Analysis: Economics'));
    check('IC scenario IRR grouped bar present (Project IRR + Equity IRR series)', allXml.includes('Project IRR') && allXml.includes('Equity IRR'));
    check('IC scenario "what drives each case" driver table present (Assumption + Sales price)', allXml.includes('Assumption') && allXml.includes('Sales price'));
    check('IC scenario NPV chart values present (507.6 / -132.2 / 621)', allXml.includes('507.6') && allXml.includes('-132.2') && allXml.includes('621'));
    check('IC scenario case names present as chart categories (Downside / Upside)', allXml.includes('Downside') && allXml.includes('Upside'));
    check('IC scenario charts are native bar charts', allXml.includes('c:barChart'));
  }

  // ── Money scale selectable: thousands renders SAR '000 (not millions) ──
  {
    const inp = { ...makeInputs(), icMoneyScale: 'thousands' as const };
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs: inp, fmt, currency: 'SAR', asOf, ic, scenarios: null });
    const { allXml } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    // GDV = 14,055,000,000 raw -> thousands = 14,055,000; unit note "SAR '000".
    // The apostrophe is XML-escaped in the deck (&apos;).
    check('IC money scale=thousands: GDV in thousands (14,055,000) + SAR \'000 unit', allXml.includes('14,055,000') && allXml.includes('SAR &apos;000'));
    check('IC money scale=thousands: no millions unit note (SAR m absent)', !allXml.includes('SAR m'));
  }

  // ── Lender ── (11 sections, cover excluded => nav 10 => 2 + 10 = 12 slides, no dividers)
  {
    const pptx = buildReportPptx({ reportType: 'lender', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, lender });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('Lender slide count = 12 (cover + ToC + 10 sections, no dividers)', slideCount === 12);
    check('Lender section titles present (Facility Terms, Covenant Analysis, Repayment)', allXml.includes('Facility Terms') && allXml.includes('Covenant Analysis') && allXml.includes('Repayment'));
    check('Lender peak debt present (2,834,065,875)', allXml.includes('2,834,065,875'));
    check('Lender facility rate present (6.30%)', allXml.includes('6.30%'));
    check('Lender covenant verdicts present (PASS + FAIL)', allXml.includes('PASS') && allXml.includes('FAIL'));
    check('Lender narrative from form present (security + covenant commentary)', allXml.includes('First-ranking mortgage.') && allXml.includes('Headroom on LTV.'));
    check('Lender ToC has >= 10 internal slide links', slideRelCount(tocRels) >= 10);
  }

  // ── One-Pager ── (6 sections, no cover => nav 6 => 2 + 6 = 8 slides, no dividers)
  {
    const pptx = buildReportPptx({ reportType: 'onepager', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, onePager });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('One-Pager slide count = 8 (cover + ToC + 6 sections, no dividers)', slideCount === 8);
    check('One-Pager sections present (Deal at a Glance, Capital Ask, Timeline)', allXml.includes('Deal at a Glance') && allXml.includes('Capital Ask') && allXml.includes('Timeline'));
    check('One-Pager headline values present (11.9% / 2.40x)', allXml.includes('11.9%') && allXml.includes('2.40x'));
    check('One-Pager thesis line present', allXml.includes('Buy: yield beats cost of debt.'));
    check('One-Pager ToC has >= 6 internal slide links', slideRelCount(tocRels) >= 6);
  }

  // ── show/hide + reorder respected (IC) ──
  {
    const base = makeInputs();
    const baseNav = icVisibleSections(ic, base).filter((k) => k !== 'cover').length;
    const inp = makeInputs();
    const icCfg = inp.sectionConfig.ic.map((x) => ({ ...x }));
    // Hide disclaimers; move investment_recommendation to the front.
    for (const x of icCfg) { if (x.key === 'disclaimers') x.visible = false; if (x.key === 'investment_recommendation') x.order = -1; }
    inp.sectionConfig = { ...inp.sectionConfig, ic: icCfg };
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs: inp, fmt, currency: 'SAR', asOf, ic, scenarios: null });
    const { slideCount, allXml } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('hide: disclaimers removed drops 1 slide (no dividers)', slideCount === 2 + (baseNav - 1));
    check('hide: "Disclaimers" title no longer in deck', !allXml.includes('Disclaimers'));
    // ToC (slide2) lists Investment Recommendation before Project Overview after reorder.
    const toc = allXml.slice(allXml.indexOf('Contents'));
    check('reorder: Investment Recommendation before Project Overview in ToC', toc.indexOf('Investment Recommendation') >= 0 && toc.indexOf('Investment Recommendation') < toc.indexOf('Project Overview'));
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
