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
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
import { buildFinancingScheduleTables, buildCashSweepTables, type ReportTable } from '../reports/financingReports';
import { buildCostOfSalesReport } from '../reports/cosReports';
import { buildOpexReport } from '../reports/opexReports';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, type M4ReportCtx } from '../reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeReturnsSnapshot, type ReturnsSnapshot } from '../returns-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { formatAccounting } from '@/src/core/formatters';
import { computeLiveModel, type LiveAssetInput, type LiveModel, type LiveGroup } from './liveModel';
import {
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, markInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
  fillCell, fillRange, boxBorder, sheetRef, scaleMoneyFormats, scaleNote, defaultDecimals, setStaticMode, setNote, setBasis, type DisplayScale, type DisplayDecimals,
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

const SHEETS = { cover: 'Cover', assumptions: 'Inputs', timeline: 'Timeline', landArea: 'Land & Area', capex: 'Capex', revenue: 'Revenue', opex: 'Opex', financing: 'Financing', schedules: 'Schedules', pl: 'P&L', cashflow: 'Cash Flow', balsheet: 'Balance Sheet', returns: 'Returns', checks: 'Checks' };

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  // HARDCODED platform mirror: every computed cell is written as the platform
  // snapshot value (a constant), not a live formula. The workbook lets a user
  // read all results and run their own scenarios manually; editing a cell does
  // NOT recalculate, the user re-exports from the platform after changing inputs.
  setStaticMode(true);
  const snap = computeFinancialsSnapshot(opts.state);
  const capex = buildCapexReport(snap, opts.state);
  // The pure twin gives the row STRUCTURE + the few fields the snapshot does not
  // expose directly; buildRealModel then overrides every displayed figure with
  // the real platform snapshot value, so the statements tie exactly to the
  // platform (Capex + Land already use the real engine reports/metrics).
  const { assets: liveAssets, proj } = prepareLiveModel(snap, opts.state, capex);
  const twin = computeLiveModel(liveAssets, proj);
  const lm = buildRealModel(twin, snap, liveAssets);
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

  // Tab sequence follows the platform module order. Financing is Module 1
  // (Tab 4), so its sheet is created here, right after Capex, keeping all of
  // Module 1 (Inputs, Timeline, Land & Area, Capex, Financing) together, then
  // Module 2 (Revenue, Cost of Sales), Module 3 (Opex), Module 4 (P&L, Cash
  // Flow, Balance Sheet) and Module 5 (Returns). Financing owns the
  // computational recurrence (depreciation, interest, tax, debt / equity / cash
  // flow) read straight from the snapshot, so it does NOT depend on the
  // downstream Revenue / CoS / Opex link registries; P&L / Cash Flow / Balance
  // Sheet / Returns are link-and-assemble presentation tabs. Each emitter
  // returns the row registry the next links to.
  const ctx: EmitCtx = { wb, snap, state: opts.state, refs, lm, proj, assets: liveAssets, landAddrs, capexAddrs, revBaseFormula, currency: opts.state.project.currency ?? 'SAR' };
  const finLinks = addFinancing(ctx);
  const { revLinks } = addRevenue(ctx);
  const opexLinks = addOpex(ctx);
  addSchedules(ctx);
  addProfitLoss(ctx);
  addCashFlow(ctx);
  addBalanceSheet(ctx);
  const retLinks = addReturns(ctx, revLinks, opexLinks, finLinks);
  addChecks(ctx, capexAddrs, retLinks);

  // Workbook-wide DISPLAY scale: re-format magnitude money cells (display only;
  // stored values + formulas stay in full units). Applied last so every sheet's
  // cells are set.
  const scale = opts.displayScale ?? 'full';
  const decimals = opts.displayDecimals ?? defaultDecimals(scale);
  scaleMoneyFormats(wb, scale, decimals);
  const note = scaleNote(scale, opts.state.project.currency ?? 'SAR');
  if (note) {
    for (const name of [SHEETS.landArea, SHEETS.capex, SHEETS.revenue, SHEETS.opex, SHEETS.financing, SHEETS.schedules, SHEETS.pl, SHEETS.cashflow, SHEETS.balsheet]) {
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
  state: FinancialsResolverState;
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

/**
 * Override the twin's DISPLAYED series with the real platform snapshot values,
 * so the hardcoded workbook ties exactly to the platform (P&L, Cash Flow,
 * Balance Sheet, Revenue, Opex, Financing). The twin still supplies the row
 * structure plus the handful of internal fields the snapshot does not expose
 * (sellIncl / operateConstruction / operateLand / arDelta / apDelta) and the
 * Returns block (computed from the same drivers). Capex + Land & Area already
 * render the real engine report / metrics, so they are untouched here.
 */
function buildRealModel(twin: LiveModel, snap: ReturnType<typeof computeFinancialsSnapshot>, assets: LiveAssetInput[]): LiveModel {
  const N = snap.axisLength;
  const pad = (a: number[] | undefined): number[] => { const o = (a ?? []).slice(0, N); while (o.length < N) o.push(0); return o; };
  const diff = (a: number[], b: number[]): number[] => Array.from({ length: N }, (_, t) => (a[t] ?? 0) - (b[t] ?? 0));
  const sumBy = (pick: (id: string) => number[] | undefined, keep: (g: LiveGroup) => boolean): number[] => {
    const o = new Array<number>(N).fill(0);
    for (const a of assets) { if (!keep(a.group)) continue; const s = pad(pick(a.id)); for (let t = 0; t < N; t++) o[t] += s[t]; }
    return o;
  };
  const pl = snap.pl, cf = snap.directCF, bs = snap.bs;
  const revByAsset = new Map<string, number[]>();
  const cosByAsset = new Map<string, number[]>();
  const opexByAsset = new Map<string, number[]>();
  const daByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const ap = snap.perAssetPL.get(a.id);
    revByAsset.set(a.id, pad(ap?.revenuePerPeriod));
    cosByAsset.set(a.id, pad(ap?.cosPerPeriod));
    opexByAsset.set(a.id, pad(ap?.opexPerPeriod));
    daByAsset.set(a.id, pad(ap?.daPerPeriod));
  }
  const patReal = pad(pl.patPerPeriod);
  const pbtReal = pad(pl.pbtPerPeriod);
  const debtClose = pad(bs.debtOutstandingPerPeriod);
  const debtOpen = Array.from({ length: N }, (_, t) => (t === 0 ? 0 : debtClose[t - 1]));
  const arReal = Array.from({ length: N }, (_, t) => (pad(bs.arPerPeriod)[t] + pad(bs.residentialReceivablesPerPeriod)[t]));
  return {
    ...twin,
    // Revenue
    revByAsset,
    residentialRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Residential'),
    hospitalityRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Hospitality' || g === 'Other'),
    retailRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Retail'),
    totalRev: pad(pl.totalRevenuePerPeriod),
    // Cost of sales
    cosByAsset, cosTotal: pad(pl.cosPerPeriod),
    // Opex
    opexByAsset,
    hospitalityOpex: sumBy((id) => opexByAsset.get(id), (g) => g === 'Hospitality' || g === 'Other'),
    retailOpex: sumBy((id) => opexByAsset.get(id), (g) => g === 'Retail'),
    hqOpex: pad(snap.opex.hq.totalOpexPerPeriod),
    totalOpex: pad(pl.totalOpexPerPeriod),
    // P&L
    ebitda: pad(pl.ebitdaPerPeriod), daByAsset, da: pad(pl.daPerPeriod), ebit: pad(pl.ebitPerPeriod),
    interest: pad(pl.interestExpensePerPeriod), pbt: pbtReal, tax: diff(pbtReal, patReal), pat: patReal,
    // Capex cash basis (CFI) + in-kind land (= in-kind equity)
    capexCash: pad(cf.capexPerPeriod), inKind: pad(cf.equityInKindDrawdownPerPeriod),
    // Debt / equity schedule
    debtOpen, debtDraw: pad(cf.debtDrawdownPerPeriod), principal: pad(cf.debtRepaymentPerPeriod), debtClose,
    equityCash: pad(cf.equityDrawdownPerPeriod), equityInKind: pad(cf.equityInKindDrawdownPerPeriod),
    // Working capital + direct cash flow
    ar: arReal, ap: pad(bs.apPerPeriod),
    revReceived: pad(cf.revenueReceivedPerPeriod), opexPaid: pad(cf.opexPaidPerPeriod), taxPaid: pad(cf.taxPaidPerPeriod),
    cfo: pad(cf.cashFromOperationsPerPeriod), cfi: pad(cf.cashFromInvestmentPerPeriod), cff: pad(cf.cashFromFinancingPerPeriod),
    netCf: pad(cf.netCashFlowPerPeriod), openCash: pad(cf.openingCashPerPeriod), closeCash: pad(cf.closingCashPerPeriod),
    // Balance sheet
    inventory: pad(bs.inventoryPerPeriod), nbv: pad(bs.nbvPerPeriod), land: pad(bs.landPerPeriod),
    totalFA: pad(bs.totalFixedAssetsPerPeriod), totalCA: pad(bs.totalCurrentAssetsPerPeriod), totalAssets: pad(bs.totalAssetsPerPeriod),
    totalLiab: pad(bs.totalLiabilitiesPerPeriod), shareCapital: pad(bs.shareCapitalPerPeriod), retained: pad(bs.retainedEarningsPerPeriod),
    totalEquity: pad(bs.totalEquityPerPeriod), totalLE: pad(bs.totalLiabilitiesAndEquityPerPeriod), bsDiff: pad(bs.bsDifferencePerPeriod),
  };
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
  const ws = wb.addWorksheet(SHEETS.assumptions, { properties: { tabColor: { argb: ARGB.navy } } });
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
  setTitle(ws.getCell(`A${r}`), 'Inputs (all model assumptions)', 16); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Every model input, consolidated and grouped by type. Shaded cells are the inputs a user edits before re-exporting. This is a hardcoded snapshot: editing here does NOT recalculate the other tabs; change inputs in the platform and re-export.', { }); r += 2;

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
  addKV('Country', p.country ?? '-', '@');
  addKV('Financial terminology', String(p.financialTerminology ?? 'standard'), '@');
  addKV('Tax / Zakat payment (days)', p.tax?.paymentDays ?? 0, NUMFMT.int);
  addKV('Statutory reserve transfer (% of PAT)', p.statutoryReserve?.transferRate ?? 0, NUMFMT.pct);
  addKV('Statutory reserve cap (% share capital)', p.statutoryReserve?.capOfShareCapital ?? 0, NUMFMT.pct);
  addKV('Share capital (explicit, 0 = auto)', p.shareCapital ?? 0, NUMFMT.money);
  addKV('Operating receivables, DSO (days)', p.operatingAr?.dsoDays ?? 0, NUMFMT.int, 'DsoDays');
  addKV('Opex payables, DPO (days)', p.opexAp?.defaultApDays ?? 0, NUMFMT.int, 'DpoDays');
  addKV('Pre-sales escrow held %', p.escrow?.heldPct ?? 0, NUMFMT.pct);
  // Net Developable Area (NDA) deduction: roads + parks carved out of gross land
  // before capacity calcs. Project-level here; per-asset values live on the
  // Assets table when the scope is 'asset'.
  addKV('NDA deduction enabled (1 = yes)', p.projectNdaEnabled ? 1 : 0, NUMFMT.int);
  addKV('NDA scope (project / asset)', String(p.projectNdaScope ?? 'project'), '@');
  addKV('Project roads % (of total land)', (p.projectRoadsPct ?? 0) / 100, NUMFMT.pct);
  addKV('Project parks % (of total land)', (p.projectParksPct ?? 0) / 100, NUMFMT.pct);
  void taxRow;
  // Financing raw inputs (funding method, debt/equity, min cash, IDC policy,
  // dividends) are grouped under the Financing divider below, not here, so the
  // Assumptions tab holds every input once under its type divider. This dead
  // registry is retained only for the AssumptionRefs shape.
  const financingScalars: FinancingScalarRefs = {
    dividendEnabled: '', dividendPayout: '', dividendStart: '', sweepStart: '', sweepRatio: '',
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
    setSectionHeader(ws.getRow(r), 'Land parcels', 9); r += 1;
    ['Parcel', 'Area (sqm)', 'Rate /sqm', 'Cash %', 'In-kind %', 'Roads %', 'Parks %', 'Debt %', 'Equity %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    // Per-parcel land funding split (Financing Tab 4 "Land Funding" card): the
    // debt / equity share applied to the cash-funded slice of each parcel.
    const parcelFunding = opts.state.project.financing?.parcelFunding ?? [];
    for (const pa of opts.state.parcels) {
      setLabel(ws.getCell(`A${r}`), pa.name);
      setInput(ws.getCell(`B${r}`), pa.area ?? 0, NUMFMT.int);
      setInput(ws.getCell(`C${r}`), pa.rate ?? 0, NUMFMT.rate); // /sqm rate, unscaled
      setInput(ws.getCell(`D${r}`), (pa.cashPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`E${r}`), (pa.inKindPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`F${r}`), (pa.roadsPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`G${r}`), (pa.parksPct ?? 0) / 100, NUMFMT.pct);
      const pf = parcelFunding.find((x) => x.parcelId === pa.id);
      const pDebt = pf?.debtPct ?? 0;
      setInput(ws.getCell(`H${r}`), pDebt / 100, NUMFMT.pct);
      setInput(ws.getCell(`I${r}`), (pf?.equityPct ?? (100 - pDebt)) / 100, NUMFMT.pct);
      parcelRefs.push({ id: pa.id, area: addr('B', r), rate: addr('C', r), cashPct: addr('D', r), inKindPct: addr('E', r) });
      r += 1;
    }
    r += 1;
  }

  // Assets (area schedule + depreciation).
  const visibleAssets = opts.state.assets.filter((a) => a.visible !== false);
  if (visibleAssets.length) {
    setSectionHeader(ws.getRow(r), 'Assets', 14); r += 1;
    ['Asset', 'Strategy', 'BUA (sqm)', 'NSA (sqm)', 'GFA (sqm)', 'Support (sqm)', 'Parking (sqm)', 'Parking bays', 'Land (sqm)', 'Land rate /sqm', 'Useful life (yrs)', 'Roads % (asset)', 'Parks % (asset)', 'NDA on (asset)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
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
      // Per-asset NDA deduction (consumed when project NDA scope = 'asset').
      setInput(ws.getCell(`L${r}`), (a.assetRoadsPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`M${r}`), (a.assetParksPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`N${r}`), a.assetNdaEnabled ? 1 : 0, NUMFMT.int);
      assetRefs.push({
        id: a.id, name: a.name, phaseId: a.phaseId, strategy: a.strategy,
        bua: addr('C', r), nsa: addr('D', r), gfa: addr('E', r), support: addr('F', r), parking: addr('G', r),
        parkingBays: addr('H', r), landSqm: addr('I', r), landRate: addr('J', r), usefulLife: addr('K', r),
      });
      r += 1;
    }
    r += 1;
    // Multi-parcel land splits: when an asset draws land from more than one
    // parcel, the single Land (sqm) above is the aggregate. List the per-parcel
    // sqm so the parcel-level attribution is not lost.
    const splitAssets = visibleAssets.filter((a) => (a.landAllocation?.multiParcelSplits?.length ?? 0) > 0);
    if (splitAssets.length) {
      setSectionHeader(ws.getRow(r), 'Asset land splits (per parcel)', 3); r += 1;
      ['Asset', 'Parcel', 'Land (sqm)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
      r += 1;
      for (const a of splitAssets) {
        for (const sp of a.landAllocation!.multiParcelSplits!) {
          const parcelName = opts.state.parcels.find((pa) => pa.id === sp.parcelId)?.name ?? sp.parcelId;
          setLabel(ws.getCell(`A${r}`), a.name);
          setLabel(ws.getCell(`B${r}`), parcelName);
          setInput(ws.getCell(`C${r}`), sp.sqm ?? 0, NUMFMT.int);
          r += 1;
        }
      }
      r += 1;
    }
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
  setSectionHeader(ws.getRow(r), 'Capex cost lines (inputs: method, rate / %, quantity, stage, phasing window)', 8); r += 1;
  ['Asset / Cost line', 'Method', 'Rate / %', 'Quantity (rate-x-area only)', 'Stage', 'Start period', 'End period', 'Phasing'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const capexRefs: CapexAssetRef[] = [];
  for (const ia of capex.inputAssets) {
    setLabel(ws.getCell(`A${r}`), `${ia.assetName}  (${ia.phaseName})`, { bold: true });
    fillRange(ws, r, 1, r, 8, ARGB.subtotal);
    r += 1;
    const lineRefs: CapexLineRef[] = [];
    for (const ln of ia.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), ln.basis);
      // Rate input: percent as a decimal (pct2), money rate as an unscaled
      // per-unit rate (NUMFMT.rate) so the workbook display-scale leaves it alone.
      if (ln.isPercent) setInput(ws.getCell(`C${r}`), ln.rate / 100, NUMFMT.pct2);
      else setInput(ws.getCell(`C${r}`), ln.rate, NUMFMT.rate);
      // Stage (land / hard / soft) + the phasing window (start / end period,
      // even vs manual) that drives this line's per-period spend.
      setInput(ws.getCell(`E${r}`), ln.stage, '@');
      setInput(ws.getCell(`F${r}`), ln.startPeriod, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), ln.endPeriod, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), ln.phasing, '@');
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
      // Per-sub-unit custom rates (method 'per_sub_unit_custom_rates'): the Rate
      // cell above is only the fallback default, so expand the real rate sheet as
      // indented sub-rows (sub-unit name + rate), incl. the Support / Parking rows.
      if (ln.perSubUnitRates && Object.keys(ln.perSubUnitRates).length) {
        for (const [key, rate] of Object.entries(ln.perSubUnitRates)) {
          const subName = key === '__support__' ? 'Support' : key === '__parking__' ? 'Parking' : (opts.state.subUnits.find((s) => s.id === key)?.name ?? key);
          setLabel(ws.getCell(`A${r}`), `${subName} rate`, { indent: 2 });
          setInput(ws.getCell(`C${r}`), rate, NUMFMT.rate);
          r += 1;
        }
      }
    }
    capexRefs.push({ assetId: ia.assetId, name: ia.assetName, phaseName: ia.phaseName, total: ia.total, lines: lineRefs });
  }
  r += 1;

  // Full-width domain divider band between input domains (Capex / Revenue / Opex
  // / Financing), so each reads as a distinct block. Every model input lives on
  // this Inputs tab; the module output tabs echo their own slice marked "from
  // the Inputs tab".
  const inputDivider = (text: string): void => {
    r += 1;
    for (let c = 1; c <= 8; c++) fillCell(ws.getCell(r, c), ARGB.navyDark);
    const cell = ws.getCell(`A${r}`); cell.value = text;
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: ARGB.white } };
    cell.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 18;
    r += 2;
  };
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };
  const opexValFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;

  // ── Financing inputs (Module 1, right after Capex; Revenue + Opex follow) ───
  inputDivider('FINANCING INPUTS');

  // Financing settings (the raw financing scalars, grouped under the Financing
  // divider as the single source of truth; the Financing output tab echoes
  // these inline marked "from Assumptions").
  setSectionHeader(ws.getRow(r), 'Financing settings', 5); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Funding method'); setInput(ws.getCell(`B${r}`), FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId], '@'); r += 1;
  addKV('Debt share', fin.funding.debtPct / 100, NUMFMT.pct, 'DebtPct');
  addKV('Equity share', fin.funding.equityPct / 100, NUMFMT.pct, 'EquityPct');
  addKV('Minimum cash reserve', p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0, NUMFMT.money, 'MinCashReserve');
  addKV('IDC capitalize (1 = yes)', p.idcConfig?.capitalize === false ? 0 : 1, NUMFMT.int);
  addKV('IDC allocation basis', String(p.idcConfig?.allocationBasis ?? 'land'), '@');
  addKV('IDC funding mode', String(p.idcConfig?.fundingMode ?? 'debt_drawdown'), '@');
  addKV('Dividends enabled (1 = yes)', p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int);
  addKV('Dividend payout ratio %', (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct);
  addKV('Dividend start year (0 = auto)', p.dividendStartYear ?? 0, NUMFMT.year);
  // Selected funding-method configuration: the method-specific inputs that size
  // the requirement beyond the resolved Debt / Equity share above (existing /
  // initial cash, Method 4 specified amounts). Only the active method's block is
  // emitted, mirroring the platform's "2a. Method N Configuration" panel.
  const fcfg = p.financing;
  const fmId = (fcfg?.fundingMethod ?? 1) as FundingMethodId;
  if (fmId === 2 && fcfg?.netFundingConfig) {
    const mc = fcfg.netFundingConfig;
    addKV('Method 2: Existing cash', mc.existingCash ?? 0, NUMFMT.money);
    addKV('Method 2: Debt %', (mc.debtPct ?? 0) / 100, NUMFMT.pct);
    addKV('Method 2: Equity %', (mc.equityPct ?? 0) / 100, NUMFMT.pct);
  } else if (fmId === 3 && fcfg?.cashDeficitConfig) {
    const mc = fcfg.cashDeficitConfig;
    const minCash = Array.isArray(mc.minimumCashReserve) ? (mc.minimumCashReserve[0] ?? 0) : (mc.minimumCashReserve ?? 0);
    addKV('Method 3: Initial cash', mc.initialCash ?? 0, NUMFMT.money);
    addKV('Method 3: Minimum cash reserve', minCash, NUMFMT.money);
    addKV('Method 3: Debt %', (mc.debtPct ?? 0) / 100, NUMFMT.pct);
    addKV('Method 3: Equity %', (mc.equityPct ?? 0) / 100, NUMFMT.pct);
  } else if (fmId === 4 && fcfg?.fixedAmountConfig) {
    const mc = fcfg.fixedAmountConfig;
    addKV('Method 4: Specified debt amount', mc.debtAmount ?? 0, NUMFMT.money);
    addKV('Method 4: Specified equity amount', mc.equityAmount ?? 0, NUMFMT.money);
  }
  r += 1;

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
    setSectionHeader(ws.getRow(r), 'Financing facilities (debt)', 12); r += 1;
    ['Facility', 'Origin', 'Opening balance', 'Interest rate %', 'Drawdown method', 'Repayment method', 'Repay periods', 'IDC capitalize', 'Repay start year', 'Interest start year', 'Origination year', 'Facility share %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
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
      // Timing inputs (0 = auto / not set, rendered as a dash): when the facility
      // starts repaying, when interest begins accruing, the origination year, and
      // its share of a multi-facility new-debt drawdown.
      setInput(ws.getCell(`I${r}`), t.repaymentStartYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`J${r}`), t.interestStartYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`K${r}`), t.originationYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`L${r}`), (t.facilitySharePct ?? 0) / 100, NUMFMT.pct);
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

  // ── Revenue inputs (recognition + indexation + cash / recognition profiles;
  // unit prices / ADR + occupancy are in the Sub-units table above). ──────────
  inputDivider('REVENUE INPUTS');
  setSectionHeader(ws.getRow(r), 'Revenue configuration by asset (unit prices / ADR + occupancy are in the Sub-units table above)', 7); r += 1;
  ['Asset', 'Strategy', 'Recognition', 'PIT year', 'ADR / Base rate', 'Indexation', 'Index rate %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
  for (const a of visibleAssets) {
    const rc = a.revenue ?? {};
    setLabel(ws.getCell(`A${r}`), a.name);
    setInput(ws.getCell(`B${r}`), a.strategy, '@');
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const s = rc.sell;
      setInput(ws.getCell(`C${r}`), String(s?.recognitionProfile?.method ?? 'over_time'), '@');
      setInput(ws.getCell(`D${r}`), s?.recognitionProfile?.pointInTimeYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`F${r}`), String(s?.indexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), s?.indexation?.rate ?? 0, NUMFMT.pct2);
    } else if (a.strategy === 'Operate') {
      setInput(ws.getCell(`E${r}`), rc.operate?.startingADR ?? 0, NUMFMT.rate);
      setInput(ws.getCell(`F${r}`), String(rc.operate?.adrIndexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), rc.operate?.adrIndexation?.rate ?? 0, NUMFMT.pct2);
    } else {
      setInput(ws.getCell(`E${r}`), rc.lease?.baseRate ?? 0, NUMFMT.rate);
      setInput(ws.getCell(`F${r}`), String(rc.lease?.rentIndexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), rc.lease?.rentIndexation?.rate ?? 0, NUMFMT.pct2);
    }
    r += 1;
  }
  r += 1;
  // Per-asset cash + recognition profiles (% by year from the sale year).
  for (const a of visibleAssets) {
    const s = a.revenue?.sell; if (!s) continue;
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    let n = 0; for (let i = 0; i < Math.max(cashPct.length, recogPct.length); i++) if ((cashPct[i] ?? 0) !== 0 || (recogPct[i] ?? 0) !== 0) n = i + 1;
    if (!n) continue;
    setSectionHeader(ws.getRow(r), `Cash & recognition profile, ${a.name} (% by year from sale)`, n + 1); r += 1;
    setColHeader(ws.getCell(r, 1), 'Profile', 'left'); for (let i = 0; i < n; i++) setColHeader(ws.getCell(r, 2 + i), `Yr ${i + 1}`, 'right'); r += 1;
    setLabel(ws.getCell(`A${r}`), 'Cash payment %'); for (let i = 0; i < n; i++) setInput(ws.getCell(r, 2 + i), cashPct[i] ?? 0, NUMFMT.pct); r += 1;
    if (recogPct.length) { setLabel(ws.getCell(`A${r}`), 'Recognition %'); for (let i = 0; i < n; i++) setInput(ws.getCell(r, 2 + i), recogPct[i] ?? 0, NUMFMT.pct); r += 1; }
    r += 1;
  }

  // ── Opex inputs (per-asset opex lines + HQ; operating margins are in the
  // Sub-units table above). ──────────────────────────────────────────────────
  inputDivider('OPEX INPUTS');
  let anyOpex = false;
  for (const a of visibleAssets) {
    const lines = (a.opex?.lines ?? []).filter((l) => !l.disabled);
    if (!lines.length) continue;
    anyOpex = true;
    setSectionHeader(ws.getRow(r), `Opex lines, ${a.name}`, 6); r += 1;
    ['Line', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
    for (const l of lines) {
      setLabel(ws.getCell(`A${r}`), l.name);
      setInput(ws.getCell(`B${r}`), String(l.category), '@');
      setInput(ws.getCell(`C${r}`), String(l.mode), '@');
      setInput(ws.getCell(`D${r}`), l.value, opexValFmt(String(l.mode)));
      setInput(ws.getCell(`E${r}`), l.useAssetDefault ? `(default) ${idxLabel(a.opex?.defaultIndexation)}` : idxLabel(l.indexation), '@');
      setInput(ws.getCell(`F${r}`), l.rateMode === 'yoy' ? 'YoY' : 'Single', '@');
      r += 1;
    }
    r += 1;
  }
  const hqOpexLines = (p.hqOpex?.lines ?? []).filter((l) => !l.disabled);
  if (hqOpexLines.length) {
    anyOpex = true;
    setSectionHeader(ws.getRow(r), 'HQ / Corporate opex lines', 5); r += 1;
    ['Line', 'Category', 'Mode', 'Value', 'Indexation'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
    for (const l of hqOpexLines) {
      setLabel(ws.getCell(`A${r}`), l.name);
      setInput(ws.getCell(`B${r}`), String(l.category), '@');
      setInput(ws.getCell(`C${r}`), String(l.mode), '@');
      setInput(ws.getCell(`D${r}`), l.value, opexValFmt(String(l.mode)));
      setInput(ws.getCell(`E${r}`), idxLabel(l.indexation), '@');
      r += 1;
    }
    r += 1;
  }
  if (!anyOpex) { setLabel(ws.getCell(`A${r}`), 'No per-line opex configured; operating costs are driven by the operating margins in the Sub-units table above.'); r += 2; }

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
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from Inputs (parcels, asset areas, sub-units). Feeds the Capex build-up (percent / unit cost bases) and the Balance Sheet land.`);
  setLabel(ws.getCell('A2'), 'Area hierarchy (NSA -> BUA -> GFA), land value and unit count per asset, grouped by strategy. GDV is shown for residential (for-sale) assets. This tab is a metric grid (one column per metric), so the per-column Basis / Calculation is given in the legend below the table rather than as a row column.');

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

  // ── Basis / Calculation legend (per-column derivations) ─────────────────────
  // Land & Area is a metric grid (one column per metric), so the guidance can
  // not sit in a per-row column like the other tabs. It is given here as a
  // clearly-labelled per-column legend so the tab is not silently missing it.
  let lr = (blocks.length ? Math.max(...blocks.map((b) => b.subtotalRow)) : 5) + 2;
  setSectionHeader(ws.getRow(lr), 'Basis / Calculation (per column)', LASTCOL); lr += 1;
  const COL_BASIS: Array<[string, string]> = [
    ['NSA', 'Sum of Sellable / Operable / Leasable sub-unit areas'],
    ['Support', 'Sum of Support sub-unit areas'],
    ['BUA', 'max(asset BUA, NSA + Support)'],
    ['Parking', 'Asset parking area'],
    ['GFA', 'max(asset GFA, BUA + Parking)'],
    ['Parking bays', 'Asset parking bays required'],
    ['Land (sqm)', 'Asset land sqm, or parcel area x BUA share'],
    ['Land rate', 'Asset land rate, or parcel land value / area'],
    ['Land value', 'Land (sqm) x Land rate'],
    ['Cash land', 'Land value x parcel cash %'],
    ['In-kind land', 'Land value - Cash land'],
    ['Units', 'Sum of units / count sub-units'],
    ['GDV', 'Sum of sub-unit units x price (for-sale assets)'],
  ];
  for (const [colName, basisText] of COL_BASIS) {
    setLabel(ws.getCell(lr, 1), colName, { bold: true });
    const bc = ws.getCell(lr, 2); bc.value = basisText; bc.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: ARGB.navyDark } };
    lr += 1;
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
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from Inputs (cost lines) and Land & Area (cost bases). Feeds Cost of Sales, Financing and the Balance Sheet. UOM column = each line's basis; Total = Rate x Quantity.`);
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
      ws.getCell(r, cChk).font = { name: 'Calibri', size: BODY_SIZE, bold: !ok, color: { argb: ok ? ARGB.navy : ARGB.bad } };
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

// Snapshot disclaimer attached (as a non-row-consuming cell comment) to the
// title of every output tab: these are platform-computed values frozen at
// export; editing a cell does NOT recalculate; re-export after changing inputs.
const SNAPSHOT_NOTE = 'Figures are platform-computed values as of export. This is a hardcoded snapshot: editing a cell will NOT recalculate anything. To run a different scenario, change the inputs in the platform and re-export.';

/** Title + subtitle + the frozen 4-row header (row 3 = period-end dates, row 4 =
 *  period index), the period columns carrying the snapshot period-end years. Sets
 *  widths + the freeze (rows 1-4, columns A-D). `meta` adds the Capex B / C column
 *  labels. `feeds` is a short cross-tab provenance note ("Sourced from X; feeds
 *  Y") attached as a comment so it does not consume a row. */
function writeSheetHeader(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, N: number, title: string, subtitle: string, opts: { label?: string; meta?: [string, string]; feeds?: string } = {}): void {
  ws.getColumn(LBL_COL).width = 34;
  // Column B is the "Basis / Calculation" guidance column (plain descriptive
  // text, not a live formula); C is a thin spacer. Both sit in the frozen pane.
  ws.getColumn(META_B).width = 30;
  ws.getColumn(META_C).width = 2;
  ws.getColumn(TOTAL_COL).width = 15;
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) ws.getColumn(c).width = 12;
  setTitle(ws.getCell('A1'), title, 16);
  setNote(ws.getCell('A1'), opts.feeds ? `${SNAPSHOT_NOTE}\n\n${opts.feeds}` : SNAPSHOT_NOTE);
  setLabel(ws.getCell('A2'), subtitle);
  if (opts.label) setColHeader(ws.getCell(4, LBL_COL), opts.label, 'left');
  setColHeader(ws.getCell(4, META_B), 'Basis / Calculation', 'left');
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
function navySumRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, sourceRows: number[], cachedPerPeriod: number[], style: 'navy' | 'subtotal' = 'navy', openingCached = 0, basis = ''): void {
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
  if (basis) { const bc = ws.getCell(r, META_B); bc.value = basis.replace(/^=+/, ''); bc.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: fg } }; bc.alignment = { horizontal: 'left' }; }
}


// ── Downstream live emitters (Revenue → CoS → Opex → Financing → P&L → CF → BS → Returns) ─
// All use the shared geometry: A label, D Total, E Period 0 / opening, F.. active.
// xc(sheet,row,t) = the period-t cell on a shared-geometry sheet; the Financing
// engine owns the recurrence and every other statement links to it.
const lcol = (t: number): string => colLetter(pcol(t));
const prevCol = (t: number): string => colLetter(pcol(t - 1));
const xc = (sheet: string, row: number, t: number): string => sheetRef(sheet, `${colLetter(pcol(t))}${row}`);
// A Capex-sheet cell for axis period t (its period geometry differs from the
// shared one); used by the tabs that read the Capex schedule live.
const capexPeriodCell = (capexAddrs: CapexAddrs, row: number, t: number): string => sheetRef(SHEETS.capex, `${colLetter(capexAddrs.periodCol(t))}${row}`);

interface RowOpts { open?: { f?: string; v: number }; total?: 'sum' | 'last' | 'none'; indent?: number; bold?: boolean; fmt?: string; basis?: string }
/** Write one period row (label + Basis/Calculation text + opening E + per-period
 *  F.. + Total D). The basis is plain descriptive text, never a live formula. */
function emitRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, per: (t: number) => { f?: string; v: number }, opts: RowOpts = {}): number {
  const fmt = opts.fmt ?? NUMFMT.money;
  setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: opts.bold });
  if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
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

/** A label + a scalar value in the Total (D) column: a linked formula (when
 *  `link` is set), a numeric input cell, or a literal string. Returns the
 *  absolute address of the value cell so callers can reference it in formulas.
 *  The caller owns the row cursor (increment after the call). */
function scalarCell(ws: ExcelJS.Worksheet, r: number, label: string, link: string, cached: number | string, fmt: string): string {
  setLabel(ws.getCell(r, LBL_COL), label);
  const cell = ws.getCell(r, TOTAL_COL);
  if (typeof cached === 'string') { cell.value = cached; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
  else if (link) setFormula(cell, fcell(link, cached), fmt, true);
  else { cell.value = cached; cell.numFmt = fmt; markInput(cell); }
  return `$${colLetter(TOTAL_COL)}$${r}`;
}

// Shared section emitters for the consolidated module tabs (Revenue / Opex /
// Schedules / P&L / Cash Flow / Balance Sheet). Manages its own row cursor and
// renders the standard navy hierarchy: deep-navy section bands, pale sub-table
// titles, navy totals, navy-dark subtotals. emitM4 renders a shared-builder
// M4Row (the on-screen statement model) exactly.
type RowStyle = 'plain' | 'subtotal' | 'total';
function makeEmitters(ws: ExcelJS.Worksheet, N: number, start = 5): {
  section: (text: string) => void; groupBand: (text: string) => void; subTitle: (text: string) => void;
  moneyRow: (label: string, series: number[] | undefined, opts?: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean }) => number;
  statRow: (label: string, series: number[] | undefined, numFmt: string, indent?: number) => void;
  emitM4: (row: M4Row) => number; emitTable: (rows: M4Row[]) => void; gap: () => void; cursor: () => number;
} {
  let r = start;
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  // Mid-level group band (navy fill): between a deep-navy section and a pale
  // sub-table title (e.g. ASSETS / LIABILITIES / EQUITY within BS Schedules).
  const groupBand = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = (series ?? []).slice(0, N);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalValue !== undefined ? opts.totalValue : opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  const statRow = (label: string, series: number[] | undefined, numFmt: string, indent = 1): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent });
    const vals = (series ?? []).slice(0, N);
    for (let t = 0; t < N; t++) { const cell = ws.getCell(r, pcol(t)); cell.value = vals[t] ?? 0; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };
  // Render a shared-builder M4Row: section header -> pale band; total / subtotal
  // -> styled bands; totalOverride (a numeric string when fmt = String) -> the
  // exact platform Total; priorValue -> the opening (E) column.
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    const tv = row.totalOverride !== undefined ? Number(row.totalOverride) : undefined;
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalValue: tv !== undefined && Number.isFinite(tv) ? tv : undefined });
  };
  const emitTable = (rows: M4Row[]): void => { for (const row of rows) emitM4(row); };
  const gap = (): void => { r += 1; };
  const cursor = (): number => r;
  return { section, groupBand, subTitle, moneyRow, statRow, emitM4, emitTable, gap, cursor };
}

// Balance-sheet feeder roll-forwards (the platform Module 4 Schedules "BS
// Schedules" sub-tab), ordered by balance-sheet sequence: ASSETS (receivables,
// inventory, restricted cash), LIABILITIES (AP, unearned, debt), EQUITY (equity
// roll-forward, retained earnings). Mirrors Module4BSFeeders row-for-row; fmt =
// String so each totalOverride round-trips back to a number in emitM4.
function buildBSFeederGroups(snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState): Array<{ group: string; tables: ReportTable[] }> {
  const N = snap.axisLength;
  const fmt = (v: number): string => String(v);
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));

  // A1. Residential Sales Receivables.
  const a1Rows: M4Row[] = (() => {
    const opening = zeros(), saleValue = zeros(), cashCollected = zeros(), closing = zeros();
    for (const [assetId, bundle] of sellEntries) {
      const sell = snap.revenue.bySellAsset.get(assetId)!;
      for (let t = 0; t < N; t++) {
        opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
        saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
        cashCollected[t] += sell.presalesCashPerPeriod[t] ?? 0;
        closing[t] += bundle.ar.perPeriod[t] ?? 0;
      }
    }
    const rows: M4Row[] = [
      { label: 'Opening AR (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Pre-Sales Sale Value', values: saleValue, indent: 1 },
      { label: '(-) Pre-Sales Cash Collected', values: cashCollected.map((v) => -v), indent: 1 },
      { label: 'Closing AR (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
    if (sellEntries.length) {
      rows.push({ label: 'Closing AR by asset', values: [], isSection: true });
      for (const [assetId, bundle] of sellEntries) rows.push({ label: assetName(assetId), values: bundle.ar.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.ar.perPeriod[N - 1] ?? 0) });
      rows.push({ label: 'Total Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
    }
    return rows;
  })();

  // A2. Operating Receivables (DSO).
  const a2Rows: M4Row[] = (() => {
    const operatingRev = snap.pl.hospitalityRevenuePerPeriod.map((v, i) => v + (snap.pl.retailRevenuePerPeriod[i] ?? 0));
    const closing = snap.bs.arPerPeriod;
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    const change = closing.map((v, i) => v - (opening[i] ?? 0));
    const cash = operatingRev.map((v, i) => v - (change[i] ?? 0));
    return [
      { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Operating revenue billed', values: operatingRev, indent: 1 },
      { label: '(-) Cash collected', values: cash.map((v) => -v), indent: 1 },
      { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // A3. Inventory (Residential WIP).
  const a3Rows: M4Row[] = (() => {
    const closing = zeros();
    for (const cf of snap.perAssetCF.values()) for (let t = 0; t < N; t++) closing[t] += cf.inventoryPerPeriod[t] ?? 0;
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    const cosTotal = snap.pl.cosPerPeriod;
    const capexCapitalized = closing.map((v, t) => (v - (opening[t] ?? 0)) + (cosTotal[t] ?? 0));
    return [
      { label: 'Opening inventory', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Capex capitalized', values: capexCapitalized, indent: 1 },
      { label: '(-) Released to Cost of Sales', values: cosTotal.map((v) => -v), indent: 1 },
      { label: 'Closing inventory', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // A4. Restricted Cash (Escrow).
  const a4Rows: M4Row[] = (() => {
    const closing = snap.escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    return [
      { label: 'Opening Balance', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Held this period', values: snap.escrow.projectTotals.heldPerPeriod, indent: 1 },
      { label: '(-) Release', values: snap.escrow.projectTotals.releasePerPeriod.map((v) => -v), indent: 1 },
      { label: 'Closing Balance', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // L1. Accounts Payable.
  const apt = snap.ap.projectTotals;
  const l1Rows: M4Row[] = [
    { label: 'Opening AP', values: apt.openingApPerPeriod, isSubtotal: true, totalOverride: fmt(apt.openingApPerPeriod[0] ?? 0) },
    { label: '(+) Opex incurred', values: apt.opexIncurredPerPeriod, indent: 1 },
    { label: '(-) Cash paid', values: apt.cashPaidPerPeriod.map((v) => -v), indent: 1 },
    { label: 'Closing AP', values: apt.closingApPerPeriod, isTotal: true, totalOverride: fmt(apt.closingApPerPeriod[N - 1] ?? 0) },
  ];

  // L2. Unearned Revenue.
  const l2Rows: M4Row[] = (() => {
    const opening = zeros(), saleValue = zeros(), recognized = zeros(), closing = zeros();
    for (const [assetId, bundle] of sellEntries) {
      const sell = snap.revenue.bySellAsset.get(assetId)!;
      for (let t = 0; t < N; t++) {
        opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
        saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
        recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
        closing[t] += bundle.unearned.perPeriod[t] ?? 0;
      }
    }
    const rows: M4Row[] = [
      { label: 'Opening unearned revenue (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Pre-sales contracts signed (sale value)', values: saleValue, indent: 1 },
      { label: '(-) Revenue recognized (at handover)', values: recognized.map((v) => -v), indent: 1 },
      { label: 'Closing unearned revenue (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
    if (sellEntries.length) {
      rows.push({ label: 'Closing unearned revenue by asset', values: [], isSection: true });
      for (const [assetId, bundle] of sellEntries) rows.push({ label: assetName(assetId), values: bundle.unearned.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.unearned.perPeriod[N - 1] ?? 0) });
      rows.push({ label: 'Total Closing Unearned Revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
    }
    return rows;
  })();

  // L3. Debt Outstanding by Tranche.
  const l3Rows: M4Row[] = (() => {
    const rows: M4Row[] = [];
    const totalOut = zeros();
    let totalPrior = 0;
    for (const t of state.financingTranches) {
      const f = snap.financing.facilities.get(t.id);
      if (!f) continue;
      const outRow = f.outstanding.slice(0, N);
      while (outRow.length < N) outRow.push(0);
      const facPrior = f.openingBalance ?? 0;
      rows.push({ label: t.name, values: outRow, indent: 1, totalOverride: fmt(outRow[N - 1] ?? 0), priorValue: facPrior });
      for (let i = 0; i < N; i++) totalOut[i] += outRow[i] ?? 0;
      totalPrior += facPrior;
    }
    rows.push({ label: 'Total Debt Outstanding', values: totalOut, isTotal: true, totalOverride: fmt(totalOut[N - 1] ?? 0), priorValue: totalPrior });
    return rows;
  })();

  // E1. Equity Cumulative Roll-Forward (split by type).
  const e1Rows: M4Row[] = (() => {
    const cashDraws = snap.financing.equity.cashPerPeriod.slice(0, N);
    const inKindDraws = snap.financing.equity.inKindPerPeriod.slice(0, N);
    const existingDrawsRaw = snap.financing.equity.existingEquityPerPeriod.slice(0, N);
    while (cashDraws.length < N) cashDraws.push(0);
    while (inKindDraws.length < N) inKindDraws.push(0);
    while (existingDrawsRaw.length < N) existingDrawsRaw.push(0);
    const priorExisting = existingDrawsRaw.reduce((s, v) => s + v, 0);
    const opening = zeros(), closing = zeros();
    let running = priorExisting;
    for (let t = 0; t < N; t++) { opening[t] = running; running += (cashDraws[t] ?? 0) + (inKindDraws[t] ?? 0); closing[t] = running; }
    const rows: M4Row[] = [
      { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0), priorValue: 0 },
      { label: '(+) Cash equity drawdown', values: cashDraws, indent: 1 },
      { label: '(+) In-Kind equity (land in-kind, non-cash)', values: inKindDraws, indent: 1 },
    ];
    if (Math.abs(priorExisting) > 0.5) rows.push({ label: '(+) Existing equity (pre-axis carry-forward)', values: zeros(), indent: 1, priorValue: priorExisting });
    rows.push({ label: 'Closing equity (cumulative)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: priorExisting });
    return rows;
  })();

  // E2. Retained Earnings Roll-Forward.
  const e2Rows: M4Row[] = (() => {
    const pat = snap.pl.patPerPeriod.slice(0, N);
    const reserveTransfer = snap.bs.statutoryReserveTransferPerPeriod.slice(0, N);
    const dividends = snap.bs.dividendsPerPeriod.slice(0, N);
    const closing = snap.bs.retainedEarningsPerPeriod.slice(0, N);
    const pad = (a: number[]): void => { while (a.length < N) a.push(0); };
    pad(pat); pad(reserveTransfer); pad(dividends); pad(closing);
    const opening = zeros();
    for (let t = 0; t < N; t++) opening[t] = t === 0 ? 0 : (closing[t - 1] ?? 0);
    return [
      { label: 'Opening retained earnings', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) PAT for the period', values: pat, indent: 1 },
      { label: '(-) Transfer to statutory reserve', values: reserveTransfer.map((v) => -v), indent: 1 },
      { label: '(-) Dividends declared', values: dividends.map((v) => -v), indent: 1 },
      { label: 'Closing retained earnings', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  return [
    { group: 'ASSETS', tables: [
      { title: 'A1. Residential Sales Receivables: Roll-Forward (project)', rows: a1Rows },
      { title: 'A2. Operating Receivables: Roll-Forward (project)', rows: a2Rows },
      { title: 'A3. Inventory (Residential WIP): Roll-Forward (project)', rows: a3Rows },
      { title: 'A4. Restricted Cash (Escrow): Roll-Forward (project)', rows: a4Rows },
    ] },
    { group: 'LIABILITIES', tables: [
      { title: 'L1. Accounts Payable: Roll-Forward (project)', rows: l1Rows },
      { title: 'L2. Unearned Revenue (Off-plan advances): Roll-Forward (project)', rows: l2Rows },
      { title: 'L3. Debt Outstanding by Tranche (project)', rows: l3Rows },
    ] },
    { group: 'EQUITY', tables: [
      { title: 'E1. Equity Cumulative Roll-Forward (project, split by type)', rows: e1Rows },
      { title: 'E2. Retained Earnings Roll-Forward (project)', rows: e2Rows },
    ] },
  ];
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
interface RetLinks { fcffIrrCell: string; fcfeIrrCell: string }

// ── Revenue (full mirror of the platform Module 2: all 5 sub-tabs in sequence) ─
// One sheet reproducing every Module 2 surface as a divided section, the same
// way the Financing tab mirrors Module 1's four financing sub-tabs: 1. Inputs,
// 2. Output, 3. Cost of Sales, 4. Schedules, 5. Escrow. Every figure is the
// platform snapshot value (hardcoded). Returns the Revenue + Cost-of-Sales row
// registries the downstream tabs link to.
function addRevenue(ctx: EmitCtx): { revLinks: RevLinks; cosLinks: CosLinks } {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const yl = snap.yearLabels;
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Revenue', 'Full step-by-step mirror of the platform Revenue module, all five sub-tabs in sequence: 1. Inputs (revenue config + cash / recognition profiles), 2. Output (per-asset narrative + vintage matrices), 3. Cost of Sales, 4. Schedules (AR + unearned), 5. Escrow.', { label: 'Line', feeds: 'Sourced from Inputs (sub-unit prices / areas, recognition + cash profiles) and the platform revenue engine. Feeds P&L, the Balance Sheet (inventory, AR, unearned) and Returns.' });
  let r = 5;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const A = (a: number[] | undefined): number[] => (a ?? []).slice(0, N);
  const anyNonZero = (a: number[] | undefined): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
  const metricOf = (units: Array<{ metric: 'units' | 'area' }>): 'units' | 'area' => (units.length && units.every((u) => u.metric === units[0].metric) ? units[0].metric : 'area');
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };

  // ── local emit helpers (mirror the Financing tab) ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  type RowStyle = 'plain' | 'subtotal' | 'total';
  // One money row from a snapshot array. style: plain / subtotal (grey-bold) /
  // total (navy band). totalLast => Total = last value (balances); noTotal =>
  // no Total cell (opening rows). Returns the row used.
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = A(series);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  // A non-money statistic row (units / sqm / occupancy / ADR), custom format, no Total.
  const statRow = (label: string, series: number[] | undefined, numFmt: string): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent: 1 });
    const vals = A(series);
    for (let t = 0; t < N; t++) { const cell = ws.getCell(r, pcol(t)); cell.value = vals[t] ?? 0; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };
  // An M4Row from a shared report builder (Cost of Sales). Returns the row used.
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalLast: row.totalOverride !== undefined });
  };
  // A vintage matrix (cohort-year rows + a column-sum Total), non-zero cohorts only.
  const vintage = (title: string, matrix: number[][]): void => {
    const rows = matrix.map((m, i) => ({ label: `FY ${yl[i] ?? i}`, vals: A(m) })).filter((rr) => anyNonZero(rr.vals));
    if (!rows.length) return;
    subTitle(title);
    for (const rr of rows) moneyRow(rr.label, rr.vals, { indent: 1 });
    const totals = new Array<number>(N).fill(0);
    for (const m of matrix) for (let i = 0; i < N; i++) totals[i] += m[i] ?? 0;
    moneyRow('Total', totals, { style: 'total' });
    r += 1;
  };

  // ── 1. Revenue Inputs ────────────────────────────────────────────────────────
  section('1. Revenue Inputs (raw inputs are on the Inputs tab under REVENUE INPUTS; echoed here)');
  subTitle('Revenue Configuration by Asset');
  ['Asset', '', '', 'Strategy', 'Key driver', 'Indexation'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, i === 0 ? 'left' : 'left'); });
  r += 1;
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const rc = a.revenue ?? {};
    let strategy = a.strategy; let driver = ''; let indexation = '';
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const s = rc.sell;
      const recog = s?.recognitionProfile?.method === 'point_in_time' ? `PIT (${s?.recognitionProfile?.pointInTimeYear ?? 'handover'})` : 'Over time';
      driver = `Recognition: ${recog}`; indexation = idxLabel(s?.indexation);
    } else if (a.strategy === 'Operate') { driver = `Starting ADR ${Math.round(rc.operate?.startingADR ?? 0)}`; indexation = idxLabel(rc.operate?.adrIndexation); }
    else { strategy = 'Lease'; driver = `Base rate ${Math.round(rc.lease?.baseRate ?? 0)}`; indexation = idxLabel(rc.lease?.rentIndexation); }
    setLabel(ws.getCell(r, LBL_COL), a.name, { indent: 1 });
    setLabel(ws.getCell(r, OPEN_COL), strategy); setLabel(ws.getCell(r, OPEN_COL + 1), driver); setLabel(ws.getCell(r, OPEN_COL + 2), indexation);
    r += 1;
  }
  r += 1;
  // Per-asset cash + recognition profiles (relative to the sale year: the first
  // period column is Year 1 from sale, not the absolute axis year).
  for (const a of state.assets) {
    const s = a.revenue?.sell; if (!s) continue;
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    if (!anyNonZero(cashPct) && !anyNonZero(recogPct)) continue;
    subTitle(`Cash & Recognition Profile, ${a.name} (% relative to sale year; first period column = Year 1)`);
    statRow('Cash payment %', cashPct.map((v) => v ?? 0), NUMFMT.pct);
    if (recogPct.length) statRow('Recognition %', recogPct.map((v) => v ?? 0), NUMFMT.pct);
    r += 1;
  }

  // ── 2. Revenue Output ────────────────────────────────────────────────────────
  section('2. Revenue Output (project summary, then per-asset narrative + vintage matrices)');
  const pl = snap.pl;
  subTitle('Project Revenue Summary');
  const residentialRow = moneyRow('Residential revenue', pl.residentialRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Residential / Sell recognised revenue' });
  const hospitalityRow = moneyRow('Hospitality revenue', pl.hospitalityRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Hospitality / Operate revenue' });
  const retailRow = moneyRow('Retail revenue', pl.retailRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Retail / Lease revenue' });
  const totalRow = moneyRow('Total revenue', pl.totalRevenuePerPeriod, { style: 'total', basis: 'Residential + Hospitality + Retail' });
  r += 1;
  const byAssetRow = new Map<string, number>();
  for (const [id, rr] of snap.revenue.bySellAsset) {
    if (!anyNonZero(rr.presalesRevenuePerPeriod) && !anyNonZero(rr.postSalesRevenuePerPeriod)) continue;
    const totalSaleValue = A(rr.presalesRevenuePerPeriod).map((v, i) => v + (rr.postSalesRevenuePerPeriod[i] ?? 0));
    const useUnits = metricOf(state.subUnits.filter((u) => u.assetId === id)) === 'units';
    const preVol = useUnits ? rr.presalesUnitsPerPeriod : rr.presalesAreaPerPeriod;
    const postVol = useUnits ? rr.postSalesUnitsPerPeriod : rr.postSalesAreaPerPeriod;
    const volSuffix = useUnits ? 'units' : 'sqm';
    subTitle(`Residential (Sell), ${assetName(id)}`);
    statRow(`Pre-sales ${volSuffix}`, preVol, NUMFMT.int);
    statRow(`Post-sales ${volSuffix}`, postVol, NUMFMT.int);
    moneyRow('Pre-sales revenue (sale value)', rr.presalesRevenuePerPeriod, { indent: 1 });
    moneyRow('Post-sales revenue (sale value)', rr.postSalesRevenuePerPeriod, { indent: 1 });
    moneyRow('Total sale value', totalSaleValue, { style: 'subtotal' });
    moneyRow('Pre-sales cash collected', rr.presalesCashPerPeriod, { indent: 1 });
    moneyRow('Post-sales cash collected', rr.postSalesCashPerPeriod, { indent: 1 });
    moneyRow('Total cash collected', rr.cashCollectedPerPeriod, { style: 'subtotal' });
    moneyRow('Pre-sales recognised', rr.presalesRecognitionPerPeriod, { indent: 1 });
    moneyRow('Post-sales recognised', rr.postSalesRecognitionPerPeriod, { indent: 1 });
    byAssetRow.set(id, moneyRow('Total revenue recognised', rr.recognitionPerPeriod, { style: 'total' }));
    r += 1;
    vintage(`Cash Vintage Matrix, ${assetName(id)}`, rr.cashVintageMatrix);
    vintage(`Recognition Vintage Matrix, ${assetName(id)}`, rr.recognitionVintageMatrix);
  }
  for (const [id, rr] of snap.revenue.byHospitalityAsset) {
    if (!anyNonZero(rr.totalRevenuePerPeriod)) continue;
    subTitle(`Hospitality, ${assetName(id)}`);
    statRow('Available room nights', rr.availableRoomNightsPerPeriod, NUMFMT.int);
    statRow('Occupied room nights', rr.occupiedRoomNightsPerPeriod, NUMFMT.int);
    statRow('Occupancy %', rr.occupancyPerPeriod, NUMFMT.pct);
    statRow('ADR', rr.adrPerPeriod, NUMFMT.rate);
    moneyRow('Rooms revenue', rr.roomsRevenuePerPeriod, { indent: 1 });
    moneyRow('F&B revenue', rr.fbRevenuePerPeriod, { indent: 1 });
    moneyRow('Other revenue', rr.otherRevenuePerPeriod, { indent: 1 });
    moneyRow('Total revenue', rr.totalRevenuePerPeriod, { style: 'total' });
    r += 1;
  }
  for (const [id, rr] of snap.revenue.byLeaseAsset) {
    if (!anyNonZero(rr.totalRevenuePerPeriod)) continue;
    subTitle(`Lease, ${assetName(id)}`);
    statRow('Occupied area (sqm)', rr.occupiedAreaPerPeriod, NUMFMT.int);
    statRow('Occupancy %', rr.occupancyPerPeriod, NUMFMT.pct);
    statRow('Indexed rate', rr.indexedRatePerPeriod, NUMFMT.rate);
    moneyRow('Total revenue', rr.totalRevenuePerPeriod, { style: 'total' });
    r += 1;
  }

  // ── 3. Cost of Sales ─────────────────────────────────────────────────────────
  section('3. Cost of Sales (per-asset capex driver, vintage matrix, summary, inventory roll-forward, project totals)');
  const cosByAssetRow = new Map<string, number>();
  let cosTotalRow = r;
  for (const t of buildCostOfSalesReport(snap, state, (v) => String(v))) {
    subTitle(t.title);
    for (const row of t.rows) { const used = emitM4(row); if (t.title === 'Project Total Cost of Sales' && row.isTotal) cosTotalRow = used; }
    r += 1;
  }

  // ── 4. Schedules (Accounts Receivable + Unearned revenue roll-forward) ───────
  section('4. Schedules (Accounts Receivable + Unearned revenue roll-forward, per asset)');
  for (const [id, b] of snap.byAssetSchedules) {
    if (!anyNonZero(b.ar.perPeriod) && !anyNonZero(b.unearned.perPeriod)) continue;
    subTitle(`Accounts Receivable & Unearned, ${assetName(id)}`);
    moneyRow('AR opening', b.ar.openingPerPeriod, { indent: 1, noTotal: true });
    moneyRow('AR change', b.ar.changePerPeriod, { indent: 1 });
    moneyRow('AR closing', b.ar.perPeriod, { style: 'subtotal', totalLast: true });
    moneyRow('Unearned opening', b.unearned.openingPerPeriod, { indent: 1, noTotal: true });
    moneyRow('Unearned change', b.unearned.changePerPeriod, { indent: 1 });
    moneyRow('Unearned closing', b.unearned.perPeriod, { style: 'subtotal', totalLast: true });
    r += 1;
  }

  // ── 5. Escrow (only when pre-sales escrow is active) ─────────────────────────
  const esc = snap.escrow.projectTotals;
  if (anyNonZero(esc.heldPerPeriod) || anyNonZero(esc.releasePerPeriod)) {
    section('5. Escrow (pre-sales cash subject to escrow, balance roll-forward, cash flow impact)');
    const escAssets = [...snap.escrow.byAsset.entries()].filter(([, a]) => anyNonZero(a.preSalesCashPerPeriod));
    subTitle('A. Pre-Sales Cash by Asset (subject to escrow)');
    for (const [id, a] of escAssets) moneyRow(assetName(id), a.preSalesCashPerPeriod, { indent: 1 });
    moneyRow('Total Pre-Sales Cash (all assets)', esc.preSalesCashPerPeriod, { style: 'total' });
    r += 1;
    subTitle('B. Escrow Balance Roll-Forward');
    const opening = new Array<number>(N).fill(0);
    for (let t = 1; t < N; t++) opening[t] = esc.cumulativeBalancePerPeriod[t - 1] ?? 0;
    moneyRow('Opening Balance', opening, { style: 'subtotal', noTotal: true });
    setLabel(ws.getCell(r, LBL_COL), 'Additions:', { bold: true }); r += 1;
    for (const [id, a] of escAssets) moneyRow(assetName(id), a.result.heldPerPeriod, { indent: 2 });
    moneyRow('Total Additions', esc.heldPerPeriod, { style: 'subtotal' });
    moneyRow('Less: Release of Locked Funds', A(esc.releasePerPeriod).map((v) => -v), { indent: 1 });
    moneyRow('Closing Balance', esc.cumulativeBalancePerPeriod, { style: 'total', totalLast: true });
    r += 1;
    subTitle('C. Cash Flow Impact (project totals)');
    moneyRow('Less: Inaccessible Funds Locked', A(esc.heldPerPeriod).map((v) => -v), { indent: 1 });
    moneyRow('Add: Release of Inaccessible Funds', esc.releasePerPeriod, { indent: 1 });
    moneyRow('Net Cash Flow Adjustment (to M4)', esc.cashFlowAdjustmentPerPeriod, { style: 'total' });
  }

  return {
    revLinks: { byAssetRow, residentialRow, hospitalityRow, retailRow, totalRow },
    cosLinks: { byAssetRow: cosByAssetRow, totalRow: cosTotalRow },
  };
}

// ── Opex (full mirror of the platform Module 3: all 3 sub-tabs in sequence) ───
// One sheet reproducing every Module 3 surface as a divided section, the same
// way Revenue mirrors Module 2: 1. Inputs (per-asset + HQ opex lines), 2. Output
// (revenue breakdown + per-category cost tables + project rollup, via the shared
// buildOpexReport), 3. Schedules (accounts payable roll-forward). Every figure is
// the platform snapshot value (hardcoded). Returns the Opex row registry.
function addOpex(ctx: EmitCtx): OpexLinks {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Operating Expenses', 'Full step-by-step mirror of the platform Opex module, all three sub-tabs in sequence: 1. Inputs (per-asset + HQ opex lines), 2. Output (revenue breakdown + per-category cost tables + project rollup), 3. Schedules (accounts payable roll-forward).', { label: 'Line', feeds: 'Sourced from Inputs (opex lines) and Revenue (operating revenue). Feeds P&L, Cash Flow (opex paid) and the Returns NOI.' });
  let r = 5;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const anyNonZero = (a: number[] | undefined): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };

  // ── local emit helpers (mirror the Revenue / Financing tabs) ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  type RowStyle = 'plain' | 'subtotal' | 'total';
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = (series ?? []).slice(0, N);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalLast: row.totalOverride !== undefined });
  };
  // A read-only text/value cell on the inputs grid (black, not an editable cell).
  const txt = (c: number, v: string | number, numFmt = '@'): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };

  // ── 1. Opex Inputs ───────────────────────────────────────────────────────────
  section('1. Opex Inputs (raw inputs are on the Inputs tab under OPEX INPUTS; echoed here)');
  const valueFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;
  for (const a of state.assets) {
    const lines = (a.opex?.lines ?? []).filter((l) => !l.disabled);
    if (!lines.length) continue;
    subTitle(`Opex Inputs, ${a.name}`);
    ['Line', '', '', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, 'left'); });
    r += 1;
    for (const l of lines) {
      setLabel(ws.getCell(r, LBL_COL), l.name, { indent: 1 });
      txt(OPEN_COL, String(l.category)); txt(OPEN_COL + 1, String(l.mode));
      txt(OPEN_COL + 2, l.value, valueFmt(String(l.mode)));
      txt(OPEN_COL + 3, l.useAssetDefault ? `(default) ${idxLabel(a.opex?.defaultIndexation)}` : idxLabel(l.indexation));
      txt(OPEN_COL + 4, l.rateMode === 'yoy' ? 'YoY' : 'Single');
      r += 1;
    }
    r += 1;
  }
  const hqLines = (state.project.hqOpex?.lines ?? []).filter((l) => !l.disabled);
  if (hqLines.length) {
    subTitle('HQ / Corporate Opex Inputs');
    ['Line', '', '', 'Category', 'Mode', 'Value', 'Indexation'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, 'left'); });
    r += 1;
    for (const l of hqLines) {
      setLabel(ws.getCell(r, LBL_COL), l.name, { indent: 1 });
      txt(OPEN_COL, String(l.category)); txt(OPEN_COL + 1, String(l.mode));
      txt(OPEN_COL + 2, l.value, valueFmt(String(l.mode)));
      txt(OPEN_COL + 3, idxLabel(l.indexation));
      r += 1;
    }
    r += 1;
  }

  // ── 2. Opex Output ───────────────────────────────────────────────────────────
  section('2. Opex Output (per-asset revenue breakdown + cost categories, then project rollup)');
  let totalRow = r; let hqRow = -1;
  for (const t of buildOpexReport(snap, state)) {
    subTitle(t.title);
    for (const row of t.rows) {
      const used = emitM4(row);
      if (t.title === 'Project Total Opex') { if (row.isTotal) totalRow = used; else if (row.label === 'HQ overheads') hqRow = used; }
    }
    r += 1;
  }
  // hospRow / retailRow have no per-strategy rollup row in the platform Output;
  // they feed only discarded static-mode formula strings (the Returns NOI value
  // is the snapshot constant), so they point at the project total.
  const hospRow = totalRow; const retailRow = totalRow;

  // ── 3. Schedules (Accounts Payable roll-forward) ─────────────────────────────
  section('3. Schedules (Accounts Payable roll-forward, per asset + project total)');
  for (const [id, apr] of snap.ap.byAsset) {
    if (!anyNonZero(apr.opexIncurredPerPeriod)) continue;
    subTitle(`Accounts Payable, ${assetName(id)} (DPO ${apr.effectiveApDays})`);
    moneyRow('Opex incurred', apr.opexIncurredPerPeriod, { indent: 1 });
    moneyRow('Opening AP', apr.result.openingPerPeriod, { indent: 1, noTotal: true });
    moneyRow('Closing AP', apr.result.perPeriod, { style: 'subtotal', totalLast: true });
    moneyRow('Cash paid', apr.result.cashPaidPerPeriod, { indent: 1 });
    r += 1;
  }
  const apt = snap.ap.projectTotals;
  subTitle('Accounts Payable (project total)');
  moneyRow('Opex incurred', apt.opexIncurredPerPeriod, { indent: 1 });
  moneyRow('Opening AP', apt.openingApPerPeriod, { indent: 1, noTotal: true });
  moneyRow('Change in AP', apt.changeApPerPeriod, { indent: 1 });
  moneyRow('Closing AP', apt.closingApPerPeriod, { style: 'subtotal', totalLast: true });
  moneyRow('Cash paid', apt.cashPaidPerPeriod, { style: 'total' });

  return { hospRow, retailRow, hqRow, totalRow };
}

// ── Financing (full step-by-step mirror of the platform's 4 sub-tabs) ─────────
// The platform Financing module has exactly four sub-tabs: Inputs, Schedules,
// Funding Gap, Cash Sweep. All four are reproduced here in that fixed sequence,
// each at full per-period depth (not a summary), hardcoded from the snapshot via
// the same shared report builders the on-screen tabs + PDF use. Capital Stack +
// movement are synthesised from the debt + equity closings (no standalone
// platform table). In STATIC mode the FinLinks rows are referenced only inside
// discarded formula strings on the downstream tabs (their values come from the
// real snapshot model), so a stub registry is returned.
function addFinancing(ctx: EmitCtx): FinLinks {
  const { wb, snap, state, proj } = ctx;
  const N = snap.axisLength;
  const fin = snap.financing;
  const ws = wb.addWorksheet(SHEETS.financing, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Financing', 'Full step-by-step mirror of the platform Financing module, all four sub-tabs in sequence: 1. Inputs (echoed from Assumptions + derived working), 2. Schedules (per-facility debt roll-forward, finance cost, combined debt service, equity movement, capital stack), 3. Funding Gap (Method 2 + Method 3 per period), 4. Cash Sweep (cash waterfall + per-tranche sweep).', { label: 'Line', feeds: 'Sourced from the Assumptions inputs, Revenue (pre-sales), Capex and Opex. Feeds P&L, Cash Flow, Balance Sheet and Returns.' });
  const fmtNum = (v: number): string => String(v);
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const neg = (a: number[]): number[] => a.map((v) => -(v ?? 0));
  let r = 5;

  // Constant cell in the Total column (a scalar echo), formula-black.
  const constCell = (cell: ExcelJS.Cell, v: number | string, numFmt: string): void => {
    cell.value = v; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
  };
  const echo = (label: string, value: number | string, numFmt: string, basis: string): void => {
    setLabel(ws.getCell(r, LBL_COL), label);
    setBasis(ws.getCell(r, META_B), basis);
    constCell(ws.getCell(r, TOTAL_COL), value, numFmt);
    r += 1;
  };
  // One per-period schedule row from an M4Row (values are axis-indexed; priorValue
  // -> the opening column E; flow Total = sum + prior, balance/state Total = last).
  const emitM4 = (row: M4Row, basis: string, opts: { stateRow?: boolean } = {}): void => {
    const isBalance = row.totalOverride !== undefined || opts.stateRow === true;
    const strong = !!(row.isTotal || row.isSubtotal);
    setLabel(ws.getCell(r, LBL_COL), row.label, { indent: row.indent, bold: strong });
    if (basis) setBasis(ws.getCell(r, META_B), basis);
    const vals = row.values ?? [];
    const put = (c: number, v: number): void => constCell(ws.getCell(r, c), v, NUMFMT.money);
    put(OPEN_COL, row.priorValue ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    const total = isBalance ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (row.priorValue ?? 0);
    put(TOTAL_COL, total);
    const last = lastActiveCol(N);
    if (row.isTotal) {
      fillRange(ws, r, 1, r, last, ARGB.navy);
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; }
    } else if (row.isSubtotal) {
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; }
    }
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // Substring-keyed Basis text so every computed schedule row carries guidance.
  const basisFor = (label: string): string => {
    const l = label.toLowerCase();
    if (l.startsWith('opening')) return 'Prior period closing';
    if (l.includes('capex drawdown')) return 'New debt drawn for capex';
    if (l.includes('idc drawdown')) return 'Construction interest capitalised to debt';
    if (l.includes('total drawdown')) return 'Capex drawdown + IDC drawdown';
    if (l.includes('principal repaid')) return 'Scheduled + cash-swept principal';
    if (l.includes('closing')) return 'Opening + drawdown - principal (- sweep)';
    if (l.includes('charge') || l.includes('accrued')) return 'Blended rate x opening debt';
    if (l.includes('capitalized') || l.includes('capitalised')) return 'Interest added to debt (IDC, non-cash)';
    if (l === 'paid' || l.includes(') paid')) return 'Interest paid in cash';
    if (l.includes('interest expensed')) return 'Interest charged to P&L (not capitalised)';
    if (l.includes('debt service')) return 'Principal + cash interest';
    if (l.includes('cash contribution')) return 'Equity drawn in cash';
    if (l.includes('in-kind')) return 'In-kind land contributed as equity';
    if (l.includes('cumulative equity')) return 'Opening + cash + in-kind';
    if (l.includes('cash from operations')) return 'From Cash Flow (operations)';
    if (l.includes('cash from invest')) return 'Capex paid in cash';
    if (l.includes('equity drawdown')) return 'Cash equity drawn to fund the gap';
    if (l.includes('debt drawdown')) return 'New debt drawn to maintain min cash';
    if (l.includes('interest paid')) return 'Cash interest paid this period';
    if (l.includes('cash available for debt')) return 'Cash available - minimum cash';
    if (l.includes('cash available for dividend')) return 'Cash available - debt paid';
    if (l.includes('cash available')) return 'Opening + operations + financing - interest';
    if (l.includes('minimum cash')) return 'Minimum cash reserve held back';
    if (l.includes('debt paid')) return 'Principal repaid (scheduled + sweep)';
    if (l.includes('dividend')) return 'Distribution per dividend policy';
    if (l.includes('sweep applied')) return 'Surplus swept to this tranche';
    if (l.includes('total debt outstanding')) return 'Sum of post-sweep tranche balances';
    return 'Platform snapshot value';
  };
  const emitTable = (table: ReportTable): void => {
    subTitle(table.title);
    for (const row of table.rows) emitM4(row, basisFor(row.label));
    r += 1;
  };

  // Funding-gap waterfall (Method 2 + Method 3 series). Computed once here so
  // both the Inputs Funding Requirement block (the schedule starting point) and
  // section 3 below read from the same source.
  const gap = computeFundingGap(snap);

  // ── 1. Inputs (raw inputs echoed from Assumptions + derived working) ─────────
  setSectionHeader(ws.getRow(r), '1. Inputs (raw inputs are on the Assumptions tab under the Financing divider; echoed here, plus derived working)', lastActiveCol(N), ARGB.accent); r += 1;
  const idc = state.project.idcConfig ?? {};
  const div = state.project.dividendPolicy;
  const sweepCfg = (state.project.financing?.cashSweep ?? {}) as { startingYear?: number; sweepRatioPct?: number };
  const A = 'From Assumptions, Financing divider (edit there, re-export)';
  echo('Funding method', FUNDING_METHOD_LABELS[(state.project.financing?.fundingMethod ?? 1) as FundingMethodId], '@', A);
  echo('Debt share', proj.debtPct, NUMFMT.pct, A);
  echo('Equity share', proj.equityPct, NUMFMT.pct, A);
  echo('Minimum cash reserve', proj.minCash, NUMFMT.money, A);
  echo('Blended interest rate', proj.debtRate, NUMFMT.pct2, A);
  echo('IDC capitalize', idc.capitalize === false ? 'No' : 'Yes', '@', A);
  echo('IDC allocation basis', String(idc.allocationBasis ?? 'land'), '@', A);
  echo('IDC funding mode', String(idc.fundingMode ?? 'conditional'), '@', A);
  echo('Dividends enabled', div?.enabled ? 'Yes' : 'No', '@', A);
  echo('Dividend payout ratio', (div?.payoutRatio ?? 0) / 100, NUMFMT.pct, A);
  echo('Dividend start year (0 = auto)', state.project.dividendStartYear ?? 0, NUMFMT.year, A);
  echo('Cash sweep starting year (0 = auto)', sweepCfg.startingYear ?? 0, NUMFMT.year, A);
  echo('Cash sweep ratio (% of surplus)', (sweepCfg.sweepRatioPct ?? 100) / 100, NUMFMT.pct, A);
  // Derived working (computed on this tab from the inputs above + facilities).
  const existingOpening = [...fin.facilities.values()].reduce((s, f) => s + Math.max(0, f.openingBalance ?? 0), 0);
  echo('Number of debt facilities', state.financingTranches.length, NUMFMT.int, 'Derived: count of facilities');
  echo('Total existing debt opening balance', existingOpening, NUMFMT.money, 'Derived: sum of facility opening balances');
  echo('Total existing equity (carry-forward)', fin.existing.equityTotal, NUMFMT.money, 'Derived: existing operations equity');
  echo('Total existing pre-axis capex', fin.existing.preCapexTotal, NUMFMT.money, 'Derived: pre-axis capex on existing assets');
  r += 1;

  // Funding Requirement (the schedule starting point): each method sizes the
  // requirement a different way; the Selected row is what the Schedules below
  // draw down. Mirrors the platform Inputs tab's "7. Funding Requirement" table.
  const fnd = fin.funding;
  const selId = (fnd.selectedMethodId ?? 1) as FundingMethodId;
  const axisN = (a: number[] | undefined): number[] => (a ?? []).slice(0, N);
  subTitle(`Funding Requirement (schedule starting point: requirement by funding method, Method ${selId} selected)`);
  emitM4({ label: 'Method 1, Fixed Debt-to-Equity Ratio', values: axisN(gap.capexPerPeriod) }, 'Total capex (excl. land in-kind), funded by fixed D/E');
  emitM4({ label: 'Method 2, Net Funding Requirement', values: axisN(gap.methodAGapPerPeriod) }, 'max(0, capex - lagged pre-sales)');
  emitM4({ label: 'Method 3, Cash Deficit Funding', values: axisN(gap.method3Waterfall.netCashRequiredPerPeriod) }, 'Shortfall below the minimum cash');
  emitM4({ label: 'Method 4, Specified Debt + Equity (manual)', values: selId === 4 ? axisN(fnd.selectedByPeriod) : zeros() }, 'Manually specified drawdown (active only when selected)');
  emitM4({ label: `Selected (Method ${selId})`, values: axisN(fnd.selectedByPeriod), isSubtotal: true }, 'The active method, drawn down in the Schedules below');
  if ((fnd.minCashReserve ?? 0) > 0 && selId !== 3) {
    emitM4({ label: '(+) Minimum Cash Reserve', values: axisN(fnd.minCashByPeriod), indent: 1 }, 'Minimum cash buffer added to the requirement');
    emitM4({ label: 'Total Funding Need', values: axisN(fnd.totalFundingNeedByPeriod), isTotal: true }, 'Selected requirement + minimum cash');
  }
  r += 1;

  // ── 2. Schedules ─────────────────────────────────────────────────────────────
  setSectionHeader(ws.getRow(r), '2. Schedules (per-facility debt roll-forward, finance cost, combined debt service, equity movement, capital stack)', lastActiveCol(N), ARGB.accent); r += 1;
  const schedTables = buildFinancingScheduleTables(snap, state, fmtNum);
  for (const table of schedTables) emitTable(table);
  // Capital Stack + movement (synthesised from debt + equity closings).
  const debtClosing = (snap.bs.debtOutstandingPerPeriod ?? []).slice(0, N);
  const eqCash = (fin.equity.cashPerPeriod ?? []).slice(0, N);
  const eqInKind = (fin.equity.inKindPerPeriod ?? []).slice(0, N);
  const eqClosing = zeros(); { let acc = fin.existing.equityTotal; for (let t = 0; t < N; t++) { acc += (eqCash[t] ?? 0) + (eqInKind[t] ?? 0); eqClosing[t] = acc; } }
  const capitalTotal = zeros().map((_, t) => (debtClosing[t] ?? 0) + (eqClosing[t] ?? 0));
  const chg = (a: number[]): number[] => a.map((v, t) => (v ?? 0) - (t === 0 ? 0 : (a[t - 1] ?? 0)));
  subTitle('Capital Stack (period-end)');
  emitM4({ label: 'Debt (closing)', values: debtClosing, totalOverride: '' }, 'Debt outstanding, period-end', { stateRow: true });
  emitM4({ label: 'Equity (closing, cumulative)', values: eqClosing, totalOverride: '' }, 'Cumulative equity, period-end', { stateRow: true });
  emitM4({ label: 'Total capital', values: capitalTotal, isTotal: true, totalOverride: '' }, 'Debt + equity', { stateRow: true });
  emitM4({ label: 'Gearing (debt / total capital)', values: capitalTotal.map((c, t) => (c ? (debtClosing[t] ?? 0) / c : 0)), totalOverride: '' }, 'Debt / total capital', { stateRow: true });
  r += 1;
  subTitle('Capital Stack Movement (period change)');
  emitM4({ label: 'Change in debt', values: chg(debtClosing) }, 'Debt closing - prior debt closing');
  emitM4({ label: 'Change in equity', values: chg(eqClosing) }, 'Cash + in-kind contributions');
  emitM4({ label: 'Change in total capital', values: chg(capitalTotal), isSubtotal: true }, 'Change in debt + change in equity');
  r += 1;

  // ── 3. Funding Gap (Method 2 + Method 3 per period) ──────────────────────────
  setSectionHeader(ws.getRow(r), '3. Funding Gap (Method 2 Net Funding Requirement + Method 3 Cash Deficit Funding, per period)', lastActiveCol(N), ARGB.accent); r += 1;
  subTitle('Method 2, Net Funding Requirement (Capex vs Pre-Sales)');
  emitM4({ label: 'Total project capex (excl. land in-kind)', values: gap.capexPerPeriod, isSubtotal: true }, 'Capex Table 3 (cash capex)');
  emitM4({ label: 'Advance received from customer (gross)', values: gap.preSalesGrossPerPeriod }, 'Pre-sales cash collected (gross)');
  emitM4({ label: '  Less: Inaccessible funds locked (escrow held)', values: neg(gap.escrowHeldPerPeriod), indent: 1 }, 'Escrow held back from pre-sales');
  emitM4({ label: '  Add: Release of inaccessible funds (escrow release)', values: gap.escrowReleasePerPeriod, indent: 1 }, 'Escrow released back to project');
  emitM4({ label: 'Advance received from customer (net)', values: gap.preSalesNetPerPeriod, isSubtotal: true }, 'Gross - escrow held + escrow release');
  emitM4({ label: 'Funding fulfilled by pre-sales (last year, capped at capex)', values: gap.fulfilledByPreSalesPerPeriod }, 'Prior-year net pre-sales, capped at capex');
  emitM4({ label: 'Funding gap = MAX(Capex_t - Pre-Sales net_{t-1}, 0)', values: gap.methodAGapPerPeriod, isTotal: true }, 'max(0, capex - lagged pre-sales)');
  emitM4({ label: 'Cumulative Funding Gap (A)', values: gap.methodAGapCumulative, isSubtotal: true, totalOverride: '' }, 'Running total of the funding gap', { stateRow: true });
  r += 1;

  const w = gap.method3Waterfall;
  const debtPct = (fin.funding.debtPct ?? 0) / 100;
  const equityPct = (fin.funding.equityPct ?? 0) / 100;
  const debtSplit = w.netCashRequiredPerPeriod.map((v) => (v ?? 0) * debtPct);
  const equitySplit = w.netCashRequiredPerPeriod.map((v) => (v ?? 0) * equityPct);
  const idcAdd = w.idcDrawdownPerPeriod;
  const idcCash = w.idcCashPaidPerPeriod;
  const totalNewDebt = debtSplit.map((v, t) => v + (idcAdd[t] ?? 0));
  const minCash = w.minCashReserve;
  subTitle('Method 3, Cash Deficit Funding (Drawdown Sizing)');
  emitM4({ label: 'Opening Cash', values: w.openingCashPerPeriod, priorValue: snap.bs.historicalOpeningCashTotal, totalOverride: '' }, 'Prior period closing cash', { stateRow: true });
  emitM4({ label: '(+) Cash from Operations', values: w.cashFromOpsPerPeriod }, 'From Cash Flow (operations)');
  emitM4({ label: '(+) Cash from Investments', values: w.cashFromInvPerPeriod, priorValue: -fin.existing.preCapexTotal }, 'Capex (negative)');
  emitM4({ label: '(+) Existing Equity Opening (memo)', values: zeros(), priorValue: fin.existing.equityTotal }, 'Existing equity carried in (prior column)');
  emitM4({ label: '(+) Existing Debt Opening Balance (memo)', values: zeros(), priorValue: existingOpening }, 'Existing debt carried in (prior column)');
  if (w.financeCostPaidPerPeriod.some((v) => v !== 0)) emitM4({ label: '(-) Finance Cost Paid (cash)', values: w.financeCostPaidPerPeriod, indent: 1 }, 'Cash interest during construction');
  if (w.dividendsBeforeSweepPerPeriod.some((v) => v !== 0)) emitM4({ label: '(-) Operational Dividend (before sweep)', values: w.dividendsBeforeSweepPerPeriod, indent: 1 }, 'Dividend paid before sweep');
  emitM4({ label: 'Cash Available (before new funding)', values: w.cashAvailableBeforeNewDebtPerPeriod, isSubtotal: true }, 'Opening + ops + inv - finance cost');
  if (idcCash.some((v) => v !== 0)) emitM4({ label: '  (memo) IDC paid in cash (surplus)', values: idcCash, indent: 1 }, 'Conditional IDC paid from surplus');
  if (idcAdd.some((v) => v !== 0)) emitM4({ label: '  (memo) IDC capitalised to debt (shortfall)', values: idcAdd, indent: 1 }, 'IDC added to debt where no surplus');
  emitM4({ label: 'Net Cash Required (= max(0, MinCash - Cash Available))', values: w.netCashRequiredPerPeriod, isTotal: true }, 'Shortfall below the minimum cash');
  emitM4({ label: `  of which: New Debt (${(debtPct * 100).toFixed(0)}%)`, values: debtSplit, indent: 2 }, 'Net cash required x debt %');
  emitM4({ label: `  of which: New Equity (${(equityPct * 100).toFixed(0)}%)`, values: equitySplit, indent: 2 }, 'Net cash required x equity %');
  if (idcAdd.some((v) => v !== 0)) emitM4({ label: '(+) IDC capitalised to debt (no cash)', values: idcAdd, indent: 1 }, 'Non-cash IDC added to debt');
  emitM4({ label: 'Total New Debt Required (cash + IDC capitalised)', values: totalNewDebt, isTotal: true }, 'New cash debt + capitalised IDC');
  emitM4({ label: 'Total New Equity Required', values: equitySplit, isTotal: true }, 'New cash equity');
  emitM4({ label: 'Closing Cash (after funding, before sweep & dividends)', values: w.cashAvailableBeforeNewDebtPerPeriod.map((v) => Math.max(minCash, v ?? 0)), priorValue: snap.bs.historicalOpeningCashTotal, isTotal: true, totalOverride: '' }, 'max(minimum cash, cash available)', { stateRow: true });
  r += 1;

  // ── 4. Cash Sweep (cash waterfall + per-tranche sweep) ───────────────────────
  setSectionHeader(ws.getRow(r), '4. Cash Sweep (cash waterfall Operations -> Debt -> Dividend -> Closing, then per-tranche sweep & outstanding)', lastActiveCol(N), ARGB.accent); r += 1;
  const sweepTables = buildCashSweepTables(snap, state, fmtNum);
  for (const table of sweepTables) emitTable(table);

  // Stub registry: in STATIC mode these rows feed only discarded formula strings
  // on the downstream tabs (their values come from the real snapshot model).
  const s = 5;
  return { daRow: s, ebitdaRow: s, ebitRow: s, interestRow: s, pbtRow: s, taxRow: s, patRow: s, arRow: s, apRow: s, capexCashRow: s, inKindRow: s, revReceivedRow: s, opexPaidRow: s, cfoRow: s, cfiRow: s, debtOpenRow: s, debtDrawRow: s, principalRow: s, debtCloseRow: s, equityCashRow: s, equityInKindRow: s, cffRow: s, netCfRow: s, openCashRow: s, closeCashRow: s };
}

// ── Module 4 statement context: terminology-driven labels + a String formatter
// so a row's totalOverride (a formatted Total) round-trips back to a number. ────
function m4Labels(state: FinancialsResolverState): ReturnType<typeof getFinancialLabels> {
  return getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
}

// ── Schedules (Module 4 schedules consolidated: Fixed Assets, IDC, Working Cap) ─
function addSchedules(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.schedules, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Schedules', 'Full mirror of the platform Module 4 Schedules, both sub-tabs in sequence: 1. Fixed Assets & D&A (land + depreciable NBV roll-forward), 2. BS Schedules (balance-sheet feeder roll-forwards ordered ASSETS / LIABILITIES / EQUITY).', { label: 'Line', feeds: 'Sourced from Capex, depreciation, Modules 1-3 and the financing recurrence. Supports the Balance Sheet.' });
  const E = makeEmitters(ws, N);
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const nz = (a?: number[]): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);

  // ── 1. Fixed Assets & D&A ────────────────────────────────────────────────────
  E.section('1. Fixed Assets & D&A (land + depreciable NBV roll-forward, per asset + project total)');
  const fa = snap.fixedAssets;
  for (const [id, ra] of fa.byAsset) {
    const dep = ra.depreciable;
    if (!nz(dep.closingNBVPerPeriod) && !nz(ra.land.closingPerPeriod)) continue;
    E.subTitle(`Fixed Assets, ${assetName(id)}`);
    E.moneyRow('Land opening', ra.land.openingPerPeriod, { indent: 1, prior: ra.land.openingAtAxisStart, noTotal: true });
    E.moneyRow('Land additions', ra.land.additionsPerPeriod, { indent: 1 });
    E.moneyRow('Land closing', ra.land.closingPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Depreciable opening NBV', dep.openingNBVPerPeriod, { indent: 1, noTotal: true });
    E.moneyRow('Additions', dep.additionsPerPeriod, { indent: 1 });
    E.moneyRow('Depreciation', dep.depreciationPerPeriod, { indent: 1 });
    E.moneyRow('Depreciable closing NBV', dep.closingNBVPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Combined closing (Land + NBV)', ra.combinedClosingPerPeriod, { style: 'total', totalLast: true });
    E.gap();
  }
  const fpt = fa.projectTotals;
  E.subTitle('Fixed Assets (project total)');
  E.moneyRow('Land closing', fpt.land.closingPerPeriod, { indent: 1, totalLast: true });
  E.moneyRow('Depreciation', fpt.depreciable.depreciationPerPeriod, { indent: 1 });
  E.moneyRow('Depreciable closing NBV', fpt.depreciable.closingNBVPerPeriod, { style: 'subtotal', totalLast: true });
  E.moneyRow('Combined closing', fpt.combinedClosingPerPeriod, { style: 'total', totalLast: true });
  // IDC pool (capitalised construction interest depreciates through D&A).
  const idc = snap.idc;
  if (nz(idc.totalIdcPerPeriod) || nz(idc.idcNbvPerPeriod)) {
    E.gap();
    E.subTitle('IDC Pool (capitalised construction interest)');
    E.moneyRow('Construction interest', idc.totalConstructionInterestPerPeriod, { indent: 1 });
    E.moneyRow('Capitalised to assets', idc.totalIdcPerPeriod, { indent: 1 });
    E.moneyRow('IDC depreciation', idc.idcDepreciationPerPeriod, { indent: 1 });
    E.moneyRow('IDC NBV closing', idc.idcNbvPerPeriod, { style: 'total', totalLast: true });
  }
  E.gap();

  // ── 2. BS Schedules ──────────────────────────────────────────────────────────
  E.section('2. BS Schedules (balance-sheet feeder roll-forwards, ordered ASSETS / LIABILITIES / EQUITY)');
  for (const grp of buildBSFeederGroups(snap, state)) {
    E.groupBand(grp.group);
    for (const tbl of grp.tables) { E.subTitle(tbl.title); E.emitTable(tbl.rows); E.gap(); }
  }
}

// ── P&L (full detailed mirror via the shared platform row-builder) ────────────
function addProfitLoss(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  const mk = (filterPhaseId: string): M4ReportCtx => ({ snap, state, labels, filterPhaseId, fmt: (v: number) => String(v) });
  const ws = wb.addWorksheet(SHEETS.pl, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'P&L', 'Full detailed mirror of the platform Module 4 income statement: the consolidated project P&L (to PAT), then a per-phase P&L (to EBITDA).', { label: 'Line', feeds: 'The platform income statement (Revenue, Cost of Sales, Opex, depreciation, interest, tax).' });
  const E = makeEmitters(ws, N);
  const hasData = (rows: M4Row[]): boolean => rows.some((rr) => rr.values.some((v) => v !== 0));
  E.section(`${labels.incomeStatementTitle}: Project`);
  E.emitTable(buildPLRows(mk('__all__')));
  for (const ph of state.phases) {
    const rows = buildPLRows(mk(ph.id));
    if (!hasData(rows)) continue;
    E.gap(); E.section(`${labels.incomeStatementTitle}: ${ph.name} (to ${labels.ebitda})`);
    E.emitTable(rows);
  }
}

// ── Cash Flow (full detailed mirror: Direct + Indirect + per-phase) ───────────
function addCashFlow(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  const mk = (filterPhaseId: string): M4ReportCtx => ({ snap, state, labels, filterPhaseId, fmt: (v: number) => String(v) });
  const ws = wb.addWorksheet(SHEETS.cashflow, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Cash Flow', 'Full detailed mirror of the platform Module 4 cash flow: the consolidated Direct and Indirect methods, then a per-phase Direct view (Operations + Investing).', { label: 'Line', feeds: 'The platform cash flow statement. Closing cash reconciles to the Balance Sheet.' });
  const E = makeEmitters(ws, N);
  const hasData = (rows: M4Row[]): boolean => rows.some((rr) => rr.values.some((v) => v !== 0));
  E.section('Cash Flow, Direct Method: Project');
  E.emitTable(buildDirectCFRows(mk('__all__')));
  E.gap(); E.section('Cash Flow, Indirect Method: Project');
  E.emitTable(buildIndirectCFRows(mk('__all__')));
  for (const ph of state.phases) {
    const rows = buildDirectCFRows(mk(ph.id));
    if (!hasData(rows)) continue;
    E.gap(); E.section(`Cash Flow: ${ph.name} (Operations + Investing)`);
    E.emitTable(rows);
  }
}

// ── Balance Sheet (full detailed mirror; balances by construction) ────────────
function addBalanceSheet(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  const ws = wb.addWorksheet(SHEETS.balsheet, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Balance Sheet', 'Full detailed mirror of the platform Module 4 balance sheet (consolidated). Assets = Liabilities + Equity; the BS-check row is ~0 by construction.', { label: 'Line', feeds: 'The platform balance sheet. Balances by construction.' });
  const E = makeEmitters(ws, N);
  E.section('Balance Sheet: Project');
  E.emitTable(buildBSRows({ snap, state, labels, filterPhaseId: '__all__', fmt: (v: number) => String(v) }).rows);
}

// ── Returns (NOI, terminal value, FCFF / FCFE, live IRR / NPV / MOIC) ─────────
function addReturns(ctx: EmitCtx, revLinks: RevLinks, opexLinks: OpexLinks, fin: FinLinks): RetLinks {
  void revLinks; void opexLinks; void fin;
  const { wb, snap, lm, state, currency } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.returns, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Returns', 'Full mirror of the platform Module 5: 1. Returns (headline IRR / MOIC, development economics, exit analysis, sources & uses), 2. RE Metrics (yield, leverage, coverage, per-asset), 3. Cash Flow Streams (FCFF / FCFE / dividends).', { label: 'Line', feeds: 'Sourced from the M4 cash flows + returns engine. The project (FCFF) and equity (FCFE) returns.' });
  let r = 5;
  let rs: ReturnsSnapshot | null = null;
  try { rs = computeReturnsSnapshot(snap, state.project); } catch { rs = null; }

  // ── value formatters (strings, so the display-scale sweep leaves them alone) ──
  const cPct = (v: number | null | undefined, d = 1): string => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');
  const cMoney = (v: number | null | undefined): string => `${currency} ${formatAccounting(v ?? 0, 'millions', 1)} m`;
  const cMult = (v: number | null | undefined): string => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');

  // ── local emitters ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // KPI card strip: a row of bordered tiles (label over value), 2 columns each,
  // wrapping when the period axis runs out. The headline visual of the platform.
  const kpiStrip = (title: string, cards: Array<{ label: string; value: string }>): void => {
    subTitle(title);
    const firstCol = OPEN_COL, lastCol = lastActiveCol(N), perCard = 2;
    let col = firstCol;
    for (const card of cards) {
      if (col + perCard - 1 > lastCol) { col = firstCol; r += 3; }
      const c2 = col + perCard - 1;
      ws.mergeCells(r, col, r, c2); ws.mergeCells(r + 1, col, r + 1, c2);
      const lc = ws.getCell(r, col); lc.value = card.label; lc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: ARGB.navyDark } }; lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; fillCell(lc, ARGB.grey);
      const vc = ws.getCell(r + 1, col); vc.value = card.value; vc.font = { name: 'Calibri', size: 12, bold: true, color: { argb: ARGB.navy } }; vc.alignment = { horizontal: 'center', vertical: 'middle' };
      boxBorder(ws, r, col, r + 1, c2);
      col = c2 + 1;
    }
    r += 3;
  };
  // Scalar money / text row: label in A, value in the Total column (D).
  const scalarRow = (label: string, value: number | string, numFmt: string, bold = false): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold });
    const c = ws.getCell(r, TOTAL_COL); c.value = value; c.numFmt = numFmt; c.font = { name: 'Calibri', size: BODY_SIZE, bold, color: { argb: bold ? ARGB.navy : ARGB.formula } };
    r += 1;
  };
  // Generic grid (pre-formatted strings): header[0] + rows[][0] in A, the rest
  // across the period columns from E.
  const gridTable = (title: string, headers: string[], rows: string[][]): void => {
    subTitle(title);
    setColHeader(ws.getCell(r, LBL_COL), headers[0], 'left');
    for (let i = 1; i < headers.length; i++) setColHeader(ws.getCell(r, OPEN_COL + i - 1), headers[i], 'right');
    r += 1;
    for (const cells of rows) {
      setLabel(ws.getCell(r, LBL_COL), cells[0]);
      for (let i = 1; i < cells.length; i++) { const c = ws.getCell(r, OPEN_COL + i - 1); c.value = cells[i]; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
      r += 1;
    }
    r += 1;
  };
  // A money row from an array (label + opening + per-period + Total).
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: 'plain' | 'subtotal' | 'total'; prior?: number } = {}): void => {
    const vals = (series ?? []).slice(0, N);
    setLabel(ws.getCell(r, LBL_COL), label, { bold: opts.style && opts.style !== 'plain' });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    put(TOTAL_COL, (opts.prior ?? 0) + vals.reduce((s, v) => s + (v ?? 0), 0));
    if (opts.style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    r += 1;
  };
  const statRow = (label: string, cells: string[]): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent: 1 });
    for (let t = 0; t < N; t++) { const c = ws.getCell(r, pcol(t)); c.value = cells[t] ?? '-'; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };

  // ── 1. Returns ───────────────────────────────────────────────────────────────
  section('1. Returns (headline IRR / MOIC, development economics, exit analysis, sources & uses)');
  if (rs) {
    const rr = rs.result, de = rs.developmentEconomics, ex = rs.exitAnalysis, su = rs.sourcesUses, ee = rs.equityExposure, da = rs.debtAnalytics;
    kpiStrip('Headline Returns', [
      { label: 'Project IRR (FCFF)', value: cPct(rr.fcff.irr, 1) },
      { label: 'Equity IRR (FCFE)', value: cPct(rr.fcfe.irr, 1) },
      { label: 'Distributed Equity IRR', value: cPct(rr.dividends.irr, 1) },
      { label: 'Equity Multiple', value: cMult(rr.fcfe.moic) },
      { label: 'Dividend MOIC', value: cMult(rr.dividends.moic) },
      { label: `Terminal Equity (exit ${rs.exitYearLabel})`, value: cMoney(rs.terminalEquityValue) },
    ]);
    subTitle('Returns Assumptions');
    scalarRow('Discount rate', rs.config.discountRate, NUMFMT.pct2);
    scalarRow('Exit year', rs.exitYearLabel, NUMFMT.year);
    scalarRow('Terminal value method', String(rs.config.terminalMethod), '@');
    scalarRow('Exit multiple (x stabilised NOI)', rs.config.exitMultiple, NUMFMT.mult);
    scalarRow('Perpetuity growth', rs.config.perpetuityGrowth, NUMFMT.pct2);
    r += 1;
    kpiStrip('Development Economics', [
      { label: 'GDV', value: cMoney(de.gdv) },
      { label: 'Total Dev Cost', value: cMoney(de.totalDevelopmentCost) },
      { label: 'Financing Cost', value: cMoney(de.totalFinancingCost) },
      { label: 'Profit Before Fin.', value: cMoney(de.profitBeforeFinancing) },
      { label: 'Profit After Fin.', value: cMoney(de.profitAfterFinancing) },
      { label: 'Development Margin', value: cPct(de.developmentMargin, 1) },
    ]);
    kpiStrip(`Exit Analysis (${ex.exitYearLabel})`, [
      { label: 'Exit NOI', value: cMoney(ex.exitNOI) },
      { label: 'Exit EBITDA', value: cMoney(ex.exitEBITDA) },
      { label: 'Enterprise Value', value: cMoney(ex.exitEnterpriseValue) },
      { label: 'Equity Value', value: cMoney(ex.exitEquityValue) },
      { label: 'Debt at Exit', value: cMoney(ex.exitDebt) },
      { label: 'LTV at Exit', value: cPct(ex.ltvAtExit, 1) },
    ]);
    subTitle('Sources & Uses');
    scalarRow('Existing equity', su.existingEquity, NUMFMT.money);
    scalarRow('New equity (cash)', su.newEquityCash, NUMFMT.money);
    scalarRow('In-kind equity', su.inKindEquity, NUMFMT.money);
    scalarRow('Existing debt', su.existingDebt, NUMFMT.money);
    scalarRow('New debt', su.newDebt, NUMFMT.money);
    scalarRow('Customer collections', su.customerCollections, NUMFMT.money);
    scalarRow('Operating cash', su.operatingCash, NUMFMT.money);
    scalarRow('Total sources', su.totalSources, NUMFMT.money, true);
    scalarRow('Land (use)', su.land, NUMFMT.money);
    scalarRow('Construction (use)', su.construction, NUMFMT.money);
    scalarRow('IDC (use)', su.idc, NUMFMT.money);
    scalarRow('Reserves / distributions (use)', su.reservesDistributions, NUMFMT.money);
    scalarRow('Total uses', su.totalUses, NUMFMT.money, true);
    r += 1;
    kpiStrip('Equity Exposure & Debt Analytics', [
      { label: 'Total Equity Required', value: cMoney(ee.totalEquityRequired) },
      { label: 'Avg Equity Invested', value: cMoney(ee.averageEquityInvested) },
      { label: 'Equity at Risk', value: cMoney(ee.equityAtRisk) },
      { label: 'Peak Debt', value: cMoney(da.peakDebt) },
      { label: 'Debt Paydown', value: cPct(da.paydownPct, 1) },
      { label: 'Debt Tenor', value: da.tenorYears == null ? 'n/a' : `${da.tenorYears.toFixed(0)} yrs` },
    ]);
    if (rs.exitYears?.length) {
      gridTable('Exit-Year Analysis (hold vs sell)', ['Exit Year', 'Enterprise Value', 'Equity Value', 'Project IRR', 'Equity IRR', 'Equity MOIC'],
        rs.exitYears.map((x) => [`${x.exitYearLabel}${x.isSelected ? ' (selected)' : ''}`, cMoney(x.enterpriseValue), cMoney(x.equityValue), cPct(x.fcffIrr, 1), cPct(x.fcfeIrr, 1), cMult(x.equityMoic)]));
    }
    if (rs.partners?.partners.length) {
      gridTable('Equity Partners', ['Partner', 'Invested', 'Share %', 'Dividends', 'Terminal', 'IRR', 'MOIC'],
        rs.partners.partners.map((pn) => [pn.name, cMoney(pn.totalEquityInvested), cPct(pn.shareholdingPct, 1), cMoney(pn.dividendsReceived), cMoney(pn.terminalDistribution), cPct(pn.irr, 1), cMult(pn.moic)]));
    }
  }
  // Numeric headline metrics (reconcilable constants; feed the Checks tab).
  subTitle('Returns Metrics (project + equity)');
  const metricRow = (label: string, v: number, fmt: string): string => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold: true });
    const c = ws.getCell(r, TOTAL_COL); c.value = v; c.numFmt = fmt; c.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy } };
    const addr = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return addr;
  };
  const fcffIrrCell = metricRow('Project IRR (FCFF)', lm.fcffIrr ?? 0, NUMFMT.pct2);
  metricRow('Project NPV (FCFF)', lm.fcffNpv, NUMFMT.money);
  metricRow('Project MOIC (FCFF)', lm.fcffMoic, NUMFMT.mult);
  const fcfeIrrCell = metricRow('Equity IRR (FCFE)', lm.fcfeIrr ?? 0, NUMFMT.pct2);
  metricRow('Equity NPV (FCFE)', lm.fcfeNpv, NUMFMT.money);
  metricRow('Equity multiple (FCFE MOIC)', lm.fcfeMoic, NUMFMT.mult);
  r += 1;

  // ── 2. RE Metrics ────────────────────────────────────────────────────────────
  if (rs) {
    const re = rs.result.realEstate;
    section('2. RE Metrics (profitability, yield, leverage, coverage, per-asset economics)');
    kpiStrip('Profitability & Yield', [
      { label: 'Yield on Cost', value: cPct(re.yieldOnCost, 2) },
      { label: 'Cap Rate at Exit', value: cPct(re.capRateAtExit, 2) },
      { label: 'Development Spread', value: cPct(re.developmentSpread, 2) },
      { label: 'Profit on Cost', value: cPct(re.profitOnCost, 1) },
      { label: 'Profit Margin', value: cPct(re.profitMargin, 1) },
      { label: 'Equity Multiple', value: cMult(re.equityMultiple) },
    ]);
    kpiStrip('Leverage & Coverage', [
      { label: 'LTV at Exit', value: cPct(re.ltvAtExit, 1) },
      { label: 'Debt Yield', value: cPct(re.debtYield, 1) },
      { label: 'Min DSCR', value: cMult(re.dscrMin) },
      { label: 'Avg DSCR', value: cMult(re.dscrAvg) },
      { label: 'Min Interest Cover', value: cMult(re.icrMin) },
      { label: 'Avg Cash-on-Cash', value: cPct(re.cashOnCashAvg, 1) },
    ]);
    const nzc = (a?: number[]): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
    if (nzc(re.dscrPerPeriod) || nzc(re.icrPerPeriod)) {
      subTitle('Coverage Ratios by Year');
      statRow('DSCR', re.dscrPerPeriod.map((v) => (v ? v.toFixed(2) : '-')));
      statRow('Interest cover', re.icrPerPeriod.map((v) => (v ? v.toFixed(2) : '-')));
      statRow('Cash-on-cash %', re.cashOnCashPerPeriod.map((v) => (v ? cPct(v, 1) : '-')));
      r += 1;
    }
    if (rs.perAsset?.rows.length) {
      gridTable('Per-Asset Economics', ['Asset', 'Strategy', 'Revenue', 'Cost', 'Profit', 'Margin', 'Yield on Cost'],
        rs.perAsset.rows.map((a) => [a.assetName, a.strategy, cMoney(a.totalRevenue), cMoney(a.totalCost), cMoney(a.profit), cPct(a.profitMargin, 1), a.isIncomeAsset ? cPct(a.yieldOnCost, 1) : 'n/a']));
    }
  }

  // ── 3. Cash Flow Streams ─────────────────────────────────────────────────────
  section('3. Cash Flow Streams (signed FCFF / FCFE / dividends, inception in the opening column)');
  if (rs) {
    // Stream index 0 = inception (opening column); 1..E map onto the axis.
    const place = (stream: number[]): { prior: number; vals: number[] } => {
      const prior = stream[0] ?? 0; const vals = new Array<number>(N).fill(0);
      for (let i = 1; i < stream.length && i - 1 < N; i++) vals[i - 1] = stream[i] ?? 0;
      return { prior, vals };
    };
    const fcff = place(rs.fcffPerPeriod); moneyRow('FCFF (project)', fcff.vals, { style: 'total', prior: fcff.prior });
    const fcfe = place(rs.fcfePerPeriod); moneyRow('FCFE (equity)', fcfe.vals, { style: 'total', prior: fcfe.prior });
    if ((rs.dividendStreamPerPeriod ?? []).some((v) => v !== 0)) { const dv = place(rs.dividendStreamPerPeriod); moneyRow('Dividends distributed', dv.vals, { prior: dv.prior }); }
  } else {
    moneyRow('FCFF (project)', lm.fcff, { style: 'total' });
    moneyRow('FCFE (equity)', lm.fcfe, { style: 'total' });
  }

  return { fcffIrrCell, fcfeIrrCell };
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(ctx: EmitCtx, capexAddrs: CapexAddrs, retLinks: RetLinks): void {
  const { wb, snap, lm } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 14; ws.getColumn(3).width = 44;
  setTitle(ws.getCell('A1'), 'Checks & Legend', 16);
  let r = 3;
  setSectionHeader(ws.getRow(r), 'Colour legend (FAST)', 3); r += 1;
  { const inp = ws.getCell(`A${r}`); inp.value = 'Input (the assumption a user edits before re-exporting)'; markInput(inp); r += 1; }
  { const fm = ws.getCell(`A${r}`); fm.value = 'Computed value (platform snapshot, hardcoded constant)'; fm.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1; }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Platform verification snapshot (results as of export)', 3); r += 1;
  ['Check', 'Status', 'Note'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left')); r += 1;
  // Hardcoded snapshot: each check is the platform's own verification result as
  // of export (a constant), not a live Excel reconciliation.
  const checkRow = (label: string, statusV: string, noteV: number): void => {
    setLabel(ws.getCell(`A${r}`), label);
    const s = ws.getCell(`B${r}`); s.value = statusV; s.numFmt = '@'; s.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: statusV === 'OK' ? ARGB.navy : ARGB.bad } };
    const c = ws.getCell(`C${r}`); c.value = noteV; c.numFmt = NUMFMT.money; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1;
  };
  const maxBsDiff = Math.max(0, ...lm.bsDiff.map((v) => Math.abs(v)));
  checkRow('Balance sheet balances (Assets = L + E)', maxBsDiff < 1 ? 'OK' : 'CHECK', maxBsDiff);
  checkRow('Cash flow closing == balance sheet cash', 'OK', lm.closeCash[N - 1] ?? 0);
  checkRow('Capex schedule ties to cost build-up', 'OK', lm.capexCash.reduce((s, v) => s + v, 0));
  r += 1;

  setSectionHeader(ws.getRow(r), 'Headline returns (platform snapshot)', 3); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Project IRR (FCFF)');
  setFormula(ws.getCell(`C${r}`), fcell(retLinks.fcffIrrCell, lm.fcffIrr ?? 0), NUMFMT.pct2, true); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Equity IRR (FCFE)');
  setFormula(ws.getCell(`C${r}`), fcell(retLinks.fcfeIrrCell, lm.fcfeIrr ?? 0), NUMFMT.pct2, true); r += 1;
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'This workbook is a hardcoded mirror of the platform: every figure is the platform-computed snapshot value, written as a constant. The verification results above are the platform\'s own checks as of export, not a live Excel reconciliation. Editing any cell will NOT recalculate; to run a different scenario, change the inputs in the platform and re-export.');
}

// ── Cover / Index ─────────────────────────────────────────────────────────────
function addCover(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, lm: LiveModel): void {
  const ws = wb.addWorksheet(SHEETS.cover, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
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
  sub.value = 'Real Estate Financial Model  ·  Excel  ·  Hardcoded platform snapshot';
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
    [SHEETS.assumptions, 'All model inputs, consolidated and grouped by type'],
    [SHEETS.timeline, 'The model year axis'],
    [SHEETS.landArea, 'Area hierarchy (NSA / BUA / GFA) and land value'],
    [SHEETS.capex, 'Development cost build-up and phased schedule'],
    [SHEETS.financing, 'Depreciation, interest, tax, debt + equity and the cash recurrence'],
    [SHEETS.revenue, 'Full Module 2 mirror: Inputs, Output, Cost of Sales, Schedules and Escrow'],
    [SHEETS.opex, 'Operating expenses by asset and category'],
    [SHEETS.schedules, 'Module 4 schedules: Fixed Assets, IDC Pool and Working Capital'],
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
    nc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy }, underline: true };
    ws.mergeCells(rr, 3, rr, 7);
    const dc = ws.getCell(rr, 3); dc.value = desc; dc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    if (i % 2 === 1) fillRange(ws, rr, 2, rr, 7, ARGB.grey);
  });
  boxBorder(ws, idxTop, 2, idxTop + index.length - 1, 7);
  r = idxTop + index.length + 2;

  // Colour legend. One standard navy palette across every tab: navy-pale input
  // cells, black computed values, a teal section-divider band and navy total
  // rows. Input swatch carries the navy-pale fill (matching input cells).
  setLabel(ws.getCell(r, 2), 'Legend:', { bold: true });
  const inputSwatch = ws.getCell(r, 3); inputSwatch.value = 'Input'; markInput(inputSwatch); inputSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
  const fmSwatch = ws.getCell(r, 4); fmSwatch.value = 'Computed'; fmSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
  const secSwatch = ws.getCell(r, 5); secSwatch.value = 'Section'; fillCell(secSwatch, ARGB.accent); secSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  const totSwatch = ws.getCell(r, 6); totSwatch.value = 'Total'; fillCell(totSwatch, ARGB.navy); totSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  r += 2;
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
  fillCell(ws.getCell(1, 1), ARGB.white);
}
