/**
 * valuesWorkbook.ts (2026-11-12, founder: export simplification step 2)
 *
 * THE VALUES MODE OF THE ONE LAYOUT. The values workbook is the live workbook's layout with the
 * platform ENGINE's numbers in its rows, built by the same builders, so the two files have the
 * same tabs, headings and rows wherever a row is a figure the engine produces. It never runs a
 * formula layer and never evaluates a formula: every number is what the builder printed from the
 * engine (`buildModelWorkbook` with `valuesMode`).
 *
 * A ROW THE ENGINE HAS NO FIGURE FOR IS LEFT OUT. The live layout carries workings a formula
 * needs (the Timeline's year flags and counters, Capex's spend shares and plot weights, a sale
 * line's velocity and sqm sold, the "in operations" flags and inflation factors, the depreciation
 * start helper, the Returns workings and sensitivity streams). The builder works those out by the
 * live workbook's rules, which on a set-up the live workbook refuses (an overlapping phase, a
 * monthly model, existing operations) can contradict what the engine did. A values file shows no
 * such row: `WORKING_ROWS` names them by their registry key, and a heading left with nothing under
 * it goes too. `verify-values-mode` ties every row that remains to an engine series, on every set-up
 * the live workbook refuses and on every open project.
 *
 * It exports for EVERY project and set-up: nothing here refuses.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { buildModelWorkbook, houseContextOf, enableIterativeCalc, type BuildModelOptions } from './buildModelWorkbook';
import { CellRegistry, setCellSink } from './cellRegistry';
import { deleteRowAt } from './liveFrontMatter';
import { applyHouseStyle } from './houseStyle';

/** The working rows the engine has no figure for, by registry key (the row's label cell). */
export const WORKING_ROWS: ReadonlyArray<RegExp> = [
  /^tl:flag:/, /^tl:ctr:/,                                   // Timeline: year flags and counters
  /^cxpp:/, /^cxw:/, /^cxbw:/, /^cxhw:/, /^cxbs:/, /^cx:escf$/, // Capex: phase periods, spend shares, plot weights, escalation factor
  /^rev\|.+\|s\|.*: (velocity|sqm sold|sqm unsold at year end)$/, // Revenue: the sales path's workings
  /^rev\|.+\|s\|Price indexation factor$/,
  /^rev\|.+\|o\|In operations \(1 = yes\)$/,
  /^ox\|.+\|(io|fac)$/,                                       // Opex: in operations, inflation factors (a line, a strip, HQ)
  /^fain:/, /^fafirst:/,                                      // Schedules: depreciation start helper
  /^rs\|/,                                                    // Returns: the stream workings and sensitivity streams
  /^fl:sqmActive$/,                                           // Financing: land under construction (a working of the land split)
  /^fl:ph:/, /^fl:(open|avail|after|idcDisp|ebit0)$/,         // Financing: the loop's own workings (per-phase income and proceeds, cash before / after funding)
  /^cx5memo:/,                                                // Capex: the land-stage memo, a sum the builder forms
  /^fa\|.+\|idcNbv$/,                                         // Schedules: the capitalised interest NBV memo the loop reads
  /^ret\|pt\|cy$/,                                            // Returns: capital-years, a working of the time-weighted share
  /^ret\|ey[fe]\|/,                                           // Returns: the exit-year streams (Scenarios carries the exit-year table, step 6)
  /^rm\|k:l(avail|let)$/,                                     // Returns: lease area let and available, worked back from the averages
  /^rm\|heldcost$/,                                           // Returns: held assets' cost, worked back from income over yield
];

/** A calculation tab's yes / no flags and year counters, by their words. */
export const WORKING_LABELS = /\(1 = yes\)$|^Operating year \(any phase operating\)$|year number$/;

export interface ValuesWorkbookResult { wb: ExcelJS.Workbook; dropped: Array<{ sheet: string; key: string; label: string }> }

export function buildValuesWorkbook(opts: BuildModelOptions): ValuesWorkbookResult {
  const registry = new CellRegistry();
  setCellSink(registry.sink, registry.shift);
  let wb: ExcelJS.Workbook;
  try { wb = buildModelWorkbook({ ...opts, liveLayout: true, valuesMode: true }); } finally { setCellSink(null); }

  // The rows to leave out, per sheet, by the key on their label cell (or any cell of the row).
  const drop = new Map<string, Map<number, string>>();
  for (const key of registry.keys()) {
    if (!WORKING_ROWS.some((re) => re.test(key))) continue;
    const a = registry.get(key)!;
    const m = drop.get(a.sheet) ?? new Map<number, string>();
    if (!m.has(a.row)) m.set(a.row, key);
    drop.set(a.sheet, m);
  }
  // And by what a row IS, wherever its key sits: a yes / no flag or a year counter of a calculation
  // tab (Inputs keeps its typed switches: they are inputs, not workings).
  for (const ws of wb.worksheets) {
    if (ws.name === 'Inputs' || ws.name === 'Guide' || ws.name === 'Cover') continue;
    ws.eachRow((row, r) => {
      const v = row.getCell(1).value;
      if (typeof v !== 'string' || !WORKING_LABELS.test(v.trim())) return;
      const m = drop.get(ws.name) ?? new Map<number, string>();
      if (!m.has(r)) m.set(r, `label:${v.trim()}`);
      drop.set(ws.name, m);
    });
  }
  const dropped: ValuesWorkbookResult['dropped'] = [];
  for (const [sheet, rows] of drop) {
    const ws = wb.getWorksheet(sheet); if (!ws) continue;
    for (const r of [...rows.keys()].sort((x, y) => y - x)) {
      dropped.push({ sheet, key: rows.get(r)!, label: String(ws.getCell(r, 1).value ?? '') });
      deleteRowAt(ws, r);
    }
  }
  for (const ws of wb.worksheets) dropEmptyHeadings(ws);
  // No formula reaches the values file: a stray one keeps the number the builder printed beside it.
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as unknown as { formula?: string; result?: unknown } | null;
    if (v && typeof v === 'object' && typeof v.formula === 'string') c.value = (v.result ?? null) as ExcelJS.CellValue;
  }));
  const house = houseContextOf(wb);
  if (house) applyHouseStyle(wb, house);
  return { wb, dropped };
}

/** A heading (a filled bar, or a bold label with no figure) with no figure under it before the next heading goes. */
function dropEmptyHeadings(ws: ExcelJS.Worksheet): void {
  const isBar = (r: number): boolean => {
    const a = ws.getCell(r, 1);
    const f = (a.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
    return !!f && (f === 'FF0D2E5A' || f === 'FF1B4F8A') && typeof a.value === 'string' && !rowHasFigure(r);
  };
  const rowHasFigure = (r: number): boolean => {
    let any = false;
    ws.getRow(r).eachCell((c, col) => { if (col >= 2 && (typeof c.value === 'number' || (typeof c.value === 'string' && c.value !== ''))) any = true; });
    return any;
  };
  for (let r = ws.rowCount; r >= 5; r--) {
    if (!isBar(r)) continue;
    let next = r + 1;
    while (next <= ws.rowCount && !ws.findRow(next)?.hasValues) next++;
    if (next > ws.rowCount || isBar(next)) deleteRowAt(ws, r);
  }
}

/** The values workbook as a file: the one door the Export dialog's values download calls. */
export async function generateValuesWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const { wb } = buildValuesWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  return enableIterativeCalc(buf as ArrayBuffer);
}
