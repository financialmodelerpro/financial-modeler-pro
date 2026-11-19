/**
 * LOCAL TIMING FLAGS ON EVERY CALCULATION TAB (2026-11-19, founder B6).
 *
 * Each calculation tab carries, at its top, the Timeline rows and cells its formulas read: the year flags (one row
 * each, a green link per year) and the phase dates and counts (one cell each, in the Total column). Every formula on
 * the tab then reads these local rows, never Timeline directly, so a reader follows a tab's timing on the tab.
 *
 * The rows are inserted through relayout (every reference anywhere follows the moved cells) and the moves are
 * returned for the registry. A Timeline row is a YEAR row when it sits in the year header (rows 4 to 6) or in the
 * year flags section; any other Timeline cell (the phase schedule, the model years in column F) is a single value.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { Relayout, type SheetPlan } from './relayout';
import type { FrameMoves } from './tabFrame';

const TABS = ['Revenue', 'Capex', 'Opex', 'Financing', 'Fixed Assets & Inventory', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns'];
const INSERT_AT = 7;
const LABEL = 3, TOTAL = 6, FIRST_COL = 7;
const REF = /(?:'Timeline'|Timeline)!(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;

const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const textOf = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { result?: unknown }).result === 'string' ? (v as { result: string }).result : '');
const numOf = (v: unknown): unknown => {
  const x = v && typeof v === 'object' && !(v instanceof Date) && 'result' in (v as object) ? (v as { result?: unknown }).result : v;
  return typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean' || x instanceof Date ? x : undefined;
};

export function localTimingFlags(wb: ExcelJS.Workbook, live: boolean): FrameMoves {
  const tl = wb.getWorksheet('Timeline');
  const none: FrameMoves = { move: (_s, r, c) => ({ r, c }), oldCol: (_s, c) => c, newCol: (_s, c) => c };
  if (!tl || !live) return none;
  // The year flags section starts at its numbered bar.
  let flagsAt = Infinity, schedAt = 0;
  tl.eachRow((row, r) => { const b = textOf(row.getCell(2).value); if (/^\d+\.\s+Year flags/i.test(b)) flagsAt = r; if (/^\d+\.\s+Phase schedule/i.test(b)) schedAt = r; });
  const isYearRow = (r: number): boolean => r <= 6 || r > flagsAt;
  let lastCol = FIRST_COL;
  tl.getRow(4).eachCell((_c, col) => { if (col > lastCol) lastCol = col; });
  // What each tab reads.
  const plan = new Map<string, { years: number[]; cells: Array<[number, number]> }>();
  for (const name of TABS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const years = new Set<number>(), cells = new Map<string, [number, number]>();
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
      const parts = v.formula.split(/("(?:[^"]|"")*")/);
      for (let i = 0; i < parts.length; i += 2) for (const m of parts[i].matchAll(REF)) {
        const r1 = Number(m[4]), c1 = colNum(m[2]);
        if (isYearRow(r1) && c1 >= FIRST_COL) years.add(r1);
        else if (!m[6]) cells.set(`${r1}|${c1}`, [r1, c1]);
        else { const r2 = Number(m[8]); for (let r = r1; r <= r2; r++) years.add(r); }
      }
    }));
    if (years.size || cells.size) plan.set(name, { years: [...years].sort((a, b) => a - b), cells: [...cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) });
  }
  if (!plan.size) return none;
  // Insert the block: a heading, the year rows, the single cells, a blank row.
  const k = new Map<string, number>();
  for (const [name, p] of plan) k.set(name, 1 + p.years.length + p.cells.length + 1);
  const plans = new Map<string, SheetPlan>();
  for (const [name] of plan) {
    const n = k.get(name)!;
    plans.set(name, { map: (r, c) => ({ r: r >= INSERT_AT ? r + n : r, c }), rowOf: (r) => (r >= INSERT_AT ? r + n : r), colOf: (c) => c });
  }
  const relayout = new Relayout(wb, plans);
  relayout.run();
  // Write the block and point the tab's formulas at it.
  for (const [name, p] of plan) {
    const ws = wb.getWorksheet(name)!;
    let r = INSERT_AT;
    const head = ws.getCell(r, LABEL);
    head.value = 'Timing flags (links to Timeline)';
    head.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1B4F8A' } };
    r += 1;
    const yearRowOf = new Map<number, number>(), cellRowOf = new Map<string, number>();
    const green = { name: 'Calibri', size: 9, color: { argb: 'FF008000' } } as ExcelJS.Font;
    for (const tr of p.years) {
      const lab = ws.getCell(r, LABEL);
      lab.value = textOf(tl.getCell(tr, LABEL).value) || `Timeline row ${tr}`;
      lab.font = { name: 'Calibri', size: 9 }; lab.alignment = { indent: 1 };
      for (let c = FIRST_COL; c <= lastCol; c++) {
        const src = tl.getCell(tr, c);
        if (src.value === null || src.value === undefined || src.value === '') continue;
        const cell = ws.getCell(r, c);
        cell.value = { formula: `Timeline!${colName(c)}$${tr}`, result: numOf(src.value) } as ExcelJS.CellValue;
        cell.numFmt = src.numFmt; cell.font = green; cell.alignment = { horizontal: 'right' };
      }
      yearRowOf.set(tr, r);
      r += 1;
    }
    for (const [tr, tc] of p.cells) {
      const lab = ws.getCell(r, LABEL);
      // The cell's row label and its column head on Timeline, so "Phase 1: Construction (yrs)" reads as itself.
      let head2 = '';
      for (let hr = tr - 1; hr >= Math.max(1, schedAt); hr--) { const t = textOf(tl.getCell(hr, tc).value); if (t && hr >= schedAt) { head2 = t; break; } }
      const rowLab = textOf(tl.getCell(tr, LABEL).value);
      lab.value = [rowLab, head2].filter(Boolean).join(': ') || `Timeline ${colName(tc)}${tr}`;
      lab.font = { name: 'Calibri', size: 9 }; lab.alignment = { indent: 1 };
      const src = tl.getCell(tr, tc);
      const cell = ws.getCell(r, TOTAL);
      cell.value = { formula: `Timeline!$${colName(tc)}$${tr}`, result: numOf(src.value) } as ExcelJS.CellValue;
      cell.numFmt = src.numFmt; cell.font = green; cell.alignment = { horizontal: 'right' };
      cellRowOf.set(`${tr}|${tc}`, r);
      r += 1;
    }
    const blockEnd = r;
    ws.eachRow((row, rr) => {
      if (rr >= INSERT_AT && rr < blockEnd) return;
      row.eachCell((c) => {
        const v = c.value as { formula?: string; result?: unknown } | null;
        if (!v || typeof v !== 'object' || typeof v.formula !== 'string' || !/Timeline!/.test(v.formula)) return;
        const parts = v.formula.split(/("(?:[^"]|"")*")/);
        for (let i = 0; i < parts.length; i += 2) parts[i] = parts[i].replace(REF, (all, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
          const R1 = Number(r1), C1 = colNum(c1);
          if (!c2) {
            const yr = yearRowOf.get(R1);
            if (yr && C1 >= FIRST_COL) return `${d1}${c1}${d2}${yr}`;
            const cr = cellRowOf.get(`${R1}|${C1}`);
            return cr ? `$${colName(TOTAL)}$${cr}` : all;
          }
          const ya = yearRowOf.get(R1), yb = yearRowOf.get(Number(r2));
          return ya && yb && R1 === Number(r2) ? `${d1}${c1}${d2}${ya}:${d3 ?? ''}${c2}${d4 ?? ''}${yb}` : all;
        });
        c.value = { ...v, formula: parts.join('') } as ExcelJS.CellValue;
      });
    });
  }
  return { move: (sheet, rr, c) => relayout.moveCell(sheet, rr, c), oldCol: (_s, c) => c, newCol: (_s, c) => c };
}
