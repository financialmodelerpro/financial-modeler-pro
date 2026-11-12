/**
 * exportScope.ts (2026-11-12, founder: the export simplification, step 1)
 *
 * THE BUILDER RULES EVERY EXCEL TAB FOLLOWS, BOTH WORKBOOKS (docs/EXPORT_SIMPLIFICATION_PLAN.md):
 *
 *   1. A FEATURE SWITCHED OFF IS NOT BUILT. `notUsedFeatures` is the ONE rule that names
 *      them (escrow at 0%, HQ off, payables at 0 days, no existing position, a zero
 *      statutory reserve, zero opex lines). A tab asks `featureUsed` before it builds a
 *      feature's rows, and Inputs carries one line listing what is not used
 *      (`notUsedLine`), so the reader knows where to turn it on.
 *   2. A ZERO COST LINE IS NOT BUILT. `isZeroLine` is the one test (every period zero
 *      and no typed value), shared so a tab and its total agree on what was left out.
 *   3. A ONE-LINE GROUP SHOWS ONCE. `groupNeedsTotal` is the rule: a group earns its own
 *      total row only with two or more rows; a single row is its own total.
 *
 * Pure: reads the model state, writes nothing. The tabs adopt the rules one by one in
 * the restructure steps; the predicates live here so no tab writes its own version.
 *
 * No em dashes in this file.
 */
import { hqOpexLinesInForce, type OpexLine } from '@/src/core/calculations/opex';

export type ExportFeature = 'escrow' | 'hq' | 'payables' | 'existing' | 'statutoryReserve' | 'opexLines';

/** The words Inputs uses for each feature, in the order the line lists them. */
export const FEATURE_WORDS: Record<ExportFeature, string> = {
  escrow: 'escrow (held at 0%)',
  hq: 'HQ overheads',
  payables: 'payables (0 days)',
  existing: 'an existing position (debt, equity or operations at the start)',
  statutoryReserve: 'statutory reserve (0%)',
  opexLines: 'zero opex lines',
};

/** The slice of the model state the rules read (structural, so any snapshot shape fits). */
export interface ScopeState {
  project: {
    escrow?: { heldPct?: number };
    opexAp?: { defaultApDays?: number };
    statutoryReserve?: { transferRate?: number };
    hqOpex?: { lines?: unknown[] };
    existingRetainedEarnings?: number;
    historicalOpeningCash?: number;
  };
  phases: Array<{ status?: string }>;
  assets: Array<{
    visible?: boolean;
    historicalPreCapexLand?: number;
    historicalPreCapexBuilding?: number;
    historicalPreCapex?: number;
    historicalEquityAmount?: number;
    opex?: { apDaysOverride?: number; lines?: Array<{ value?: number; disabled?: boolean; yoyRates?: number[]; yoyRatesByPhase?: number[]; rateMode?: string }> };
    revenue?: { sell?: { escrow?: { heldPctOverride?: number } } };
  }>;
  financingTranches?: Array<{ origin?: string; openingBalance?: number }>;
}

const pos = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** An opex line with nothing typed: switched off, or every value it could charge is zero. */
function opexLineIsZero(l: { value?: number; disabled?: boolean; rateMode?: string; yoyRates?: number[]; yoyRatesByPhase?: number[] }): boolean {
  if (l.disabled) return true;
  if (l.rateMode === 'yoy') return ![...(l.yoyRates ?? []), ...(l.yoyRatesByPhase ?? [])].some((v) => v !== 0 && Number.isFinite(v));
  return !(typeof l.value === 'number' && l.value !== 0);
}

/** How many opex lines (per asset and HQ) charge nothing. */
export function zeroOpexLineCount(state: ScopeState): number {
  let n = 0;
  for (const a of state.assets) {
    if (a.visible === false) continue;
    for (const l of a.opex?.lines ?? []) if (opexLineIsZero(l)) n++;
  }
  for (const l of hqOpexLinesInForce(state.project.hqOpex?.lines as OpexLine[] | undefined) as Array<{ value?: number; disabled?: boolean }>) if (opexLineIsZero(l)) n++;
  return n;
}

/** Whether a feature is in force on this model. */
export function featureUsed(state: ScopeState, f: ExportFeature): boolean {
  const p = state.project;
  const assets = state.assets.filter((a) => a.visible !== false);
  switch (f) {
    case 'escrow':
      return pos(p.escrow?.heldPct) || assets.some((a) => pos(a.revenue?.sell?.escrow?.heldPctOverride));
    case 'hq':
      return (hqOpexLinesInForce(p.hqOpex?.lines as OpexLine[] | undefined) as Array<{ value?: number; disabled?: boolean }>).some((l) => !opexLineIsZero(l));
    case 'payables':
      return pos(p.opexAp?.defaultApDays) || assets.some((a) => pos(a.opex?.apDaysOverride));
    case 'existing':
      return state.phases.some((ph) => ph.status === 'operational')
        || (state.financingTranches ?? []).some((t) => t.origin === 'existing' || pos(t.openingBalance))
        || pos(p.existingRetainedEarnings) || pos(p.historicalOpeningCash)
        || assets.some((a) => pos(a.historicalPreCapexLand) || pos(a.historicalPreCapexBuilding) || pos(a.historicalPreCapex) || pos(a.historicalEquityAmount));
    case 'statutoryReserve':
      return pos(p.statutoryReserve?.transferRate);
    case 'opexLines':
      // "Used" means no zero line is carried: the rule is about the zero lines themselves.
      return zeroOpexLineCount(state) === 0;
  }
}

/** Every feature this model does not use, in the order Inputs lists them. */
export function notUsedFeatures(state: ScopeState): ExportFeature[] {
  return (Object.keys(FEATURE_WORDS) as ExportFeature[]).filter((f) => !featureUsed(state, f));
}

/** The one line on Inputs, or '' when everything is used. */
export function notUsedLine(state: ScopeState): string {
  const list = notUsedFeatures(state).map((f) => (f === 'opexLines' ? `${zeroOpexLineCount(state)} ${FEATURE_WORDS[f]}` : FEATURE_WORDS[f]));
  if (!list.length) return '';
  return `Not used in this project: ${list.join(', ')}. Turn on in the platform and re-export.`;
}

/** A line every period of which is zero (and so is not built). */
export function isZeroLine(values: ReadonlyArray<number | null | undefined>): boolean {
  return values.every((v) => !v || Math.abs(v) < 1e-9);
}

/** A group shows its own total only with two rows or more; one row is its own total. */
export function groupNeedsTotal(rowsInGroup: number): boolean {
  return rowsInGroup >= 2;
}
