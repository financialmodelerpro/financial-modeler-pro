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
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCostOfSalesReport } from '../src/hubs/modeling/platforms/refm/lib/reports/cosReports';
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

  // Tab sequence follows the platform module order: Module 1 (Inputs, Timeline,
  // Land & Area, Capex, Financing), Module 2 (Revenue: a single sheet mirroring
  // all five Module 2 sub-tabs), Module 3 (Opex), Module 4 (P&L, Cash Flow,
  // Balance Sheet), Module 5 (Returns).
  const ALL_SHEETS = ['Cover', 'Inputs', 'Timeline', 'Land & Area', 'Capex', 'Financing', 'Revenue', 'Opex', 'Schedules', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Checks'];
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
  const snapGrand = snap.financing.capex.totals.inclAllLand;
  check('Capex Project Total (incl. all land) == snapshot grand', close(totCapexD(/^Project Total \(incl\. all land\)$/), snapGrand, 1e-6), `wb=${Math.round(totCapexD(/^Project Total \(incl\. all land\)$/))} snap=${Math.round(snapGrand)}`);
  check('Capex Table 2 (incl. all land) total ties', close(totCapexD(/^Total Capex \(incl\. all land\)$/), snapGrand, 1e-6));
  check('Capex Table 3 (excl. land in-kind) total present', Number.isFinite(totCapexD(/^Total Capex \(excl\. land in-kind\)$/)));
  check('Capex Table 4 (excl. all land) total present', Number.isFinite(totCapexD(/^Total Capex \(excl\. all land\)$/)));

  // ── Statements tie EXACTLY to the platform snapshot (constants) ─────────────
  const totD = (sheet: string, re: RegExp): number => { const ws = wb.getWorksheet(sheet)!; const R = rowByLabel(ws, re); return R > 0 ? num(ws.getCell(R, 4).value) : NaN; }; // period-sheet Total col = D (4)
  check('Revenue total == snapshot total revenue', close(totD('Revenue', /^Total revenue$/), sumA(snap.pl.totalRevenuePerPeriod, N)), `wb=${Math.round(totD('Revenue', /^Total revenue$/))} snap=${Math.round(sumA(snap.pl.totalRevenuePerPeriod, N))}`);
  check('Opex total == snapshot total opex', close(totD('Opex', /^Total Project Opex$/), sumA(snap.pl.totalOpexPerPeriod, N)));
  // Module 3 mirror: the Opex sheet reproduces all platform sub-tabs in order.
  const opxWs = wb.getWorksheet('Opex')!;
  const m3 = (re: RegExp): number => rowByLabel(opxWs, re);
  const m3a = m3(/^1\. Opex Inputs/), m3b = m3(/^2\. Opex Output/), m3c = m3(/^3\. Schedules/);
  check('Opex mirrors the Module 3 sub-tabs in sequence (Inputs, Output, Schedules)', m3a > 0 && m3b > m3a && m3c > m3b, `rows=${m3a},${m3b},${m3c}`);
  check('Opex Schedules carries the project-total Accounts Payable roll-forward', m3(/^Accounts Payable \(project total\)$/) > m3c);
  // Cost of Sales is a section on the Revenue sheet; tie its project-total row
  // (the last 'Total Cost of Sales' on that sheet) to the snapshot.
  const rowByLabelLast = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (re.test(labelOf(ws, R))) row = R; }); return row; };
  const cosTotRow = rowByLabelLast(wb.getWorksheet('Revenue')!, /^Total Cost of Sales$/);
  const cosProjTable = buildCostOfSalesReport(snap, state, (v: number) => String(v)).find((t) => t.title === 'Project Total Cost of Sales');
  const cosProjTotal = cosProjTable ? sumA(cosProjTable.rows.find((r) => r.isTotal)?.values ?? [], N) : 0;
  check('Cost of Sales project total ties to the CoS builder', cosTotRow > 0 && close(num(wb.getWorksheet('Revenue')!.getCell(cosTotRow, 4).value), cosProjTotal));
  // Module 2 mirror: the Revenue sheet reproduces all platform sub-tabs in order.
  const revWs = wb.getWorksheet('Revenue')!;
  const m2 = (re: RegExp): number => rowByLabel(revWs, re);
  const m2a = m2(/^1\. Revenue Inputs/), m2b = m2(/^2\. Revenue Output/), m2c = m2(/^3\. Cost of Sales/), m2d = m2(/^4\. Schedules/);
  check('Revenue mirrors the Module 2 sub-tabs in sequence (Inputs, Output, Cost of Sales, Schedules)', m2a > 0 && m2b > m2a && m2c > m2b && m2d > m2c, `rows=${m2a},${m2b},${m2c},${m2d}`);
  check('Revenue Output carries per-asset vintage matrices', m2(/Vintage Matrix,/) > m2b);
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
  check('Schedules: Capital Stack + movement present', finRow(/^Capital Stack \(period-end\)$/) > 0 && finRow(/^Capital Stack Movement/) > 0);
  // Combined Debt Service ties to the combined snapshot.
  const cmb = snap.financing.combined;
  check('Combined Total Principal Repaid ties to snapshot', close(Math.abs(totD('Financing', /^Total Principal Repaid$/)), sumA(cmb.totalPrincipalRepaid, N)));
  check('Combined Total Interest Expensed ties to snapshot', close(Math.abs(totD('Financing', /^Total Interest Expensed$/)), sumA(cmb.totalInterestExpensed, N)));
  check('Combined Total Drawdown (Capex+IDC) ties to snapshot', close(totD('Financing', /^Total Drawdown \(Capex \+ IDC\)$/), sumA(cmb.totalDrawdown, N) + sumA(cmb.totalInterestCapitalized, N)));
  // Equity Movement closing == existing + cumulative cash + in-kind.
  const eqClosingLast = snap.financing.existing.equityTotal + sumA(snap.financing.equity.cashPerPeriod, N) + sumA(snap.financing.equity.inKindPerPeriod, N);
  check('Equity Movement closing (last) == cumulative equity', close(finLast(/^Closing \(cumulative equity\)$/), eqClosingLast));
  // Capital stack last == debt closing + equity closing.
  check('Capital Stack total (last) == debt + equity closing', close(finLast(/^Total capital$/), (snap.bs.debtOutstandingPerPeriod[N - 1] ?? 0) + eqClosingLast));
  // Sub-tab 3 Funding Gap: Method 2 gap ties; Method 3 present.
  const gapSnap = computeFundingGap(snap);
  check('Funding Gap Method 2 total gap ties to snapshot', close(totD('Financing', /^Funding gap = MAX/), gapSnap.methodATotalGap));
  check('Funding Gap Method 3 (Cash Deficit Funding) present', finRow(/^Method 3, Cash Deficit Funding/) > 0);
  check('Funding Gap Method 3 Net Cash Required present', finRow(/^Net Cash Required/) > 0);
  // Sub-tab 4 Cash Sweep: closing cash ties to Direct CF closing.
  check('Cash Sweep closing cash (last) == Direct CF closing', close(finLast(/^= Closing Cash/), snap.directCF.closingCashPerPeriod[N - 1] ?? 0));
  // Inputs sub-tab echoes raw inputs (from Assumptions) inline.
  check('Financing Inputs echoes raw inputs (Funding method, Debt share)', finRow(/^Funding method$/) > r1 && finRow(/^Debt share$/) > r1);
  // Inputs sub-tab Funding Requirement block (the schedule starting point):
  // method-by-method requirement + Selected row, all above the Schedules header.
  const frReq = finRow(/^Funding Requirement \(schedule starting point/);
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
  for (const re of [/^Project$/, /^Phases$/, /^Assets$/, /^Capex cost lines/, /^Financing settings$/, /Financing facilities/]) check(`Inputs divider present: ${re.source}`, rowByLabel(inp, re) > 0);
  // Raw financing scalars live under the Financing divider (once), not Project.
  check('Financing settings divider holds the raw financing scalars', rowByLabel(inp, /^Funding method$/) > rowByLabel(inp, /^Financing settings$/) && rowByLabel(inp, /^Debt share$/) > rowByLabel(inp, /^Financing settings$/));
  check('Inputs title says Inputs', /Inputs/.test(labelOf(inp, 1)));
  // All model inputs live on the Inputs tab, grouped by domain divider band.
  check('Inputs tab has the REVENUE INPUTS domain', rowByLabel(inp, /^REVENUE INPUTS$/) > 0 && rowByLabel(inp, /^Revenue configuration by asset/) > rowByLabel(inp, /^REVENUE INPUTS$/));
  check('Inputs tab has the OPEX INPUTS domain', rowByLabel(inp, /^OPEX INPUTS$/) > rowByLabel(inp, /^REVENUE INPUTS$/));
  // Domain order mirrors the module sequence: Capex (M1) -> Financing (M1) ->
  // Revenue (M2) -> Opex (M3). Financing sits right after the Capex cost lines.
  check('Inputs domains ordered Capex -> Financing -> Revenue -> Opex', rowByLabel(inp, /^Capex cost lines/) < rowByLabel(inp, /^FINANCING INPUTS$/) && rowByLabel(inp, /^FINANCING INPUTS$/) < rowByLabel(inp, /^REVENUE INPUTS$/) && rowByLabel(inp, /^REVENUE INPUTS$/) < rowByLabel(inp, /^OPEX INPUTS$/));
  // Module 1 input completeness (gaps closed 2026-06-14): per-parcel land
  // funding split, selected funding-method config, per-facility timing + share.
  const parcelsHdr = rowByLabel(inp, /^Land parcels$/);
  if (parcelsHdr > 0) check('Land parcels carry Debt % / Equity % funding split', String(inp.getCell(parcelsHdr + 1, 8).value) === 'Debt %' && String(inp.getCell(parcelsHdr + 1, 9).value) === 'Equity %');
  const facHdr = rowByLabel(inp, /Financing facilities/);
  if (facHdr > 0) check('Financing facilities carry timing + share columns', String(inp.getCell(facHdr + 1, 9).value) === 'Repay start year' && String(inp.getCell(facHdr + 1, 12).value) === 'Facility share %');
  const selMethod = snap.financing.funding.selectedMethodId;
  if (selMethod !== 1) check(`Selected funding-method config (Method ${selMethod}) emitted in Inputs`, rowByLabel(inp, new RegExp(`^Method ${selMethod}:`)) > rowByLabel(inp, /^Financing settings$/));
  // Capex cost lines carry Stage + phasing window (start / end period, even/manual).
  const capHdr = rowByLabel(inp, /^Capex cost lines/);
  if (capHdr > 0) check('Capex cost lines carry Stage + phasing-window columns', String(inp.getCell(capHdr + 1, 5).value) === 'Stage' && String(inp.getCell(capHdr + 1, 6).value) === 'Start period' && String(inp.getCell(capHdr + 1, 8).value) === 'Phasing');
  // Project NDA deduction settings present.
  check('Project NDA deduction settings emitted', rowByLabel(inp, /^NDA deduction enabled/) > 0 && rowByLabel(inp, /^Project roads %/) > 0);
  // Assets table carries per-asset NDA columns.
  const astHdr = rowByLabel(inp, /^Assets$/);
  if (astHdr > 0) check('Assets carry per-asset NDA columns', String(inp.getCell(astHdr + 1, 12).value) === 'Roads % (asset)' && String(inp.getCell(astHdr + 1, 14).value) === 'NDA on (asset)');

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

  // ── Returns: IRR is a finite constant (not a live formula) ──────────────────
  const ret = wb.getWorksheet('Returns')!; const irrRow = rowByLabel(ret, /^Project IRR \(FCFF\)$/);
  const irrCell: any = irrRow > 0 ? ret.getCell(irrRow, 4).value : null;
  check('Returns Project IRR is a finite constant (not a formula)', irrRow > 0 && !isFormula(irrCell) && Number.isFinite(num(irrCell)), `irr=${num(irrCell)}`);
  // Module 5 mirror: the Returns tab reproduces the platform sub-tabs + KPI strips.
  const m5 = (re: RegExp): number => rowByLabel(ret, re);
  check('Returns mirrors Module 5 sub-tabs (Returns, RE Metrics, Cash Flow Streams)', m5(/^1\. Returns/) > 0 && m5(/^2\. RE Metrics/) > m5(/^1\. Returns/) && m5(/^3\. Cash Flow Streams/) > m5(/^2\. RE Metrics/));
  check('Returns carries KPI strips (Headline Returns, Development Economics)', m5(/^Headline Returns$/) > 0 && m5(/^Development Economics$/) > 0);
  check('Returns carries Sources & Uses + RE coverage cards', m5(/^Sources & Uses$/) > 0 && m5(/^Leverage & Coverage$/) > 0);

  // ── Universal navy palette: every cell colour is one standard scheme ─────────
  // No per-tab or off-palette colours (no green / teal / blue accents). Allowed:
  // navy / navyDark / deep-navy section band / pale-navy subtotal / navy-pale
  // input / grey / greyMid / light-navy border, plus black, white and red (fails).
  const PALETTE = new Set(['FF1B4F8A', 'FF1B3A6B', 'FF0C2340', 'FFE8EEF7', 'FFE2EAF4', 'FFF1F3F5', 'FFD9DEE3', 'FFBDCCE3', 'FF000000', 'FFFFFFFF', 'FFC00000']);
  const stray = new Map<string, string>();
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      const fc = (c.font as any)?.color?.argb; const fl = (c.fill as any)?.fgColor?.argb; const bd = (c.border as any)?.bottom?.color?.argb;
      for (const x of [fc, fl, bd]) if (typeof x === 'string' && !PALETTE.has(x)) stray.set(x, ws.name);
    }));
  }
  check('every cell uses the standard navy palette (no green / per-tab colours)', stray.size === 0, [...stray.entries()].map(([k, v]) => `${k}@${v}`).join(' '));
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
