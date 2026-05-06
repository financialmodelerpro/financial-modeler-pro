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
  location: string;          // free-text city (display only)
  // M2.0c additions: drive conditional cost lines (e.g. RETT for KSA)
  // and the rate_per_nda / rate_per_roads cost methods. Both default
  // to undefined / 0 so existing v5 snapshots keep working.
  country?: string;          // free-text country, used by requiresCountry filter
  projectRoadsPct?: number;  // 0..100, fraction of land used for roads
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
  | 'rate_per_bua'             // value × asset.buaSqm
  | 'rate_per_nsa'             // value × asset.sellableBuaSqm
  | 'rate_per_unit'            // value × sub-unit count (Sellable category)
  | 'percent_of_selected'      // value% × sum of selectedLineIds totals
  | 'percent_of_construction'  // value% × sum of stage='hard' line totals
  | 'percent_of_total_land'    // value% × parcels total value
  | 'percent_of_cash_land'     // value% × parcels cash value
  | 'percent_of_inkind_land';  // value% × parcels in-kind value

export const COST_METHODS: readonly CostMethod[] = [
  'fixed',
  'rate_per_land',
  'rate_per_nda',
  'rate_per_roads',
  'rate_per_gfa',
  'rate_per_bua',
  'rate_per_nsa',
  'rate_per_unit',
  'percent_of_selected',
  'percent_of_construction',
  'percent_of_total_land',
  'percent_of_cash_land',
  'percent_of_inkind_land',
] as const;

export const COST_METHOD_LABELS: Record<CostMethod, string> = {
  fixed:                   'Fixed Amount',
  rate_per_land:           'Rate × Land Area',
  rate_per_nda:            'Rate × NDA',
  rate_per_roads:          'Rate × Roads',
  rate_per_gfa:            'Rate × GFA',
  rate_per_bua:            'Rate × BUA',
  rate_per_nsa:            'Rate × NSA (sellable)',
  rate_per_unit:           'Rate × Unit Count',
  percent_of_selected:     '% of Selected Lines',
  percent_of_construction: '% of Construction',
  percent_of_total_land:   '% of Total Land Value',
  percent_of_cash_land:    '% of Cash Land Value',
  percent_of_inkind_land:  '% of In-Kind Land Value',
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
  | 'category'       // project line allocated by Sell/Operate/Lease/Hybrid bucket
  | 'manual';        // user defines per-asset weights (defer to override)

export const ALLOCATION_BASES: readonly AllocationBasis[] = [
  'per_asset',
  'bua_share',
  'gfa_share',
  'land_share',
  'category',
  'manual',
] as const;

export type CostPhasing =
  | 'even'           // equal slice per period in [startPeriod, endPeriod]
  | 'frontloaded'    // S-curve weighted toward early periods
  | 'backloaded'     // S-curve weighted toward late periods
  | 'sCurve'         // bell-shape, peak in middle
  | 'manual'         // distribution[] supplies per-period weights (sum = 1)
  | 'phase_aligned'; // automatically span phase.constructionStart..end

export const COST_PHASINGS: readonly CostPhasing[] = [
  'even',
  'frontloaded',
  'backloaded',
  'sCurve',
  'manual',
  'phase_aligned',
] as const;

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
}

export interface CostOverride {
  assetId: string;
  lineId: string;
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
// M2.0c expands the drawdown matrix from 5 modes to 5 distinct
// economic models pre-M2.0 supported. capex_basis is the legacy
// 'sameAsCost' renamed; manual stays; debt_equity_ratio is the
// legacy 'fixed' financingMode + globalDebtPct path; capex_minus_-
// presales nets pre-sales (Module 2 supplies the schedule when ready
// in M2.1, today defaults to zero); min_cash_floor watches the
// running cash position and draws to keep cash >= floor.
export type DrawdownMethod =
  | 'capex_basis'           // tracks construction capex curve × ltvPct
  | 'manual'                // distribution[] per period
  | 'debt_equity_ratio'     // ltvPct of capex per period
  | 'capex_minus_presales'  // (capex - presales) × ltvPct, with land toggle
  | 'min_cash_floor';       // draws when running cash < floor

export const DRAWDOWN_METHODS: readonly DrawdownMethod[] = [
  'capex_basis',
  'manual',
  'debt_equity_ratio',
  'capex_minus_presales',
  'min_cash_floor',
] as const;

export const DRAWDOWN_METHOD_LABELS: Record<DrawdownMethod, string> = {
  capex_basis:          'CapEx Basis (LTV × CapEx)',
  manual:               'Manual per Period',
  debt_equity_ratio:    'Debt/Equity Ratio % of CapEx',
  capex_minus_presales: 'CapEx minus Pre-sales',
  min_cash_floor:       'Minimum Cash Floor',
};

// Repayment matrix:
// 'manual' -> distribution[] per period
// 'straight_line' -> equal principal per period across repaymentPeriods
// 'cashsweep_continuous' -> sweeps every period after construction
// 'cashsweep_from_period' -> sweeps from sweepStartPeriod onward
// 'cashsweep_min_cash' -> sweeps to keep cash above sweepMinCashFloor
export type RepaymentMethod =
  | 'manual'
  | 'straight_line'
  | 'cashsweep_continuous'
  | 'cashsweep_from_period'
  | 'cashsweep_min_cash';

export const REPAYMENT_METHODS: readonly RepaymentMethod[] = [
  'manual',
  'straight_line',
  'cashsweep_continuous',
  'cashsweep_from_period',
  'cashsweep_min_cash',
] as const;

export const REPAYMENT_METHOD_LABELS: Record<RepaymentMethod, string> = {
  manual:                 'Manual per Period',
  straight_line:          'Straight-line over N',
  cashsweep_continuous:   'Cash Sweep, Continuous',
  cashsweep_from_period:  'Cash Sweep, from Period N',
  cashsweep_min_cash:     'Cash Sweep, Maintain Floor',
};

export interface FinancingTranche {
  id: string;
  phaseId: string;
  // M2.0c: optional per-asset financing detail. When set, the tranche
  // only finances this asset's slice of the phase capex; otherwise it
  // finances the whole phase pro-rata across visible assets.
  assetId?: string;
  name: string;
  ltvPct: number;
  interestRatePct: number;
  // Drawdown
  drawdownMethod: DrawdownMethod;
  drawdownDistribution?: number[];     // manual only
  drawdownIncludeLand?: boolean;       // capex_minus_presales: include land in net
  drawdownMinCashFloor?: number;       // min_cash_floor only
  // Repayment
  repaymentMethod: RepaymentMethod;
  repaymentPeriods: number;
  repaymentManualDistribution?: number[]; // manual only
  sweepStartPeriod?: number;              // cashsweep_from_period
  sweepMinCashFloor?: number;             // cashsweep_min_cash
  // IDC capitalization (interest during construction goes to principal,
  // not paid in cash). When false, interest is expensed during
  // construction and reduces equity contribution.
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
    country: '',
    projectRoadsPct: 0,
  };
}

// Default cost lines for a freshly minted phase. v6 returns the 12-line
// pre-M2.0 catalog (plus the locked Land Cash row), all initialised to
// allocationBasis: 'bua_share' so newly-minted projects see project-level
// totals split across assets by BUA. Users override per-line + per-asset
// from the Costs tab UI.
//
// constructionPeriods is read so endPeriod can default to the phase
// duration. If 0 (no phase yet), endPeriod defaults to 24 to match
// makeDefaultPhase.
export function makeDefaultCostLines(phaseId: string, constructionPeriods = 24): CostLine[] {
  const cp = Math.max(1, constructionPeriods);
  const mid = Math.max(1, Math.floor(cp / 2));
  return [
    {
      id: 'land-cash', phaseId, name: 'Land (Cash Portion)',
      method: 'percent_of_cash_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
      isLocked: true,
    },
    {
      id: 'site-prep', phaseId, name: 'Site Preparation',
      method: 'rate_per_land', value: 15,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 1, endPeriod: Math.min(cp, mid), phasing: 'even',
    },
    {
      id: 'infrastructure', phaseId, name: 'Infrastructure',
      method: 'rate_per_nda', value: 80,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 1, endPeriod: Math.min(cp, mid + 1), phasing: 'even',
    },
    {
      id: 'structural', phaseId, name: 'Structural Works',
      method: 'rate_per_gfa', value: 400,
      stage: 'hard', scope: 'direct', allocationBasis: 'gfa_share',
      startPeriod: 1, endPeriod: cp, phasing: 'frontloaded',
    },
    {
      id: 'mep', phaseId, name: 'MEP Works',
      method: 'rate_per_gfa', value: 150,
      stage: 'hard', scope: 'direct', allocationBasis: 'gfa_share',
      startPeriod: Math.max(1, mid - 1), endPeriod: cp, phasing: 'even',
    },
    {
      id: 'finishing', phaseId, name: 'Finishing Works',
      method: 'rate_per_bua', value: 200,
      stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
      startPeriod: mid, endPeriod: cp, phasing: 'backloaded',
    },
    {
      id: 'professional-fees', phaseId, name: 'Professional Fees',
      method: 'percent_of_construction', value: 8,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cp, phasing: 'even',
    },
    {
      id: 'contingency', phaseId, name: 'Contingency',
      method: 'percent_of_construction', value: 5,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cp, phasing: 'even',
    },
    {
      id: 'marketing', phaseId, name: 'Marketing & Sales',
      method: 'percent_of_total_land', value: 2,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: Math.max(1, mid - 1), endPeriod: cp, phasing: 'backloaded',
    },
    {
      id: 'project-management', phaseId, name: 'Project Management',
      method: 'percent_of_construction', value: 3,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: cp, phasing: 'even',
    },
    {
      id: 'legal', phaseId, name: 'Legal & Admin',
      method: 'percent_of_total_land', value: 1,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      startPeriod: 1, endPeriod: Math.min(cp, mid), phasing: 'frontloaded',
    },
    {
      id: 'landscaping', phaseId, name: 'Landscaping & External',
      method: 'rate_per_nda', value: 30,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: mid, endPeriod: cp, phasing: 'backloaded',
    },
    {
      id: 'ffe', phaseId, name: 'FF&E / Interior Design',
      method: 'rate_per_bua', value: 50,
      stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
      startPeriod: cp, endPeriod: cp, phasing: 'even',
    },
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
    drawdownMethod: 'capex_basis',
    repaymentMethod: 'straight_line',
    repaymentPeriods: 60,
    idcCapitalize: true,
  };
}
