/**
 * writer.ts (2026-09-27), THE LIVE LAYERS' CELL WRITER.
 *
 * Writes a formula over a cell the hardcoded build filled, keeping the
 * platform's value as the cached result, and records what each formula READS,
 * address by address. That record is what makes a staged build honest: a value
 * that belongs to a stage not yet live (the Revenue figures Capex's marketing
 * charges on, say) is written as a PENDING value, and every formula that reads
 * one, directly or through other formulas, is pending too. The verifier then
 * knows exactly which cells may not yet follow an input, and every other live
 * cell must follow it to the cent.
 *
 * References are absolute and sheet-qualified. Arguments to `f` are evaluated
 * before it runs, so the references made while building a formula string are
 * the ones it reads.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { CellRegistry, CellAddr } from '../cellRegistry';
import { quoteSheet, colLetter } from '../styles';

const addrId = (a: CellAddr): string => `${a.sheet}!R${a.row}C${a.col}`;

/**
 * WHAT EVERY FORMULA READS, per build (keyed by the build's shared pending set), so
 * pending can be settled to a fixed point once every layer has written. Marking at
 * write time alone misses a FORWARD reference: an opening balance written before
 * the closing balance it reads (2026-09-27, the Cash Flow's opening cash).
 */
const DEPS = new WeakMap<Set<string>, Map<string, string[]>>();

/** Mark pending every formula that reads a pending cell, directly or through others. */
export function settlePending(pending: Set<string>): number {
  const deps = DEPS.get(pending);
  if (!deps) return 0;
  let added = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const [addr, reads] of deps) {
      if (pending.has(addr)) continue;
      if (reads.some((d) => pending.has(d))) { pending.add(addr); added++; changed = true; }
    }
  }
  return added;
}

export class LiveWriter {
  readonly formulas = new Map<string, number>();
  /** Addresses whose value waits for a later stage ("Sheet!R1C2"). */
  /** Shared by every layer of one build, so a formula reading a cell another layer marked pending is pending too. */
  readonly pending: Set<string>;
  private deps: string[] = [];
  private readonly allDeps: Map<string, string[]>;
  constructor(readonly wb: ExcelJS.Workbook, readonly reg: CellRegistry, pending?: Set<string>) {
    this.pending = pending ?? new Set<string>();
    if (!DEPS.has(this.pending)) DEPS.set(this.pending, new Map());
    this.allDeps = DEPS.get(this.pending)!;
  }

  has(key: string): boolean { return this.reg.get(key) !== undefined; }
  addr(key: string, col?: number): CellAddr {
    const a = this.reg.need(key);
    return col === undefined ? a : { sheet: a.sheet, row: a.row, col };
  }
  /** Record a new cell in the registry (the layers' own working cells). */
  claim(key: string, sheet: string, row: number, col: number): void { this.reg.sink(key, { sheet, row, col }); }

  /** An absolute reference to a registered cell (optionally another column of its row). */
  ref(key: string, col?: number): string { return this.refA(this.addr(key, col)); }
  refA(a: CellAddr): string {
    this.deps.push(addrId(a));
    return `${quoteSheet(a.sheet)}!$${colLetter(a.col)}$${a.row}`;
  }
  /** An absolute range on one row, from column c0 to c1. */
  rangeA(sheet: string, row: number, c0: number, c1: number): string {
    for (let c = c0; c <= c1; c++) this.deps.push(addrId({ sheet, row, col: c }));
    return `${quoteSheet(sheet)}!$${colLetter(c0)}$${row}:$${colLetter(c1)}$${row}`;
  }

  cellA(a: CellAddr): ExcelJS.Cell { return this.wb.getWorksheet(a.sheet)!.getCell(a.row, a.col); }
  /** What the hardcoded build wrote in a cell (a number, text, or undefined). */
  platformValue(a: CellAddr): number | string | undefined {
    const v = this.cellA(a).value as unknown;
    const r = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
    return typeof r === 'number' || typeof r === 'string' ? r : undefined;
  }

  /** Write a formula at an address, caching `cached` (default: what the cell held). */
  fA(a: CellAddr, formula: string, opts: { numFmt?: string; cached?: number | string } = {}): void {
    const deps = this.deps; this.deps = [];
    const c = this.cellA(a);
    const cached = opts.cached !== undefined ? opts.cached : this.platformValue(a);
    c.value = { formula, result: cached } as unknown as ExcelJS.CellValue;
    if (opts.numFmt) c.numFmt = opts.numFmt;
    this.allDeps.set(addrId(a), deps);
    if (deps.some((d) => this.pending.has(d))) this.pending.add(addrId(a));
    this.formulas.set(a.sheet, (this.formulas.get(a.sheet) ?? 0) + 1);
  }
  f(key: string, formula: string, opts: { numFmt?: string; col?: number; cached?: number | string } = {}): void {
    this.fA(this.addr(key, opts.col), formula, opts);
  }
  /** A plain value; `pending` marks it as waiting for a later stage. */
  valueA(a: CellAddr, v: number | string | undefined, opts: { numFmt?: string; pending?: boolean } = {}): void {
    this.deps = [];
    const c = this.cellA(a);
    c.value = v === undefined ? null : v;
    if (opts.numFmt) c.numFmt = opts.numFmt;
    if (opts.pending) this.pending.add(addrId(a));
  }
  /** Forget references gathered while building text that is not a formula. */
  reset(): void { this.deps = []; }
}
