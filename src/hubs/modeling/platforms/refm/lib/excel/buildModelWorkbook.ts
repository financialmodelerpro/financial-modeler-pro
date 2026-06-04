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
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import {
  ARGB, NUMFMT, fcell, setInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
} from './styles';

export interface BuildModelOptions {
  state: FinancialsResolverState;
  projectName: string;
  dateLabel: string;
}

const SHEETS = { cover: 'Cover', assumptions: 'Assumptions', timeline: 'Timeline', checks: 'Checks' };

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  const snap = computeFinancialsSnapshot(opts.state);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Financial Modeler Pro';
  wb.created = new Date(0); // deterministic (avoid clock for reproducible output)
  wb.calcProperties.fullCalcOnLoad = true;

  addCover(wb, snap, opts); // first tab; index links to the sheets created below
  const refs = addAssumptions(wb, snap, opts);
  addTimeline(wb, snap, refs);
  addChecks(wb, snap);
  return wb;
}

export async function generateModelWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const wb = buildModelWorkbook(opts);
  return wb.xlsx.writeBuffer();
}

// Cell references the rest of the model links to (defined-name targets).
interface AssumptionRefs {
  startYearName: string;
  axisLength: number;
}

// ── Assumptions (Inputs) ──────────────────────────────────────────────────────
function addAssumptions(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions): AssumptionRefs {
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

  ws.views = [{ state: 'frozen', ySplit: 2 }];
  return { startYearName: 'ProjectStartYear', axisLength: snap.axisLength };
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
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>): void {
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.good } } });
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
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Build status: Phase 1 (foundation). Cover, Assumptions, Timeline and Checks are in place. Calculation sheets (Revenue, Capex, Financing, Opex, Fixed Assets), the financial statements (P&L, Cash Flow, Balance Sheet) and Returns are added in subsequent phases, each formula-linked to the Assumptions.', { });
}

// ── Cover / Index ─────────────────────────────────────────────────────────────
function addCover(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions): void {
  const ws = wb.addWorksheet(SHEETS.cover, { properties: { tabColor: { argb: ARGB.navyDark } } });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 48;
  ws.mergeCells('A1:B1');
  setTitle(ws.getCell('A1'), opts.projectName || 'Untitled Project', 22);
  ws.mergeCells('A2:B2');
  setLabel(ws.getCell('A2'), 'Real Estate Financial Model (Excel)', { });
  const p = opts.state.project;
  let r = 4;
  const meta: Array<[string, string]> = [
    ['Date', opts.dateLabel],
    ['Currency', p.currency ?? 'SAR'],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Model horizon', `${snap.axisLength} years (${snap.projectStartYear} to ${snap.projectStartYear + snap.axisLength - 1})`],
  ];
  for (const [k, v] of meta) { setLabel(ws.getCell(`A${r}`), k, { bold: true }); setLabel(ws.getCell(`B${r}`), v); r += 1; }
  r += 1;
  setSectionHeader(ws.getRow(r), 'Contents', 2); r += 1;
  const index = [SHEETS.assumptions, SHEETS.timeline, SHEETS.checks];
  for (const name of index) {
    const cell = ws.getCell(`A${r}`);
    cell.value = { text: name, hyperlink: `#'${name}'!A1` };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.linked }, underline: true };
    r += 1;
  }
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Financial Modeler Pro  ·  financialmodelerpro.com', { });
}
