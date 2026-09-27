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
import { stage1LandArea } from './liveLayers/stage1LandArea';

export type SheetStatus = 'live' | 'partial' | 'values' | 'values-by-design' | 'front';

export interface LayerContext {
  wb: ExcelJS.Workbook;
  reg: CellRegistry;
  opts: BuildModelOptions;
}

export interface LiveLayer {
  /** Short name, for reports and commit notes. */
  name: string;
  /** Apply the layer. Returns the status each sheet it touched now has, and a
   *  note per sheet saying what is live on it (shown on the sheet). */
  apply(ctx: LayerContext): Array<{ sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number }>;
}

/** The layers, in dependency order. */
export const LIVE_LAYERS: LiveLayer[] = [stage1LandArea];

/** Sheets that are values by the founder's decision (2026-09-27), never live. */
const BY_DESIGN: Record<string, string> = {
  Scenarios: 'VALUES BY DESIGN: a live workbook models the case that was exported; the other cases are the platform\'s results as of export.',
};
const FRONT = new Set(['Cover', 'Guide']);

export interface FormulaWorkbookResult {
  wb: ExcelJS.Workbook;
  registry: CellRegistry;
  status: Map<string, { status: SheetStatus; note: string; formulas: number }>;
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
  for (const layer of LIVE_LAYERS) {
    for (const s of layer.apply({ wb, reg: registry, opts })) {
      const prev = status.get(s.sheet);
      status.set(s.sheet, {
        status: s.status,
        note: prev?.note ? `${prev.note} ${s.note}` : s.note,
        formulas: (prev?.formulas ?? 0) + s.formulas,
      });
    }
  }
  relabel(wb, status);
  return { wb, registry, status };
}

export async function generateFormulaWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const { wb } = buildFormulaWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  return enableIterativeCalc(buf as ArrayBuffer);
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
