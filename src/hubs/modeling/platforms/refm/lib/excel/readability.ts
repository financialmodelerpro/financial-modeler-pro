/**
 * readability.ts (2026-11-17, founder: the final fix before step 7 is pushed)
 *
 * SO THE WORKBOOK READS LIKE A HAND-BUILT MODEL. The last passes of both workbooks, after the house
 * style, the tab frame and the Total rule:
 *
 *   - labels: 50 characters or fewer, no explanation in brackets, none starting with "=" (`tidyLabels`);
 *   - number formats: a price, rate or size per unit with no decimals, a percentage with one, a
 *     multiple with two, zero shown as "-", no "m" written after a figure (`tidyFormats`);
 *   - live only: a MAX(0, ...) that only guards an Inputs cell goes, the cell taking a "0 or more" rule
 *     instead (`dropInputGuards`), and a SUMPRODUCT that is a plain conditional sum becomes SUMIF
 *     (`simplifySumproducts`).
 *
 * None of these moves a figure: labels and formats are display, a guard is dropped only where the
 * guarded cell is 0 or more and is then held there by data validation, and SUMIF over a 1 / 0 flag
 * row is the same sum. No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { houseFormats } from './houseStyle';
import type { DisplayScale } from './styles';

const isFormula = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const SKIP_TABS = new Set(['Cover', 'Guide']);

// ── Labels ───────────────────────────────────────────────────────────────────────

/** Bracketed words that are a name, a unit, a sign or an abbreviation, never an explanation. */
const KEEP_BRACKET = /^(indexed|Cash|In-Kind|in kind|Retail|sqm|sqm per slot|%|x|1 = yes|\+|-|years?|USD|[A-Z][A-Z&]{1,6}|Land \d+(?: \+ Land \d+)*|Sell|Operate|Lease)$/;

/** Labels reworded by hand, where taking the brackets out is not enough (or says too little). */
const RENAME: Array<[RegExp, string]> = [
  [/^Zakat \(the P&L\)$/, 'Zakat, from the P&L'],
  [/^(Phase \d+): EBITDA \(the phase P&L\)$/, '$1 EBITDA, from its P&L'],
  [/^(.+): land under construction(?: \(sqm\))?$/, '$1, land building'],
  [/^(.+): share of the capitalised interest$/, '$1, IDC share'],
  [/^Land of the assets that share capitalised interest \(sqm\)$/, 'Land sharing capitalised interest (sqm)'],
  [/^Land under construction \(sqm\)$/, 'Land building (sqm)'],
  [/^Exit proceeds \(the held assets sold, in the exit year\)$/, 'Exit proceeds'],
  [/^First draw \(year\): the one-off fund fees are charged in it$/, 'First draw year'],
  [/^Phase period of the year, (Phase \d+).*$/, '$1 period of the year'],
  [/^Cost escalation factor, by the year the money is spent$/, 'Cost escalation factor'],
  [/^Curve, (.+), from half the.*$/, 'Curve from mid-build, $1'],
  [/^Curve, (.+), construction years$/, 'Curve, $1'],
  [/^Curve, (\d+) assets in (Phase \d+).*$/, 'Curve from mid-build, $2 ($1 assets)'],
  [/^Revenue inputs, lease lines.*$/, 'Lease lines'],
  [/^Revenue inputs, /, ''],
  [/^Operations start year.*$/, 'Operations start year'],
  [/^Opex lines, lease lines.*$/, 'Opex lines, lease lines'],
  [/^Sale cohort terms, by construction year of the sale$/, 'Sale cohort terms, by construction year'],
  [/^Derived areas by plot.*$/, 'Derived areas by plot'],
  [/^Land values: the plots, then the land each asset holds$/, 'Land values'],
  [/^DISTRIBUTIONS NET OF THE FEE, NET CASH FLOW TO EQUITY$/, 'NET DISTRIBUTIONS AFTER THE FEE'],
  [/^DISTRIBUTIONS, NET CASH FLOW TO EQUITY$/, 'NET DISTRIBUTIONS'],
  [/^Distributions to equity, before the performance fee$/, 'Distributions before the performance fee'],
  [/^Distribution returns, before the performance fee$/, 'Distribution returns, before the fee'],
  [/^Distribution returns, net of the performance fee$/, 'Distribution returns, net of the fee'],
  [/^Pre-sales collected in full, (.+)$/, 'Pre-sales collected, $1'],
  [/^Balance sheet balances.*$/, 'Balance sheet balances'],
  [/^Zakat on the P&L equals zakat paid on the Cash Flow$/, 'Zakat charged equals zakat paid'],
  [/^Checks \(live: .*$/, 'Checks'],
  [/^Held assets' cost.*$/, "Held assets' cost"],
  [/^Yield on cost.*$/, 'Yield on cost'],
  [/^In the construction window.*$/, 'In the construction window (1 = yes)'],
  [/^In the hold.*$/, 'In the hold (1 = yes)'],
];

/** One label, tidied: no leading "=", explanations out of brackets, 50 characters or fewer. */
export function tidyLabel(raw: string): string {
  const num = /^(\d+\.(?:\d+)?\s+)/.exec(raw)?.[1] ?? '';
  let s = raw.slice(num.length).trim();
  s = s.replace(/^=\s*/, '');
  for (const [re, to] of RENAME) if (re.test(s)) { s = s.replace(re, to); break; }
  // Each bracket group that explains (not a name, unit, sign or abbreviation) goes.
  s = s.replace(/\s*\(([^()]*)\)/g, (all, inner: string) => (KEEP_BRACKET.test(inner.trim()) ? all : ''));
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,:;])/g, '$1').trim();
  if (s.length > 50) {
    // A long list of names keeps its first items and says how many more.
    const parts = s.split(/;\s*/);
    if (parts.length > 1) { let out = parts[0]; let i = 1; while (i < parts.length && (out + '; ' + parts[i]).length <= 42) out += '; ' + parts[i++]; s = i < parts.length ? `${out} and ${parts.length - i} more` : out; }
  }
  if (s.length > 50) s = s.slice(0, 50).replace(/[\s,;:]+\S*$/, '');
  return num + s;
}

export function tidyLabels(wb: ExcelJS.Workbook): void {
  for (const ws of wb.worksheets) {
    if (SKIP_TABS.has(ws.name)) continue;
    let longest = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r < 4) return;
      const a = row.getCell(1);
      if (typeof a.value === 'string' && a.value.trim()) {
        const t = tidyLabel(a.value);
        if (t !== a.value) a.value = t;
        longest = Math.max(longest, t.length);
      }
    });
    // The label column fits its longest label (50 characters at most), so nothing is cut by column B.
    const col = ws.getColumn(1);
    const want = Math.min(48, Math.max(30, Math.ceil(longest * 0.92) + 2));
    if ((col.width ?? 0) < want) col.width = want;
  }
}

// ── Inputs: one bar width, title case, tables aligned ───────────────────────────

const BAR = 'FF1B4F8A';
const ACRONYM = /^(P&L|HQ|NSA|GFA|BUA|DPO|IDC|NOI|ADR|KPI|IRR|FCFF|FCFE|DSCR|ICR|LTV|USD|SAR|AED)$/;
/** "ASSET TYPES & STANDARDS" -> "Asset Types & Standards"; an acronym stays in capitals. */
export function titleCase(s: string): string {
  return s.split(' ').map((w) => (ACRONYM.test(w) || !/[A-Z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
}

/**
 * INPUTS READS AS ONE FORM (2026-11-17, founder): every section bar is the same width (the widest table on the
 * tab), its title in title case ("2. Parties", not "2. PARTIES"), and a table of text (the parties) sits under
 * its heads, each value aligned as its head is.
 */
export function tidyInputs(wb: ExcelJS.Workbook): void {
  const ws = wb.getWorksheet('Inputs');
  if (!ws) return;
  const fill = (c: ExcelJS.Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => { if (r >= 4 && fill(row.getCell(1)) !== BAR) row.eachCell({ includeEmpty: false }, (_c, col) => { if (col > width && col <= 14) width = col; }); });
  width = Math.max(6, Math.min(14, width));
  let partiesHead = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const a = row.getCell(1);
    if (r < 4) return;
    if (a.value === 'Party' && row.getCell(2).value === 'Identifier') partiesHead = r;
    if (fill(a) !== BAR || typeof a.value !== 'string') return;
    let others = 0; row.eachCell({ includeEmpty: false }, (c, col) => { if (col > 1 && c.value !== null && c.value !== '' && !/^Not used in this project/.test(String(c.value))) others++; });
    if (others) return; // a table head, not a section bar
    const m = /^(\d+\.(?:\d+)?\s+)?(.*)$/.exec(a.value)!;
    const body = m[2] === m[2].toUpperCase() ? titleCase(m[2]) : m[2];
    a.value = `${m[1] ?? ''}${body}`;
    for (let c = 1; c <= width; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAR } };
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    }
  });
  if (partiesHead) {
    for (let r = partiesHead; r <= partiesHead + 50; r++) {
      const row = ws.getRow(r);
      if (r > partiesHead && !row.getCell(1).value) break;
      for (let c = 1; c <= 3; c++) ws.getCell(r, c).alignment = { horizontal: 'left', vertical: 'top' };
    }
  }
}

/** The last passes both workbooks (and a verifier's platform twin) share, in order. */
export function finalPasses(wb: ExcelJS.Workbook, scale: DisplayScale): void {
  tidyInputs(wb);
  tidyLabels(wb);
  tidyFormats(wb, scale);
  colourLinks(wb);
}

/** A formula that only reads one cell of another tab (a minus sign allowed). */
const LINK_ONLY = /^-?(?:'(?:[^']|'')+'|[A-Za-z0-9_&.]+)!\$?[A-Z]{1,3}\$?\d+$/;
/**
 * A LINK FROM ANOTHER TAB IS GREEN (the house style), including a cell that became one after the house style ran:
 * a guard dropped from an Inputs link (2026-11-17) or a Cover figure linked to Returns.
 */
export function colourLinks(wb: ExcelJS.Workbook): void {
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value as unknown;
    if (!isFormula(v) || !LINK_ONLY.test(v.formula.trim())) return;
    const fill = (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
    if (fill && fill !== 'FFFFFFFF') return;
    c.font = { name: 'Calibri', size: 9, ...(c.font ?? {}), color: { argb: 'FF2E8B3A' } } as ExcelJS.Font;
  }));
}

// ── Number formats ───────────────────────────────────────────────────────────────

export function tidyFormats(wb: ExcelJS.Workbook, scale: DisplayScale): void {
  const fmts = houseFormats(scale, scale === 'millions' ? 1 : 0);
  const count = fmts.count;
  for (const ws of wb.worksheets) {
    if (ws.name === 'Cover') continue;
    // A curve's window total is its typed shares added (100 when whole): shown as a percentage, the value unchanged.
    // Capex only: on Revenue the column of that name is money (a collections weight).
    if (ws.name === 'Capex') ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (h, col) => {
      if (h.value !== 'Window total') return;
      for (let rr = r + 1; rr <= r + 60; rr++) {
        const a = ws.getCell(rr, 1).value;
        if (a === null || a === undefined || a === '') break;
        const c = ws.getCell(rr, col); const v = isFormula(c.value) ? c.value.result : c.value;
        if (typeof v === 'number' || (isFormula(c.value) && v === undefined)) c.numFmt = '0.0"%";-0.0"%";"-"';
      }
    }));
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
      const nf = String(c.numFmt ?? '');
      if (!nf || nf === '@' || nf === 'General') return;
      // A figure written with "m" after it reads as text: money takes the download's own format.
      if (/"m"/.test(nf)) { c.numFmt = fmts.money(scale === 'millions' ? 1 : 0); return; }
      // A price, rate or size per unit: no decimals (11,000 not 11,000.00); zero as "-".
      if (/^#,##0\.0+(_\))?(;|$)/.test(nf) && !/,,|0,(_|;|$)/.test(nf)) { c.numFmt = count; return; }
      if (nf === '#,##0' || nf === '#,##0_)') { c.numFmt = count; return; }
      // An index or factor keeps three decimals and shows zero as "-".
      if (nf === '0.000') { c.numFmt = '0.000;-0.000;"-"'; return; }
      // A plain whole number (a count of years, a period) shows zero as "-".
      if (nf === '0' && typeof (isFormula(c.value) ? c.value.result : c.value) === 'number') {
        const v = Number(isFormula(c.value) ? c.value.result : c.value);
        if (!(v >= 1900 && v <= 2200)) c.numFmt = '0;-0;"-"';
      }
    }));
  }
}

// ── Live only: input guards and plain conditional sums ──────────────────────────
// A rewritten formula keeps a cached 0 where it had none: a missing cached value loads as text inside the
// financing loop and Excel's iteration turns it into a #VALUE! that never clears (2026-11-17, TRAPS 3.45).

const INPUT_REF = String.raw`(?:'Inputs'|Inputs)!\$?([A-Z]{1,3})\$?(\d+)`;
const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };

/**
 * A MAX(0, ...) ROUND AN INPUT GOES (founder: 533 formulas wore one). Where the wrapper holds only an
 * Inputs cell (or a sum of Inputs cells), or MAX(0,MIN(1, ...)) a share, and every cell it holds is 0 or
 * more as exported, the wrapper is dropped and the cell gets a "0 or more" (or "0% to 100%") rule, so a
 * typed value can no longer go where the wrapper used to catch it. A MAX(0, ...) on a calculated value
 * is logic and stays. Returns how many formulas changed.
 */
export function dropInputGuards(wb: ExcelJS.Workbook): number {
  const inputs = wb.getWorksheet('Inputs');
  if (!inputs) return 0;
  const valueAt = (col: string, row: string): unknown => { const v = inputs.getCell(Number(row), colNum(col)).value as unknown; return isFormula(v) ? v.result : v; };
  const nonNeg = (col: string, row: string): boolean => { const v = valueAt(col, row); return v === null || v === undefined || (typeof v === 'number' && v >= 0); };
  const share = (col: string, row: string): boolean => { const v = valueAt(col, row); return v === null || v === undefined || (typeof v === 'number' && v >= 0 && v <= 1); };
  const ruled = new Map<string, 'nonneg' | 'share'>();
  const one = new RegExp(String.raw`MAX\(0,(${INPUT_REF})\)`, 'g');
  const sum = new RegExp(String.raw`MAX\(0,\(\(?(${INPUT_REF})\+(${INPUT_REF})\)?\)\)`, 'g');
  const clamp = new RegExp(String.raw`MAX\(0,MIN\(1,(${INPUT_REF})\)\)`, 'g');
  const nOf = new RegExp(String.raw`MAX\(0,N\((${INPUT_REF})\)\)`, 'g');
  // A grid read clamped to 0% to 100%: every cell of the grid a share as exported, each then held there by a rule.
  const gridClamp = new RegExp(String.raw`MIN\(1,MAX\(0,(INDEX\((?:'Inputs'|Inputs)!\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+),[^()]*(?:\([^()]*\))*[^()]*\))\)\)`, 'g');
  const gridShares = (c1: string, r1: string, c2: string, r2: string): boolean => {
    for (let r = Number(r1); r <= Number(r2); r++) for (let c = colNum(c1); c <= colNum(c2); c++) {
      const v = inputs.getCell(r, c).value as unknown; const n = isFormula(v) ? v.result : v;
      if (!(n === null || n === undefined || (typeof n === 'number' && n >= 0 && n <= 1))) return false;
    }
    return true;
  };
  const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  let changed = 0;
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value as unknown;
    if (!isFormula(v)) return;
    let f = v.formula;
    f = f.replace(gridClamp, (all, idx: string, c1: string, r1: string, c2: string, r2: string) => {
      if (!gridShares(c1, r1, c2, r2)) return all;
      for (let r = Number(r1); r <= Number(r2); r++) for (let cc = colNum(c1); cc <= colNum(c2); cc++) ruled.set(`${colName(cc)}${r}`, 'share');
      return idx;
    });
    f = f.replace(nOf, (all, ref: string, col: string, r: string) => (nonNeg(col, r) ? (ruled.set(`${col}${r}`, ruled.get(`${col}${r}`) ?? 'nonneg'), `N(${ref})`) : all));
    f = f.replace(clamp, (all, ref: string, col: string, r: string) => (share(col, r) ? (ruled.set(`${col}${r}`, 'share'), ref) : all));
    f = f.replace(sum, (all, a: string, ca: string, ra: string, b: string, cb: string, rb: string) => (nonNeg(ca, ra) && nonNeg(cb, rb) ? (ruled.set(`${ca}${ra}`, ruled.get(`${ca}${ra}`) ?? 'nonneg'), ruled.set(`${cb}${rb}`, ruled.get(`${cb}${rb}`) ?? 'nonneg'), `(${a}+${b})`) : all));
    f = f.replace(one, (all, ref: string, col: string, r: string) => (nonNeg(col, r) ? (ruled.set(`${col}${r}`, ruled.get(`${col}${r}`) ?? 'nonneg'), ref) : all));
    if (f !== v.formula) { c.value = { formula: f, result: v.result ?? 0 } as ExcelJS.CellValue; changed++; }
  }));
  for (const [addr, kind] of ruled) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr)!;
    const cell = inputs.getCell(Number(m[2]), colNum(m[1]));
    if (cell.dataValidation && (cell.dataValidation as { type?: string }).type) continue;
    cell.dataValidation = kind === 'share'
      ? { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1], showErrorMessage: true, errorTitle: 'Out of range', error: 'Enter a share between 0% and 100%.' }
      : { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Out of range', error: 'Enter 0 or more.' };
  }
  return changed;
}

/**
 * A SUMPRODUCT THAT IS A CONDITIONAL SUM BECOMES SUMIF (founder: a hand-built model would not write
 * it): SUMPRODUCT(flags, values) over a row of 1 / 0 flags is SUMIF(flags, 1, values), and
 * SUMPRODUCT((range=x)*values) is SUMIF(range, x, values). SUMPRODUCT(MAX(range)) of a plain range is
 * MAX(range). Anything else (an array condition, MIN over years) stays. Returns how many changed.
 */
export function simplifySumproducts(wb: ExcelJS.Workbook): number {
  const RANGE = String.raw`(?:'(?:[^']|'')+'!|[A-Za-z0-9_&.]+!)?\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+`;
  const flagRow = (ref: string, own: ExcelJS.Worksheet): boolean => {
    const m = new RegExp(String.raw`^(?:'((?:[^']|'')+)'!|([A-Za-z0-9_&.]+)!)?\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$`).exec(ref);
    if (!m) return false;
    const sheet = (m[1] ?? m[2] ?? own.name).replace(/''/g, "'");
    const ws = wb.getWorksheet(sheet); if (!ws || m[4] !== m[6]) return false;
    const label = String((ws.getCell(Number(m[4]), 1).value as unknown) ?? '');
    if (!/\(1 = yes\)|^In the |flag/i.test(label)) return false;
    let ok = true;
    for (let c = colNum(m[3]); c <= colNum(m[5]); c++) {
      const v = ws.getCell(Number(m[4]), c).value as unknown;
      const n = isFormula(v) ? v.result : v;
      if (!(n === null || n === undefined || n === 0 || n === 1)) ok = false;
    }
    return ok;
  };
  const pair = new RegExp(String.raw`SUMPRODUCT\((${RANGE}),(${RANGE})\)`, 'g');
  const eq = new RegExp(String.raw`SUMPRODUCT\(\((${RANGE})=([^()*,]+)\)\*(${RANGE})\)`, 'g');
  const mx = new RegExp(String.raw`SUMPRODUCT\((MAX|MIN)\((${RANGE})\)\)`, 'g');
  let changed = 0;
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value as unknown;
    if (!isFormula(v) || !v.formula.includes('SUMPRODUCT')) return;
    let f = v.formula;
    f = f.replace(eq, (_all, r: string, x: string, vals: string) => `SUMIF(${r},${x},${vals})`);
    f = f.replace(mx, (_all, fn: string, r: string) => `${fn}(${r})`);
    f = f.replace(pair, (all, a: string, b: string) => (flagRow(a, ws) ? `SUMIF(${a},1,${b})` : flagRow(b, ws) ? `SUMIF(${b},1,${a})` : all));
    if (f !== v.formula) { c.value = { formula: f, result: v.result ?? 0 } as ExcelJS.CellValue; changed++; }
  }));
  return changed;
}
