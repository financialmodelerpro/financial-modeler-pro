import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CostItem {
  id: number;
  name: string;
  method: string;
  value: number;
  startPeriod: number;
  endPeriod: number;
  phasing: string | { type: string; values?: number[] };
  canDelete?: boolean;
}

interface FinancingLineItem {
  name: string;
  total: number;
  debtAmt: number;
  equityAmt: number;
  debtPct: number;
}

interface FinancingResult {
  lineItems: FinancingLineItem[];
  debtAdd: number[];
  debtOpen: number[];
  debtRep: number[];
  debtClose: number[];
  equityAdd: number[];
  eqOpen: number[];
  eqClose: number[];
  interest: number[];
  totalDebt: number;
  totalEquity: number;
  totalInterest: number;
  totalPeriods: number;
}

interface ExportPayload {
  projectName: string;
  projectType: string;
  country: string;
  currency: string;
  modelType: 'monthly' | 'annual';
  projectStart: string;
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;
  projectEndDate: string;
  totalLandArea: number;
  totalLandValue: number;
  landValuePerSqm: number;
  cashValue: number;
  inKindValue: number;
  cashPercent: number;
  inKindPercent: number;
  projectRoadsPct: number;
  projectFAR: number;
  projectNDA: number;
  projectRoadsArea: number;
  totalProjectGFA: number;
  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;
  residentialGFA: number;
  hospitalityGFA: number;
  retailGFA: number;
  residentialBUA: number;
  hospitalityBUA: number;
  retailBUA: number;
  residentialNetSaleable: number;
  hospitalityNetSaleable: number;
  retailNetSaleable: number;
  residentialLandValue: number;
  hospitalityLandValue: number;
  retailLandValue: number;
  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;
  costInputMode: string;
  residentialCosts: CostItem[];
  hospitalityCosts: CostItem[];
  retailCosts: CostItem[];
  interestRate: number;
  financingMode: string;
  globalDebtPct: number;
  capitalizeInterest: boolean;
  repaymentPeriods: number;
  repaymentMethod: string;
  lineRatios: Record<string, number>;
  finRes: FinancingResult | null;
  finHosp: FinancingResult | null;
  finRet: FinancingResult | null;
  totalCapex: number;
  totalDebt: number;
  totalEquity: number;
  projectLabel: string;
  versionLabel: string;
}

// ── Colour constants ──────────────────────────────────────────────────────────
const NAVY   = '1B4F8A';   // primary navy — uniform across all table headers
const WHITE  = 'FFFFFF';
const YELLOW = 'FEF3C7';
const YELLOW_TEXT = '92400E';
const GREEN  = '1B6E50';
const BLUE   = '1B4F8A';   // alias kept for backward compat
const ALT    = 'F0F5FF';
const TOTAL  = 'E8F0FB';
const CONSTR = 'FFF9E6';
const OPS    = 'E8F5FF';

const fill = (rgb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: rgb } });
const font = (bold: boolean, sz: number, color = '000000'): Partial<ExcelJS.Font> => ({ name: 'Calibri', bold, size: sz, color: { argb: color } });
const align = (horizontal: ExcelJS.Alignment['horizontal'], wrap = false): Partial<ExcelJS.Alignment> => ({ horizontal, vertical: 'middle', wrapText: wrap });
const border = (): Partial<ExcelJS.Borders> => ({
  top:    { style: 'thin', color: { argb: 'D0D8E4' } },
  bottom: { style: 'thin', color: { argb: 'D0D8E4' } },
  left:   { style: 'thin', color: { argb: 'D0D8E4' } },
  right:  { style: 'thin', color: { argb: 'D0D8E4' } },
});

function styleCell(cell: ExcelJS.Cell, opts: {
  bold?: boolean; sz?: number; fg?: string; color?: string;
  halign?: ExcelJS.Alignment['horizontal']; numFmt?: string; wrap?: boolean;
}) {
  cell.font      = font(opts.bold ?? false, opts.sz ?? 10, opts.color ?? '000000');
  cell.fill      = opts.fg ? fill(opts.fg) : { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
  cell.alignment = align(opts.halign ?? 'left', opts.wrap);
  cell.border    = border();
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

const NUM  = '#,##0';
const DEC2 = '#,##0.00';
const PCT1 = '0.0%';

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const d: ExportPayload = await req.json();

  // ── White-label cover placeholder ────────────────────────────────────────────
  // TODO: When white-label is enabled, read clientName / clientLogo from the
  // branding_config table (server-side) and apply them to the cover tab here.
  // For now the workbook uses the standard REFM Pro branding.
  // ─────────────────────────────────────────────────────────────────────────────

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'REFM Pro';
  wb.created  = new Date();
  wb.modified = new Date();

  const period = d.modelType === 'monthly' ? 'M' : 'Y';
  const totalPeriods = d.constructionPeriods + d.operationsPeriods;

  // ════════════════════════════════════════════════════════
  // SHEET 1 — INPUTS
  // ════════════════════════════════════════════════════════
  const ws1 = wb.addWorksheet('📋 Inputs', { properties: { tabColor: { argb: NAVY } } });
  ws1.columns = [
    { width: 34 }, { width: 20 }, { width: 22 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];

  const addRow1 = (values: (string | number | null)[], opts: {
    bold?: boolean; sz?: number; fg?: string; color?: string;
    halign?: ExcelJS.Alignment['horizontal']; numFmt?: string;
    mergeEnd?: number;
  }[] ) => {
    const row = ws1.addRow(values);
    row.height = 18;
    values.forEach((_, ci) => {
      const o = opts[ci] ?? opts[0];
      styleCell(row.getCell(ci + 1), o);
    });
    return row;
  };

  // Title
  const t1 = ws1.addRow(['🏗️  REAL ESTATE FINANCIAL MODELING PLATFORM']);
  t1.height = 26;
  styleCell(t1.getCell(1), { bold: true, sz: 13, fg: NAVY, color: WHITE, halign: 'center' });
  ws1.mergeCells(t1.number, 1, t1.number, 7);

  const t2 = ws1.addRow([`Module 1: Project Setup & Financial Structure   |   ${d.projectLabel}  ›  ${d.versionLabel}`]);
  t2.height = 20;
  styleCell(t2.getCell(1), { bold: true, sz: 11, fg: BLUE, color: WHITE, halign: 'center' });
  ws1.mergeCells(t2.number, 1, t2.number, 7);

  ws1.addRow([]);

  // Metadata
  const meta = ws1.addRow([
    'Project:', d.projectLabel, 'Version:', d.versionLabel,
    'Exported:', new Date().toLocaleString(), 'REFM Pro v3',
  ]);
  meta.height = 16;
  ['1B4F8A','000000','1B4F8A','000000','1B4F8A','000000','000000'].forEach((c, i) => {
    styleCell(meta.getCell(i + 1), { sz: 9, fg: 'E8F0FB', color: c, bold: i % 2 === 0 });
  });

  ws1.addRow([]);

  // ── Section helper ──
  const sectionHeader = (ws: ExcelJS.Worksheet, title: string, cols = 7, fg = NAVY) => {
    const r = ws.addRow([title]);
    r.height = 20;
    styleCell(r.getCell(1), { bold: true, sz: 11, fg, color: WHITE, halign: 'center' });
    ws.mergeCells(r.number, 1, r.number, cols);
    return r;
  };

  const subHeader = (ws: ExcelJS.Worksheet, headers: string[], fg = BLUE) => {
    const r = ws.addRow(headers);
    r.height = 16;
    headers.forEach((_, i) => {
      styleCell(r.getCell(i + 1), { bold: true, sz: 10, fg, color: WHITE, halign: 'center' });
    });
    return r;
  };

  const dataRow = (ws: ExcelJS.Worksheet, values: (string | number | null)[], alt: boolean) => {
    const r = ws.addRow(values);
    r.height = 16;
    values.forEach((v, i) => {
      const isNum = typeof v === 'number';
      const fgC = i === 1 ? (alt ? YELLOW : 'EBF5FF') : (alt ? '' : ALT);
      styleCell(r.getCell(i + 1), {
        sz: 10, fg: fgC || undefined,
        bold: i === 0,
        color: i === 1 ? YELLOW_TEXT : '000000',
        halign: i === 0 ? 'left' : isNum ? 'right' : 'left',
        numFmt: isNum ? NUM : undefined,
      });
    });
    return r;
  };

  // ── PROJECT TIMELINE ──
  sectionHeader(ws1, 'PROJECT TIMELINE');
  subHeader(ws1, ['Field', 'Input Value', 'Notes', '', '', '', '']);
  const tlRows: [string, string | number, string][] = [
    ['Project Name',            d.projectName,                                    ''],
    ['Project Type',            d.projectType,                                    'residential | hospitality | mixed-use'],
    ['Country',                 d.country,                                        ''],
    ['Currency',                d.currency,                                       ''],
    ['Model Type',              d.modelType,                                      'monthly | annual'],
    ['Start Date',              d.projectStart,                                   ''],
    ['Construction Duration',   d.constructionPeriods,                            d.modelType === 'monthly' ? 'months' : 'years'],
    ['Operations Duration',     d.operationsPeriods,                              d.modelType === 'monthly' ? 'months' : 'years'],
    ['Total Horizon',           d.constructionPeriods + d.operationsPeriods,      d.modelType === 'monthly' ? 'months' : 'years'],
    ['Project End Date',        d.projectEndDate,                                 'Auto-calculated'],
  ];
  tlRows.forEach(([label, val, note], i) => {
    const r = ws1.addRow([label, val, note]);
    r.height = 16;
    const alt = i % 2 === 0;
    styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
    styleCell(r.getCell(2), { sz: 10, fg: alt ? YELLOW : 'EBF5FF', color: YELLOW_TEXT, halign: 'right', numFmt: typeof val === 'number' ? NUM : undefined });
    styleCell(r.getCell(3), { sz: 10, fg: alt ? '' : ALT });
    ws1.mergeCells(r.number, 3, r.number, 7);
  });
  ws1.addRow([]);

  // ── LAND & AREA ──
  sectionHeader(ws1, 'LAND & AREA');
  subHeader(ws1, ['Parameter', 'Input', 'Calculated Value', '', '', '', '']);
  const landRows: [string, number, string][] = [
    ['Total Land Area (sqm)',   d.totalLandArea,                          `${d.totalLandArea.toLocaleString()} sqm`],
    ['Land Value per sqm',      d.landValuePerSqm,                        `${d.currency} ${Math.round(d.landValuePerSqm).toLocaleString()}`],
    ['Total Land Value',        d.totalLandValue,                         `${d.currency} ${Math.round(d.totalLandValue).toLocaleString()}`],
    ['Cash Land %',             d.cashPercent / 100,                      `${d.currency} ${Math.round(d.cashValue).toLocaleString()}`],
    ['In-Kind Land %',          d.inKindPercent / 100,                    `${d.currency} ${Math.round(d.inKindValue).toLocaleString()}`],
    ['Roads %',                 d.projectRoadsPct / 100,                  `${Math.round(d.projectRoadsArea).toLocaleString()} sqm`],
    ['FAR',                     d.projectFAR,                             `GFA = ${Math.round(d.totalProjectGFA).toLocaleString()} sqm`],
    ['Net Developable Area',    d.projectNDA,                             `${Math.round(d.projectNDA).toLocaleString()} sqm`],
    ['Total GFA',               d.totalProjectGFA,                        `${Math.round(d.totalProjectGFA).toLocaleString()} sqm`],
  ];
  landRows.forEach(([label, val, calc], i) => {
    const r = ws1.addRow([label, val, calc]);
    r.height = 16;
    const alt = i % 2 === 0;
    const isPct = label.includes('%') || label === 'FAR';
    styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
    styleCell(r.getCell(2), { sz: 10, fg: alt ? YELLOW : 'EBF5FF', color: YELLOW_TEXT, halign: 'right', numFmt: isPct ? PCT1 : DEC2 });
    styleCell(r.getCell(3), { sz: 10, fg: alt ? '' : ALT });
    ws1.mergeCells(r.number, 3, r.number, 7);
  });
  ws1.addRow([]);

  // Asset allocation sub-table
  sectionHeader(ws1, 'AREA ALLOCATION BY ASSET', 7, GREEN);
  const areaHdrs = ['Asset', 'Alloc %', 'GFA (sqm)', 'BUA (sqm)', 'Net Saleable', 'Land Value', ''];
  subHeader(ws1, areaHdrs, GREEN);
  const assets: { label: string; pct: number; gfa: number; bua: number; nsa: number; lv: number; show: boolean }[] = [
    { label: 'Residential', pct: d.residentialPercent / 100, gfa: d.residentialGFA, bua: d.residentialBUA, nsa: d.residentialNetSaleable, lv: d.residentialLandValue, show: d.showResidential },
    { label: 'Hospitality',  pct: d.hospitalityPercent / 100,  gfa: d.hospitalityGFA,  bua: d.hospitalityBUA,  nsa: d.hospitalityNetSaleable,  lv: d.hospitalityLandValue,  show: d.showHospitality },
    { label: 'Retail',       pct: d.retailPercent / 100,       gfa: d.retailGFA,       bua: d.retailBUA,       nsa: d.retailNetSaleable,       lv: d.retailLandValue,       show: d.showRetail },
  ].filter(a => a.show);
  assets.forEach((a, i) => {
    const r = ws1.addRow([a.label, a.pct, Math.round(a.gfa), Math.round(a.bua), Math.round(a.nsa), Math.round(a.lv), '']);
    r.height = 16;
    const alt = i % 2 === 0;
    styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
    styleCell(r.getCell(2), { sz: 10, halign: 'right', numFmt: PCT1, fg: alt ? '' : ALT });
    [3, 4, 5, 6].forEach(ci => styleCell(r.getCell(ci), { sz: 10, halign: 'right', numFmt: NUM, fg: alt ? '' : ALT }));
  });
  ws1.addRow([]);

  // ── DEVELOPMENT COSTS ──
  sectionHeader(ws1, 'DEVELOPMENT COSTS');

  const renderCostSection = (costs: CostItem[], label: string) => {
    sectionHeader(ws1, `${label} — DEVELOPMENT COSTS`, 7, GREEN);
    subHeader(ws1, ['Cost Item', 'Method', 'Input Value', 'Total Cost', 'Start Period', 'End Period', 'Phasing']);
    let grandTotal = 0;
    costs.forEach((cost, i) => {
      const alt = i % 2 === 0;
      const r = ws1.addRow([
        cost.name, cost.method, cost.value, cost.value,
        cost.startPeriod, cost.endPeriod,
        typeof cost.phasing === 'string' ? cost.phasing : (cost.phasing as { type: string }).type,
      ]);
      r.height = 16;
      grandTotal += cost.value;
      styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
      styleCell(r.getCell(2), { sz: 10, halign: 'center', fg: alt ? '' : ALT });
      styleCell(r.getCell(3), { sz: 10, fg: alt ? YELLOW : 'EBF5FF', color: YELLOW_TEXT, halign: 'right', numFmt: NUM });
      styleCell(r.getCell(4), { sz: 10, halign: 'right', numFmt: NUM, fg: alt ? '' : ALT });
      styleCell(r.getCell(5), { sz: 10, halign: 'center', fg: alt ? '' : ALT });
      styleCell(r.getCell(6), { sz: 10, halign: 'center', fg: alt ? '' : ALT });
      styleCell(r.getCell(7), { sz: 10, fg: alt ? '' : ALT });
    });
    const tot = ws1.addRow([`TOTAL ${label}`, '', '', grandTotal, '', '', '']);
    tot.height = 18;
    [1, 2, 3].forEach(ci => styleCell(tot.getCell(ci), { bold: true, sz: 10, fg: NAVY, color: WHITE }));
    styleCell(tot.getCell(4), { bold: true, sz: 10, fg: NAVY, color: WHITE, halign: 'right', numFmt: NUM });
    [5, 6, 7].forEach(ci => styleCell(tot.getCell(ci), { bold: true, sz: 10, fg: NAVY, color: WHITE }));
    ws1.addRow([]);
  };

  if (d.costInputMode === 'same-for-all') {
    renderCostSection(d.residentialCosts, 'ALL ASSETS (SHARED)');
  } else {
    if (d.showResidential) renderCostSection(d.residentialCosts, 'Residential');
    if (d.showHospitality) renderCostSection(d.hospitalityCosts, 'Hospitality');
    if (d.showRetail)      renderCostSection(d.retailCosts, 'Retail');
  }

  // ── FINANCING ASSUMPTIONS ──
  sectionHeader(ws1, 'FINANCING ASSUMPTIONS');
  subHeader(ws1, ['Parameter', 'Value', 'Notes', '', '', '', '']);
  const finRows: [string, string | number, string][] = [
    ['Interest Rate (% p.a.)', d.interestRate,   `Annual; periodic = ${d.modelType === 'monthly' ? (d.interestRate / 12).toFixed(3) : d.interestRate.toFixed(3)}%`],
    ['Financing Mode',         d.financingMode === 'fixed' ? 'Fixed Global Ratio' : 'Per Line Item', ''],
    ['Global Debt %',          d.globalDebtPct,  'Applies in fixed mode'],
    ['Global Equity %',        100 - d.globalDebtPct, ''],
    ['Capitalize Interest',    d.capitalizeInterest ? 'Yes' : 'No', 'Interest added to debt balance each period'],
    ['Repayment Method',       d.repaymentMethod === 'fixed' ? 'Fixed Instalments' : 'Cash Sweep', ''],
    ['Repayment Periods',      d.repaymentPeriods, d.modelType === 'monthly' ? 'months' : 'years'],
    ['Grace Period (Construction)', d.constructionPeriods, 'No repayment during construction'],
  ];
  finRows.forEach(([label, val, note], i) => {
    const r = ws1.addRow([label, val, note]);
    r.height = 16;
    const alt = i % 2 === 0;
    const isNum = typeof val === 'number';
    styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
    styleCell(r.getCell(2), { sz: 10, fg: alt ? YELLOW : 'EBF5FF', color: YELLOW_TEXT, halign: 'right', numFmt: isNum ? DEC2 : undefined });
    styleCell(r.getCell(3), { sz: 10, fg: alt ? '' : ALT });
    ws1.mergeCells(r.number, 3, r.number, 7);
  });

  // ════════════════════════════════════════════════════════
  // SHEET 2 — OUTPUTS (Cost + Financing Schedules)
  // ════════════════════════════════════════════════════════
  const maxPer = Math.min(totalPeriods, 30);
  const ws2 = wb.addWorksheet('📊 Schedules', { properties: { tabColor: { argb: GREEN } } });

  // Column widths: label col + period cols
  ws2.columns = [
    { width: 30 },
    ...Array.from({ length: maxPer + 2 }, () => ({ width: 11 })),
  ];

  const periodHdr = (col: number): { style: { fg: string; color: string }; label: string } => {
    const p = col - 2;
    if (p <= d.constructionPeriods)
      return { style: { fg: CONSTR, color: '78350F' }, label: `${period}${p}` };
    return { style: { fg: OPS, color: '1B4F8A' }, label: `${period}${p}` };
  };

  // Title row
  const h1 = ws2.addRow(['📊 OUTPUT SCHEDULES — DEVELOPMENT COST & FINANCING']);
  h1.height = 26;
  styleCell(h1.getCell(1), { bold: true, sz: 13, fg: NAVY, color: WHITE, halign: 'center' });
  ws2.mergeCells(h1.number, 1, h1.number, maxPer + 2);

  const h2 = ws2.addRow([`${d.projectLabel}  ›  ${d.versionLabel}  |  ${d.constructionPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'} Construction + ${d.operationsPeriods} Operations`]);
  h2.height = 18;
  styleCell(h2.getCell(1), { bold: true, sz: 11, fg: BLUE, color: WHITE, halign: 'center' });
  ws2.mergeCells(h2.number, 1, h2.number, maxPer + 2);
  ws2.addRow([]);

  // ── Financing summary per asset ──
  const renderFinancingSchedule = (fin: FinancingResult, assetLabel: string) => {
    // Section header
    const sh = ws2.addRow([`${assetLabel.toUpperCase()} — FINANCING SCHEDULE (${d.currency})`]);
    sh.height = 20;
    styleCell(sh.getCell(1), { bold: true, sz: 11, fg: GREEN, color: WHITE, halign: 'center' });
    ws2.mergeCells(sh.number, 1, sh.number, maxPer + 2);

    // Period header row
    const phRow = ws2.addRow(['Item', 'Total', ...Array.from({ length: maxPer }, (_, i) => `${period}${i}`)]);
    phRow.height = 16;
    styleCell(phRow.getCell(1), { bold: true, sz: 9, fg: NAVY, color: WHITE });
    styleCell(phRow.getCell(2), { bold: true, sz: 9, fg: NAVY, color: WHITE, halign: 'right', numFmt: NUM });
    for (let ci = 3; ci <= maxPer + 2; ci++) {
      const ph = periodHdr(ci);
      styleCell(phRow.getCell(ci), { bold: true, sz: 8, fg: ph.style.fg, color: ph.style.color, halign: 'center' });
    }

    // Schedule rows
    const rows: { label: string; values: number[] }[] = [
      { label: 'Equity Drawdown',  values: fin.equityAdd },
      { label: 'Debt Drawdown',    values: fin.debtAdd },
      { label: 'Debt Balance (Close)', values: fin.debtClose },
      { label: 'Equity Balance (Close)', values: fin.eqClose },
      { label: 'Interest Expense', values: fin.interest },
      { label: 'Debt Repayment',   values: fin.debtRep },
    ];

    rows.forEach((row, ri) => {
      const vals = Array.from({ length: maxPer }, (_, i) => Math.round(row.values[i] ?? 0));
      const rowTotal = vals.reduce((s, v) => s + v, 0);
      const r = ws2.addRow([row.label, rowTotal, ...vals]);
      r.height = 15;
      const alt = ri % 2 === 0;
      styleCell(r.getCell(1), { sz: 9, bold: ri === rows.length - 1, fg: alt ? '' : ALT });
      styleCell(r.getCell(2), { sz: 9, halign: 'right', numFmt: NUM, bold: true, fg: TOTAL, color: NAVY });
      vals.forEach((_, i) => {
        const ci = i + 3;
        const p = i;
        const isConstr = p <= d.constructionPeriods;
        styleCell(r.getCell(ci), {
          sz: 8, halign: 'right', numFmt: NUM,
          fg: alt ? (isConstr ? CONSTR : OPS) : (isConstr ? 'FFF2CC' : 'DAE8FC'),
        });
      });
    });

    // Totals row
    const totRow = ws2.addRow([
      'TOTALS', Math.round(fin.totalDebt + fin.totalEquity),
      ...Array(maxPer).fill(''),
    ]);
    totRow.height = 18;
    styleCell(totRow.getCell(1), { bold: true, sz: 10, fg: NAVY, color: WHITE });
    styleCell(totRow.getCell(2), { bold: true, sz: 10, fg: NAVY, color: WHITE, halign: 'right', numFmt: NUM });
    for (let ci = 3; ci <= maxPer + 2; ci++) {
      styleCell(totRow.getCell(ci), { bold: true, sz: 9, fg: NAVY, color: WHITE });
    }
    ws2.addRow([]);
  };

  if (d.finRes)  renderFinancingSchedule(d.finRes,  'Residential');
  if (d.finHosp) renderFinancingSchedule(d.finHosp, 'Hospitality');
  if (d.finRet)  renderFinancingSchedule(d.finRet,  'Retail');

  // ── Grand summary ──
  sectionHeader(ws2, 'PROJECT FINANCING SUMMARY', maxPer + 2, NAVY);
  const sumRows: [string, number][] = [
    ['Total CAPEX',      Math.round(d.totalCapex)],
    ['Total Debt',       Math.round(d.totalDebt)],
    ['Total Equity',     Math.round(d.totalEquity)],
    ['Debt/CAPEX Ratio', d.totalCapex > 0 ? d.totalDebt / d.totalCapex : 0],
  ];
  sumRows.forEach(([label, val], i) => {
    const r = ws2.addRow([label, val]);
    r.height = 16;
    const alt = i % 2 === 0;
    styleCell(r.getCell(1), { bold: true, sz: 10, fg: alt ? '' : ALT });
    const isPct = label.includes('Ratio');
    styleCell(r.getCell(2), { sz: 10, halign: 'right', numFmt: isPct ? PCT1 : NUM, fg: alt ? TOTAL : ALT, color: NAVY, bold: true });
  });

  // ── Stream response ──
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="REFM_Export.xlsx"',
    },
  });
}
