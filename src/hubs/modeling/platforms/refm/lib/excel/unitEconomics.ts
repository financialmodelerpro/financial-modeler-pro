/**
 * UNIT ECONOMICS ON RETURNS (2026-11-19, founder B4).
 *
 * The cost per sqm by line and the sale price against cost, built on Capex, move to the end of Returns' key metrics
 * as "Unit economics", rebuilt as two proper tables: every column has its own head and unit, every row names its line,
 * and the values sit under their heads. Returns comes after Financing, so the cost with capitalised interest no longer
 * reads a later tab from Capex.
 *
 * The cells keep their formulas: a reference to Capex is qualified, a reference to a cell of the moved tables follows
 * it, any other tab is unchanged. The move is returned for the registry.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

type At = { r: number; c: number };
const LBL = 3;
const REF = /('(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;
const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function unitEconomicsToReturns(wb: ExcelJS.Workbook): ((sheet: string, row: number, col: number) => { sheet: string; r: number; c: number } | null) | null {
  const cx = wb.getWorksheet('Capex'), rt = wb.getWorksheet('Returns');
  if (!cx || !rt) return null;
  let aAt = 0, bAt = 0, endAt = 0;
  cx.eachRow((row, r) => { const b = text(row.getCell(2).value); if (/^\d+\.\s+Cost per sqm/i.test(b)) aAt = r; if (/^\d+\.\s+Sale price against cost/i.test(b)) bAt = r; if (/^End of sheet/i.test(b)) endAt = r; });
  if (!aAt) return null;
  const lastOld = (bAt || endAt) - 1;
  // ── Parse table A: a line row (areas in E:G), then its cost rows (cost in D, per sqm in E:G) ──
  type ABlock = { line: string; head: number; costs: number[] };
  const aBlocks: ABlock[] = [];
  for (let r = aAt + 1; r <= lastOld; r++) {
    const l = text(cx.getCell(r, LBL).value);
    if (!l || /^Line and cost base$/i.test(l)) continue;
    const isHead = cx.getCell(r, 4).value === null || cx.getCell(r, 4).value === undefined;
    if (isHead) aBlocks.push({ line: l, head: r, costs: [] }); else aBlocks[aBlocks.length - 1]?.costs.push(r);
  }
  // ── Parse table B: a line row (heads), its area/price row, its cost rows, its escalation row ──
  type BBlock = { line: string; data: number; costs: number[]; esc: number };
  const bBlocks: BBlock[] = [];
  if (bAt) for (let r = bAt + 1; r < (endAt || cx.rowCount + 1); r++) {
    const l = text(cx.getCell(r, LBL).value);
    if (!l || /^Line and cost base$/i.test(l)) continue;
    if (text(cx.getCell(r, 4).value) === 'Area sold (sqm)') { bBlocks.push({ line: l, data: r + 1, costs: [], esc: 0 }); r += 1; continue; }
    const cur = bBlocks[bBlocks.length - 1];
    if (!cur) continue;
    if (/^Escalation earned/i.test(l)) cur.esc = r; else cur.costs.push(r);
  }
  // ── Where Returns ends ──
  let rtEnd = 0;
  rt.eachRow((row, r) => { if (/^End of sheet/i.test(text(row.getCell(2).value))) rtEnd = r; });
  if (!rtEnd) rtEnd = rt.rowCount + 2;
  const endStyle = rt.getCell(rtEnd, 2).style;
  // The band runs to the last column of the header row (a filled cell with no value is not seen by eachCell).
  const lastHead = (ws: ExcelJS.Worksheet): number => { let n = 2; ws.getRow(4).eachCell({ includeEmpty: false }, (_c, col) => { if (col > n) n = col; }); return n; };
  const barTo = lastHead(rt);
  for (let c = 2; c <= barTo; c++) { const cell = rt.getCell(rtEnd, c); cell.value = null; cell.style = {}; }
  // ── The new layout and the map old cell -> new cell ──
  const map = new Map<string, At>();
  const k = (r: number, c: number): string => `${r}|${c}`;
  type Put = { at: At; from?: At; value?: unknown; link?: At; numFmt?: string; head?: boolean; title?: boolean; label?: boolean };
  // Values sit in D and from F on (E is the spacer between Input and Total).
  const V = [4, 6, 7, 8, 9, 10, 11];
  const puts: Put[] = [];
  let r = rtEnd;
  const heading = (t: string): void => { puts.push({ at: { r, c: LBL }, value: t, head: true, title: true }); r += 1; };
  const heads = (hs: string[]): void => {
    hs.forEach((h, i) => puts.push({ at: { r, c: i === 0 ? LBL : V[i - 1] }, value: h, head: true }));
    // The spacer under the band too, so the header row is one band.
    for (let c = LBL; c <= V[V.length - 1]; c++) if (c !== LBL && !V.includes(c)) puts.push({ at: { r, c }, value: null, head: true });
    r += 1;
  };
  heading('Unit economics: cost per sqm, by line');
  heads(['Line: cost base', 'Cost (SAR)', 'NSA (sqm)', 'GFA (sqm)', 'BUA (sqm)', 'SAR per sqm of NSA', 'SAR per sqm of GFA', 'SAR per sqm of BUA']);
  for (const b of aBlocks) {
    let first = 0;
    for (const cr of b.costs) {
      puts.push({ at: { r, c: LBL }, value: `${b.line}: ${text(cx.getCell(cr, LBL).value)}`, label: true });
      puts.push({ at: { r, c: V[0] }, from: { r: cr, c: 4 } });
      for (let i = 0; i < 3; i++) {
        if (!first) puts.push({ at: { r, c: V[1 + i] }, from: { r: b.head, c: 5 + i } });
        else puts.push({ at: { r, c: V[1 + i] }, link: { r: first, c: V[1 + i] }, numFmt: cx.getCell(b.head, 5 + i).numFmt });
        puts.push({ at: { r, c: V[4 + i] }, from: { r: cr, c: 5 + i } });
      }
      if (!first) first = r;
      r += 1;
    }
  }
  if (bBlocks.length) {
    r += 1;
    heading('Unit economics: sale price against cost, per sqm of NSA');
    heads(['Line: cost base', 'Area sold (sqm)', 'Base price (SAR/sqm)', 'Realised price (SAR/sqm)', 'Cost (SAR/sqm of NSA)', 'Margin at base price (SAR/sqm)', 'Margin at realised price (SAR/sqm)', 'Escalation earned (SAR/sqm)']);
    for (const b of bBlocks) {
      let first = 0;
      for (const cr of b.costs) {
        puts.push({ at: { r, c: LBL }, value: `${b.line}: ${text(cx.getCell(cr, LBL).value)}`, label: true });
        for (let i = 0; i < 3; i++) {
          if (!first) puts.push({ at: { r, c: V[i] }, from: { r: b.data, c: 4 + i } });
          else puts.push({ at: { r, c: V[i] }, link: { r: first, c: V[i] }, numFmt: cx.getCell(b.data, 4 + i).numFmt });
        }
        puts.push({ at: { r, c: V[3] }, from: { r: cr, c: 4 } });
        puts.push({ at: { r, c: V[4] }, from: { r: cr, c: 5 } });
        puts.push({ at: { r, c: V[5] }, from: { r: cr, c: 6 } });
        if (!first && b.esc) puts.push({ at: { r, c: V[6] }, from: { r: b.esc, c: 6 } });
        else if (b.esc) puts.push({ at: { r, c: V[6] }, link: { r: first, c: V[6] }, numFmt: cx.getCell(b.esc, 6).numFmt });
        if (!first) first = r;
        r += 1;
      }
    }
  }
  for (const p of puts) if (p.from) map.set(k(p.from.r, p.from.c), p.at);
  // ── A formula moved from Capex: Capex references qualified, references into the moved cells followed ──
  const rewrite = (f: string): string => f.split(/("(?:[^"]|"")*")/).map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (all, q: string | undefined, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
    const sheet = q ? q.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : 'Capex';
    if (sheet !== 'Capex') return all;
    const a = map.get(k(Number(r1), colNum(c1)));
    if (!c2) return a ? `${d1}${colName(a.c)}${d2}${a.r}` : `Capex!${d1}${c1}${d2}${r1}`;
    const b = map.get(k(Number(r2), colNum(c2)));
    return a && b ? `${d1}${colName(a.c)}${d2}${a.r}:${d3 ?? ''}${colName(b.c)}${d4 ?? ''}${b.r}` : `Capex!${d1}${c1}${d2}${r1}:${d3 ?? ''}${c2}${d4 ?? ''}${r2}`;
  }))).join('');
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153D64' } } as ExcelJS.Fill;
  for (const p of puts) {
    const cell = rt.getCell(p.at.r, p.at.c);
    if (p.head) {
      cell.value = p.value as ExcelJS.CellValue;
      const isTitle = !!p.title;
      cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: isTitle ? 'FF1B4F8A' : 'FFFFFFFF' } };
      if (!isTitle) { cell.fill = headFill; cell.alignment = { horizontal: p.at.c === LBL ? 'left' : 'center', wrapText: true, vertical: 'middle' }; }
      continue;
    }
    if (p.label) { cell.value = p.value as ExcelJS.CellValue; cell.font = { name: 'Calibri', size: 9 }; continue; }
    if (p.link) {
      const src = rt.getCell(p.link.r, p.link.c).value as { result?: unknown } | null;
      cell.value = { formula: `${colName(p.link.c)}$${p.link.r}`, result: src && typeof src === 'object' ? src.result : src } as ExcelJS.CellValue;
      if (p.numFmt) cell.numFmt = p.numFmt;
      cell.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } };
      continue;
    }
    if (p.from) {
      const old = cx.getCell(p.from.r, p.from.c);
      const v = old.value as unknown;
      cell.value = (v && typeof v === 'object' && typeof (v as { formula?: string }).formula === 'string' ? { ...(v as object), formula: rewrite((v as { formula: string }).formula) } : v) as ExcelJS.CellValue;
      cell.numFmt = old.numFmt;
      cell.font = old.font ?? { name: 'Calibri', size: 9 };
      cell.alignment = { horizontal: 'right' };
    }
  }
  // A link row cell's result is only known once its source is written: fill it now.
  for (const p of puts) if (p.link) {
    const src = rt.getCell(p.link.r, p.link.c).value as { result?: unknown } | null;
    const cell = rt.getCell(p.at.r, p.at.c);
    cell.value = { formula: `${colName(p.link.c)}$${p.link.r}`, result: src && typeof src === 'object' ? src.result : src } as ExcelJS.CellValue;
  }
  // The End of sheet bar after the tables.
  const end = r + 1;
  const band = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F8A' } } as ExcelJS.Fill;
  const endFill = (endStyle?.fill as ExcelJS.Fill | undefined) ?? band;
  const endBand = (ws: ExcelJS.Worksheet, row: number, to: number): void => {
    for (let c = 2; c <= to; c++) ws.getCell(row, c).fill = endFill;
    const e = ws.getCell(row, 2); e.value = 'End of sheet'; e.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(row).height = 16;
  };
  endBand(rt, end, barTo);
  // Capex: the two sections go, and its End of sheet bar comes up under what remains.
  const clearFrom = aAt;
  const endStyleCx = endAt ? cx.getCell(endAt, 2).style : undefined;
  const barToCx = lastHead(cx);
  for (let rr = clearFrom; rr <= (endAt || cx.rowCount); rr++) {
    const row = cx.getRow(rr);
    row.eachCell({ includeEmpty: true }, (c) => { c.value = null; c.style = {}; });
    row.height = undefined as never;
  }
  if (endStyleCx) endBand(cx, clearFrom, barToCx);
  return (sheet, row, col) => {
    if (sheet !== 'Capex') return { sheet, r: row, c: col };
    const a = map.get(k(row, col));
    if (a) return { sheet: 'Returns', r: a.r, c: a.c };
    return row >= clearFrom ? null : { sheet, r: row, c: col };
  };
}
