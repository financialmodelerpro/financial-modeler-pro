/**
 * splitInputs.ts (2026-11-18, founder item 5)
 *
 * THE INPUTS TAB BECOMES TWO, "Project Inputs" and "Operating Inputs", in the training model's order. It runs on
 * the finished workbook (after the reference layout and the Dashboard), so no layer knows: every cell of Inputs
 * moves to its tab and row, and every reference to it follows, in every formula of the workbook, every defined
 * name, validation, conditional format and internal link, and in the cell registry (the returned move).
 *
 *   Project Inputs: 1 General and timeline (Project, Parties), 2 Land and plots, 3 Asset types and build rates,
 *   4 Development costs and construction phasing, 5 Funding (with the lender covenants), 6 Zakat (or tax) and
 *   depreciation, 7 Exit, discount rates and fund terms, 8 Dashboard and model settings.
 *   Operating Inputs: A Residential (sell lines, commission terms), B Hospitality (hotel revenue and opex),
 *   C Retail (lease lines and their opex), D Working capital (payable days).
 *
 * A section this file does not know keeps its own name, on Project Inputs before the Dashboard settings. A range
 * that the move would split, or reorder, THROWS: a formula must never read a different block than it did.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

export const PROJECT_INPUTS = 'Project Inputs';
export const OPERATING_INPUTS = 'Operating Inputs';
const SRC = 'Inputs';
const BAR = 'FF1B4F8A';

const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const quote = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const unquote = (q: string): string => (q.startsWith("'") ? q.slice(1, -1).replace(/''/g, "'") : q);
const REF = /(?<![A-Za-z0-9_.$!'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(!])/g;
const txt = (c: ExcelJS.Cell): string => { const v = c.value as unknown; return typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && 'richText' in (v as object)) ? (v as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join('').trim() : ''; };
const fillOf = (c: ExcelJS.Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;

export interface SplitMove { sheet: string; r: number; c: number }
export interface SplitResult { move(sheet: string, r: number, c: number): SplitMove | null }

interface Block { section: string; sub: string | null; rows: number[] }
interface Group { sheet: string; key: string; title: string; blocks: Block[] }

/** Where a block of the old tab goes: its tab and its group (in each tab's order). */
function groupOf(section: string, sub: string | null, zakat: boolean): { sheet: string; key: string; title: string } {
  const P = (key: string, title: string) => ({ sheet: PROJECT_INPUTS, key, title });
  const O = (key: string, title: string) => ({ sheet: OPERATING_INPUTS, key, title });
  const s = section.toLowerCase(); const u = (sub ?? '').toLowerCase();
  if (s === 'project' || s === 'parties') return P('1', 'General and timeline');
  if (s.startsWith('assets & sub-units')) return P('2', 'Land and plots');
  if (s.startsWith('asset types')) return P('3', 'Asset types and build rates');
  if (s.startsWith('capex')) return P('4', 'Development costs and construction phasing');
  if (s.startsWith('financing')) return P('5', 'Funding');
  if (s.startsWith('returns') && /lender covenants/.test(u)) return P('5', 'Funding');
  if (s.startsWith('financial statement')) return P('6', zakat ? 'Zakat and depreciation' : 'Tax and depreciation');
  if (s.startsWith('returns') || s.startsWith('fund')) return P('7', 'Exit, discount rates and fund terms');
  if (s.startsWith('dashboard')) return P('9', 'Dashboard and model settings');
  if (s.startsWith('revenue')) {
    if (/\(operate\)/.test(u)) return O('B', 'Hospitality');
    if (/^lease lines/.test(u)) return O('C', 'Retail');
    return O('A', 'Residential');
  }
  if (s.startsWith('opex')) {
    if (/accounts payable|dpo/.test(u)) return O('D', 'Working capital');
    if (/lease lines/.test(u)) return O('C', 'Retail');
    if (/^opex inflation/.test(u)) return O('B0', 'Hospitality');
    return O('B', 'Hospitality');
  }
  return P('8', section);
}

/** The sections and sub-sections of the old tab, read off the reference layout's bars and numbered headings. */
function readBlocks(ws: ExcelJS.Worksheet): { titleRows: number[]; blocks: Block[]; endRow: number; barRows: Map<number, string> } {
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
  const barRows = new Map<number, string>();
  bars.forEach((bar, i) => {
    barRows.set(bar.row, bar.name);
    const end = (bars[i + 1]?.row ?? endRow) - 1;
    const subs: Array<{ row: number; name: string }> = [];
    for (let r = bar.row + 1; r <= end; r++) { const t = txt(ws.getCell(r, 3)); const m = /^\d+\.\d+\s+(.+)$/.exec(t); if (m) subs.push({ row: r, name: m[1].trim() }); }
    const pre = trim(Array.from({ length: Math.max(0, (subs[0]?.row ?? end + 1) - bar.row - 1) }, (_, k) => bar.row + 1 + k));
    if (pre.length) blocks.push({ section: bar.name, sub: null, rows: pre });
    subs.forEach((s, k) => {
      const last = (subs[k + 1]?.row ?? end + 1) - 1;
      const rows = trim(Array.from({ length: last - s.row + 1 }, (_, j) => s.row + j));
      if (rows.length) blocks.push({ section: bar.name, sub: s.name, rows });
    });
  });
  const titleRows = Array.from({ length: bars[0].row - 1 }, (_, k) => k + 1);
  return { titleRows, blocks, endRow, barRows };
}

interface CellSnap { value: ExcelJS.CellValue; style: Partial<ExcelJS.Style>; dv?: ExcelJS.DataValidation }

export function splitInputs(wb: ExcelJS.Workbook): SplitResult | null {
  const src = wb.getWorksheet(SRC);
  if (!src) return null;
  let zakat = false;
  src.eachRow((row) => row.eachCell((c) => { if (/zakat/i.test(txt(c))) zakat = true; }));
  const { titleRows, blocks, endRow, barRows } = readBlocks(src);

  // TIMING EXCEPTIONS ONLY (2026-11-18, founder item 5): the cost-line table keeps a line only when it holds an input
  // (its own window, a rate) or a formula reads it; a line that follows its phase is the default and goes.
  const read = new Set<string>();
  const scan = (f: string, own: string): void => {
    f.split(/("(?:[^"]|"")*")/).forEach((seg, i) => {
      if (i % 2 === 1) return;
      for (const m of seg.matchAll(REF)) {
        if ((m[1] ? unquote(m[1].slice(0, -1)) : own) !== SRC) continue;
        const r1 = Number(m[5]), r2 = m[9] ? Number(m[9]) : r1;
        for (let r = r1; r <= r2; r++) read.add(String(r));
      }
    });
  };
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && typeof v.formula === 'string') scan(v.formula, ws.name); }));
  for (const n of (wb.definedNames as unknown as { model: Array<{ ranges: string[] }> }).model) for (const rg of n.ranges) scan(rg, '');
  let exceptionHead = 0;
  for (const b of blocks) {
    if (!b.section.toLowerCase().startsWith('capex')) continue;
    const head = b.rows.find((r) => txt(src.getCell(r, 3)) === 'Cost line');
    if (!head) continue;
    let inTable = false;
    b.rows = b.rows.filter((r) => {
      if (r === head) { inTable = true; return true; }
      if (!inTable) return true;
      const row = src.getRow(r);
      let blank = true, keep = false;
      row.eachCell((c) => { if (c.value !== null && c.value !== '') blank = false; if (fillOf(c) === 'FFFFF2CC') keep = true; });
      if (blank || [2, 3].some((k) => BAR === fillOf(row.getCell(k)))) { inTable = false; return true; }
      return keep || read.has(String(r));
    });
    exceptionHead = head;
  }

  // ── The new layout: groups in each tab's order ──────────────────────────────
  const groups = new Map<string, Group>();
  for (const b of blocks) {
    const g = groupOf(b.section, b.sub, zakat);
    const id = `${g.sheet}|${g.key === 'B0' ? 'B' : g.key}|${g.key === '8' ? b.section : ''}`;
    if (!groups.has(id)) groups.set(id, { sheet: g.sheet, key: g.key === 'B0' ? 'B' : g.key, title: g.title, blocks: [] });
    const grp = groups.get(id)!;
    if (g.key === 'B0') grp.blocks.unshift(b); else grp.blocks.push(b);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.sheet === b.sheet ? a.key.localeCompare(b.key) : a.sheet === PROJECT_INPUTS ? -1 : 1));

  const rowTo = new Map<number, { sheet: string; r: number }>();
  const placed: Array<{ sheet: string; from: number; to: number; heading?: string }> = [];
  const barsOut: Array<{ sheet: string; to: number; text: string; from: number }> = [];
  const endOut: Array<{ sheet: string; to: number }> = [];
  const firstBar = titleRows.length + 1;
  for (const sheet of [PROJECT_INPUTS, OPERATING_INPUTS]) {
    const mine = ordered.filter((g) => g.sheet === sheet);
    if (!mine.length) continue;
    let r = firstBar;
    let n = 0;
    mine.forEach((g, gi) => {
      if (gi > 0) r += 1;
      n += 1;
      const label = sheet === OPERATING_INPUTS ? g.key : String(n);
      const barFrom = [...barRows.keys()].find((br) => barRows.get(br) === g.blocks[0].section)!;
      barsOut.push({ sheet, to: r, text: `${label}. ${g.title}`, from: barFrom });
      r += 2;
      let k = 0;
      g.blocks.forEach((b, bi) => {
        if (bi > 0) r += 1;
        const heading = b.sub ? `${label}.${++k} ${b.sub}` : undefined;
        b.rows.forEach((from, j) => {
          rowTo.set(from, { sheet, r });
          placed.push({ sheet, from, to: r, heading: j === 0 ? heading : undefined });
          r += 1;
        });
      });
    });
    endOut.push({ sheet, to: r + 1 });
  }
  // Bars and the End band are not read by any formula; the old bars point at the first new bar of their section.
  for (const [br, name] of barRows) {
    const b = barsOut.find((x) => blocks.some((bl) => bl.section === name && rowTo.get(bl.rows[0])?.sheet === x.sheet)) ?? barsOut[0];
    rowTo.set(br, { sheet: b.sheet, r: b.to });
  }
  for (const r of titleRows) rowTo.set(r, { sheet: PROJECT_INPUTS, r });
  rowTo.set(endRow, { sheet: PROJECT_INPUTS, r: endOut[0].to });

  const move = (r: number, c: number): SplitMove | null => { const t = rowTo.get(r); return t ? { sheet: t.sheet, r: t.r, c } : null; };

  // ── Rewrite every reference to the old tab ──────────────────────────────────
  const rewrite = (formula: string, own: string, where: string): string => {
    const parts = formula.split(/("(?:[^"]|"")*")/);
    return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (all, q: string | undefined, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
      const sheet = q ? unquote(q.slice(0, -1)) : own;
      if (sheet !== SRC) return all;
      const a = move(Number(r1), colNum(c1));
      if (!a) {
        // A cell on an unused row of the old tab (an empty row between blocks): nothing reads it, but say so.
        throw new Error(`splitInputs: ${where} reads Inputs!${c1}${r1}, a row the split does not place`);
      }
      let body = `${d1}${colName(a.c)}${d2}${a.r}`;
      if (c2 && r2) {
        const b = move(Number(r2), colNum(c2));
        if (!b || b.sheet !== a.sheet || b.r - a.r !== Number(r2) - Number(r1)) throw new Error(`splitInputs: ${where} reads a range the split would break (${all})`);
        for (let rr = Number(r1); rr <= Number(r2); rr++) { const m = rowTo.get(rr); if (m && (m.sheet !== a.sheet || m.r - a.r !== rr - Number(r1))) throw new Error(`splitInputs: ${where} reads a range the split would reorder (${all})`); }
        body += `:${d3 ?? ''}${colName(b.c)}${d4 ?? ''}${b.r}`;
      }
      return a.sheet === (own === SRC ? '\u0000' : own) ? body : `${quote(a.sheet)}!${body}`;
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

  // Snapshot the old tab before anything changes.
  const snap = new Map<number, Map<number, CellSnap>>();
  const heights = new Map<number, number | undefined>();
  src.eachRow({ includeEmpty: true }, (row, r) => {
    heights.set(r, row.height);
    const m = new Map<number, CellSnap>();
    row.eachCell({ includeEmpty: true }, (c, col) => {
      m.set(col, { value: c.value, style: JSON.parse(JSON.stringify(c.style ?? {})), dv: c.dataValidation ? JSON.parse(JSON.stringify(c.dataValidation)) : undefined });
    });
    snap.set(r, m);
  });
  const srcModel = src.model as unknown as { merges?: string[]; cols?: Array<{ min: number; max: number; width?: number; hidden?: boolean; style?: unknown }> };
  const merges = [...(srcModel.merges ?? [])];
  const cols = JSON.parse(JSON.stringify(srcModel.cols ?? [])) as Array<{ min: number; max: number; width?: number; hidden?: boolean }>;
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
  // Defined names.
  const dn = (wb.definedNames as unknown as { model: Array<{ name: string; ranges: string[] }> });
  dn.model = dn.model.map((n) => ({ ...n, ranges: n.ranges.map((rg) => {
    const m = /^((?:'(?:[^']|'')+'|[^!]+))!(.+)$/.exec(rg);
    if (!m || unquote(m[1]) !== SRC) return rg;
    const a = /^\$?([A-Z]+)\$?(\d+)/.exec(m[2]);
    const to = a ? move(Number(a[2]), colNum(a[1])) : null;
    return to ? `${quote(to.sheet)}!$${colName(to.c)}$${to.r}` : rg;
  }) }));

  // ── Build the two tabs ──────────────────────────────────────────────────────
  const order = (src as unknown as { orderNo: number }).orderNo;
  const views = JSON.parse(JSON.stringify(src.views ?? []));
  const pageSetup = { ...JSON.parse(JSON.stringify(src.pageSetup ?? {})), printArea: undefined, printTitlesRow: undefined };
  const headerFooter = JSON.parse(JSON.stringify(src.headerFooter ?? {}));
  const props = JSON.parse(JSON.stringify(src.properties ?? {}));
  for (const ws of wb.worksheets) { const o = ws as unknown as { orderNo: number }; if (o.orderNo > order) o.orderNo += 1; }
  wb.removeWorksheet(src.id);
  const make = (name: string, at: number): ExcelJS.Worksheet => {
    const ws = wb.addWorksheet(name, { properties: props, views, pageSetup, headerFooter } as never);
    (ws as unknown as { orderNo: number }).orderNo = at;
    for (const c of cols) for (let k = c.min; k <= c.max; k++) { const col = ws.getColumn(k); if (c.width !== undefined) col.width = c.width; if (c.hidden) col.hidden = true; }
    return ws;
  };
  const out = new Map<string, ExcelJS.Worksheet>([[PROJECT_INPUTS, make(PROJECT_INPUTS, order)], [OPERATING_INPUTS, make(OPERATING_INPUTS, order + 1)]]);
  const put = (ws: ExcelJS.Worksheet, from: number, to: number, own: string): void => {
    const cells = snap.get(from); if (!cells) return;
    const h = heights.get(from); if (h) ws.getRow(to).height = h;
    for (const [col, s] of cells) {
      const c = ws.getCell(to, col);
      c.value = rewriteValue(s.value, SRC, `Inputs!${colName(col)}${from}`);
      // The tab's own cells: a reference that stays on the same tab is written unqualified.
      const v = c.value as unknown as { formula?: string } | null;
      if (v && typeof v === 'object' && typeof v.formula === 'string') c.value = { ...(v as object), formula: v.formula.replace(new RegExp(`${quote(own).replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}!`, 'g'), '') } as never;
      c.style = s.style as ExcelJS.Style;
      if (s.dv) c.dataValidation = { ...s.dv, formulae: (s.dv.formulae ?? []).map((f) => (typeof f === 'string' ? rewrite(f, SRC, 'Inputs validation') : f)) } as ExcelJS.DataValidation;
    }
  };
  // Title block on both tabs; the tab name in its second row.
  for (const [name, ws] of out) {
    for (const r of titleRows) put(ws, r, r, name);
    for (let r = 1; r <= titleRows.length; r++) {
      const c = ws.getCell(r, 2);
      if (txt(c) === SRC) c.value = name;
      else if (r === 3 && typeof c.value === 'string') c.value = name === PROJECT_INPUTS
        ? 'Every project input: timeline, land and plots, types and build rates, costs and phasing, funding, zakat and depreciation, exit and fund terms.'
        : 'Every operating input: residential sales, hospitality and retail operations, and working capital.';
    }
  }
  for (const p of placed) {
    const ws = out.get(p.sheet)!;
    put(ws, p.from, p.to, p.sheet);
    if (p.heading) ws.getCell(p.to, 3).value = p.heading;
    if (p.from === exceptionHead) ws.getCell(p.to, 3).value = 'Timing exceptions (a line not on its phase curve)';
  }
  for (const b of barsOut) {
    const ws = out.get(b.sheet)!;
    put(ws, b.from, b.to, b.sheet);
    ws.getCell(b.to, 2).value = b.text;
  }
  for (const e of endOut) put(out.get(e.sheet)!, endRow, e.to, e.sheet);
  // Merges: a moved range keeps its shape on its new tab; the title block's on both.
  for (const rg of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rg); if (!m) continue;
    const r1 = Number(m[2]), r2 = Number(m[4]);
    if (r1 <= titleRows.length) { for (const ws of out.values()) { try { ws.mergeCells(rg); } catch { /* already merged */ } } continue; }
    const a = rowTo.get(r1), b = rowTo.get(r2);
    if (!a || !b || a.sheet !== b.sheet || b.r - a.r !== r2 - r1) continue;
    try { out.get(a.sheet)!.mergeCells(`${m[1]}${a.r}:${m[3]}${b.r}`); } catch { /* a bar row shared by two old bars */ }
  }
  // Conditional formats on the old tab follow their rows.
  for (const cf of cfs) {
    const refs = cf.ref.split(' ').map((x) => {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(x); if (!m) return null;
      const a = rowTo.get(Number(m[2])); if (!a) return null;
      const b = m[4] ? rowTo.get(Number(m[4])) : a; if (!b || b.sheet !== a.sheet) return null;
      return { sheet: a.sheet, ref: m[3] ? `${m[1]}${a.r}:${m[3]}${b.r}` : `${m[1]}${a.r}` };
    }).filter((x): x is { sheet: string; ref: string } => !!x);
    if (!refs.length) continue;
    const ws = out.get(refs[0].sheet)!;
    ws.addConditionalFormatting({ ref: refs.filter((x) => x.sheet === refs[0].sheet).map((x) => x.ref).join(' '), rules: cf.rules.map((rl) => ({ ...rl, formulae: Array.isArray(rl.formulae) ? rl.formulae.map((f) => (typeof f === 'string' ? rewrite(f, SRC, 'Inputs conditional format') : f)) : rl.formulae })) } as never);
  }
  for (const ws of out.values()) formatInputTab(ws);
  return { move: (sheet, r, c) => (sheet === SRC ? move(r, c) : null) };
}

// ── THE TRAINING LOOK ON BOTH INPUT TABS (2026-11-18, founder item 5, formatting) ─────────────────────────
const WIDTHS: Record<string, number[]> = {
  // A, B, then C onwards; every later column to T is 13.
  [PROJECT_INPUTS]: [1.5, 1.5, 52, 14, 22, 11],
  [OPERATING_INPUTS]: [1.5, 1.5, 52, 16, 15, 13, 11],
};
const INPUT_FILL = 'FFFFF2CC', INPUT_TEXT = 'FF0000FF', NOTE = 'FF5A6675';
const BANDS = new Set([BAR, 'FF153D64']);
const dotted = { style: 'dotted' as const };

/**
 * Inputs blue on yellow with a dotted box; formulas black with no fill or border; a percentage 0.0% centred, an
 * amount #,##0 right, a year 0 right, text centred; a typed zero shows as 0 or 0.0%, never "-"; notes grey
 * italic; no wrapped cells; bars, table heads and End of sheet across the full width.
 */
export function formatInputTab(ws: ExcelJS.Worksheet): void {
  const widths = WIDTHS[ws.name]; if (!widths) return;
  let lastCol = 20;
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => { if (c.value !== null && c.value !== undefined && c.value !== '') lastCol = Math.max(lastCol, Number(c.col)); }));
  for (let k = 1; k <= lastCol; k++) ws.getColumn(k).width = widths[k - 1] ?? 13;
  ws.eachRow((row, r) => {
    const band = [2, 3].map((k) => fillOf(row.getCell(k))).find((f) => f && BANDS.has(f));
    row.eachCell({ includeEmpty: true }, (c) => {
      if (c.alignment?.wrapText) c.alignment = { ...c.alignment, wrapText: false };
      // A table head fits its column on one line.
      if (band) { if (typeof c.value === 'string' && Number(c.col) >= 4) c.alignment = { ...(c.alignment ?? {}), shrinkToFit: true, wrapText: false }; return; }
      const v = c.value as unknown;
      const isF = !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
      const val = isF ? (v as { result?: unknown }).result : v;
      const nf = String(c.numFmt ?? '');
      if (fillOf(c) === INPUT_FILL && !isF) {
        c.font = { name: 'Calibri', size: 9, bold: c.font?.bold, color: { argb: INPUT_TEXT } };
        c.border = { top: dotted, bottom: dotted, left: dotted, right: dotted };
        const al = (h: 'center' | 'right' | 'left'): void => { c.alignment = { ...(c.alignment ?? {}), horizontal: h, wrapText: false }; };
        // Text centred where it fits its column; a longer text starts at the left so none of it is cut.
        if (typeof val === 'string' || nf === '@') { al(String(val ?? '').length <= (ws.getColumn(Number(c.col)).width ?? 13) ? 'center' : 'left'); return; }
        if (typeof val !== 'number') { al('center'); return; }
        if (nf.includes('%')) { c.numFmt = Math.abs(Math.round(val * 1000) - val * 1000) > 1e-6 ? '0.00%' : '0.0%'; al('center'); return; }
        if (nf === '0' && Number.isInteger(val) && val >= 1900 && val <= 2200) { al('right'); return; }
        if (/^0\.0+$/.test(nf) || /"x"/.test(nf)) { c.numFmt = '0.00'; al('right'); return; }
        if (/^0\.000/.test(nf) || /^dd|yy/.test(nf)) { al('right'); return; }
        c.numFmt = /#,##0\.00/.test(nf) ? '#,##0.00;(#,##0.00);0.00' : '#,##0;(#,##0);0';
        al('right');
        return;
      }
      if (isF && r > 3) {
        c.font = { name: 'Calibri', size: c.font?.size ?? 9, bold: c.font?.bold, italic: c.font?.italic, color: { argb: 'FF000000' } };
        c.fill = { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
        c.border = {};
        return;
      }
      // A note: grey italic.
      const col = c.font?.color?.argb;
      if (r > 3 && typeof val === 'string' && (col === NOTE || col === 'FF6B7785') && !fillOf(c)) c.font = { name: 'Calibri', size: 9, italic: true, color: { argb: NOTE } };
    });
    if (band) {
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } } as ExcelJS.Fill;
      const from = fillOf(row.getCell(2)) === band ? 2 : 3;
      for (let k = from; k <= lastCol; k++) { const c = row.getCell(k); if (!fillOf(c)) c.fill = fill; }
    }
    if (r > 3 && row.height && row.height > 15) row.height = 15;
  });
}
