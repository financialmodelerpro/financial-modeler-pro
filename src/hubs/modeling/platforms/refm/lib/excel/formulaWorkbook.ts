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
import { stage6Financing } from './liveLayers/stage6Financing';
import { stage6bFinancingSheet } from './liveLayers/stage6bFinancingSheet';
import { stage7Returns } from './liveLayers/stage7Returns';
import { stage7bMetrics } from './liveLayers/stage7bMetrics';

export type SheetStatus = 'live' | 'partial' | 'values' | 'values-by-design' | 'front';

export interface LayerContext {
  wb: ExcelJS.Workbook;
  reg: CellRegistry;
  opts: BuildModelOptions;
  /** Addresses waiting for a later stage, shared by every layer of the build (writer.ts). */
  pending: Set<string>;
}

export interface LiveLayer {
  /** Short name, for reports and commit notes. */
  name: string;
  /** Apply the layer. Returns the status each sheet it touched now has, and a
   *  note per sheet saying what is live on it (shown on the sheet). */
  apply(ctx: LayerContext): Array<{
    sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number;
    /** Addresses ("Sheet!R1C2") whose value waits for a stage not yet live. */
    pending?: string[];
  }>;
}

/** The layers, in dependency order. */
// Revenue before Capex: Capex's selling costs read the revenue a line earns.
export const LIVE_LAYERS: LiveLayer[] = [stage1LandArea, stage3Revenue, stage2Capex, stage3Cos, stage3Opex, stage4Schedules, stage5Statements, stage6Financing, stage6bFinancingSheet, stage7Returns, stage7bMetrics];

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
  for (const layer of LIVE_LAYERS) {
    for (const s of layer.apply({ wb, reg: registry, opts, pending })) {
      for (const a of s.pending ?? []) pending.add(a);
      const prev = status.get(s.sheet);
      status.set(s.sheet, {
        status: s.status,
        note: prev?.note ? `${prev.note} ${s.note}` : s.note,
        formulas: (prev?.formulas ?? 0) + s.formulas,
      });
    }
  }
  // Pending settles to a fixed point: a formula written before a pending cell it reads is pending too.
  settlePending(pending);
  // A layer's hidden working sheet is not a tab the reader sees, so it gets no status line.
  for (const ws of wb.worksheets) if (ws.state !== 'visible' && ws.state !== undefined) status.delete(ws.name);
  relabel(wb, status);
  return { wb, registry, status, pending };
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
