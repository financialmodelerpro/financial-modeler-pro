/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-excel-export.ts
 *
 * Locks the HARDCODED Excel MODEL export (full platform mirror, 2026-06-13).
 * The workbook is a hardcoded snapshot of the platform: every computed cell is
 * the platform-computed value written as a CONSTANT (no live formulas). The file
 * lets a user read all results and run their own scenarios manually; editing a
 * cell does not recalculate, the user re-exports after changing inputs.
 *
 * Checks: structure (14 tabs incl. the consolidated Inputs tab, gridlines hidden,
 * frozen 4-row headers), NO formula cells anywhere (it is hardcoded), every
 * figure ties to the platform snapshot (Capex grand + the 4 tables, Revenue,
 * Opex, P&L, Cash Flow, Balance Sheet, Financing), the consolidated Inputs tab
 * carries the grouped dividers, each output tab has the "Basis / Calculation"
 * guidance column + the snapshot/cross-tab note, and the accounting formatting
 * (dash for zero, percentages 2dp) holds at both display scales.
 */
import ExcelJS from 'exceljs';
import { buildModelWorkbook, generateModelWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const num = (v: any): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') { if ('result' in v && typeof v.result === 'number') return v.result; if ('formula' in v) return NaN; }
  return NaN;
};
const isFormula = (v: any): boolean => !!(v && typeof v === 'object' && 'formula' in v);
const labelOf = (ws: ExcelJS.Worksheet, R: number): string => { const a = ws.getCell(R, 1).value; return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : ''); };
const rowByLabel = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (row < 0 && re.test(labelOf(ws, R))) row = R; }); return row; };
const sumA = (a: number[], n: number): number => a.slice(0, n).reduce((s, v) => s + (v ?? 0), 0);
const close = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= Math.max(1000, Math.abs(b) * tol);

async function main(): Promise<void> {
  console.log('=== Excel MODEL export test (hardcoded platform mirror) ===');
  const state = buildExcelSampleState();
  const snap = computeFinancialsSnapshot(state);
  const N = snap.axisLength;
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '13 June 2026' });

  const ALL_SHEETS = ['Cover', 'Inputs', 'Timeline', 'Land & Area', 'Capex', 'Revenue', 'Cost of Sales', 'Opex', 'Financing', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Checks'];
  for (const name of ALL_SHEETS) check(`worksheet present: ${name}`, !!wb.getWorksheet(name));
  const noGrid = (n: string): boolean => (wb.getWorksheet(n)?.views ?? []).every((v) => (v as any).showGridLines === false);
  for (const name of ALL_SHEETS) check(`gridlines hidden: ${name}`, noGrid(name));

  const OUTPUT_TABS = ['Revenue', 'Cost of Sales', 'Opex', 'Financing', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns'];
  const frozenOk = (n: string): boolean => { const v: any = (wb.getWorksheet(n)?.views ?? [])[0]; return v && v.state === 'frozen' && v.ySplit === 4 && v.xSplit === 4; };
  for (const n of OUTPUT_TABS) check(`frozen header (rows 1-4, cols A-D): ${n}`, frozenOk(n));

  // ── HARDCODED: no formula cells anywhere in the workbook ────────────────────
  let formulaCells = 0;
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) formulaCells++; }));
  check('workbook is fully hardcoded (zero formula cells)', formulaCells === 0, `formulaCells=${formulaCells}`);

  // ── Capex grand + the 4 tables tie to the snapshot ──────────────────────────
  const cap = wb.getWorksheet('Capex')!;
  const totCapexD = (re: RegExp): number => { const R = rowByLabel(cap, re); return R > 0 ? num(cap.getCell(R, 5).value) : NaN; }; // Capex Total col = E (5)
  const snapGrand = snap.financing.capex.totals.inclAllLand;
  check('Capex Project Total (incl. all land) == snapshot grand', close(totCapexD(/^Project Total \(incl\. all land\)$/), snapGrand, 1e-6), `wb=${Math.round(totCapexD(/^Project Total \(incl\. all land\)$/))} snap=${Math.round(snapGrand)}`);
  check('Capex Table 2 (incl. all land) total ties', close(totCapexD(/^Total Capex \(incl\. all land\)$/), snapGrand, 1e-6));
  check('Capex Table 3 (excl. land in-kind) total present', Number.isFinite(totCapexD(/^Total Capex \(excl\. land in-kind\)$/)));
  check('Capex Table 4 (excl. all land) total present', Number.isFinite(totCapexD(/^Total Capex \(excl\. all land\)$/)));

  // ── Statements tie EXACTLY to the platform snapshot (constants) ─────────────
  const totD = (sheet: string, re: RegExp): number => { const ws = wb.getWorksheet(sheet)!; const R = rowByLabel(ws, re); return R > 0 ? num(ws.getCell(R, 4).value) : NaN; }; // period-sheet Total col = D (4)
  check('Revenue total == snapshot total revenue', close(totD('Revenue', /^Total revenue$/), sumA(snap.pl.totalRevenuePerPeriod, N)), `wb=${Math.round(totD('Revenue', /^Total revenue$/))} snap=${Math.round(sumA(snap.pl.totalRevenuePerPeriod, N))}`);
  check('Opex total == snapshot total opex', close(totD('Opex', /^Total opex$/), sumA(snap.pl.totalOpexPerPeriod, N)));
  check('Cost of Sales total == snapshot cost of sales', close(totD('Cost of Sales', /^Total cost of sales$/), sumA(snap.pl.cosPerPeriod, N)));
  check('P&L Revenue == snapshot total revenue', close(totD('P&L', /^Revenue$/), sumA(snap.pl.totalRevenuePerPeriod, N)));
  check('P&L Profit after tax == snapshot PAT', close(totD('P&L', /^Profit after tax$/), sumA(snap.pl.patPerPeriod, N)));
  // P&L EBITDA per-period ties cell-for-cell.
  const plWs = wb.getWorksheet('P&L')!; const ebitdaRow = rowByLabel(plWs, /^EBITDA$/);
  let ebitdaTie = ebitdaRow > 0; for (let t = 0; t < N && ebitdaTie; t++) ebitdaTie = close(num(plWs.getCell(ebitdaRow, 6 + t).value), snap.pl.ebitdaPerPeriod[t] ?? 0);
  check('P&L EBITDA ties to snapshot per period', ebitdaTie);
  // Financing interest ties to the platform interest expense.
  check('Financing interest total == snapshot interest expense', close(totD('Financing', /^Interest \(rate x opening debt\)$/), sumA(snap.pl.interestExpensePerPeriod, N)));
  // Cash Flow closing cash (last period) == snapshot closing cash.
  const cfWs = wb.getWorksheet('Cash Flow')!; const ccRow = rowByLabel(cfWs, /^Closing cash$/);
  check('Cash Flow closing cash (last) == snapshot closing cash', ccRow > 0 && close(num(cfWs.getCell(ccRow, 6 + N - 1).value), snap.directCF.closingCashPerPeriod[N - 1] ?? 0));

  // ── Balance Sheet balances by construction (constants) ──────────────────────
  const bsWs = wb.getWorksheet('Balance Sheet')!;
  const bsDiffRow = rowByLabel(bsWs, /^Balance check/);
  let maxBsDiff = 0; if (bsDiffRow > 0) for (let t = 0; t < N; t++) { const v = num(bsWs.getCell(bsDiffRow, 6 + t).value); if (Number.isFinite(v)) maxBsDiff = Math.max(maxBsDiff, Math.abs(v)); }
  check('Balance Sheet balances by construction (max |Assets - L&E| < 1)', bsDiffRow > 0 && maxBsDiff < 1, `maxDiff=${maxBsDiff}`);
  check('Balance Sheet Total assets == snapshot total assets', close(num(bsWs.getCell(rowByLabel(bsWs, /^Total assets$/), 6 + N - 1).value), snap.bs.totalAssetsPerPeriod[N - 1] ?? 0));

  // ── Consolidated Inputs tab carries the grouped dividers ────────────────────
  const inp = wb.getWorksheet('Inputs')!;
  for (const re of [/^Project$/, /^Phases$/, /^Assets$/, /^Capex cost lines/, /Financing facilities/]) check(`Inputs divider present: ${re.source}`, rowByLabel(inp, re) > 0);
  check('Inputs title says Inputs', /Inputs/.test(labelOf(inp, 1)));

  // ── Guidance "Basis / Calculation" column on every output tab ───────────────
  const hasBasisCol = (sheet: string): boolean => { const ws = wb.getWorksheet(sheet)!; return String(ws.getCell(4, 2).value ?? '').includes('Basis'); };
  for (const n of OUTPUT_TABS) check(`Basis / Calculation column header present: ${n}`, hasBasisCol(n));
  // Basis cells populated (plain text, not formulas) on P&L AND Financing.
  const basisCells = (sheet: string): number => { let n = 0; wb.getWorksheet(sheet)!.eachRow((row, R) => { if (R > 4) { const b = wb.getWorksheet(sheet)!.getCell(R, 2).value; if (typeof b === 'string' && b.length > 0 && b !== 'Basis / Calculation') n++; } }); return n; };
  check('P&L basis column is populated with descriptive text', basisCells('P&L') >= 8, `cells=${basisCells('P&L')}`);
  check('Financing basis column is populated (recurrence rows)', basisCells('Financing') >= 18, `cells=${basisCells('Financing')}`);

  // ── Snapshot note (cell comment) on each output tab + Capex + Land & Area ────
  const hasNote = (sheet: string): boolean => { const c: any = wb.getWorksheet(sheet)!.getCell('A1'); return !!c.note; };
  for (const n of [...OUTPUT_TABS, 'Capex', 'Land & Area']) check(`snapshot note present: ${n}`, hasNote(n));
  // Land & Area carries its guidance as a per-column legend (its grid layout
  // can not take a per-row Basis column).
  check('Land & Area has a Basis / Calculation legend', rowByLabel(wb.getWorksheet('Land & Area')!, /^Basis \/ Calculation \(per column\)$/) > 0);

  // ── Returns: IRR is a finite constant (not a live formula) ──────────────────
  const ret = wb.getWorksheet('Returns')!; const irrRow = rowByLabel(ret, /^Project IRR \(FCFF\)$/);
  const irrCell: any = irrRow > 0 ? ret.getCell(irrRow, 4).value : null;
  check('Returns Project IRR is a finite constant (not a formula)', irrRow > 0 && !isFormula(irrCell) && Number.isFinite(num(irrCell)), `irr=${num(irrCell)}`);

  // ── Accounting formatting: dash for zero + percentages 2dp ──────────────────
  const moneyCell = bsWs.getCell(rowByLabel(bsWs, /^Total assets$/), 6);
  check('money format uses dash for zero', typeof moneyCell.numFmt === 'string' && moneyCell.numFmt.includes('"-"'));
  const revWs = wb.getWorksheet('Revenue')!; let pct2Ok = false;
  revWs.eachRow((row) => row.eachCell((c) => { if (typeof c.numFmt === 'string' && /0\.00%/.test(c.numFmt)) pct2Ok = true; }));
  check('percentages are 2 decimals', pct2Ok);

  // ── Valid .xlsx reloads cleanly ─────────────────────────────────────────────
  const buf = await generateModelWorkbookBuffer({ state, projectName: 'X', dateLabel: 'd' });
  check('writes a non-trivial .xlsx buffer', buf.byteLength > 8192, `bytes=${buf.byteLength}`);
  const reload = new ExcelJS.Workbook();
  await reload.xlsx.load(buf);
  check('buffer reloads with all sheets', ALL_SHEETS.every((n) => !!reload.getWorksheet(n)));

  // ── Display scale leaves stored values unchanged (millions) ─────────────────
  const wbM = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', displayScale: 'millions' });
  const revM = wbM.getWorksheet('Revenue')!; const rtRowM = rowByLabel(revM, /^Total revenue$/);
  const revTotWb = totD('Revenue', /^Total revenue$/);
  check('Display scale leaves stored values unchanged', rtRowM > 0 && Math.abs(num(revM.getCell(rtRowM, 4).value) - revTotWb) <= Math.max(1, Math.abs(revTotWb) * 1e-6));
  // No formulas at millions scale either.
  let fm = 0; for (const ws of wbM.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) fm++; }));
  check('millions-scale workbook is also fully hardcoded', fm === 0, `formulaCells=${fm}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
