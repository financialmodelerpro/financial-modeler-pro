/**
 * foundations.ts (2026-10-14), FORMULA-LINKED EXPORT: THE SHARED PERIOD AXIS.
 *
 * ONE PERIOD, ONE COLUMN, ON EVERY TAB (founder, 2026-10-14). Each period tab's
 * frozen header carries the period-end year (row 3) and the period index
 * (row 4). The hardcoded export prints both as numbers; here every header cell
 * links to the same column of the Timeline, so a tab can never show a year the
 * Timeline does not, and a year typed into a header cannot drift from it.
 *
 * A header is linked only where it already shows the Timeline's year and index
 * in the same column: a tab laid out on another geometry is left alone and
 * stays visible to the column check rather than being linked across columns.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { CellRegistry } from '../cellRegistry';
import { LiveWriter } from './writer';

/** Link rows 3 and 4 of each named tab to the Timeline; returns the formulas written per tab. */
export function linkPeriodHeaders(wb: ExcelJS.Workbook, reg: CellRegistry, pending: Set<string>, sheets: string[]): Map<string, number> {
  const w = new LiveWriter(wb, reg, pending);
  const yearCols = reg.keys().filter((k) => k.startsWith('tl:year:')).map((k) => Number(k.split(':')[2])).sort((a, b) => a - b);
  const out = new Map<string, number>();
  if (!yearCols.length) return out;
  const yearRow = reg.need(`tl:year:${yearCols[0]}`).row;
  for (const sheet of sheets) {
    if (sheet === 'Timeline' || !wb.getWorksheet(sheet)) continue;
    let n = 0;
    for (const c of yearCols) {
      const tYear = { sheet: 'Timeline', row: yearRow, col: c }, tIdx = { sheet: 'Timeline', row: yearRow + 1, col: c };
      const hYear = { sheet, row: 3, col: c }, hIdx = { sheet, row: 4, col: c };
      const same = (a: typeof tYear, b: typeof tYear): boolean => typeof w.platformValue(a) === 'number' && w.platformValue(a) === w.platformValue(b);
      // The index is the column's count from the opening column (ExcelJS keeps no cached 0, so it is not read back).
      if (!same(hYear, tYear) || w.platformValue(hIdx) !== c - yearCols[0]) continue;
      // The column relative, so the row is one formula copied across.
      const rel = (s: string): string => s.replace(/!\$([A-Z]+)\$/, '!$1$');
      w.fA(hYear, rel(w.refA(tYear)));
      w.fA(hIdx, rel(w.refA(tIdx)));
      n += 2;
    }
    if (n) out.set(sheet, n);
  }
  return out;
}
