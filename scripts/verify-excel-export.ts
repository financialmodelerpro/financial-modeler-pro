/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-excel-export.ts
 *
 * Locks the formula-driven Excel MODEL export (full live rebuild, 2026-06-11).
 * The workbook is a SIMPLE, fully formula-linked three-statement + returns model:
 * Revenue / Cost of Sales / Opex / Financing / P&L / Cash Flow / Balance Sheet /
 * Returns are all live formulas (the `{ formula, result }` pattern), driven off the
 * Assumptions inputs, so editing any input flows through to the IRR.
 *
 * Checks: structure (14 sheets, gridlines hidden, frozen headers, defined names),
 * the Capex tab still reconciles to the snapshot, the downstream tabs are LIVE
 * (formulas, not cached constants), revenue reconciles to the snapshot, the
 * Balance Sheet balances by construction (per-period check ~0), the Returns IRR
 * cells are live IRR() formulas, and a valid .xlsx with iterative calc is produced.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildModelWorkbook, generateModelWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const A = (n: number, f = 0): number[] => Array(n).fill(f);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.tax = { rate: 0.15 };
  project.returns = { discountRate: 0.11, exitYearOffset: 9, terminalMethod: 'exit_multiple', exitMultiple: 9, perpetuityGrowth: 0.02 };
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0 };
  const p2: any = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  // Priced so the project is economic (GDV > dev cost), exercising the positive-IRR path.
  const resi: any = { id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true, buaSqm: 20000, sellableBuaSqm: 20000,
    revenue: { sell: { assetId: 'R1', subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }], cashPaymentProfile: { percentages: [0.5, 0.5] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_500_000 };
  const retail: any = { id: 'L1', phaseId: 'p2', name: 'Retail', type: '', strategy: 'Lease', visible: true, buaSqm: 5000, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(8, 0.9), arDays: 60 } } };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };
  const cl = [...makeDefaultCostLines('p1', 2), ...makeDefaultCostLines('p2', 2)];
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return { project, phases: [p1, p2], assets: [resi, retail], subUnits: [suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1'), makeDefaultFinancingTranche('t2', 'p2')], equityContributions: [] };
}

const num = (v: any): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') { if ('result' in v && typeof v.result === 'number') return v.result; if ('formula' in v) return 0; }
  return NaN;
};
const isFormula = (v: any): boolean => !!(v && typeof v === 'object' && 'formula' in v);
const labelOf = (ws: ExcelJS.Worksheet, R: number): string => { const a = ws.getCell(R, 1).value; return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : ''); };
const rowByLabel = (ws: ExcelJS.Worksheet, re: RegExp): number => { let row = -1; ws.eachRow((_r, R) => { if (row < 0 && re.test(labelOf(ws, R))) row = R; }); return row; };

async function main(): Promise<void> {
  console.log('=== Excel MODEL export test (full live rebuild: spine -> IRR) ===');
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const N = snap.axisLength;
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '11 June 2026' });

  const ALL_SHEETS = ['Cover', 'Assumptions', 'Timeline', 'Land & Area', 'Capex', 'Revenue', 'Cost of Sales', 'Opex', 'Financing', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Checks'];
  for (const name of ALL_SHEETS) check(`worksheet present: ${name}`, !!wb.getWorksheet(name));
  const noGrid = (n: string): boolean => (wb.getWorksheet(n)?.views ?? []).every((v) => (v as any).showGridLines === false);
  for (const name of ALL_SHEETS) check(`gridlines hidden: ${name}`, noGrid(name));

  // Defined names referenced by the live formulas.
  const hasName = (n: string): boolean => { try { return ((wb.definedNames as any).getRanges(n)?.ranges?.length ?? 0) > 0; } catch { return false; } };
  for (const n of ['ProjectStartYear', 'TaxRate', 'DiscountRate', 'DebtPct', 'EquityPct', 'ExitMultiple', 'ExitYearOffset']) check(`defined name exists: ${n}`, hasName(n));

  // Frozen 4-row header on the period sheets.
  const frozenOk = (n: string): boolean => { const v: any = (wb.getWorksheet(n)?.views ?? [])[0]; return v && v.state === 'frozen' && v.ySplit === 4 && v.xSplit === 4; };
  for (const n of ['Revenue', 'Cost of Sales', 'Opex', 'Financing', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns']) check(`frozen header (rows 1-4, cols A-D): ${n}`, frozenOk(n));

  // ── Capex still reconciles to the snapshot (the tab is unchanged) ────────────
  const cap = wb.getWorksheet('Capex')!;
  const capReport = buildCapexReport(snap, state);
  const totD = (re: RegExp): number => { const R = rowByLabel(cap, re); return R > 0 ? num(cap.getCell(R, 5).value) : NaN; };
  const snapGrand = snap.financing.capex.totals.inclAllLand;
  check('Capex Project Total (incl. all land) == snapshot grand', Math.abs(totD(/^Project Total \(incl\. all land\)$/) - snapGrand) <= Math.max(1, snapGrand * 1e-6), `wb=${Math.round(totD(/^Project Total \(incl\. all land\)$/))} snap=${Math.round(snapGrand)}`);
  void capReport;

  // ── Revenue: live base x profile, reconciles to the snapshot ─────────────────
  const rev = wb.getWorksheet('Revenue')!;
  let revBaseXProfile = 0, revInputProfiles = 0;
  rev.eachRow((row, R) => {
    const lab = labelOf(rev, R);
    if (/ revenue$/.test(lab)) { for (let t = 0; t < N; t++) { const v = rev.getCell(R, 6 + t).value; if (isFormula(v) && /\$[A-Z]+\$\d+\*[A-Z]+\d+/.test(String((v as any).formula))) revBaseXProfile++; } }
    if (/profile %$/.test(lab)) { let inputs = 0; for (let t = 0; t < N; t++) { const c = rev.getCell(R, 6 + t); if ((c.fill as any)?.fgColor?.argb === 'FFE2EAF4') inputs++; } if (inputs > 0) revInputProfiles++; }
  });
  check('Revenue rows are live base x profile formulas', revBaseXProfile > 0, `cells=${revBaseXProfile}`);
  check('Revenue profile rows are editable inputs (navy-pale)', revInputProfiles > 0, `rows=${revInputProfiles}`);
  const revTotRow = rowByLabel(rev, /^Total revenue$/);
  const revTotWb = revTotRow > 0 ? num(rev.getCell(revTotRow, 4).value) : NaN;
  const revTotSnap = snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + (v ?? 0), 0);
  check('Revenue total reconciles to snapshot total revenue', Math.abs(revTotWb - revTotSnap) <= Math.max(1000, revTotSnap * 1e-4), `wb=${Math.round(revTotWb)} snap=${Math.round(revTotSnap)}`);

  // ── Cost of Sales + Opex are live formulas (not cached constants) ────────────
  const countFormulas = (sheet: string): number => { let n = 0; wb.getWorksheet(sheet)!.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value)) n++; })); return n; };
  check('Cost of Sales is formula-driven', countFormulas('Cost of Sales') > N, `formulas=${countFormulas('Cost of Sales')}`);
  check('Opex is formula-driven', countFormulas('Opex') > N, `formulas=${countFormulas('Opex')}`);

  // ── Financing: the recurrence is live (interest = rate x opening debt off a
  //    LOCAL input cell; closing debt + cash are formulas) ───────────────────
  const fin = wb.getWorksheet('Financing')!;
  let finInterestLocalRate = false, finLinksAssumptions = false;
  fin.eachRow((row) => row.eachCell((c) => { const v: any = c.value; if (isFormula(v)) { const f = String(v.formula); if (/\$[A-Z]+\$\d+\*\$[A-Z]+\$\d+/.test(f) || /\*\$[A-Z]+\$\d+$/.test(f)) finInterestLocalRate = true; if (/Assumptions!|DebtPct|TaxRate/.test(f)) finLinksAssumptions = true; } }));
  check('Financing interest references a LOCAL rate input cell', finInterestLocalRate);
  check('Financing inputs link from Assumptions / defined names', finLinksAssumptions);
  const debtCloseRow = rowByLabel(fin, /^Debt: closing$/);
  check('Financing has a live debt-closing recurrence row', debtCloseRow > 0 && isFormula(fin.getCell(debtCloseRow, 6 + N - 1).value));

  // ── P&L + Cash Flow are link-driven presentation tabs ───────────────────────
  const linksTo = (sheet: string, re: RegExp): boolean => { let ok = false; wb.getWorksheet(sheet)!.eachRow((row) => row.eachCell((c) => { if (isFormula(c.value) && re.test(String((c.value as any).formula))) ok = true; })); return ok; };
  check('P&L links to Revenue / Financing', linksTo('P&L', /Revenue!|Financing!/));
  check('Cash Flow links to the Financing recurrence', linksTo('Cash Flow', /Financing!/));

  // ── Balance Sheet balances by construction (the headline integrity check) ────
  const bsWs = wb.getWorksheet('Balance Sheet')!;
  const bsDiffRow = rowByLabel(bsWs, /^Balance check/);
  let maxBsDiff = 0; let bsDiffIsFormula = true;
  if (bsDiffRow > 0) for (let t = 0; t < N; t++) { const cell = bsWs.getCell(bsDiffRow, 6 + t); const v = num(cell.value); if (Number.isFinite(v)) maxBsDiff = Math.max(maxBsDiff, Math.abs(v)); if (!isFormula(cell.value)) bsDiffIsFormula = false; }
  check('Balance Sheet balances by construction (max |Assets - L&E| < 1)', bsDiffRow > 0 && maxBsDiff < 1, `maxDiff=${maxBsDiff}`);
  check('Balance check row is a live formula', bsDiffRow > 0 && bsDiffIsFormula);
  // Rolling accounts (inventory / NBV / share capital) self-reference the prior column.
  const rolls = (re: RegExp): boolean => { const R = rowByLabel(bsWs, re); if (R < 0) return false; const v: any = bsWs.getCell(R, 6 + 1).value; return isFormula(v) && new RegExp(`[A-Z]+${R}`).test(String(v.formula)); };
  check('Balance Sheet inventory rolls forward (self-references prior column)', rolls(/^Inventory/));
  check('Balance Sheet share capital rolls forward', rolls(/^Share capital/));

  // ── Returns: live IRR / NPV / MOIC over the FCFF / FCFE streams ──────────────
  const ret = wb.getWorksheet('Returns')!;
  const irrRow = rowByLabel(ret, /^Project IRR \(FCFF\)$/);
  const eqIrrRow = rowByLabel(ret, /^Equity IRR \(FCFE\)$/);
  const irrCell: any = irrRow > 0 ? ret.getCell(irrRow, 4).value : null;
  check('Returns Project IRR is a live IRR() formula', !!irrCell && isFormula(irrCell) && /IRR\(/.test(String(irrCell.formula)), `f=${irrCell?.formula}`);
  check('Returns Equity IRR is a live IRR() formula', eqIrrRow > 0 && isFormula(ret.getCell(eqIrrRow, 4).value) && /IRR\(/.test(String((ret.getCell(eqIrrRow, 4).value as any).formula)));
  const fcffRow = rowByLabel(ret, /^FCFF \(project\)$/);
  check('Returns has an FCFF stream row with an inception (Period 0) cell', fcffRow > 0);
  // The cached FCFF IRR is finite for the (economic) fixture.
  check('Project IRR cached value is finite', irrRow > 0 && Number.isFinite(num(irrCell)), `irr=${num(irrCell)}`);

  // ── Checks tab still ties Capex + surfaces the balance check ────────────────
  const checksWs = wb.getWorksheet('Checks')!;
  let hasBalanceCheck = false; checksWs.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string' && /Balance sheet balances/.test(c.value)) hasBalanceCheck = true; }));
  check('Checks tab surfaces the balance-sheet integrity check', hasBalanceCheck);

  // ── Valid .xlsx with iterative calc enabled, reloads cleanly ────────────────
  const buf = await generateModelWorkbookBuffer({ state, projectName: 'X', dateLabel: 'd' });
  check('writes a non-trivial .xlsx buffer', buf.byteLength > 8192, `bytes=${buf.byteLength}`);
  const reload = new ExcelJS.Workbook();
  await reload.xlsx.load(buf);
  check('buffer reloads with all sheets', ALL_SHEETS.every((n) => !!reload.getWorksheet(n)));
  const zip = await JSZip.loadAsync(buf);
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  check('iterative calculation is enabled (calcPr iterate)', /<calcPr\b[^>]*iterate="1"/.test(wbXml));

  // ── Display scale is number-format only (stored value unchanged) ────────────
  const wbM = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', displayScale: 'millions' });
  const revM = wbM.getWorksheet('Revenue')!;
  const rtRowM = rowByLabel(revM, /^Total revenue$/);
  check('Display scale leaves stored values unchanged', rtRowM > 0 && Math.abs(num(revM.getCell(rtRowM, 4).value) - revTotWb) <= Math.max(1, revTotWb * 1e-6));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
