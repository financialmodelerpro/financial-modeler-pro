/**
 * dashboard.ts (2026-11-17, founder: "DASHBOARD (replaces Summary; copy the reference exactly for layout, styles,
 * charts)")
 *
 * THE INVESTMENT CASE ON THREE PRINTED PAGES, built after the reference layout (referenceLayout.ts) on the final
 * tabs, so every link reads the row it means where it now is. Every figure is a formula over the model's own tabs;
 * every word that depends on the project comes from a formula or from the platform (a line's type, a phase's
 * name, the strategies the project has), never typed in; a row or a clause the project has nothing for is not
 * built, and the sections below it move up. Scenarios and the sensitivity grid stay the platform's results (as
 * agreed): the Dashboard links the Scenarios tab.
 *
 * Each formula carries the value it shows when the file opens (formulaEval.ts, over the cached figures), so the
 * values file (the live file frozen) shows the same Dashboard.
 *
 * The risk-flag TRIGGERS are inputs on Inputs (section "Dashboard risk triggers"), read here by links.
 *
 * Charts: ExcelJS writes none, so `addDashboardCharts` puts the four chart parts into the package after it is
 * written (the value bridge on page 2, three charts on page 3).
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { FormulaEvaluator, workbookReader, type Scalar } from './formulaEval';

// ── Colours and formats (the reference's) ────────────────────────────────────────────────────────────────────────
const NAVY = 'FF153D64', BAR = 'FF1B4F8A', ZEBRA = 'FFF2F5F9', TOTAL = 'FFDDE7F3', INPUT = 'FFFFF2CC';
const INK = 'FF2A3440', GREY = 'FF6B7785', WHITE = 'FFFFFFFF', PALE = 'FFC9D6E5', BLUE = 'FF0000FF', LINK = 'FF0563C1';
const PCT = '0.0%;(0.0%);"-"', MULT = '0.00"x";(0.00"x");"-"', INT = '#,##0;(#,##0);"-"';

const colL = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const q = (sheet: string): string => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`);
/** An absolute address on a tab: Returns!$F$33. */
const A = (sheet: string, r: number, c: number): string => `${q(sheet)}!$${colL(c)}$${r}`;
/** A row-anchored address (the column moves across): 'P&L'!H$15. */
const AR = (sheet: string, r: number, c: number): string => `${q(sheet)}!${colL(c)}$${r}`;
const RG = (sheet: string, r1: number, c1: number, r2: number, c2: number): string => `${q(sheet)}!$${colL(c1)}$${r1}:$${colL(c2)}$${r2}`;
const txt = (c: ExcelJS.Cell): string => { const v = c.value as unknown; if (typeof v === 'string') return v.trim(); if (v && typeof v === 'object' && 'result' in (v as object) && typeof (v as { result?: unknown }).result === 'string') return String((v as { result: string }).result).trim(); if (v && typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join('').trim(); return ''; };
const isF = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
/** A text formula from pieces: plain words (adjacent ones merged into one quoted string) and expressions, joined by &. */
type Seg = string | { e: string };
function cat(...xs: Seg[]): string {
  const out: string[] = [];
  let lit = '';
  const flush = (): void => { if (lit) out.push(`"${lit.replace(/"/g, '""')}"`); lit = ''; };
  for (const x of xs) { if (typeof x === 'string') lit += x; else { flush(); out.push(x.e); } }
  flush();
  return out.join('&') || '""';
}
const numOf = (c: ExcelJS.Cell): number | null => { const v = c.value as unknown; const n = isF(v) ? v.result : v; return typeof n === 'number' ? n : null; };

/** Rows and columns of the final tabs, found by their words (so another project's rows are found where they are). */
class Locate {
  constructor(private readonly wb: ExcelJS.Workbook) {}
  ws(name: string): ExcelJS.Worksheet { const w = this.wb.getWorksheet(name); if (!w) throw new Error(`dashboard: no ${name} tab`); return w; }
  /** The rows of a numbered section (its bar's text matches), first row under the bar to the row before the next bar. */
  section(sheet: string, re: RegExp): [number, number] | null {
    const ws = this.ws(sheet);
    let from = 0, to = ws.rowCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const b = txt(ws.getCell(r, 2));
      if (!/^\d+\.\s/.test(b)) continue;
      if (from && r > from) { to = r - 1; break; }
      if (re.test(b.replace(/^\d+\.\s+/, ''))) from = r + 1;
    }
    return from ? [from, to] : null;
  }
  /** The first row in [from, to] whose label (column C) matches. */
  row(sheet: string, label: string | RegExp, within?: [number, number] | null, col = 3): number | null {
    const ws = this.ws(sheet);
    const [a, b] = within ?? [1, ws.rowCount];
    for (let r = a; r <= b; r++) { const t = txt(ws.getCell(r, col)); if (typeof label === 'string' ? t === label : label.test(t)) return r; }
    return null;
  }
  rowsAll(sheet: string, label: string | RegExp, within?: [number, number] | null, col = 3): number[] {
    const ws = this.ws(sheet); const out: number[] = [];
    const [a, b] = within ?? [1, ws.rowCount];
    for (let r = a; r <= b; r++) { const t = txt(ws.getCell(r, col)); if (typeof label === 'string' ? t === label : label.test(t)) out.push(r); }
    return out;
  }
  need(sheet: string, label: string | RegExp, within?: [number, number] | null, col = 3): number {
    const r = this.row(sheet, label, within, col);
    if (r === null) throw new Error(`dashboard: ${sheet} has no row "${String(label)}"`);
    return r;
  }
  /** The column of a header in a row. */
  colOf(sheet: string, r: number, head: string | RegExp): number | null {
    const ws = this.ws(sheet);
    for (let c = 1; c <= ws.columnCount; c++) { const t = txt(ws.getCell(r, c)); if (typeof head === 'string' ? t === head : head.test(t)) return c; }
    return null;
  }
  /** The year columns of a time tab (row 4, after the opening column): first and last. */
  years(sheet: string): { first: number; last: number; open: number } {
    const ws = this.ws(sheet);
    let open = 0, first = 0, last = 0;
    ws.getRow(4).eachCell({ includeEmpty: false }, (c, col) => { const f = String(c.numFmt ?? ''); if (f === '"Opening"' && !open) open = col; if (f === '"Dec "0') { if (!first) first = col; last = col; } });
    return { first, last, open };
  }
}

// ── Inputs: the risk triggers (built before the reference layout, so the section is numbered and closed) ───────────
export const RISK_TRIGGER_ROWS: ReadonlyArray<{ key: string; label: string; amber: number; red?: number; fmt: string; basis: string }> = [
  { key: 'margin', label: 'Development margin', amber: 0.2, red: 0.15, fmt: PCT, basis: 'Amber and red below these' },
  { key: 'irrHead', label: 'IRR headroom over the discount rate and the hurdle', amber: 0.02, fmt: PCT, basis: 'Amber within this of the rate; red below it' },
  { key: 'spread', label: 'Development spread (yield on cost less cap)', amber: 0.01, red: 0, fmt: PCT, basis: 'Amber and red below these' },
  { key: 'downMargin', label: 'Downside case: development margin', amber: 0.1, red: 0.05, fmt: PCT, basis: 'Amber and red below these' },
  { key: 'covHead', label: 'Covenant headroom: DSCR, interest cover, debt yield', amber: 0.25, fmt: PCT, basis: 'Amber within this above the covenant; red below it' },
  { key: 'ltvHead', label: 'Covenant headroom: LTV', amber: 0.2, fmt: PCT, basis: 'Amber within this below the covenant; red above it' },
  { key: 'largest', label: 'Largest single line, share of revenue', amber: 0.4, red: 0.6, fmt: PCT, basis: 'Amber and red above these' },
  { key: 'collections', label: 'Construction funded by collections', amber: 0.3, red: 0.5, fmt: PCT, basis: 'Amber and red above these' },
  { key: 'checks', label: 'Model checks failing', amber: 0, red: 0, fmt: INT, basis: 'Amber and red above these' },
];

/**
 * Adds the "Dashboard risk triggers" section at the end of Inputs, in the tab's frame BEFORE the reference layout
 * (label in column A, the amber value in B, the red value in C, the basis in D). Typed inputs, styled as the tab's.
 */
export function addRiskTriggers(wb: ExcelJS.Workbook): void {
  const ws = wb.getWorksheet('Inputs');
  if (!ws) return;
  // A typed input cell to copy the input look from.
  let proto: ExcelJS.Cell | null = null;
  ws.eachRow((row) => row.eachCell((c) => { const f = (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb; if (!proto && f === INPUT && typeof c.value === 'number' && String(c.numFmt).includes('%')) proto = c; }));
  let last = 0; ws.eachRow({ includeEmpty: false }, (_row, r) => { last = r; });
  let barNo = 0; ws.eachRow((row) => { const m = /^(\d+)\.\s/.exec(txt(row.getCell(1))); if (m) barNo = Math.max(barNo, Number(m[1])); });
  let r = last + 2;
  const bar = ws.getRow(r);
  for (let c = 1; c <= 6; c++) bar.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } };
  bar.getCell(1).value = `${barNo + 1}. Dashboard risk triggers`;
  bar.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
  r += 2;
  const heads = ['Test', 'Amber if', 'Red if', 'Basis'];
  heads.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } }; c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } }; });
  r += 1;
  for (const t of RISK_TRIGGER_ROWS) {
    const a = ws.getCell(r, 1); a.value = t.label; a.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } };
    const put = (c: number, v: number): void => {
      const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = t.fmt;
      const p = proto as ExcelJS.Cell | null;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } };
      cell.font = p?.font ? { ...p.font } : { name: 'Calibri', size: 9, color: { argb: BLUE } };
      if (p?.border) cell.border = JSON.parse(JSON.stringify(p.border));
      if (p?.alignment) cell.alignment = { ...p.alignment };
    };
    put(2, t.amber);
    if (t.red !== undefined) put(3, t.red);
    else {
      // An amber-only test has no red trigger of its own (its red is the rate or covenant itself): "n/a", not an input.
      const na = ws.getCell(r, 3); na.value = 'n/a';
      na.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7785' } }; na.alignment = { horizontal: 'right' };
    }
    // The basis sits one indent clear of the right-aligned figures beside it.
    const d = ws.getCell(r, 4); d.value = t.basis; d.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } }; d.alignment = { indent: 1 };
    r += 1;
  }

  // THE CIRCULARITY SWITCH (2026-11-17, founder, open fix 8: "If it drifts, add a circularity switch on Inputs (1 = on),
  // with interest using the switch"). Opened with no stored values, Excel's iteration reads a not yet worked out cell
  // in the financing loop as empty text, and an error that enters a loop never leaves it (TRAPS 3.46). At 0 the
  // interest is 0, the loop is broken and every cell takes a figure; back at 1 the loop iterates from those figures to
  // the platform's. The Guide (section 3) says when to use it.
  r += 1;
  const bar2 = ws.getRow(r);
  for (let c = 1; c <= 6; c++) bar2.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } };
  bar2.getCell(1).value = `${barNo + 2}. Calculation settings`;
  bar2.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
  // The switch sits directly under its bar (no empty row, whose blank left the input's top edge standing alone).
  r += 1;
  const s1 = ws.getCell(r, 1); s1.value = CIRCULARITY_LABEL; s1.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } };
  const s2 = ws.getCell(r, 2); s2.value = 1; s2.numFmt = '0';
  const p = proto as ExcelJS.Cell | null;
  s2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } };
  s2.font = p?.font ? { ...p.font } : { name: 'Calibri', size: 9, color: { argb: BLUE } };
  if (p?.border) s2.border = JSON.parse(JSON.stringify(p.border));
  const s3 = ws.getCell(r, 4); s3.value = 'Set to 0, recalculate (F9), then back to 1 if an error ever fills the financing loop';
  s3.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } }; s3.alignment = { indent: 1 };
  s2.dataValidation = { type: 'whole', operator: 'between', allowBlank: false, formulae: [0, 1], showErrorMessage: true, errorTitle: 'Circularity switch', error: 'Type 1 (on) or 0 (off).' };

  // The switch cuts the loop where it closes: every year of every facility's "Interest charged" row, and every
  // Financing cell that reads the P&L back (the zakat charge and each phase's EBITDA for its dividend cap). With the
  // switch at 0 no cell on the loop depends on itself.
  const fin = wb.getWorksheet('Financing');
  if (!fin) return;
  const sw = `Inputs!$B$${r}`;
  // Two more loops close without interest, and are cut too: the fund fees (the fee base is the equity, and the equity
  // funds the fees: their total) and the cash sweep (the sweep sets the debt repaid at the exit, which sets the cash
  // the sweep takes from).
  const CUT = new Set(['Interest charged', 'Total fund fees', '(-) Swept from cash above the minimum']);
  fin.eachRow((row) => {
    const interest = CUT.has(txt(row.getCell(1)));
    row.eachCell((c, col) => {
      if (col < 2) return;
      const v = c.value as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string' || /^SUM\(/.test(v.formula)) return;
      if (!interest && !/'P&L'!/.test(v.formula)) return;
      c.value = { formula: `IF(${sw}=1,${v.formula},0)`, result: v.result ?? 0 } as ExcelJS.CellValue;
    });
  });
}

export const CIRCULARITY_LABEL = 'Circularity switch (1 = on)';

// ── The Dashboard ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface DashboardContext {
  /** "USD", the project's currency. */
  currency: string;
  /** Money in the units the download chose (the Dashboard's tiles and sentences are always in millions). */
  scale: 'full' | 'thousands' | 'millions';
}
/** The words the project gives, read off the platform's own tables in the workbook. */
interface DashboardWords {
    /** Each sell line, in order: its type label and phase name (the Revenue / P&L / Capex block label is `${type}, ${phase}`). */
    sellLines: Array<{ type: string; phase: string; label: string }>;
    /** The first operated line (hotel), if any. */
    operate?: { type: string; phase: string; label: string };
    /** The first leased line that is not a retail strip, if any. */
    lease?: { type: string; phase: string; label: string };
    phases: string[];
    taxName: 'Zakat' | 'Tax';
    fund: boolean;
    /** The fund manager's name (a fee earner who is not a partner), when a fund is on. */
    feeEarnerNotPartner?: string;
}

/** The project's lines, phases, tax and fund, from Land & Area's "Merged by line" table, Timeline, the P&L and Inputs. */
function wordsOf(L: Locate): DashboardWords {
  const lines = L.section('Land & Area', /^Merged by line$/);
  const out: DashboardWords = { sellLines: [], phases: [], taxName: 'Zakat', fund: false };
  if (lines) {
    const ws = L.ws('Land & Area');
    const head = lines[0];
    const cPh = L.colOf('Land & Area', head, 'Phase') ?? 4, cSt = L.colOf('Land & Area', head, 'Strategy') ?? 5;
    for (let r = head + 1; r <= lines[1]; r++) {
      const type = txt(ws.getCell(r, 3)), phase = txt(ws.getCell(r, cPh)), st = txt(ws.getCell(r, cSt));
      if (!type || /^TOTAL/.test(type)) continue;
      const strip = /^Phase d+, /.test(type);
      const line = { type, phase, label: `${type}, ${phase}` };
      if (st === 'Sell') out.sellLines.push(line);
      else if (st === 'Operate' && !out.operate) out.operate = line;
      else if (st === 'Lease' && !strip && !out.lease) out.lease = line;
    }
  }
  const sched = L.section('Timeline', /^Phase schedule$/);
  if (sched) { const ws = L.ws('Timeline'); for (let r = sched[0] + 1; r <= sched[1]; r++) { const t = txt(ws.getCell(r, 3)); if (!t || t === 'Project') break; out.phases.push(t); } }
  out.taxName = L.row('P&L', /^PROFIT AFTER ZAKAT$/) ? 'Zakat' : 'Tax';
  const fund = L.row('Inputs', 'Fund layer enabled');
  out.fund = !!fund && txt(L.ws('Inputs').getCell(fund, 4)) === 'Yes';
  return out;
}

interface Cx {
  ws: ExcelJS.Worksheet; L: Locate; ev: FormulaEvaluator; money: string; tile: string; unitM: string;
}

type Style = 'label' | 'labelB' | 'value' | 'valueB' | 'unit' | 'note' | 'head' | 'headR' | 'total' | 'totalR' | 'totalRn' | 'grey' | 'input';
function styleCell(c: ExcelJS.Cell, s: Style, fill?: string | null): void {
  const font = (size: number, color: string, bold = false, italic = false): Partial<ExcelJS.Font> => ({ name: 'Calibri', size, bold: bold || undefined, italic: italic || undefined, color: { argb: color } });
  const left = { horizontal: 'left', vertical: 'middle', indent: 1 } as Partial<ExcelJS.Alignment>;
  const right = { horizontal: 'right', vertical: 'middle' } as Partial<ExcelJS.Alignment>;
  switch (s) {
    case 'label': c.font = font(9, INK); c.alignment = left; break;
    case 'labelB': c.font = font(9, INK, true); c.alignment = left; break;
    case 'value': c.font = font(9, INK); c.alignment = right; break;
    case 'valueB': c.font = font(9, INK, true); c.alignment = right; break;
    case 'unit': c.font = font(8, GREY, false, true); c.alignment = left; break;
    case 'note': c.font = font(8, GREY, false, true); c.alignment = left; break;
    case 'grey': c.font = font(9, GREY, false, true); c.alignment = left; break;
    case 'head': c.font = font(9, WHITE, true); c.alignment = left; fill = NAVY; break;
    case 'headR': c.font = font(9, WHITE, true); c.alignment = right; fill = NAVY; break;
    case 'total': c.font = font(9, NAVY, true); c.alignment = left; fill = TOTAL; c.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } }; break;
    case 'totalR': c.font = font(9, NAVY, true); c.alignment = right; fill = TOTAL; c.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } }; break;
    case 'totalRn': c.font = font(9, NAVY); c.alignment = right; fill = TOTAL; c.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } }; break;
    case 'input': c.font = font(9, BLUE); c.alignment = right; fill = INPUT; break;
  }
  if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

export function buildDashboard(wb: ExcelJS.Workbook, ctx: DashboardContext): { charts: ChartSpec[] } {
  const L = new Locate(wb);
  const ev = new FormulaEvaluator(workbookReader(wb));
  let ws = wb.getWorksheet('Dashboard');
  if (!ws) ws = wb.addWorksheet('Dashboard');
  const commas = ctx.scale === 'millions' ? ',,' : ctx.scale === 'thousands' ? ',' : '';
  const money = `#,##0.0${commas};(#,##0.0${commas});"-"`;
  const unitM = ctx.scale === 'millions' ? `${ctx.currency} m` : ctx.scale === 'thousands' ? `${ctx.currency} thousands` : ctx.currency;
  const unitLong = ctx.scale === 'millions' ? `${ctx.currency} millions` : ctx.scale === 'thousands' ? `${ctx.currency} thousands` : ctx.currency;
  const cx: Cx = { ws, L, ev, money, tile: '#,##0.0,,"m";(#,##0.0,,"m");"-"', unitM };
  const charts: ChartSpec[] = [];
  const W = { words: wordsOf(L) };

  // Columns, views and print set-up (three A4 landscape pages, fitted to width).
  [1.5, 1.5, 36, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5].forEach((w, i) => { ws!.getColumn(i + 1).width = w; });
  ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
  ws.properties.tabColor = { argb: NAVY };

  const put = (r: number, c: number, v: unknown, s?: Style, fmt?: string, fill?: string | null): ExcelJS.Cell => {
    const cell = ws!.getCell(r, c);
    if (typeof v === 'string' && v.startsWith('=')) {
      const f = v.slice(1);
      let res: Scalar;
      try { res = ev.evaluate(f, 'Dashboard'); } catch (e) { throw new Error(`dashboard ${colL(c)}${r}: ${(e as Error).message}`); }
      cell.value = { formula: f, result: res === null ? 0 : typeof res === 'object' ? undefined : res } as ExcelJS.CellValue;
    } else cell.value = v as ExcelJS.CellValue;
    if (s) styleCell(cell, s, fill);
    else if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    if (fmt) cell.numFmt = fmt;
    return cell;
  };
  const fillRun = (r: number, c1: number, c2: number, color: string): void => { for (let c = c1; c <= c2; c++) ws!.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; };
  const merge = (r: number, c1: number, c2: number): void => { if (c2 > c1) ws!.mergeCells(r, c1, r, c2); };
  const bar = (r: number, c1: number, c2: number, text: string): void => {
    fillRun(r, c1, c2, BAR);
    const c = ws!.getCell(r, c1); c.value = text; c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } }; c.alignment = { vertical: 'middle' };
    ws!.getRow(r).height = 18;
  };
  const z = (i: number): string | null => (i % 2 === 0 ? ZEBRA : null);

  // ── Locations on the final tabs ──
  const RET = 'Returns', PL = 'P&L', CAP = 'Capex', LA = 'Land & Area', TL = 'Timeline', FIN = 'Financing', CF = 'Cash Flow', INP = 'Inputs', SCN = 'Scenarios';
  const ry = L.years(RET);
  const retA = L.section(RET, /^Assumptions$/), retExit = L.section(RET, /^Exit value$/), retFcff = L.section(RET, /^FCFF/), retFcfe = L.section(RET, /^FCFE/);
  const retDist = L.section(RET, /^Distributions before/), retFee = L.section(RET, /^Performance fee/), retPart = L.section(RET, /^Equity partners$/);
  const retFees = L.section(RET, /^Fund fees and who earns them$/), retSU = L.section(RET, /^Sources and uses/), retKM = L.section(RET, /^Key metrics$/);
  const rDisc = L.need(RET, 'Discount rate', retA), rExitY = L.need(RET, 'Exit year', retA), rCap = L.row(RET, 'Exit cap rate', retA);
  const rNoi = L.need(RET, 'Income capitalised', retExit), rTv = L.need(RET, 'Terminal value', retExit);
  const rFcff = L.need(RET, 'FCFF', retFcff), rFcffRet = L.need(RET, 'Project returns (FCFF)', retFcff);
  const rFcfe = L.need(RET, 'FCFE', retFcfe), rFcfeRet = L.need(RET, 'Equity returns (FCFE)', retFcfe);
  const rDistNet = retDist ? L.row(RET, 'NET DISTRIBUTIONS', retDist) : null, rDistRet = retDist ? L.row(RET, 'Distribution returns, before the fee', retDist) : null;
  const rFeeNet = retFee ? L.row(RET, 'NET DISTRIBUTIONS AFTER THE FEE', retFee) : null, rFeeRet = retFee ? L.row(RET, 'Distribution returns, net of the fee', retFee) : null;
  const rGdv = L.need(RET, 'Gross development value', retKM), rTdc = L.need(RET, 'Total development cost', retKM), rOpex = L.need(RET, 'Operating expenses over the hold', retKM);
  const rFin = L.need(RET, 'Total financing cost', retKM), rSurplus = L.need(RET, 'Development surplus after finance', retKM), rMargin = L.need(RET, 'Development margin', retKM);
  const yoc = L.rowsAll(RET, 'Yield on cost', retKM).filter((r) => numOf(L.ws(RET).getCell(r, 6)) !== null);
  const rYoc = yoc[0] ?? null, rCapX = L.row(RET, 'Cap rate at exit', retKM), rSpread = L.row(RET, 'Development spread', retKM);
  const rDscrY = L.row(RET, 'DSCR', retKM);
  const covHead = L.row(RET, 'Covenant', retKM);
  const cov = (label: string): number | null => (covHead ? L.row(RET, label, [covHead + 1, covHead + 6]) : null);
  const rCovDscr = cov('DSCR'), rCovIcr = cov('Interest Cover (ICR)'), rCovLtv = cov('LTV'), rCovDy = cov('Debt Yield');
  const peaks = L.rowsAll(RET, 'Peak equity', retKM); const rPeakEq = peaks[peaks.length - 1];
  const rNewCash = retPart ? L.row(RET, 'New cash equity', retPart) : null, rInKind = retPart ? L.row(RET, 'In-kind equity', retPart) : null;
  const plSec = L.section(PL, /^Income Statement \(P&L\): Project$/)!;
  const rRev = L.need(PL, 'TOTAL REVENUE', plSec), rEbitda = L.need(PL, 'EBITDA', plSec), rPat = L.need(PL, /^PROFIT AFTER (ZAKAT|TAX)$/, plSec);
  const plRevFirst = plSec[0] + 0, plRevLast = rRev - 1;
  const capSum = L.section(CAP, /^Capex summary/)!;
  const rCapTot = L.need(CAP, 'TOTAL CAPEX', capSum);
  const capType = (l: string): number | null => L.row(CAP, l, capSum);
  const rLandCash = capType('Land, cash'), rLandKind = capType('Land, in-kind'), rRett = capType('RETT'), rHard = capType('Hard costs'), rSoft = capType('Soft costs'), rCont = capType('Contingency'), rFee = capType('Developer fee'), rTypeTot = capType('Total capex by cost type');
  const laPlots = L.section(LA, /^Derived areas by plot$/)!, laLines = L.section(LA, /^Merged by line$/)!;
  const rPlotTot = L.need(LA, 'TOTAL, all plots', laPlots), rLineTot = L.need(LA, 'TOTAL, all lines', laLines);
  const laHead = laPlots[0];
  const cLand = L.colOf(LA, laHead, 'Plot Area (sqm)')!, cGfa = L.colOf(LA, laHead, 'Total GFA (sqm)')!, cNsa = L.colOf(LA, laHead, 'NSA or GLA (sqm)')!, cUnits = L.colOf(LA, laHead, 'Units or Keys')!;
  const cPhase = L.colOf(LA, laHead, 'Phase')!, cStrat = L.colOf(LA, laLines[0], 'Strategy')!;
  const linesFirst = laLines[0] + 1, linesLast = rLineTot - 1, plotsFirst = laHead + 1, plotsLast = rPlotTot - 1;
  const tlSched = L.section(TL, /^Phase schedule$/)!;
  const tlHead = tlSched[0];
  const cCs = L.colOf(TL, tlHead, 'Construction start')!, cCe = L.colOf(TL, tlHead, 'Construction end')!, cOs = L.colOf(TL, tlHead, 'Operations start')!;
  const rProj = L.need(TL, 'Project', tlSched);
  const tlRow = (name: string): number => L.need(TL, name, tlSched);
  const rFinSweep = L.row(FIN, 'Sweep starts (year)');
  const finDebt = L.section(FIN, /^Senior debt$|^(?!Operating|The funding|Interest|Zakat|Tax|Fund fees|Cash waterfall).+/);
  const rDebtClose = finDebt ? L.row(FIN, 'Closing', finDebt) : null;
  const fy = L.years(FIN);
  const cy = L.years(CF);
  const rCfColl = L.need(CF, 'Total cash collected'), rCfCapex = L.need(CF, 'Total capex paid in cash'), rCfEq = L.need(CF, 'Equity drawn in cash'), rCfDebt = L.need(CF, 'Debt drawn'), rCfDiv = L.need(CF, 'Dividends paid'), rCfClose = L.need(CF, 'CLOSING CASH');
  const tly = L.years(TL);
  const checks = L.ws('Checks');
  const chkHead = L.row('Checks', 'Check') ?? 6;
  const cStatus = L.colOf('Checks', chkHead, 'Status') ?? 4;
  const chkRange = RG('Checks', chkHead + 1, cStatus, chkHead + 55, cStatus);
  void checks;
  const inp = (label: string | RegExp, within?: [number, number] | null, col = 3): number | null => L.row(INP, label, within, col);

  // ── Title block ──
  put(1, 2, '=Cover!C2'); ws.getCell(1, 2).font = { name: 'Calibri', size: 14, bold: true, color: { argb: NAVY } };
  const back = ws.getCell(1, 16); back.value = { text: '<- Back to Cover', hyperlink: "#'Cover'!A1" } as ExcelJS.CellValue;
  back.font = { name: 'Calibri', size: 9, underline: true, color: { argb: LINK } }; back.alignment = { horizontal: 'right', vertical: 'middle' };
  put(2, 2, 'Dashboard'); ws.getCell(2, 2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: BAR } };
  put(3, 2, `The investment case on three pages: the decision, the economics, the detail (${unitLong})`); ws.getCell(3, 2).font = { name: 'Calibri', size: 9, italic: true, color: { argb: GREY } };

  // ── The checks bar ──
  const inputsCcy = inp('Currency');
  put(5, 3, `="Model checks:  "&IF(COUNTIF(${chkRange},"CHECK")=0,"ALL OK","CHECK FAILS: "&COUNTIF(${chkRange},"CHECK"))&"     |     Notes:  "&COUNTIF(${chkRange},"NOTE")&"     |     Exit year:  "&${A(RET, rExitY, 6)}${rCap ? `&"     |     Exit cap rate:  "&TEXT(${A(RET, rCap, 6)},"0.0%")` : ''}&"     |     Currency:  "&${inputsCcy ? A(INP, inputsCcy, 4) : `"${ctx.currency}"`}`);
  const c5 = ws.getCell(5, 3); c5.font = { name: 'Calibri', size: 9, bold: true, color: { argb: NAVY } }; c5.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  fillRun(5, 3, 16, TOTAL); ws.getRow(5).height = 18;

  // ── The eight tiles ──
  const tile = (r: number, c: number, cap: string, value: string, fmt: string, sub: string): void => {
    const span = c === 3 ? 2 : 4;
    const a = put(r, c, cap); a.font = { name: 'Calibri', size: 8, bold: true, color: { argb: PALE } }; a.alignment = { vertical: 'bottom', indent: 1 }; a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    const b = put(r + 1, c, value, undefined, fmt); b.font = { name: 'Calibri', size: 20, bold: true, color: { argb: WHITE } }; b.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }; b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    const d = put(r + 2, c, sub); d.font = { name: 'Calibri', size: 8, italic: true, color: { argb: PALE } }; d.alignment = { vertical: 'top', indent: 1 }; d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    for (const rr of [r, r + 1, r + 2]) merge(rr, c, c + span - 1);
  };
  const firstYear = A(TL, L.need(TL, 'First model year'), 6);
  tile(7, 3, 'GROSS DEVELOPMENT VALUE', `=${A(PL, rRev, 6)}`, cx.tile, `="Total revenue, "&${firstYear}&" to "&${A(RET, rExitY, 6)}`);
  tile(7, 5, 'TOTAL DEVELOPMENT COST', `=${A(CAP, rCapTot, 6)}`, cx.tile, '="Land, build, fees and contingency"');
  tile(7, 9, 'DEVELOPMENT MARGIN', `=${A(RET, rMargin, 6)}`, '0.0%', `="Surplus after finance "&TEXT(${A(RET, rSurplus, 6)}/1000000,"#,##0.0")&"m"`);
  const kindPart = rInKind && (numOf(L.ws(RET).getCell(rInKind, 6)) ?? 0) !== 0 ? `&"m + land in kind "&TEXT(${A(RET, rInKind, 6)}/1000000,"#,##0.0")&"m"` : '&"m"';
  tile(7, 13, 'EQUITY INVESTED', `=${A(RET, rPeakEq, 6)}`, cx.tile, rNewCash ? `="Cash "&TEXT(${A(RET, rNewCash, 6)}/1000000,"#,##0.0")${kindPart}` : '=""');
  for (const r of [7, 9]) ws.getRow(r).height = 14;
  ws.getRow(8).height = 27;
  const moicNpv = (r: number): string => `="MOIC "&TEXT(${A(RET, r, 7)},"0.00")&"x  |  NPV "&TEXT(${A(RET, r, 8)}/1000000,"#,##0.0")&"m"`;
  tile(11, 3, 'PROJECT IRR (FCFF)', `=${A(RET, rFcffRet, 6)}`, '0.0%', moicNpv(rFcffRet));
  tile(11, 5, 'EQUITY IRR (FCFE)', `=${A(RET, rFcfeRet, 6)}`, '0.0%', moicNpv(rFcfeRet));
  const hurdle = W.words.fund ? inp('Hurdle rate') : null;
  const netRet = rFeeRet ?? rDistRet ?? rFcfeRet;
  tile(11, 9, rFeeRet ? 'INVESTOR IRR, NET OF THE FEE' : 'DISTRIBUTIONS IRR', `=${A(RET, netRet, 6)}`, '0.0%', hurdle ? `="MOIC "&TEXT(${A(RET, netRet, 7)},"0.00")&"x  |  hurdle "&TEXT(${A(INP, hurdle, 4)},"0.0%")` : `="MOIC "&TEXT(${A(RET, netRet, 7)},"0.00")&"x"`);
  const debtRange = rDebtClose ? RG(FIN, rDebtClose, fy.first, rDebtClose, fy.last) : null;
  tile(11, 13, 'PEAK DEBT', debtRange ? `=MAX(${debtRange})` : '=0', cx.tile,
    debtRange ? `="Peaks in "&INDEX(${RG(TL, 4, tly.first, 4, tly.last)},MATCH(MAX(${debtRange}),${debtRange},0))${rFinSweep ? `&", swept from "&${A(FIN, rFinSweep, 6)}` : ''}` : '="No debt"');
  for (const r of [11, 13]) ws.getRow(r).height = 14;
  ws.getRow(12).height = 27;

  // ── Key messages ──
  bar(15, 3, 16, 'Key messages');
  ws.getCell(15, 3).alignment = { vertical: 'middle' };
  const msgs: string[] = [];
  const sellCrit = [...new Set(W.words.sellLines.map((l) => l.type))];
  const sumIfs = (strategy: string, col: number): string => `SUMIFS(${RG(LA, linesFirst, col, linesLast, col)},${RG(LA, linesFirst, cStrat, linesLast, cStrat)},"${strategy}")`;
  // The scheme's parts, each the platform's count of what the project has: "A, a B and C."
  const parts: Seg[][] = [];
  if (W.words.sellLines.length) parts.push([{ e: `TEXT(${sumIfs('Sell', cUnits)},"#,##0")` }, ' residential units for sale']);
  if (W.words.operate) parts.push(['a ', { e: `TEXT(${sumIfs('Operate', cUnits)},"#,##0")` }, '-key hotel']);
  if (W.words.lease) parts.push([{ e: `TEXT(${sumIfs('Lease', cNsa)},"#,##0")` }, ' sqm of retail to lease']);
  const listed: Seg[] = [];
  parts.forEach((p, i) => { if (i > 0) listed.push(i === parts.length - 1 ? ' and ' : ', '); listed.push(...p); });
  const loc = inp('Location');
  msgs.push(`=${cat('The scheme:  ', { e: `TEXT(${A(LA, rPlotTot, cGfa)},"#,##0")` }, ' sqm of GFA on ', { e: `TEXT(${A(LA, rPlotTot, cLand)},"#,##0")` }, ' sqm of land in ', loc ? { e: A(INP, loc, 4) } : '', ', built in ', { e: A(TL, rProj, 4) }, ' phases from ', { e: `TEXT(${A(TL, rProj, cCs)},"yyyy")` }, ...(parts.length ? [': ', ...listed, '.'] : ['.']))}`);
  msgs.push(`="The value:  GDV of "&TEXT(${A(PL, rRev, 6)}/1000000,"#,##0.0")&"m against a total development cost of "&TEXT(${A(CAP, rCapTot, 6)}/1000000,"#,##0.0")&"m leaves a surplus after finance of "&TEXT(${A(RET, rSurplus, 6)}/1000000,"#,##0.0")&"m: a "&TEXT(${A(RET, rMargin, 6)},"0.0%")&" margin on GDV and "&TEXT(${A(RET, rSurplus, 6)}/${A(RET, rTdc, 6)},"0.0%")&" on cost."`);
  const rSuColl = retSU ? L.row(RET, /^Customer collections/, retSU) : null, rSuTot = retSU ? L.row(RET, 'Total sources', retSU) : null;
  const sellShare = sellCrit.length ? `TEXT((${sellCrit.map((t) => `SUMIFS(${RG(PL, plRevFirst, 6, plRevLast, 6)},${RG(PL, plRevFirst, 3, plRevLast, 3)},"${t}, Phase*")`).join('+')})/${A(PL, rRev, 6)},"0%")` : '';
  const held = [W.words.operate ? 'the hotel' : '', W.words.lease ? 'retail' : ''].filter(Boolean).join(' and ');
  const engine: Seg[][] = [];
  if (sellShare) engine.push(['residential sales are ', { e: sellShare }, ' of revenue']);
  if (rSuColl && rSuTot) engine.push(['customer collections fund ', { e: `TEXT(${A(RET, rSuColl, 6)}/${A(RET, rSuTot, 6)},"0%")` }, ' of construction']);
  const engSegs: Seg[] = ['The engine:  '];
  engine.forEach((e, i) => { if (i) engSegs.push(', and '); engSegs.push(...e); });
  if (held) engSegs.push(`; ${held} add `, { e: `TEXT(${A(RET, rTv, 6)}/1000000,"#,##0.0")` }, 'm of exit value.'); else engSegs.push('.');
  msgs.push(`=${cat(...engSegs)}`);
  const disc = A(RET, rDisc, 6);
  msgs.push(hurdle && rFeeRet
    ? `="The returns:  equity IRR of "&TEXT(${A(RET, rFcfeRet, 6)},"0.0%")&" ("&TEXT(${A(RET, rFcfeRet, 7)},"0.00")&"x); investors net "&TEXT(${A(RET, rFeeRet, 6)},"0.0%")&" after the performance fee, "&IF(${A(RET, rFeeRet, 6)}>=${A(INP, hurdle, 4)},"above","below")&" the "&TEXT(${A(INP, hurdle, 4)},"0.0%")&" hurdle. Project IRR "&TEXT(${A(RET, rFcffRet, 6)},"0.0%")&" against a "&TEXT(${disc},"0.0%")&" discount rate."`
    : `="The returns:  equity IRR of "&TEXT(${A(RET, rFcfeRet, 6)},"0.0%")&" ("&TEXT(${A(RET, rFcfeRet, 7)},"0.00")&"x). Project IRR "&TEXT(${A(RET, rFcffRet, 6)},"0.0%")&" against a "&TEXT(${disc},"0.0%")&" discount rate."`);
  if (debtRange && rCovDscr && rCovLtv) {
    msgs.push(`="The debt:  peaks at "&TEXT(MAX(${debtRange})/1000000,"#,##0.0")&"m${rFinSweep ? `, is swept from "&${A(FIN, rFinSweep, 6)}&"` : ''}, and the worst-year DSCR is "&TEXT(${A(RET, rCovDscr, 7)},"0.00")&"x against a "&TEXT(${A(RET, rCovDscr, 6)},"0.00")&"x covenant; peak LTV "&TEXT(${A(RET, rCovLtv, 7)},"0.0%")&" against "&TEXT(${A(RET, rCovLtv, 6)},"0.0%")&"."`);
  } else msgs.push('="The debt:  the project draws no debt."');
  const scnHead = L.row(SCN, 'Metric') ?? 0;
  const scnCol = (re: RegExp): number | null => (scnHead ? L.colOf(SCN, scnHead, re) : null);
  const cBase = scnCol(/Management|\(active\)|base/i) ?? 5, cDown = scnCol(/Downside/i), cUp = scnCol(/Upside/i);
  const scnRow = (label: string): number | null => L.row(SCN, label);
  const watch: Seg[][] = [];
  if (rYoc && rCapX && rSpread) watch.push(['the held assets yield ', { e: `TEXT(${A(RET, rYoc, 6)},"0.0%")` }, ' on cost against an ', { e: `TEXT(${A(RET, rCapX, 6)},"0.0%")` }, ' exit cap (', { e: `IF(${A(RET, rSpread, 6)}<0,"they are worth less than they cost","they create value")` }, ')']);
  const sMargin = scnRow('Development Margin'), sIrr = scnRow('Equity IRR (FCFE)');
  if (cDown && sMargin && sIrr) watch.push(['in the Downside case the margin falls to ', { e: `TEXT(${A(SCN, sMargin, cDown)},"0.0%")` }, ' and the equity IRR to ', { e: `TEXT(${A(SCN, sIrr, cDown)},"0.0%")` }]);
  const watchSegs: Seg[] = ['Watch:  '];
  watch.forEach((w, i) => { if (i) watchSegs.push('; '); watchSegs.push(...w); });
  watchSegs.push(watch.length ? '.' : 'nothing to flag.');
  msgs.push(`=${cat(...watchSegs)}`);
  msgs.forEach((m, i) => {
    const r = 16 + i;
    put(r, 3, m, 'label', undefined, z(i));
    ws!.getCell(r, 3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    merge(r, 3, 16);
    ws!.getRow(r).height = 17;
  });

  // ── 1. Key assumptions (C to E) and 2. Returns (G to P) ──
  let sec = 0;
  const S = (): number => ++sec;
  const top = 23;
  bar(top, 3, 5, `${S()}. Key assumptions`);
  bar(top, 7, 16, `${S()}. Returns`);
  for (const [c, t, s] of [[3, 'Assumption', 'head'], [4, 'Value', 'headR'], [5, 'Basis', 'headR']] as const) put(top + 1, c, t, s);
  for (const [c, t, s] of [[7, 'Returns', 'head'], [11, 'IRR', 'headR'], [12, 'MOIC', 'headR'], [13, 'NPV', 'headR'], [14, 'Cash in', 'headR'], [15, 'Cash out', 'headR']] as const) put(top + 1, c, t, s);
  fillRun(top + 1, 8, 10, NAVY); fillRun(top + 1, 16, 16, NAVY);
  ws.getRow(top + 1).height = 13.5;

  // The assumptions the project has, each from its own input.
  const inpSec = (re: RegExp): [number, number] | null => L.section(INP, re);
  const subunits = inpSec(/^Assets & Sub-units$/);
  const suHead = subunits ? L.row(INP, 'Line', subunits) : null;
  const cSuRate = suHead ? L.colOf(INP, suHead, /^Rate/) : null, cSuCat = suHead ? L.colOf(INP, suHead, 'Category') : null, cSuShare = suHead ? L.colOf(INP, suHead, /NSA Share/) : null;
  const suRow = (line: string, cat: string): number | null => {
    if (!suHead || !cSuCat) return null;
    const inp = L.ws(INP);
    for (let r = suHead + 1; r <= (subunits?.[1] ?? suHead); r++) {
      if (txt(inp.getCell(r, 3)) !== line || txt(inp.getCell(r, cSuCat)) !== cat) continue;
      if (cSuShare && cat === 'Leasable' && !numOf(inp.getCell(r, cSuShare))) continue;
      return r;
    }
    return null;
  };
  const firstLeaseRow = (): number | null => {
    if (!suHead || !cSuCat) return null;
    const inp = L.ws(INP);
    for (let r = suHead + 1; r <= (subunits?.[1] ?? suHead); r++) if (txt(inp.getCell(r, cSuCat)) === 'Leasable' && (!cSuShare || numOf(inp.getCell(r, cSuShare)))) return r;
    return null;
  };
  const revSec = inpSec(/^Revenue Inputs$/);
  const lineSub = (label: string): [number, number] | null => {
    if (!revSec) return null;
    const inp = L.ws(INP);
    for (let r = revSec[0]; r <= revSec[1]; r++) {
      const t = txt(inp.getCell(r, 3));
      if (/^\d+\.\d+\s/.test(t) && t.replace(/^\d+\.\d+\s+/, '').startsWith(label)) {
        let e = r + 1; while (e <= revSec[1] && !/^\d+\.\d+\s/.test(txt(inp.getCell(e, 3)))) e++;
        return [r + 1, e - 1];
      }
    }
    return null;
  };
  // A grid row runs the full width of its line's grids (the widest header row in the block), as the reference reads it.
  const rowSpan = (r: number, block?: [number, number] | null): [number, number] => {
    const inp = L.ws(INP); let last = 4;
    const [a, b] = block ?? [r, r];
    for (let x = a; x <= b; x++) {
      const head = (inp.getCell(x, 3).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb === BAR;
      if (x !== r && !head) continue;
      for (let c = 4; c <= 16; c++) { const v = inp.getCell(x, c).value; if (v !== null && v !== undefined && v !== '') last = Math.max(last, c); }
    }
    return [4, last];
  };
  const assumptions: Array<{ label: string; value: string; fmt: string; unit: string }> = [];
  const sl = W.words.sellLines;
  if (sl.length) {
    const first = sl[0];
    const sub = suRow(`${first.phase}, ${first.label.replace(/, Phase \d+$/, '')}`, 'Sellable') ?? (suHead ? (() => { const inp = L.ws(INP); for (let r = suHead + 1; r <= (subunits?.[1] ?? suHead); r++) if (txt(inp.getCell(r, cSuCat!)) === 'Sellable') return r; return null; })() : null);
    if (sub && cSuRate) assumptions.push({ label: `${first.type} sale price, today`, value: `=${A(INP, sub, cSuRate)}`, fmt: INT, unit: 'per sqm' });
    const blocks = sl.map((l) => lineSub(`${l.phase}, ${l.type}`));
    const b0 = blocks[0];
    const growth = b0 ? L.row(INP, 'Price Indexation: rate %', b0) : null;
    if (growth) assumptions.push({ label: 'Sale price growth', value: `=${A(INP, growth, 4)}`, fmt: PCT, unit: 'a year' });
    const pre = blocks.map((b) => (b ? (() => { const h = L.row(INP, /^Pre-Sales velocity/, b); return h ? h + 1 : null; })() : null));
    if (pre.every((x) => x !== null)) {
      const f = pre.map((r, k) => { const [a, b] = rowSpan(r!, blocks[k]); return `TEXT(SUM(${RG(INP, r!, a, r!, b)}),"0%")`; }).join('&" / "&');
      assumptions.push({ label: `Sold off-plan, ${sl.map((l) => l.phase).join(' / ')}`, value: `=${f}`, fmt: '@', unit: 'of NSA' });
    }
    const dp = b0 ? L.row(INP, 'Downpayment % by sale year', b0) : null;
    // The downpayments run the width of their own table (the header row just above them).
    if (dp) { const [a, b] = rowSpan(dp, [dp - 1, dp]); assumptions.push({ label: `Downpayment, ${first.phase}`, value: `=TEXT(MIN(${RG(INP, dp, a, dp, b)}),"0%")&" to "&TEXT(MAX(${RG(INP, dp, a, dp, b)}),"0%")`, fmt: '@', unit: 'by sale year' }); }
  }
  const op = W.words.operate;
  if (op && cSuRate) {
    const sub = suRow(`${op.phase}, ${op.type}`, 'Operable');
    if (sub) assumptions.push({ label: 'Hotel ADR, opening year', value: `=${A(INP, sub, cSuRate)}`, fmt: INT, unit: 'per night' });
    const ob = lineSub(`${op.phase}, ${op.type}`);
    const occ = ob ? L.row(INP, 'Occupancy', ob) : null;
    if (occ) { const [a, b] = rowSpan(occ, ob); assumptions.push({ label: 'Hotel occupancy, stabilised', value: `=MAX(${RG(INP, occ, a, occ, b)})`, fmt: PCT, unit: '' }); }
  }
  const lr = firstLeaseRow();
  if (W.words.lease && lr && cSuRate) assumptions.push({ label: 'Retail rent', value: `=${A(INP, lr, cSuRate)}`, fmt: INT, unit: 'per sqm a year' });
  const costStd = inpSec(/^Asset Types & Standards$/);
  const buildTypes = [sl[0]?.type, op?.type].filter((x): x is string => !!x);
  // The construction cost standard of each type (the "Cost standards: construction cost" table, not the type table).
  const consHead = costStd ? L.row(INP, /^\d+\.\d+ Cost standards: construction cost$/, costStd) : null;
  const consTbl: [number, number] | null = consHead && costStd ? [consHead + 1, costStd[1]] : null;
  const buildRows = buildTypes.map((t) => (consTbl ? L.row(INP, t, consTbl) : null));
  const cRateStd = consTbl ? (() => { const h = L.row(INP, 'Item', consTbl); return h ? L.colOf(INP, h, /^Rate/) : null; })() : null;
  if (buildRows.length && buildRows.every((x) => x !== null) && cRateStd) {
    assumptions.push({ label: `Build cost, ${buildTypes.map((t) => t.toLowerCase()).join(' / ')}`, value: `=${buildRows.map((r) => `TEXT(${A(INP, r!, cRateStd)},"#,##0")`).join('&" / "&')}`, fmt: '@', unit: 'per sqm GFA' });
  }
  if (rLandCash && rLandKind) assumptions.push({ label: 'Land value, average', value: `=(${A(CAP, rLandCash, 6)}+${A(CAP, rLandKind, 6)})/${A(LA, rPlotTot, cLand)}`, fmt: INT, unit: 'per sqm of land' });
  const contRow = costStd ? L.row(INP, 'Contingency', costStd) : null, feeRow = costStd ? L.row(INP, 'Developer Fee', costStd) : null;
  if (contRow && feeRow) assumptions.push({ label: 'Contingency / developer fee', value: `=TEXT(${A(INP, contRow, 5)},"0%")&" / "&TEXT(${A(INP, feeRow, 5)},"0%")`, fmt: '@', unit: 'of costs' });
  const finIn = inpSec(/^Financing Inputs$/);
  const facHead = finIn ? L.row(INP, /^Facility|^Debt facilit/, finIn) : null;
  const facRow = finIn ? (() => { const inp = L.ws(INP); const h = L.row(INP, /^7\.3 Debt facilities$/, finIn); if (!h) return null; for (let r = h + 1; r <= finIn[1]; r++) { const v = inp.getCell(r, 5).value; if (typeof v === 'number' || isF(v)) return r; } return null; })() : null;
  void facHead;
  if (facRow) assumptions.push({ label: 'Interest rate (base + margin)', value: `=${A(INP, facRow, 5)}+${A(INP, facRow, 6)}`, fmt: PCT, unit: 'a year' });
  const debtShare = finIn ? L.row(INP, 'Debt share', finIn) : null;
  if (debtShare) assumptions.push({ label: 'Debt share of the funding need', value: `=${A(INP, debtShare, 4)}`, fmt: PCT, unit: '' });
  const retIn = inpSec(/^Returns Inputs$/);
  const capIn = retIn ? L.row(INP, 'Exit Cap Rate (%)', retIn) : null, discIn = retIn ? L.row(INP, 'Discount Rate (%)', retIn) : null;
  if (capIn) assumptions.push({ label: 'Exit cap rate', value: `=${A(INP, capIn, 4)}`, fmt: PCT, unit: 'on NOI' });
  if (discIn) assumptions.push(hurdle
    ? { label: 'Discount rate / hurdle rate', value: `=TEXT(${A(INP, discIn, 4)},"0.0%")&" / "&TEXT(${A(INP, hurdle, 4)},"0.0%")`, fmt: '@', unit: '' }
    : { label: 'Discount rate', value: `=${A(INP, discIn, 4)}`, fmt: PCT, unit: '' });
  const perfFee = W.words.fund ? inp('Performance fee on the excess') : null;
  if (perfFee) assumptions.push({ label: 'Performance fee above the hurdle', value: `=${A(INP, perfFee, 4)}`, fmt: PCT, unit: '' });
  const taxRate = inp(/^(Zakat|Tax) Rate \(%\)$/);
  if (taxRate) assumptions.push({ label: W.words.taxName, value: `=${A(INP, taxRate, 4)}`, fmt: PCT, unit: 'of profit' });
  assumptions.forEach((a, i) => {
    const r = top + 2 + i;
    put(r, 3, a.label, 'label', undefined, z(i));
    put(r, 4, a.value, 'valueB', a.fmt, z(i));
    const u = put(r, 5, a.unit || null, 'unit', undefined, z(i)); void u;
    ws!.getRow(r).height = 13.5;
  });
  const assumEnd = top + 1 + assumptions.length;

  // Returns table.
  const retRows: Array<{ label: string; row: number; stream: number }> = [
    { label: 'Project (FCFF, unlevered)', row: rFcffRet, stream: rFcff },
    { label: 'Equity (FCFE, levered)', row: rFcfeRet, stream: rFcfe },
  ];
  if (rDistRet && rDistNet) retRows.push({ label: 'Distributions, before the performance fee', row: rDistRet, stream: rDistNet });
  if (rFeeRet && rFeeNet) retRows.push({ label: 'Distributions, net of the performance fee', row: rFeeRet, stream: rFeeNet });
  retRows.forEach((x, i) => {
    const r = top + 2 + i, f = z(i);
    put(r, 7, x.label, 'label', undefined, f); merge(r, 7, 10);
    put(r, 11, `=${A(RET, x.row, 6)}`, 'valueB', PCT, f);
    put(r, 12, `=${A(RET, x.row, 7)}`, 'valueB', MULT, f);
    put(r, 13, `=${A(RET, x.row, 8)}`, 'value', money, f);
    const span = RG(RET, x.stream, ry.open || ry.first, x.stream, ry.last);
    put(r, 14, `=SUMIF(${span},">0")`, 'value', money, f);
    put(r, 15, `=SUMIF(${span},"<0")`, 'value', money, f);
    if (f) fillRun(r, 16, 16, f);
  });

  // 3. Risk flags (G to P), below the returns table.
  const riskBar = top + 2 + retRows.length + 1;
  bar(riskBar, 7, 16, `${S()}. Risk flags: hurdles, covenants and resilience`);
  for (const [c, t, s] of [[7, 'Test', 'head'], [10, 'Value', 'headR'], [11, 'Amber if', 'headR'], [12, 'Red if', 'headR'], [13, 'Status', 'headR'], [14, 'Why it matters', 'head']] as const) put(riskBar + 1, c, t, s);
  fillRun(riskBar + 1, 8, 9, NAVY); fillRun(riskBar + 1, 15, 16, NAVY);
  const trig = L.section(INP, /^Dashboard risk triggers$/);
  const trigRow = (key: string): number | null => { const t = RISK_TRIGGER_ROWS.find((x) => x.key === key); return t && trig ? L.row(INP, t.label, trig) : null; };
  const TA = (key: string): string => { const r = trigRow(key); if (!r) throw new Error(`dashboard: no risk trigger ${key}`); return A(INP, r, 4); };
  const TR = (key: string): string => { const r = trigRow(key); if (!r) throw new Error(`dashboard: no risk trigger ${key}`); return A(INP, r, 5); };
  type Risk = { label: string; value: string; fmt: string; amber: string; red: string; above: boolean; why: string; link?: boolean };
  const risks: Risk[] = [];
  risks.push({ label: 'Development margin', value: `=${A(RET, rMargin, 6)}`, fmt: PCT, amber: `=${TA('margin')}`, red: `=${TR('margin')}`, above: false, why: 'Cushion for cost overruns', link: true });
  risks.push({ label: 'Project IRR against the discount rate', value: `=${A(RET, rFcffRet, 6)}`, fmt: PCT, amber: `=${disc}+${TA('irrHead')}`, red: `=${disc}`, above: false, why: 'Does the project earn its cost of capital' });
  if (hurdle && rFeeRet) risks.push({ label: 'Investor net IRR against the hurdle', value: `=${A(RET, rFeeRet, 6)}`, fmt: PCT, amber: `=${A(INP, hurdle, 4)}+${TA('irrHead')}`, red: `=${A(INP, hurdle, 4)}`, above: false, why: 'What investors keep after the fee' });
  if (rSpread) risks.push({ label: 'Development spread (yield on cost less cap)', value: `=${A(RET, rSpread, 6)}`, fmt: PCT, amber: `=${TA('spread')}`, red: `=${TR('spread')}`, above: false, why: 'Held assets add or lose value', link: true });
  if (cDown && sIrr) {
    const bench = hurdle ? A(INP, hurdle, 4) : disc;
    risks.push({ label: 'Downside case: equity IRR', value: `=${A(SCN, sIrr, cDown)}`, fmt: PCT, amber: `=${bench}+${TA('irrHead')}`, red: `=${bench}`, above: false, why: hurdle ? 'Does the hurdle survive a downturn' : 'Does the cost of capital survive a downturn' });
  }
  if (cDown && sMargin) risks.push({ label: 'Downside case: development margin', value: `=${A(SCN, sMargin, cDown)}`, fmt: PCT, amber: `=${TA('downMargin')}`, red: `=${TR('downMargin')}`, above: false, why: 'How close a downturn is to a loss', link: true });
  if (rCovDscr) risks.push({ label: 'DSCR, worst year', value: `=${A(RET, rCovDscr, 7)}`, fmt: MULT, amber: `=${A(RET, rCovDscr, 6)}*(1+${TA('covHead')})`, red: `=${A(RET, rCovDscr, 6)}`, above: false, why: 'Lender covenant with 25% headroom' });
  if (rCovIcr) risks.push({ label: 'Interest cover, worst year', value: `=${A(RET, rCovIcr, 7)}`, fmt: MULT, amber: `=${A(RET, rCovIcr, 6)}*(1+${TA('covHead')})`, red: `=${A(RET, rCovIcr, 6)}`, above: false, why: 'Lender covenant with 25% headroom' });
  if (rCovLtv) risks.push({ label: 'LTV, peak', value: `=${A(RET, rCovLtv, 7)}`, fmt: PCT, amber: `=${A(RET, rCovLtv, 6)}*(1-${TA('ltvHead')})`, red: `=${A(RET, rCovLtv, 6)}`, above: true, why: 'Lender covenant with 20% headroom' });
  if (rCovDy) risks.push({ label: 'Debt yield, worst year', value: `=${A(RET, rCovDy, 7)}`, fmt: PCT, amber: `=${A(RET, rCovDy, 6)}*(1+${TA('covHead')})`, red: `=${A(RET, rCovDy, 6)}`, above: false, why: 'Lender covenant with 25% headroom' });
  risks.push({ label: 'Largest single line, share of revenue', value: `=MAX(${RG(PL, plRevFirst, 6, plRevLast, 6)})/${A(PL, rRev, 6)}`, fmt: PCT, amber: `=${TA('largest')}`, red: `=${TR('largest')}`, above: true, why: 'Reliance on one product', link: true });
  if (rSuColl && rSuTot) risks.push({ label: 'Construction funded by collections', value: `=${A(RET, rSuColl, 6)}/${A(RET, rSuTot, 6)}`, fmt: PCT, amber: `=${TA('collections')}`, red: `=${TR('collections')}`, above: true, why: 'Reliance on off-plan sales', link: true });
  risks.push({ label: 'Model checks failing', value: `=COUNTIF(${chkRange},"CHECK")`, fmt: INT, amber: `=${TA('checks')}`, red: `=${TR('checks')}`, above: true, why: "The model's own reconciliations", link: true });
  risks.forEach((x, i) => {
    const r = riskBar + 2 + i, f = z(i);
    put(r, 7, x.label, 'label', undefined, f); merge(r, 7, 9);
    put(r, 10, x.value, 'valueB', x.fmt, f);
    const a = put(r, 11, x.amber, 'value', x.fmt, f), b = put(r, 12, x.red, 'value', x.fmt, f);
    if (x.link) { for (const c of [a, b]) if (isF(c.value) && /^Inputs!\$[A-Z]+\$\d+$/.test((c.value as { formula: string }).formula)) c.font = { ...c.font, color: { argb: 'FF2E8B3A' } }; }
    const J = `${colL(10)}${r}`, K = `${colL(11)}${r}`, Lc = `${colL(12)}${r}`;
    put(r, 13, x.above ? `=IF(${J}>${Lc},"RED",IF(${J}>${K},"AMBER","GREEN"))` : `=IF(${J}<${Lc},"RED",IF(${J}<${K},"AMBER","GREEN"))`, 'valueB', undefined, f);
    ws!.getCell(r, 13).alignment = { horizontal: 'center', vertical: 'middle' };
    put(r, 14, x.why, 'note', undefined, f); merge(r, 14, 16);
    ws!.addConditionalFormatting({ ref: `M${r}`, rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"RED"'], priority: 1, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC0392B' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"AMBER"'], priority: 2, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF5B041' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"GREEN"'], priority: 3, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF2E8B3A' } } } },
    ] } as never);
  });
  const riskNote = riskBar + 2 + risks.length;
  put(riskNote, 7, 'Triggers are inputs: set them on Inputs (Dashboard risk triggers) to the committee\'s own limits.', 'note');
  for (let r = top + 2; r <= Math.max(assumEnd, riskNote); r++) if (!ws.getRow(r).height) ws.getRow(r).height = 13.5;

  // ── Page 2 ──
  const p2 = Math.max(assumEnd, riskNote) + 3;
  ws.getRow(p2 - 2).addPageBreak();
  bar(p2, 3, 5, `${S()}. Project at a glance`);
  bar(p2, 7, 16, `${S()}. Development economics`);
  for (const [c, t, s] of [[3, 'Item', 'head'], [4, 'Value', 'headR'], [5, 'Unit', 'headR']] as const) put(p2 + 1, c, t, s);
  for (const [c, t, s] of [[7, 'Item', 'head'], [11, unitM, 'headR'], [12, '% of GDV', 'headR'], [13, 'Per sqm GFA', 'headR']] as const) put(p2 + 1, c, t, s);
  fillRun(p2 + 1, 8, 10, NAVY);
  const glance: Array<{ label: string; value: string; fmt: string; unit: string | null; bold?: boolean }> = [];
  if (loc) glance.push({ label: 'Location', value: `=${A(INP, loc, 4)}`, fmt: '@', unit: null });
  for (const ph of W.words.phases) { const r = tlRow(ph); glance.push({ label: `${ph} construction`, value: `=TEXT(${A(TL, r, cCs)},"mmm yyyy")&" to "&TEXT(${A(TL, r, cCe)},"mmm yyyy")`, fmt: '@', unit: null }); }
  glance.push({ label: 'Operations start', value: `=TEXT(${A(TL, tlRow(W.words.phases[0]), cOs)},"mmm yyyy")`, fmt: '@', unit: null });
  glance.push({ label: 'Land area', value: `=${A(LA, rPlotTot, cLand)}`, fmt: INT, unit: 'sqm' });
  glance.push({ label: 'Total GFA', value: `=${A(LA, rPlotTot, cGfa)}`, fmt: INT, unit: 'sqm' });
  glance.push({ label: 'Plot ratio (GFA / land)', value: `=${A(LA, rPlotTot, cGfa)}/${A(LA, rPlotTot, cLand)}`, fmt: '0.00"x"', unit: '' });
  glance.push({ label: 'Saleable and leasable area (NSA)', value: `=${A(LA, rPlotTot, cNsa)}`, fmt: INT, unit: 'sqm' });
  if (sl.length) glance.push({ label: 'Residential units', value: `=${sumIfs('Sell', cUnits)}`, fmt: INT, unit: 'units' });
  if (op) glance.push({ label: 'Hotel keys', value: `=${sumIfs('Operate', cUnits)}`, fmt: INT, unit: 'keys' });
  if (W.words.lease) glance.push({ label: 'Retail to lease', value: `=${sumIfs('Lease', cNsa)}`, fmt: INT, unit: 'sqm' });
  if (op || W.words.lease) {
    glance.push({ label: "Held assets' NOI, year capitalised", value: `=${A(RET, rNoi, 6)}`, fmt: money, unit: unitM });
    glance.push({ label: 'Exit value of the held assets', value: `=${A(RET, rTv, 6)}`, fmt: money, unit: unitM });
  }
  glance.forEach((g, i) => {
    const r = p2 + 2 + i, f = z(i);
    put(r, 3, g.label, 'label', undefined, f);
    put(r, 4, g.value, 'valueB', g.fmt, f);
    if (g.fmt === '@') merge(r, 4, 5);
    else put(r, 5, g.unit, 'unit', undefined, f);
  });
  const gl = A(LA, rPlotTot, cGfa), gdvR = A(RET, rGdv, 6);
  const econ: Array<{ label: string; value: string; kind: 'line' | 'key' | 'pct'; bold?: boolean }> = [
    { label: 'Gross development value', value: `=${gdvR}`, kind: 'line', bold: true },
  ];
  if (rLandCash && rLandKind) econ.push({ label: 'Land, cash and in kind', value: `=${A(CAP, rLandCash, 6)}+${A(CAP, rLandKind, 6)}`, kind: 'line' });
  if (rRett) econ.push({ label: 'Transfer tax (RETT)', value: `=${A(CAP, rRett, 6)}`, kind: 'line' });
  for (const [l, r] of [['Hard costs', rHard], ['Soft costs', rSoft], ['Contingency', rCont], ['Developer fee', rFee]] as const) if (r) econ.push({ label: l, value: `=${A(CAP, r, 6)}`, kind: 'line' });
  if (rTypeTot) econ.push({ label: 'TOTAL DEVELOPMENT COST', value: `=${A(CAP, rTypeTot, 6)}`, kind: 'key' });
  econ.push({ label: 'Operating expenses over the hold', value: `=${A(RET, rOpex, 6)}`, kind: 'line' });
  econ.push({ label: 'Financing cost', value: `=${A(RET, rFin, 6)}`, kind: 'line' });
  econ.push({ label: 'SURPLUS AFTER FINANCE', value: `=${A(RET, rSurplus, 6)}`, kind: 'key' });
  econ.push({ label: 'Development margin (surplus / GDV)', value: `=${A(RET, rMargin, 6)}`, kind: 'pct' });
  econ.push({ label: 'Profit on cost (surplus / total development cost)', value: `=IFERROR(${A(RET, rSurplus, 6)}/${A(RET, rTdc, 6)},0)`, kind: 'pct' });
  if (rYoc) econ.push({ label: 'Yield on cost, held assets', value: `=${A(RET, rYoc, 6)}`, kind: 'pct' });
  if (rSpread) econ.push({ label: 'Development spread (yield on cost less exit cap)', value: `=${A(RET, rSpread, 6)}`, kind: 'pct' });
  let zi = 0;
  econ.forEach((e, i) => {
    const r = p2 + 2 + i;
    if (e.kind === 'key') {
      put(r, 7, e.label, 'total'); merge(r, 7, 10);
      for (let c = 8; c <= 10; c++) ws!.getCell(r, c).border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } };
      put(r, 11, e.value, 'totalR', money);
      put(r, 12, `=IFERROR(K${r}/${gdvR},0)`, 'totalRn', PCT);
      put(r, 13, `=IFERROR(K${r}/${gl},0)`, 'totalRn', INT);
      zi++;
      return;
    }
    const f = z(zi++);
    put(r, 7, e.label, e.bold ? 'labelB' : 'label', undefined, f); merge(r, 7, 10);
    if (e.kind === 'pct') { put(r, 11, e.value, 'valueB', PCT, f); if (f) fillRun(r, 12, 13, f); return; }
    put(r, 11, e.value, e.bold ? 'valueB' : 'value', money, f);
    put(r, 12, `=IFERROR(K${r}/${gdvR},0)`, 'value', PCT, f);
    put(r, 13, `=IFERROR(K${r}/${gl},0)`, 'value', INT, f);
  });
  const spreadRow = econ.findIndex((e) => e.label.startsWith('Development spread'));
  if (spreadRow >= 0) ws.addConditionalFormatting({ ref: `K${p2 + 2 + spreadRow}`, rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1, style: { font: { name: 'Calibri', bold: true, color: { argb: 'FFC0392B' } } } }] } as never);
  const p2a = p2 + 2 + Math.max(glance.length, econ.length) + 1;

  // 6. Sources and uses, 7. Where the value goes.
  bar(p2a, 3, 5, `${S()}. Sources and uses, construction years`);
  bar(p2a, 7, 16, `${S()}. Where the value goes (${unitM})`);
  for (const [c, t, s] of [[3, 'Sources', 'head'], [4, 'Amount', 'headR'], [5, 'Share', 'headR'], [7, 'Step', 'head'], [8, 'Amount', 'headR'], [9, 'Chart base', 'headR']] as const) put(p2a + 1, c, t, s);
  let r = p2a + 2;
  const suRows = (from: number, to: number): number[] => { const out: number[] = []; for (let x = from; x <= to; x++) out.push(x); return out; };
  const totS = rSuTot!, totU = L.need(RET, 'Total uses', retSU);
  const srcRows = suRows(L.need(RET, 'Cash equity', retSU), totS - 1);
  const labelsSU: Record<string, string> = { 'Customer collections during construction': 'Customer collections', 'Customer collections during construction (net of escrow)': 'Customer collections', 'Disposal proceeds during construction': 'Disposal proceeds', 'Interest paid during construction': 'Interest during construction', 'Operating costs paid during construction': 'Operating costs during construction' };
  srcRows.forEach((sr, i) => { const f = z(i); put(r, 3, labelsSU[txt(L.ws(RET).getCell(sr, 3))] ?? txt(L.ws(RET).getCell(sr, 3)), 'label', undefined, f); put(r, 4, `=${A(RET, sr, 6)}`, 'value', money, f); put(r, 5, `=IFERROR(D${r}/${A(RET, totS, 6)},0)`, 'value', PCT, f); r++; });
  put(r, 3, 'TOTAL SOURCES', 'total'); put(r, 4, `=${A(RET, totS, 6)}`, 'totalR', money); put(r, 5, `=IFERROR(D${r}/${A(RET, totS, 6)},0)`, 'totalR', PCT); r++;
  for (const [c, t, s] of [[3, 'Uses', 'head'], [4, 'Amount', 'headR'], [5, 'Share', 'headR']] as const) put(r, c, t, s);
  r++;
  const useRows = suRows(totS + 1, totU - 1);
  const debtRep = L.row(RET, 'Debt repaid during construction', retSU), distC = L.row(RET, 'Distributions during construction', retSU);
  let ui = 0;
  for (const ur of useRows) {
    if (ur === distC && debtRep) continue;
    const f = z(ui++);
    if (ur === debtRep && distC) { put(r, 3, 'Debt repaid and distributions', 'label', undefined, f); put(r, 4, `=${A(RET, debtRep, 6)}+${A(RET, distC, 6)}`, 'value', money, f); }
    else { put(r, 3, labelsSU[txt(L.ws(RET).getCell(ur, 3))] ?? txt(L.ws(RET).getCell(ur, 3)), 'label', undefined, f); put(r, 4, `=${A(RET, ur, 6)}`, 'value', money, f); }
    put(r, 5, `=IFERROR(D${r}/${A(RET, totU, 6)},0)`, 'value', PCT, f);
    r++;
  }
  put(r, 3, 'TOTAL USES', 'total'); put(r, 4, `=${A(RET, totU, 6)}`, 'totalR', money); put(r, 5, `=IFERROR(D${r}/${A(RET, totU, 6)},0)`, 'totalR', PCT);
  const suEnd = r;
  // The value bridge: GDV, then each cost, then the surplus; the chart base draws the waterfall.
  const steps: Array<[string, string]> = [['GDV', `=${A(RET, rGdv, 6)}`]];
  if (rLandCash && rLandKind) steps.push([rRett ? 'Land, RETT' : 'Land', `=${A(CAP, rLandCash, 6)}+${A(CAP, rLandKind, 6)}${rRett ? `+${A(CAP, rRett, 6)}` : ''}`]);
  if (rHard) steps.push(['Hard costs', `=${A(CAP, rHard, 6)}`]);
  if (rSoft) steps.push(['Soft costs', `=${A(CAP, rSoft, 6)}`]);
  if (rCont || rFee) steps.push(['Cont. and fee', `=${[rCont, rFee].filter((x): x is number => !!x).map((x) => A(CAP, x, 6)).join('+')}`]);
  steps.push(['Opex (hold)', `=${A(RET, rOpex, 6)}`]);
  steps.push(['Finance', `=${A(RET, rFin, 6)}`]);
  steps.push(['Surplus', `=${A(RET, rSurplus, 6)}`]);
  const b0 = p2a + 2;
  steps.forEach(([label, f], i) => {
    const rr = b0 + i, fl = z(i);
    put(rr, 7, label, 'label', undefined, fl);
    put(rr, 8, f, 'value', money, fl);
    const base = i === 0 || i === steps.length - 1 ? '=0' : `=H${b0}-SUM(H${b0 + 1}:H${rr})`;
    put(rr, 9, base, 'unit', money, fl);
    ws!.getCell(rr, 9).alignment = { horizontal: 'right', vertical: 'middle' };
  });
  const bridgeEnd = b0 + steps.length - 1;
  put(bridgeEnd + 1, 7, 'Chart base = GDV less the costs so far (draws the waterfall)', 'note');
  charts.push({ kind: 'bridge', anchor: { col: 9, row: p2a }, ext: { cx: 5400000, cy: 2160000 }, cat: `'Dashboard'!$G$${b0}:$G$${bridgeEnd}`, base: `'Dashboard'!$I$${b0}:$I$${bridgeEnd}`, amount: `'Dashboard'!$H$${b0}:$H$${bridgeEnd}`, lastPoint: steps.length - 1 });
  const p2b = Math.max(suEnd, bridgeEnd + 1) + 2;

  // 8. Who gets what.
  bar(p2b, 3, 16, `${S()}. Who gets what`);
  const whoHeads: Array<[number, string, Style]> = [[3, 'Party', 'head'], [4, 'Role', 'headR'], [6, 'Invested', 'headR'], [7, 'Share', 'headR'], [8, 'Distributions', 'headR'], [9, 'IRR', 'headR'], [10, 'MOIC', 'headR'], [11, 'Fees earned', 'headR'], [12, 'Total received', 'headR']];
  for (const [c, t, s] of whoHeads) put(p2b + 1, c, t, s);
  fillRun(p2b + 1, 5, 5, NAVY); fillRun(p2b + 1, 13, 16, NAVY);
  r = p2b + 2;
  const partHead = retPart ? L.row(RET, 'Partner', retPart) : null;
  const partners: number[] = [];
  if (partHead) { const rw = L.ws(RET); for (let x = partHead + 1; x <= retPart![1] && txt(rw.getCell(x, 3)); x++) partners.push(x); }
  const pc = (h: string | RegExp): number | null => (partHead ? L.colOf(RET, partHead, h) : null);
  const cInv = pc('Invested'), cShare = pc('Share'), cDist = pc('Distributions'), cDIrr = pc('Distribution IRR'), cDMoic = pc('Distribution MOIC');
  const earnHead = retFees ? L.row(RET, 'Earner', retFees) : null;
  const earners: number[] = [];
  if (earnHead) { const rw = L.ws(RET); for (let x = earnHead + 1; x <= retFees![1] && txt(rw.getCell(x, 3)) && txt(rw.getCell(x, 3)) !== 'Total'; x++) earners.push(x); }
  const cEarnTot = earnHead ? L.colOf(RET, earnHead, 'Total') : null;
  const feeF = (rr: number): string => (earners.length && cEarnTot ? `=SUMIF(${RG(RET, earners[0], 3, earners[earners.length - 1], 3)},C${rr},${RG(RET, earners[0], cEarnTot, earners[earners.length - 1], cEarnTot)})` : '=0');
  const whoStart = r;
  partners.forEach((pr, i) => {
    const f = z(i);
    put(r, 3, `=${A(RET, pr, 3)}`, 'labelB', undefined, f); put(r, 4, 'Equity partner', 'grey', undefined, f); merge(r, 4, 5);
    ws!.getCell(r, 4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: GREY } };
    put(r, 6, cInv ? `=${A(RET, pr, cInv)}` : '=0', 'value', money, f);
    put(r, 7, cShare ? `=${A(RET, pr, cShare)}` : '=0', 'value', PCT, f);
    put(r, 8, cDist ? `=${A(RET, pr, cDist)}` : '=0', 'value', money, f);
    put(r, 9, cDIrr ? `=${A(RET, pr, cDIrr)}` : '=0', 'valueB', PCT, f);
    put(r, 10, cDMoic ? `=${A(RET, pr, cDMoic)}` : '=0', 'value', MULT, f);
    put(r, 11, feeF(r), 'value', money, f);
    put(r, 12, `=H${r}+K${r}`, 'valueB', money, f);
    if (f) fillRun(r, 13, 16, f);
    r++;
  });
  const partnerNames = new Set(partners.map((pr) => txt(L.ws(RET).getCell(pr, 3))));
  earners.filter((er) => !partnerNames.has(txt(L.ws(RET).getCell(er, 3)))).forEach((er, j) => {
    const f = z(partners.length + j);
    put(r, 3, `=${A(RET, er, 3)}`, 'labelB', undefined, f); put(r, 4, 'Fund manager', 'grey', undefined, f); merge(r, 4, 5);
    ws!.getCell(r, 4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: GREY } };
    for (const c of [6, 7, 8, 9, 10]) put(r, c, '=0', 'value', money, f);
    put(r, 11, feeF(r), 'value', money, f);
    put(r, 12, `=H${r}+K${r}`, 'valueB', money, f);
    if (f) fillRun(r, 13, 16, f);
    r++;
  });
  put(r, 3, 'TOTAL', 'total');
  for (const c of [4, 5, 7, 9, 10]) { const cell = ws.getCell(r, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL } }; cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } } }; }
  for (const c of [6, 8, 11, 12]) put(r, c, `=SUM(${colL(c)}${whoStart}:${colL(c)}${r - 1})`, 'totalR', money);
  const p2c = r + 2;

  // 9. Unit economics of the homes for sale (only with a sell line).
  r = p2c;
  if (sl.length) {
    bar(r, 3, 16, `${S()}. Unit economics of the homes for sale, per sqm of NSA`);
    const heads: Array<[number, string, Style]> = [[3, 'Sell line', 'head'], [4, 'NSA (sqm)', 'headR'], [5, 'Sale price', 'headR'], [6, 'Build cost', 'headR'], [7, '+ IDC', 'headR'], [8, '+ land', 'headR'], [9, 'All-in cost', 'headR'], [10, 'Margin', 'headR'], [11, 'Margin %', 'headR']];
    for (const [c, t, s] of heads) put(r + 1, c, t, s);
    fillRun(r + 1, 12, 16, NAVY);
    r += 2;
    const revSecs = [L.section('Revenue', /^Residential$/)].filter(Boolean) as Array<[number, number]>;
    const allLineLabels: string[] = (() => { const lw = L.ws(LA); const out: string[] = []; for (let x = linesFirst; x <= linesLast; x++) { const t = txt(lw.getCell(x, 3)); out.push(/^Phase \d+, /.test(t) ? t : `${txt(lw.getCell(x, cPhase))}, ${t}`); } return out; })();
    sl.forEach((l, i) => {
      const f = z(i);
      const laRow = (() => { const lw = L.ws(LA); for (let x = linesFirst; x <= linesLast; x++) if (txt(lw.getCell(x, 3)) === l.type && txt(lw.getCell(x, cPhase)) === l.phase && txt(lw.getCell(x, cStrat)) === 'Sell') return x; return null; })();
      const revHead = L.row('Revenue', l.label, revSecs[0] ?? null);
      let rEnd = L.ws('Revenue').rowCount;
      if (revHead) { const rw = L.ws('Revenue'); for (let x = revHead + 1; x <= rw.rowCount; x++) { const t = txt(rw.getCell(x, 3)); const ft = (rw.getCell(x, 3).font as { bold?: boolean; color?: { argb?: string } } | undefined); if (/^\d+\.\s/.test(txt(rw.getCell(x, 2))) || (t && ft?.bold && ft.color?.argb === BAR && t !== 'Area sold' && /, Phase \d+$/.test(t))) { rEnd = x - 1; break; } } }
      const sqm = revHead ? L.row('Revenue', 'Sqm sold', [revHead, rEnd]) : null, sv = revHead ? L.row('Revenue', 'Sale value', [revHead, rEnd]) : null;
      const capHead = L.row(CAP, `${l.phase}: ${l.type}`);
      let capEnd = capHead ?? 0;
      if (capHead) { const cw = L.ws(CAP); for (let x = capHead + 1; x <= cw.rowCount; x++) { const t = txt(cw.getCell(x, 3)); if (/^Phase \d+: /.test(t) || /^PROJECT TOTAL$/.test(t) || !t) { capEnd = x - 1; break; } } }
      const landRows: number[] = [], buildRows2: number[] = [];
      if (capHead) for (let x = capHead + 1; x <= capEnd; x++) { const t = txt(L.ws(CAP).getCell(x, 3)); if (/^(Land \(|RETT)/.test(t)) landRows.push(x); else buildRows2.push(x); }
      // The line's capitalised interest: its own row (its label, maybe with its plots in brackets), never another
      // line's (a retail strip is "<type> (Retail)", a line of its own).
      const own = `${l.phase}, ${l.type}`;
      const otherLines = new Set(allLineLabels.filter((x) => x !== own));
      const idc = (() => {
        const fw = L.ws(FIN); const out: number[] = [];
        for (let x = 1; x <= fw.rowCount; x++) {
          const t = txt(fw.getCell(x, 3));
          if (!(t === own || (t.startsWith(`${own} (`) && !otherLines.has(t)))) continue;
          if (numOf(fw.getCell(x, 6)) !== null || isF(fw.getCell(x, 6).value)) out.push(x);
        }
        return out[out.length - 1] ?? null;
      })();
      put(r, 3, l.label, 'label', undefined, f);
      put(r, 4, laRow ? `=${A(LA, laRow, cNsa)}` : '=0', 'value', INT, f);
      put(r, 5, sv && sqm ? `=IFERROR(${A('Revenue', sv, 6)}/SUM(${RG('Revenue', sqm, 8, sqm, ry.last)}),0)` : '=0', 'valueB', INT, f);
      put(r, 6, buildRows2.length ? `=IFERROR(SUM(${RG(CAP, buildRows2[0], 6, buildRows2[buildRows2.length - 1], 6)})/D${r},0)` : '=0', 'value', INT, f);
      put(r, 7, idc ? `=IFERROR(${A(FIN, idc, 6)}/D${r},0)` : '=0', 'value', INT, f);
      put(r, 8, landRows.length ? `=IFERROR(SUM(${RG(CAP, landRows[0], 6, landRows[landRows.length - 1], 6)})/D${r},0)` : '=0', 'value', INT, f);
      put(r, 9, `=F${r}+G${r}+H${r}`, 'valueB', INT, f);
      put(r, 10, `=E${r}-I${r}`, 'valueB', INT, f);
      put(r, 11, `=IFERROR(J${r}/E${r},0)`, 'valueB', PCT, f);
      if (f) fillRun(r, 12, 16, f);
      r++;
    });
    put(r, 3, 'Sale price is the realised average after price growth; build cost includes soft costs, contingency and developer fee.', 'note');
    r += 2;
  }

  // 10. Phase by phase.
  bar(r, 3, 16, `${S()}. Phase by phase`);
  const ph = r + 1;
  for (const [c, t, s] of [[3, 'Phase', 'head'], [4, 'Built', 'headR'], [6, 'Opens', 'headR'], [7, 'Land (sqm)', 'headR'], [8, 'GFA (sqm)', 'headR'], [9, 'GDV', 'headR'], [10, 'Total cost', 'headR'], [11, 'EBITDA', 'headR'], [12, 'EBITDA / GDV', 'headR'], [13, 'Exit value', 'headR']] as const) put(ph, c, t, s);
  fillRun(ph, 5, 5, NAVY); fillRun(ph, 14, 16, NAVY);
  r = ph + 1;
  W.words.phases.forEach((name, i) => {
    const f = z(i), tr = tlRow(name);
    const psec = L.section(PL, new RegExp(`^Income Statement \\(P&L\\): ${name}$`));
    const cos = psec ? L.row(PL, 'Cost of sales', psec) ?? L.row(PL, /^Operating expenses/, psec) : null;
    const pe = psec ? L.row(PL, 'EBITDA', psec) : null;
    const sub = L.row(CAP, `Subtotal, ${name}`, capSum);
    const exitP = L.row(FIN, `${name}: exit proceeds`);
    put(r, 3, name, 'labelB', undefined, f);
    put(r, 4, `=TEXT(${A(TL, tr, cCs)},"yyyy")&" to "&TEXT(${A(TL, tr, cCe)},"yyyy")`, 'label', undefined, f); merge(r, 4, 5);
    put(r, 6, `=TEXT(${A(TL, tr, cOs)},"mmm yyyy")`, 'value', '@', f);
    put(r, 7, `=SUMIFS(${RG(LA, plotsFirst, cLand, plotsLast, cLand)},${RG(LA, plotsFirst, cPhase, plotsLast, cPhase)},"${name}")`, 'value', INT, f);
    put(r, 8, `=SUMIFS(${RG(LA, plotsFirst, cGfa, plotsLast, cGfa)},${RG(LA, plotsFirst, cPhase, plotsLast, cPhase)},"${name}")`, 'value', INT, f);
    put(r, 9, psec && cos ? `=SUM(${RG(PL, psec[0], 6, cos - 1, 6)})` : '=0', 'value', money, f);
    put(r, 10, sub ? `=${A(CAP, sub, 6)}` : '=0', 'value', money, f);
    put(r, 11, pe ? `=${A(PL, pe, 6)}` : '=0', 'valueB', money, f);
    put(r, 12, `=IFERROR(K${r}/I${r},0)`, 'value', PCT, f);
    put(r, 13, exitP ? `=${A(FIN, exitP, 6)}` : '=0', 'value', money, f);
    if (f) fillRun(r, 14, 16, f);
    r++;
  });
  put(r, 3, 'Phase EBITDA is before the fund fees, which sit at project level.', 'note');
  const p3break = r;
  ws.getRow(p3break).addPageBreak();
  r += 2;

  // ── Page 3: 11. Programme and year by year ──
  bar(r, 3, 16, `${S()}. Programme and year by year (${unitLong})`);
  const yh = r + 1;
  const nYears = tly.last - tly.first + 1;
  const yc = (k: number): number => 5 + k;
  put(yh, 3, 'Line', 'head'); put(yh, 4, 'Total', 'headR');
  for (let k = 0; k < nYears; k++) put(yh, yc(k), `=${AR(TL, 4, tly.first + k)}`, 'headR', '"Dec "0');
  r = yh + 1;
  const flagRow = (label: string): number | null => L.row(TL, label);
  const exitFlag = flagRow('Exit year (1 = yes)');
  const progStart = r;
  for (const name of W.words.phases) {
    const con = flagRow(`${name}: construction year (1 = yes)`), opr = flagRow(`${name}: operating year (1 = yes)`);
    put(r, 3, name, 'labelB');
    for (let k = 0; k < nYears; k++) {
      const col = colL(tly.first + k);
      const f = con && opr ? `=IF(Timeline!${col}$${con}=1,"Build",IF(Timeline!${col}$${opr}=1,${exitFlag ? `IF(Timeline!${col}$${exitFlag}=1,"Exit","Operate")` : '"Operate"'},""))` : '=""';
      const c = put(r, yc(k), f, undefined, '@'); c.font = { name: 'Calibri', size: 8, bold: true, color: { argb: WHITE } }; c.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    const ref = `${colL(yc(0))}${r}:${colL(yc(nYears - 1))}${r}`, first = `${colL(yc(0))}${r}`;
    ws.addConditionalFormatting({ ref, rules: [
      { type: 'expression', formulae: [`${first}="Build"`], priority: 1, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: NAVY } } } },
      { type: 'expression', formulae: [`${first}="Operate"`], priority: 2, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF7FA7D1' } } } },
      { type: 'expression', formulae: [`${first}="Exit"`], priority: 3, style: { font: { name: 'Calibri', bold: true, color: { argb: WHITE } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF2E8B3A' } } } },
    ] } as never);
    r++;
  }
  void progStart;
  r++;
  const yrRows: Array<{ label: string; sheet: string; row: number | null; fmt: string; bold?: boolean; total: boolean; pct?: boolean }> = [
    { label: 'Revenue', sheet: PL, row: rRev, fmt: money, bold: true, total: true },
    { label: 'EBITDA', sheet: PL, row: rEbitda, fmt: money, bold: true, total: true },
    { label: 'EBITDA margin', sheet: '', row: null, fmt: PCT, total: true, pct: true },
    { label: W.words.taxName === 'Zakat' ? 'Profit after zakat' : 'Profit after tax', sheet: PL, row: rPat, fmt: money, total: true },
    { label: 'Customer collections', sheet: CF, row: rCfColl, fmt: money, total: true },
    { label: 'Capex paid in cash', sheet: CF, row: rCfCapex, fmt: money, total: true },
    { label: 'Equity drawn in cash', sheet: CF, row: rCfEq, fmt: money, total: true },
    { label: 'Debt drawn', sheet: CF, row: rCfDebt, fmt: money, total: true },
    { label: 'Debt outstanding, year end', sheet: FIN, row: rDebtClose, fmt: money, total: false },
    { label: 'Dividends paid', sheet: CF, row: rCfDiv, fmt: money, total: true },
    { label: 'Equity cash flow (FCFE)', sheet: RET, row: rFcfe, fmt: money, bold: true, total: true },
    { label: 'Cumulative FCFE', sheet: '', row: null, fmt: money, total: false },
    { label: 'Closing cash', sheet: CF, row: rCfClose, fmt: money, total: false },
    { label: 'DSCR', sheet: RET, row: rDscrY, fmt: MULT, total: false },
  ];
  const at: Record<string, number> = {};
  yrRows.forEach((x, i) => {
    const f = z(i);
    at[x.label] = r;
    put(r, 3, x.label, x.bold ? 'labelB' : 'label', undefined, f);
    const firstCol = x.sheet ? L.years(x.sheet).first : 0;
    for (let k = 0; k < nYears; k++) {
      const c = yc(k), cl = colL(c);
      let fm: string;
      if (x.pct) fm = `=IFERROR(${cl}${at.EBITDA}/${cl}${at.Revenue},0)`;
      else if (x.label === 'Cumulative FCFE') fm = k === 0 ? `=${cl}${at['Equity cash flow (FCFE)']}` : `=${colL(c - 1)}${r}+${cl}${at['Equity cash flow (FCFE)']}`;
      else fm = x.row ? `=${AR(x.sheet, x.row, firstCol + k)}` : '=0';
      put(r, c, fm, x.bold ? 'valueB' : 'value', x.fmt, f);
    }
    if (x.total) put(r, 4, x.pct ? `=IFERROR(D${at.EBITDA}/D${at.Revenue},0)` : `=SUM(${colL(yc(0))}${r}:${colL(yc(nYears - 1))}${r})`, 'valueB', x.fmt, f);
    else if (f) fillRun(r, 4, 4, f);
    r++;
  });
  const lastY = colL(yc(nYears - 1));
  r++;

  // 12. Charts (three, side by side).
  bar(r, 3, 16, `${S()}. Charts`);
  const chartRow = r;
  const catR = `'Dashboard'!$E$${yh}:$${lastY}$${yh}`;
  const ser = (label: string): string => `'Dashboard'!$E$${at[label]}:$${lastY}$${at[label]}`;
  charts.push({ kind: 'revEbitda', anchor: { col: 2, row: chartRow }, ext: { cx: 4176000, cy: 2520000 }, cat: catR, s1: ser('Revenue'), s2: ser('EBITDA') });
  charts.push({ kind: 'funding', anchor: { col: 6, row: chartRow }, ext: { cx: 4176000, cy: 2520000 }, cat: catR, s1: ser('Customer collections'), s2: ser('Debt drawn'), s3: ser('Equity drawn in cash') });
  charts.push({ kind: 'payback', anchor: { col: 11, row: chartRow }, ext: { cx: 4176000, cy: 2520000 }, cat: catR, s1: ser('Equity cash flow (FCFE)'), s2: ser('Cumulative FCFE') });
  r += 17;

  // 13. Scenarios and 14. Sensitivity (platform results).
  const sc = r;
  bar(sc, 3, 6, `${S()}. Scenarios (platform results)`);
  bar(sc, 8, 16, `${S()}. Sensitivity: equity IRR (platform results)`);
  for (const [c, t, s] of [[3, 'Metric', 'head'], [4, 'Downside', 'headR'], [5, 'Base', 'headR'], [6, 'Upside', 'headR']] as const) put(sc + 1, c, t, s);
  const sens = L.row(SCN, /exit cap rate$/);
  const sensCols = sens ? (() => { const sw = L.ws(SCN); const out: number[] = []; for (let c = 4; c <= sw.columnCount; c++) { const v = sw.getCell(sens, c).value; if (v !== null && v !== undefined && v !== '') out.push(c); } return out; })() : [];
  put(sc + 1, 8, null, undefined, undefined, NAVY);
  put(sc + 1, 9, sens ? 'Cash \\ cap rate' : '', 'head'); ws.getCell(sc + 1, 9).font = { name: 'Calibri', size: 8, bold: true, color: { argb: WHITE } };
  sensCols.forEach((c, k) => put(sc + 1, 10 + k, `=${AR(SCN, sens!, c)}`, 'headR', '0.0%'));
  for (let c = 10 + sensCols.length; c <= 16; c++) put(sc + 1, c, null, undefined, undefined, NAVY);
  const scen: Array<[string, string, string]> = [
    ['Equity IRR (FCFE)', 'Equity IRR (FCFE)', PCT], ['Project IRR (FCFF)', 'Project IRR (FCFF)', PCT], ['Investor IRR, net of the fee', 'Distributed Equity IRR', PCT],
    ['Equity MOIC', 'Equity Multiple (FCFE)', MULT], ['Gross development value', 'Gross Development Value', money], ['Total development cost', 'Total Development Cost', money],
    ['Development margin', 'Development Margin', PCT], ['Worst-year DSCR', 'Min DSCR', MULT], ['Peak equity', 'Peak Equity', money],
  ];
  r = sc + 2;
  scen.forEach(([label, src, fmt], i) => {
    const f = z(i), sr = scnRow(src);
    put(r, 3, label, 'label', undefined, f);
    put(r, 4, sr && cDown ? `=${A(SCN, sr, cDown)}` : null, 'value', fmt, f);
    put(r, 5, sr ? `=${A(SCN, sr, cBase)}` : null, 'valueB', fmt, f);
    put(r, 6, sr && cUp ? `=${A(SCN, sr, cUp)}` : null, 'value', fmt, f);
    r++;
  });
  const hurdleOrDisc = hurdle ? A(INP, hurdle, 4) : disc;
  for (const k of [0, 2]) ws.addConditionalFormatting({ ref: `D${sc + 2 + k}:F${sc + 2 + k}`, rules: [{ type: 'cellIs', operator: 'lessThan', formulae: [hurdleOrDisc], priority: 1, style: { font: { name: 'Calibri', bold: true, color: { argb: 'FFC0392B' } } } }] } as never);
  put(r, 3, hurdle ? 'Red: below the hurdle rate. Re-export after changing inputs to refresh.' : 'Red: below the discount rate. Re-export after changing inputs to refresh.', 'note');
  const scEnd = r;
  let sr2 = sc + 2;
  if (sens) {
    const sw = L.ws(SCN);
    for (let x = sens + 1; x <= sw.rowCount && (typeof sw.getCell(x, 3).value === 'string' && /%$/.test(txt(sw.getCell(x, 3)))); x++) {
      put(sr2, 9, `=${A(SCN, x, 3)}`, 'labelB');
      sensCols.forEach((c, k) => put(sr2, 10 + k, `=${AR(SCN, x, c)}`, 'value', PCT));
      sr2++;
    }
    if (sensCols.length) ws.addConditionalFormatting({ ref: `J${sc + 2}:${colL(9 + sensCols.length)}${sr2 - 1}`, rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: [{ argb: 'FFF4C7C3' }, { argb: 'FFFFF2CC' }, { argb: 'FFC6E0B4' }] }] } as never);
    put(sr2, 9, 'Rows: change in operating cash. Columns: exit cap rate.', 'note');
  }
  const end = Math.max(scEnd, sr2) + 3;
  for (let x = 1; x <= end; x++) if (!ws.getRow(x).height) ws.getRow(x).height = 13.5;
  put(end, 3, 'End of sheet', 'head'); fillRun(end, 3, 16, NAVY);

  ws.pageSetup = { ...ws.pageSetup, orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:Q${end}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.5, footer: 0.5 } } as ExcelJS.PageSetup;
  return { charts };
}

// ── Charts, written into the package (ExcelJS writes none) ───────────────────────────────────────────────────────
export type ChartSpec =
  | { kind: 'bridge'; anchor: { col: number; row: number }; ext: { cx: number; cy: number }; cat: string; base: string; amount: string; lastPoint: number }
  | { kind: 'revEbitda' | 'payback'; anchor: { col: number; row: number }; ext: { cx: number; cy: number }; cat: string; s1: string; s2: string }
  | { kind: 'funding'; anchor: { col: number; row: number }; ext: { cx: number; cy: number }; cat: string; s1: string; s2: string; s3: string };

const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const solid = (rgb: string): string => `<a:solidFill ${NS_A}><a:srgbClr val="${rgb}"/></a:solidFill>`;
const lineOf = (rgb?: string): string => `<a:ln ${NS_A}>${rgb ? `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>` : ''}<a:prstDash val="solid"/></a:ln>`;
const title = (t: string): string => `<title><tx><rich><a:bodyPr ${NS_A}/><a:p ${NS_A}><a:pPr><a:defRPr/></a:pPr><a:r><a:t>${t}</a:t></a:r></a:p></rich></tx></title>`;
const axes = (low: boolean): string => `<catAx><axId val="10"/><scaling><orientation val="minMax"/></scaling><delete val="0"/><axPos val="l"/><majorTickMark val="none"/><minorTickMark val="none"/>${low ? '<tickLblPos val="low"/>' : ''}<crossAx val="100"/><lblOffset val="100"/></catAx><valAx><axId val="100"/><scaling><orientation val="minMax"/></scaling><delete val="0"/><axPos val="l"/><numFmt formatCode="#,##0,," sourceLinked="0"/><majorTickMark val="none"/><minorTickMark val="none"/><crossAx val="10"/></valAx>`;
const barSer = (i: number, name: string, rgb: string, cat: string, val: string): string => `<ser><idx val="${i}"/><order val="${i}"/><tx><v>${name}</v></tx><spPr>${solid(rgb)}${lineOf(rgb)}</spPr><invertIfNegative val="0"/><cat><numRef><f>${cat}</f></numRef></cat><val><numRef><f>${val}</f></numRef></val></ser>`;
const tail = '<legend><legendPos val="b"/><overlay val="0"/></legend><plotVisOnly val="1"/><dispBlanksAs val="gap"/></chart></chartSpace>';

export function chartXml(c: ChartSpec): string {
  const head = '<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"><roundedCorners val="0"/><chart>';
  switch (c.kind) {
    case 'bridge':
      return `${head}<plotArea><barChart><barDir val="col"/><grouping val="stacked"/>`
        + `<ser><idx val="0"/><order val="0"/><tx><v>base</v></tx><spPr><a:noFill ${NS_A}/><a:ln ${NS_A}><a:noFill/><a:prstDash val="solid"/></a:ln></spPr><cat><numRef><f>${c.cat}</f></numRef></cat><val><numRef><f>${c.base}</f></numRef></val></ser>`
        + `<ser><idx val="1"/><order val="1"/><tx><v>Amount</v></tx><spPr>${solid('7FA7D1')}${lineOf()}</spPr>`
        + `<dPt><idx val="0"/><spPr>${solid('153D64')}${lineOf()}</spPr></dPt><dPt><idx val="${c.lastPoint}"/><spPr>${solid('2E8B3A')}${lineOf()}</spPr></dPt>`
        + `<cat><numRef><f>${c.cat}</f></numRef></cat><val><numRef><f>${c.amount}</f></numRef></val></ser>`
        + `<gapWidth val="40"/><overlap val="100"/><axId val="10"/><axId val="100"/></barChart>${axes(false)}</plotArea><plotVisOnly val="1"/><dispBlanksAs val="gap"/></chart></chartSpace>`;
    case 'revEbitda':
      return `${head}${title('Revenue and EBITDA')}<plotArea><barChart><barDir val="col"/><grouping val="clustered"/>${barSer(0, 'Revenue', '153D64', c.cat, c.s1)}${barSer(1, 'EBITDA', '7FA7D1', c.cat, c.s2)}<gapWidth val="150"/><axId val="10"/><axId val="100"/></barChart>${axes(true)}</plotArea>${tail}`;
    case 'funding':
      return `${head}${title('How the build is funded')}<plotArea><barChart><barDir val="col"/><grouping val="stacked"/>${barSer(0, 'Customer collections', '7FA7D1', c.cat, c.s1)}${barSer(1, 'Debt drawn', '153D64', c.cat, c.s2)}${barSer(2, 'Equity drawn', '2E8B3A', c.cat, c.s3)}<gapWidth val="150"/><overlap val="100"/><axId val="10"/><axId val="100"/></barChart>${axes(true)}</plotArea>${tail}`;
    case 'payback':
      return `${head}${title('Equity cash flow and payback')}<plotArea><barChart><barDir val="col"/><grouping val="clustered"/>${barSer(0, 'Equity cash flow', '7FA7D1', c.cat, c.s1)}<gapWidth val="150"/><axId val="10"/><axId val="100"/></barChart>`
        + `<lineChart><grouping val="standard"/><ser><idx val="1"/><order val="1"/><tx><v>Cumulative (payback)</v></tx><spPr><a:ln ${NS_A} w="28000"><a:solidFill><a:srgbClr val="153D64"/></a:solidFill><a:prstDash val="solid"/></a:ln></spPr><marker><symbol val="none"/><spPr><a:ln ${NS_A}><a:prstDash val="solid"/></a:ln></spPr></marker><cat><numRef><f>${c.cat}</f></numRef></cat><val><numRef><f>${c.s2}</f></numRef></val><smooth val="0"/></ser><axId val="10"/><axId val="100"/></lineChart>${axes(true)}</plotArea>${tail}`;
  }
}

/** Puts the Dashboard's charts into a written workbook (the sheet named "Dashboard"). */
export async function addDashboardCharts(buf: ArrayBuffer, charts: ChartSpec[]): Promise<ArrayBuffer> {
  if (!charts.length) return buf;
  const z = await JSZip.loadAsync(buf);
  const wbXml = await z.file('xl/workbook.xml')!.async('string');
  const rels = await z.file('xl/_rels/workbook.xml.rels')!.async('string');
  const m = /<sheet [^>]*name="Dashboard"[^>]*r:id="([^"]+)"/.exec(wbXml);
  if (!m) return buf;
  const target = new RegExp(`<Relationship [^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`).exec(rels) ?? new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`).exec(rels);
  if (!target) return buf;
  const sheetPath = `xl/${target[1].replace(/^\/?xl\//, '')}`;
  const sheetName = sheetPath.split('/').pop()!;
  const sheetRelsPath = `xl/worksheets/_rels/${sheetName}.rels`;
  // Fresh part numbers past any the package has.
  const used = (re: RegExp): number => Math.max(0, ...Object.keys(z.files).map((n) => Number(re.exec(n)?.[1] ?? 0)));
  const dNo = used(/^xl\/drawings\/drawing(\d+)\.xml$/) + 1;
  let cNo = used(/^xl\/charts\/chart(\d+)\.xml$/);
  const anchors: string[] = [], dRels: string[] = [];
  charts.forEach((c, i) => {
    cNo++;
    z.file(`xl/charts/chart${cNo}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${chartXml(c)}`);
    dRels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${cNo}.xml"/>`);
    anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${c.anchor.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${c.ext.cx}" cy="${c.ext.cy}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`);
  });
  z.file(`xl/drawings/drawing${dNo}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`);
  z.file(`xl/drawings/_rels/drawing${dNo}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${dRels.join('')}</Relationships>`);
  const relId = 'rIdDash1';
  const existing = z.file(sheetRelsPath) ? await z.file(sheetRelsPath)!.async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  z.file(sheetRelsPath, existing.replace('</Relationships>', `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${dNo}.xml"/></Relationships>`));
  let sx = await z.file(sheetPath)!.async('string');
  if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  // The drawing element sits after the page set-up and the breaks, before any legacy drawing and the table parts.
  const drawing = `<drawing r:id="${relId}"/>`;
  if (/<legacyDrawing /.test(sx)) sx = sx.replace(/<legacyDrawing /, `${drawing}<legacyDrawing `);
  else if (/<tableParts/.test(sx)) sx = sx.replace(/<tableParts/, `${drawing}<tableParts`);
  else if (/<extLst>/.test(sx)) sx = sx.replace(/<extLst>/, `${drawing}<extLst>`);
  else sx = sx.replace('</worksheet>', `${drawing}</worksheet>`);
  z.file(sheetPath, sx);
  let ct = await z.file('[Content_Types].xml')!.async('string');
  const adds: string[] = [`<Override PartName="/xl/drawings/drawing${dNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`];
  for (let k = cNo - charts.length + 1; k <= cNo; k++) adds.push(`<Override PartName="/xl/charts/chart${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  ct = ct.replace('</Types>', `${adds.join('')}</Types>`);
  z.file('[Content_Types].xml', ct);
  return (await z.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
}
