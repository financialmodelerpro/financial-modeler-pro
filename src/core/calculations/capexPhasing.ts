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
  const source = resolvePhasingSource(line, override);

  // The asset curve keeps the line's OWN window: it says how to spread, not
  // when to start. A followed source says both (see the header).
  const assetCurve = asset.capexPhasing;
  const group: EffectivePhasing | undefined = assetCurve
    ? {
        phasing: assetCurve.phasing,
        distribution: assetCurve.distribution,
        startPeriod: fallback.startPeriod,
        endPeriod: fallback.endPeriod,
      }
    : undefined;

  const resolution = resolveInheritance<EffectivePhasing>({
    mode: source,
    own: fallback,
    group,
    derived: {
      land_cash: () => shapeToPhasing(ctx.landCashPerPeriod),
      collections: () => shapeToPhasing(ctx.collectionsPerPeriod),
    },
    fallback,
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
