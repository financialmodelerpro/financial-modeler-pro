/**
 * module1-types.ts
 *
 * Normalized data shape for REFM Module 1.
 *
 * Phase M1.R (2026-05-02) introduced the assets[] / phases[] / costs[]
 * model that replaced the 3 hardcoded asset arrays.
 *
 * Phase M1.5 (2026-05-02) layers in the full 5-tier hierarchy from
 * Architecture sheet section 1: Master Holding > Sub-Project > Phase >
 * Asset > Sub-Unit. Sub-Project becomes the parent of Phases. Each
 * Asset is bound to one Phase (and therefore to one Sub-Project),
 * which lets a single project span multiple phases with their own
 * asset lists and operations start years.
 *
 * Architecture references applied here:
 *   - Section 1: 5-layer hierarchy, single-project users leave MH null.
 *   - Section 2: Category enum locked, 20 prebuilt asset types.
 *   - Section 8: Cost methods preserved verbatim from project.types.
 *
 * Design choices ratified by Ahmad on 2026-05-02:
 *   - Master Holding P&L / consolidation math is OUT OF SCOPE here;
 *     it lives in M8.1 (Portfolio rollup) where it belongs naturally.
 *     M1.5 is structure-only.
 *   - CostLine.phaseId semantics: undefined = global to the sub-
 *     project (applies across all its phases), defined = phase-
 *     specific. Preserves the M1.R single-phase migration as a
 *     degenerate case (no phaseId set).
 *   - AssetClass.phaseId is REQUIRED: every asset belongs to exactly
 *     one phase. The Hierarchy tab UI is the only place this can
 *     change (move-asset-between-phases).
 */

import type { CostItem } from '@core/types/project.types';

// ── Asset categories (Architecture section 2, locked enum) ─────────────────
export type AssetCategory = 'Sell' | 'Operate' | 'Lease' | 'Hybrid';

// ── Pre-built asset types (Architecture section 2, 20 entries) ─────────────
export const PREBUILT_ASSET_TYPES = {
  Sell: [
    'Branded Villas',
    'Branded Apartments',
    'High-end Villas',
    'High-end Apartments',
    'Class B Apartments',
  ],
  Operate: [
    'Hotel 4-star',
    'Hotel 5-star',
    'Resort',
    'Serviced Apartments',
    'Senior Living',
    'Student Housing',
  ],
  Lease: [
    'Retail',
    'Office',
    'Industrial',
    'Healthcare',
    'Self-Storage',
    'Data Center',
  ],
  Hybrid: ['Marina', 'Cinema', 'Mixed-Use'],
} as const;

// ── Master Holding (Architecture section 1, optional top-level) ────────────
// When `enabled === false` the rest of the fields are inert; the toggle
// in the Hierarchy tab flips this. Single-project users keep enabled
// false and the panel stays hidden.
export interface MasterHolding {
  id: string;
  name: string;
  enabled: boolean;
  // Master-level land cost (separate from per-sub-project lands).
  // Held as a simple { method, value } pair until M1.6 fleshes out a
  // full land-parcel structure for MH.
  landCostMethod: 'fixed' | 'rate_total_allocated';
  landCostValue: number;
  // Master-level debt for land acquisition. Term in periods (months
  // for monthly model, years for annual).
  masterDebtPrincipal: number;
  masterDebtRate: number;
  masterDebtTermPeriods: number;
}

// ── Sub-Project (Architecture section 1, "Fund") ───────────────────────────
// Independent financing unit. Today most projects are 1 sub-project; a
// "fund of zones" project has multiple. Currency is per-sub-project
// per the v1 currency note in section 3 (multi-currency deferred to v2).
export interface SubProject {
  id: string;
  name: string;
  currency: string;
  // null = standalone sub-project. When set, the sub-project rolls up
  // into the named MH and pays revenueShareToMaster %.
  masterHoldingId: string | null;
  revenueShareToMaster: number;
}

// ── Phase (extended from M1.R) ──────────────────────────────────────────────
// New in M1.5: subProjectId binds the phase to its parent sub-project.
// All other fields preserved.
export interface Phase {
  id: string;
  name: string;
  subProjectId: string;
  constructionStart: number;
  constructionPeriods: number;
  operationsStart: number;
  operationsPeriods: number;
  overlapPeriods: number;
}

// ── Asset (extended from M1.R) ──────────────────────────────────────────────
// New in M1.5: subProjectId + phaseId are REQUIRED. Every asset belongs
// to exactly one phase, which transitively binds it to one sub-project.
// The Hierarchy tab is the canonical place to set / change these.
export interface AssetClass {
  id: string;
  name: string;
  type: string;
  category: AssetCategory;
  allocationPct: number;
  deductPct: number;
  efficiencyPct: number;
  visible: boolean;
  subProjectId: string;
  phaseId: string;
}

// ── Sub-Unit (NEW in M1.5; Architecture section 1 + section 7) ─────────────
// Inventory unit beneath an asset. Metric semantics depend on the parent
// asset's category:
//   Sell    -> metric='count' (units), unitPrice = price per unit
//   Operate -> metric='count' (keys),  unitPrice = ADR or per-key value
//   Lease   -> metric='area'  (sqm),   unitPrice = rent per sqm/year
//   Hybrid  -> caller chooses; UI offers both forms per stream
export interface SubUnit {
  id: string;
  assetId: string;
  name: string;
  metric: 'count' | 'area';
  metricValue: number;
  unitPrice: number;
  priceEscalationPct?: number;
}

// ── CostLine (extended from M1.R) ──────────────────────────────────────────
// New in M1.5: optional subProjectId. Today it always equals the cost's
// asset's subProjectId, but storing it explicitly lets future
// project-scope cost rows (per Architecture section 8) live without
// being tied to a single asset.
//
// phaseId semantics (finalized in M1.5):
//   undefined -> cost is GLOBAL to its sub-project (applies across all
//                phases). This is the migrated-from-v3 default.
//   defined   -> cost is PHASE-SPECIFIC; only contributes to that
//                phase's capex curve.
export interface CostLine extends CostItem {
  assetId: string;
  phaseId?: string;
  subProjectId?: string;
}

// ── Canonical default ids ──────────────────────────────────────────────────
export const LEGACY_ASSET_IDS = {
  residential: 'residential',
  hospitality: 'hospitality',
  retail:      'retail',
} as const;

export type LegacyAssetId = (typeof LEGACY_ASSET_IDS)[keyof typeof LEGACY_ASSET_IDS];

export const DEFAULT_SUB_PROJECT_ID = 'subproject_1';
export const DEFAULT_PHASE_ID       = 'phase_1';
export const DEFAULT_MASTER_HOLDING_ID = 'mh_1';

// ── Factories ──────────────────────────────────────────────────────────────
export function makeDefaultSubProject(name: string, currency: string): SubProject {
  return {
    id: DEFAULT_SUB_PROJECT_ID,
    name,
    currency,
    masterHoldingId: null,
    revenueShareToMaster: 0,
  };
}

export function makeDefaultPhase(
  subProjectId: string,
  constructionPeriods: number,
  operationsPeriods: number,
  overlapPeriods: number,
): Phase {
  return {
    id: DEFAULT_PHASE_ID,
    name: 'Phase 1',
    subProjectId,
    constructionStart: 1,
    constructionPeriods,
    operationsStart: Math.max(1, constructionPeriods - overlapPeriods + 1),
    operationsPeriods,
    overlapPeriods,
  };
}

export function makeDefaultMasterHolding(): MasterHolding {
  return {
    id: DEFAULT_MASTER_HOLDING_ID,
    name: 'Master Holding',
    enabled: false,
    landCostMethod: 'fixed',
    landCostValue: 0,
    masterDebtPrincipal: 0,
    masterDebtRate: 0,
    masterDebtTermPeriods: 0,
  };
}

// ── Defaults ───────────────────────────────────────────────────────────────
// The 3 canonical legacy assets, now bound to the default sub-project +
// default phase. Used only by the migrator when upgrading an existing
// v2/v3 snapshot. Brand-new projects start with assets=[] (M1.5 default
// init drops the 3-asset seed; users add assets via the Hierarchy tab).
export const DEFAULT_LEGACY_ASSETS: AssetClass[] = [
  {
    id: LEGACY_ASSET_IDS.residential,
    name: 'Residential',
    type: 'High-end Apartments',
    category: 'Sell',
    allocationPct: 50,
    deductPct: 10,
    efficiencyPct: 85,
    visible: true,
    subProjectId: DEFAULT_SUB_PROJECT_ID,
    phaseId:      DEFAULT_PHASE_ID,
  },
  {
    id: LEGACY_ASSET_IDS.hospitality,
    name: 'Hospitality',
    type: 'Hotel 5-star',
    category: 'Operate',
    allocationPct: 30,
    deductPct: 15,
    efficiencyPct: 80,
    visible: true,
    subProjectId: DEFAULT_SUB_PROJECT_ID,
    phaseId:      DEFAULT_PHASE_ID,
  },
  {
    id: LEGACY_ASSET_IDS.retail,
    name: 'Retail',
    type: 'Retail',
    category: 'Lease',
    allocationPct: 20,
    deductPct: 5,
    efficiencyPct: 90,
    visible: true,
    subProjectId: DEFAULT_SUB_PROJECT_ID,
    phaseId:      DEFAULT_PHASE_ID,
  },
];
