/**
 * tabFrame.ts (2026-11-15, founder: export simplification step 2, the review of the step 2 files)
 *
 * THE FRAME EVERY TAB SHARES, the last step of both workbooks (after the house style), matched to
 * the founder's model (docs/FMP_Marina_Gate_Model.xlsx):
 *
 *   row 1  "FMP - <PROJECT> | <MODEL TYPE>", a link back to the Cover
 *   row 2  the tab's name, with "Back to Cover" beside it
 *   row 3  one line saying what the tab holds, with its unit
 *   row 4  the column heads and the years ("Opening" over the opening column)
 *   row 5  the phase of each year (Construction / Operations / Exit year) UNDER the years
 *
 * The period counter row (0 to N) and the empty dark bar under the old header go. A formula that read
 * a tab's own counter row now reads the one on Timeline (where it stays, as a body row), through
 * relayout.ts, which moves every cell and rewrites every reference. The "Basis / Calculation" column
 * becomes "Input" (about 12 wide) and holds only a row's own input (a rate, a share, a number of
 * years); a tab with no such input loses the column.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { Relayout, referencedCells, type SheetPlan } from './relayout';
import { HOUSE } from './houseStyle';

export interface FrameContext {
  projectName: string;
  modelType: string;
}

/** What each tab holds, one line (its unit is added from the tab's own units line). */
const DESCRIPTIONS: Record<string, string> = {
  Guide: 'The colours of the model and what each tab holds',
  Summary: 'Headline returns, development economics and cost per sqm',
  Inputs: 'Every input of the model, in the platform\'s module order',
  Timeline: 'Model years, phase dates and the year flags every tab reads',
  'Land & Area': 'Plots, areas by line, land values and sub-unit areas',
  Revenue: 'Sales, hotel and lease revenue, collections and selling costs',
  Capex: 'Development cost by cost line and year, and the capex summary',
  Opex: 'Operating expenses by line',
  Schedules: 'Fixed assets, depreciation, cost of sales and working capital',
  Financing: 'Funding need, debt, equity, interest and dividends',
  'P&L': 'Profit and loss, consolidated and by phase',
  'Cash Flow': 'Cash flow, direct method',
  'Balance Sheet': 'Balance sheet and the balance check',
  Returns: 'Free cash flows, distributions, returns and Sources and Uses',
  Scenarios: 'Cases, changed assumptions and the comparison',
  Checks: 'The model\'s reconciliations, each OK or CHECK',
};

/** The model type for the title line, from the categories the project's assets fall in. */
export function modelTypeOf(categories: string[]): string {
  const set = new Set(categories.map((c) => c.toLowerCase()));
  if (set.size > 1) return 'MIXED-USE DEVELOPMENT MODEL';
  const only = [...set][0] ?? '';
  if (only.startsWith('resid')) return 'RESIDENTIAL DEVELOPMENT MODEL';
  if (only.startsWith('hosp')) return 'HOSPITALITY DEVELOPMENT MODEL';
  if (only.startsWith('retail') || only.startsWith('comm')) return 'COMMERCIAL DEVELOPMENT MODEL';
  return 'REAL ESTATE DEVELOPMENT MODEL';
}

const isFormula = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const fillOf = (c: ExcelJS.Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
const yearOf = (c: ExcelJS.Cell): number | null => { const v = c.value as unknown; const n = isFormula(v) ? v.result : v; return typeof n === 'number' ? n : null; };

/** A tab whose rows run across the years: years in row 3 from column E, the counter row under them. */
function isPeriodSheet(ws: ExcelJS.Worksheet): boolean {
  return ws.getCell(3, 6).numFmt === '"Dec "0' && yearOf(ws.getCell(3, 6)) !== null;
}

function rowEmpty(ws: ExcelJS.Worksheet, r: number): boolean {
  let any = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== undefined && c.value !== '') any = true; });
  return !any;
}

/**
 * Where the frame moved each cell (2026-11-17, step 7): `move` takes a cell from before the frame to where
 * it is now (null when dropped), so a registry of addresses can follow its cells; `oldCol` takes a column
 * of the framed sheet back to the column it had before (a tab that lost its Input column B).
 */
export interface FrameMoves {
  move(sheet: string, r: number, c: number): { r: number; c: number } | null;
  oldCol(sheet: string, c: number): number;
  /** A column from before the frame to the column it is now (the dropped column B keeps its number). */
  newCol(sheet: string, c: number): number;
}

export function applyTabFrame(wb: ExcelJS.Workbook, ctx: FrameContext, mode: { values?: boolean } = {}): FrameMoves {
  const plans = new Map<string, SheetPlan>();
  const info = new Map<string, { period: boolean; unit: string; titleCol: number; dropB: boolean; inputCol: boolean; xSplit: number; ySplit: number; print?: string }>();
  const timeline = wb.getWorksheet('Timeline');
  const tlPeriod = !!timeline && isPeriodSheet(timeline);

  for (const ws of wb.worksheets) {
    if (ws.name === 'Cover') continue;
    const period = isPeriodSheet(ws);
    const a2 = ws.getCell(2, 1).value;
    const unit = typeof a2 === 'string' ? a2 : '';
    const titleCol = typeof ws.getCell(1, 1).value === 'string' ? 1 : 2;
    const v0 = ws.views?.[0] as { xSplit?: number; ySplit?: number } | undefined;

    // The Input column: only a row's own input stays; a tab with none loses the column.
    let dropB = false, inputCol = false;
    if (period && ws.getCell(4, 2).value === 'Basis / Calculation') {
      inputCol = true;
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        if (r < 5) return;
        const b = row.getCell(2);
        if (typeof b.value === 'string' && fillOf(row.getCell(1)) !== HOUSE.bar) b.value = null;
      });
      let keeps = false;
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        if (r < 5) return;
        const v = row.getCell(2).value as unknown;
        if (typeof v === 'number' || isFormula(v)) keeps = true;
      });
      if (!keeps) {
        dropB = true;
        // A heading left in the column is cleared with it.
        ws.eachRow({ includeEmpty: false }, (row, r) => { if (r >= 5) row.getCell(2).value = null; });
      }
    }
    const colMap = (c: number): number | null => (!dropB ? c : c === 2 ? null : c > 2 ? c - 1 : c);
    info.set(ws.name, { period, unit, titleCol, dropB, inputCol, xSplit: v0?.xSplit ?? 0, ySplit: v0?.ySplit ?? 0, print: ws.pageSetup?.printTitlesRow });

    // A RUN OF EMPTY ROWS KEEPS ONE (2026-11-15): a block taken out leaves no gap behind. emptyBefore[r]
    // counts the empty rows above r (from row 6) that go; an empty row maps to the next row kept.
    const lastRow = ws.rowCount;
    const gone = new Array<number>(lastRow + 2).fill(0);
    const drops = new Set<number>();
    for (let r = 6, prevEmpty = false; r <= lastRow; r++) {
      const e = rowEmpty(ws, r);
      if (e && prevEmpty) drops.add(r);
      prevEmpty = e;
      gone[r + 1] = gone[r] + (drops.has(r) ? 1 : 0);
    }
    const sq = (r: number): number => { let x = r; while (drops.has(x)) x++; return x - gone[Math.min(x, lastRow + 1)]; };
    if (period) {
      const isTl = ws.name === 'Timeline';
      // The empty row under the old header (a dark bar on some tabs, blank on others) goes.
      const darkBar = (!isTl || !!mode.values) && rowEmpty(ws, 5);
      const bodyShift = (r: number): number => (r >= 6 ? sq(r) : r) + (isTl && !mode.values ? 2 : 1 - (darkBar && r > 5 ? 1 : 0));
      const rowOf = (r: number): number | null => {
        if (r === 1 || r === 2) return null;
        if (r === 3) return 4;
        // The values file has no formula reading the counter, so Timeline drops it too.
        if (r === 4) return isTl && !mode.values ? 6 : null;
        if (r === 5 && darkBar) return null;
        return bodyShift(r);
      };
      plans.set(ws.name, {
        rowOf,
        colOf: colMap,
        map: (r, c) => {
          const cc = colMap(c); if (cc === null) return null;
          if (r === 1) return null;
          if (r === 2) return c >= 6 ? { r: 5, c: cc } : null;
          if (r === 3) return c >= 5 || isTl ? { r: 4, c: cc } : null;
          if (r === 4) return isTl ? (mode.values ? null : { r: 6, c: cc }) : c < 5 ? { r: 4, c: cc } : null;
          if (r === 5 && darkBar) return null;
          return { r: bodyShift(r), c: cc };
        },
        // A tab's counter row is Timeline's (each of its cells linked there): read it on Timeline.
        redirect: (r, c) => (r === 4 && c >= 5 && tlPeriod && !isTl ? { sheet: 'Timeline', r: 6, c } : null),
      });
    } else {
      plans.set(ws.name, {
        rowOf: (r) => (r <= 2 || drops.has(r) ? null : (r >= 6 ? sq(r) : r) + 1),
        colOf: (c) => c,
        map: (r, c) => (r <= 2 ? null : { r: (r >= 6 ? sq(r) : r) + 1, c }),
      });
    }
  }

  const relayout = new Relayout(wb, plans);
  relayout.run();
  const moves: FrameMoves = {
    move: (sheet, r, c) => relayout.moveCell(sheet, r, c),
    oldCol: (sheet, c) => (info.get(sheet)?.dropB && c >= 2 ? c + 1 : c),
    newCol: (sheet, c) => (info.get(sheet)?.dropB && c > 2 ? c - 1 : c),
  };

  const line = `${/^FMP\b/i.test(ctx.projectName) ? '' : 'FMP - '}${ctx.projectName} | ${ctx.modelType}`;
  for (const ws of wb.worksheets) {
    const inf = info.get(ws.name);
    if (!inf) continue;
    const tc = inf.titleCol;
    const t1 = ws.getCell(1, tc);
    t1.value = { text: line, hyperlink: "#'Cover'!A1" } as ExcelJS.CellValue;
    t1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: HOUSE.bar } };
    const t2 = ws.getCell(2, tc);
    t2.value = ws.name.toUpperCase();
    t2.font = { name: 'Calibri', size: 13, bold: true, color: { argb: HOUSE.band } };
    const back = ws.getCell(2, tc + 1);
    back.value = { text: '<- Back to Cover', hyperlink: "#'Cover'!A1" } as ExcelJS.CellValue;
    back.font = { name: 'Calibri', size: 9, underline: true, color: { argb: HOUSE.bar } };
    const desc = DESCRIPTIONS[ws.name] ?? '';
    const t3 = ws.getCell(3, tc);
    t3.value = [desc, inf.unit ? `(${inf.unit})` : ''].filter(Boolean).join(' ');
    t3.font = { name: 'Calibri', size: 9, italic: true, color: { argb: HOUSE.ink } };
    for (const r of [1, 2, 3]) ws.getRow(r).height = r === 2 ? 18 : undefined as never;

    if (inf.period) {
      // Row 4: the heads and the years, the opening column shown as "Opening".
      const row4 = ws.getRow(4);
      let last = 0;
      row4.eachCell({ includeEmpty: false }, (_c, col) => { last = Math.max(last, col); });
      const firstYearCol = inf.dropB ? 4 : 5;
      const open = ws.getCell(4, firstYearCol);
      if (yearOf(open) !== null) open.numFmt = '"Opening"';
      for (let c = 1; c <= last; c++) {
        const cell = ws.getCell(4, c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOUSE.band } };
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: HOUSE.white } };
        cell.border = {};
      }
      if (inf.inputCol && !inf.dropB) { ws.getCell(4, 2).value = 'Input'; ws.getColumn(2).width = 12; }
      // Row 5: the phase of each year, under the years.
      const a5 = ws.getCell(5, 1);
      a5.value = 'Phase';
      for (let c = 1; c <= last; c++) {
        const cell = ws.getCell(5, c);
        cell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: c === 1 ? HOUSE.slate : (cell.font?.color?.argb ?? HOUSE.calc) } };
        cell.border = { bottom: { style: 'medium', color: { argb: HOUSE.band } } };
        if (c > 1) cell.alignment = { horizontal: 'center' };
      }
      ws.getRow(4).height = undefined as never;
      ws.views = [{ state: 'frozen', xSplit: Math.max(0, inf.xSplit - (inf.dropB ? 1 : 0)), ySplit: 5, showGridLines: false } as ExcelJS.WorksheetView];
      ws.pageSetup = { ...ws.pageSetup, printTitlesRow: '1:5' };
    } else {
      if (inf.ySplit > 0) ws.views = [{ state: 'frozen', xSplit: inf.xSplit, ySplit: inf.ySplit + 1, showGridLines: false } as ExcelJS.WorksheetView];
      if (inf.print) ws.pageSetup = { ...ws.pageSetup, printTitlesRow: '1:3' };
    }
  }
  return moves;
}

/**
 * THE SUMMARY TILES ALWAYS READ IN MILLIONS, ONE DECIMAL (founder, 2026-11-15): a tile is narrow, so
 * a full-unit figure showed "###". A tile is a value under a bar-filled caption on the Summary.
 */
export function tilesInMillions(wb: ExcelJS.Workbook): void {
  const ws = wb.getWorksheet('Summary');
  if (!ws) return;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cap, col) => {
      // A tile caption starts with a letter: a column head such as "+ IDC" is upper case too (2026-11-17).
      if (typeof cap.value !== 'string' || cap.value !== cap.value.toUpperCase() || cap.value.length < 4 || !/^[A-Z]/.test(cap.value)) return;
      if (fillOf(cap) !== HOUSE.bar) return;
      const v = ws.getCell(r + 1, col);
      const n = yearOf(v);
      if (n === null) return;
      const fmt = String(v.numFmt ?? '');
      if (fmt.includes('%') || fmt.includes('x')) return;
      v.numFmt = '#,##0.0,,"m"';
    });
  });
}

/**
 * A TOTAL ONLY FOR A FLOW (2026-11-15, founder, workbook-wide): the Total column is left blank for a flag,
 * a factor, a rate, a percentage, an area, a price and a balance (opening, closing, outstanding); money,
 * room nights and sqm sold keep their total. A row is a balance where its Total is its last (or first)
 * year rather than the sum of the years. A Total any formula reads is kept. The Balance Sheet (every row a
 * balance, its column headed Closing) is left as it is.
 */
export function blankNonFlowTotals(wb: ExcelJS.Workbook): void {
  const read = referencedCells(wb);
  const val = (c: ExcelJS.Cell): number | null => { const v = c.value as unknown; const n = isFormula(v) ? v.result : v; return typeof n === 'number' ? n : null; };
  const FLOW = /sqm sold|room nights/i;
  const NOT_FLOW = /\(1 = yes\)|factor|opening|closing|balance|outstanding|year end|unsold|payable|receivable|unearned|velocity|occupancy|margin|rate\b|rent per sqm|per occupied|per available|\bADR\b|RevPAR|price|area let|lettable|\(sqm\)|year no|share of/i;
  for (const ws of wb.worksheets) {
    if (ws.name === 'Balance Sheet' || !isPeriodFramed(ws)) continue;
    let totalCol = 0, firstYear = 0;
    ws.getRow(4).eachCell({ includeEmpty: false }, (c, col) => {
      const t = typeof c.value === 'string' ? c.value : '';
      if (!totalCol && /^Total/.test(t)) totalCol = col;
      if (!firstYear && col > 2 && yearOf(c) !== null) firstYear = col;
    });
    if (!totalCol || !firstYear) continue;
    const yearCols: number[] = [];
    ws.getRow(4).eachCell({ includeEmpty: false }, (c, col) => { if (col > firstYear && yearOf(c) !== null) yearCols.push(col); });
    if (!yearCols.length) continue;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r < 6) return;
      const tc = row.getCell(totalCol);
      if (tc.value === null || tc.value === undefined) return;
      if (read.has(`${ws.name}!${r}:${totalCol}`)) return;
      const label = String(row.getCell(1).value ?? '');
      const years = yearCols.map((c) => val(row.getCell(c)));
      if (years.every((v) => v === null)) return; // a scalar: its value lives in the Total column
      if (FLOW.test(label)) return;
      const fmt = String(row.getCell(yearCols[0]).numFmt ?? '');
      const pctOrFactor = fmt.includes('%') || fmt === '0.000' || /0\.00(?!0)[^,]*$/.test(fmt.replace(/_\).*$/, '')) && !/,,|,"/.test(fmt);
      const f = tc.value as { formula?: string } | null;
      const lastOrFirst = !!f && typeof f === 'object' && typeof f.formula === 'string' && /^\$?[A-Z]{1,3}\$?\d+$/.test(f.formula.trim());
      const t = val(tc) ?? 0, sum = years.reduce((a: number, v) => a + (v ?? 0), 0), last = years[years.length - 1] ?? 0;
      const balanceByValue = !f && Math.abs(t - last) < 1e-6 * Math.max(1, Math.abs(t)) && Math.abs(t - sum) > 1e-6 * Math.max(1, Math.abs(t));
      if (NOT_FLOW.test(label) || pctOrFactor || lastOrFirst || balanceByValue) tc.value = null;
    });
  }
}
function isPeriodFramed(ws: ExcelJS.Worksheet): boolean {
  let years = 0;
  ws.getRow(4).eachCell({ includeEmpty: false }, (c, col) => { if (col > 2 && yearOf(c) !== null) years++; });
  return years >= 2 && ws.getCell(5, 1).value === 'Phase';
}
