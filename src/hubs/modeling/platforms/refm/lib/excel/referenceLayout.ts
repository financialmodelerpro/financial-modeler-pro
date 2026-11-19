/**
 * referenceLayout.ts (2026-11-17, founder: "make the export match the reference file exactly")
 *
 * THE LAST LAYOUT STEP OF BOTH WORKBOOKS, matched to the founder's restyled export of the reference project
 * (docs/refm-export-reference.xlsx, local and gitignored). It moves cells through relayout.ts, so every formula,
 * link, validation and conditional format follows, and it returns its moves so the registry follows too.
 *
 *   - Columns A and B are narrow (1.5). B holds only the title block (rows 1 to 3) and the section bar text;
 *     every other cell moves two columns right, so a line's label is in C.
 *   - A time tab with no Input column gets an empty one (D), so the years are the same letters on every time
 *     tab: Line C, Input D, a narrow spacer E, Total F, the opening column G and the first year H.
 *   - Section bars are numbered 1, 2, 3 ... with exactly one blank row before each; a few of the old
 *     sub-headings become bars (Financing, Returns, Opex), named as the reference names them, and the empty
 *     row a bar left under itself goes.
 *   - A table's header row is filled to the last used column; every tab ends with a navy "End of sheet" band
 *     two rows under its last row.
 *
 * A section that is not built for a project is simply not there, and the bars after it renumber.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { Relayout, type SheetPlan } from './relayout';
import { HOUSE } from './houseStyle';
import type { FrameMoves } from './tabFrame';

/** Tabs this step leaves alone: the Cover, and the tabs built in the final geometry after it. */
const BUILT_AFTER = new Set(['Cover', 'Guide', 'Summary', 'Dashboard']);

/** A sub-heading that becomes a section bar, with the bar's name (`null` keeps the sub-heading's own text). */
interface Promote { match: RegExp; name: string | ((m: RegExpExecArray) => string) | null }
const PROMOTE: Record<string, Promote[]> = {
  Financing: [
    { match: /^Operating cash, capex and the exit$/, name: null },
    { match: /^The funding need$/, name: null },
    { match: /^Cash short of the minimum$/, name: null },
    { match: /^Debt: (.+)$/, name: (m) => m[1] },
    { match: /^Interest and capitalised interest$/, name: null },
    { match: /^Zakat$/, name: null },
    { match: /^Tax$/, name: null },
    { match: /^Fund fees$/, name: null },
    { match: /^Cash waterfall: debt service, the sweep and( dividends)?$/, name: 'Cash waterfall: debt service, the sweep and dividends' },
  ],
  Returns: [
    { match: /^Assumptions$/, name: null },
    { match: /^Exit value$/, name: null },
    { match: /^FCFF, unlevered project$/, name: null },
    { match: /^FCFE, levered equity$/, name: null },
    { match: /^Distributions before the performance fee$/, name: null },
    { match: /^Performance fee$/, name: 'Performance fee (the hurdle waterfall)' },
    { match: /^Equity partners$/, name: null },
    { match: /^Fund fees and who earns them$/, name: null },
    { match: /^Sources and uses of capital, over construction$/, name: null },
  ],
  Opex: [{ match: /^Summary by line$/, name: null }],
};
/** Tabs whose sub-headings are numbered under their bar, x.1, x.2 (2026-11-19, founder: the Financing sub-tables). */
const SUB_NUMBERED = new Map<string, RegExp>([['Financing', /./], ['Revenue', /^\d+\. Selling costs$/]]);
/** A top bar that only repeats the tab's name goes (its sub-sections become the bars). */
const DROP_BAR: Record<string, RegExp> = { Returns: /^Returns$/ };

const fillOf = (c: ExcelJS.Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
const isFormula = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const yearOf = (c: ExcelJS.Cell): number | null => { const v = c.value as unknown; const n = isFormula(v) ? v.result : v; return typeof n === 'number' ? n : null; };
const textOf = (c: ExcelJS.Cell): string => (typeof c.value === 'string' ? c.value.trim() : '');
const stripNo = (s: string): string => s.replace(/^\d+(?:\.\d+)*\.?\s+/, '');

function rowEmpty(ws: ExcelJS.Worksheet, r: number): boolean {
  let any = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== undefined && c.value !== '') any = true; });
  return !any;
}
function isPeriodFramed(ws: ExcelJS.Worksheet): boolean {
  let years = 0;
  ws.getRow(4).eachCell({ includeEmpty: false }, (c, col) => { if (col > 2 && yearOf(c) !== null) years++; });
  return years >= 2 && ws.getCell(5, 1).value === 'Phase';
}
/** A numbered section bar: its first cell filled with the bar colour and holding the bar's text. */
const isBar = (ws: ExcelJS.Worksheet, r: number): boolean => fillOf(ws.getCell(r, 1)) === HOUSE.bar && /^\d+(?:\.\d+)*\.?\s+\S/.test(textOf(ws.getCell(r, 1)));
/** A sub-heading: bold bar-coloured text in the first cell, no fill, nothing else on the row. */
function isSubHeading(ws: ExcelJS.Worksheet, r: number): boolean {
  const a = ws.getCell(r, 1);
  if (!textOf(a) || fillOf(a)) return false;
  const f = a.font as { bold?: boolean; color?: { argb?: string } } | undefined;
  if (!f?.bold || f.color?.argb !== HOUSE.bar) return false;
  let others = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (c, col) => { if (col > 1 && c.value !== null && c.value !== undefined && c.value !== '') others = true; });
  return !others;
}

interface SheetLayout { insertInput: boolean; period: boolean; bars: Map<number, string>; timeline: boolean; lastOld: number }

/** Each laid-out sheet's row plan, kept per workbook so a twin (a verifier's values build) can follow it exactly. */
interface RowPlan { newRow: Array<number | null>; bars: Map<number, string>; insertInput: boolean; lastOld: number; cur: number }
const RECORDED = new WeakMap<ExcelJS.Workbook, Map<string, RowPlan>>();

/**
 * `mirror`: lay the sheets out with the row plan another workbook was laid out with (the same build in values,
 * whose emptiness can differ from the live file's where the live file inlined a row), so a cell and its twin keep
 * one address.
 */
export function applyReferenceLayout(wb: ExcelJS.Workbook, opts: { mirror?: ExcelJS.Workbook } = {}): FrameMoves {
  const recorded = new Map<string, RowPlan>();
  RECORDED.set(wb, recorded);
  const mirrorOf = opts.mirror ? RECORDED.get(opts.mirror) : undefined;
  const plans = new Map<string, SheetPlan>();
  const layouts = new Map<string, SheetLayout>();
  for (const ws of wb.worksheets) {
    if (BUILT_AFTER.has(ws.name)) continue;
    const period = isPeriodFramed(ws);
    // A twin with a different number of rows on this sheet (an edited copy) lays it out by its own rows.
    const m0 = mirrorOf?.get(ws.name);
    const mirrored = m0 && m0.lastOld === ws.rowCount ? m0 : undefined;
    const insertInput = mirrored ? mirrored.insertInput : period && textOf(ws.getCell(4, 1)) === 'Line' && textOf(ws.getCell(4, 2)) !== 'Input';
    const lastOld = mirrored ? mirrored.lastOld : ws.rowCount;
    // Which rows are bars after this step, with their text (numbered below), and which rows go.
    const bars = new Map<number, string>();
    const drop = new Set<number>();
    const promote = PROMOTE[ws.name] ?? [];
    for (let r = 4; r <= lastOld; r++) {
      if (isBar(ws, r)) {
        const t = stripNo(textOf(ws.getCell(r, 1)));
        if (DROP_BAR[ws.name]?.test(t)) { drop.add(r); continue; }
        bars.set(r, t);
        continue;
      }
      if (!isSubHeading(ws, r)) continue;
      const t = textOf(ws.getCell(r, 1));
      for (const p of promote) {
        const m = p.match.exec(t);
        if (!m) continue;
        bars.set(r, p.name === null ? t : typeof p.name === 'string' ? p.name : p.name(m));
        break;
      }
    }
    // On a time tab the empty row a bar left under itself goes: one blank row sits BEFORE a bar, never after it
    // (the founder: "remove any double blank rows"). A tab of tables (Inputs) keeps the space under its bars.
    if (period) for (const r of bars.keys()) { let x = r + 1; while (x <= lastOld && rowEmpty(ws, x) && !drop.has(x)) { drop.add(x); x++; } }
    // Number the bars in order.
    let n = 0;
    for (const r of [...bars.keys()].sort((a, b) => a - b)) bars.set(r, `${++n}. ${bars.get(r)!}`);
    // The sub-headings under a bar, numbered with it (x.1, x.2), on the tabs that number them.
    if (SUB_NUMBERED.has(ws.name) && !mirrorOf?.get(ws.name)) {
      let major = 0, minor = 0;
      for (let r = 4; r <= lastOld; r++) {
        // Only under the bars the tab numbers (Revenue: its selling costs, 2026-11-19).
        if (bars.has(r)) { major = SUB_NUMBERED.get(ws.name)!.test(bars.get(r)!) ? Number(/^(\d+)\./.exec(bars.get(r)!)?.[1] ?? 0) : 0; minor = 0; continue; }
        if (!major || drop.has(r) || !isSubHeading(ws, r)) continue;
        const a = ws.getCell(r, 1);
        a.value = `${major}.${++minor} ${stripNo(textOf(a))}`;
      }
    }

    // Rows: one blank row before every bar (inserted where the row above it is not empty).
    let newRow = new Array<number | null>(lastOld + 1).fill(null);
    let cur = 0, prevEmpty = true;
    for (let r = 1; r <= lastOld; r++) {
      if (drop.has(r)) continue;
      if (bars.has(r) && !prevEmpty) cur++;
      newRow[r] = ++cur;
      prevEmpty = rowEmpty(ws, r);
      if (bars.has(r)) prevEmpty = false;
    }
    if (mirrored) {
      newRow = mirrored.newRow.slice(); cur = mirrored.cur;
      bars.clear(); for (const [r, t] of mirrored.bars) bars.set(r, t);
    }
    recorded.set(ws.name, { newRow, bars: new Map(bars), insertInput, lastOld, cur });
    const colOf = (c: number): number => (insertInput ? (c === 1 ? 3 : c + 3) : c + 2);
    plans.set(ws.name, {
      rowOf: (r) => (r >= 1 && r <= lastOld ? newRow[r] : null),
      colOf: (c) => colOf(c),
      map: (r, c) => {
        if (r > lastOld) return { r: r + (cur - lastOld), c: colOf(c) };
        const nr = newRow[r];
        if (nr === null) return null;
        // The title block and a bar's text sit in column B.
        if (c === 1 && (r <= 3 || bars.has(r))) return { r: nr, c: 2 };
        return { r: nr, c: colOf(c) };
      },
    });
    const newBars = new Map<number, string>();
    for (const [r, t] of bars) newBars.set(newRow[r]!, t);
    layouts.set(ws.name, { insertInput, period, bars: newBars, timeline: ws.name === 'Timeline', lastOld: cur });
  }

  const relayout = new Relayout(wb, plans);
  relayout.run();

  for (const ws of wb.worksheets) {
    const lay = layouts.get(ws.name);
    if (!lay) continue;
    // The last used column (from the header row down), which every band and bar runs to.
    let last = 3;
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c, col) => { if (c.value !== null && c.value !== undefined && c.value !== '' && col > last) last = col; }));
    for (const r of [1, 2, 3]) { const t = ws.getCell(r, 2); t.alignment = { ...(t.alignment ?? {}), vertical: 'middle' }; }
    ws.getColumn(1).width = 1.5;
    ws.getColumn(2).width = 1.5;

    if (lay.insertInput) {
      const d4 = ws.getCell(4, 4);
      d4.value = 'Input';
      ws.getColumn(4).width = 12;
    }
    // THE HEADER ROWS START IN COLUMN B (2026-11-19, founder), as the bars do: the fill, borders and bottom line run
    // from B; the words stay in C.
    if (lay.period) {
      for (let c = 2; c <= last; c++) {
        const h = ws.getCell(4, c);
        h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOUSE.band } };
        h.font = { name: 'Calibri', size: 9, bold: true, color: { argb: HOUSE.white } };
      }
      const d4 = ws.getCell(4, 4);
      if (d4.value === 'Input') d4.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      for (let c = 2; c <= last; c++) {
        const p = ws.getCell(5, c);
        p.border = { bottom: { style: 'medium', color: { argb: HOUSE.band } } };
        if (c === 4 && lay.insertInput) p.font = { name: 'Calibri', size: 8, italic: true, color: { argb: HOUSE.calc } };
      }
    }

    // Bars: the number and name in B, the bar colour from B to the last used column, white bold, 18 high.
    for (const [r, text] of lay.bars) {
      const row = ws.getRow(r);
      for (let c = 2; c <= last; c++) {
        const cell = row.getCell(c);
        if (c === 2) cell.value = text; else if (c > 2) cell.value = null;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOUSE.bar } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HOUSE.white } };
        cell.border = {};
        cell.alignment = c === 2 ? { vertical: 'middle' } : {};
      }
      row.height = 18;
    }
    // The new Input column wears its row's style where the row is a subtotal or a total (fill, border, font).
    if (lay.insertInput) for (let r = 6; r <= ws.rowCount; r++) {
      if (lay.bars.has(r)) continue;
      const c3 = ws.getCell(r, 3), d = ws.getCell(r, 4);
      if (!fillOf(c3) || d.value !== null && d.value !== undefined) continue;
      d.fill = JSON.parse(JSON.stringify(c3.fill));
      d.border = JSON.parse(JSON.stringify(c3.border ?? {}));
      d.font = JSON.parse(JSON.stringify(c3.font ?? {}));
    }
    // A table's header row (a heading cell filled navy or bar blue with white text, not a bar) runs the full
    // width: every cell from C to the last used column in the header colour, its text white bold.
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r <= 5 || lay.bars.has(r)) return;
      let f: string | undefined;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (f || col < 3 || typeof cell.value !== 'string' || !cell.value) return;
        const fc = fillOf(cell), fo = (cell.font as { color?: { argb?: string } } | undefined)?.color?.argb;
        if ((fc === HOUSE.band || fc === HOUSE.bar) && fo === HOUSE.white) f = fc;
      });
      if (!f) return;
      // The Timeline legend (its swatches are filled cells) is a key, not a table head.
      if (/^Legend/.test(textOf(row.getCell(3)))) return;
      for (let c = 2; c <= last; c++) {
        const cell = row.getCell(c);
        if (c === 2) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }; cell.border = JSON.parse(JSON.stringify(row.getCell(3).border ?? {})); continue; }
        if (!fillOf(cell)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } };
        if (c === 3 || (cell.value !== null && cell.value !== undefined && cell.value !== '')) cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: HOUSE.white } };
      }
    });

    // The end of the sheet: two rows under the last row, a navy band from B to the last used column.
    let lastRow = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => { let any = false; row.eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== undefined && c.value !== '') any = true; }); if (any) lastRow = Math.max(lastRow, r); });
    const end = lastRow + 2;
    for (let c = 2; c <= last; c++) {
      const cell = ws.getCell(end, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOUSE.band } };
      if (c === 2) { cell.value = 'End of sheet'; cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: HOUSE.white } }; }
    }
    ws.getRow(end).height = 16;

    // Freeze panes: under the header block and right of the Total column on a time tab (G7); Timeline keeps its
    // own rows (it has no blank row 6); a tab frozen before keeps its rows, its columns moved with the cells.
    const v0 = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    if (lay.period && !lay.timeline) ws.views = [{ state: 'frozen', xSplit: 6, ySplit: 6, showGridLines: false } as ExcelJS.WorksheetView];
    else if (v0?.state === 'frozen') ws.views = [{ state: 'frozen', xSplit: lay.timeline ? 6 : (v0.xSplit ?? 0) + 2, ySplit: v0.ySplit ?? 0, showGridLines: false } as ExcelJS.WorksheetView];
    else ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
    if (lay.period) ws.pageSetup = { ...ws.pageSetup, printTitlesRow: '1:5' };
  }

  return {
    move: (sheet, r, c) => relayout.moveCell(sheet, r, c),
    oldCol: (sheet, c) => { const l = layouts.get(sheet); if (!l) return c; return l.insertInput ? (c === 3 ? 1 : c - 3) : c - 2; },
    newCol: (sheet, c) => { const l = layouts.get(sheet); if (!l) return c; return l.insertInput ? (c === 1 ? 3 : c + 3) : c + 2; },
  };
}

/** Two frames, one after the other, as one. */
export function composeMoves(a: FrameMoves, b: FrameMoves): FrameMoves {
  return {
    move: (sheet, r, c) => { const m = a.move(sheet, r, c); return m ? b.move(sheet, m.r, m.c) : null; },
    oldCol: (sheet, c) => a.oldCol(sheet, b.oldCol(sheet, c)),
    newCol: (sheet, c) => b.newCol(sheet, a.newCol(sheet, c)),
  };
}

/**
 * ECHOED INPUTS SIT IN THE INPUT COLUMN (2026-11-19, founder B7): on Revenue, Opex and Fixed Assets & Inventory a
 * single value read from another tab for reference (key size, operations start year, receivable days, lettable area)
 * is in column D, green, never under Total. A row qualifies when its only figure is in the Total column (F), nothing
 * is in its years or in D, and the figure is a formula reading another tab. Moved through relayout, so every formula
 * that reads it follows, and the moves are returned for the registry.
 */
const ECHO_LABEL = /^(Key size|Operations start year|Receivable days|Lettable area|Average unit size)/i;
export function echoesToInputColumn(wb: ExcelJS.Workbook): FrameMoves {
  const TABS = ['Revenue', 'Opex', 'Fixed Assets & Inventory'];
  const D = 4, F = 6, FIRST_YEAR = 8;
  const moved = new Map<string, Set<number>>();
  for (const name of TABS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const rows = new Set<number>();
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r <= 5) return;
      // By what the row is (the same in a values twin, which has no formulas): an echoed setting, one figure under Total.
      if (!ECHO_LABEL.test(String(row.getCell(3).value ?? '').trim())) return;
      const f = row.getCell(F).value;
      if (f === null || f === undefined || f === '') return;
      const dv = row.getCell(D).value;
      if (dv !== null && dv !== undefined && dv !== '') return;
      let years = false;
      row.eachCell({ includeEmpty: false }, (c, col) => { if (col >= FIRST_YEAR && c.value !== null && c.value !== undefined && c.value !== '') years = true; });
      if (!years) rows.add(r);
    });
    if (rows.size) moved.set(name, rows);
  }
  const plans = new Map<string, SheetPlan>();
  for (const [name, rows] of moved) plans.set(name, {
    map: (r, c) => (rows.has(r) && c === F ? { r, c: D } : { r, c }),
    rowOf: (r) => r, colOf: (c) => c,
  });
  const relayout = new Relayout(wb, plans);
  if (plans.size) relayout.run();
  for (const [name, rows] of moved) {
    const ws = wb.getWorksheet(name)!;
    for (const r of rows) {
      const c = ws.getCell(r, D);
      c.font = { ...(c.font ?? {}), color: { argb: 'FF008000' } };
      c.alignment = { ...(c.alignment ?? {}), horizontal: 'right' };
    }
  }
  return {
    move: (sheet, r, c) => relayout.moveCell(sheet, r, c),
    oldCol: (_s, c) => c,
    newCol: (_s, c) => c,
  };
}
