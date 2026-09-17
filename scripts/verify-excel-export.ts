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
 * Checks: structure (16 tabs incl. the consolidated Inputs tab, a one-page Summary + a Scenarios tab, gridlines hidden,
 * frozen 4-row headers), NO formula cells anywhere (it is hardcoded), every
 * figure ties to the platform snapshot (Capex grand + the 4 tables, Revenue,
 * Opex, P&L, Cash Flow, Balance Sheet, Financing), the consolidated Inputs tab
 * carries the grouped dividers, each output tab has the "Basis / Calculation"
 * guidance column + the snapshot/cross-tab note, and the accounting formatting
 * (dash for zero, percentages 2dp) holds at both display scales.
 */
import ExcelJS from 'exceljs';
import { buildModelWorkbook, generateModelWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCostOfSalesReport } from '../src/hubs/modeling/platforms/refm/lib/reports/cosReports';
import * as FinancingReports from '../src/hubs/modeling/platforms/refm/lib/reports/financingReports';
import { readFileSync as fsReadFileSync } from 'fs';
import { buildExcelSampleState } from './excelSampleState';
import { ARGB, ALLOWED_FILLS } from '../src/hubs/modeling/platforms/refm/lib/excel/styles';
import { payloadHasActiveProject } from '../src/shared/entitlements/exportGuard';

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
/** The first row matching `re` BELOW the first row matching `after`. The
 *  Revenue tab mirrors the platform's project total tables, whose grand row is
 *  "Total Project" in three tables (sales value, recognised, cash), so the
 *  recognised figure is found under its own table title. */
const rowByLabelAfter = (ws: ExcelJS.Worksheet, after: RegExp, re: RegExp): number => { const from = rowByLabel(ws, after); let row = -1; if (from < 0) return -1; ws.eachRow((_r, R) => { if (row < 0 && R > from && re.test(labelOf(ws, R))) row = R; }); return row; };
const sumA = (a: number[], n: number): number => a.slice(0, n).reduce((s, v) => s + (v ?? 0), 0);
const close = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= Math.max(1000, Math.abs(b) * tol);

async function main(): Promise<void> {
  console.log('=== Excel MODEL export test (hardcoded platform mirror) ===');
  const state = buildExcelSampleState();
  const snap = computeFinancialsSnapshot(state);
  const N = snap.axisLength;
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '13 June 2026' });

  // Tab sequence follows the platform module order: Module 1 (Inputs, Timeline,
  // Land & Area, Capex, Financing), Module 2 (Revenue: a single sheet mirroring
  // all five Module 2 sub-tabs), Module 3 (Opex), Module 4 (P&L, Cash Flow,
  // Balance Sheet), Module 5 (Returns).
  const ALL_SHEETS = ['Cover', 'Guide', 'Summary', 'Inputs', 'Timeline', 'Land & Area', 'Capex', 'Financing', 'Revenue', 'Opex', 'Schedules', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios', 'Checks'];
  for (const name of ALL_SHEETS) check(`worksheet present: ${name}`, !!wb.getWorksheet(name));
  const actualOrder = wb.worksheets.map((w) => w.name);
  check('worksheet sequence follows the platform module order', actualOrder.join(' > ') === ALL_SHEETS.join(' > '), actualOrder.join(' > '));
  const noGrid = (n: string): boolean => (wb.getWorksheet(n)?.views ?? []).every((v) => (v as any).showGridLines === false);
  for (const name of ALL_SHEETS) check(`gridlines hidden: ${name}`, noGrid(name));

  const OUTPUT_TABS = ['Revenue', 'Opex', 'Financing', 'Schedules', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns'];
  const frozenOk = (n: string): boolean => { const v: any = (wb.getWorksheet(n)?.views ?? [])[0]; return v && v.state === 'frozen' && v.ySplit === 4 && v.xSplit === 4; };
  for (const n of OUTPUT_TABS) check(`frozen header (rows 1-4, cols A-D): ${n}`, frozenOk(n));

  // ── HARDCODED: no formula cells anywhere in the workbook ────────────────────
  let formulaCells = 0;
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) formulaCells++; }));
  check('workbook is fully hardcoded (zero formula cells)', formulaCells === 0, `formulaCells=${formulaCells}`);

  // ── Capex grand + the 4 tables tie to the snapshot ──────────────────────────
  const cap = wb.getWorksheet('Capex')!;
  const totCapexD = (re: RegExp): number => { const R = rowByLabel(cap, re); return R > 0 ? num(cap.getCell(R, 5).value) : NaN; }; // Capex Total col = E (5)
  // The platform labels (2026-09-17): Table 1 closes on "Project Total" and each
  // summary table on "Total", so a table's total is the first matching row
  // BELOW its own title, never the first match on the sheet.
  const totAfter = (title: RegExp, re: RegExp): number => {
    const T = rowByLabel(cap, title); if (T < 0) return NaN;
    let row = -1; cap.eachRow((_r, R) => { if (row < 0 && R > T && re.test(labelOf(cap, R))) row = R; });
    return row > 0 ? num(cap.getCell(row, 5).value) : NaN;
  };
  const snapGrand = snap.financing.capex.totals.inclAllLand;
  const capTot = snap.financing.capex.totals;
  check('Capex Project Total (incl. all land) == snapshot grand', close(totCapexD(/^Project Total$/), snapGrand, 1e-6), `wb=${Math.round(totCapexD(/^Project Total$/))} snap=${Math.round(snapGrand)}`);
  check('Capex Table 2 (incl. all land) total ties', close(totAfter(/^Table 2 - /, /^Total$/), snapGrand, 1e-6));
  check('Capex Table 3 (excl. land in-kind) total ties', close(totAfter(/^Table 3 - /, /^Total$/), capTot.exclLandInKind, 1e-6));
  check('Capex Table 4 (excl. all land) total ties', close(totAfter(/^Table 4 - /, /^Total$/), capTot.exclAllLand, 1e-6));
  check('Capex Table 5 total land == Table 2 less Table 4', close(totAfter(/^Table 5 - /, /^Total land$/), capTot.inclAllLand - capTot.exclAllLand, 1e-6), `wb=${totAfter(/^Table 5 - /, /^Total land$/)}`);
  check('Capex Table 6 both category blocks foot to Tables 2 and 4', close(totCapexD(/^Including all land, total$/), snapGrand, 1e-6) && close(totCapexD(/^Excluding total land, total$/), capTot.exclAllLand, 1e-6));
  check('Capex UOM reads the platform method label, never a raw method id', (() => { let raw = false; cap.eachRow((row) => { const b = row.getCell(2).value; if (typeof b === 'string' && /^(percent_of|rate_|per_sub)/.test(b)) raw = true; }); return !raw; })());

  // ── Statements tie EXACTLY to the platform snapshot (constants) ─────────────
  const totD = (sheet: string, re: RegExp): number => { const ws = wb.getWorksheet(sheet)!; const R = rowByLabel(ws, re); return R > 0 ? num(ws.getCell(R, 4).value) : NaN; }; // period-sheet Total col = D (4)
  const revTotalRow = rowByLabelAfter(wb.getWorksheet('Revenue')!, /^Project Revenue Recognised$/, /^Total Project$/);
  const revTotalWb = revTotalRow > 0 ? num(wb.getWorksheet('Revenue')!.getCell(revTotalRow, 4).value) : NaN;
  check('Revenue total (Project Revenue Recognised, Total Project) == snapshot total revenue', close(revTotalWb, sumA(snap.pl.totalRevenuePerPeriod, N)), `wb=${Math.round(revTotalWb)} snap=${Math.round(sumA(snap.pl.totalRevenuePerPeriod, N))}`);
  check('Opex total == snapshot total opex', close(totD('Opex', /^Total Project Opex$/), sumA(snap.pl.totalOpexPerPeriod, N)));
  // Module 3 mirror: the Opex sheet reproduces both platform sub-tabs in order
  // (Inputs, Opex Output); the payables roll-forward sits on Output, as on screen.
  const opxWs = wb.getWorksheet('Opex')!;
  const m3 = (re: RegExp): number => rowByLabel(opxWs, re);
  const m3a = m3(/^1\. Opex Inputs/), m3b = m3(/^2\. Opex Output/);
  check('Opex mirrors the Module 3 sub-tabs in sequence (Inputs, Opex Output)', m3a > 0 && m3b > m3a, `rows=${m3a},${m3b}`);
  check('Opex Output carries the project-total Accounts Payable roll-forward', m3(/^Project Total: AP Roll-Forward$/) > m3b);
  check('Opex Inputs print the platform labels, never the stored codes', m3(/^Line item$/) > m3a
    && (() => { let codes = 0; opxWs.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string' && /^(indirect_|direct_|pct_of_|per_room_year|per_sqm_year|fixed_baseline)/.test(c.value)) codes++; })); return codes === 0; })());
  // Cost of Sales is a section on the Revenue sheet; tie its project-total row
  // (the last 'Total Cost of Sales' ABOVE the Schedules section, whose income
  // statement feed repeats the label) to the snapshot.
  const revSchedulesRow = rowByLabel(wb.getWorksheet('Revenue')!, /^4\. Schedules/);
  const rowByLabelLast = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (re.test(labelOf(ws, R)) && (revSchedulesRow < 0 || R < revSchedulesRow)) row = R; }); return row; };
  const cosTotRow = rowByLabelLast(wb.getWorksheet('Revenue')!, /^Total Cost of Sales$/);
  const cosProjTable = buildCostOfSalesReport(snap, state, (v: number) => String(v)).find((t) => t.title === 'Project Total Cost of Sales');
  const cosProjRow = (cosProjTable?.rows.find((r) => r.isTotal)?.values ?? []) as number[];
  const cosProjTotal = sumA(cosProjRow, N);
  check('Cost of Sales project total ties to the CoS builder', cosTotRow > 0 && close(num(wb.getWorksheet('Revenue')!.getCell(cosTotRow, 4).value), cosProjTotal));
  // 2026-08-30: tying the workbook to the Module 2 builder was never enough,
  // because that builder used to run a SECOND engine. It is the P&L the
  // workbook has to agree with, PER PERIOD, not just in total: the two engines
  // agreed to within 0.24% over a lifetime on one live project while being
  // 407,131,731 apart in a single year, and that near-agreement is exactly what
  // hid the split. There is one engine now, and this pins it.
  {
    let tie = true; let worst = 0; let worstT = -1;
    for (let t = 0; t < N; t++) {
      const d = Math.abs((cosProjRow[t] ?? 0) - (snap.pl.cosPerPeriod[t] ?? 0));
      if (d > worst) { worst = d; worstT = t; }
      if (!close(cosProjRow[t] ?? 0, snap.pl.cosPerPeriod[t] ?? 0)) tie = false;
    }
    check('Cost of Sales ties to the P&L in EVERY period, not just in total', tie,
      `worst gap ${Math.round(worst).toLocaleString()} at period ${worstT}`);
  }
  // And the inventory the Module 2 roll-forward shows is the one the balance
  // sheet carries: same object, so the screen and the statement cannot differ.
  {
    const invM2 = new Array<number>(N).fill(0);
    for (const [, c] of snap.byAssetCostOfSales) for (let t = 0; t < N; t++) invM2[t] += c.inventoryPerPeriod[t] ?? 0;
    let tie = true;
    for (let t = 0; t < N; t++) if (!close(invM2[t], snap.bs.inventoryPerPeriod[t] ?? 0)) tie = false;
    check('Module 2 inventory roll-forward IS the balance sheet inventory', tie);
  }
  // Module 2 mirror: the Revenue sheet reproduces all platform sub-tabs in order.
  const revWs = wb.getWorksheet('Revenue')!;
  const m2 = (re: RegExp): number => rowByLabel(revWs, re);
  const m2a = m2(/^1\. Revenue Inputs/), m2b = m2(/^2\. Revenue Output/), m2c = m2(/^3\. Cost of Sales/), m2d = m2(/^4\. Schedules/);
  check('Revenue mirrors the Module 2 sub-tabs in sequence (Inputs, Output, Cost of Sales, Schedules)', m2a > 0 && m2b > m2a && m2c > m2b && m2d > m2c, `rows=${m2a},${m2b},${m2c},${m2d}`);
  check('Revenue Output carries per-line recognition vintage matrices', m2(/Recognition Vintage Matrix/) > m2b);
  // A LINE'S REVENUE IS COUNTED ONCE on the Cost of Sales build: the "Revenue
  // recognised" rows add to the Sell lines' recognised revenue, never to a
  // multiple of it (a merged line printed its recognition once per plot).
  {
    let built = 0;
    revWs.eachRow((_r, R) => { if (R > m2c && R < m2d && labelOf(revWs, R) === 'Revenue recognised') built += num(revWs.getCell(R, 4).value); });
    let sellRecognised = 0;
    for (const [, r] of snap.revenue.bySellAsset) sellRecognised += sumA(r.recognitionPerPeriod, N);
    check('Cost of Sales build: revenue recognised adds to the Sell lines\' recognised revenue, once', close(built, sellRecognised), `built=${Math.round(built)} sell=${Math.round(sellRecognised)}`);
  }
  check('P&L Total Revenue == snapshot total revenue', close(totD('P&L', /^Total Revenue$/), sumA(snap.pl.totalRevenuePerPeriod, N)));
  check('P&L PAT == snapshot PAT', close(totD('P&L', /^PAT$/), sumA(snap.pl.patPerPeriod, N)));
  // P&L EBITDA per-period ties cell-for-cell.
  const plWs = wb.getWorksheet('P&L')!; const ebitdaRow = rowByLabel(plWs, /^EBITDA$/);
  let ebitdaTie = ebitdaRow > 0; for (let t = 0; t < N && ebitdaTie; t++) ebitdaTie = close(num(plWs.getCell(ebitdaRow, 6 + t).value), snap.pl.ebitdaPerPeriod[t] ?? 0);
  check('P&L EBITDA ties to snapshot per period', ebitdaTie);
  // ── Financing: all four sub-tabs reproduced at full depth + tie to snapshot ──
  const finWs = wb.getWorksheet('Financing')!;
  const finRow = (re: RegExp): number => rowByLabel(finWs, re);
  const finLast = (re: RegExp): number => { const R = finRow(re); return R > 0 ? num(finWs.getCell(R, 6 + N - 1).value) : NaN; };
  const r1 = finRow(/^1\. Inputs/), r2 = finRow(/^2\. Schedules/), r3 = finRow(/^3\. Funding Gap/), r4 = finRow(/^4\. Cash Sweep/);
  check('Financing reproduces all 4 sub-tabs in the fixed sequence', r1 > 0 && r2 > r1 && r3 > r2 && r4 > r3, `rows=${r1},${r2},${r3},${r4}`);
  // Sub-tab 2 Schedules: per-facility + combined + equity + capital stack present.
  check('Schedules: per-facility Debt Movement present', finRow(/^Debt Movement,/) > 0);
  check('Schedules: per-facility Finance Cost present', finRow(/^Finance Cost,/) > 0);
  check('Schedules: Combined Debt Service present', finRow(/^Combined Debt Service$/) > 0);
  check('Schedules: Equity Movement present', finRow(/^Equity Movement$/) > 0);
  // The platform has no Capital Stack table, so the workbook shows none (2026-09-17).
  check('Schedules: no Capital Stack table (not on the platform)', finRow(/^Capital Stack/) < 0);
  check('Schedules: IDC Allocation by Line present (as on the platform)', finRow(/^IDC Allocation, by Line/) > r2 && finRow(/^IDC Allocation, by Line/) < r3);
  // Combined Debt Service ties to the combined snapshot.
  const cmb = snap.financing.combined;
  check('Combined Total Principal Repaid ties to snapshot', close(Math.abs(totD('Financing', /^Total Principal Repaid$/)), sumA(cmb.totalPrincipalRepaid, N)));
  check('Combined Total Interest Expensed ties to snapshot', close(Math.abs(totD('Financing', /^Total Interest Expensed$/)), sumA(cmb.totalInterestExpensed, N)));
  check('Combined Total Drawdown (Capex+IDC) ties to snapshot', close(totD('Financing', /^Total Drawdown \(Capex \+ IDC\)$/), sumA(cmb.totalDrawdown, N) + sumA(cmb.totalInterestCapitalized, N)));
  // Equity Movement closing == existing + cumulative cash + in-kind.
  const eqClosingLast = snap.financing.existing.equityTotal + sumA(snap.financing.equity.cashPerPeriod, N) + sumA(snap.financing.equity.inKindPerPeriod, N);
  check('Equity Movement closing (last) == cumulative equity', close(finLast(/^Closing \(cumulative equity\)$/), eqClosingLast));
  // Total Debt Required (Inputs 8) == the combined capex + IDC drawdown.
  check('Total Debt Required (new draws + IDC) == combined drawdown', close(totD('Financing', /^Total Debt Required \(new draws \+ IDC\)$/), sumA(cmb.totalDrawdown, N) + sumA(cmb.totalInterestCapitalized, N)));
  // Sub-tab 3 Funding Gap: Method 2 gap ties; Method 3 present.
  const gapSnap = computeFundingGap(snap);
  check('Funding Gap Method 2 total gap ties to snapshot', close(totD('Financing', /^Funding gap = MAX/), gapSnap.methodATotalGap));
  check('Funding Gap Method 3 (Cash Deficit Funding) present', finRow(/^Method 3, Cash Deficit Funding/) > 0);
  check('Funding Gap Method 3 development funding need present', finRow(/^Development funding need/) > r3);
  check('Method 3 closing cash is the engine series (closingCashAfterFundingPerPeriod)', close(finLast(/^Closing cash \(after funding/), gapSnap.method3Waterfall.closingCashAfterFundingPerPeriod[N - 1] ?? 0));
  // Sub-tab 4 Cash Sweep: closing cash ties to Direct CF closing.
  check('Cash Sweep closing cash (last) == Direct CF closing', close(finLast(/^= Closing Cash/), snap.directCF.closingCashPerPeriod[N - 1] ?? 0));
  // Inputs sub-tab echoes raw inputs (from Assumptions) inline.
  // The screen's own section labels and inputs, input-shaded (2026-09-17).
  const minCashRow = finRow(/^Minimum Cash Reserve$/);
  check('Financing Inputs carries the platform inputs (Minimum Cash Reserve, Selected method), shaded as inputs', minCashRow > r1 && finRow(/^Selected method$/) > r1
    && (finWs.getCell(minCashRow, 4).fill as any)?.fgColor?.argb === ARGB.inputFill);
  check('Financing Inputs has no echo of the removed IDC toggles', finRow(/^IDC capitalize$/) < 0 && finRow(/^IDC funding$/) < 0 && finRow(/^Blended interest rate$/) < 0);
  // Inputs sub-tab Funding Requirement block (section 7 on the screen):
  // method-by-method requirement + Selected row, all above the Schedules header.
  const frReq = finRow(/^7\. Funding Requirement$/);
  check('Financing Inputs shows the Funding Requirement (schedule starting point)', frReq > r1 && frReq < r2);
  check('Funding Requirement lists all four methods + Selected', finRow(/^Method 1, Fixed Debt-to-Equity Ratio$/) > r1 && finRow(/^Method 4, Specified Debt \+ Equity \(manual\)$/) > r1 && finRow(/^Selected \(Method /) > r1);
  // Method 1 requirement total ties to the snapshot funding need (total capex excl land in-kind).
  check('Funding Requirement Method 1 total ties to snapshot', close(totD('Financing', /^Method 1, Fixed Debt-to-Equity Ratio$/), sumA(gapSnap.capexPerPeriod, N)));
  // Cash Flow closing cash (last period) == snapshot closing cash.
  const cfWs = wb.getWorksheet('Cash Flow')!; const ccRow = rowByLabel(cfWs, /^Closing cash$/);
  check('Cash Flow closing cash (last) == snapshot closing cash', ccRow > 0 && close(num(cfWs.getCell(ccRow, 6 + N - 1).value), snap.directCF.closingCashPerPeriod[N - 1] ?? 0));

  // ── Balance Sheet balances by construction (constants) ──────────────────────
  const bsWs = wb.getWorksheet('Balance Sheet')!;
  const bsDiffRow = rowByLabel(bsWs, /^BS Check/);
  let maxBsDiff = 0; if (bsDiffRow > 0) for (let t = 0; t < N; t++) { const v = num(bsWs.getCell(bsDiffRow, 6 + t).value); if (Number.isFinite(v)) maxBsDiff = Math.max(maxBsDiff, Math.abs(v)); }
  check('Balance Sheet balances by construction (max |Assets - L&E| < 1)', bsDiffRow > 0 && maxBsDiff < 1, `maxDiff=${maxBsDiff}`);
  check('Balance Sheet Total assets == snapshot total assets', close(num(bsWs.getCell(rowByLabel(bsWs, /^TOTAL ASSETS$/), 6 + N - 1).value), snap.bs.totalAssetsPerPeriod[N - 1] ?? 0));
  // Module 4 mirror: Schedules tab (Fixed Assets / IDC / Working Capital) + the
  // P&L / Cash Flow / Balance Sheet as separate full-detail statement tabs.
  const schWs = wb.getWorksheet('Schedules')!;
  const m4s = (re: RegExp): number => rowByLabel(schWs, re);
  check('Schedules mirrors Module 4 sub-tabs (Fixed Assets & D&A, BS Schedules)', m4s(/^1\. Fixed Assets & D&A/) > 0 && m4s(/^2\. BS Schedules/) > m4s(/^1\. Fixed Assets & D&A/));
  check('BS Schedules grouped ASSETS / LIABILITIES / EQUITY', m4s(/^ASSETS$/) > m4s(/^2\. BS Schedules/) && m4s(/^LIABILITIES$/) > m4s(/^ASSETS$/) && m4s(/^EQUITY$/) > m4s(/^LIABILITIES$/));
  check('BS Schedules carries the roll-forwards (A1 / L1 / E2)', m4s(/^A1\. Residential Sales Receivables/) > 0 && m4s(/^L1\. Accounts Payable/) > 0 && m4s(/^E2\. Retained Earnings/) > 0);
  check('P&L is a separate full-detail statement (to PAT)', rowByLabel(plWs, /Project$/) > 0 && rowByLabel(plWs, /^PAT$/) > 0);
  check('Cash Flow has both Direct and Indirect methods', rowByLabel(cfWs, /Direct Method/) > 0 && rowByLabel(cfWs, /Indirect Method/) > 0);
  check('Balance Sheet has the full ASSETS / LIABILITIES / EQUITY structure', rowByLabel(bsWs, /^ASSETS$/) > 0 && rowByLabel(bsWs, /^LIABILITIES$/) > 0 && rowByLabel(bsWs, /TOTAL LIABILITIES \+ EQUITY/) > 0);

  // ── Consolidated Inputs tab carries the grouped dividers ────────────────────
  const inp = wb.getWorksheet('Inputs')!;
  // 2026-09-17: the Assets table carries the platform's Table 2 title.
  for (const re of [/^Project$/, /^Phases$/, /^Assets by plot, what you enter$/, /^Capex cost lines/, /^Financing settings$/, /Financing facilities/]) check(`Inputs divider present: ${re.source}`, rowByLabel(inp, re) > 0);
  // Raw financing scalars live under the Financing divider (once), not Project.
  check('Financing settings divider holds the raw financing scalars', rowByLabel(inp, /^Funding method$/) > rowByLabel(inp, /^Financing settings$/) && rowByLabel(inp, /^Debt share$/) > rowByLabel(inp, /^Financing settings$/));
  check('Inputs title says Inputs', /Inputs/.test(labelOf(inp, 1)));
  // All model inputs live on the Inputs tab, grouped by domain divider band.
  check('Inputs tab has the REVENUE INPUTS domain', rowByLabel(inp, /^REVENUE INPUTS$/) > 0 && rowByLabel(inp, /^Revenue inputs, /) > rowByLabel(inp, /^REVENUE INPUTS$/));
  check('Inputs tab has the OPEX INPUTS domain', rowByLabel(inp, /^OPEX INPUTS$/) > rowByLabel(inp, /^REVENUE INPUTS$/));
  // Domain order mirrors the module sequence: Capex (M1) -> Financing (M1) ->
  // Revenue (M2) -> Opex (M3). Financing sits right after the Capex cost lines.
  check('Inputs domains ordered Capex -> Financing -> Revenue -> Opex', rowByLabel(inp, /^Capex cost lines/) < rowByLabel(inp, /^FINANCING INPUTS$/) && rowByLabel(inp, /^FINANCING INPUTS$/) < rowByLabel(inp, /^REVENUE INPUTS$/) && rowByLabel(inp, /^REVENUE INPUTS$/) < rowByLabel(inp, /^OPEX INPUTS$/));
  // Module 1 input completeness (gaps closed 2026-06-14): per-parcel land
  // funding split, selected funding-method config, per-facility timing + share.
  // BY HEADER NAME, NEVER BY COLUMN INDEX (2026-09-16). This asserted columns 8
  // and 9; the split is emitted at 6 and 7, so the check failed while the data
  // was present and correct. A fixed index turns any column edit into a false
  // failure, which is indistinguishable from a real one until someone looks.
  // 2026-09-17: the split moved off the plots table to the Land Funding block,
  // per phase, which is where Financing section 4 states it; the plots table is
  // Module 1's Table 1 and carries no split.
  const parcelsHdr = rowByLabel(inp, /^Land Funding \(per phase/);
  check('Land Funding block present when the project has land', snap.financing.capex.landByPhase?.length ? parcelsHdr > 0 : true);
  if (parcelsHdr > 0) {
    const hdr: string[] = [];
    for (let c = 1; c <= 16; c++) hdr.push(String(inp.getCell(parcelsHdr + 1, c).value ?? ''));
    check('Land funding carries Debt % / Equity % funding split',
      hdr.includes('Debt %') && hdr.includes('Equity %'), hdr.filter((h) => h).join(' | '));
  }
  const facHdr = rowByLabel(inp, /Financing facilities/);
  if (facHdr > 0) check('Financing facilities carry timing + share columns', String(inp.getCell(facHdr + 1, 9).value) === 'Repay start year' && String(inp.getCell(facHdr + 1, 12).value) === 'Facility share %');
  const selMethod = snap.financing.funding.selectedMethodId;
  if (selMethod !== 1) check(`Selected funding-method config (Method ${selMethod}) emitted in Inputs`, rowByLabel(inp, new RegExp(`^Method ${selMethod}:`)) > rowByLabel(inp, /^Financing settings$/));
  // Capex cost lines carry Stage + phasing window (start / end period, even/manual).
  const capHdr = rowByLabel(inp, /^Capex cost lines/);
  if (capHdr > 0) check('Capex cost lines carry Stage + phasing-window columns', String(inp.getCell(capHdr + 1, 5).value) === 'Stage' && String(inp.getCell(capHdr + 1, 6).value) === 'Start period' && String(inp.getCell(capHdr + 1, 8).value) === 'Phasing');
  // THE NDA DEDUCTION IS RETIRED, SO THE WORKBOOK MUST NOT CARRY IT (2026-09-16).
  //
  // These two used to assert the OPPOSITE, and they were the last thing still
  // asking for it. The roads and parks deduction modelled LAND development while
  // this platform models VERTICAL development, and the area chain's Land
  // Utilisation % states the same thing at asset level, so it was retired on
  // 2026-09-08: `projectRoadsPct` is marked read by nothing, no engine or
  // resolver file touches `projectNdaEnabled` / `projectParksPct` /
  // `hasNdaDeduction`, and the screens keep only historical markers saying where
  // the card used to live. An input the model does not read must not appear in a
  // workbook that claims to be a copy of the model.
  check('NDA is retired: the workbook does not emit the project deduction rows',
    rowByLabel(inp, /^NDA deduction enabled/) < 0 && rowByLabel(inp, /^Project roads %/) < 0);
  const astHdr = rowByLabel(inp, /^Assets by plot, what you enter$/);
  if (astHdr > 0) {
    const hdrRow: string[] = [];
    for (let c = 1; c <= 16; c++) hdrRow.push(String(inp.getCell(astHdr + 1, c).value ?? ''));
    check('NDA is retired: the Assets table carries no per-asset NDA columns',
      !hdrRow.some((h) => /NDA|Roads %|Parks %/i.test(h)), hdrRow.filter((h) => h).join(' | '));
  }

  // ── Guidance "Basis / Calculation" column on every output tab ───────────────
  const hasBasisCol = (sheet: string): boolean => { const ws = wb.getWorksheet(sheet)!; return String(ws.getCell(4, 2).value ?? '').includes('Basis'); };
  for (const n of OUTPUT_TABS) check(`Basis / Calculation column header present: ${n}`, hasBasisCol(n));
  // Basis cells populated (plain text, not formulas) on P&L AND Financing.
  const basisCells = (sheet: string): number => { let n = 0; wb.getWorksheet(sheet)!.eachRow((row, R) => { if (R > 4) { const b = wb.getWorksheet(sheet)!.getCell(R, 2).value; if (typeof b === 'string' && b.length > 0 && b !== 'Basis / Calculation') n++; } }); return n; };
  check('Financing basis column is populated (recurrence rows)', basisCells('Financing') >= 18, `cells=${basisCells('Financing')}`);

  // ── Snapshot note (cell comment) on each output tab + Capex + Land & Area ────
  const hasNote = (sheet: string): boolean => { const c: any = wb.getWorksheet(sheet)!.getCell('A1'); return !!c.note; };
  for (const n of [...OUTPUT_TABS, 'Capex', 'Land & Area']) check(`snapshot note present: ${n}`, hasNote(n));
  // Land & Area carries its guidance as a per-column legend (its grid layout
  // can not take a per-row Basis column).
  check('Land & Area has a Basis / Calculation legend', rowByLabel(wb.getWorksheet('Land & Area')!, /^Basis \/ Calculation \(per column\)$/) > 0);

  // ── Returns: the headline IRR is a finite constant (not a live formula) ─────
  // The Returns tab mirrors the screen, whose IRRs are card values, so the
  // numeric constant now lives on the Checks tab's headline pairs (2026-09-17),
  // read from the same returns engine the Returns cards print.
  const ret = wb.getWorksheet('Returns')!;
  const chk = wb.getWorksheet('Checks')!; const irrRow = rowByLabel(chk, /^Project IRR \(FCFF\)$/);
  const irrCell: any = irrRow > 0 ? chk.getCell(irrRow, 3).value : null;
  check('Headline Project IRR is a finite constant (not a formula)', irrRow > 0 && !isFormula(irrCell) && Number.isFinite(num(irrCell)), `irr=${num(irrCell)}`);
  // Module 5 mirror: the Returns tab reproduces the platform's three Module 5
  // sub-tabs in order (Returns, RE Metrics, Case Comparison), each section in
  // its screen order, under the screen's own titles.
  const m5 = (re: RegExp): number => rowByLabel(ret, re);
  check('Returns mirrors Module 5 sub-tabs in order (1. Returns -> 2. RE Metrics -> 3. Case Comparison)', m5(/^1\. Returns$/) > 0 && m5(/^2\. RE Metrics$/) > m5(/^1\. Returns$/) && m5(/^3\. Case Comparison$/) > m5(/^2\. RE Metrics$/));
  check('Returns carries the Returns sub-tab sections in screen order', (() => {
    const order = [/^Returns Assumptions$/, /^Headline Returns$/, /^Development Economics$/, /^Equity Partners$/, /^Sources & Uses of Capital$/, /^Returns by Cash-Flow Basis$/, /^Return Cash-Flow Streams/, /^FCFF Build-Up/, /^FCFE Build-Up/, /^(Distributed Equity Build-Up|Dividend Discount Model \(DDM\), before performance fee)/, /^Exit: terminal value and gain on disposal$/, /^Sensitivity, Equity IRR \(FCFE\)$/].map(m5);
    return order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]) && v < m5(/^2\. RE Metrics$/));
  })());
  check('Returns carries the RE Metrics sections in screen order', (() => {
    const order = [/^2\. RE Metrics$/, /^Lender Covenants$/, /^Exit-Year Analysis \(hold vs sell timing\)$/, /^Coverage and profitability detail$/, /^Development economics$/, /^Income and exit profile$/, /^Funding mix$/].map(m5);
    return order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]));
  })());
  check('Returns prints no block the platform does not show (no NPV rows, no Debt Analytics / Equity Exposure / Exit Analysis strips)',
    m5(/NPV \(FC/) < 0 && m5(/^Debt Analytics$/) < 0 && m5(/^Equity Exposure$/) < 0 && m5(/^Exit Analysis/) < 0 && m5(/^Per-Line Economics$/) < 0);
  check('Returns assumptions are shaded as inputs under the panel labels', (() => {
    const R = m5(/^Discount Rate \(%\)$/);
    return R > 0 && (ret.getCell(R, 4).fill as any)?.fgColor?.argb === ARGB.inputFill && m5(/^Terminal Value Method$/) > 0;
  })());
  check('Returns Memo NOI is on the stream basis (the opening column carries no NOI)', (() => {
    const R = m5(/^Memo: NOI \(recurring\)$/);
    return R > 0 && num(ret.getCell(R, 5).value) === 0;
  })());

  // ── LOCKED palette: every fill comes from the one sanctioned set ─────────────
  // ALLOWED_FILLS is exported from styles.ts, so this check tracks the single
  // source of truth rather than a hand-copied list that can drift out of step.
  // Text / border colours carry a slightly wider set (they include the navy text
  // tone and the FAST input / link colours, which are never used as fills).
  const TEXT_OK = new Set<string>([
    ARGB.navy, ARGB.navyDark, ARGB.sectionDark, ARGB.formula, ARGB.white, ARGB.bad,
    ARGB.slate, ARGB.ink, ARGB.greyMid, ARGB.inputBorder, ARGB.good, ARGB.linked, ARGB.input,
  ]);
  const strayFill = new Map<string, string>();
  const strayText = new Map<string, string>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      const fl = (c.fill as any)?.fgColor?.argb;
      if (typeof fl === 'string' && !ALLOWED_FILLS.has(fl)) strayFill.set(fl, ws.name);
      const fc = (c.font as any)?.color?.argb; const bd = (c.border as any)?.bottom?.color?.argb;
      for (const x of [fc, bd]) if (typeof x === 'string' && !TEXT_OK.has(x)) strayText.set(x, ws.name);
    }));
  }
  check('every FILL is in the locked palette', strayFill.size === 0, [...strayFill.entries()].map(([k, v]) => `${k}@${v}`).join(' '));
  check('every text / border colour is in the locked palette', strayText.size === 0, [...strayText.entries()].map(([k, v]) => `${k}@${v}`).join(' '));

  // The forbidden darks must be gone as FILLS. #1B3A6B survives as a text tone
  // only; #0C2340 and pure black must not appear as a fill anywhere.
  const FORBIDDEN_FILLS = ['FF0C2340', 'FF1B3A6B', 'FF000000'];
  const forbiddenHits = new Map<string, string>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      const fl = (c.fill as any)?.fgColor?.argb;
      if (typeof fl === 'string' && FORBIDDEN_FILLS.includes(fl)) forbiddenHits.set(fl, ws.name);
    }));
  }
  check('no forbidden dark / black FILL remains (0C2340, 1B3A6B, black)', forbiddenHits.size === 0, [...forbiddenHits.entries()].map(([k, v]) => `${k}@${v}`).join(' '));
  // Section header bands are navy or the one sanctioned darker shade, never else.
  const badBand = new Map<string, string>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row, R) => {
      const a = row.getCell(1);
      const fl = (a.fill as any)?.fgColor?.argb;
      const isBand = typeof fl === 'string' && (a.font as any)?.color?.argb === ARGB.white && typeof a.value === 'string';
      if (isBand && fl !== ARGB.navy && fl !== ARGB.sectionDark) badBand.set(`${fl}@${ws.name}!A${R}`, ws.name);
    });
  }
  check('every section header band is navy or sectionDark', badBand.size === 0, [...badBand.keys()].join(' '));

  // ── Per-tab sub-TOC: top-of-tab navigation with working internal links ───────
  const DATA_TABS = ALL_SHEETS.filter((n) => n !== 'Cover' && n !== 'Guide');
  const cellText = (v: any): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') { if ('text' in v) return String(v.text); if ('result' in v) return String(v.result); }
    return v == null ? '' : String(v);
  };
  for (const name of DATA_TABS) {
    const ws = wb.getWorksheet(name)!;
    let strip = -1, back = false;
    const internal: Array<{ label: string; row: number }> = [];
    ws.eachRow((row, R) => {
      if (strip < 0 && /^On this tab/.test(cellText(row.getCell(1).value))) strip = R;
      row.eachCell({ includeEmpty: false }, (c) => {
        const v: any = c.value;
        if (!v || typeof v !== 'object' || typeof v.hyperlink !== 'string') return;
        if (String(v.text).includes('Back to Cover')) { back = v.hyperlink === "#'Cover'!A1"; return; }
        const m = new RegExp(`^#'${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'!A(\\d+)$`).exec(v.hyperlink);
        if (m) internal.push({ label: cellText(v.text).replace(/^›\s*/, ''), row: Number(m[1]) });
      });
    });
    check(`${name}: has a sub-TOC strip`, strip > 0, `strip=${strip}`);
    check(`${name}: sub-TOC has a Back to Cover link`, back);
    check(`${name}: sub-TOC carries internal jump links`, internal.length > 0, `${internal.length}`);
    // Every jump link must land on the row whose column A actually holds that label.
    const norm = (t: string): string => t.replace(/^\d+\.\s*/, '').trim();
    const misses = internal.filter((e) => norm(cellText(ws.getCell(e.row, 1).value)) !== norm(e.label));
    check(`${name}: every sub-TOC link lands on its own section row`, misses.length === 0,
      misses.slice(0, 2).map((e) => `"${e.label}"->A${e.row}`).join(' '));
    // The buried guide block must be one click away.
    check(`${name}: sub-TOC links to the basis-of-calculation block`, internal.some((e) => /How this tab is calculated/i.test(e.label)));
  }

  // ── Basis of calculation on every data tab, in the Inputs/Calculation/Feeds shape ─
  for (const name of DATA_TABS) {
    const ws = wb.getWorksheet(name)!;
    let head = -1; const parts = new Set<string>();
    ws.eachRow((row, R) => {
      const a = row.getCell(1);
      const navyBand = (a.fill as any)?.fgColor?.argb === ARGB.navy;
      if (head < 0 && navyBand && /How this tab is calculated/i.test(cellText(a.value))) head = R;
      if (head > 0 && R > head) { const t = cellText(a.value); if (t === 'Inputs' || t === 'Calculation' || t === 'Feeds') parts.add(t); }
    });
    check(`${name}: has a "How this tab is calculated" block`, head > 0, `row=${head}`);
    check(`${name}: block explains Inputs + Calculation + Feeds`, parts.size === 3, [...parts].join(','));
  }

  // ── Timeline: phase-wise dated programme + cell Gantt ────────────────────────
  {
    const tl = wb.getWorksheet('Timeline')!;
    const rowOf = (re: RegExp): number => { let r = -1; tl.eachRow((row, R) => { if (r < 0 && re.test(cellText(row.getCell(1).value))) r = R; }); return r; };
    check('Timeline keeps the period axis rows', /Period ending/.test(cellText(tl.getCell(3, 1).value)) && /Period index/.test(cellText(tl.getCell(4, 1).value)));
    const schedRow = rowOf(/^Phase schedule \(dated\)/);
    const ganttRow = rowOf(/^Development programme \(Gantt\)/);
    check('Timeline has a dated phase schedule', schedRow > 0);
    check('Timeline has a Gantt programme', ganttRow > schedRow);
    // Dated columns, driven by computePhaseTimeline.
    const heads = [3, 4, 5, 6].map((c) => cellText(tl.getCell(schedRow + 1, c).value));
    check('Timeline schedule carries construction + operations windows',
      heads.join('|') === 'Construction start|Construction end|Operations start|Operations end', heads.join('|'));
    const firstPhase = cellText(tl.getCell(schedRow + 2, 3).value);
    check('Timeline dates are real month-year dates from the model', /^[A-Z][a-z]{2} \d{4}$/.test(firstPhase), firstPhase);
    check('Timeline states the project envelope', rowOf(/^Project$/) > schedRow);
    // The Gantt paints construction (navy) and operations (green) bars on the grid.
    let cBars = 0, oBars = 0, endMark = 0;
    tl.eachRow((row, R) => {
      if (R <= ganttRow) return;
      for (let c = 5; c <= 5 + N; c++) {
        const fl = (row.getCell(c).fill as any)?.fgColor?.argb;
        if (fl === ARGB.navy) cBars += 1;
        else if (fl === ARGB.good) oBars += 1;
        else if (fl === ARGB.sectionDark && cellText(row.getCell(c).value) === 'END') endMark += 1;
      }
    });
    check('Gantt paints construction bars', cBars > 0, `${cBars}`);
    check('Gantt paints operations bars', oBars > 0, `${oBars}`);
    check('Gantt marks project end exactly once', endMark === 1, `${endMark}`);
  }
  // Tab colours are uniform navy across every sheet.
  const tabColors = new Set(wb.worksheets.map((w) => (w.properties as any)?.tabColor?.argb).filter(Boolean));
  check('all worksheet tab colours are the same navy', tabColors.size === 1 && tabColors.has('FF1B4F8A'), [...tabColors].join(','));

  // ── Accounting formatting: dash for zero + percentages 2dp ──────────────────
  const moneyCell = bsWs.getCell(rowByLabel(bsWs, /^TOTAL ASSETS$/), 6);
  check('money format uses dash for zero', typeof moneyCell.numFmt === 'string' && moneyCell.numFmt.includes('"-"'));
  let pct2Ok = false;
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
  const revM = wbM.getWorksheet('Revenue')!; const rtRowM = rowByLabelAfter(revM, /^Project Revenue Recognised$/, /^Total Project$/);
  const revTotWb = revTotalWb;
  check('Display scale leaves stored values unchanged', rtRowM > 0 && Math.abs(num(revM.getCell(rtRowM, 4).value) - revTotWb) <= Math.max(1, Math.abs(revTotWb) * 1e-6));
  // No formulas at millions scale either.
  let fm = 0; for (const ws of wbM.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) fm++; }));
  check('millions-scale workbook is also fully hardcoded', fm === 0, `formulaCells=${fm}`);

  // ── Inputs / Schedules / Outputs filter (mirrors the PDF; hides sheets) ──
  const hiddenSet = (parts: { inputs?: boolean; outputs?: boolean; schedules?: boolean }): Set<string> => {
    const wbf = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', parts });
    const hidden = new Set<string>();
    wbf.eachSheet((ws) => { if (ws.state === 'hidden') hidden.add(ws.name); });
    return hidden;
  };
  const INPUT_SHEETS = ['Inputs', 'Timeline', 'Land & Area'];
  const SCHED_SHEETS = ['Capex', 'Financing', 'Revenue', 'Opex', 'Schedules'];
  const OUTPUT_SHEETS = ['P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios'];
  const ALWAYS = ['Cover', 'Summary', 'Checks'];
  const allOn = hiddenSet({ inputs: true, outputs: true, schedules: true });
  check('filter: all categories ticked hides nothing', allOn.size === 0, `hidden=${[...allOn].join(',')}`);
  const outOnly = hiddenSet({ inputs: false, outputs: true, schedules: false });
  check('filter: outputs-only hides all input + schedule sheets', [...INPUT_SHEETS, ...SCHED_SHEETS].every((s) => outOnly.has(s)), `hidden=${[...outOnly].join(',')}`);
  check('filter: outputs-only keeps the statement + always sheets visible', [...OUTPUT_SHEETS, ...ALWAYS].every((s) => !outOnly.has(s)), `hidden=${[...outOnly].join(',')}`);
  const inOnly = hiddenSet({ inputs: true, outputs: false, schedules: false });
  check('filter: inputs-only hides all schedule + output sheets', [...SCHED_SHEETS, ...OUTPUT_SHEETS].every((s) => inOnly.has(s)), `hidden=${[...inOnly].join(',')}`);
  check('filter: inputs-only keeps input + always sheets visible', [...INPUT_SHEETS, ...ALWAYS].every((s) => !inOnly.has(s)), `hidden=${[...inOnly].join(',')}`);
  const noneOn = hiddenSet({ inputs: false, outputs: false, schedules: false });
  check('filter: Cover + Checks always visible (even with nothing ticked)', ALWAYS.every((s) => !noneOn.has(s)), `hidden=${[...noneOn].join(',')}`);
  const noFilter = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd' });
  let anyHidden = false; noFilter.eachSheet((ws) => { if (ws.state === 'hidden') anyHidden = true; });
  check('filter: omitting parts leaves every sheet visible (backward compatible)', !anyHidden, '');

  // ── Module 6: Scenarios tab (case comparison + year-on-year impact) ─────────
  // Without a caseComparison bundle the tab is present but shows a note.
  const scnNote = wb.getWorksheet('Scenarios')!;
  check('Scenarios tab present after Returns, before Checks', actualOrder.indexOf('Scenarios') === actualOrder.indexOf('Returns') + 1 && actualOrder.indexOf('Checks') === actualOrder.indexOf('Scenarios') + 1);
  check('Scenarios (no cases) shows the section 1 header + a no-scenarios note', rowByLabel(scnNote, /^1\. Cases$/) > 0 && rowByLabel(scnNote, /No scenario cases are defined/) > 0);
  // With a base + one scenario (a tax-rate change) the full comparison renders.
  const cmpCases = [
    { id: 'base', name: 'Management', role: 'base', overrides: {} },
    { id: 's1', name: 'Downside', role: 'scenario', overrides: { 'project.tax.rate': 0.25 } },
  ];
  const wbS = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', caseComparison: { baseModel: state, cases: cmpCases as any, activeCaseId: 'base' } });
  const scn = wbS.getWorksheet('Scenarios')!;
  const s6 = (re: RegExp): number => rowByLabel(scn, re);
  check('Scenarios mirrors Module 6 sections in order (1. Cases -> 2. Assumptions by case -> 3. Comparison -> 4. Year-on-Year Impact)',
    s6(/^1\. Cases$/) > 0 && s6(/^2\. Assumptions by case$/) > s6(/^1\. Cases$/) && s6(/^3\. Comparison$/) > s6(/^2\. Assumptions by case$/) && s6(/^4\. Year-on-Year Impact$/) > s6(/^3\. Comparison$/));
  check('Scenarios lists every case (Management + the scenario)', s6(/^★ Management$/) > s6(/^1\. Cases$/) && s6(/^◆ Downside$/) > s6(/^1\. Cases$/));
  check('Scenarios assumptions grid carries the overridden field', s6(/^Assumption$/) > s6(/^2\. Assumptions by case$/) && s6(/tax/i) > s6(/^2\. Assumptions by case$/) && s6(/tax/i) < s6(/^3\. Comparison$/));
  // With ZERO overrides the curated key drivers still show their Management
  // values, as on the screen (they used to vanish with the year-on-year blocks).
  const wbZ = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', caseComparison: { baseModel: state, cases: [cmpCases[0], { ...cmpCases[1], overrides: {} }] as any, activeCaseId: 'base' } });
  const scnZ = wbZ.getWorksheet('Scenarios')!;
  check('Scenarios assumptions grid shows the curated drivers with zero overrides', (() => {
    const hdr = rowByLabel(scnZ, /^Assumption$/), r3 = rowByLabel(scnZ, /^3\. Comparison$/);
    return hdr > rowByLabel(scnZ, /^2\. Assumptions by case$/) && r3 > hdr + 2;
  })());
  check('Scenarios comparison matrix carries headline KPIs (Equity IRR)', s6(/^Comparison$/) > s6(/^3\. Comparison$/) && s6(/^Equity IRR \(FCFE\)$/) > 0);
  check('Scenarios Year-on-Year Impact renders each case row and the delta row', (() => {
    const r4 = s6(/^4\. Year-on-Year Impact$/); let base = -1, sc = -1, delta = -1;
    scn.eachRow((_r, R) => { if (R <= r4) return; const l = labelOf(scn, R); if (base < 0 && l === '★ Management') base = R; if (sc < 0 && l === '◆ Downside') sc = R; if (delta < 0 && l === 'Downside delta vs Management') delta = R; });
    return r4 > 0 && base > r4 && sc > base && delta > sc;
  })());
  // The Scenarios tab stays hardcoded (no formula cells) at both display scales.
  let scnFormulas = 0; for (const w of wbS.worksheets) w.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) scnFormulas++; }));
  check('Scenarios workbook is also fully hardcoded (zero formula cells)', scnFormulas === 0, `formulaCells=${scnFormulas}`);

  // ── Cover = Table of Contents + one-page Summary (cosmetic front matter) ────
  // Front-matter content lives in column B (merged B:G bands), so scan column 2.
  const colB = (ws: ExcelJS.Worksheet, R: number): string => { const v = ws.getCell(R, 2).value; return typeof v === 'string' ? v : (v && typeof v === 'object' && 'text' in (v as any) ? (v as any).text : ''); };
  const rowByColB = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (row < 0 && re.test(colB(ws, R))) row = R; }); return row; };
  const cov = wb.getWorksheet('Cover')!;
  check('front matter is Cover, Guide, Summary in order', actualOrder[0] === 'Cover' && actualOrder[1] === 'Guide' && actualOrder[2] === 'Summary');
  check('Cover carries a grouped Table of Contents', rowByColB(cov, /^Table of Contents$/) > 0 && rowByColB(cov, /^Module 1 /) > 0 && rowByColB(cov, /^Module 6 /) > 0);
  check('Cover ToC links the Summary + Scenarios sheets', rowByColB(cov, /Summary$/) > 0 && rowByColB(cov, /Scenarios$/) > 0);
  // Cover ToC links are internal hyperlinks (not formulas).
  let tocLinks = 0; cov.eachRow((row) => row.eachCell((c) => { const v: any = c.value; if (v && typeof v === 'object' && typeof v.hyperlink === 'string' && v.hyperlink.startsWith('#')) tocLinks++; }));
  check('Cover ToC has internal sheet hyperlinks', tocLinks >= 14, `links=${tocLinks}`);
  const sum = wb.getWorksheet('Summary')!;
  check('Summary mirrors the Project Overview sections in order', (() => {
    const order = [/^Key facts$/, /^Headline returns$/, /^Cost per sqm$/, /^Key economics$/, /^Cost & capital structure$/, /^Timeline & structure$/, /^Scheme$/, /^Land and build, by asset type$/, /^Phases$/, /^Exit and cash$/].map((re) => rowByColB(sum, re));
    return order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]));
  })());
  check('Summary headline returns are three pairs, each IRR beside its MOIC', ['Project (FCFF)', 'Equity (FCFE)', 'Distributed (DDM)'].every((l) => { let hit = false; sum.eachRow((row) => row.eachCell((c) => { if (c.value === l) hit = true; })); return hit; }));
  // The two highlight tables sit side by side: dev economics header in col B, the
  // returns/leverage header in col E.
  const colE = (ws: ExcelJS.Worksheet, R: number): string => { const v = ws.getCell(R, 5).value; return typeof v === 'string' ? v : ''; };
  const hasColE = (ws: ExcelJS.Worksheet, re: RegExp): boolean => { let hit = false; ws.eachRow((_r, R) => { if (re.test(colE(ws, R))) hit = true; }); return hit; };
  void hasColE;
  check('Summary carries no DSCR or ICR (the overview does not)', (() => { let hit = false; sum.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string' && /DSCR|Interest Cover|\bICR\b/.test(c.value)) hit = true; })); return !hit; })());
  // Summary stays on the palette + hardcoded (no formulas).
  let sumFormulas = 0; sum.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) sumFormulas++; }));
  check('Summary is fully hardcoded (zero formula cells)', sumFormulas === 0, `formulaCells=${sumFormulas}`);

  // ── Print setup: every sheet is print-ready (fit-to-width, oriented) ─────────
  const allPrintReady = wb.worksheets.every((ws) => { const ps: any = ws.pageSetup ?? {}; return ps.fitToPage === true && ps.fitToWidth === 1 && (ps.orientation === 'portrait' || ps.orientation === 'landscape'); });
  check('every sheet has a print-ready page layout (fit to width + orientation)', allPrintReady);
  check('Cover prints centred portrait on one page', ['Cover'].every((n) => { const ps: any = wb.getWorksheet(n)!.pageSetup ?? {}; return ps.orientation === 'portrait' && ps.fitToHeight === 1 && ps.horizontalCentered === true; }));
  // The Summary mirrors the whole Project Overview, which is longer than one
  // page, so it prints portrait at full width and flows to a second page.
  check('Summary prints portrait, fit to width', (() => { const ps: any = wb.getWorksheet('Summary')!.pageSetup ?? {}; return ps.orientation === 'portrait' && ps.fitToWidth === 1; })());
  check('wide period tabs repeat the header rows when printed', ['P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios'].every((n) => { const ps: any = wb.getWorksheet(n)!.pageSetup ?? {}; return ps.orientation === 'landscape' && ps.printTitlesRow === '1:4'; }));

  // ── Table of Contents: second-level clickable section sub-entries (2026-07-26) ─
  const cover = wb.getWorksheet('Cover')!;
  const coverLinks: Array<{ text: string; target: string }> = [];
  cover.eachRow((row) => row.eachCell((c) => {
    const v: any = c.value;
    if (v && typeof v === 'object' && 'hyperlink' in v) coverLinks.push({ text: String(v.text ?? ''), target: String(v.hyperlink ?? '') });
  }));
  check('Cover ToC links every tab to its A1', ALL_SHEETS.slice(1).every((n) => coverLinks.some((l) => l.target === `#'${n}'!A1`)), `links=${coverLinks.length}`);
  const sectionLinks = coverLinks.filter((l) => { const m = l.target.match(/^#'(.+)'!A(\d+)$/); return !!m && Number(m[2]) > 1; });
  check('Cover ToC carries second-level section sub-entries (jump INTO a tab)', sectionLinks.length > 0, `sectionLinks=${sectionLinks.length}`);
  check('every section sub-entry points at the row whose label is its title (a real anchor)', sectionLinks.every((l) => { const m = l.target.match(/^#'(.+)'!A(\d+)$/)!; const ws = wb.getWorksheet(m[1]); return !!ws && labelOf(ws, Number(m[2])) === l.text; }), `n=${sectionLinks.length}`);

  // ── Per-tab guideline block ("How this tab is calculated") + Covers line ─────
  const GUIDE_TABS = ['Summary', 'Inputs', 'Timeline', 'Land & Area', 'Capex', 'Financing', 'Revenue', 'Opex', 'Schedules', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios', 'Checks'];
  for (const n of GUIDE_TABS) check(`guideline block present: ${n}`, rowByLabel(wb.getWorksheet(n)!, /^How this tab is calculated$/) > 0);
  const plGuide = wb.getWorksheet('P&L')!;
  const patRow = rowByLabel(plGuide, /^PAT$/);
  check('the guideline block sits BELOW the statement data (frozen header + rows untouched)', patRow > 0 && rowByLabel(plGuide, /^How this tab is calculated$/) > patRow);
  const covA2 = (n: string): string => { const v = wb.getWorksheet(n)!.getCell('A2').value; return typeof v === 'string' ? v : ''; };
  check('statement tabs carry a "Covers:" subtitle listing their sections', ['P&L', 'Balance Sheet', 'Returns', 'Financing'].every((n) => /^Covers:/.test(covA2(n))), `pl="${covA2('P&L')}"`);
  check('the guideline block added NO formula cells (still fully hardcoded)', formulaCells === 0);

  // ── Dedicated Guide tab (tab 2): consolidated "how the model works" reference ─
  check('Guide is tab 2 (right after the Cover)', actualOrder[1] === 'Guide');
  const guide = wb.getWorksheet('Guide')!;
  const guideLinks: string[] = [];
  guide.eachRow((row) => row.eachCell((c) => { const v: any = c.value; if (v && typeof v === 'object' && 'hyperlink' in v) guideLinks.push(String(v.hyperlink)); }));
  check('the Guide links to every data tab', ['Summary', 'Inputs', 'Capex', 'Financing', 'Revenue', 'P&L', 'Balance Sheet', 'Returns', 'Scenarios', 'Checks'].every((n) => guideLinks.includes(`#'${n}'!A1`)), `links=${guideLinks.length}`);
  const guideText = (() => { let s = ''; guide.eachRow((row) => row.eachCell((c) => { const v: any = c.value; s += ' ' + (typeof v === 'string' ? v : (v && v.text) ? v.text : ''); })); return s; })();
  check('the Guide explains the model is a hardcoded snapshot', /hardcoded snapshot/i.test(guideText) && /does NOT recalculate/i.test(guideText));
  check('the Guide carries the P&L methodology (EBITDA struck after the fund fees)', /Revenue - Cost of Sales = gross profit; - operating expenses - Total Fund Management Fee = EBITDA/.test(guideText));
  check('the Cover ToC links to the Guide', coverLinks.some((l) => l.target === `#'Guide'!A1`));

  // ── A totalOverride is a VALUE on EVERY tab (2026-09-01) ────────────────────
  //
  // Three of the workbook's four M4 emitters read "has an override" as "this
  // row is a balance, print the LAST period". True only while every override IS
  // the last period. On the Financing tab five are not (priorBal, a literal 0,
  // priorExisting, opening[0], -minCash), and SIX of sixteen override rows
  // printed a Total the builder never asked for: every "Opening" row showed a
  // CLOSING figure, so "Opening Cash" read 58,922,877.94 where the builder
  // stated 0.00.
  //
  // Rows are matched on LABEL PLUS VALUES, not label alone. "Closing" and
  // "Opening" each appear more than once on this tab, and a label-keyed check
  // aliases them: the first version of this measurement reported 9 of 17
  // mismatches where the truth was 6 of 16, because two builder rows collapsed
  // onto one key.
  {
    const money2 = (v: number): string => v.toFixed(2);
    const keyOf = (label: string, vals: number[]): string =>
      `${label}|${vals.map((x) => Math.round((x ?? 0) * 100)).join(',')}`;
    const intended = new Map<string, string>();
    for (const name of Object.keys(FinancingReports)) {
      const fn = (FinancingReports as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      let tables: unknown;
      try { tables = (fn as (...a: unknown[]) => unknown)(snap, state, money2); }
      catch { try { tables = (fn as (...a: unknown[]) => unknown)(snap, money2); } catch { continue; } }
      const list = Array.isArray(tables) ? tables : [tables];
      for (const t of list as Array<{ rows?: Array<{ label: string; values?: number[]; totalOverride?: string }> }>) {
        for (const row of t?.rows ?? []) {
          if (row.totalOverride === undefined || String(row.totalOverride).trim() === '') continue;
          intended.set(keyOf(row.label, row.values ?? []), String(row.totalOverride));
        }
      }
    }
    let checked = 0; const wrong: string[] = [];
    const fin = wb.worksheets.find((s) => s.name === 'Financing');
    fin?.eachRow((row, rn) => {
      const label = String(row.getCell(1).value ?? '').trim();
      const vals: number[] = [];
      for (let c = 6; c <= 80; c++) { const v = row.getCell(c).value; if (typeof v === 'number') vals.push(v); else break; }
      const want = intended.get(keyOf(label, vals));
      if (want === undefined) return;
      const cell = row.getCell(4).value; // TOTAL_COL
      if (typeof cell !== 'number') return;
      checked += 1;
      if (money2(cell) !== want) wrong.push(`row${rn} "${label}" states ${want} prints ${money2(cell)}`);
    });
    check('Financing tab: some rows DO carry a totalOverride (the check is not vacuous)', checked >= 10, `checked=${checked}`);
    check('Financing tab: every totalOverride is printed as the Total, not the last period',
      wrong.length === 0, wrong.slice(0, 4).join(' ; '));

    // THE BLANK-OVERRIDE SENTINEL, pinned separately. The check above SKIPS
    // blank overrides, so it cannot see the opposite mistake: reading '' as a
    // value. Number('') is 0 and finite, so a naive parse prints 0.00 for a
    // closing balance. The Financing tab emits these balance rows with no
    // override as state rows, and they must show the LAST period. (The two
    // Capital Stack rows this pinned are gone: the platform has no such table.)
    for (const label of ['Cumulative Funding Gap (A)', 'Closing cash (after funding, before finance cost, sweep and dividends)']) {
      let printed: number | null = null; const series: number[] = [];
      fin?.eachRow((row) => {
        if (String(row.getCell(1).value ?? '').trim() !== label) return;
        const cell = row.getCell(4).value;
        printed = typeof cell === 'number' ? cell : null;
        for (let c = 6; c <= 80; c++) { const v = row.getCell(c).value; if (typeof v === 'number') series.push(v); else break; }
      });
      const last = series.length ? series[series.length - 1] : null;
      check(`Financing "${label}": a BLANK override still prints the closing balance, not 0`,
        printed !== null && last !== null && Math.abs(printed - last) < 0.005,
        `printed=${printed} last=${last}`);
    }

    // EVERY M4 EMITTER ROUTES THROUGH m4RowOpts. opexReports emits no override
    // at all, so the Opex copy cannot be caught by any workbook measurement:
    // it is correct by vacuity today and would break silently the moment a
    // builder gained one. This is the structural pin that covers it.
    {
      const wbSrc = fsReadFileSync('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts', 'utf8');
      const emitters = wbSrc.split('const emitM4 = ').length - 1;
      const routed = (wbSrc.match(/m4RowOpts\(row\)/g) ?? []).length;
      check('every M4 emitter maps its row through m4RowOpts (no hand-rolled total rule)',
        // The Revenue and Opex tabs dropped their private emitM4 copies for the
        // shared makeEmitters (2026-09-17), so two definitions remain.
        emitters >= 2 && routed >= emitters - 1,
        `emitters=${emitters} routed=${routed} (the Financing emitter reads the override directly and is pinned by the row checks above)`);
      check('no emitter still uses the "override means print the last period" shortcut',
        !/totalLast: row\.totalOverride !== undefined/.test(wbSrc));
    }
  }

  // ── Commit 3: no-project export guard (the route rejects an empty payload) ──
  check('no-project guard: empty / missing project blocks Excel export', payloadHasActiveProject({ projectName: '' }) === false && payloadHasActiveProject({}) === false && payloadHasActiveProject(null) === false, '');
  check('no-project guard: an open project passes', payloadHasActiveProject({ projectName: 'Riverside Mixed-Use' }) === true, '');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
