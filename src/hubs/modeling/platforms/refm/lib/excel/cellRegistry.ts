/**
 * cellRegistry.ts (2026-09-27)
 *
 * WHERE EACH MODEL QUANTITY LANDS IN THE WORKBOOK, recorded while the sheets are
 * written, so the formula-linked export (formulaWorkbook.ts) can write a formula
 * that references the cell holding an input or an intermediate, instead of
 * searching the sheet for a label.
 *
 * The sink is NULL during an ordinary export, so `registerCell` does nothing and
 * the hardcoded workbook is byte-for-byte what it was: registering a cell never
 * changes what is written. Keys are stable, readable strings
 * (`plot:<id>:landSqm`, `chain:plot:<id>:totalGfa`); a key registered twice is a
 * builder defect and throws, because two cells claiming one quantity is exactly
 * how a formula would read the wrong one.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';

export interface CellAddr {
  /** The sheet's name as written (used to build a quoted cross-sheet reference). */
  sheet: string;
  /** Absolute column and row, 1-based. */
  row: number;
  col: number;
}

type Sink = (key: string, addr: CellAddr) => void;
let sink: Sink | null = null;

/** Start (a function) or stop (null) recording. Only the formula export sets it. */
export function setCellSink(fn: Sink | null): void { sink = fn; }

/** Record that `cell` on `ws` holds quantity `key`. A no-op outside the formula export. */
export function registerCell(key: string, ws: ExcelJS.Worksheet, cell: ExcelJS.Cell): void {
  if (!sink) return;
  sink(key, { sheet: ws.name, row: Number(cell.row), col: Number(cell.col) });
}

/** A registry that refuses a second claim on one key. */
export class CellRegistry {
  private readonly map = new Map<string, CellAddr>();
  readonly sink: Sink = (key, addr) => {
    const prev = this.map.get(key);
    if (prev && (prev.sheet !== addr.sheet || prev.row !== addr.row || prev.col !== addr.col)) {
      throw new Error(`cellRegistry: "${key}" registered twice (${prev.sheet}!R${prev.row}C${prev.col} and ${addr.sheet}!R${addr.row}C${addr.col})`);
    }
    this.map.set(key, addr);
  };
  get(key: string): CellAddr | undefined { return this.map.get(key); }
  /** The cell or a thrown error naming the missing key (a formula must never guess). */
  need(key: string): CellAddr {
    const a = this.map.get(key);
    if (!a) throw new Error(`cellRegistry: no cell registered for "${key}"`);
    return a;
  }
  keys(): string[] { return [...this.map.keys()]; }
  get size(): number { return this.map.size; }
}
