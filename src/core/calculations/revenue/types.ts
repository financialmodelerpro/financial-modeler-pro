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
  method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
  rate?: number;
  startYear?: number;
  steps?: Array<{ year: number; factor: number }>;
  // Pass 8e (2026-05-18): per-year growth array, project-axis-indexed
  // (decimal, e.g. 0.05 = 5%). Used only when method = 'yoy_per_period'.
  // factor[y] = factor[y-1] × (1 + growthPerPeriod[y]) for y > startYear;
  // factor[startYear] = 1. Mirrors MAAD's OOD revenue growth column
  // pattern where each year's escalation can differ.
  growthPerPeriod?: number[];
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
  // Pass 7f (2026-05-17): per-sub-unit breakdowns. Key = sub-unit id,
  // value = project-axis-indexed array. Aggregate arrays above are the
  // sum across sub-units; consumers that need the MAAD-style per-line
  // build (Pre-Sale Area per period per sub-unit, Pre-Sale Revenue per
  // period per sub-unit) read from these.
  presalesAreaPerPeriodPerSubUnit: Record<string, number[]>;
  presalesRevenuePerPeriodPerSubUnit: Record<string, number[]>;
  postSalesAreaPerPeriodPerSubUnit: Record<string, number[]>;
  postSalesRevenuePerPeriodPerSubUnit: Record<string, number[]>;
  // Pass 7y (2026-05-18): per-sub-unit unit counts for units-metric
  // sub-units (e.g., apartments / hotel keys). Zero for sqm-metric
  // sub-units. Lets the UI render Block 1 in the sub-unit's native
  // metric (units when metric='units', sqm otherwise).
  presalesUnitsPerPeriodPerSubUnit: Record<string, number[]>;
  postSalesUnitsPerPeriodPerSubUnit: Record<string, number[]>;
  // Pass 7f: pre / post split of cash + recognition. Cash collected per
  // period = presalesCash + postSalesCash. Recognition per period =
  // presalesRecognition + postSalesRecognition. Post-sales components
  // equal postSalesRevenuePerPeriod (post-sales = cash + recognition in
  // the same period under the operating-sales convention).
  cashCollectedPerPeriod: number[];
  presalesCashPerPeriod: number[];
  postSalesCashPerPeriod: number[];
  recognitionPerPeriod: number[];
  presalesRecognitionPerPeriod: number[];
  postSalesRecognitionPerPeriod: number[];
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

// ───────────────────────────────────────────────────────────────────
// M2 Pass 8: Hospitality (Operate-strategy) revenue types.
//
// Engine math per project-axis period y, inside the operations window:
//   AvailableRoomNights[y] = keys × daysPerYear
//   OccupiedRoomNights[y]  = ARN[y] × occupancy[y]
//   ADR[y]                 = indexed(startingADR, y, adrIndexation)
//   Rooms[y]               = ORN[y] × ADR[y]
//   Guests[y]              = ORN[y] × guestsPerOccupiedRoom
//   F&B[y]                 = ancillary(fb, Rooms[y], Guests[y], y)
//   Other[y]               = ancillary(other, Rooms[y], Guests[y], y)
//   Total[y]               = Rooms + F&B + Other
//
// Outside [opsStartIdx, opsEndIdx] (inclusive) all outputs are 0.
// ───────────────────────────────────────────────────────────────────

export type AncillaryRevenueMode = 'percent_of_rooms' | 'per_guest' | 'fixed_amount';

export interface AncillaryRevenueConfig {
  mode: AncillaryRevenueMode;
  // percent_of_rooms: F&B[y] = Rooms[y] × pct(y). Scalar (uniform) or
  // per-period array. Indexation does not apply (already a ratio).
  percentOfRooms?: number | number[];
  // per_guest: F&B[y] = Guests[y] × ratePerGuest(y). Currency per
  // guest per occupied night. Scalar (uniform) or per-period array.
  // Indexation MAY apply (rate escalation).
  ratePerGuest?: number | number[];
  // fixed_amount: F&B[y] = explicit per-period currency value, or a
  // single scalar that broadcasts to every operating year. Indexation
  // MAY apply (lift base by factor).
  fixedAmountPerPeriod?: number | number[];
  // Optional indexation on the rate (per_guest) or the fixed amount.
  // Ignored for percent_of_rooms.
  indexation?: IndexationConfig;
}

export interface HospitalityConfig {
  assetId: string;
  // Total keys for the asset. Caller resolves from M1 sub-units
  // (sum of metricValue where metric='units').
  keys: number;
  // Days per operating year. Default 365 (some operators use 360).
  daysPerYear?: number;
  // Starting Average Daily Rate (currency / occupied room night) at
  // the operations start year. Escalates per adrIndexation.
  startingADR: number;
  // ADR escalation. Reuses IndexationConfig from Sell.
  adrIndexation: IndexationConfig;
  // Occupancy ramp, project-axis-indexed. 0..1 per period. Engine
  // clamps. Values outside [opsStart, opsEnd] are ignored.
  occupancyPerPeriod: number[];
  // Average paying guests per occupied room night. Default 1.5.
  // Drives the per-guest F&B / Other revenue modes.
  guestsPerOccupiedRoom?: number;
  fb: AncillaryRevenueConfig;
  otherRevenue: AncillaryRevenueConfig;
  // Operations window (project-axis indices, inclusive). Engine zeros
  // every output before opsStartIdx and after opsEndIdx.
  opsStartIdx: number;
  opsEndIdx: number;
}

export interface HospitalityAssetResult {
  assetId: string;
  axisLength: number;
  availableRoomNightsPerPeriod: number[];
  occupiedRoomNightsPerPeriod: number[];
  occupancyPerPeriod: number[];          // clamped, mirror of input
  adrPerPeriod: number[];                // indexed
  guestsPerPeriod: number[];
  roomsRevenuePerPeriod: number[];
  fbRevenuePerPeriod: number[];
  otherRevenuePerPeriod: number[];
  totalRevenuePerPeriod: number[];
}
