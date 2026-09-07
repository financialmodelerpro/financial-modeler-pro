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
 * THREE THINGS AN ASSET CAN BE, and all three need a home:
 *   - drawn from ONE parcel: it sits under that plot.
 *   - drawn from SEVERAL (multiParcelSplits): it sits under the parcel it
 *     draws MOST from, and its row says how many parcels it spans, because
 *     the exception must not reshape the table.
 *   - drawn from NO specific parcel (a weighted-average or custom-rate
 *     sentinel, or nothing at all): it sits in a final group of its own
 *     rather than being hidden or silently attached to plot one.
 *
 * No em dashes in this file.
 */

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
  /** What this plot's assets draw FROM THIS PLOT, including the slice of any
   *  multi-parcel asset that names it. */
  allocatedSqm: number;
  /** parcelArea - allocated. Positive means the plot is not fully drawn;
   *  negative means it is over-drawn. Absent for the unplotted group, which
   *  has no area to check against. */
  remainingSqm?: number;
  /** 'ok' within half a sqm, else 'under' or 'over'. Absent for unplotted. */
  status?: 'ok' | 'under' | 'over';
}

/** How much of ONE parcel a single asset draws. Splits win when present, then
 *  an explicit sqm on a real parcel; anything else draws nothing FROM A NAMED
 *  PLOT, which is exactly what puts it in the unplotted group. */
export function assetDrawFromParcel(asset: Asset, parcelId: string): number {
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    return splits
      .filter((s) => s.parcelId === parcelId)
      .reduce((sum, s) => sum + Math.max(0, s.sqm), 0);
  }
  const named = asset.landAllocation?.parcelId;
  if (named === parcelId && !isParcelSentinel(named)) {
    return Math.max(0, asset.landAllocation?.sqm ?? asset.landAreaSqm ?? 0);
  }
  return 0;
}

/** How many distinct parcels an asset draws from. 1 is the ordinary case; the
 *  row only says anything when this is more than 1. */
export function assetParcelCount(asset: Asset): number {
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    return new Set(splits.filter((s) => s.sqm > 0).map((s) => s.parcelId)).size;
  }
  const named = asset.landAllocation?.parcelId;
  return named && !isParcelSentinel(named) ? 1 : 0;
}

/** The plot an asset is FILED under: its only parcel, or the one it draws
 *  most from, or the unplotted group. Ties break on the first split, so the
 *  grouping is stable rather than dependent on object order. */
export function primaryParcelId(asset: Asset): string {
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    let best = splits[0];
    for (const s of splits) if (s.sqm > best.sqm) best = s;
    return best.sqm > 0 ? best.parcelId : UNPLOTTED_GROUP;
  }
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
    // The DRAW is counted across every asset, not just the ones filed here,
    // so a multi-parcel asset's slice still counts toward each plot it names.
    const allocatedSqm = real.reduce((sum, a) => sum + assetDrawFromParcel(a, p.id), 0);
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
