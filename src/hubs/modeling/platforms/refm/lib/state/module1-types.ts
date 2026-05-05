/**
 * module1-types.ts (v5 schema)
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
//   'Sell'     -> develop and sell on completion (residential, villas)
//   'Operate'  -> develop and run as a going concern (hotel, serviced)
//   'Lease'    -> develop and lease to tenants (retail, office)
//   'Hybrid'   -> sell-then-operate (e.g. branded residences sold first
//                 then operated under a hospitality flag)
export type AssetStrategy = 'Sell' | 'Operate' | 'Lease' | 'Hybrid';

export const ASSET_STRATEGIES: readonly AssetStrategy[] = [
  'Sell',
  'Operate',
  'Lease',
  'Hybrid',
] as const;

// ── Sub-unit categories ────────────────────────────────────────────────────
// Drives metric semantics + which Module 2 revenue stream it feeds.
//   'Sellable' -> sale revenue (cohort collection over construction)
//   'Operable' -> hospitality USAH (ADR x occupancy x keys x days)
//   'Leasable' -> retail/office NOI (rent per sqm x occupancy)
//   'Support'  -> non-revenue (back-of-house, parking, MEP); appears in
//                 area roll-ups but not in revenue streams
export type SubUnitCategory = 'Sellable' | 'Operable' | 'Leasable' | 'Support';

export const SUB_UNIT_CATEGORIES: readonly SubUnitCategory[] = [
  'Sellable',
  'Operable',
  'Leasable',
  'Support',
] as const;

// ── Sub-unit metric semantics ──────────────────────────────────────────────
// 'count' -> integer inventory units (apartments, hotel keys, parking bays)
// 'area'  -> sqm of leasable / sellable area (retail GLA, office GLA)
export type SubUnitMetric = 'count' | 'area';

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
export type ModelGranularity = 'monthly' | 'annual';
export type ProjectStatus     = 'draft' | 'active' | 'archived';

export interface Project {
  name: string;
  currency: string;          // ISO code (e.g. 'SAR', 'USD', 'AED')
  modelType: ModelGranularity;
  startDate: string;         // ISO 'YYYY-MM-DD'
  status: ProjectStatus;
  location: string;          // free-text city / country (display only)
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
export interface Phase {
  id: string;
  name: string;
  constructionStart: number;     // 1-indexed period number
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;
}

// ── Parcel (land) ──────────────────────────────────────────────────────────
// Project-level land. Multiple parcels supported (mixed cash + in-kind +
// donated land are common in MAAD models). Allocation across assets is
// driven by landAllocationMode at the snapshot level.
export interface Parcel {
  id: string;
  phaseId: string;            // parcel is bought/transferred during a phase
  name: string;
  area: number;               // sqm
  rate: number;               // currency per sqm
  cashPct: number;            // 0..100; remainder is in-kind
  inKindPct: number;          // 0..100; cashPct + inKindPct must sum to 100
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
//   Sell    -> sale price per unit (or per sqm for area metrics)
//   Operate -> ADR (per key per day) or per-key annual revenue
//   Lease   -> rent per sqm per year
//   Hybrid  -> sale price per unit (operate phase priced separately)
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
// gfaSqm / buaSqm / sellableBuaSqm: explicit area inputs in MAAD-Spec.
// No FAR / coverage / cascade math; the user enters whatever the
// architect handed them. UI shows live-derived ratios (efficiency =
// sellable / bua, etc.) as read-outs only.
//
// parkingBaysRequired: integer count, fed straight to the cost engine.
// No allocator, no surface/vertical/basement split, just a number.
export interface Asset {
  id: string;
  phaseId: string;
  name: string;
  type: string;                  // free-text, chosen from the M2.0 type bank
  strategy: AssetStrategy;
  visible: boolean;
  // Land
  landAreaSqm?: number;
  landAreaPct?: number;
  // Areas (entered, not derived)
  gfaSqm: number;                // gross floor area
  buaSqm: number;                // built-up area (subset of gfa, after MEP/BoH)
  sellableBuaSqm: number;        // saleable / leasable area within bua
  // Parking
  parkingBaysRequired: number;
}

// ── Cost line ──────────────────────────────────────────────────────────────
// MAAD's 9 standard cost lines, fixed identity (id is one of the
// COST_LINE_KEYS constants). Per-asset overrides live in costOverrides
// keyed by `${assetId}.${costLineKey}` (see HydrateSnapshot below).
//
// method:
//   'lumpsum'        -> value is total currency amount
//   'rate_per_bua'   -> value is currency per BUA sqm (multiplied by total BUA)
//   'rate_per_park'  -> value is currency per parking bay (parking line only)
//   'rate_per_land'  -> value is currency per land sqm (land/infra/landscape)
//   'percent_of_construction' -> value is % of summed Construction lines
//   'percent_of_total_cost'   -> value is % of summed all-other-lines
//
// phasing:
//   'even'           -> spread across construction window evenly
//   'frontloaded'    -> S-curve weighted toward early periods
//   'backloaded'     -> S-curve weighted toward late periods
//   'manual'         -> distribution[] supplies per-period weights (sum = 1)
export type CostLineKey =
  | 'land'
  | 'constructionBua'
  | 'constructionParking'
  | 'infrastructure'
  | 'landscaping'
  | 'preOperating'
  | 'professionalFee'
  | 'commissionFee'
  | 'contingency';

export const COST_LINE_KEYS: readonly CostLineKey[] = [
  'land',
  'constructionBua',
  'constructionParking',
  'infrastructure',
  'landscaping',
  'preOperating',
  'professionalFee',
  'commissionFee',
  'contingency',
] as const;

export const COST_LINE_LABELS: Record<CostLineKey, string> = {
  land:                 'Land',
  constructionBua:      'Construction (BUA)',
  constructionParking:  'Construction (Parking)',
  infrastructure:       'Infrastructure',
  landscaping:          'Landscaping',
  preOperating:         'Pre-operating',
  professionalFee:      'Professional fee',
  commissionFee:        'Commission fee',
  contingency:          'Contingency',
};

export type CostMethod =
  | 'lumpsum'
  | 'rate_per_bua'
  | 'rate_per_park'
  | 'rate_per_land'
  | 'percent_of_construction'
  | 'percent_of_total_cost';

export const COST_METHODS: readonly CostMethod[] = [
  'lumpsum',
  'rate_per_bua',
  'rate_per_park',
  'rate_per_land',
  'percent_of_construction',
  'percent_of_total_cost',
] as const;

export type CostPhasing = 'even' | 'frontloaded' | 'backloaded' | 'manual';

export const COST_PHASINGS: readonly CostPhasing[] = [
  'even',
  'frontloaded',
  'backloaded',
  'manual',
] as const;

export interface CostLine {
  key: CostLineKey;
  phaseId: string;
  method: CostMethod;
  value: number;
  phasing: CostPhasing;
  distribution?: number[];   // manual only; length = constructionPeriods, sums to 1
}

// Per-asset override keyed by `${assetId}.${costLineKey}`. When present,
// replaces the project-level CostLine for that asset only. Method + value +
// phasing are all overridable; distribution rides along when phasing ===
// 'manual'.
export interface CostOverride {
  assetId: string;
  key: CostLineKey;
  method: CostMethod;
  value: number;
  phasing: CostPhasing;
  distribution?: number[];
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
export type DrawdownMethod =
  | 'sameAsCost'
  | 'evenOverPhase'
  | 'frontloaded'
  | 'backloaded'
  | 'manual';

export const DRAWDOWN_METHODS: readonly DrawdownMethod[] = [
  'sameAsCost',
  'evenOverPhase',
  'frontloaded',
  'backloaded',
  'manual',
] as const;

export type RepaymentMethod = 'fixedSchedule' | 'cashSweep' | 'bullet';

export const REPAYMENT_METHODS: readonly RepaymentMethod[] = [
  'fixedSchedule',
  'cashSweep',
  'bullet',
] as const;

export interface FinancingTranche {
  id: string;
  phaseId: string;
  name: string;
  // Sizing
  ltvPct: number;                  // 0..100, share of phase capex funded by debt
  // Pricing
  interestRatePct: number;         // annual %, divided by 12 for monthly model
  // Drawdown
  drawdownMethod: DrawdownMethod;
  drawdownDistribution?: number[]; // manual only; length = constructionPeriods
  // Repayment
  repaymentMethod: RepaymentMethod;
  repaymentPeriods: number;        // 0 means tranche stays open until paid via cash sweep / bullet
  // Cash-sweep only
  sweepStartPeriod?: number;
  cashFloorPct?: number;
  // IDC
  idcCapitalize: boolean;
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
}

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
  Hybrid: [
    'Branded Residences',
    'Mixed-Use Tower',
    'Lifestyle Cluster',
  ],
};

// ── Default occupancy + operating margin per strategy (Module 2 seed) ──────
// Used to pre-fill SubUnit.occupancyPct / operatingMargin when the user
// adds a sub-unit. Operate uses hospitality industry typicals; Lease uses
// stabilised retail typicals; Sell + Hybrid leave them undefined (no
// recurring revenue concept during the sell phase).
export const DEFAULT_OPERATIONS_BY_STRATEGY: Record<AssetStrategy, {
  occupancyPct?: number;
  operatingMargin?: number;
}> = {
  Sell:    {},
  Operate: { occupancyPct: 65, operatingMargin: 35 },
  Lease:   { occupancyPct: 92, operatingMargin: 80 },
  Hybrid:  {},
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
    modelType,
    startDate: `${yyyy}-${mm}-${dd}`,
    status: 'draft',
    location: '',
  };
}

// Default cost lines for a freshly minted phase. Values are the MAAD
// reference defaults (Saudi mixed-use); UI exposes them all for edit.
export function makeDefaultCostLines(phaseId: string): CostLine[] {
  return [
    { key: 'land',                 phaseId, method: 'lumpsum',                 value: 0,    phasing: 'even' },
    { key: 'constructionBua',      phaseId, method: 'rate_per_bua',            value: 4500, phasing: 'frontloaded' },
    { key: 'constructionParking',  phaseId, method: 'rate_per_park',           value: 60000, phasing: 'frontloaded' },
    { key: 'infrastructure',       phaseId, method: 'rate_per_land',           value: 350,  phasing: 'frontloaded' },
    { key: 'landscaping',          phaseId, method: 'rate_per_land',           value: 150,  phasing: 'backloaded' },
    { key: 'preOperating',         phaseId, method: 'lumpsum',                 value: 0,    phasing: 'backloaded' },
    { key: 'professionalFee',      phaseId, method: 'percent_of_construction', value: 6,    phasing: 'even' },
    { key: 'commissionFee',        phaseId, method: 'percent_of_construction', value: 2,    phasing: 'backloaded' },
    { key: 'contingency',          phaseId, method: 'percent_of_total_cost',   value: 5,    phasing: 'even' },
  ];
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
    drawdownMethod: 'sameAsCost',
    repaymentMethod: 'fixedSchedule',
    repaymentPeriods: 60,
    idcCapitalize: true,
  };
}
