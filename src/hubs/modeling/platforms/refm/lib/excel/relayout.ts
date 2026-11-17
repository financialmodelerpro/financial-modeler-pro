/**
 * relayout.ts (2026-11-15, founder: export simplification step 2)
 *
 * MOVES CELLS ON FINISHED SHEETS AND REWRITES EVERY REFERENCE TO THEM, so a last pass can change a
 * tab's frame (the title block, the header band, a column taken out) after every layer has written
 * its formulas, without any layer knowing. ExcelJS moves no formula when rows move (TRAPS 3.2), so
 * this rebuilds each planned sheet from its model at the new addresses and rewrites the references in
 * every formula of the workbook, every data validation, every defined name and every internal link.
 *
 * A plan maps an old cell to its new cell, or drops it. A reference to a dropped cell is REDIRECTED
 * to the cell the plan names (the period counter row on a tab goes to the one on Timeline), and a
 * reference to a dropped cell with no redirect THROWS: a formula must never point at nothing.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

export interface At { r: number; c: number }
export interface SheetPlan {
  /** Old cell to new cell, or null when the cell is dropped. */
  map(r: number, c: number): At | null;
  /** A reference to a dropped cell points here instead (new coordinates). */
  redirect?(r: number, c: number): { sheet: string; r: number; c: number } | null;
  /** The new row a whole old row's properties (height) go to, or null. */
  rowOf(r: number): number | null;
  /** The new column an old column's properties (width) go to, or null. */
  colOf(c: number): number | null;
}

const colName = (n: number): string => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const quote = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const unquote = (q: string): string => (q.startsWith("'") ? q.slice(1, -1).replace(/''/g, "'") : q);

const REF = /(?<![A-Za-z0-9_.$!'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.&]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(!])/g;

export class Relayout {
  constructor(private readonly wb: ExcelJS.Workbook, private readonly plans: Map<string, SheetPlan>) {}

  private resolve(sheet: string, r: number, c: number, where: string): { sheet: string; r: number; c: number } {
    const plan = this.plans.get(sheet);
    if (!plan) return { sheet, r, c };
    const m = plan.map(r, c);
    if (m) return { sheet, r: m.r, c: m.c };
    const red = plan.redirect?.(r, c);
    if (red) return red;
    throw new Error(`relayout: ${where} reads ${sheet}!${colName(c)}${r}, a cell the new layout drops`);
  }

  /** A formula with every reference moved to where its cell now is. */
  rewrite(formula: string, own: string, where: string): string {
    const parts = formula.split(/("(?:[^"]|"")*")/);
    return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (_all, q: string | undefined, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
      const sheet = q ? unquote(q.slice(0, -1)) : own;
      const a = this.resolve(sheet, Number(r1), colNum(c1), where);
      const cell = (x: { r: number; c: number }, da: string, db: string): string => `${da}${colName(x.c)}${db}${x.r}`;
      let body = cell(a, d1, d2);
      if (c2 && r2) {
        const b = this.resolve(sheet, Number(r2), colNum(c2), where);
        if (b.sheet !== a.sheet) throw new Error(`relayout: ${where} has a range split across tabs`);
        body += `:${cell(b, d3 ?? '', d4 ?? '')}`;
      }
      const qual = a.sheet !== own || (q && a.sheet === sheet) ? `${quote(a.sheet)}!` : '';
      return `${qual}${body}`;
    }))).join('');
  }

  /** An A1 address (or range) on `sheet`, moved; null when it is dropped. */
  private moveAddr(sheet: string, a1: string): string | null {
    const plan = this.plans.get(sheet);
    if (!plan) return a1;
    const one = (s: string): string | null => {
      const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)$/.exec(s);
      if (!m) return s;
      const to = plan.map(Number(m[4]), colNum(m[2]));
      return to ? `${m[1]}${colName(to.c)}${m[3]}${to.r}` : null;
    };
    const [x, y] = a1.split(':');
    const a = one(x); if (!a) return null;
    if (y === undefined) return a;
    const b = one(y); return b ? `${a}:${b}` : null;
  }

  /** Where an old cell is after the move (unchanged on a sheet with no plan); null when it is dropped. */
  moveCell(sheet: string, r: number, c: number): At | null {
    const plan = this.plans.get(sheet);
    return plan ? plan.map(r, c) : { r, c };
  }

  run(): void {
    const wb = this.wb;
    // Defined names first (their ranges name a sheet).
    const dn = (wb.definedNames as unknown as { model: Array<{ name: string; ranges: string[] }> });
    const names = dn.model.map((n) => ({ ...n, ranges: n.ranges.map((rg) => {
      const m = /^((?:'(?:[^']|'')+'|[^!]+))!(.+)$/.exec(rg);
      if (!m) return rg;
      const sheet = unquote(m[1]);
      const moved = this.moveAddr(sheet, m[2].replace(/\$/g, '') === m[2] ? m[2] : m[2]);
      return moved ? `${m[1]}!${moved}` : rg;
    }) }));
    dn.model = names;

    for (const ws of wb.worksheets) {
      const plan = this.plans.get(ws.name);
      const model = (ws as unknown as { model: WsModel }).model;
      // Rewrite every formula (all sheets read planned ones), then move this sheet's cells.
      for (const row of model.rows) for (const cell of row.cells) {
        if (typeof cell.formula === 'string') cell.formula = this.rewrite(cell.formula, ws.name, `${ws.name}!${cell.address}`);
        if (typeof cell.hyperlink === 'string' && cell.hyperlink.startsWith('#')) {
          const m = /^#((?:'(?:[^']|'')+'|[^!]+))!(.+)$/.exec(cell.hyperlink);
          if (m) { const moved = this.moveAddr(unquote(m[1]), m[2]); if (moved) cell.hyperlink = `#${m[1]}!${moved}`; }
        }
      }
      const dv = model.dataValidations ?? {};
      for (const v of Object.values(dv)) if (Array.isArray(v.formulae)) v.formulae = v.formulae.map((f) => (typeof f === 'string' ? this.rewrite(f, ws.name, `${ws.name} validation`) : f));
      if (!plan) { (ws as unknown as { model: WsModel }).model = withMergeCells(model, ws); continue; }

      const rows = new Map<number, { cells: CellModel[]; src: RowModel | null }>();
      const getRow = (n: number): { cells: CellModel[]; src: RowModel | null } => { let x = rows.get(n); if (!x) { x = { cells: [], src: null }; rows.set(n, x); } return x; };
      for (const row of model.rows) {
        const to = plan.rowOf(row.number);
        if (to !== null && !getRow(to).src) getRow(to).src = row;
        for (const cell of row.cells) {
          const m = /^([A-Z]+)(\d+)$/.exec(cell.address)!;
          const at = plan.map(Number(m[2]), colNum(m[1]));
          if (!at) continue;
          cell.address = `${colName(at.c)}${at.r}`;
          getRow(at.r).cells.push(cell);
        }
      }
      const newRows: RowModel[] = [];
      for (const [n, x] of [...rows].sort((a, b) => a[0] - b[0])) {
        x.cells.sort((a, b) => colNum(/^[A-Z]+/.exec(a.address)![0]) - colNum(/^[A-Z]+/.exec(b.address)![0]));
        const cols = x.cells.map((c) => colNum(/^[A-Z]+/.exec(c.address)![0]));
        newRows.push({ ...(x.src ?? {}), number: n, cells: x.cells, min: cols.length ? Math.min(...cols) : 1, max: cols.length ? Math.max(...cols) : 1 } as RowModel);
      }
      model.rows = newRows;
      // Columns: expand to one definition per column, move, keep the first that lands on each.
      const colDefs = new Map<number, ColModel>();
      for (const c of model.cols ?? []) for (let k = c.min; k <= c.max; k++) {
        const to = plan.colOf(k); if (to === null || colDefs.has(to)) continue;
        colDefs.set(to, { ...c, min: to, max: to });
      }
      model.cols = [...colDefs.values()].sort((a, b) => a.min - b.min);
      model.merges = (model.merges ?? []).map((rg) => this.moveAddr(ws.name, rg)).filter((x): x is string => !!x);
      const nd: Record<string, DvModel> = {};
      for (const [k, v] of Object.entries(dv)) { const to = this.moveAddr(ws.name, k); if (to) nd[to] = v; }
      model.dataValidations = nd;
      model.conditionalFormattings = (model.conditionalFormattings ?? []).map((cf) => ({ ...cf, ref: cf.ref.split(' ').map((x) => this.moveAddr(ws.name, x)).filter(Boolean).join(' ') })).filter((cf) => cf.ref);
      (ws as unknown as { model: WsModel }).model = withMergeCells(model, ws);
    }
  }
}

interface CellModel { address: string; formula?: string; hyperlink?: string; [k: string]: unknown }
interface RowModel { number: number; cells: CellModel[]; min: number; max: number; [k: string]: unknown }
interface ColModel { min: number; max: number; [k: string]: unknown }
interface DvModel { formulae?: unknown[]; [k: string]: unknown }
interface WsModel {
  rows: RowModel[]; cols?: ColModel[]; merges?: string[]; mergeCells?: string[];
  dataValidations?: Record<string, DvModel>; conditionalFormattings?: Array<{ ref: string; [k: string]: unknown }>;
  [k: string]: unknown;
}
/** The setter reads `mergeCells` (the getter writes `merges`) and keeps old merges unless cleared. */
function withMergeCells(model: WsModel, ws: ExcelJS.Worksheet): WsModel {
  (ws as unknown as { _merges: Record<string, unknown> })._merges = {};
  return { ...model, mergeCells: model.merges ?? [] };
}

/**
 * INLINE CELLS (2026-11-15, founder: "link to Inputs directly"): every formula in the workbook that reads
 * one of the target cells reads the target's own formula in its place, in brackets, so the target rows
 * can go. A range that covers only target cells of one column becomes their sum; a range that covers
 * targets and other cells throws (it cannot be written without them). Cached results do not change.
 */
export function inlineCells(wb: ExcelJS.Workbook, targets: Array<{ sheet: string; row: number; col: number }>): void {
  const id = (sh: string, r: number, c: number): string => `${sh}!${r}:${c}`;
  const tset = new Map<string, { sheet: string; row: number; col: number }>();
  for (const t of targets) tset.set(id(t.sheet, t.row, t.col), t);
  const formulaOf = (t: { sheet: string; row: number; col: number }): string => {
    const v = wb.getWorksheet(t.sheet)!.getCell(t.row, t.col).value as { formula?: string } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') {
      const n = wb.getWorksheet(t.sheet)!.getCell(t.row, t.col).value;
      return typeof n === 'number' ? String(n) : '0';
    }
    return v.formula;
  };
  /** A formula of `from` re-expressed for a cell on `to`: its own-sheet references qualified. */
  const qualify = (f: string, from: string, to: string): string => {
    if (from === to) return f;
    const parts = f.split(/("(?:[^"]|"")*")/);
    return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (all: string, q: string | undefined) => (q ? all : `${quote(from)}!${all}`)))).join('');
  };
  const resolved = new Map<string, string>();
  const subst = (f: string, own: string, depth: number): string => {
    if (depth > 20) throw new Error('inlineCells: the targets read each other in a loop');
    const parts = f.split(/("(?:[^"]|"")*")/);
    return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(REF, (all: string, q: string | undefined, _d1: string, c1: string, _d2: string, r1: string, _d3?: string, c2?: string, _d4?: string, r2?: string) => {
      const sheet = q ? unquote(q.slice(0, -1)) : own;
      const a = { r: Number(r1), c: colNum(c1) };
      const cells: Array<{ r: number; c: number }> = [];
      if (c2 && r2) { const b = { r: Number(r2), c: colNum(c2) }; for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) cells.push({ r, c }); }
      else cells.push(a);
      const hits = cells.filter((x) => tset.has(id(sheet, x.r, x.c)));
      if (!hits.length) return all;
      if (hits.length !== cells.length) throw new Error(`inlineCells: ${own} reads a range part target, part not (${all})`);
      return `(${cells.map((x) => { const k = id(sheet, x.r, x.c); return `(${qualify(inner(tset.get(k)!, depth + 1), sheet, own)})`; }).join('+')})`;
    }))).join('');
  };
  const inner = (t: { sheet: string; row: number; col: number }, depth: number): string => {
    const k = id(t.sheet, t.row, t.col);
    if (!resolved.has(k)) resolved.set(k, subst(formulaOf(t), t.sheet, depth));
    return resolved.get(k)!;
  };
  for (const t of targets) inner(t, 0);
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((cell) => {
    if (tset.has(id(ws.name, Number(cell.row), Number(cell.col)))) return;
    const v = cell.value as { formula?: string; result?: unknown } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
    const nf = subst(v.formula, ws.name, 0);
    if (nf !== v.formula) {
      const result = (cell as unknown as { model?: { result?: unknown } }).model?.result;
      cell.value = { formula: nf, result } as ExcelJS.CellValue;
    }
  }));
}

/** Every cell some formula reads, as "Sheet!row:col" (ranges expanded). */
export function referencedCells(wb: ExcelJS.Workbook): Set<string> {
  const out = new Set<string>();
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((cell) => {
    const v = cell.value as { formula?: string } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
    const parts = v.formula.split(/("(?:[^"]|"")*")/);
    parts.forEach((seg, i) => {
      if (i % 2 === 1) return;
      for (const m of seg.matchAll(REF)) {
        const sheet = m[1] ? unquote(m[1].slice(0, -1)) : ws.name;
        const r1 = Number(m[5]), c1 = colNum(m[3]);
        const r2 = m[9] ? Number(m[9]) : r1, c2 = m[7] ? colNum(m[7]) : c1;
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.add(`${sheet}!${r}:${c}`);
      }
    });
  }));
  return out;
}
