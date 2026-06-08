/**
 * styles.ts
 *
 * Shared ExcelJS styling + helpers for the formula-driven model export. Follows
 * FAST conventions: blue inputs, black formulas, green cross-sheet links, so a
 * reviewer can tell at a glance what is an assumption versus a calculation.
 *
 * The key helper is `fcell(formula, result)`: it emits a LIVE Excel formula with
 * the platform's computed value cached as the result, so the workbook is fully
 * dynamic (recalculates on edit) AND opens with correct values AND is
 * verifiable (the cached result must reconcile to the platform snapshot).
 */
import type ExcelJS from 'exceljs';

// FAST palette (Excel-canonical), ARGB.
export const ARGB = {
  input: 'FF0070C0',     // blue, hardcoded user inputs
  formula: 'FF000000',   // black, calculations
  linked: 'FF00B050',    // green, cross-sheet references
  external: 'FFFF0000',  // red, external links (unused for now)
  navy: 'FF1B4F8A',
  navyDark: 'FF1B3A6B',
  white: 'FFFFFFFF',
  grey: 'FFF1F3F5',
  greyMid: 'FFD9DEE3',
  subtotal: 'FFE8EEF7',
  good: 'FF107C41',
  bad: 'FFC00000',
  warnBg: 'FFFFF3CD',
};

export const NUMFMT = {
  money: '#,##0_);(#,##0)',
  money1: '#,##0.0_);(#,##0.0)',
  pct: '0.0%',
  pct2: '0.00%',
  int: '#,##0',
  year: '0',
  mult: '0.00"x"',
};

type Cell = ExcelJS.Cell;

/** Live formula with the platform value cached as the result (reconcilable). */
export function fcell(formula: string, result: number | string | boolean): { formula: string; result: number | string | boolean } {
  return { formula, result };
}

/**
 * Quote a sheet name for use inside a formula when it is not a bare token Excel
 * accepts unquoted (letters / digits / underscore, not starting with a digit).
 * Names with spaces or symbols (e.g. 'Land & Area', 'Cost of Sales') must be
 * single-quoted, else Excel raises #NAME? (it parses '&' as concatenation and
 * the leading word as an unknown name). Embedded single quotes are doubled.
 * This is the single choke point: every cross-sheet reference is built via
 * sheetRef(), so any current or future multi-word sheet is quoted correctly.
 */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Fully-qualified cross-sheet reference, sheet name quoted as needed. */
export function sheetRef(sheet: string, a1: string): string {
  return `${quoteSheet(sheet)}!${a1}`;
}

export function setInput(cell: Cell, value: number | string, numFmt = NUMFMT.money): void {
  cell.value = value;
  cell.font = { name: 'Calibri', size: 10, color: { argb: ARGB.input } };
  cell.numFmt = numFmt;
}
export function setFormula(cell: Cell, fc: { formula: string; result: number | string | boolean }, numFmt = NUMFMT.money, linked = false): void {
  cell.value = fc;
  cell.font = { name: 'Calibri', size: 10, color: { argb: linked ? ARGB.linked : ARGB.formula } };
  cell.numFmt = numFmt;
}
export function setLabel(cell: Cell, text: string, opts: { bold?: boolean; indent?: number } = {}): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size: 10, bold: opts.bold ?? false, color: { argb: ARGB.formula } };
  if (opts.indent) cell.alignment = { indent: opts.indent };
}
export function setTitle(cell: Cell, text: string, size = 16): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size, bold: true, color: { argb: ARGB.navyDark } };
}
export function setSectionHeader(row: ExcelJS.Row, text: string, span: number): void {
  const c = row.getCell(1);
  c.value = text;
  c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  for (let i = 1; i <= span; i++) {
    const cell = row.getCell(i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.navy } };
  }
}
export function setColHeader(cell: Cell, text: string | number, align: 'left' | 'right' | 'center' = 'right'): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.navyDark } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
  cell.alignment = { horizontal: align };
  cell.border = { bottom: { style: 'thin', color: { argb: ARGB.greyMid } } };
}

export function fillCell(cell: Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
/** Solid-fill every cell in a 1-based rectangular range. */
export function fillRange(ws: ExcelJS.Worksheet, top: number, left: number, bottom: number, right: number, argb: string): void {
  for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) fillCell(ws.getCell(r, c), argb);
}
/** Thin box border around a 1-based rectangular range. */
export function boxBorder(ws: ExcelJS.Worksheet, top: number, left: number, bottom: number, right: number, argb = ARGB.greyMid): void {
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const cell = ws.getCell(r, c);
      const b: Partial<ExcelJS.Borders> = { ...(cell.border ?? {}) };
      if (r === top) b.top = { style: 'thin', color: { argb } };
      if (r === bottom) b.bottom = { style: 'thin', color: { argb } };
      if (c === left) b.left = { style: 'thin', color: { argb } };
      if (c === right) b.right = { style: 'thin', color: { argb } };
      cell.border = b;
    }
  }
}

/** Column letter for a 1-based column index (1 -> A, 27 -> AA). */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
