/**
 * assetTableModel.ts (2026-09-07, land planning step 3)
 *
 * How the Assets table GROUPS and CHECKS, as pure functions.
 *
 * PRESENTATION ONLY. Every number here comes from the existing engine
 * helpers (`computeAssetLandSqm`, `computeLandLandChain` is not involved);
 * this file decides which asset appears under which plot and whether a plot's
 * assets add up. Nothing in the calculation engine calls it, and it computes
 * no model value of its own.
 *
 * A PLOT IS A PARCEL. The reference workbook is one flat table whose rows
 * carry a cluster column; this platform groups the rows under the plot they
 * draw from, which is the same information with the repetition removed, plus
 * the one thing the flat table cannot show: whether a plot is fully drawn.
 *
 * AN ASSET BELONGS TO EXACTLY ONE PLOT (2026-09-08). Two plots for one
 * building is modelled by merging the plots or by splitting the building into
 * two assets, which is the same model with one less special case. Measured
 * before removing it: across 1406 stored versions and 9399 asset rows, ZERO
 * used a multi-parcel split, so nothing live was lost.
 *
 * TWO THINGS AN ASSET CAN BE:
 *   - drawn from ONE parcel: it sits under that plot, and the plot's check is
 *     a simple sum of the assets under it.
 *   - drawn from NO specific parcel (a weighted-average or custom-rate
 *     sentinel, or nothing at all): it sits in a final group of its own
 *     rather than being hidden or silently attached to plot one. This is not
 *     an edge case: 6860 of those 9399 rows are on a sentinel.
 *
 * No em dashes in this file.
 */

import { resolveAssetPlotDraw } from '@/src/core/calculations';
import { groupAssetsForConsolidation, type NormaliseTypeId } from '@/src/core/calculations/consolidation';
import type { Asset, Parcel } from '../../../lib/state/module1-types';
import { isParcelSentinel } from '../../../lib/state/module1-types';

/** The bucket for assets that name no real parcel. Not a parcel id, and
 *  deliberately not a valid one, so it can never collide. */
export const UNPLOTTED_GROUP = '__unplotted__';

export interface AssetPlotGroup {
  /** The parcel id, or UNPLOTTED_GROUP. */
  key: string;
  parcel?: Parcel;
  assets: Asset[];
  /** The parcel's own area, when this group is a real parcel. */
  parcelAreaSqm?: number;
  /** What the assets under this plot draw from it. A plain sum, now that an
   *  asset belongs to exactly one plot. */
  allocatedSqm: number;
  /** parcelArea - allocated. Positive means the plot is not fully drawn;
   *  negative means it is over-drawn. Absent for the unplotted group, which
   *  has no area to check against. */
  remainingSqm?: number;
  /** 'ok' within half a sqm, else 'under' or 'over'. Absent for unplotted. */
  status?: 'ok' | 'under' | 'over';
}

/** How much of ONE parcel an asset draws: its explicit sqm when it names that
 *  parcel, and nothing otherwise. An asset naming no real parcel draws nothing
 *  FROM A NAMED PLOT, which is exactly what puts it in the unplotted group. */
/**
 * THE CHECK MUST SUM WHAT THE ENGINE DRAWS, not the raw stored field.
 *
 * This read `landAllocation.sqm` directly, so it was a THIRD answer to "how
 * much does this asset take from this plot", beside the two in the engine. It
 * reported a plot as under-drawn while the engine drew the whole thing, which
 * is worse than either number being wrong: the check that exists to catch a
 * mismatch was itself the mismatch. It now delegates to the one rule.
 */
export function assetDrawFromParcel(
  asset: Asset,
  parcelId: string,
  parcels: readonly Parcel[],
  assets: readonly Asset[],
): number {
  const named = asset.landAllocation?.parcelId;
  if (named !== parcelId || isParcelSentinel(named)) return 0;
  const draw = resolveAssetPlotDraw(asset, parcels as Parcel[], assets as Asset[]);
  return draw ? draw.sqm : 0;
}

/** The plot an asset belongs to: the parcel it names, or the unplotted group. */
export function primaryParcelId(asset: Asset): string {
  const named = asset.landAllocation?.parcelId;
  if (named && !isParcelSentinel(named)) return named;
  return UNPLOTTED_GROUP;
}

/**
 * Group the assets under their plots, in parcel order, with the unplotted
 * group last. EVERY parcel appears, including one nothing draws from yet,
 * because an empty plot is a fact worth showing; the unplotted group appears
 * only when something is in it.
 *
 * Companions are excluded: they carry no land of their own (the engine's
 * Rule 2), so filing them under a plot would double-count the check.
 */
export function groupAssetsByPlot(
  assets: readonly Asset[],
  parcels: readonly Parcel[],
): AssetPlotGroup[] {
  const real = assets.filter((a) => a.isCompanion !== true);
  const groups: AssetPlotGroup[] = parcels.map((p) => {
    const mine = real.filter((a) => primaryParcelId(a) === p.id);
    // A SIMPLE SUM OF THE ASSETS UNDER IT, now that an asset belongs to
    // exactly one plot: what is filed here is all that can draw from here.
    const allocatedSqm = mine.reduce((sum, a) => sum + assetDrawFromParcel(a, p.id, parcels, assets), 0);
    const parcelAreaSqm = Math.max(0, p.area);
    const remainingSqm = parcelAreaSqm - allocatedSqm;
    const status: AssetPlotGroup['status'] =
      Math.abs(remainingSqm) < 0.5 ? 'ok' : remainingSqm > 0 ? 'under' : 'over';
    return { key: p.id, parcel: p, assets: mine, parcelAreaSqm, allocatedSqm, remainingSqm, status };
  });

  const unplotted = real.filter((a) => primaryParcelId(a) === UNPLOTTED_GROUP);
  if (unplotted.length > 0) {
    groups.push({ key: UNPLOTTED_GROUP, assets: unplotted, allocatedSqm: 0 });
  }
  return groups;
}

/** One sentence for a plot's check, so the header states the answer rather
 *  than leaving a reader to subtract two numbers. */
export function plotCheckText(g: AssetPlotGroup, fmt: (n: number) => string): string {
  if (g.key === UNPLOTTED_GROUP) {
    return 'These assets do not draw from a specific plot (a weighted average, a custom rate, or no land yet).';
  }
  if (g.status === 'ok') return 'Assets draw exactly this plot\'s area.';
  if (g.status === 'under') return `${fmt(g.remainingSqm ?? 0)} sqm of this plot is not drawn by any asset.`;
  return `Assets draw ${fmt(Math.abs(g.remainingSqm ?? 0))} sqm more than this plot holds.`;
}

/**
 * WHICH SUB-UNITS BELONG TO WHICH CONSOLIDATED LINE.
 *
 * A PURE PARTITION, and it lives here rather than in the tab because the tab's
 * first attempt was a defect that markup could not have shown. That version
 * asked, once per line, "group these sub-units under these assets", handing it
 * the LINE's members but the WHOLE PROJECT's sub-units. The grouping helper's
 * contract is that anything left unmatched is an orphan the user must still be
 * able to reach, so every other line's sub-units came back as an "Unassigned"
 * group under every line: on one live project four sub-units repeated under
 * four headings, on another twelve to fourteen under seven, and every line
 * header printed the same NSA (the project total, 47,500 sqm) because named
 * plus orphans is always the whole project. One wrong argument, three symptoms
 * that each looked like a separate display bug.
 *
 * So the rule is stated once, as a partition: every sub-unit lands in exactly
 * one bucket, the buckets sum to the input, and nothing can appear twice.
 * `stray` holds what belongs to no line (an asset since deleted, or a
 * companion, whose sub-units mirror its parent's and are filtered out by the
 * caller). It is a real bucket, not a leftover: a row nothing shows is a row
 * nobody can delete.
 *
 * PRESENTATION ONLY, like the rest of this file. A sub-unit's `assetId` is
 * untouched; it re-parents onto the line in a later pass, together with the
 * engine's lookup sites and the asset-keyed cost overrides, because a
 * half-moved parent is two answers to one question.
 */
export interface SubUnitLinePartition {
  /** The consolidation key: one type in one phase. */
  key: string;
  phaseId: string;
  typeLabel: string;
  typed: boolean;
  members: Asset[];
  subUnits: SubUnitLike[];
}

/** The little of a sub-unit this partition needs: which asset it hangs off. */
export interface SubUnitLike {
  id: string;
  assetId: string;
}

export function partitionSubUnitsByLine<U extends SubUnitLike>(
  assets: readonly Asset[],
  subUnits: readonly U[],
  phaseIds: readonly string[],
  normaliseTypeId: NormaliseTypeId,
): { lines: Array<SubUnitLinePartition & { subUnits: U[] }>; stray: U[] } {
  const lines = groupAssetsForConsolidation(
    assets as unknown as Parameters<typeof groupAssetsForConsolidation>[0],
    phaseIds,
    normaliseTypeId,
  );
  const claimed = new Set<string>();
  const out = lines.map((line) => {
    const members = line.assets as unknown as Asset[];
    const memberIds = new Set(members.map((m) => m.id));
    const mine = subUnits.filter((u) => memberIds.has(u.assetId));
    for (const u of mine) claimed.add(u.id);
    return {
      key: line.key,
      phaseId: line.phaseId,
      typeLabel: line.typeLabel,
      typed: line.typed,
      members,
      subUnits: mine,
    };
  });
  return { lines: out, stray: subUnits.filter((u) => !claimed.has(u.id)) };
}

// ── WHAT THE SUB-UNITS ARE PARTS OF, and what they add up to ──────────────

export type NsaSource = 'chain' | 'entered' | 'none';

export interface ResolvedNsa {
  value: number;
  source: NsaSource;
}

/**
 * THE WHOLE THAT THE PARTS ARE CHECKED AGAINST.
 *
 * OPT IN, LIKE THE REST OF THE CHAIN. When the area chain is running for a
 * plot it has already worked out that plot's net saleable area, and that is the
 * figure the sub-units are parts of; when it is not, the entered NSA stays the
 * reference exactly as before. The chain is never forced on anyone and never
 * ignored once someone has turned it on.
 *
 * THIS REVERSES A DELIBERATE RULE, so the reason is worth keeping. The check
 * read the ENTERED NSA and nothing else, on the principle that a derivation has
 * no business inside an editing surface. In practice every live asset has an
 * entered NSA of 0, so the check never fired once, on any project: every group
 * read "no NSA entered, so there is nothing to check the parts against" while
 * the chain sat one table above with the answer. A check that cannot fire is
 * not a conservative check, it is an absent one.
 *
 * A CHAIN NSA OF ZERO IS STILL THE CHAIN SPEAKING. It means this plot builds
 * nothing saleable (a full service deduction, say), so parts allocated against
 * it are over-allocated. Falling back to the entered figure there would answer
 * a question the chain has already answered.
 */
export function resolveAssetNsa(
  enteredSqm: number | undefined,
  chainNsaSqm: number | undefined,
): ResolvedNsa {
  if (typeof chainNsaSqm === 'number' && Number.isFinite(chainNsaSqm)) {
    return { value: Math.max(0, chainNsaSqm), source: 'chain' };
  }
  if (typeof enteredSqm === 'number' && Number.isFinite(enteredSqm) && enteredSqm > 0) {
    return { value: enteredSqm, source: 'entered' };
  }
  return { value: 0, source: 'none' };
}

/** One sub-unit, reduced to what a total needs. */
export interface SubUnitValueRow {
  areaSqm: number;
  units?: number;
  rate?: number;
  /** True when the rate is charged per unit or key, false when per sqm. */
  perUnit: boolean;
}

export interface PooledSubUnits {
  areaSqm: number;
  units: number;
  value: number;
  /** Value over area. Zero when there is no area, never a division by zero. */
  blendedRate: number;
  /** True when the rows priced here are not all on the same basis, so the
   *  blended rate mixes a price per unit with a price per sqm. */
  mixedBasis: boolean;
  /** How many rows carried a rate at all, so a caption can say what the
   *  blended figure is actually made of. */
  pricedRows: number;
}

/**
 * TOTAL AREA, TOTAL UNITS, AND A BLENDED RATE THAT IS VALUE OVER AREA.
 *
 * NEVER AN AVERAGE OF RATES. The same rule as the line's blended land rate,
 * for the same reason: averaging two prices weights a 200 sqm shop equally with
 * a 20,000 sqm tower, so the answer moves when you split a row in two. Value
 * over area does not.
 *
 * A row's value is its rate times WHAT THE RATE IS PER: units for a per-unit or
 * per-key price, area for a per-sqm one. `mixedBasis` says when those two have
 * been added together, because a pooled figure over rows priced differently is
 * a real number that a reader should be told the shape of rather than handed
 * flat.
 */
export function poolSubUnits(rows: readonly SubUnitValueRow[]): PooledSubUnits {
  let areaSqm = 0, units = 0, value = 0, pricedRows = 0;
  const bases = new Set<boolean>();
  for (const r of rows) {
    areaSqm += Number.isFinite(r.areaSqm) ? r.areaSqm : 0;
    if (typeof r.units === 'number' && Number.isFinite(r.units)) units += r.units;
    const rate = r.rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate === 0) continue;
    const qty = r.perUnit ? (r.units ?? 0) : r.areaSqm;
    if (!Number.isFinite(qty)) continue;
    value += rate * qty;
    pricedRows += 1;
    bases.add(r.perUnit);
  }
  return {
    areaSqm,
    units,
    value,
    blendedRate: areaSqm > 0 ? value / areaSqm : 0,
    mixedBasis: bases.size > 1,
    pricedRows,
  };
}
