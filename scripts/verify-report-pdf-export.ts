/**
 * verify-report-pdf-export.ts (REFM Module 7, IC deck: the shareable PDF)
 *
 * Pins the PDF side of the deck exporter (Phase E, 2026-07-28). The PDF is a
 * SAME-MODEL renderer, not a conversion: it reads the identical resolved contract
 * (resolveDeckExport) the canvas and the .pptx read, so this verifier asserts the
 * things that are specific to the PDF as a DOCUMENT rather than re-checking the
 * numbers (verify-report-deck-export already pins figure-for-figure agreement).
 *
 * What it asserts, by parsing the real bytes back with pdf-lib:
 *
 *   - one landscape 960 x 540pt page per VISIBLE slide, hidden slides dropped,
 *   - an /Outlines bookmark tree exists, is flat, and its entry count + titles
 *     match the visible slides in page order (so bookmarks and the gapless page
 *     numbering can never disagree),
 *   - /PageMode is UseOutlines, so a reader opens with the bookmark panel showing,
 *   - every bookmark destination points at a page that is actually in the document,
 *   - GoTo link annotations resolve to in-range pages, and the Contents (ToC)
 *     page's links land on the page whose slide they name,
 *   - no editor-only placeholder text reaches the file,
 *   - a reduced no-debt / single-case model still builds (the auto-omit + unlinked
 *     path is exercised end to end).
 *
 * Pure: no DB, no network. Run: npx tsx scripts/verify-report-pdf-export.ts
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { makeDeckFmt } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import { seedDeck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { resolveDeckExport } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/exportModel';
import { buildDeckPdf } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/deckPdf';
import { PLACEHOLDER } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/placeholders';
import type { Deck } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/types';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const near = (a: number, b: number, eps = 0.5): boolean => Math.abs(a - b) < eps;
const MM = 1_000_000;
const k = (x: number): number => x * MM;

// ── Fixture: enough for a full composed deck (charts, tables, Gantt, ToC) ─────
const YEARS = 8, START = 2026;
const yearLabels = Array.from({ length: YEARS }, (_, i) => START + i);
const series = (b: number, s: number): number[] => Array.from({ length: YEARS }, (_, i) => k(b + s * i));
const S = YEARS + 1;

const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 1.9, npv: k(1240), totalInflow: k(6100), totalOutflow: k(3200), netProfit: k(2900) },
    fcfe: { irr: 0.083, moic: 2.4, npv: k(980), totalInflow: k(4720), totalOutflow: k(2050), netProfit: k(2670) },
    dividends: { irr: 0.171, moic: 2.1, npv: Number.NaN, totalInflow: k(4300), totalOutflow: k(2050), netProfit: k(2250) },
    realEstate: { equityMultiple: 2.4, yieldOnCost: 0.064, capRateAtExit: 0.087, profitOnCost: 1.86, cashOnCashAvg: 0.1, dscrMin: 1.5, ltvAtExit: 0 },
  },
  buildup: {
    existingPreCapexPerPeriod: [k(-900), ...Array.from({ length: YEARS }, () => 0)],
    existingEquityPerPeriod: [k(-500), ...Array.from({ length: YEARS }, () => 0)],
    cfoPerPeriod: [0, ...series(-1, 15)], cfiPerPeriod: [0, ...series(-50, 2)],
    inKindLandPerPeriod: Array.from({ length: S }, () => 0),
    terminalEnterprisePerPeriod: Array.from({ length: S }, (_, i) => (i === S - 1 ? k(4200) : 0)),
    debtDrawPerPeriod: [0, ...series(25, -1)], principalRepayPerPeriod: [0, ...series(0, -1.5)],
    interestPaidPerPeriod: [0, ...series(-3, -0.2)],
    terminalEquityPerPeriod: Array.from({ length: S }, (_, i) => (i === S - 1 ? k(3600) : 0)),
    equityCashPerPeriod: Array.from({ length: S }, () => k(-30)),
    equityInKindPerPeriod: Array.from({ length: S }, () => 0),
    dividendsDistributedPerPeriod: Array.from({ length: S }, () => k(20)),
  },
  fcffPerPeriod: Array.from({ length: S }, () => k(120)),
  fcfePerPeriod: Array.from({ length: S }, () => k(90)),
  dividendStreamPerPeriod: Array.from({ length: S }, () => k(70)),
  streamYearLabels: [START - 1, ...yearLabels],
  totalDividendsDistributed: k(4300),
  developmentEconomics: { gdv: k(14055), totalDevelopmentCost: k(4912), totalFinancingCost: k(820), profitBeforeFinancing: k(9142), profitAfterFinancing: k(8322), developmentMargin: 0.59, costToValue: 0.35 },
  sourcesUses: { existingEquity: k(1282), inKindEquity: k(1350), existingDebt: k(2400), newDebt: k(434), customerCollections: k(4973), land: k(1350), construction: k(3561), idc: k(104), reservesDistributions: k(5423), totalSources: k(10440), totalUses: k(10440) },
  fundingMix: { debtPct: 0.27, cashEquityPct: 0.12, inKindEquityPct: 0.13, customerFundingPct: 0.48 },
  equityExposure: { equityAtRisk: k(2632) },
  debtAnalytics: { peakDebt: k(2834.1), remainingDebtAtExit: 0, tenorYears: 4, paydownPct: 1 },
  totalEquityInvested: k(2632), terminalEquityValue: k(3602),
  noiPerPeriod: series(0, 5), yearLabels, exitYearLabel: yearLabels[YEARS - 1],
  exitYears: [
    { exitYearLabel: yearLabels[YEARS - 2], equityValue: k(3200), fcffIrr: 0.11, fcfeIrr: 0.08, equityMoic: 2.1, isSelected: false },
    { exitYearLabel: yearLabels[YEARS - 1], equityValue: k(3602), fcffIrr: 0.119, fcfeIrr: 0.083, equityMoic: 2.4, isSelected: true },
  ],
  sensitivity: { xVariable: 'Exit cap rate', yVariable: 'Discount rate', xValues: [0.06, 0.07], yValues: [0.1, 0.11], irr: [[0.12, 0.11], [0.1, 0.09]], baseEquityIrr: 0.083 },
};
const snap: any = {
  projectStartYear: START, yearLabels,
  pl: {
    totalRevenuePerPeriod: series(7, 22), ebitdaPerPeriod: series(0, 11), cosPerPeriod: series(3, 8),
    totalOpexPerPeriod: series(4, 3), daPerPeriod: series(2, 1), ebitPerPeriod: series(-2, 10),
    interestExpensePerPeriod: series(3, 0), pbtPerPeriod: series(-5, 10), taxPerPeriod: series(0, 2),
    patPerPeriod: series(-5, 8), residentialRevenuePerPeriod: series(0, 12),
    hospitalityRevenuePerPeriod: series(5, 7), retailRevenuePerPeriod: series(2, 3),
    hospitalityOpexPerPeriod: series(1, 2), retailOpexPerPeriod: series(1, 1), hqOpexPerPeriod: series(2, 0),
  },
  directCF: {
    cashFromOperationsPerPeriod: series(-1, 15), cashFromInvestmentPerPeriod: series(-50, 2),
    cashFromFinancingPerPeriod: series(52, -5), netCashFlowPerPeriod: series(1, 11),
    closingCashPerPeriod: series(1, 10), openingCashPerPeriod: series(0, 10),
  },
  bs: {
    totalAssetsPerPeriod: series(153, 21), cashPerPeriod: series(1, 10), arPerPeriod: series(2, 1),
    residentialReceivablesPerPeriod: series(6, 2), inventoryPerPeriod: series(40, 3),
    totalFixedAssetsPerPeriod: series(100, 4), debtOutstandingPerPeriod: series(60, -2),
    apPerPeriod: series(12, 1), unearnedRevenuePerPeriod: series(9, 0.5),
    totalLiabilitiesPerPeriod: series(81, -0.5), totalEquityPerPeriod: series(72, 22),
  },
  perAssetCF: new Map<string, any>(),
};
const project: any = { name: 'FMP RE HUB', location: 'Riyadh', country: 'KSA', currency: 'SAR', startDate: '2026-01-01', modelType: 'annual', financing: { fundingMethod: 3, minimumCashReserve: 50 } };
const phases: any = [
  { id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionStart: 1, constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 },
];
const assets: any = [
  { id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, phaseId: 'p1', buaTotal: 12083, landAreaSqm: 5000 },
  { id: 'a2', name: 'Residences', strategy: 'Sell', visible: true, phaseId: 'p1', buaTotal: 8000, landAreaSqm: 4000 },
];
const parties: any = [{ id: '1', name: 'PaceMakers', roles: ['Sponsor'] }];

const model: ICReportModel = buildICReportModel({ project, phases, assets, subUnits: [], rs, snap, parties, asOf: '2026-07-28', cases: [{ id: 'base' } as any] });
const fmt = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));
const seed = { inputs: null };
const deck: Deck = seedDeck('proj-1', model, seed, { asOf: '2026-07-28' });

/** Editor-only prompt markers that must never reach a rendered file. */
const PLACEHOLDER_SIGNS = ['[Add ', 'Click to edit', 'Generate Commentary', PLACEHOLDER('x').slice(0, 5)];

void (async () => {
  console.log('=== 1. Pages: one landscape 960 x 540 page per VISIBLE slide ===');
  const ex = resolveDeckExport(deck, model, fmt);
  const bytes = await buildDeckPdf({ deck, model, fmt });
  const head = Buffer.from(bytes.slice(0, 5)).toString('latin1');
  check('produces a real PDF (%PDF header)', bytes.length > 2000 && head.startsWith('%PDF'), `${bytes.length} bytes`);

  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString, PDFRef } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  const visible = deck.slides.filter((s) => !s.hidden);
  check('one page per visible slide', pageCount === visible.length, `pdf=${pageCount} visible=${visible.length}`);
  check('resolved export agrees on the slide count', ex.slides.length === pageCount);
  const p0 = doc.getPage(0);
  check('pages are landscape 960 x 540 pt', near(p0.getWidth(), 960) && near(p0.getHeight(), 540), `${p0.getWidth()} x ${p0.getHeight()}`);
  check('every page is the same size', doc.getPages().every((p) => near(p.getWidth(), 960) && near(p.getHeight(), 540)));

  console.log('\n=== 2. Hidden slides drop out of the document AND the outline ===');
  {
    const hiddenDeck: Deck = { ...deck, slides: deck.slides.map((s, i) => (i === 2 ? { ...s, hidden: true } : s)) };
    const hb = await buildDeckPdf({ deck: hiddenDeck, model, fmt });
    const hd = await PDFDocument.load(hb);
    check('hiding a slide removes exactly one page', hd.getPageCount() === pageCount - 1, `${hd.getPageCount()}`);
    const hOut = hd.catalog.get(PDFName.of('Outlines'));
    const hDict = hOut instanceof PDFRef ? hd.context.lookup(hOut) : hOut;
    const hCount = hDict instanceof PDFDict ? (hDict.get(PDFName.of('Count')) as any)?.asNumber?.() : -1;
    check('the outline loses that entry too (bookmarks track the pages)', hCount === pageCount - 1, `${hCount}`);
  }

  console.log('\n=== 3. /Outlines bookmark tree ===');
  const outlinesEntry = doc.catalog.get(PDFName.of('Outlines'));
  const outlines = outlinesEntry instanceof PDFRef ? doc.context.lookup(outlinesEntry) : outlinesEntry;
  check('catalog carries an /Outlines tree', outlines instanceof PDFDict);
  const pageMode = doc.catalog.get(PDFName.of('PageMode'));
  check('/PageMode is UseOutlines (reader opens the bookmark panel)', String(pageMode) === '/UseOutlines', String(pageMode));

  // Walk First -> Next collecting titles + destination pages. Deliberately NOT
  // wrapped in an `if (outlines)`: every assertion below must RUN and fail when
  // the tree is missing, rather than silently not executing (which would let a
  // regression pass as "no failures").
  const titles: string[] = [];
  const destPages: number[] = [];
  const pageRefs = doc.getPages().map((p) => String(p.ref));
  const count = outlines instanceof PDFDict ? (outlines.get(PDFName.of('Count')) as any)?.asNumber?.() : -1;
  check('outline Count equals the page count', count === pageCount, `${count} vs ${pageCount}`);
  {
    let cur = outlines instanceof PDFDict ? outlines.get(PDFName.of('First')) : undefined;
    let guard = 0;
    while (cur && guard++ < 200) {
      const item = cur instanceof PDFRef ? doc.context.lookup(cur) : cur;
      if (!(item instanceof PDFDict)) break;
      const t = item.get(PDFName.of('Title'));
      titles.push(t instanceof PDFHexString ? t.decodeText() : t instanceof PDFString ? t.asString() : String(t));
      const d = item.get(PDFName.of('Dest'));
      destPages.push(d instanceof PDFArray ? pageRefs.indexOf(String(d.get(0))) : -1);
      cur = item.get(PDFName.of('Next'));
    }
  }
  check('outline has one entry per page', titles.length === pageCount, `${titles.length}`);
  check('outline titles match the visible slide titles in page order',
    titles.join('|') === ex.slides.map((s) => s.title).join('|'),
    titles.slice(0, 3).join('|'));
  check('every bookmark destination resolves to a real page in the document',
    destPages.length > 0 && destPages.every((i) => i >= 0 && i < pageCount),
    destPages.slice(0, 5).join(','));
  check('bookmarks are in page order (entry i targets page i)',
    destPages.length === pageCount && destPages.every((p, i) => p === i), destPages.slice(0, 6).join(','));

  console.log('\n=== 4. GoTo link annotations ===');
  {
    let annots = 0, goTo = 0, inRange = 0;
    const pageRefs = doc.getPages().map((p) => String(p.ref));
    for (const page of doc.getPages()) {
      const a = page.node.get(PDFName.of('Annots'));
      const arr = a instanceof PDFRef ? doc.context.lookup(a) : a;
      if (!(arr instanceof PDFArray)) continue;
      for (let i = 0; i < arr.size(); i++) {
        const raw = arr.get(i);
        const an = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
        if (!(an instanceof PDFDict)) continue;
        annots += 1;
        const d = an.get(PDFName.of('Dest'));
        if (d instanceof PDFArray) {
          goTo += 1;
          if (pageRefs.includes(String(d.get(0)))) inRange += 1;
        }
      }
    }
    check('the document carries link annotations', annots > 0, `${annots}`);
    check('internal GoTo links all resolve to in-range pages', goTo > 0 && goTo === inRange, `goTo=${goTo} inRange=${inRange}`);
  }

  console.log('\n=== 5. Contents page links land on the slide they name ===');
  {
    // The ToC is resolved from the deck's own slide list, so its entries carry the
    // page each title sits on. Assert that mapping against the real page order.
    const tocSlideIdx = ex.slides.findIndex((s) => s.objects.some((o) => o.paint.kind === 'toc'));
    check('the deck ships a Contents page', tocSlideIdx >= 0);
    if (tocSlideIdx >= 0) {
      const toc = ex.slides[tocSlideIdx].objects.find((o) => o.paint.kind === 'toc')!.paint as any;
      const wrong = toc.entries.filter((e: any) => ex.slides[e.page - 1]?.title !== e.title);
      check('every Contents entry points at the page holding that slide', wrong.length === 0,
        wrong.slice(0, 2).map((e: any) => `${e.title}->p${e.page}`).join(' '));
      check('Contents never lists itself', !toc.entries.some((e: any) => e.page === tocSlideIdx + 1));
      check('Contents pages are within the document', toc.entries.every((e: any) => e.page >= 1 && e.page <= pageCount));
    }
  }

  console.log('\n=== 6. No editor-only placeholder text reaches the file ===');
  {
    const painted: string[] = [];
    for (const s of ex.slides) {
      for (const o of s.objects) {
        const p: any = o.paint;
        if (p.kind === 'text') painted.push(p.text);
        else if (p.kind === 'bullets') painted.push(...p.items);
        else if (p.kind === 'shape') painted.push(p.text ?? '');
        else if (p.kind === 'riskMatrix') for (const r of p.rows) painted.push(r.risk, r.mitigation);
      }
    }
    const leaked = painted.filter((t) => PLACEHOLDER_SIGNS.some((sig) => sig && t.includes(sig)));
    check('no placeholder prompt text in the rendered paints', leaked.length === 0, leaked.slice(0, 2).join(' | '));
  }

  console.log('\n=== 7. Reduced model (no debt, single case) still builds ===');
  {
    const mNoDebt: ICReportModel = {
      ...model,
      capital: { ...model.capital, peakDebt: 0, remainingDebtAtExit: 0, debtPct: 0 },
      financing: { ...model.financing, facilities: [], existingDebt: 0, newDebt: 0 },
      sensitivity: { ...model.sensitivity, hasData: false },
    } as ICReportModel;
    const dNoDebt = seedDeck('p2', mNoDebt, seed, { asOf: '2026-07-28' });
    const b2 = await buildDeckPdf({ deck: dNoDebt, model: mNoDebt, fmt });
    const h2 = Buffer.from(b2.slice(0, 5)).toString('latin1');
    check('reduced model produces a valid PDF', b2.length > 2000 && h2.startsWith('%PDF'));
    const d2 = await PDFDocument.load(b2);
    check('reduced model omits slides (fewer pages than the full model)', d2.getPageCount() < pageCount, `${d2.getPageCount()} vs ${pageCount}`);
    const o2raw = d2.catalog.get(PDFName.of('Outlines'));
    const o2 = o2raw instanceof PDFRef ? d2.context.lookup(o2raw) : o2raw;
    const c2 = o2 instanceof PDFDict ? (o2.get(PDFName.of('Count')) as any)?.asNumber?.() : -1;
    check('reduced model still gets a matching outline', c2 === d2.getPageCount(), `${c2} vs ${d2.getPageCount()}`);
  }

  console.log('\n=== 8. Money scale carries into the document ===');
  {
    const fmtK = makeDeckFmt(icMoneyScaleSpec('thousands', 'SAR'));
    const bK = await buildDeckPdf({ deck, model, fmt: fmtK });
    check('thousands scale produces a different file from millions', bK.length !== bytes.length || Buffer.compare(Buffer.from(bK), Buffer.from(bytes)) !== 0);
    const dK = await PDFDocument.load(bK);
    check('the scale toggle does not change the page count', dK.getPageCount() === pageCount);
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); fails.forEach((n) => console.log(`  - ${n}`)); process.exit(1); }
})();
