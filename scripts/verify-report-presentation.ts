/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-report-presentation.ts
 *
 * Pass 4 of the export review: six findings about how a correct number is
 * PRESENTED. Every one of them was a figure the model computes correctly and a
 * reader cannot interpret.
 *
 *   P1  the fund waterfall printed Hurdle Paid's LIFETIME total (5,668.5)
 *       directly under a Total Hurdle Owed row with no total at all, closing at
 *       4,834.0. Scanning the column, more was paid than was ever owed. One is
 *       a flow summed over the hold, the other a balance at a point in time,
 *       and nothing said so.
 *   P2  "Total" meant two things in one document. The P&L used it for a
 *       lifetime sum; the balance sheet used it for the closing balance (TOTAL
 *       ASSETS printed 2,512.1, the at-exit figure); the cash flow statement
 *       used it for both at once.
 *   P3  two assets reported a bare 0 for built-up area, and zero cost with a
 *       100% margin, beside six assets reporting real figures. Both zeros are
 *       correct and structural: an existing operational asset has no new build
 *       and its cost predates the model, and a companion's area and cost sit on
 *       its parent.
 *   P4  the three capital bases sat inside the fee basis table with Timing,
 *       Rate and (in the workbook) Base all empty and their amount in the
 *       column that holds a fee charged, so a quantity of capital read as a fee.
 *   P5  Distributed Equity IRR and MOIC appeared three times in a ten-page
 *       summary, twice as a byte-identical card set.
 *   P6  all of the above hold in the FULL report and the workbook, not only in
 *       the summary PDF.
 *
 * TEETH. Presence checks alone would pass against two hand-maintained copies
 * that agree today, which is the failure this codebase has already had once
 * (the fund waterfall reached Excel and not the PDF). So every shared rule is
 * asserted ON THE BUILDER and each surface is asserted to CONSUME it, and the
 * documents are generated and decoded rather than grepped for in source.
 *
 * Run: npx tsx scripts/verify-report-presentation.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import ExcelJS from 'exceljs';
import { pdfText } from './pdfTextExtract';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  buildBSRows, buildPLRows, buildDirectCFRows,
  totalColumnKind, totalColumnHeading, totalColumnNote,
  TOTAL_COLUMN_HEADINGS, FUND_CAPITAL_BASES_TITLE, FUND_CAPITAL_BASES_NOTE, FUND_CAPITAL_BASE_TAG,
  buildFundCapitalRows,
} from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import {
  fundWaterfallTotalsNote, fundHeadlineRestatementNote, buildFundWaterfallRows,
  FUND_WATERFALL_NO_TOTAL_ROWS, type FundReportCtx,
} from '../src/hubs/modeling/platforms/refm/lib/reports/fundReports';
import { buildAssetNotes, structuralZeroKindFor, structuralZeroCell } from '../src/hubs/modeling/platforms/refm/lib/reports/assetNotes';
import { getFinancialLabels } from '../src/core/calculations/financials';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

// pdf-lib embeds Inter as a CID font and Inter maps some punctuation to
// private-use codepoints, so a raw decode silently drops every parenthesis.
const PUA: Record<number, number> = { 0xE081: 40, 0xE082: 41, 0xE083: 91, 0xE084: 93, 0xE088: 45, 0xE092: 58 };
const decode = (b: Uint8Array): string => Array.from(pdfText(b)).map((ch) => {
  const c = ch.codePointAt(0) ?? 0;
  if (c < 0xE000 || c > 0xF8FF) return ch;
  const m = PUA[c];
  return m === undefined ? '?' : String.fromCharCode(m);
}).join('');

const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];
const TERMS = {
  enabled: true, fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.005, fundManagementFeePct: 0.005, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.005, otherExpensesPerAnnum: 3_000_000,
  performanceFeePct: 0.2, hurdleRatePct: 0.08,
  fundManagerName: 'Fund Manager', feeDistribution: [] as any[],
};

/** A minimal but COMPLETE hospitality config. The resolver reads `fb.mode` and
 *  `otherRevenue.mode` unconditionally, so a half-built object throws rather
 *  than degrading, and the fixture has to supply the real shape. */
function operateConfig(assetId: string, adr: number, occupancy: number): any {
  return {
    assetId, startingADR: adr, daysPerYear: 365, dso: 0, guestsPerOccupiedRoom: 1.5,
    occupancyPerPeriod: new Array(11).fill(occupancy),
    occupancyPerPeriodByPhase: new Array(11).fill(occupancy),
    adrIndexation: { method: 'yoy_compound', rate: 0.03, startYear: 1 },
    fb: { mode: 'percent_of_rooms', percentOfRooms: 0.18, ratePerGuest: 50 },
    otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0.04 },
  };
}

/**
 * The fixture, with the two structural-zero shapes REAL: an existing
 * operational asset carrying historical pre-capex and no cost lines, and a
 * companion whose area and cost sit on its parent. Built here rather than
 * borrowed from the live project, because the live snapshot is edited in place
 * and is not a stable baseline.
 */
function fixture(o: { fund?: boolean } = {}): any {
  const s = buildExcelSampleState();
  if (o.fund !== false) s.project.fundTerms = { ...TERMS };
  for (const ph of s.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };

  // An EXISTING operational asset: no new build, cost spent before period 0.
  s.assets.push({
    id: 'EX1', phaseId: 'p1', name: 'Legacy Hotel', type: 'Hotel 4-star', strategy: 'Operate',
    visible: true, buaSqm: 0, gfaSqm: 0, status: 'operational', usefulLifeYears: 25,
    historicalPreCapex: 800_000_000, historicalPreCapexLand: 200_000_000,
    historicalPreCapexBuilding: 600_000_000, historicalDebtAmount: 500_000_000,
    historicalEquityAmount: 300_000_000, subUnitMetric: 'units',
    revenue: { operate: operateConfig('EX1', 260, 0.62) },
  });
  // Metric 'units' with unitArea 0, which is exactly how the live project's
  // hotel keys are entered and why its computed BUA is nil.
  s.subUnits.push({ id: 'exsu1', assetId: 'EX1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 300, unitArea: 0, unitPrice: 0, startingAdr: 900 });

  // A COMPANION of the Residences tower: same building, second strategy.
  s.assets.push({
    id: 'CO1', phaseId: 'p1', name: 'Residences - Operate', type: 'High-end Apartments', strategy: 'Operate',
    visible: true, buaSqm: 0, gfaSqm: 0, status: 'construction', isCompanion: true,
    companionType: 'operate', parentAssetId: 'R1', unitsFromParent: 40, usefulLifeYears: 25, subUnitMetric: 'units',
    revenue: { operate: operateConfig('CO1', 700, 0.75) },
  });
  s.subUnits.push({ id: 'cosu1', assetId: 'CO1', name: 'Serviced Units', category: 'Operable', metric: 'units', metricValue: 40, unitArea: 0, unitPrice: 0, startingAdr: 700 });
  return s;
}

const money = (v: number): string => `${(v / 1e6).toFixed(1)}m`;
const fundCtx = (state: any): FundReportCtx => {
  const snap = computeFinancialsSnapshot(state);
  const returns = computeReturnsSnapshot(snap, state.project);
  return { snap, returns, fmt: { money, pct: (v, d = 1) => `${((v ?? 0) * 100).toFixed(d)}%`, mult: (v) => `${(v ?? 0).toFixed(2)}x` } };
};
const m4ctx = (state: any, snap: any): any => ({ snap, state, labels: getFinancialLabels(state.project), filterPhaseId: '__all__', fmt: (v: number) => String(v) });

const flat = (t: string): string => t.replace(/\s+/g, ' ');
/**
 * A period table draws [title][heading][prior][years...], so the heading is the
 * next line after the title. NOT literally the next line, though: a title can
 * be the last thing on a page, putting the footer between it and its header
 * (the summary's cash flow table does exactly that). So this scans the next few
 * lines for the first one that IS one of the three legal headings, which also
 * makes the check fail loudly rather than silently matching a footer.
 */
const LEGAL_HEADINGS = [TOTAL_COLUMN_HEADINGS.sum, TOTAL_COLUMN_HEADINGS.closing, TOTAL_COLUMN_HEADINGS.mixed];
const headingAfter = (txt: string, title: string): string => {
  const ls = txt.split('\n');
  const i = ls.findIndex((l) => l.includes(title));
  if (i < 0) return '(title not found)';
  for (let k = i + 1; k < Math.min(ls.length, i + 6); k++) {
    const s = (ls[k] ?? '').trim();
    if (LEGAL_HEADINGS.includes(s)) return s;
  }
  return `(no heading within 5 lines: ${ls.slice(i + 1, i + 4).map((l) => l.trim()).join(' | ')})`;
};
const cellText = (v: any): string => (v && typeof v === 'object' && 'text' in v ? String(v.text) : v == null ? '' : String(v));
const sheetCol = (ws: ExcelJS.Worksheet, col: number): string[] => {
  const out: string[] = [];
  ws.eachRow((rw) => out.push(cellText(rw.getCell(col).value)));
  return out;
};

async function main(): Promise<void> {
  console.log('=== Report presentation (export review pass 4) ===');
  const state = fixture();
  const snap: any = computeFinancialsSnapshot(state);
  const ctx = fundCtx(state);
  const common = { state, projectName: 'Riverside Mixed-Use', dateLabel: '13 August 2026', displayScale: 'millions' } as any;
  const full = decode(await generateProjectPdf({ ...common, selectedModuleKeys: MODULE_KEYS }));
  const summary = decode(await generateSummaryPdf({ ...common, selectedModuleKeys: [] }));
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '13 August 2026' } as any);

  // ── P1: the waterfall's Total column is explained ─────────────────────────
  console.log('\n-- P1: flow totals beside untotalled balances --');
  {
    const note = fundWaterfallTotalsNote(ctx);
    check('P1: the builder produces a totals note on a fund project', note.length > 0);
    check('P1: it says the flow rows are LIFETIME totals', /LIFETIME/.test(note));
    check('P1: it names the balance rows as carrying no total', flat(note).includes('balance rows carry no total'));
    check('P1: it quotes the two figures the reader is comparing',
      note.includes(money(ctx.returns.waterfall.hurdlePaidPerPeriod.reduce((s: number, v: number) => s + v, 0)))
      && note.includes(money(ctx.returns.waterfall.totalHurdleOwedPerPeriod[ctx.returns.waterfall.totalHurdleOwedPerPeriod.length - 1])),
      'the note must quote the model, not a hardcoded pair');
    check('P1: it states they are not comparable', flat(note).includes('not comparable'));
    check('P1: the note is EMPTY when the fund layer is off', fundWaterfallTotalsNote(fundCtx(fixture({ fund: false }))) === '');
    // The rows the note describes must be the rows the builder actually blanks,
    // or the sentence is a claim about a table that does not exist.
    const rows = buildFundWaterfallRows(ctx);
    const blanked = rows.filter((r) => r.totalOverride === '').map((r) => r.label);
    check('P1: exactly the documented rows carry no total',
      blanked.length === FUND_WATERFALL_NO_TOTAL_ROWS.length && blanked.every((l) => FUND_WATERFALL_NO_TOTAL_ROWS.includes(l)),
      blanked.join(', '));
    check('P1: Hurdle Paid still carries its lifetime total',
      (rows.find((r) => r.label === 'Hurdle Paid')?.totalOverride ?? '') !== '');
    for (const [doc, txt] of [['full report', full], ['summary', summary]] as const) {
      check(`P1: the ${doc} prints the note`, flat(txt).includes('flow rows are LIFETIME totals over the hold'));
    }
    const returnsSheet = wb.getWorksheet('Returns')!;
    check('P1: the workbook prints the note', sheetCol(returnsSheet, 1).some((v) => v.includes('flow rows are LIFETIME totals')));
  }

  // ── P2: one heading, one meaning ──────────────────────────────────────────
  console.log('\n-- P2: the leading column says what it holds --');
  {
    const bs = buildBSRows(m4ctx(state, snap)).rows;
    const pl = buildPLRows(m4ctx(state, snap));
    const cf = buildDirectCFRows(m4ctx(state, snap));
    check('P2: a balance-sheet row list resolves to "closing"', totalColumnKind(bs) === 'closing', totalColumnKind(bs));
    check('P2: a P&L row list resolves to "sum"', totalColumnKind(pl) === 'sum', totalColumnKind(pl));
    check('P2: a cash flow row list resolves to "mixed"', totalColumnKind(cf) === 'mixed', totalColumnKind(cf));
    check('P2: the headings are three distinct words',
      new Set([TOTAL_COLUMN_HEADINGS.sum, TOTAL_COLUMN_HEADINGS.closing, TOTAL_COLUMN_HEADINGS.mixed]).size === 3);
    check('P2: the P&L heading is unchanged', totalColumnHeading(pl) === 'Total');
    check('P2: a mixed table carries an explanatory note', totalColumnNote(cf).length > 0);
    check('P2: a pure-sum table carries none', totalColumnNote(pl) === '');
    // EVERY balance-sheet row must declare itself, or one stray summed row
    // silently downgrades the whole heading to "Total / Closing".
    check('P2: every valued balance-sheet row declares totalIsBalance',
      bs.filter((r) => !(r.isSection && r.values.length === 0)).every((r) => r.totalIsBalance === true));

    // Rendered documents.
    check('P2: full report balance sheet is headed Closing',
      headingAfter(full, 'Balance Sheet: Project') === TOTAL_COLUMN_HEADINGS.closing, headingAfter(full, 'Balance Sheet: Project'));
    check('P2: full report cash flow is headed Total / Closing',
      headingAfter(full, 'Cash Flow, Direct Method: Project') === TOTAL_COLUMN_HEADINGS.mixed, headingAfter(full, 'Cash Flow, Direct Method: Project'));
    check('P2: full report P&L is still headed Total',
      headingAfter(full, `${getFinancialLabels(state.project).incomeStatementTitle}: Project`) === TOTAL_COLUMN_HEADINGS.sum);
    check('P2: summary balance sheet is headed Closing',
      headingAfter(summary, 'Balance Sheet (summary)') === TOTAL_COLUMN_HEADINGS.closing, headingAfter(summary, 'Balance Sheet (summary)'));
    check('P2: summary cash flow is headed Total / Closing',
      headingAfter(summary, 'Cash Flow (summary)') === TOTAL_COLUMN_HEADINGS.mixed, headingAfter(summary, 'Cash Flow (summary)'));
    check('P2: summary P&L is still headed Total',
      headingAfter(summary, 'Profit & Loss (summary)') === TOTAL_COLUMN_HEADINGS.sum);
    // The workbook writes the heading once per sheet, at D4.
    const d4 = (name: string): string => cellText(wb.getWorksheet(name)?.getCell(4, 4).value);
    check('P2: workbook Balance Sheet D4 is Closing', d4('Balance Sheet') === TOTAL_COLUMN_HEADINGS.closing, d4('Balance Sheet'));
    check('P2: workbook Cash Flow D4 is Total / Closing', d4('Cash Flow') === TOTAL_COLUMN_HEADINGS.mixed, d4('Cash Flow'));
    check('P2: workbook Schedules D4 is Total / Closing', d4('Schedules') === TOTAL_COLUMN_HEADINGS.mixed, d4('Schedules'));
    check('P2: workbook P&L D4 is unchanged', d4('P&L') === TOTAL_COLUMN_HEADINGS.sum, d4('P&L'));
    check('P2: workbook Revenue D4 is unchanged', d4('Revenue') === TOTAL_COLUMN_HEADINGS.sum, d4('Revenue'));
  }

  // ── P3: a structural zero says so ─────────────────────────────────────────
  console.log('\n-- P3: structural zeros are marked and footnoted --');
  {
    const notes = buildAssetNotes(state, money);
    const ex = state.assets.find((a: any) => a.id === 'EX1');
    const co = state.assets.find((a: any) => a.id === 'CO1');
    const normal = state.assets.find((a: any) => a.id === 'R1');
    check('P3: an existing operational asset is detected', structuralZeroKindFor(ex) === 'existing_operations');
    check('P3: a companion is detected', structuralZeroKindFor(co) === 'companion');
    check('P3: an ordinary asset is NOT', structuralZeroKindFor(normal) === null);
    // The detection must be on the DECLARED shape. An asset with no historical
    // spend and no companion flag is just an empty asset and must stay one.
    check('P3: "operational" alone does not qualify without historical spend',
      structuralZeroKindFor({ ...ex, historicalPreCapex: 0 } as any) === null);
    check('P3: a real figure is never suppressed', notes.hasBuaNote('EX1', 12_000) === null);
    check('P3: a zero on a structural asset IS marked', notes.hasBuaNote('EX1', 0) !== null);
    check('P3: a zero on an ordinary asset is NOT marked', notes.hasBuaNote('R1', 0) === null);
    // Read through optionals deliberately: a sabotage that stops detecting
    // structural zeros must make this file FAIL, not crash on a bang. A crash
    // still stops a bad build, but it hides which checks would have caught it.
    const zEx = notes.byAssetId.get('EX1') ?? null;
    const zCo = notes.byAssetId.get('CO1') ?? null;
    check('P3: the marked cell is a dash carrying a footnote marker',
      zEx !== null && /^- \[[a-z]\]$/.test(structuralZeroCell(zEx)),
      zEx ? structuralZeroCell(zEx) : 'no marker built');
    check('P3: the two reasons get DIFFERENT markers',
      zEx !== null && zCo !== null && zEx.marker !== zCo.marker);
    check('P3: the companion footnote names its parent', !!zCo?.reason.includes('Residences'));
    check('P3: the existing-asset footnote quotes the historical spend',
      !!zEx?.reason.includes(money(800_000_000)));
    {
      // takeFootnotes must report only what a table actually raised, or a note
      // appears under a table explaining a marker that is not in it.
      const n2 = buildAssetNotes(state, money);
      n2.hasBuaNote('EX1', 0);
      const raised = n2.takeFootnotes();
      check('P3: only the raised footnote is returned',
        raised.length === 1 && raised[0].marker === n2.byAssetId.get('EX1')?.marker);
      check('P3: the tally resets for the next table', n2.takeFootnotes().length === 0);
      check('P3: the project can still raise both', n2.allFootnotes.length === 2, String(n2.allFootnotes.length));
    }
    for (const [doc, txt] of [['full report', full], ['summary', summary]] as const) {
      check(`P3: the ${doc} composition table marks the zero`, txt.includes('- [a]') || txt.includes('- [b]'));
      check(`P3: the ${doc} carries the existing-operations footnote`, flat(txt).includes('Existing operational asset: there is no new build'));
      check(`P3: the ${doc} carries the companion footnote`, flat(txt).includes('Companion asset: it runs a second strategy'));
    }
    check('P3: the full report marks per-asset economics too',
      flat(full).includes('Per-Asset Economics'));
    const retCol = sheetCol(wb.getWorksheet('Returns')!, 1);
    check('P3: the workbook carries both footnotes on Returns',
      retCol.some((v) => v.includes('Existing operational asset')) && retCol.some((v) => v.includes('Companion asset')));
    const laCol = sheetCol(wb.getWorksheet('Land & Area')!, 1);
    check('P3: the workbook Land & Area names its nil-area assets',
      laCol.some((v) => v.includes('Assets reporting nil built-up area')));
    check('P3: and lists them by name with their marker',
      laCol.some((v) => /Legacy Hotel \[[a-z]\]/.test(v)) && laCol.some((v) => /Residences - Operate \[[a-z]\]/.test(v)));
  }

  // ── P4: capital is not a fee ──────────────────────────────────────────────
  console.log('\n-- P4: the capital bases are their own block --');
  {
    const capital = buildFundCapitalRows(snap);
    check('P4: the fixture resolves three capital bases', capital.length === 3, String(capital.length));
    check('P4: equity + debt reconciles to the fund size',
      Math.abs(capital[0].amount + capital[1].amount - capital[2].amount) < 0.01);
    check('P4: the title and note are shared constants',
      FUND_CAPITAL_BASES_TITLE.length > 0 && FUND_CAPITAL_BASES_NOTE.includes('not fees'));
    for (const [doc, txt] of [['full report', full], ['summary', summary]] as const) {
      check(`P4: the ${doc} has a captioned capital-bases table`, flat(txt).includes(flat(FUND_CAPITAL_BASES_TITLE)));
      check(`P4: the ${doc} explains they are not fees`, flat(txt).includes('amounts of CAPITAL, not fees'));
    }
    // In the workbook the capital rows must sit ABOVE the fee basis block, in
    // their own captioned section, with the tag in the Base column. Before the
    // fix they were the first three rows of the fee table with Base empty.
    for (const sheet of ['Returns', 'P&L']) {
      const ws = wb.getWorksheet(sheet)!;
      const labels = sheetCol(ws, 1);
      const capRow = labels.findIndex((v) => v.includes(FUND_CAPITAL_BASES_TITLE));
      // The first fee row, found by its ": basis" / ": charged" suffix rather
      // than by the block caption: the capital-bases title itself ends in
      // "charged on", so a caption match found the same row twice.
      const feeRow = labels.findIndex((v) => /:\s*(basis|charged)$/.test(v.trim()));
      check(`P4: ${sheet} has the capital-bases caption`, capRow >= 0);
      check(`P4: ${sheet} puts it ABOVE the fee basis block`, capRow >= 0 && feeRow > capRow, `cap=${capRow} fee=${feeRow}`);
      let tagged = 0;
      ws.eachRow((rw) => {
        const a = cellText(rw.getCell(1).value).trim().replace(/^=\s*/, '');
        if (capital.some((c) => c.label === a) && cellText(rw.getCell(2).value) === FUND_CAPITAL_BASE_TAG) tagged++;
      });
      check(`P4: ${sheet} tags all three capital rows in the Base column`, tagged === 3, String(tagged));
      check(`P4: ${sheet} carries the not-a-fee note`, sheetCol(ws, 1).some((v) => v.includes('amounts of CAPITAL, not fees')));
    }
    // And the fee basis table itself must no longer contain a capital label,
    // which is the whole finding.
    const feeBasisRowsInPdf = full.split('\n');
    const feeIdx = feeBasisRowsInPdf.findIndex((l) => l.includes('Fund Fee Basis (what each fee is charged on)'));
    const window = feeBasisRowsInPdf.slice(feeIdx, feeIdx + 12).map((l) => l.trim());
    check('P4: no capital label opens the fee basis table',
      feeIdx >= 0 && !window.includes('Total equity') && !window.includes('= Fund size'),
      window.slice(0, 10).join(' | '));
  }

  // ── P5: one metric, stated once per view ──────────────────────────────────
  console.log('\n-- P5: Distributed Equity is not restated three times --');
  {
    const restated = fundHeadlineRestatementNote(ctx);
    check('P5: the fund block says it is a restatement', flat(restated).includes('SAME Distributed Equity IRR and MOIC'));
    check('P5: it names the split', flat(restated).includes('before the performance fee'));
    check('P5: it is EMPTY on a standalone project', fundHeadlineRestatementNote(fundCtx(fixture({ fund: false }))) === '');
    const cardHits = (txt: string): number => txt.split('\n').filter((l) => /^DISTRIBUTED EQUITY (IRR|MOIC)$/.test(l.trim())).length;
    check('P5: the summary carries the card pair ONCE, not twice', cardHits(summary) === 2, `${cardHits(summary)} card lines (2 = one IRR + one MOIC)`);
    check('P5: the summary returns page points at where they are',
      flat(summary).includes('are reported in the Executive Summary'));
    check('P5: the summary still reports the figures somewhere', /DISTRIBUTED EQUITY IRR/.test(summary));
    check('P5: the fund page keeps its gross / net split',
      summary.includes('DISTRIBUTED EQUITY IRR (GROSS)') && summary.includes('DISTRIBUTED EQUITY IRR (NET)'));
  }

  // ── P6: fund toggle OFF is untouched by the fund-only changes ─────────────
  console.log('\n-- P6: fund off carries no fund content --');
  {
    const off = fixture({ fund: false });
    const offCommon = { state: off, projectName: 'Riverside Mixed-Use', dateLabel: '13 August 2026', displayScale: 'millions' } as any;
    const offFull = decode(await generateProjectPdf({ ...offCommon, selectedModuleKeys: MODULE_KEYS }));
    const offSummary = decode(await generateSummaryPdf({ ...offCommon, selectedModuleKeys: [] }));
    // Populated but DISABLED must be byte-identical to fund terms absent: the
    // standing invariant, re-proved here because this pass touched the block.
    const disabled = fixture();
    disabled.project.fundTerms = { ...TERMS, enabled: false };
    const disCommon = { state: disabled, projectName: 'Riverside Mixed-Use', dateLabel: '13 August 2026', displayScale: 'millions' } as any;
    const disFull = decode(await generateProjectPdf({ ...disCommon, selectedModuleKeys: MODULE_KEYS }));
    const disSummary = decode(await generateSummaryPdf({ ...disCommon, selectedModuleKeys: [] }));
    check('P6: absent vs populated-but-disabled are identical (full)', offFull === disFull);
    check('P6: absent vs populated-but-disabled are identical (summary)', offSummary === disSummary);
    for (const [doc, txt] of [['full report', offFull], ['summary', offSummary]] as const) {
      check(`P6: ${doc} has no waterfall totals note`, !txt.includes('flow rows are LIFETIME totals'));
      check(`P6: ${doc} has no capital-bases block`, !flat(txt).includes(flat(FUND_CAPITAL_BASES_TITLE)));
      check(`P6: ${doc} has no restatement note`, !flat(txt).includes('SAME Distributed Equity IRR and MOIC'));
    }
    const offWb = buildModelWorkbook({ state: off, projectName: 'Riverside Mixed-Use', dateLabel: '13 August 2026' } as any);
    const offReturns = sheetCol(offWb.getWorksheet('Returns')!, 1).join('\n');
    check('P6: the workbook Returns tab carries no fund note',
      !offReturns.includes('flow rows are LIFETIME totals') && !offReturns.includes(FUND_CAPITAL_BASES_TITLE));
    // The NON-fund changes must still apply with the fund off, or the fix only
    // half landed: the balance-sheet heading is not a fund feature.
    check('P6: the balance-sheet heading still reads Closing with the fund off',
      cellText(offWb.getWorksheet('Balance Sheet')?.getCell(4, 4).value) === TOTAL_COLUMN_HEADINGS.closing);
    check('P6: the structural-zero footnotes still render with the fund off',
      flat(offFull).includes('Companion asset: it runs a second strategy'));
  }

  // ── House style ──────────────────────────────────────────────────────────
  console.log('\n-- House style --');
  for (const f of [
    'src/hubs/modeling/platforms/refm/lib/reports/assetNotes.ts',
    'src/hubs/modeling/platforms/refm/lib/reports/fundReports.ts',
    'src/hubs/modeling/platforms/refm/lib/reports/m4Reports.ts',
    'scripts/verify-report-presentation.ts',
  ]) {
    // The character is built from its codepoint, not written literally: a
    // literal one here would make this file fail its own check.
    check(`no em dash in ${f.split('/').pop()}`, !readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
