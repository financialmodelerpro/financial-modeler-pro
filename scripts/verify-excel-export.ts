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
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { resolveAssetAreaMetrics } from '../src/core/calculations';
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

  const ALL_SHEETS = ['Cover', 'Assumptions', 'Timeline', 'Land & Area', 'Capex', 'Financing', 'Revenue', 'Cost of Sales', 'Opex', 'Checks'];
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

  // Full inputs tab: the entity sections are present and inputs carry the FAST
  // navy-pale shading (matching the PDF input cells), not a coloured font.
  const asumText: string[] = [];
  let blueInputs = 0;
  asum.eachRow((row) => row.eachCell((c) => {
    if (typeof c.value === 'string') asumText.push(c.value);
    const fill = (c.fill as any)?.fgColor?.argb;
    if (fill === 'FFE2EAF4') blueInputs++;
  }));
  // Sections that the fixture always exercises (parcels / assets / sub-units /
  // debt). Equity contributions render only when present, so not asserted here.
  for (const sec of ['Land parcels', 'Assets', 'Sub-units', 'Financing facilities (debt)']) {
    check(`Assumptions has section: ${sec}`, asumText.includes(sec), '');
  }
  check('Assumptions carries a substantial FAST-shaded input set (navy-pale)', blueInputs > 30, `inputs=${blueInputs}`);

  // Timeline 4-row frozen header: row 3 = period-end dates, row 4 = period index.
  // Period columns from E (col 5): E = Period 0 / Dec(startYear-1, the opening),
  // F = Period 1 / startYear, etc. Date cells store the integer year, shown "Dec YYYY".
  const tl = wb.getWorksheet('Timeline')!;
  const OPENC = 5; // E
  const yOpen = tl.getCell(3, OPENC).value as any; // E3 = opening (Period 0)
  check('Timeline opening date (E3) is ProjectStartYear-1 (Period 0)', !!yOpen && typeof yOpen === 'object' && String(yOpen.formula).replace(/\s/g, '') === 'ProjectStartYear-1' && yOpen.result === snap.projectStartYear - 1, `got=${yOpen?.result} expect=${snap.projectStartYear - 1}`);
  const y0 = tl.getCell(3, OPENC + 1).value as any; // F3 = first active year (Period 1)
  check('Timeline first active date (F3) is a +1 formula = startYear', !!y0 && typeof y0 === 'object' && String(y0.formula).endsWith('3+1') && y0.result === snap.yearLabels[0], `got=${y0?.result} expect=${snap.yearLabels[0]}`);
  const yLast = tl.getCell(3, OPENC + snap.axisLength).value as any; // last active date
  check('Timeline last date is a +1 formula and reconciles', !!yLast && typeof yLast === 'object' && String(yLast.formula).endsWith('3+1') && yLast.result === snap.yearLabels[snap.axisLength - 1], `got=${yLast?.result} expect=${snap.yearLabels[snap.axisLength - 1]}`);
  // Period index row (4): E4 = 0, F4 = 1.
  const ix0 = tl.getCell(4, OPENC).value as any; // cached result 0 is dropped by exceljs; check the formula
  check('Timeline period index opening (E4) = 0', !!ix0 && typeof ix0 === 'object' && String(ix0.formula) === '0', `got=${JSON.stringify(ix0)}`);
  // Frozen header: rows 1-4 and columns A-D frozen on a period sheet.
  const frozenOk = (n: string): boolean => { const v: any = (wb.getWorksheet(n)?.views ?? [])[0]; return v && v.state === 'frozen' && v.ySplit === 4 && v.xSplit === 4; };
  for (const n of ['Capex', 'Financing', 'Revenue', 'Cost of Sales', 'Opex']) check(`Frozen header (rows 1-4, cols A-D): ${n}`, frozenOk(n));

  // Land & Area (step 3): the area hierarchy + land value are formulas linking to
  // Assumptions, and each asset's BUA + land value reconcile to the engine.
  const la = wb.getWorksheet('Land & Area')!;
  let laLinks = 0;
  const laResults: number[] = [];
  la.eachRow((row) => row.eachCell((c) => {
    const v = c.value as any;
    if (v && typeof v === 'object' && 'formula' in v) {
      if (String(v.formula).includes('Assumptions!')) laLinks++;
      if (typeof v.result === 'number') laResults.push(v.result);
    }
  }));
  check('Land & Area links to Assumptions inputs', laLinks > 0, `links=${laLinks}`);
  const near = (target: number) => laResults.some((x) => Math.abs(x - target) <= Math.max(1, Math.abs(target) * 1e-6));
  let areaOk = true; let landOk = true;
  for (const a of state.assets.filter((x: any) => x.visible !== false)) {
    const m = resolveAssetAreaMetrics(a, state.project, state.parcels, state.assets.filter((x: any) => x.phaseId === a.phaseId), state.subUnits, state.landAllocationMode);
    if (m.bua > 1 && !near(m.bua)) areaOk = false;
    if (m.landValue > 1 && !near(m.landValue)) landOk = false;
  }
  check('Land & Area BUA reconciles to engine (per asset)', areaOk);
  check('Land & Area land value reconciles to engine (per asset)', landOk);

  const cap = wb.getWorksheet('Capex')!;
  // ── Unit 1: sheet-name quoting (no #NAME?) ──────────────────────────────────
  // Every cross-sheet reference to a multi-word sheet must be single-quoted, else
  // Excel raises #NAME? (e.g. 'Land & Area' parses '&' as concatenation). Scan
  // every formula on every sheet and assert no bare (unquoted) multi-word ref.
  const MULTIWORD = ['Land & Area', 'Cost of Sales', 'Operating Expenses'];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unquotedRefs: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as any;
      if (!(v && typeof v === 'object' && 'formula' in v)) return;
      const f = String(v.formula);
      for (const n of MULTIWORD) {
        const stripped = f.replace(new RegExp(`'${esc(n)}'!`, 'g'), '');
        if (stripped.includes(`${n}!`)) unquotedRefs.push(`${ws.name}: ${f}`);
      }
    }));
  }
  check('No unquoted multi-word sheet references anywhere (no #NAME? source)', unquotedRefs.length === 0, unquotedRefs.slice(0, 3).join(' || '));

  // ── Unit 1: Assumptions capex block is PURE INPUTS ──────────────────────────
  // Locate the capex cost-lines block and assert column D (Quantity) holds no
  // money-formatted constant (a derived basis); percent rows (col C in pct) must
  // have an EMPTY D. Physical-quantity rows (int-formatted) may keep D.
  let inCapexBlock = false; let moneyBasisConstants = 0; let percentRowsWithQty = 0;
  asum.eachRow((row) => {
    const a = row.getCell(1).value;
    if (typeof a === 'string' && a.startsWith('Capex cost lines')) { inCapexBlock = true; return; }
    if (inCapexBlock && typeof a === 'string' && (a.startsWith('Financing facilities') || a.startsWith('Equity contributions'))) inCapexBlock = false;
    if (!inCapexBlock) return;
    const cC = row.getCell(3); const cD = row.getCell(4);
    // Accounting money format leads with `_(* `; the int (count/area) format does
    // not, so this detects a derived money basis without flagging a quantity.
    if (typeof cD.value === 'number' && /_\(\*/.test(String(cD.numFmt ?? ''))) moneyBasisConstants++;
    const cIsPct = /%/.test(String(cC.numFmt ?? ''));
    if (cIsPct && cD.value !== null && cD.value !== undefined && cD.value !== '') percentRowsWithQty++;
  });
  check('Assumptions capex block holds NO derived money basis (pure inputs)', moneyBasisConstants === 0, `moneyConstants=${moneyBasisConstants}`);
  check('Assumptions percent-method capex rows have an empty Quantity cell', percentRowsWithQty === 0, `percentRowsWithQty=${percentRowsWithQty}`);

  // ── Capex layout: A label, B UOM, C Rate, D Total, E Period 0, F.. active ────
  const capReport = buildCapexReport(snap, state);
  const NN = snap.axisLength;
  const TOTAL_C = 4, OPEN_C = 5; const yCol = (t: number): number => OPEN_C + 1 + t; const chkCol = OPEN_C + NN + 1;
  // exceljs drops a cached result:0 on write, so a formula cell with no numeric
  // result reads as 0 (Excel recomputes it on open via fullCalcOnLoad).
  const num = (v: any): number => {
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') { if ('result' in v && typeof v.result === 'number') return v.result; if ('formula' in v) return 0; }
    return NaN;
  };
  const aOf = (R: number): string => { const a = cap.getCell(R, 1).value; return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : ''); };
  const rowLabel = (re: RegExp): number => { let row = -1; cap.eachRow((_r, R) => { if (re.test(aOf(R)) && row < 0) row = R; }); return row; };

  // Frozen header row 4: A=Cost line, B=UOM, C=Rate, D=Total.
  const headerOk = aOf(4) === 'Cost line' && cap.getCell(4, 2).value === 'UOM' && cap.getCell(4, 3).value === 'Rate' && cap.getCell(4, 4).value === 'Total';
  // Period 0 opening column present (E header index = 0).
  const e4: any = cap.getCell(4, OPEN_C).value; // links to Timeline index (cached 0 dropped by exceljs)
  check('Capex frozen header (A Cost line / B UOM / C Rate / D Total)', headerOk);
  check('Capex has a Period 0 opening column (E links to Timeline index)', !!e4 && typeof e4 === 'object' && /Timeline/.test(String(e4.formula)), `got=${JSON.stringify(e4)}`);

  let hasInputs = false, hasBuildup = false, hasOldBuildup = false;
  let allocConstCells = 0, allocFormulaCells = 0, amtYearFormulaCells = 0, amtYearConstCells = 0;
  let buildupLinksLandArea = false, buildupLinksAssumptions = false, selectedSumLive = false, selfRef = false;
  const allocChecksOk: boolean[] = [];
  const buildupLineRows: Array<{ asset: string; name: string; row: number }> = [];
  const t1LineRows: number[] = [];
  const assetTotRows: Array<{ name: string; row: number }> = [];
  // Asset-group rows read "{asset} ({phase})". Cost-line names can also end in
  // "(...)" (e.g. "Land (Cash)"), so match the leading token against the real
  // asset names rather than a generic parenthesis test.
  const assetNameSet = new Set(state.assets.filter((x: any) => x.visible !== false).map((x: any) => x.name));
  let mode: '' | 'buildup' | 'alloc' | 't1' | 'summary' = ''; let curAsset = '';
  cap.eachRow((_row, R) => {
    const a = aOf(R);
    if (/^Capex by year, |^Cost build-up by asset|^Asset-Wise/.test(a)) hasOldBuildup = true;
    if (/^Capex Cost Build-up/.test(a)) { mode = 'buildup'; hasBuildup = true; return; }
    if (/^INPUTS - Allocation profile/.test(a)) { mode = 'alloc'; hasInputs = true; return; }
    if (/^Table 1 - /.test(a)) { mode = 't1'; return; }
    if (/^Table [234] - /.test(a)) { mode = 'summary'; return; }
    if (!a) return;
    if (/^Subtotal, /.test(a)) { if (mode === 't1') assetTotRows.push({ name: a.replace(/^Subtotal, /, '').trim(), row: R }); return; }
    if (/^Project Total|^Total Capex|^Grand /.test(a)) return; // build-up grand 'Total Capex' + summary totals
    const base = a.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (assetNameSet.has(base)) { curAsset = base; return; } // asset group row
    if (mode === 'buildup') {
      buildupLineRows.push({ asset: curAsset, name: a, row: R });
      const ev: any = cap.getCell(R, TOTAL_C).value; // D = build-up Total (rate x basis)
      if (ev && typeof ev === 'object' && 'formula' in ev) {
        const f = String(ev.formula);
        if (f.includes("'Land & Area'!")) buildupLinksLandArea = true;
        if (f.includes('Assumptions!')) buildupLinksAssumptions = true;
        if (/Assumptions!\$C\$\d+\*\(\$D\$\d+/.test(f)) { selectedSumLive = true; const inside = f.slice(f.indexOf('(') + 1, f.lastIndexOf(')')); if (inside.split('+').map((s) => s.trim()).includes(`$D$${R}`)) selfRef = true; }
      }
    } else if (mode === 'alloc') {
      for (let t = 0; t < NN; t++) { const v: any = cap.getCell(R, yCol(t)).value; if (typeof v === 'number') allocConstCells++; else if (v && typeof v === 'object' && 'formula' in v) allocFormulaCells++; }
      const ch: any = cap.getCell(R, chkCol).value;
      if (ch !== null && ch !== undefined && ch !== '') allocChecksOk.push(String((ch && ch.result) ?? ch) === 'OK');
    } else if (mode === 't1') {
      t1LineRows.push(R);
      // Table 1 period amounts = build-up Total x allocation % (a $D$.. x $col$.. formula).
      for (let t = 0; t < NN; t++) { const v: any = cap.getCell(R, yCol(t)).value; if (v && typeof v === 'object' && 'formula' in v) { amtYearFormulaCells++; if (!/\$D\$\d+\*\$[A-Z]+\$\d+/.test(String(v.formula))) amtYearConstCells++; } else if (typeof v === 'number') amtYearConstCells++; }
    }
  });

  check('Capex build-up table (rate x basis = Total Capex) is on top', hasBuildup);
  check('Capex INPUTS (allocation %) follow the build-up, before the output tables', hasInputs);
  check('Old interleaved per-asset build-up sections are gone', !hasOldBuildup);
  check('Allocation % are input constants (no formulas)', allocConstCells > 0 && allocFormulaCells === 0, `const=${allocConstCells} formula=${allocFormulaCells}`);
  check('Table 1 period cells are build-up x allocation% formulas', amtYearFormulaCells > 0 && amtYearConstCells === 0, `formula=${amtYearFormulaCells} non=${amtYearConstCells}`);
  check('Every per-line Check reads OK (100% within tol)', allocChecksOk.length > 0 && allocChecksOk.every(Boolean), `ok=${allocChecksOk.filter(Boolean).length}/${allocChecksOk.length}`);
  check('Build-up Total (D) links to Assumptions + Land & Area (live)', buildupLinksAssumptions && buildupLinksLandArea);
  check('Percent-of-selected sums sibling D cells (live)', selectedSumLive);
  check('Percent-of-selected never self-references its own D cell', !selfRef);

  // Identity 1: each build-up line Total (D) == engine line total.
  const engLineAmt = new Map<string, number>();
  for (const ia of capReport.inputAssets) for (const ln of ia.lines) engLineAmt.set(`${ia.assetName.trim()}|${ln.name}`, ln.amount);
  let id1Ok = true; const id1Detail: string[] = [];
  for (const al of buildupLineRows) {
    const eng = engLineAmt.get(`${al.asset}|${al.name}`); if (eng === undefined) continue;
    const tot = num(cap.getCell(al.row, TOTAL_C).value);
    if (!(Math.abs(tot - eng) <= Math.max(1, Math.abs(eng) * 1e-6))) { id1Ok = false; if (id1Detail.length < 5) id1Detail.push(`${al.asset}/${al.name}: wb=${Math.round(tot)} eng=${Math.round(eng)}`); }
  }
  check('Identity 1: each build-up line Total (D) == engine line total', id1Ok && buildupLineRows.length > 0, id1Detail.join('; '));

  // Identity 2: each asset incl-land per-period (F..) == engine perPeriod.
  const inclTbl = capReport.results.find((t) => t.title === 'Total Capex (incl. all land)');
  const assetIncl = new Map<string, number[]>();
  for (const rw of inclTbl?.rows ?? []) if (!(rw as any).isTotal) assetIncl.set(rw.label, (rw.values || []).slice());
  let id2Ok = true; const id2Detail: string[] = [];
  for (const at of assetTotRows) {
    const incl = assetIncl.get(at.name) || [];
    for (let t = 0; t < NN; t++) { const v = num(cap.getCell(at.row, yCol(t)).value); if (!(Math.abs(v - (incl[t] ?? 0)) <= Math.max(1, Math.abs(incl[t] ?? 0) * 1e-6))) { id2Ok = false; if (id2Detail.length < 5) id2Detail.push(`${at.name}[y${t}] wb=${Math.round(v)} eng=${Math.round(incl[t] ?? 0)}`); } }
  }
  check('Identity 2: each period asset total == engine per-period', id2Ok && assetTotRows.length > 0, id2Detail.join('; '));

  // The 4 output tables tie to the snapshot (Total column D).
  const snapGrand = snap.financing.capex.totals.inclAllLand;
  const exclGrand = snap.financing.capex.perPeriod.exclAllLand.slice(0, NN).reduce((s, v) => s + (v ?? 0), 0);
  const exclInKindGrand = snap.financing.capex.perPeriod.exclLandInKind.slice(0, NN).reduce((s, v) => s + (v ?? 0), 0);
  const totD = (re: RegExp): number => { const R = rowLabel(re); return R > 0 ? num(cap.getCell(R, TOTAL_C).value) : NaN; };
  check('Table 1 Project Total (incl. all land) == snapshot grand', Math.abs(totD(/^Project Total \(incl\. all land\)$/) - snapGrand) <= Math.max(1, snapGrand * 1e-6), `wb=${Math.round(totD(/^Project Total \(incl\. all land\)$/))} snap=${Math.round(snapGrand)}`);
  check('Table 2 total (incl. all land) == snapshot grand', Math.abs(totD(/^Total Capex \(incl\. all land\)$/) - snapGrand) <= Math.max(1, snapGrand * 1e-6), `wb=${Math.round(totD(/^Total Capex \(incl\. all land\)$/))} snap=${Math.round(snapGrand)}`);
  check('Table 3 total (excl. land in-kind) == snapshot excl-in-kind', Math.abs(totD(/^Total Capex \(excl\. land in-kind\)$/) - exclInKindGrand) <= Math.max(1, Math.abs(exclInKindGrand) * 1e-6), `wb=${Math.round(totD(/^Total Capex \(excl\. land in-kind\)$/))} snap=${Math.round(exclInKindGrand)}`);
  check('Table 4 total (excl. all land) == snapshot excl-all', Math.abs(totD(/^Total Capex \(excl\. all land\)$/) - exclGrand) <= Math.max(1, Math.abs(exclGrand) * 1e-6), `wb=${Math.round(totD(/^Total Capex \(excl\. all land\)$/))} snap=${Math.round(exclGrand)}`);

  // Checks handoff: a Capex-referencing cell on the Checks sheet ties to the grand.
  const checksWs = wb.getWorksheet('Checks')!;
  let checksTie = false;
  checksWs.eachRow((row) => row.eachCell((c) => { const v: any = c.value; if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number' && Math.abs(v.result - snapGrand) <= Math.max(1, Math.abs(snapGrand) * 1e-6) && /Capex|\$D\$/.test(String(v.formula ?? ''))) checksTie = true; }));
  check('Checks sheet still ties to the Capex grand total (scheduleTotalAddr)', checksTie);

  // ── Display scale: thousands / millions are number-format only ──────────────
  const incRow = rowLabel(/^Project Total \(incl\. all land\)$/);
  const wbK = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', displayScale: 'thousands' });
  const wbM = buildModelWorkbook({ state, projectName: 'X', dateLabel: 'd', displayScale: 'millions' });
  const capK = wbK.getWorksheet('Capex')!; const capM = wbM.getWorksheet('Capex')!;
  const grandFull = num(cap.getCell(incRow, TOTAL_C).value);
  const grandK = num(capK.getCell(incRow, TOTAL_C).value);
  const grandM = num(capM.getCell(incRow, TOTAL_C).value);
  check('Scale: stored grand value is identical at full / thousands / millions', grandFull === grandK && grandFull === grandM && Math.abs(grandFull - snapGrand) <= Math.max(1, snapGrand * 1e-6), `full=${Math.round(grandFull)} k=${Math.round(grandK)} m=${Math.round(grandM)}`);
  check('Scale: thousands money format has one trailing comma', /#,##0,_\)/.test(String(capK.getCell(incRow, TOTAL_C).numFmt)), `fmt=${capK.getCell(incRow, TOTAL_C).numFmt}`);
  check('Scale: millions money format has two trailing commas (1 decimal)', /#,##0\.0,,_\)/.test(String(capM.getCell(incRow, TOTAL_C).numFmt)), `fmt=${capM.getCell(incRow, TOTAL_C).numFmt}`);
  // A Rate cell (column C on a Table-1 line) must NOT be scaled.
  const rateRow = buildupLineRows[0]?.row ?? -1;
  if (rateRow > 0) check('Scale: rate cell (C) is not scaled (no trailing comma)', !/,_\)/.test(String(capK.getCell(rateRow, 3).numFmt)) && !/,,/.test(String(capM.getCell(rateRow, 3).numFmt)), `k=${capK.getCell(rateRow, 3).numFmt} m=${capM.getCell(rateRow, 3).numFmt}`);
  // Zero renders as a dash: the opening (Period 0) cell of a Table-1 line is 0 and
  // carries the accounting money format whose zero section is a dash.
  const t1Row = t1LineRows[0] ?? -1;
  if (t1Row > 0) check('Accounting zero-as-dash on numeric value cells', /"-"/.test(String(cap.getCell(t1Row, OPEN_C).numFmt)), `fmt=${cap.getCell(t1Row, OPEN_C).numFmt}`);
  // Percentages render zero as a dash too (cleaner allocation rows): find a
  // percent-formatted cell on Capex and assert its format carries a dash zero.
  let pctFmt = '';
  cap.eachRow((row) => row.eachCell((c) => { const f = String(c.numFmt ?? ''); if (!pctFmt && /%/.test(f)) pctFmt = f; }));
  check('Percent format renders zero as a dash', /;"-"/.test(pctFmt), `fmt=${pctFmt}`);

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

  // Financing (Module 1 step 5): the debt roll-forward is live (interest =
  // rate x balance links to Assumptions; closing reconciles to the engine).
  const finWs = wb.getWorksheet('Financing')!;
  let finInterestFormula = false;
  const finResults: number[] = [];
  finWs.eachRow((row) => row.eachCell((c) => {
    const v = c.value as any;
    if (v && typeof v === 'object' && 'formula' in v) {
      if (/\)\*Assumptions!/.test(String(v.formula))) finInterestFormula = true; // (opening+draw)*rate
      if (typeof v.result === 'number') finResults.push(v.result);
    }
  }));
  check('Financing interest = rate x balance links to Assumptions', finInterestFormula, 'no (balance)*Assumptions! interest formula found');
  const facs = [...snap.financing.facilities.values()];
  const totClosingLast = facs.reduce((s, f) => s + ((f.outstanding ?? [])[snap.axisLength - 1] ?? 0), 0);
  const totInterest = facs.reduce((s, f) => s + (f.interestAccrued ?? []).slice(0, snap.axisLength).reduce((a, v) => a + (v ?? 0), 0), 0);
  const finNear = (target: number) => target === 0 || finResults.some((x) => Math.abs(x - target) <= Math.max(1000, Math.abs(target) * 1e-6));
  check('Financing closing debt reconciles to engine', finNear(totClosingLast), `closingLast=${Math.round(totClosingLast)}`);
  check('Financing total interest reconciles to engine', finNear(totInterest), `interest=${Math.round(totInterest)}`);

  // ── Financing unit: live per-facility roll-forward + IDC pool + sweep ───────
  // Universal geometry: opening (Period 0) at col E (5), active period t at col
  // 6 + t, Total at col D. The frozen header (dates / index) is at rows 3-4.
  const finY = (t: number): number => 6 + t;
  const finLab = (R: number): string => { const a = finWs.getCell(R, 1).value; return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : ''); };
  const finFac = new Map<string, any>();
  for (const [id, f] of snap.financing.facilities.entries()) { const t = state.financingTranches.find((x: any) => x.id === id); finFac.set((t?.name ?? id), f); }
  type FBlock = { name: string; rows: Record<string, number> };
  const fBlocks: FBlock[] = []; const idcPoolRows: Record<string, number> = {};
  let fCur: FBlock | null = null; let fSection: '' | 'fac' | 'idc' = '';
  let hasDeprecNbv = false; let liveFlowFormulas = 0; let hasSweepRow = false;
  const isLiveFlow = (label: string): boolean => /^(Interest accrued|IDC capitalised|Cash interest paid|Cash sweep repaid|Total drawdown|Closing)/.test(label);
  finWs.eachRow((_row, R) => {
    const lab = finLab(R);
    if (/IDC depreciation|IDC NBV/.test(lab)) hasDeprecNbv = true;
    if (/^Debt movement, /.test(lab)) { fCur = { name: lab.replace(/^Debt movement, /, '').replace(/ \(existing\)$/, '').trim(), rows: {} }; fBlocks.push(fCur); fSection = 'fac'; return; }
    if (/^IDC pool$/.test(lab)) { fSection = 'idc'; fCur = null; return; }
    if (/^Combined debt$|^Equity movement$|^Engine-derived cash budgets/.test(lab)) { fSection = ''; fCur = null; return; }
    if (['Movement', 'Combined', 'IDC', 'Equity', 'Budget'].includes(lab) || !lab) return;
    if (/^Cash sweep repaid/.test(lab)) hasSweepRow = true;
    if (fSection === 'fac' && fCur) { fCur.rows[lab] = R; if (isLiveFlow(lab)) { for (let t = 0; t < NN; t++) { const v: any = finWs.getCell(R, finY(t)).value; if (v && typeof v === 'object' && 'formula' in v) liveFlowFormulas++; } } }
    if (fSection === 'idc' && lab) idcPoolRows[lab] = R;
  });

  check('Financing per-facility flow rows are live formulas (interest / IDC / cash / sweep / closing)', liveFlowFormulas > 0, `formulaCells=${liveFlowFormulas}`);
  check('Cash sweep is broken out as its own row', hasSweepRow);
  check('IDC depreciation / NBV moved out of Financing (no downstream FA rows here)', !hasDeprecNbv);

  // Per-facility reconciliation (cached, per period): closing / interest / IDC / sweep.
  const finRowKeys: [string, (f: any, t: number) => number][] = [
    ['Interest accrued (rate x balance)', (f, t) => f.interestAccrued[t] ?? 0],
    ['IDC capitalised (to debt)', (f, t) => f.interestCapitalized[t] ?? 0],
    ['Cash sweep repaid', (f, t) => f.sweepRepaid[t] ?? 0],
    ['Closing', (f, t) => f.outstanding[t] ?? 0],
  ];
  let finRecOk = true; const finRecDetail: string[] = [];
  for (const b of fBlocks) {
    const f = finFac.get(b.name); if (!f) { finRecOk = false; finRecDetail.push(`${b.name}: no engine facility`); continue; }
    for (const [key, eng] of finRowKeys) {
      const R = b.rows[key]; if (!R) continue; // row may be absent (e.g. no sweep)
      for (let t = 0; t < NN; t++) { const v = num(finWs.getCell(R, finY(t)).value); const e = eng(f, t); if (!(Math.abs(v - e) <= Math.max(1, Math.abs(e) * 1e-6))) { finRecOk = false; if (finRecDetail.length < 6) finRecDetail.push(`${b.name}/${key}[y${t}] wb=${Math.round(v)} eng=${Math.round(e)}`); } }
    }
  }
  check('Financing per-facility closing / interest / IDC / sweep tie to engine', finRecOk && fBlocks.length > 0, finRecDetail.join('; '));

  // IDC pool ties (live structural sums).
  const idcPoolChecks: [string, number[]][] = [
    ['Construction interest', snap.idc.totalConstructionInterestPerPeriod],
    ['Capitalised to debt', snap.financing.combined.totalInterestCapitalized],
    ['Paid in cash (conditional)', snap.financing.combined.totalInterestCapitalizedCashPaid],
    ['Capitalised to asset basis', snap.idc.totalIdcPerPeriod],
  ];
  let idcPoolOk = true; const idcPoolDetail: string[] = [];
  for (const [key, eng] of idcPoolChecks) {
    const R = idcPoolRows[key]; if (!R) { idcPoolOk = false; idcPoolDetail.push(`${key}: row missing`); continue; }
    for (let t = 0; t < NN; t++) { const v = num(finWs.getCell(R, finY(t)).value); const e = eng[t] ?? 0; if (!(Math.abs(v - e) <= Math.max(1, Math.abs(e) * 1e-6))) { idcPoolOk = false; if (idcPoolDetail.length < 6) idcPoolDetail.push(`${key}[y${t}] wb=${Math.round(v)} eng=${Math.round(e)}`); } }
  }
  check('Financing IDC pool ties to engine (construction interest / capitalised / cash / asset basis)', idcPoolOk, idcPoolDetail.join('; '));

  // Equity rows are LIVE formulas (in-kind -> Land & Area, existing -> Assumptions).
  // Gated on the engine actually having that equity (the fixture may have none).
  const sliceSum = (a: number[] | undefined): number => (a ?? []).slice(0, snap.axisLength).reduce((s, v) => s + (v ?? 0), 0);
  const engInKind = sliceSum(snap.financing.equity.inKindPerPeriod);
  const engExisting = sliceSum(snap.financing.equity.existingEquityPerPeriod);
  let inKindRow = -1, existingRow = -1, totalEqRow = -1;
  finWs.eachRow((_row, R) => { const lab = finLab(R); if (/^In-kind equity/.test(lab)) inKindRow = R; if (/^Existing equity/.test(lab)) existingRow = R; if (/^Total equity$/.test(lab)) totalEqRow = R; });
  const rowLinks = (R: number, re: RegExp): boolean => { if (R < 0) return false; for (let t = 0; t < NN; t++) { const v: any = finWs.getCell(R, finY(t)).value; if (v && typeof v === 'object' && 'formula' in v && re.test(String(v.formula))) return true; } return false; };
  check('Equity in-kind row is a live formula linking to Land & Area (when present)', engInKind <= 0 || rowLinks(inKindRow, /Land & Area/), `engInKind=${Math.round(engInKind)}`);
  check('Equity existing row is a live formula linking to Assumptions (when present)', engExisting <= 0 || rowLinks(existingRow, /Assumptions/), `engExisting=${Math.round(engExisting)}`);
  // Total equity is a live sum and ties to the engine.
  let totalEqOk = true;
  if (totalEqRow > 0) for (let t = 0; t < NN; t++) { const v = num(finWs.getCell(totalEqRow, finY(t)).value); const e = (snap.financing.equity.totalPerPeriod ?? [])[t] ?? 0; if (!(Math.abs(v - e) <= Math.max(1, Math.abs(e) * 1e-6))) totalEqOk = false; }
  check('Total equity is live and ties to engine', totalEqRow > 0 && totalEqOk);

  // Cached-cell audit: the ONLY rows holding a nonzero plain-number period cell
  // must be the three named circular budget rows. Everything else is a formula
  // (a missing/zero cached result is fine; exceljs drops result:0). The fixture
  // runs Method 1, where Cash equity is the equity side of the funding split
  // (nonzero); it is 0 on Method-3 deliverables (FMP RE HUB), where the strict
  // exactly-three audit holds (verified by the live-project proof). It is on the
  // same convert-when-CF-lands backlog as the gap-sized debt.
  const budgetLabels = new Set(['Capex drawdown (gap-sized debt)', 'IDC cash budget', 'Cash-sweep budget']);
  const cachedValueRows = new Set<string>();
  finWs.eachRow((_row, R) => {
    const lab = finLab(R);
    if (!lab || ['Movement', 'Combined', 'IDC', 'Equity', 'Budget'].includes(lab)) return;
    for (let t = 0; t < NN; t++) { const v = finWs.getCell(R, finY(t)).value; if (typeof v === 'number' && v !== 0) { cachedValueRows.add(lab); break; } }
  });
  const allowedCached = new Set([...budgetLabels, 'Cash equity']); // cash equity = Method-1 funding-split sibling
  const unexpectedCached = [...cachedValueRows].filter((l) => !allowedCached.has(l));
  check('Cached audit: only budget rows (+ Method-1 cash equity) hold cached values, nothing else', unexpectedCached.length === 0, `unexpected=[${unexpectedCached.join(', ')}]`);

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
  // Iterate flags must be present + correct so Excel converges the future
  // Financing<->CashFlow circularity (load-bearing once budgets go live). The
  // delta (0.001) is far below every Checks tolerance (>= 1), so no residual
  // can break the reconciliation.
  check('iterate count is 100', /<calcPr\b[^>]*iterateCount="100"/.test(wbXml), 'iterateCount missing/incorrect');
  check('iterate delta is 0.001 (tight enough vs Checks tol >= 1)', /<calcPr\b[^>]*iterateDelta="0\.001"/.test(wbXml), 'iterateDelta missing/incorrect');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
