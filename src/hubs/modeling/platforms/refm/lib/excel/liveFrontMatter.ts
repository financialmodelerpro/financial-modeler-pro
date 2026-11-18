/**
 * liveFrontMatter.ts (2026-10-20), THE LIVE WORKBOOK'S COVER, GUIDE AND TAB HEADS.
 *
 * Founder's review of 2026-10-20 (item 10): every model tab is short and easy to read. Each
 * tab has a title row, one units line, then its tables; the "Covers" line, the "On this tab"
 * band and the "How this tab is calculated" block are gone, and the explanations live on the
 * Guide, one short paragraph per tab in plain English. The Cover shows the project name,
 * date, currency, location and horizon only. A sentence that stood as a row of its own on a
 * model tab is removed (`dropNoteRows`); what it said is in the Guide.
 *
 * Live layout only: the hardcoded export keeps its own front matter and guide blocks.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { ARGB, BODY_SIZE, fillRange, setLabel, type DisplayScale } from './styles';
import { notifyRowsDeleted, rowIsRegistered, registerCell } from './cellRegistry';

/** One line per tab: what it does, in plain English (2026-11-16, founder: export simplification step 6). */
export const LIVE_TAB_GUIDE: Array<[string, string]> = [
  ['Summary', 'The project at a glance: headline returns, economics, cost per sqm by line, funding, scheme and phases.'],
  ['Inputs', 'Every number you can change: shaded cells are inputs; type over them and every tab recalculates.'],
  ['Timeline', "The model years, each phase's dates and the flags every tab reads (construction, operations, exit)."],
  ['Land & Area', "Each plot's value and its areas from the top down, merged by line; Capex and Revenue take their quantities here."],
  ['Revenue', 'One path per line: sales and collections for a sell line; occupancy, rate and revenue for a hotel or lease line.'],
  ['Capex', 'Each cost line per asset: rate x quantity x spend share x escalation, by year, with and without land.'],
  ['Opex', 'Operating costs per hotel and lease line, by year of operation.'],
  ['Schedules', 'Fixed assets and depreciation per held asset, and cost of sales and inventory per sell line.'],
  ['Financing', 'The funding need, draws, interest, repayments, sweep, dividends and the exit, in year order with no circular reference.'],
  ['P&L', 'Revenue to EBITDA by line, then depreciation, interest, the gain on disposal and zakat; phases to EBITDA.'],
  ['Cash Flow', 'Cash in and out by the direct method, and opening and closing cash.'],
  ['Balance Sheet', 'Balances at each year end with the equity roll-forward; the check row must read zero.'],
  ['Returns', 'The exit value; FCFF, FCFE and distributions, each with IRR, MOIC and NPV; partners, fees, sources and uses, key metrics.'],
  ['Scenarios', 'The cases, the assumptions that differ, the comparison, the sensitivity grid and exit years (platform results).'],
  ['Checks', "The identities that prove the model holds together, and Revenue's own checks: OK holds, CHECK fails, NOTE advises."],
];

export interface CoverData {
  name: string;
  modelType: string;
  date: string;
  currency: string;
  /** "USD millions": the units the money figures are shown in. */
  unit: string;
  /** The money format of those units. */
  moneyFmt: string;
  location: string;
  phases: string;
  lines: string;
  horizon: string;
  exitYear: string;
  workbook: string;
  headlines: { gdv: number; tdc: number; irr: number | null; moic: number | null };
  /** The tabs to link, each with its one line. */
  nav: Array<[string, string]>;
}

/**
 * THE COVER (2026-11-17, founder: modelled on the founder's own model's Cover, adapted to the user's project).
 * A navy banner with the project and model type and the tagline, the FMP logo, "About this model" worked out
 * from the project, the headline figures, a link to every tab with its one line, and a footer. No author bio:
 * the model is the user's. The headline cells are registered (`cover|gdv` and so on) so the live workbook can
 * link them to Returns.
 */
export function buildLiveCover(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, d: CoverData, logoBase64?: string): void {
  const NAVY = 'FF153D64', BAR = 'FF1B4F8A', LIGHT = 'FFDDE7F3', INK = 'FF000000';
  [2.5, 3, 30, 30, 30, 30, 3].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
  const band = (r: number): void => { for (let c = 3; c <= 6; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; };
  band(2); band(3);
  const t = ws.getCell('C2'); t.value = `${/^FMP\b/i.test(d.name) ? '' : 'FMP - '}${d.name || 'Untitled Project'}  |  ${d.modelType}`; t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  const s = ws.getCell('C3'); s.value = 'Structured Modeling. Real-World Finance.'; s.font = { name: 'Calibri', size: 9, italic: true, color: { argb: LIGHT } };
  ws.getRow(2).height = 26; ws.getRow(3).height = 16;
  if (logoBase64) {
    const id = wb.addImage({ base64: logoBase64, extension: 'png' });
    ws.addImage(id, { tl: { col: 5.55, row: 4.2 }, ext: { width: 96, height: 96 } });
  }
  let r = 5;
  const head = (text: string): void => { const c = ws.getCell(r, 3); c.value = text; c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BAR } }; r += 1; };
  const pair = (label: string, value: string | number, fmt?: string, key?: string): void => {
    const a = ws.getCell(r, 3); a.value = label; a.font = { name: 'Calibri', size: 9, color: { argb: INK } };
    const b = ws.getCell(r, 4); b.value = value; b.font = { name: 'Calibri', size: 9, bold: true, color: { argb: INK } };
    b.alignment = { horizontal: typeof value === 'number' ? 'right' : 'left' };
    if (fmt) b.numFmt = fmt;
    if (key) registerCell(key, ws, b);
    r += 1;
  };
  head('About this model');
  pair('Location', d.location || 'Not stated');
  pair('Currency', d.currency);
  pair('Phases', d.phases);
  pair('Lines', d.lines);
  pair('Horizon', d.horizon);
  pair('Exit year', d.exitYear);
  pair('Exported', d.date);
  pair('Workbook', d.workbook);
  r += 1;
  head(`Key figures (${d.unit})`);
  pair('Gross development value', d.headlines.gdv, d.moneyFmt, 'cover|gdv');
  pair('Total development cost', d.headlines.tdc, d.moneyFmt, 'cover|tdc');
  pair('Equity IRR', d.headlines.irr ?? 'n/a', '0.0%', 'cover|irr');
  pair('Equity MOIC', d.headlines.moic ?? 'n/a', '0.00"x"', 'cover|moic');
  r += 1;
  head('Quick navigation');
  for (const [tab, line] of d.nav) {
    const a = ws.getCell(r, 3); a.value = { text: `-> Go to ${tab}`, hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` } as ExcelJS.CellValue;
    a.font = { name: 'Calibri', size: 9, color: { argb: BAR }, underline: true };
    ws.mergeCells(r, 4, r, 6);
    const b = ws.getCell(r, 4); b.value = line; b.font = { name: 'Calibri', size: 9, color: { argb: INK } }; b.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = line.length > 95 ? 24 : 13;
    r += 1;
  }
  r += 1;
  band(r); band(r + 1);
  const f1 = ws.getCell(r, 3); f1.value = 'Built with Financial Modeler Pro, financialmodelerpro.com'; f1.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  const f2 = ws.getCell(r + 1, 3); f2.value = 'The results depend on the inputs entered for this project: review them before relying on any figure.'; f2.font = { name: 'Calibri', size: 8, italic: true, color: { argb: LIGHT } };
  ws.pageSetup = { ...ws.pageSetup, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
}

/** The Guide: the colour legend, then one paragraph per tab. The loop links follow (formulaWorkbook). */
export function buildLiveGuide(ws: ExcelJS.Worksheet, markInput: (c: ExcelJS.Cell) => void, valuesFile = false): void {
  ws.getColumn(1).width = 3; ws.getColumn(2).width = 18; ws.getColumn(3).width = 100;
  const t = ws.getCell('B2'); t.value = 'Guide'; t.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy } };
  let r = 4;
  const head = (text: string): void => { setLabel(ws.getCell(r, 2), text, { bold: true }); fillRange(ws, r, 2, r, 3, ARGB.subtotal); r += 1; };
  // THE LEGEND (2026-11-17, founder): input, link from another tab, calculation, key total and check, each
  // shown as it looks; one font size on the whole tab.
  head('Colours');
  const swatch = (word: string, style: (c: ExcelJS.Cell) => void, text: string): void => {
    const c = ws.getCell(r, 2); c.value = word; c.font = { name: 'Calibri', size: BODY_SIZE }; style(c);
    const d = ws.getCell(r, 3); d.value = text; d.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    r += 1;
  };
  swatch('Input', (c) => markInput(c), valuesFile ? 'Blue on yellow: a value typed on the platform; change it there and export again.' : 'Blue on yellow: an input; type over it and every tab recalculates.');
  swatch('Link', (c) => { c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: 'FF2E8B3A' } }; }, valuesFile ? 'Green: a figure carried from another tab.' : 'Green: a cell that only reads another tab.');
  swatch('Calculation', (c) => { c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: 'FF000000' } }; }, valuesFile ? 'Black: the platform result as of export (this file holds values, not formulas).' : 'Black: a formula on this tab.');
  swatch('KEY TOTAL', (c) => { c.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: 'FF153D64' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE7F3' } }; }, 'Capitals, navy on light blue: a total the statements and returns are built on.');
  swatch('Check', (c) => { c.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.good } }; }, 'On the Checks tab: OK holds, CHECK fails, NOTE advises.');
  r += 1;
  head('The tabs');
  // The values file says what IT is: the tabs that talk of typing over an input or of Excel iterating.
  const VALUES_TEXT: Record<string, string> = {
    Inputs: 'Every number the model takes: shaded cells were typed on the platform; change them there and export again.',
    Financing: 'The funding need, draws, interest, repayments, sweep, dividends and the exit, as the platform solved them.',
  };
  for (const [tab, liveText] of LIVE_TAB_GUIDE) {
    const text = valuesFile ? VALUES_TEXT[tab] ?? liveText : liveText;
    const a = ws.getCell(r, 2); a.value = { text: tab, hyperlink: `#'${tab}'!A1` } as ExcelJS.CellValue;
    a.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy }, underline: true }; a.alignment = { vertical: 'top' };
    const b = ws.getCell(r, 3); b.value = text; b.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; b.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = Math.max(15, Math.ceil(text.length / 110) * 15);
    r += 1;
  }
}

/** The units line under each model tab's title. */
export function liveUnitsLine(sheet: string, currency: string, scale: DisplayScale): string {
  const money = `${currency}${scale === 'millions' ? ' millions' : scale === 'thousands' ? ' thousands' : ''}`;
  switch (sheet) {
    case 'Inputs': return `${currency}; areas in sqm`;
    case 'Timeline': return 'Years';
    // Land values follow the download's units like every money cell (2026-11-12, founder); areas stay in sqm.
    case 'Land & Area': return `Areas in sqm; land values in ${money}`;
    default: return money;
  }
}

/**
 * A ROW THAT IS ONLY A SENTENCE IS REMOVED (live layout): every non-empty cell is text, one of
 * them is a sentence (over 60 characters), none is a band or a column header (no fill) and no
 * cell on it is registered. The rows below move up, and so do the registry, the merges and the
 * hyperlinks into the tab. Run on finished sheets, before any formula is written.
 */
export function dropNoteRows(ws: ExcelJS.Worksheet, from: number): number {
  let dropped = 0;
  for (let r = ws.rowCount; r >= from; r--) {
    const row = ws.findRow(r);
    if (!row) continue;
    let texts = 0, long = false, other = false, filled = false;
    row.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value as unknown;
      if (typeof v === 'string') { texts++; if (v.length > 60) long = true; }
      else other = true;
      const f = c.fill as { fgColor?: { argb?: string } } | undefined;
      if (f?.fgColor?.argb) filled = true;
    });
    if (!texts || other || !long || filled || rowIsRegistered(ws.name, r)) continue;
    deleteRowAt(ws, r);
    dropped++;
  }
  return dropped;
}

export function deleteRowAt(ws: ExcelJS.Worksheet, at: number): void {
  const model = ws as unknown as { model?: { merges?: string[] } };
  const merges = [...(model.model?.merges ?? [])];
  for (const m of merges) { try { ws.unMergeCells(m); } catch { /* not merged after all */ } }
  ws.spliceRows(at, 1);
  notifyRowsDeleted(ws.name, at, 1);
  const shiftA1 = (a1: string): string | null => {
    const m = /^(\$?[A-Z]+\$?)(\d+)$/.exec(a1); if (!m) return a1;
    const R = Number(m[2]); if (R === at) return null;
    return `${m[1]}${R > at ? R - 1 : R}`;
  };
  for (const m of merges) {
    const [tl, br] = m.split(':');
    const a = shiftA1(tl), b = shiftA1(br ?? tl);
    if (!a || !b) continue;
    try { ws.mergeCells(`${a}:${b}`); } catch { /* overlaps */ }
  }
}

/** A label cut to about 60 characters: trailing brackets first, then the part before a colon. */
export function shortLabel(s: string, max = 60): string {
  let t = s.trim();
  while (t.length > max && /\s\([^()]*\)$/.test(t)) t = t.replace(/\s\([^()]*\)$/, '');
  if (t.length > max) { const i = t.indexOf(': '); if (i > 0 && i <= max) t = t.slice(0, i); }
  if (t.length > max) { const i = t.indexOf('; '); if (i > 0 && i <= max) t = t.slice(0, i); }
  if (t.length > max) { const i = t.lastIndexOf(' ', max - 2); t = `${t.slice(0, i > 20 ? i : max - 2)}…`; }
  return t;
}
const isSentence = (s: string): boolean => /[.;]\s|[.]$|^(A|An|The|Each|Every|Only|One|Not|Stands|From|Defaults|Share|NSA|Ground|Period|Cash|Capex|Debt|Payout|Revenue|Schedules)\b.*\s\w+\s\w+\s\w+\s\w+\s\w+/.test(s.trim());

/**
 * NO TEXT CELL RUNS OVER ABOUT 60 CHARACTERS (live layout, 2026-10-20). A label or a title is
 * cut by `shortLabel`; an explanation (a sentence, or any long text right of the label column)
 * is removed, since the Guide says what each tab does. Formulas are left alone. Run on finished
 * sheets, before any formula is written, so the platform twin reads the same words.
 */
export function shortenTexts(ws: ExcelJS.Worksheet): void {
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => {
    if (c.isMerged && c.master.address !== c.address) return;
    const v = c.value;
    if (typeof v !== 'string' || v.length <= 60) return;
    // A cell set to wrap is meant to be read in full (an "Applies to" list, 2026-11-15).
    if (c.alignment?.wrapText === true) return;
    // A shaded cell is an input (its text is the choice made): never rewritten.
    const f = c.fill as { pattern?: string; fgColor?: { argb?: string } } | undefined;
    if (f?.pattern === 'solid' && f.fgColor?.argb === ARGB.inputFill) return;
    if (Number(c.col) >= 2 || isSentence(v)) { c.value = null; return; }
    c.value = shortLabel(v);
  }));
}

/** Collapse runs of spaces in every text cell of a sheet ("Branded  Villas"). */
export function collapseSpaces(ws: ExcelJS.Worksheet): void {
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => {
    if (c.isMerged && c.master.address !== c.address) return;
    if (typeof c.value === 'string' && /\S {2,}\S/.test(c.value)) c.value = c.value.replace(/(\S) {2,}(?=\S)/g, '$1 ');
    // A formula's own words too (its quoted text), so a live sentence reads as its twin does.
    const v = c.value as { formula?: string; result?: unknown } | null;
    if (v && typeof v === 'object' && typeof v.formula === 'string' && /"[^"]* {2,}[^"]*"/.test(v.formula)) {
      const formula = v.formula.replace(/"[^"]*"/g, (q) => q.replace(/ {2,}/g, ' '));
      const result = typeof v.result === 'string' ? v.result.replace(/(\S) {2,}(?=\S)/g, '$1 ') : v.result;
      c.value = { ...v, formula, result } as unknown as ExcelJS.CellValue;
    }
  }));
}
