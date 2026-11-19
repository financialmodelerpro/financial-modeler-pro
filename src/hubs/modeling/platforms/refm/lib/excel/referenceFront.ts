/**
 * referenceFront.ts (2026-11-17, founder: "make the export match the reference file exactly": the Cover, the Guide
 * and the Dashboard)
 *
 * THE FRONT TABS OF BOTH WORKBOOKS, after the reference layout (referenceLayout.ts):
 *   - the Guide, seven numbered sections in the reference's words (colours with samples, what the model does with
 *     its purpose and time frame by formula, before you start, the model map with links and the flow, reading the
 *     results, the links that read a later tab, troubleshooting), its "Before you start" in the values file's own
 *     words (no iterative calculation);
 *   - the Dashboard in place of the Summary (dashboard.ts);
 *   - the Cover's quick navigation, one row per tab with its one line, as the Guide's model map says it.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { FormulaEvaluator, workbookReader } from './formulaEval';
import { buildDashboard, type ChartSpec } from './dashboard';
import { splitInputs, PROJECT_INPUTS, type SplitResult } from './splitInputs';

const NAVY = 'FF153D64', BAR = 'FF1B4F8A', INK = 'FF2A3440', GREY = 'FF6B7785', WHITE = 'FFFFFFFF', LINK = 'FF0563C1';

/** One line per tab, the Guide's model map and the Cover's quick navigation alike. */
export const TAB_LINES: ReadonlyArray<[string, string]> = [
  ['Dashboard', 'The investment case on three pages: headline returns, key messages, assumptions, risk flags, economics, funding, scenarios and charts.'],
  ['Inputs', "Every number you can change, in the platform's module order."],
  ['Project Inputs', 'Every project input: timeline, land and plots, types and build rates, costs and phasing, funding, %TAX% and depreciation, exit and fund terms.'],
  ['Operating Inputs', 'Every operating input: residential sales, hospitality and retail operations, working capital.'],
  ['Timeline', "Model years, each phase's dates, the programme bar and the year flags every tab reads."],
  ['Land & Area', 'Land, plots and the area chain: GFA, NSA, units, keys and parking for each plot and line.'],
  ['Revenue', 'Sales and collections for each sell line; occupancy, rate and revenue for the hotel and lease lines; selling costs.'],
  ['Capex', 'Development cost for each asset: rate x quantity x spend share x escalation, by year, and the capex summary.'],
  ['Opex', 'Operating costs for the hotel and lease lines, and EBITDA by line.'],
  ['Financing', 'Funding need, debt and equity, interest and capitalised interest, %TAX%, fund fees and the cash waterfall.'],
  ['Fixed Assets & Inventory', 'Fixed assets and depreciation for each held asset; cost of sales and inventory for each sell line.'],
  ['P&L', 'Revenue to profit after %TAX% for the project, and each phase to EBITDA.'],
  ['Cash Flow', 'Cash in and out by the direct method; opening and closing cash.'],
  ['Balance Sheet', 'Year-end balances and the equity roll-forward; the balance check must read zero.'],
  ['Returns', 'Exit value; FCFF, FCFE and distributions with IRR, MOIC and NPV; the performance fee; partners; sources and uses; key metrics.'],
  ['Scenarios', 'Cases, the assumptions that differ, the comparison, the sensitivity grid and exit years (platform results).'],
  ['Checks', "The model's own reconciliations: OK, NOTE or CHECK."],
];
const COVER_FIRST: ReadonlyArray<[string, string]> = [
  ['Guide', 'How to read the workbook: colours, flow, glossary and troubleshooting'],
  ['Dashboard', 'The investment case on three pages: the decision, the economics and the detail.'],
];

export interface FrontContext {
  valuesOutput: boolean;
  /** A hardcoded twin of a live file splits Inputs as that file did (splitInputs `readFrom`). */
  splitReadFrom?: ExcelJS.Workbook;
  scale: 'full' | 'thousands' | 'millions';
  /**
   * The values fallback only (a project the live workbook does not build for, such as one with no asset yet): a
   * Dashboard that has nothing to read says so instead of failing the file. The live build never sets it.
   */
  emptyDashboardIfUnreadable?: boolean;
}

const txt = (c: ExcelJS.Cell): string => (typeof c.value === 'string' ? c.value.trim() : '');

function taxWord(wb: ExcelJS.Workbook): 'zakat' | 'tax' {
  let zakat = false;
  wb.getWorksheet('P&L')?.eachRow((row) => row.eachCell((c) => { if (/PROFIT AFTER ZAKAT/.test(String(c.value ?? ''))) zakat = true; }));
  return zakat ? 'zakat' : 'tax';
}
function currencyOf(wb: ExcelJS.Workbook): string {
  const ws = wb.getWorksheet('Inputs') ?? wb.getWorksheet(PROJECT_INPUTS);
  let ccy = 'USD';
  ws?.eachRow((row) => { if (txt(row.getCell(3)) === 'Currency' && typeof row.getCell(4).value === 'string') ccy = String(row.getCell(4).value); });
  return ccy;
}

/** Replaces a tab with an empty one at the same place in the tab order. */
function freshSheet(wb: ExcelJS.Workbook, name: string, replaces?: string): ExcelJS.Worksheet {
  const old = wb.getWorksheet(replaces ?? name);
  const order = old ? (old as unknown as { orderNo: number }).orderNo : wb.worksheets.length;
  if (old) wb.removeWorksheet(old.id);
  const ws = wb.addWorksheet(name);
  (ws as unknown as { orderNo: number }).orderNo = order;
  return ws;
}

export function buildFrontTabs(wb: ExcelJS.Workbook, ctx: FrontContext): { charts: ChartSpec[]; split: SplitResult | null } {
  const tax = taxWord(wb);
  const ccy = currencyOf(wb);
  // NOTHING READS THE SUMMARY: it goes, the Dashboard takes its place.
  for (const ws of wb.worksheets) {
    if (ws.name === 'Summary') continue;
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string } | null;
      if (v && typeof v === 'object' && typeof v.formula === 'string' && /(^|[^A-Za-z])Summary!/.test(v.formula)) throw new Error(`front tabs: ${ws.name}!${c.address} reads the Summary, which the Dashboard replaces`);
    }));
  }
  freshSheet(wb, 'Dashboard', 'Summary');
  let charts: ChartSpec[] = [];
  try { charts = buildDashboard(wb, { currency: ccy, scale: ctx.scale }).charts; }
  catch (e) {
    if (!ctx.emptyDashboardIfUnreadable) throw e;
    emptyDashboard(freshSheet(wb, 'Dashboard'));
  }
  // TWO INPUT TABS (2026-11-18, founder item 5): the Dashboard is built on Inputs and follows its cells; the Guide
  // and the Cover are built after, on the two tabs.
  const split = splitInputs(wb, { readFrom: ctx.splitReadFrom });
  buildGuide(freshSheet(wb, 'Guide'), wb, ctx, tax);
  if (split) renameInputsInProse(wb.getWorksheet('Guide'));
  // A GRID CELL OUTSIDE ITS PHASE IS AN EMPTY GREY CELL, NOT THE TEXT "n/a" (2026-11-19, founder C16).
  for (const n of ['Project Inputs', 'Operating Inputs']) {
    const ws = wb.getWorksheet(n);
    if (ws) ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string' && c.value.trim().toLowerCase() === 'n/a') c.value = null; }));
  }
  // THE INPUT CHECKS COUNT TOO (2026-11-19, founder C5): a typed grid that does not add to 100% reads CHECK on its
  // input tab, and the Dashboard's count of failing checks includes them.
  {
    const dash = wb.getWorksheet('Dashboard');
    // The check cells themselves (a formula that can read "CHECK"), never a range: COUNTIF ignores case, so a
    // "Check" column head would count.
    const cells: string[] = [];
    for (const n of ['Project Inputs', 'Operating Inputs']) {
      const ws = wb.getWorksheet(n);
      if (ws) ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && typeof v.formula === 'string' && v.formula.includes('"CHECK"')) cells.push(`('${n}'!$${ws.getColumn(c.col).letter}$${c.row}="CHECK")`); }));
    }
    const inTabs = cells;
    if (dash && inTabs.length) dash.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string' || !v.formula.includes('"CHECK")')) return;
      const f = v.formula.replace(/COUNTIF\((Checks!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+),"CHECK"\)/g, (_m, rng: string) => `(COUNTIF(${rng},"CHECK")+${cells.join('+')})`);
      if (f !== v.formula) c.value = { ...v, formula: f } as ExcelJS.CellValue;
    }));
  }
  restyleCover(wb, tax);
  for (const name of ['Cover', 'Guide', 'Dashboard']) { const ws = wb.getWorksheet(name); if (ws) plainMergedCells(ws); }
  return { charts, split };
}

/** The Guide's sentences name the two input tabs once Inputs is split (2026-11-18). */
function renameInputsInProse(ws: ExcelJS.Worksheet | undefined): void {
  if (!ws) return;
  const swaps: Array<[RegExp, string]> = [
    [/yellow cells on Inputs/g, 'yellow cells on Project Inputs and Operating Inputs'],
    [/^Inputs {2}->/g, 'Project Inputs, Operating Inputs  ->'],
    [/terms on Inputs/g, 'terms on Operating Inputs'],
    [/covenant on Inputs/g, 'covenant on Project Inputs'],
    [/on Inputs/g, 'on Project Inputs'],
  ];
  ws.eachRow((row) => row.eachCell((c) => {
    if (typeof c.value !== 'string') return;
    let s = c.value; for (const [re, to] of swaps) s = s.replace(re, to);
    if (s !== c.value) c.value = s;
  }));
}

/**
 * A merged range shows its first cell; the cells it covers hold no style of their own (ExcelJS copies the first
 * cell's style onto them when it merges), as the reference has them.
 */
function plainMergedCells(ws: ExcelJS.Worksheet): void {
  const merges = (ws as unknown as { _merges: Record<string, { model?: { top: number; left: number; bottom: number; right: number } }> })._merges;
  for (const m of Object.values(merges)) {
    const g = m.model; if (!g) continue;
    for (let r = g.top; r <= g.bottom; r++) for (let c = g.left; c <= g.right; c++) {
      if (r === g.top && c === g.left) continue;
      // A total row's lines run under the whole merge.
      const b = ws.getCell(r, c).border;
      ws.getCell(r, c).style = b && (b.top || b.bottom) ? { border: JSON.parse(JSON.stringify(b)) } : {};
    }
  }
}

/** A project with nothing for the Dashboard to read (no asset yet): the tab says so, in the house look. */
function emptyDashboard(ws: ExcelJS.Worksheet): void {
  ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
  [1.5, 1.5, 36].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const title = String(ws.workbook.getWorksheet('Cover')?.getCell('C2').value ?? '');
  const t = ws.getCell(1, 2); t.value = { formula: 'Cover!C2', result: title } as ExcelJS.CellValue;
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: NAVY } };
  ws.getCell(2, 2).value = 'Dashboard'; ws.getCell(2, 2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: BAR } };
  ws.getCell(3, 2).value = 'Nothing to show yet: the project has no asset to value. Add one on the platform and export again.';
  ws.getCell(3, 2).font = { name: 'Calibri', size: 9, italic: true, color: { argb: GREY } };
}

// ── The Guide ─────────────────────────────────────────────────────────────────────────────────────────────────────
function buildGuide(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, ctx: FrontContext, tax: 'zakat' | 'tax'): void {
  const ev = new FormulaEvaluator(workbookReader(wb));
  [1.5, 1.5, 30, 14, 14, 14, 14, 14, 14, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
  ws.properties.tabColor = { argb: BAR };
  const f = (size: number, color: string, bold = false, italic = false): Partial<ExcelJS.Font> => ({ name: 'Calibri', size, bold: bold || undefined, italic: italic || undefined, color: { argb: color } });
  const formula = (cell: ExcelJS.Cell, fx: string, own = 'Guide'): void => {
    const res = ev.evaluate(fx, own);
    cell.value = { formula: fx, result: res === null || typeof res === 'object' ? '' : res } as ExcelJS.CellValue;
  };
  formula(ws.getCell(1, 2), 'Cover!C2'); ws.getCell(1, 2).font = f(14, NAVY, true);
  const back = ws.getCell(1, 11); back.value = { text: '<- Back to Cover', hyperlink: "#'Cover'!A1" } as ExcelJS.CellValue;
  back.font = { ...f(9, LINK), underline: true }; back.alignment = { horizontal: 'right' };
  ws.getCell(2, 2).value = 'Guide'; ws.getCell(2, 2).font = f(11, BAR, true);
  ws.getCell(3, 2).value = 'How to read and use this workbook: the colours, the tabs, the flow and what to do when something looks wrong';
  ws.getCell(3, 2).font = f(9, GREY, false, true);

  let r = 5, n = 0;
  const bar = (text: string): void => {
    for (let c = 2; c <= 11; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } };
    const c = ws.getCell(r, 2); c.value = `${++n}. ${text}`; c.font = f(10, WHITE, true);
    ws.getRow(r).height = 18; r++;
  };
  const line = (label: string | ExcelJS.CellValue, text: string | { formula: string }, opts: { labelFont?: Partial<ExcelJS.Font>; labelFill?: string; border?: Partial<ExcelJS.Borders>; height?: number } = {}): void => {
    const a = ws.getCell(r, 3); a.value = label as ExcelJS.CellValue;
    a.font = opts.labelFont ?? f(9, INK, true); a.alignment = { vertical: 'middle', indent: 1 };
    if (opts.labelFill) a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.labelFill } };
    if (opts.border) a.border = opts.border;
    const d = ws.getCell(r, 4);
    if (typeof text === 'string') d.value = text; else formula(d, text.formula);
    d.font = f(9, INK); d.alignment = { vertical: 'middle', wrapText: true };
    ws.mergeCells(r, 4, r, 11);
    const len = typeof text === 'string' ? text.length : String((d.value as { result?: unknown }).result ?? '').length;
    ws.getRow(r).height = opts.height ?? (len > 120 ? 27 : 15);
    r++;
  };
  const thin = { style: 'thin' as const, color: { argb: NAVY } };

  bar('Colours: what each style means (read first)');
  line('Input', 'Yellow fill, blue text. The only cells you type in. Every tab recalculates from them.', { labelFont: f(9, 'FF0000FF', true), labelFill: 'FFFFF2CC' });
  line('Link from another tab', 'Green text. Reads a figure from another tab. Change the source, not this cell.', { labelFont: f(9, 'FF2E8B3A', true) });
  line('Calculation', 'Black text. A formula on this tab. Do not type over it.', { labelFont: f(9, INK, true) });
  line('Column header', 'Navy row with white text: the line, input, total and year columns at the top of each tab.', { labelFont: f(9, WHITE, true), labelFill: NAVY });
  line('Section band', 'Blue row with white text, numbered. Starts a group of related lines; a blank row sits above each one.', { labelFont: f(9, WHITE, true), labelFill: BAR });
  line('Subtotal', 'Grey row, bold. Adds up the lines above it within a section.', { labelFont: f(9, INK, true), labelFill: 'FFD9D9D9', border: { top: thin } });
  line('KEY TOTAL', 'Capitals, navy on pale blue with lines above and below. A figure the statements and returns are built on.', { labelFont: f(9, NAVY, true), labelFill: 'FFDDE7F3', border: { top: thin, bottom: thin } });
  line('Check status', 'On the Checks tab: OK holds, NOTE advises, CHECK fails and must be fixed before using any number.', { labelFont: f(9, INK, true) });
  line('Note', 'Small grey italic text. Guidance only; not used in any calculation.', { labelFont: f(9, GREY, false, true) });
  r++;

  bar('What this model does');
  const inputs = (wb.getWorksheet('Inputs') ?? wb.getWorksheet(PROJECT_INPUTS))!;
  const INP = inputs.name === 'Inputs' ? 'Inputs' : `'${inputs.name}'`;
  // The split tabs read label, unit, value: the value is in E (2026-11-19).
  const VC = inputs.name === 'Inputs' ? 'D' : 'E';
  let nameRow = 0, locRow = 0;
  inputs.eachRow((row, rr) => { const t = txt(row.getCell(3)); if (t === 'Project Name' && !nameRow) nameRow = rr; if (t === 'Location' && !locRow) locRow = rr; });
  const tl = wb.getWorksheet('Timeline')!;
  let fy = 0, ly = 0, ny = 0;
  tl.eachRow((row, rr) => { const t = txt(row.getCell(3)); if (t === 'First model year') fy = rr; if (t === 'Last model year') ly = rr; if (t === 'Model years') ny = rr; });
  line('Purpose', { formula: `"A development, sales, operating, financing and exit model for "&${INP}!${VC}${nameRow}&" in "&${INP}!${VC}${locRow}&", built on Financial Modeler Pro and exported with ${ctx.valuesOutput ? 'its values' : 'live formulas'}."` }, { height: 27 });
  line('Time frame', { formula: `"Annual model, "&Timeline!$F$${fy}&" to "&Timeline!$F$${ly}&" ("&Timeline!$F$${ny}&" years), one column per year ending in December. The Opening column holds balances before the first year."` }, { height: 27 });
  line('Scheme', 'Land and plots, then GFA, NSA, units and keys for each line; each line is sold, operated (hotel) or leased (retail).');
  line('Methods', `Area chain from land, off-plan sales with instalments and revenue at handover, hotel P&L to EBITDA, leasing to NOI, cost-based capex with spend curves, funding sized on the cash short of the minimum, a cash sweep, ${tax}, and an exit at a cap rate.`, { height: 27 });
  line('Outputs', 'The Dashboard: development margin, funding, project and equity IRR, investor returns after the performance fee, covenant tests, risk flags, scenarios and sensitivity.', { height: 27 });
  r++;

  bar('Before you start');
  const unit = ctx.scale === 'millions' ? 'millions' : ctx.scale === 'thousands' ? 'thousands' : 'full units';
  const ccy = currencyOf(wb);
  line('Save a copy', 'Keep the exported file untouched and work in a copy.');
  if (ctx.valuesOutput) line('Values, not formulas', 'This file holds the platform\'s results as values: nothing recalculates and no iterative calculation is needed. Change an input on the platform and export again.', { height: 27 });
  // NO CIRCULAR REFERENCE (2026-11-18): the switch and the iteration it needed are gone.
  else line('No circular reference', 'Leave iterative calculation off (File > Options > Formulas). Interest reads the opening debt and half the draw of the year, so nothing in the model reads itself, and Excel would report any loop.', { height: 27 });
  line('Units', `Figures show in the unit chosen at export (here ${ccy}${ctx.scale === 'full' ? '' : ` ${unit}`}). Cells hold full values, so nothing is rounded inside the model.`, { height: 27 });
  line('What to change', ctx.valuesOutput ? 'Nothing here: every figure is a value. Change the project on the platform and export again.' : 'Only the yellow cells on Inputs (the Dashboard\'s risk-flag triggers included). Everything else is a formula.');
  line('Do not', 'Insert or delete columns in the year area, type over black or green cells, or rename tabs.');
  line('Checks', 'The Checks tab must read ALL OK before you use any number. The Dashboard shows the same status at the top.');
  r++;

  // PRINTED ON TWO PAGES (2026-11-17, founder): the colours, the model and before you start on page 1; the model map
  // onward on page 2 (fitted to the width and to two pages tall, below).
  ws.getRow(r - 1).addPageBreak();
  bar('Model map');
  for (const [tab, text] of TAB_LINES) {
    if (!wb.getWorksheet(tab)) continue;
    const t = text.replace(/%TAX%/g, tax);
    line({ text: tab, hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` } as ExcelJS.CellValue, t, { labelFont: { ...f(9, LINK, true), underline: true }, height: t.length > 120 ? 27 : 15 });
  }
  line('Flow', 'Inputs  ->  Timeline  ->  Land & Area  ->  Revenue, Capex, Opex  ->  Financing  ->  Fixed Assets & Inventory  ->  P&L, Cash Flow, Balance Sheet  ->  Returns  ->  Dashboard', { height: 27 });
  r++;

  bar('Reading the results');
  line('FCFF', 'Project cash flow before any financing. Gives the project IRR, MOIC and NPV.');
  line('FCFE', 'Cash flow to equity after debt drawn, interest and repayments. Gives the equity IRR.');
  // THE NPV CONVENTION (2026-11-18, founder): end of year, valued at the project start.
  line('Selling costs, cash', 'Marketing is paid as units are sold (a phase from 2026-11-18; older phases with collections). The sales commission is paid on each residential line terms on Inputs: a share on contract, in the sale year, and the rest with customer collections or at handover. It stays a contract cost on the Balance Sheet until the revenue is recognised.', { height: 27 });
  line('Exit settlement', 'In the exit year receivables are collected, payables paid and the year’s zakat paid, so the cash reaches the exit distribution and the Balance Sheet closes to zero; Checks proves it.', { height: 27 });
  line('NPV', 'End of year, valued at the project start: each model year is discounted by its full years, the first year once (as Excel NPV() from the first model year). The project NPV uses the discount rate; the equity NPVs use the cost of equity on Inputs.', { height: 27 });
  line('Distributions', 'What investors actually receive: dividends plus the exit value, before and after the performance fee.');
  line('Performance fee', "The manager's share of distributions above the hurdle return, worked out in the hurdle waterfall on Returns.");
  line('GDV and development profit', 'GDV is the residential sales value plus the gross exit value of the held assets. Development profit is GDV less the development cost, the capitalised interest (IDC) and the selling costs; the margin divides it by GDV, profit on cost by the cost plus IDC.', { height: 27 });
  line('Yield on cost', "Held assets' NOI in the stabilised year (every held asset at its top occupancy) divided by their cost including IDC. Below the exit cap rate typed, the assets are worth less than they cost.", { height: 27 });
  line('DSCR', 'Cash flow available for debt service (the cash from operations, after zakat) over the scheduled debt service (interest paid plus scheduled principal; the cash sweep is excluded), tested in operating years with debt outstanding. Construction years are not tested: their interest is funded.', { height: 27 });
  line('ICR', 'Project EBITDA (before the fund fees) over the interest charged, tested in operating years with debt outstanding.');
  line('LTV, debt yield', 'Loan to cost in a construction year (debt over the development cost to date including capitalised interest), loan to value after it (debt over the NOI of the held assets at the exit cap rate plus the unsold homes at the price of that year). Each test against its covenant on Inputs; the Dashboard shows the worst year.', { height: 27 });
  line('IDC, RETT, NSA, GFA', 'Capitalised interest during construction; real estate transfer tax; net saleable or leasable area; gross floor area.');
  r++;

  bar('Links that read a later tab');
  // FIXED ASSETS & INVENTORY COMES AFTER FINANCING (2026-11-19): its capitalised interest now flows forward; only the
  // cost per sqm on Capex reads Financing's IDC back.
  line('Capitalised interest', 'The cost per sqm on Capex (construction + IDC) reads it from Financing, which works it out from the opening debt and the draw of the year.');
  line('Retained earnings', 'The dividend cap on Financing reads the retained earnings available on the Balance Sheet (last year\'s retained earnings and this year\'s profit after tax), none of which reads this year\'s dividend.');
  line(tax === 'zakat' ? 'Zakat' : 'Tax', tax === 'zakat' ? '2.5% of profit before zakat, excluding the exit gain, worked out on the P&L; Financing reads the charge back for the cash.' : 'Worked out on the P&L; Financing reads the charge back for the cash.');
  r++;

  bar('Troubleshooting');
  line('A CHECK on Checks', 'Open the Checks tab, read the line that fails and fix the input it names.');
  line('Numbers look odd', ctx.valuesOutput ? 'Every figure is a value as of export. Change the project on the platform and export again.' : 'Press F9 to recalculate. If Excel reports a circular reference, a formula was typed over: undo, or re-export.');
  line('#VALUE! or #REF!', 'A formula was typed over or a row or column was deleted. Undo, or re-export from the platform.');
  line('Scenarios or sensitivity', 'These are platform results. Re-export after changing inputs to refresh them.');
  line('Different from the platform', 'The export matches the platform on the day it is made. Re-export after editing the project.');
  r++;

  for (let c = 2; c <= 11; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  const e = ws.getCell(r, 2); e.value = 'End of sheet'; e.font = f(9, WHITE, true);
  ws.pageSetup = { ...ws.pageSetup, orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 2, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } as ExcelJS.PageSetup;
}

// ── The Cover: quick navigation and footer as the reference has them ─────────────────────────────────────────────
function restyleCover(wb: ExcelJS.Workbook, tax: 'zakat' | 'tax'): void {
  const ws = wb.getWorksheet('Cover');
  if (!ws) return;
  // Find the navigation heading and clear everything under it.
  let nav = 0;
  ws.eachRow((row, r) => { if (txt(row.getCell(3)) === 'Quick navigation') nav = r; });
  if (!nav) return;
  for (const m of Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges)) {
    const mm = /^([A-Z]+)(\d+)$/.exec(m); if (mm && Number(mm[2]) > nav) ws.unMergeCells(m);
  }
  for (let r = nav + 1; r <= Math.max(ws.rowCount, nav + 40); r++) { const row = ws.getRow(r); row.height = undefined as never; for (let c = 1; c <= 8; c++) { const cell = row.getCell(c); cell.value = null; cell.style = {}; } }
  let r = nav + 1;
  const lines = [...COVER_FIRST, ...TAB_LINES.filter(([t]) => t !== 'Dashboard')];
  for (const [tab, text] of lines) {
    if (!wb.getWorksheet(tab)) continue;
    const a = ws.getCell(r, 3); a.value = { text: `-> Go to ${tab}`, hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` } as ExcelJS.CellValue;
    a.font = { name: 'Calibri', size: 9, underline: true, color: { argb: LINK } }; a.alignment = { vertical: 'middle' };
    ws.mergeCells(r, 4, r, 6);
    const b = ws.getCell(r, 4); b.value = text.replace(/%TAX%/g, tax); b.font = { name: 'Calibri', size: 9, color: { argb: INK } }; b.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 15;
    r++;
  }
  r++;
  for (const rr of [r, r + 1]) for (let c = 3; c <= 6; c++) ws.getCell(rr, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  // THE FOOTER IS READ ON ITS BAND (2026-11-17): the reference wrote it navy on navy, which cannot be read; it is
  // white, and the note pale, on the navy band (verify-export-vs-reference names this difference).
  const f1 = ws.getCell(r, 3); f1.value = 'Built with Financial Modeler Pro, financialmodelerpro.com'; f1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } };
  const f2 = ws.getCell(r + 1, 3); f2.value = 'The results depend on the inputs entered for this project: review them before relying on any figure.'; f2.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FFC9D6E5' } };
  // THE COVER PRINTS ON ONE PAGE (2026-11-17, founder): fitted to one page wide and one tall.
  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 1 } as ExcelJS.PageSetup;
  // Every link on the Cover opens its tab at A1.
  ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { text?: string; hyperlink?: string } | null; if (v && typeof v === 'object' && typeof v.hyperlink === 'string') c.value = { ...v, hyperlink: v.hyperlink.replace(/!\$?[A-Z]+\$?\d+$/, '!A1') } as ExcelJS.CellValue; }));
}
