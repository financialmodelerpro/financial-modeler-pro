/**
 * consolidatedLine.ts (2026-09-09, consolidation merge rules)
 *
 * THE FIELDS THAT BELONG TO THE LINE, NOT TO THE PLOT.
 *
 * THE COLLISIONS DISAPPEAR RATHER THAN BEING RESOLVED. Step 2a listed where two
 * plots of one type would disagree: strategy, recognition, indexation, ADR,
 * opex and its indexation, capex phasing, useful life. None of those describes
 * a piece of ground. They describe the thing being built, which is the LINE. So
 * the answer is not a rule for picking between two values; it is that neither
 * plot holds the field any more, and there is nothing to pick between.
 *
 * The merge is therefore UNCONDITIONAL: same type, same phase, one line. A
 * different phase is a different line.
 *
 * WHAT STAYS ON THE PLOT is what is genuinely per plot: land area and rate, and
 * the chain inputs describing that plot's own massing, coverage, FAR, retail
 * share, service share, utilisation and floors. The line SUMS the derived areas
 * and POOLS the land, which is the multi-plot draw returning at the level where
 * it belongs.
 *
 * WHY THIS FILE STILL RESOLVES ANYTHING. The fields have not moved in storage
 * yet, and will not until the step that re-parents sub-units: this pass must
 * change no number and no project. So the line READS them off its members
 * today. With one member, which is every live line on both projects, the line
 * takes that member's value verbatim and nothing merges. With several, the
 * value is taken from the first member and the disagreement is REPORTED, not
 * hidden, so the transitional state can never quietly pick a winner.
 *
 * Pure. No imports. Nothing reads it. No em dashes.
 */

/** Where a line-level value came from. */
export type LineValueSource =
  /** One member: the value is that member's, verbatim. */
  | 'single'
  /** Several members that all agree. */
  | 'agreed'
  /** Several members that do NOT agree. The first member's value is used and
   *  the disagreement is carried on the line for a surface to show. */
  | 'conflict';

export interface LineValue<T> {
  value: T;
  source: LineValueSource;
  /** Every distinct value found, rendered short, when the source is a conflict. */
  others?: string[];
}

/** The shape this needs from a member. Structural, so core stays import-free. */
export interface LineMemberAsset {
  id: string;
  name?: string;
  strategy?: string;
  usefulLifeYears?: number;
  depreciationMethod?: string;
  subUnitMetric?: string;
  capexPhasing?: { phasing?: string };
  managementAgreement?: { managementFeePct?: number; ownerRevenueSharePct?: number };
  opex?: { defaultIndexation?: { method?: string } };
  revenue?: {
    sell?: {
      recognitionProfile?: { method?: string };
      indexation?: { method?: string };
      maxInstalmentYears?: number;
      escrow?: { heldPctOverride?: number };
    };
    operate?: { startingADR?: number };
    lease?: { baseRate?: number };
  };
}

/**
 * THE LINE-LEVEL FIELDS, as data.
 *
 * One entry per field that moves off the plot. The list is the merge rule: a
 * field here belongs to the line, a field absent from it stays on the plot.
 * Keeping it as data rather than as a chain of property reads is what lets the
 * verifier enumerate it and lets step 2a's collision list be compared against
 * it line for line.
 */
export const LINE_LEVEL_FIELDS = [
  'strategy',
  'usefulLifeYears',
  'depreciationMethod',
  'subUnitMetric',
  'capexPhasing.phasing',
  'managementAgreement.managementFeePct',
  'managementAgreement.ownerRevenueSharePct',
  'opex.defaultIndexation.method',
  'revenue.sell.recognitionProfile.method',
  'revenue.sell.indexation.method',
  'revenue.sell.maxInstalmentYears',
  'revenue.sell.escrow.heldPctOverride',
  'revenue.operate.startingADR',
  'revenue.lease.baseRate',
] as const;

/**
 * WHAT STAYS ON THE PLOT, also as data, and also checkable.
 *
 * Named explicitly rather than left as "everything else", so the two lists can
 * be proven disjoint. A field that drifted into both would be a field with two
 * owners, which is the shape of most defects in this codebase.
 */
export const PLOT_LEVEL_FIELDS = [
  'landAllocation',
  'landAreaSqm',
  'landAreaPct',
  'landChain.utilisationPct',
  'landChain.coveragePct',
  'landChain.farRatio',
  'landChain.retailPct',
  'landChain.servicePct',
  'landChain.maxFloors',
  // landChain.retailAreaPerSlotSqm LEFT THIS LIST on 2026-09-09. It is not a
  // plot-level field any more, nor a line-level one: it is ONE PROJECT figure
  // on the standards tab, so it belongs to neither side of a merge and two
  // plots can no longer disagree about it.
] as const;

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function show(v: unknown): string {
  if (v === undefined) return '(not set)';
  if (v === null) return '(null)';
  if (typeof v === 'string') return v.trim() === '' ? '(blank)' : v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v).slice(0, 60);
}

/**
 * IS THIS MEMBER SAYING ANYTHING? Absent, null and an all-whitespace string are
 * all "nothing typed here"; a 0 and a `false` are real answers.
 *
 * This is the platform's standing blank-versus-typed-zero rule, applied to the
 * one place it had been missed.
 */
function isStated(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

/**
 * Resolve ONE line-level field across a line's members.
 *
 * WITH ONE MEMBER THE ANSWER IS THAT MEMBER'S VALUE, and `source` says
 * `single`, which is the whole of the "no number changes" promise: a line with
 * one plot is its plot, unchanged, and nothing is merged, averaged or picked.
 *
 * ABSENCE IS NOT DISAGREEMENT (2026-09-09), and this was found on live rows
 * rather than reasoned about. The first live two-plot line, built by the
 * founder to exercise the merge, reported FIVE conflicts, and every one of them
 * read `<a value> vs null`: the second plot simply had nothing typed on those
 * fields. Counting that as a disagreement puts an amber badge on a line that
 * has exactly one answer, and it would have done so on the first line anyone
 * merged, every time, because the second plot of a pair is usually the emptier
 * one. Only two DIFFERENT STATED values are a conflict.
 *
 * The value returned is the first STATED one, not the first member's, so a line
 * whose first plot is blank still shows the answer its other plot gives instead
 * of an empty cell beside a filled one.
 */
export function resolveLineField<T>(
  members: readonly LineMemberAsset[],
  path: string,
): LineValue<T> {
  const values = members.map((m) => readPath(m, path));
  const first = values[0] as T;
  if (members.length <= 1) return { value: first, source: 'single' };
  const stated = values.filter(isStated);
  // Nobody typed it. That is one answer (none), not a conflict.
  if (stated.length === 0) return { value: first, source: 'agreed' };
  const distinct = [...new Set(stated.map(show))];
  if (distinct.length === 1) return { value: stated[0] as T, source: 'agreed' };
  return { value: stated[0] as T, source: 'conflict', others: distinct };
}

export interface ConsolidatedLineFields {
  /** One entry per LINE_LEVEL_FIELDS path, in the same order. */
  fields: Record<string, LineValue<unknown>>;
  /** Paths whose members disagree. Empty on every live project today. */
  conflicts: string[];
  /** True when the line has exactly one member, so nothing merged at all. */
  singleMember: boolean;
}

export function resolveConsolidatedLine(
  members: readonly LineMemberAsset[],
): ConsolidatedLineFields {
  const fields: Record<string, LineValue<unknown>> = {};
  const conflicts: string[] = [];
  for (const path of LINE_LEVEL_FIELDS) {
    const v = resolveLineField<unknown>(members, path);
    fields[path] = v;
    if (v.source === 'conflict') conflicts.push(path);
  }
  return { fields, conflicts, singleMember: members.length <= 1 };
}

// ── The line's land, pooled from its plots ────────────────────────────────

export interface LinePlotDraw {
  /** The member asset drawing the land. */
  assetId: string;
  /** The plot it draws from, or undefined when it names none. */
  parcelId?: string;
  sqm: number;
  /** The plot's rate per sqm, for the value. */
  rate: number;
  value: number;
}

export interface LineLand {
  draws: LinePlotDraw[];
  totalSqm: number;
  totalValue: number;
  /** Value over area, or 0 when there is no area. The line's blended rate. */
  weightedRate: number;
  /** How many DISTINCT plots feed this line. */
  plotCount: number;
}

/**
 * A LINE POOLS LAND FROM SEVERAL PLOTS, by definition.
 *
 * The multi-plot draw was removed from the plot-level asset earlier, correctly:
 * one asset, one plot, and the plot table got simple. It returns HERE, at the
 * level where pooling is what the thing is. A line of two Branded Villas plots
 * has two draws and one blended rate, and the reference workbook's own type row
 * does exactly this.
 *
 * The draws are passed IN rather than resolved, so this file stays pure and the
 * caller states where each figure came from. That is also what keeps it from
 * becoming a second opinion on the land rules.
 */
export function poolLineLand(draws: readonly LinePlotDraw[]): LineLand {
  const totalSqm = draws.reduce((s, d) => s + Math.max(0, d.sqm), 0);
  const totalValue = draws.reduce((s, d) => s + Math.max(0, d.value), 0);
  return {
    draws: [...draws],
    totalSqm,
    totalValue,
    // A RATE, so it is value over area and never an average of rates: two plots
    // of different sizes at different rates do not blend to their midpoint.
    weightedRate: totalSqm > 0 ? totalValue / totalSqm : 0,
    plotCount: new Set(draws.map((d) => d.parcelId).filter((x) => x !== undefined)).size,
  };
}

/** Sum the derived areas of a line's members. Every figure is additive, which
 *  is why this needs no rule: areas add, and that is the whole of it. */
export function poolLineAreas(
  areas: readonly Partial<Record<string, number | undefined>>[],
  keys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    let sum = 0;
    let any = false;
    for (const a of areas) {
      const v = a[k];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; any = true; }
    }
    // A LINE WITH NO DERIVABLE AREA REPORTS NOTHING, not zero. A zero here
    // would read as "this line builds nothing", which is a different claim.
    if (any) out[k] = sum;
  }
  return out;
}
