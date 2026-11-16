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
import { notifyRowsDeleted, rowIsRegistered } from './cellRegistry';

/** One line per tab: what it does, in plain English (2026-11-16, founder: export simplification step 6). */
export const LIVE_TAB_GUIDE: Array<[string, string]> = [
  ['Summary', 'The project at a glance: headline returns, economics, cost per sqm by line, funding, scheme and phases.'],
  ['Inputs', 'Every number you can change: shaded cells are inputs; type over them and every tab recalculates.'],
  ['Timeline', "The model years, each phase's dates and the flags every tab reads (construction, operations, exit)."],
  ['Land & Area', "Each plot's value and its areas from the top down, merged by line; Capex and Revenue take their quantities here."],
  ['Revenue', 'One path per line: sales and collections for a sell line; occupancy, rate and revenue for a hotel or lease line.'],
  ['Capex', 'Each cost line per asset: rate x quantity x spend share x escalation, by year, with and without land.'],
  ['Opex', 'Operating costs per line, inflated while the line operates, and the payables they leave.'],
  ['Schedules', 'Fixed assets and depreciation per held asset, and cost of sales and inventory per sell line.'],
  ['Financing', 'The funding need, draws, interest, repayments, sweep, dividends and the exit; Excel iterates this loop.'],
  ['P&L', 'Revenue to EBITDA by line, then depreciation, interest, the gain on disposal and zakat; phases to EBITDA.'],
  ['Cash Flow', 'Cash in and out by the direct method, and opening and closing cash.'],
  ['Balance Sheet', 'Balances at each year end with the equity roll-forward; the check row must read zero.'],
  ['Returns', 'The exit value; FCFF, FCFE and distributions, each with IRR, MOIC and NPV; partners, fees, sources and uses, key metrics.'],
  ['Scenarios', 'The cases, the assumptions that differ, the comparison, the sensitivity grid and exit years (platform results).'],
  ['Checks', "The identities that prove the model holds together, and Revenue's own checks: OK holds, CHECK fails, NOTE advises."],
];

/** The Cover: project name, date, currency, location and horizon. */
export function buildLiveCover(ws: ExcelJS.Worksheet, d: { name: string; date: string; currency: string; location: string; horizon: string }): void {
  ws.getColumn(1).width = 3; ws.getColumn(2).width = 60;
  const t = ws.getCell('B2'); t.value = d.name || 'Untitled Project'; t.font = { name: 'Calibri', size: 20, bold: true, color: { argb: ARGB.navy } };
  const s = ws.getCell('B3'); s.value = 'Real Estate Financial Model'; s.font = { name: 'Calibri', size: 12, color: { argb: ARGB.navyDark } };
  const i = ws.getCell('B5'); i.value = [d.date, d.currency, d.location, d.horizon].filter(Boolean).join(' · '); i.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.navyDark } };
}

/** The Guide: the colour legend, then one paragraph per tab. The loop links follow (formulaWorkbook). */
export function buildLiveGuide(ws: ExcelJS.Worksheet, markInput: (c: ExcelJS.Cell) => void, valuesFile = false): void {
  ws.getColumn(1).width = 3; ws.getColumn(2).width = 18; ws.getColumn(3).width = 100;
  const t = ws.getCell('B2'); t.value = 'Guide'; t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: ARGB.navy } };
  let r = 4;
  const head = (text: string): void => { setLabel(ws.getCell(r, 2), text, { bold: true }); fillRange(ws, r, 2, r, 3, ARGB.subtotal); r += 1; };
  head('Colours');
  if (valuesFile) {
    // THE VALUES FILE (2026-11-12): the same layout as the live workbook, the platform's numbers, no formulas.
    { const c = ws.getCell(r, 2); c.value = 'Input'; markInput(c); ws.getCell(r, 3).value = 'A shaded cell is a value typed on the platform.'; r += 1; }
    { const c = ws.getCell(r, 2); c.value = 'Figure'; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; ws.getCell(r, 3).value = 'Every other number is the platform\'s own result as of export. This file holds values, not formulas: change an input on the platform and export again.'; r += 1; }
  } else {
    { const c = ws.getCell(r, 2); c.value = 'Input'; markInput(c); ws.getCell(r, 3).value = 'A shaded cell is an input: type over it.'; r += 1; }
    { const c = ws.getCell(r, 2); c.value = 'Formula'; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; ws.getCell(r, 3).value = 'Everything else is a formula over the inputs.'; r += 1; }
  }
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
