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
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../financials-resolvers';
import { computeReturnsSnapshot } from '../returns-resolvers';
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
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

const SHEETS = { cover: 'Cover', assumptions: 'Assumptions', timeline: 'Timeline', capex: 'Capex', checks: 'Checks' };

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  const snap = computeFinancialsSnapshot(opts.state);
  const capex = buildCapexReport(snap, opts.state);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Financial Modeler Pro';
  wb.created = new Date(0); // deterministic (avoid clock for reproducible output)
  wb.calcProperties.fullCalcOnLoad = true;

  addCover(wb, snap, opts); // first tab; index links to the sheets created below
  const refs = addAssumptions(wb, snap, opts, capex);
  addTimeline(wb, snap, refs);
  const capexAddrs = addCapex(wb, snap, capex, refs);
  addChecks(wb, snap, capex, capexAddrs);
  return wb;
}

export async function generateModelWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const wb = buildModelWorkbook(opts);
  return wb.xlsx.writeBuffer();
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
interface AssumptionRefs {
  startYearName: string;
  axisLength: number;
  capex: CapexAssetRef[];
}

// ── Assumptions (Inputs) ──────────────────────────────────────────────────────
function addAssumptions(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, capex: CapexReport): AssumptionRefs {
  const ws = wb.addWorksheet(SHEETS.assumptions, { properties: { tabColor: { argb: ARGB.input } } });
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 16;
  const p = opts.state.project;
  const fin = snap.financing;
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

  ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return { startYearName: 'ProjectStartYear', axisLength: snap.axisLength, capex: capexRefs };
}

// ── Timeline (formula-driven year axis) ───────────────────────────────────────
function addTimeline(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, refs: AssumptionRefs): void {
  const ws = wb.addWorksheet(SHEETS.timeline, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 28;
  setTitle(ws.getCell('A1'), 'Timeline', 16);
  setLabel(ws.getCell('A2'), 'The model year axis. Every calculation sheet references these columns.');

  const N = refs.axisLength;
  const firstCol = 2; // column B = period 0
  // Header row (period years), used as the column headers everywhere.
  setColHeader(ws.getCell(4, 1), 'Period', 'left');
  for (let t = 0; t < N; t++) { const c = firstCol + t; ws.getColumn(c).width = 11; setColHeader(ws.getCell(4, c), t, 'right'); }

  // Period index row: 0, then +1.
  setLabel(ws.getCell('A5'), 'Period index', { bold: true });
  for (let t = 0; t < N; t++) {
    const c = colLetter(firstCol + t);
    const prev = colLetter(firstCol + t - 1);
    setFormula(ws.getCell(5, firstCol + t), fcell(t === 0 ? '0' : `${prev}5+1`, t), NUMFMT.int);
  }
  // Year row: first = ProjectStartYear, then +1.
  setLabel(ws.getCell('A6'), 'Year', { bold: true });
  for (let t = 0; t < N; t++) {
    const prev = colLetter(firstCol + t - 1);
    setFormula(ws.getCell(6, firstCol + t), fcell(t === 0 ? 'ProjectStartYear' : `${prev}6+1`, snap.yearLabels[t] ?? snap.projectStartYear + t), NUMFMT.year, true);
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }];
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
  const totalCol = firstCol + N;
  setSectionHeader(ws.getRow(r), 'Capex by period (incl. all land)', totalCol); r += 1;
  setColHeader(ws.getCell(r, 1), 'Asset', 'left');
  for (let t = 0; t < N; t++) {
    const c = firstCol + t;
    ws.getColumn(c).width = 12;
    const cell = ws.getCell(r, c);
    setFormula(cell, fcell(`Timeline!${colLetter(c)}6`, snap.yearLabels[t] ?? snap.projectStartYear + t), NUMFMT.year, true);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    cell.alignment = { horizontal: 'right' };
  }
  ws.getColumn(totalCol).width = 14;
  setColHeader(ws.getCell(r, totalCol), 'Total', 'right');
  r += 1;

  const inclTable = capex.results.find((t) => t.title === 'Total Capex (incl. all land)');
  const assetRows = (inclTable?.rows ?? []).filter((rw) => !rw.isTotal);
  const assetPeriodRows: number[] = [];
  for (const ar of assetRows) {
    setLabel(ws.getCell(`A${r}`), ar.label, { indent: 1 });
    for (let t = 0; t < N; t++) {
      const cell = ws.getCell(r, firstCol + t);
      cell.value = ar.values[t] ?? 0; // phased value (engine curve output), cached
      cell.font = { name: 'Calibri', size: 10, color: { argb: ARGB.formula } };
      cell.numFmt = NUMFMT.money;
    }
    const rowRange = `${colLetter(firstCol)}${r}:${colLetter(firstCol + N - 1)}${r}`;
    const rowCached = ar.values.slice(0, N).reduce((s, v) => s + (v ?? 0), 0);
    setFormula(ws.getCell(r, totalCol), fcell(`SUM(${rowRange})`, rowCached), NUMFMT.money);
    assetPeriodRows.push(r);
    r += 1;
  }
  // Project total row: each period = SUM of the asset cells above (formula).
  setLabel(ws.getCell(`A${r}`), 'Total capex (incl. all land)', { bold: true });
  const inclAll = snap.financing.capex.perPeriod.inclAllLand;
  for (let t = 0; t < N; t++) {
    const col = colLetter(firstCol + t);
    const colSum = assetPeriodRows.length ? assetPeriodRows.map((rr) => `${col}${rr}`).join('+') : '0';
    setFormula(ws.getCell(r, firstCol + t), fcell(colSum, inclAll[t] ?? 0), NUMFMT.money);
  }
  const gtRange = `${colLetter(firstCol)}${r}:${colLetter(firstCol + N - 1)}${r}`;
  const gtCached = inclAll.slice(0, N).reduce((s, v) => s + (v ?? 0), 0);
  setFormula(ws.getCell(r, totalCol), fcell(`SUM(${gtRange})`, gtCached), NUMFMT.money);
  fillRange(ws, r, 1, r, totalCol, ARGB.navy);
  for (let c = 1; c <= totalCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.white } };
  const scheduleTotalAddr = `${SHEETS.capex}!$${colLetter(totalCol)}$${r}`;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
  return { scheduleTotalAddr, buildupTotalAddr };
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, capexAddrs: CapexAddrs): void {
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
  setLabel(ws.getCell(`A${r}`), 'Build status: Phase 2 (Capex). Cover, Assumptions, Timeline, Capex and Checks are in place. The remaining calculation sheets (Revenue + Cost of Sales, Opex, Financing, Fixed Assets), the financial statements (P&L, Cash Flow, Balance Sheet) and Returns are added in subsequent phases, each formula-linked to the Assumptions.', { });
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
    [SHEETS.capex, 'Development cost build-up and phased schedule'],
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
