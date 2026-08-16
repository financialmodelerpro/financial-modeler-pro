/**
 * capexPhasing.ts (2026-08-15)
 *
 * Resolves the EFFECTIVE phasing curve for every cost line on an asset, using
 * the shared inherit-and-override mechanism. Pure.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 *   One curve per asset. Phasing was set line by line and in practice every
 *   line on an asset repeats the same curve, so a user typed the same
 *   percentages five or six times per asset.
 *
 *   RETT follows the land cash outflow. A transfer tax is due when the land
 *   cash is paid, so it must never take the construction curve.
 *
 *   Marketing and commission follow collections. They are paid as a percentage
 *   of cash received, so they arise when collections arrive, not across the
 *   build.
 *
 * HOW IT REACHES THE ENGINE WITHOUT NEW ENGINE MATHS
 *
 * `distributeItemCost` already reads `phasing` / `distribution` / `startPeriod`
 * / `endPeriod` off the line it is handed, and `phasing: 'manual'` with a
 * weight array expresses ANY curve. So a resolved curve is written as exactly
 * that, and the distribution maths is untouched.
 *
 * A FOLLOWED SOURCE REPLACES THE WINDOW, NOT JUST THE SHAPE. If commission
 * follows collections and collections arrive in periods 8 to 14, the line
 * spends in periods 8 to 14. Keeping the line's old construction window and
 * only reshaping inside it would put a sales cost back on the build programme,
 * which is the defect being fixed.
 *
 * THE INERT CASE IS THE IMPORTANT ONE. With no asset curve and no
 * `phasingSource` anywhere (which is every line on every existing project),
 * every line resolves to its own stored phasing, window and distribution. The
 * resolver returns the inputs unchanged and the model is byte-identical.
 *
 * No em dashes in this file.
 */

import type {
  Asset,
  CostLine,
  CostOverride,
  CostPhasing,
  CapexPhasingSource,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { resolveInheritance, type Resolution } from '@/src/hubs/modeling/platforms/refm/lib/state/inheritance';

/** The curve a line will actually spend on. */
export interface EffectivePhasing {
  phasing: CostPhasing;
  distribution?: number[];
  startPeriod: number;
  endPeriod: number;
}

/** What the resolver decided, and why. The UI badges from this rather than
 *  re-deriving it, so the badge and the number cannot disagree. */
export interface PhasingDecision {
  lineId: string;
  effective: EffectivePhasing;
  source: CapexPhasingSource;
  resolution: Resolution<EffectivePhasing>;
}

/**
 * Per-period shapes the derived sources follow. Both are supplied by the
 * caller because both are computed elsewhere in the model: the land cash
 * outflow inside the cost engine, the collections profile by the revenue
 * engine (which runs first and takes no cost input, so there is no circularity).
 *
 * A source that is absent or all-zero yields nothing, and the shared mechanism
 * falls through to the asset curve and then to the line's own setting, flagging
 * `degraded` so the UI can say "set to follow collections, but there are none
 * yet" instead of silently showing an unexplained curve.
 */
export interface CapexPhasingContext {
  /** Land cash outflow per PHASE-RELATIVE period. */
  landCashPerPeriod?: number[];
  /** Sales cash collected per PHASE-RELATIVE period, for THIS asset. */
  collectionsPerPeriod?: number[];
}

/** Normalise a shape into a window plus weights, or undefined when it carries
 *  nothing to follow. Leading and trailing zero periods are trimmed so the
 *  window is the periods the money actually moves in. */
export function shapeToPhasing(shape: number[] | undefined): EffectivePhasing | undefined {
  if (!shape || shape.length === 0) return undefined;
  let first = -1;
  let last = -1;
  let total = 0;
  for (let i = 0; i < shape.length; i += 1) {
    const v = shape[i] ?? 0;
    if (v > 0) {
      if (first < 0) first = i;
      last = i;
      total += v;
    }
  }
  if (first < 0 || total <= 0) return undefined;
  const distribution: number[] = [];
  for (let i = first; i <= last; i += 1) distribution.push((shape[i] ?? 0) / total);
  return { phasing: 'manual', distribution, startPeriod: first, endPeriod: last };
}

/**
 * Convert a PROJECT-axis series into the PHASE-LOCAL index space the cost
 * engine phases on.
 *
 * The engine's local index 0 is the Y0 lump slot (land at project start) and
 * local i >= 1 maps to project index `offset + i - 1`. That inverse mapping is
 * written once here because it is the same rule `capex.ts` and
 * `fixed-assets-resolvers` project WITH, and a second hand-rolled copy is
 * exactly how a curve ends up one period out.
 */
export function projectAxisToPhaseLocal(
  series: number[] | undefined,
  offset: number,
  slots: number,
): number[] | undefined {
  if (!series || series.length === 0 || slots <= 0) return undefined;
  const out = new Array<number>(slots).fill(0);
  for (let i = 1; i < slots; i += 1) {
    const projIdx = offset + i - 1;
    if (projIdx >= 0 && projIdx < series.length) out[i] = series[projIdx] ?? 0;
  }
  return out;
}

/** The shape a revenue snapshot presents to the capex layer. Structural rather
 *  than the concrete `ProjectRevenueSnapshot`, so `@/src/core` keeps no import
 *  back into the platform's revenue resolvers. */
export interface CollectionsSource {
  bySellAsset: Map<string, { cashCollectedPerPeriod?: number[] } | undefined>;
}

/**
 * Phase-local sales collections for one asset (2026-08-16).
 *
 * ONE definition, used by every `computeAssetCost` call site, because this is
 * where the previous divergence lived: the offset arithmetic and the slot count
 * were written out at the single wired site and nowhere else, so a second site
 * copying it by hand is how a curve ends up one period out. A site either calls
 * this or passes nothing.
 *
 * Returns undefined when the asset has no sell result (a Lease or Operate
 * asset, or a project with no revenue yet), which the resolver reports as a
 * degraded follow rather than phasing the line to nothing.
 */
export function collectionsForAsset(
  revenue: CollectionsSource | undefined,
  assetId: string,
  phase: { startDate?: string; constructionPeriods?: number; operationsPeriods?: number },
  projectStartYear: number,
): number[] | undefined {
  const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  return collectionsForAssetAtOffset(
    revenue, assetId, Math.max(0, phaseStartYear - projectStartYear), phase);
}

/**
 * The same thing where the caller ALREADY HOLDS the phase offset.
 *
 * The financing aggregate keeps offsets on its axis (`axis.phaseOffsets`) and
 * uses them to place every other series. Re-deriving the offset from dates
 * there would be a second source for the same number, and the two can disagree
 * on a project whose axis was built from anything other than the raw phase
 * start date. So that path passes its own offset and this is the shared body.
 */
export function collectionsForAssetAtOffset(
  revenue: CollectionsSource | undefined,
  assetId: string,
  offset: number,
  phase: { constructionPeriods?: number; operationsPeriods?: number },
): number[] | undefined {
  const series = revenue?.bySellAsset?.get(assetId)?.cashCollectedPerPeriod;
  if (!series || series.length === 0) return undefined;
  const slots = (phase.constructionPeriods ?? 0) + (phase.operationsPeriods ?? 0) + 2;
  return projectAxisToPhaseLocal(series, offset, slots);
}

/**
 * Total sales cash collected for an asset over the WHOLE hold (2026-08-16).
 *
 * Deliberately summed from the untrimmed project-axis series, NOT from the
 * phase-local array `collectionsForAsset` returns: that one is windowed to the
 * phase for phasing purposes, and a total must not lose cash that arrives
 * outside the window. The two answer different questions and are computed
 * differently on purpose.
 *
 * This is the base for `percent_of_revenue_cash`.
 */
export function collectionsTotalForAsset(
  revenue: CollectionsSource | undefined,
  assetId: string,
): number | undefined {
  const series = revenue?.bySellAsset?.get(assetId)?.cashCollectedPerPeriod;
  if (!series || series.length === 0) return undefined;
  return series.reduce((s, v) => s + (v ?? 0), 0);
}

/**
 * The parcel-driven land value lines, which take NO part in phasing at all.
 *
 * Land cash timing comes from the parcel schedule (the payment terms on the
 * parcel, including a deferred schedule), not from a curve. Letting these lines
 * inherit an asset curve, or presenting them with a phasing control and an
 * inheritance badge, implies a decision the user does not actually have.
 *
 * Identified by base id rather than by stage or method, deliberately:
 *   - `stage === 'land'` would also catch RETT, which is a land-stage cost that
 *     MUST follow the land cash outflow and therefore does participate.
 *   - `method === 'percent_of_cash_land'` would also catch RETT, for the same
 *     reason: RETT is charged on the land value.
 * The two seeded land lines are the parcel value itself, and they are the only
 * lines whose timing is not a choice.
 *
 * Shared by the engine and the row UI so the control and the maths cannot
 * disagree about which lines are exempt.
 */
export function isParcelDrivenLandLine(line: { id: string }): boolean {
  const base = line.id.split('__')[0];
  return base === 'land-cash' || base === 'land-inkind';
}

/** The source a line resolves under, master line merged with any per-asset
 *  override. Absent everywhere means `inherit`, which is what every
 *  pre-existing line carries. */
export function resolvePhasingSource(
  line: CostLine,
  override?: CostOverride,
): CapexPhasingSource {
  if (override && override.overridden !== false && override.phasingSource) return override.phasingSource;
  return line.phasingSource ?? 'inherit';
}

const SOURCE_LABELS: Record<string, string> = {
  land_cash: 'the land cash outflow',
  collections: 'sales collections',
};

/**
 * Resolve one line. `fallback` is what the line would have done before any of
 * this existed (master merged with override), and is what an untouched project
 * always gets back.
 */
export function resolveLinePhasing(
  line: CostLine,
  fallback: EffectivePhasing,
  asset: Asset,
  ctx: CapexPhasingContext,
  override?: CostOverride,
): PhasingDecision {
  // Land value lines never participate: their timing is the parcel schedule.
  if (isParcelDrivenLandLine(line)) {
    return {
      lineId: line.id,
      effective: fallback,
      source: 'own',
      resolution: {
        value: fallback, kind: 'fallback', brokenOut: false, degraded: false,
        reason: 'Land cash timing comes from the parcel schedule, not from a phasing curve.',
      },
    };
  }
  const source = resolvePhasingSource(line, override);

  // The asset curve keeps the line's OWN window: it says how to spread, not
  // when to start. A followed source says both (see the header).
  //
  // THE CURVE IS INDEXED BY ABSOLUTE PERIOD, AND MUST BE SLICED TO THE WINDOW.
  // `distribute('manual', span, weights)` reads `weights[i]` where i counts
  // from the START OF THE LINE'S WINDOW, not from period 0. The asset curve is
  // authored against periods P0..Pn (that is how the control labels it), so
  // handing the whole array to a line that starts at P1 applied the P0 weight
  // to P1, shifted every later weight one period early, and dropped the last
  // one off the end. Measured before this fix: a typed curve of
  // 0 / 10 / 30 / 40 / 20 distributed a P1..P4 line as 0 / 12.5 / 37.5 / 50,
  // which is money moving on a curve the user never entered.
  const assetCurve = asset.capexPhasing;
  let group: EffectivePhasing | undefined;
  // Set when a curve EXISTS but covers none of this line's window, so the
  // resolution can say "the asset curve does not cover this row" rather than
  // "the asset curve is not set", which would be false and misdirecting.
  let groupEmpty = false;
  if (assetCurve) {
    if (assetCurve.phasing !== 'manual') {
      group = { phasing: assetCurve.phasing, startPeriod: fallback.startPeriod, endPeriod: fallback.endPeriod };
    } else {
      const full = assetCurve.distribution ?? [];
      const slice = full.slice(fallback.startPeriod, fallback.endPeriod + 1);
      const sum = slice.reduce((s, v) => s + (v ?? 0), 0);
      // A window the curve says nothing about (all zero, or off the end of the
      // array) must NOT become a zero curve: that would distribute nothing and
      // the line's money would vanish. Leaving `group` undefined degrades to
      // the line's own setting, and the shared mechanism reports it.
      if (sum > 0) {
        group = { phasing: 'manual', distribution: slice, startPeriod: fallback.startPeriod, endPeriod: fallback.endPeriod };
      } else {
        group = undefined;
        groupEmpty = true;
      }
    }
  }

  const resolution = resolveInheritance<EffectivePhasing>({
    mode: source,
    own: fallback,
    group,
    derived: {
      land_cash: () => shapeToPhasing(ctx.landCashPerPeriod),
      collections: () => shapeToPhasing(ctx.collectionsPerPeriod),
    },
    fallback,
    groupEmpty,
    groupLabel: 'the asset curve',
    derivedLabels: SOURCE_LABELS,
  });

  return { lineId: line.id, effective: resolution.value, source, resolution };
}

/**
 * True when nothing on this asset opts in, so the caller can skip resolution
 * entirely and stay provably byte-identical. Kept explicit rather than relying
 * on the resolution happening to be an identity, because "we did nothing" is a
 * stronger guarantee than "we did something that cancelled out".
 */
export function capexPhasingIsInert(asset: Asset, lines: CostLine[], overrides: CostOverride[]): boolean {
  if (asset.capexPhasing) return false;
  for (const l of lines) {
    const s = l.phasingSource;
    if (s && s !== 'inherit') return false;
  }
  for (const o of overrides) {
    if (o.assetId !== asset.id) continue;
    if (o.phasingSource && o.phasingSource !== 'inherit') return false;
  }
  return true;
}
