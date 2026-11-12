/**
 * houseStyle.ts (2026-11-12, founder: the export simplification, step 1)
 *
 * THE ONE LOOK BOTH WORKBOOKS WEAR, applied as the LAST step of each build (the values
 * workbook at the end of `buildModelWorkbook`, the live workbook at the end of
 * `buildFormulaWorkbook`, after every layer and check), so no tab builder carries its own
 * version of it and the two files cannot drift. Matched to the founder's hand-built model
 * (docs/EXPORT_SIMPLIFICATION_PLAN.md):
 *
 *   - a title block: the tab title (13pt navy #153D64) with "Back to Cover" beside it and the
 *     units line under it (italic);
 *   - a navy header band (#153D64, white bold) over the period columns, with a phase row above
 *     it naming what each year is (construction, operations, both, the exit year);
 *   - numbered section bars (#1B4F8A, white bold), line items indented;
 *   - inputs blue on yellow (#FFF2CC, dotted top and bottom), cross-sheet links green
 *     (#2E8B3A), calculations black;
 *   - key totals in CAPS, navy on light blue (#DDE7F3) with a top and bottom border;
 *     subtotals grey (#D9D9D9) with a top border;
 *   - one number format per type, money in the units the download chose (by format only,
 *     every stored value stays in full units);
 *   - landscape print, fit to width, no gridlines.
 *
 * IT READS THE ROLES THE BUILDERS ALREADY MARK (a navy-filled label row with figures is a
 * total, a dark band without figures is a section, a grey header cell is a column head, a bold
 * label over bold figures is a subtotal) and restyles them. It changes no stored value and no
 * formula: only text case on a total's label, the section numbers, fills, fonts, borders,
 * widths and number formats. Run it more than once and the result is the same.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { ARGB, BODY_SIZE, type DisplayScale, type DisplayDecimals } from './styles';

/** The house palette (the founder's model). Every fill here is in ALLOWED_FILLS. */
export const HOUSE = {
  band: 'FF153D64',      // header band, key total text, title
  bar: 'FF1B4F8A',       // numbered section bars, inner table heads, sub-headings
  total: 'FFDDE7F3',     // key total fill
  subtotal: 'FFD9D9D9',  // subtotal fill
  input: 'FFFFF2CC',     // input fill
  inputText: 'FF0000FF', // input text
  link: 'FF2E8B3A',      // cross-sheet link text
  calc: 'FF000000',      // calculation text
  ink: 'FF2A3440',       // subtitle text
  slate: 'FF5A6675',     // the phase row label
  white: 'FFFFFFFF',
} as const;

/** The number format for each type of figure (the founder's model). */
export function houseFormats(scale: DisplayScale, decimals: DisplayDecimals): { money: (dec: number) => string; count: string; pct1: string; pct2: string; mult: string } {
  const commas = scale === 'thousands' ? ',' : scale === 'millions' ? ',,' : '';
  const money = (dec: number): string => {
    const d = dec > 0 ? `.${'0'.repeat(dec)}` : '';
    return `#,##0${d}${commas}_);(#,##0${d}${commas});"-"_)`;
  };
  void decimals;
  return { money, count: '#,##0_);(#,##0);"-"_)', pct1: '0.0%;(0.0%);"-"', pct2: '0.00%;(0.00%);"-"', mult: '0.00"x";(0.00"x");"-"' };
}

export interface HouseContext {
  scale: DisplayScale;
  decimals: DisplayDecimals;
  /** The project currency, for a unit written beside a figure. */
  currency?: string;
  /** The "Not used in this project" line for Inputs ('' when everything is used). */
  notUsedLine: string;
  /** The phase row above each period band: its label per model year (index 0 = the first model year). */
  phaseLabels: string[];
  /**
   * Live workbook only: the Timeline formula for the phase label of a period column (column
   * letter in, formula out), so a moved phase relabels its years. Absent = the values workbook
   * (plain labels), or a live build that keeps the labels as typed text.
   */
  timelinePhaseFormula?: (col: string) => string | null;
}

type Cell = ExcelJS.Cell;
const fillOf = (c: Cell): string | undefined => {
  const f = c.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
  return f && f.type === 'pattern' && f.pattern === 'solid' ? f.fgColor?.argb : undefined;
};
const setFill = (c: Cell, argb: string): void => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
const clearFill = (c: Cell): void => { const s = { ...(c.style ?? {}) } as Partial<ExcelJS.Style>; delete s.fill; c.style = s as ExcelJS.Style; };
const isFormula = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const isFigure = (c: Cell): boolean => {
  const v = c.value as unknown;
  if (typeof v === 'number') return true;
  if (isFormula(v)) return typeof v.result === 'number' || v.result === undefined || v.result === null;
  return false;
};
const textOf = (c: Cell): string => (typeof c.value === 'string' ? c.value : '');
const font = (c: Cell, f: Partial<ExcelJS.Font>): void => { c.font = { name: 'Calibri', size: 9, ...(c.font ?? {}), ...f } as ExcelJS.Font; };

const BAR_FILLS = new Set<string>([ARGB.navy, ARGB.sectionDark, HOUSE.bar]);
const HEAD_FILLS = new Set<string>([ARGB.grey]);
const SUB_FILLS = new Set<string>([ARGB.subtotal]);
const LEGACY_LINK = new Set<string>(['FF00B050', HOUSE.link]);
const LEGACY_NAVY_TEXT = new Set<string>([ARGB.navyDark]);
/** A formula that is a reference to another tab and nothing else (a minus sign allowed). */
const LINK_ONLY = /^-?(?:'(?:[^']|'')+'|[A-Za-z0-9_&.]+)!\$?[A-Z]{1,3}\$?\d+$/;

/** The tabs whose rows run across the years (they carry the period band and the phase row). */
function periodSheet(ws: ExcelJS.Worksheet): boolean {
  const f = ws.getCell(3, 6);
  return f.numFmt === '"Dec "0' && f.value !== null && f.value !== undefined;
}

/** The last column a row uses. */
function lastCol(row: ExcelJS.Row): number {
  let n = 0;
  row.eachCell({ includeEmpty: false }, (_c, col) => { if (col > n) n = col; });
  return n;
}

/** A section bar's text without the number this pass gave it. */
const stripNumber = (s: string): string => s.replace(/^\d+\.(\d+)?\s+/, '');

export function applyHouseStyle(wb: ExcelJS.Workbook, ctx: HouseContext): void {
  const fmts = houseFormats(ctx.scale, ctx.decimals);
  for (const ws of wb.worksheets) {
    const isCover = ws.name === 'Cover';
    const timed = periodSheet(ws);
    let widest = 0;
    ws.eachRow((row) => { widest = Math.max(widest, lastCol(row)); });

    // ── Body: roles, fonts, formats ───────────────────────────────────────────────
    let major = 0, minor = 0;
    let hasDark = false, preNumbered = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const a = row.getCell(1);
      if (fillOf(a) === ARGB.sectionDark) hasDark = true;
      // A tab whose builder numbers its sections after the platform's sub-tabs ("2. Revenue Output") keeps them.
      if (fillOf(a) && BAR_FILLS.has(fillOf(a)!) && /^\d+\.(\d+)?\s/.test(textOf(a))) preNumbered = true;
    });
    const firstBody = timed ? 5 : 3;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const a = row.getCell(1);
      const aFill = fillOf(a);
      let figures = 0, boldFigures = 0;
      row.eachCell({ includeEmpty: false }, (c, col) => { if (col >= 2 && isFigure(c)) { figures++; if (c.font?.bold) boldFigures++; } });

      if (!isCover && r >= firstBody && aFill && BAR_FILLS.has(aFill)) {
        if (figures === 0) {
          // A section bar: numbered, #1B4F8A, white bold. An empty one goes.
          const t = stripNumber(textOf(a)).trim();
          if (!t) { row.eachCell({ includeEmpty: true }, (c) => { if (fillOf(c) && BAR_FILLS.has(fillOf(c)!)) clearFill(c); }); return; }
          if (preNumbered) {
            // The builder's own numbers are the majors; a bar under one is its sub-section.
            const own = /^(\d+)\.\s/.exec(textOf(a));
            if (own) { major = Number(own[1]); minor = 0; } else if (major > 0) { minor += 1; a.value = `${major}.${minor} ${t}`; }
          } else {
            const level2 = aFill === ARGB.navy && major > 0 && hasDark;
            if (level2) minor += 1; else { major += 1; minor = 0; }
            a.value = level2 ? `${major}.${minor} ${t}` : `${major}. ${t}`;
          }
          row.eachCell({ includeEmpty: true }, (c) => {
            if (!fillOf(c) || !BAR_FILLS.has(fillOf(c)!)) return;
            setFill(c, HOUSE.bar); font(c, { size: 9, bold: true, italic: false, color: { argb: HOUSE.white } });
          });
          row.height = undefined as never;
          return;
        }
        // A key total: CAPS, navy on light blue, a border above and below.
        if (typeof a.value === 'string') a.value = a.value.toUpperCase();
        row.eachCell({ includeEmpty: true }, (c) => {
          if (!fillOf(c) || !BAR_FILLS.has(fillOf(c)!)) return;
          setFill(c, HOUSE.total);
          font(c, { size: 9, bold: true, color: { argb: HOUSE.band } });
          c.border = { top: { style: 'thin', color: { argb: HOUSE.bar } }, bottom: { style: 'thin', color: { argb: HOUSE.bar } } };
        });
        restyleFormats(row, fmts, ctx);
        return;
      }

      if (aFill && SUB_FILLS.has(aFill)) {
        if (figures === 0) {
          // A line's own heading: navy bold text, no fill.
          row.eachCell({ includeEmpty: true }, (c) => { if (fillOf(c) && SUB_FILLS.has(fillOf(c)!)) clearFill(c); });
          font(a, { size: 9, bold: true, color: { argb: HOUSE.bar } });
          const b = row.getCell(2); if (b.value) font(b, { size: 9, color: { argb: HOUSE.bar } });
        } else {
          row.eachCell({ includeEmpty: true }, (c) => { if (fillOf(c) && SUB_FILLS.has(fillOf(c)!)) setFill(c, HOUSE.subtotal); });
          subtotalBorders(row);
          row.eachCell({ includeEmpty: false }, (c, col) => { if (c.font?.bold || col === 1) font(c, { size: 9, color: { argb: HOUSE.calc } }); });
        }
        restyleFormats(row, fmts, ctx);
        return;
      }

      // Column heads: the top band of a period tab is #153D64, an inner table head #1B4F8A.
      let isHead = false, headTexts = 0;
      row.eachCell({ includeEmpty: true }, (c) => { const f = fillOf(c); if (f && HEAD_FILLS.has(f) && (c.value !== null && c.value !== undefined && c.value !== '')) headTexts++; });
      const top = timed && (r === 3 || r === 4);
      if (!top && headTexts === 1 && figures === 0 && fillOf(a) && HEAD_FILLS.has(fillOf(a)!) && typeof a.value === 'string') {
        // A head row with one label over its block is a heading, not a band.
        row.eachCell({ includeEmpty: true }, (c) => { if (fillOf(c) && HEAD_FILLS.has(fillOf(c)!)) clearFill(c); c.border = {}; });
        font(a, { size: 9, bold: true, color: { argb: HOUSE.bar } });
        return;
      }
      row.eachCell({ includeEmpty: true }, (c, col) => {
        const f = fillOf(c);
        if (!f || !HEAD_FILLS.has(f)) return;
        isHead = true;
        setFill(c, top ? HOUSE.band : HOUSE.bar);
        font(c, { size: 9, bold: true, italic: false, color: { argb: HOUSE.white } });
        c.border = top && r === 4 ? { bottom: { style: 'medium', color: { argb: HOUSE.band } } } : {};
        if (col >= 2) c.alignment = { ...(c.alignment ?? {}), horizontal: 'center', wrapText: true, vertical: 'middle' };
      });
      if (isHead) { restyleFormats(row, fmts, ctx); return; }

      if (!isCover && timed && r >= firstBody && !aFill && a.font?.bold && (typeof a.value === 'string' || isFormula(a.value))) {
        if (figures > 0 && boldFigures > 0) {
          // A subtotal: grey, a border above, black bold.
          const to = Math.max(widest, lastCol(row));
          for (let c = 1; c <= to; c++) { const cell = row.getCell(c); setFill(cell, HOUSE.subtotal); font(cell, { size: 9, bold: true, color: { argb: HOUSE.calc } }); }
          subtotalBorders(row, to);
        } else if (figures === 0) {
          font(a, { size: 9, bold: true, color: { argb: HOUSE.bar } });
        }
      } else if (!isCover && timed && r >= firstBody && !aFill && typeof a.value === 'string' && a.value && !a.font?.bold && figures > 0) {
        // A line item is indented under its heading.
        if (!a.alignment?.indent) a.alignment = { ...(a.alignment ?? {}), indent: 1 };
      }
      restyleFormats(row, fmts, ctx);
    });

    // ── Fonts everywhere: one size, the house colours ───────────────────────────────
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
      const f = c.font;
      if (!f) return;
      const argb = f.color?.argb;
      const next: Partial<ExcelJS.Font> = {};
      if (f.size === BODY_SIZE || f.size === 9.5 || f.size === 8.5) next.size = 9;
      if (argb && LEGACY_LINK.has(argb)) next.color = { argb: HOUSE.link };
      // A cell that only links another tab reads green, whoever wrote it.
      else if ((!argb || argb === HOUSE.calc) && isFormula(c.value) && LINK_ONLY.test(c.value.formula) && !fillOf(c)) next.color = { argb: HOUSE.link };
      else if (argb && LEGACY_NAVY_TEXT.has(argb)) next.color = { argb: HOUSE.band };
      if (Object.keys(next).length) font(c, next);
      if (fillOf(c) === HOUSE.input || fillOf(c) === ARGB.inputFill) styleInput(c);
    }));

    unitLabels(ws, ctx);
    if (isCover) coverLinks(ws, wb);
    if (!isCover) titleBlock(ws, ctx);
    if (timed) phaseRow(ws, ctx);
    if (ws.name === 'Inputs' && ctx.notUsedLine) notUsed(ws, ctx.notUsedLine);
    widenCutColumns(ws);

    // ── Print and view: landscape, fit to width, no gridlines ───────────────────────
    ws.pageSetup = { ...ws.pageSetup, paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    ws.views = (ws.views && ws.views.length ? ws.views : [{}]).map((v) => ({ ...v, showGridLines: false })) as ExcelJS.WorksheetView[];
  }
}

function subtotalBorders(row: ExcelJS.Row, to = lastCol(row)): void {
  for (let c = 1; c <= to; c++) row.getCell(c).border = { top: { style: 'thin', color: { argb: HOUSE.bar } } };
}

function styleInput(c: Cell): void {
  setFill(c, HOUSE.input);
  font(c, { size: 9, color: { argb: HOUSE.inputText } });
  c.border = { top: { style: 'dotted' }, bottom: { style: 'dotted' } };
}

/** Money in the units the download chose, every other type in its one format. */
function restyleFormats(row: ExcelJS.Row, fmts: ReturnType<typeof houseFormats>, ctx: HouseContext): void {
  // A percentage shows one decimal; a TYPED one keeps the second decimal it was typed with, so an
  // input never reads as a rounded version of itself.
  const needs2 = (c: Cell): boolean => {
    if (fillOf(c) !== HOUSE.input) return false;
    const v = isFormula(c.value) ? c.value.result : c.value;
    return typeof v === 'number' && Math.abs(Math.round(v * 1000) - v * 1000) > 1e-6;
  };
  row.eachCell({ includeEmpty: false }, (c) => {
    const nf = c.numFmt ?? '';
    if (!nf || nf === '@' || nf === 'General') return;
    const acc = /^_\(\* #,##0(?:\.(0+))?(,*)_\)/.exec(nf);
    if (acc) {
      const dec = acc[1]?.length ?? 0;
      // A per-unit rate (two decimals, never scaled) keeps full units; every other money cell takes the download's units.
      if (dec === 2 && !acc[2]) { c.numFmt = '#,##0.00_);(#,##0.00);"-"_)'; return; }
      c.numFmt = fmts.money(ctx.decimals || dec);
      return;
    }
    if (nf === '#,##0.0,,_);(#,##0.0,,);"-"_)') { c.numFmt = fmts.money(ctx.decimals); return; }
    if (/^0\.0+%/.test(nf) || nf === '0%') { c.numFmt = needs2(c) ? fmts.pct2 : fmts.pct1; return; }
    if (/^0\.00"x"/.test(nf)) { c.numFmt = fmts.mult; return; }
  });
}

/** Row 1: the title and "Back to Cover"; row 2: the units line. */
function titleBlock(ws: ExcelJS.Worksheet, _ctx: HouseContext): void {
  const t = titleCellOf(ws);
  if (t) font(t, { size: 13, bold: true, italic: false, color: { argb: HOUSE.band } });
  ws.getRow(1).height = 18;
  // Back to Cover: the first free cell right of the title (B for every tab today).
  let col = 2;
  while (col < 8 && ws.getCell(1, col).value !== null && ws.getCell(1, col).value !== undefined && !isBackLink(ws.getCell(1, col))) col++;
  const link = ws.getCell(1, col);
  link.value = { text: 'Back to Cover', hyperlink: "#'Cover'!A1" } as ExcelJS.CellValue;
  link.font = { name: 'Calibri', size: 9, underline: true, color: { argb: HOUSE.bar } };
  link.alignment = { horizontal: 'left', vertical: 'middle' };
  const a2 = ws.getCell(2, 1);
  if (typeof a2.value === 'string') font(a2, { size: 9, italic: true, bold: false, color: { argb: HOUSE.ink } });
}
/** A tab's title: A1, or on a canvas tab (the Guide, a designed Summary) the first text in rows 1 and 2. */
export function titleCellOf(ws: ExcelJS.Worksheet): Cell | null {
  const a1 = ws.getCell(1, 1);
  if (typeof a1.value === 'string' || isFormula(a1.value)) return a1;
  for (const r of [1, 2]) for (let c = 1; c <= 3; c++) {
    const cell = ws.getCell(r, c);
    if (typeof cell.value === 'string' && cell.value.trim()) return cell;
  }
  return null;
}
const isBackLink = (c: Cell): boolean => {
  const v = c.value as { hyperlink?: string } | null;
  return !!v && typeof v === 'object' && v.hyperlink === "#'Cover'!A1";
};

/** Row 2 over the years: what each year is, linked to Timeline in the live workbook. */
function phaseRow(ws: ExcelJS.Worksheet, ctx: HouseContext): void {
  const year3 = (col: number): unknown => { const v = ws.getCell(3, col).value as unknown; return isFormula(v) ? v.result : v; };
  const first = Number(year3(6));
  // A tab that is values by design (Scenarios in the live workbook) keeps values: plain labels, no link.
  let anyFormula = false;
  ws.eachRow({ includeEmpty: false }, (row, r) => { if (r > 2 && !anyFormula) row.eachCell({ includeEmpty: false }, (c, col) => { if (col >= 5 && r > 4 && isFormula(c.value)) anyFormula = true; }); });
  const linkIt = !!ctx.timelinePhaseFormula && anyFormula;
  for (let col = 6; col <= 6 + ctx.phaseLabels.length - 1; col++) {
    const y = Number(year3(col));
    if (!Number.isFinite(y)) break;
    const label = ctx.phaseLabels[y - first] ?? '';
    const c = ws.getCell(2, col);
    const letter = colName(col);
    const own = ws.name === 'Timeline' ? ctx.timelinePhaseFormula?.(letter) ?? null : null;
    if (ws.name === 'Timeline' && own) c.value = { formula: own, result: label } as ExcelJS.CellValue;
    else if (ws.name !== 'Timeline' && linkIt) c.value = { formula: `Timeline!${letter}$2`, result: label } as ExcelJS.CellValue;
    else c.value = label;
    c.numFmt = '@';
    c.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ws.name !== 'Timeline' && linkIt ? HOUSE.link : HOUSE.calc } };
    c.alignment = { horizontal: 'center' };
  }
}

/**
 * A UNIT BESIDE A FIGURE NAMES THE UNITS IT IS SHOWN IN: a "USD m" written next to a money cell
 * (the live Summary) follows the download's units, since the cell's format now does.
 */
function unitLabels(ws: ExcelJS.Worksheet, ctx: HouseContext): void {
  if (!ctx.currency) return;
  const was = `${ctx.currency} m`;
  const now = ctx.scale === 'millions' ? `${ctx.currency} m` : ctx.scale === 'thousands' ? `${ctx.currency} k` : ctx.currency;
  if (now === was) return;
  ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c, col) => {
    if (c.value !== was || col < 2) return;
    if (isFigure(row.getCell(col - 1))) c.value = now;
  }));
}

/** THE COVER LINKS TO EVERY TAB: a contents list where the Cover does not already link each one. */
function coverLinks(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook): void {
  const linked = new Set<string>();
  let last = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    last = r;
    row.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value as { hyperlink?: string } | null;
      const m = v && typeof v === 'object' && typeof v.hyperlink === 'string' ? /^#'?(.+?)'?!/.exec(v.hyperlink) : null;
      if (m) linked.add(m[1].replace(/''/g, "'"));
    });
  });
  const tabs = wb.worksheets.filter((s) => s.name !== ws.name && (s.state === 'visible' || s.state === undefined)).map((s) => s.name);
  if (tabs.every((t) => linked.has(t))) return;
  let r = last + 2;
  const head = ws.getCell(r, 2);
  head.value = 'Contents';
  head.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HOUSE.bar } };
  r += 1;
  for (const t of tabs) {
    const c = ws.getCell(r, 2);
    c.value = { text: `Go to ${t}`, hyperlink: `#'${t.replace(/'/g, "''")}'!A1` } as ExcelJS.CellValue;
    c.font = { name: 'Calibri', size: 9, underline: true, color: { argb: HOUSE.bar } };
    r += 1;
  }
}

function notUsed(ws: ExcelJS.Worksheet, text: string): void {
  // The first empty row under the title block, above the first section.
  for (let r = 3; r <= 12; r++) {
    const row = ws.getRow(r);
    let used = false;
    row.eachCell({ includeEmpty: false }, () => { used = true; });
    if (used) continue;
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: 'Calibri', size: 9, italic: true, color: { argb: HOUSE.slate } };
    return;
  }
  const a2 = ws.getCell(2, 1);
  a2.value = `${typeof a2.value === 'string' ? `${a2.value}. ` : ''}${text}`;
}

/**
 * A NARROW COLUMN NEVER CUTS A VALUE OFF (2026-11-12, founder: Revenue's column C showed
 * "10.00% 3" and a cut "Down %" head). A column narrower than what it holds, in a row that is
 * not a section bar, is widened to fit, up to 30.
 */
function widenCutColumns(ws: ExcelJS.Worksheet): void {
  const need = new Map<number, number>();
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (BAR_FILLS.has(fillOf(row.getCell(1)) ?? '') || fillOf(row.getCell(1)) === HOUSE.bar) return;
    row.eachCell({ includeEmpty: false }, (c, col) => {
      if (col === 1 || col > 4) return;
      if (c.isMerged && c.master.address !== c.address) return;
      const v = c.value as unknown;
      let len = 0;
      if (typeof v === 'string') len = v.length;
      else if (typeof v === 'number' || isFormula(v)) len = 9;
      else if (v && typeof v === 'object' && 'text' in (v as object)) len = String((v as { text: string }).text).length;
      if (!len) return;
      // A label left of empty cells may spill over them; only a value with a neighbour to its right is cut.
      const right = row.getCell(col + 1).value;
      if (typeof v === 'string' && (right === null || right === undefined)) return;
      need.set(col, Math.max(need.get(col) ?? 0, Math.min(30, len + 2)));
    });
  });
  for (const [col, w] of need) {
    const c = ws.getColumn(col);
    if ((c.width ?? 8) < w) c.width = w;
  }
}

function colName(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * THE PHASE OF EACH MODEL YEAR, by the Timeline's own flag rules (`addPeriodFlags`): a phase
 * builds from its start year to its handover year and operates the years after it; the exit
 * year is named as such. Index 0 is the first model year.
 */
export function phaseLabelsFor(
  phases: Array<{ start: number; cp: number; op: number }>,
  axis: number, n: number, exitIdx: number | null,
): string[] {
  const out: string[] = [];
  for (let t = 0; t < n; t++) {
    let con = false, ops = false;
    for (const p of phases) {
      const offset = p.start - axis;
      const cp = Math.max(0, p.cp), op = Math.max(0, p.op);
      const hand = Math.max(0, offset + cp - 1);
      if (t >= offset && t <= offset + cp - 1) con = true;
      if (t > hand && t <= hand + op) ops = true;
    }
    out.push(exitIdx !== null && t === exitIdx ? 'Exit year' : con && ops ? 'Build + Ops' : con ? 'Construction' : ops ? 'Operations' : '');
  }
  return out;
}

/** The Timeline formula for one period column's phase label, from its flag rows. */
export function timelinePhaseFormula(col: string, rows: { con: number[]; ops: number[]; exit: number | null }): string {
  const sum = (rs: number[]): string => (rs.length ? rs.map((r) => `${col}$${r}`).join('+') : '0');
  const c = sum(rows.con), o = sum(rows.ops);
  const body = `IF(${c}>0,IF(${o}>0,"Build + Ops","Construction"),IF(${o}>0,"Operations",""))`;
  return rows.exit !== null ? `IF(${col}$${rows.exit}=1,"Exit year",${body})` : body;
}
