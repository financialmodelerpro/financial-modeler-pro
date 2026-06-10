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
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../financials-resolvers';
import { computeReturnsSnapshot } from '../returns-resolvers';
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
import { buildCostOfSalesReport, type ReportTable } from '../reports/cosReports';
import { resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { formatAccounting } from '@/src/core/formatters';
import {
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, markInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
  fillCell, fillRange, boxBorder, sheetRef, scaleMoneyFormats, scaleNote, defaultDecimals, type DisplayScale, type DisplayDecimals,
} from './styles';

export interface BuildModelOptions {
  state: FinancialsResolverState;
  projectName: string;
  dateLabel: string;
  /** Workbook-wide DISPLAY scale (cosmetic number format only; stored values +
   *  formulas stay in full units). Defaults to 'full'. */
  displayScale?: DisplayScale;
  /** Money decimal places (display only). Defaults per scale: 0 for full /
   *  thousands, 1 for millions. Percentages are always 2dp regardless. */
  displayDecimals?: DisplayDecimals;
}

const SHEETS = { cover: 'Cover', assumptions: 'Assumptions', timeline: 'Timeline', landArea: 'Land & Area', capex: 'Capex', financing: 'Financing', revenue: 'Revenue', cos: 'Cost of Sales', opex: 'Opex', checks: 'Checks' };

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
  const landAddrs = addLandArea(wb, opts.state, refs);
  const capexAddrs = addCapex(wb, snap, capex, refs, landAddrs);
  addFinancing(wb, snap, opts.state, refs, landAddrs);
  const revAddr = addRevenue(wb, snap, opts.state, refs);
  const cosAddr = addCoS(wb, snap, cos, refs);
  const opexAddr = addOpex(wb, snap, opts.state, refs);
  const revTotal = snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + (v ?? 0), 0);
  const cosTotalRow = cos.find((t) => t.title === 'Project Total Cost of Sales')?.rows.find((rw) => rw.isTotal)?.values ?? [];
  const cosTotal = cosTotalRow.reduce((s, v) => s + (v ?? 0), 0);
  const opexTotal = snap.opex.totalOpexPerPeriodInclHQ.reduce((s, v) => s + (v ?? 0), 0);
  addChecks(wb, snap, capex, capexAddrs, { revAddr, revTotal, cosAddr, cosTotal, opexAddr, opexTotal });
  // Workbook-wide DISPLAY scale: re-format magnitude money cells (display only;
  // stored values + formulas stay in full units, so the locked reconciliation
  // is identical at every scale). Applied last so every sheet's cells are set.
  const scale = opts.displayScale ?? 'full';
  const decimals = opts.displayDecimals ?? defaultDecimals(scale);
  scaleMoneyFormats(wb, scale, decimals);
  const note = scaleNote(scale, opts.state.project.currency ?? 'SAR');
  if (note) {
    // Append the unit note to the header (A2) of every money-bearing sheet so
    // the scaled figures are unambiguous.
    for (const name of [SHEETS.landArea, SHEETS.capex, SHEETS.financing, SHEETS.revenue, SHEETS.cos, SHEETS.opex]) {
      const ws = wb.getWorksheet(name); if (!ws) continue;
      const a2 = ws.getCell('A2'); const cur = typeof a2.value === 'string' ? a2.value : '';
      setLabel(a2, cur ? `${cur}  (${note})` : note);
    }
  }
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
  /** Cost-line id (phase-scoped), so percent_of_selected can find sibling rows. */
  id: string;
  /** Raw cost method, so the build-up picks the right live-basis source. */
  method: string;
  /** Sibling line ids summed as the base for percent_of_selected. */
  selectedLineIds: string[];
  /** Cost stage ('hard' etc.); percent_of_construction sums the 'hard' lines. */
  stage: string;
  /** Raw rate / percent the user entered (percent as 0..100), for reconciliation. */
  rate: number;
  /** True when the rate is a percentage (drives the UOM + Rate cell format). */
  isPercent: boolean;
  /** Human basis / unit-of-measure label (capexReports basisLabel), e.g.
   *  'per BUA sqm' / '% of In-kind land' / 'Fixed (lump sum)'. The Capex UOM col. */
  basis: string;
  name: string;
  /** Absolute cross-sheet address of the rate / % input cell on Assumptions. */
  rateAddr: string;
  /** Absolute address of the physical-quantity input cell on Assumptions, kept
   *  only for rate-x-area methods (metricKind 'area'); null otherwise. Derived
   *  money / count bases are computed live on the calc sheets, not stored here. */
  qtyAddr: string | null;
  /** Basis source for non-area methods, so the build-up can link live. */
  metricKind: 'area' | 'count' | 'money' | 'none';
  amount: number;
}
interface CapexAssetRef { assetId: string; name: string; phaseName: string; total: number; lines: CapexLineRef[] }

// Live-basis addresses captured on the Land & Area calc sheet, keyed by asset.
interface LandAreaAssetAddrs { landValue: string; cashLand: string; inKindLand: string; unitCount: string; revenue: string }

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
interface ExistingEquityRef { assetId: string; name: string; amount: string }
// Financing-policy scalar inputs (absolute Assumptions addresses), so the
// Financing tab's local Inputs block can link them in once and every formula on
// the tab references the LOCAL cell, not a long cross-sheet path.
interface FinancingScalarRefs { dividendEnabled: string; dividendPayout: string; dividendStart: string; sweepStart: string; sweepRatio: string }

interface AssumptionRefs {
  startYearName: string;
  axisLength: number;
  capex: CapexAssetRef[];
  assets: AssetInputRef[];
  subUnits: SubUnitInputRef[];
  parcels: ParcelInputRef[];
  tranches: TrancheInputRef[];
  equity: EquityInputRef[];
  /** Per-asset historical equity inputs (operational-phase assets), source of
   *  the Financing sheet's Existing-equity row. */
  existingEquity: ExistingEquityRef[];
  /** Financing-policy scalar input addresses (dividends + cash sweep), linked
   *  once into the Financing tab's local Inputs block. */
  financingScalars: FinancingScalarRefs;
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
  const existingEquityRefs: ExistingEquityRef[] = [];
  const addr = (col: string, row: number): string => sheetRef(SHEETS.assumptions, `$${col}$${row}`);
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
  const divEnabledRow = addKV('Dividends enabled (1 = yes)', p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int);
  const divPayoutRow = addKV('Dividend payout ratio %', (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct);
  const divStartRow = addKV('Dividend start year (0 = auto)', p.dividendStartYear ?? 0, NUMFMT.year);
  void taxRow; void debtRow;
  // Financing-policy scalar addresses; sweep settings are captured in the
  // Financing inputs block below (after the Capex / Financing separator).
  const financingScalars: FinancingScalarRefs = {
    dividendEnabled: addr('B', divEnabledRow), dividendPayout: addr('B', divPayoutRow),
    dividendStart: addr('B', divStartRow), sweepStart: '', sweepRatio: '',
  };
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
      setInput(ws.getCell(`C${r}`), pa.rate ?? 0, NUMFMT.rate); // /sqm rate, unscaled
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
      setInput(ws.getCell(`J${r}`), a.landAllocation?.customRate ?? 0, NUMFMT.rate); // /sqm rate, unscaled
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
      setInput(ws.getCell(`G${r}`), u.startingAdr ?? u.unitPrice ?? 0, NUMFMT.rate); // price / ADR per unit, unscaled
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

  // Capex cost lines: PURE INPUTS only (method + rate / %, plus a physical
  // quantity for rate-x-area methods). Derived bases stay OFF this sheet: an
  // in-kind / cash / total land value, a revenue basis, a sum-of-selected-lines
  // and a derived unit count are all calculated results, so they are computed
  // live on the calc sheets (Land & Area, Capex itself) instead of being stored
  // here as constants. Percent rates are decimals (0.10); a fixed lump = rate.
  setSectionHeader(ws.getRow(r), 'Capex cost lines (inputs: method, rate / %, physical quantity)', 4); r += 1;
  ['Asset / Cost line', 'Method', 'Rate / %', 'Quantity (rate-x-area only)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const capexRefs: CapexAssetRef[] = [];
  for (const ia of capex.inputAssets) {
    setLabel(ws.getCell(`A${r}`), `${ia.assetName}  (${ia.phaseName})`, { bold: true });
    fillRange(ws, r, 1, r, 4, ARGB.subtotal);
    r += 1;
    const lineRefs: CapexLineRef[] = [];
    for (const ln of ia.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), ln.basis);
      // Rate input: percent as a decimal (pct2), money rate as an unscaled
      // per-unit rate (NUMFMT.rate) so the workbook display-scale leaves it alone.
      if (ln.isPercent) setInput(ws.getCell(`C${r}`), ln.rate / 100, NUMFMT.pct2);
      else setInput(ws.getCell(`C${r}`), ln.rate, NUMFMT.rate);
      // Keep column D as an input ONLY for a genuine physical quantity: rate-x-
      // area (BUA / NSA / GFA / NDA / roads / land sqm) and rate-per-parking-bay
      // (basisFor tags bays as 'count', but a bay is a physical input). A derived
      // unit count and every money basis (land value / revenue / selected lines)
      // are left blank here and built live on the calc sheets from the real source.
      const hasQty = !ln.isFixed && ln.metricValue !== null && (ln.metricKind === 'area' || ln.method === 'rate_per_parking_bay');
      // Store the EFFECTIVE driver quantity (amount / rate), not the raw area
      // metric. They are equal when no allocation applies; when the engine
      // allocates a line's cost across assets (e.g. bua_share), the effective
      // quantity is this asset's share, so rate x quantity reconciles to the
      // engine amount on recalculation rather than drifting.
      if (hasQty) setInput(ws.getCell(`D${r}`), ln.rate ? ln.amount / ln.rate : (ln.metricValue as number), NUMFMT.int);
      lineRefs.push({
        id: ln.id,
        method: ln.method,
        selectedLineIds: ln.selectedLineIds,
        stage: ln.stage,
        rate: ln.rate,
        isPercent: ln.isPercent,
        basis: ln.basis,
        name: ln.name,
        rateAddr: sheetRef(SHEETS.assumptions, `$C$${r}`),
        qtyAddr: hasQty ? sheetRef(SHEETS.assumptions, `$D$${r}`) : null,
        metricKind: ln.metricKind,
        amount: ln.amount,
      });
      r += 1;
    }
    capexRefs.push({ assetId: ia.assetId, name: ia.assetName, phaseName: ia.phaseName, total: ia.total, lines: lineRefs });
  }
  r += 1;

  // ── Separator: Capex inputs above, Financing inputs below ──────────────────
  // A full-width divider band so the two input domains read as distinct blocks
  // (the Capex cost lines end above; every Financing input starts here).
  r += 1;
  for (let c = 1; c <= 8; c++) fillCell(ws.getCell(r, c), ARGB.navyDark);
  const sepCell = ws.getCell(`A${r}`);
  sepCell.value = 'FINANCING INPUTS';
  sepCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: ARGB.white } };
  sepCell.alignment = { vertical: 'middle' };
  ws.getRow(r).height = 18;
  r += 2;

  // Cash sweep settings (project-wide; the Financing tab links these in).
  const sweepCfg = (p.financing as { cashSweep?: { startingYear?: number; sweepRatioPct?: number } } | undefined)?.cashSweep ?? {};
  setSectionHeader(ws.getRow(r), 'Cash sweep settings', 2); r += 1;
  ['Setting', 'Value'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Sweep starting year (0 = auto)');
  setInput(ws.getCell(`B${r}`), sweepCfg.startingYear ?? 0, NUMFMT.year);
  financingScalars.sweepStart = addr('B', r); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Sweep ratio (% of surplus)');
  setInput(ws.getCell(`B${r}`), (sweepCfg.sweepRatioPct ?? 100) / 100, NUMFMT.pct);
  financingScalars.sweepRatio = addr('B', r); r += 2;

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

  // Existing operations equity (historical). Opening-balance equity on
  // operational-phase assets (asset.historicalEquityAmount), the source the
  // Financing sheet's Existing-equity row links to. Input cells (editable).
  const opPhaseIds = new Set(opts.state.phases.filter((ph) => ph.status === 'operational').map((ph) => ph.id));
  const existingEqAssets = visibleAssets.filter((a) => opPhaseIds.has(a.phaseId) && Math.max(0, a.historicalEquityAmount ?? 0) > 0);
  if (existingEqAssets.length) {
    setSectionHeader(ws.getRow(r), 'Existing operations equity (historical)', 2); r += 1;
    ['Asset', 'Equity contributed'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const a of existingEqAssets) {
      setLabel(ws.getCell(`A${r}`), a.name);
      setInput(ws.getCell(`B${r}`), Math.max(0, a.historicalEquityAmount ?? 0), NUMFMT.money);
      existingEquityRefs.push({ assetId: a.id, name: a.name, amount: addr('B', r) });
      r += 1;
    }
    r += 1;
  }

  ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return {
    startYearName: 'ProjectStartYear', axisLength: snap.axisLength, capex: capexRefs,
    assets: assetRefs, subUnits: subUnitRefs, parcels: parcelRefs, tranches: trancheRefs, equity: equityRefs,
    existingEquity: existingEquityRefs, financingScalars,
  };
}

// ── Timeline (formula-driven period axis; the canonical date / index source) ───
function addTimeline(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, refs: AssumptionRefs): void {
  const ws = wb.addWorksheet(SHEETS.timeline, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 28;
  ws.getColumn(META_B).width = 3; ws.getColumn(META_C).width = 3; ws.getColumn(TOTAL_COL).width = 3;
  setTitle(ws.getCell('A1'), 'Timeline', 16);
  setLabel(ws.getCell('A2'), 'The model period axis. Period 0 is the opening (Dec of the year before start); periods 1..N are the active years. Every schedule links its frozen header dates and index here.');

  const N = refs.axisLength;
  setColHeader(ws.getCell(3, 1), 'Period ending', 'left');
  setColHeader(ws.getCell(4, 1), 'Period index', 'left');
  // Period columns from E: E = Period 0 / Dec(startYear - 1), F.. = active years.
  const hdr = (cell: ExcelJS.Cell): void => {
    cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    cell.alignment = { horizontal: 'right' };
  };
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) {
    ws.getColumn(c).width = 12;
    const cl = colLetter(c); const prev = colLetter(c - 1);
    // Date row (3): E = ProjectStartYear - 1, then +1; stored year, shown "Dec YYYY".
    const dCell = ws.getCell(3, c);
    setFormula(dCell, fcell(c === OPEN_COL ? 'ProjectStartYear-1' : `${prev}3+1`, colYear(snap, c)), NUMFMT.date, true);
    hdr(dCell);
    // Index row (4): E = 0, then +1.
    const iCell = ws.getCell(4, c);
    setFormula(iCell, fcell(c === OPEN_COL ? '0' : `${prev}4+1`, c - OPEN_COL), NUMFMT.year);
    hdr(iCell);
  }
  ws.views = [FROZEN_VIEW()];
}

// Strategy -> display group, shared by the Land & Area and Capex groupings.
function strategyGroup(strategy: string): 'Residential' | 'Hospitality' | 'Retail' | 'Other' {
  if (strategy === 'Operate') return 'Hospitality';
  if (strategy === 'Lease') return 'Retail';
  if (strategy === 'Sell' || strategy === 'Sell + Manage') return 'Residential';
  return 'Other';
}

// ── Land & Area (formula area hierarchy + land value, links to Assumptions) ────
// Asset-wise (no sub-unit rows): each asset's NSA / Support / BUA / GFA, land
// value (cash + in-kind split), unit count and GDV, grouped by strategy
// (Residential -> Hospitality -> Retail) with a total per group. Sub-unit areas
// are folded directly into each asset's formula (summed off the Assumptions
// sub-unit inputs) so the tab reads at the asset level. GDV is a residential
// (for-sale) concept, so it is shown only for Residential assets (and for any
// asset that drives a percent-of-revenue capex line, which needs the basis).
function addLandArea(wb: ExcelJS.Workbook, state: FinancialsResolverState, refs: AssumptionRefs): Map<string, LandAreaAssetAddrs> {
  const ws = wb.addWorksheet(SHEETS.landArea, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 30;
  for (let c = 2; c <= 14; c++) ws.getColumn(c).width = 13;
  setTitle(ws.getCell('A1'), 'Land & Area', 16);
  setLabel(ws.getCell('A2'), 'Area hierarchy (NSA -> BUA -> GFA), land value and unit count per asset, grouped by strategy, computed from the Assumptions inputs. GDV is shown for residential (for-sale) assets. The Capex build-up links its percent / unit cost bases here.');

  // Engine metrics per asset, cached so the formulas reconcile to the platform.
  const metricsById = new Map<string, AssetAreaMetrics>();
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const inPhase = state.assets.filter((x) => x.phaseId === a.phaseId);
    metricsById.set(a.id, resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode));
  }

  const catOf = strategyGroup; // strategy -> display group (shared helper)
  // GDV is shown for residential assets; also kept for any asset whose capex has a
  // percent-of-revenue line (the build-up base links to the GDV cell).
  const revenueLinked = new Set(
    refs.capex.filter((a) => a.lines.some((l) => /revenue/.test(l.method))).map((a) => a.assetId),
  );
  const needsGdv = (ar: AssetInputRef): boolean => catOf(ar.strategy) === 'Residential' || revenueLinked.has(ar.id);

  // Inline sub-unit expressions (summed off the Assumptions sub-unit inputs), so
  // the asset rows carry the NSA / support / unit / GDV contributions directly.
  const subOf = (assetId: string): SubUnitInputRef[] => refs.subUnits.filter((s) => s.assetId === assetId);
  const areaExpr = (s: SubUnitInputRef): string => `IF(${s.metric}="area",${s.value},${s.value}*${s.unitArea})`;
  const isNsaCat = (s: SubUnitInputRef): string => `OR(${s.category}="Sellable",${s.category}="Operable",${s.category}="Leasable")`;
  const nsaExpr = (s: SubUnitInputRef): string => `IF(${isNsaCat(s)},${areaExpr(s)},0)`;
  const supExpr = (s: SubUnitInputRef): string => `IF(${s.category}="Support",${areaExpr(s)},0)`;
  const unitsExpr = (s: SubUnitInputRef): string => `IF(OR(${s.metric}="units",${s.metric}="count"),${s.value},0)`;
  const gdvExpr = (s: SubUnitInputRef): string => `IF(${isNsaCat(s)},${s.value}*${s.price},0)`;
  const joinOr0 = (parts: string[]): string => (parts.length ? parts.join('+') : '0');

  // Column header set (A label + B..N metrics). Land rate (I) is per-sqm so it is
  // never summed into a group total.
  const HEADERS = ['Asset', 'NSA', 'Support', 'BUA', 'Parking', 'GFA', 'Parking bays', 'Land (sqm)', 'Land rate', 'Land value', 'Cash land', 'In-kind land', 'Units', 'GDV'];
  const LASTCOL = HEADERS.length; // 14 (col N)

  let r = 4;
  setSectionHeader(ws.getRow(r), 'Asset area & land', LASTCOL); r += 1;
  HEADERS.forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;

  const groupOrder: Array<'Residential' | 'Hospitality' | 'Retail' | 'Other'> = ['Residential', 'Hospitality', 'Retail', 'Other'];
  interface ARow { ref: AssetInputRef; row: number }
  interface GBlock { label: string; aRows: ARow[]; subtotalRow: number }
  const allARows: ARow[] = [];
  const blocks: GBlock[] = [];

  // Layout + hierarchy (B..G) pass: a group label row, asset hierarchy rows, then
  // a reserved subtotal row per group.
  for (const cat of groupOrder) {
    const inGroup = refs.assets.filter((a) => catOf(a.strategy) === cat);
    if (!inGroup.length) continue;
    setLabel(ws.getCell(r, 1), cat, { bold: true }); fillRange(ws, r, 1, r, LASTCOL, ARGB.subtotal); r += 1;
    const grp: ARow[] = [];
    for (const ar of inGroup) {
      const m = metricsById.get(ar.id);
      const subs = subOf(ar.id);
      const nsaSub = joinOr0(subs.map(nsaExpr));
      const supSub = joinOr0(subs.map(supExpr));
      setLabel(ws.getCell(`A${r}`), ar.name, { indent: 1 });
      setFormula(ws.getCell(`B${r}`), fcell(`MAX(${ar.nsa},${nsaSub})`, m?.nsa ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`C${r}`), fcell(`${ar.support}+(${supSub})`, m?.supportArea ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`D${r}`), fcell(`MAX(${ar.bua},B${r}+C${r})`, m?.bua ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`E${r}`), fcell(ar.parking, m?.parkingArea ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`F${r}`), fcell(`MAX(${ar.gfa},D${r}+E${r})`, m?.gfa ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`G${r}`), fcell(ar.parkingBays, m?.parkingBays ?? 0), NUMFMT.int, true);
      const aRow: ARow = { ref: ar, row: r };
      grp.push(aRow); allARows.push(aRow);
      r += 1;
    }
    blocks.push({ label: cat, aRows: grp, subtotalRow: r }); r += 1;
  }

  // Land columns (H..N) pass: need every asset BUA cell for the auto-by-BUA land
  // share, so this runs after the full layout.
  const parcelPhase = new Map(state.parcels.map((p) => [p.id, p.phaseId] as const));
  const parcelsInPhase = (phaseId: string): ParcelInputRef[] => refs.parcels.filter((p) => parcelPhase.get(p.id) === phaseId);
  const landAddrsByAsset = new Map<string, LandAreaAssetAddrs>();
  for (const { ref: ar, row } of allARows) {
    const m = metricsById.get(ar.id);
    const ph = ar.phaseId;
    const pcs = parcelsInPhase(ph);
    const landTotal = pcs.length ? pcs.map((p) => p.area).join('+') : '0';
    const landValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}`).join('+') : '0';
    const cashValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}*${p.cashPct}`).join('+') : '0';
    const phaseBua = allARows.filter((x) => x.ref.phaseId === ph).map((x) => `D${x.row}`).join('+') || '0';
    setFormula(ws.getCell(`H${row}`), fcell(`IF(${ar.landSqm}>0,${ar.landSqm},IFERROR((${landTotal})*D${row}/(${phaseBua}),0))`, m?.landSqm ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`I${row}`), fcell(`IF(${ar.landRate}>0,${ar.landRate},IFERROR((${landValueF})/(${landTotal}),0))`, (m && m.landSqm > 0) ? m.landValue / m.landSqm : 0), NUMFMT.rate, true);
    setFormula(ws.getCell(`J${row}`), fcell(`H${row}*I${row}`, m?.landValue ?? 0), NUMFMT.money);
    setFormula(ws.getCell(`K${row}`), fcell(`J${row}*IFERROR((${cashValueF})/(${landValueF}),0)`, m?.cashLandValue ?? 0), NUMFMT.money);
    setFormula(ws.getCell(`L${row}`), fcell(`J${row}-K${row}`, m?.inKindLandValue ?? 0), NUMFMT.money);
    const subs = subOf(ar.id);
    setFormula(ws.getCell(`M${row}`), fcell(joinOr0(subs.map(unitsExpr)), m?.unitCount ?? 0), NUMFMT.int);
    // GDV: residential (for-sale) assets + any revenue-linked asset; blank else.
    if (needsGdv(ar)) setFormula(ws.getCell(`N${row}`), fcell(joinOr0(subs.map(gdvExpr)), m?.totalRevenue ?? 0), NUMFMT.money);
    landAddrsByAsset.set(ar.id, {
      landValue: sheetRef(SHEETS.landArea, `$J$${row}`),
      cashLand: sheetRef(SHEETS.landArea, `$K$${row}`),
      inKindLand: sheetRef(SHEETS.landArea, `$L$${row}`),
      unitCount: sheetRef(SHEETS.landArea, `$M$${row}`),
      revenue: sheetRef(SHEETS.landArea, `$N$${row}`),
    });
  }

  // Group total rows: SUM the group's asset rows per column (skip the per-sqm rate
  // col I; GDV col N only where the group carries it).
  const sumSpec: Array<{ col: number; pick: (m: AssetAreaMetrics) => number; fmt: string }> = [
    { col: 2, pick: (m) => m.nsa, fmt: NUMFMT.int },
    { col: 3, pick: (m) => m.supportArea, fmt: NUMFMT.int },
    { col: 4, pick: (m) => m.bua, fmt: NUMFMT.int },
    { col: 5, pick: (m) => m.parkingArea, fmt: NUMFMT.int },
    { col: 6, pick: (m) => m.gfa, fmt: NUMFMT.int },
    { col: 7, pick: (m) => m.parkingBays, fmt: NUMFMT.int },
    { col: 8, pick: (m) => m.landSqm, fmt: NUMFMT.int },
    { col: 10, pick: (m) => m.landValue, fmt: NUMFMT.money },
    { col: 11, pick: (m) => m.cashLandValue, fmt: NUMFMT.money },
    { col: 12, pick: (m) => m.inKindLandValue, fmt: NUMFMT.money },
    { col: 13, pick: (m) => m.unitCount, fmt: NUMFMT.int },
  ];
  for (const b of blocks) {
    const rr = b.subtotalRow;
    setLabel(ws.getCell(rr, 1), `Total ${b.label}`, { bold: true });
    const rowsWithM = b.aRows.map((a) => ({ row: a.row, m: metricsById.get(a.ref.id) })).filter((x) => x.m) as Array<{ row: number; m: AssetAreaMetrics }>;
    for (const sp of sumSpec) {
      const f = colSum(colLetter(sp.col), rowsWithM.map((x) => x.row));
      const cached = rowsWithM.reduce((s, x) => s + sp.pick(x.m), 0);
      setFormula(ws.getCell(rr, sp.col), fcell(f, cached), sp.fmt);
    }
    // GDV total only if any asset in the group carries it.
    const gdvRows = b.aRows.filter((a) => needsGdv(a.ref)).map((a) => ({ row: a.row, m: metricsById.get(a.ref.id) })).filter((x) => x.m) as Array<{ row: number; m: AssetAreaMetrics }>;
    if (gdvRows.length) {
      setFormula(ws.getCell(rr, LASTCOL), fcell(colSum('N', gdvRows.map((x) => x.row)), gdvRows.reduce((s, x) => s + x.m.totalRevenue, 0)), NUMFMT.money);
    }
    fillRange(ws, rr, 1, rr, LASTCOL, ARGB.navy);
    for (let c = 1; c <= LASTCOL; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false }];
  return landAddrsByAsset;
}

// ── Capex (cost build-up + phased schedule) ───────────────────────────────────
interface CapexAddrs { scheduleTotalAddr: string; buildupTotalAddr: string }

function addCapex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, refs: AssumptionRefs, landAddrs: Map<string, LandAreaAssetAddrs>): CapexAddrs {
  const ws = wb.addWorksheet(SHEETS.capex, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  // Capex-LOCAL geometry (the other period sheets keep the shared geometry): one
  // extra metadata column for Quantity, so A = Cost line, B = UOM, C = Rate,
  // D = Quantity, E = Total, F = Period 0 (opening), G.. = active years.
  const C_LBL = 1, C_UOM = 2, C_RATE = 3, C_QTY = 4, C_TOT = 5, C_OPEN = 6;
  const cP = (t: number): number => C_OPEN + 1 + t;   // G.. active period t
  const cLast = C_OPEN + N;                            // last active column
  const cChk = cLast + 1;
  const cRange = (rr: number): string => `${colLetter(cP(0))}${rr}:${colLetter(cLast)}${rr}`;
  const TOL = 0.0001;
  const TITLE = 'Capex';
  const SUB = 'Development cost, fully live. Each line: Total = Rate x Quantity (the live basis). INPUTS (top): allocation % per period. OUTPUTS: Table 1 the per-line schedule (period = Total x allocation %), then Tables 2-4 the asset-wise incl-land / excl-in-kind / excl-total-land summaries. All tie by construction.';

  // ── Capex-local frozen 4-row header (rows 3 dates / 4 index; freeze A-E) ──
  ws.getColumn(C_LBL).width = 34; ws.getColumn(C_UOM).width = 16; ws.getColumn(C_RATE).width = 12; ws.getColumn(C_QTY).width = 15; ws.getColumn(C_TOT).width = 15;
  for (let c = C_OPEN; c <= cLast; c++) ws.getColumn(c).width = 12;
  ws.getColumn(cChk).width = 9;
  setTitle(ws.getCell('A1'), TITLE, 16);
  setLabel(ws.getCell('A2'), SUB);
  setColHeader(ws.getCell(4, C_LBL), 'Cost line', 'left');
  setColHeader(ws.getCell(4, C_UOM), 'UOM', 'left');
  setColHeader(ws.getCell(4, C_RATE), 'Rate', 'right');
  setColHeader(ws.getCell(4, C_QTY), 'Quantity', 'right');
  setColHeader(ws.getCell(4, C_TOT), 'Total', 'right');
  setColHeader(ws.getCell(4, cChk), 'Check', 'center');
  for (let c = C_OPEN; c <= cLast; c++) {
    const cl = colLetter(c);
    const d = ws.getCell(3, c);
    setFormula(d, fcell(sheetRef(SHEETS.timeline, `${cl}3`), colYear(snap, c)), NUMFMT.date, true);
    d.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    d.alignment = { horizontal: 'right' };
    const ix = ws.getCell(4, c);
    setFormula(ix, fcell(sheetRef(SHEETS.timeline, `${cl}4`), c - C_OPEN), NUMFMT.year, true);
    ix.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    ix.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    ix.alignment = { horizontal: 'right' };
  }
  ws.views = [{ state: 'frozen', xSplit: C_TOT, ySplit: 4, showGridLines: false }];

  const cat = (assetId: string): string => strategyGroup(refs.assets.find((x) => x.id === assetId)?.strategy ?? '');
  // Cached engine series (per asset name) for the 4 result tables.
  const seriesByName = (title: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const rw of capex.results.find((t) => t.title === title)?.rows ?? []) if (!rw.isTotal) m.set(rw.label, rw.values.slice());
    return m;
  };
  const inclByName = seriesByName('Total Capex (incl. all land)');
  const exclInKindByName = seriesByName('Capex excl. Land In-Kind (cash-impact schedule)');
  const exclAllByName = seriesByName('Capex excl. Total Land (pure development cost)');
  const perPeriodByLine = new Map<string, number[]>();
  for (const ia of capex.inputAssets) for (const ln of ia.lines) perPeriodByLine.set(`${ia.assetId}|${ln.id}`, ln.perPeriod ?? []);

  // A navy / grey total row over the Capex geometry (Total in E = SUM of periods).
  const cSum = (rr: number, label: string, srcRows: number[], cachedPer: number[], style: 'navy' | 'subtotal', cachedOpen = 0): void => {
    setLabel(ws.getCell(rr, C_LBL), label, { bold: true });
    const put = (c: number, cached: number): void => setFormula(ws.getCell(rr, c), fcell(colSum(colLetter(c), srcRows), cached), NUMFMT.money);
    put(C_OPEN, cachedOpen);
    for (let t = 0; t < N; t++) put(cP(t), cachedPer[t] ?? 0);
    setFormula(ws.getCell(rr, C_TOT), fcell(`SUM(${cRange(rr)})`, cachedPer.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
    const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal; const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
    fillRange(ws, rr, 1, rr, cLast, fill);
    for (let c = 1; c <= cLast; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: fg } };
  };

  // Money-basis methods (Quantity scales with the workbook); everything else is a
  // count / area (sqm, bays, units, lump) and stays unscaled like a rate.
  const moneyBasis = new Set(['percent_of_inkind_land', 'percent_of_cash_land', 'percent_of_total_land', 'percent_of_total_revenue', 'percent_of_revenue_cash', 'percent_of_revenue_sale', 'percent_of_selected', 'percent_of_construction']);

  let r = 5;

  // ── INPUTS: all assets' allocation % tables, in sequence ─────────────────────
  setSectionHeader(ws.getRow(r), 'INPUTS - Allocation profile per cost line (% of each line\'s total, per period)', cLast); r += 1;
  // line key -> per-period allocation % cell address [Period0, active0, active1, ...].
  const allocCells = new Map<string, string[]>();
  for (const a of refs.capex) {
    setLabel(ws.getCell(r, C_LBL), `${a.name} (${a.phaseName})`, { bold: true }); fillRange(ws, r, 1, r, cLast, ARGB.subtotal); r += 1;
    for (const ln of a.lines) {
      const total = ln.amount;
      const pp = perPeriodByLine.get(`${a.assetId}|${ln.id}`) ?? [];
      setLabel(ws.getCell(r, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(r, C_UOM), ln.basis);
      setFormula(ws.getCell(r, C_RATE), fcell(ln.rateAddr, ln.isPercent ? ln.rate / 100 : ln.rate), ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate, true);
      const cells: string[] = [];
      let pctSum = 0;
      setInput(ws.getCell(r, C_OPEN), 0, NUMFMT.pct2); cells.push(`$${colLetter(C_OPEN)}$${r}`); // Period 0: no capex
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        const pct = total ? (pp[t] ?? 0) / total : 0; // guard: zero total -> 0
        setInput(ws.getCell(r, c), pct, NUMFMT.pct2);
        cells.push(`$${colLetter(c)}$${r}`);
        pctSum += pct;
      }
      // Total (E) = sum of the period %s (should be 100%); Check flags drift.
      setFormula(ws.getCell(r, C_TOT), fcell(`SUM(${cRange(r)})`, pctSum), NUMFMT.pct2);
      const ok = Math.abs(pctSum - (total ? 1 : 0)) <= TOL;
      setFormula(ws.getCell(r, cChk), fcell(`IF(ABS(${colLetter(C_TOT)}${r}-${total ? 1 : 0})<=${TOL},"OK","CHECK")`, ok ? 'OK' : 'CHECK'), '@');
      ws.getCell(r, cChk).alignment = { horizontal: 'center' };
      ws.getCell(r, cChk).font = { name: 'Calibri', size: BODY_SIZE, bold: !ok, color: { argb: ok ? ARGB.good : ARGB.bad } };
      allocCells.set(`${a.assetId}|${ln.id}`, cells);
      r += 1;
    }
  }
  r += 1;

  // ── Table 1: per-asset cost-line schedule (single block per asset) ───────────
  // Cost line, UOM, Rate, Quantity (the live basis), Total = Rate x Quantity, then
  // the period amounts (= Total x allocation %). The build-up is merged here, so
  // there is no separate build-up block. Subtotal rows feed Tables 2-4.
  setSectionHeader(ws.getRow(r), 'Table 1 - Construction Cost Schedule by Period (per cost line, per asset)', cLast); r += 1;
  interface AssetMeta { name: string; category: string; inclRow: number; landRows: number[]; nonLandRows: number[]; exclAll: number[]; exclInKind: number[]; incl: number[] }
  const assetMeta: AssetMeta[] = [];
  const assetInclRows: number[] = [];
  const allLineTotCells: string[] = []; // every line's Total (E) cell, for the build-up grand
  const grandCapex = refs.capex.reduce((s, a) => s + a.total, 0);

  for (const a of refs.capex) {
    const land = landAddrs.get(a.assetId);
    setLabel(ws.getCell(r, C_LBL), `${a.name} (${a.phaseName})`, { bold: true }); fillRange(ws, r, 1, r, cLast, ARGB.subtotal); r += 1;
    // Pre-assign line rows so percent-of-selected can reference sibling Total (E) cells.
    const totRowOf = new Map<string, number>();
    a.lines.forEach((ln, i) => totRowOf.set(ln.id, r + i));
    const eCellOf = (id: string): string | null => { const rr = totRowOf.get(id); return rr != null ? `$E$${rr}` : null; };
    const sumE = (ids: string[], own: string): string | null => {
      const cells = ids.map(eCellOf).filter((c): c is string => !!c && c !== own);
      return cells.length ? `(${cells.join('+')})` : null;
    };
    // The live Quantity basis (the value the Rate multiplies) for a line.
    const qtyExprOf = (ln: CapexLineRef, own: string): string | null => {
      if (ln.qtyAddr) return ln.qtyAddr;                      // area / bays (Assumptions stored qty)
      switch (ln.method) {
        case 'rate_per_unit': return land?.unitCount ?? null;
        case 'percent_of_inkind_land': return land?.inKindLand ?? null;
        case 'percent_of_cash_land': return land?.cashLand ?? null;
        case 'percent_of_total_land': return land?.landValue ?? null;
        case 'percent_of_total_revenue':
        case 'percent_of_revenue_cash':
        case 'percent_of_revenue_sale': return land?.revenue ?? null;
        case 'percent_of_selected': return sumE(ln.selectedLineIds, own);
        case 'percent_of_construction': return sumE(a.lines.filter((s) => s.stage === 'hard' && s.id !== ln.id).map((s) => s.id), own);
        default: return null;
      }
    };
    const sumAmt = (ids: string[]): number => ids.reduce((s, id) => s + (a.lines.find((l) => l.id === id)?.amount ?? 0), 0);
    const predictedLive = (ln: CapexLineRef): number | null => {
      switch (ln.method) {
        case 'fixed': return ln.rate;
        case 'percent_of_selected': return (ln.rate / 100) * sumAmt(ln.selectedLineIds.filter((id) => id !== ln.id));
        case 'percent_of_construction': return (ln.rate / 100) * sumAmt(a.lines.filter((s) => s.stage === 'hard' && s.id !== ln.id).map((s) => s.id));
        default: return null;
      }
    };
    const lineRows: number[] = []; const landRows: number[] = []; const nonLandRows: number[] = [];
    const inclYear = new Array<number>(N).fill(0); const exclYear = new Array<number>(N).fill(0);
    for (const ln of a.lines) {
      const myRow = totRowOf.get(ln.id)!;
      const isLand = ln.stage === 'land';
      const own = `$E$${myRow}`;
      setLabel(ws.getCell(myRow, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(myRow, C_UOM), ln.basis);
      setFormula(ws.getCell(myRow, C_RATE), fcell(ln.rateAddr, ln.isPercent ? ln.rate / 100 : ln.rate), ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate, true);
      const rateDec = ln.isPercent ? ln.rate / 100 : ln.rate;
      const qtyCached = rateDec !== 0 ? ln.amount / rateDec : 0; // fixed -> amount/rate = 1
      const qtyFmt = moneyBasis.has(ln.method) ? NUMFMT.money : NUMFMT.int;
      const qtyCell = `$D$${myRow}`;
      // Quantity (D) + Total (E = Rate x Quantity). Cross-asset-allocated lines and
      // bases with no reproducible cell fall back to the cached engine value.
      const totCell = `$C$${myRow}*${qtyCell}`; // Total = Rate (C) x Quantity (D)
      if (ln.method === 'fixed') {
        // Lump sum: Quantity = 1, Total = Rate x 1.
        const c = ws.getCell(myRow, C_QTY); c.value = 1; c.numFmt = NUMFMT.int; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
        setFormula(ws.getCell(myRow, C_TOT), fcell(totCell, ln.amount), NUMFMT.money);
      } else {
        const qExpr = qtyExprOf(ln, own);
        const predicted = predictedLive(ln);
        const reconciles = predicted === null || Math.abs(predicted - ln.amount) <= Math.max(1, Math.abs(ln.amount) * 1e-6);
        if (qExpr && reconciles) {
          setFormula(ws.getCell(myRow, C_QTY), fcell(qExpr, qtyCached), qtyFmt, /!/.test(qExpr));
          setFormula(ws.getCell(myRow, C_TOT), fcell(totCell, ln.amount), NUMFMT.money);
        } else {
          // Engine-sourced (cross-asset allocation / no reproducible basis): cache both.
          const dq = ws.getCell(myRow, C_QTY); dq.value = qtyCached; dq.numFmt = qtyFmt; dq.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
          const de = ws.getCell(myRow, C_TOT); de.value = ln.amount; de.numFmt = NUMFMT.money; de.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
        }
      }
      const eCell = `$E$${myRow}`;
      const pcts = allocCells.get(`${a.assetId}|${ln.id}`) ?? [];
      const pp = perPeriodByLine.get(`${a.assetId}|${ln.id}`) ?? [];
      const money0 = (c: number, v: number): void => { const cell = ws.getCell(myRow, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
      money0(C_OPEN, 0); // Period 0: no capex
      for (let t = 0; t < N; t++) {
        const v = pp[t] ?? 0;
        setFormula(ws.getCell(myRow, cP(t)), fcell(`${eCell}*${pcts[t + 1]}`, v), NUMFMT.money);
        inclYear[t] += v; if (!isLand) exclYear[t] += v;
      }
      allLineTotCells.push(eCell);
      lineRows.push(myRow); if (isLand) landRows.push(myRow); else nonLandRows.push(myRow);
      r += 1;
    }
    // Subtotal, {asset} (incl. all land) = SUM of the line rows per column.
    const inclRow = r;
    setLabel(ws.getCell(inclRow, C_LBL), `Subtotal, ${a.name}`, { bold: true });
    setFormula(ws.getCell(inclRow, C_TOT), fcell(colSum('E', lineRows), a.total), NUMFMT.money);
    setFormula(ws.getCell(inclRow, C_OPEN), fcell(colSum(colLetter(C_OPEN), lineRows), 0), NUMFMT.money);
    for (let t = 0; t < N; t++) setFormula(ws.getCell(inclRow, cP(t)), fcell(colSum(colLetter(cP(t)), lineRows), inclYear[t]), NUMFMT.money);
    fillRange(ws, inclRow, 1, inclRow, cLast, ARGB.subtotal);
    for (let c = 1; c <= cLast; c++) ws.getCell(inclRow, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    assetInclRows.push(inclRow);
    const m = inclByName.get(a.name) ?? inclYear;
    assetMeta.push({
      name: a.name, category: cat(a.assetId), inclRow, landRows, nonLandRows,
      exclAll: exclAllByName.get(a.name) ?? exclYear, exclInKind: exclInKindByName.get(a.name) ?? exclYear, incl: m,
    });
    r += 1;
  }
  // Project Total (incl. all land) = the Total Capex (4,912,199,956 on the live project).
  cSum(r, 'Project Total (incl. all land)', assetInclRows, sumSeries(assetMeta.map((m) => m.incl), N), 'navy');
  const projTotalRow = r; r += 2;

  // ── OUTPUT Tables 2-4: asset-wise summaries (reference Table 1) ───────────────
  // Each per-asset row is live off Table 1: incl = the asset subtotal; excl-total-
  // land = the asset's non-land lines; excl-in-kind = incl - in-kind land.
  const summaryTable = (title: string, totalLabel: string, perAsset: (m: AssetMeta) => { f: (col: string) => string; cached: number[]; predicted?: number[] }, totalCached: number[]): void => {
    setSectionHeader(ws.getRow(r), title, cLast); r += 1;
    const rows: number[] = [];
    for (const m of assetMeta) {
      const { f, cached, predicted } = perAsset(m);
      setLabel(ws.getCell(r, C_LBL), m.name, { indent: 1 });
      setFormula(ws.getCell(r, C_OPEN), fcell(f(colLetter(C_OPEN)), 0), NUMFMT.money);
      for (let t = 0; t < N; t++) {
        const v = cached[t] ?? 0;
        // Verify-and-fallback: if the live formula would drift from the engine
        // value, store the cached constant so the table opens AND recalculates right.
        const drift = predicted ? Math.abs((predicted[t] ?? 0) - v) > Math.max(1, Math.abs(v) * 1e-6) : false;
        if (drift) { const cell = ws.getCell(r, cP(t)); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
        else setFormula(ws.getCell(r, cP(t)), fcell(f(colLetter(cP(t))), v), NUMFMT.money);
      }
      setFormula(ws.getCell(r, C_TOT), fcell(`SUM(${cRange(r)})`, cached.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
      rows.push(r); r += 1;
    }
    cSum(r, totalLabel, rows, totalCached, 'navy'); r += 2;
  };

  summaryTable('Table 2 - Total Capex Including Land Value', 'Total Capex (incl. all land)',
    (m) => ({ f: (col) => `${col}${m.inclRow}`, cached: m.incl }), sumSeries(assetMeta.map((m) => m.incl), N));
  summaryTable('Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)', 'Total Capex (excl. land in-kind)',
    (m) => {
      const lnd = landAddrs.get(refs.capex.find((a) => a.name === m.name)?.assetId ?? '');
      const frac = lnd ? `IFERROR(${lnd.inKindLand}/${lnd.landValue},0)` : '0';
      const landSum = (col: string): string => (m.landRows.length ? colSum(col, m.landRows) : '0');
      const landTot = m.incl.map((v, t) => v - (m.exclAll[t] ?? 0));
      const inKindTot = m.incl.map((v, t) => v - (m.exclInKind[t] ?? 0));
      const Ld = landTot.reduce((s, v) => s + v, 0); const Ik = inKindTot.reduce((s, v) => s + v, 0);
      const fr = Ld > 0 ? Ik / Ld : 0;
      const predicted = m.incl.map((v, t) => v - (landTot[t] ?? 0) * fr);
      return { f: (col) => `${col}${m.inclRow}-(${landSum(col)})*${frac}`, cached: m.exclInKind, predicted };
    }, sumSeries(assetMeta.map((m) => m.exclInKind), N));
  summaryTable('Table 4 - Capex Excluding Total Land (pure development cost)', 'Total Capex (excl. all land)',
    (m) => ({ f: (col) => (m.nonLandRows.length ? colSum(col, m.nonLandRows) : '0'), cached: m.exclAll }), sumSeries(assetMeta.map((m) => m.exclAll), N));

  // Build-up vs phased reconciliation. Build-up grand = sum of every line Total (E);
  // phased grand = Table 1 Project Total. The Checks sheet asserts they tie.
  setLabel(ws.getCell(r, C_LBL), 'Grand build-up (sum of line Totals)', { bold: true });
  setFormula(ws.getCell(r, C_TOT), fcell(allLineTotCells.length ? allLineTotCells.join('+') : '0', grandCapex), NUMFMT.money);
  const buildupTotalAddr = sheetRef(SHEETS.capex, `$E$${r}`);
  const scheduleTotalAddr = sheetRef(SHEETS.capex, `$E$${projTotalRow}`);

  return { scheduleTotalAddr, buildupTotalAddr };
}

/** Element-wise sum of equal-length series (padded to N). */
function sumSeries(series: number[][], N: number): number[] {
  const o = new Array<number>(N).fill(0);
  for (const s of series) for (let t = 0; t < N; t++) o[t] += s[t] ?? 0;
  return o;
}

// ── Financing (live debt roll-forward + equity + IDC) ─────────────────────────
function addFinancing(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, refs: AssumptionRefs, landAddrs: Map<string, LandAreaAssetAddrs>): void {
  const ws = wb.addWorksheet(SHEETS.financing, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  const fin = snap.financing;
  writeSheetHeader(ws, snap, N, 'Financing', 'Full Financing module mirror. INPUTS (top) link each assumption in once from Assumptions; every calculation below references those LOCAL cells. Sections: Funding requirement (Methods 1-3 + selected), debt + equity required, per-facility debt movement (interest = rate x balance off the local rate), combined debt, finance cost, IDC allocation by asset, equity movement, IDC pool, Funding Gap (Method 2 + Method 3 waterfall) and the Cash Sweep waterfall + dividends + per-tranche sweep. Engine-derived circular series (gap-sized debt, IDC / sweep budgets, cash-flow bases) are cached pending the Cash-Flow unit.', { label: 'Facility / line' });
  const lastCol = lastActiveCol(N);

  const sliceN = (a: number[] | undefined): number[] => (a ?? []).slice(0, N);
  const openingSeries = (closing: number[], init: number): number[] => { const o = new Array<number>(N).fill(0); o[0] = init; for (let i = 1; i < N; i++) o[i] = closing[i - 1] ?? 0; return o; };
  const colP = (t: number): string => colLetter(pcol(t));
  let r = 5;

  // A single financing row: opening cell (E) + per-period (formula or cached) + Total (D).
  const finRow = (label: string, open: { f?: string; v: number }, per: (t: number) => { f?: string; v: number }, total: 'sum' | 'last', opts: { indent?: number; bold?: boolean } = {}): number => {
    const rowN = r;
    setLabel(ws.getCell(`A${rowN}`), label, opts);
    const put = (c: number, x: { f?: string; v: number }): void => {
      if (x.f) { setFormula(ws.getCell(rowN, c), fcell(x.f, x.v), NUMFMT.money); }
      else { const cell = ws.getCell(rowN, c); cell.value = x.v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    };
    put(OPEN_COL, open);
    const cached: number[] = [];
    for (let t = 0; t < N; t++) { const x = per(t); put(pcol(t), x); cached.push(x.v); }
    const totF = total === 'sum' ? `SUM(${activeRange(N, rowN)})` : `${colLetter(lastActiveCol(N))}${rowN}`;
    const totV = total === 'sum' ? cached.reduce((s, v) => s + v, 0) : (cached[N - 1] ?? 0);
    setFormula(ws.getCell(rowN, TOTAL_COL), fcell(totF, totV), NUMFMT.money);
    if (opts.bold) for (let c = 1; c <= lastCol; c++) { const cell = ws.getCell(rowN, c); cell.font = { ...(cell.font as object), bold: true }; }
    r += 1;
    return rowN;
  };

  const gap = computeFundingGap(snap);
  const w3 = gap.method3Waterfall;
  const p = state.project;

  // ── INPUTS (linked from Assumptions) ──────────────────────────────────────
  // Every assumption this tab needs is pulled in ONCE here via a simple link;
  // all calculations below reference these LOCAL cells (not long cross-sheet
  // paths), so the math reads and audits entirely within the Financing tab.
  setSectionHeader(ws.getRow(r), 'Inputs (linked from Assumptions)', lastCol); r += 1;
  const localScalar = (label: string, link: string, cached: number, fmt: string): string => {
    setLabel(ws.getCell(`A${r}`), label);
    if (link) setFormula(ws.getCell(r, TOTAL_COL), fcell(link, cached), fmt, true);
    else { const cell = ws.getCell(r, TOTAL_COL); cell.value = cached; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    const a = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return a;
  };
  setLabel(ws.getCell(`A${r}`), 'Funding method'); { const c = ws.getCell(r, TOTAL_COL); c.value = FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; c.alignment = { horizontal: 'right' }; } r += 1;
  const Lscalar = {
    debtPct: localScalar('Debt share', 'DebtPct', fin.funding.debtPct / 100, NUMFMT.pct),
    equityPct: localScalar('Equity share', 'EquityPct', fin.funding.equityPct / 100, NUMFMT.pct),
    minCash: localScalar('Minimum cash reserve', 'MinCashReserve', fin.funding.minCashReserve ?? 0, NUMFMT.money),
    divEnabled: localScalar('Dividends enabled (1 = yes)', refs.financingScalars.dividendEnabled, p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int),
    divPayout: localScalar('Dividend payout ratio', refs.financingScalars.dividendPayout, (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct),
    divStart: localScalar('Dividend start year', refs.financingScalars.dividendStart, p.dividendStartYear ?? 0, NUMFMT.year),
    sweepStart: localScalar('Sweep starting year', refs.financingScalars.sweepStart, (p.financing as { cashSweep?: { startingYear?: number } } | undefined)?.cashSweep?.startingYear ?? 0, NUMFMT.year),
    sweepRatio: localScalar('Sweep ratio (% of surplus)', refs.financingScalars.sweepRatio, ((p.financing as { cashSweep?: { sweepRatioPct?: number } } | undefined)?.cashSweep?.sweepRatioPct ?? 100) / 100, NUMFMT.pct),
  };
  // Per-facility terms table (each value linked once from Assumptions).
  const facInputs = new Map<string, { rate: string; open: string; periods: string }>();
  if (state.financingTranches.length) {
    setColHeader(ws.getCell(r, LBL_COL), 'Facility terms', 'left');
    setColHeader(ws.getCell(r, TOTAL_COL), 'Interest rate', 'right');
    setColHeader(ws.getCell(r, OPEN_COL), 'Opening balance', 'right');
    setColHeader(ws.getCell(r, OPEN_COL + 1), 'Repay periods', 'right');
    r += 1;
    for (const t of state.financingTranches) {
      const trRef = refs.tranches.find((x) => x.id === t.id);
      const rateVal = (t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0))) / 100;
      setLabel(ws.getCell(`A${r}`), t.name);
      if (trRef) {
        setFormula(ws.getCell(r, TOTAL_COL), fcell(trRef.rate, rateVal), NUMFMT.pct2, true);
        setFormula(ws.getCell(r, OPEN_COL), fcell(trRef.openingBalance, t.openingBalance ?? 0), NUMFMT.money, true);
        setFormula(ws.getCell(r, OPEN_COL + 1), fcell(trRef.periods, t.repaymentPeriods ?? 0), NUMFMT.int, true);
      }
      facInputs.set(t.id, { rate: `$${colLetter(TOTAL_COL)}$${r}`, open: `$${colLetter(OPEN_COL)}$${r}`, periods: `$${colLetter(OPEN_COL + 1)}$${r}` });
      r += 1;
    }
  }
  r += 1;

  // ── Funding requirement (Method 1 / 2 / 3 + selected, mirrors the Inputs tab) ─
  setSectionHeader(ws.getRow(r), 'Funding requirement', lastCol); r += 1;
  cachedRow(ws, r, N, 'Method 1 (Total Capex, excl. land in-kind)', sliceN(fin.capex.perPeriod.exclLandInKind), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Method 2 (Net Funding Requirement)', sliceN(gap.methodAGapPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Method 3 (Cash Deficit Funding)', sliceN(w3.netCashRequiredPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Selected method', sliceN(fin.funding.selectedByPeriod), { bold: true }); const selectedFundingRow = r; r += 1;
  cachedRow(ws, r, N, 'Minimum cash requirement', sliceN(fin.funding.minCashByPeriod), { indent: 1 }); const minCashReqRow = r; r += 1;
  navySumRow(ws, r, N, 'Total funding need', [selectedFundingRow, minCashReqRow], sliceN(fin.funding.totalFundingNeedByPeriod), 'subtotal'); r += 2;

  // ── Total debt + equity required (the funding split) ─────────────────────────
  setSectionHeader(ws.getRow(r), 'Total debt + equity required', lastCol); r += 1;
  cachedRow(ws, r, N, 'Total debt required', sliceN(fin.debtEquitySplit.debt), { bold: true }); r += 2;
  cachedRow(ws, r, N, 'Cash contribution', sliceN(fin.debtEquitySplit.equity), { indent: 1 }); const eqCashReqRow = r; r += 1;
  cachedRow(ws, r, N, 'In-kind contribution', sliceN(fin.debtEquitySplit.inKind), { indent: 1 }); const eqInKindReqRow = r; r += 1;
  navySumRow(ws, r, N, 'Total equity required', [eqCashReqRow, eqInKindReqRow], sliceN(fin.equity.totalPerPeriod), 'subtotal'); r += 2;

  // ── Engine-derived cash budgets (CACHED inputs; the only non-formula rows) ──
  // Recomputed exactly as the snapshot's fixed-point solver derives them
  // (deriveCircularInputs). They break the Financing<->CashFlow cycle so the
  // schedule is a pure forward recurrence on this sheet. BACKLOG: convert to
  // live Cash-Flow references when the Cash-Flow unit lands.
  const idcCashBudget = new Array<number>(N).fill(0);
  {
    const capC = fin.combined.totalInterestCapitalized;
    const capCashC = fin.combined.totalInterestCapitalizedCashPaid;
    for (let t = 0; t < N; t++) {
      const ci = (capC[t] ?? 0) + (capCashC[t] ?? 0);
      if (ci <= 0) continue;
      const surplus = Math.max(0, (w3.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0) - w3.minCashReserve);
      if (surplus > 0) idcCashBudget[t] = surplus;
    }
  }
  const sweepBudget = new Array<number>(N).fill(0);
  {
    const minCashS = snap.cashSweep.minCashReserve;
    const closingC = snap.directCF.closingCashPerPeriod;
    const sweepC = snap.cashSweep.totalSweepPerPeriod;
    const divC = snap.dividends.totalDividendsPerPeriod;
    for (let t = 0; t < N; t++) {
      const preDist = (closingC[t] ?? 0) + (sweepC[t] ?? 0) + (divC[t] ?? 0);
      sweepBudget[t] = Math.max(0, preDist - minCashS);
    }
  }
  let idcBudgetRow = -1, sweepBudgetRow = -1;
  const hasIdcBudget = idcCashBudget.some((v) => v !== 0);
  const hasSweepBudget = sweepBudget.some((v) => v !== 0);
  if (hasIdcBudget || hasSweepBudget) {
    setSectionHeader(ws.getRow(r), 'Engine-derived cash budgets (cached inputs, convert to live CF refs later)', lastCol); r += 1;
    if (hasIdcBudget) { cachedRow(ws, r, N, 'IDC cash budget', idcCashBudget, { indent: 1 }); idcBudgetRow = r; r += 1; }
    if (hasSweepBudget) { cachedRow(ws, r, N, 'Cash-sweep budget', sweepBudget, { indent: 1 }); sweepBudgetRow = r; r += 1; }
    // Style the budget value cells as inputs (these are the cached circular inputs).
    for (const br of [idcBudgetRow, sweepBudgetRow]) {
      if (br < 0) continue;
      for (let t = 0; t < N; t++) markInput(ws.getCell(br, pcol(t)));
    }
    r += 1;
  }

  const tr = (id: string) => state.financingTranches.find((t) => t.id === id);
  const ordered = [...fin.facilities.entries()]
    .filter(([id, f]) => nz(f.drawSchedule) || nz(f.outstanding) || (tr(id)?.openingBalance ?? 0) > 0)
    .sort(([a], [b]) => ((tr(a)?.origin === 'existing' ? 0 : 1) - (tr(b)?.origin === 'existing' ? 0 : 1)));

  const projectSweep = (state.project.financing as { cashSweep?: { startingYear?: number; sweepRatioPct?: number } } | undefined)?.cashSweep ?? {};
  const constructionColsByFacility: boolean[][] = [];
  const interestRowsAll: number[] = [];
  const idcCapRowsAll: number[] = [];
  const cashIntRowsAll: number[] = [];
  const principalRows: number[] = [];
  const sweepRows: number[] = [];
  const closingRows: number[] = [];
  interface FacMeta { id: string; name: string; existing: boolean; interestRow: number; idcCapRow: number; cashIntRow: number; schedPrinRow: number; sweepRow: number; closingRow: number; accrued: number[]; idcCap: number[]; cashPaid: number[]; schedPrin: number[]; sweep: number[] }
  const facMeta: FacMeta[] = [];
  const totInterest = new Array<number>(N).fill(0);
  const totPrincipal = new Array<number>(N).fill(0);
  const totSweep = new Array<number>(N).fill(0);
  const totClosing = new Array<number>(N).fill(0);
  const priorSweepRows: number[] = [];   // sweep rows of facilities processed earlier (shared budget, existing-first)
  const priorNewCashIntRows: number[] = []; // construction cash-paid rows of prior NEW facilities (shared IDC budget)
  const fallbackPrincipalLabels: string[] = [];

  for (const [id, f] of ordered) {
    const t0 = tr(id);
    const existing = t0?.origin === 'existing';
    const priorBal = existing ? Math.max(0, t0?.openingBalance ?? 0) : 0;
    const closing = sliceN(f.outstanding);
    const opening = openingSeries(closing, priorBal);
    const draw = sliceN(f.drawSchedule);
    const idcCap = sliceN(f.interestCapitalized);
    const accrued = sliceN(f.interestAccrued);
    const repaid = sliceN(f.principalRepaid);
    const sweep = sliceN(f.sweepRepaid);
    const idcWindow = sliceN(f.interestDuringConstruction);
    const schedPrin = repaid.map((v, i) => (v ?? 0) - (sweep[i] ?? 0)); // non-sweep principal
    const constructionCols = idcWindow.map((v) => (v ?? 0) > 0);
    constructionColsByFacility.push(constructionCols);
    const fi = facInputs.get(id);
    const rateAddr = fi?.rate ?? '0';        // LOCAL rate cell (links to Assumptions)
    const openBalAddr = fi?.open;            // LOCAL opening-balance cell
    for (let t = 0; t < N; t++) { totClosing[t] += closing[t] ?? 0; totInterest[t] += accrued[t] ?? 0; totPrincipal[t] += schedPrin[t] ?? 0; totSweep[t] += sweep[t] ?? 0; }

    // Sweep eligibility / start / ratio (mirror schedule.ts).
    const sweepCfg = (t0?.cashSweepConfig ?? {}) as { enabled?: boolean; startingYear?: number; sweepRatio?: number };
    const sweepEligible = t0?.repaymentMethod === 'cash_sweep' || t0?.repaymentMethod === 'cashsweep_from_period'
      || t0?.repaymentMethod === 'cashsweep_min_cash' || sweepCfg.enabled === true;
    const effStartYear = projectSweep.startingYear ?? sweepCfg.startingYear;
    const sweepStart = effStartYear !== undefined && Number.isFinite(effStartYear)
      ? Math.max(0, Math.min(N - 1, effStartYear - snap.projectStartYear)) : 0;
    const ratio = Math.max(0, Math.min(1, (projectSweep.sweepRatioPct ?? sweepCfg.sweepRatio ?? 100) / 100));
    const ratioF = ratio === 1 ? '' : `*${ratio}`;

    setSectionHeader(ws.getRow(r), `Debt movement, ${t0?.name ?? id}${existing ? ' (existing)' : ''}`, lastCol); r += 1;
    const openingRow = r, capexDrawRow = r + 1, interestRow = r + 2, idcCapRow = r + 3, cashIntRow = r + 4, schedPrinRow = r + 5, sweepRow = r + 6, totalDrawRow = r + 7, closingRow = r + 8;
    const balAfterIdc = (t: number): string => `${colP(t)}${openingRow}+${colP(t)}${capexDrawRow}+${colP(t)}${idcCapRow}`;
    const balAfterPrin = (t: number): string => `${balAfterIdc(t)}-${colP(t)}${schedPrinRow}`;

    finRow('Opening', { f: priorBal > 0 && openBalAddr ? openBalAddr : undefined, v: priorBal },
      (t) => (t === 0 ? { f: `${colLetter(OPEN_COL)}${openingRow}`, v: opening[0] } : { f: `${colP(t - 1)}${closingRow}`, v: opening[t] ?? 0 }), 'last');
    finRow('Capex drawdown (gap-sized debt)', { v: 0 }, (t) => ({ v: draw[t] ?? 0 }), 'sum', { indent: 1 }); // CACHED budget
    finRow('Interest accrued (rate x balance)', { v: 0 }, (t) => ({ f: `(${colP(t)}${openingRow}+${colP(t)}${capexDrawRow})*${rateAddr}`, v: accrued[t] ?? 0 }), 'sum', { indent: 1 });
    finRow('IDC capitalised (to debt)', { v: 0 }, (t) => {
      // Construction-window interest for a NEW facility goes to the debt balance
      // when the project capitalises IDC. Conditional mode pays the part covered
      // by the surplus cash budget IN CASH and capitalises only the shortfall
      // (MAX(0, interest − available)); every other capitalising mode (and
      // conditional with no surplus) capitalises the FULL construction interest.
      if (existing || !constructionCols[t] || !snap.idc.capitalize) return { v: 0 };
      if (idcBudgetRow > 0) {
        const avail = priorNewCashIntRows.length
          ? `(${colP(t)}${idcBudgetRow}-(${priorNewCashIntRows.map((rr) => `${colP(t)}${rr}`).join('+')}))`
          : `${colP(t)}${idcBudgetRow}`;
        return { f: `MAX(0,${colP(t)}${interestRow}-${avail})`, v: idcCap[t] ?? 0 };
      }
      return { f: `${colP(t)}${interestRow}`, v: idcCap[t] ?? 0 };
    }, 'sum', { indent: 1 });
    finRow('Cash interest paid', { v: 0 }, (t) => ({ f: `${colP(t)}${interestRow}-${colP(t)}${idcCapRow}`, v: (accrued[t] ?? 0) - (idcCap[t] ?? 0) }), 'sum', { indent: 1 });
    // Scheduled principal (non-sweep): live straight-line / equal-principal
    // (a constant slice), zero for cash-sweep facilities (all principal flows
    // through the sweep), cached fallback for the rest (annuity / bullet /
    // balloon / yoy / manual). The slice = total drawn / number of repay periods.
    const method = t0?.repaymentMethod ?? '';
    const subM = t0?.equalRepaymentSubMethod ?? 'equal_total';
    const isSlice = !existing && (method === 'straight_line' || (method === 'equal_repayment' && subM === 'equal_principal'));
    const windowCount = schedPrin.filter((v) => (v ?? 0) > 1e-6).length;
    const drawSumF = `SUM(${colLetter(pcol(0))}${capexDrawRow}:${colLetter(lastActiveCol(N))}${capexDrawRow})`;
    let principalReconciles = true;
    finRow('Principal repaid (scheduled)', { v: 0 }, (t) => {
      const sched = schedPrin[t] ?? 0;
      if (sched <= 1e-6) return { v: 0 };
      if (isSlice && windowCount > 0) return { f: `MIN(${balAfterIdc(t)},${drawSumF}/${windowCount})`, v: sched };
      principalReconciles = false;
      return { v: sched }; // cached fallback (non-reproducible repayment method)
    }, 'sum', { indent: 1 });
    if (!principalReconciles) fallbackPrincipalLabels.push(t0?.name ?? id);
    finRow('Cash sweep repaid', { v: 0 }, (t) => {
      if (!sweepEligible || t < sweepStart) return { v: 0 };
      const avail = priorSweepRows.length
        ? `(${colP(t)}${sweepBudgetRow}-(${priorSweepRows.map((rr) => `${colP(t)}${rr}`).join('+')}))`
        : `${colP(t)}${sweepBudgetRow}`;
      if (sweepBudgetRow < 0) return { v: sweep[t] ?? 0 };
      return { f: `MIN(${balAfterPrin(t)},(${avail})${ratioF})`, v: sweep[t] ?? 0 };
    }, 'sum', { indent: 1 });
    finRow('Total drawdown', { v: 0 }, (t) => ({ f: `${colP(t)}${capexDrawRow}+${colP(t)}${idcCapRow}`, v: (draw[t] ?? 0) + (idcCap[t] ?? 0) }), 'sum', { bold: true });
    finRow('Closing', { f: priorBal > 0 && openBalAddr ? openBalAddr : undefined, v: priorBal },
      (t) => ({ f: `${colP(t)}${openingRow}+${colP(t)}${totalDrawRow}-${colP(t)}${schedPrinRow}-${colP(t)}${sweepRow}`, v: closing[t] ?? 0 }), 'last', { bold: true });

    interestRowsAll.push(interestRow); idcCapRowsAll.push(idcCapRow); cashIntRowsAll.push(cashIntRow);
    principalRows.push(schedPrinRow); sweepRows.push(sweepRow); closingRows.push(closingRow);
    priorSweepRows.push(sweepRow);
    if (!existing) priorNewCashIntRows.push(cashIntRow);
    facMeta.push({ id, name: t0?.name ?? id, existing, interestRow, idcCapRow, cashIntRow, schedPrinRow, sweepRow, closingRow,
      accrued, idcCap, cashPaid: accrued.map((v, i) => (v ?? 0) - (idcCap[i] ?? 0)), schedPrin, sweep });
    r += 1;
  }

  // Combined debt totals (live sums across facilities).
  if (closingRows.length) {
    setSectionHeader(ws.getRow(r), 'Combined debt', lastCol); r += 1;
    finRow('Total interest accrued', { v: 0 }, (t) => ({ f: colSum(colP(t), interestRowsAll), v: totInterest[t] ?? 0 }), 'sum', { bold: true });
    finRow('Total principal repaid', { v: 0 }, (t) => ({ f: colSum(colP(t), principalRows), v: totPrincipal[t] ?? 0 }), 'sum', { indent: 1 });
    finRow('Total cash sweep', { v: 0 }, (t) => ({ f: colSum(colP(t), sweepRows), v: totSweep[t] ?? 0 }), 'sum', { indent: 1 });
    finRow('Total debt outstanding', { v: 0 }, (t) => ({ f: colSum(colP(t), closingRows), v: totClosing[t] ?? 0 }), 'last', { bold: true });
    r += 1;
  }

  // ── Finance cost roll-forward (per facility + combined; live within-tab) ─────
  // Each period settles to zero: Opening 0 + Charge − Capitalised − Paid = Closing 0.
  // Charge / Capitalised / Paid link to the per-facility debt-movement rows above,
  // so the whole block recalculates off the local rate input.
  if (facMeta.length) {
    setSectionHeader(ws.getRow(r), 'Finance cost', lastCol); r += 1;
    for (const m of facMeta) {
      setLabel(ws.getCell(`A${r}`), `Finance cost, ${m.name}${m.existing ? ' (existing)' : ''}`, { bold: true });
      fillRange(ws, r, 1, r, lastCol, ARGB.subtotal);
      for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
      r += 1;
      finRow('Opening', { v: 0 }, () => ({ v: 0 }), 'last', { indent: 1 });
      finRow('Charge (accrued)', { v: 0 }, (t) => ({ f: `${colP(t)}${m.interestRow}`, v: m.accrued[t] ?? 0 }), 'sum', { indent: 1 });
      finRow('Capitalised', { v: 0 }, (t) => ({ f: `-${colP(t)}${m.idcCapRow}`, v: -(m.idcCap[t] ?? 0) }), 'sum', { indent: 1 });
      finRow('Paid', { v: 0 }, (t) => ({ f: `-${colP(t)}${m.cashIntRow}`, v: -(m.cashPaid[t] ?? 0) }), 'sum', { indent: 1 });
      finRow('Closing', { v: 0 }, () => ({ v: 0 }), 'last', { indent: 1 });
    }
    if (facMeta.length > 1) {
      setSectionHeader(ws.getRow(r), 'Combined finance cost', lastCol); r += 1;
      finRow('Charge (accrued, all debt)', { v: 0 }, (t) => ({ f: colSum(colP(t), interestRowsAll), v: totInterest[t] ?? 0 }), 'sum', { indent: 1, bold: true });
      finRow('Capitalised', { v: 0 }, (t) => ({ f: `-(${colSum(colP(t), idcCapRowsAll)})`, v: -(fin.combined.totalInterestCapitalized[t] ?? 0) }), 'sum', { indent: 1 });
      finRow('Paid', { v: 0 }, (t) => ({ f: `-(${colSum(colP(t), cashIntRowsAll)})`, v: -((totInterest[t] ?? 0) - (fin.combined.totalInterestCapitalized[t] ?? 0)) }), 'sum', { indent: 1 });
    }
    r += 1;
  }

  // Equity movement (LIVE, not cached): in-kind links to Land & Area in-kind
  // land, existing links to the Assumptions historical-equity inputs, cash is 0
  // (no gap-residual). Each period carries the engine's timing share of the
  // live source total, so the rows reconcile period-by-period. Total = live sum.
  const eq = fin.equity;
  setSectionHeader(ws.getRow(r), 'Equity movement', lastCol); r += 1;
  const inKindArr = sliceN(eq.inKindPerPeriod);
  const existingArr = sliceN(eq.existingEquityPerPeriod);
  const cashArr = sliceN(eq.cashPerPeriod);
  const inKindCells = [...landAddrs.values()].map((a) => a.inKindLand);
  const inKindSumF = inKindCells.length ? inKindCells.join('+') : '0';
  const existingCells = refs.existingEquity.map((e) => e.amount);
  const existingSumF = existingCells.length ? existingCells.join('+') : '0';
  const inKindTotal = inKindArr.reduce((s, v) => s + (v ?? 0), 0);
  const existingTotal = existingArr.reduce((s, v) => s + (v ?? 0), 0);
  // A per-period row that distributes a live source total by the engine's
  // per-period share (share=1 -> full source link; 0 -> 0; fractional -> share x source).
  const liveEquityRow = (label: string, values: number[], total: number, sourceF: string): number => {
    const rowN = r;
    setLabel(ws.getCell(`A${rowN}`), label, { indent: 1 });
    const money0 = (c: number, v: number): void => { const cell = ws.getCell(rowN, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    money0(OPEN_COL, 0);
    for (let t = 0; t < N; t++) {
      const v = values[t] ?? 0;
      const share = total > 0 ? v / total : 0;
      if (share === 0 || sourceF === '0') money0(pcol(t), v);
      else setFormula(ws.getCell(rowN, pcol(t)), fcell(Math.abs(share - 1) < 1e-9 ? `${sourceF}` : `(${sourceF})*${share}`, v), NUMFMT.money);
    }
    setFormula(ws.getCell(rowN, TOTAL_COL), fcell(`SUM(${activeRange(N, rowN)})`, total), NUMFMT.money);
    r += 1;
    return rowN;
  };
  const eqRows: number[] = [];
  eqRows.push(liveEquityRow('Cash equity', cashArr, cashArr.reduce((s, v) => s + (v ?? 0), 0), '0'));
  eqRows.push(liveEquityRow('In-kind equity (to Land & Area in-kind land)', inKindArr, inKindTotal, inKindSumF));
  eqRows.push(liveEquityRow('Existing equity (to Assumptions historical equity)', existingArr, existingTotal, existingSumF));
  navySumRow(ws, r, N, 'Total equity', eqRows, sliceN(eq.totalPerPeriod)); r += 2;

  // IDC pool (live structural sums of the per-facility rows). Depreciation /
  // NBV are downstream Fixed-Asset outputs, surfaced in that module, not here.
  setSectionHeader(ws.getRow(r), 'IDC pool', lastCol); r += 1;
  const idcS = snap.idc;
  // Construction interest = sum of facility interest cells in their construction columns.
  const constrInterestCell = (t: number): string => {
    const cells: number[] = [];
    interestRowsAll.forEach((rr, fi) => { if (constructionColsByFacility[fi]?.[t]) cells.push(rr); });
    return cells.length ? colSum(colP(t), cells) : '0';
  };
  const constrInterestRow = finRow('Construction interest', { v: 0 }, (t) => ({ f: constrInterestCell(t), v: idcS.totalConstructionInterestPerPeriod[t] ?? 0 }), 'sum', { indent: 1 });
  finRow('Capitalised to debt', { v: 0 }, (t) => ({ f: colSum(colP(t), idcCapRowsAll), v: fin.combined.totalInterestCapitalized[t] ?? 0 }), 'sum', { indent: 1 });
  finRow('Paid in cash (conditional)', { v: 0 }, (t) => ({ f: `(${constrInterestCell(t)})-(${colSum(colP(t), idcCapRowsAll)})`, v: fin.combined.totalInterestCapitalizedCashPaid[t] ?? 0 }), 'sum', { indent: 1 });
  finRow('Capitalised to asset basis', { v: 0 }, (t) => ({ f: constrInterestCell(t), v: idcS.totalIdcPerPeriod[t] ?? 0 }), 'sum', { indent: 1 });
  r += 1;

  // ── IDC allocation by asset (live: asset share x the construction-interest row) ─
  // Only meaningful when interest is capitalised (otherwise it flows to P&L and
  // the per-asset basis is zero).
  const idcAssets = [...idcS.byAsset.values()].filter((a) => a.totalIdc > 0 || (a.idcPerPeriod ?? []).some((v) => (v ?? 0) !== 0));
  if (idcS.capitalize && idcAssets.length) {
    setSectionHeader(ws.getRow(r), `IDC allocation by asset (basis: ${idcS.allocationBasis}; capitalised to asset basis)`, lastCol); r += 1;
    const idcAssetRows: number[] = [];
    for (const a of idcAssets) {
      const share = a.shareOfTotalLand ?? 0;
      const rr = finRow(a.assetName, { v: 0 }, (t) => ({ f: `${colP(t)}${constrInterestRow}*${share}`, v: a.idcPerPeriod[t] ?? 0 }), 'sum', { indent: 1 });
      idcAssetRows.push(rr);
    }
    navySumRow(ws, r, N, 'Total IDC allocated', idcAssetRows, sliceN(idcS.totalIdcPerPeriod), 'subtotal'); r += 2;
  }

  // ── Funding Gap, Method 2 (Net Funding Requirement: Capex vs Pre-Sales) ──────
  setSectionHeader(ws.getRow(r), 'Funding Gap, Method 2 (Net Funding Requirement)', lastCol); r += 1;
  cachedRow(ws, r, N, 'Total project capex (excl. land in-kind)', sliceN(gap.capexPerPeriod), { indent: 1 }); const m2Capex = r; r += 1;
  cachedRow(ws, r, N, 'Advance received from customer (gross)', sliceN(gap.preSalesGrossPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Less: escrow held', sliceN(gap.escrowHeldPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Add: escrow release', sliceN(gap.escrowReleasePerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, 'Pre-sales (net of escrow)', sliceN(gap.preSalesNetPerPeriod), { indent: 1 }); const m2Net = r; r += 1;
  cachedRow(ws, r, N, 'Funding fulfilled by pre-sales', sliceN(gap.fulfilledByPreSalesPerPeriod), { indent: 1 }); r += 1;
  const m2GapRow = finRow('Funding gap = MAX(0, capex − pre-sales net prior)', { v: 0 },
    (t) => ({ f: t === 0 ? `MAX(0,${colP(0)}${m2Capex})` : `MAX(0,${colP(t)}${m2Capex}-${colP(t - 1)}${m2Net})`, v: gap.methodAGapPerPeriod[t] ?? 0 }), 'sum', { bold: true });
  const m2CumRow = r;
  finRow('Cumulative funding gap', { v: 0 },
    (t) => ({ f: t === 0 ? `${colP(0)}${m2GapRow}` : `${colP(t - 1)}${m2CumRow}+${colP(t)}${m2GapRow}`, v: gap.methodAGapCumulative[t] ?? 0 }), 'last', { indent: 1 });
  r += 1;

  // ── Funding Gap, Method 3 (Cash Deficit waterfall) ──────────────────────────
  setSectionHeader(ws.getRow(r), 'Funding Gap, Method 3 (Cash Deficit waterfall)', lastCol); r += 1;
  cachedRow(ws, r, N, 'Opening cash', sliceN(w3.openingCashPerPeriod), { indent: 1 }); const w3Open = r; r += 1;
  cachedRow(ws, r, N, '(+) Cash from operations', sliceN(w3.cashFromOpsPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, '(+) Cash from investing', sliceN(w3.cashFromInvPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, '(−) Finance cost paid', sliceN(w3.financeCostPaidPerPeriod), { indent: 1 }); r += 1;
  cachedRow(ws, r, N, '(−) Dividends (before sweep)', sliceN(w3.dividendsBeforeSweepPerPeriod), { indent: 1 }); const w3Div = r; r += 1;
  const w3AvailRow = finRow('Cash available (before new funding)', { v: 0 },
    (t) => ({ f: `SUM(${colP(t)}${w3Open}:${colP(t)}${w3Div})`, v: w3.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0 }), 'last', { bold: true });
  const w3NetRow = finRow('Net cash required = MAX(0, min cash − available)', { v: 0 },
    (t) => ({ f: `MAX(0,${Lscalar.minCash}-${colP(t)}${w3AvailRow})`, v: w3.netCashRequiredPerPeriod[t] ?? 0 }), 'sum', { bold: true });
  finRow('of which: new debt', { v: 0 }, (t) => ({ f: `${colP(t)}${w3NetRow}*${Lscalar.debtPct}`, v: (w3.netCashRequiredPerPeriod[t] ?? 0) * (fin.funding.debtPct / 100) }), 'sum', { indent: 1 });
  finRow('of which: new equity', { v: 0 }, (t) => ({ f: `${colP(t)}${w3NetRow}*${Lscalar.equityPct}`, v: (w3.netCashRequiredPerPeriod[t] ?? 0) * (fin.funding.equityPct / 100) }), 'sum', { indent: 1 });
  cachedRow(ws, r, N, '(+) IDC capitalised to debt', sliceN(w3.idcDrawdownPerPeriod), { indent: 1 }); r += 1;
  finRow('Closing cash (after funding, before sweep)', { v: 0 },
    (t) => ({ f: `MAX(${Lscalar.minCash},${colP(t)}${w3AvailRow})`, v: Math.max(w3.minCashReserve, w3.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0) }), 'last', { bold: true });
  r += 1;

  // ── Cash Sweep waterfall (Operations → Debt → Dividend → Closing) ───────────
  const dcf = snap.directCF; const div = snap.dividends; const sweep = snap.cashSweep;
  setSectionHeader(ws.getRow(r), 'Cash Sweep, waterfall (Operations → Debt → Dividend → Closing)', lastCol); r += 1;
  cachedRow(ws, r, N, 'Opening cash', sliceN(dcf.openingCashPerPeriod), { indent: 1 }); const cwOpen = r; r += 1;
  cachedRow(ws, r, N, '(+) Cash from operations', sliceN(dcf.cashFromOperationsPerPeriod), { indent: 1 }); const cwOps = r; r += 1;
  cachedRow(ws, r, N, '(−) Cash from investing (capex)', sliceN(dcf.cashFromInvestmentPerPeriod), { indent: 1 }); const cwInv = r; r += 1;
  cachedRow(ws, r, N, '(+) Equity drawdown (cash)', sliceN(dcf.equityDrawdownPerPeriod), { indent: 1 }); const cwEq = r; r += 1;
  cachedRow(ws, r, N, '(+) Debt drawdown', sliceN(dcf.debtDrawdownPerPeriod), { indent: 1 }); const cwDraw = r; r += 1;
  cachedRow(ws, r, N, '(−) Interest paid', sliceN(dcf.interestPaidPerPeriod), { indent: 1 }); const cwInt = r; r += 1;
  const cwAvailRow = finRow('= Cash available', { v: 0 },
    (t) => ({ f: `SUM(${colP(t)}${cwOpen}:${colP(t)}${cwInt})`, v: (dcf.openingCashPerPeriod[t] ?? 0) + (dcf.cashFromOperationsPerPeriod[t] ?? 0) + (dcf.cashFromInvestmentPerPeriod[t] ?? 0) + (dcf.equityDrawdownPerPeriod[t] ?? 0) + (dcf.debtDrawdownPerPeriod[t] ?? 0) + (dcf.interestPaidPerPeriod[t] ?? 0) }), 'last', { bold: true });
  finRow('(−) Minimum cash requirement', { v: 0 }, (t) => ({ f: `-${Lscalar.minCash}`, v: -(fin.funding.minCashReserve ?? 0) }), 'last', { indent: 1 });
  const debtPaidRows: number[] = [];
  for (const m of facMeta) {
    const rr = finRow(`(−) Debt paid: ${m.name}`, { v: 0 },
      (t) => ({ f: `-(${colP(t)}${m.schedPrinRow}+${colP(t)}${m.sweepRow})`, v: -((m.schedPrin[t] ?? 0) + (m.sweep[t] ?? 0)) }), 'sum', { indent: 1 });
    debtPaidRows.push(rr);
  }
  const cwDebtPaidRow = r;
  finRow('Total debt paid', { v: 0 }, (t) => ({ f: debtPaidRows.length ? colSum(colP(t), debtPaidRows) : '0', v: dcf.debtRepaymentPerPeriod[t] ?? 0 }), 'sum', { bold: true });
  let cwDivRow = -1;
  if (div.enabled) { cachedRow(ws, r, N, '(−) Dividend paid', sliceN(div.totalDividendsPerPeriod).map((v) => -Math.abs(v)), { indent: 1 }); cwDivRow = r; r += 1; }
  finRow('= Closing cash (ties to Cash Flow + Balance Sheet)', { v: 0 }, (t) => {
    const parts = [`${colP(t)}${cwOpen}`, `${colP(t)}${cwOps}`, `${colP(t)}${cwInv}`, `${colP(t)}${cwEq}`, `${colP(t)}${cwDraw}`, `${colP(t)}${cwInt}`, `${colP(t)}${cwDebtPaidRow}`];
    if (cwDivRow > 0) parts.push(`${colP(t)}${cwDivRow}`);
    return { f: parts.join('+'), v: dcf.closingCashPerPeriod[t] ?? 0 };
  }, 'last', { bold: true });
  void cwAvailRow; r += 1;

  // ── Per-tranche sweep & outstanding (only when a sweep-eligible loan exists) ──
  if (sweep.enabled && sweep.eligibleTranches.length) {
    setSectionHeader(ws.getRow(r), 'Per-tranche sweep & outstanding', lastCol); r += 1;
    for (const row of sweep.eligibleTranches) {
      const m = facMeta.find((f) => f.id === row.trancheId);
      cachedRow(ws, r, N, `${row.trancheName}, opening (pre-sweep)`, sliceN(row.preSweepOutstanding), { indent: 1 }); r += 1;
      if (m) finRow(`${row.trancheName}, sweep applied`, { v: 0 }, (t) => ({ f: `-${colP(t)}${m.sweepRow}`, v: -(row.sweepPerPeriod[t] ?? 0) }), 'sum', { indent: 2 });
      else { cachedRow(ws, r, N, `${row.trancheName}, sweep applied`, sliceN(row.sweepPerPeriod).map((v) => -v), { indent: 2 }); r += 1; }
      cachedRow(ws, r, N, `${row.trancheName}, closing (post-sweep)`, sliceN(row.postSweepOutstanding), { indent: 1, bold: true }); r += 1;
    }
    cachedRow(ws, r, N, 'Project total debt outstanding (post-sweep)', sliceN(sweep.adjustedDebtOutstanding), { bold: true });
    fillRange(ws, r, 1, r, lastCol, ARGB.navy);
    for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
    r += 1;
  }

  void fallbackPrincipalLabels;
}

// ── Shared period-sheet geometry + frozen 4-row header ────────────────────────
const nz = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

// Universal column geometry. Columns A-D are a frozen label / metadata block;
// the period columns start at E. The opening column (E) is Period 0 / Dec(start
// year - 1) (flows are 0 here, balances carry their opening). Active period t is
// at col 6 + t (year = projectStartYear + t). The Total column (D) sits inside
// the frozen block so it stays visible, and SUMs the active periods (F..last).
const LBL_COL = 1;            // A  row label
const META_B = 2, META_C = 3; // B, C  (Capex: UOM, Rate; period sheets: spacers)
const TOTAL_COL = 4;          // D  Total
const OPEN_COL = 5;           // E  Opening / Period 0 / Dec(startYear - 1)
const pcol = (t: number): number => OPEN_COL + 1 + t;        // F.. active period t
const lastActiveCol = (N: number): number => OPEN_COL + N;   // last active column
const activeRange = (N: number, r: number): string => `${colLetter(pcol(0))}${r}:${colLetter(lastActiveCol(N))}${r}`;
// Display year / period index for a 1-based column (E = startYear-1 / index 0).
const colYear = (snap: ReturnType<typeof computeFinancialsSnapshot>, c: number): number => snap.projectStartYear + (c - 6);
const FROZEN_VIEW = (): { state: 'frozen'; xSplit: number; ySplit: number; showGridLines: boolean } => ({ state: 'frozen', xSplit: TOTAL_COL, ySplit: 4, showGridLines: false });

/** A column's additive formula over the given rows: a SUM(range) when the rows
 *  are contiguous (the requested convention), else an explicit '+' join. */
function colSum(col: string, rows: number[]): string {
  if (!rows.length) return '0';
  const contiguous = rows.every((v, i) => i === 0 || v === rows[i - 1] + 1);
  return contiguous && rows.length > 1 ? `SUM(${col}${rows[0]}:${col}${rows[rows.length - 1]})` : rows.map((rr) => `${col}${rr}`).join('+');
}

/** Title + subtitle + the frozen 4-row header (row 3 = period-end dates, row 4 =
 *  period index), the period columns linked to the Timeline. Sets widths + the
 *  freeze (rows 1-4, columns A-D). `meta` adds the Capex B / C column labels. */
function writeSheetHeader(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, N: number, title: string, subtitle: string, opts: { label?: string; meta?: [string, string] } = {}): void {
  ws.getColumn(LBL_COL).width = 34;
  ws.getColumn(META_B).width = opts.meta ? 15 : 3;
  ws.getColumn(META_C).width = opts.meta ? 11 : 3;
  ws.getColumn(TOTAL_COL).width = 15;
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) ws.getColumn(c).width = 12;
  setTitle(ws.getCell('A1'), title, 16);
  setLabel(ws.getCell('A2'), subtitle);
  if (opts.label) setColHeader(ws.getCell(4, LBL_COL), opts.label, 'left');
  if (opts.meta) { setColHeader(ws.getCell(4, META_B), opts.meta[0], 'left'); setColHeader(ws.getCell(4, META_C), opts.meta[1], 'right'); }
  setColHeader(ws.getCell(4, TOTAL_COL), 'Total', 'right');
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) {
    const cl = colLetter(c);
    const d = ws.getCell(3, c); // period-end date (linked to Timeline date row)
    setFormula(d, fcell(sheetRef(SHEETS.timeline, `${cl}3`), colYear(snap, c)), NUMFMT.date, true);
    d.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    d.alignment = { horizontal: 'right' };
    const ix = ws.getCell(4, c); // period index (linked to Timeline index row)
    setFormula(ix, fcell(sheetRef(SHEETS.timeline, `${cl}4`), c - OPEN_COL), NUMFMT.year, true);
    ix.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    ix.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    ix.alignment = { horizontal: 'right' };
  }
  ws.views = [FROZEN_VIEW()];
}

/** A data row: opening cell (E) + cached per-period values (F..) + Total (D) =
 *  SUM(active). */
function cachedRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, values: number[], opts: { indent?: number; bold?: boolean } = {}, opening = 0): void {
  setLabel(ws.getCell(r, LBL_COL), label, opts);
  const money = (c: number, v: number): void => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    cell.numFmt = NUMFMT.money;
  };
  money(OPEN_COL, opening);
  for (let t = 0; t < N; t++) money(pcol(t), values[t] ?? 0);
  setFormula(ws.getCell(r, TOTAL_COL), fcell(`SUM(${activeRange(N, r)})`, values.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
}

/** A total row whose opening (E) + period (F..) cells SUM the given source rows
 *  (SUM(range) when contiguous), platform values cached. style 'navy' = grand
 *  total; 'subtotal' = grey. */
function navySumRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, sourceRows: number[], cachedPerPeriod: number[], style: 'navy' | 'subtotal' = 'navy', openingCached = 0): void {
  setLabel(ws.getCell(r, LBL_COL), label, { bold: true });
  const sumCol = (c: number, cached: number): void => {
    setFormula(ws.getCell(r, c), fcell(colSum(colLetter(c), sourceRows), cached), NUMFMT.money);
  };
  sumCol(OPEN_COL, openingCached);
  for (let t = 0; t < N; t++) sumCol(pcol(t), cachedPerPeriod[t] ?? 0);
  setFormula(ws.getCell(r, TOTAL_COL), fcell(`SUM(${activeRange(N, r)})`, cachedPerPeriod.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
  const lastCol = lastActiveCol(N);
  const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal;
  const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
  fillRange(ws, r, 1, r, lastCol, fill);
  for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: fg } };
}

// ── Revenue (per-asset detail + project summary) ──────────────────────────────
function addRevenue(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  writeSheetHeader(ws, snap, N, 'Revenue', 'Recognised revenue by strategy and asset, phased onto the model timeline. Total revenue sums the strategy components.', { label: 'Revenue' });

  // Project revenue summary (formula total over the three strategy components).
  let r = 5;
  setSectionHeader(ws.getRow(r), 'Project revenue summary', lastActiveCol(N)); r += 1;
  const compRows: number[] = [];
  cachedRow(ws, r, N, 'Residential revenue', snap.pl.residentialRevenuePerPeriod); compRows.push(r); r += 1;
  cachedRow(ws, r, N, 'Hospitality revenue', snap.pl.hospitalityRevenuePerPeriod); compRows.push(r); r += 1;
  cachedRow(ws, r, N, 'Retail revenue', snap.pl.retailRevenuePerPeriod); compRows.push(r); r += 1;
  navySumRow(ws, r, N, 'Total revenue', compRows, snap.pl.totalRevenuePerPeriod);
  const totalAddr = sheetRef(SHEETS.revenue, `$${colLetter(TOTAL_COL)}$${r}`);
  r += 2;

  // Revenue detail by asset (cached series, informational; row totals are SUM).
  setSectionHeader(ws.getRow(r), 'Revenue detail by asset', lastActiveCol(N)); r += 1;
  const group = (title: string, entries: Array<[string, number[]]>): void => {
    const present = entries.filter(([, v]) => nz(v));
    if (!present.length) return;
    setLabel(ws.getCell(r, LBL_COL), title, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal); r += 1;
    for (const [id, v] of present) { cachedRow(ws, r, N, assetName(id), v, { indent: 1 }); r += 1; }
  };
  group('Residential / Sell', [...snap.revenue.bySellAsset.entries()].map(([id, rv]) => [id, rv.recognitionPerPeriod] as [string, number[]]));
  group('Hospitality', [...snap.revenue.byHospitalityAsset.entries()].map(([id, rv]) => [id, rv.totalRevenuePerPeriod] as [string, number[]]));
  group('Lease / Retail', [...snap.revenue.byLeaseAsset.entries()].map(([id, rv]) => [id, rv.totalRevenuePerPeriod] as [string, number[]]));
  return totalAddr;
}

// ── Cost of Sales (per-asset + project total) ─────────────────────────────────
function addCoS(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, cosTables: ReportTable[], refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.cos, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  writeSheetHeader(ws, snap, N, 'Cost of Sales', 'Cost of sales matched to recognised revenue (mirrors the platform Cost of Sales tab). The total sums the per-asset rows.', { label: 'Asset' });

  let r = 5;
  setSectionHeader(ws.getRow(r), 'Cost of sales by asset', lastActiveCol(N)); r += 1;
  const totalTable = cosTables.find((t) => t.title === 'Project Total Cost of Sales');
  const assetRows = (totalTable?.rows ?? []).filter((rw) => !rw.isTotal && !rw.isSection);
  const rowIdx: number[] = [];
  const cosTotalCached = new Array<number>(N).fill(0);
  for (const ar of assetRows) {
    const vals = ar.values.slice(0, N);
    cachedRow(ws, r, N, ar.label, vals, { indent: 1 });
    for (let t = 0; t < N; t++) cosTotalCached[t] += vals[t] ?? 0;
    rowIdx.push(r); r += 1;
  }
  navySumRow(ws, r, N, 'Total cost of sales', rowIdx, cosTotalCached);
  return sheetRef(SHEETS.cos, `$${colLetter(TOTAL_COL)}$${r}`);
}

// ── Opex (by asset + by category) ─────────────────────────────────────────────
function addOpex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, refs: AssumptionRefs): string {
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  const opex = snap.opex;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  writeSheetHeader(ws, snap, N, 'Operating Expenses', 'Operating expenses by asset and by category, phased onto the model timeline. Totals sum their components.', { label: 'Asset' });

  let r = 5;
  // Section 1: opex by asset (+ HQ), total = SUM of the rows.
  setSectionHeader(ws.getRow(r), 'Opex by asset', lastActiveCol(N)); r += 1;
  const assetRowIdx: number[] = [];
  for (const [id, ar] of opex.byAsset) {
    if (!nz(ar.totalOpexPerPeriod)) continue;
    cachedRow(ws, r, N, assetName(id), ar.totalOpexPerPeriod, { indent: 1 });
    assetRowIdx.push(r); r += 1;
  }
  if (nz(opex.hq.totalOpexPerPeriod)) {
    cachedRow(ws, r, N, 'HQ & corporate overheads', opex.hq.totalOpexPerPeriod, { indent: 1 });
    assetRowIdx.push(r); r += 1;
  }
  navySumRow(ws, r, N, 'Total project opex', assetRowIdx, opex.totalOpexPerPeriodInclHQ);
  const totalAddr = sheetRef(SHEETS.opex, `$${colLetter(TOTAL_COL)}$${r}`);
  r += 2;

  // Section 2: project opex by category (Direct / Indirect / Mgmt / Other + HQ).
  setSectionHeader(ws.getRow(r), 'Project opex by category', lastActiveCol(N)); r += 1;
  const pt = opex.projectTotals;
  const catRows: number[] = [];
  cachedRow(ws, r, N, 'Direct costs', pt.directCostsPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, N, 'Indirect costs', pt.indirectCostsPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, N, 'Management fees', pt.managementFeePerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  cachedRow(ws, r, N, 'Other charges', pt.otherOpexPerPeriod, { indent: 1 }); catRows.push(r); r += 1;
  navySumRow(ws, r, N, 'All asset opex', catRows, pt.totalOpexPerPeriod, 'subtotal');
  const allAssetRow = r; r += 1;
  let hqRow = -1;
  if (nz(opex.hq.totalOpexPerPeriod)) {
    cachedRow(ws, r, N, 'HQ overheads', opex.hq.totalOpexPerPeriod, { indent: 1 });
    hqRow = r; r += 1;
  }
  navySumRow(ws, r, N, 'Total project opex', hqRow >= 0 ? [allAssetRow, hqRow] : [allAssetRow], opex.totalOpexPerPeriodInclHQ);
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
  // Input rows carry the navy-pale fill (matching the input cells); formula /
  // linked are shown by their font colour.
  {
    const inp = ws.getCell(`A${r}`); inp.value = 'Input (edit these)'; markInput(inp); r += 1;
    const fm = ws.getCell(`A${r}`); fm.value = 'Formula (calculation)'; fm.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1;
    const lk = ws.getCell(`A${r}`); lk.value = 'Linked (reference to another sheet)'; lk.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.linked } }; r += 1;
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
    s.value = ok ? 'OK' : 'CHECK'; s.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ok ? ARGB.good : ARGB.bad } };
    setLabel(ws.getCell(`C${r}`), note);
    r += 1;
  }
  // Live check: the phased Capex schedule total ties to the cost build-up total
  // (both reference the Capex sheet, so this recalculates if a rate is edited).
  setLabel(ws.getCell(`A${r}`), 'Capex schedule ties to cost build-up');
  const cs = ws.getCell(`B${r}`);
  cs.value = fcell(`IF(ABS(${capexAddrs.scheduleTotalAddr}-${capexAddrs.buildupTotalAddr})<1,"OK","CHECK")`, 'OK');
  cs.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.good } };
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
    const kc = ws.getCell(rr, 2); kc.value = k; kc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    ws.mergeCells(rr, 3, rr, 4);
    const vc = ws.getCell(rr, 3); vc.value = v; vc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
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
    [SHEETS.financing, 'Funding requirement, debt + equity, finance cost, IDC, funding gap and cash sweep'],
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
    nc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.linked }, underline: true };
    ws.mergeCells(rr, 3, rr, 7);
    const dc = ws.getCell(rr, 3); dc.value = desc; dc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    if (i % 2 === 1) fillRange(ws, rr, 2, rr, 7, ARGB.grey);
  });
  boxBorder(ws, idxTop, 2, idxTop + index.length - 1, 7);
  r = idxTop + index.length + 2;

  // Colour legend. Input swatch carries the navy-pale fill (matching input cells).
  setLabel(ws.getCell(r, 2), 'Legend:', { bold: true });
  const inputSwatch = ws.getCell(r, 3); inputSwatch.value = 'Input'; markInput(inputSwatch); inputSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
  const fmSwatch = ws.getCell(r, 4); fmSwatch.value = 'Formula'; fmSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
  const lkSwatch = ws.getCell(r, 5); lkSwatch.value = 'Linked'; lkSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.linked } };
  r += 2;
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
  fillCell(ws.getCell(1, 1), ARGB.white);
}
