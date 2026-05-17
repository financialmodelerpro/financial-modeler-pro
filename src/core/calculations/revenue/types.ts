/**
 * M2 Revenue Engine - Phase 1 Residential Sell types
 *
 * Pure TypeScript types for the Sell-strategy engine. Schema-side
 * additions live on Asset.revenue.sell (additive on module1-types.ts;
 * no SCHEMA_VERSION bump). All arrays are indexed by project period
 * following the M1 axis convention (arr[0] = first active year, no
 * prior column).
 *
 * The engine matches the MAAD Residential Cashflow v1.16 pattern
 * (root of repo): cash + over-time recognition both use an absolute-
 * year-with-catchup profile. A cohort sold in year N pays / recognizes
 * the cumulative profile through N at year N (lump catchup) then per
 * profile in later years. A 'relative_to_sale' fallback is available
 * per-cohort for markets where the profile is anchored at sale year.
 */

import type { SubUnitMetric } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

// Cohort math semantics. See file header for the catchup explanation.
export type ProfileMode = 'absolute_with_catchup' | 'relative_to_sale';

// Per-sub-unit sales pacing within an asset. Both arrays indexed by
// project period (axis). preSalesVelocity entries sum <= 1.0; the
// residual feeds the post-handover post-sales path.
export interface SellSubUnitConfig {
  subUnitId: string;
  preSalesVelocity: number[];
  postSalesVelocity: number[];
}

// Cash payment milestone profile. percentages sum to 1.0 across the
// cohort. positions[i] = the project-period index where percentages[i]
// applies (absolute_with_catchup mode) or the offset from cohort sale
// year (relative_to_sale mode). When positions is omitted, the engine
// treats percentages[i] as project period i (absolute) or offset i
// (relative).
export interface CashPaymentProfile {
  percentages: number[];
  positions?: number[];
  profileMode?: ProfileMode;
}

// Revenue recognition profile. Point-in-time variant lumps the full
// cohort at handover or sale year (configurable). Over-time variant
// reuses the cohort engine with its own profile + mode.
export interface RecognitionProfile {
  method: 'point_in_time' | 'over_time';
  // point_in_time only:
  pointInTimeYear?: 'handover' | 'sale_year';
  // over_time only:
  percentages?: number[];
  positions?: number[];
  profileMode?: ProfileMode;
}

export interface WafiEscrowConfig {
  enabled: boolean;
  heldPct: number;
  releaseYear: number;
}

export interface IndexationConfig {
  method: 'none' | 'single_rate' | 'yoy_compound' | 'step';
  rate?: number;
  startYear?: number;
  steps?: Array<{ year: number; factor: number }>;
}

// A Cohort is a named launch with its own velocity per sub-unit and
// optional overrides for price and the cash / recognition profiles.
// When AssetSellConfig.cohorts is non-empty the engine sums across
// every cohort to produce the asset-level outputs; the top-level
// config.subUnits + config.cashPaymentProfile + config.recognitionProfile
// then act as fallbacks for any cohort that does NOT override them.
//
// Per-sub-unit velocity in a cohort is interpreted as % of the
// sub-unit's TOTAL area (same convention as the single-cohort path).
// The reconcile.velocity-sum-bound identity sums across cohorts: for
// each sub-unit, sum(cohort[k].subUnits.velocity) <= 1.0.
//
// pricePerSubUnit (optional) overrides the SubUnitMaterial.ratePerArea
// used to value cohort sales (allows multi-phase launches with
// different prices). Indexation still applies on top of the override.
export interface Cohort {
  id: string;
  name: string;
  subUnits: SellSubUnitConfig[];
  cashPaymentProfile?: CashPaymentProfile;
  recognitionProfile?: RecognitionProfile;
  pricePerSubUnit?: Record<string, number>;
}

export interface AssetSellConfig {
  assetId: string;
  subUnits: SellSubUnitConfig[];
  cashPaymentProfile: CashPaymentProfile;
  recognitionProfile: RecognitionProfile;
  escrow: WafiEscrowConfig;
  indexation: IndexationConfig;
  // Handover year = absolute project period index of construction-end
  // for the asset's phase. Engine reads from project + phases when
  // omitted, but the field is allowed as an override for testing /
  // multi-cohort overrides where the handover is forced.
  handoverYearOverride?: number;
  // M2 Pass 4 (2026-05-16): optional per-cohort breakdown. When present
  // AND non-empty, the engine sums across every cohort. When absent or
  // empty, the engine uses the top-level subUnits / cashPaymentProfile
  // / recognitionProfile as a single implicit cohort (Pass 3 path).
  cohorts?: Cohort[];
}

// Per-sub-unit material context the engine pulls from M1 so the math
// stays pure (no store coupling inside revenue/).
export interface SubUnitMaterial {
  id: string;
  area: number;
  count: number;
  ratePerArea: number;
  ratePerUnit: number;
  metric: SubUnitMetric;
}

export interface SellAssetResult {
  assetId: string;
  axisLength: number;
  presalesUnitsPerPeriod: number[];
  presalesAreaPerPeriod: number[];
  presalesRevenuePerPeriod: number[];
  postSalesUnitsPerPeriod: number[];
  postSalesAreaPerPeriod: number[];
  postSalesRevenuePerPeriod: number[];
  cashCollectedPerPeriod: number[];
  recognitionPerPeriod: number[];
  escrowHeldPerPeriod: number[];
  escrowReleasedPerPeriod: number[];
  escrowBalancePerPeriod: number[];
  netCashAvailablePerPeriod: number[];
  // Universal UI rule (2026-05-17): cohort vintage matrices required for
  // every cash + recognition profile so consumers can render the 2D grid
  // (rows = sale year, cols = collection / recognition year) that MAAD
  // ships as the canonical visualisation. Aggregated across cohorts.
  presalesSalesValuePerPeriod: number[];
  cashVintageMatrix: number[][];        // matrix[saleYear][collectionYear]
  recognitionVintageMatrix: number[][]; // matrix[saleYear][recognitionYear]
}

export interface ReconcileIdentity {
  id: string;
  ok: boolean;
  message?: string;
  deltas?: number[];
}

export interface ReconcileReport {
  ok: boolean;
  identities: ReconcileIdentity[];
}
