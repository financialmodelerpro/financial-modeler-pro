/**
 * M2 Revenue Engine, Phase 1 Residential Sell types.
 *
 * Pure TypeScript types for the Sell-strategy engine. Stored on
 * Asset.revenue.sell in module1-types.ts (mirrors this shape). All
 * arrays are project-axis-indexed (arr[0] = first active project year).
 *
 * Pass 7d (2026-05-17) removed multi-cohort (Cohort) + Wafi escrow
 * (WafiEscrowConfig) from the engine. The Advanced cohort modal and
 * the Wafi-style escrow / net-cash columns are gone. Single implicit
 * cohort is driven by the top-level subUnits + cashPaymentProfile +
 * recognitionProfile. Schema fields stay on Asset.revenue.sell as
 * `@deprecated` so older snapshots still parse.
 */

import type { SubUnitMetric } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

// Cohort math semantics. See cohort.ts for the catchup explanation.
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

export interface IndexationConfig {
  method: 'none' | 'single_rate' | 'yoy_compound' | 'step';
  rate?: number;
  startYear?: number;
  steps?: Array<{ year: number; factor: number }>;
}

export interface AssetSellConfig {
  assetId: string;
  subUnits: SellSubUnitConfig[];
  cashPaymentProfile: CashPaymentProfile;
  recognitionProfile: RecognitionProfile;
  indexation: IndexationConfig;
  // Handover year = absolute project period index of construction-end
  // for the asset's phase. Engine reads from project + phases when
  // omitted, but the field is allowed as an override for testing.
  handoverYearOverride?: number;
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
