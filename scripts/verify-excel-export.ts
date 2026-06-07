/**
 * verify-excel-export.ts
 *
 * Locks the formula-driven Excel model export (Phase 1 foundation). Checks the
 * workbook structure (Cover / Assumptions / Timeline / Checks), that inputs are
 * present on the Assumptions sheet, that the Timeline is FORMULA-DRIVEN with the
 * platform value cached as the result (the { formula, result } pattern), that
 * the cached results RECONCILE to the snapshot, that the key defined names
 * exist, and that a valid .xlsx buffer is produced.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildModelWorkbook, generateModelWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCostOfSalesReport } from '../src/hubs/modeling/platforms/refm/lib/reports/cosReports';
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
  const resi: any = { id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true, buaSqm: 20000, sellableBuaSqm: 20000,
    revenue: { sell: { assetId: 'R1', subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }], cashPaymentProfile: { percentages: [0.5, 0.5] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 };
  const retail: any = { id: 'L1', phaseId: 'p2', name: 'Retail', type: '', strategy: 'Lease', visible: true, buaSqm: 5000, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(8, 0.9), arDays: 60 } } };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };
  const cl = [...makeDefaultCostLines('p1', 2), ...makeDefaultCostLines('p2', 2)];
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return { project, phases: [p1, p2], assets: [resi, retail], subUnits: [suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1'), makeDefaultFinancingTranche('t2', 'p2')], equityContributions: [] };
}

async function main(): Promise<void> {
  console.log('=== Excel model export test (axis fix + iterative calc; Phases 1-4 sheets) ===');
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const wb = buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '4 June 2026' });

  const ALL_SHEETS = ['Cover', 'Assumptions', 'Timeline', 'Capex', 'Revenue', 'Cost of Sales', 'Opex', 'Checks'];
  for (const name of ALL_SHEETS) {
    check(`worksheet present: ${name}`, !!wb.getWorksheet(name));
  }

  // Clean look: gridlines hidden on EVERY sheet.
  const noGrid = (n: string): boolean => (wb.getWorksheet(n)?.views ?? []).every((v) => (v as any).showGridLines === false);
  for (const name of ALL_SHEETS) {
    check(`gridlines hidden: ${name}`, noGrid(name));
  }

  // Defined names for key scalars (so formulas reference inputs by name).
  const hasName = (n: string): boolean => {
    try { return ((wb.definedNames as any).getRanges(n)?.ranges?.length ?? 0) > 0; } catch { return false; }
  };
  for (const n of ['ProjectStartYear', 'TaxRate', 'DiscountRate', 'DebtPct']) {
    check(`defined name exists: ${n}`, hasName(n), '');
  }

  const asum = wb.getWorksheet('Assumptions')!;
  // ProjectStartYear is a FORMULA over the phase inputs (formula-driven origin).
  let startYearCell: ExcelJS.Cell | null = null;
  asum.eachRow((row) => { row.eachCell((c) => { if (c.value && typeof c.value === 'object' && 'formula' in (c.value as any) && String((c.value as any).formula).startsWith('MIN(')) startYearCell = c; }); });
  check('Project start year is a MIN() formula over phase inputs', !!startYearCell);
  check('Project start year formula caches the snapshot value', !!startYearCell && (startYearCell as any).value.result === snap.projectStartYear, `got=${(startYearCell as any)?.value?.result} expect=${snap.projectStartYear}`);

  // Timeline year row (row 6). Column B = Opening (prior year = projectStartYear-1,
  // matching the platform's leading prior-year column); column C = period 0; etc.
  const tl = wb.getWorksheet('Timeline')!;
  const yOpen = tl.getCell('B6').value as any;
  check('Timeline leads with an Opening prior-year column', !!yOpen && typeof yOpen === 'object' && String(yOpen.formula).replace(/\s/g, '') === 'ProjectStartYear-1' && yOpen.result === snap.projectStartYear - 1, `got=${yOpen?.result} expect=${snap.projectStartYear - 1}`);
  const y0 = tl.getCell('C6').value as any; // period 0 (first active year)
  check('Timeline year[0] is a formula referencing ProjectStartYear', !!y0 && typeof y0 === 'object' && y0.formula === 'ProjectStartYear');
  check('Timeline year[0] caches the correct year', !!y0 && y0.result === snap.yearLabels[0], `got=${y0?.result} expect=${snap.yearLabels[0]}`);
  const yLast = tl.getCell(6, 2 + snap.axisLength).value as any; // last active period col (period0 at col 3)
  check('Timeline last year is a +1 formula and reconciles', !!yLast && typeof yLast === 'object' && String(yLast.formula).endsWith('6+1') && yLast.result === snap.yearLabels[snap.axisLength - 1], `got=${yLast?.result} expect=${snap.yearLabels[snap.axisLength - 1]}`);

  // Capex (Phase 2): build-up amounts are formulas linking to Assumptions inputs,
  // and a cached formula result reconciles to the snapshot capex total.
  const cap = wb.getWorksheet('Capex')!;
  let linksAssumptions = 0;
  const capResults: number[] = [];
  cap.eachRow((row) => row.eachCell((c) => {
    const v = c.value as any;
    if (v && typeof v === 'object' && 'formula' in v) {
      if (String(v.formula).includes('Assumptions!')) linksAssumptions++;
      if (typeof v.result === 'number') capResults.push(v.result);
    }
  }));
  check('Capex build-up links to Assumptions inputs (rate x quantity)', linksAssumptions > 0, `links=${linksAssumptions}`);
  const inclSum = snap.financing.capex.perPeriod.inclAllLand.reduce((s, v) => s + (v ?? 0), 0);
  const capTol = Math.max(1000, Math.abs(inclSum) * 1e-6);
  check('Capex total reconciles to snapshot (incl. all land)', capResults.some((x) => Math.abs(x - inclSum) <= capTol), `inclSum=${Math.round(inclSum)}`);

  // Revenue (Phase 3): the total-revenue formula caches the snapshot total.
  const collectResults = (sheet: string): number[] => {
    const out: number[] = [];
    wb.getWorksheet(sheet)!.eachRow((row) => row.eachCell((c) => {
      const v = c.value as any;
      if (v && typeof v === 'object' && 'formula' in v && typeof v.result === 'number') out.push(v.result);
    }));
    return out;
  };
  const revResults = collectResults('Revenue');
  const revSum = snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + (v ?? 0), 0);
  const revTol = Math.max(1000, Math.abs(revSum) * 1e-6);
  check('Revenue total reconciles to snapshot total revenue', revResults.some((x) => Math.abs(x - revSum) <= revTol), `revSum=${Math.round(revSum)}`);

  // Cost of Sales (Phase 3): the sheet mirrors the platform Cost of Sales tab
  // (cosReports, which capitalises IDC into the basis), so it reconciles to the
  // report's project total, not the P&L's reduced CoS line.
  const cosReport = buildCostOfSalesReport(snap, state, (v) => String(v));
  const cosReportTotal = (cosReport.find((t) => t.title === 'Project Total Cost of Sales')?.rows.find((rw) => rw.isTotal)?.values ?? [])
    .reduce((s, v) => s + (v ?? 0), 0);
  const cosResults = collectResults('Cost of Sales');
  const cosTol = Math.max(1000, Math.abs(cosReportTotal) * 1e-6);
  check('Cost of Sales total reconciles to platform CoS tab', cosResults.some((x) => Math.abs(x - cosReportTotal) <= cosTol), `cosReportTotal=${Math.round(cosReportTotal)}`);

  // Opex (Phase 4): total ties to the snapshot opex (incl. HQ).
  const opexResults = collectResults('Opex');
  const opexSum = snap.opex.totalOpexPerPeriodInclHQ.reduce((s, v) => s + (v ?? 0), 0);
  const opexTol = Math.max(1000, Math.abs(opexSum) * 1e-6);
  check('Opex total reconciles to snapshot opex (incl. HQ)', opexResults.some((x) => Math.abs(x - opexSum) <= opexTol), `opexSum=${Math.round(opexSum)}`);

  // Valid .xlsx buffer.
  const buf = await generateModelWorkbookBuffer({ state, projectName: 'X', dateLabel: 'd' });
  check('writes a non-trivial .xlsx buffer', buf.byteLength > 4096, `bytes=${buf.byteLength}`);
  const reload = new ExcelJS.Workbook();
  await reload.xlsx.load(buf);
  check('buffer reloads as a valid workbook with all sheets', ALL_SHEETS.every((n) => !!reload.getWorksheet(n)));

  // Iterative calculation must be enabled in the workbook (the debt / IDC /
  // cash-sweep / funding formulas are circular). Verify by reading xl/workbook.xml
  // from the .xlsx zip and checking the calcPr iterate flag.
  const zip = await JSZip.loadAsync(buf);
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  check('iterative calculation is enabled (calcPr iterate)', /<calcPr\b[^>]*iterate="1"/.test(wbXml), 'iterate flag missing in workbook.xml');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
