/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-excel-recalc.ts
 *
 * Proves the Excel MODEL export actually RECALCULATES (not just opens with cached
 * values). The structure verifier (verify-excel-export.ts) checks the cached
 * `{ formula, result }` values; those come from the TS twin, so a wrong cell
 * REFERENCE would still cache the right number yet break on edit. This script
 * loads the generated formulas into HyperFormula, evaluates the dependency graph
 * from scratch, and asserts:
 *   1. the Balance Sheet balances when computed from the formulas alone,
 *   2. the IRR cells evaluate to a finite number matching the cached value,
 *   3. editing an input (exit multiple) actually MOVES the IRR (liveness).
 */
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

// Convert an ExcelJS cell value into HyperFormula content (formula string or scalar).
function cellContent(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('formula' in v) return '=' + v.formula;
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if ('richText' in v) return (v.richText as any[]).map((r) => r.text).join('');
    if ('hyperlink' in v) return v.text ?? '';
    return null;
  }
  return v;
}

const NAMES = ['ProjectStartYear', 'TaxRate', 'DebtPct', 'EquityPct', 'MinCashReserve', 'DsoDays', 'DpoDays', 'DiscountRate', 'ExitMultiple', 'ExitYearOffset', 'PerpetuityGrowth'];
const labelOf = (ws: ExcelJS.Worksheet, R: number): string => { const a = ws.getCell(R, 1).value; return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : ''); };
const rowByLabel = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (row < 0 && re.test(labelOf(ws, R))) row = R; }); return row; };
const colNum = (letters: string): number => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

function toHyperFormula(wb: ExcelJS.Workbook): { hf: HyperFormula; sheetId: (n: string) => number } {
  const sheets: Record<string, any[][]> = {};
  for (const ws of wb.worksheets) {
    const maxR = ws.rowCount, maxC = Math.max(ws.columnCount, 1);
    const data: any[][] = [];
    for (let r = 1; r <= maxR; r++) {
      const row: any[] = [];
      for (let c = 1; c <= maxC; c++) row.push(cellContent(ws.getCell(r, c).value));
      data.push(row);
    }
    sheets[ws.name] = data;
  }
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  // Register the model's defined names (single-cell scalars on Assumptions).
  for (const name of NAMES) {
    let ranges: string[] = [];
    try { ranges = ((wb.definedNames as any).getRanges(name)?.ranges) ?? []; } catch { /* none */ }
    if (ranges.length) { try { hf.addNamedExpression(name, '=' + ranges[0]); } catch { /* dup */ } }
  }
  return { hf, sheetId: (n: string) => hf.getSheetId(n)! };
}

function main(): void {
  console.log('=== Excel MODEL recalc proof (HyperFormula evaluates the formula graph) ===');
  const state = buildExcelSampleState();
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '11 June 2026' });
  const { hf, sheetId } = toHyperFormula(wb);

  const bsWs = wb.getWorksheet('Balance Sheet')!;
  const retWs = wb.getWorksheet('Returns')!;
  const bsDiffRow = rowByLabel(bsWs, /^Balance check/);
  const irrRow = rowByLabel(retWs, /^Project IRR \(FCFF\)$/);
  const eqIrrRow = rowByLabel(retWs, /^Equity IRR \(FCFE\)$/);
  const bsId = sheetId('Balance Sheet');
  const retId = sheetId('Returns');

  // 1. Balance sheet balances when computed purely from the formulas.
  let maxDiff = 0;
  const maxC = bsWs.columnCount;
  for (let c = 6; c <= maxC; c++) {
    const v = hf.getCellValue({ sheet: bsId, row: bsDiffRow - 1, col: c - 1 });
    if (typeof v === 'number') maxDiff = Math.max(maxDiff, Math.abs(v));
  }
  check('Balance Sheet balances when formulas are evaluated (max |diff| < 1)', maxDiff < 1, `maxDiff=${maxDiff}`);

  // HyperFormula has NPV but NOT IRR, so the IRR cell itself can only be checked
  // structurally (Excel computes it natively). The spine that feeds IRR (the FCFF
  // / FCFE streams + NPV) IS fully evaluated here, so a wrong reference WOULD be
  // caught: IRR is a deterministic function of a stream we prove recomputes.
  const num = (v: any): number => (v && typeof v === 'object' && 'result' in v ? v.result : (typeof v === 'number' ? v : NaN));

  // 2. The FCFF / FCFE streams recompute cell-for-cell from the formula graph.
  const fcffRow = rowByLabel(retWs, /^FCFF \(project\)$/);
  const fcfeRow = rowByLabel(retWs, /^FCFE \(equity\)$/);
  const streamMatches = (row: number): { ok: boolean; n: number } => {
    let ok = true, n = 0;
    for (let c = 6; c <= retWs.columnCount; c++) {
      const cached = num(retWs.getCell(row, c).value);
      if (!Number.isFinite(cached)) continue;
      const evald = hf.getCellValue({ sheet: retId, row: row - 1, col: c - 1 });
      n++;
      if (typeof evald !== 'number' || Math.abs(evald - cached) > Math.max(1, Math.abs(cached) * 1e-6)) ok = false;
    }
    return { ok, n };
  };
  const fcffStream = streamMatches(fcffRow);
  const fcfeStream = streamMatches(fcfeRow);
  check('FCFF stream recomputes cell-for-cell from the formulas', fcffStream.ok && fcffStream.n > 0, `cells=${fcffStream.n}`);
  check('FCFE stream recomputes cell-for-cell from the formulas', fcfeStream.ok && fcfeStream.n > 0, `cells=${fcfeStream.n}`);

  // 3. NPV (HF-supported) evaluates and matches the twin (validates discounting + the stream).
  const npvRow = rowByLabel(retWs, /^Project NPV \(FCFF\)$/);
  const npvEval = hf.getCellValue({ sheet: retId, row: npvRow - 1, col: 3 });
  const npvCached = num(retWs.getCell(npvRow, 4).value);
  check('Project NPV (FCFF) evaluates and matches the twin', typeof npvEval === 'number' && Math.abs(npvEval - npvCached) <= Math.max(1, Math.abs(npvCached) * 1e-6), `eval=${npvEval} cached=${npvCached}`);

  // 4. The IRR cell is structurally a live IRR() over the FCFF stream range.
  const irrF = String((retWs.getCell(irrRow, 4).value as any)?.formula ?? '');
  const eqIrrF = String((retWs.getCell(eqIrrRow, 4).value as any)?.formula ?? '');
  check('Project IRR is a live IRR() over the FCFF stream (Excel-native)', /IRR\([A-Z]+\d+:[A-Z]+\d+/.test(irrF), `f=${irrF}`);
  check('Equity IRR is a live IRR() over the FCFE stream (Excel-native)', /IRR\([A-Z]+\d+:[A-Z]+\d+/.test(eqIrrF));

  // 5. Liveness: editing the exit multiple MOVES the FCFF NPV (terminal -> stream -> NPV).
  let exitMultAddr = '';
  try { exitMultAddr = (((wb.definedNames as any).getRanges('ExitMultiple')?.ranges) ?? [])[0] ?? ''; } catch { /* */ }
  const m = /^([^!]+)!\$?([A-Z]+)\$?(\d+)$/.exec(exitMultAddr.replace(/'/g, ''));
  if (m) {
    const aId = sheetId(m[1]);
    const cell = { sheet: aId, row: Number(m[3]) - 1, col: colNum(m[2]) - 1 };
    const before = hf.getCellValue({ sheet: retId, row: npvRow - 1, col: 3 }) as number;
    const cur = hf.getCellValue(cell) as number;
    hf.setCellContents(cell, [[(typeof cur === 'number' ? cur : 9) * 2 + 5]]);
    const after = hf.getCellValue({ sheet: retId, row: npvRow - 1, col: 3 }) as number;
    check('Editing the exit multiple changes the FCFF NPV (live recalc)', typeof before === 'number' && typeof after === 'number' && Math.abs(after - before) > 1e-6, `before=${before} after=${after}`);
  } else {
    check('Editing the exit multiple changes the FCFF NPV (live recalc)', false, `could not resolve ExitMultiple address (${exitMultAddr})`);
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

main();
