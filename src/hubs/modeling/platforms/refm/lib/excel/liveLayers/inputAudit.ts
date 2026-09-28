/**
 * inputAudit.ts (2026-09-28)
 *
 * A SHADED CELL IS A PROMISE: type here and the model recalculates (founder,
 * 2026-09-28: a shaded cell that does nothing when you type into it is the
 * worst thing this workbook could ship with). This module measures the promise
 * and keeps it, for the build (formulaWorkbook.ts) and the proof
 * (verify-formula-workbook) alike, so the two cannot disagree about it.
 *
 *   - readCells: every cell any formula in the workbook reads, ranges expanded.
 *   - shadedCells: every visible cell carrying the input fill and a value.
 *   - fixAtExport: unshades a cell and says why, in the founder's words.
 *
 * WHAT MAY STAY SHADED. A shaded cell must be READ by a formula. The ones that
 * are not are either (a) a TEXT choice, which defines structure the live model
 * never re-parses and so is fixed at export by rule, or (b) a number a layer
 * DECLARED fixed (registry key `fixed:<why>` on the cell). Anything else is a
 * dead input and the verifier fails on it; the build never unshades it
 * silently, because doing so would hide a link that had broken.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { ARGB } from '../styles';

export const FIXED_AT_EXPORT_NOTE = 'Fixed at export: the live workbook is built for this value; change it on the platform and re-export.';

const colNum = (s: string): number => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const cellId = (sheet: string, row: number, col: number): string => `${sheet}!${row}:${col}`;

/** Every cell a formula reads, as sheet!row:col, ranges expanded. */
export function readCells(wb: ExcelJS.Workbook): Set<string> {
  const read = new Set<string>();
  const re = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_&]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g;
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((cell) => {
    const v = cell.value as unknown as { formula?: string } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
    for (const m of v.formula.matchAll(re)) {
      const sh = (m[1] ?? m[2]).replace(/''/g, "'");
      const c1 = colNum(m[3]), r1 = Number(m[4]);
      const c2 = m[5] ? colNum(m[5]) : c1, r2 = m[6] ? Number(m[6]) : r1;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) read.add(cellId(sh, r, c));
    }
  }));
  return read;
}

/** The colour legend's input swatch ("Input" / "Input (the assumption a user edits ...)"). */
export const isLegendSwatch = (text: string): boolean => /^Input\b/.test(text.trim());

export const isShaded =(cell: ExcelJS.Cell): boolean => (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb === ARGB.inputFill;

export interface ShadedCell { sheet: string; row: number; col: number; value: unknown; isFormula: boolean; isText: boolean }

/** Every visible shaded cell with a value (the legend swatches on the front sheets excluded). */
export function shadedCells(wb: ExcelJS.Workbook): ShadedCell[] {
  const out: ShadedCell[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue;
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      if (!isShaded(cell)) return;
      const v = cell.value as unknown;
      if (v === null || v === undefined || v === '') return;
      const isFormula = !!v && typeof v === 'object' && 'formula' in (v as object);
      out.push({ sheet: ws.name, row: r, col: c, value: v, isFormula, isText: !isFormula && typeof v === 'string' });
    }));
  }
  return out;
}

/** Unshade a cell and say, on the cell, that it is fixed at export. */
export function fixAtExport(ws: ExcelJS.Worksheet, row: number, col: number, why?: string): void {
  const cell = ws.getCell(row, col);
  cell.fill = { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
  cell.border = {};
  cell.font = { ...(cell.font ?? {}), color: { argb: ARGB.formula } };
  cell.note = { texts: [{ text: why ? `${FIXED_AT_EXPORT_NOTE} ${why}` : FIXED_AT_EXPORT_NOTE }], margins: { insetmode: 'auto' } } as unknown as ExcelJS.Comment;
}
