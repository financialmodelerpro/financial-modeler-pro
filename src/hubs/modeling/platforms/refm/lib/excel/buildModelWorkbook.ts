/**
 * buildModelWorkbook.ts
 *
 * Formula-driven Excel model export (PHASE 1: foundation). Builds an ExcelJS
 * workbook from the live project: a Cover/Index, a centralised Assumptions
 * (Inputs) sheet, a formula-driven Timeline, and a Checks/legend sheet. Later
 * phases add the calculation + statement + returns sheets, each formula-linked
 * to the Assumptions and reconciled to the platform snapshot via the
 * { formula, result } cache pattern (see styles.fcell).
 *
 * Conventions: blue inputs, black formulas, green cross-sheet links (FAST).
 * Separation of Inputs (Assumptions) / Calculations / Outputs is structural:
 * inputs live only on Assumptions; every other sheet references them by name or
 * cell, so nothing is hardcoded in the calculations.
 *
 * Pure: reads computeFinancialsSnapshot + state, returns a workbook.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../financials-resolvers';
import { computeReturnsSnapshot } from '../returns-resolvers';
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
import { buildCostOfSalesReport, type ReportTable } from '../reports/cosReports';
import { resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { formatAccounting } from '@/src/core/formatters';
import {
  ARGB, NUMFMT, fcell, setInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
  fillCell, fillRange, boxBorder,
} from './styles';

export interface BuildModelOptions {
  state: FinancialsResolverState;
  projectName: string;
  dateLabel: string;
}

const SHEETS = { cover: 'Cover', assumptions: 'Assumptions', timeline: 'Timeline', landArea: 'Land & Area', capex: 'Capex', revenue: 'Revenue', cos: 'Cost of Sales', opex: 'Opex', checks: 'Checks' };

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  const snap = computeFinancialsSnapshot(opts.state);
  const capex = buildCapexReport(snap, opts.state);
  const cos = buildCostOfSalesReport(snap, opts.state, (v) => String(v));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Financial Modeler Pro';
  wb.created = new Date(0); // deterministic (avoid clock for reproducible output)
  wb.calcProperties.fullCalcOnLoad = true;

  addCover(wb, snap, opts); // first tab; index links to the sheets created below
  const refs = addAssumptions(wb, snap, opts, capex);
  addTimeline(wb, snap, refs);
  addLandArea(wb, opts.state, refs);
  const capexAddrs = addCapex(wb, snap, capex, refs);
  const revAddr = addRevenue(wb, snap, opts.state, refs);
  const cosAddr = addCoS(wb, snap, cos, refs);
  const opexAddr = addOpex(wb, snap, opts.state, refs);
  const revTotal = snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + (v ?? 0), 0);
  const cosTotalRow = cos.find((t) => t.title === 'Project Total Cost of Sales')?.rows.find((rw) => rw.isTotal)?.values ?? [];
  const cosTotal = cosTotalRow.reduce((s, v) => s + (v ?? 0), 0);
  const opexTotal = snap.opex.totalOpexPerPeriodInclHQ.reduce((s, v) => s + (v ?? 0), 0);
  addChecks(wb, snap, capex, capexAddrs, { revAddr, revTotal, cosAddr, cosTotal, opexAddr, opexTotal });
  return wb;
}

export async function generateModelWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const wb = buildModelWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  return enableIterativeCalc(buf);
}

/**
 * ExcelJS hardcodes <calcPr> and cannot emit the iterative-calculation flags the
 * model needs (the debt / IDC / cash-sweep / funding formulas are circular).
 * Post-process the .xlsx zip to add iterate / iterateCount / iterateDelta to
 * xl/workbook.xml so Excel converges the circular formulas on open.
 */
async function enableIterativeCalc(buf: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('xl/workbook.xml');
    if (!f) return buf;
    let xml = await f.async('string');
    const ITER = 'iterate="1" iterateCount="100" iterateDelta="0.001"';
    if (/<calcPr\b/.test(xml)) {
      xml = xml.replace(/<calcPr\b([^>]*?)\/>/, (_m, attrs: string) => {
        const cleaned = attrs.replace(/\s+iterate(Count|Delta)?="[^"]*"/g, '');
        return `<calcPr${cleaned} ${ITER}/>`;
      });
    } else {
      xml = xml.replace('</workbook>', `<calcPr calcId="171027" ${ITER}/></workbook>`);
    }
    zip.file('xl/workbook.xml', xml);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return buf; // never block the export on the calc-flag tweak
  }
}

// Cell references the rest of the model links to (defined-name targets).
interface CapexLineRef {
  name: string;
  /** Absolute cross-sheet address of the rate / % input cell on Assumptions. */
  rateAddr: string;
  /** Absolute address of the quantity / basis input cell, null for fixed lumps. */
  qtyAddr: string | null;
  amount: number;
}
interface CapexAssetRef { name: string; phaseName: string; total: number; lines: CapexLineRef[] }

// Absolute cell addresses on the Assumptions sheet, captured as inputs are
// written, so the calc sheets reference inputs by cell (nothing hardcoded).
interface AssetInputRef {
  id: string; name: string; phaseId: string; strategy: string;
  bua: string; nsa: string; gfa: string; support: string; parking: string;
  parkingBays: string; usefulLife: string; landSqm: string; landRate: string;
}
interface SubUnitInputRef { id: string; assetId: string; category: string; metric: string; value: string; unitArea: string; price: string }
interface ParcelInputRef { id: string; area: string; rate: string; cashPct: string; inKindPct: string }
interface TrancheInputRef { id: string; name: string; openingBalance: string; rate: string; periods: string }
interface EquityInputRef { id: string; name: string; amount: string }

interface AssumptionRefs {
  startYearName: string;
  axisLength: number;
  capex: CapexAssetRef[];
  assets: AssetInputRef[];
  subUnits: SubUnitInputRef[];
  parcels: ParcelInputRef[];
  tranches: TrancheInputRef[];
  equity: EquityInputRef[];
}

// ── Assumptions (Inputs) ──────────────────────────────────────────────────────
function addAssumptions(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, capex: CapexReport): AssumptionRefs {
  const ws = wb.addWorksheet(SHEETS.assumptions, { properties: { tabColor: { argb: ARGB.input } } });
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  for (let c = 3; c <= 12; c++) ws.getColumn(c).width = 14;
  const p = opts.state.project;
  const fin = snap.financing;
  const assetRefs: AssetInputRef[] = [];
  const subUnitRefs: SubUnitInputRef[] = [];
  const parcelRefs: ParcelInputRef[] = [];
  const trancheRefs: TrancheInputRef[] = [];
  const equityRefs: EquityInputRef[] = [];
  const addr = (col: string, row: number): string => `${SHEETS.assumptions}!$${col}$${row}`;
  let r = 1;
  setTitle(ws.getCell(`A${r}`), 'Assumptions (Inputs)', 16); r += 1;
  setLabel(ws.getCell(`A${r}`), 'All blue cells are inputs. Edit here; the model recalculates throughout.', { }); r += 2;

  // Project section.
  setSectionHeader(ws.getRow(r), 'Project', 5); r += 1;
  const addKV = (label: string, value: number | string, numFmt: string, name?: string): number => {
    setLabel(ws.getCell(`A${r}`), label);
    setInput(ws.getCell(`B${r}`), value, numFmt);
    if (name) wb.definedNames.add(`${SHEETS.assumptions}!$B$${r}`, name);
    const row = r; r += 1; return row;
  };
  addKV('Project name', p.name || '(unnamed)', '@');
  addKV('Currency', p.currency ?? 'SAR', '@');
  addKV('Location', [p.location, p.country].filter(Boolean).join(', ') || '-', '@');
  const taxRow = addKV('Tax / Zakat rate', p.tax?.rate ?? 0, NUMFMT.pct2, 'TaxRate');
  addKV('Minimum cash reserve', p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0, NUMFMT.money, 'MinCashReserve');
  setLabel(ws.getCell(`A${r}`), 'Funding method'); setInput(ws.getCell(`B${r}`), FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId], '@'); r += 1;
  const debtRow = addKV('Debt share', fin.funding.debtPct / 100, NUMFMT.pct, 'DebtPct');
  addKV('Equity share', fin.funding.equityPct / 100, NUMFMT.pct, 'EquityPct');
  addKV('Country', p.country ?? '-', '@');
  addKV('Financial terminology', String(p.financialTerminology ?? 'standard'), '@');
  addKV('Tax / Zakat payment (days)', p.tax?.paymentDays ?? 0, NUMFMT.int);
  addKV('Statutory reserve transfer (% of PAT)', p.statutoryReserve?.transferRate ?? 0, NUMFMT.pct);
  addKV('Statutory reserve cap (% share capital)', p.statutoryReserve?.capOfShareCapital ?? 0, NUMFMT.pct);
  addKV('Share capital (explicit, 0 = auto)', p.shareCapital ?? 0, NUMFMT.money);
  addKV('Operating receivables, DSO (days)', p.operatingAr?.dsoDays ?? 0, NUMFMT.int, 'DsoDays');
  addKV('Opex payables, DPO (days)', p.opexAp?.defaultApDays ?? 0, NUMFMT.int, 'DpoDays');
  addKV('Pre-sales escrow held %', p.escrow?.heldPct ?? 0, NUMFMT.pct);
  addKV('IDC capitalize (1 = yes)', p.idcConfig?.capitalize === false ? 0 : 1, NUMFMT.int);
  addKV('IDC allocation basis', String(p.idcConfig?.allocationBasis ?? 'land'), '@');
  addKV('IDC funding mode', String(p.idcConfig?.fundingMode ?? 'debt_drawdown'), '@');
  addKV('Dividends enabled (1 = yes)', p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int);
  addKV('Dividend payout ratio %', (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct);
  addKV('Dividend start year (0 = auto)', p.dividendStartYear ?? 0, NUMFMT.year);
  void taxRow; void debtRow;
  r += 1;

  // Phases section.
  setSectionHeader(ws.getRow(r), 'Phases', 5); r += 1;
  ['Phase', 'Start year', 'Construction yrs', 'Operations yrs', 'Status'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const phaseStartCells: string[] = [];
  for (const ph of opts.state.phases) {
    const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : snap.projectStartYear;
    setLabel(ws.getCell(`A${r}`), ph.name);
    setInput(ws.getCell(`B${r}`), sy, NUMFMT.year);
    setInput(ws.getCell(`C${r}`), ph.constructionPeriods ?? 0, NUMFMT.int);
    setInput(ws.getCell(`D${r}`), ph.operationsPeriods ?? 0, NUMFMT.int);
    setInput(ws.getCell(`E${r}`), String(ph.status ?? 'planning'), '@');
    phaseStartCells.push(`$B$${r}`);
    r += 1;
  }
  // Project start year = MIN(phase start years): a formula over the inputs.
  setLabel(ws.getCell(`A${r}`), 'Project start year (model axis origin)', { bold: true });
  setFormula(ws.getCell(`B${r}`), fcell(`MIN(${phaseStartCells.join(',')})`, snap.projectStartYear), NUMFMT.year);
  wb.definedNames.add(`${SHEETS.assumptions}!$B$${r}`, 'ProjectStartYear');
  r += 2;

  // Land parcels.
  if (opts.state.parcels.length) {
    setSectionHeader(ws.getRow(r), 'Land parcels', 7); r += 1;
    ['Parcel', 'Area (sqm)', 'Rate /sqm', 'Cash %', 'In-kind %', 'Roads %', 'Parks %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const pa of opts.state.parcels) {
      setLabel(ws.getCell(`A${r}`), pa.name);
      setInput(ws.getCell(`B${r}`), pa.area ?? 0, NUMFMT.int);
      setInput(ws.getCell(`C${r}`), pa.rate ?? 0, NUMFMT.money);
      setInput(ws.getCell(`D${r}`), (pa.cashPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`E${r}`), (pa.inKindPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`F${r}`), (pa.roadsPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`G${r}`), (pa.parksPct ?? 0) / 100, NUMFMT.pct);
      parcelRefs.push({ id: pa.id, area: addr('B', r), rate: addr('C', r), cashPct: addr('D', r), inKindPct: addr('E', r) });
      r += 1;
    }
    r += 1;
  }

  // Assets (area schedule + depreciation).
  const visibleAssets = opts.state.assets.filter((a) => a.visible !== false);
  if (visibleAssets.length) {
    setSectionHeader(ws.getRow(r), 'Assets', 11); r += 1;
    ['Asset', 'Strategy', 'BUA (sqm)', 'NSA (sqm)', 'GFA (sqm)', 'Support (sqm)', 'Parking (sqm)', 'Parking bays', 'Land (sqm)', 'Land rate /sqm', 'Useful life (yrs)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const a of visibleAssets) {
      setLabel(ws.getCell(`A${r}`), a.name);
      setInput(ws.getCell(`B${r}`), a.strategy, '@');
      setInput(ws.getCell(`C${r}`), a.buaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`D${r}`), a.sellableBuaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`E${r}`), a.gfaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`F${r}`), a.supportArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), a.parkingArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), a.parkingBaysRequired ?? 0, NUMFMT.int);
      setInput(ws.getCell(`I${r}`), a.landAllocation?.sqm ?? a.landAreaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`J${r}`), a.landAllocation?.customRate ?? 0, NUMFMT.money);
      setInput(ws.getCell(`K${r}`), a.usefulLifeYears ?? 0, NUMFMT.int);
      assetRefs.push({
        id: a.id, name: a.name, phaseId: a.phaseId, strategy: a.strategy,
        bua: addr('C', r), nsa: addr('D', r), gfa: addr('E', r), support: addr('F', r), parking: addr('G', r),
        parkingBays: addr('H', r), landSqm: addr('I', r), landRate: addr('J', r), usefulLife: addr('K', r),
      });
      r += 1;
    }
    r += 1;
  }

  // Sub-units (revenue / area drivers).
  if (opts.state.subUnits.length) {
    setSectionHeader(ws.getRow(r), 'Sub-units', 9); r += 1;
    ['Sub-unit', 'Asset', 'Category', 'Metric', 'Quantity', 'Unit area (sqm)', 'Price / ADR', 'Occupancy %', 'Margin %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const u of opts.state.subUnits) {
      const aName = opts.state.assets.find((a) => a.id === u.assetId)?.name ?? u.assetId;
      setLabel(ws.getCell(`A${r}`), u.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), aName);
      setInput(ws.getCell(`C${r}`), String(u.category), '@');
      setInput(ws.getCell(`D${r}`), String(u.metric), '@');
      setInput(ws.getCell(`E${r}`), u.metricValue ?? 0, NUMFMT.int);
      setInput(ws.getCell(`F${r}`), u.unitArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), u.startingAdr ?? u.unitPrice ?? 0, NUMFMT.money);
      setInput(ws.getCell(`H${r}`), (u.occupancyPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`I${r}`), (u.operatingMargin ?? 0) / 100, NUMFMT.pct);
      subUnitRefs.push({ id: u.id, assetId: u.assetId, category: addr('C', r), metric: addr('D', r), value: addr('E', r), unitArea: addr('F', r), price: addr('G', r) });
      r += 1;
    }
    r += 1;
  }

  // Returns config section.
  setSectionHeader(ws.getRow(r), 'Returns & Valuation assumptions', 5); r += 1;
  const cfg = opts.state.project.returns;
  addKV('Discount rate', cfg?.discountRate ?? 0.1, NUMFMT.pct, 'DiscountRate');
  addKV('Exit year (offset from start, 0-based)', cfg?.exitYearOffset ?? (snap.axisLength - 1), NUMFMT.int, 'ExitYearOffset');
  setLabel(ws.getCell(`A${r}`), 'Terminal value method'); setInput(ws.getCell(`B${r}`), String(cfg?.terminalMethod ?? 'exit_multiple'), '@'); r += 1;
  addKV('Exit multiple (x stabilised NOI)', cfg?.exitMultiple ?? 8, NUMFMT.mult, 'ExitMultiple');
  addKV('Perpetuity growth', cfg?.perpetuityGrowth ?? 0.02, NUMFMT.pct, 'PerpetuityGrowth');
  r += 1;

  // Capex cost lines (rate inputs + quantity / basis drivers). The Capex sheet
  // multiplies these to produce each line amount, so editing a rate here flows
  // through the model. Percent-method rates are stored as decimals (0.10) and
  // multiply a money basis; rate methods multiply a physical quantity; a fixed
  // lump has no quantity.
  setSectionHeader(ws.getRow(r), 'Capex cost lines (rate x quantity, or % x basis)', 5); r += 1;
  ['Asset / Cost line', 'Method', 'Rate / %', 'Quantity / Basis', ''].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const capexRefs: CapexAssetRef[] = [];
  for (const ia of capex.inputAssets) {
    setLabel(ws.getCell(`A${r}`), `${ia.assetName}  (${ia.phaseName})`, { bold: true });
    fillRange(ws, r, 1, r, 5, ARGB.subtotal);
    r += 1;
    const lineRefs: CapexLineRef[] = [];
    for (const ln of ia.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), ln.basis);
      if (ln.isPercent) setInput(ws.getCell(`C${r}`), ln.rate / 100, NUMFMT.pct2);
      else setInput(ws.getCell(`C${r}`), ln.rate, NUMFMT.money);
      const hasQty = !ln.isFixed && ln.metricValue !== null;
      if (hasQty) setInput(ws.getCell(`D${r}`), ln.metricValue as number, ln.metricKind === 'money' ? NUMFMT.money : NUMFMT.int);
      lineRefs.push({
        name: ln.name,
        rateAddr: `${SHEETS.assumptions}!$C$${r}`,
        qtyAddr: hasQty ? `${SHEETS.assumptions}!$D$${r}` : null,
        amount: ln.amount,
      });
      r += 1;
    }
    capexRefs.push({ name: ia.assetName, phaseName: ia.phaseName, total: ia.total, lines: lineRefs });
  }
  r += 1;

  // Financing facilities (debt).
  if (opts.state.financingTranches.length) {
    setSectionHeader(ws.getRow(r), 'Financing facilities (debt)', 8); r += 1;
    ['Facility', 'Origin', 'Opening balance', 'Interest rate %', 'Drawdown method', 'Repayment method', 'Repay periods', 'IDC capitalize'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const t of opts.state.financingTranches) {
      const rate = t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0));
      setLabel(ws.getCell(`A${r}`), t.name);
      setInput(ws.getCell(`B${r}`), String(t.origin ?? 'new'), '@');
      setInput(ws.getCell(`C${r}`), t.openingBalance ?? 0, NUMFMT.money);
      setInput(ws.getCell(`D${r}`), rate / 100, NUMFMT.pct2);
      setInput(ws.getCell(`E${r}`), String(t.drawdownMethod ?? '-'), '@');
      setInput(ws.getCell(`F${r}`), String(t.repaymentMethod ?? '-'), '@');
      setInput(ws.getCell(`G${r}`), t.repaymentPeriods ?? 0, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), t.idcCapitalize ? 1 : 0, NUMFMT.int);
      trancheRefs.push({ id: t.id, name: t.name, openingBalance: addr('C', r), rate: addr('D', r), periods: addr('G', r) });
      r += 1;
    }
    r += 1;
  }

  // Equity contributions.
  if (opts.state.equityContributions.length) {
    setSectionHeader(ws.getRow(r), 'Equity contributions', 4); r += 1;
    ['Contribution', 'Amount', 'Timing', 'Type'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const e of opts.state.equityContributions) {
      setLabel(ws.getCell(`A${r}`), e.name);
      setInput(ws.getCell(`B${r}`), e.amount ?? 0, NUMFMT.money);
      setInput(ws.getCell(`C${r}`), String(e.timing ?? 'upfront'), '@');
      setInput(ws.getCell(`D${r}`), String(e.type ?? 'cash'), '@');
      equityRefs.push({ id: e.id, name: e.name, amount: addr('B', r) });
      r += 1;
    }
    r += 1;
  }

  ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return {
    startYearName: 'ProjectStartYear', axisLength: snap.axisLength, capex: capexRefs,
    assets: assetRefs, subUnits: subUnitRefs, parcels: parcelRefs, tranches: trancheRefs, equity: equityRefs,
  };
}

// ── Timeline (formula-driven year axis) ───────────────────────────────────────
function addTimeline(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, refs: AssumptionRefs): void {
  const ws = wb.addWorksheet(SHEETS.timeline, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 28;
  setTitle(ws.getCell('A1'), 'Timeline', 16);
  setLabel(ws.getCell('A2'), 'The model year axis. Every calculation sheet references these columns.');

  const N = refs.axisLength;
  // Column B = Opening (prior year, projectStartYear - 1); column C = period 0
  // (projectStartYear); then +1 per column. This leading Opening column mirrors
  // the platform's results tables (which lead with projectStartYear - 1) and is
  // the axis every period sheet references via Timeline!<col>6.
  const openingCol = 2;
  const period0Col = 3;
  setColHeader(ws.getCell(4, 1), 'Period', 'left');
  setColHeader(ws.getCell(4, openingCol), 'Opening', 'right');
  for (let t = 0; t < N; t++) { const c = period0Col + t; ws.getColumn(c).width = 11; setColHeader(ws.getCell(4, c), t, 'right'); }

  // Period index row: Opening = -1, then 0, 1, ... (+1 per column).
  setLabel(ws.getCell('A5'), 'Period index', { bold: true });
  setFormula(ws.getCell(5, openingCol), fcell('-1', -1), NUMFMT.int);
  for (let t = 0; t < N; t++) {
    const prev = colLetter(period0Col + t - 1);
    setFormula(ws.getCell(5, period0Col + t), fcell(`${prev}5+1`, t), NUMFMT.int);
  }
  // Year row: Opening = ProjectStartYear - 1, period 0 = ProjectStartYear, +1.
  setLabel(ws.getCell('A6'), 'Year', { bold: true });
  ws.getColumn(openingCol).width = 11;
  setFormula(ws.getCell(6, openingCol), fcell('ProjectStartYear-1', snap.projectStartYear - 1), NUMFMT.year, true);
  for (let t = 0; t < N; t++) {
    const prev = colLetter(period0Col + t - 1);
    setFormula(ws.getCell(6, period0Col + t), fcell(t === 0 ? 'ProjectStartYear' : `${prev}6+1`, snap.yearLabels[t] ?? snap.projectStartYear + t), NUMFMT.year, true);
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }];
}

// ── Land & Area (formula area hierarchy + land value, links to Assumptions) ────
function addLandArea(wb: ExcelJS.Workbook, state: FinancialsResolverState, refs: AssumptionRefs): void {
  const ws = wb.addWorksheet(SHEETS.landArea, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 28;
  for (let c = 2; c <= 12; c++) ws.getColumn(c).width = 13;
  setTitle(ws.getCell('A1'), 'Land & Area', 16);
  setLabel(ws.getCell('A2'), 'Area hierarchy (NSA -> BUA -> GFA) and land value, computed from the Assumptions inputs.');

  // Engine metrics per asset, cached so the formulas reconcile to the platform.
  const metricsById = new Map<string, AssetAreaMetrics>();
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const inPhase = state.assets.filter((x) => x.phaseId === a.phaseId);
    metricsById.set(a.id, resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode));
  }
  const sub = (id: string): SubUnitInputRef | undefined => refs.subUnits.find((s) => s.id === id);
  const suRaw = new Map(state.subUnits.map((u) => [u.id, u] as const));

  let r = 4;
  // ── Section 1: sub-unit areas (drivers for the NSA hierarchy) ──
  setSectionHeader(ws.getRow(r), 'Sub-unit areas', 7); r += 1;
  ['Sub-unit', 'Asset', 'Category', 'Metric', 'Area (sqm)', 'NSA area', 'Support area'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const suCells = new Map<string, { nsa: string; support: string }>(); // sub-unit id -> this-sheet cells
  for (const sr of refs.subUnits) {
    const u = suRaw.get(sr.id);
    if (!u) continue;
    const aName = state.assets.find((a) => a.id === sr.assetId)?.name ?? sr.assetId;
    const area = u.metric === 'area' ? (u.metricValue ?? 0) : (u.metricValue ?? 0) * (u.unitArea ?? 0);
    const isNsa = u.category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable';
    const isSupport = u.category === 'Support';
    setLabel(ws.getCell(`A${r}`), u.name, { indent: 1 });
    setLabel(ws.getCell(`B${r}`), aName);
    setFormula(ws.getCell(`C${r}`), fcell(sr.category, String(u.category)), '@', true);
    setFormula(ws.getCell(`D${r}`), fcell(sr.metric, String(u.metric)), '@', true);
    // Area = IF(metric="area", value, value * unitArea)
    setFormula(ws.getCell(`E${r}`), fcell(`IF(${sr.metric}="area",${sr.value},${sr.value}*${sr.unitArea})`, area), NUMFMT.int, true);
    const areaCell = `E${r}`;
    setFormula(ws.getCell(`F${r}`), fcell(`IF(OR(C${r}="Sellable",C${r}="Operable",C${r}="Leasable"),${areaCell},0)`, isNsa ? area : 0), NUMFMT.int);
    setFormula(ws.getCell(`G${r}`), fcell(`IF(C${r}="Support",${areaCell},0)`, isSupport ? area : 0), NUMFMT.int);
    suCells.set(sr.id, { nsa: `${SHEETS.landArea}!F${r}`, support: `${SHEETS.landArea}!G${r}` });
    r += 1;
  }
  r += 1;

  // ── Section 2: asset area hierarchy + land ──
  setSectionHeader(ws.getRow(r), 'Asset area & land', 12); r += 1;
  ['Asset', 'NSA', 'Support', 'BUA', 'Parking', 'GFA', 'Parking bays', 'Land (sqm)', 'Land rate', 'Land value', 'Cash land', 'In-kind land'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;

  // Pass 1: hierarchy rows; capture each asset's BUA cell for cross-asset land share.
  interface ARow { ref: AssetInputRef; row: number; buaCell: string }
  const aRows: ARow[] = [];
  for (const ar of refs.assets) {
    const m = metricsById.get(ar.id);
    const mySub = refs.subUnits.filter((s) => s.assetId === ar.id).map((s) => suCells.get(s.id)).filter(Boolean) as Array<{ nsa: string; support: string }>;
    const nsaSub = mySub.length ? mySub.map((c) => c.nsa).join('+') : '0';
    const supSub = mySub.length ? mySub.map((c) => c.support).join('+') : '0';
    setLabel(ws.getCell(`A${r}`), ar.name);
    // NSA = MAX(asset NSA input, sub-unit NSA); Support = asset support + sub-unit support
    setFormula(ws.getCell(`B${r}`), fcell(`MAX(${ar.nsa},${nsaSub})`, m?.nsa ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`C${r}`), fcell(`${ar.support}+(${supSub})`, m?.supportArea ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`D${r}`), fcell(`MAX(${ar.bua},B${r}+C${r})`, m?.bua ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`E${r}`), fcell(ar.parking, m?.parkingArea ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`F${r}`), fcell(`MAX(${ar.gfa},D${r}+E${r})`, m?.gfa ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`G${r}`), fcell(ar.parkingBays, m?.parkingBays ?? 0), NUMFMT.int, true);
    aRows.push({ ref: ar, row: r, buaCell: `D${r}` });
    r += 1;
  }

  // Pass 2: land columns (need cross-asset BUA for the auto-by-BUA share).
  const parcelPhase = new Map(state.parcels.map((p) => [p.id, p.phaseId] as const));
  const parcelsInPhase = (phaseId: string): ParcelInputRef[] => refs.parcels.filter((p) => parcelPhase.get(p.id) === phaseId);
  for (const row of aRows) {
    const m = metricsById.get(row.ref.id);
    const ph = row.ref.phaseId;
    const pcs = parcelsInPhase(ph);
    const landTotal = pcs.length ? pcs.map((p) => p.area).join('+') : '0';
    const landValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}`).join('+') : '0';
    const cashValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}*${p.cashPct}`).join('+') : '0';
    const phaseBua = aRows.filter((x) => x.ref.phaseId === ph).map((x) => x.buaCell).join('+') || '0';
    // Land sqm: explicit input if set, else phase land x this BUA / phase BUA.
    setFormula(ws.getCell(`H${row.row}`), fcell(`IF(${row.ref.landSqm}>0,${row.ref.landSqm},IFERROR((${landTotal})*${row.buaCell}/(${phaseBua}),0))`, m?.landSqm ?? 0), NUMFMT.int, true);
    // Land rate: explicit input if set, else phase weighted average.
    setFormula(ws.getCell(`I${row.row}`), fcell(`IF(${row.ref.landRate}>0,${row.ref.landRate},IFERROR((${landValueF})/(${landTotal}),0))`, (m && m.landSqm > 0) ? m.landValue / m.landSqm : 0), NUMFMT.money, true);
    setFormula(ws.getCell(`J${row.row}`), fcell(`H${row.row}*I${row.row}`, m?.landValue ?? 0), NUMFMT.money);
    // Cash / in-kind split via the phase cash fraction.
    setFormula(ws.getCell(`K${row.row}`), fcell(`J${row.row}*IFERROR((${cashValueF})/(${landValueF}),0)`, m?.cashLandValue ?? 0), NUMFMT.money);
    setFormula(ws.getCell(`L${row.row}`), fcell(`J${row.row}-K${row.row}`, m?.inKindLandValue ?? 0), NUMFMT.money);
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
}

// ── Capex (cost build-up + phased schedule) ───────────────────────────────────
interface CapexAddrs { scheduleTotalAddr: string; buildupTotalAddr: string }

function addCapex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, refs: AssumptionRefs): CapexAddrs {
  const ws = wb.addWorksheet(SHEETS.capex, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 16;
  const N = refs.axisLength;
  const firstCol = 2; // column B = period 0, mirroring the Timeline axis

  setTitle(ws.getCell('A1'), 'Capex', 16);
  setLabel(ws.getCell('A2'), 'Development cost build-up per asset (rates link to Assumptions), then phased onto the model timeline.');

  let r = 4;

  // ── Section 1: cost build-up by asset (formula-driven, links to Assumptions) ──
  setSectionHeader(ws.getRow(r), 'Cost build-up by asset', 2); r += 1;
  setColHeader(ws.getCell(r, 1), 'Asset / Cost line', 'left');
  setColHeader(ws.getCell(r, 2), 'Amount', 'right');
  r += 1;
  const assetSubtotalRows: number[] = [];
  for (const a of refs.capex) {
    setLabel(ws.getCell(`A${r}`), `${a.name}  (${a.phaseName})`, { bold: true });
    fillRange(ws, r, 1, r, 2, ARGB.subtotal);
    r += 1;
    const lineRows: number[] = [];
    for (const ln of a.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      // amount = rate x quantity (rate / percent methods) or rate (fixed lump).
      const formula = ln.qtyAddr ? `${ln.rateAddr}*${ln.qtyAddr}` : `${ln.rateAddr}`;
      setFormula(ws.getCell(`B${r}`), fcell(formula, ln.amount), NUMFMT.money, true);
      lineRows.push(r);
      r += 1;
    }
    setLabel(ws.getCell(`A${r}`), `Subtotal, ${a.name}`, { bold: true });
    const sumRange = lineRows.length ? `SUM(B${lineRows[0]}:B${lineRows[lineRows.length - 1]})` : '0';
    setFormula(ws.getCell(`B${r}`), fcell(sumRange, a.total), NUMFMT.money);
    ws.getCell(`B${r}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.formula } };
    fillRange(ws, r, 1, r, 2, ARGB.grey);
    assetSubtotalRows.push(r);
    r += 1;
  }
  const buildupTotalCached = refs.capex.reduce((s, a) => s + a.total, 0);
  setLabel(ws.getCell(`A${r}`), 'Total development cost (incl. all land)', { bold: true });
  const subSum = assetSubtotalRows.length ? assetSubtotalRows.map((rr) => `B${rr}`).join('+') : '0';
  setFormula(ws.getCell(`B${r}`), fcell(subSum, buildupTotalCached), NUMFMT.money);
  fillRange(ws, r, 1, r, 2, ARGB.navy);
  ws.getCell(`A${r}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.white } };
  ws.getCell(`B${r}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.white } };
  const buildupTotalAddr = `${SHEETS.capex}!$B$${r}`;
  r += 2;

  // ── Section 2: capex phased by period (incl. all land) ──
  const totalCol = periodTotalCol(firstCol, N);
  setSectionHeader(ws.getRow(r), 'Capex by period (incl. all land)', totalCol); r += 1;
  periodHeader(ws, r, firstCol, N, snap, 'Asset'); r += 1;

  const inclTable = capex.results.find((t) => t.title === 'Total Capex (incl. all land)');
  const assetRows = (inclTable?.rows ?? []).filter((rw) => !rw.isTotal);
  const assetPeriodRows: number[] = [];
  for (const ar of assetRows) {
    cachedRow(ws, r, firstCol, N, totalCol, ar.label, ar.values, { indent: 1 });
    assetPeriodRows.push(r);
    r += 1;
  }
  const inclAll = snap.financing.capex.perPeriod.inclAllLand;
  navySumRow(ws, r, firstCol, N, totalCol, 'Total capex (incl. all land)', assetPeriodRows, inclAll);
  const scheduleTotalAddr = `${SHEETS.capex}!$${colLetter(totalCol)}$${r}`;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
  return { scheduleTotalAddr, buildupTotalAddr };
}

// ── Shared period-sheet helpers (Timeline-anchored tables) ────────────────────
const nz = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

// Period-axis geometry (mirrors the platform's displayed axis):
//   firstCol   = Opening column (prior year = projectStartYear - 1, carries
//                opening balances; flows are 0 here)
//   firstCol+1 .. firstCol+N = the N active periods (projectStartYear ...)
//   firstCol+N+1 = Total column (sums the active periods only, not Opening)
const periodCol = (firstCol: number, t: number): number => firstCol + 1 + t;       // period t column
const periodTotalCol = (firstCol: number, N: number): number => firstCol + N + 1;  // Total column
const periodRange = (firstCol: number, N: number, r: number): string =>
  `${colLetter(periodCol(firstCol, 0))}${r}:${colLetter(periodCol(firstCol, N - 1))}${r}`;

/** Write the period header row: label col + Opening col + year cols (linked to
 *  the Timeline year row) + a Total col. Returns the 1-based Total column index. */
function periodHeader(ws: ExcelJS.Worksheet, r: number, firstCol: number, N: number, snap: ReturnType<typeof computeFinancialsSnapshot>, labelCol: string): number {
  const totalCol = periodTotalCol(firstCol, N);
  setColHeader(ws.getCell(r, 1), labelCol, 'left');
  const yearHdr = (c: number, cached: number): void => {
    ws.getColumn(c).width = 12;
    const cell = ws.getCell(r, c);
    setFormula(cell, fcell(`Timeline!${colLetter(c)}6`, cached), NUMFMT.year, true);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    cell.alignment = { horizontal: 'right' };
  };
  yearHdr(firstCol, snap.projectStartYear - 1); // Opening (prior year)
  for (let t = 0; t < N; t++) yearHdr(periodCol(firstCol, t), snap.yearLabels[t] ?? snap.projectStartYear + t);
  ws.getColumn(totalCol).width = 14;
  setColHeader(ws.getCell(r, totalCol), 'Total', 'right');
  return totalCol;
}

/** A data row: Opening cell + cached per-period values + Total = SUM(active). */
function cachedRow(ws: ExcelJS.Worksheet, r: number, firstCol: number, N: number, totalCol: number, label: string, values: number[], opts: { indent?: number; bold?: boolean } = {}, opening = 0): void {
  setLabel(ws.getCell(`A${r}`), label, opts);
  const money = (c: number, v: number): void => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { name: 'Calibri', size: 10, color: { argb: ARGB.formula } };
    cell.numFmt = NUMFMT.money;
  };
  money(firstCol, opening);
  for (let t = 0; t < N; t++) money(periodCol(firstCol, t), values[t] ?? 0);
  setFormula(ws.getCell(r, totalCol), fcell(`SUM(${periodRange(firstCol, N, r)})`, values.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
}

/** A total row whose Opening + period cells are the SUM of the given source rows
 *  (formula), platform values cached. style 'navy' = grand total; 'subtotal' = grey. */
function navySumRow(ws: ExcelJS.Worksheet, r: number, firstCol: number, N: number, totalCol: number, label: string, sourceRows: number[], cachedPerPeriod: number[], style: 'navy' | 'subtotal' = 'navy', openingCached = 0): void {
  setLabel(ws.getCell(`A${r}`), label, { bold: true });
  const sumCol = (c: number, cached: number): void => {
    const col = colLetter(c);
    const f = sourceRows.length ? sourceRows.map((rr) => `${col}${rr}`).join('+') : '0';
    setFormula(ws.getCell(r, c), fcell(f, cached), NUMFMT.money);
  };
  sumCol(firstCol, openingCached);
  for (let t = 0; t < N; t++) sumCol(periodCol(firstCol, t), cachedPerPeriod[t] ?? 0);
  setFormula(ws.getCell(r, totalCol), fcell(`SUM(${periodRange(firstCol, N, r)})`, cachedPerPeriod.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
  const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal;
  const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
  fillRange(ws, r, 1, r, totalCol, fill);
  for (let c = 1; c <= totalCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: fg } };
}

// ── Revenue (per-asset detail + project summary) ──────────────────────────────
function addRevenue(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 34;
  const N = refs.axisLength;
  const firstCol = 2;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  setTitle(ws.getCell('A1'), 'Revenue', 16);
  setLabel(ws.getCell('A2'), 'Recognised revenue by strategy and asset, phased onto the model timeline. Total revenue sums the strategy components.');

  // Project revenue summary (formula total over the three strategy components).
  let r = 4;
  setSectionHeader(ws.getRow(r), 'Project revenue summary', periodTotalCol(firstCol, N)); r += 1;
  const tCol = periodHeader(ws, r, firstCol, N, snap, 'Revenue'); r += 1;
  const compRows: number[] = [];
  cachedRow(ws, r, firstCol, N, tCol, 'Residential revenue', snap.pl.residentialRevenuePerPeriod); compRows.push(r); r += 1;
  cachedRow(ws, r, firstCol, N, tCol, 'Hospitality revenue', snap.pl.hospitalityRevenuePerPeriod); compRows.push(r); r += 1;
  cachedRow(ws, r, firstCol, N, tCol, 'Retail revenue', snap.pl.retailRevenuePerPeriod); compRows.push(r); r += 1;
  navySumRow(ws, r, firstCol, N, tCol, 'Total revenue', compRows, snap.pl.totalRevenuePerPeriod);
  const totalAddr = `'${SHEETS.revenue}'!$${colLetter(tCol)}$${r}`;
  r += 2;

  // Revenue detail by asset (cached series, informational; row totals are SUM).
  const dCol = periodTotalCol(firstCol, N);
  setSectionHeader(ws.getRow(r), 'Revenue detail by asset', dCol); r += 1;
  periodHeader(ws, r, firstCol, N, snap, 'Asset'); r += 1;
  const group = (title: string, entries: Array<[string, number[]]>): void => {
    const present = entries.filter(([, v]) => nz(v));
    if (!present.length) return;
    setLabel(ws.getCell(`A${r}`), title, { bold: true });
    fillRange(ws, r, 1, r, dCol, ARGB.subtotal); r += 1;
    for (const [id, v] of present) { cachedRow(ws, r, firstCol, N, dCol, assetName(id), v, { indent: 1 }); r += 1; }
  };
  group('Residential / Sell', [...snap.revenue.bySellAsset.entries()].map(([id, rv]) => [id, rv.recognitionPerPeriod] as [string, number[]]));
  group('Hospitality', [...snap.revenue.byHospitalityAsset.entries()].map(([id, rv]) => [id, rv.totalRevenuePerPeriod] as [string, number[]]));
  group('Lease / Retail', [...snap.revenue.byLeaseAsset.entries()].map(([id, rv]) => [id, rv.totalRevenuePerPeriod] as [string, number[]]));

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
  return totalAddr;
}

// ── Cost of Sales (per-asset + project total) ─────────────────────────────────
function addCoS(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, cosTables: ReportTable[], refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.cos, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 34;
  const N = refs.axisLength;
  const firstCol = 2;
  setTitle(ws.getCell('A1'), 'Cost of Sales', 16);
  setLabel(ws.getCell('A2'), 'Cost of sales matched to recognised revenue (mirrors the platform Cost of Sales tab). The total sums the per-asset rows.');

  let r = 4;
  setSectionHeader(ws.getRow(r), 'Cost of sales by asset', periodTotalCol(firstCol, N)); r += 1;
  const tCol = periodHeader(ws, r, firstCol, N, snap, 'Asset'); r += 1;
  const totalTable = cosTables.find((t) => t.title === 'Project Total Cost of Sales');
  const assetRows = (totalTable?.rows ?? []).filter((rw) => !rw.isTotal && !rw.isSection);
  const rowIdx: number[] = [];
  const cosTotalCached = new Array<number>(N).fill(0);
  for (const ar of assetRows) {
    const vals = ar.values.slice(0, N);
    cachedRow(ws, r, firstCol, N, tCol, ar.label, vals, { indent: 1 });
    for (let t = 0; t < N; t++) cosTotalCached[t] += vals[t] ?? 0;
    rowIdx.push(r); r += 1;
  }
  navySumRow(ws, r, firstCol, N, tCol, 'Total cost of sales', rowIdx, cosTotalCached);
  const totalAddr = `'${SHEETS.cos}'!$${colLetter(tCol)}$${r}`;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
  return totalAddr;
}

// ── Opex (by asset + by category) ─────────────────────────────────────────────
function addOpex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 34;
  const N = refs.axisLength;
  const firstCol = 2;
  const opex = snap.opex;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  setTitle(ws.getCell('A1'), 'Operating Expenses', 16);
  setLabel(ws.getCell('A2'), 'Operating expenses by asset and by category, phased onto the model timeline. Totals sum their components.');

  let r = 4;
  // Section 1: opex by asset (+ HQ), total = SUM of the rows.
  setSectionHeader(ws.getRow(r), 'Opex by asset', periodTotalCol(firstCol, N)); r += 1;
  const tCol = periodHeader(ws, r, firstCol, N, snap, 'Asset'); r += 1;
  const assetRowIdx: number[] = [];
  for (const [id, ar] of opex.byAsset) {
    if (!nz(ar.totalOpexPerPeriod)) continue;
    cachedRow(ws, r, firstCol, N, tCol, assetName(id), ar.totalOpexPerPeriod, { indent: 1 });
    assetRowIdx.push(r); r += 1;
  }
  if (nz(opex.hq.totalOpexPerPeriod)) {
    cachedRow(ws, r, firstCol, N, tCol, 'HQ & corporate overheads', opex.hq.totalOpexPerPeriod, { indent: 1 });
    assetRowIdx.push(r); r += 1;
  }
  navySumRow(ws, r, firstCol, N, tCol, 'Total project opex', assetRowIdx, opex.totalOpexPerPeriodInclHQ);
  const totalAddr = `'${SHEETS.opex}'!$${colLetter(tCol)}$${r}`;
  r += 2;

  // Section 2: project opex by category (Direct / Indirect / Mgmt / Other + HQ).
  setSectionHeader(ws.getRow(r), 'Project opex by category', periodTotalCol(firstCol, N)); r += 1;
  periodHeader(ws, r, firstCol, N, snap, 'Category'); r += 1;
  const pt = opex.projectTotals;
  const catRows: number[] = [];
  cachedRow(ws, r, firstCol, N, tCol, 'Direct costs', pt.directCostsPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, firstCol, N, tCol, 'Indirect costs', pt.indirectCostsPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, firstCol, N, tCol, 'Management fees', pt.managementFeePerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, firstCol, N, tCol, 'Other charges', pt.otherOpexPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  navySumRow(ws, r, firstCol, N, tCol, 'All asset opex', catRows, pt.totalOpexPerPeriod, 'subtotal');
  const allAssetRow = r; r += 1;
  let hqRow = -1;
  if (nz(opex.hq.totalOpexPerPeriod)) {
    cachedRow(ws, r, firstCol, N, tCol, 'HQ overheads', opex.hq.totalOpexPerPeriod, { indent: 1 });
    hqRow = r; r += 1;
  }
  navySumRow(ws, r, firstCol, N, tCol, 'Total project opex', hqRow >= 0 ? [allAssetRow, hqRow] : [allAssetRow], opex.totalOpexPerPeriodInclHQ);

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
  return totalAddr;
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, capexAddrs: CapexAddrs, ext: { revAddr: string; revTotal: number; cosAddr: string; cosTotal: number; opexAddr: string; opexTotal: number }): void {
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.good } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 40;
  setTitle(ws.getCell('A1'), 'Checks & Legend', 16);
  let r = 3;
  setSectionHeader(ws.getRow(r), 'Colour legend (FAST)', 3); r += 1;
  const legend: Array<[string, string]> = [
    ['Input (edit these)', ARGB.input],
    ['Formula (calculation)', ARGB.formula],
    ['Linked (reference to another sheet)', ARGB.linked],
  ];
  for (const [text, argb] of legend) {
    const cell = ws.getCell(`A${r}`);
    cell.value = text; cell.font = { name: 'Calibri', size: 10, color: { argb } };
    r += 1;
  }
  r += 1;
  setSectionHeader(ws.getRow(r), 'Model integrity checks', 3); r += 1;
  ['Check', 'Status', 'Note'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left'));
  r += 1;
  // Phase 1 reconciliation reference points (cached from the snapshot; become
  // live formulas as the statement sheets are added in later phases).
  const maxBsDiff = Math.max(0, ...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const cfTie = snap.directCF.closingCashPerPeriod.every((v, i) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[i] ?? 0)) <= 1);
  const checks: Array<[string, boolean, string]> = [
    ['Balance sheet balances (Assets = Liabilities + Equity)', maxBsDiff < 1000, `max |diff| = ${Math.round(maxBsDiff).toLocaleString()}`],
    ['Direct cash flow closing == Indirect closing', cfTie, 'both methods tie out'],
  ];
  for (const [label, ok, note] of checks) {
    setLabel(ws.getCell(`A${r}`), label);
    const s = ws.getCell(`B${r}`);
    s.value = ok ? 'OK' : 'CHECK'; s.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ok ? ARGB.good : ARGB.bad } };
    setLabel(ws.getCell(`C${r}`), note);
    r += 1;
  }
  // Live check: the phased Capex schedule total ties to the cost build-up total
  // (both reference the Capex sheet, so this recalculates if a rate is edited).
  setLabel(ws.getCell(`A${r}`), 'Capex schedule ties to cost build-up');
  const cs = ws.getCell(`B${r}`);
  cs.value = fcell(`IF(ABS(${capexAddrs.scheduleTotalAddr}-${capexAddrs.buildupTotalAddr})<1,"OK","CHECK")`, 'OK');
  cs.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.good } };
  setFormula(ws.getCell(`C${r}`), fcell(capexAddrs.scheduleTotalAddr, capex.inputAssets.reduce((s, a) => s + a.total, 0)), NUMFMT.money, true);
  r += 2;
  // Linked lifetime reference totals (become pass/fail cross-checks once the
  // statement sheets land).
  setSectionHeader(ws.getRow(r), 'Reference totals (lifetime)', 3); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Total revenue');
  setFormula(ws.getCell(`C${r}`), fcell(ext.revAddr, ext.revTotal), NUMFMT.money, true);
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Total cost of sales');
  setFormula(ws.getCell(`C${r}`), fcell(ext.cosAddr, ext.cosTotal), NUMFMT.money, true);
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Total operating expenses');
  setFormula(ws.getCell(`C${r}`), fcell(ext.opexAddr, ext.opexTotal), NUMFMT.money, true);
  r += 2;
  setLabel(ws.getCell(`A${r}`), 'Build status: Phase 4 (Opex). Cover, Assumptions, Timeline, Capex, Revenue, Cost of Sales, Opex and Checks are in place. The remaining calculation sheets (Financing, Fixed Assets), the financial statements (P&L, Cash Flow, Balance Sheet) and Returns are added in subsequent phases, each formula-linked to the Assumptions.', { });
}

// ── Cover / Index ─────────────────────────────────────────────────────────────
function addCover(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions): void {
  const ws = wb.addWorksheet(SHEETS.cover, { properties: { tabColor: { argb: ARGB.navyDark } }, views: [{ showGridLines: false }] });
  let returns: ReturnType<typeof computeReturnsSnapshot> | null = null;
  try { returns = computeReturnsSnapshot(snap, opts.state.project); } catch { returns = null; }
  const p = opts.state.project;
  const currency = p.currency ?? 'SAR';
  const m = (v: number): string => `${currency} ${formatAccounting(v, 'millions', 1)} m`;
  const pct = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);

  // Column layout: A narrow margin, B..G content, H margin.
  ws.getColumn(1).width = 3;
  for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 17;
  ws.getColumn(8).width = 3;

  // Banner.
  ws.mergeCells('B2:G6');
  const title = ws.getCell('B2');
  title.value = opts.projectName || 'Untitled Project';
  title.font = { name: 'Calibri', size: 28, bold: true, color: { argb: ARGB.white } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  fillRange(ws, 2, 2, 6, 7, ARGB.navy);
  for (let r = 2; r <= 6; r++) ws.getRow(r).height = 24;
  ws.mergeCells('B7:G7');
  const sub = ws.getCell('B7');
  sub.value = 'Real Estate Financial Model  ·  Excel  ·  Formula-driven';
  sub.font = { name: 'Calibri', size: 12, color: { argb: ARGB.white } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  fillRange(ws, 7, 2, 7, 7, ARGB.navyDark);
  ws.getRow(7).height = 22;

  // Key facts card (left) + headline KPI tiles (right).
  let r = 9;
  ws.mergeCells(r, 2, r, 4);
  const kfh = ws.getCell(r, 2);
  kfh.value = 'Project snapshot';
  kfh.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  fillRange(ws, r, 2, r, 4, ARGB.navy);
  // KPI header (right).
  ws.mergeCells(r, 5, r, 7);
  const kpih = ws.getCell(r, 5);
  kpih.value = 'Headline';
  kpih.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  fillRange(ws, r, 5, r, 7, ARGB.navy);
  r += 1;
  const facts: Array<[string, string]> = [
    ['Date', opts.dateLabel],
    ['Currency', currency],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Horizon', `${snap.axisLength} yrs (${snap.projectStartYear}–${snap.projectStartYear + snap.axisLength - 1})`],
    ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ['Debt / Equity', `${snap.financing.funding.debtPct.toFixed(0)}% / ${snap.financing.funding.equityPct.toFixed(0)}%`],
  ];
  const factTop = r;
  facts.forEach(([k, v], i) => {
    const rr = r + i;
    const kc = ws.getCell(rr, 2); kc.value = k; kc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.navyDark } };
    ws.mergeCells(rr, 3, rr, 4);
    const vc = ws.getCell(rr, 3); vc.value = v; vc.font = { name: 'Calibri', size: 10, color: { argb: ARGB.formula } };
    if (i % 2 === 1) fillRange(ws, rr, 2, rr, 4, ARGB.grey);
  });
  boxBorder(ws, factTop, 2, factTop + facts.length - 1, 4);

  // KPI tiles (right column), value-over-label, in bordered cells.
  const kpis: Array<[string, string]> = [
    ['Total dev cost', m(snap.financing.capex.totals.inclAllLand)],
    ['Gross dev value', m(snap.pl.totalRevenuePerPeriod.reduce((s, x) => s + x, 0))],
    ['Project IRR', returns ? pct(returns.result.fcff.irr) : 'n/a'],
    ['Equity IRR', returns ? pct(returns.result.fcfe.irr) : 'n/a'],
    ['Peak debt', m(Math.max(0, ...snap.bs.debtOutstandingPerPeriod))],
    ['Equity multiple', returns ? `${returns.result.fcfe.moic.toFixed(2)}x` : 'n/a'],
  ];
  kpis.forEach(([label, value], i) => {
    const rr = factTop + i;
    const lc = ws.getCell(rr, 5); lc.value = label; lc.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark }, bold: true };
    ws.mergeCells(rr, 6, rr, 7);
    const vc = ws.getCell(rr, 6); vc.value = value; vc.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.navy } };
    vc.alignment = { horizontal: 'right' };
    if (i % 2 === 1) fillRange(ws, rr, 5, rr, 7, ARGB.grey);
  });
  boxBorder(ws, factTop, 5, factTop + kpis.length - 1, 7);
  r = factTop + Math.max(facts.length, kpis.length) + 2;

  // Contents.
  ws.mergeCells(r, 2, r, 7);
  const ch = ws.getCell(r, 2); ch.value = 'Contents'; ch.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  fillRange(ws, r, 2, r, 7, ARGB.navy);
  r += 1;
  const index: Array<[string, string]> = [
    [SHEETS.assumptions, 'All inputs and assumptions (edit here)'],
    [SHEETS.timeline, 'The model year axis'],
    [SHEETS.landArea, 'Area hierarchy (NSA / BUA / GFA) and land value'],
    [SHEETS.capex, 'Development cost build-up and phased schedule'],
    [SHEETS.revenue, 'Recognised revenue by strategy and asset'],
    [SHEETS.cos, 'Cost of sales matched to recognised revenue'],
    [SHEETS.opex, 'Operating expenses by asset and category'],
    [SHEETS.checks, 'Integrity checks and colour legend'],
  ];
  const idxTop = r;
  index.forEach(([name, desc], i) => {
    const rr = r + i;
    const nc = ws.getCell(rr, 2);
    nc.value = { text: `${i + 1}.  ${name}`, hyperlink: `#'${name}'!A1` };
    nc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.linked }, underline: true };
    ws.mergeCells(rr, 3, rr, 7);
    const dc = ws.getCell(rr, 3); dc.value = desc; dc.font = { name: 'Calibri', size: 10, color: { argb: ARGB.formula } };
    if (i % 2 === 1) fillRange(ws, rr, 2, rr, 7, ARGB.grey);
  });
  boxBorder(ws, idxTop, 2, idxTop + index.length - 1, 7);
  r = idxTop + index.length + 2;

  // Colour legend.
  setLabel(ws.getCell(r, 2), 'Legend:', { bold: true });
  const legend: Array<[string, string]> = [['Input', ARGB.input], ['Formula', ARGB.formula], ['Linked', ARGB.linked]];
  legend.forEach(([t, argb], i) => { const c = ws.getCell(r, 3 + i); c.value = t; c.font = { name: 'Calibri', size: 10, bold: true, color: { argb } }; });
  r += 2;
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
  fillCell(ws.getCell(1, 1), ARGB.white);
}
