/**
 * Fixed Asset + Depreciation engine — types (Pass 1d, 2026-05-19).
 *
 * Engine handles ONLY the depreciable roll-forward. Land sits outside
 * the engine — resolver builds a separate Land roll-forward.
 *
 * Methods (Pass 1d, 2026-05-19):
 *   - 'straight_line' (SL): equal per-period charge until fully
 *     written off OR axis end (residual stays as NBV at exit).
 *   - 'reducing_balance' (RB / WDV): per-period charge = NBV × rate.
 *     Asymptotes toward zero; residual NBV at axis end. When
 *     `reducingBalanceRate` is undefined the engine derives it as
 *     `2 / usefulLifeYears` (the standard double-declining-balance
 *     convention) so the same useful-life input drives both methods.
 *
 * Methodology anchored to the reference Excel v7.0 Fixed Asset block:
 * per-period opening + addition − depreciation = closing.
 */

export type DepreciationMethod = 'straight_line' | 'reducing_balance';

/**
 * Input config for a single asset's depreciable roll-forward. Caller
 * separates Land before passing additions in.
 */
export interface AssetFixedAssetConfig {
  assetId: string;
  axisLength: number;
  /**
   * First project-axis index where depreciation begins for additions
   * spent at or before this index. Additions spent AFTER this index
   * start depreciating immediately on their spend year.
   */
  startIdx: number;
  /** DEPRECIABLE additions per period (Land excluded by caller). */
  additionsPerPeriod: number[];
  /** Useful life for new (project-axis) additions, in years. */
  usefulLifeYears: number;
  /**
   * Override useful life for the opening (existing) NBV. Defaults to
   * `usefulLifeYears` when undefined.
   */
  openingRemainingLife?: number;
  /** Opening Net Book Value at axis index 0 (Building basis only). */
  openingNBV?: number;
  /** Opening Accumulated Depreciation at axis index 0. */
  openingAccumDep?: number;
  /** Depreciation method (default 'straight_line'). */
  method?: DepreciationMethod;
  /**
   * Reducing-balance rate as a decimal (e.g. 0.10 = 10%). When
   * `method === 'reducing_balance'` and this is undefined, the engine
   * uses `2 / usefulLifeYears` (double-declining). Ignored when
   * method is straight_line.
   */
  reducingBalanceRate?: number;
}

export interface AssetFixedAssetResult {
  assetId: string;
  axisLength: number;
  method: DepreciationMethod;
  /** Resolved RB rate when method === 'reducing_balance' (echo for UI). */
  effectiveRate?: number;
  /** Echo of the input depreciable additions. */
  additionsPerPeriod: number[];
  /** Depreciation expense per period (positive number). */
  depreciationPerPeriod: number[];
  /** Cumulative depreciation through the end of each period. */
  accumDepPerPeriod: number[];
  /** Opening NBV per period (closing of prior period). Depreciable only. */
  openingNBVPerPeriod: number[];
  /** Closing NBV per period = opening + additions − depreciation. */
  closingNBVPerPeriod: number[];
  /** Total depreciable base contributed across all vintages. */
  totalDepreciableBase: number;
  /** Sum of depreciable additions over the axis. */
  totalAdditions: number;
  /** Sum of depreciation over the axis. */
  totalDepreciation: number;
}
