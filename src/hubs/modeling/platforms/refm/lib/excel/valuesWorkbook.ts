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
 * THE LIVE FILE, FROZEN (2026-11-17, founder: "same tabs, tab order, layout, styles, sections, Dashboard, Guide and
 * Cover as the live file; the only difference: values instead of formulas"). Where the live workbook builds and is
 * not refused, the values file IS that workbook with every formula replaced by the value it holds (the engine's
 * figure the builder printed, which the real-Excel proof shows each formula gives back), so the two files cannot
 * differ in a row, a style or a word. A project the live workbook refuses (no asset, a set-up it does not model)
 * falls back to the values mode below, which builds for every project.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { buildModelWorkbook, houseContextOf, finalizeCalcSettings, applyPartVisibility, type BuildModelOptions } from './buildModelWorkbook';
import { CellRegistry, setCellSink } from './cellRegistry';
import { deleteRowAt } from './liveFrontMatter';
import { applyHouseStyle } from './houseStyle';
import { applyReferenceLayout, echoesToInputColumn } from './referenceLayout';
import { applyTabFrame, tilesInMillions, blankNonFlowTotals } from './tabFrame';
import { finalPasses, plainSalesWords, namedTolerances, snapResidues, houseStandard, modelYearRow, cleanDefinedNames } from './readability';
import { TAB_ORDER, buildFormulaWorkbook } from './formulaWorkbook';
import { emptyProjectRefusal, liveWorkbookRefusal } from './liveWorkbookAvailability';
import { addDashboardCharts, addRiskTriggers, type ChartSpec } from './dashboard';
import { isEmptyText, FormulaEvaluator, workbookReader } from './formulaEval';
import { buildFrontTabs } from './referenceFront';

/** THE VALUES FILE'S TABS IN THE LIVE FILE'S ORDER (founder, 2026-11-15): Revenue before Capex and Financing. */
function orderTabs(wb: ExcelJS.Workbook): void {
  let n = 0;
  const at = (ws: ExcelJS.Worksheet): { orderNo: number } => ws as unknown as { orderNo: number };
  for (const name of TAB_ORDER) { const ws = wb.getWorksheet(name); if (ws) at(ws).orderNo = n++; }
  for (const ws of wb.worksheets) if (!TAB_ORDER.includes(ws.name)) at(ws).orderNo = n++;
}

/** The working rows the engine has no figure for, by registry key (the row's label cell). */
export const WORKING_ROWS: ReadonlyArray<RegExp> = [
  /^tl:flag:/, /^tl:ctr:/,                                   // Timeline: year flags and counters
  /^cxpp:/, /^cxw:/, /^cxwhead$/, /^cxbband:/, /^cxbw:/, /^cxhw:/, /^cxbs:/, /^cx:escf$/, // Capex: phase periods, spend shares (and their heads), plot weights, escalation factor
  // Revenue: the sales path's workings (a line of one sub-unit names them without a prefix, 2026-11-17)
  /^rev\|.+\|s\|(?:.*: )?(velocity|pre-sales %|sales during operation %|sqm sold|sqm unsold at year end)$/i,
  /^rev\|.+\|s\|Price indexation factor$/,
  /^rev\|.+\|o\|In operations \(1 = yes\)$/,
  /^ox\|.+\|(io|fac)$/,                                       // Opex: in operations, inflation factors (a line, a strip, HQ)
  // (2026-11-15) The life and the first depreciation year are now single values in the Input column: shown.
  // Returns: the year flags and the cash-held workings only (2026-11-17, step 7). Step 6 put the visible
  // streams (FCFF, FCFE, distributions, the fee waterfall, fee income) under `rs|` too, and a blanket `^rs\|`
  // took every cash flow row off the values file's Returns, leaving its IRR lines with nothing above them.
  /^rs\|(hold|con|cxon|level|floor|close|debt)(\||$)/,
  // Financing: the settings block (2026-11-15, founder: the live file links Inputs and Land & Area directly).
  /^fl:tr:[^:]+:(rate|td)$/,
  /^fl:(open|avail|after|idcDisp|ebit0)$/,         // Financing: the loop's own workings (per-phase income and proceeds, cash before / after funding)
  /^cx5memo:/,                                                // Capex: the land-stage memo, a sum the builder forms
  /^fa\|.+\|idcNbv$/,                                         // Schedules: the capitalised interest NBV memo the loop reads
  /^ret\|pt\|cy(:cash|:kind)?$/,                               // Returns: capital-years, a working of the time-weighted share
  /^ret\|ey[fe]\|/,                                           // Returns: the exit-year streams (Scenarios carries the exit-year table, step 6)
  /^rm\|k:l(avail|let)(:\d+)?$/,                              // Returns: lease area let and available, worked back from the averages
  /^rm\|at95y$/,
  /^rm\|heldcost:\d+$/,
  /^ret\|x\|exyr$/,
  /^rm\|heldcost$/,                                           // Returns: held assets' cost, worked back from income over yield
];

/** A calculation tab's yes / no flags and year counters, by their words. */
export const WORKING_LABELS = /\(1 = yes\)$|^Operating year \(any phase operating\)$|year number$/;

export interface ValuesWorkbookResult { wb: ExcelJS.Workbook; dropped: Array<{ sheet: string; key: string; label: string }>; source?: 'live' | 'values'; charts?: ChartSpec[] }

/**
 * A formula's value in the values file (2026-11-17, founder: "zeros written as blank"). ExcelJS reports a cached 0 as
 * NO result (TRAPS 3.45), so `result ?? null` wrote 3,518 zeros as empty cells, which show nothing where the live file
 * shows "-". A missing result is the zero it stands for; only a formula that returns "" is empty, and an error value
 * (none is exported) would be empty too.
 */
export function frozenValue(result: unknown, emptyText = false): ExcelJS.CellValue {
  if (emptyText) return null;
  if (result === undefined || result === null) return 0;
  if (result === '') return null;
  if (typeof result === 'object' && !(result instanceof Date)) return null;
  return result as ExcelJS.CellValue;
}

/**
 * EVERY FORMULA'S VALUE, as the values file holds it: the cached result; where ExcelJS kept none (it keeps no 0 and no
 * ""), the formula worked out over the cached figures (formulaEval.ts), "" staying empty and anything else its value;
 * a formula the evaluator cannot read (IRR, EDATE: always a figure) its 0. Worked out before any cell is replaced.
 */
export function formulaValuesOf(wb: ExcelJS.Workbook): Map<string, ExcelJS.CellValue> {
  const ev = new FormulaEvaluator(workbookReader(wb));
  const out = new Map<string, ExcelJS.CellValue>();
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as unknown as { formula?: string; result?: unknown } | null;
    if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
    let empty = isEmptyText(wb, ws.name, c.address);
    if (!empty && (v.result === undefined || v.result === null)) { try { empty = ev.evaluate(v.formula, ws.name) === ''; } catch { empty = false; } }
    out.set(`${ws.name}!${c.address}`, frozenValue(v.result, empty));
  }));
  return out;
}
/** Every formula of the workbook replaced by its value (formulaValuesOf). */
export function freezeFormulas(wb: ExcelJS.Workbook): void {
  const vals = formulaValuesOf(wb);
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const k = `${ws.name}!${c.address}`;
    if (vals.has(k)) c.value = vals.get(k)!;
  }));
}

/**
 * The live workbook with every formula frozen to the value it holds, or null when the live workbook does not build
 * for this project (no asset, a refusal, a failed check), in which case the values mode builds the file.
 */
export function frozenLiveWorkbook(opts: BuildModelOptions): { wb: ExcelJS.Workbook; charts: ChartSpec[] } | null {
  const assets = (opts.state as { assets?: Array<{ visible?: boolean }> }).assets ?? [];
  if (emptyProjectRefusal(assets.filter((a) => a.visible !== false).length)) return null;
  let wb: ExcelJS.Workbook, charts: ChartSpec[];
  try {
    const res = buildFormulaWorkbook({ ...opts, valuesOutput: true });
    if (liveWorkbookRefusal(res.status)) return null;
    wb = res.wb; charts = res.charts;
  } catch {
    return null;
  }
  freezeFormulas(wb);
  applyPartVisibility(wb, opts.parts);
  return { wb, charts };
}

export function buildValuesWorkbook(opts: BuildModelOptions): ValuesWorkbookResult {
  const frozen = frozenLiveWorkbook(opts);
  if (frozen) return { wb: frozen.wb, dropped: [], source: 'live', charts: frozen.charts };
  return buildValuesModeWorkbook(opts);
}

/**
 * THE VALUES MODE, the file for a project the live workbook does not build for (and the engine-tie proof of
 * verify-values-mode): the live layout's rows with the engine's numbers, laid out as the live file is, with the same
 * front tabs (the Dashboard, the Guide, the Cover's navigation).
 */
export function buildValuesModeWorkbook(opts: BuildModelOptions): ValuesWorkbookResult {
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
  // Which tabs carry a figure in the Input column before any working row goes (the live file keeps the column there).
  const keepInput = new Set<string>();
  for (const ws of wb.worksheets) ws.eachRow((row, r) => { if (r >= 5) { const v = row.getCell(2).value as unknown; if (typeof v === 'number' || (!!v && typeof v === 'object' && 'formula' in (v as object))) keepInput.add(ws.name); } });
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
    if (v && typeof v === 'object' && typeof v.formula === 'string') c.value = frozenValue(v.result);
  }));
  const house = houseContextOf(wb);
  if (house) {
    applyHouseStyle(wb, house);
    if (house.frame) applyTabFrame(wb, house.frame, { values: true, keepInput });
    tilesInMillions(wb);
    blankNonFlowTotals(wb);
    finalPasses(wb, house.scale);
    plainSalesWords(wb);
    addRiskTriggers(wb);
    applyReferenceLayout(wb);
    echoesToInputColumn(wb);
  }
  orderTabs(wb);
  let charts: ChartSpec[] = [];
  if (house) {
    const front = buildFrontTabs(wb, { valuesOutput: true, scale: house.scale, emptyDashboardIfUnreadable: true });
    charts = front.charts;
    if (front.split) registry.relocate(front.split.move);
    // The front tabs are built as formulas over the figures; a values file holds their values.
    freezeFormulas(wb);
  }
  // The same tolerance cells as the live file (2026-11-19, founder B5), so the layouts agree.
  namedTolerances(wb);
  snapResidues(wb, false);
  modelYearRow(wb, false);
  cleanDefinedNames(wb);
  houseStandard(wb);
  orderTabs(wb);
  return { wb, dropped, source: 'values', charts };
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
  const { wb, charts } = buildValuesWorkbook(opts);
  const buf = await addDashboardCharts((await wb.xlsx.writeBuffer()) as ArrayBuffer, charts ?? []);
  return finalizeCalcSettings(buf);
}
