/**
 * formulaWorkbook.ts (2026-09-27)
 *
 * THE FORMULA-LINKED EXCEL EXPORT, built beside the hardcoded one, which does
 * not change at all.
 *
 * HOW IT IS BUILT. The hardcoded workbook is built first, exactly as the normal
 * export builds it, with the cell registry recording where each quantity
 * lands. Then each LIVE LAYER (one per stage, in dependency order) overwrites the
 * cells it owns with Excel formulas that reproduce the platform's rules, each
 * formula carrying the platform value as its cached result. So the file opens
 * showing the platform's numbers, recalculates when an input changes, and every
 * sheet not yet made live still shows the platform's values and SAYS SO.
 *
 * WHY NOT THE OLD FORMULAS. buildModelWorkbook still carries formulas from the
 * 2026-06-11 live build, flattened to constants by `setStaticMode(true)`. They
 * belong to a deliberately simplified twin model (`liveModel.ts`), which on
 * 2026-08-11 put a Project IRR of 177.3% on the Summary against the platform's
 * 10.9%. Turning static mode off would bring that second model back, so this
 * export never does: every live formula here is written by a layer that mirrors
 * the ENGINE, and each is proved in real Excel against the platform
 * (scripts/verify-formula-workbook.ts).
 *
 * HONEST LABELLING. A sheet is 'live' (every derived figure a formula), 'partial'
 * (named parts live) or 'values' (platform values, not yet live). Every
 * statement the hardcoded build makes about "a hardcoded snapshot" is rewritten
 * from the sheet's real status, so no sheet ever claims to be live when it is
 * not, or static when it is live.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import { buildModelWorkbook, enableIterativeCalc, type BuildModelOptions } from './buildModelWorkbook';
import { CellRegistry, setCellSink } from './cellRegistry';
import { settlePending } from './liveLayers/writer';
import { stage1LandArea } from './liveLayers/stage1LandArea';
import { stage2Capex } from './liveLayers/stage2Capex';
import { stage3Revenue } from './liveLayers/stage3Revenue';
import { stage3Cos } from './liveLayers/stage3Cos';
import { stage3Opex } from './liveLayers/stage3Opex';
import { stage4Schedules } from './liveLayers/stage4Schedules';
import { stage5Statements } from './liveLayers/stage5Statements';
import { stage6Loop } from './liveLayers/stage6Loop';
import { stage7Returns } from './liveLayers/stage7Returns';
import { stage7bMetrics } from './liveLayers/stage7bMetrics';
import { stage7cChecks } from './liveLayers/stage7cChecks';
import { stage7dSummary } from './liveLayers/stage7dSummary';
import { stage8Schedules, stage8FundFees } from './liveLayers/stage8Schedules';
import { stage8Capex7 } from './liveLayers/stage8Capex7';
import { stage9InputLinks } from './liveLayers/stage9InputLinks';
import { simplifyWorkbook, dropNumberWrappers } from './liveLayers/simplify';
import { storeComputedValues } from './liveLayers/evaluate';
import { computedCells } from './liveLayers/writer';
import { linkPeriodHeaders } from './liveLayers/foundations';

export type SheetStatus = 'live' | 'partial' | 'values' | 'values-by-design' | 'front';

export interface LayerContext {
  wb: ExcelJS.Workbook;
  reg: CellRegistry;
  opts: BuildModelOptions;
  /** Addresses waiting for a later stage, shared by every layer of the build (writer.ts). */
  pending: Set<string>;
  /** The later stages that made themselves live in this build, so a sheet's note can stop saying it waits for them. */
  settled: Set<LaterStage>;
}

/** A stage an earlier layer's figures can wait for. */
export type LaterStage = 'financing';

/**
 * WHAT A SHEET WAITS FOR IS DECIDED AFTER EVERY LAYER HAS RUN (2026-09-28). A layer
 * cannot know whether a later stage will make its pending figures live (that stage
 * may refuse the model), so it states both sentences and the build picks one: `text`
 * while the stage has not settled, `after` once it has, and the sheet's status moves
 * to `afterStatus` when the wait was all that kept it partial.
 */
export interface SheetWait { on: LaterStage; text: string; after: string; afterStatus?: 'live' | 'partial' }

export interface LiveLayer {
  /** Short name, for reports and commit notes. */
  name: string;
  /** Apply the layer. Returns the status each sheet it touched now has, and a
   *  note per sheet saying what is live on it (shown on the sheet). */
  apply(ctx: LayerContext): Array<{
    sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number;
    /** Addresses ("Sheet!R1C2") whose value waits for a stage not yet live. */
    pending?: string[];
    /** A sentence that holds only until a later stage settles (see SheetWait). */
    waits?: SheetWait;
  }>;
}

/** The layers, in dependency order. */
// Revenue before Capex: Capex's selling costs read the revenue a line earns.
export const LIVE_LAYERS: LiveLayer[] = [stage1LandArea, stage3Revenue, stage2Capex, stage3Cos, stage3Opex, stage4Schedules, stage6Loop, stage5Statements, stage8Schedules, stage8FundFees, stage8Capex7, stage7Returns, stage7bMetrics, stage7cChecks, stage7dSummary, stage9InputLinks];

/** Sheets that are values by the founder's decision (2026-09-27), never live. */
const BY_DESIGN: Record<string, string> = {
  Scenarios: 'VALUES BY DESIGN: a live workbook models the case that was exported; the other cases are the platform\'s results as of export.',
};
const FRONT = new Set(['Cover', 'Guide']);

export interface FormulaWorkbookResult {
  wb: ExcelJS.Workbook;
  registry: CellRegistry;
  status: Map<string, { status: SheetStatus; note: string; formulas: number }>;
  /** Every live address whose value still waits for a later stage (see liveLayers/writer.ts). */
  pending: Set<string>;
}

export function buildFormulaWorkbook(opts: BuildModelOptions): FormulaWorkbookResult {
  // EVERY TAB VISIBLE, IN THE LIVE LAYOUT (2026-10-14). A formula workbook links
  // across its tabs, so the Inputs / Schedules / Outputs filter (which hides
  // tabs) does not apply to it, and the builder lays out every row a formula
  // reads, zero lines included.
  opts = { ...opts, parts: undefined, liveLayout: true };
  const registry = new CellRegistry();
  setCellSink(registry.sink, registry.shift);
  let wb: ExcelJS.Workbook;
  try { wb = buildModelWorkbook(opts); } finally { setCellSink(null); }

  const status = new Map<string, { status: SheetStatus; note: string; formulas: number }>();
  for (const ws of wb.worksheets) {
    if (FRONT.has(ws.name)) status.set(ws.name, { status: 'front', note: '', formulas: 0 });
    else if (BY_DESIGN[ws.name]) status.set(ws.name, { status: 'values-by-design', note: BY_DESIGN[ws.name], formulas: 0 });
    else status.set(ws.name, { status: 'values', note: '', formulas: 0 });
  }
  const pending = new Set<string>();
  const settled = new Set<LaterStage>();
  const waits = new Map<string, SheetWait[]>();
  for (const layer of LIVE_LAYERS) {
    for (const s of layer.apply({ wb, reg: registry, opts, pending, settled })) {
      for (const a of s.pending ?? []) pending.add(a);
      const prev = status.get(s.sheet);
      // A layer that reports a sheet as values has thrown away what earlier layers wrote, waits included.
      if (s.status === 'values') waits.delete(s.sheet);
      if (s.waits) waits.set(s.sheet, [...(waits.get(s.sheet) ?? []), s.waits]);
      status.set(s.sheet, {
        status: s.status,
        note: prev?.note ? `${prev.note} ${s.note}` : s.note,
        formulas: (prev?.formulas ?? 0) + s.formulas,
      });
    }
  }
  for (const [sheet, list] of waits) {
    const st = status.get(sheet); if (!st) continue;
    const open = list.filter((x) => !settled.has(x.on));
    const text = list.map((x) => (settled.has(x.on) ? x.after : x.text)).join(' ');
    const lifted = !open.length && list.every((x) => x.afterStatus === 'live') && st.status === 'partial';
    status.set(sheet, { ...st, status: lifted ? 'live' : st.status, note: [st.note, text].filter(Boolean).join(' ') });
  }
  // ONE PERIOD, ONE COLUMN, NAMED BY TIMELINE: every live period tab's year and index rows link there.
  for (const [sheet, n] of linkPeriodHeaders(wb, registry, pending, [...status].filter(([, s]) => s.status === 'live' || s.status === 'partial').map(([k]) => k))) {
    const st = status.get(sheet); if (st) status.set(sheet, { ...st, formulas: st.formulas + n });
  }
  // Pending settles to a fixed point: a formula written before a pending cell it reads is pending too.
  settlePending(pending);
  // SIMPLE FORMULAS (founder, 2026-10-11): sum chains become SUM over ranges and terms
  // that add nothing go, the arithmetic unchanged (liveLayers/simplify.ts).
  simplifyWorkbook(wb);
  // N() only where a cell can be text or blank (2026-10-20).
  dropNumberWrappers(wb);
  // A CELL THE PLATFORM PRINTS NO FIGURE FOR STORES ITS VALUE (2026-10-20): evaluated from the
  // stored figures it reads, so the file opens showing it (the verifier compares each with Excel, B5).
  storeComputedValues(wb, computedCells(wb));
  // A CIRCULAR CELL NEEDS A STARTING VALUE (the financing loop runs through Financing, Schedules
  // and the statements): Excel iterates from each cell's cached result, and a formula with none
  // enters the loop with nothing to start from and never recovers. Run last, after every rewrite.
  for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => {
    const v = c.value as unknown as { formula?: string; result?: unknown } | null;
    if (v && typeof v === 'object' && typeof v.formula === 'string' && (v.result === undefined || v.result === null)) c.value = { formula: v.formula, result: 0 } as never;
  }));
  // A layer's hidden working sheet is not a tab the reader sees, so it gets no status line.
  for (const ws of wb.worksheets) if (ws.state !== 'visible' && ws.state !== undefined) status.delete(ws.name);
  relabel(wb, status);
  orderTabs(wb);
  writeLoopLinks(wb);
  const problems = exportShapeProblems(wb);
  if (problems.length) throw new Error(`The live workbook failed its shape check: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? ` and ${problems.length - 6} more` : ''}.`);
  return { wb, registry, status, pending };
}

/**
 * THE TAB ORDER IS THE ORDER THE MODEL FLOWS (2026-10-14, founder): inputs, the
 * timeline, the modules, the statements, then returns. Revenue comes before
 * Capex (selling costs charge on it) and Financing after Schedules (the solve's
 * tax reads depreciation). The front tabs, Scenarios and Checks keep their places.
 */
export const TAB_ORDER = ['Cover', 'Guide', 'Summary', 'Inputs', 'Timeline', 'Land & Area', 'Revenue', 'Capex', 'Opex', 'Schedules', 'Financing', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios', 'Checks'];
function orderTabs(wb: ExcelJS.Workbook): void {
  const rest = wb.worksheets.filter((ws) => !TAB_ORDER.includes(ws.name));
  let n = 0;
  const at = (ws: ExcelJS.Worksheet): { orderNo: number } => ws as unknown as { orderNo: number };
  for (const name of TAB_ORDER) { const ws = wb.getWorksheet(name); if (ws) at(ws).orderNo = n++; }
  for (const ws of rest) at(ws).orderNo = n++;
}

/**
 * THE ONE KIND OF READ BACK ALLOWED (2026-10-15): the financing loop's output, the capitalised
 * interest each line takes, read by the tabs before Financing that carry it (Schedules: cost of
 * sales and the held lines' additions; Capex: Table 7). Every other formula reads only the tabs
 * before it. The working sheets the rebuild moved onto the visible tabs are all gone, so no tab
 * may be hidden.
 */
export const LOOP_LINKS: ReadonlyArray<{ from: string; to: string }> = [{ from: 'Schedules', to: 'Financing' }, { from: 'Capex', to: 'Financing' }];
const isLoopLink = (from: string, to: string): boolean => LOOP_LINKS.some((x) => x.from === from && x.to === to);

/**
 * THE SHAPE CHECK (2026-10-14, founder): the export fails rather than ship a
 * hidden tab, a hidden row or column, or a formula that reads a tab the
 * workbook does not have. Grouping is allowed, expanded (a collapsed group
 * hides its rows, which this reads as hidden).
 */
export function exportShapeProblems(wb: ExcelJS.Workbook): string[] {
  const out: string[] = [];
  const names = new Set(wb.worksheets.map((ws) => ws.name));
  const re = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_&.]+))!/g;
  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible' && ws.state !== undefined) out.push(`the tab "${ws.name}" is hidden`);
    for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).hidden) out.push(`${ws.name} row ${r} is hidden`);
    (ws.columns ?? []).forEach((col, i) => { if (col?.hidden) out.push(`${ws.name} column ${i + 1} is hidden`); });
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      const v = cell.value as unknown as { formula?: string } | null;
      if (!v || typeof v !== 'object' || typeof v.formula !== 'string') return;
      // Text in quotes is not a reference: strip string literals first.
      const f = v.formula.replace(/"(?:[^"]|"")*"/g, '""');
      // An empty bracket that is not a function call (`(()>0)`) is a formula Excel will not
      // open the file over (2026-10-15: an empty list of rows joined into a SUMPRODUCT).
      if (/(^|[^A-Za-z0-9_.])\(\s*\)/.test(f)) out.push(`${ws.name}!R${r}C${c} has an empty bracket, which Excel cannot read`);
      for (const m of f.matchAll(re)) {
        const sh = (m[1] ?? m[2]).replace(/''/g, "'");
        if (!names.has(sh)) out.push(`${ws.name}!R${r}C${c} reads the tab "${sh}", which does not exist`);
      }
    }));
  }
  // A read of a later tab is a problem unless it is the loop's own link.
  for (const b of backwardReads(wb)) if (!isLoopLink(b.from, b.to)) out.push(`${b.from} row ${b.row} reads ${b.to}, a later tab`);
  return out;
}

/**
 * THE LIVE WORKBOOK ITERATES FURTHER THAN THE HARDCODED ONE (2026-09-27, stage 6):
 * two coupled fixed-point solves (the fee-free one and the real one) must settle
 * to the platform's exact fixed point, so 1,000 passes to a millionth of a unit.
 * The hardcoded export keeps its own setting, byte-identical.
 */
export const FORMULA_ITERATION = { count: 1000, delta: 0.000001 };
export function enableFormulaIteration(buf: ArrayBuffer): Promise<ArrayBuffer> {
  return enableIterativeCalc(buf, FORMULA_ITERATION);
}

export async function generateFormulaWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const { wb } = buildFormulaWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  return enableFormulaIteration(buf as ArrayBuffer);
}

// ── Honest labelling ─────────────────────────────────────────────────────────

export function sheetStatusSentence(s: { status: SheetStatus; note: string }): string {
  switch (s.status) {
    case 'live': return `LIVE: every derived figure on this sheet is an Excel formula; change a shaded input and it recalculates. ${s.note}`.trim();
    case 'partial': return `PARTLY LIVE: ${s.note} Everything else on this sheet is the platform's value as of export and does NOT recalculate yet.`;
    case 'values-by-design': return s.note;
    case 'values': return `${s.note ? `${s.note} ` : ''}NOT LIVE YET in this build: the figures on this sheet are the platform\'s values as of export and do NOT recalculate when an input changes.`;
    default: return '';
  }
}

function workbookStatusText(status: FormulaWorkbookResult['status']): string {
  const names = (want: SheetStatus[]): string[] => [...status].filter(([, v]) => want.includes(v.status)).map(([k]) => k);
  const live = names(['live']), partial = names(['partial']), notYet = names(['values']), byDesign = names(['values-by-design']);
  return [
    'This is the FORMULA-LINKED model, built in stages beside the hardcoded export.',
    `Live: ${live.length ? live.join(', ') : 'none yet'}.`,
    partial.length ? `Partly live: ${partial.join(', ')}.` : '',
    `Not live yet (platform values as of export; they do NOT recalculate): ${notYet.length ? notYet.join(', ') : 'none'}.`,
    byDesign.length ? `Values by design: ${byDesign.join(', ')}.` : '',
    'Shaded cells are inputs. Iterative calculation is switched on for the circular financing.',
  ].filter(Boolean).join(' ');
}

const HARDCODED = /hardcoded|NOT recalculate|do not recalculate|will NOT recalculate/i;

/** Drop the sentences that claim a hardcoded snapshot and put the true status in their place. */
function rewriteText(text: string, replacement: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !HARDCODED.test(s));
  return [...kept, replacement].filter(Boolean).join(' ').trim();
}

function relabel(wb: ExcelJS.Workbook, status: FormulaWorkbookResult['status']): void {
  const wbText = workbookStatusText(status);
  for (const ws of wb.worksheets) {
    const st = status.get(ws.name);
    const replacement = !st || st.status === 'front' || ws.name === 'Summary' ? wbText : sheetStatusSentence(st);
    ws.eachRow((row) => row.eachCell((cell) => {
      // A merged block's every cell reads and writes its MASTER, so rewriting each one
      // appended the status sentence once per cell (ten copies on a ten-column block).
      if (cell.isMerged && cell.master.address !== cell.address) return;
      if (typeof cell.value === 'string' && HARDCODED.test(cell.value)) cell.value = rewriteText(cell.value, replacement);
      const n = cell.note as unknown as { texts?: Array<{ text: string }> } | string | undefined;
      if (n && typeof n === 'object' && Array.isArray(n.texts)) {
        const t = n.texts.map((x) => x.text).join('');
        if (HARDCODED.test(t)) {
          const paras = t.split('\n\n');
          const out = paras.map((p) => (HARDCODED.test(p) ? rewriteText(p, replacement) : p)).join('\n\n');
          cell.note = { texts: [{ text: out }], margins: { insetmode: 'auto' } } as unknown as ExcelJS.Comment;
        }
      }
    }));
  }
}

/** The tabs a formula may only read forward from, in the flow (front matter and Checks read everything). */
const FLOW = TAB_ORDER.filter((n) => !['Cover', 'Guide', 'Summary', 'Scenarios', 'Checks'].includes(n));

/**
 * EVERY FORMULA THAT READS A LATER TAB (2026-10-15), by row: a flow tab reading a tab after it, or a
 * hidden working sheet. The one allowed kind is the financing loop's output (the capitalised interest
 * Schedules and Capex read back from Financing); `writeLoopLinks` lists those on the Guide.
 */
export function backwardReads(wb: ExcelJS.Workbook): Array<{ from: string; row: number; to: string; toRow: number }> {
  const pos = (n: string): number => FLOW.indexOf(n);
  const out: Array<{ from: string; row: number; to: string; toRow: number }> = [];
  const seen = new Set<string>();
  for (const ws of wb.worksheets) {
    if (pos(ws.name) < 0) continue;
    ws.eachRow((row, r) => row.eachCell((cell) => {
      const v = cell.value as unknown as { formula?: string } | null;
      const f = v && typeof v === 'object' ? v.formula : undefined;
      if (!f) return;
      for (const m of f.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z][A-Za-z0-9&.]*))!\$?[A-Z]{1,3}\$?(\d+)/g)) {
        const name = (m[1] ?? m[2]).replace(/''/g, "'");
        const later = pos(name) > pos(ws.name) || (pos(name) < 0 && / Calc$/.test(name));
        if (!later) continue;
        const k = `${ws.name}|${r}|${name}|${m[3]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ from: ws.name, row: r, to: name, toRow: Number(m[3]) });
      }
    }));
  }
  return out;
}

/** THE LOOP'S LINKS ON THE GUIDE: each row that reads the financing loop's output back, and what it reads. */
function writeLoopLinks(wb: ExcelJS.Workbook): void {
  const guide = wb.getWorksheet('Guide');
  if (!guide) return;
  const label = (sheet: string, row: number): string => String(wb.getWorksheet(sheet)?.getCell(row, 1).value ?? '').trim();
  const links = backwardReads(wb).filter((x) => isLoopLink(x.from, x.to));
  if (!links.length) return;
  const uniq = new Map<string, [string, string]>();
  for (const x of links) {
    const a = `${x.from}: ${label(x.from, x.row)}`, b = `${x.to}: ${label(x.to, x.toRow)}`;
    uniq.set(`${a}|${b}`, [a, b]);
  }
  let r = guide.rowCount + 2;
  const head = guide.getCell(r, 1);
  head.value = 'Links that read a later tab: the financing loop\'s output';
  head.font = { name: 'Calibri', size: 11, bold: true };
  r += 1;
  const note = guide.getCell(r, 1);
  note.value = 'Every other formula reads only the tabs before it. The financing loop solves the capitalised interest, which Schedules (cost of sales and the held lines\' additions) and Capex (Table 7) read back; Excel iterates the loop to the platform\'s fixed point.';
  note.font = { name: 'Calibri', size: 9, italic: true };
  r += 1;
  for (const [a, b] of [...uniq.values()].sort((x, y) => x[0].localeCompare(y[0]))) {
    guide.getCell(r, 1).value = a;
    guide.getCell(r, 2).value = `reads ${b}`;
    r += 1;
  }
}
