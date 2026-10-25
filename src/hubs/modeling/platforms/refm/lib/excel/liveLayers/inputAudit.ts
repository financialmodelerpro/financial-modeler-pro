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
export function readCells(wb: ExcelJS.Workbook, onRead?: (target: string, reader: string, formula: string) => void): Set<string> {
  const read = new Set<string>();
  const re = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_&]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/g;
  // A reference with no sheet name is to the formula's own sheet (2026-10-14: the
  // live tabs write `F$107`, not `Opex!$F$107`). Text in quotes and function
  // names (a letter run followed by a bracket) are not references.
  const local = /(?<![A-Za-z0-9_.$!'])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;
  const add = (sh: string, m: RegExpMatchArray, i: number): void => {
    const c1 = colNum(m[i]), r1 = Number(m[i + 1]);
    const c2 = m[i + 2] ? colNum(m[i + 2]) : c1, r2 = m[i + 3] ? Number(m[i + 3]) : r1;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const t = cellId(sh, r, c); read.add(t); onRead?.(t, reader, formula); }
  };
  let reader = '', formula = '';
  for (const ws of wb.worksheets) ws.eachRow((row, rr) => row.eachCell((cell, cc) => {
    reader = cellId(ws.name, rr, cc);
    const v = cell.value as unknown as { formula?: string } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
    const f = v.formula.replace(/"(?:[^"]|"")*"/g, '""');
    formula = f;
    for (const m of f.matchAll(re)) add((m[1] ?? m[2]).replace(/''/g, "'"), m, 3);
    for (const m of f.replace(re, ' ').matchAll(local)) add(ws.name, m, 1);
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

/**
 * THE DEAD SWITCHES (2026-10-25, founder): inputs the live workbook holds but no formula
 * reads YET, each to be wired in when its own tab is fixed. They are the ONLY typed
 * values on Inputs allowed to go unread, and each is allowed BY NAME: the builder
 * registers the cell `deadswitch:<name>|<where>`, and `inputsUnreadProblems` fails on
 * any other unread value. Remove a name here when its tab reads it.
 */
export const DEAD_SWITCHES = {
  feeMatrix: 'fee distribution matrix (Returns)',
  openingBalance: 'facility opening balance (Financing)',
  idcCapitalise: 'facility IDC capitalise (Financing)',
  interestStart: 'facility interest start year (Financing)',
  originationYear: 'facility origination year (Financing)',
  zakatDays: 'zakat payment days (Financing)',
  reserveCap: 'statutory reserve cap (Balance Sheet)',
  // (2026-10-25: hotel and lease receivable days are LIVE inputs, never on this list:
  // Schedules builds each line's operating receivable from them, and the check protects them.)
} as const;
export type DeadSwitch = typeof DEAD_SWITCHES[keyof typeof DEAD_SWITCHES];
export const deadSwitchKey = (name: DeadSwitch, sheet: string, row: number, col: number): string => `deadswitch:${name}|${sheet}!R${row}C${col}`;

/**
 * A TYPED VALUE ON INPUTS (the founder's count): a cell right of the label column that
 * holds a number, or a shaded text choice, and is not a formula. Unshaded text is a
 * header, a label or a note.
 */
export function typedInputsCells(wb: ExcelJS.Workbook): Array<{ row: number; col: number; value: unknown }> {
  const ws = wb.getWorksheet('Inputs');
  if (!ws) return [];
  const out: Array<{ row: number; col: number; value: unknown }> = [];
  ws.eachRow((row, r) => row.eachCell((cell, c) => {
    if (c === 1) return;
    const v = cell.value as unknown;
    if (v === null || v === undefined || v === '') return;
    if (typeof v === 'object' && 'formula' in (v as object)) return;
    if (typeof v === 'string' && !isShaded(cell)) return;
    if (typeof v === 'object') return;
    out.push({ row: r, col: c, value: v });
  }));
  return out;
}

/**
 * THE INPUT CHECK, two strengths (2026-10-25).
 *   - THE EXPORT (default): every typed value on Inputs is read by a formula, the named
 *     allowances apart. It runs on every user's export, so it never blocks one for a tab
 *     that is not yet live on that model (a sheet left as values reads nothing).
 *   - STRICT (the proof, on the reference project): every value DRIVES the model. "Read" is
 *     not enough: the hotel and lease receivable days were read only by a copy on the Revenue
 *     card that nothing read, so typing them moved nothing while the export check passed. A
 *     reader counts only if a formula reads it in turn, or if it computes from something besides
 *     Inputs; a shaded blank number cell ("blank = the default") is held to it too; a text value
 *     is a label or a choice and is not. Measured on the other open projects, whose Schedules
 *     is still values, strict fails on dozens of cells, which is why the export does not run it.
 *     The receivable days have their own export rule (`receivableDaysProblems`).
 */
export function inputsUnreadProblems(wb: ExcelJS.Workbook, allowed: ReadonlySet<string>, opts: { strict?: boolean } = {}): string[] {
  const strict = opts.strict === true;
  const readers = new Map<string, Array<{ reader: string; computes: boolean }>>();
  const read = readCells(wb, (target, reader, formula) => {
    if (!target.startsWith('Inputs!')) return;
    const rest = formula.replace(/(?:'Inputs'|Inputs)!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/g, ' ');
    const computes = /[A-Za-z0-9_&']+!\$?[A-Z]+\$?\d+/.test(rest) || (!reader.startsWith('Inputs!') && /(?<![A-Za-z0-9_.$!'])\$?[A-Z]{1,3}\$?\d+(?![A-Za-z0-9_(])/.test(rest));
    (readers.get(target) ?? readers.set(target, []).get(target)!).push({ reader, computes });
  });
  const drives = (id: string): boolean => (readers.get(id) ?? []).some((x) => read.has(x.reader) || x.computes);
  const colL = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const out: string[] = [];
  const ws = wb.getWorksheet('Inputs');
  if (!ws) return out;
  ws.eachRow((row, r) => row.eachCell({ includeEmpty: true }, (cell, c) => {
    if (c === 1) return;
    const v = cell.value as unknown;
    if (v && typeof v === 'object') return;
    const empty = v === null || v === undefined || v === '';
    if (empty ? !(strict && isShaded(cell) && cell.numFmt !== '@') : !(typeof v === 'number' || isShaded(cell))) return;
    const id = cellId('Inputs', r, c);
    if (allowed.has(id)) return;
    if (!read.has(id)) out.push(`Inputs!${colL(c)}${r} (${JSON.stringify(v ?? null).slice(0, 24)}) is read by no formula`);
    else if (strict && typeof v !== 'string' && !drives(id)) out.push(`Inputs!${colL(c)}${r} (${JSON.stringify(v ?? null).slice(0, 24)}) is read only by a copy nothing reads`);
  }));
  return out;
}

/**
 * INPUTS THAT ARE INERT UNDER THIS MODEL'S SETTINGS, OR NOT YET LIVE (2026-10-25). Unlike a
 * dead switch, each is allowed only where the builder knows the condition holds, and it says
 * which: the same cell on a model where the condition fails is held to the rule. Registered
 * `inert:<name>|<where>`. A name here marks work to do or a setting that switches it off,
 * never a live input whose wiring is missing.
 */
export const INERT_INPUTS = {
  repayPeriods: 'facility repayment periods (Financing): read by nothing while the loan repays by cash sweep',
  facilityFees: 'facility upfront and commitment fees (Financing): the platform charges neither',
  openingFixedAssets: 'opening land and building NBV (Schedules): zero for a phase that is not operating at the model start, and not built live',
  growthG: 'growth g (Returns): read by nothing while the exit cap rate is typed and the exit metric is not grown',
  discountRate: 'discount rate (Returns): NPV on Returns is printed as a value, not yet a formula',
} as const;
export type InertInput = typeof INERT_INPUTS[keyof typeof INERT_INPUTS];
export const inertKey = (name: InertInput, sheet: string, row: number, col: number): string => `inert:${name}|${sheet}!R${row}C${col}`;

/**
 * HOTEL AND LEASE RECEIVABLE DAYS DRIVE THE CASH (2026-10-25, founder): wherever Schedules is
 * live, each line's days on Inputs (`rxin|<line>|arDays`) must be read by a Schedules formula,
 * its operating receivable. The export fails otherwise, so a broken wiring cannot ship.
 */
export function receivableDaysProblems(wb: ExcelJS.Workbook, cells: Array<{ sheet: string; row: number; col: number }>, schedulesLive: boolean): string[] {
  if (!schedulesLive || !cells.length) return [];
  const bySchedules = new Set<string>();
  readCells(wb, (target, reader) => { if (reader.startsWith('Schedules!')) bySchedules.add(target); });
  const colL = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  return cells.filter((a) => !bySchedules.has(cellId(a.sheet, a.row, a.col))).map((a) => `Inputs!${colL(a.col)}${a.row} (a line's receivable days) drives no receivable on Schedules`);
}
