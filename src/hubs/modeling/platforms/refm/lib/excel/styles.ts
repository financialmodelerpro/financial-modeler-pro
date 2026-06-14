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
  input: 'FF0070C0',     // blue (legacy; inputs now use the navy-pale shading below)
  // FAST input cell shading: navy-pale fill + navy text + light border, matching
  // the on-screen FAST_INPUT cells and the PDF input shading, so an assumption
  // reads at a glance without a coloured font.
  inputFill: 'FFE2EAF4',   // navy-pale fill (PDF FAST_FILL)
  inputBorder: 'FFBDCCE3', // light navy border (PDF FAST_BORDER)
  formula: 'FF000000',   // black, calculations
  linked: 'FF00B050',    // green, cross-sheet references
  external: 'FFFF0000',  // red, external links (unused for now)
  navy: 'FF1B4F8A',
  navyDark: 'FF1B3A6B',
  // Deep navy band for top-level section headers: the darkest shade in the
  // monochrome navy hierarchy (section = deepest, total = navy, subtotal =
  // pale navy), so a section break stands out from a total without introducing
  // a second hue. Named `accent` for historical call-site reasons; it is navy.
  accent: 'FF0C2340',
  white: 'FFFFFFFF',
  grey: 'FFF1F3F5',
  greyMid: 'FFD9DEE3',
  subtotal: 'FFE8EEF7',
  good: 'FF107C41',
  bad: 'FFC00000',
  warnBg: 'FFFFF3CD',
};

/**
 * Excel accounting number format (no currency symbol): right-aligned digits,
 * parentheses for negatives, a dash for zero, all sections column-aligned. The
 * model uses accounting style throughout for an institutional, audit-ready look.
 *   `decimals` = decimal places; `commas` = trailing scale commas (each divides
 *   the displayed value by 1000, see the display-scale note below).
 */
export function accountingFormat(decimals: number, commas = 0): string {
  const dec = decimals > 0 ? `.${'0'.repeat(decimals)}` : '';
  const c = ','.repeat(Math.max(0, commas));
  const dash = decimals > 0 ? `"-"${'?'.repeat(decimals)}` : '"-"';
  return `_(* #,##0${dec}${c}_);_(* (#,##0${dec}${c});_(* ${dash}_);_(@_)`;
}

export const NUMFMT = {
  money: accountingFormat(0),
  money1: accountingFormat(1),
  // Per-unit rate / price (SAR per sqm / bay / unit, ADR). Distinct from `money`
  // so the workbook-wide display-scale (scaleMoneyFormats) leaves rates in full
  // units; only magnitude figures (money / money1) scale.
  rate: accountingFormat(2),
  // All percentages are 2-decimal throughout the model, independent of the money
  // decimal selection. Zero renders as a dash (matching the accounting style), so
  // sparse allocation rows read cleanly instead of a wall of "0.00%". `pct` is
  // kept as an alias so existing call sites stay 2dp.
  pct: '0.00%;-0.00%;"-"',
  pct2: '0.00%;-0.00%;"-"',
  // Counts / areas: accounting style (dash for zero, parentheses for negatives),
  // distinct from `money` so the display-scale sweep never scales a count / area.
  int: '#,##0_);(#,##0);"-"_)',
  year: '0',
  // Period-end date label: the stored value stays the integer year, formatted as
  // "Dec 2026" (so the +1 formula chain and every year reference keep working).
  date: '"Dec "0',
  mult: '0.00"x"',
};

/**
 * Workbook-wide DISPLAY scale. Excel custom number formats divide the DISPLAYED
 * value by 1000 per trailing comma, leaving the stored value and every formula
 * in full units. So a thousands / millions view is purely cosmetic and the
 * locked reconciliation (which compares stored full-unit values) is untouched.
 * Only the magnitude formats (money / money1) scale; rate / pct / int / year /
 * mult are left alone.
 */
export type DisplayScale = 'full' | 'thousands' | 'millions';
export type DisplayDecimals = 0 | 1 | 2;

/** Trailing scale commas for a display scale (each divides displayed value /1000). */
export function scaleCommas(scale: DisplayScale): number {
  return scale === 'thousands' ? 1 : scale === 'millions' ? 2 : 0;
}

/** Default money decimals for a scale when the caller has not chosen explicitly:
 *  full / thousands show whole numbers; millions show one decimal. */
export function defaultDecimals(scale: DisplayScale): DisplayDecimals {
  return scale === 'millions' ? 1 : 0;
}

export function scaledMoneyFormats(scale: DisplayScale, decimals: DisplayDecimals): { money: string; money1: string } {
  const commas = scaleCommas(scale);
  return { money: accountingFormat(decimals, commas), money1: accountingFormat(Math.max(1, decimals), commas) };
}

/** Sweep every sheet: re-format magnitude money cells to the chosen scale +
 *  decimals. Display-only; stored values + formulas are unchanged, so the locked
 *  reconciliation (full-unit values) is identical at every scale / decimal. */
export function scaleMoneyFormats(wb: ExcelJS.Workbook, scale: DisplayScale, decimals: DisplayDecimals = defaultDecimals(scale)): void {
  if (scale === 'full' && decimals === 0) return; // base formats already correct
  const { money, money1 } = scaledMoneyFormats(scale, decimals);
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((cell) => {
      if (cell.numFmt === NUMFMT.money) cell.numFmt = money;
      else if (cell.numFmt === NUMFMT.money1) cell.numFmt = money1;
    }));
  }
}

/** Human unit-note suffix for headers when a scale is active. */
export function scaleNote(scale: DisplayScale, currency: string): string {
  if (scale === 'thousands') return `All money figures in ${currency} thousands`;
  if (scale === 'millions') return `All money figures in ${currency} millions`;
  return '';
}

type Cell = ExcelJS.Cell;

/**
 * STATIC (hardcoded) mode. When on, `setFormula` writes the cached platform
 * value as a plain constant instead of a live `{ formula, result }`, so the
 * whole workbook is a hardcoded snapshot of the platform: every figure is the
 * platform-computed value, nothing recalculates on edit. The layout, number
 * formats, FAST colours and frozen headers are unchanged; only the cell value
 * kind flips (formula object -> constant). This is the single choke point that
 * turns the formula-driven model into the hardcoded platform mirror.
 */
let STATIC = false;
export function setStaticMode(on: boolean): void { STATIC = on; }
export function isStaticMode(): boolean { return STATIC; }

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

// Default body font size for the workbook (Calibri 9.5 throughout).
export const BODY_SIZE = 9.5;

/** Apply the FAST input look (navy-pale fill, navy text, light border) to a cell.
 *  Use on cells whose value / formula is written elsewhere but which are inputs. */
export function markInput(cell: Cell): void {
  cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.navyDark } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.inputFill } };
  const b = { style: 'thin' as const, color: { argb: ARGB.inputBorder } };
  cell.border = { top: b, bottom: b, left: b, right: b };
}
export function setInput(cell: Cell, value: number | string, numFmt = NUMFMT.money): void {
  cell.value = value;
  cell.numFmt = numFmt;
  markInput(cell);
}
export function setFormula(cell: Cell, fc: { formula: string; result: number | string | boolean }, numFmt = NUMFMT.money, linked = false): void {
  // STATIC: write the platform-computed value as a hardcoded constant (no live
  // formula). Linked cells still use the formula-black font (there is no live
  // cross-sheet link in a hardcoded workbook, so the green "linked" colour
  // would be misleading); everything reads as a plain computed constant.
  cell.value = STATIC ? fc.result : fc;
  cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: (linked && !STATIC) ? ARGB.linked : ARGB.formula } };
  cell.numFmt = numFmt;
}

/**
 * Guidance "Basis / Calculation" cell: human-readable, NON-computable text
 * describing how a row's value was derived (e.g. "Rate x Quantity",
 * "Opening + Draw + IDC - Principal - Sweep"). Rendered in a muted italic so it
 * reads as a note, never mistaken for a value. Leading "=" is stripped so no
 * client treats it as a formula.
 */
export function setBasis(cell: Cell, text: string): void {
  cell.value = text.replace(/^=+/, '');
  cell.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: ARGB.navyDark } };
  cell.alignment = { horizontal: 'left', wrapText: false };
}

/**
 * Attach a short cross-tab / provenance note as an Excel cell comment, so it
 * does not consume a row. Used for the "Sourced from X; feeds Y" notes and the
 * "values as of export, editing will not recalculate" snapshot note.
 */
export function setNote(cell: Cell, text: string): void {
  cell.note = { texts: [{ text }], margins: { insetmode: 'auto' } } as unknown as ExcelJS.Comment;
}
export function setLabel(cell: Cell, text: string, opts: { bold?: boolean; indent?: number } = {}): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size: BODY_SIZE, bold: opts.bold ?? false, color: { argb: ARGB.formula } };
  if (opts.indent) cell.alignment = { indent: opts.indent };
}
export function setTitle(cell: Cell, text: string, size = 16): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size, bold: true, color: { argb: ARGB.navyDark } };
}
export function setSectionHeader(row: ExcelJS.Row, text: string, span: number, argb: string = ARGB.navy): void {
  const c = row.getCell(1);
  c.value = text;
  c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  for (let i = 1; i <= span; i++) {
    const cell = row.getCell(i);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  }
}
export function setColHeader(cell: Cell, text: string | number, align: 'left' | 'right' | 'center' = 'right'): void {
  cell.value = text;
  cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
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
