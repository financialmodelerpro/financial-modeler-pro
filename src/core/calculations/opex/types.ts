/**
 * Module 3 Opex Engine, types.
 *
 * Operational expenses for Hospitality (rooms / F&B / other dept,
 * indirect G&A / IT / S&M / POM / Energy / EOSB, management fee
 * base + technology + incentive, replacement reserve, rent &
 * insurance) and Lease (property management, CAM, utilities, tax,
 * insurance). Project-axis-indexed: arr[0] = first active project
 * year. Pure: no store reads, no IO.
 */

import type { IndexationConfig } from '@/src/core/calculations/revenue/types';

/** How a line item is sized per period. */
export type OpexLineMode =
  // Flat baseline (currency / year), indexed forward.
  | 'fixed_baseline'
  // Per-period % of one of the revenue streams the engine receives:
  | 'pct_of_room_rev'
  | 'pct_of_fb_rev'
  | 'pct_of_other_rev'
  | 'pct_of_total_rev'
  | 'pct_of_lease_rev'
  // Per-unit drivers (currency × units), indexed forward.
  | 'per_room_year'
  | 'per_sqm_year'
  // Computed after first-pass direct + indirect aggregation.
  | 'pct_of_gop';

/**
 * Where this line falls in the P&L hierarchy. Engine uses category
 * for aggregation buckets (direct / indirect / mgmt / other) and the
 * UI uses it for section grouping. Default seed maps every line to a
 * KPMG-style category but users can change category on edit.
 */
export type OpexLineCategory =
  // Direct departmental
  | 'direct_rooms'
  | 'direct_fb'
  | 'direct_other'
  // Indirect (undistributed) operating
  | 'indirect_ga'
  | 'indirect_it'
  | 'indirect_sm'
  | 'indirect_pom'
  | 'indirect_energy'
  | 'indirect_eosb'
  // Management fee + reserve
  | 'mgmt_base'
  | 'mgmt_tech'
  | 'mgmt_incentive'
  | 'replacement_reserve'
  // Fixed charges
  | 'rent_insurance'
  | 'property_tax'
  | 'utilities'
  | 'cam'
  // HQ / corporate (used by project-wide opex)
  | 'hq_payroll'
  | 'hq_office'
  | 'hq_professional'
  | 'hq_other'
  // Catch-all
  | 'other';

export interface OpexLine {
  /** Stable uuid for re-renders + edits. */
  id: string;
  /** User-editable display label. */
  name: string;
  category: OpexLineCategory;
  mode: OpexLineMode;
  /** Baseline value, interpretation depends on mode:
   *   - fixed_baseline / per_room_year / per_sqm_year: currency
   *   - pct_*: decimal 0..1
   *   - pct_of_gop: decimal 0..1
   */
  value: number;
  indexation: IndexationConfig;
  /** When true, the engine skips this line (left in the config so the
   *  user can toggle a line off without losing the values). */
  disabled?: boolean;
}

/**
 * Revenue context the resolver hands to the engine. Each array is
 * project-axis-indexed. The engine consumes only what each line
 * needs; missing streams default to zero.
 */
export interface OpexRevenueContext {
  roomRevenuePerPeriod: number[];
  fbRevenuePerPeriod: number[];
  otherRevenuePerPeriod: number[];
  totalRevenuePerPeriod: number[];
  leaseRevenuePerPeriod: number[];
}

export interface AssetOpexInputs {
  assetId: string;
  /** Asset strategy, used to pick the right defaults + revenue stream */
  strategy: 'Hospitality' | 'Lease' | 'Sell' | 'Sell + Manage';
  /** Per-asset line items. */
  lines: OpexLine[];
  /** Total keys (Hospitality drivers). 0 for non-hospitality. */
  keys: number;
  /** Leasable area in sqm (Lease drivers). 0 for non-lease. */
  leasableSqm: number;
  /** Project-axis index of first operations year. */
  opsStartIdx: number;
  /** Project-axis index of last operations year (inclusive). */
  opsEndIdx: number;
  /** Total project axis length. */
  axisLength: number;
  /** Per-asset revenue streams from M2 resolver. */
  revenue: OpexRevenueContext;
}

export interface AssetOpexResult {
  assetId: string;
  /** lines[i] in same order as input config; each cell is currency. */
  perLinePerPeriod: number[][];

  // Bucket aggregates (sums across category groups).
  directCostsPerPeriod: number[];
  indirectCostsPerPeriod: number[];
  managementFeePerPeriod: number[];
  otherOpexPerPeriod: number[];
  totalOpexPerPeriod: number[];

  // Derived for downstream consumers (P&L composition).
  /** Revenue - Direct costs - Indirect costs (excludes mgmt + other). */
  gopPerPeriod: number[];
  /** gopPerPeriod / totalRevenuePerPeriod (0 when revenue is 0). */
  gopMarginPerPeriod: number[];
  /** Revenue - totalOpex (NOI before D&A / interest / tax). */
  noiPerPeriod: number[];
}

/**
 * Project-wide HQ / corporate opex. Not tied to an asset. Same line
 * primitives, no revenue context (lines may only use fixed_baseline,
 * per-employee, or pct_of_total_rev with the project total revenue).
 */
export interface HQOpexInputs {
  lines: OpexLine[];
  axisLength: number;
  /** Project total revenue per period (used when any line is pct_of_total_rev). */
  projectTotalRevenuePerPeriod: number[];
  /** When set, lines are clamped to this window. Defaults to the full axis. */
  opsStartIdx?: number;
  opsEndIdx?: number;
}

export interface HQOpexResult {
  perLinePerPeriod: number[][];
  totalOpexPerPeriod: number[];
}
