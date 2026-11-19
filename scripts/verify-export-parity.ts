/**
 * verify-export-parity.ts (2026-11-18, founder: "Export parity is a hard gate")
 *
 * EVERY PLATFORM CHANGE REACHES ALL THREE EXPORTS. For a real project (each named saved version of the live
 * project), this builds the live Excel workbook, the values Excel workbook and the PDF report from the one saved
 * model, runs the engine on the same model, and checks:
 *
 *   I.  INPUTS: every engine setting in PARITY_INPUTS (the financing, returns, tax, dividend, fund and IDC settings,
 *       the ones added 2026-11-18 among them) is on the live Inputs sheet, the values Inputs sheet and the PDF, each
 *       with the model's value. Every input-styled cell of the live Inputs sheet is the same in the values file.
 *   O.  OUTPUTS: every line of the engine's statements (the P&L, the direct cash flow, the balance sheet, each from
 *       the shared builder the screens, the PDF and the workbooks read) with a figure in it is a row of the live and
 *       of the values workbook carrying the same figures year by year (matched by its figures, since the workbooks
 *       word their rows for reading), and is in the PDF by its label with its total; the headline returns (IRR,
 *       MOIC, NPV of every stream), the exit value gross, less selling costs and net, and who gets what, are in all
 *       three with the engine's figures.
 *
 * Anything missing or different is listed and fails. Needs credentials (run through the suite runner).
 * No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { loadLiveExportInputs, type LiveExportInputs } from './fixtures/liveExportInputs';
import { LIVE_PROJECT_ID } from './fixtures/liveProject';
import { createClient } from '@supabase/supabase-js';
import { generateLiveWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { generateValuesWorkbookBuffer } from '../src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook';
import { generateProjectPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { pdfText } from './pdfTextExtract';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildPLRows, buildDirectCFRows, buildBSRows } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '../src/core/calculations/financials';
import { formatAccounting } from '../src/core/formatters';
import { resolveFundTerms, FEE_BASE_LABELS } from '../src/hubs/modeling/platforms/refm/lib/fundTerms';
import { IDC_INTEREST_METHOD_LABELS, resolveIdcInterestMethod } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * THE LIVE FILE RECALCULATED EQUALS WHAT IT STORES (2026-11-18, founder): the values file is the live file frozen,
 * so a stored figure the formulas do not give back is a published series the engine got wrong. Recalculate every
 * formula in headless LibreOffice and count the cells whose result differs from the stored value.
 */
const SOFFICE = join(process.env.LOCALAPPDATA ?? '', 'LibreOfficeExtract', 'program', 'soffice.exe');
async function libreDiff(buf: Buffer | ArrayBuffer, stored: ExcelJS.Workbook, tag: string): Promise<{ compared: number; diffs: string[]; errors: string[] } | null> {
  if (!existsSync(SOFFICE)) return null;
  const dir = resolve('exports', '.parity'); const outDir = join(dir, 'out'); const prof = join(dir, 'profile', 'user');
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); mkdirSync(prof, { recursive: true });
  writeFileSync(join(prof, 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
  const src = join(dir, `${tag}.xlsx`);
  writeFileSync(src, Buffer.from(buf as ArrayBuffer));
  execFileSync(SOFFICE, [`-env:UserInstallation=file:///${join(dir, 'profile').replace(/\\/g, '/')}`, '--headless', '--norestore', '--calc', '--convert-to', 'xlsx', '--outdir', outDir, src], { timeout: 900_000, stdio: 'pipe' });
  const wb = await loadWb(await (await import('node:fs/promises')).readFile(join(outDir, `${tag}.xlsx`)));
  let compared = 0; const diffs: string[] = []; const errors: string[] = [];
  for (const ws of stored.worksheets) {
    const re = wb.getWorksheet(ws.name);
    ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== 'object' || !('formula' in v) || typeof v.result !== 'number') return;
      const r = re?.getCell(c.address).value as { result?: unknown } | number | null | undefined;
      const x = r && typeof r === 'object' && 'result' in r ? r.result : r;
      if (x && typeof x === 'object' && 'error' in (x as object)) { errors.push(`${ws.name}!${c.address}`); return; }
      if (typeof x !== 'number') return;
      compared++;
      if (Math.abs(x - v.result) > 1e-6 * Math.max(1, Math.abs(v.result))) diffs.push(`${ws.name}!${c.address} stored ${v.result} recalculated ${x}`);
    }));
  }
  return { compared, diffs, errors };
}

let passed = 0, failed = 0;

/**
 * WHERE THE WORKBOOKS PRESENT AN ENGINE LINE DIFFERENTLY, BY DESIGN (the founder's restyled reference layout).
 * Each is named with its reason, its parts are still checked (they are lines of their own), and an allowance the
 * workbooks no longer need fails as stale. The PDF still prints every one of these lines.
 */
const WORKBOOK_LAYOUT: Array<{ sheet: string; label: RegExp; why: string }> = [
  { sheet: 'Cash Flow', label: /^= (Residential Cash Collection|Hospitality EBITDA|Retail NOI)$/, why: 'the workbook Cash Flow lists cash collected and opex paid per line, not the screen statement\'s subtotals by category' },
  { sheet: 'Cash Flow', label: /^Cash Flow from (Investment|Financing)$/, why: 'the workbook Cash Flow is cash only; the screen statement carries the land in kind as a non-cash pair inside these two totals' },
];
const usedAllowances = new Set<string>();
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? `\n         ${detail.split('\n').join('\n         ')}` : ''}`); }
}

type Cell = number | string | null;
const cellVal = (c: ExcelJS.Cell): Cell => {
  const v = c.value as unknown;
  const r = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v && typeof v === 'object' && 'formula' in (v as object) ? 0 : v;
  if (typeof r === 'number') return r;
  if (typeof r === 'string') return r.trim();
  if (r && typeof r === 'object' && 'richText' in (r as object)) return (r as { richText: Array<{ text: string }> }).richText.map((x) => x.text).join('').trim();
  return r == null ? null : String(r);
};
const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.5, 1e-7 * Math.max(Math.abs(a), Math.abs(b)));

async function loadWb(buf: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  // ExcelJS cannot read the chart parts; the cells are all this needs.
  const z = await JSZip.loadAsync(buf);
  for (const n of Object.keys(z.files)) {
    if (z.files[n].dir || !z.file(n)) continue;
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(n)) z.file(n, (await z.file(n)!.async('string')).replace(/<drawing [^>]*\/>/g, '').replace(/<legacyDrawing [^>]*\/>/g, ''));
    if (/^xl\/worksheets\/_rels\//.test(n)) z.file(n, (await z.file(n)!.async('string')).replace(/<Relationship [^>]*Type="[^"]*\/(drawing|vmlDrawing|comments)"[^>]*\/>/g, ''));
  }
  for (const n of Object.keys(z.files)) if (/^xl\/(drawings|charts|comments)\//.test(n)) z.remove(n);
  const ct = await z.file('[Content_Types].xml')!.async('string');
  z.file('[Content_Types].xml', ct.replace(/<Override [^>]*PartName="\/xl\/(drawings|charts|comments)[^>]*\/>/g, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await z.generateAsync({ type: 'nodebuffer' })) as never);
  return wb;
}

/** The input tabs: "Project Inputs" and "Operating Inputs" since 2026-11-18 (founder item 5), or one "Inputs" before. */
const INPUT_TABS = ['Project Inputs', 'Operating Inputs', 'Inputs'];
const inputTabs = (wb: ExcelJS.Workbook): ExcelJS.Worksheet[] => INPUT_TABS.map((n) => wb.getWorksheet(n)).filter((x): x is ExcelJS.Worksheet => !!x);
function valueOnInputs(wb: ExcelJS.Workbook, label: string): Cell | undefined {
  for (const ws of inputTabs(wb)) { const v = valueBeside(ws, label); if (v !== undefined) return v; }
  return undefined;
}

/** The value beside a label on a sheet: the first non-empty cell to the label's right. */
function valueBeside(ws: ExcelJS.Worksheet | undefined, label: string): Cell | undefined {
  if (!ws) return undefined;
  let out: Cell | undefined;
  ws.eachRow((row) => {
    if (out !== undefined) return;
    row.eachCell((c, col) => {
      if (out !== undefined || cellVal(c) !== label) return;
      // THE SPLIT INPUT TABS READ LABEL (C), UNIT (D), VALUE (E) (2026-11-19, the step 3 review): the cell beside a
      // label there is its unit, never its value, so the value is read from E on.
      const from = INPUT_TABS.slice(0, 2).includes(ws.name) && col === 3 ? col + 2 : col + 1;
      for (let k = from; k <= col + 6; k++) { const v = cellVal(row.getCell(k)); if (v !== null && v !== '') { out = v; return; } }
    });
  });
  return out;
}

/** Every row of a sheet as its numeric cells in order (for matching an engine line by its figures). */
function numericRows(ws: ExcelJS.Worksheet | undefined): number[][] {
  const out: number[][] = [];
  ws?.eachRow((row) => {
    const xs: number[] = [];
    row.eachCell((c) => { const v = cellVal(c); if (typeof v === 'number') xs.push(v); });
    if (xs.length) out.push(xs);
  });
  return out;
}
/** Every row of every sheet of a workbook (an engine line may be shown on another tab than its statement's). */
function allRows(wb: ExcelJS.Workbook): number[][] { return wb.worksheets.flatMap((ws) => numericRows(ws)); }
/** True when some row carries the series in order (a contiguous run), as an inflow or as an outflow. */
function hasSeries(rows: number[][], series: number[]): boolean {
  return hasRun(rows, series) || hasRun(rows, series.map((x) => -x));
}
function hasRun(rows: number[][], s: number[]): boolean {
  return rows.some((r) => {
    for (let k = 0; k + s.length <= r.length; k++) {
      let ok = true;
      for (let j = 0; j < s.length && ok; j++) ok = close(r[k + j], s[j]);
      if (ok) return true;
    }
    return false;
  });
}
const anyCell = (wb: ExcelJS.Workbook, sheet: string, v: number): boolean => {
  const ws = wb.getWorksheet(sheet); let hit = false;
  ws?.eachRow((row) => row.eachCell((c) => { const x = cellVal(c); if (!hit && typeof x === 'number' && close(x, v)) hit = true; }));
  return hit;
};

async function runVersion(inp: LiveExportInputs, title: string): Promise<void> {
  console.log(`\n--- ${title} ---`);
  const state = inp.state;
  const p = state.project;
  const common = { state, projectName: inp.projectName, dateLabel: 'parity', displayScale: 'full' as const, caseComparison: inp.caseComparison ?? undefined, parties: inp.parties as never, includeSensitivity: true };
  const built = await generateLiveWorkbook(common);
  if (!built.ok) { check('the live workbook builds', false, `${built.message} ${built.detail}`); return; }
  const live = await loadWb(built.buffer);
  {
    const d = await libreDiff(built.buffer, live, title.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40));
    if (!d) check('R1 LibreOffice is available to recalculate the live file', false, SOFFICE);
    else check(`R1 the live file recalculated in LibreOffice gives back every stored figure (${d.compared} cells, ${d.diffs.length} differ, ${d.errors.length} errors)`, d.compared > 1000 && d.diffs.length === 0 && d.errors.length === 0, [...d.errors.slice(0, 5), ...d.diffs.slice(0, 15)].join('\n'));
  }
  const vals = await loadWb(await generateValuesWorkbookBuffer(common));
  const pdfBytes = await generateProjectPdf({ state, projectName: inp.projectName, versionLabel: inp.versionLabel, versionComment: inp.versionComment, dateLabel: 'parity', selectedModuleKeys: ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'], caseComparison: inp.caseComparison, displayScale: 'millions' } as never);
  const pdfRaw = pdfText(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes as ArrayBuffer));
  const pdf = pdfRaw.replace(/\s+/g, ' ');
  if (process.env.PARITY_DUMP) (await import('node:fs')).writeFileSync(`${process.env.PARITY_DUMP}-${title.replace(/[^A-Za-z0-9]+/g, '_')}.txt`, pdfRaw);
  /** A label in the PDF, read as its words: a narrow column wraps a label and the text comes back in pieces. */
  const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const pdfSquashed = squash(pdf);
  const labelInPdf = (label: string): boolean => pdfSquashed.includes(squash(label));
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, p);
  const cfg = resolveReturnsConfig(p, snap.axisLength);
  const ft = resolveFundTerms(p);
  const m = (v: number): string => formatAccounting(v, 'millions', 1);
  const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;
  /** The PDF carries the label and, within the next 800 characters, one of the value's forms (read as words). */
  const inPdf = (label: string, forms: string[]): boolean => {
    const L = squash(label);
    let i = pdfSquashed.indexOf(L);
    while (i >= 0) { const w = pdfSquashed.slice(i, i + L.length + 800); if (forms.some((f) => w.includes(squash(f)))) return true; i = pdfSquashed.indexOf(L, i + 1); }
    return false;
  };

  // ── I. Inputs ──
  const inputs: Array<{ name: string; label: string; want: number | string; pdfLabel: string; pdfForms: string[] }> = [
    { name: 'IDC method', label: 'IDC method', want: IDC_INTEREST_METHOD_LABELS[resolveIdcInterestMethod(p)], pdfLabel: 'IDC method', pdfForms: [IDC_INTEREST_METHOD_LABELS[resolveIdcInterestMethod(p)]] },
    { name: 'Dividends above retained earnings', label: 'Dividends above retained earnings', want: p.dividendPolicy?.allowAboveRetainedEarnings ? 1 : 0, pdfLabel: 'Dividends above retained earnings', pdfForms: [p.dividendPolicy?.allowAboveRetainedEarnings ? 'Yes' : 'No'] },
    { name: 'Minimum cash reserve', label: 'Minimum cash reserve', want: Number(p.financing?.minimumCashReserve ?? 0), pdfLabel: 'Minimum Cash Reserve', pdfForms: [m(Number(p.financing?.minimumCashReserve ?? 0))] },
    { name: 'Discount rate', label: 'Discount rate', want: cfg.discountRate, pdfLabel: 'Discount rate', pdfForms: [pct(cfg.discountRate)] },
    // Blank on Inputs when none is typed (it then reads the discount rate), so the cell beside the label is its note.
    { name: 'Cost of equity', label: 'Cost of equity', want: p.returns?.costOfEquity === undefined ? 'Blank: the discount rate.' : cfg.costOfEquity, pdfLabel: 'Cost of equity', pdfForms: [pct(cfg.costOfEquity)] },
    ...(cfg.terminalMethod !== 'none' ? [{ name: 'Selling costs at exit', label: 'Selling costs at exit', want: cfg.exitSellingCostRate, pdfLabel: 'Selling costs at exit', pdfForms: [pct(cfg.exitSellingCostRate)] }] : []),
    ...(ft.enabled ? [
      { name: 'Structure fee basis', label: 'Structure fee basis', want: ft.structureFeeBasis === 'total_development_cost' ? 'Total development cost (excl. IDC)' : 'Fund size (debt + equity funding need)', pdfLabel: 'Fund structure fee', pdfForms: [FEE_BASE_LABELS[ft.structureFeeBasis === 'total_development_cost' ? 'total_development_cost' : 'fund_size']] },
      { name: 'Arranging fee basis', label: 'Arranging fee basis', want: ft.arrangingFeeBasis === 'debt_share_cash_cost' ? 'Debt share x cash development cost' : 'Total facility (capex debt + IDC)', pdfLabel: 'Debt arranging fee', pdfForms: [FEE_BASE_LABELS[ft.arrangingFeeBasis === 'debt_share_cash_cost' ? 'debt_share_cash_cost' : 'total_facility']] },
    ] : []),
  ];
  const badIn: string[] = [];
  for (const x of inputs) {
    for (const [nm, wb] of [['live', live], ['values', vals]] as const) {
      const got = valueOnInputs(wb, x.label);
      const ok = typeof x.want === 'number' ? typeof got === 'number' && close(got, x.want) : got === x.want;
      if (!ok) badIn.push(`${x.name}: ${nm} Inputs has ${JSON.stringify(got)}, the model ${JSON.stringify(x.want)}`);
    }
    if (!inPdf(x.pdfLabel, x.pdfForms)) badIn.push(`${x.name}: the PDF has no "${x.pdfLabel}" with ${x.pdfForms.join(' / ')}`);
  }
  check(`I1 ${inputs.length} settings are in the live and values Inputs and the PDF, with the model's value`, badIn.length === 0, badIn.join('\n'));
  // Every input-styled cell of the live Inputs sheet is the same in the values file.
  {
    const bad: string[] = []; let n = 0;
    for (const li of inputTabs(live)) {
    const vi = vals.getWorksheet(li.name);
    if (!vi) bad.push(`the values file has no ${li.name} tab`);
    li.eachRow((row, r) => row.eachCell((c, col) => {
      const v = c.value as unknown;
      if (v && typeof v === 'object' && 'formula' in (v as object)) return;
      const a = cellVal(c); if (a === null || a === '') return;
      n++;
      const b = vi ? cellVal(vi.getCell(r, col)) : null;
      const ok = typeof a === 'number' ? typeof b === 'number' && close(a, b) : a === b;
      if (!ok && bad.length < 20) bad.push(`${li.name}!${c.address}: live ${JSON.stringify(a)} values ${JSON.stringify(b)}`);
    }));
    }
    check(`I2 every typed cell of the live input tabs is the same in the values file (${n} cells)`, bad.length === 0 && n > 200, bad.join('\n'));
  }

  // ── O. Outputs ──
  const labels = getFinancialLabels(p.financialTerminology ?? defaultTerminologyForCountry(p.country));
  const ctx = { snap, state, labels, filterPhaseId: '__all__', fmt: m };
  const N = snap.axisLength;
  const groups: Array<{ name: string; sheet: string; rows: Array<{ label: string; values: number[]; totalOverride?: string; isSection?: boolean; valueKind?: string }> }> = [
    { name: 'P&L', sheet: 'P&L', rows: buildPLRows(ctx) as never },
    { name: 'Cash Flow', sheet: 'Cash Flow', rows: buildDirectCFRows(ctx) as never },
    { name: 'Balance Sheet', sheet: 'Balance Sheet', rows: buildBSRows(ctx).rows as never },
  ];
  for (const g of groups) {
    const lr = allRows(live), vr = allRows(vals);
    const bad: string[] = []; let n = 0;
    for (const row of g.rows) {
      if (row.isSection || !row.label) continue;
      const v = row.values.slice(0, N);
      if (!v.some((x) => Math.abs(x ?? 0) > 0.5) || (row.valueKind && row.valueKind !== 'money')) continue;
      n++;
      const allowed = WORKBOOK_LAYOUT.find((a) => a.sheet === g.sheet && a.label.test(row.label));
      const inLive = hasSeries(lr, v), inVals = hasSeries(vr, v);
      if (allowed) {
        // A NAMED LAYOUT DIFFERENCE IS STILL MEASURED: it is used while some line under it is not in the workbooks,
        // and the final check (A1) fails it as stale once every such line is carried in every version.
        if (!(inLive && inVals)) usedAllowances.add(allowed.why);
      } else {
        if (!inLive) bad.push(`"${row.label}": no row of the live workbook carries its figures`);
        if (!inVals) bad.push(`"${row.label}": no row of the values workbook carries its figures`);
      }
      if (!labelInPdf(row.label)) bad.push(`"${row.label}": not in the PDF`);
    }
    check(`O1 ${g.name}: every engine line with a figure (${n}) is in the live and values workbooks with its figures, and in the PDF`, bad.length === 0 && n > 3, bad.slice(0, 25).join('\n'));
  }
  // Headline returns and the exit value, on the Returns sheets and in the PDF.
  {
    const r = rs.result;
    const items: Array<{ name: string; v: number | null; pdfForms: string[] }> = [
      { name: 'project IRR', v: r.fcff.irr, pdfForms: r.fcff.irr === null ? [] : [pct(r.fcff.irr), `${(r.fcff.irr * 100).toFixed(1)}%`] },
      { name: 'project NPV', v: r.fcff.npv, pdfForms: [m(r.fcff.npv)] },
      { name: 'equity IRR (FCFE)', v: r.fcfe.irr, pdfForms: r.fcfe.irr === null ? [] : [pct(r.fcfe.irr), `${(r.fcfe.irr * 100).toFixed(1)}%`] },
      { name: 'equity NPV (FCFE)', v: r.fcfe.npv, pdfForms: [m(r.fcfe.npv)] },
      { name: 'distributions IRR', v: r.dividends.irr, pdfForms: r.dividends.irr === null ? [] : [pct(r.dividends.irr), `${(r.dividends.irr * 100).toFixed(1)}%`] },
      ...(snap.disposal.booked ? [
        { name: 'gross exit value', v: snap.disposal.grossValue, pdfForms: [m(snap.disposal.grossValue)] },
        { name: 'net exit value', v: snap.disposal.proceeds, pdfForms: [m(snap.disposal.proceeds)] },
      ] : []),
      ...(rs.waterfall.active ? [{ name: 'performance fee', v: rs.waterfall.totalPerformanceFee, pdfForms: [m(rs.waterfall.totalPerformanceFee)] }] : []),
      ...(rs.feeEarners.active ? rs.feeEarners.earners.filter((e) => e.totalFeeIncome > 0.5).map((e) => ({ name: `who gets what: ${e.name}`, v: e.totalFeeIncome, pdfForms: [m(e.totalFeeIncome)] })) : []),
    ];
    const bad: string[] = [];
    for (const it of items) {
      if (it.v === null) continue;
      if (!anyCell(live, 'Returns', it.v)) bad.push(`${it.name}: not on the live Returns sheet (${it.v})`);
      if (!anyCell(vals, 'Returns', it.v)) bad.push(`${it.name}: not on the values Returns sheet (${it.v})`);
      if (it.pdfForms.length && !it.pdfForms.some((f) => pdf.includes(f))) bad.push(`${it.name}: not in the PDF (${it.pdfForms.join(' / ')})`);
    }
    check(`O2 the headline returns, the exit value and who gets what (${items.length}) are on both Returns sheets and in the PDF`, bad.length === 0, bad.join('\n'));
  }
}

(async () => {
  console.log('=== verify-export-parity ===');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Every saved version of the live project from v1.1 on: the version the reference was made from and every
  // later one (the training model match), so a setting only a later version uses is exercised too.
  const { data, error } = await sb.from('refm_project_versions').select('id, label, created_at').eq('project_id', LIVE_PROJECT_ID).gte('created_at', '2026-09-27').order('created_at', { ascending: true });
  if (error || !data?.length) { check('the live project has saved versions to check', false, error?.message ?? 'none'); }
  for (const v of (data ?? []) as Array<{ id: string; label: string | null }>) {
    const inp = await loadLiveExportInputs(LIVE_PROJECT_ID, v.id);
    await runVersion(inp, `${inp.projectName}, ${v.label ?? v.id}`);
  }
  const stale = WORKBOOK_LAYOUT.filter((a) => !usedAllowances.has(a.why)).map((a) => a.why);
  check('A1 every named workbook layout difference still occurs (none stale)', stale.length === 0, stale.join('\n'));
  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
