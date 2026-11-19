/**
 * splitInputs.ts (2026-11-18, founder item 5; rebuilt cell by cell 2026-11-19, the step 3 review)
 *
 * THE INPUTS TAB BECOMES TWO, "Project Inputs" and "Operating Inputs", in the training model's layout. It runs on
 * the finished workbook (after the reference layout and the Dashboard), so no layer knows: every cell of Inputs
 * moves to its tab, row AND column, and every reference to it follows, in every formula of the workbook, every
 * defined name, validation, conditional format and internal link, and in the cell registry (the returned move).
 *
 *   Project Inputs: 1 General and timeline, 2 Land and plots, 3 Asset types and build rates, 4 Development costs,
 *   5 Construction phasing (the % grid, then the timing rules as sentences), 6 Funding (with the lender covenants),
 *   7 Zakat (or tax) and depreciation, 8 Exit, discount rates and fund terms, 9 Dashboard and model settings.
 *   Operating Inputs: A Residential (one column per sell line, then the grids), B Hospitality (revenue, a
 *   Line | Basis | Rate cost table, the occupancy grid), C Retail (one column per lease line, then occupancy),
 *   D Working capital (receivable and payable days per line).
 *
 * EVERY ROW READS LABEL (C), UNIT (D), INPUT (E), NOTES AFTER. A table keeps its columns and carries its units on a
 * row under its head. A cell a formula reads but nobody types (a land payment window, an opex line's "On") moves to
 * a HIDDEN helper column on the row of the sentence that states it, so the model reads what it read and the reader
 * sees a sentence. A range a formula reads must land as a translated rectangle (or a one-dimensional line, which
 * INDEX and SUM read the same either way); anything else THROWS, as does a read cell the layout does not place.
 *
 * Anything this file does not recognise is laid out generically in its section, never dropped while a formula
 * reads it or a user types it.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

export const PROJECT_INPUTS = 'Project Inputs';
export const OPERATING_INPUTS = 'Operating Inputs';
const SRC = 'Inputs';
const BAR = 'FF1B4F8A';
const END_FILL = 'FF153D64';
const INPUT_FILL = 'FFFFF2CC';
const NOTE = 'FF5A6675';
const INK = 'FF2A3440';
/** The first hidden helper column (AN). Nothing a reader needs is ever here. */
const HID = 40;

const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const quote = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const unquote = (q: string): string => (q.startsWith("'") ? q.slice(1, -1).replace(/''/g, "'") : q);
const REF = /(?<![A-Za-z0-9_.$!'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(!])/g;
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && 'richText' in (v as object)) ? (v as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join('').trim() : '');
const txt = (c: ExcelJS.Cell): string => textOf(c.value);
const fillOf = (c: { fill?: unknown } | undefined): string | undefined => ((c?.fill as { fgColor?: { argb?: string }; pattern?: string } | undefined)?.pattern === 'solid' ? (c?.fill as { fgColor?: { argb?: string } }).fgColor?.argb : undefined);
const K = (r: number, c: number): string => `${r}:${c}`;

export interface SplitMove { sheet: string; r: number; c: number }
export interface SplitResult { move(sheet: string, r: number, c: number): SplitMove | null }

interface Block { section: string; sub: string | null; rows: number[] }
interface CellSnap { value: ExcelJS.CellValue; style: Partial<ExcelJS.Style>; dv?: ExcelJS.DataValidation }

// ── The output plan ─────────────────────────────────────────────────────────────
type Style = Partial<ExcelJS.Style>;
interface OCell {
  /** The source cell whose content (and address) lands here. */
  from?: [number, number];
  /** The address lands here and the content does not (a decoration inside a range a formula reads). */
  ghost?: boolean;
  value?: ExcelJS.CellValue;
  style?: Style;
  /** A formula written by this file, already in the new tab's addresses: never rewritten. */
  final?: boolean;
}
type RowKind = 'data' | 'head' | 'unit' | 'note' | 'blank' | 'sub' | 'bar';
class ORow {
  cells = new Map<number, OCell>();
  constructor(public kind: RowKind = 'data', public height?: number) {}
  set(c: number, cell: OCell): this { this.cells.set(c, cell); return this; }
}
interface OSub { title?: string; rows: ORow[] }
interface OGroup { sheet: string; key: string; title: string; subs: OSub[] }

const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Calibri', size: 9, color: { argb: 'FF000000' }, ...o });
const S_LABEL: Style = { font: font() };
const S_UNIT: Style = { font: font({ color: { argb: INK } }), alignment: { horizontal: 'left' } };
const S_NOTE: Style = { font: font({ italic: true, color: { argb: NOTE } }) };
const S_HEAD = (left: boolean): Style => ({ font: font({ bold: true, color: { argb: 'FFFFFFFF' } }), fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } } as ExcelJS.Fill, alignment: { horizontal: left ? 'left' : 'center', vertical: 'middle', wrapText: true } });
const S_UNITROW: Style = { font: font({ italic: true, color: { argb: NOTE } }), alignment: { horizontal: 'center' } };
const S_FORMULA: Style = { font: font(), alignment: { horizontal: 'center' } };

/** A label and the unit it carried in brackets or a suffix, apart. */
function splitUnit(raw: string): { label: string; unit?: string; note?: string } {
  let s = raw.trim();
  let unit: string | undefined; let note: string | undefined;
  const UNIT_WORDS: Array<[RegExp, string]> = [
    [/^(sqm|m2)$/i, 'sqm'], [/^sar\s*\/\s*sqm$/i, 'SAR / sqm'], [/^x$/i, 'x'], [/^%$/, '%'], [/^years?$/i, 'years'], [/^year$/i, 'year'],
    [/^days$/i, 'days'], [/^1 = yes$/i, '1 = yes'], [/^date$/i, 'date'], [/^sqm per slot$/i, 'sqm'],
  ];
  s = s.replace(/\s*\(([^()]*)\)/g, (all, inner: string) => {
    const t = inner.trim();
    for (const [re, u] of UNIT_WORDS) if (re.test(t)) { unit = unit ?? (u === 'years' && /^year$/i.test(t) ? 'year' : u); return ''; }
    if (/^blank\b/i.test(t)) { note = note ?? `${t[0].toUpperCase()}${t.slice(1)}.`; return ''; }
    return all;
  });
  // "Cash %", "Debt share %", "Rate %".
  if (/\s%$/.test(s)) { unit = unit ?? '%'; s = s.replace(/\s%$/, ''); }
  // "Price Indexation: rate %" style.
  const colon = /^(.*):\s*(.+)$/.exec(s);
  if (colon && /^%|^rate %$/i.test(colon[2])) { unit = unit ?? '%'; s = colon[1]; }
  return { label: s.trim(), unit, note };
}

function normTitle(s: string): string { return s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
/** "Phase 1, Branded Apartments (Land 1 + Land 2)" -> "P1 Branded Apartments". */
function shortLine(s: string): string { return s.replace(/\s*\([^)]*\)/g, '').replace(/^Phase (\d+),\s*/, 'P$1 ').replace(/\s+/g, ' ').trim(); }

/** Where a block of the old tab goes: its tab and its group (in each tab's order). */
function groupOf(section: string, sub: string | null, zakat: boolean): { sheet: string; key: string; title: string } {
  const P = (key: string, title: string) => ({ sheet: PROJECT_INPUTS, key, title });
  const O = (key: string, title: string) => ({ sheet: OPERATING_INPUTS, key, title });
  const s = section.toLowerCase(); const u = (sub ?? '').toLowerCase();
  if (s === 'project' || s === 'parties') return P('1', 'General and timeline');
  if (s.startsWith('assets & sub-units')) return P('2', 'Land and plots');
  if (s.startsWith('asset types')) return /soft costs/.test(u) ? P('4', 'Development costs') : P('3', 'Asset types and build rates');
  if (s.startsWith('capex')) return P('5', 'Construction phasing');
  if (s.startsWith('financing')) return P('6', 'Funding');
  if (s.startsWith('returns') && /lender covenants/.test(u)) return P('6', 'Funding');
  if (s.startsWith('financial statement')) return P('7', zakat ? 'Zakat and depreciation' : 'Tax and depreciation');
  if (s.startsWith('returns') || s.startsWith('fund')) return P('8', 'Exit, discount rates and fund terms');
  if (s.startsWith('dashboard')) return P('9', 'Dashboard and model settings');
  if (s.startsWith('revenue')) {
    if (/\(operate\)/.test(u)) return O('B', 'Hospitality');
    if (/^lease lines/.test(u)) return O('C', 'Retail');
    return O('A', 'Residential');
  }
  if (s.startsWith('opex')) {
    if (/accounts payable|dpo/.test(u)) return O('D', 'Working capital');
    if (/lease lines/.test(u)) return O('C', 'Retail');
    return O('B', 'Hospitality');
  }
  return P('8x', section);
}

/** The sections and sub-sections of the old tab, read off the reference layout's bars and numbered headings. */
function readBlocks(ws: ExcelJS.Worksheet): { titleRows: number[]; blocks: Block[]; endRow: number } {
  const bars: Array<{ row: number; name: string }> = [];
  let endRow = 0;
  ws.eachRow((row, r) => {
    const b = row.getCell(2);
    const t = txt(b);
    if (t === 'End of sheet') { endRow = r; return; }
    const m = /^\d+\.\s+(.+)$/.exec(t);
    if (m && fillOf(b) === BAR) bars.push({ row: r, name: m[1].trim() });
  });
  if (!bars.length || !endRow) throw new Error('splitInputs: Inputs has no numbered sections or no End of sheet');
  const empty = (r: number): boolean => { let e = true; ws.getRow(r).eachCell((c) => { if (c.value !== null && c.value !== undefined && c.value !== '') e = false; }); return e; };
  const trim = (rows: number[]): number[] => { let a = 0, b = rows.length; while (a < b && empty(rows[a])) a++; while (b > a && empty(rows[b - 1])) b--; return rows.slice(a, b); };
  const blocks: Block[] = [];
  bars.forEach((bar, i) => {
    const end = (bars[i + 1]?.row ?? endRow) - 1;
    const subs: Array<{ row: number; name: string }> = [];
    for (let r = bar.row + 1; r <= end; r++) { const t = txt(ws.getCell(r, 3)); const m = /^\d+\.\d+\s+(.+)$/.exec(t); if (m) subs.push({ row: r, name: m[1].trim() }); }
    const pre = trim(Array.from({ length: Math.max(0, (subs[0]?.row ?? end + 1) - bar.row - 1) }, (_, k) => bar.row + 1 + k));
    if (pre.length) blocks.push({ section: bar.name, sub: null, rows: pre });
    subs.forEach((s, k) => {
      const last = (subs[k + 1]?.row ?? end + 1) - 1;
      // The sub-heading row itself is the new layout's to write.
      const rows = trim(Array.from({ length: last - s.row }, (_, j) => s.row + 1 + j));
      if (rows.length) blocks.push({ section: bar.name, sub: s.name, rows });
    });
  });
  const titleRows = Array.from({ length: bars[0].row - 1 }, (_, k) => k + 1);
  return { titleRows, blocks, endRow };
}

export function splitInputs(wb: ExcelJS.Workbook): SplitResult | null {
  const src = wb.getWorksheet(SRC);
  if (!src) return null;
  let zakat = false;
  src.eachRow((row) => row.eachCell((c) => { if (/zakat/i.test(txt(c))) zakat = true; }));
  const { titleRows, blocks, endRow } = readBlocks(src);

  // ── Snapshot the old tab ──────────────────────────────────────────────────────
  const snap = new Map<string, CellSnap>();
  const heights = new Map<number, number | undefined>();
  let srcLastCol = 1;
  src.eachRow({ includeEmpty: true }, (row, r) => {
    heights.set(r, row.height);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      snap.set(K(r, col), { value: c.value, style: JSON.parse(JSON.stringify(c.style ?? {})), dv: c.dataValidation ? JSON.parse(JSON.stringify(c.dataValidation)) : undefined });
      if (c.value !== null && c.value !== undefined && c.value !== '') srcLastCol = Math.max(srcLastCol, col);
    });
  });
  const val = (r: number, c: number): ExcelJS.CellValue => snap.get(K(r, c))?.value ?? null;
  const str = (r: number, c: number): string => textOf(val(r, c));
  const isInput = (r: number, c: number): boolean => fillOf(snap.get(K(r, c))?.style) === INPUT_FILL;
  const hasVal = (r: number, c: number): boolean => { const v = val(r, c); return v !== null && v !== undefined && v !== ''; };
  const numFmtOf = (r: number, c: number): string => String(snap.get(K(r, c))?.style?.numFmt ?? '');
  const numOf = (r: number, c: number): number | undefined => { const v = val(r, c) as unknown; const x = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v; return typeof x === 'number' ? x : undefined; };
  const rowCells = (r: number): number[] => { const out: number[] = []; for (let c = 1; c <= srcLastCol; c++) if (hasVal(r, c) || isInput(r, c) || read.has(K(r, c))) out.push(c); return out; };
  const isHeadRow = (r: number): boolean => fillOf(snap.get(K(r, 3))?.style) === BAR;
  const emptyRow = (r: number): boolean => rowCells(r).length === 0;

  // ── Every cell any formula, name, validation or format of the workbook reads ──────
  const read = new Set<string>();
  const ranges: Array<{ r1: number; c1: number; r2: number; c2: number; where: string; formula: string }> = [];
  const scan = (f: string, own: string, where: string): void => {
    f.split(/("(?:[^"]|"")*")/).forEach((seg, i) => {
      if (i % 2 === 1) return;
      for (const m of seg.matchAll(REF)) {
        if ((m[1] ? unquote(m[1].slice(0, -1)) : own) !== SRC) continue;
        const r1 = Number(m[5]), c1 = colNum(m[3]); const r2 = m[9] ? Number(m[9]) : r1, c2 = m[7] ? colNum(m[7]) : c1;
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) read.add(K(r, c));
        if (m[9]) ranges.push({ r1, c1, r2, c2, where, formula: f });
      }
    });
  };
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && typeof v.formula === 'string') scan(v.formula, ws.name, `${ws.name}!${c.address}`); }));
  for (const n of (wb.definedNames as unknown as { model: Array<{ ranges: string[] }> }).model) for (const rg of n.ranges) scan(rg, '', 'a defined name');
  const isRead = (r: number, c: number): boolean => read.has(K(r, c));

  let ccy = 'SAR';
  for (const b of blocks) for (const r of b.rows) if (str(r, 3) === 'Currency' && str(r, 4)) ccy = str(r, 4);

  // ── The plan ──────────────────────────────────────────────────────────────────
  /** Source cells some builder has placed (or deliberately consumed), so no other builder places them again. */
  const claimed = new Set<string>();
  const claim = (r: number, c: number): void => { claimed.add(K(r, c)); };
  const free = (r: number, c: number): boolean => !claimed.has(K(r, c));
  const mv = (r: number, c: number): OCell => { claim(r, c); return { from: [r, c] }; };
  const ghost = (r: number, c: number): OCell => { claim(r, c); return { from: [r, c], ghost: true }; };
  const lit = (value: ExcelJS.CellValue, style: Style = S_LABEL): OCell => ({ value, style });
  const note = (text: string): OCell => lit(text, S_NOTE);
  /** A row's helper cells: a value a formula reads that a reader does not type. */
  const hide = (row: ORow, r: number, c: number): void => { let k = HID; while (row.cells.has(k)) k++; row.set(k, mv(r, c)); };
  const blank = (): ORow => new ORow('blank');
  const noteRow = (text: string): ORow => new ORow('note').set(3, note(text));

  /** A scalar row: label in C, unit in D, the value in E, notes after. */
  const scalar = (label: string, unit: string | undefined, valueCell: OCell | undefined, notes: OCell[] = []): ORow => {
    const row = new ORow('data').set(3, lit(label));
    if (unit) row.set(4, lit(unit, S_UNIT));
    if (valueCell) row.set(5, valueCell);
    notes.forEach((n, i) => row.set(6 + i, n));
    return row;
  };
  const unitFor = (label: string, r: number, c: number): string | undefined => {
    const fmt = numFmtOf(r, c); const n = numOf(r, c);
    if (/dd|yy|mmm/i.test(fmt) || val(r, c) instanceof Date) return 'date';
    if (/year$/i.test(label) || /\(year\)/i.test(label)) return 'year';
    if (/\bdays?\b/i.test(label) && n !== undefined) return 'days';
    if (/years$/i.test(label) && n !== undefined) return 'years';
    if (fmt.includes('%')) return '%';
    if (n !== undefined && Number.isInteger(n) && n >= 1900 && n <= 2200 && /^0$/.test(fmt)) return 'year';
    if (/^0\.00/.test(fmt) && n !== undefined) return 'x';
    if (n !== undefined && Math.abs(n) >= 1000) return ccy;
    return undefined;
  };
  const LABEL_UNIT: Array<[RegExp, string, string | undefined]> = [
    [/^Zakat payment$|^Tax payment$/, '$&', 'days'],
    [/^Days per year$/i, 'Days open per year', 'days'],
    [/^Share capital$/, 'Share capital', '@ccy'],
    [/^Construction cost escalation$/, 'Construction cost escalation', '% p.a.'],
    [/^Growth g$/, 'Growth after exit (g)', '% p.a.'],
    [/^Dividends paid$/, 'Dividends paid', '1 = yes'],
    [/^Sweep starting year$/, 'Sweep starting year', 'year'],
    [/^Dividend start year$/, 'Dividend start year', 'year'],
    [/^Exit Year$/, 'Exit year', 'year'],
    [/^Discount Rate$/, 'Discount rate', '%'],
    [/^Cost of equity$/, 'Cost of equity', '%'],
    [/^Exit Cap Rate$/, 'Exit cap rate', '%'],
    [/^Zakat Rate$/, 'Zakat rate', '%'],
    [/^Tax Rate$/, 'Tax rate', '%'],
  ];
  /** The generic layout of a run of rows: tables keep their columns (units on a row under the head), the rest are scalar rows. */
  const generic = (rows: number[], opts: { headRename?: Record<string, string>; skipCols?: number[]; cellText?: (head: string, text: string) => string; headUnit?: Record<string, string> } = {}): ORow[] => {
    let heads0 = new Map<number, string>();
    const out: ORow[] = [];
    let table: Map<number, number> | null = null;
    let tableRows: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (emptyRow(r) || rowCells(r).every((c) => !free(r, c))) {
        if (emptyRow(r)) { table = null; if (out.length && out[out.length - 1].kind !== 'blank') out.push(blank()); }
        continue;
      }
      if (isHeadRow(r)) {
        // The table's rows: until a blank row or the next head.
        tableRows = [];
        for (let j = i + 1; j < rows.length && !emptyRow(rows[j]) && !isHeadRow(rows[j]); j++) tableRows.push(rows[j]);
        const heads = rowCells(r).filter((c) => c >= 3 && !(opts.skipCols ?? []).includes(c));
        // A column no data row fills (or types, or a formula reads) goes.
        const kept = heads.filter((c) => c === 3 || tableRows.some((tr) => free(tr, c) && (hasVal(tr, c) || isInput(tr, c) || isRead(tr, c))));
        table = new Map(); let to = 3;
        for (const c of kept) { table.set(c, c === 3 ? 3 : ++to); }
        const head = new ORow('head'); const units = new ORow('unit'); let anyUnit = false;
        for (const c of heads) { claim(r, c); if (isRead(r, c) && !kept.includes(c)) head.set(HID + c, ghost(r, c)); }
        for (const c of kept) {
          const raw = opts.headRename?.[str(r, c)] ?? str(r, c);
          const { label, unit: u0 } = splitUnit(raw);
          const unit = u0 ?? opts.headUnit?.[label];
          heads0.set(c, label);
          head.set(table.get(c)!, { ...(isRead(r, c) ? { from: [r, c] as [number, number] } : {}), value: label, style: S_HEAD(c === 3) });
          if (unit) { units.set(table.get(c)!, lit(unit, S_UNITROW)); anyUnit = true; }
        }
        out.push(head);
        if (anyUnit) out.push(units);
        continue;
      }
      if (table) {
        const row = new ORow('data');
        for (const c of rowCells(r)) {
          if (!free(r, c)) continue;
          const to = table.get(c);
          const t = opts.cellText && typeof val(r, c) === 'string' && !isRead(r, c) && !isInput(r, c) ? opts.cellText(heads0.get(c) ?? '', str(r, c)) : undefined;
          if (to !== undefined) row.set(to, t !== undefined ? { ...mv(r, c), value: t } : mv(r, c));
          else if (isRead(r, c) || isInput(r, c)) hide(row, r, c);
          else claim(r, c);
        }
        if (row.cells.size) out.push(row);
        continue;
      }
      // A scalar row.
      const row = new ORow('data');
      const raw = str(r, 3);
      let { label, unit, note: n } = splitUnit(raw);
      for (const [re, to, u] of LABEL_UNIT) if (re.test(label)) { label = label.replace(re, to); unit = u === '@ccy' ? ccy : u ?? unit; break; }
      if (raw) { claim(r, 3); row.set(3, isRead(r, 3) ? { from: [r, 3], value: label } : lit(label)); }
      if (!unit && free(r, 4)) unit = unitFor(raw, r, 4);
      if (unit) row.set(4, lit(unit, S_UNIT));
      for (const c of rowCells(r)) { if (c < 4 || !free(r, c)) continue; row.set(c + 1, mv(r, c)); }
      if (n && !row.cells.has(6)) row.set(6, note(n));
      if (row.cells.size) out.push(row);
    }
    while (out.length && out[out.length - 1].kind === 'blank') out.pop();
    return out;
  };
  const findRow = (rows: number[], re: RegExp, col = 3): number | undefined => rows.find((r) => re.test(str(r, col)));
  const bySub = (re: RegExp, sec?: RegExp): Block[] => blocks.filter((b) => re.test(b.sub ?? '') && (!sec || sec.test(b.section)));

  // Facts the builders share.
  const landBlock = bySub(/^Land and plots$/)[0];
  let hasRetailStrip = false;
  if (landBlock) {
    const head = landBlock.rows.find(isHeadRow);
    const col = head ? rowCells(head).find((c) => /^Retail/i.test(str(head, c))) : undefined;
    if (head && col) for (const r of landBlock.rows) if (r > head && (numOf(r, col) ?? 0) > 0) hasRetailStrip = true;
  }
  /** Sub-unit rows per line (Project Inputs 2.3): a line's only row lends its rate to the operating block. */
  const subUnitBlock = bySub(/^Sub-units/)[0];
  const subUnitRate = new Map<string, { r: number; rateCol: number; basisCol?: number }>();
  if (subUnitBlock) {
    const head = subUnitBlock.rows.find(isHeadRow);
    if (head) {
      const rateCol = rowCells(head).find((c) => /^Rate\b/i.test(str(head, c)) && !/basis/i.test(str(head, c)));
      const basisCol = rowCells(head).find((c) => /^Rate Basis/i.test(str(head, c)));
      const count = new Map<string, number[]>();
      for (const r of subUnitBlock.rows) { if (r <= head || !str(r, 3)) continue; const k = normTitle(str(r, 3)); count.set(k, [...(count.get(k) ?? []), r]); }
      if (rateCol) for (const [k, rs] of count) if (rs.length === 1) subUnitRate.set(k, { r: rs[0], rateCol, basisCol });
    }
  }
  const takeRate = (title: string): { cell: OCell; basis: string } | undefined => {
    const s = subUnitRate.get(normTitle(title));
    if (!s || !hasVal(s.r, s.rateCol) && !isInput(s.r, s.rateCol)) return undefined;
    const basis = s.basisCol ? str(s.r, s.basisCol) : '';
    if (s.basisCol) claim(s.r, s.basisCol);
    return { cell: mv(s.r, s.rateCol), basis };
  };

  const groups: OGroup[] = [];
  const group = (sheet: string, key: string, title: string): OGroup => {
    let g = groups.find((x) => x.sheet === sheet && x.key === key);
    if (!g) { g = { sheet, key, title, subs: [] }; groups.push(g); }
    return g;
  };

  // ════ OPERATING INPUTS (built first: it claims cells that sit on Project Inputs today) ════
  const sellBlocks = blocks.filter((b) => /^revenue/i.test(b.section) && b.rows.some((r) => /^Pre-Sales velocity/i.test(str(r, 3))));
  const operateBlocks = blocks.filter((b) => /^revenue/i.test(b.section) && /\(Operate\)\s*$/i.test(b.sub ?? ''));
  const leaseBlock = blocks.find((b) => /^revenue/i.test(b.section) && /^Lease lines/i.test(b.sub ?? ''));
  const commissionBlock = blocks.find((b) => /^revenue/i.test(b.section) && /^Sales commission terms/i.test(b.sub ?? ''));
  const softBlock = bySub(/soft costs/i, /^asset types/i)[0];
  const capexLinesBlock = blocks.find((b) => /^capex/i.test(b.section) && b.rows.some((r) => isHeadRow(r) && /^(Cost line|Timing exceptions)/.test(str(r, 3))));
  const inflationBlock = blocks.find((b) => /^opex/i.test(b.section) && /^Opex inflation/i.test(b.sub ?? ''));
  const dpoBlock = blocks.find((b) => /^opex/i.test(b.section) && /accounts payable|dpo/i.test(b.sub ?? ''));
  const leaseOpexBlock = blocks.find((b) => /^opex/i.test(b.section) && /lease lines/i.test(b.sub ?? ''));
  const statementBlock = blocks.find((b) => /^financial statement/i.test(b.section) && /^P&L Inputs/i.test(b.sub ?? ''));
  const dsoRow = statementBlock ? findRow(statementBlock.rows, /^Receivable days|^Operating receivables/i) : undefined;
  /** Receivable days per line, found in the revenue blocks: line title -> source cell. */
  const arCells: Array<{ title: string; r: number; c: number }> = [];
  const commissionSentenceAt = { sub: '' };
  const SETTING = /^(Price Indexation|Revenue Recognition|Recognition year|Sale cohort|Downpayment|Max instalment|Instalments)/i;

  // ── A. Residential ──
  if (sellBlocks.length) {
    const g = group(OPERATING_INPUTS, 'A', 'Residential');
    const lines = sellBlocks.map((b) => ({ b, title: b.sub ?? '', short: shortLine(b.sub ?? '') }));
    const n = lines.length;
    const terms: ORow[] = [];
    const head = new ORow('head').set(3, lit('Item', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false)));
    lines.forEach((l, i) => head.set(5 + i, lit(l.short, S_HEAD(false))));
    terms.push(head);
    const perLine = (label: string, unit: string | undefined, cellOf: (l: typeof lines[number], i: number) => OCell | undefined, notes: OCell[] = []): void => {
      const cells = lines.map((l, i) => cellOf(l, i));
      if (cells.every((c) => !c)) return;
      const row = new ORow('data').set(3, lit(label));
      if (unit) row.set(4, lit(unit, S_UNIT));
      cells.forEach((c, i) => { if (c) row.set(5 + i, c); });
      notes.forEach((x, k) => row.set(5 + n + k, x));
      terms.push(row);
    };
    const at = (l: typeof lines[number], re: RegExp): OCell | undefined => { const r = findRow(l.b.rows, re); return r !== undefined && (hasVal(r, 4) || isInput(r, 4) || isRead(r, 4)) ? mv(r, 4) : undefined; };
    // Sale price: the line's only sub-unit's rate.
    let priceBasis = '';
    perLine('Sale price', undefined, (l) => { const t = takeRate(l.title); if (t) priceBasis = priceBasis || t.basis; return t?.cell; });
    if (terms.length > 1 && terms[terms.length - 1].cells.get(3)?.value === 'Sale price') terms[terms.length - 1].set(4, lit(/unit/i.test(priceBasis) ? `${ccy} / unit` : `${ccy} / sqm NSA`, S_UNIT));
    perLine('Sale price growth', '% p.a.', (l) => at(l, /^Price Indexation: rate/i));
    perLine('Sale price growth from', 'year', (l) => at(l, /^Price Indexation: start year/i));
    perLine('Maximum instalment years after a pre-sale', 'years', (l) => at(l, /^Max instalment years/i));
    perLine('Instalments', undefined, (l) => at(l, /^Instalments$/i));
    // Marketing and commission are ONE rate on the platform (a cost standard, a capex line): typed once, read by every line.
    const oneRate = (label: string, unit: string, r: number | undefined, c: number): void => {
      if (r === undefined || !free(r, c)) return;
      const row = new ORow('data').set(3, lit(label)).set(4, lit(unit, S_UNIT)).set(5, mv(r, c));
      const rowIdx = terms.length; void rowIdx;
      for (let i = 1; i < n; i++) row.set(5 + i, { value: { formula: `$E$@ROW@` } as unknown as ExcelJS.CellValue, style: S_FORMULA, final: true });
      if (n > 1) row.set(5 + n, note('One rate for every residential line.'));
      terms.push(row);
    };
    const mkRow = softBlock ? findRow(softBlock.rows, /^Marketing$/i) : undefined;
    oneRate('Marketing (expensed as sold)', '% of sale value', mkRow, 5);
    if (mkRow !== undefined) { claim(mkRow, 3); claim(mkRow, 4); }
    const commRow = capexLinesBlock ? findRow(capexLinesBlock.rows, /^Sales commission$/i) : undefined;
    oneRate('Sales commission (expensed as sold)', '% of sale value', commRow, 5);
    const commTerm = (l: typeof lines[number], col: number): OCell | undefined => {
      if (!commissionBlock) return undefined;
      const r = commissionBlock.rows.find((x) => normTitle(str(x, 3)) === normTitle(l.title));
      if (r === undefined) return undefined;
      claim(r, 3);
      return hasVal(r, col) || isInput(r, col) || isRead(r, col) ? mv(r, col) : undefined;
    };
    perLine('Commission paid on contract', '%', (l) => commTerm(l, 4));
    perLine('Commission remainder paid', undefined, (l) => commTerm(l, 5));
    if (commissionBlock) for (const r of commissionBlock.rows) if (isHeadRow(r)) for (const c of rowCells(r)) claim(r, c);
    g.subs.push({ title: 'Sale terms by line', rows: terms });
    commissionSentenceAt.sub = 'A.1';
    // Recognition, in words.
    const rec = lines.map((l) => { const a = findRow(l.b.rows, /^Revenue Recognition$/i); const y = findRow(l.b.rows, /^Recognition year$/i); if (a !== undefined) { claim(a, 3); claim(a, 4); } if (y !== undefined) { claim(y, 3); claim(y, 4); } return a !== undefined ? `${str(a, 4)}|${y !== undefined ? str(y, 4) : ''}` : ''; });
    if (rec.every((x) => x && x === rec[0])) {
      const [how, when] = rec[0].split('|');
      terms.push(noteRow(/point/i.test(how) && /handover/i.test(when) ? 'Revenue is recognised at handover. Pre-sale balances are paid in instalments up to the maximum years above.' : `Revenue recognition: ${how}${when ? `, ${when.toLowerCase()}` : ''}.`));
    }
    for (const l of lines) for (const r of l.b.rows) if (/^Price Indexation: method$/i.test(str(r, 3))) { claim(r, 3); claim(r, 4); }

    // The grids: one row per line (per sub-unit row where a line has several), years across, values from F.
    const grid: ORow[] = [];
    const gridRows = (l: typeof lines[number], headRe: RegExp): number[] => {
      const h = findRow(l.b.rows, headRe); if (h === undefined) return [];
      for (const c of rowCells(h)) claim(h, c);
      const out: number[] = [];
      // A grid's rows are its sub-units' rows: they hold a number in the first year, and the line's settings follow.
      for (const r of l.b.rows) { if (r <= h) continue; if (emptyRow(r) || isHeadRow(r) || (numOf(r, 4) === undefined && !isInput(r, 4)) || str(r, 3).includes(':') || SETTING.test(str(r, 3))) break; out.push(r); }
      return out;
    };
    const yearsIn = (l: typeof lines[number], headRe: RegExp): number => { const h = findRow(l.b.rows, headRe); if (h === undefined) return 0; return rowCells(h).filter((c) => c >= 4 && /\d+$/.test(str(h, c))).length; };
    const valueRow = (label: string, unit: string, r: number, check?: (row: ORow) => void): ORow => {
      const row = new ORow('data').set(3, lit(label)).set(4, lit(unit, S_UNIT));
      claim(r, 3);
      for (let c = 4; c <= srcLastCol; c++) { if (!free(r, c)) continue; if (hasVal(r, c) || isInput(r, c)) row.set(c + 2, mv(r, c)); else if (isRead(r, c)) row.set(c + 2, ghost(r, c)); }
      check?.(row);
      return row;
    };
    const yearHead = (label: string, third: string, nYears: number): ORow => {
      const h = new ORow('head').set(3, lit(label, S_HEAD(true))).set(4, lit('Unit', S_HEAD(false))).set(5, lit(third, S_HEAD(false)));
      for (let k = 1; k <= nYears; k++) h.set(5 + k, lit(k, S_HEAD(false)));
      return h;
    };
    const nCon = Math.max(0, ...lines.map((l) => Math.max(yearsIn(l, /^Pre-Sales velocity/i), yearsIn(l, /^Sale cohort terms/i))));
    const nOps = Math.max(0, ...lines.map((l) => yearsIn(l, /^Sales During Operation/i)));
    const suffix = (l: typeof lines[number], rs: number[], r: number): string => (rs.length > 1 ? `${l.short}, ${str(r, 3)}` : l.short);
    grid.push(yearHead('Construction year (residential pre-sales)', '', nCon));
    const preRowsOf = new Map<string, ORow[]>();
    for (const l of lines) { const rs = gridRows(l, /^Pre-Sales velocity/i); const made = rs.map((r) => valueRow(`Pre-sales: ${suffix(l, rs, r)}`, '% of NSA', r)); preRowsOf.set(l.title, made); grid.push(...made); }
    for (const l of lines) {
      const h = findRow(l.b.rows, /^Sale cohort terms/i); if (h !== undefined) for (const c of rowCells(h)) claim(h, c);
      const r = findRow(l.b.rows, /^Downpayment/i);
      if (r !== undefined) grid.push(valueRow(`Downpayment on pre-sales: ${l.short}`, '% of price', r));
    }
    grid.push(noteRow("Columns are construction years of each residential line's phase."));
    grid.push(blank());
    grid.push(yearHead('Operating year (residential sales after handover)', 'Check', nOps));
    const checks: Array<{ row: ORow; pre: ORow | undefined }> = [];
    for (const l of lines) {
      const rs = gridRows(l, /^Sales During Operation/i);
      const pres = preRowsOf.get(l.title) ?? [];
      rs.forEach((r, k) => { const row = valueRow(`Sales after handover: ${suffix(l, rs, r)}`, '% of NSA', r); checks.push({ row, pre: rs.length === pres.length ? pres[k] : undefined }); grid.push(row); });
    }
    for (const ch of checks) if (ch.pre) ch.row.set(5, { value: { formula: `@CHECK@` } as unknown as ExcelJS.CellValue, style: S_FORMULA, final: true });
    grid.push(noteRow('Check: pre-sales plus sales after handover add to 100% of each line.'));
    g.subs.push({ title: 'Pre-sales and sales after handover', rows: grid });
    (g as OGroup & { checks?: typeof checks }).checks = checks;
  }

  // Opex inflation: one rate for the hotel and the retail lines' fixed-amount costs.
  let inflationNote: ((rowOf: (cell: OCell) => string | undefined) => OCell) | undefined;
  const inflationRows: ORow[] = [];
  if (inflationBlock) {
    const head = inflationBlock.rows.find(isHeadRow);
    const data = inflationBlock.rows.filter((r) => head !== undefined && r > head && !emptyRow(r));
    if (head !== undefined && data.length === 1) {
      const r = data[0];
      const hc = rowCells(head);
      const rateCol = hc.find((c) => /^Rate/i.test(str(head, c)));
      const fromCol = hc.find((c) => /from/i.test(str(head, c)));
      for (const c of rowCells(head)) claim(head, c);
      claim(r, 3); for (const c of rowCells(r)) if (c !== rateCol && c !== fromCol) claim(r, c);
      const rate = rateCol ? mv(r, rateCol) : undefined;
      const from = fromCol ? mv(r, fromCol) : undefined;
      const rr = scalar('Opex inflation, fixed-amount lines', '% p.a.', rate, [note('Lines charged as a % of revenue move with revenue.')]);
      inflationRows.push(rr);
      const fr = scalar('Inflation counted from', 'year', from);
      if (from) inflationRows.push(fr);
      inflationNote = () => ({ value: { formula: '@INFL@' } as unknown as ExcelJS.CellValue, style: S_NOTE, final: true });
      (inflationRows as ORow[] & { rateRow?: ORow; fromRow?: ORow }).rateRow = rr;
      (inflationRows as ORow[] & { rateRow?: ORow; fromRow?: ORow }).fromRow = from ? fr : undefined;
    }
  }
  /** An opex line table as Line | Basis | Rate (one rate column per line where the table carries several). */
  const opexRows = (b: Block, lineCols?: Array<{ col: number; to: number }>): ORow[] => {
    const head = b.rows.find(isHeadRow); if (head === undefined) return [];
    const hc = rowCells(head);
    const modeCol = hc.find((c) => /^Mode$/i.test(str(head, c)));
    const valueCol = hc.find((c) => /^Value$/i.test(str(head, c)));
    const onCol = hc.find((c) => /^On$/i.test(str(head, c)));
    for (const c of hc) claim(head, c);
    const out: ORow[] = [];
    for (const r of b.rows) {
      if (r <= head || emptyRow(r) || isHeadRow(r)) continue;
      const row = new ORow('data').set(3, mv(r, 3));
      const mode = modeCol ? str(r, modeCol) : '';
      if (modeCol) { claim(r, modeCol); row.set(4, lit(mode.replace(/^Per (Key|SQM|Unit) per Year$/i, (_a, w: string) => `${ccy} / ${w.toLowerCase() === 'sqm' ? 'sqm' : w.toLowerCase()} / yr`).replace(/ Revenue$/, ' revenue'), S_UNIT)); }
      let next = 5;
      if (lineCols) for (const lc of lineCols) { if (hasVal(r, lc.col) || isInput(r, lc.col) || isRead(r, lc.col)) row.set(lc.to, mv(r, lc.col)); next = Math.max(next, lc.to + 1); }
      else if (valueCol) { row.set(5, mv(r, valueCol)); next = 6; }
      if (onCol) hide(row, r, onCol);
      // A fixed amount inflates; a share of revenue moves with revenue.
      if (/^Per /i.test(mode) && inflationNote) row.set(next, inflationNote(() => undefined));
      for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c) || isInput(r, c)) hide(row, r, c); else claim(r, c); }
      out.push(row);
    }
    return out;
  };

  // ── B. Hospitality ──
  if (operateBlocks.length || (inflationRows.length && !leaseBlock)) {
    const g = group(OPERATING_INPUTS, 'B', 'Hospitality');
    if (inflationRows.length) g.subs.push({ title: 'Opex inflation (hotel and retail)', rows: inflationRows });
    for (const b of operateBlocks) {
      const title = (b.sub ?? '').replace(/\s*\(Operate\)\s*$/i, '');
      const rows: ORow[] = [];
      const at = (re: RegExp): number | undefined => findRow(b.rows, re);
      const take = (r: number | undefined): OCell | undefined => (r !== undefined && (hasVal(r, 4) || isInput(r, 4) || isRead(r, 4)) ? mv(r, 4) : undefined);
      const done = (r: number | undefined): void => { if (r !== undefined) for (const c of rowCells(r)) if (c === 3 || c >= 5) claim(r, c); };
      const fromRow = at(/^ADR indexation: (index from|start year)/i);
      const fromText = fromRow !== undefined ? str(fromRow, 4) : '';
      const t = takeRate(title);
      if (t) rows.push(scalar('ADR', `${ccy} / night`, t.cell, fromText ? [note(/first operating/i.test(fromText) ? 'In the first operating year; grows from the year after.' : `Indexed from ${fromText}.`)] : []));
      const growth = at(/^ADR indexation: rate/i); rows.push(scalar('ADR growth', '% p.a.', take(growth))); done(growth);
      if (fromRow !== undefined) { claim(fromRow, 3); if (!isRead(fromRow, 4)) claim(fromRow, 4); else rows[rows.length - 1].set(HID, mv(fromRow, 4)); }
      const meth = at(/^ADR indexation: method/i); if (meth !== undefined) { claim(meth, 3); if (!isRead(meth, 4)) claim(meth, 4); }
      const ops = at(/^Operations start year/i); if (ops !== undefined) { const nt = str(ops, 5); rows.push(scalar('Operations start year', 'year', mv(ops, 4), nt ? [note(nt)] : [])); done(ops); }
      const days = at(/^Days per year/i); if (days !== undefined) { const nt = str(days, 5); rows.push(scalar('Days open per year', 'days', take(days), nt ? [note(nt)] : [])); done(days); }
      for (const [re, label] of [[/^F&B Revenue: %/i, 'F&B revenue'], [/^Other Revenue: %/i, 'Other revenue']] as Array<[RegExp, string]>) {
        const r = at(re); if (r === undefined) continue;
        rows.push(scalar(label, '% of rooms', take(r))); done(r);
      }
      for (const re of [/^F&B Revenue: driver/i, /^Other Revenue: driver/i]) { const r = at(re); if (r !== undefined && str(r, 4) === '% of Rooms' && !isRead(r, 4)) { claim(r, 3); claim(r, 4); } }
      const ar = at(/^Accounts Receivable Days/i); if (ar !== undefined) { arCells.push({ title, r: ar, c: 4 }); claim(ar, 3); claim(ar, 4); }
      // The cost table.
      const opex = blocks.find((x) => /^opex/i.test(x.section) && normTitle((x.sub ?? '').replace(/^Opex lines,\s*/i, '')) === normTitle(title));
      if (opex) {
        rows.push(blank());
        const h = new ORow('head').set(3, lit('Hotel operating costs', S_HEAD(true))).set(4, lit('Basis', S_HEAD(false))).set(5, lit('Rate', S_HEAD(false)));
        rows.push(h, ...opexRows(opex));
      }
      // Occupancy by operating year.
      const oh = at(/^Occupancy ramp/i);
      if (oh !== undefined) {
        for (const c of rowCells(oh)) claim(oh, c);
        const nOps = rowCells(oh).filter((c) => c >= 4 && /\d+$/.test(str(oh, c))).length;
        rows.push(blank());
        const h = new ORow('head').set(3, lit('Operating year (hotel)', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false))).set(5, lit('', S_HEAD(false)));
        for (let k = 1; k <= nOps; k++) h.set(5 + k, lit(k, S_HEAD(false)));
        rows.push(h);
        for (const r of b.rows) {
          if (r <= oh) continue; if (emptyRow(r) || isHeadRow(r) || !/^Occupancy/i.test(str(r, 3))) break;
          const row = new ORow('data').set(3, lit('Hotel occupancy')).set(4, lit('%', S_UNIT)); claim(r, 3);
          for (let c = 4; c <= srcLastCol; c++) { if (!free(r, c)) continue; if (hasVal(r, c) || isInput(r, c)) row.set(c + 2, mv(r, c)); else if (isRead(r, c)) row.set(c + 2, ghost(r, c)); }
          rows.push(row);
        }
      }
      const rest = b.rows.filter((r) => rowCells(r).some((c) => free(r, c) && (isRead(r, c) || isInput(r, c))));
      if (rest.length) rows.push(blank(), ...generic(rest));
      for (const r of b.rows) for (const c of rowCells(r)) if (free(r, c) && !isRead(r, c)) claim(r, c);
      g.subs.push({ title: shortLine(title) === title ? title : title, rows });
    }
  }

  // ── C. Retail ──
  if (leaseBlock) {
    const g = group(OPERATING_INPUTS, 'C', 'Retail');
    if (inflationRows.length && !operateBlocks.length) g.subs.push({ title: 'Opex inflation (retail)', rows: inflationRows });
    const head = leaseBlock.rows.find(isHeadRow);
    const rows: ORow[] = [];
    if (head !== undefined) {
      const lineCols = rowCells(head).filter((c) => c >= 4).map((c) => ({ col: c, to: c + 1, title: str(head, c) }));
      const n = lineCols.length;
      for (const c of rowCells(head)) claim(head, c);
      const h = new ORow('head').set(3, lit('Item', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false)));
      for (const lc of lineCols) h.set(lc.to, lit(shortLine(lc.title), S_HEAD(false)));
      rows.push(h);
      const lastTo = Math.max(...lineCols.map((x) => x.to));
      const perLine = (label: string, unit: string | undefined, r: number | undefined, notes: OCell[] = []): void => {
        if (r === undefined) return;
        const row = new ORow('data').set(3, lit(label)); if (unit) row.set(4, lit(unit, S_UNIT));
        claim(r, 3);
        for (const lc of lineCols) if (hasVal(r, lc.col) || isInput(r, lc.col) || isRead(r, lc.col)) row.set(lc.to, mv(r, lc.col));
        notes.forEach((x, k) => row.set(lastTo + 1 + k, x));
        rows.push(row);
      };
      // Rent: each line's only sub-unit's rate.
      const rents = lineCols.map((lc) => takeRate(lc.title));
      if (rents.some((x) => x)) { const row = new ORow('data').set(3, lit('Rent')).set(4, lit(`${ccy} / sqm / yr`, S_UNIT)); rents.forEach((x, i) => { if (x) row.set(lineCols[i].to, x.cell); }); rows.push(row); }
      const fromRow = findRow(leaseBlock.rows, /^Rent indexation: (start year|index from)/i);
      const fromText = fromRow !== undefined ? str(fromRow, lineCols[0].col) : '';
      perLine('Rent growth', '% p.a.', findRow(leaseBlock.rows, /^Rent indexation: rate/i), fromText && /first operating/i.test(fromText) ? [note('Rent is in first operating year money; it grows from the year after.')] : []);
      if (fromRow !== undefined) { claim(fromRow, 3); for (const lc of lineCols) { if (isRead(fromRow, lc.col)) rows[rows.length - 1].set(HID + lc.col, mv(fromRow, lc.col)); else claim(fromRow, lc.col); } }
      const meth = findRow(leaseBlock.rows, /^Rent indexation: method/i); if (meth !== undefined) { claim(meth, 3); for (const lc of lineCols) if (!isRead(meth, lc.col)) claim(meth, lc.col); }
      perLine('Operations start year', 'year', findRow(leaseBlock.rows, /^Operations start year/i), [note('Blank: the year after handover.')]);
      // The cost lines, one rate per line.
      if (leaseOpexBlock) {
        const oh = leaseOpexBlock.rows.find(isHeadRow);
        if (oh !== undefined) {
          const cols = lineCols.map((lc) => ({ col: rowCells(oh).find((c) => normTitle(str(oh, c)) === normTitle(lc.title)) ?? -1, to: lc.to })).filter((x) => x.col > 0);
          rows.push(...opexRows(leaseOpexBlock, cols));
        }
      }
      // Receivable days per line go to working capital.
      const ar = findRow(leaseBlock.rows, /^Accounts Receivable Days/i);
      if (ar !== undefined) { claim(ar, 3); for (const lc of lineCols) { arCells.push({ title: lc.title, r: ar, c: lc.col }); claim(ar, lc.col); } }
      // Occupancy: the rows run down the old table, one per operating year; here one row per line, years across.
      const occ = leaseBlock.rows.filter((r) => /^Occupancy, ops year \d+/i.test(str(r, 3)));
      if (occ.length) {
        rows.push(blank());
        const oh2 = new ORow('head').set(3, lit('Operating year (retail)', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false))).set(5, lit('', S_HEAD(false)));
        for (let k = 1; k <= occ.length; k++) oh2.set(5 + k, lit(k, S_HEAD(false)));
        rows.push(oh2);
        for (const r of occ) claim(r, 3);
        for (const lc of lineCols) {
          const row = new ORow('data').set(3, lit(`Occupancy: ${shortLine(lc.title)}`)).set(4, lit('%', S_UNIT));
          occ.forEach((r, k) => row.set(6 + k, mv(r, lc.col)));
          rows.push(row);
        }
      }
      void n;
    }
    const rest = leaseBlock.rows.filter((r) => rowCells(r).some((c) => free(r, c) && (isRead(r, c) || isInput(r, c))));
    if (rest.length) rows.push(blank(), ...generic(rest));
    for (const r of leaseBlock.rows) for (const c of rowCells(r)) if (free(r, c) && !isRead(r, c)) claim(r, c);
    g.subs.push({ title: 'Lease lines', rows });
  }

  // ── D. Working capital ──
  if (dpoBlock || arCells.length) {
    const g = group(OPERATING_INPUTS, 'D', 'Working capital');
    const rows: ORow[] = [];
    const h = new ORow('head').set(3, lit('Line', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false))).set(5, lit('Receivable days', S_HEAD(false))).set(6, lit('Payable days', S_HEAD(false)));
    rows.push(h);
    const dpoDefault = dpoBlock ? findRow(dpoBlock.rows, /Default DPO/i) : undefined;
    const basis = dpoBlock ? findRow(dpoBlock.rows, /^Days basis/i) : undefined;
    const def = new ORow('data').set(3, lit('Default (a line left blank)')).set(4, lit('days', S_UNIT));
    if (dsoRow !== undefined && statementBlock) { claim(dsoRow, 3); def.set(5, mv(dsoRow, 4)); }
    if (dpoDefault !== undefined) { claim(dpoDefault, 3); def.set(6, mv(dpoDefault, 4)); for (const c of rowCells(dpoDefault)) if (c > 4) claim(dpoDefault, c); }
    rows.push(def);
    // Per line: receivable days from the revenue blocks, the payable override from the DPO table.
    const dpoHead = dpoBlock ? dpoBlock.rows.find(isHeadRow) : undefined;
    const dpoRows = dpoBlock && dpoHead !== undefined ? dpoBlock.rows.filter((r) => r > dpoHead && !emptyRow(r)) : [];
    if (dpoHead !== undefined) for (const c of rowCells(dpoHead)) claim(dpoHead, c);
    const titles: string[] = [];
    for (const a of arCells) if (!titles.some((t) => normTitle(t) === normTitle(a.title))) titles.push(a.title);
    for (const r of dpoRows) if (!titles.some((t) => normTitle(t) === normTitle(str(r, 3)))) titles.push(str(r, 3));
    for (const t of titles) {
      const row = new ORow('data').set(3, lit(shortLine(t))).set(4, lit('days', S_UNIT));
      const a = arCells.find((x) => normTitle(x.title) === normTitle(t));
      if (a) row.set(5, mv(a.r, a.c));
      const d = dpoRows.find((r) => normTitle(str(r, 3)) === normTitle(t));
      if (d !== undefined) { claim(d, 3); row.set(6, mv(d, 4)); for (const c of rowCells(d)) if (c > 4 && free(d, c)) { if (isRead(d, c)) hide(row, d, c); else claim(d, c); } }
      rows.push(row);
    }
    rows.push(noteRow('Receivable days run on hotel and retail revenue, payable days on their operating costs. A blank line uses the default.'));
    if (basis !== undefined) { claim(basis, 3); rows.push(blank(), scalar('Days in the year', 'days', mv(basis, 4))); }
    if (dpoBlock) { const rest = dpoBlock.rows.filter((r) => rowCells(r).some((c) => free(r, c) && (isRead(r, c) || isInput(r, c)))); if (rest.length) rows.push(blank(), ...generic(rest)); for (const r of dpoBlock.rows) for (const c of rowCells(r)) if (free(r, c) && !isRead(r, c)) claim(r, c); }
    g.subs.push({ rows });
  }

  // Anything left in the revenue and opex blocks that a formula reads or a user types: laid out generically.
  for (const b of blocks) {
    if (!/^(revenue|opex)/i.test(b.section)) continue;
    const rest = b.rows.filter((r) => rowCells(r).some((c) => free(r, c) && (isRead(r, c) || isInput(r, c))));
    for (const r of b.rows) for (const c of rowCells(r)) if (free(r, c) && !isRead(r, c) && !isInput(r, c)) claim(r, c);
    if (!rest.length) continue;
    const gk = groupOf(b.section, b.sub, zakat);
    group(gk.sheet, gk.key, gk.title).subs.push({ title: b.sub ?? undefined, rows: generic(rest) });
  }

  // ════ PROJECT INPUTS ════
  for (const b of blocks) {
    if (/^(revenue|opex)/i.test(b.section)) continue;
    const gk = groupOf(b.section, b.sub, zakat);
    const g = group(gk.sheet, gk.key, gk.title);
    const sub = b.sub ?? undefined;
    const u = (b.sub ?? '').toLowerCase();
    // 3.2 Parking: the retail strip's own ratio only where a strip exists.
    if (/^parking and cost escalation/.test(u)) {
      const rows: ORow[] = [];
      for (const r of b.rows) {
        if (emptyRow(r)) continue;
        if (/^Parking area per slot/i.test(str(r, 3))) {
          claim(r, 3);
          rows.push(scalar('Parking area per slot', 'sqm', mv(r, 4)));
          // The strip's sqm of retail GFA per slot, beside it on the old row.
          const rc = rowCells(r).find((c) => c > 4 && typeof numOf(r, c) === 'number');
          for (const c of rowCells(r)) if (c > 4 && c !== rc) claim(r, c);
          if (rc !== undefined) {
            if (hasRetailStrip) rows.push(scalar('Retail parking: sqm of retail GFA per slot', 'sqm', mv(r, rc), [note('Ground-floor retail only.')]));
            else hide(rows[rows.length - 1], r, rc);
          }
        } else rows.push(...generic([r]));
      }
      g.subs.push({ title: sub, rows });
      continue;
    }
    // 4 Development costs: soft costs as label, %, rate, then what each is a share of.
    if (/soft costs/.test(u)) {
      const rows: ORow[] = [];
      const head = b.rows.find(isHeadRow);
      const basisCol = head !== undefined ? rowCells(head).find((c) => /^Basis$/i.test(str(head, c))) : undefined;
      const rateCol = head !== undefined ? rowCells(head).find((c) => /^Rate/i.test(str(head, c))) : undefined;
      if (head !== undefined) for (const c of rowCells(head)) claim(head, c);
      for (const r of b.rows) {
        if (r === head || emptyRow(r) || !free(r, 3) && rowCells(r).every((c) => !free(r, c))) continue;
        if (rateCol === undefined) { rows.push(...generic([r])); continue; }
        claim(r, 3);
        const basis = basisCol ? str(r, basisCol) : ''; if (basisCol) claim(r, basisCol);
        const row = scalar(str(r, 3), '%', mv(r, rateCol), basis ? [note(basis.replace(/^% of /, 'Of ').replace(/$/, '.'))] : []);
        for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c) || isInput(r, c)) hide(row, r, c); else claim(r, c); }
        rows.push(row);
      }
      g.subs.push({ rows });
      continue;
    }
    // 5 Construction phasing: the curves as a % grid by construction year.
    if (/^construction phasing/.test(u)) {
      const head = b.rows.find(isHeadRow);
      if (head !== undefined) {
        const yearCols = rowCells(head).filter((c) => /^Year \d+$/i.test(str(head, c)));
        for (const c of rowCells(head)) claim(head, c);
        const nY = yearCols.length;
        const h = new ORow('head').set(3, lit('Construction year', S_HEAD(true))).set(4, lit('Unit', S_HEAD(false))).set(5, lit('Check', S_HEAD(false)));
        for (let k = 1; k <= nY; k++) h.set(5 + k, lit(k, S_HEAD(false)));
        const rows: ORow[] = [h];
        const applies = rowCells(head).find((c) => /^Applies to$/i.test(str(head, c)));
        for (const r of b.rows) {
          if (r <= head || emptyRow(r) || isHeadRow(r)) continue;
          const who = applies ? str(r, applies) : '';
          const phases = [...new Set([...who.matchAll(/\bP(\d+)\b/g)].map((m) => m[1]))];
          const label = phases.length === 1 ? `Spend phasing: Phase ${phases[0]} (all Phase ${phases[0]} lines)` : `Spend phasing: ${str(r, 3)}${who ? ` (${who})` : ''}`;
          claim(r, 3);
          const row = new ORow('data').set(3, lit(label)).set(4, lit('% of cost', S_UNIT));
          const first = yearCols[0] ?? 4;
          for (let c = 4; c <= srcLastCol; c++) {
            if (!free(r, c)) continue;
            const isYear = c >= first && c < first + nY;
            if (isYear) row.set(c - first + 6, mv(r, c));
            else if (isRead(r, c)) row.set(c - first + 6, ghost(r, c));
            else claim(r, c);
          }
          row.set(5, { value: { formula: `@SUMCHECK:${nY}@` } as unknown as ExcelJS.CellValue, style: S_FORMULA, final: true });
          rows.push(row);
        }
        g.subs.push({ rows });
        continue;
      }
    }
    // The timing rules, as sentences; the windows a formula reads go to hidden helper cells on the sentence row.
    if (b === capexLinesBlock) {
      const head = b.rows.find((r) => isHeadRow(r) && /^(Cost line|Timing exceptions)/.test(str(r, 3)))!;
      const hc = rowCells(head);
      const col = (re: RegExp): number | undefined => hc.find((c) => re.test(str(head, c)));
      const cRate = col(/^Rate$/i), cPh = col(/^Phasing$/i), cS = col(/^Start/i), cE = col(/^End/i), cA = col(/^Applies to$/i);
      for (const c of hc) claim(head, c);
      const pre = generic(b.rows.filter((r) => r < head));
      const rows: ORow[] = [...pre];
      const land: Array<{ r: number; s: number; e: number }> = [];
      const others: ORow[] = [];
      const phasesOf = (r: number): string => { const ps = [...new Set([...(cA ? str(r, cA) : '').matchAll(/\bP(\d+)\b/g)].map((m) => m[1]))].sort(); return ps.length === 1 ? `Phase ${ps[0]}` : ps.length ? `Phases ${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}` : 'every phase'; };
      // A line that follows its phase is the default and says nothing; its window, which a formula reads, rides hidden on a sentence row.
      const quiet: Array<[number, number]> = [];
      for (const r of b.rows) {
        if (r <= head || emptyRow(r) || isHeadRow(r)) continue;
        if (rowCells(r).every((c) => !free(r, c)) && !/commission terms/i.test(cPh ? str(r, cPh) : '')) continue;
        const name = str(r, 3); claim(r, 3);
        const s = cS ? numOf(r, cS) : undefined, e = cE ? numOf(r, cE) : undefined;
        const ph = cPh ? str(r, cPh) : '';
        const stated = rowCells(r).some((c) => isInput(r, c)) || /commission terms|sales|collections/i.test(ph);
        if (!stated) { for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c)) { claim(r, c); quiet.push([r, c]); } else claim(r, c); } continue; }
        let row: ORow;
        if (/^Land\b/i.test(name)) { land.push({ r, s: s ?? 1, e: e ?? 1 }); row = new ORow('data'); }
        else if (/commission terms/i.test(ph)) row = noteRow(`${name}: paid per the commission terms on Operating Inputs (${commissionSentenceAt.sub || 'A'}).`);
        else if (/sales|collections/i.test(ph)) row = noteRow(`${name}: paid as sales are made.`);
        else row = noteRow(`${name}, ${phasesOf(r)}: ${/even/i.test(ph) || !ph ? 'spread evenly' : ph.toLowerCase()} over construction years ${s ?? 1} to ${e ?? s ?? 1}.`);
        for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c) || isInput(r, c)) hide(row, r, c); else claim(r, c); }
        if (/^Land\b/i.test(name)) (land[land.length - 1] as { row?: ORow }).row = row; else others.push(row);
      }
      if (land.length) {
        const merge = (into: ORow, from: ORow | undefined): void => { if (from) for (const [, cell] of from.cells) { let kk = HID; while (into.cells.has(kk)) kk++; into.set(kk, cell); } };
        if (land.every((x) => x.e <= 1)) {
          const row = noteRow('Land and RETT are paid in construction year 1 of each phase.');
          for (const x of land) merge(row, (x as { row?: ORow }).row);
          rows.push(row);
        } else for (const x of land) {
          const row = noteRow(`Land, ${phasesOf(x.r)}: paid over construction years ${Math.max(1, x.s)} to ${Math.max(1, x.e)}.`);
          merge(row, (x as { row?: ORow }).row);
          rows.push(row);
        }
      }
      rows.push(...others);
      { const holder = rows.find((x) => x.kind === 'note') ?? (rows.push(new ORow('blank')), rows[rows.length - 1]); for (const [qr, qc] of quiet) { let k = HID; while (holder.cells.has(k)) k++; holder.set(k, { from: [qr, qc] }); } }
      void cRate;
      // The sentences sit under the grid, in section 5.
      g.subs.push({ rows, title: undefined });
      (g.subs[g.subs.length - 1] as OSub & { after?: boolean }).after = true;
      continue;
    }
    // Debt facilities: one facility reads as scalar rows.
    if (/^debt facilities/.test(u)) {
      const head = b.rows.find(isHeadRow);
      const data = head !== undefined ? b.rows.filter((r) => r > head && !emptyRow(r)) : [];
      if (head !== undefined && data.length === 1) {
        const r = data[0]; const name = str(r, 3); claim(r, 3);
        for (const c of rowCells(head)) claim(head, c);
        const rows: ORow[] = [];
        for (const c of rowCells(head)) {
          if (c === 3) continue;
          if (!hasVal(r, c) && !isInput(r, c) && !isRead(r, c)) continue;
          if (str(r, c) === '-' && !isRead(r, c)) { claim(r, c); continue; }
          const { label, unit } = splitUnit(str(head, c));
          rows.push(scalar(`${name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`, unit ?? (typeof numOf(r, c) === 'number' ? unitFor(label, r, c) : undefined), mv(r, c)));
        }
        g.subs.push({ title: sub, rows });
        continue;
      }
    }
    // Lender covenants: one row each, the test in the label.
    if (/^lender covenants/.test(u)) {
      const head = b.rows.find(isHeadRow);
      if (head !== undefined) {
        for (const c of rowCells(head)) claim(head, c);
        const rows: ORow[] = [];
        for (const r of b.rows) {
          if (r <= head || emptyRow(r)) continue;
          const test = str(r, 4); claim(r, 3); claim(r, 4);
          const fmt = numFmtOf(r, 5);
          rows.push(scalar(`${str(r, 3)}, ${test}`, fmt.includes('%') ? '%' : 'x', mv(r, 5)));
          for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c) || isInput(r, c)) hide(rows[rows.length - 1], r, c); else claim(r, c); }
        }
        g.subs.push({ title: sub, rows });
        continue;
      }
    }
    // Depreciation: the default lives are scalar rows; the asset table stays a table.
    if (/^depreciation inputs/.test(u)) {
      const firstHead = b.rows.find(isHeadRow);
      const rows: ORow[] = [];
      if (firstHead !== undefined && /^Default useful life$/i.test(str(firstHead, 3))) {
        for (const c of rowCells(firstHead)) claim(firstHead, c);
        let r0 = firstHead + 1;
        for (; b.rows.includes(r0) && !emptyRow(r0) && !isHeadRow(r0); r0++) { claim(r0, 3); rows.push(scalar(`Useful life: ${str(r0, 3)}`, 'years', mv(r0, 4))); }
      }
      const rest = b.rows.filter((r) => rowCells(r).some((c) => free(r, c)));
      if (rest.length) { if (rows.length) rows.push(blank()); rows.push(...generic(rest, { headRename: { 'Useful life (blank = default)': 'Useful life (years)' } })); }
      g.subs.push({ title: sub, rows });
      continue;
    }
    // Fund terms: Value | Unit | Note becomes Unit | Value | Note.
    if (/^fund terms/.test(u)) {
      const head = b.rows.find(isHeadRow);
      if (head !== undefined && /^Value$/i.test(str(head, 4)) && /^Unit$/i.test(str(head, 5))) {
        for (const c of rowCells(head)) claim(head, c);
        const rows: ORow[] = [];
        for (const r of b.rows) {
          if (r <= head || emptyRow(r)) continue;
          claim(r, 3); claim(r, 5);
          const raw = str(r, 5); const n = numOf(r, 4);
          let unit: string | undefined; let lead = '';
          if (/^of its basis$/i.test(raw)) { unit = '%'; lead = 'Of its basis. '; }
          else if (/^of equity to date pa$/i.test(raw)) { unit = '% p.a.'; lead = 'Of equity drawn to date. '; }
          else if (/^per annum$/i.test(raw)) unit = numFmtOf(r, 4).includes('%') ? '% p.a.' : `${ccy} p.a.`;
          else if (/^of excess$/i.test(raw)) unit = '% of excess';
          else if (raw) unit = raw;
          const nt = `${lead}${str(r, 6)}`.trim(); if (hasVal(r, 6)) claim(r, 6);
          const row = scalar(str(r, 3), n !== undefined ? unit : undefined, mv(r, 4), nt ? [note(nt)] : []);
          for (const c of rowCells(r)) if (free(r, c)) { if (isRead(r, c) || isInput(r, c)) hide(row, r, c); else claim(r, c); }
          rows.push(row);
        }
        g.subs.push({ title: sub, rows });
        continue;
      }
    }
    // Receivable days left on the P&L inputs only when working capital did not take it.
    const costTable = /construction cost/.test(u);
    g.subs.push({ title: sub, rows: generic(b.rows, {
      ...(costTable ? { cellText: (head: string, t: string) => (head === 'Basis' ? t.replace(/^[A-Z]{3} per sqm of /, '').replace(/^./, (x) => x.toUpperCase()) : t), headUnit: { Rate: `${ccy} / sqm` } } : {}),
      headRename: { 'Phase Name': 'Phase', 'Phase Start Date': 'Start (date)', 'Avg unit size (sqm)': 'Unit size (sqm)', 'Strategy for new assets': 'Strategy', 'Rate (first model year money)': 'Rate', 'Average Unit Size (sqm)': 'Unit size (sqm)', 'Retail % (ground floor)': 'Retail (ground floor) %' },
    }) });
  }

  // ── Order: groups by tab and key; the sentences after the grid in section 5 ──
  const ordered = groups.filter((g) => g.subs.some((s) => s.rows.length)).sort((a, b) => (a.sheet === b.sheet ? a.key.localeCompare(b.key, undefined, { numeric: true }) : a.sheet === PROJECT_INPUTS ? -1 : 1));
  for (const g of ordered) {
    const after = g.subs.filter((s) => (s as OSub & { after?: boolean }).after);
    if (after.length) {
      const grid = g.subs.filter((s) => !(s as OSub & { after?: boolean }).after);
      g.subs = grid.length ? [{ title: grid[0].title, rows: [...grid.flatMap((s, i) => (i ? [blank(), ...s.rows] : s.rows)), blank(), ...after.flatMap((s) => s.rows)] }] : after;
    }
  }

  // ── Positions ────────────────────────────────────────────────────────────────
  const firstBar = titleRows.length + 1;
  const placed: Array<{ sheet: string; r: number; row: ORow }> = [];
  const barRows: Array<{ sheet: string; r: number; text: string }> = [];
  const subRows: Array<{ sheet: string; r: number; text: string }> = [];
  const endAt = new Map<string, number>();
  for (const sheet of [PROJECT_INPUTS, OPERATING_INPUTS]) {
    const mine = ordered.filter((g) => g.sheet === sheet);
    let r = firstBar; let n = 0;
    mine.forEach((g, gi) => {
      if (gi > 0) r += 1;
      n += 1;
      const label = sheet === OPERATING_INPUTS ? String.fromCharCode(64 + n) : String(n);
      barRows.push({ sheet, r, text: `${label}. ${g.title}` });
      r += 2;
      let k = 0;
      const subs = g.subs.filter((s) => s.rows.length);
      subs.forEach((s, si) => {
        if (si > 0) r += 1;
        if (s.title && subs.length > 1) { subRows.push({ sheet, r, text: `${label}.${++k} ${s.title}` }); r += 1; }
        else if (s.title && subs.length === 1 && !/^(Lease lines)$/i.test(s.title)) { subRows.push({ sheet, r, text: `${label}.${++k} ${s.title}` }); r += 1; }
        for (const row of s.rows) { placed.push({ sheet, r, row }); r += 1; }
      });
    });
    endAt.set(sheet, r + 1);
  }

  // The address of every source cell.
  const addr = new Map<string, SplitMove>();
  for (const p of placed) for (const [c, cell] of p.row.cells) if (cell.from) addr.set(K(cell.from[0], cell.from[1]), { sheet: p.sheet, r: p.r, c });
  // The old bars, the title rows and End of sheet (no formula reads them, but a link may).
  for (const r of titleRows) for (let c = 1; c <= srcLastCol; c++) if (!addr.has(K(r, c))) addr.set(K(r, c), { sheet: PROJECT_INPUTS, r, c });
  const move = (r: number, c: number): SplitMove | null => addr.get(K(r, c)) ?? null;
  for (const k of read) if (!addr.has(k)) { const [r, c] = k.split(':').map(Number); const bl = blocks.find((x) => x.rows.includes(r)); const head = bl?.rows.filter((x) => x < r && isHeadRow(x)).pop(); throw new Error(`splitInputs: a formula reads Inputs!${colName(c)}${r} (row "${str(r, 3)}", column "${head ? str(head, c) : ''}", in ${bl ? `${bl.section} / ${bl.sub ?? ''}` : 'no block'}; claimed ${claimed.has(k)}), which the new layout does not place`); }
  // A range must land as a translated rectangle, or a one-dimensional line in order.
  for (const g of ranges) {
    const r1 = Math.min(g.r1, g.r2), r2 = Math.max(g.r1, g.r2), c1 = Math.min(g.c1, g.c2), c2 = Math.max(g.c1, g.c2);
    const a = move(r1, c1)!, b = move(r2, c2)!;
    let ok = a.sheet === b.sheet;
    const rect = ok && b.r - a.r === r2 - r1 && b.c - a.c === c2 - c1;
    const line = ok && (r1 === r2 || c1 === c2) && ((b.r === a.r && b.c - a.c === (r2 - r1) + (c2 - c1)) || (b.c === a.c && b.r - a.r === (r2 - r1) + (c2 - c1)));
    ok = ok && (rect || line);
    if (ok) for (let r = r1; r <= r2 && ok; r++) for (let c = c1; c <= c2 && ok; c++) {
      const m = move(r, c); const k = (r - r1) + (c - c1);
      ok = !!m && m.sheet === a.sheet && (rect ? m.r - a.r === r - r1 && m.c - a.c === c - c1 : (b.r === a.r ? m.r === a.r && m.c === a.c + k : m.c === a.c && m.r === a.r + k));
    }
    if (ok && !rect) {
      // A line turned on its side reads the same only where it is one argument of INDEX(range, n) or of an aggregate.
      const turned = !(b.r - a.r === r2 - r1 && b.c - a.c === c2 - c1);
      if (turned && !new RegExp(`(INDEX|SUM|MAX|MIN|AVERAGE|COUNT)\\(${colName(g.c1)}${g.r1}:${colName(g.c2)}${g.r2}[,)]`).test(g.formula.replace(/\$/g, '').replace(/(?:'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*)!/g, ''))) ok = false;
    }
    if (!ok) throw new Error(`splitInputs: ${g.where} reads Inputs!${colName(g.c1)}${g.r1}:${colName(g.c2)}${g.r2}, which the new layout would break`);
  }

  // ── Rewrite every reference to the old tab ──────────────────────────────────
  const rewrite = (formula: string, own: string, where: string): string => {
    const parts = formula.split(/("(?:[^"]|"")*")/);
    return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (all, q: string | undefined, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
      const sheet = q ? unquote(q.slice(0, -1)) : own;
      if (sheet !== SRC) return all;
      const a = move(Number(r1), colNum(c1));
      if (!a) throw new Error(`splitInputs: ${where} reads Inputs!${c1}${r1}, a cell the split does not place`);
      let body = `${d1}${colName(a.c)}${d2}${a.r}`;
      if (c2 && r2) { const b = move(Number(r2), colNum(c2))!; body += `:${d3 ?? ''}${colName(b.c)}${d4 ?? ''}${b.r}`; }
      return a.sheet === own ? body : `${quote(a.sheet)}!${body}`;
    }))).join('');
  };
  const moveLink = (h: string): string => {
    const m = /^#((?:'(?:[^']|'')+'|[^!]+))!(\$?[A-Z]+\$?\d+)(?::.+)?$/.exec(h);
    if (!m || unquote(m[1]) !== SRC) return h;
    const a = /^\$?([A-Z]+)\$?(\d+)$/.exec(m[2])!;
    const to = move(Number(a[2]), colNum(a[1])) ?? { sheet: PROJECT_INPUTS, r: 1, c: 1 };
    return `#${quote(to.sheet)}!${colName(to.c)}${to.r}`;
  };
  const rewriteValue = (v: ExcelJS.CellValue, own: string, where: string): ExcelJS.CellValue => {
    if (!v || typeof v !== 'object') return v;
    const o = v as unknown as Record<string, unknown>;
    if (typeof o.formula === 'string') return { ...o, formula: rewrite(o.formula, own, where) } as unknown as ExcelJS.CellValue;
    if (typeof o.hyperlink === 'string' && o.hyperlink.startsWith('#')) return { ...o, hyperlink: moveLink(o.hyperlink) } as unknown as ExcelJS.CellValue;
    return v;
  };

  const srcModel = src.model as unknown as { merges?: string[] };
  const merges = [...(srcModel.merges ?? [])];
  const cfs = JSON.parse(JSON.stringify((src as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? [])) as Array<{ ref: string; rules: Array<{ formulae?: unknown[] }> }>;

  // Every other tab: formulas, links, validations and conditional formats that read the old tab.
  for (const ws of wb.worksheets) {
    if (ws.name === SRC) continue;
    ws.eachRow((row) => row.eachCell((c) => { const nv = rewriteValue(c.value, ws.name, `${ws.name}!${c.address}`); if (nv !== c.value) c.value = nv; }));
    const dvm = (ws as unknown as { dataValidations: { model: Record<string, { formulae?: unknown[] }> } }).dataValidations?.model ?? {};
    for (const v of Object.values(dvm)) if (Array.isArray(v.formulae)) v.formulae = v.formulae.map((f) => (typeof f === 'string' ? rewrite(f, ws.name, `${ws.name} validation`) : f));
    for (const cf of ((ws as unknown as { conditionalFormattings?: Array<{ rules: Array<{ formulae?: unknown[] }> }> }).conditionalFormattings ?? [])) {
      for (const rl of cf.rules ?? []) if (Array.isArray(rl.formulae)) rl.formulae = rl.formulae.map((f) => (typeof f === 'string' ? rewrite(f, ws.name, `${ws.name} conditional format`) : f));
    }
  }
  // Defined names (a range keeps both ends).
  const dn = (wb.definedNames as unknown as { model: Array<{ name: string; ranges: string[] }> });
  dn.model = dn.model.map((nm) => ({ ...nm, ranges: nm.ranges.map((rg) => {
    const m = /^((?:'(?:[^']|'')+'|[^!]+))!(.+)$/.exec(rg);
    if (!m || unquote(m[1]) !== SRC) return rg;
    const out = rewrite(rg, '', 'a defined name');
    return /!/.test(out) ? out : rg;
  }) }));

  // ── Build the two tabs ──────────────────────────────────────────────────────
  const order = (src as unknown as { orderNo: number }).orderNo;
  const views = JSON.parse(JSON.stringify(src.views ?? []));
  const pageSetup = { ...JSON.parse(JSON.stringify(src.pageSetup ?? {})), printArea: undefined, printTitlesRow: undefined };
  const headerFooter = JSON.parse(JSON.stringify(src.headerFooter ?? {}));
  const props = JSON.parse(JSON.stringify(src.properties ?? {}));
  const barStyle = JSON.parse(JSON.stringify(snap.get(K(blocks.length ? [...snap.keys()].map((k) => k.split(':').map(Number)).find(([r, c]) => c === 2 && fillOf(snap.get(K(r, c))?.style) === BAR)?.[0] ?? 1 : 1, 2))?.style ?? {})) as Style;
  const subStyle: Style = { font: font({ bold: true, color: { argb: BAR } }) };
  const endStyle = JSON.parse(JSON.stringify(snap.get(K(endRow, 2))?.style ?? {})) as Style;
  for (const ws of wb.worksheets) { const o = ws as unknown as { orderNo: number }; if (o.orderNo > order) o.orderNo += 1; }
  wb.removeWorksheet(src.id);
  const make = (name: string, at: number): ExcelJS.Worksheet => {
    const ws = wb.addWorksheet(name, { properties: props, views, pageSetup, headerFooter } as never);
    (ws as unknown as { orderNo: number }).orderNo = at;
    return ws;
  };
  const out = new Map<string, ExcelJS.Worksheet>([[PROJECT_INPUTS, make(PROJECT_INPUTS, order)], [OPERATING_INPUTS, make(OPERATING_INPUTS, order + 1)]]);
  const putSrc = (ws: ExcelJS.Worksheet, from: [number, number], to: { r: number; c: number }, own: string, content: boolean, override?: OCell): void => {
    const s = snap.get(K(from[0], from[1])); if (!s) return;
    const c = ws.getCell(to.r, to.c);
    if (!content) return;
    c.value = override?.value !== undefined ? override.value : rewriteValue(s.value, own === SRC ? SRC : SRC, `Inputs!${colName(from[1])}${from[0]}`);
    const v = c.value as unknown as { formula?: string } | null;
    if (v && typeof v === 'object' && typeof v.formula === 'string') c.value = { ...(v as object), formula: v.formula.replace(new RegExp(`${quote(own).replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}!`, 'g'), '') } as never;
    c.style = (override?.style ?? s.style) as ExcelJS.Style;
    if (override?.style && fillOf(s.style) === INPUT_FILL) c.style = { ...s.style, ...override.style, fill: s.style.fill, numFmt: s.style.numFmt } as ExcelJS.Style;
    if (s.dv) c.dataValidation = { ...s.dv, formulae: (s.dv.formulae ?? []).map((f) => (typeof f === 'string' ? rewrite(f, SRC, 'Inputs validation') : f)) } as ExcelJS.DataValidation;
  };
  // Title block on both tabs; the tab name in its second row.
  for (const [name, ws] of out) {
    for (const r of titleRows) for (let c = 1; c <= srcLastCol; c++) if (snap.has(K(r, c))) putSrc(ws, [r, c], { r, c }, name, true);
    for (const r of titleRows) { const h = heights.get(r); if (h) ws.getRow(r).height = h; }
    for (let r = 1; r <= titleRows.length; r++) {
      const c = ws.getCell(r, 2);
      if (txt(c) === SRC) c.value = name;
      else if (r === 3 && typeof c.value === 'string') c.value = name === PROJECT_INPUTS
        ? `Every project input: timeline, land and plots, types and build rates, development costs and phasing, funding, ${zakat ? 'zakat' : 'tax'} and depreciation, exit and fund terms.`
        : 'Every operating input: residential sales, hospitality and retail operations, and working capital.';
    }
  }
  // The rows.
  const posOf = new Map<ORow, { sheet: string; r: number }>();
  for (const p of placed) posOf.set(p.row, { sheet: p.sheet, r: p.r });
  for (const p of placed) {
    const ws = out.get(p.sheet)!;
    for (const [c, cell] of p.row.cells) {
      if (cell.from && !cell.ghost) putSrc(ws, cell.from, { r: p.r, c }, p.sheet, true, cell.value !== undefined || cell.style ? { value: cell.value, style: cell.style } : undefined);
      else if (!cell.from) {
        const x = ws.getCell(p.r, c);
        x.value = cell.value ?? null;
        if (cell.style) x.style = JSON.parse(JSON.stringify(cell.style));
      }
    }
  }
  // The formulas this file writes, now that every position is known.
  const at = (sheet: string, r: number, c: number): ExcelJS.Cell => out.get(sheet)!.getCell(r, c);
  for (const p of placed) for (const [c, cell] of p.row.cells) {
    if (!cell.final) continue;
    const numAt = (sheet: string, r: number, cc: number): number => { const v = at(sheet, r, cc).value as unknown; const x2 = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v; return typeof x2 === 'number' ? x2 : 0; };
    const sumRow = (sheet: string, r: number, c1: number, c2: number): number => { let t = 0; for (let k = c1; k <= c2; k++) t += numAt(sheet, r, k); return t; };
    const ok = (t: number): string => (Math.abs(Math.round(t * 1e6) / 1e6 - 1) < 1e-9 ? 'OK' : 'CHECK');
    const x = at(p.sheet, p.r, c);
    const f = (x.value as { formula?: string } | null)?.formula ?? '';
    const lastYear = (): number => { let m = 5; for (const [cc, oc] of p.row.cells) if (cc > m && cc < HID && oc.from) m = cc; return m; };
    if (f === '$E$@ROW@') { x.value = { formula: `$E${p.r}`, result: numAt(p.sheet, p.r, 5) } as ExcelJS.CellValue; x.numFmt = at(p.sheet, p.r, 5).numFmt; }
    else if (/^@SUMCHECK:(\d+)@$/.test(f)) { const nY = Number(/(\d+)/.exec(f)![1]); x.value = { formula: `IF(ROUND(SUM(F${p.r}:${colName(5 + Math.max(1, nY))}${p.r}),6)=1,"OK","CHECK")`, result: ok(sumRow(p.sheet, p.r, 6, 5 + Math.max(1, nY))) } as ExcelJS.CellValue; }
    else if (f === '@CHECK@') {
      const grp = ordered.find((g) => g.key === 'A' && g.sheet === OPERATING_INPUTS) as (OGroup & { checks?: Array<{ row: ORow; pre: ORow | undefined }> }) | undefined;
      const ch = grp?.checks?.find((x2) => x2.row === p.row);
      const pre = ch?.pre ? posOf.get(ch.pre) : undefined;
      const lc = colName(Math.max(lastYear(), ch?.pre ? (() => { let m = 6; for (const [cc, oc] of ch.pre!.cells) if (cc > m && cc < HID && oc.from) m = cc; return m; })() : 6));
      const lcN = colNum(lc); x.value = { result: ok(sumRow(p.sheet, p.r, 6, lcN) + (pre ? sumRow(pre.sheet, pre.r, 6, lcN) : 0)), formula: pre ? `IF(ROUND(SUM(F${p.r}:${lc}${p.r})+SUM(F${pre.r}:${lc}${pre.r}),6)=1,"OK","CHECK")` : `IF(ROUND(SUM(F${p.r}:${lc}${p.r}),6)=1,"OK","CHECK")` } as ExcelJS.CellValue;
    } else if (f === '@INFL@') {
      const meta = inflationRows as ORow[] & { rateRow?: ORow; fromRow?: ORow };
      const rr = meta.rateRow ? posOf.get(meta.rateRow) : undefined; const fr = meta.fromRow ? posOf.get(meta.fromRow) : undefined;
      if (rr) {
        const ref = (q: { sheet: string; r: number }): string => `${q.sheet === p.sheet ? '' : `${quote(q.sheet)}!`}$E$${q.r}`;
        x.value = { formula: `"Inflated at "&TEXT(${ref(rr)},"0.0%")&" p.a."${fr ? `&" from "&${ref(fr)}` : ''}`, result: `Inflated at ${(numAt(rr.sheet, rr.r, 5) * 100).toFixed(1)}% p.a.${fr ? ` from ${numAt(fr.sheet, fr.r, 5)}` : ''}` } as ExcelJS.CellValue;
      } else x.value = null;
    }
  }
  for (const b of barRows) { const c = out.get(b.sheet)!.getCell(b.r, 2); c.value = b.text; c.style = JSON.parse(JSON.stringify(barStyle)); out.get(b.sheet)!.getRow(b.r).height = 15; }
  for (const s of subRows) { const c = out.get(s.sheet)!.getCell(s.r, 3); c.value = s.text; c.style = JSON.parse(JSON.stringify(subStyle)); }
  for (const [sheet, r] of endAt) { const c = out.get(sheet)!.getCell(r, 2); c.value = 'End of sheet'; c.style = JSON.parse(JSON.stringify(endStyle)); }
  // Merges: a moved range keeps its shape on its new tab; the title block's on both.
  for (const rg of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rg); if (!m) continue;
    const r1 = Number(m[2]), r2 = Number(m[4]);
    if (r1 <= titleRows.length) { for (const ws of out.values()) { try { ws.mergeCells(rg); } catch { /* already merged */ } } continue; }
    const a = move(r1, colNum(m[1])), b = move(r2, colNum(m[3]));
    if (!a || !b || a.sheet !== b.sheet || b.r - a.r !== r2 - r1 || b.c - a.c !== colNum(m[3]) - colNum(m[1])) continue;
    try { out.get(a.sheet)!.mergeCells(`${colName(a.c)}${a.r}:${colName(b.c)}${b.r}`); } catch { /* overlaps */ }
  }
  // Conditional formats on the old tab follow their cells.
  for (const cf of cfs) {
    const refs = cf.ref.split(' ').map((x) => {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(x); if (!m) return null;
      const a = move(Number(m[2]), colNum(m[1])); if (!a) return null;
      const b = m[4] ? move(Number(m[4]), colNum(m[3])) : a; if (!b || b.sheet !== a.sheet) return null;
      return { sheet: a.sheet, ref: m[3] ? `${colName(a.c)}${a.r}:${colName(b.c)}${b.r}` : `${colName(a.c)}${a.r}` };
    }).filter((x): x is { sheet: string; ref: string } => !!x);
    if (!refs.length) continue;
    try { out.get(refs[0].sheet)!.addConditionalFormatting({ ref: refs.filter((x) => x.sheet === refs[0].sheet).map((x) => x.ref).join(' '), rules: cf.rules.map((rl) => ({ ...rl, formulae: Array.isArray(rl.formulae) ? rl.formulae.map((f) => (typeof f === 'string' ? rewrite(f, SRC, 'Inputs conditional format') : f)) : rl.formulae })) } as never); } catch { /* a format whose cells were dropped */ }
  }
  const kinds = new Map<string, Map<number, RowKind>>();
  for (const p of placed) { if (!kinds.has(p.sheet)) kinds.set(p.sheet, new Map()); kinds.get(p.sheet)!.set(p.r, p.row.kind); }
  for (const b of barRows) kinds.get(b.sheet)?.set(b.r, 'bar');
  for (const s of subRows) kinds.get(s.sheet)?.set(s.r, 'sub');
  for (const ws of out.values()) formatInputTab(ws, kinds.get(ws.name) ?? new Map());
  return { move: (sheet, r, c) => (sheet === SRC ? move(r, c) : null) };
}

// ── THE TRAINING LOOK ON BOTH INPUT TABS (2026-11-18; the step 3 review 2026-11-19) ───────────────────────
const WIDTHS: Record<string, number[]> = {
  // A, B, C (label), D (unit), E (input), then every later column.
  [PROJECT_INPUTS]: [1.5, 1.5, 46, 18, 22, 12],
  [OPERATING_INPUTS]: [1.5, 1.5, 46, 18, 18, 18, 12],
};
const BANDS = new Set([BAR, END_FILL]);
const dotted = { style: 'dotted' as const };
/** Characters of 9 pt Calibri a column of this width shows. */
const fits = (width: number, bold = false): number => Math.max(1, Math.floor(width * (bold ? 1.2 : 1.35)));
const LINE_PT = 11.5;

/** The decimals a number needs to show exactly (to `max`). */
function decimalsOf(v: number, max: number): number { for (let d = 0; d < max; d++) if (Math.abs(Math.round(v * 10 ** d) - v * 10 ** d) < 1e-6) return d; return max; }

/**
 * Inputs blue on yellow with a dotted box; formulas black with no fill or border; a percentage shows every decimal it
 * has (0.0% at least), a ratio 0.00, an amount #,##0 (with the decimals it has), a year 0; notes grey italic; a
 * header wraps on a taller row; a text that would be cut by its neighbour wraps; bars and table heads run the full
 * printed width; hidden helper columns stay hidden and outside the print area; page breaks fall before a section
 * that would not fit the page it starts on.
 */
export function formatInputTab(ws: ExcelJS.Worksheet, kinds: Map<number, RowKind> = new Map()): void {
  const widths = WIDTHS[ws.name]; if (!widths) return;
  let lastCol = 8; let lastRow = 1;
  ws.eachRow((row, r) => row.eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== undefined && c.value !== '' && Number(c.col) < HID) { if (r > 1) lastCol = Math.max(lastCol, Number(c.col)); lastRow = Math.max(lastRow, r); } }));
  // The title's link sits at the right edge of the printed width.
  ws.getRow(1).eachCell((c) => { const v = c.value as { hyperlink?: string } | null; if (v && typeof v === 'object' && v.hyperlink && Number(c.col) > 3 && Number(c.col) !== lastCol) { const t = ws.getCell(1, lastCol); t.value = c.value; t.style = JSON.parse(JSON.stringify(c.style)); t.alignment = { horizontal: 'right', vertical: 'middle' }; c.value = null; c.style = {}; } });
  for (let k = 1; k <= lastCol; k++) ws.getColumn(k).width = widths[k - 1] ?? widths[widths.length - 1];
  let maxHid = 0; ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => { if (Number(c.col) >= HID) maxHid = Math.max(maxHid, Number(c.col)); }));
  for (let k = HID; k <= maxHid; k++) ws.getColumn(k).hidden = true;
  const width = (k: number): number => ws.getColumn(k).width ?? 12;
  const headText = new Map<number, string>();
  let curUnitCol = new Map<number, string>();
  ws.eachRow((row, r) => {
    if (r <= 3) return;
    const kind = kinds.get(r);
    const band = [2, 3].map((k) => fillOf(row.getCell(k))).find((f) => f && BANDS.has(f));
    if (kind === 'head') { headText.clear(); row.eachCell((c) => { if (typeof c.value === 'string') headText.set(Number(c.col), c.value); }); curUnitCol = new Map(); }
    if (kind === 'unit') row.eachCell((c) => { if (typeof c.value === 'string') curUnitCol.set(Number(c.col), c.value); });
    if (kind === 'bar' || kind === 'sub' || kind === 'blank') { headText.clear(); curUnitCol = new Map(); }
    const rowUnit = typeof row.getCell(4).value === 'string' && kind === 'data' ? String(row.getCell(4).value) : '';
    row.eachCell({ includeEmpty: true }, (c) => {
      const col = Number(c.col);
      if (band) return;
      const v = c.value as unknown;
      const isF = !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
      const val = isF ? (v as { result?: unknown }).result : v;
      const nf = String(c.numFmt ?? '');
      if (fillOf(c) === INPUT_FILL && !isF) {
        c.font = { name: 'Calibri', size: 9, bold: c.font?.bold, color: { argb: 'FF0000FF' } };
        c.border = { top: dotted, bottom: dotted, left: dotted, right: dotted };
        const al = (h: 'center' | 'right' | 'left', wrap = false): void => { c.alignment = { horizontal: h, vertical: 'middle', wrapText: wrap }; };
        if (typeof val === 'string' || nf === '@') { const s = String(val ?? ''); const fit = s.length <= fits(width(col)); al(fit ? 'center' : 'left', !fit); return; }
        if (typeof val !== 'number') { al('center'); return; }
        const unit = (curUnitCol.get(col) ?? rowUnit).trim();
        const head = headText.get(col) ?? '';
        if (nf.includes('%') || /%/.test(unit) && !/^% of (sale|price|NSA)/.test('')) {
          if (nf.includes('%') || /^%/.test(unit)) { c.numFmt = `0.${'0'.repeat(Math.max(1, decimalsOf(val * 100, 3)))}%`; al('center'); return; }
        }
        if (/\b(year)\b/i.test(unit) || (nf === '0' && Number.isInteger(val) && val >= 1900 && val <= 2200)) { c.numFmt = '0'; al('right'); return; }
        if (/^dd|yy/.test(nf)) { al('right'); return; }
        if (unit === 'x' || /\b(ratio|FAR|multiple)\b/i.test(head) || /\b(DSCR|ICR|ratio|FAR)\b/i.test(String(row.getCell(3).value ?? ''))) { c.numFmt = `0.${'0'.repeat(Math.max(2, decimalsOf(val, 4)))}`; al('right'); return; }
        const d = decimalsOf(val, 4);
        c.numFmt = d === 0 ? '#,##0;(#,##0);0' : `#,##0.${'0'.repeat(d)};(#,##0.${'0'.repeat(d)});0`;
        al('right');
        return;
      }
      if (isF) {
        if (c.font?.italic && c.font?.color?.argb === NOTE) return;
        c.font = { name: 'Calibri', size: c.font?.size ?? 9, bold: c.font?.bold, color: { argb: 'FF000000' } };
        c.fill = { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
        c.border = {};
        return;
      }
      // A table's text lines up left, its numbers right.
      if (kind === 'data' && typeof val === 'string' && col > 3 && !c.font?.italic) c.alignment = { ...(c.alignment ?? {}), horizontal: 'left' };
      const fc = c.font?.color?.argb;
      if (typeof val === 'string' && (fc === NOTE || fc === 'FF6B7785' || fc === END_FILL) && c.font?.italic && !fillOf(c)) c.font = { name: 'Calibri', size: 9, italic: true, color: { argb: NOTE } };
    });
    if (band) {
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } } as ExcelJS.Fill;
      const from = fillOf(row.getCell(2)) === band ? 2 : 3;
      for (let k = from; k <= lastCol; k++) { const c = row.getCell(k); if (!fillOf(c)) c.fill = fill; }
    }
  });
  // Header alignment follows its column (text left, numbers right, inputs and checks centred); every head wraps.
  ws.eachRow((row, r) => {
    if (r <= 3 || kinds.get(r) !== 'head') return;
    let lines = 1;
    row.eachCell((c) => {
      if (Number(c.col) >= HID || typeof c.value !== 'string' && typeof c.value !== 'number') return;
      const col = Number(c.col);
      const below = ws.getCell(r + (kinds.get(r + 1) === 'unit' ? 2 : 1), col);
      const bv = below.value as unknown; const bvv = bv && typeof bv === 'object' && 'result' in (bv as object) ? (bv as { result: unknown }).result : bv;
      const h: 'left' | 'center' | 'right' = col === 3 ? 'left' : fillOf(below) === INPUT_FILL ? 'center' : typeof bvv === 'number' ? 'right' : 'left';
      c.alignment = { horizontal: h, vertical: 'middle', wrapText: true, shrinkToFit: false };
      const s = String(c.value);
      lines = Math.max(lines, wrapLines(s, width(col), true));
    });
    row.height = Math.max(15, lines * LINE_PT + 4);
  });
  // A text a neighbour would cut wraps, on a row tall enough to show it.
  ws.eachRow((row, r) => {
    if (r <= 3) return;
    const kind = kinds.get(r);
    if (kind === 'head' || kind === 'bar' || kind === 'sub') return;
    let lines = 1;
    row.eachCell({ includeEmpty: false }, (c) => {
      const col = Number(c.col); if (col >= HID) return;
      const v = c.value as unknown; const s = typeof v === 'string' ? v : '';
      if (!s) return;
      // Free space to the right counts for a label or a note, never for a boxed input.
      let room = width(col);
      const boxed = fillOf(c) === INPUT_FILL;
      if (!boxed) for (let k = col + 1; k <= lastCol + 2; k++) { const n = ws.getCell(r, k); if (n.value !== null && n.value !== undefined && n.value !== '' || fillOf(n) === INPUT_FILL) break; room += width(k); }
      if (s.length <= fits(room)) return;
      c.alignment = { ...(c.alignment ?? {}), wrapText: true, vertical: 'top' };
      lines = Math.max(lines, wrapLines(s, width(col), !!c.font?.bold));
    });
    // A wrapped row reads from the top in every cell, so a label lines up with the first line of its text.
    if (lines > 1) { row.height = lines * LINE_PT + 3; row.eachCell({ includeEmpty: false }, (c) => { if (Number(c.col) < HID) c.alignment = { ...(c.alignment ?? {}), vertical: 'top' }; }); }
    else if (row.height && row.height > 15 && kind !== 'note') row.height = 15;
  });
  // A check reads OK or CHECK in the middle of its column, under a centred head.
  ws.eachRow((row, r) => {
    if (r <= 3) return;
    row.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string' || !/"OK"/.test(v.formula)) return;
      c.alignment = { ...(c.alignment ?? {}), horizontal: 'center' };
      for (let up = r - 1; up > 3; up--) { const k = kinds.get(up); if (k === 'head') { const h = ws.getCell(up, Number(c.col)); h.alignment = { ...(h.alignment ?? {}), horizontal: 'center' }; break; } if (k === 'blank' || k === 'bar' || k === 'sub') break; }
    });
  });
  // Every row states its height, so the page breaks below land where Excel and LibreOffice put them.
  for (let r = 1; r <= lastRow + 1; r++) { const row = ws.getRow(r); if (!row.height) row.height = r === 1 ? 20 : kinds.get(r) === 'bar' ? 15 : 12.75; }
  // Print: a fixed scale that fits the width (a fit-to-page setting would move the breaks), the helper columns out
  // of the print area, and a break before a section that would not fit the page it starts on.
  ws.pageSetup.printArea = `A1:${colName(lastCol)}${lastRow + 1}`;
  const colPt = (k: number): number => (width(k) * 7 + 5) * 0.75;
  const totalPt = Array.from({ length: lastCol }, (_, k) => colPt(k + 1)).reduce((a, b) => a + b, 0);
  const landscape = ws.pageSetup.orientation !== 'portrait';
  const paper = landscape ? { w: 11.69, h: 8.27 } : { w: 8.27, h: 11.69 };
  const m = ws.pageSetup.margins ?? { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5 };
  const printW = (paper.w - (m.left ?? 0.4) - (m.right ?? 0.4)) * 72;
  const printH = (paper.h - (m.top ?? 0.5) - (m.bottom ?? 0.5)) * 72;
  const pct = Math.max(10, Math.min(100, Math.floor((printW / totalPt) * 100 * 0.985)));
  ws.pageSetup = { ...ws.pageSetup, fitToPage: false, scale: pct } as unknown as ExcelJS.PageSetup;
  delete (ws.pageSetup as { fitToWidth?: number }).fitToWidth; delete (ws.pageSetup as { fitToHeight?: number }).fitToHeight;
  const pageH = (printH / (pct / 100)) * 0.98;
  const hOf = (r: number): number => ws.getRow(r).height ?? 12.75;
  const span = (from: number, to: number): number => { let t = 0; for (let r = from; r < to; r++) t += hOf(r); return t; };
  const bars = [...kinds].filter(([, k]) => k === 'bar').map(([r]) => r).sort((x, y) => x - y);
  const subs = [...kinds].filter(([, k]) => k === 'sub').map(([r]) => r).sort((x, y) => x - y);
  const end = lastRow + 1;
  // A break goes after the blank row above a section or sub-section, so the new page starts on its heading.
  const breakBefore = (r: number): void => { ws.getRow(r - 1).addPageBreak(); };
  let used = span(1, bars[0] ?? end);
  bars.forEach((a, i) => {
    const next = bars[i + 1] ?? end;
    const whole = span(a, next);
    const mySubs = subs.filter((x) => x > a && x < next);
    // The bar and its first block stay together.
    const firstEnd = mySubs[1] ?? next;
    const first = span(a, firstEnd);
    // A section that fits a page starts on a fresh page when it does not fit what is left of this one;
    // a longer one does too unless that leaves most of this page empty, and then its blocks break on their own.
    if (used > 0 && used + whole > pageH && (whole <= pageH || used + first > pageH || pageH - used < pageH * 0.5)) { breakBefore(a); used = 0; }
    used += span(a, mySubs[0] !== undefined ? (mySubs[1] ?? next) : next);
    if (used > pageH) used = used % pageH;
    for (let k = 1; k < mySubs.length; k++) {
      const s0 = mySubs[k], s1 = mySubs[k + 1] ?? next;
      const h = span(s0, s1);
      if (used > 0 && used + h > pageH && h <= pageH && pageH - used < pageH * 0.5) { breakBefore(s0); used = 0; }
      used += h; if (used > pageH) used = used % pageH;
    }
  });
}

/** The lines a text takes at a column width, broken at spaces. */
function wrapLines(s: string, width: number, bold: boolean): number {
  const cap = fits(width, bold);
  let lines = 1, cur = 0;
  for (const w of s.split(/\s+/)) {
    const len = w.length;
    if (cur === 0) { cur = len; lines += Math.floor(Math.max(0, len - 1) / cap); cur = len % cap || cap; continue; }
    if (cur + 1 + len <= cap) cur += 1 + len;
    else { lines += 1; cur = len > cap ? len % cap || cap : len; if (len > cap) lines += Math.floor((len - 1) / cap); }
  }
  return lines;
}
