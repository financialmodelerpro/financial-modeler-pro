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
 * Phase M1.7 (2026-05-02) extends the hierarchy with Plot (and
 * optional Zone) entities BETWEEN Phase and Asset. A Plot owns the
 * physical envelope (plot area, FAR, coverage, floors, parking
 * config) and zero-or-more Zones (e.g. "1A", "1B"). Assets remain
 * phase-bound for backward compatibility but gain an optional
 * plotId / zoneId so the Area Program tab can roll the area cascade
 * (TBA -> BUA -> GFA -> GSA/GLA -> MEP -> basement parking ->
 * back-of-house -> other technical) up to the plot envelope. M1.7/1
 * is structure-only: the calc engines, AssetClass strategy fields,
 * and Area Program tab UI land in subsequent sub-commits.
 *
 * Architecture references applied here:
 *   - Section 1: 5-layer hierarchy, single-project users leave MH null.
 *   - Section 1A: Plot / Zone live between Phase and Asset (M1.7).
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
 *   - AssetClass.plotId / zoneId are OPTIONAL (M1.7): legacy assets
 *     without a plot still load and behave as before. Assets only
 *     pick up area-cascade math once they are assigned to a plot
 *     via the Area Program tab. This preserves the M1.R / M1.5
 *     migration as a degenerate case (no plotId set).
 *   - Plot defaults (FAR 3.0, coverage 60%, basement efficiency 95%,
 *     bay sizes 25/40/44 sqm) are industry-typical seeds; they are
 *     NOT lifted from any specific project file. Users always
 *     override them per-plot in the Area Program tab.
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
//
// New in M1.7: plotId / zoneId are OPTIONAL. An asset is only included
// in the Area Program cascade once it has been assigned to a plot via
// the Area Program tab. Legacy / pre-M1.7 assets keep these undefined
// and behave exactly as before. AssetClass strategy fields land in
// M1.7/3 (primaryStrategy + allocation %, optional secondary).
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
  // M1.7: optional plot binding. Keep undefined for assets that pre-date
  // the Area Program tab; set via the Area Program tab (M1.7/5).
  plotId?: string;
  zoneId?: string;
}

// ── Strategy enum (Architecture section 1A; Project West vocabulary) ──────
// A Plot's assets each pick a Primary Strategy + an optional Secondary
// Strategy with allocation %. Strategy expresses the operating model:
//   'Develop & Sell'    — sell on completion (residential / villas / etc.)
//   'Develop & Lease'   — lease to tenants on completion (retail / office)
//   'Develop & Operate' — operate as a going concern (hotel / serviced)
// Strategy is RELATED TO but distinct from AssetCategory: an Operate-
// category hotel typically uses 'Develop & Operate' Primary, but a
// Lease-category retail asset can carry 'Develop & Sell' as a Secondary
// (e.g. strata-sell ground-floor retail while leasing the rest). The
// AssetClass.primaryStrategy / secondaryStrategy fields are added in
// M1.7/3 alongside the rest of the area-cascade extensions.
export type AssetStrategy = 'Develop & Sell' | 'Develop & Lease' | 'Develop & Operate';

export const ASSET_STRATEGIES: readonly AssetStrategy[] = [
  'Develop & Sell',
  'Develop & Lease',
  'Develop & Operate',
] as const;

// Default strategy lookup keyed by AssetCategory. Used when the user
// adds a new asset on a Plot without specifying a strategy explicitly:
// the Area Program tab (M1.7/5) seeds primaryStrategy from this map.
export const DEFAULT_STRATEGY_BY_CATEGORY: Record<AssetCategory, AssetStrategy> = {
  Sell:    'Develop & Sell',
  Lease:   'Develop & Lease',
  Operate: 'Develop & Operate',
  Hybrid:  'Develop & Sell',  // Hybrid defaults to Sell; user picks Secondary explicitly.
};

// ── Plot (NEW in M1.7; Architecture section 1A) ────────────────────────────
// A Plot is the physical land parcel beneath a Phase. It owns the
// envelope inputs (plot area, FAR, coverage, floors) plus parking
// config, and parents zero-or-more Zones and one-or-more Assets.
//
// Computed fields (NOT stored on Plot — derived in @core/calculations
// in M1.7/2):
//   maxGFA      = plotArea * maxFAR
//   footprint   = plotArea * coveragePct/100
//   publicArea  = plotArea - footprint
//   podiumGFA   = footprint * podiumFloors
//   typicalGFA  = (plotArea * typicalCoveragePct/100) * typicalFloors
//   totalBuiltGFA = podiumGFA + typicalGFA  (must be <= maxGFA; UI warns on overshoot)
//
// Parking calculation (M1.7/2): Surface bays consume publicArea (after
// landscape/hardscape allocation), Vertical bays consume podium floors,
// Basement bays consume basementCount * footprint * basementEfficiencyPct/100.
export interface Plot {
  id: string;
  name: string;
  phaseId: string;
  // Envelope
  plotArea: number;        // sqm
  maxFAR: number;          // ratio (e.g. 3.0)
  coveragePct: number;     // % of plotArea (drives podium footprint)
  // Floors
  numberOfFloors: number;  // total floors above ground (informational)
  podiumFloors: number;    // count
  typicalFloors: number;   // count
  typicalCoveragePct: number; // % of plotArea (for typical floor plates above podium)
  // Optional shape (for plate / massing tools later; UI may derive from area)
  length?: number;         // m
  width?: number;          // m
  // Public-area allocation (% of publicArea = plotArea - footprint)
  landscapePct: number;    // %
  hardscapePct: number;    // %  (the rest of public area is available for surface parking)
  // Parking config
  surfaceBaySqm:          number; // sqm per surface parking bay
  verticalBaySqm:         number; // sqm per vertical (podium) parking bay
  basementBaySqm:         number; // sqm per basement parking bay
  basementCount:          number; // # of basement levels
  basementEfficiencyPct:  number; // % of footprint usable for parking per basement level
}

// ── Zone (NEW in M1.7; optional sub-grouping under Plot) ───────────────────
// A Zone is an optional logical sub-division of a Plot — e.g. a single
// 100,000 sqm plot might carry "Zone 1A" (residential tower cluster) and
// "Zone 1B" (mixed-use podium). Zones do NOT affect the area cascade by
// themselves; they are grouping labels that the Area Program tab uses to
// segment per-asset rollups when the user wants to slice a single
// envelope into multiple operating clusters.
export interface Zone {
  id: string;
  name: string;
  plotId: string;
  // Optional share of the parent plot's area. When undefined the zone
  // inherits no area on its own — it is a pure label. When set, the
  // Area Program tab can warn if zones[].areaSharePct sum > 100% on the
  // same plot.
  areaSharePct?: number;
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
export const DEFAULT_PLOT_ID        = 'plot_1';

// ── Industry-typical Plot defaults (M1.7) ──────────────────────────────────
// Seeds for a brand-new plot. NOT lifted from any specific project; users
// always override these per-plot in the Area Program tab. Source: common
// developer-side rules of thumb (FAR 3.0, coverage 60%) and surveyed
// regional bay-size standards (Surface 25 sqm incl. drive, Vertical 40
// sqm incl. ramps, Basement 44 sqm incl. ramps + walls).
export const DEFAULT_PLOT_FAR                    = 3.0;
export const DEFAULT_PLOT_COVERAGE_PCT           = 60;
export const DEFAULT_PLOT_TYPICAL_COVERAGE_PCT   = 40;
export const DEFAULT_PLOT_LANDSCAPE_PCT          = 40;
export const DEFAULT_PLOT_HARDSCAPE_PCT          = 40;
export const DEFAULT_PLOT_NUMBER_OF_FLOORS       = 12;
export const DEFAULT_PLOT_PODIUM_FLOORS          = 2;
export const DEFAULT_PLOT_TYPICAL_FLOORS         = 10;
export const DEFAULT_PLOT_BASEMENT_COUNT         = 1;
export const DEFAULT_PLOT_BASEMENT_EFFICIENCY_PCT = 95;
export const PARKING_BAY_SQM_SURFACE  = 25;
export const PARKING_BAY_SQM_VERTICAL = 40;
export const PARKING_BAY_SQM_BASEMENT = 44;

// ── Sub-Unit parking ratio defaults (M1.7; consumed in M1.7/3) ─────────────
// Lookup keyed by sub-unit type label. Residential ratios are bays-per-
// unit; hospitality ratios are bays-per-key; lease-class (office /
// retail) ratios are bays-per-25-sqm-GFA. The Area Program tab seeds
// SubUnit.parkingBaysPerUnit from this table when the user picks a
// known type; custom types default to 1.0 with a hint to adjust.
export const DEFAULT_PARKING_BAYS_BY_SUBUNIT_TYPE: Record<string, number> = {
  // Residential — bays per dwelling
  'Studio': 1.0,
  '1BR':    1.0,
  '2BR':    1.6,
  '3BR':    2.0,
  'Apartments Type 1':   1.0,
  'Apartments Type 2':   1.6,
  'Apartments Type 3':   2.0,
  'Branded Residences':  2.0,
  // Hospitality — bays per key
  'Hotel Key':          1.0,
  'Serviced Apartment': 1.0,
  // Lease — bays per 25 sqm GFA (M1.7/2 calc engine handles the
  // /25 conversion when sub-unit metric === 'area'; the value here is
  // the per-25-sqm bay count, so 1.0 means 1 bay / 25 sqm).
  'Office':  1.0,
  'Retail':  1.0,
};

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

// Plot factory (M1.7). Industry-typical defaults; users override per-plot
// in the Area Program tab. plotArea is required from the caller because
// there is no sensible default — callers either pull it from a land
// parcel (most common) or accept the user's input from the Area Program
// tab's "Add Plot" form.
export function makeDefaultPlot(id: string, name: string, phaseId: string, plotArea: number): Plot {
  return {
    id,
    name,
    phaseId,
    plotArea,
    maxFAR:                DEFAULT_PLOT_FAR,
    coveragePct:           DEFAULT_PLOT_COVERAGE_PCT,
    numberOfFloors:        DEFAULT_PLOT_NUMBER_OF_FLOORS,
    podiumFloors:          DEFAULT_PLOT_PODIUM_FLOORS,
    typicalFloors:         DEFAULT_PLOT_TYPICAL_FLOORS,
    typicalCoveragePct:    DEFAULT_PLOT_TYPICAL_COVERAGE_PCT,
    landscapePct:          DEFAULT_PLOT_LANDSCAPE_PCT,
    hardscapePct:          DEFAULT_PLOT_HARDSCAPE_PCT,
    surfaceBaySqm:         PARKING_BAY_SQM_SURFACE,
    verticalBaySqm:        PARKING_BAY_SQM_VERTICAL,
    basementBaySqm:        PARKING_BAY_SQM_BASEMENT,
    basementCount:         DEFAULT_PLOT_BASEMENT_COUNT,
    basementEfficiencyPct: DEFAULT_PLOT_BASEMENT_EFFICIENCY_PCT,
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
