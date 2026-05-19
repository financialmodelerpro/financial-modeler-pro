/**
 * Fixed Asset + Depreciation engine — types.
 *
 * Methodology is anchored to the reference Excel v7.0 fixed-asset block:
 * per-period opening + addition − depreciation = closing roll-forward,
 * straight-line over a per-line useful life, Land excluded from
 * depreciation (life=0 by convention). Component split (Land / Hard /
 * Soft) is wired in Pass 1; finer component lives (Pre-Op + Capitalised
 * Interest @ 7 yrs separate from Construction @ 25 yrs) land later
 * once the financing engine surfaces the capitalised-interest stream.
 *
 * Everything is pure: no Zustand, no React, no store imports. The
 * resolver in src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts
 * bridges the M1 store to this engine.
 */

export type DepreciationMethod = 'straight_line';

/**
 * Input config for a single asset's fixed-asset roll-forward. Pass
 * `additionsLandPerPeriod` so the engine can echo Land additions on
 * the roll-forward while leaving them out of the depreciation base.
 */
export interface AssetFixedAssetConfig {
  assetId: string;
  axisLength: number;
  /**
   * First project-axis index where depreciation begins for additions
   * spent at or before this index. Additions spent AFTER this index
   * start depreciating immediately on their spend year. Set to the
   * asset's handover year (or operations start) for the standard
   * "WIP becomes fixed asset at handover" treatment.
   */
  startIdx: number;

  /** Total additions per period (incl. Land). Length = axisLength. */
  additionsPerPeriod: number[];
  /** Land additions per period (excluded from depreciation). Length = axisLength. */
  additionsLandPerPeriod: number[];

  /** Useful life for new (project-axis) additions, in years. */
  usefulLifeYears: number;
  /**
   * Override useful life for the opening (existing) NBV. Defaults to
   * `usefulLifeYears` when undefined — used when the operator knows
   * how many years of life remain on an existing asset.
   */
  openingRemainingLife?: number;
  /** Opening Net Book Value at axis index 0 (existing operations). */
  openingNBV?: number;
  /** Opening Accumulated Depreciation at axis index 0 (existing operations). */
  openingAccumDep?: number;

  method?: DepreciationMethod;
}

export interface AssetFixedAssetResult {
  assetId: string;
  axisLength: number;
  /** Echo of the input additions (length = axisLength). */
  additionsPerPeriod: number[];
  /** Echo of the input Land additions (length = axisLength). */
  additionsLandPerPeriod: number[];
  /**
   * Additions excluded from the depreciation base = additionsLandPerPeriod.
   * Equivalent to additionsPerPeriod − landAdditionsPerPeriod. Surfaced
   * separately so UI can show "(of which depreciable)" alongside total
   * additions.
   */
  depreciableAdditionsPerPeriod: number[];

  /** Depreciation expense per period (positive number). */
  depreciationPerPeriod: number[];
  /** Cumulative depreciation through the end of each period. */
  accumDepPerPeriod: number[];

  /** Opening NBV per period (closing of prior period). */
  openingNBVPerPeriod: number[];
  /** Closing NBV per period = opening + additions − depreciation. */
  closingNBVPerPeriod: number[];

  /** Total depreciable base contributed across all vintages. */
  totalDepreciableBase: number;
  /** Sum of all additions (incl. Land). */
  totalAdditions: number;
  /** Sum of depreciation over the axis. */
  totalDepreciation: number;
}

export interface ProjectFixedAssetTotals {
  axisLength: number;
  additionsPerPeriod: number[];
  additionsLandPerPeriod: number[];
  depreciableAdditionsPerPeriod: number[];
  depreciationPerPeriod: number[];
  accumDepPerPeriod: number[];
  openingNBVPerPeriod: number[];
  closingNBVPerPeriod: number[];
}
