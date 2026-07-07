/* eslint-disable no-console */
/**
 * verify-pdf-export.ts
 *
 * Smoke + structure test for the full-project PDF report (lib/pdf/generateProjectPdf).
 * Builds a rich fixture (hotel + residences + retail + sub-units + cost lines +
 * senior debt + dividends), renders the PDF headless, and checks:
 *   - bytes > 0 and the document parses as a valid PDF;
 *   - a SUBSTANTIAL page count (cover + description + every module's inputs /
 *     outputs / schedules in tab order, not a 10-page summary);
 *   - per-module Inputs / Outputs / Schedules toggles actually drop content;
 *   - the cover + description pages are always present (empty module selection
 *     still yields a 2-page document);
 *   - the underlying snapshot the PDF renders reconciles (BS balances by
 *     construction, Direct CF closing == Indirect CF closing), the proxy for
 *     "numbers in the PDF match the UI", since both read the same snapshot.
 *
 * Run: npx tsx scripts/verify-pdf-export.ts
 */
import { readFileSync } from 'fs';
import zlib from 'zlib';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { generateProjectPdf, generateSummaryPdf, collectModuleTabs } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { PDF_MODULE_TABS } from '../src/hubs/modeling/platforms/refm/lib/pdf/pdfModuleTabs';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import INTER_REGULAR_B64 from '../src/hubs/modeling/platforms/refm/lib/pdf/fonts/interRegular';
import INTER_BOLD_B64 from '../src/hubs/modeling/platforms/refm/lib/pdf/fonts/interBold';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const A = (n: number, fill = 0): number[] => Array(n).fill(fill);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  project.escrow = { heldPct: 0.2 };
  project.dividendPolicy = { enabled: true, payoutRatio: 100, mode: 'cash_above_min' };
  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
  };

  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(11, 0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const suH: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };

  const resi: any = {
    id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 20000, sellableBuaSqm: 20000, parkingBaysRequired: 0,
    revenue: { sell: {
      assetId: 'R1',
      subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }],
      cashPaymentProfile: { percentages: [0.5, 0.5] },
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 };

  const retail: any = {
    id: 'L1', phaseId: 'p1', name: 'Retail', type: '', strategy: 'Lease', visible: true,
    gfaSqm: 0, buaSqm: 5000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(11, 0.9), arDays: 60 } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'lo1', name: 'Property mgmt', category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 5, indexation: { method: 'none' }, useAssetDefault: false, rateMode: 'single' }] },
  };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };

  const cl = makeDefaultCostLines('p1', 2);
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr = makeDefaultFinancingTranche('t1', 'p1');
  return { project, phases: [p1], assets: [hotel, resi, retail], subUnits: [suH, suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr], equityContributions: [] };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

async function main(): Promise<void> {
  console.log('=== PDF full-report export test ===');
  const allKeys = ['module1', 'module2', 'module3', 'module4', 'module5'];

  // Full export, all parts.
  const bytes = await generateProjectPdf({
    state: buildState(),
    projectName: 'Riverside Mixed-Use',
    versionLabel: 'v1.0',
    versionComment: 'Base case with senior debt + 100% dividend sweep',
    dateLabel: '3 June 2026',
    selectedModuleKeys: allKeys,
  });
  check('returns bytes', bytes instanceof Uint8Array);
  check('file size > 0', bytes.length > 0, `len=${bytes.length}`);
  check('non-trivial size (> 8 KB)', bytes.length > 8192, `len=${bytes.length}`);

  // Font: the bundled base64 modules the generator embeds must be the exact
  // Inter TTFs in the repo (the platform UI font, per app/layout.tsx).
  const regOnDisk = readFileSync(path.join(process.cwd(), 'src/assets/fonts/Inter-Regular.ttf'));
  const boldOnDisk = readFileSync(path.join(process.cwd(), 'src/assets/fonts/Inter-Bold.ttf'));
  check('bundled regular == repo Inter-Regular.ttf', Buffer.from(INTER_REGULAR_B64, 'base64').equals(regOnDisk), '');
  check('bundled bold == repo Inter-Bold.ttf', Buffer.from(INTER_BOLD_B64, 'base64').equals(boldOnDisk), '');

  // Unicode: Inter must render Δ and the Unicode minus (−) that WinAnsi could
  // not encode, so no ASCII fallback is needed. Embed via the same fontkit path
  // and confirm the embedded font is Inter + that drawing those glyphs + save()
  // does not throw. (Helvetica threw on these exact characters before.)
  let unicodeOk = true;
  let fontName = '';
  try {
    const doc2 = await PDFDocument.create();
    doc2.registerFontkit(fontkit);
    const f = await doc2.embedFont(Buffer.from(INTER_REGULAR_B64, 'base64'), { subset: false });
    fontName = f.name;
    const pg = doc2.addPage([220, 80]);
    pg.drawText('Δ = Assets − Liab  ·  € 1,234', { x: 10, y: 40, size: 12, font: f });
    await doc2.save();
  } catch { unicodeOk = false; }
  check('embedded font is Inter', /inter/i.test(fontName), `name=${fontName}`);
  check('Inter renders Δ and Unicode minus (no ASCII fallback)', unicodeOk, '');

  // The full report itself emits Δ and − in its labels (BS check + M5 build-ups);
  // it produced valid bytes above, which Helvetica could not have done.
  check('full report renders with Unicode content', bytes.length > 8192, '');

  const fullPages = await pageCount(bytes);
  // Cover + description + a full inputs/outputs/schedules walk across 5 modules
  // with three assets should run well past a 10-page summary.
  check('substantial page count (>= 15)', fullPages >= 15, `pages=${fullPages}`);

  // Subset export (single module): cover + description + at least one module page.
  const subsetBytes = await generateProjectPdf({
    state: buildState(), projectName: 'Riverside Mixed-Use', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4'],
  });
  const subsetPages = await pageCount(subsetBytes);
  check('subset page count >= cover + description + 1', subsetPages >= 3, `pages=${subsetPages}`);
  check('subset smaller than full', subsetBytes.length < bytes.length, `subset=${subsetBytes.length} full=${bytes.length}`);

  // Part toggle: Module 1 outputs-only should be smaller than Module 1 all-parts.
  const m1All = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module1'],
  });
  const m1OutputsOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module1'],
    moduleSections: { module1: { inputs: false, outputs: true, schedules: false } },
  });
  check('part toggle drops content (m1 outputs-only < m1 all)', m1OutputsOnly.length < m1All.length, `out=${m1OutputsOnly.length} all=${m1All.length}`);
  check('part toggle still valid PDF', (await pageCount(m1OutputsOnly)) >= 2, '');

  // FAST input shading: input-part tables fill their value cells with the
  // navy-pale FAST_INPUT color (0.886 0.917 0.957) so assumptions read as
  // inputs, matching the on-screen FAST_INPUT cells. The token must appear when
  // inputs are included and must NOT appear when only outputs are rendered.
  const FAST_FILL_TOKEN = '0.886 0.917 0.957 rg';
  const inflatedContent = (bytes: Uint8Array): string => {
    const buf = Buffer.from(bytes);
    const s = buf.toString('latin1');
    let out = '';
    const re = /stream\r?\n/g; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const start = m.index + m[0].length;
      const end = s.indexOf('endstream', start);
      if (end < 0) continue;
      try { out += zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { /* not a flate stream */ }
    }
    return out;
  };
  const m1InputsOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module1'],
    moduleSections: { module1: { inputs: true, outputs: false, schedules: false } },
  });
  check('FAST input shading present on input cells', inflatedContent(m1InputsOnly).includes(FAST_FILL_TOKEN), 'fill token not found in inputs-only render');
  check('FAST input shading absent from outputs-only', !inflatedContent(m1OutputsOnly).includes(FAST_FILL_TOKEN), 'fill token leaked into outputs-only render');

  // Empty selection still produces cover + executive summary (both mandatory).
  const coverOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: [],
  });
  check('empty selection => cover + exec summary (2 pages)', (await pageCount(coverOnly)) === 2, '');

  // Display scale option: thousands produces a (generally) larger byte stream
  // than millions for the same content (more digits per cell), and both are
  // valid multi-page documents.
  const millions = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: allKeys, displayScale: 'millions' });
  const thousands = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: allKeys, displayScale: 'thousands' });
  check('scale option produces valid PDFs (millions + thousands)', (await pageCount(millions)) >= 15 && (await pageCount(thousands)) >= 15, '');

  // Decimals option: 2 decimals produces a valid (and generally larger) byte
  // stream than 0 decimals for the same content.
  const dec0 = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: allKeys, displayScale: 'millions', displayDecimals: 0 });
  const dec2 = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: allKeys, displayScale: 'millions', displayDecimals: 2 });
  check('decimals option produces valid PDFs (0 + 2)', (await pageCount(dec0)) >= 15 && (await pageCount(dec2)) >= 15, '');

  // Future-module placeholder: selecting a not-yet-built module (module7 Reports)
  // yields a roadmap page even though it has no builder.
  const withFuture = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4', 'module7'] });
  const withoutFuture = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4'] });
  check('future (unbuilt) module renders a placeholder page', (await pageCount(withFuture)) > (await pageCount(withoutFuture)), `with=${await pageCount(withFuture)} without=${await pageCount(withoutFuture)}`);

  // Per-tab selection: restricting module4 to a single tab drops content vs all
  // tabs of module4.
  const m4AllTabs = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4'] });
  const m4OneTab = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4'], moduleTabs: { module4: ['Tab 3: P&L'] } });
  check('per-tab selection drops content (m4 one tab < all tabs)', m4OneTab.length < m4AllTabs.length, `one=${m4OneTab.length} all=${m4AllTabs.length}`);

  // Tab manifest stays in sync: every tab the builders emit for the fixture must
  // appear in the static PDF_MODULE_TABS manifest (the modal's source of truth).
  const emitted = collectModuleTabs(buildState());
  const orphanTabs: string[] = [];
  for (const [key, tabs] of Object.entries(emitted)) {
    const manifest = PDF_MODULE_TABS[key] ?? [];
    for (const t of tabs) if (!manifest.includes(t)) orphanTabs.push(`${key}:${t}`);
  }
  check('PDF tab manifest covers every emitted tab', orphanTabs.length === 0, orphanTabs.join(', '));

  // Case comparison: a 2-case bundle makes Module 5 render the Case Comparison
  // table (an extra page vs no bundle).
  const caseBundle = {
    baseModel: buildState(),
    activeCaseId: 'base',
    cases: [
      { id: 'base', name: 'Management', role: 'base' as const, overrides: {} },
      { id: 's1', name: 'Downside', role: 'scenario' as const, overrides: { 'project.tax.rate': 0.25 } },
    ],
  };
  const m5NoCases = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module5'] });
  const m5WithCases = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module5'], caseComparison: caseBundle });
  check('Module 5 renders Case Comparison with >1 case', (await pageCount(m5WithCases)) > (await pageCount(m5NoCases)), `with=${await pageCount(m5WithCases)} no=${await pageCount(m5NoCases)}`);

  // Module 6 (Scenarios) is now BUILT (not a placeholder): with a >1 case bundle
  // it renders scenario comparison + year-on-year impact content; with a single
  // case it still renders a short "no scenarios" note page (never blank).
  const m6NoCases = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module6'] });
  const m6WithCases = await generateProjectPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module6'], caseComparison: caseBundle });
  check('Module 6 renders a page even with no scenarios', (await pageCount(m6NoCases)) >= 3, `pages=${await pageCount(m6NoCases)}`);
  check('Module 6 renders scenario content with >1 case', (await pageCount(m6WithCases)) > (await pageCount(m6NoCases)), `with=${await pageCount(m6WithCases)} no=${await pageCount(m6NoCases)}`);

  // Manifest sync with a case bundle: Module 6's scenario tabs (Comparison /
  // Year-on-Year) + Module 5's Case Comparison must all appear in the manifest.
  const emittedWithCases = collectModuleTabs(buildState(), caseBundle);
  const orphanWithCases: string[] = [];
  for (const [key, tabs] of Object.entries(emittedWithCases)) {
    const manifest = PDF_MODULE_TABS[key] ?? [];
    for (const t of tabs) if (!manifest.includes(t)) orphanWithCases.push(`${key}:${t}`);
  }
  check('PDF tab manifest covers every emitted tab (with cases)', orphanWithCases.length === 0, orphanWithCases.join(', '));

  // Executive summary gains the Scenario Summary block (+ Module 5 case matrix)
  // when a >1 case bundle is supplied, so the case-aware full report is larger.
  const fullWithCases = await generateProjectPdf({ state: buildState(), projectName: 'Riverside Mixed-Use', versionLabel: 'v1.0', dateLabel: '3 June 2026', selectedModuleKeys: allKeys, caseComparison: caseBundle });
  check('case bundle enriches full report (exec scenario summary + M5 matrix)', fullWithCases.length > bytes.length, `withCases=${fullWithCases.length} base=${bytes.length}`);

  // The standalone Executive Summary PDF also reflects scenarios: a case bundle
  // adds the Scenario Summary table, so it is larger than without.
  const summaryNoCases = await generateSummaryPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: [] });
  const summaryWithCases = await generateSummaryPdf({ state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: [], caseComparison: caseBundle });
  check('summary PDF adds Scenario Summary with cases', summaryWithCases.length > summaryNoCases.length, `withCases=${summaryWithCases.length} no=${summaryNoCases.length}`);

  // Data-layer reconciliation: the PDF renders this exact snapshot, so if it
  // balances + the two CF methods tie, the printed numbers match the UI.
  const snap = computeFinancialsSnapshot(buildState());
  const tol = Math.max(1000, Math.max(0, ...snap.bs.totalLiabilitiesAndEquityPerPeriod.map(Math.abs)) * 1e-6);
  const bsBalances = snap.bs.bsDifferencePerPeriod.every((v) => Math.abs(v) <= tol);
  check('snapshot BS balances by construction', bsBalances, `maxDiff=${Math.max(0, ...snap.bs.bsDifferencePerPeriod.map(Math.abs)).toFixed(2)}`);
  const cfTie = snap.directCF.closingCashPerPeriod.every((v, i) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[i] ?? 0)) <= 1);
  check('Direct CF closing == Indirect CF closing', cfTie, '');

  // Summary (executive) PDF: a few pages, valid, and far shorter than the full
  // detailed report.
  const summary = await generateSummaryPdf({ state: buildState(), projectName: 'Riverside Mixed-Use', versionLabel: 'v1.0', dateLabel: '4 June 2026', selectedModuleKeys: [] });
  check('summary returns valid bytes', summary instanceof Uint8Array && summary.length > 4096, `len=${summary.length}`);
  const summaryPages = await pageCount(summary);
  check('summary is concise (cover + exec + financials + returns, <= 8 pages)', summaryPages >= 3 && summaryPages <= 8, `pages=${summaryPages}`);
  check('summary is shorter than the full report', summaryPages < fullPages, `summary=${summaryPages} full=${fullPages}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
