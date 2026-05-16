/**
 * module1-types.ts (v7 schema)
 *
 * Phase M2.0e (2026-05-06): wizard simplification + Tab 2 full asset
 * entry. Schema gains three additive optional fields (no SCHEMA_VERSION
 * bump; v7 snapshots without these fields stay valid):
 *   - Phase.startDate?: ISO date. When set, takes precedence over the
 *     constructionStart period offset for phase timing display +
 *     computePhaseTimeline. Wizard Step 2 captures this per phase.
 *   - Asset.status?: 'planned' | 'construction' | 'operational'.
 *     Tab 2 status pill; defaults to 'planned' on add.
 *   - Project.projectType?: 'Residential' | 'Hospitality' | 'Retail'
 *     | 'Office' | 'Mixed-Use' | 'Custom'. Wizard Step 3 captures it;
 *     Tab 2 type-catalog dropdown filters by it.
 *
 * Phase M2.0d (2026-05-06): bumps to v7 to absorb the M2.0d Costs polish:
 *   - AssetStrategy.Hybrid renamed to 'Sell + Manage' (MAAD Tower 01
 *     pattern: build, sell to investors, retain operating rights via
 *     management agreement).
 *   - Asset.managementAgreement added (management fee % + owner revenue
 *     share % + optional agreement start/duration).
 *   - Asset.usefulLifeYears added (depreciation horizon for Operate /
 *     Lease assets; ignored on Sell / Sell + Manage). Category defaults
 *     in DEFAULT_USEFUL_LIFE_YEARS.
 *   - makeDefaultCostLines returns the M2.0d standard 9-line catalog
 *     (Land, Construction BUA, Construction Parking, Infrastructure,
 *     Landscaping, Pre-operating, Professional Fee, Commission,
 *     Contingency). Names editable by user, ids stay so derivation
 *     rules can target them.
 *   - CostMethod gains 'rate_per_parking_bay' (value × asset.parkingBays).
 *   - Stage / Scope are now AUTO-DERIVED in calc engine for the standard
 *     9 lines via deriveCostStage / deriveCostScope; the CostLine.stage
 *     field stays writeable so custom user lines can carry a user-picked
 *     stage at create time.
 *
 * Phase M2.0 (2026-05-06): complete rebuild to MAAD-Spec.
 *
 * Reference: MAAD Residential Cashflow v1.13 (Saudi mixed-use feasibility,
 * 4-day model). The previous v3/v4 schema (Master Holding / Sub-Project /
 * Plot / Zone / FAR / Cascade / Parking Allocator) has been retired
 * entirely. Module 1 is now flat:
 *
 *   Project -> Phase[] -> Asset[] -> SubUnit[]
 *                       -> Parcel[]                (land at project level)
 *                       -> CostLine[]              (9 standard lines)
 *                       -> FinancingTranche[]      (per-phase debt)
 *                       -> EquityContribution[]    (per-phase equity)
 *
 * Hard cuts versus M1.13d:
 *   - Master Holding   (deleted)
 *   - Sub-Project      (renamed Project; one per workspace)
 *   - Plot             (deleted; assets carry GFA/BUA directly)
 *   - Zone             (deleted)
 *   - FAR / Coverage / Podium / Typical / Public-area split (deleted)
 *   - Parking allocator (deleted; parking is just a bay-count input)
 *   - Build Program tab + Plot/Parcel Setup Wizards (deleted)
 *
 * The 4 tabs that consume this schema:
 *   1. Project & Phases     (project meta + Phase[] timing)
 *   2. Assets & Sub-units   (Parcel[] block at top, then Asset[] cards)
 *   3. Costs                (9 fixed cost lines, per-asset overridable)
 *   4. Financing            (FinancingTranche[] + EquityContribution[])
 *
 * v3/v4 snapshots are intentionally NOT migrated; module1-migrate.ts
 * returns an error so the old data does not silently upgrade to a
 * different model.
 */

// ── Strategy enum ──────────────────────────────────────────────────────────
// MAAD vocabulary: how an asset earns money over its life.
//   'Sell'         -> develop and sell on completion (residential, villas)
//   'Operate'      -> develop and run as a going concern (hotel, serviced)
//   'Lease'        -> develop and lease to tenants (retail, office)
//   'Sell + Manage'-> develop, sell units to investors, retain operating
//                     rights via a management agreement (MAAD Tower 01
//                     pattern, branded residences with management contract).
//                     Capex still flows through COGS at unit sale (developer
//                     does NOT own the asset post-sale, no Fixed Assets, no
//                     depreciation), but managementFeePct of operating
//                     revenue accrues to the developer post-handover.
//
// M2.0d (2026-05-06): renamed 'Hybrid' to 'Sell + Manage' to make the
// accounting treatment unambiguous. Pre-v7 snapshots are hard-cut by
// migrate.ts; this is not a silent rename.
export type AssetStrategy = 'Sell' | 'Operate' | 'Lease' | 'Sell + Manage';

export const ASSET_STRATEGIES: readonly AssetStrategy[] = [
  'Sell',
  'Operate',
  'Lease',
  'Sell + Manage',
] as const;

// ── Management agreement ──────────────────────────────────────────────────
// Only consumed when asset.strategy === 'Sell + Manage'. Module 2 (Revenue)
// will read this to compute developer's recurring fee post-handover.
export interface ManagementAgreement {
  managementFeePct: number;      // % of operating revenue accruing to developer
  ownerRevenueSharePct: number;  // % to unit owners (auto = 100 - managementFeePct, editable)
  agreementStartPeriod?: number; // optional, default = handover (sales schedule end)
  agreementDurationPeriods?: number; // optional, undefined = perpetual
}

export const DEFAULT_MANAGEMENT_AGREEMENT: ManagementAgreement = {
  managementFeePct: 30,
  ownerRevenueSharePct: 70,
};

// ── Useful life defaults (depreciation horizon, in YEARS) ─────────────────
// Read by classifyAssetCapex when asset.strategy === 'Operate' or 'Lease'.
// Sell + Sell + Manage don't depreciate (capex becomes COGS at sale).
// Land NEVER depreciates regardless of strategy; the calc engine subtracts
// landValue from the depreciation base.
export const DEFAULT_USEFUL_LIFE_YEARS = {
  residential: 30,
  hospitality: 20,
  retail:      25,
  office:      25,
  default:     25,
} as const;

// ── Sub-unit categories ────────────────────────────────────────────────────
// Drives metric semantics + which Module 2 revenue stream it feeds.
//   'Sellable' -> sale revenue (cohort collection over construction)
//   'Operable' -> hospitality USAH (ADR x occupancy x keys x days)
//   'Leasable' -> retail/office NOI (rent per sqm x occupancy)
//   'Support'  -> non-revenue (back-of-house, MEP); appears in area
//                 roll-ups but not in revenue streams
//
// M2.0g Fix 4 (2026-05-06): the M2.0f 'Parking' category is removed.
// Parking moves to an asset-level input (asset.parkingArea) so users
// no longer have to break it into a sub-unit when it's a single
// catch-all area. Sub-units now describe REVENUE-generating units only
// (apartments, hotel keys, retail GLA). module1-migrate folds any
// legacy 'Parking' sub-unit area into asset.parkingArea.
export type SubUnitCategory = 'Sellable' | 'Operable' | 'Leasable' | 'Support';

export const SUB_UNIT_CATEGORIES: readonly SubUnitCategory[] = [
  'Sellable',
  'Operable',
  'Leasable',
  'Support',
] as const;

// ── Sub-unit metric semantics ──────────────────────────────────────────────
// 'units' -> integer inventory units (apartments, hotel keys, leasable bays).
//            User enters count + unitSize; area derives = count × unitSize.
// 'area'  -> sqm of leasable / sellable area (retail GLA, office GLA).
//            User enters total area; count derives if unitSize present.
//
// M2.0i Fix 6 (2026-05-07): renamed 'count' to 'units' so the dropdown
// label and the storage value match. Migration: legacy snapshots with
// metric='count' coerce to 'units' on hydrate (see module1-migrate
// migrateM20iCountToUnits).
export type SubUnitMetric = 'units' | 'area';

// ── Land allocation mode ───────────────────────────────────────────────────
// How parcel land is split across assets:
//   'sqm'       -> user enters absolute sqm per asset (sum must <= total)
//   'percent'   -> user enters % per asset (sum must == 100)
//   'autoByBua' -> Module 1 derives % automatically as asset.bua / total bua
export type LandAllocationMode = 'sqm' | 'percent' | 'autoByBua';

export const LAND_ALLOCATION_MODES: readonly LandAllocationMode[] = [
  'sqm',
  'percent',
  'autoByBua',
] as const;

// ── Project meta ───────────────────────────────────────────────────────────
// M2.0g v8 (Addendum 3, 2026-05-06): inputs are always entered at
// ANNUAL granularity. modelType stays on the schema for legacy v7
// snapshots and as the calc-engine period unit, but new projects
// always set modelType='annual'. outputGranularity drives the
// reporting / display view toggle (annual default, quarterly /
// monthly distribute at render time).
export type ModelGranularity = 'monthly' | 'annual';
export type ProjectStatus     = 'draft' | 'active' | 'archived';
export type OutputGranularity = 'annual' | 'quarterly' | 'monthly';

export const OUTPUT_GRANULARITIES: readonly OutputGranularity[] = ['annual', 'quarterly', 'monthly'] as const;

export const OUTPUT_GRANULARITY_LABELS: Record<OutputGranularity, string> = {
  annual:    'Annual',
  quarterly: 'Quarterly',
  monthly:   'Monthly',
};

// M2.0g (2026-05-06): project-level display scale. Storage stays full
// value (e.g. 98,450 SAR/sqm); only the display layer divides for
// thousands / millions readability. Wizard Step 1 captures it.
export type DisplayScale = 'full' | 'thousands' | 'millions';

export const DISPLAY_SCALES: readonly DisplayScale[] = ['full', 'thousands', 'millions'] as const;

export const DISPLAY_SCALE_LABELS: Record<DisplayScale, string> = {
  full:      'Full numbers (1,234,567)',
  thousands: 'Thousands (1,234.57 K)',
  millions:  'Millions (1.23 M)',
};

// M2.0i Fix 3 (2026-05-07): companion to displayScale. Decimal places
// in the formatted output. Defaults to 2 (matches M2.0g formatScaled
// behaviour). 0..3 are the user-pickable options. Tab 1 Display
// Settings panel exposes both controls together; format helpers
// (formatScaled / formatNumber / formatScaledCurrency) consume both.
export type DisplayDecimals = 0 | 1 | 2 | 3;

export const DISPLAY_DECIMALS: readonly DisplayDecimals[] = [0, 1, 2, 3] as const;

// M2.0L Fix 2 (2026-05-11): cost input mode. Drives whether Tab 3
// shows one cost table that applies to ALL assets uniformly ('same')
// or a per-asset selector with separate cost tables ('individual').
// Undefined = user has not chosen yet, which triggers the first-open
// modal in Module1Costs.
export type CostInputMode = 'same' | 'individual';

export const COST_INPUT_MODES: readonly CostInputMode[] = ['same', 'individual'] as const;

export const COST_INPUT_MODE_LABELS: Record<CostInputMode, string> = {
  same:       'Same for All Assets',
  individual: 'Individual per Asset',
};

// M2.0e: closed-enum project type that drives Tab 2's asset-type catalog.
// Mixed-Use exposes every type from every category; Custom = free-text
// fallback (still shows the full bank as suggestions).
//
// M2.0f Fix 3 (2026-05-06): catalog expanded from 6 -> 14 entries
// restoring the pre-M2.0 breadth (Industrial, Data Center, Education,
// Healthcare, Marina, Hospitality + Branded Residences, Senior Living,
// Self-Storage). Each new type carries its own asset-type catalog
// below in ASSET_TYPES_BY_PROJECT_TYPE.
export type ProjectType =
  | 'Residential'
  | 'Hospitality'
  | 'Retail'
  | 'Office'
  | 'Mixed-Use'
  | 'Industrial'
  | 'Data Center'
  | 'Education'
  | 'Healthcare'
  | 'Marina'
  | 'Hospitality + Branded Residences'
  | 'Senior Living'
  | 'Self-Storage'
  | 'Custom';

export const PROJECT_TYPES: readonly ProjectType[] = [
  'Residential',
  'Hospitality',
  'Retail',
  'Office',
  'Mixed-Use',
  'Industrial',
  'Data Center',
  'Education',
  'Healthcare',
  'Marina',
  'Hospitality + Branded Residences',
  'Senior Living',
  'Self-Storage',
  'Custom',
] as const;

export interface Project {
  name: string;
  currency: string;          // ISO code (e.g. 'SAR', 'USD', 'AED')
  modelType: ModelGranularity;
  startDate: string;         // ISO 'YYYY-MM-DD'
  status: ProjectStatus;
  location: string;          // free-text city (display only)
  // M2.0c additions: drive conditional cost lines (e.g. RETT for KSA)
  // and the rate_per_nda / rate_per_roads cost methods. Both default
  // to undefined / 0 so existing v5 snapshots keep working.
  country?: string;          // free-text country, used by requiresCountry filter
  projectRoadsPct?: number;  // 0..100, fraction of TOTAL land used for roads
  // M2.0M Pass 6 Fix 3 (2026-05-11): project-level NDA deduction. When
  // projectNdaEnabled is true, calc engine applies (projectRoadsPct +
  // projectParksPct) to the TOTAL phase land (sum across parcels) to
  // derive NDA. Per-parcel hasNdaDeduction is kept for back-compat but
  // ignored when projectNdaEnabled is set. Migration weighted-averages
  // legacy per-parcel toggles into these fields.
  projectParksPct?: number;  // 0..100, fraction of TOTAL land used for parks
  projectNdaEnabled?: boolean;
  // M2.0 Pass 8 (2026-05-12): NDA scope toggle. 'project' uses the
  // project-level projectRoadsPct + projectParksPct above; 'asset' lets
  // each Asset carry its own assetRoadsPct + assetParksPct + assetNdaEnabled.
  // Defaults to 'project' on hydrate when projectNdaEnabled is true and
  // this field is unset.
  projectNdaScope?: 'project' | 'asset';
  // M2.0 Pass 8 Fix 8: Tab 3 Results view mode + selected asset (Single
  // Asset mode). Defaults to 'combined' post-migration.
  resultsViewMode?: 'combined' | 'single_asset';
  resultsSelectedAssetId?: string;
  // M2.0e: project type drives Tab 2's asset-type catalog filter and
  // the empty-state asset suggestions per phase. Captured in Wizard
  // Step 3.
  projectType?: ProjectType;
  // M2.0g (2026-05-06): display scale. Optional; defaults to 'full'
  // when undefined so v7 snapshots keep working unchanged.
  displayScale?: DisplayScale;
  // M2.0i Fix 3 (2026-05-07): decimal places for formatted numbers.
  // Optional; defaults to 2 when undefined. 0/1/2/3 are the only user-
  // pickable options.
  displayDecimals?: DisplayDecimals;
  // M2.0g v8 Addendum 3 (2026-05-06): output granularity for reporting
  // / display.
  // **@deprecated M2.0 Pass 14 (2026-05-13).** Annual-only basis until
  // M5 Financial Statements introduces a granularity toggle scoped to
  // FS output. Every read site collapses to 'annual'; every write site
  // stamps 'annual'. Field retained on schema for snapshot back-compat
  // (legacy v7/v8 snapshots may carry 'quarterly' / 'monthly'); migration
  // does not coerce, but consumers ignore the stored value.
  outputGranularity?: OutputGranularity;
  // M2.0L Fix 2 (2026-05-11): Tab 3 cost input mode.
  // M2.0L Pass 4 (2026-05-11): **DEPRECATED.** The Same vs Individual
  // mode toggle was replaced by the single parent/child inheritance
  // surface (master template + per-asset resolved replicas with
  // per-row override toggle). The field stays on the schema for
  // back-compat on legacy snapshots; the UI no longer reads it and
  // migrateM20Pass4Inheritance strips it on hydrate.
  costInputMode?: CostInputMode;
  // M2.0M (2026-05-11): project-level financing config. Optional so
  // legacy v8 snapshots stay valid; migrateM20MFinancing stamps a
  // default-on-Method-1 wrapper when missing.
  financing?: ProjectFinancingConfig;
}

// ── Phase ──────────────────────────────────────────────────────────────────
// Each phase has its own construction window + operations window. Periods
// are integer counts in the model granularity (months for monthly, years
// for annual). overlapPeriods >= 0 lets operations begin before
// construction ends (e.g. tower 1 opens while tower 2 is still building).
//
// All assets, parcels, costLines, financingTranches, and
// equityContributions are PER-PHASE. operationsStart is derived in the UI:
//   operationsStart = constructionStart + constructionPeriods - overlapPeriods
// M2.0i Fix 10 (2026-05-07): phase status drives operational-phase
// treatment. 'operational' phases reveal a Historical Baseline section
// in Tab 1 with sunk-cost / opening-balance inputs that flow into the
// future Module 5 cash flow + balance sheet.
export type PhaseStatus = 'planning' | 'construction' | 'operational';

export const PHASE_STATUSES: readonly PhaseStatus[] = ['planning', 'construction', 'operational'] as const;

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  planning:     'Planning',
  construction: 'Construction',
  operational:  'Operational',
};

// M2.0i Fix 10 (2026-05-07): historical baseline for operational phases.
// All fields entered in project currency at the project's reporting
// start (period 0 / Y0). Module 5 Statements (when it ships) will read
// these to seed opening balances on the cash flow + balance sheet.
export interface PhaseHistoricalBaseline {
  // Pass 38 (2026-05-14): the form was trimmed to opening-BS items only.
  // Sunk-cost roll-ups + run-rate metrics moved to a future Historical
  // Financials panel under the Financials module. Engine no longer reads
  // the deprecated fields; per-asset Pre-Capex / Existing Equity feed
  // existing.ts directly. Fields kept on the type so legacy snapshots
  // still parse.
  /** @deprecated since Pass 38. Use Asset.historicalPreCapex per-asset. */
  historicalCapexTotal: number;
  /** @deprecated since Pass 38. Use Asset.historicalEquityAmount per-asset. */
  historicalEquityContributed: number;
  /** @deprecated since Pass 38. Use FinancingTranche.openingBalance for existing facilities. */
  historicalDebtDrawn: number;
  // Active opening BS items (consumed by FS module when it ships).
  currentDebtOutstanding: number;
  cumulativeDepreciationCharged: number;
  netBookValueFixedAssets: number;
  // Pass 44 (2026-05-14): existing retained earnings at project Y0.
  // Seeds the BS equity section alongside the per-asset historical
  // equity contributions. Captured on Tab 4 (Financing) under the
  // Existing Operations Summary card.
  existingRetainedEarnings?: number;
  /** @deprecated since Pass 38. Will move to Historical Financials panel under Financials module. */
  last12MonthsRevenue: number;
  /** @deprecated since Pass 38. Will move to Historical Financials panel under Financials module. */
  last12MonthsOpex: number;
  /** @deprecated since Pass 38. Will move to Historical Financials panel under Financials module. */
  currentOccupancy?: number;
  /** @deprecated since Pass 38. Will move to Historical Financials panel under Financials module. */
  currentAdr?: number;
  /** @deprecated since Pass 38. Will move to Historical Financials panel under Financials module. */
  currentRentRate?: number;
}

export interface Phase {
  id: string;
  name: string;
  constructionStart: number;     // 1-indexed period number
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;
  // M2.0e: optional ISO date (YYYY-MM-DD). When present, computePhase-
  // Timeline derives concrete construction / operations dates from this
  // instead of treating constructionStart as an offset from project.
  // startDate. Wizard Step 2 captures this per phase; legacy snapshots
  // without it fall back to project.startDate + (constructionStart - 1)
  // periods.
  startDate?: string;
  // M2.0i Fix 10 (2026-05-07): phase lifecycle status. Optional;
  // defaults to 'planning' when undefined. When set to 'operational',
  // Tab 1 reveals a Historical Baseline section.
  status?: PhaseStatus;
  // M2.0i Fix 10: opening balances + run-rate baseline. Only populated
  // when status === 'operational' (Tab 1 hides the inputs otherwise).
  historicalBaseline?: PhaseHistoricalBaseline;
}

// ── Parcel (land) ──────────────────────────────────────────────────────────
// Project-level land. Multiple parcels supported (mixed cash + in-kind +
// donated land are common in MAAD models). Allocation across assets is
// driven by landAllocationMode at the snapshot level.
//
// M2.0h Fix 4 (2026-05-07): per-parcel optional NDA (Net Developable
// Area) deduction. When hasNdaDeduction is true, NDA = area × (1 -
// roadsPct/100 - parksPct/100); otherwise NDA = area. Asset land
// allocation references NDA (so when a parcel reserves 15% for roads
// and parks, the developable sqm fed to assets is 85% × parcel area
// while the full parcel cost still flows to the assets at an inflated
// effective NDA rate).
export interface Parcel {
  id: string;
  phaseId: string;            // parcel is bought/transferred during a phase
  name: string;
  area: number;               // sqm
  rate: number;               // currency per sqm
  cashPct: number;            // 0..100; remainder is in-kind
  inKindPct: number;          // 0..100; cashPct + inKindPct must sum to 100
  // M2.0h Fix 4: optional NDA deduction. Default OFF.
  hasNdaDeduction?: boolean;
  roadsPct?: number;          // 0..100; share of area reserved for roads
  parksPct?: number;          // 0..100; share of area reserved for parks
}

// ── Sub-unit ───────────────────────────────────────────────────────────────
// Inventory beneath an asset. metricValue meaning depends on metric:
//   metric === 'count' -> integer count (units, keys, bays)
//   metric === 'area'  -> total sqm (GLA / GSA)
//
// unitArea: only meaningful when metric === 'count'. The per-unit floor
// area in sqm. Used to compute the asset's sellable/operable/leasable
// BUA contribution: count * unitArea.
//
// unitPrice: meaning depends on parent asset strategy:
//   Sell          -> sale price per unit (or per sqm for area metrics)
//   Operate       -> ADR (per key per day) or per-key annual revenue
//   Lease         -> rent per sqm per year
//   Sell + Manage -> sale price per unit (post-handover management fee
//                    accrues to developer via Asset.managementAgreement)
export interface SubUnit {
  id: string;
  assetId: string;
  name: string;
  category: SubUnitCategory;
  metric: SubUnitMetric;
  metricValue: number;
  unitArea?: number;            // sqm per unit (count metric only)
  unitPrice: number;            // see strategy table above
  priceEscalationPct?: number;  // annual escalation on unitPrice
  // Operate-only (Module 2 picks these up; ignored for other strategies):
  occupancyPct?: number;        // 0..100, hospitality / leasable utilisation
  operatingMargin?: number;     // 0..100, share of revenue retained as NOI
  // T2-Fix 5c (2026-05-12): Companion sub-unit linkage. When this
  // SubUnit lives on a companion (Operate) asset and mirrors a parent
  // Sellable sub-unit, parentSubUnitId points at the parent row.
  // Mirrored rows are auto-rendered (no Add / Delete; no Area input;
  // Count derives from parent metricValue). startingAdr captures the
  // Average Daily Rate the user enters; it is the only editable field
  // on a companion sub-unit row.
  parentSubUnitId?: string;
  startingAdr?: number;
}

// ── Asset ──────────────────────────────────────────────────────────────────
// Top-level revenue-producing entity beneath a phase.
//
// landAreaSqm: directly entered when landAllocationMode === 'sqm';
//              ignored otherwise.
// landAreaPct: directly entered when landAllocationMode === 'percent';
//              ignored otherwise.
// (autoByBua mode derives both from the asset's bua share at compute
//  time; neither field is read.)
//
// M2.0f Fix 2: assets can carry an explicit parcel reference for the
// case where multiple parcels exist with DIFFERENT rates. parcelId
// (single-parcel) and parcelSplits (multi-parcel) are optional; when
// undefined, the calc engine falls back to the project-wide allocation
// rules (sqm / percent / autoByBua) using a value-weighted average
// rate across the phase's parcels. See AssetLandAllocation below.
//
// gfaSqm / buaSqm / sellableBuaSqm: explicit area inputs in MAAD-Spec.
// No FAR / coverage / cascade math; the user enters whatever the
// architect handed them. UI shows live-derived ratios (efficiency =
// sellable / bua, etc.) as read-outs only.
//
// parkingBaysRequired: integer count, fed straight to the cost engine.
// No allocator, no surface/vertical/basement split, just a number.
// M2.0e: lifecycle status for Tab 2 status pill. Sales / revenue logic
// reads this to gate which streams are active per period (an asset in
// 'planned' has no revenue regardless of strategy; 'construction' has
// pre-sale cohort revenue for Sell strategy; 'operational' has full
// revenue for Operate / Lease / post-handover Sell+Manage).
export type AssetStatus = 'planned' | 'construction' | 'operational';

export const ASSET_STATUSES: readonly AssetStatus[] = ['planned', 'construction', 'operational'] as const;

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  planned:      'Planned',
  construction: 'Construction',
  operational:  'Operational',
};

// M2.0f Fix 2: a single per-asset / per-parcel allocation slice.
// When asset.landAllocation.multiParcelSplits is populated, each
// entry maps a distinct parcelId -> sqm draw, and the asset's land
// cost is the sum across slices using each parcel's own rate. When
// only landAllocation.parcelId is set, the entire allocation comes
// from that one parcel.
export interface AssetParcelSplit {
  parcelId: string;
  sqm: number;
}

// M2.0f Fix 2: AssetLandAllocation captures the per-asset land entry.
// Mode A (sqm)     -> use sqm OR multiParcelSplits[]
// Mode B (percent) -> use pct (whole-portfolio share)
// Mode C (autoByBua) -> auto-derived; nothing stored
//
// parcelId narrows mode A to a SINGLE source parcel. The sentinel
// "__weighted__" means "use the phase-weighted-average rate"; the
// sentinel "__custom__" means "use the customRate field". Anything
// else is a real parcel id. multiParcelSplits extends mode A to
// multiple parcels with explicit per-parcel sqm draws. When BOTH are
// set, multiParcelSplits wins.
//
// M2.0g Fix 2 (2026-05-06): adds customRate so the user can override
// with a specific rate without picking a parcel.
export interface AssetLandAllocation {
  parcelId?: string;
  sqm?: number;
  pct?: number;
  customRate?: number;
  multiParcelSplits?: AssetParcelSplit[];
}

export const PARCEL_WEIGHTED_AVG = '__weighted__';
export const PARCEL_CUSTOM_RATE = '__custom__';

export interface Asset {
  id: string;
  phaseId: string;
  name: string;
  type: string;                  // free-text, optional from M2.0j Fix 2 ('' = unspecified); legacy snapshots set a default
  strategy: AssetStrategy;
  visible: boolean;
  // Land (legacy mirrors; kept for backward compat with v7 snapshots
  // pre-M2.0f). New code should read asset.landAllocation; calc engine
  // copies legacy fields into the structured shape if landAllocation
  // is undefined.
  landAreaSqm?: number;
  landAreaPct?: number;
  // M2.0f Fix 2: structured allocation (parcelId / multi-parcel splits).
  // Optional so v7 snapshots without it stay valid; resolveAssetLand-
  // Allocation flattens legacy fields into this shape.
  landAllocation?: AssetLandAllocation;
  // Areas (entered, not derived)
  gfaSqm: number;                // gross floor area
  buaSqm: number;                // built-up area (subset of gfa, after MEP/BoH)
  sellableBuaSqm: number;        // saleable / leasable area within bua
  // M2.0g Fix 4 (2026-05-06): asset-level total BUA + Support + Parking
  // inputs. User enters total BUA at asset level as a check, and
  // Support / Parking as asset-level inputs (no longer sub-units).
  // computeAssetAreaTotals reconciles: Sub-units (revenue) + Support +
  // Parking should equal asset.buaTotal.
  buaTotal?: number;
  supportArea?: number;
  parkingArea?: number;
  // Parking
  parkingBaysRequired: number;
  // M2.0d: capitalization + depreciation rules
  // managementAgreement: only consumed when strategy === 'Sell + Manage'.
  // usefulLifeYears: depreciation horizon for Operate / Lease assets;
  // defaults via DEFAULT_USEFUL_LIFE_YEARS keyed by category guess from
  // strategy + type when undefined (calc engine resolves the default at
  // compute time so the user can leave it blank).
  managementAgreement?: ManagementAgreement;
  usefulLifeYears?: number;
  // M2.0e: lifecycle status pill (planned / construction / operational).
  // Defaults to 'planned' on first add. Module 2 Revenue gates revenue
  // streams off this; today the calc engine ignores it (visible flag
  // still controls inclusion in cost rollups).
  status?: AssetStatus;
  // M2.0i Fix 10 (2026-05-07): per-asset historical baseline (only
  // consumed when asset.status === 'operational'). Mirrors the phase-
  // level shape but scoped to a single asset within an otherwise mixed
  // phase (e.g. Phase 1 has Hotel operational + Apt-Tower-3 still in
  // construction, each carries its own baseline).
  historicalBaseline?: PhaseHistoricalBaseline;
  // M2.0 Pass 15 (2026-05-13): per-asset pre-capex with explicit debt +
  // equity entry. Only consumed when the asset belongs to an operational
  // phase. The brief moves the historical-cost entry out of the
  // phase-level baseline so each asset in a mixed phase can carry its
  // own sunk-cost split. Validation chip in the Tab 1 UI shows
  // green Balances when total pre-capex === historicalDebtAmount +
  // historicalEquityAmount (within rounding), amber Mismatch otherwise.
  // Engine wire: pre-capex feeds Tab 4 Capex Breakdown prior column;
  // debt feeds Total Debt Required prior column; equity feeds Equity
  // Required prior column.
  //
  // M2.0 Pass 56 (2026-05-16): pre-capex split into two components so
  // future depreciation can apply only to the depreciable portion.
  //   - historicalPreCapexLand: land basis (NOT depreciated later).
  //   - historicalPreCapexBuilding: building + infrastructure capex
  //     (depreciated later over usefulLifeYears).
  // Total pre-capex is derived via getAssetPreCapexTotal(asset) and is
  // what feeds every downstream consumer (engine aggregate, dashboard
  // tile, balance chip). Legacy historicalPreCapex stays on schema for
  // back-compat; migrateM20pass56SplitPreCapex seeds Building from it
  // when the split is absent (Land defaults to 0 for the user to set).
  historicalPreCapexLand?: number;
  historicalPreCapexBuilding?: number;
  /** @deprecated since Pass 56. Use historicalPreCapexLand + historicalPreCapexBuilding (sum via getAssetPreCapexTotal). */
  historicalPreCapex?: number;
  historicalDebtAmount?: number;
  historicalEquityAmount?: number;
  // M2.0 Pass 8 (2026-05-12): per-asset NDA inputs (when
  // project.projectNdaScope === 'asset'). Each asset can carry its own
  // Roads %/Parks % deduction; Apply Roads/Parks toggle gates whether
  // the asset's NDA reduction applies at all. Defaults: undefined / 0.
  assetRoadsPct?: number;
  assetParksPct?: number;
  assetNdaEnabled?: boolean;
  // M2.0 Pass 8 Fix 2c: sub-unit metric uniform per asset. Replaces the
  // per-row SubUnit.metric. Migration takes the first sub-unit's metric
  // as the asset metric. SubUnit.metric stays on schema for back-compat.
  subUnitMetric?: SubUnitMetric;
  // P10-Fix 4 (2026-05-12): Sell + Manage companion-asset linkage. When
  // the user picks 'Sell + Manage' as strategy on an asset, a companion
  // Operate asset is auto-created with name '[Parent] - Operate'.
  // parentAssetId points at the parent (sell) asset; isCompanion marks
  // the row as auto-generated; companionType captures the role (today
  // only 'operate'). The companion inherits its units count from the
  // parent's total sellable units (unitsFromParent updates when the
  // parent's sub-units change). Companions are filtered out of land
  // allocation aggregation (computeAssetLandSqm + aggregatePhaseMetrics)
  // so they do NOT double-count land basis. Cascade-delete on parent
  // removal is handled in module1-store.ts removeAsset.
  parentAssetId?: string;
  isCompanion?: boolean;
  companionType?: 'operate';
  unitsFromParent?: number;
}

// M2.0 Pass 56 (2026-05-16): single resolver for an asset's total
// historical pre-capex. Sums the Land + Building/Infra split; when
// neither new field is set, falls back to the legacy historicalPreCapex
// value so pre-migration snapshots keep producing the same total.
// All downstream consumers (engine existing aggregate, Dashboard tile,
// balance chip in Tab 4 Existing Operations panel) read through this
// helper so future depreciation logic only needs to touch the Building
// portion (historicalPreCapexBuilding) without re-deriving the total.
export function getAssetPreCapexTotal(a: Asset): number {
  const land = a.historicalPreCapexLand;
  const building = a.historicalPreCapexBuilding;
  if (land == null && building == null) {
    return Math.max(0, a.historicalPreCapex ?? 0);
  }
  return Math.max(0, land ?? 0) + Math.max(0, building ?? 0);
}

// ── Cost line (v6: open-ended catalog) ─────────────────────────────────────
// M2.0c bumps from 9 fixed lines to a 12-default open-ended catalog so the
// pre-M2.0 cost engine functionality can be restored. Each line carries:
//
//   id             open string id (`'land-cash'`, `'site-prep'`, `'custom-1'`)
//   name           free-text display name
//   method         one of 12 calculation methods (see CostMethod)
//   value          rate or percent or fixed amount, depending on method
//   stage          land / hard / soft / operating
//   scope          direct / indirect / allocated
//   allocationBasis  per-asset / bua-share / gfa-share / land-share / category / manual
//   startPeriod    inclusive period index (0 = upfront / period 0)
//   endPeriod      inclusive period index in the construction window
//   phasing        even / frontloaded / backloaded / sCurve / manual / phase-aligned
//   distribution[] manual phasing weights (sum to 1), length = endPeriod-startPeriod+1
//   selectedLineIds[] for percent_of_selected, the ids whose totals are summed as base
//   isLocked       seed lines like Land Cash that the user cannot delete
//   requiresCountry optional gate: line only renders when project.country matches
//
// Per-asset overrides live in costOverrides keyed by `${assetId}.${lineId}`.
// Override carries the same method/value/phasing fields; everything else
// (stage, scope, allocationBasis) inherits from the base line.
export type CostMethod =
  | 'fixed'                    // lump sum currency amount
  | 'rate_per_land'            // value × resolved land area (sqm)
  | 'rate_per_nda'             // value × net developable area (land × (1 - roads%))
  | 'rate_per_roads'           // value × roads area
  | 'rate_per_gfa'             // value × asset.gfaSqm
  | 'rate_per_bua'             // value × asset.buaSqm OR derived BUA total
  | 'rate_per_nsa'             // value × asset.sellableBuaSqm
  | 'rate_per_unit'            // value × sub-unit count (Sellable category)
  | 'rate_per_parking_bay'     // value × asset.parkingBaysRequired (M2.0d)
  // M2.0g Fix 4 additions (2026-05-06):
  | 'rate_x_support_area'      // value × asset.supportArea (asset-level)
  | 'rate_x_parking_area'      // value × asset.parkingArea (asset-level)
  | 'rate_x_specific_subunit'  // value × area of a specific sub-unit (line.subUnitId)
  // M2.0h Fix 5 (2026-05-07): per-sub-unit custom rates. line.perSubUnitRates
  // holds a rate per sub-unit id plus optional special keys '__support__' /
  // '__parking__' for the asset-level Support and Parking rows. Total =
  // sum of (area × rate) across all rows.
  | 'per_sub_unit_custom_rates'
  | 'percent_of_selected'      // value% × sum of selectedLineIds totals
  | 'percent_of_construction'  // value% × sum of stage='hard' line totals
  | 'percent_of_total_land'    // value% × parcels total value
  | 'percent_of_cash_land'     // value% × parcels cash value
  | 'percent_of_inkind_land'   // value% × parcels in-kind value
  // T3-edit-runtime v7 (2026-05-13): commission cost lines tied to
  // asset revenue from Tab 2 sub-units. All three resolve via
  // metrics.totalRevenue (sum of metricValue x unitPrice across
  // Sellable / Operable / Leasable sub-units). cash / sale basis
  // distinction kept on schema for M2.1 forward-compat; today all
  // three produce the same per-asset total.
  | 'percent_of_total_revenue' // value% × Tab 2 total revenue
  | 'percent_of_revenue_cash'  // value% × revenue collected per period (cash basis)
  | 'percent_of_revenue_sale'; // value% × revenue recognised per period (sale basis)

export const COST_METHODS: readonly CostMethod[] = [
  'fixed',
  'rate_per_land',
  'rate_per_nda',
  'rate_per_roads',
  'rate_per_gfa',
  'rate_per_bua',
  'rate_per_nsa',
  'rate_per_unit',
  'rate_per_parking_bay',
  'rate_x_support_area',
  'rate_x_parking_area',
  'rate_x_specific_subunit',
  'per_sub_unit_custom_rates',
  'percent_of_selected',
  'percent_of_construction',
  'percent_of_total_land',
  'percent_of_cash_land',
  'percent_of_inkind_land',
  'percent_of_total_revenue',
  'percent_of_revenue_cash',
  'percent_of_revenue_sale',
] as const;

// M2.0h Fix 5: special keys for asset-level Support / Parking rows in
// the perSubUnitRates dictionary. These do not collide with sub-unit
// ids (which are guid-style strings).
export const PER_SUBUNIT_RATE_KEY_SUPPORT = '__support__';
export const PER_SUBUNIT_RATE_KEY_PARKING = '__parking__';

export const COST_METHOD_LABELS: Record<CostMethod, string> = {
  fixed:                   'Fixed Amount',
  rate_per_land:           'Rate × Land Area',
  rate_per_nda:            'Rate × NDA',
  rate_per_roads:          'Rate × Roads',
  rate_per_gfa:            'Rate × GFA',
  rate_per_bua:            'Rate × BUA Total',
  rate_per_nsa:            'Rate × Sellable BUA',
  rate_per_unit:           'Rate × Unit Count',
  rate_per_parking_bay:    'Rate × Parking Bays',
  rate_x_support_area:     'Rate × Support Area',
  rate_x_parking_area:     'Rate × Parking Area',
  rate_x_specific_subunit: 'Rate × Specific Sub-unit',
  per_sub_unit_custom_rates: 'Per sub-unit custom rates',
  percent_of_selected:     '% of Selected Lines',
  percent_of_construction: '% of Construction',
  percent_of_total_land:   '% of Total Land Value',
  percent_of_cash_land:    '% of Cash Land Value',
  percent_of_inkind_land:  '% of In-Kind Land Value',
  percent_of_total_revenue: '% of Total Revenue',
  percent_of_revenue_cash: '% of Total Revenue (Cash Basis)',
  percent_of_revenue_sale: '% of Total Revenue (Sale Basis)',
};

export type CostStage = 'land' | 'hard' | 'soft' | 'operating';

export const COST_STAGES: readonly CostStage[] = ['land', 'hard', 'soft', 'operating'] as const;

export const COST_STAGE_LABELS: Record<CostStage, string> = {
  land:      'Land',
  hard:      'Hard Cost',
  soft:      'Soft Cost',
  operating: 'Operating',
};

export type CostScope = 'direct' | 'indirect' | 'allocated';

export const COST_SCOPES: readonly CostScope[] = ['direct', 'indirect', 'allocated'] as const;

export type AllocationBasis =
  | 'per_asset'      // each asset has its own line; values sum
  | 'bua_share'      // project line allocated by BUA share
  | 'gfa_share'      // project line allocated by GFA share
  | 'land_share'     // project line allocated by land share
  | 'category'       // project line allocated by Sell / Operate / Lease / Sell + Manage bucket
  | 'manual';        // user defines per-asset weights (defer to override)

export const ALLOCATION_BASES: readonly AllocationBasis[] = [
  'per_asset',
  'bua_share',
  'gfa_share',
  'land_share',
  'category',
  'manual',
] as const;

// M2.0L Pass 5 (2026-05-11): Cost Category. User-facing distinction
// between asset-specific (Direct) and project-wide pool (Allocated)
// cost lines.
//   'direct'    -> the cost computes against the asset it's evaluated
//                  for. Per-asset overrides apply normally.
//   'allocated' -> the cost is a project-wide pool. Each asset's share
//                  = total pool x driver factor (BUA / Land / Value
//                  share). Driver is required when category is
//                  'allocated'; ignored otherwise.
export type CostCategory = 'direct' | 'allocated';

export const COST_CATEGORIES: readonly CostCategory[] = ['direct', 'allocated'] as const;

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  direct:    'Direct (asset-specific)',
  allocated: 'Allocated (project pool, split by driver)',
};

export type CostDriver = 'bua_share' | 'land_share' | 'value_share';

export const COST_DRIVERS: readonly CostDriver[] = ['bua_share', 'land_share', 'value_share'] as const;

export const COST_DRIVER_LABELS: Record<CostDriver, string> = {
  bua_share:   'BUA share',
  land_share:  'Land share',
  value_share: 'Value share',
};

// M2.0L Pass 5: Internal auto-derived cost type from method + stage.
// Not stored on the line; derived at compute time via deriveCostType().
// Powers Results tables + future M5 benchmark callouts.
export type CostType = 'hard' | 'soft' | 'land_cash' | 'land_in_kind' | 'operating';

export const COST_TYPES: readonly CostType[] = ['hard', 'soft', 'land_cash', 'land_in_kind', 'operating'] as const;

// M2.0j Fix 9 (2026-05-07): phasing simplified from 6 options to 2.
// Real users only need Even (default) or Manual % (custom curve). The 4
// dropped values ('frontloaded' / 'backloaded' / 'sCurve' / 'phase_aligned')
// are still ACCEPTED on read for legacy snapshots and treated as 'even';
// the calc engine's distribute() helper continues to recognise them so
// behaviour is bit-identical (an even spread). UI dropdown shows only
// 'even' and 'manual'.
export type CostPhasing =
  | 'even'           // equal slice per period in [startPeriod, endPeriod]
  | 'manual'         // distribution[] supplies per-period weights (sum = 1)
  // Legacy values, accepted on read (treated as 'even') but not user-pickable
  | 'frontloaded'
  | 'backloaded'
  | 'sCurve'
  | 'phase_aligned';

// User-pickable phasing values (Fix 9). Use this for dropdown rendering;
// COST_PHASINGS still includes legacy values for read-side compat.
export const COST_PHASING_OPTIONS: readonly CostPhasing[] = ['even', 'manual'] as const;

export const COST_PHASINGS: readonly CostPhasing[] = [
  'even',
  'frontloaded',
  'backloaded',
  'sCurve',
  'manual',
  'phase_aligned',
] as const;

// Fix 9: helper used by migrate to fold deprecated phasing values into
// 'even' on save. Read-side keeps recognising them so older snapshots load.
export function normalizeCostPhasing(p: CostPhasing | undefined): CostPhasing {
  if (p === 'frontloaded' || p === 'backloaded' || p === 'sCurve' || p === 'phase_aligned') return 'even';
  return p ?? 'even';
}

export interface CostLine {
  id: string;
  phaseId: string;
  name: string;
  method: CostMethod;
  value: number;
  stage: CostStage;
  scope: CostScope;
  allocationBasis: AllocationBasis;
  startPeriod: number;
  endPeriod: number;
  phasing: CostPhasing;
  distribution?: number[];
  selectedLineIds?: string[];
  isLocked?: boolean;
  requiresCountry?: string;
  // M2.0d: per-line toggle (UI on/off). When true the line contributes 0
  // to all assets' rollups regardless of method / value.
  disabled?: boolean;
  // M2.0d: when set, the line is a CUSTOM line targeted at exactly one
  // asset (via "+ Add Custom Cost" in that asset's per-asset section).
  // The Costs tab UI hides target-tagged lines from other assets'
  // sections. When undefined, the line is project-wide (the standard 9
  // catalog and any future user-added project-level lines).
  targetAssetId?: string;
  // M2.0g Fix 4 (2026-05-06): only consumed when method =
  // 'rate_x_specific_subunit'. Identifies the sub-unit whose area the
  // rate multiplies against (e.g. construction rate for hotel keys vs
  // branded suites differs).
  subUnitId?: string;
  // M2.0h Fix 5 (2026-05-07): only consumed when method =
  // 'per_sub_unit_custom_rates'. Maps sub-unit id -> rate (currency
  // per sqm). Special keys '__support__' / '__parking__' carry rates
  // for the asset-level Support and Parking rows. When a sub-unit id
  // is missing, the row falls back to line.value as default rate so
  // a line that switched into this method without explicit rates
  // still produces a sensible total.
  perSubUnitRates?: Record<string, number>;
  // M2.0L Pass 5 (2026-05-11): Cost category. Optional; defaults to
  // 'direct' on hydrate via migrateM20Pass5Categories so legacy
  // snapshots keep their Pass-3+ asset-specific compute path.
  costCategory?: CostCategory;
  // M2.0L Pass 5 (2026-05-11): Driver. Only consumed when
  // costCategory === 'allocated'. Picks the share key the calc engine
  // uses to split the project-wide pool across visible assets in the
  // phase.
  costDriver?: CostDriver;
}

export interface CostOverride {
  assetId: string;
  lineId: string;
  method: CostMethod;
  value: number;
  phasing: CostPhasing;
  distribution?: number[];
  // M2.0d: per-asset on/off toggle. When true this asset zeros out the
  // line regardless of value or method. Independent of CostLine.disabled
  // (which zeros out the line for ALL assets).
  disabled?: boolean;
  // M2.0h Fix 5: per-asset override of perSubUnitRates so each asset
  // can carry its own rate sheet on top of a project-wide line.
  perSubUnitRates?: Record<string, number>;
  // M2.0L Pass 4 (2026-05-11): explicit inheritance toggle.
  //   undefined  -> legacy entry, treated as overridden=true (intentional
  //                 override pre-Pass-4).
  //   false      -> override exists but is inactive; resolver reads master.
  //   true       -> override is active; each defined field overrides
  //                 master, undefined fields fall back to master.
  overridden?: boolean;
  // M2.0L Pass 4 (2026-05-11): optional per-asset timing override. When
  // either is set AND overridden !== false, the calc engine substitutes
  // these for the master line's startPeriod / endPeriod when computing
  // this asset's contribution + per-period distribution.
  startPeriod?: number;
  endPeriod?: number;
  // Method 2 removed 2026-05-13: the per-asset debt/equity override
  // fields previously here (debtPctOverride, equityPctOverride) were
  // only consumed by Method 2 Line-Item Based Financing. They are
  // stripped from any loaded snapshot by migrateM20pass5DropMethod2.
}

// ── Financing tranche ──────────────────────────────────────────────────────
// Per-phase debt instrument. Multiple tranches per phase supported (senior
// + mezzanine, multi-currency, etc.). All financial math is currency-
// neutral; the UI assumes the tranche pulls from the project's currency.
//
// drawdownMethod:
//   'sameAsCost'      -> tranche draws in lockstep with the construction
//                        capex curve (default for most projects)
//   'evenOverPhase'   -> equal slices across constructionPeriods
//   'frontloaded'     -> S-curve weighted toward early periods
//   'backloaded'      -> S-curve weighted toward late periods
//   'manual'          -> drawdownDistribution[] supplies per-period weights
//
// repaymentMethod:
//   'fixedSchedule'   -> straight-line principal across repaymentPeriods,
//                        interest accrues on outstanding balance
//   'cashSweep'       -> all available cash above cashFloorPct goes to
//                        principal until extinguished
//   'bullet'          -> interest-only during ops, principal due at
//                        repaymentPeriods (single bullet payment)
//
// idcCapitalize: when true, interest during construction (period <=
// constructionEnd) is added to principal rather than paid. When false,
// IDC is expensed in P&L during construction and reduces equity.
//
// cashSweep-only fields:
//   sweepStartPeriod: 0 (default) sweeps continuously; positive integer
//                     defers sweep until that period.
//   cashFloorPct:     % of monthly cash retained before sweep applies.
// M2.0c expands the drawdown matrix from 5 modes to 5 distinct
// economic models pre-M2.0 supported. capex_basis is the legacy
// 'sameAsCost' renamed; manual stays; debt_equity_ratio is the
// legacy 'fixed' financingMode + globalDebtPct path; capex_minus_-
// presales nets pre-sales (Module 2 supplies the schedule when ready
// in M2.1, today defaults to zero); min_cash_floor watches the
// running cash position and draws to keep cash >= floor.
// M2.0L (2026-05-11): drawdown matrix widens to 9 methods (5 original
// + 4 new). The 4 new options come from the M2.0L brief:
//   - 'front_loaded': 100% in first period of availability (bullet draw)
//   - 'equal_periodic': equal drawdown each period across availability
//   - 'custom_schedule': per-period absolute amounts (not %)
//   - 'cash_available' alias to capex_minus_presales (KPMG MAAD pattern)
// The 5 original values continue to be accepted; the calc engine
// resolves cash_available -> capex_minus_presales.
export type DrawdownMethod =
  | 'capex_basis'           // tracks construction capex curve × ltvPct
  | 'manual'                // distribution[] per period (weights, sum to 1)
  | 'debt_equity_ratio'     // ltvPct of capex per period
  | 'capex_minus_presales'  // (capex - presales) × ltvPct, with land toggle
  | 'min_cash_floor'        // draws when running cash < floor
  | 'front_loaded'          // 100% in first period of availability
  | 'equal_periodic'        // equal drawdown across availability period
  | 'custom_schedule'       // per-period absolute amounts (drawdownCustomSchedule[])
  | 'cash_available';       // alias to capex_minus_presales (MAAD pattern)

export const DRAWDOWN_METHODS: readonly DrawdownMethod[] = [
  'capex_basis',
  'manual',
  'debt_equity_ratio',
  'capex_minus_presales',
  'min_cash_floor',
  'front_loaded',
  'equal_periodic',
  'custom_schedule',
  'cash_available',
] as const;

export const DRAWDOWN_METHOD_LABELS: Record<DrawdownMethod, string> = {
  capex_basis:          'Matched to CapEx (Debt % × CapEx)',
  manual:               'Manual % per Period',
  debt_equity_ratio:    'Debt/Equity Ratio % of CapEx',
  capex_minus_presales: 'CapEx minus Pre-sales',
  min_cash_floor:       'Minimum Cash Floor',
  front_loaded:         'Front-loaded (Bullet draw, Y1)',
  equal_periodic:       'Equal Periodic over Availability',
  custom_schedule:      'Custom per-period amounts',
  cash_available:       'Cash-Available Basis',
};

// Repayment matrix:
// 'manual' -> distribution[] per period
// 'straight_line' -> equal principal per period across repaymentPeriods
// 'cashsweep_continuous' -> sweeps every period after construction
// 'cashsweep_from_period' -> sweeps from sweepStartPeriod onward
// 'cashsweep_min_cash' -> sweeps to keep cash above sweepMinCashFloor
// M2.0L (2026-05-11): repayment matrix widens to 9 methods (5 original
// + 4 new). New: equal_periodic_amortization (annuity PMT), bullet
// (interest only + principal at maturity), balloon (small periodic +
// large balloon), custom_schedule (per-period amounts).
// P2-Fix 5 (2026-05-11): repayment matrix collapses to 3 user-visible
// methods. Legacy values stay on the type for snapshot compat; the UI
// emits only the 3 new ones. migrateM20mPass2Financing remaps existing
// snapshots.
export type RepaymentMethod =
  // ── New (P2-Fix 5) ────────────────────────────────────────────────
  | 'equal_repayment'                   // sub-mode: equal_total (annuity) or equal_principal
  | 'year_on_year_pct'                  // yearOnYearPctSchedule[] per period
  | 'cash_sweep'                        // cashSweepConfig: { startingYear, sweepRatio }
  // ── Legacy (kept for snapshot back-compat, never emitted by UI) ───
  | 'manual'
  | 'straight_line'
  | 'cashsweep_continuous'
  | 'cashsweep_from_period'
  | 'cashsweep_min_cash'
  | 'equal_periodic_amortization'
  | 'bullet'
  | 'balloon'
  | 'custom_schedule';

export const REPAYMENT_METHODS: readonly RepaymentMethod[] = [
  'equal_repayment',
  'year_on_year_pct',
  'cash_sweep',
  // Legacy keys retained for snapshot loaders only.
  'manual',
  'straight_line',
  'cashsweep_continuous',
  'cashsweep_from_period',
  'cashsweep_min_cash',
  'equal_periodic_amortization',
  'bullet',
  'balloon',
  'custom_schedule',
] as const;

// UI dropdowns iterate this 3-element constant.
export const REPAYMENT_METHODS_USER: readonly RepaymentMethod[] = [
  'equal_repayment',
  'year_on_year_pct',
  'cash_sweep',
] as const;

export const REPAYMENT_METHOD_LABELS: Record<RepaymentMethod, string> = {
  equal_repayment:              'Equal Repayment',
  year_on_year_pct:             'Year-on-Year %',
  cash_sweep:                   'Cash Sweep',
  // Legacy labels (kept so any old snapshot still renders a name).
  manual:                       'Manual % per Period (legacy)',
  straight_line:                'Equal Principal (legacy)',
  cashsweep_continuous:         'Cash Sweep, Continuous (legacy)',
  cashsweep_from_period:        'Cash Sweep, from Period N (legacy)',
  cashsweep_min_cash:           'Cash Sweep, Maintain Floor (legacy)',
  equal_periodic_amortization:  'Equal Periodic Payment (legacy)',
  bullet:                       'Bullet at Maturity (legacy)',
  balloon:                      'Balloon (legacy)',
  custom_schedule:              'Custom per-period amounts (legacy)',
};

// P2-Fix 5: sub-mode for the new equal_repayment method.
export type EqualRepaymentSubMethod = 'equal_total' | 'equal_principal';

export const EQUAL_REPAYMENT_SUB_METHODS: readonly EqualRepaymentSubMethod[] = ['equal_total', 'equal_principal'] as const;

export const EQUAL_REPAYMENT_SUB_METHOD_LABELS: Record<EqualRepaymentSubMethod, string> = {
  equal_total:     'Equal Total Payment (annuity)',
  equal_principal: 'Equal Principal (declining)',
};

// M2.0L (2026-05-11): debt facility extensions. Optional fields keep
// v8 additive. Legacy FinancingTranche shape continues to compute via
// the calc engine; new fields enable multi-facility (senior_construction
// / senior_term / mezzanine / bridge / bullet), IDC treatment matrix
// (capitalize / expense / mixed), fees (upfront + commitment), covenants
// (DSCR + Debt %, informational), prepayments, PIK toggle, principal as
// absolute amount alternative to ltvPct.
export type FacilityType =
  | 'senior_construction'
  | 'senior_term'
  | 'mezzanine'
  | 'bridge'
  | 'bullet'
  | 'other';

export const FACILITY_TYPES: readonly FacilityType[] = [
  'senior_construction',
  'senior_term',
  'mezzanine',
  'bridge',
  'bullet',
  'other',
] as const;

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  senior_construction: 'Senior Construction Loan',
  senior_term:         'Senior Term Loan',
  mezzanine:           'Mezzanine',
  bridge:              'Bridge',
  bullet:              'Bullet Facility',
  other:               'Other',
};

export type InterestRateType = 'fixed' | 'floating';

export type BaseRate =
  | 'saibor_1m' | 'saibor_3m' | 'saibor_6m'
  | 'sofr' | 'eibor';

export const BASE_RATES: readonly BaseRate[] = ['saibor_1m', 'saibor_3m', 'saibor_6m', 'sofr', 'eibor'] as const;

export const BASE_RATE_LABELS: Record<BaseRate, string> = {
  saibor_1m: 'SAIBOR 1M',
  saibor_3m: 'SAIBOR 3M',
  saibor_6m: 'SAIBOR 6M',
  sofr:      'SOFR',
  eibor:     'EIBOR',
};

// M2.0L: IDC treatment per IFRS 23. 'capitalize' adds IDC to asset
// basis (auto-generates a read-only cost line in Tab 3). 'expense'
// charges to P&L immediately. 'mixed' capitalizes during construction
// and expenses afterwards (idcMixedSplitPeriod is the cut-over).
export type IDCTreatment = 'capitalize' | 'expense' | 'mixed';

export const IDC_TREATMENTS: readonly IDCTreatment[] = ['capitalize', 'expense', 'mixed'] as const;

export const IDC_TREATMENT_LABELS: Record<IDCTreatment, string> = {
  capitalize: 'Capitalize (IFRS 23 standard)',
  expense:    'Expense (P&L during construction)',
  mixed:      'Mixed (capitalize then expense)',
};

// M2.0L: fee treatment. 'capitalize' adds to asset basis like IDC
// when treatment matches; 'expense' charges to P&L; 'amortize'
// spreads over tenor as interest-equivalent.
export type FeeTreatment = 'capitalize' | 'expense' | 'amortize';

export const FEE_TREATMENTS: readonly FeeTreatment[] = ['capitalize', 'expense', 'amortize'] as const;

export const FEE_TREATMENT_LABELS: Record<FeeTreatment, string> = {
  capitalize: 'Capitalize to asset',
  expense:    'Expense to P&L',
  amortize:   'Amortize over tenor',
};

// M2.0L: equity tranche type. 'cash' = sponsor / LP cash. 'in_kind'
// = non-cash contribution (land, sweat equity). 'jv' = joint venture
// partner.
export type EquityTrancheType = 'cash' | 'in_kind' | 'jv';

export const EQUITY_TRANCHE_TYPES: readonly EquityTrancheType[] = ['cash', 'in_kind', 'jv'] as const;

export const EQUITY_TRANCHE_TYPE_LABELS: Record<EquityTrancheType, string> = {
  cash:    'Cash Equity',
  in_kind: 'In-Kind',
  jv:      'JV Partner',
};

export interface FinancingTranche {
  id: string;
  phaseId: string;
  // M2.0c: optional per-asset financing detail. When set, the tranche
  // only finances this asset's slice of the phase capex; otherwise it
  // finances the whole phase pro-rata across visible assets.
  assetId?: string;
  name: string;
  /**
   * @deprecated M2.0 Pass 18 (2026-05-13). Per-facility drawdown is now
   * derived from the project-level funding.debtEquitySplit.debt[] series
   * scaled by `facilitySharePct`. `ltvPct` stays on schema for snapshot
   * back-compat; engine ignores it when `precomputedDrawSchedule` is
   * supplied (the new path for all UI callers).
   */
  ltvPct: number;
  interestRatePct: number;
  // Drawdown
  /**
   * @deprecated M2.0 Pass 18 (2026-05-13). Drawdown method dropdown
   * dropped from TrancheCard UI; the engine no longer consults this
   * field when `precomputedDrawSchedule` is supplied. Kept for snapshot
   * back-compat; legacy callers that omit `precomputedDrawSchedule`
   * still use this switch.
   */
  drawdownMethod: DrawdownMethod;
  drawdownDistribution?: number[];     // manual only
  drawdownIncludeLand?: boolean;       // capex_minus_presales: include land in net
  drawdownMinCashFloor?: number;       // min_cash_floor only
  // M2.0L (2026-05-11): per-period absolute amounts for custom_schedule
  drawdownCustomSchedule?: number[];
  // Repayment
  repaymentMethod: RepaymentMethod;
  repaymentPeriods: number;
  repaymentManualDistribution?: number[]; // manual only
  sweepStartPeriod?: number;              // cashsweep_from_period
  sweepMinCashFloor?: number;             // cashsweep_min_cash
  // M2.0L: per-period absolute amounts for repayment custom_schedule
  repaymentCustomSchedule?: number[];
  // IDC capitalization (interest during construction goes to principal,
  // not paid in cash). When false, interest is expensed during
  // construction and reduces equity contribution.
  // M2.0L: superseded by idcTreatment (3 options) when set; this
  // boolean remains for legacy snapshots (true -> capitalize, false ->
  // expense).
  idcCapitalize: boolean;

  // ── M2.0L (2026-05-11) extensions, all optional, additive ──────────
  facilityType?: FacilityType;
  lender?: string;
  /** Absolute principal. When set, overrides ltvPct calculation. */
  principal?: number;
  /** @deprecated 2026-05-14: floating-rate plumbing removed (no auto
   *  source for live base rates). UI surfaces a single Interest Rate %
   *  composed of Interbank Rate % + Credit Spread %. */
  interestRateType?: InterestRateType;
  /** @deprecated 2026-05-14: see interestRateType. */
  baseRate?: BaseRate;
  /** @deprecated 2026-05-14: see interestRateType. */
  spreadBps?: number;
  /** Pass 27 (2026-05-14): Interbank rate component (e.g., SAIBOR).
   *  Stored as percentage (e.g., 5.50 for 5.50%). When set together
   *  with creditSpreadPct, the engine uses their sum as the effective
   *  rate; legacy snapshots fall back to interestRatePct directly. */
  interbankRatePct?: number;
  /** Pass 27 (2026-05-14): Bank credit spread (in % points). */
  creditSpreadPct?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Engine derives tenor from
   *  `gracePeriods + repaymentPeriods`. Field stays for snapshot back-compat. */
  tenorPeriods?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Engine derives availability
   *  from the project capex window starting at `drawdownStartPeriod`.
   *  Field stays for snapshot back-compat. */
  availabilityPeriods?: number;
  /** @deprecated 2026-05-14: grace period concept retired across the
   *  platform. Engine always treats this as 0. Field kept for legacy
   *  snapshot back-compat. */
  gracePeriods?: number;
  /** Upfront fee % of principal. */
  upfrontFeePct?: number;
  upfrontFeeTreatment?: FeeTreatment;
  /** Commitment fee % per annum on undrawn balance. */
  commitmentFeePct?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Informational covenant
   *  retired from UI pending M5 breach surfacing. */
  dscrCovenant?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Retired from UI pending
   *  M5 breach surfacing. */
  ltvCovenant?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). New facilities always
   *  capitalize during construction; engine hardcodes the behavior.
   *  Field stays for snapshot back-compat. */
  idcTreatment?: IDCTreatment;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Mixed IDC dropped along
   *  with the IDC Treatment dropdown. */
  idcMixedSplitPeriod?: number;
  /** For repaymentMethod='balloon': % of principal due at maturity. */
  balloonPct?: number;
  /** For cash-sweep repayments: % of available CF directed to principal (default 75). */
  sweepRatio?: number;
  /** @deprecated M2.0 Pass 23 (2026-05-13). Prepayments editor retired
   *  from UI pending the M5 prepayment workflow. */
  prepayments?: Array<{ period: number; amount: number }>;
  /** @deprecated M2.0 Pass 23 (2026-05-13). PIK toggle retired from UI;
   *  capitalize-during-grace is now controlled by graceInterestTreatment. */
  pikEnabled?: boolean;
  /** When true (default for capitalize/mixed treatments), auto-generate
   *  a read-only cost line in Tab 3 for the capitalized IDC. */
  autoGenerateIdcCostLine?: boolean;

  // ── M2.0M Pass 3 (2026-05-12) ────────────────────────────────────
  // P3-Fix 3: % of total debt this facility funds. Multi-facility split
  // (sums to 100% across facilities in the same scope). Single facility
  // defaults to 100. Migration adds even-split defaults when missing.
  facilitySharePct?: number;
  // P3-Fix 4: facility scope explicit on schema. UI surfaces 3 options
  // (project / phase / asset); Pass 2 hid the asset option, Pass 3
  // restores it.
  scope?: 'project' | 'phase' | 'asset';
  scopeId?: string;

  // ── M2.0M Pass 2 (2026-05-11) ────────────────────────────────────
  // P2-Fix 5: sub-mode for the new equal_repayment method.
  equalRepaymentSubMethod?: EqualRepaymentSubMethod;
  // P2-Fix 5: % per period for year_on_year_pct (sums to 100, auto-normalised).
  yearOnYearPctSchedule?: number[];
  // P2-Fix 5: cash sweep config for the new cash_sweep method.
  cashSweepConfig?: {
    startingYear: number;
    sweepRatio: number;  // 0..100, % of excess cash above project min reserve
  };
  // ── Existing Operations (2026-05-13) ──────────────────────────────
  /** Origin of the facility. 'new' = drawdown in model; 'existing' = pre-existing facility with opening balance. Default 'new'. */
  origin?: 'new' | 'existing';
  /** Opening principal balance at project Y0. Required when origin === 'existing'.
   *  Auto-prefilled from sum of operational-phase historicalBaseline.currentDebtOutstanding
   *  when the user clicks "+ Add Existing Facility"; editable thereafter. */
  openingBalance?: number;
  /** @deprecated Pass 36 (2026-05-14): Remaining Tenor field removed
   *  from UI; engine derives the runway from repaymentStartYear +
   *  remainingRepaymentPeriods directly. Field kept on schema for
   *  legacy snapshot back-compat. */
  remainingTenorPeriods?: number;
  /** Remaining repayment periods at project Y0. Required when origin === 'existing'. Replaces repaymentPeriods for existing facilities. */
  remainingRepaymentPeriods?: number;
  /** Pass 36 (2026-05-14): Calendar year the existing loan was
   *  originated (raised). When origYear >= projectStartYear, the
   *  Opening Balance draws as a cash inflow at that year. When
   *  origYear < projectStartYear (or unset), the Opening Balance
   *  carries forward at project Y0 as a pre-existing balance. */
  originationYear?: number;
  /** Pass 36 (2026-05-14): Calendar year interest starts accruing
   *  on the existing loan. Periods before interestStartYear accrue
   *  zero interest. Defaults to projectStartYear when unset. */
  interestStartYear?: number;

  // ── M2.0 Pass 20 (2026-05-13) ────────────────────────────────────
  /** @deprecated 2026-05-14: retired alongside Grace Periods. Field
   *  kept for legacy snapshot back-compat; engine ignores it. */
  graceInterestTreatment?: 'capitalize' | 'raise_via_funding' | 'raise_as_debt' | 'pay_from_ocf';

  // ── M2.0 Pass 23 (2026-05-13) ────────────────────────────────────
  /**
   * @deprecated 2026-05-14: drawdown auto-starts at the first capex
   * period (project Y1). UI no longer surfaces this field; engine
   * always treats it as 0. Retained on the type for back-compat with
   * legacy snapshots.
   */
  drawdownStartPeriod?: number;

  // ── M2.0 Pass 24 (2026-05-14) ────────────────────────────────────
  /**
   * Calendar year (e.g., 2030) when principal repayment begins.
   * Replaces the implicit `constructionEnd + grace` rule. When unset,
   * engine falls back to `projectStartYear + constructionPeriods`
   * (end of construction). For `year_on_year_pct` the YoY schedule
   * spans `[repaymentStartYear .. operationsEndYear]`; for fixed-count
   * methods (straight-line, equal-periodic, balloon, bullet) the
   * `repaymentPeriods` field still controls the count.
   */
  repaymentStartYear?: number;
}

// ── Equity contribution ────────────────────────────────────────────────────
// Per-phase equity injection. Multiple contributions per phase supported
// (sponsor + LP, staged commitments). Contribution amount is the
// remainder after debt covers ltvPct of capex, but explicit contributions
// override the default split.
//
// timing:
//   'upfront'     -> single contribution in constructionStart
//   'evenOverPhase' -> equal slices across constructionPeriods
//   'manual'      -> distribution[] supplies per-period weights
export type EquityTiming = 'upfront' | 'evenOverPhase' | 'manual';

export const EQUITY_TIMINGS: readonly EquityTiming[] = [
  'upfront',
  'evenOverPhase',
  'manual',
] as const;

export interface EquityContribution {
  id: string;
  phaseId: string;
  name: string;
  amount: number;             // currency
  timing: EquityTiming;
  distribution?: number[];    // manual only; length = constructionPeriods

  // ── M2.0L (2026-05-11) extensions, all optional, additive ──────────
  /** Cash / In-Kind / JV. Drives capital stack categorisation. */
  type?: EquityTrancheType;
  /** Free-text source: 'Sponsor', 'Landowner', 'LP Fund X', etc. */
  source?: string;
  /** Optional scope narrowing (project-wide / specific phase / specific asset). */
  scope?: 'project' | 'phase' | 'asset';
  scopeId?: string;
  /** Target IRR for waterfall (M4); stored but not yet consumed by calc engine. */
  irrHurdle?: number;
  /** Preferred return rate, % per annum (M4). */
  preferredReturn?: number;
  /** True when auto-created from a Land (In-Kind) cost line on Tab 3. */
  autoDetectedFromCostLine?: boolean;
  /** When autoDetectedFromCostLine, points back at the source cost line id. */
  sourceCostLineId?: string;
  /** Per-asset scope reference when scope='asset'. */
  assetId?: string;
}

// ── M2.0M: Project-level financing config (4 funding methods) ─────────────
// User picks ONE funding method per project. Each method has its own
// config slot. Legacy FinancingTranche[] (debt facilities) + Equity-
// Contribution[] (equity tranches) remain the source of truth for the
// capital stack; ProjectFinancingConfig sits on TOP and tells the
// engine HOW to derive the funding gap before tranches absorb it.
//
// Hook discipline: the funding-gap math reads everything through
// `FinancingDataHooks` (capex / pre-sales / OCF / closing cash). When
// upstream engines aren't ready yet, hooks return zeros, so the four
// methods behave as documented in docs/m20M-financing-architecture.md.
// Method 2 (Line-Item Based Financing) removed 2026-05-13. Old snapshots
// migrate fundingMethod 2 -> 1 via migrateM20pass5DropMethod2.
// M2.0 Pass 17 (2026-05-13): methods renumbered 1 | 3 | 4 -> 1 | 2 | 3.
// Method 1 = Fixed Debt-to-Equity Ratio (unchanged).
// Method 2 = Net Funding Requirement (was Method 3).
// Method 3 = Cash Deficit Funding (was Method 4).
// migrateM20pass17MethodRenumber backfills legacy snapshots.
export type FundingMethodId = 1 | 2 | 3 | 4;

export const FUNDING_METHOD_IDS: readonly FundingMethodId[] = [1, 2, 3, 4] as const;

export const FUNDING_METHOD_LABELS: Record<FundingMethodId, string> = {
  1: 'Fixed Debt-to-Equity Ratio',
  2: 'Net Funding Requirement',
  3: 'Cash Deficit Funding',
  4: 'Specified Debt + Equity (manual)',
};

export const FUNDING_METHOD_DESCRIPTIONS: Record<FundingMethodId, string> = {
  1: 'Single global debt% / equity% applied to total capex (excl. land in-kind).',
  2: 'Net funding = capex minus pre-sales minus operating CF minus existing cash, then split by ratio.',
  3: 'Period-by-period: draw debt+equity only when closing cash would fall below minimum reserve.',
  4: 'User specifies total debt and total equity; engine spreads them per-period via a year-on-year % schedule.',
};

export interface FundingMethod1Config {
  debtPct: number;     // 0..100
  equityPct: number;   // 0..100
}

export interface FundingMethod3Config {
  existingCash: number;
  debtPct: number;
  equityPct: number;
}

export interface FundingMethod4Config {
  initialCash: number;
  /** Scalar OR PeriodArray (period-indexed minimum cash threshold). */
  minimumCashReserve: number | number[];
  debtPct: number;
  equityPct: number;
}

// Pass 30 (2026-05-14): Method 4 (Specified Debt + Equity) lets the
// user override the capex-derived sizing entirely. They supply two
// total amounts + a per-period draw curve (sums to 100%).
export interface FundingMethodFixedAmountConfig {
  debtAmount: number;
  equityAmount: number;
  /** Per-period draw % (project axis order). Engine normalises to 100. */
  yoySchedule: number[];
}

// Per-parcel land funding (separate from the 4 project-wide methods).
//   100pct_equity     -> default; landowner-equivalent cash equity
//   100pct_debt       -> rare; standalone land loan
//   custom_split      -> user-defined debtPct + equityPct
//   in_kind           -> landowner contributes the parcel as equity;
//                        auto-detected from a Tab 3 'land-inkind' line
//   deferred_payment  -> paid in installments during construction
export type ParcelFundingType =
  | '100pct_equity'
  | '100pct_debt'
  | 'custom_split'
  | 'in_kind'
  | 'deferred_payment';

export const PARCEL_FUNDING_TYPES: readonly ParcelFundingType[] = [
  '100pct_equity',
  '100pct_debt',
  'custom_split',
  'in_kind',
  'deferred_payment',
] as const;

export const PARCEL_FUNDING_TYPE_LABELS: Record<ParcelFundingType, string> = {
  '100pct_equity':    '100% Equity',
  '100pct_debt':      '100% Debt',
  'custom_split':     'Custom Split',
  'in_kind':          'In-Kind (Landowner)',
  'deferred_payment': 'Deferred Payment',
};

export interface ParcelFundingConfig {
  parcelId: string;
  /**
   * @deprecated M2.0 Pass 16 (2026-05-13). UI replaced with direct
   * `debtPct` / `equityPct` inputs. Field retained for snapshot
   * back-compat; the engine's `parcelDebtEquityFractions` resolver
   * falls back to the legacy enum only when `debtPct` is missing.
   */
  fundingType?: ParcelFundingType;
  /** Debt % for Land Cash funding. Auto-paired with equityPct (sum = 100). */
  debtPct?: number;
  /** Equity % for Land Cash funding. Auto-paired with debtPct (sum = 100). */
  equityPct?: number;
  /**
   * @deprecated M2.0 Pass 16 (2026-05-13). Custom-split inputs collapsed
   * into the universal `debtPct` / `equityPct` pair. Kept for snapshot
   * back-compat via migration.
   */
  customDebtPct?: number;
  /** @deprecated M2.0 Pass 16 (2026-05-13). See `customDebtPct`. */
  customEquityPct?: number;
  /**
   * @deprecated M2.0 Pass 16 (2026-05-13). Deferred Payment dropped from
   * the UI; schedule is no longer reachable from the Land Funding card.
   * Field retained for snapshot back-compat. The helper
   * `expandDeferredSchedule` still exists but is no longer wired to a
   * user-facing flow.
   */
  deferredSchedule?: {
    type: 'even' | 'manual_pct';
    startPeriod: number;
    endPeriod: number;
    /** Required when type='manual_pct'. Sums to 100. */
    distribution?: number[];
  };
  /** Optional link from a debt-funded land slice to a specific facility. */
  facilityId?: string;
}

export type FundingViewMode = 'combined' | 'single_asset';

export const FUNDING_VIEW_MODES: readonly FundingViewMode[] = ['combined', 'single_asset'] as const;

export interface ProjectFinancingConfig {
  fundingMethod: FundingMethodId;
  fixedRatio?: FundingMethod1Config;
  netFundingConfig?: FundingMethod3Config;
  cashDeficitConfig?: FundingMethod4Config;
  /** Pass 30 (2026-05-14): Method 4 - Specified Debt + Equity amounts. */
  fixedAmountConfig?: FundingMethodFixedAmountConfig;
  parcelFunding: ParcelFundingConfig[];
  /** @deprecated Tab 4 is project-wide only (2026-05-13). Field kept for snapshot back-compat. Not consumed by UI. */
  viewMode: FundingViewMode;
  /** @deprecated Tab 4 is project-wide only (2026-05-13). Field kept for snapshot back-compat. Not consumed by UI. */
  selectedAssetId?: string;
  // P2-Fix 6 (2026-05-11): project-level cash floor applied across ALL
  // funding methods and cash-sweep repayments. Defaults to 0 on fresh
  // projects; migrateM20mPass2Financing lifts any legacy
  // cashDeficitConfig.minimumCashReserve into this field.
  minimumCashReserve?: number;
  /** @deprecated Tab 4 is project-wide only (2026-05-13). Field kept for snapshot back-compat. Not consumed by UI. */
  phaseFilter?: string;
  /** @deprecated Tab 4 is project-wide only (2026-05-13). Field kept for snapshot back-compat. Not consumed by UI. */
  assetFilter?: string;
}

export const ASSET_FILTER_COMBINED = '__combined__';

export const PHASE_FILTER_ALL = '__all__';

export const DEFAULT_FUNDING_METHOD_1_CONFIG: FundingMethod1Config = { debtPct: 70, equityPct: 30 };
export const DEFAULT_FUNDING_METHOD_3_CONFIG: FundingMethod3Config = { existingCash: 0, debtPct: 70, equityPct: 30 };
export const DEFAULT_FUNDING_METHOD_4_CONFIG: FundingMethod4Config = {
  initialCash: 0,
  minimumCashReserve: 0,
  debtPct: 70,
  equityPct: 30,
};

export const DEFAULT_FUNDING_METHOD_FIXED_AMOUNT_CONFIG: FundingMethodFixedAmountConfig = {
  debtAmount: 0,
  equityAmount: 0,
  yoySchedule: [],
};

export const DEFAULT_PROJECT_FINANCING_CONFIG: ProjectFinancingConfig = {
  fundingMethod: 1,
  fixedRatio: { ...DEFAULT_FUNDING_METHOD_1_CONFIG },
  parcelFunding: [],
  viewMode: 'combined',
  minimumCashReserve: 0,
  phaseFilter: PHASE_FILTER_ALL,
};

// ── M2.0e: Asset type bank by project type ────────────────────────────────
// Tab 2's asset Type dropdown filters by Project.projectType, falling
// back to ASSET_TYPES_BY_STRATEGY for legacy / Custom projects. Mixed-Use
// surfaces the union; Custom returns the same union with the implicit
// understanding the user types free-form. Each entry is a display label;
// the stored Asset.type is the same string (no separate id).
export const ASSET_TYPES_BY_PROJECT_TYPE: Record<ProjectType, readonly string[]> = {
  Residential: [
    'High-end Apartments',
    'Mid-tier Apartments',
    'Affordable Housing',
    'Branded Suites',
    'Villas',
    'Townhouses',
    'Compounds',
  ],
  Hospitality: [
    'Hotel 5-star',
    'Hotel 4-star',
    'Hotel 3-star',
    'Branded Residences',
    'Serviced Apartments',
    'Resort',
    'Boutique Hotel',
  ],
  Retail: [
    'Retail Mall',
    'Strip Retail',
    'F&B',
    'Department Store',
    'Showroom',
    'Anchor Tenant',
    'Outlet',
  ],
  Office: [
    'Office Tower (Grade A)',
    'Office Tower (Grade B)',
    'Co-working',
    'Business Park',
    'Corporate HQ',
  ],
  Industrial: [
    'Warehouse',
    'Logistics Center',
    'Light Industrial',
    'Cold Storage',
    'Distribution Hub',
  ],
  'Data Center': [
    'Hyperscale',
    'Edge Data Center',
    'Co-location',
    'Cloud Region',
  ],
  Education: [
    'University Campus',
    'Private School (K-12)',
    'Vocational Institute',
    'Training Center',
  ],
  Healthcare: [
    'Hospital (Multi-specialty)',
    'Specialty Clinic',
    'Medical Office Building',
    'Diagnostic Center',
    'Pharmacy Hub',
  ],
  Marina: [
    'Yacht Berths',
    'Waterfront F&B',
    'Marina Retail',
    'Boat Maintenance Facility',
  ],
  'Hospitality + Branded Residences': [
    'Hotel 5-star',
    'Hotel 4-star',
    'Branded Residences',
    'Serviced Apartments',
    'Resort',
    'Branded Suites',
  ],
  'Senior Living': [
    'Assisted Living',
    'Memory Care',
    'Independent Living',
    'Nursing Home',
  ],
  'Self-Storage': [
    'Climate-controlled',
    'Standard',
    'Mobile Storage',
    'Drive-up Units',
  ],
  'Mixed-Use': [
    'High-end Apartments',
    'Branded Residences',
    'Hotel 5-star',
    'Hotel 4-star',
    'Serviced Apartments',
    'Retail Mall',
    'F&B',
    'Office Tower (Grade A)',
    'Co-working',
    'Branded Suites',
    'Townhouses',
  ],
  Custom: [
    'High-end Apartments',
    'Hotel 5-star',
    'Retail Mall',
    'Office Tower (Grade A)',
    'Branded Residences',
    'Serviced Apartments',
    'Co-working',
    'Townhouses',
  ],
};

// Empty-state suggestions Tab 2 prints under each phase header when the
// phase has no assets yet, e.g. "Suggested for Mixed-Use: Residential,
// Hospitality, Retail". One-line nudge, not auto-creation.
export const SUGGESTED_CATEGORIES_BY_PROJECT_TYPE: Record<ProjectType, readonly string[]> = {
  Residential:                          ['Residential'],
  Hospitality:                          ['Hospitality'],
  Retail:                               ['Retail'],
  Office:                               ['Office'],
  Industrial:                           ['Warehouse', 'Logistics'],
  'Data Center':                        ['Hyperscale', 'Co-location'],
  Education:                            ['Campus', 'School'],
  Healthcare:                           ['Hospital', 'Clinic'],
  Marina:                               ['Berths', 'Waterfront F&B'],
  'Hospitality + Branded Residences':   ['Hotel', 'Branded Residences'],
  'Senior Living':                      ['Assisted Living', 'Independent Living'],
  'Self-Storage':                       ['Climate-controlled', 'Standard'],
  'Mixed-Use':                          ['Residential', 'Hospitality', 'Retail'],
  Custom:                               ['any combination'],
};

// ── Asset type bank ────────────────────────────────────────────────────────
// Reference list of asset types per strategy. UI offers these as auto-
// complete suggestions; user can free-text any other type.
export const ASSET_TYPES_BY_STRATEGY: Record<AssetStrategy, readonly string[]> = {
  Sell: [
    'Branded Villas',
    'Branded Apartments',
    'High-end Villas',
    'High-end Apartments',
    'Class A Apartments',
    'Class B Apartments',
    'Townhouses',
  ],
  Operate: [
    'Hotel 5-star',
    'Hotel 4-star',
    'Hotel 3-star',
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
    'Mixed Retail / F&B',
  ],
  'Sell + Manage': [
    'Branded Residences',
    'Mixed-Use Tower',
    'Lifestyle Cluster',
    'Branded Apartments (managed)',
  ],
};

// ── Default occupancy + operating margin per strategy (Module 2 seed) ──────
// Used to pre-fill SubUnit.occupancyPct / operatingMargin when the user
// adds a sub-unit. Operate uses hospitality industry typicals; Lease uses
// stabilised retail typicals; Sell leaves them undefined (no recurring
// revenue during the sell phase). Sell + Manage gets an Operate-style
// seed because the management fee accrues against the operator's running
// occupancy + margin post-handover.
export const DEFAULT_OPERATIONS_BY_STRATEGY: Record<AssetStrategy, {
  occupancyPct?: number;
  operatingMargin?: number;
}> = {
  Sell:            {},
  Operate:         { occupancyPct: 65, operatingMargin: 35 },
  Lease:           { occupancyPct: 92, operatingMargin: 80 },
  // Sell + Manage post-handover behaves like the operating partner's
  // hospitality / serviced-apartment block, hence the same operate-style
  // seed.
  'Sell + Manage': { occupancyPct: 65, operatingMargin: 30 },
};

// ── Canonical default ids ──────────────────────────────────────────────────
export const DEFAULT_PHASE_ID  = 'phase_1';
export const DEFAULT_PARCEL_ID = 'parcel_1';

// ── Factories ──────────────────────────────────────────────────────────────
export function makeDefaultPhase(
  id: string = DEFAULT_PHASE_ID,
  name: string = 'Phase 1',
  constructionPeriods = 24,
  operationsPeriods = 60,
  overlapPeriods = 0,
): Phase {
  return {
    id,
    name,
    constructionStart: 1,
    constructionPeriods,
    operationsPeriods,
    overlapPeriods,
  };
}

export function makeDefaultParcel(
  id: string = DEFAULT_PARCEL_ID,
  phaseId: string = DEFAULT_PHASE_ID,
  name: string = 'Land 1',
  area = 100000,
  rate = 500,
): Parcel {
  return {
    id,
    phaseId,
    name,
    area,
    rate,
    cashPct: 60,
    inKindPct: 40,
  };
}

export function makeDefaultProject(
  name: string = 'New Project',
  currency: string = 'SAR',
  modelType: ModelGranularity = 'annual',
): Project {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    name,
    currency,
    // M2.0g v8: modelType always 'annual' on new projects; outputGranularity
    // controls the reporting view.
    modelType: 'annual',
    startDate: `${yyyy}-${mm}-${dd}`,
    status: 'draft',
    location: '',
    country: '',
    projectRoadsPct: 0,
    projectType: 'Mixed-Use',
    // M2.0M Pass 6 Fix 2 (2026-05-11): default reporting view switches
    // to thousands + 0 decimals. The header line carries the scale
    // indicator ("All figures in SAR '000") so cells render as integer
    // thousands. Legacy default combo (full + 2) is migrated only when
    // BOTH match the prior defaults; explicit user customisation is
    // preserved by migrateM20mPass6DisplayDefaults.
    displayScale: 'thousands',
    displayDecimals: 0,
    outputGranularity: 'annual',
    // M2.0M (2026-05-11): start every new project on Method 1 (70/30)
    // with no per-parcel land funding configs and Combined view.
    // P2-Fix 6 + Fix 10: minimumCashReserve=0 + phaseFilter='__all__' by default.
    financing: {
      fundingMethod: 1,
      fixedRatio: { ...DEFAULT_FUNDING_METHOD_1_CONFIG },
      parcelFunding: [],
      viewMode: 'combined',
      minimumCashReserve: 0,
      phaseFilter: PHASE_FILTER_ALL,
    },
  };
}

// ── M2.0d: standard 9-line cost catalog ───────────────────────────────────
// User-facing list (tracked by stable internal id; user can rename freely).
// Stage / scope are auto-derived from the id (deriveCostStage in calc
// engine); the value here is just the seed so the field is non-undefined.
//
// 9 user-facing lines, 10 internal rows. Land splits into Land (Cash)
// and Land (In-Kind) at the storage layer because they have distinct cash
// flow + in-kind equity treatments (Fix 8). The Costs tab UI groups them
// as a single "Land" row by default; the underlying override surface
// stays per-internal-id so rates tracking the parcel split stay sane.
export const STANDARD_COST_LINE_IDS = [
  'land-cash',
  'land-inkind',
  'construction-bua',
  'construction-parking',
  'infrastructure',
  'landscaping',
  'pre-operating',
  'professional-fee',
  'commission',
  'contingency',
] as const;
export type StandardCostLineId = typeof STANDARD_COST_LINE_IDS[number];

// M2.0L (2026-05-11): cost line ids are now phase-scoped to keep them
// globally unique across multi-phase projects. Pre-M2.0L snapshots
// stored hardcoded base ids ('land-cash', etc.) per phase, so a
// 2-phase project produced 20 lines whose ids collided across phases.
// The store updateCostLine / removeCostLine mutated every line with
// the matching id (silently corrupting the other phase), and the
// Results page filter at Module1Costs.tsx ignored phaseId and walked
// duplicates. Composing the id with the phaseId fixes both at the
// storage layer; migrateM20lDedupeCostLineIds in module1-migrate
// retrofits legacy snapshots on hydrate.
//
// Format: `${baseId}__${phaseId}` (double underscore separator,
// distinct from the single underscore in default phase ids like
// 'phase_1'). Custom user lines use `custom-${timestamp}` and don't
// need scoping since they're already unique.
const PHASE_ID_SEPARATOR = '__';

export function composeLineId(baseId: string, phaseId: string): string {
  if (!phaseId) return baseId;
  if (baseId.includes(PHASE_ID_SEPARATOR)) return baseId; // already scoped
  return `${baseId}${PHASE_ID_SEPARATOR}${phaseId}`;
}

export function deriveLineBaseId(lineId: string): string {
  const idx = lineId.indexOf(PHASE_ID_SEPARATOR);
  return idx === -1 ? lineId : lineId.slice(0, idx);
}

export function isStandardCostLineBaseId(baseId: string): baseId is StandardCostLineId {
  return (STANDARD_COST_LINE_IDS as readonly string[]).includes(baseId);
}

// constructionPeriods is read so endPeriod can default to the phase
// duration. If 0 (no phase yet), endPeriod defaults to 24 to match
// makeDefaultPhase.
export function makeDefaultCostLines(phaseId: string, constructionPeriods = 24): CostLine[] {
  const cp = Math.max(1, constructionPeriods);
  // T3-defaults Fix 4 (2026-05-12): construction-line endPeriod defaults
  // to cp+1 (one-period buffer beyond construction) per brief so heavy
  // costs spilling into the first operations period are captured by
  // default. User can shorten back to cp via the input. Land Cash + Land
  // In-Kind keep startPeriod=0/endPeriod=0 (single-period upfront draw).
  const cpEnd = cp + 1;
  // M2.0L (2026-05-11): every seed line id is composed with phaseId
  // so a multi-phase project produces globally unique ids.
  // selectedLineIds reference the phase-scoped peer ids in the SAME phase.
  const id = (baseId: StandardCostLineId): string => composeLineId(baseId, phaseId);
  return [
    // ── Land (cash + in-kind, both locked: derive from parcels) ─────────
    {
      id: id('land-cash'), phaseId, name: 'Land (Cash)',
      method: 'percent_of_cash_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
      isLocked: true,
    },
    {
      id: id('land-inkind'), phaseId, name: 'Land (In-Kind)',
      method: 'percent_of_inkind_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
      isLocked: true,
    },
    // ── Construction (BUA + Parking) ────────────────────────────────────
    {
      id: id('construction-bua'), phaseId, name: 'Construction (BUA)',
      method: 'rate_per_bua', value: 4500,
      stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cpEnd, phasing: 'even',
    },
    {
      id: id('construction-parking'), phaseId, name: 'Construction (Parking)',
      method: 'rate_per_parking_bay', value: 25000,
      stage: 'hard', scope: 'direct', allocationBasis: 'per_asset',
      startPeriod: 1, endPeriod: cpEnd, phasing: 'even',
    },
    // ── Infrastructure / Landscaping ────────────────────────────────────
    {
      id: id('infrastructure'), phaseId, name: 'Infrastructure',
      method: 'rate_per_nda', value: 250,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 1, endPeriod: cpEnd, phasing: 'even',
    },
    {
      id: id('landscaping'), phaseId, name: 'Landscaping',
      method: 'rate_per_nda', value: 75,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: Math.max(1, Math.floor(cp / 2)), endPeriod: cpEnd, phasing: 'even',
    },
    // ── Pre-operating (% of Construction + Infra + Landscaping) ─────────
    {
      id: id('pre-operating'), phaseId, name: 'Pre-operating',
      method: 'percent_of_selected', value: 3,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: Math.max(1, cp - 6), endPeriod: cpEnd, phasing: 'even',
      selectedLineIds: [id('construction-bua'), id('construction-parking'), id('infrastructure'), id('landscaping')],
    },
    // ── Professional Fee (% of Construction BUA + Parking) ──────────────
    {
      id: id('professional-fee'), phaseId, name: 'Professional Fee',
      method: 'percent_of_selected', value: 6,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cpEnd, phasing: 'even',
      selectedLineIds: [id('construction-bua'), id('construction-parking')],
    },
    // ── Commission (% of Revenue) ───────────────────────────────────────
    // Sell + Sell+Manage only; calc engine zeroes out for non-Sell strategies.
    // Revenue source ships in Module 2.1; for now value × 0 (revenue stub) = 0.
    {
      id: id('commission'), phaseId, name: 'Commission',
      method: 'percent_of_selected', value: 4,
      stage: 'soft', scope: 'indirect', allocationBasis: 'per_asset',
      startPeriod: Math.max(1, Math.floor(cp / 2)), endPeriod: cpEnd, phasing: 'even',
      selectedLineIds: [],
    },
    // ── Contingency (% of Construction BUA + Parking) ───────────────────
    {
      id: id('contingency'), phaseId, name: 'Contingency',
      method: 'percent_of_selected', value: 5,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cpEnd, phasing: 'even',
      selectedLineIds: [id('construction-bua'), id('construction-parking')],
    },
  ];
}

// P10-Fix 4 (2026-05-12): companion asset factory for Sell + Manage.
// Returns a sibling Asset that represents the post-handover operate
// role (developer keeps a management agreement after units are sold).
// Inherits ONLY the parent's units count via unitsFromParent. Land /
// BUA / sub-units stay 0 on the companion (filtered from land basis
// + cost rollups so they do not double-count). Companions are flagged
// isCompanion=true + parentAssetId points back at the parent.
// makeCompanionAsset is called from the store's updateAsset bookkeeper
// when the user picks 'Sell + Manage' as strategy on a parent asset.
export function makeCompanionAsset(parent: Asset, unitsFromParent: number): Asset {
  return {
    id: `companion_${parent.id}`,
    phaseId: parent.phaseId,
    name: `${parent.name} - Operate`,
    // T2P3 Fix 2 (2026-05-12): companion.type mirrors parent.type so a
    // "Residential" Sell+Manage parent yields a "Residential" Operate
    // companion (matches the user's mental model: same asset class, two
    // strategies). Empty parent.type passes through as empty.
    type: parent.type ?? '',
    strategy: 'Operate',
    visible: true,
    gfaSqm: 0,
    buaSqm: 0,
    sellableBuaSqm: 0,
    parkingBaysRequired: 0,
    status: parent.status ?? 'planned',
    parentAssetId: parent.id,
    isCompanion: true,
    companionType: 'operate',
    unitsFromParent: Math.max(0, unitsFromParent),
  };
}

// T2-Fix 5c (2026-05-12): companion sub-unit factory. Mirrors a parent
// Sellable sub-unit into the companion (Operate) asset's sub-unit row.
// metric='units', unitArea=0, metricValue = parent's metricValue (count
// derives from parent). unitPrice mirrors startingAdr so legacy revenue
// math that reads unitPrice still works. preservedAdr lets the migration
// or sync pass keep the user's ADR when the parent sub-unit gets renamed
// or otherwise re-mirrored.
export function makeCompanionSubUnit(
  parentSubUnit: SubUnit,
  companionAssetId: string,
  preservedAdr?: number,
): SubUnit {
  const count = parentSubUnit.metric === 'units'
    ? Math.max(0, parentSubUnit.metricValue)
    : (parentSubUnit.unitArea && parentSubUnit.unitArea > 0
        ? Math.round(parentSubUnit.metricValue / parentSubUnit.unitArea)
        : 0);
  const adr = Math.max(0, preservedAdr ?? 0);
  return {
    id: `companion-sub_${parentSubUnit.id}`,
    assetId: companionAssetId,
    name: parentSubUnit.name,
    category: 'Operable',
    metric: 'units',
    metricValue: count,
    unitArea: 0,
    unitPrice: adr,
    parentSubUnitId: parentSubUnit.id,
    startingAdr: adr,
  };
}

export function makeDefaultFinancingTranche(
  id: string,
  phaseId: string,
): FinancingTranche {
  return {
    id,
    phaseId,
    name: 'Senior debt',
    ltvPct: 60,
    interestRatePct: 7.5,
    interbankRatePct: 5.5,
    creditSpreadPct: 2.0,
    drawdownMethod: 'capex_basis',
    repaymentMethod: 'straight_line',
    // M2.0 Pass 18 (2026-05-13): drop the 60-period default so the YoY %
    // editor doesn't render a P1..P60 grid when the user hasn't picked
    // a repayment window yet. The UI's handleAddTranche overrides this
    // to phase.operationsPeriods on creation; the YoY editor falls back
    // to phase.constructionPeriods (capex window) when this stays 0.
    repaymentPeriods: 0,
    idcCapitalize: true,
    // M2.0 Pass 20 (2026-05-13): new tranches default to capitalize
    // (rolls grace interest into the facility balance, same mechanic
    // as construction IDC). Other 3 options are user-selectable.
    graceInterestTreatment: 'capitalize',
    // M2.0 Pass 23 (2026-05-13): facility starts drawing at project Y1
    // (first construction period) by default. User can shift it later
    // if the facility funds a later phase.
    drawdownStartPeriod: 0,
  };
}
