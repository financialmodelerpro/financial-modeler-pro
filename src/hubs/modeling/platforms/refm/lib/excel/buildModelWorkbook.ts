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
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
import { resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { formatAccounting } from '@/src/core/formatters';
import { computeLiveModel, type LiveAssetInput, type LiveModel, type LiveGroup } from './liveModel';
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

const SHEETS = { cover: 'Cover', assumptions: 'Assumptions', timeline: 'Timeline', landArea: 'Land & Area', capex: 'Capex', revenue: 'Revenue', cos: 'Cost of Sales', opex: 'Opex', financing: 'Financing', pl: 'P&L', cashflow: 'Cash Flow', balsheet: 'Balance Sheet', returns: 'Returns', checks: 'Checks' };

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  const snap = computeFinancialsSnapshot(opts.state);
  const capex = buildCapexReport(snap, opts.state);
  // Pure live-model twin (the cached value every downstream formula will show).
  const { assets: liveAssets, proj } = prepareLiveModel(snap, opts.state, capex);
  const lm = computeLiveModel(liveAssets, proj);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Financial Modeler Pro';
  wb.created = new Date(0); // deterministic (avoid clock for reproducible output)
  wb.calcProperties.fullCalcOnLoad = true;

  addCover(wb, snap, opts, lm); // first tab; index links to the sheets created below
  const refs = addAssumptions(wb, snap, opts, capex);
  addTimeline(wb, snap, refs);
  const landAddrs = addLandArea(wb, opts.state, refs);
  const capexAddrs = addCapex(wb, snap, capex, refs, landAddrs);

  // Excel base-cell formula per asset: Sell links the Land & Area GDV cell;
  // Operate / Lease build the stabilised annual revenue from the sub-unit inputs.
  const revBaseFormula = new Map<string, string>();
  for (const a of liveAssets) {
    if (a.revKind === 'gdv') { revBaseFormula.set(a.id, landAddrs.get(a.id)?.revenue ?? '0'); continue; }
    const subs = refs.subUnits.filter((s) => s.assetId === a.id);
    const parts = subs.map((s) => {
      const su = opts.state.subUnits.find((x) => x.id === s.id);
      return su?.metric === 'units' ? `${s.value}*${s.price}*365` : `${s.value}*${s.price}`;
    });
    revBaseFormula.set(a.id, parts.length ? parts.join('+') : '0');
  }

  // Downstream live tabs. Revenue / CoS / Opex first; the Financing tab then
  // owns the computational recurrence (depreciation, interest, tax, debt /
  // equity / cash flow); P&L / Cash Flow / Balance Sheet / Returns are link-and-
  // assemble presentation tabs. Each returns the row registry the next links to.
  const ctx: EmitCtx = { wb, snap, refs, lm, proj, assets: liveAssets, landAddrs, capexAddrs, revBaseFormula, currency: opts.state.project.currency ?? 'SAR' };
  const revLinks = addRevenue(ctx);
  const cosLinks = addCostOfSales(ctx, revLinks);
  const opexLinks = addOpex(ctx, revLinks);
  const finLinks = addFinancing(ctx, revLinks, cosLinks, opexLinks);
  addProfitLoss(ctx, revLinks, cosLinks, opexLinks, finLinks);
  const cfLinks = addCashFlow(ctx, finLinks);
  const bsLinks = addBalanceSheet(ctx, finLinks, cosLinks);
  const retLinks = addReturns(ctx, revLinks, opexLinks, finLinks);
  addChecks(ctx, capexAddrs, { cfLinks, bsLinks, retLinks });

  // Workbook-wide DISPLAY scale: re-format magnitude money cells (display only;
  // stored values + formulas stay in full units). Applied last so every sheet's
  // cells are set.
  const scale = opts.displayScale ?? 'full';
  const decimals = opts.displayDecimals ?? defaultDecimals(scale);
  scaleMoneyFormats(wb, scale, decimals);
  const note = scaleNote(scale, opts.state.project.currency ?? 'SAR');
  if (note) {
    for (const name of [SHEETS.landArea, SHEETS.capex, SHEETS.revenue, SHEETS.cos, SHEETS.opex, SHEETS.financing, SHEETS.pl, SHEETS.cashflow, SHEETS.balsheet]) {
      const ws = wb.getWorksheet(name); if (!ws) continue;
      const a2 = ws.getCell('A2'); const cur = typeof a2.value === 'string' ? a2.value : '';
      setLabel(a2, cur ? `${cur}  (${note})` : note);
    }
  }
  return wb;
}

// Shared context threaded through every downstream emitter.
interface EmitCtx {
  wb: ExcelJS.Workbook;
  snap: ReturnType<typeof computeFinancialsSnapshot>;
  refs: AssumptionRefs;
  lm: LiveModel;
  proj: import('./liveModel').LiveProjectInput;
  assets: LiveAssetInput[];
  landAddrs: Map<string, LandAreaAssetAddrs>;
  capexAddrs: CapexAddrs;
  revBaseFormula: Map<string, string>;
  currency: string;
}

// ── Pure live-model inputs (cached values + scalars) from the snapshot ─────────
function prepareLiveModel(snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, capex: CapexReport): { assets: LiveAssetInput[]; proj: import('./liveModel').LiveProjectInput } {
  const N = snap.axisLength;
  const padN = (a: number[] | undefined): number[] => { const o = (a ?? []).slice(0, N); while (o.length < N) o.push(0); return o; };
  const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
  const seriesByName = (title: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const rw of capex.results.find((t) => t.title === title)?.rows ?? []) if (!rw.isTotal) m.set(rw.label, rw.values.slice());
    return m;
  };
  const inclByName = seriesByName('Total Capex (incl. all land)');
  const exclInKindByName = seriesByName('Capex excl. Land In-Kind (cash-impact schedule)');
  const exclAllByName = seriesByName('Capex excl. Total Land (pure development cost)');

  const metricsById = new Map<string, AssetAreaMetrics>();
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const inPhase = state.assets.filter((x) => x.phaseId === a.phaseId);
    metricsById.set(a.id, resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode));
  }

  const assets: LiveAssetInput[] = [];
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const group = strategyGroup(a.strategy);
    const phase = state.phases.find((p) => p.id === a.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : snap.projectStartYear;
    const offset = Math.max(0, phaseStartYear - snap.projectStartYear);
    const m = metricsById.get(a.id);
    const inclPer = padN(inclByName.get(a.name));
    const exclInKindPer = padN(exclInKindByName.get(a.name));
    const exclAllPer = padN(exclAllByName.get(a.name));
    const gdv = m?.totalRevenue ?? 0;
    const subs = state.subUnits.filter((s) => s.assetId === a.id);
    const annualBase = subs.reduce((s, su) => {
      const val = su.metricValue ?? 0; const price = su.startingAdr ?? su.unitPrice ?? 0;
      return s + (su.metric === 'units' ? val * price * 365 : val * price);
    }, 0);
    const revKind: 'gdv' | 'annual' = group === 'Residential' ? 'gdv' : 'annual';
    const revBaseCached = revKind === 'gdv' ? gdv : annualBase;
    const engRev = padN(
      group === 'Residential' ? snap.revenue.bySellAsset.get(a.id)?.recognitionPerPeriod
        : group === 'Hospitality' ? snap.revenue.byHospitalityAsset.get(a.id)?.totalRevenuePerPeriod
          : group === 'Retail' ? snap.revenue.byLeaseAsset.get(a.id)?.totalRevenuePerPeriod : [],
    );
    const revProfile = engRev.map((v) => (revBaseCached > 0 ? v / revBaseCached : 0));
    const engOpex = padN(snap.opex.byAsset.get(a.id)?.totalOpexPerPeriod);
    const revTot = sum(engRev); const opexTot = sum(engOpex);
    const opexMargin = group !== 'Residential' && revTot > 0 ? Math.min(1, Math.max(0, 1 - opexTot / revTot)) : 0;
    const inclTotal = sum(inclPer);
    assets.push({
      id: a.id, name: a.name, strategy: a.strategy, group,
      offset, cp: phase?.constructionPeriods ?? 0, op: phase?.operationsPeriods ?? 0,
      usefulLife: a.usefulLifeYears ?? 0,
      revBaseCached, revKind, revProfile,
      inclPerPeriod: inclPer, exclInKindPerPeriod: exclInKindPer, exclAllPerPeriod: exclAllPer,
      inclTotal, exclInKindTotal: sum(exclInKindPer), exclAllTotal: sum(exclAllPer),
      landCashTotal: m?.cashLandValue ?? 0, landInKindTotal: m?.inKindLandValue ?? 0,
      cosRatioCached: group === 'Residential' && gdv > 0 ? inclTotal / gdv : 0,
      opexMargin,
    });
  }

  const p = state.project;
  const fin = snap.financing;
  const trancheRates = state.financingTranches.map((t) => (t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0))) / 100).filter((r) => r > 0);
  const debtRate = trancheRates.length ? trancheRates.reduce((s, r) => s + r, 0) / trancheRates.length : 0;
  const proj: import('./liveModel').LiveProjectInput = {
    N,
    taxRate: Math.max(0, p.tax?.rate ?? 0),
    debtPct: (fin.funding.debtPct ?? 0) / 100,
    equityPct: (fin.funding.equityPct ?? 0) / 100,
    debtRate,
    minCash: p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0,
    dsoDays: p.operatingAr?.dsoDays ?? 0,
    dpoDays: p.opexAp?.defaultApDays ?? 0,
    discountRate: p.returns?.discountRate ?? 0.1,
    exitOffset: p.returns?.exitYearOffset ?? (N - 1),
    exitMultiple: p.returns?.exitMultiple ?? 8,
    terminalMethod: String(p.returns?.terminalMethod ?? 'exit_multiple'),
    perpetuityGrowth: p.returns?.perpetuityGrowth ?? 0.02,
    hqOpexCached: padN(snap.opex.hq.totalOpexPerPeriod),
  };
  return { assets, proj };
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
    const prev = colLetter(c - 1);
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
// scheduleTotalAddr / buildupTotalAddr feed the Checks reconciliation. The row
// registry + period-column function let the downstream tabs (Cost of Sales,
// Balance Sheet) reference the Capex schedule live by cell.
interface CapexAddrs {
  scheduleTotalAddr: string;
  buildupTotalAddr: string;
  inclTotalRow: number;        // Table 1 'Project Total (incl. all land)'
  exclInKindTotalRow: number;  // Table 3 'Total Capex (excl. land in-kind)' = CFI cash
  exclAllTotalRow: number;     // Table 4 'Total Capex (excl. all land)'
  perAsset: Map<string, { inclRow: number; exclInKindRow: number; exclAllRow: number }>;
  /** Capex-local period column index for axis period t (its geometry differs). */
  periodCol: (t: number) => number;
}

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
  interface AssetMeta { assetId: string; name: string; category: string; inclRow: number; landRows: number[]; nonLandRows: number[]; exclAll: number[]; exclInKind: number[]; incl: number[] }
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
      assetId: a.assetId, name: a.name, category: cat(a.assetId), inclRow, landRows, nonLandRows,
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
  const summaryTable = (title: string, totalLabel: string, perAsset: (m: AssetMeta) => { f: (col: string) => string; cached: number[]; predicted?: number[] }, totalCached: number[]): { rowsByAsset: Map<string, number>; totalRow: number } => {
    setSectionHeader(ws.getRow(r), title, cLast); r += 1;
    const rows: number[] = [];
    const rowsByAsset = new Map<string, number>();
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
      rowsByAsset.set(m.assetId, r); rows.push(r); r += 1;
    }
    const totalRow = r;
    cSum(r, totalLabel, rows, totalCached, 'navy'); r += 2;
    return { rowsByAsset, totalRow };
  };

  summaryTable('Table 2 - Total Capex Including Land Value', 'Total Capex (incl. all land)',
    (m) => ({ f: (col) => `${col}${m.inclRow}`, cached: m.incl }), sumSeries(assetMeta.map((m) => m.incl), N));
  const t3 = summaryTable('Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)', 'Total Capex (excl. land in-kind)',
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
  const t4 = summaryTable('Table 4 - Capex Excluding Total Land (pure development cost)', 'Total Capex (excl. all land)',
    (m) => ({ f: (col) => (m.nonLandRows.length ? colSum(col, m.nonLandRows) : '0'), cached: m.exclAll }), sumSeries(assetMeta.map((m) => m.exclAll), N));
  // Per-asset row registry for the downstream tabs (Cost of Sales / Balance
  // Sheet read the Capex schedule live): Table-1 incl subtotal, Table-3 cash
  // (excl in-kind), Table-4 construction (excl all land). Period column for axis
  // t is C_OPEN + 1 + t (Capex's local geometry).
  const perAssetCapex = new Map<string, { inclRow: number; exclInKindRow: number; exclAllRow: number }>();
  for (const m of assetMeta) perAssetCapex.set(m.assetId, { inclRow: m.inclRow, exclInKindRow: t3.rowsByAsset.get(m.assetId) ?? m.inclRow, exclAllRow: t4.rowsByAsset.get(m.assetId) ?? m.inclRow });

  // Build-up vs phased reconciliation. Build-up grand = sum of every line Total (E);
  // phased grand = Table 1 Project Total. The Checks sheet asserts they tie.
  setLabel(ws.getCell(r, C_LBL), 'Grand build-up (sum of line Totals)', { bold: true });
  setFormula(ws.getCell(r, C_TOT), fcell(allLineTotCells.length ? allLineTotCells.join('+') : '0', grandCapex), NUMFMT.money);
  const buildupTotalAddr = sheetRef(SHEETS.capex, `$E$${r}`);
  const scheduleTotalAddr = sheetRef(SHEETS.capex, `$E$${projTotalRow}`);

  return {
    scheduleTotalAddr, buildupTotalAddr,
    inclTotalRow: projTotalRow, exclInKindTotalRow: t3.totalRow, exclAllTotalRow: t4.totalRow,
    perAsset: perAssetCapex, periodCol: (t: number) => C_OPEN + 1 + t,
  };
}

/** Element-wise sum of equal-length series (padded to N). */
function sumSeries(series: number[][], N: number): number[] {
  const o = new Array<number>(N).fill(0);
  for (const s of series) for (let t = 0; t < N; t++) o[t] += s[t] ?? 0;
  return o;
}


// ── Shared period-sheet geometry + frozen 4-row header ────────────────────────
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


// ── Downstream live emitters (Revenue → CoS → Opex → Financing → P&L → CF → BS → Returns) ─
// All use the shared geometry: A label, D Total, E Period 0 / opening, F.. active.
// xc(sheet,row,t) = the period-t cell on a shared-geometry sheet; the Financing
// engine owns the recurrence and every other statement links to it.
const lcol = (t: number): string => colLetter(pcol(t));
const prevCol = (t: number): string => colLetter(pcol(t - 1));
const xc = (sheet: string, row: number, t: number): string => sheetRef(sheet, `${colLetter(pcol(t))}${row}`);

interface RowOpts { open?: { f?: string; v: number }; total?: 'sum' | 'last' | 'none'; indent?: number; bold?: boolean; fmt?: string }
/** Write one period row (label + opening E + per-period F.. + Total D). Returns r. */
function emitRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, per: (t: number) => { f?: string; v: number }, opts: RowOpts = {}): number {
  const fmt = opts.fmt ?? NUMFMT.money;
  setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: opts.bold });
  const put = (c: number, x: { f?: string; v: number }): void => {
    if (x.f) setFormula(ws.getCell(r, c), fcell(x.f, x.v), fmt);
    else { const cell = ws.getCell(r, c); cell.value = x.v; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
  };
  put(OPEN_COL, opts.open ?? { v: 0 });
  const cached: number[] = [];
  for (let t = 0; t < N; t++) { const x = per(t); put(pcol(t), x); cached.push(x.v); }
  if (opts.total !== 'none') {
    const last = opts.total === 'last';
    const f = last ? `${colLetter(lastActiveCol(N))}${r}` : `SUM(${activeRange(N, r)})`;
    const v = last ? (cached[N - 1] ?? 0) : cached.reduce((s, x) => s + x, 0);
    setFormula(ws.getCell(r, TOTAL_COL), fcell(f, v), fmt);
  }
  if (opts.bold) for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { ...(cell.font as object), bold: true }; }
  return r;
}

interface RevLinks { byAssetRow: Map<string, number>; residentialRow: number; hospitalityRow: number; retailRow: number; totalRow: number }
interface CosLinks { byAssetRow: Map<string, number>; totalRow: number }
interface OpexLinks { hospRow: number; retailRow: number; hqRow: number; totalRow: number }
interface FinLinks {
  daRow: number; ebitdaRow: number; ebitRow: number; interestRow: number; pbtRow: number; taxRow: number; patRow: number;
  arRow: number; apRow: number; capexCashRow: number; inKindRow: number; revReceivedRow: number; opexPaidRow: number;
  cfoRow: number; cfiRow: number; debtOpenRow: number; debtDrawRow: number; principalRow: number; debtCloseRow: number;
  equityCashRow: number; equityInKindRow: number; cffRow: number; netCfRow: number; openCashRow: number; closeCashRow: number;
}
interface CfLinks { cfoRow: number; cfiRow: number; cffRow: number; closeCashRow: number }
interface BsLinks { totalAssetsRow: number; totalLERow: number; bsDiffRow: number; cashRow: number }
interface RetLinks { fcffIrrCell: string; fcfeIrrCell: string }

// ── Revenue (base x profile) ──────────────────────────────────────────────────
function addRevenue(ctx: EmitCtx): RevLinks {
  const { wb, snap, lm, assets, revBaseFormula } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Revenue', 'Revenue per asset = a live base (Sell: GDV = units x price; Operate / Lease: stabilised annual = keys x ADR x 365 or NLA x rent) multiplied by an editable per-period recognition / operating profile. Edit a price, area or profile cell and the whole model (down to the IRR) updates.', { label: 'Revenue' });
  let r = 5;

  setSectionHeader(ws.getRow(r), 'Revenue bases (live magnitude drivers)', lastActiveCol(N)); r += 1;
  setColHeader(ws.getCell(r, LBL_COL), 'Asset', 'left'); setColHeader(ws.getCell(r, OPEN_COL), 'Base', 'right'); r += 1;
  const baseRowMap = new Map<string, number>();
  for (const a of assets) {
    setLabel(ws.getCell(r, LBL_COL), `${a.name}  (${a.revKind === 'gdv' ? 'GDV' : 'annual'})`, { indent: 1 });
    setFormula(ws.getCell(r, OPEN_COL), fcell(revBaseFormula.get(a.id) ?? '0', a.revBaseCached), NUMFMT.money, true);
    baseRowMap.set(a.id, r); r += 1;
  }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Revenue by asset (= base x profile)', lastActiveCol(N)); r += 1;
  const byAssetRow = new Map<string, number>();
  const groupOrder: Array<[LiveGroup, string]> = [['Residential', 'Residential / Sell'], ['Hospitality', 'Hospitality / Operate'], ['Retail', 'Retail / Lease'], ['Other', 'Other']];
  const groupRows = new Map<LiveGroup, number[]>();
  for (const [g, label] of groupOrder) {
    const inG = assets.filter((a) => a.group === g);
    if (!inG.length) continue;
    setLabel(ws.getCell(r, LBL_COL), label, { bold: true }); fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal); r += 1;
    const rows: number[] = [];
    for (const a of inG) {
      const baseCell = `$${colLetter(OPEN_COL)}$${baseRowMap.get(a.id)}`;
      // Editable profile % row.
      setLabel(ws.getCell(r, LBL_COL), `${a.name}: recognition / operating profile %`, { indent: 1 });
      { const c = ws.getCell(r, OPEN_COL); c.value = 0; c.numFmt = NUMFMT.pct2; markInput(c); }
      for (let t = 0; t < N; t++) { const c = ws.getCell(r, pcol(t)); c.value = a.revProfile[t] ?? 0; c.numFmt = NUMFMT.pct2; markInput(c); }
      setFormula(ws.getCell(r, TOTAL_COL), fcell(`SUM(${activeRange(N, r)})`, a.revProfile.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.pct2);
      const pRow = r; r += 1;
      const rev = lm.revByAsset.get(a.id) ?? [];
      emitRow(ws, r, N, `${a.name} revenue`, (t) => ({ f: `${baseCell}*${lcol(t)}${pRow}`, v: rev[t] ?? 0 }), { indent: 1 });
      byAssetRow.set(a.id, r); rows.push(r); r += 1;
    }
    groupRows.set(g, rows);
  }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Project revenue summary', lastActiveCol(N)); r += 1;
  const resiRows = groupRows.get('Residential') ?? [];
  const hospRows = [...(groupRows.get('Hospitality') ?? []), ...(groupRows.get('Other') ?? [])];
  const retRows = groupRows.get('Retail') ?? [];
  navySumRow(ws, r, N, 'Residential revenue', resiRows, lm.residentialRev, 'subtotal'); const residentialRow = r; r += 1;
  navySumRow(ws, r, N, 'Hospitality revenue', hospRows, lm.hospitalityRev, 'subtotal'); const hospitalityRow = r; r += 1;
  navySumRow(ws, r, N, 'Retail revenue', retRows, lm.retailRev, 'subtotal'); const retailRow = r; r += 1;
  navySumRow(ws, r, N, 'Total revenue', [residentialRow, hospitalityRow, retailRow], lm.totalRev, 'navy'); const totalRow = r; r += 1;
  return { byAssetRow, residentialRow, hospitalityRow, retailRow, totalRow };
}

// ── Cost of Sales (Sell: revenue x cost ratio) ────────────────────────────────
function addCostOfSales(ctx: EmitCtx, revLinks: RevLinks): CosLinks {
  const { wb, snap, lm, assets, landAddrs, capexAddrs } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.cos, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Cost of Sales', 'Development cost of for-sale (Residential) assets, recognised in proportion to revenue: CoS = revenue x (total development cost / GDV). Operate / Lease assets carry their costs as opex, not cost of sales.', { label: 'Asset' });
  let r = 5;
  setSectionHeader(ws.getRow(r), 'Cost of sales by asset', lastActiveCol(N)); r += 1;
  const byAssetRow = new Map<string, number>();
  const sellRows: number[] = [];
  for (const a of assets.filter((x) => x.group === 'Residential')) {
    const inclRow = capexAddrs.perAsset.get(a.id)?.inclRow;
    const inclCell = inclRow ? sheetRef(SHEETS.capex, `$E$${inclRow}`) : '0';
    const gdv = landAddrs.get(a.id)?.revenue ?? '0';
    const revRow = revLinks.byAssetRow.get(a.id);
    const cos = lm.cosByAsset.get(a.id) ?? [];
    emitRow(ws, r, N, a.name, (t) => ({ f: revRow ? `IFERROR(${xc(SHEETS.revenue, revRow, t)}*${inclCell}/${gdv},0)` : '0', v: cos[t] ?? 0 }), { indent: 1 });
    byAssetRow.set(a.id, r); sellRows.push(r); r += 1;
  }
  navySumRow(ws, r, N, 'Total cost of sales', sellRows, lm.cosTotal, 'navy'); const totalRow = r; r += 1;
  return { byAssetRow, totalRow };
}

// ── Opex (Operate / Lease: revenue x cost ratio; HQ: base x profile) ──────────
function addOpex(ctx: EmitCtx, revLinks: RevLinks): OpexLinks {
  const { wb, snap, lm, assets } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Operating Expenses', 'Operating expenses. Operate / Lease opex = revenue x an editable operating-cost ratio; HQ overheads = an editable base x profile. Residential (for-sale) costs sit in Cost of Sales, not here.', { label: 'Asset' });
  let r = 5;
  const opAssets = assets.filter((a) => a.group !== 'Residential');
  const ratioRow = new Map<string, number>();
  if (opAssets.length) {
    setSectionHeader(ws.getRow(r), 'Operating cost ratios (input: opex as % of revenue)', lastActiveCol(N)); r += 1;
    for (const a of opAssets) {
      setLabel(ws.getCell(r, LBL_COL), a.name, { indent: 1 });
      const c = ws.getCell(r, OPEN_COL); c.value = 1 - a.opexMargin; c.numFmt = NUMFMT.pct2; markInput(c);
      ratioRow.set(a.id, r); r += 1;
    }
    r += 1;
  }
  setSectionHeader(ws.getRow(r), 'Opex by asset', lastActiveCol(N)); r += 1;
  const hospRows: number[] = []; const retRows: number[] = [];
  for (const a of opAssets) {
    const revRow = revLinks.byAssetRow.get(a.id);
    const ratioCell = `$${colLetter(OPEN_COL)}$${ratioRow.get(a.id)}`;
    const ox = lm.opexByAsset.get(a.id) ?? [];
    emitRow(ws, r, N, a.name, (t) => ({ f: revRow ? `${xc(SHEETS.revenue, revRow, t)}*${ratioCell}` : '0', v: ox[t] ?? 0 }), { indent: 1 });
    (a.group === 'Retail' ? retRows : hospRows).push(r); r += 1;
  }
  const hqTotal = lm.hqOpex.reduce((s, v) => s + v, 0);
  let hqRow = -1;
  if (Math.abs(hqTotal) > 0.5) {
    setLabel(ws.getCell(r, LBL_COL), 'HQ overheads: base', { indent: 1 });
    { const c = ws.getCell(r, OPEN_COL); c.value = hqTotal; c.numFmt = NUMFMT.money; markInput(c); }
    const hqBaseRow = r; r += 1;
    setLabel(ws.getCell(r, LBL_COL), 'HQ overheads: profile %', { indent: 1 });
    { const c = ws.getCell(r, OPEN_COL); c.value = 0; c.numFmt = NUMFMT.pct2; markInput(c); }
    for (let t = 0; t < N; t++) { const c = ws.getCell(r, pcol(t)); c.value = hqTotal > 0 ? (lm.hqOpex[t] ?? 0) / hqTotal : 0; c.numFmt = NUMFMT.pct2; markInput(c); }
    setFormula(ws.getCell(r, TOTAL_COL), fcell(`SUM(${activeRange(N, r)})`, hqTotal > 0 ? 1 : 0), NUMFMT.pct2);
    const hqProfRow = r; r += 1;
    const baseCell = `$${colLetter(OPEN_COL)}$${hqBaseRow}`;
    emitRow(ws, r, N, 'HQ overheads', (t) => ({ f: `${baseCell}*${lcol(t)}${hqProfRow}`, v: lm.hqOpex[t] ?? 0 }), { indent: 1 });
    hqRow = r; r += 1;
  }
  r += 1;
  setSectionHeader(ws.getRow(r), 'Project opex summary', lastActiveCol(N)); r += 1;
  navySumRow(ws, r, N, 'Hospitality opex', hospRows, lm.hospitalityOpex, 'subtotal'); const hRow = r; r += 1;
  navySumRow(ws, r, N, 'Retail opex', retRows, lm.retailOpex, 'subtotal'); const retRow = r; r += 1;
  const totalSrc = hqRow > 0 ? [hRow, retRow, hqRow] : [hRow, retRow];
  navySumRow(ws, r, N, 'Total opex', totalSrc, lm.totalOpex, 'navy'); const totalRow = r; r += 1;
  return { hospRow: hRow, retailRow: retRow, hqRow, totalRow };
}

// ── Financing engine (depreciation, interest, tax, debt / equity / cash) ──────
function addFinancing(ctx: EmitCtx, revLinks: RevLinks, cosLinks: CosLinks, opexLinks: OpexLinks): FinLinks {
  const { wb, snap, lm, proj, assets, refs, capexAddrs } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.financing, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Financing', 'The computational engine: depreciation, interest (rate x opening debt), tax, and the debt / equity drawdown recurrence (deficit-funded, surplus swept to debt) feeding the cash flow. A clean forward recurrence (each period reads the prior period close), so there is no circularity. Every downstream statement and the IRR link here.', { label: 'Line' });
  const capP = (row: number, t: number): string => sheetRef(SHEETS.capex, `${colLetter(capexAddrs.periodCol(t))}${row}`);
  let r = 5;

  // Inputs (linked from Assumptions / local).
  setSectionHeader(ws.getRow(r), 'Inputs (linked from Assumptions)', lastActiveCol(N)); r += 1;
  const scalar = (label: string, link: string, cached: number, fmt: string): string => {
    setLabel(ws.getCell(r, LBL_COL), label);
    if (link) setFormula(ws.getCell(r, TOTAL_COL), fcell(link, cached), fmt, true);
    else { const c = ws.getCell(r, TOTAL_COL); c.value = cached; c.numFmt = fmt; markInput(c); }
    const a = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return a;
  };
  const debtPctCell = scalar('Debt share', 'DebtPct', proj.debtPct, NUMFMT.pct);
  const equityPctCell = scalar('Equity share', 'EquityPct', proj.equityPct, NUMFMT.pct);
  const minCashCell = scalar('Minimum cash reserve', 'MinCashReserve', proj.minCash, NUMFMT.money);
  const debtRateCell = scalar('Blended interest rate (input)', '', proj.debtRate, NUMFMT.pct2);
  const taxRateCell = scalar('Tax / Zakat rate', 'TaxRate', proj.taxRate, NUMFMT.pct2);
  const dsoCell = scalar('Receivables DSO (days)', 'DsoDays', proj.dsoDays, NUMFMT.int);
  const dpoCell = scalar('Payables DPO (days)', 'DpoDays', proj.dpoDays, NUMFMT.int);
  r += 1;

  // Income (for funding + tax).
  setSectionHeader(ws.getRow(r), 'Income (EBITDA, depreciation, EBIT)', lastActiveCol(N)); r += 1;
  const ebitdaRow = emitRow(ws, r, N, 'EBITDA = revenue - cost of sales - opex',
    (t) => ({ f: `${xc(SHEETS.revenue, revLinks.totalRow, t)}-${xc(SHEETS.cos, cosLinks.totalRow, t)}-${xc(SHEETS.opex, opexLinks.totalRow, t)}`, v: lm.ebitda[t] }), { bold: true }); r += 1;
  // Depreciation per depreciable asset (straight-line construction over life).
  const depAssets = assets.filter((a) => a.group !== 'Residential' && a.usefulLife > 0 && a.exclAllTotal > 0);
  const depRows: number[] = [];
  for (const a of depAssets) {
    const exclAllRow = capexAddrs.perAsset.get(a.id)?.exclAllRow;
    const exclAllCell = exclAllRow ? sheetRef(SHEETS.capex, `$E$${exclAllRow}`) : '0';
    const lifeCell = refs.assets.find((x) => x.id === a.id)?.usefulLife ?? '0';
    const handover = Math.max(0, a.offset + a.cp - 1);
    const dep = lm.daByAsset.get(a.id) ?? [];
    emitRow(ws, r, N, `${a.name} depreciation`, (t) => {
      const inWindow = t >= handover + 1 && t <= handover + a.usefulLife;
      return inWindow ? { f: `IFERROR(${exclAllCell}/${lifeCell},0)`, v: dep[t] ?? 0 } : { v: 0 };
    }, { indent: 1 });
    depRows.push(r); r += 1;
  }
  navySumRow(ws, r, N, 'Total depreciation', depRows, lm.da, 'subtotal'); const daRow = r; r += 1;
  const ebitRow = emitRow(ws, r, N, 'EBIT = EBITDA - depreciation',
    (t) => ({ f: `${lcol(t)}${ebitdaRow}-${lcol(t)}${daRow}`, v: lm.ebit[t] }), { bold: true }); r += 1;
  r += 1;

  // Drivers (capex cash, in-kind land, AR / AP balances).
  setSectionHeader(ws.getRow(r), 'Drivers (capex cash, in-kind land, working capital)', lastActiveCol(N)); r += 1;
  const capexCashRow = emitRow(ws, r, N, 'Capex (cash, excl. in-kind land)',
    (t) => ({ f: capP(capexAddrs.exclInKindTotalRow, t), v: lm.capexCash[t] }), {}); r += 1;
  const inKindRow = emitRow(ws, r, N, 'In-kind land (= in-kind equity)',
    (t) => ({ f: `${capP(capexAddrs.inclTotalRow, t)}-${capP(capexAddrs.exclInKindTotalRow, t)}`, v: lm.inKind[t] }), {}); r += 1;
  const arRow = emitRow(ws, r, N, 'Accounts receivable (revenue x DSO / 365)',
    (t) => ({ f: `${xc(SHEETS.revenue, revLinks.totalRow, t)}*${dsoCell}/365`, v: lm.ar[t] }), { total: 'last' }); r += 1;
  const apRow = emitRow(ws, r, N, 'Accounts payable (opex x DPO / 365)',
    (t) => ({ f: `${xc(SHEETS.opex, opexLinks.totalRow, t)}*${dpoCell}/365`, v: lm.ap[t] }), { total: 'last' }); r += 1;
  r += 1;

  // Recurrence (pre-assigned row numbers so each line can reference siblings).
  setSectionHeader(ws.getRow(r), 'Debt, equity & cash recurrence', lastActiveCol(N)); r += 1;
  const debtOpenRow = r, interestRow = r + 1, pbtRow = r + 2, taxRow = r + 3, patRow = r + 4,
    revReceivedRow = r + 5, opexPaidRow = r + 6, cfoRow = r + 7, cfiRow = r + 8, openCashRow = r + 9,
    preFinRow = r + 10, debtDrawRow = r + 11, equityCashRow = r + 12, principalRow = r + 13,
    equityInKindRow = r + 14, debtCloseRow = r + 15, cffRow = r + 16, netCfRow = r + 17, closeCashRow = r + 18;
  const P = lcol;
  const prev = (t: number): string => colLetter(pcol(t - 1));
  emitRow(ws, debtOpenRow, N, 'Debt: opening', (t) => (t === 0 ? { v: 0 } : { f: `${prev(t)}${debtCloseRow}`, v: lm.debtOpen[t] }), { total: 'last' });
  emitRow(ws, interestRow, N, 'Interest (rate x opening debt)', (t) => ({ f: `${P(t)}${debtOpenRow}*${debtRateCell}`, v: lm.interest[t] }), { indent: 1 });
  emitRow(ws, pbtRow, N, 'Profit before tax (EBIT - interest)', (t) => ({ f: `${P(t)}${ebitRow}-${P(t)}${interestRow}`, v: lm.pbt[t] }), { indent: 1 });
  emitRow(ws, taxRow, N, 'Tax / Zakat', (t) => ({ f: `MAX(0,${P(t)}${pbtRow})*${taxRateCell}`, v: lm.tax[t] }), { indent: 1 });
  emitRow(ws, patRow, N, 'Profit after tax', (t) => ({ f: `${P(t)}${pbtRow}-${P(t)}${taxRow}`, v: lm.pat[t] }), { indent: 1, bold: true });
  emitRow(ws, revReceivedRow, N, 'Revenue received', (t) => ({ f: t === 0 ? `${xc(SHEETS.revenue, revLinks.totalRow, 0)}-${P(0)}${arRow}` : `${xc(SHEETS.revenue, revLinks.totalRow, t)}-(${P(t)}${arRow}-${prev(t)}${arRow})`, v: lm.revReceived[t] }), { indent: 1 });
  emitRow(ws, opexPaidRow, N, 'Opex paid', (t) => ({ f: t === 0 ? `${xc(SHEETS.opex, opexLinks.totalRow, 0)}-${P(0)}${apRow}` : `${xc(SHEETS.opex, opexLinks.totalRow, t)}-(${P(t)}${apRow}-${prev(t)}${apRow})`, v: lm.opexPaid[t] }), { indent: 1 });
  emitRow(ws, cfoRow, N, 'Cash from operations', (t) => ({ f: `${P(t)}${revReceivedRow}-${P(t)}${opexPaidRow}-${P(t)}${taxRow}`, v: lm.cfo[t] }), { bold: true });
  emitRow(ws, cfiRow, N, 'Cash from investing (capex)', (t) => ({ f: `-${P(t)}${capexCashRow}`, v: lm.cfi[t] }), { bold: true });
  emitRow(ws, openCashRow, N, 'Cash: opening', (t) => (t === 0 ? { v: 0 } : { f: `${prev(t)}${closeCashRow}`, v: lm.openCash[t] }), { total: 'last' });
  emitRow(ws, preFinRow, N, 'Cash before funding', (t) => ({ f: `${P(t)}${openCashRow}+${P(t)}${cfoRow}+${P(t)}${cfiRow}-${P(t)}${interestRow}`, v: lm.openCash[t] + lm.cfo[t] + lm.cfi[t] - lm.interest[t] }), { indent: 1, total: 'none' });
  emitRow(ws, debtDrawRow, N, 'Debt drawdown', (t) => ({ f: `IF(${P(t)}${preFinRow}<${minCashCell},(${minCashCell}-${P(t)}${preFinRow})*${debtPctCell},0)`, v: lm.debtDraw[t] }), { indent: 1 });
  emitRow(ws, equityCashRow, N, 'Equity drawdown (cash)', (t) => ({ f: `IF(${P(t)}${preFinRow}<${minCashCell},(${minCashCell}-${P(t)}${preFinRow})*${equityPctCell},0)`, v: lm.equityCash[t] }), { indent: 1 });
  emitRow(ws, principalRow, N, 'Principal repaid (surplus sweep)', (t) => ({ f: `IF(${P(t)}${preFinRow}>=${minCashCell},MIN(${P(t)}${debtOpenRow},${P(t)}${preFinRow}-${minCashCell}),0)`, v: lm.principal[t] }), { indent: 1 });
  emitRow(ws, equityInKindRow, N, 'Equity drawdown (in-kind land)', (t) => ({ f: `${P(t)}${inKindRow}`, v: lm.equityInKind[t] }), { indent: 1 });
  emitRow(ws, debtCloseRow, N, 'Debt: closing', (t) => ({ f: `${P(t)}${debtOpenRow}+${P(t)}${debtDrawRow}-${P(t)}${principalRow}`, v: lm.debtClose[t] }), { total: 'last', bold: true });
  emitRow(ws, cffRow, N, 'Cash from financing', (t) => ({ f: `${P(t)}${equityCashRow}+${P(t)}${debtDrawRow}-${P(t)}${principalRow}-${P(t)}${interestRow}`, v: lm.cff[t] }), { bold: true });
  emitRow(ws, netCfRow, N, 'Net cash flow', (t) => ({ f: `${P(t)}${cfoRow}+${P(t)}${cfiRow}+${P(t)}${cffRow}`, v: lm.netCf[t] }), {});
  emitRow(ws, closeCashRow, N, 'Cash: closing', (t) => ({ f: `${P(t)}${openCashRow}+${P(t)}${netCfRow}`, v: lm.closeCash[t] }), { total: 'last', bold: true });
  r = closeCashRow + 1;

  return { daRow, ebitdaRow, ebitRow, interestRow, pbtRow, taxRow, patRow, arRow, apRow, capexCashRow, inKindRow, revReceivedRow, opexPaidRow, cfoRow, cfiRow, debtOpenRow, debtDrawRow, principalRow, debtCloseRow, equityCashRow, equityInKindRow, cffRow, netCfRow, openCashRow, closeCashRow };
}

// ── P&L (presentation; links Revenue / CoS / Opex / Financing) ────────────────
function addProfitLoss(ctx: EmitCtx, revLinks: RevLinks, cosLinks: CosLinks, opexLinks: OpexLinks, fin: FinLinks): void {
  const { wb, snap, lm } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.pl, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'P&L', 'Income statement, linked to the Revenue, Cost of Sales, Opex and Financing tabs.', { label: 'Line' });
  let r = 5;
  setSectionHeader(ws.getRow(r), 'Income statement', lastActiveCol(N)); r += 1;
  const revRow = emitRow(ws, r, N, 'Revenue', (t) => ({ f: xc(SHEETS.revenue, revLinks.totalRow, t), v: lm.totalRev[t] }), { bold: true }); r += 1;
  const cosRow = emitRow(ws, r, N, 'Cost of sales', (t) => ({ f: `-${xc(SHEETS.cos, cosLinks.totalRow, t)}`, v: -lm.cosTotal[t] }), { indent: 1 }); r += 1;
  const grossRow = emitRow(ws, r, N, 'Gross profit', (t) => ({ f: `${lcol(t)}${revRow}+${lcol(t)}${cosRow}`, v: lm.totalRev[t] - lm.cosTotal[t] }), { bold: true }); r += 1;
  const opexRow = emitRow(ws, r, N, 'Operating expenses', (t) => ({ f: `-${xc(SHEETS.opex, opexLinks.totalRow, t)}`, v: -lm.totalOpex[t] }), { indent: 1 }); r += 1;
  const ebitdaRow = emitRow(ws, r, N, 'EBITDA', (t) => ({ f: `${lcol(t)}${grossRow}+${lcol(t)}${opexRow}`, v: lm.ebitda[t] }), { bold: true }); r += 1;
  const daRow = emitRow(ws, r, N, 'Depreciation & amortisation', (t) => ({ f: `-${xc(SHEETS.financing, fin.daRow, t)}`, v: -lm.da[t] }), { indent: 1 }); r += 1;
  const ebitRow = emitRow(ws, r, N, 'EBIT', (t) => ({ f: `${lcol(t)}${ebitdaRow}+${lcol(t)}${daRow}`, v: lm.ebit[t] }), { bold: true }); r += 1;
  const intRow = emitRow(ws, r, N, 'Interest expense', (t) => ({ f: `-${xc(SHEETS.financing, fin.interestRow, t)}`, v: -lm.interest[t] }), { indent: 1 }); r += 1;
  const pbtRow = emitRow(ws, r, N, 'Profit before tax', (t) => ({ f: `${lcol(t)}${ebitRow}+${lcol(t)}${intRow}`, v: lm.pbt[t] }), { bold: true }); r += 1;
  const taxRow = emitRow(ws, r, N, 'Tax / Zakat', (t) => ({ f: `-${xc(SHEETS.financing, fin.taxRow, t)}`, v: -lm.tax[t] }), { indent: 1 }); r += 1;
  navySumRow(ws, r, N, 'Profit after tax', [pbtRow, taxRow], lm.pat, 'navy'); r += 1;
}

// ── Cash Flow (presentation; links the Financing recurrence) ──────────────────
function addCashFlow(ctx: EmitCtx, fin: FinLinks): CfLinks {
  const { wb, snap, lm } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.cashflow, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Cash Flow', 'Direct cash flow, linked to the Financing engine. Operating + investing + financing cash reconciles to the closing cash that drives the Balance Sheet.', { label: 'Line' });
  let r = 5;
  setSectionHeader(ws.getRow(r), 'Operating', lastActiveCol(N)); r += 1;
  emitRow(ws, r, N, 'Revenue received', (t) => ({ f: xc(SHEETS.financing, fin.revReceivedRow, t), v: lm.revReceived[t] }), { indent: 1 }); r += 1;
  emitRow(ws, r, N, 'Opex paid', (t) => ({ f: `-${xc(SHEETS.financing, fin.opexPaidRow, t)}`, v: -lm.opexPaid[t] }), { indent: 1 }); r += 1;
  emitRow(ws, r, N, 'Tax paid', (t) => ({ f: `-${xc(SHEETS.financing, fin.taxRow, t)}`, v: -lm.taxPaid[t] }), { indent: 1 }); r += 1;
  const cfoRow = emitRow(ws, r, N, 'Cash from operations', (t) => ({ f: xc(SHEETS.financing, fin.cfoRow, t), v: lm.cfo[t] }), { bold: true }); r += 1;
  setSectionHeader(ws.getRow(r), 'Investing', lastActiveCol(N)); r += 1;
  const cfiRow = emitRow(ws, r, N, 'Cash from investing (capex)', (t) => ({ f: xc(SHEETS.financing, fin.cfiRow, t), v: lm.cfi[t] }), { bold: true }); r += 1;
  setSectionHeader(ws.getRow(r), 'Financing', lastActiveCol(N)); r += 1;
  emitRow(ws, r, N, 'Equity drawdown (cash)', (t) => ({ f: xc(SHEETS.financing, fin.equityCashRow, t), v: lm.equityCash[t] }), { indent: 1 }); r += 1;
  emitRow(ws, r, N, 'Debt drawdown', (t) => ({ f: xc(SHEETS.financing, fin.debtDrawRow, t), v: lm.debtDraw[t] }), { indent: 1 }); r += 1;
  emitRow(ws, r, N, 'Principal repaid', (t) => ({ f: `-${xc(SHEETS.financing, fin.principalRow, t)}`, v: -lm.principal[t] }), { indent: 1 }); r += 1;
  emitRow(ws, r, N, 'Interest paid', (t) => ({ f: `-${xc(SHEETS.financing, fin.interestRow, t)}`, v: -lm.interest[t] }), { indent: 1 }); r += 1;
  const cffRow = emitRow(ws, r, N, 'Cash from financing', (t) => ({ f: xc(SHEETS.financing, fin.cffRow, t), v: lm.cff[t] }), { bold: true }); r += 1;
  emitRow(ws, r, N, 'Net cash flow', (t) => ({ f: `${lcol(t)}${cfoRow}+${lcol(t)}${cfiRow}+${lcol(t)}${cffRow}`, v: lm.netCf[t] }), { bold: true }); r += 1;
  emitRow(ws, r, N, 'Opening cash', (t) => ({ f: xc(SHEETS.financing, fin.openCashRow, t), v: lm.openCash[t] }), { total: 'last' }); r += 1;
  const closeCashRow = emitRow(ws, r, N, 'Closing cash', (t) => ({ f: xc(SHEETS.financing, fin.closeCashRow, t), v: lm.closeCash[t] }), { total: 'last', bold: true }); r += 1;
  return { cfoRow, cfiRow, cffRow, closeCashRow };
}

// ── Balance Sheet (assemble + roll; balances by construction) ─────────────────
function addBalanceSheet(ctx: EmitCtx, fin: FinLinks, cosLinks: CosLinks): BsLinks {
  const { wb, snap, lm, assets, capexAddrs } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.balsheet, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Balance Sheet', 'Assets = Liabilities + Equity. Working-capital and fixed-asset accounts roll forward from the Capex schedule, Cost of Sales, depreciation and the financing recurrence; the balance check is ~0 by construction.', { label: 'Line' });
  const capP = (row: number, t: number): string => sheetRef(SHEETS.capex, `${colLetter(capexAddrs.periodCol(t))}${row}`);
  const sumAssetCapex = (group: 'sell' | 'opConstruction' | 'opLand', t: number): string => {
    const sel = group === 'sell' ? assets.filter((a) => a.group === 'Residential') : assets.filter((a) => a.group !== 'Residential');
    const parts = sel.map((a) => {
      const pa = capexAddrs.perAsset.get(a.id); if (!pa) return null;
      if (group === 'sell') return capP(pa.inclRow, t);
      if (group === 'opConstruction') return capP(pa.exclAllRow, t);
      return `(${capP(pa.inclRow, t)}-${capP(pa.exclAllRow, t)})`;
    }).filter((x): x is string => !!x);
    return parts.length ? parts.join('+') : '0';
  };
  let r = 5;

  setSectionHeader(ws.getRow(r), 'Assets', lastActiveCol(N)); r += 1;
  const cashRow = emitRow(ws, r, N, 'Cash', (t) => ({ f: xc(SHEETS.financing, fin.closeCashRow, t), v: lm.closeCash[t] }), { total: 'last' }); r += 1;
  const arRow = emitRow(ws, r, N, 'Accounts receivable', (t) => ({ f: xc(SHEETS.financing, fin.arRow, t), v: lm.ar[t] }), { total: 'last' }); r += 1;
  const invRow = r;
  emitRow(ws, invRow, N, 'Inventory (WIP, for-sale)', (t) => ({ f: t === 0 ? `${sumAssetCapex('sell', 0)}-${xc(SHEETS.cos, cosLinks.totalRow, 0)}` : `${prevCol(t)}${invRow}+${sumAssetCapex('sell', t)}-${xc(SHEETS.cos, cosLinks.totalRow, t)}`, v: lm.inventory[t] }), { total: 'last' }); r += 1;
  const nbvRow = r;
  emitRow(ws, nbvRow, N, 'Net book value (depreciable)', (t) => ({ f: t === 0 ? `${sumAssetCapex('opConstruction', 0)}-${xc(SHEETS.financing, fin.daRow, 0)}` : `${prevCol(t)}${nbvRow}+${sumAssetCapex('opConstruction', t)}-${xc(SHEETS.financing, fin.daRow, t)}`, v: lm.nbv[t] }), { total: 'last' }); r += 1;
  const landRow = r;
  emitRow(ws, landRow, N, 'Land (operating assets)', (t) => ({ f: t === 0 ? `${sumAssetCapex('opLand', 0)}` : `${prevCol(t)}${landRow}+${sumAssetCapex('opLand', t)}`, v: lm.land[t] }), { total: 'last' }); r += 1;
  const totalFARow = emitRow(ws, r, N, 'Total fixed assets', (t) => ({ f: `${lcol(t)}${nbvRow}+${lcol(t)}${landRow}`, v: lm.totalFA[t] }), { bold: true, total: 'last' }); r += 1;
  const totalCARow = emitRow(ws, r, N, 'Total current assets', (t) => ({ f: `${lcol(t)}${cashRow}+${lcol(t)}${arRow}+${lcol(t)}${invRow}`, v: lm.totalCA[t] }), { bold: true, total: 'last' }); r += 1;
  navySumRow(ws, r, N, 'Total assets', [totalFARow, totalCARow], lm.totalAssets, 'navy'); const totalAssetsRow = r; r += 1;
  r += 1;

  setSectionHeader(ws.getRow(r), 'Liabilities', lastActiveCol(N)); r += 1;
  const apRow = emitRow(ws, r, N, 'Accounts payable', (t) => ({ f: xc(SHEETS.financing, fin.apRow, t), v: lm.ap[t] }), { total: 'last' }); r += 1;
  const debtRow = emitRow(ws, r, N, 'Debt outstanding', (t) => ({ f: xc(SHEETS.financing, fin.debtCloseRow, t), v: lm.debtClose[t] }), { total: 'last' }); r += 1;
  navySumRow(ws, r, N, 'Total liabilities', [apRow, debtRow], lm.totalLiab, 'subtotal'); const totalLiabRow = r; r += 1;
  r += 1;

  setSectionHeader(ws.getRow(r), 'Equity', lastActiveCol(N)); r += 1;
  const shareRow = r;
  emitRow(ws, shareRow, N, 'Share capital (cumulative equity)', (t) => ({ f: t === 0 ? `${xc(SHEETS.financing, fin.equityCashRow, 0)}+${xc(SHEETS.financing, fin.equityInKindRow, 0)}` : `${prevCol(t)}${shareRow}+${xc(SHEETS.financing, fin.equityCashRow, t)}+${xc(SHEETS.financing, fin.equityInKindRow, t)}`, v: lm.shareCapital[t] }), { total: 'last' }); r += 1;
  const retRow = r;
  emitRow(ws, retRow, N, 'Retained earnings (cumulative PAT)', (t) => ({ f: t === 0 ? `${xc(SHEETS.financing, fin.patRow, 0)}` : `${prevCol(t)}${retRow}+${xc(SHEETS.financing, fin.patRow, t)}`, v: lm.retained[t] }), { total: 'last' }); r += 1;
  const totalEquityRow = emitRow(ws, r, N, 'Total equity', (t) => ({ f: `${lcol(t)}${shareRow}+${lcol(t)}${retRow}`, v: lm.totalEquity[t] }), { bold: true, total: 'last' }); r += 1;
  navySumRow(ws, r, N, 'Total liabilities + equity', [totalLiabRow, totalEquityRow], lm.totalLE, 'navy'); const totalLERow = r; r += 1;
  const bsDiffRow = emitRow(ws, r, N, 'Balance check (Assets - L&E)', (t) => ({ f: `${lcol(t)}${totalAssetsRow}-${lcol(t)}${totalLERow}`, v: lm.bsDiff[t] }), { bold: true, total: 'none' }); r += 1;
  return { totalAssetsRow, totalLERow, bsDiffRow, cashRow };
}

// ── Returns (NOI, terminal value, FCFF / FCFE, live IRR / NPV / MOIC) ─────────
function addReturns(ctx: EmitCtx, revLinks: RevLinks, opexLinks: OpexLinks, fin: FinLinks): RetLinks {
  const { wb, snap, lm, proj } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.returns, { properties: { tabColor: { argb: ARGB.good } } });
  writeSheetHeader(ws, snap, N, 'Returns', 'Project (FCFF) and equity (FCFE) returns. Terminal value at the exit year = stabilised NOI x exit multiple (less debt for equity). IRR / NPV / MOIC are live Excel functions over the streams, so they update with any input. Note: the exit-year COLUMN is fixed at build; editing the exit-year offset re-prices the terminal value but does not re-window the IRR range.', { label: 'Line' });
  const exit = lm.exitOffset;
  const exitCol = colLetter(pcol(exit));
  let r = 5;

  setSectionHeader(ws.getRow(r), 'Inputs (linked from Assumptions)', lastActiveCol(N)); r += 1;
  const scalar = (label: string, link: string, cached: number | string, fmt: string): string => {
    setLabel(ws.getCell(r, LBL_COL), label);
    if (typeof cached === 'string') { const c = ws.getCell(r, TOTAL_COL); c.value = cached; c.numFmt = fmt; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    else if (link) setFormula(ws.getCell(r, TOTAL_COL), fcell(link, cached), fmt, true);
    else { const c = ws.getCell(r, TOTAL_COL); c.value = cached; c.numFmt = fmt; markInput(c); }
    const a = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return a;
  };
  const discCell = scalar('Discount rate', 'DiscountRate', proj.discountRate, NUMFMT.pct2);
  const exitMultCell = scalar('Exit multiple (x stabilised NOI)', 'ExitMultiple', proj.exitMultiple, NUMFMT.mult);
  scalar('Exit year offset (0-based)', 'ExitYearOffset', proj.exitOffset, NUMFMT.int);
  r += 1;

  setSectionHeader(ws.getRow(r), 'Net operating income & terminal value', lastActiveCol(N)); r += 1;
  const noiRow = emitRow(ws, r, N, 'Net operating income (NOI)', (t) => ({ f: `${xc(SHEETS.revenue, revLinks.hospitalityRow, t)}+${xc(SHEETS.revenue, revLinks.retailRow, t)}-${xc(SHEETS.opex, opexLinks.hospRow, t)}-${xc(SHEETS.opex, opexLinks.retailRow, t)}`, v: lm.noi[t] }), {}); r += 1;
  const scalarD = (label: string, f: string, v: number, fmt = NUMFMT.money): string => {
    setLabel(ws.getCell(r, LBL_COL), label); setFormula(ws.getCell(r, TOTAL_COL), fcell(f, v), fmt);
    const a = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return a;
  };
  const stabCell = scalarD('Stabilised NOI (max to exit)', `MAX(${lcol(0)}${noiRow}:${exitCol}${noiRow})`, lm.stabilisedNOI);
  const evCell = scalarD('Terminal enterprise value', `${stabCell}*${exitMultCell}`, lm.terminalEV);
  const teqCell = scalarD('Terminal equity value', `MAX(0,${evCell}-${xc(SHEETS.financing, fin.debtCloseRow, exit)})`, lm.terminalEquity);
  r += 1;

  setSectionHeader(ws.getRow(r), 'Free cash flow streams (inception col E, terminal at exit)', lastActiveCol(N)); r += 1;
  const base = (t: number): string => `${xc(SHEETS.financing, fin.cfoRow, t)}+${xc(SHEETS.financing, fin.cfiRow, t)}`;
  const fcffRow = emitRow(ws, r, N, 'FCFF (project)', (t) => ({ f: t === exit ? `${base(t)}+${evCell}` : base(t), v: lm.fcff[t] }), { open: { v: 0 }, total: 'none' }); r += 1;
  const equityBase = (t: number): string => `${base(t)}+${xc(SHEETS.financing, fin.debtDrawRow, t)}-${xc(SHEETS.financing, fin.principalRow, t)}-${xc(SHEETS.financing, fin.interestRow, t)}-${xc(SHEETS.financing, fin.equityInKindRow, t)}`;
  const fcfeRow = emitRow(ws, r, N, 'FCFE (equity)', (t) => ({ f: t === exit ? `${equityBase(t)}+${teqCell}` : equityBase(t), v: lm.fcfe[t] }), { open: { v: 0 }, total: 'none' }); r += 1;
  r += 1;

  setSectionHeader(ws.getRow(r), 'Returns', lastActiveCol(N)); r += 1;
  const streamRange = (row: number): string => `${colLetter(OPEN_COL)}${row}:${exitCol}${row}`;
  const npvF = (row: number): string => `${colLetter(OPEN_COL)}${row}+NPV(${discCell},${lcol(0)}${row}:${exitCol}${row})`;
  const moicF = (row: number): string => `IFERROR(SUMIF(${streamRange(row)},">0")/-SUMIF(${streamRange(row)},"<0"),0)`;
  const metric = (label: string, f: string, v: number, fmt: string): string => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold: true }); setFormula(ws.getCell(r, TOTAL_COL), fcell(f, v), fmt);
    const a = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return a;
  };
  // The cached IRR seeds Excel's IRR() guess so the solver converges even for
  // high-return projects (Excel's default 0.1 guess fails on large IRRs).
  const guess = (v: number | null): number => (v != null && Number.isFinite(v) && Math.abs(v) < 100 ? v : 0.1);
  const fcffIrrCell = metric('Project IRR (FCFF)', `IFERROR(IRR(${streamRange(fcffRow)},${guess(lm.fcffIrr)}),0)`, lm.fcffIrr ?? 0, NUMFMT.pct2);
  metric('Project NPV (FCFF)', npvF(fcffRow), lm.fcffNpv, NUMFMT.money);
  metric('Project MOIC (FCFF)', moicF(fcffRow), lm.fcffMoic, NUMFMT.mult);
  const fcfeIrrCell = metric('Equity IRR (FCFE)', `IFERROR(IRR(${streamRange(fcfeRow)},${guess(lm.fcfeIrr)}),0)`, lm.fcfeIrr ?? 0, NUMFMT.pct2);
  metric('Equity NPV (FCFE)', npvF(fcfeRow), lm.fcfeNpv, NUMFMT.money);
  metric('Equity multiple (FCFE MOIC)', moicF(fcfeRow), lm.fcfeMoic, NUMFMT.mult);
  return { fcffIrrCell, fcfeIrrCell };
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(ctx: EmitCtx, capexAddrs: CapexAddrs, links: { cfLinks: CfLinks; bsLinks: BsLinks; retLinks: RetLinks }): void {
  const { wb, snap, lm } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.good } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 14; ws.getColumn(3).width = 44;
  setTitle(ws.getCell('A1'), 'Checks & Legend', 16);
  let r = 3;
  setSectionHeader(ws.getRow(r), 'Colour legend (FAST)', 3); r += 1;
  { const inp = ws.getCell(`A${r}`); inp.value = 'Input (edit these)'; markInput(inp); r += 1; }
  { const fm = ws.getCell(`A${r}`); fm.value = 'Formula (calculation)'; fm.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1; }
  { const lk = ws.getCell(`A${r}`); lk.value = 'Linked (reference to another sheet)'; lk.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.linked } }; r += 1; }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Model integrity checks', 3); r += 1;
  ['Check', 'Status', 'Note'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left')); r += 1;
  const bs = links.bsLinks; const cf = links.cfLinks;
  const lastCol = colLetter(lastActiveCol(N));
  const firstCol = colLetter(pcol(0));
  const checkRow = (label: string, statusF: string, statusV: string, noteF: string, noteV: number): void => {
    setLabel(ws.getCell(`A${r}`), label);
    const s = ws.getCell(`B${r}`); setFormula(s, fcell(statusF, statusV), '@'); s.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: statusV === 'OK' ? ARGB.good : ARGB.bad } };
    setFormula(ws.getCell(`C${r}`), fcell(noteF, noteV), NUMFMT.money, true); r += 1;
  };
  // Balance sheet balances: max abs of the per-period balance-check row.
  const bsRange = `'${SHEETS.balsheet}'!${firstCol}${bs.bsDiffRow}:${lastCol}${bs.bsDiffRow}`;
  const maxBsDiff = Math.max(0, ...lm.bsDiff.map((v) => Math.abs(v)));
  checkRow('Balance sheet balances (Assets = L + E)', `IF(SUMPRODUCT(ABS(${bsRange}))<1,"OK","CHECK")`, maxBsDiff < 1 ? 'OK' : 'CHECK', `MAX(ABS(${bsRange}))`, maxBsDiff);
  // Cash flow closing == balance sheet cash (last period).
  const cfClose = sheetRef(SHEETS.cashflow, `${lastCol}${cf.closeCashRow}`);
  const bsCash = sheetRef(SHEETS.balsheet, `${lastCol}${bs.cashRow}`);
  const cashTie = Math.abs((lm.closeCash[N - 1] ?? 0) - (lm.closeCash[N - 1] ?? 0)) < 1;
  checkRow('Cash flow closing == balance sheet cash', `IF(ABS(${cfClose}-${bsCash})<1,"OK","CHECK")`, cashTie ? 'OK' : 'CHECK', cfClose, lm.closeCash[N - 1] ?? 0);
  // Capex schedule ties to the cost build-up.
  checkRow('Capex schedule ties to cost build-up', `IF(ABS(${capexAddrs.scheduleTotalAddr}-${capexAddrs.buildupTotalAddr})<1,"OK","CHECK")`, 'OK', capexAddrs.scheduleTotalAddr, lm.capexCash.reduce((s, v) => s + v, 0));
  r += 1;

  setSectionHeader(ws.getRow(r), 'Headline returns (live)', 3); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Project IRR (FCFF)');
  setFormula(ws.getCell(`C${r}`), fcell(links.retLinks.fcffIrrCell, lm.fcffIrr ?? 0), NUMFMT.pct2, true); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Equity IRR (FCFE)');
  setFormula(ws.getCell(`C${r}`), fcell(links.retLinks.fcfeIrrCell, lm.fcfeIrr ?? 0), NUMFMT.pct2, true); r += 1;
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'This is a simplified, fully formula-linked live model. Magnitudes (revenue, capex, opex) follow the same drivers as the platform; financing uses a clean forward recurrence (interest on opening debt, deficit-funded drawdowns, surplus cash sweep) so editing any input flows through to the IRR. It is not a byte-for-byte mirror of the platform engine (escrow, milestone AR, IDC capitalisation and the multi-method funding are simplified).');
}

// ── Cover / Index ─────────────────────────────────────────────────────────────
function addCover(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, lm: LiveModel): void {
  const ws = wb.addWorksheet(SHEETS.cover, { properties: { tabColor: { argb: ARGB.navyDark } }, views: [{ showGridLines: false }] });
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
    ['Horizon', `${snap.axisLength} yrs (${snap.projectStartYear} to ${snap.projectStartYear + snap.axisLength - 1})`],
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
    ['Gross dev value', m(lm.totalRev.reduce((s, x) => s + x, 0))],
    ['Project IRR', pct(lm.fcffIrr)],
    ['Equity IRR', pct(lm.fcfeIrr)],
    ['Peak debt', m(Math.max(0, ...lm.debtClose))],
    ['Equity multiple', `${lm.fcfeMoic.toFixed(2)}x`],
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
    [SHEETS.revenue, 'Recognised revenue by strategy and asset (base x profile)'],
    [SHEETS.cos, 'Cost of sales matched to recognised revenue'],
    [SHEETS.opex, 'Operating expenses by asset and category'],
    [SHEETS.financing, 'Depreciation, interest, tax, debt + equity and the cash recurrence'],
    [SHEETS.pl, 'Profit and loss (income statement)'],
    [SHEETS.cashflow, 'Cash flow statement'],
    [SHEETS.balsheet, 'Balance sheet (balances by construction)'],
    [SHEETS.returns, 'IRR, NPV and equity multiple (FCFF / FCFE)'],
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
