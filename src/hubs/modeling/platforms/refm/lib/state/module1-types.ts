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
 *   - AssetStrategy.Hybrid renamed to 'Sell + Manage' (build-then-
 *     manage pattern: build, sell to investors, retain operating
 *     rights via a management agreement).
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
 * Phase M2.0 (2026-05-06): complete rebuild to the flat v5 spec.
 *
 * The previous v3/v4 schema (Master Holding / Sub-Project /
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
// How an asset earns money over its life.
//   'Sell'         -> develop and sell on completion (residential, villas)
//   'Operate'      -> develop and run as a going concern (hotel, serviced)
//   'Lease'        -> develop and lease to tenants (retail, office)
//   'Sell + Manage'-> develop, sell units to investors, retain operating
//                     rights via a management agreement (branded
//                     residences with management contract).
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
// Self-Storage). Since 2026-09-07 the ASSET TYPE suggestions no longer
// vary per project type beyond the three category-named ones: see
// ASSET_TYPES_BY_CATEGORY / assetTypeCatalogForProjectType below.
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

/**
 * M5 Pass 2 equity partner. Contributions are absolute currency amounts;
 * shareholding is auto-derived from total contribution unless
 * `manualShareholdingPct` is set (override mode, 0-100). All fields except
 * id + name are optional and default to 0.
 */
export interface ProjectPartner {
  id: string;
  name: string;
  // 2026-07-09 (M5 <-> M1 Parties link): when a partner is picked from the
  // Module 1 Parties list (an equity-role party), `partyId` records the link
  // and `name` is snapshotted at pick time. The engine NEVER reads partyId
  // (identity only); `name` remains the single source for display, so a saved
  // version keeps the name it was given even if the party is later renamed or
  // deleted. Unset => a free-text / legacy partner (unlinked).
  /** Optional link to a refm_parties row (identity only, math-inert). */
  partyId?: string;
  // 2026-06-03 (M5 partners flexible split): partners now hold a PERCENTAGE
  // share of each equity TYPE. The project sets the per-type total (from
  // financing); each partner takes cashPct / inKindPct / existingPct of it,
  // and the per-type shares across partners always sum to 100 (the UI auto-
  // balances on every edit). The resolver derives the absolute contribution
  // (pct/100 x type total) before the returns engine runs, so the shares
  // stay correct even when the project's equity totals change.
  /** Share of total new cash equity (0-100). */
  cashPct?: number;
  /** Share of total in-kind (land) equity (0-100). */
  inKindPct?: number;
  /** Share of total existing equity (0-100). */
  existingPct?: number;
  // ── Legacy absolute amounts (pre-2026-06-03). Kept for back-compat; the
  // resolver falls back to these only when the matching *Pct is unset. ──
  /** @deprecated use cashPct. New cash equity contributed during the project. */
  cashContribution?: number;
  /** @deprecated use inKindPct. In-kind (e.g. land) equity contributed. */
  inKindContribution?: number;
  /** @deprecated use existingPct. Equity already funded in an operational/existing phase. */
  existingContribution?: number;
  /** @deprecated Manual shareholding override (0-100). Unset => auto from contributions. */
  manualShareholdingPct?: number;
}

// ── Scenario / case management (2026-06-03) ─────────────────────────────────
// A "case" is the base model plus a set of field OVERRIDES. The base case (the
// "Management Case" by default) holds the full model in the top-level snapshot
// fields and carries no overrides; scenario cases (Downside / Upside / custom)
// store only the fields they change, keyed by the same path scheme diffSnapshots
// emits (e.g. "assets[id=X].revenue.sell.pricePerUnit"). Value changes only:
// a case never adds or removes whole entities. See lib/cases/applyOverrides.ts.
export interface ProjectCase {
  id: string;
  name: string;
  role: 'base' | 'scenario';
  /** Field overrides keyed by diffSnapshots path. Always empty for the base case. */
  overrides: Record<string, unknown>;
}

// ── Lender covenants (2026-06-15) ───────────────────────────────────────────
// User-editable covenant thresholds shown on the RE Metrics tab. The ratios
// themselves are display-derived from the existing returns snapshot (no engine
// change); only the threshold + the pass/fail test are new. 'min' covenants pass
// when the worst ratio is >= threshold (DSCR / ICR / Debt Yield); 'max' covenants
// pass when the worst ratio is <= threshold (LTV). Thresholds are stored in the
// metric's natural unit: a multiple (x) for dscr / icr, a decimal for ltv /
// debt_yield. 'custom' carries a threshold only (no auto ratio) for bank-specific
// covenants the user adds later.
export type CovenantMetric = 'dscr' | 'icr' | 'ltv' | 'debt_yield' | 'custom';

export interface CovenantThreshold {
  id: string;
  metric: CovenantMetric;
  /** Editable display name. */
  label: string;
  operator: 'min' | 'max';
  /** Threshold in the metric's natural unit (x for dscr/icr, decimal for ltv/debt_yield). */
  threshold: number;
}

/** The four standard covenants seeded when a project has none yet. */
export const DEFAULT_COVENANTS: CovenantThreshold[] = [
  { id: 'cov_dscr',       metric: 'dscr',       label: 'DSCR',                 operator: 'min', threshold: 1.20 },
  { id: 'cov_icr',        metric: 'icr',        label: 'Interest Cover (ICR)', operator: 'min', threshold: 2.00 },
  { id: 'cov_ltv',        metric: 'ltv',        label: 'LTV (peak debt)',      operator: 'max', threshold: 0.60 },
  { id: 'cov_debt_yield', metric: 'debt_yield', label: 'Debt Yield',           operator: 'min', threshold: 0.10 },
];

export interface Project {
  name: string;
  /**
   * THE PROJECT'S OWN ASSET TYPE LIST (2026-09-10).
   *
   * The names used to be the ACCOUNT'S (`refm_asset_types`, mig 242) while the
   * values beside them were the project's (mig 244), and that split had two
   * costs. A firm's projects come from different land owners and developers,
   * so each names its types as its own scheme requires; and an edit inside one
   * project reached every other, adding a row to their tables or orphaning
   * their values with a banner that blamed a deletion nobody made.
   *
   * So the LIST joins the VALUES here. One scope, one snapshot: it versions,
   * it diffs, the change log records it, a duplicate takes its own copy, and
   * the id that keys `assetTypeValues` is minted by a list in the same object
   * as the values (docs/TRAPS.md 7.35, which this closes).
   *
   * THE FIRM'S LIST SURVIVES AS A TEMPLATE, on the account table, seeded FROM
   * on demand and pushed BACK explicitly. Never read to compute anything.
   *
   * ABSENT means a project that predates this; hydrate backfills it from what
   * the project itself references, never from an account.
   */
  assetTypes?: import('./assetTypeStandards').AssetTypeStandard[];
  /**
   * THE PROJECT'S ASSET TYPE VALUES (2026-09-07, mig 244), keyed by the
   * account vocabulary's entry id (`refm_asset_types.entry_id`, which is what
   * `Asset.assetTypeId` holds).
   *
   * Unit size, parking ratio and its basis, build cost per sqm and a revenue
   * rate with its unit are assumptions OF THIS PROJECT, because a firm's
   * schemes genuinely differ. Living in the snapshot makes each one an
   * ordinary input: it versions, it diffs, the change log records it, and
   * nothing is copied anywhere so nothing can go stale. That is what replaced
   * the stamping scheme.
   *
   * An ABSENT field inside an entry is the blank (not decided); a 0 is a
   * decision. Values for a type the firm has since removed from its list are
   * KEPT (an account-level edit must not delete a project's numbers) and are
   * surfaced as belonging to a type no longer listed.
   *
   * NOT READ BY THE CALCULATION ENGINE YET; the area chain is a later step.
   */
  assetTypeValues?: import('./assetTypeStandards').AssetTypeValuesByType;
  /** Sqm one parking slot occupies. A project assumption for the same reason
   *  as the rest (basement against surface parking changes it); moved off the
   *  account with mig 244. Absent = not decided, 0 is a decision. */
  parkingAreaPerSlotSqm?: number;
  /**
   * RETIRED 2026-09-10. Sqm of retail GFA that requires one parking slot.
   *
   * It was a plot column, then this field for one day, and neither was its
   * home: it is a retail TYPE's parking ratio on the sqm-per-slot basis, and
   * `assetTypeValues` already had a cell for exactly that. Two homes for one
   * number is what the move off the plot rows was correcting, and this field
   * repeated the mistake one level up. The reference agrees more directly than
   * either shape did: its retail-parking column divides by the retail row of
   * the ordinary parking-ratio table.
   *
   * `resolveRetailSlotArea` (lib/state/assetTypeStandards.ts) is the ONE reader
   * of the figure now, and it reads the type values. Nothing reads this field:
   * it stays DECLARED so a stored snapshot still types, and its stored value is
   * deliberately not carried across, because the only project holding one held
   * 40, the area a slot occupies, where the reference divides by 25.
   */
  retailAreaPerSlotSqm?: number;
  currency: string;          // ISO code (e.g. 'SAR', 'USD', 'AED')
  modelType: ModelGranularity;
  startDate: string;         // ISO 'YYYY-MM-DD'
  status: ProjectStatus;
  location: string;          // free-text city (display only)
  // M2.0c additions: drive conditional cost lines (e.g. RETT for KSA)
  // and the rate_per_nda / rate_per_roads cost methods. Both default
  // to undefined / 0 so existing v5 snapshots keep working.
  country?: string;          // free-text country, used by requiresCountry filter
  /** M4 Pass 2b (2026-05-20): financial-statement terminology. 'saudi'
   *  swaps the direct charge to Zakat (Zakat / Profit before Zakat /
   *  Profit after Zakat) across the P&L, CF and BS surfaces; EBITDA and
   *  EBIT are universal and unchanged. 'standard' uses Tax / EBITDA /
   *  EBIT / PBT / PAT. Defaults to 'standard'. */
  financialTerminology?: 'standard' | 'saudi';
  /** DEPRECATED 2026-09-08, read by nothing. The roads and parks deduction is
   *  retired: it modelled LAND development and this platform models VERTICAL
   *  development, and the area chain's Land Utilisation % states the same thing
   *  at asset level. Kept on the type so stored snapshots still parse. */
  projectRoadsPct?: number;
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
  /**
   * USE THE AREA CHAIN'S DERIVED SUPPORT AREA (2026-09-10, opt-in per project).
   *
   * OFF BY DEFAULT, AND THAT IS THE WHOLE DESIGN. The chain knows an asset's
   * lobby and service area; the engine only knows what somebody typed as rows
   * or into `supportArea`, so it charges construction on a BUILT area that is
   * short by exactly the part nobody typed (measured: 23,841 sqm of BUA on a
   * Marina line the chain puts at 28,051 of main GFA). Closing that gap ADDS
   * cost to assets that are already charging on a live model, which is the
   * opposite of the seeded NSA row: that one corrected an asset charging
   * NOTHING, and could fire on its own. This one changes numbers a user is
   * already reading, so the user says when.
   *
   * A project that never turns it on is byte-identical for ever.
   */
  useDerivedAreas?: boolean;
  displayScale?: DisplayScale;
  // M2.0i Fix 3 (2026-05-07): decimal places for formatted numbers.
  // Optional; defaults to 2 when undefined. 0/1/2/3 are the only user-
  // pickable options.
  displayDecimals?: DisplayDecimals;
  // 2026-06-15: Module 6 "Use scenarios?" toggle. When false, the Scenario
  // Analysis tab hides the assumptions grid + the case comparison for users
  // who do not run scenarios, AND the active case is forced back to the base
  // (Management) so a hidden scenario never drives the financials. Cases +
  // overrides are PRESERVED (never deleted); turning it back on restores the
  // previously-active case (scenarioPriorCaseId). Optional; undefined / true =
  // scenarios shown (existing behaviour unchanged).
  useScenarios?: boolean;
  // The case that was active when scenarios were turned off, restored when they
  // are turned back on. Unset while scenarios are on or when base was active.
  scenarioPriorCaseId?: string;
  // 2026-06-15: lender covenant thresholds shown on the RE Metrics tab. Optional;
  // undefined => seed DEFAULT_COVENANTS in the UI (existing projects unchanged).
  covenants?: CovenantThreshold[];
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
  /**
   * @deprecated M2 Pass 7g (2026-05-17): project-wide revenue templates
   * removed; every Sell / Operate / Lease asset owns its own cash +
   * recognition + indexation directly. Field kept on the schema so
   * legacy snapshots load without throwing; the engine ignores it.
   */
  revenueTemplates?: {
    sell?: {
      cashPaymentProfile: {
        percentages: number[];
        positions?: number[];
        profileMode?: 'absolute_with_catchup' | 'relative_to_sale';
      };
      recognitionProfile: {
        method: 'point_in_time' | 'over_time';
        pointInTimeYear?: 'handover' | 'sale_year' | 'custom';
        /** Pass 9g-H (2026-05-18): absolute project year used when
         *  pointInTimeYear === 'custom'. Lets clients pin recognition
         *  to a contract-specified year (legal title transfer, CoC).
         *  Engine clamps to the project axis. */
        pointInTimeCustomYear?: number;
        percentages?: number[];
        positions?: number[];
        profileMode?: 'absolute_with_catchup' | 'relative_to_sale';
      };
      indexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        growthPerPeriod?: number[];
      };
    };
    operate?: Record<string, unknown>;  // M2 Pass 8 hospitality template
    lease?: Record<string, unknown>;    // M2 Pass 9 lease template
  };
  /**
   * M2 Pass 9h (2026-05-19): project-wide pre-sales escrow defaults.
   * A regulator (e.g. RERA / RECC) withholds a percentage of every
   * pre-sales inflow as Inaccessible Funds, released back to the
   * developer at a defined milestone (typically asset handover). All
   * fields optional; heldPct = 0 disables escrow entirely.
   */
  escrow?: {
    /** Project-wide held fraction as a decimal (e.g. 0.04 = 4%). Used
     *  as the default for every Sell / Sell+Manage asset unless that
     *  asset overrides via revenue.sell.escrow.heldPctOverride. */
    heldPct?: number;
    /** Optional project-wide release-year override (absolute calendar
     *  year). Each asset falls back to its own phase handover year
     *  when neither this nor a per-asset override is set. */
    defaultReleaseYear?: number;
    /** Optional project-wide "held until" year (absolute calendar year).
     *  Pre-sales cash arriving after this year is NOT withheld. Each
     *  asset falls back to its own handover year when neither this nor
     *  a per-asset override is set. */
    defaultHeldUntilYear?: number;
  };
  /**
   * SALE COHORT DEFAULTS (2026-08-20, restructure Option B Step 1).
   *
   * STORED AND EDITABLE, READ BY NO ENGINE PATH YET.
   *
   * A sale cohort's downpayment is set per sale year on the asset. When an
   * asset carries NOTHING, the engine used to resolve every cohort to a zero
   * deposit, which is a large consequence reachable by doing nothing: it is
   * what takes one live project's funding requirement from 234m to 1,032m.
   * This is the project-wide default that stands in for an asset with no
   * terms of its own.
   *
   * SEEDED TO NOTHING, deliberately. `undefined` means no default has been
   * chosen, which is NOT the same as a default of zero, and an asset with
   * neither its own terms nor a project default is BLOCKED and says so
   * rather than quietly computing from a number nobody picked. Same
   * distinction the per-year strip already makes between "not set" and a
   * deliberate 0%.
   *
   * PER PROJECT, NOT PER PHASE, matching `escrow` above. Per-phase terms
   * would be an additive change if a real deal ever needs them.
   *
   * THE DEFAULT APPLIES PER ASSET, NOT PER YEAR: an asset holding a
   * downpayment on ANY sale year governs every one of its years through its
   * own forward fill, and this default is never consulted for it. Filling
   * individual blank years from here would interleave two sources inside one
   * strip and make a row unreadable.
   */
  saleCohortDefaults?: {
    /** Downpayment as a FRACTION of the cohort's sale value (0.20 = 20%),
     *  matching the per-asset strip. Absent means no default is set. */
    downpayment?: number;
  };
  /**
   * M4 Pass 2a (2026-05-20): project-wide Accounts Payable defaults.
   * Drives DPO-based AP roll-forward on all opex (per-asset + HQ).
   * Per-asset override lives on Asset.opex.apDaysOverride.
   */
  opexAp?: {
    /** Project-wide Days Payable Outstanding default (calendar days). */
    defaultApDays?: number;
    /** Days basis for the DPO ratio. Defaults to 365. */
    daysPerYear?: number;
  };
  /**
   * M4 Pass 2g (2026-05-20): project-wide operating Accounts Receivable
   * defaults. DSO-driven AR roll-forward on hospitality + lease
   * revenue (residential receivables stay on the milestone-driven
   * M2 Pass 7q path because they're contract-driven, not days-driven).
   * Reference v1.16 default: DSO 60 days. FMP defaults DSO to 0 (cash
   * basis) so existing snapshots show no behaviour change.
   */
  operatingAr?: {
    /** Project-wide Days Sales Outstanding default (calendar days). */
    dsoDays?: number;
    /** Days basis for the DSO ratio. Defaults to 365. */
    daysPerYear?: number;
  };
  /**
   * M4 Pass 2c (2026-05-20): direct-tax charge on PBT.
   * Configurable so projects in different jurisdictions can set their
   * own rate (Saudi Zakat 2.5%, UAE corporate tax 9%, etc.).
   * Defaults to 0 = no tax charge (cash-basis tax).
   */
  tax?: {
    /** Decimal tax rate applied to PBT (e.g. 0.025 = 2.5%). */
    rate?: number;
    /** Tax paid timing in days from incurrence. 0 = same-year (cash basis). */
    paymentDays?: number;
  };
  /**
   * M4 Pass 2e (2026-05-20): statutory reserve transfer (Saudi
   * Companies Law: 10% of PAT each year, capped at 30% of Share
   * Capital). Off by default; jurisdictions without this rule keep
   * the rate at 0.
   */
  statutoryReserve?: {
    /** Transfer rate as fraction of PAT. 0 = disabled. */
    transferRate?: number;
    /** Cap as fraction of Share Capital. 0 = no cap. */
    capOfShareCapital?: number;
  };
  /**
   * M4 Pass 2e (2026-05-20): explicit Share Capital. When unset, the
   * BS engine uses cumulative equity drawdowns as Share Capital.
   */
  shareCapital?: number;
  /**
   * M4 Pass 2O (2026-05-24): IDC (Interest During Construction) policy.
   * Three independent decisions:
   *   - allocationBasis: how to split project IDC across non-companion
   *     assets ('land' = land sqm share, 'bua' = built-up area share).
   *   - capitalize: when true, construction-window interest goes to
   *     asset basis (CoS for Sell, Fixed Assets + D&A for Operate/Lease).
   *     When false, interest hits P&L Finance Cost during construction
   *     and is NOT allocated to assets.
   *   - fundingMode: 'debt_drawdown' grows the debt balance by the
   *     interest amount (additional drawdown, current default).
   *     'cash' pays the interest from cash flow without growing debt.
   *     'conditional' (2026-06-02) raises debt for IDC only to the extent
   *     needed to maintain the minimum cash reserve: in any construction
   *     period with surplus cash above the minimum, the interest is paid
   *     in cash; the shortfall (if any) is capitalised to debt. Interest
   *     is still capitalised to the asset basis in every mode where
   *     capitalize !== false.
   *
   * All three default to current behaviour (land / true / debt_drawdown)
   * so legacy snapshots are unchanged.
   */
  idcConfig?: {
    allocationBasis?: 'land' | 'bua';
    capitalize?: boolean;
    fundingMode?: 'debt_drawdown' | 'cash' | 'conditional';
  };
  /**
   * Project-level dividend start year (2026-06-02). Dividends are a single
   * after-debt policy; this is the first year ANY dividend is distributed
   * (no distribution before it; the exit year still pays 100%). Unset =>
   * the engine defaults to the year after the last construction period ends.
   * Replaces the legacy per-phase dividendPolicy.startingYear, which is now
   * ignored.
   */
  dividendStartYear?: number;
  /**
   * Project-level dividend policy (2026-06-02). One rule for the whole
   * project (replaces the per-phase Phase.dividendPolicy editor):
   *   - enabled: pay dividends at all.
   *   - payoutRatio: % (0..100) of the distributable amount paid each period
   *     from dividendStartYear onward (the exit year always pays 100%).
   *   - mode: 'cash_above_min' sizes the payout off the cash above the minimum
   *     reserve (after the debt sweep); 'pct_of_ebitda' sizes it off the
   *     period EBITDA, still gated by available cash. Cumulative dividends stay
   *     capped by cumulative EBITDA.
   * When set, it drives EVERY phase. When unset, the engine falls back to the
   * legacy per-phase Phase.dividendPolicy (back-compat for older snapshots).
   */
  dividendPolicy?: {
    enabled?: boolean;
    payoutRatio?: number;
    mode?: 'cash_above_min' | 'pct_of_ebitda';
  };
  /**
   * M5 Returns (2026-06-01): returns + valuation assumptions. Additive;
   * absent => the resolver applies sensible defaults (10% discount rate,
   * exit at the last axis year, exit-multiple terminal value of 8x
   * stabilised NOI). Consumed only by Module 5 / the returns resolver;
   * does not touch any M1-M4 engine path.
   */
  returns?: {
    /** Discount rate for NPV + perpetuity terminal value (decimal). */
    discountRate?: number;
    /** Axis index of the exit/hold-period end (0-based). Clamped to the
     *  axis; unset => last active year. */
    exitYearOffset?: number;
    /** Terminal-value method the user picks. */
    terminalMethod?: 'none' | 'exit_multiple' | 'perpetuity' | 'cap_rate';
    /** Exit multiple applied to stabilised NOI (exit_multiple method). */
    exitMultiple?: number;
    /** Perpetuity growth rate g (perpetuity method, decimal). */
    perpetuityGrowth?: number;
    /**
     * EXIT CAP RATE (2026-08-19, decimal). Terminal EV = exit metric / cap rate.
     *
     * DERIVED FROM THE DISCOUNT RATE unless `capRateOverride` is true: a cap
     * rate is the discount rate less long-run growth, `r - g`, which is the same
     * spread the Gordon perpetuity divides by. Storing only the OVERRIDE means a
     * project that has never touched it follows the WACC and the growth rate as
     * they change, instead of freezing a number that silently goes stale.
     */
    capRate?: number;
    /** True when the user typed a cap rate, so the derived `r - g` is ignored. */
    capRateOverride?: boolean;
    /**
     * Whether the terminal metric is grown by one year before capitalising
     * (2026-08-19). A cap rate is conventionally applied to FORWARD income, so
     * this multiplies the exit metric by `(1 + g)`.
     *
     * ABSENT MEANS "the method's own convention", which is what keeps every
     * existing project unchanged: the Gordon perpetuity already has `(1 + g)` in
     * its formula, so it resolves to true, and exit-multiple and cap-rate
     * resolve to false. Writing a value overrides that.
     */
    applyGrowthToTerminal?: boolean;
  };
  /**
   * Fund layer, Step 1 (2026-08-03): the standalone-vs-fund toggle, and
   * nothing else yet.
   *
   * A project models a single development today. The fund layer will add
   * management fee, preferred return, carry, and gross-vs-net returns on top
   * (see docs/FUND_LAYER_GUIDELINE.md). This field is the toggle that gates
   * ALL of it, and it is deliberately the ONLY thing here at Step 1: the fee
   * percentage, fee base, hurdle, carry and committed capital arrive with the
   * M1 Fund Terms tab at Step 2.
   *
   * ABSENT or `enabled: false` means standalone, which is every project that
   * exists today, so the default is off by omission rather than by a stamped
   * value. Nothing in any engine reads this yet; `scripts/verify-fund-layer-guard.ts`
   * pins that a fully populated but DISABLED block changes no number until
   * feature code deliberately makes it.
   *
   * Step 2 (2026-08-03) added the terms themselves. This block is the
   * ENGINE-FACING copy: it rides inside the version snapshot jsonb, so a saved
   * version reproduces the numbers it was computed with, Module 6 scenarios can
   * override fund terms later, and the PDF/Excel version picker stays honest
   * about old versions. The durable per-project store the Fund Terms tab reads
   * and writes is `refm_fund_terms` (migration 208), mirrored here on every
   * save. That split follows the M5 partner precedent, which links to a party
   * by id but SNAPSHOTS the name so the engine never depends on a mutable side
   * table.
   *
   * Every rate is a DECIMAL FRACTION (0.02 = 2%), matching `returns.discountRate`
   * and `dividendPolicy.payoutRatio`. All fields optional so an older snapshot
   * hydrates unchanged; `resolveFundTerms` fills and range-clamps the gaps.
   */
  fundTerms?: {
    /** Fund economics on or off. Undefined = off = standalone = today. */
    enabled?: boolean;

    /** The entity that earns 100% of the fund management fees and holds the
     *  reserved `__fund_manager__` row in `feeDistribution`. Lives here rather
     *  than in refm_parties because it only exists when the fund layer is on. */
    fundManagerName?: string;

    /** HOW THE MANAGEMENT FEE IS FUNDED (2026-08-18f).
     *
     *  'deficit' (DEFAULT, and what every existing project does, and what the
     *  reference model does): the fee sits inside cash from operations, lowers
     *  cash available, and is funded through cash deficit funding at the
     *  project debt/equity ratio like any other outflow.
     *
     *  'equity': the fee is funded 100% by equity. It is REMOVED from the
     *  deficit sizing and drawn by the financing engine as dedicated equity on
     *  top of the ratio split, so total equity is equity capex plus the fee.
     *
     *  Absent means 'deficit'. 'debt' is accepted as a legacy alias for
     *  'deficit' from the 18b build and normalised on read. */
    managementFeeFunding?: 'deficit' | 'equity' | 'debt';

    // ── Fee bases the user TYPES. Never solved outputs: that is what keeps
    //    every fee linear and out of the M4 circular solve.
    /** Fund size (target or committed), base for the one-time structure fee.
     *  Deliberately NOT read from the model: fund size is equity plus debt,
     *  debt is solved by the funding requirement, and the fees raise that
     *  requirement, so reading it would be circular. */
    fundSize?: number;
    /** Debt facility LIMIT (not the drawn balance), base for the arranging fee.
     *  Resolved from the model's stated facilities where it has one; this is
     *  the manual figure used otherwise. */
    facilityLimit?: number;
    /** True when the typed `facilityLimit` should win over the model's figure. */
    facilityLimitOverride?: boolean;
    /** Fund layer 2026-08-05: pin the typed fund size instead of deriving it
     *  from the model (total equity plus total debt). */
    fundSizeOverride?: boolean;

    // ── Fund management fees. Each fee's timing and base are declared once in
    //    FUND_FEE_SPECS (lib/fundTerms.ts), which the UI renders from and the
    //    verifier polices.
    /** One time, decimal fraction of fund size. */
    fundStructureFeePct?: number;
    /** Annual, decimal fraction of OPENING (beginning of period) NAV. */
    fundManagementFeePct?: number;
    /** Annual, decimal fraction of OPENING NAV. */
    custodyAdminFeePct?: number;
    /** One time, decimal fraction of the facility limit. */
    debtArrangingFeePct?: number;
    /** Flat currency amount per annum. */
    otherExpensesPerAnnum?: number;

    // ── Performance fee.
    /** Performance fee on the residual above the hurdle, decimal fraction.
     *  Written alongside `carryPct` (the same number) so a reader written
     *  against either name resolves correctly. */
    performanceFeePct?: number;
    /** Same number as performanceFeePct: carry IS the performance fee. Kept so
     *  a snapshot written before 2026-08-04 still resolves. */
    carryPct?: number;
    /** Hurdle expressed as an IRR, decimal fraction. */
    hurdleRatePct?: number;

    /** Per-PARTY split of each fee type. partyId links to refm_parties and
     *  partyName is snapshotted, so a renamed or deleted party never blanks a
     *  saved row. */
    feeDistribution?: Array<{
      partyId: string; partyName: string;
      performanceFeePct: number; developerFeePct: number; commissionPct: number;
    }>;

    // ── LEGACY (2026-08-03, migration 208). Retired from the UI, still carried
    //    so an existing snapshot keeps its values and nothing is silently lost.
    /** @deprecated superseded by the explicit fee set above. */
    managementFeePct?: number;
    /** @deprecated each fee now declares its own base in FUND_FEE_SPECS. */
    feeBase?: 'committed_capital' | 'total_development_cost';
    /** @deprecated superseded by `fundSize`. */
    committedCapital?: number;
    /** @deprecated superseded by `feeDistribution`, which splits per PARTY
     *  rather than per role. */
    feeShares?: Array<{ role: string; sharePct: number }>;
  };
  /**
   * M5 Pass 2: equity partners (sponsor / JV / landowner). Splits the
   * project's total equity across investors so M5 can show per-partner
   * IRR / MOIC / Equity Multiple. Additive + optional: when empty / undefined
   * M5 stays project-level only. Consumed only by the returns resolver; never
   * touches an M1-M4 engine path.
   */
  partners?: ProjectPartner[];
  /**
   * Module 3 Opex: project-wide HQ / corporate opex line items
   * (fixed_baseline or pct_of_total_rev only). Per-asset opex lives
   * on Asset.opex.
   */
  hqOpex?: {
    /** HQ-wide inflation default. Applies to every fixed_baseline HQ
     *  line that does not opt out via useAssetDefault === false.
     *  pct_of_total_rev lines auto-escalate through revenue and ignore
     *  this. (Pass 3, 2026-05-19.) */
    defaultIndexation?: {
      method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
      rate?: number;
      startYear?: number;
      steps?: Array<{ year: number; factor: number }>;
      /** @deprecated M4 Pass 2h: project-axis-indexed. */
      growthPerPeriod?: number[];
      /** M4 Pass 2h: year-keyed (HQ has no owning phase). Key is the
       *  absolute calendar year as a string, value is the growth rate
       *  for that year. */
      growthPerPeriodByYear?: Record<string, number>;
    };
    lines: Array<{
      id: string;
      name: string;
      category: import('@/src/core/calculations/opex').OpexLineCategory;
      mode: import('@/src/core/calculations/opex').OpexLineMode;
      value: number;
      indexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        growthPerPeriod?: number[];
        /** M4 Pass 2h: year-keyed (HQ). */
        growthPerPeriodByYear?: Record<string, number>;
      };
      /** When false, engine uses this line's own indexation. Otherwise
       *  the HQ defaultIndexation wins. (Pass 3, 2026-05-19.) */
      useAssetDefault?: boolean;
      /** Value entry mode (Pass 4, 2026-05-19). 'single' = use value
       *  every year (with inflation if any). 'yoy' = use yoyRates[t]
       *  directly per period; engine ignores inflation. Default 'single'. */
      rateMode?: 'single' | 'yoy';
      /** @deprecated M4 Pass 2h: project-axis-indexed. */
      yoyRates?: number[];
      /** M4 Pass 2h: year-keyed per-period rates (HQ has no phase). */
      yoyRatesByYear?: Record<string, number>;
      disabled?: boolean;
    }>;
  };
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
  // M4 Pass 2M-A1 (2026-05-20): opening cash balance at project Y0 for
  // operational phases. Closes the BS Check imbalance at t=0 when the
  // phase carries pre-existing debt + equity without a matching cash
  // line. Captured on Tab 1 (Project & Phases) under the Historical
  // Baseline section that already exists for operational phases. The
  // BS composer adds this to Cash[0] + the prior column. Validation
  // chip: historicalPreCapex + historicalOpeningCash should equal
  // historicalDebt + historicalEquity (user-confirmed identity).
  historicalOpeningCash?: number;
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
  /**
   * M4 Pass 2T (2026-05-24): per-phase dividend policy. Drives the
   * cash waterfall after debt service:
   *   priority='before_sweep' → this phase's dividend is paid BEFORE
   *     cash sweep starts (typical for already-operational phases that
   *     are producing cash and want to distribute first).
   *   priority='after_sweep' → dividend paid AFTER cash sweep finishes
   *     (typical for new construction phases, debt repays first).
   * startingYear defaults to the phase's first operating year
   * (constructionEnd + 1 for new phases; project start year for
   * operational phases). payoutRatio is the % of available cash above
   * the minimum cash reserve to distribute each period (0..100).
   * Defaults to disabled when undefined.
   */
  dividendPolicy?: {
    enabled?: boolean;
    priority?: 'before_sweep' | 'after_sweep';
    startingYear?: number;
    payoutRatio?: number;
    /**
     * 2026-06-01: dividend sizing basis. Both modes pay only AFTER the
     * construction period (startingYear) and stay capped by cash available
     * above the minimum reserve AND by cumulative EBITDA.
     *   'cash_above_min' (default, legacy): payoutRatio % of the cash above
     *     the minimum reserve each period (the cash-sweep-style distribution).
     *   'pct_of_ebitda': payoutRatio % of THIS period's EBITDA, still gated by
     *     the cash available above the minimum reserve.
     * Works the same regardless of the tranche debt-repayment method.
     */
    mode?: 'cash_above_min' | 'pct_of_ebitda';
  };
}

// ── Parcel (land) ──────────────────────────────────────────────────────────
// Project-level land. Multiple parcels supported (mixed cash + in-kind +
// donated land are common in mixed-use feasibility models). Allocation
// across assets is driven by landAllocationMode at the snapshot level.
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
  //
  // Pass 9c (2026-05-18): per-sub-unit ADR also applies to non-companion
  // Operate sub-units (multiple room types on a pure-Operate asset,
  // e.g. Standard / Deluxe / Suite). Storage stays on startingAdr; the
  // M2 resolver reads it for any metric='units' sub-unit under an
  // Operate or companion asset. hospitalityIndexation is the optional
  // per-sub-unit ADR escalation override; the M2 resolver falls back
  // to the asset-level adrIndexation when this is undefined.
  parentSubUnitId?: string;
  startingAdr?: number;
  /**
   * THE SHARE OF THE LINE'S NSA THIS ROW STATES (2026-09-10).
   *
   * SHARE AND AREA ARE ONE PAIR AND EITHER MAY BE THE STATEMENT. The area
   * (`metricValue`) was the only stored quantity and the share was derived for
   * display, so typing a share wrote an area ONCE: the moment land, coverage,
   * FAR or the retail share moved the line's NSA, the share column still read
   * 50% while the areas underneath added up to something else, and the line
   * reported itself over or under allocated. Whichever the user typed is the
   * statement, so a typed SHARE is stored here and its area is re-derived
   * whenever the line's NSA moves.
   *
   * ABSENT MEANS THE AREA IS THE STATEMENT, which is every row that existed
   * before this field and every row where someone typed a figure in sqm. So
   * nothing stored changes meaning, and a row only starts following the NSA
   * once a user says it should by typing a percentage.
   *
   * THE AREA IS STILL THE ONE QUANTITY EVERY READER USES. The engine, the
   * reports and the exports read `metricValue` and know nothing about shares;
   * the store writes the area back (`syncLineSubUnits`), exactly as the retail
   * companion's own row is refreshed. Deriving at read time would be a second
   * answer to "how big is this row".
   */
  nsaSharePct?: number;
  /**
   * Land planning (2026-09-07): PARKING RATIO OVERRIDE for this sub-unit.
   *
   * The asset type carries the firm's default (stamped onto the asset); a
   * sub-unit that knows better states its own, and the detail wins wherever
   * it lives. Same inherit-and-override shape the cost lines use, so ABSENT
   * means inherit and a typed 0 is a real override (a villa row that needs
   * no bay), never a blank. Resolved by `resolveParkingRatio` in
   * lib/state/assetTypeStandards.ts.
   *
   * Additive, optional, and read by NOTHING in the calculation engine: the
   * parking chain that will consume it is a later step.
   */
  parkingRatio?: number;
  hospitalityIndexation?: {
    method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
    rate?: number;
    startYear?: number;
    steps?: Array<{ year: number; factor: number }>;
    growthPerPeriod?: number[];
  };
}

/**
 * The chain's figures, in fields only the platform writes. Every one is
 * optional and an ABSENT one means the chain did not derive it (or the project
 * has not opted in), never zero.
 */
/**
 * WHAT THE AREA CHAIN DERIVED FOR THIS PLOT, written by the assets tab, read
 * by capex (2026-09-12: widened from five figures to the full Table 4 set).
 *
 * THIS IS THE ONE BRIDGE between the chain and the engine. The chain runs on
 * the assets tab and nowhere else; capex reads what it WROTE here and never
 * runs a chain of its own, so the two tabs cannot hold two answers for the
 * same area. Until 2026-09-12 only five figures crossed and two of those
 * only behind an opt-in, so Table 4 showed one building and capex priced
 * another: on one live plot 25,279 sqm of Total GFA against 23,841, and
 * 3,560 sqm of parking against a hand-typed 2,800.
 *
 * ABSENT MEANS THE CHAIN SAID NOTHING, never zero. A project with no chain
 * inputs (every asset on one live project) writes no bag at all, and capex
 * then reads the sub-units and typed fields exactly as it always did.
 */
export interface DerivedAreas {
  /** Net developable area: plot area x utilisation. */
  netDevelopableSqm?: number;
  /** Building footprint: net developable x ground coverage. */
  footprintSqm?: number;
  /** Landscape and open area: net developable x (1 - coverage). */
  landscapeSqm?: number;
  /** Total GFA: net developable x FAR. The whole building, retail included. */
  totalGfaSqm?: number;
  /** Main asset GFA: total less retail and lobby (or total, with no retail). */
  mainAssetGfaSqm?: number;
  /** Retail GFA: what the retail companion carries. */
  retailGfaSqm?: number;
  /** Lobby and circulation GFA. */
  lobbyGfaSqm?: number;
  /** Service area: lobby plus the main asset's service share, the same sum the
   *  derived support row states. */
  serviceAreaSqm?: number;
  /** Net saleable: main x (1 - service). The chain's NSA; capex prices the
   *  SUB-UNITS' NSA, which the store keeps equal to the line's. */
  netSaleableSqm?: number;
  /** Chain parking area for THIS asset's own slots, retail parking excluded. */
  parkingAreaSqm?: number;
  /** Chain parking slots, on the same basis. */
  parkingBays?: number;
  /** Retail parking: charged on the retail COMPANION, which holds a stamped
   *  copy; carried here so the host line can state it. */
  retailParkingAreaSqm?: number;
  retailParkingSlots?: number;
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
// gfaSqm / buaSqm / sellableBuaSqm: explicit area inputs.
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
/**
 * 2026-08-17: weighted average across EVERY parcel in the project.
 *
 * `__weighted__` is scoped to the asset's own phase and stays that way, so no
 * saved model moves. It answers nothing at all on a phase that holds no parcels
 * of its own, which is the common real setup (one land acquisition, several
 * construction phases) and is how a Phase 2 asset came to report a zero rate.
 * Rather than silently widening the existing option's meaning, the wider scope
 * is its OWN option, and both render the rate they resolve to, so the choice is
 * made against the number rather than against a label.
 */
export const PARCEL_WEIGHTED_AVG_ALL = '__weighted_all__';
export const PARCEL_CUSTOM_RATE = '__custom__';

/** True for any of the sentinel values above, i.e. "not a real parcel id". */
export function isParcelSentinel(id: string | undefined): boolean {
  return id === PARCEL_WEIGHTED_AVG || id === PARCEL_WEIGHTED_AVG_ALL || id === PARCEL_CUSTOM_RATE;
}

export interface Asset {
  id: string;
  phaseId: string;
  name: string;
  type: string;                  // free-text, optional from M2.0j Fix 2 ('' = unspecified); legacy snapshots set a default
  /**
   * Land planning (2026-09-07): WHICH of the firm's asset types this is.
   *
   * A reference into the account vocabulary (`refm_asset_types`, mig 242) and,
   * since mig 244, the KEY this project's values for that type are looked up
   * by (`project.assetTypeValues[assetTypeId]`). Nothing is copied onto the
   * asset: the values are project inputs, so they version and change-log
   * themselves and can never go stale here.
   *
   * The stamp that used to sit beside this (`assetTypeStandards`) is DELETED
   * with mig 244. It existed only because the values lived on an account
   * table the engine must never read; holding a second copy inside the same
   * snapshot would be one rule with two answers.
   *
   * Optional and additive: a snapshot without it behaves exactly as before.
   */
  assetTypeId?: string;
  /**
   * Land planning step 2 (2026-09-07): the TOP-DOWN area chain's inputs.
   *
   * Utilisation, coverage, retail and service shares (0..100), a FAR multiple
   * and the retail area per slot. Everything else the chain needs comes from
   * the project's asset type values (tab 4) and the asset's own land
   * allocation, so this holds only what is genuinely per asset.
   *
   * OPTIONAL AND INERT. `computeLandChain` (src/core/calculations/landChain.ts)
   * turns these into a derived area set that ONE read-only panel renders
   * beside the entered figures. Nothing in the engine, the reports or the
   * exports reads either the inputs or the derivation, so an asset carrying
   * them computes exactly the same model as one without them. An asset that
   * states none of them shows no panel at all.
   */
  landChain?: import('@/src/core/calculations/landChain').LandChainInputs;
  /**
   * CONSOLIDATION LINE MEMBERSHIP (consolidation step 1, 2026-09-08).
   *
   * Which consolidated line this asset belongs to, and the (phase, type,
   * strategy) key it had when that was decided.
   *
   * THE ID IS ASSIGNED ONCE AND THEN STICKS. A line has to be an IDENTITY
   * before anything can point at it, and a key derived from three fields the
   * user edits is not an identity: it changes under their hands. Marina Gate
   * currently carries an asset typed "Bran", mid-word, which under a derived
   * key would have been three different lines in three keystrokes. So the key
   * decides membership ONCE and the id survives every later edit.
   *
   * `keyAtAssignment` is what makes that stickiness safe rather than a silent
   * bug: when an asset is later retyped or moved, its key no longer matches
   * the one recorded here, and that DRIFT is detectable. Whether membership
   * then follows the new key is a later step's decision, taken visibly.
   *
   * ADDITIVE AND UNWRITTEN. Nothing assigns this yet, nothing reads it, and no
   * stored snapshot carries it: `assignConsolidationIds` is a pure function
   * with no caller. This step exists only to prove the id is stable before
   * anything depends on it.
   */
  consolidation?: { id: string; keyAtAssignment: string };
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
  /**
   * WHAT THE CHAIN DERIVED, IN SPACE THE PLATFORM OWNS (2026-09-10).
   *
   * The chain derives a parking area, a slot count, a landscape area, a
   * footprint and a net developable area, and until now none of them could
   * reach a cost method: two methods existed and multiplied a field nothing
   * wrote (`rate_per_parking_bay` reads `parkingBaysRequired`, which the
   * factory seeds at 0 and only a retail companion ever updates), and three
   * quantities had no method at all.
   *
   * THEY DO NOT GO IN THE USER'S FIELDS, which was the whole problem: a value
   * the platform writes into `parkingArea` cannot afterwards be told from one
   * the user typed, so "derive only while nobody has said otherwise" would have
   * nothing to read and clearing it would be a one-way door. A separate bag
   * makes the precedence a READ rule (`resolveAssetParkingArea` and friends,
   * typed wins) rather than an invariant every write path must remember.
   *
   * WRITTEN ONLY BY THE ASSETS TAB'S CHAIN SYNC, and only while the project has
   * opted in (`project.useDerivedAreas`). Absent on every project that has not.
   */
  derivedAreas?: DerivedAreas;
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
  /**
   * ONE capex phasing curve for the whole asset (2026-08-15).
   *
   * Phasing was set line by line, and in practice every line on an asset
   * repeats the same curve, so a user typed the same percentages five or six
   * times per asset. Every cost line on this asset inherits this curve unless
   * it is broken out (CostLine.phasingSource === 'own') or follows a derived
   * source (land cash / collections).
   *
   * ABSENT means no asset curve, and every line keeps its own phasing exactly
   * as before. That is what makes this inert on an existing project: the asset
   * curve is the opt-in.
   */
  capexPhasing?: AssetCapexPhasing;
  usefulLifeYears?: number;
  /**
   * M4 Pass 1d (2026-05-19): depreciation method per asset. Defaults
   * to 'straight_line' when undefined. 'reducing_balance' uses
   * declining-balance with rate = `depreciationRate` or fallback
   * `2 / usefulLifeYears` (double-declining convention).
   */
  depreciationMethod?: 'straight_line' | 'reducing_balance';
  /**
   * Reducing-balance rate as a decimal (e.g. 0.10 = 10%). Only
   * consumed when depreciationMethod === 'reducing_balance'. When
   * undefined, engine falls back to `2 / usefulLifeYears`.
   */
  depreciationRate?: number;
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
  /**
   * WHICH KIND OF COMPANION, and it is load-bearing since step 4.
   *
   * 'operate' is the post-handover Operate sibling of a Sell + Manage asset:
   * it mirrors the parent's Sellable sub-units and inherits its unit count.
   * 'retail' is the pooled ground-floor retail of a consolidated LINE: strategy
   * Lease, its own areas, no sub-unit mirror and no parent to inherit from.
   *
   * Both are companions to every engine, resolver, report and export, which is
   * the point of reusing the flag. The TYPE is what stops the retail one
   * picking up the Operate one's behaviour.
   */
  companionType?: 'operate' | 'retail';
  unitsFromParent?: number;
  /**
   * RETAIL COMPANION ONLY: the plots whose ground-floor retail it pools.
   *
   * A retail companion has MANY hosts, which is why it cannot use
   * `parentAssetId`: that field is one asset, and a line is not. It is left
   * absent on a retail companion deliberately, so the two Operate-companion
   * sync passes (which both require a parentAssetId) skip it without needing to
   * know it exists.
   */
  retailHostAssetIds?: string[];
  /** RETAIL COMPANION ONLY: the consolidated line this belongs to. */
  retailLineKey?: string;
  /**
   * 2026-08-11: per-strategy assumption sets that are NOT currently active.
   *
   * Changing an asset's strategy parks the outgoing strategy's sub-units, opex
   * and (for Sell + Manage) its whole companion asset here, and restores the
   * incoming strategy's from here, so a user can build the model once and then
   * test strategies on the same asset without losing anything. Leaving
   * Sell + Manage used to hard-delete the companion outright.
   *
   * Deliberately OFF TO ONE SIDE rather than a flag on the live rows:
   * `state.subUnits` / `costLines` / `costOverrides` keep containing only the
   * ACTIVE strategy's rows, exactly as before, so no engine or UI reader has to
   * learn to filter. See lib/state/strategySwitch.ts.
   *
   * Additive and optional: a snapshot written before this existed has none, and
   * behaves exactly as it did.
   */
  retainedByStrategy?: Partial<Record<AssetStrategy, import('./strategySwitch').RetainedStrategyAssumptions>>;
  /**
   * The last strategy change on this asset, kept until the user dismisses it.
   * Drives the review banner: which assumptions activated, which were retained,
   * and which are still empty. Cleared on dismissal, not on navigation, so it
   * cannot be clicked past by accident.
   */
  strategyReview?: import('./strategySwitch').StrategySwitchReport & { changedAt: string };
  // M2 Pass 2 (2026-05-16): per-asset revenue configuration. Strategy-
  // specific sub-config (sell / operate / lease / sellManage) is added
  // incrementally; each is optional. Schema additive: undefined ==
  // 'this asset has no revenue config yet'. Phase 1 ships .sell only.
  // The actual AssetSellConfig type lives at
  // src/core/calculations/revenue/types.ts to keep the M2 engine free
  // of M1 store coupling. Stored shape mirrors that type.
  revenue?: {
    sell?: {
      assetId: string;
      subUnits: Array<{
        subUnitId: string;
        /** @deprecated M4 Pass 2h (2026-05-20): project-axis-indexed.
         *  Use preSalesVelocityByPhase. Kept for legacy snapshots; the
         *  hydration migration converts this to the new field. */
        preSalesVelocity: number[];
        /** @deprecated M4 Pass 2h (2026-05-20): project-axis-indexed. */
        postSalesVelocity: number[];
        /** M4 Pass 2h (2026-05-20): phase-local indexed (arr[0] = first
         *  year of the OWNING PHASE, mirrors the CostLine.startPeriod
         *  convention). Survives project axis origin moves. */
        preSalesVelocityByPhase?: number[];
        postSalesVelocityByPhase?: number[];
      }>;
      /**
       * @deprecated 2026-08-20. RETAINED FOR DATA, READ BY NOTHING, AND
       * NO LONGER EDITABLE ANYWHERE.
       *
       * One milestone schedule shared by every sale year. Pre-sales
       * collections have followed the per-sale-year cohort rule since the
       * sale cohort restructure Step 3; on 2026-08-20 the last surfaces
       * that displayed this profile were removed along with its editor.
       *
       * NOT DELETED, deliberately: saved projects carry schedules users
       * entered, this schema is additive only, and the legacy migration
       * still maintains the phase-local sibling so a hydrate loses
       * nothing. See CashPaymentProfile in
       * src/core/calculations/revenue/types.ts.
       */
      cashPaymentProfile: {
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        percentages: number[];
        /** @deprecated M4 Pass 2h: absolute project axis positions. */
        positions?: number[];
        profileMode?: 'absolute_with_catchup' | 'relative_to_sale';
        /** M4 Pass 2h: phase-local percentages (arr[k] paid at phase
         *  period positionsByPhase[k]). */
        percentagesByPhase?: number[];
        positionsByPhase?: number[];
      };
      recognitionProfile: {
        method: 'point_in_time' | 'over_time';
        pointInTimeYear?: 'handover' | 'sale_year' | 'custom';
        /** Pass 9g-H (2026-05-18): absolute project year used when
         *  pointInTimeYear === 'custom'. Lets clients pin recognition
         *  to a contract-specified year (legal title transfer, CoC).
         *  Engine clamps to the project axis. */
        pointInTimeCustomYear?: number;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        percentages?: number[];
        /** @deprecated M4 Pass 2h: absolute project axis positions. */
        positions?: number[];
        profileMode?: 'absolute_with_catchup' | 'relative_to_sale';
        /** M4 Pass 2h: phase-local recognition profile. */
        percentagesByPhase?: number[];
        positionsByPhase?: number[];
      };
      indexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        growthPerPeriod?: number[];
        /** M4 Pass 2h: phase-local indexed. */
        growthPerPeriodByPhase?: number[];
      };
      handoverYearOverride?: number;
      /**
       * SALE COHORT TERMS (2026-08-19, restructure Step 1). Mirrors
       * AssetSellConfig in src/core/calculations/revenue/types.ts, where
       * the meaning of each field is documented in full.
       *
       * STORED AND EDITABLE, READ BY NO ENGINE PATH YET.
       *
       * downpaymentByPhase is phase-local and one entry per SALE YEAR,
       * a FRACTION (0.20 = 20%) like the velocity and cash strips beside
       * it. The other two are one value for the asset.
       * instalmentsStopAtHandover defaults to true when absent, which is
       * the reference model's hard cut-off.
       */
      downpaymentByPhase?: Array<number | null>;
      maxInstalmentYears?: number;
      instalmentsStopAtHandover?: boolean;
      /**
       * THE LINE'S VELOCITY, STATED ONCE (2026-09-13).
       *
       * The row list in `subUnits` above was a SNAPSHOT taken at the first
       * velocity edit and refreshed only by the next one, so a sub-unit added
       * afterwards (a row seeded on Table 5, a row typed later) had no entry
       * and the engine sold none of it: on one live line the second row,
       * 10,098 sqm at 16,500, earned nothing while the first row earned
       * 267m. The engine now walks the STORE's rows and looks each one up
       * here by id; a row with no entry of its own reads THIS default; a row
       * with neither sells nothing until a velocity is typed.
       *
       * Present means "every row on this line sells at this pace" (the tab's
       * lockstep view); absent means the rows state their own pace. Phase-local
       * like every velocity strip, fractions, no legacy twin.
       */
      velocityDefault?: {
        preSalesVelocityByPhase: number[];
        postSalesVelocityByPhase: number[];
      };
      /**
       * M2 Pass 9h (2026-05-19): per-asset escrow override. Either
       * field can be set independently; unset fields fall back to the
       * project default (Project.escrow.heldPct / defaultReleaseYear)
       * which itself defaults to 0 / handover-year respectively.
       */
      escrow?: {
        /** Override the project-wide held fraction for this asset. */
        heldPctOverride?: number;
        /** Override the release-year (absolute calendar year). */
        releaseYearOverride?: number;
        /** Override the "held until" year (absolute calendar year). Pre-sales
         *  cash arriving after this year is not withheld. */
        heldUntilYearOverride?: number;
      };
    };
    /**
     * M2 Pass 8b (2026-05-18): Hospitality (Operate-strategy) config.
     * Mirrors HospitalityConfig at src/core/calculations/revenue/types.ts
     * minus the engine-resolved fields (keys, opsStartIdx, opsEndIdx)
     * which the resolver derives from M1 sub-units + phase windows.
     */
    operate?: {
      assetId: string;
      daysPerYear?: number;
      startingADR: number;
      // Pass 9e (2026-05-18): operations can start mid-construction
      // (e.g., a hotel soft-opens before the asset is fully complete).
      // When set, this absolute project year overrides the resolver's
      // default opsStartIdx = handoverYear + 1 - overlap. Engine still
      // respects operationsEndIdx from the phase.
      operationsStartYearOverride?: number;
      adrIndexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        growthPerPeriod?: number[];
        /** M4 Pass 2h: phase-local. */
        growthPerPeriodByPhase?: number[];
      };
      /** @deprecated M4 Pass 2h: project-axis-indexed occupancy ramp. */
      occupancyPerPeriod: number[];
      /** M4 Pass 2h: phase-local occupancy ramp (0..1 per period). */
      occupancyPerPeriodByPhase?: number[];
      guestsPerOccupiedRoom?: number;
      fb: {
        mode: 'percent_of_rooms' | 'per_guest' | 'fixed_amount';
        /** @deprecated M4 Pass 2h: project-axis-indexed when array. */
        percentOfRooms?: number | number[];
        ratePerGuest?: number | number[];
        fixedAmountPerPeriod?: number | number[];
        /** M4 Pass 2h: phase-local variants. */
        percentOfRoomsByPhase?: number[];
        ratePerGuestByPhase?: number[];
        fixedAmountPerPeriodByPhase?: number[];
        indexation?: {
          method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
          rate?: number;
          startYear?: number;
          steps?: Array<{ year: number; factor: number }>;
          /** @deprecated M4 Pass 2h: project-axis-indexed. */
          growthPerPeriod?: number[];
          /** M4 Pass 2h: phase-local. */
          growthPerPeriodByPhase?: number[];
        };
      };
      otherRevenue: {
        mode: 'percent_of_rooms' | 'per_guest' | 'fixed_amount';
        /** @deprecated M4 Pass 2h: project-axis-indexed when array. */
        percentOfRooms?: number | number[];
        ratePerGuest?: number | number[];
        fixedAmountPerPeriod?: number | number[];
        /** M4 Pass 2h: phase-local variants. */
        percentOfRoomsByPhase?: number[];
        ratePerGuestByPhase?: number[];
        fixedAmountPerPeriodByPhase?: number[];
        indexation?: {
          method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
          rate?: number;
          startYear?: number;
          steps?: Array<{ year: number; factor: number }>;
          /** @deprecated M4 Pass 2h: project-axis-indexed. */
          growthPerPeriod?: number[];
          /** M4 Pass 2h: phase-local. */
          growthPerPeriodByPhase?: number[];
        };
      };
      /** Days Sales Outstanding for AR roll-forward (Pass 8d). Default 30. */
      dso?: number;
      /**
       * Rental pool participation %, project-axis-indexed (decimal
       * 0..1). @deprecated M4 Pass 2h: use keysParticipationProfileByPhase.
       */
      keysParticipationProfile?: number[];
      /** M4 Pass 2h: phase-local rental pool participation %. */
      keysParticipationProfileByPhase?: number[];
    };
    /**
     * M2 Pass 9g (2026-05-18): Retail / Office Lease config. Mirrors
     * LeaseConfig at src/core/calculations/revenue/types.ts minus the
     * engine-resolved fields (gla, opsStartIdx, opsEndIdx) which the
     * resolver derives from M1 sub-units + phase windows.
     */
    lease?: {
      assetId: string;
      // Asset-level fallbacks. Resolver computes per-sub-unit gla +
      // baseRate from M1 sub-units (metric='area'). These act as the
      // fallback when an asset has no sub-units yet.
      baseRate: number;
      // Operations can start mid-construction (e.g., a retail mall
      // opens partial floors before the asset is fully complete).
      // When set, this absolute project year overrides the resolver's
      // default opsStartIdx = handoverYear + 1 - overlap. Engine still
      // respects operationsEndIdx from the phase.
      operationsStartYearOverride?: number;
      rentIndexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        growthPerPeriod?: number[];
        /** M4 Pass 2h: phase-local. */
        growthPerPeriodByPhase?: number[];
      };
      /** @deprecated M4 Pass 2h: project-axis-indexed occupancy ramp. */
      occupancyPerPeriod: number[];
      /** M4 Pass 2h: phase-local occupancy ramp (0..1 per period). */
      occupancyPerPeriodByPhase?: number[];
      /** Days Sales Outstanding for AR roll-forward. Default 30. */
      arDays?: number;
    };
  };
  /**
   * Module 3 Opex configuration. Per-asset line-item list driving the
   * operational expense build (direct departmental + indirect +
   * management fees + reserves + fixed charges). Optional: when
   * absent, the resolver seeds a strategy-appropriate default on
   * first Module 3 visit.
   */
  opex?: {
    /** Asset-wide inflation default. Applies to every fixed-cost line
     *  (fixed_baseline / per_room_year / per_sqm_year) that does not
     *  opt out via useAssetDefault === false. %-of-revenue + pct_of_gop
     *  lines never index; their auto-escalation comes from the revenue
     *  stream itself. (Pass 3, 2026-05-19.) */
    defaultIndexation?: {
      method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
      rate?: number;
      startYear?: number;
      steps?: Array<{ year: number; factor: number }>;
      /** @deprecated M4 Pass 2h: project-axis-indexed. */
      growthPerPeriod?: number[];
      /** M4 Pass 2h: phase-local. */
      growthPerPeriodByPhase?: number[];
    };
    /** Flat list of line items; engine evaluates each over the ops window. */
    lines: Array<{
      id: string;
      name: string;
      category: import('@/src/core/calculations/opex').OpexLineCategory;
      mode: import('@/src/core/calculations/opex').OpexLineMode;
      value: number;
      indexation: {
        method: 'none' | 'single_rate' | 'yoy_compound' | 'step' | 'yoy_per_period';
        rate?: number;
        startYear?: number;
        steps?: Array<{ year: number; factor: number }>;
        /** @deprecated M4 Pass 2h: project-axis-indexed. */
        growthPerPeriod?: number[];
        /** M4 Pass 2h: phase-local. */
        growthPerPeriodByPhase?: number[];
      };
      /** When false, engine uses this line's own indexation. Otherwise
       *  the asset defaultIndexation wins. (Pass 3, 2026-05-19.) */
      useAssetDefault?: boolean;
      /** Value entry mode (Pass 4, 2026-05-19). 'single' = use value
       *  every year (with inflation if any). 'yoy' = use yoyRates[t]
       *  directly per period; engine ignores inflation. Default 'single'. */
      rateMode?: 'single' | 'yoy';
      /** @deprecated M4 Pass 2h: project-axis-indexed. */
      yoyRates?: number[];
      /** M4 Pass 2h: phase-local per-period rates. */
      yoyRatesByPhase?: number[];
      disabled?: boolean;
    }>;
    /** M4 Pass 2a (2026-05-20): override the project Days Payable
     *  Outstanding default for this asset. Blank = inherit project. */
    apDaysOverride?: number;
  };
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
  // RETIRED 2026-09-08 with the roads and parks deduction. Both stay in the
  // union because stored lines must keep resolving, and both are hidden from
  // the picker via RETIRED_COST_METHODS below. rate_per_nda now multiplies
  // gross land, which is what it already computed on every live project
  // (every roads share was zero), so no stored line changes value.
  | 'rate_per_nda'             // value × land area. Was land × (1 - roads%).
  | 'rate_per_roads'           // value × roads area, which is now always 0
  | 'rate_per_gfa'             // value × asset.gfaSqm
  | 'rate_per_bua'             // value × asset.buaSqm OR derived BUA total
  | 'rate_per_nsa'             // value × asset.sellableBuaSqm
  | 'rate_per_unit'            // value × sub-unit count (Sellable category)
  | 'rate_per_parking_bay'     // value × asset.parkingBaysRequired (M2.0d)
  // M2.0g Fix 4 additions (2026-05-06):
  | 'rate_x_support_area'      // value × asset.supportArea (asset-level)
  | 'rate_x_parking_area'      // value × asset.parkingArea (asset-level)
  | 'rate_x_specific_subunit'  // value × area of a specific sub-unit (line.subUnitId)
  // 2026-09-10: three quantities the area chain derives that nothing could
  // charge against. NOT a revival of rate_per_nda: that one is RETIRED and now
  // multiplies GROSS land, and re-pointing it at the utilised area would change
  // what every stored line means without anybody editing it.
  | 'rate_x_net_developable_area' // value × chain net developable area (land x utilisation)
  | 'rate_x_footprint_area'    // value × chain building footprint
  | 'rate_x_landscape_area'    // value × chain landscape and open area
  | 'rate_x_main_asset_gfa'    // value × chain main asset GFA (total less retail and lobby)
  | 'rate_x_retail_parking_area' // value × the retail companion's parking area
  | 'rate_x_retail_gfa'        // value × the retail companion's ground-floor retail GFA; 0 on a host, whose strip carries it
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

/**
 * THE PICKER FOLLOWS TABLE 4 (2026-09-12, founder's request). Picking a basis
 * is choosing which column on the assets tab this rate multiplies, so the
 * area methods are offered in the ORDER the tab lists its columns: land and
 * footprint, then floor area outermost-in, then units and parking, then the
 * total. The lump sum leads, the two non-column area methods and the
 * per-sub-unit modes follow the columns, and the percentage methods close.
 * `verify-capex-structure` P4j fails if an area method steps out of that
 * order. The retired two stay in the list so a line already on one can still
 * render (P4d), and are never offered to a new line.
 */
export const COST_METHODS: readonly CostMethod[] = [
  'fixed',
  // Land and footprint, as the tab lists them.
  'rate_per_land',
  'rate_x_net_developable_area',
  'rate_x_footprint_area',
  'rate_x_landscape_area',
  // Floor area, outermost in: retail (the strip's), total, main, NSA.
  'rate_x_retail_gfa',
  'rate_per_bua',
  'rate_x_main_asset_gfa',
  'rate_per_nsa',
  // Units and parking.
  'rate_per_unit',
  'rate_per_parking_bay',
  'rate_x_parking_area',
  'rate_x_retail_parking_area',
  // The total.
  'rate_per_gfa',
  // Not a tab column.
  'rate_x_support_area',
  'rate_x_specific_subunit',
  'per_sub_unit_custom_rates',
  // Retired: offered only to a line already on them.
  'rate_per_nda',
  'rate_per_roads',
  // Percentages.
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

/**
 * Methods a NEW line may not choose, while stored lines keep resolving.
 *
 * Removing a method outright would orphan real cost lines: FMP RE HUB carries
 * an Infrastructure line at 250 and a Landscaping line at 75, both on
 * rate_per_nda. Hiding is the only option that leaves those numbers untouched
 * and still stops the vocabulary spreading.
 */
/**
 * WHAT EACH METHOD MULTIPLIES, AS ARITHMETIC (2026-09-11).
 *
 * The assets tab names an internal field in 13 of its tooltips
 * ("INTERNAL FIELD: Asset.parkingBaysRequired"); this is the same contract from
 * the other side, and it states the SUM rather than the name on purpose. Two
 * labels were shipped inverted because both quantities have a name in each
 * vocabulary and the two vocabularies cross at the outer tiers. A tooltip that
 * says `nsa + support, parking excluded` cannot be inverted by anybody,
 * including the next person to rename a column.
 */
export const COST_METHOD_BASIS_HELP: Partial<Record<CostMethod, string>> = {
  rate_per_land:
    "The tab's Plot Area column. INTERNAL FIELD: AssetAreaMetrics.landSqm, this asset's allocated share of its plot.",
  rate_per_nda:
    'LEGACY. Multiplies gross plot area, which is what every stored line already charged. INTERNAL FIELD: AssetAreaMetrics.ndaSqm.',
  rate_per_gfa:
    "The tab's TOTAL BUA column, the outermost tier. INTERNAL FIELD: AssetAreaMetrics.gfa = NSA + Support + Parking. The platform field is called gfa and the tab calls this tier BUA: the two vocabularies cross here.",
  rate_per_bua:
    "The tab's TOTAL GFA column, the built floor area. INTERNAL FIELD: AssetAreaMetrics.bua = NSA + Support, parking EXCLUDED. The platform field is called bua and the tab calls this tier GFA: the two vocabularies cross here. On a host with a retail strip this EXCLUDES the retail GFA the strip carries, and it still includes the lobby and service floors: the reference prices superstructure on Main Asset GFA, not on this tier.",
  rate_per_nsa:
    "The tab's NSA or GLA column. INTERNAL FIELD: AssetAreaMetrics.nsa = the sum of the Sellable, Operable and Leasable sub-units.",
  rate_per_unit:
    "The tab's Units or Keys column. INTERNAL FIELD: AssetAreaMetrics.unitCount.",
  rate_per_parking_bay:
    "The tab's Parking Slots column, this asset's own slots. INTERNAL FIELD: Asset.parkingBaysRequired when typed, else the chain's derived count.",
  rate_x_parking_area:
    "The tab's Parking Area column, this asset's own parking and not the line total. INTERNAL FIELD: Asset.parkingArea when typed, else the chain's derived area.",
  rate_x_support_area:
    'The Support sub-units plus Asset.supportArea. There is no tab column: support is a sub-unit CATEGORY, not a chain tier.',
  rate_x_net_developable_area:
    "The tab's Net Developable Area column. INTERNAL FIELD: Asset.derivedAreas.netDevelopableSqm = plot area x utilisation. Derived by the chain; there is no typed counterpart.",
  rate_x_footprint_area:
    "The tab's Building Footprint column. INTERNAL FIELD: Asset.derivedAreas.footprintSqm = net developable x ground coverage. Derived by the chain; there is no typed counterpart.",
  rate_x_landscape_area:
    "The tab's Landscape and Open Area column. INTERNAL FIELD: Asset.derivedAreas.landscapeSqm = net developable x (1 - ground coverage). Derived by the chain; there is no typed counterpart.",
  rate_x_main_asset_gfa:
    "The tab's Main Asset GFA column, the reference basis for superstructure cost. INTERNAL FIELD: Asset.derivedAreas.mainAssetGfaSqm = Total GFA less Retail GFA less Lobby GFA (or Total GFA where there is no retail). Derived by the chain; a plot with no chain inputs is priced on its Total GFA, which is the reference's own rule when retail is zero. Reads 0 on a retail strip, whose floor area is its Retail GFA.",
  rate_x_retail_parking_area:
    "The tab's Retail Parking Area column, charged on the RETAIL COMPANION and nowhere else: a host reads 0 here because its strip carries that parking. Rate x Parking Area charges a host's main parking and reads 0 on a strip, so each square metre of parking has exactly one method.",
  rate_x_retail_gfa:
    "The tab's Retail GFA column, charged on the RETAIL COMPANION and nowhere else: the strip's floor area IS the ground-floor retail its hosts derived, and a host reads 0 here because its strip carries it. The reference prices the retail strip on this figure at its own rate, separately from the hosts' superstructure.",
};

export const RETIRED_COST_METHODS: readonly CostMethod[] = ['rate_per_nda', 'rate_per_roads'] as const;

export function isRetiredCostMethod(m: CostMethod): boolean {
  return (RETIRED_COST_METHODS as readonly string[]).includes(m);
}

/**
 * WHAT A PICKER MAY OFFER, in ONE place (2026-09-11).
 *
 * Three pickers offered three different sets, each with its own inline filter,
 * and all three had drifted:
 *
 *   The add-line picker and the per-asset row picker both hid
 *   `rate_per_parking_bay`. That was right while the field it multiplies was
 *   seeded at 0 and written by nothing, which is the state `assetTableModel`
 *   recorded; the derived-areas change of 2026-09-10 gave it a real quantity
 *   and neither filter was updated, so a method that exists and computes could
 *   not be picked on the row where anyone would pick it.
 *
 *   The per-asset row picker ignored RETIRED_COST_METHODS entirely, so the two
 *   methods the other pickers hide were offered there, which is the whole
 *   point of retiring them lost on the one surface a user edits most.
 *
 * A RETIRED METHOD IS STILL OFFERED TO A LINE ALREADY ON IT, and that is not a
 * loophole: a `<select>` whose value is absent from its options renders as the
 * first option, so hiding it outright would make an Infrastructure line on
 * `rate_per_nda` display as 'Fixed Amount' and rewrite itself on the next
 * change event. RE HUB carries two such lines. `current` is how the row says
 * what it already holds.
 */
export function selectableCostMethods(current?: CostMethod): readonly CostMethod[] {
  return COST_METHODS.filter((m) => !isRetiredCostMethod(m) || m === current);
}

/**
 * THE PICKER NAMES THE QUANTITY THE ASSETS TAB NAMES (2026-09-11).
 *
 * Seven of these called a chain figure something the tab does not: 'Land Area'
 * for the column headed Plot Area, 'GFA' for Total GFA, 'BUA Total' for Total
 * BUA, 'Unit Count' for Units or Keys, 'Parking Bays' for Parking Slots, and
 * worst of all 'Sellable BUA' for the column headed NSA or GLA, which is a
 * THIRD name for a quantity whose two existing names already swap meaning
 * between the platform and the reference workbook. Picking a cost basis is
 * choosing which column on the assets tab this rate multiplies, and a reader
 * could not do that by reading.
 *
 * THE TWO OUTER TIERS CROSS, AND THE FIRST CUT OF THIS RENAME GOT THEM
 * BACKWARDS (fixed 2026-09-11, hours after shipping). Proved by arithmetic on
 * 17 of 17 live assets, not by reading a comment:
 *
 *   platform `nsa` = the sub-units                       = tab NSA or GLA
 *   platform `bua` = nsa + support, parking EXCLUDED     = tab TOTAL GFA
 *   platform `gfa` = bua + parking, the outermost tier   = tab TOTAL BUA
 *
 * and the chain agrees from its own side: `totalGfaSqm` is utilised x FAR with
 * no parking in it, and `totalBuaSqm` is that plus parking. So `rate_per_gfa`
 * charges the tier the tab calls Total BUA, and `rate_per_bua` charges the one
 * it calls Total GFA. Naming each after the platform FIELD it reads was the
 * trap: the field names are the reference's names for the other tier.
 *
 * A NAME CHECK CANNOT CATCH THIS, which is why the first cut passed its own new
 * check. `verify-capex-structure` P4h runs the arithmetic instead.
 *
 * The three chain methods added on 2026-09-10 already agreed, because they were
 * named from the tab. These bring the older seven into line. LABELS ONLY: the
 * stored `method` ids are untouched, so no line changes and no number moves.
 */
export const COST_METHOD_LABELS: Record<CostMethod, string> = {
  fixed:                   'Fixed Amount',
  rate_per_land:           'Rate × Plot Area',
  rate_per_nda:            'Rate × Plot Area (legacy)',
  rate_per_roads:          'Rate × Roads (retired)',
  rate_per_gfa:            'Rate × Total BUA',
  rate_per_bua:            'Rate × Total GFA',
  rate_per_nsa:            'Rate × NSA or GLA',
  rate_per_unit:           'Rate × Units or Keys',
  rate_per_parking_bay:    'Rate × Parking Slots',
  rate_x_support_area:     'Rate × Support Area',
  rate_x_parking_area:     'Rate × Parking Area',
  rate_x_specific_subunit: 'Rate × Specific Sub-unit',
  rate_x_net_developable_area: 'Rate × Net Developable Area',
  rate_x_footprint_area:   'Rate × Building Footprint',
  rate_x_landscape_area:   'Rate × Landscape and Open Area',
  rate_x_main_asset_gfa:   'Rate × Main Asset GFA',
  rate_x_retail_parking_area: 'Rate × Retail Parking Area',
  rate_x_retail_gfa:       'Rate × Retail GFA',
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

/**
 * 2026-08-16: `marketing` is its own stage.
 *
 * A reference budget totals CONSTRUCTION COST EXCLUDING LAND as hard cost plus
 * engineering, design, permits, developer fee and contingency, and leaves sales
 * marketing OUT of that total, while still charging the developer fee and the
 * contingency ON it. With marketing classified as a soft cost the platform
 * could express the bases (they are just selections) but not the total, because
 * every subtotal it reports is the asset total or a stage subtotal and a soft
 * cost necessarily falls inside "development cost (excl. land)".
 *
 * A stage rather than an exclude-from-totals flag, deliberately: marketing is a
 * SELLING cost, not a construction cost, so a stage states something true about
 * it. A flag would be a general mechanism for omitting any line from any total,
 * which is a much larger claim and one nothing else needs.
 *
 * The bases are unaffected. They are selections of specific lines and have
 * never consulted a stage, so marketing keeps feeding the developer fee and the
 * contingency exactly as before.
 */
export type CostStage = 'land' | 'hard' | 'soft' | 'marketing' | 'operating';

export const COST_STAGES: readonly CostStage[] = ['land', 'hard', 'soft', 'marketing', 'operating'] as const;

export const COST_STAGE_LABELS: Record<CostStage, string> = {
  land:      'Land',
  hard:      'Hard Cost',
  soft:      'Soft Cost',
  marketing: 'Marketing',
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

/**
 * Where a cost line's PHASING CURVE comes from (2026-08-15).
 *
 *   inherit      the asset's one curve (Asset.capexPhasing). When the asset has
 *                no curve this resolves to the line's own stored phasing, which
 *                is why an untouched project is unchanged by all of this.
 *   own          broken out: this line keeps its own curve whatever the asset does.
 *   land_cash    follows the land cash OUTFLOW, including any deferred parcel
 *                payment schedule. Real estate transfer tax is due when the land
 *                cash is paid, so it must never take the construction curve.
 *   collections  follows sales cash COLLECTED. Marketing and commission are paid
 *                as a percentage of cash received, so they arise when collections
 *                arrive, not across the build.
 *
 * ABSENT MEANS `inherit`, and inherit with no asset curve means "keep what you
 * had". That is deliberate: every pre-existing line carries undefined here.
 */
export type CapexPhasingSource = 'inherit' | 'own' | 'land_cash' | 'collections';

export const CAPEX_PHASING_SOURCES: readonly CapexPhasingSource[] =
  ['inherit', 'own', 'land_cash', 'collections'] as const;

export const CAPEX_PHASING_SOURCE_LABELS: Record<CapexPhasingSource, string> = {
  inherit: 'Inherit asset curve',
  own: 'Own curve',
  land_cash: 'Follows land cash',
  collections: 'Follows collections',
};

/** One phasing curve, held on an asset and inherited by its cost lines. */
export interface AssetCapexPhasing {
  phasing: CostPhasing;
  /** Manual weights, when phasing is 'manual'. Need not sum to 1; the engine
   *  normalises. */
  distribution?: number[];
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
  /** 2026-08-15. Absent = 'inherit'. See CapexPhasingSource. */
  phasingSource?: CapexPhasingSource;
  selectedLineIds?: string[];
  isLocked?: boolean;
  /**
   * DEPRECATED and RETIRED (2026-08-17c). Nothing reads this any more.
   *
   * It gated a line on `project.country`, which meant a line could be PRESENT
   * BUT INVISIBLE. That single property produced two silent money defects in
   * one week: the engine charged a row nobody could see or delete, and then,
   * once the gate was closed, selecting a country made a tax line appear and
   * charge on top of the one the user had added by hand.
   *
   * It stays on the type ONLY so `retireCountryGatedLines` (module1-migrate)
   * can find and clear it on saved snapshots. No engine, report, export or
   * screen consults it. Do not reintroduce a visibility gate on a line that
   * carries money: hide the row and you hide the number.
   */
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
  /**
   * 2026-08-17: the user's OWN classification, which wins over everything else.
   *
   * A cost table a lender reads has to let the modeller say what a line is: rows
   * can be added, renamed and deleted, so the catalog's answer is a default and
   * not a fact. `deriveCostStage` reads this first.
   *
   * A SEPARATE FIELD RATHER THAN WRITING `stage`, deliberately. `stage` is
   * outranked by `STANDARD_STAGE_BY_ID` for every standard line, and that
   * precedence is load-bearing: it is how the 2026-08-16 reclassification of
   * marketing reached every already-saved project without a migration. Flipping
   * the precedence onto `stage` would silently revert every pre-2026-08-16
   * marketing line to soft. This field carries the user's intent and nothing
   * else, so absent means "no one has said otherwise" rather than "soft".
   */
  stageOverride?: CostStage;
  /**
   * 2026-08-19: WHICH ASSETS THE LINE APPLIES TO.
   *
   *   'all'      every asset in the phase (the default and every other line)
   *   'selling'  only assets that SELL their product: `Sell` and
   *              `Sell + Manage`. A selling cost has no meaning on an asset
   *              that is held and operated: a hotel and a leased retail unit
   *              carry their own operating expenses, and there is no sale for a
   *              commission or a marketing budget to be a percentage of.
   *
   * ABSENT MEANS "NO ONE HAS SAID OTHERWISE", not 'all', exactly as
   * `stageOverride` does: `deriveAssetScope` reads this field first and falls
   * back to `SELLING_ONLY_BASE_IDS`, so the two selling lines gain the scope on
   * every already-saved project with no migration. That precedence is the same
   * one that carried the 2026-08-16 marketing reclassification, and it is why
   * this is a separate override field rather than a written value.
   *
   * Enforced in ONE place, `assetVisibleLines`, which the Costs tab, the cost
   * engine and the copy planner all call. Shown is charged and unshown is not
   * charged, both from the same rule (see docs/TRAPS.md 7.19).
   */
  assetScopeOverride?: CostAssetScope;
  /**
   * 2026-08-17: this line's period window FOLLOWS THE PHASE CONSTRUCTION WINDOW.
   *
   * Absent = the window is the line's own, which is every line on every project
   * that predates this, so nothing moves. Seeded lines set it true, and the
   * store re-derives their window whenever the phase's construction length
   * changes. Editing Start or End clears it, which is the deliberate extension
   * beyond the construction window the brief asks for.
   *
   * `startPeriod` / `endPeriod` stay REQUIRED and are always written, so every
   * reader (engine, Excel, PDF, cases) keeps reading one concrete number. This
   * flag says who owns that number, not whether it exists.
   */
  windowFollowsConstruction?: boolean;
  /**
   * 2026-08-17: WHICH CATALOG ENTRY THIS ROW IS.
   *
   * A cost line has two parts: an entry underneath that carries the method,
   * stage and phasing source, and a display name the user renames freely.
   * Without this, behaviour lived in the line's `id` while the label was free
   * text, so a row renamed "Permits and approvals" was still the seeded
   * Commission line, following sales collections, with nothing on screen
   * saying so.
   *
   * Absent resolves from the line's own base id (see `resolveCatalogId`), which
   * is why every existing line declares its identity with no migration.
   *
   * LABEL SIDE ONLY. The entry stamps method / stage / source onto the line at
   * selection time and is never read by the engine or the exports, so a catalog
   * that cannot be reached can never change a number.
   */
  catalogId?: string;
}

/** Which assets a cost line applies to. See `CostLine.assetScopeOverride`. */
export type CostAssetScope = 'all' | 'selling';

/** The strategies that SELL their product, so a selling cost applies to them. */
export function assetStrategySells(strategy: AssetStrategy | undefined): boolean {
  return strategy === 'Sell' || strategy === 'Sell + Manage';
}

/**
 * The base ids that are SELLING costs by default.
 *
 * Read only as the fallback in `deriveAssetScope`, and deliberately keyed on
 * the base id rather than the catalog, because the catalog is a label-side
 * concern the engine never reads (see costCatalog.ts). Mirrors
 * `STANDARD_STAGE_BY_ID` exactly, including the reason: a set keyed on the id
 * reaches every saved project with no migration.
 */
export const SELLING_ONLY_BASE_IDS: ReadonlySet<string> = new Set(['marketing', 'commission']);

/** The two scopes, for the row's picker. */
export const COST_ASSET_SCOPES: readonly CostAssetScope[] = ['all', 'selling'];
export const COST_ASSET_SCOPE_LABELS: Record<CostAssetScope, string> = {
  all: 'Every asset in the phase',
  selling: 'Selling assets only (Sell, Sell + Manage)',
};

export interface CostOverride {
  assetId: string;
  lineId: string;
  method: CostMethod;
  value: number;
  phasing: CostPhasing;
  distribution?: number[];
  /** 2026-08-15: per-asset phasing source, so one asset can break a line out
   *  without touching the project-wide master. Absent = defer to the master
   *  line's own phasingSource. */
  phasingSource?: CapexPhasingSource;
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
//   - 'cash_available' alias to capex_minus_presales
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
  | 'cash_available';       // alias to capex_minus_presales

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
  /** @deprecated M4 Pass 2h: project-axis-indexed. Use drawdownDistributionByYear. */
  drawdownDistribution?: number[];     // manual only
  /** M4 Pass 2h: year-keyed drawdown weights (key = absolute year). */
  drawdownDistributionByYear?: Record<string, number>;
  drawdownIncludeLand?: boolean;       // capex_minus_presales: include land in net
  drawdownMinCashFloor?: number;       // min_cash_floor only
  /** @deprecated M4 Pass 2h: project-axis-indexed absolute amounts. */
  drawdownCustomSchedule?: number[];
  /** M4 Pass 2h: year-keyed custom drawdown absolute amounts. */
  drawdownCustomScheduleByYear?: Record<string, number>;
  // Repayment
  repaymentMethod: RepaymentMethod;
  repaymentPeriods: number;
  /** @deprecated M4 Pass 2h: project-axis-indexed. */
  repaymentManualDistribution?: number[]; // manual only
  /** M4 Pass 2h: year-keyed repayment weights. */
  repaymentManualDistributionByYear?: Record<string, number>;
  sweepStartPeriod?: number;              // cashsweep_from_period
  sweepMinCashFloor?: number;             // cashsweep_min_cash
  /** @deprecated M4 Pass 2h: project-axis-indexed absolute amounts. */
  repaymentCustomSchedule?: number[];
  /** M4 Pass 2h: year-keyed custom repayment absolute amounts. */
  repaymentCustomScheduleByYear?: Record<string, number>;
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
  // M4 Pass 2S (2026-05-24): made every field optional and added a
  //   priority field so multiple sweep-enabled tranches across the
  //   project can be ordered (lower priority = paid first). Default
  //   priority = 100 (ties broken by tranche order in the list).
  //   Default startingYear = construction-end year + 1 of the owning
  //   phase. Default sweepRatio = 100 (sweep all excess above min cash).
  cashSweepConfig?: {
    /** Enable cash sweep for this tranche. Optional for back-compat;
     *  treated as true when the tranche's repaymentMethod === 'cash_sweep',
     *  false otherwise. Lets a tranche participate in sweep alongside
     *  another repayment method when explicitly enabled. */
    enabled?: boolean;
    /** Lower priority = swept first. Default 100. */
    priority?: number;
    /** Calendar year sweep begins. Defaults to construction-end + 1 of
     *  the tranche's owning phase. */
    startingYear?: number;
    /** % of excess cash above project minimum cash reserve to sweep
     *  per period. 0..100. Default 100 (sweep all). */
    sweepRatio?: number;
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
// methods behave as their per-method documentation describes.
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
  /**
   * Project-level cash sweep settings (2026-06-03). ONE setting applied to
   * EVERY cash-sweep facility, instead of three per-loan inputs. Sweep
   * eligibility is still per-loan (the loan's repayment method = Cash Sweep);
   * these control WHEN it starts and HOW much of the surplus it takes.
   *   startingYear  calendar year the sweep begins (default = construction end,
   *                 i.e. the first post-capex year).
   *   sweepRatioPct % of each period's excess cash applied to debt (default 100).
   * Repayment order across multiple sweep loans is automatic: existing loans
   * first, then the order they are listed.
   */
  cashSweep?: {
    startingYear?: number;
    sweepRatioPct?: number;
  };
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

// ── The asset type catalog (2026-09-07, land planning) ────────────────────
// THE reference land structure's list, replacing the invented M2.0e banks
// (ASSET_TYPES_BY_PROJECT_TYPE and ASSET_TYPES_BY_STRATEGY, removed same
// day: they fed ONLY the Type dropdown suggestions and the standards
// modal's quick-add, nothing else, measured before removal). Each entry is
// a display label; the stored Asset.type is the same string (no separate
// id), the field stays FREE TEXT, and a firm layers its own types through
// the account registry (refm_asset_types, mig 242), so values on live
// projects that predate this list keep working unchanged.
export type AssetTypeCategory = 'Residential' | 'Hospitality' | 'Retail';

export const ASSET_TYPE_CATEGORIES: readonly AssetTypeCategory[] = ['Residential', 'Hospitality', 'Retail'];

export const ASSET_TYPES_BY_CATEGORY: Record<AssetTypeCategory, readonly string[]> = {
  Residential: [
    'Branded Villas',
    'High End Apartments',
    'Branded Apartments High',
    'Branded Apartments Mid',
    'Apartments',
    'Residential',
  ],
  Hospitality: [
    'Resort 5 Star',
    '4 Star Hotel',
  ],
  Retail: [
    'Standalone Commercial',
    'Retail combined',
  ],
};

/** The full catalog in category order. A stable reference (never rebuilt),
 *  so React dependency arrays and memos keyed on it stay quiet. */
export const ASSET_TYPE_CATALOG: readonly string[] = [
  ...ASSET_TYPES_BY_CATEGORY.Residential,
  ...ASSET_TYPES_BY_CATEGORY.Hospitality,
  ...ASSET_TYPES_BY_CATEGORY.Retail,
];

/** The category a catalog label belongs to (trimmed, case-insensitive), or
 *  undefined for anything outside the catalog (free text, firm additions). */
export function assetTypeCategory(label: string): AssetTypeCategory | undefined {
  const key = label.trim().toLowerCase();
  if (!key) return undefined;
  for (const cat of ASSET_TYPE_CATEGORIES) {
    if (ASSET_TYPES_BY_CATEGORY[cat].some((t) => t.toLowerCase() === key)) return cat;
  }
  return undefined;
}

/** The catalog slice a project's Type dropdown suggests: the three
 *  category-named project types narrow to their own category; every other
 *  project type (Mixed-Use, Custom, Office, unset, ...) gets the full
 *  catalog, since the list is short enough to read whole. */
export function assetTypeCatalogForProjectType(pt: ProjectType | undefined): readonly string[] {
  if (pt === 'Residential' || pt === 'Hospitality' || pt === 'Retail') {
    return ASSET_TYPES_BY_CATEGORY[pt];
  }
  return ASSET_TYPE_CATALOG;
}

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

// 2026-08-15: area and rate default to ZERO. Area x rate is what puts land
// value into the model, and this factory backs the store's default state and
// the migrator's "no parcels" fallback, neither of which the user typed. The
// cash / in-kind split keeps its 60/40: it routes value rather than creating
// it, so at a zero rate it moves nothing, and zeroing both halves would make
// land cost vanish once a rate WAS typed.
export function makeDefaultParcel(
  id: string = DEFAULT_PARCEL_ID,
  phaseId: string = DEFAULT_PHASE_ID,
  name: string = 'Land 1',
  area = 0,
  rate = 0,
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
  // 2026-08-15: real estate transfer tax. Due when the land cash is PAID, so it
  // is seeded following the land cash outflow and never takes the construction
  // curve. Country gated via requiresCountry, the mechanism M2.0c added for
  // exactly this line.
  'rett',
  'construction-bua',
  'construction-parking',
  'infrastructure',
  'landscaping',
  'pre-operating',
  'professional-fee',
  'commission',
  // 2026-08-17: charged on the lines above it, and above the contingency so the
  // contingency can charge on it. See CATALOG ORDER in makeDefaultCostLines.
  'developer-fee',
  'contingency',
  // 2026-08-15: paid as a percentage of cash received, so it is seeded
  // following collections, alongside commission.
  // 2026-08-17: LAST in the catalog. See CATALOG ORDER in makeDefaultCostLines.
  'marketing',
] as const;
export type StandardCostLineId = typeof STANDARD_COST_LINE_IDS[number];

/**
 * What the SEED actually emits, in order (2026-08-17c).
 *
 * `STANDARD_COST_LINE_IDS` is the identity registry: every id the platform
 * recognises, which is what an existing line resolves its behaviour through and
 * what the row picker can offer. It is NOT the same thing as the set a new
 * project starts with, and conflating the two is how a row nobody asked for
 * ends up on every project.
 *
 * `rett` is registered but not seeded: it used to be seeded and country gated,
 * so on most projects it was PRESENT BUT INVISIBLE, which let the engine charge
 * a row that could not be seen and later let selecting a country double a cost
 * the user had already entered. A transfer tax is added from the catalog like
 * any other cost.
 */
export const SEEDED_COST_LINE_IDS = STANDARD_COST_LINE_IDS
  .filter((id) => id !== 'rett') as readonly StandardCostLineId[];

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

/**
 * How the seeded catalog's `value` field is filled (2026-08-15).
 *
 * 'reference' is the historical behaviour: the benchmark rates (4,500 per sqm
 * BUA, 25,000 per bay, 6% professional fee and so on). Test fixtures and the
 * verifier suite build models on those figures, so they stay available and
 * unchanged under this name.
 *
 * 'blank' is what a REAL project gets. The catalog is identical in every other
 * respect (names, methods, stages, allocation bases, period windows, the
 * `selectedLineIds` wiring on the percentage lines); only the rate is zero. The
 * reason is that a seeded rate is indistinguishable from a typed one once the
 * project is open: the rows arrive switched On, they are deletable rather than
 * locked, and a user who does not notice them is silently costing a scheme at
 * 4,500 per sqm they never chose. A zero rate contributes nothing until it is
 * typed, which is the only default that cannot be wrong.
 *
 * The two LOCKED land rows are exempt and keep their 100. They are not cost
 * assumptions, they are the derivation that carries the parcel value the user
 * entered in the wizard into the model, they cannot be switched off or deleted,
 * and zeroing them would drop land out of the project entirely.
 */
export type CostLineSeedValues = 'reference' | 'blank';

/**
 * THE PERIOD WINDOW A LINE TAKES WHEN IT IS FOLLOWING THE CONSTRUCTION WINDOW
 * (2026-08-17).
 *
 * ONE definition, used by the seed AND by the store's re-derive when the phase
 * length changes, so the window a line is born with and the window it keeps are
 * the same rule rather than two that agree on the day they are written.
 *
 * It ends AT `cp`, not `cp + 1`. The old catalog added a one-period buffer past
 * construction, which meant every seeded line rendered a permanent amber
 * "extends into operations period" warning on a brand new project: a default
 * that warns about itself. Extending past construction is still one edit away,
 * which is the deliberate act the brief asks for.
 *
 * The staggered starts (landscaping and the selling costs from mid-build,
 * pre-operating in the last six periods) are the catalog's own shape and are
 * kept; they are what makes the default useful rather than uniform.
 */
/**
 * A FOLLOWING WINDOW IS A DERIVED VALUE, AND IT SETTLES ON LOAD (2026-09-12).
 *
 * `updatePhase` re-derives every line carrying `windowFollowsConstruction`
 * when the construction length changes, and nothing else did. Measured on a
 * live project: a three-period phase whose six following lines still ran 1 to
 * 4, spreading a year of cost past the phase's own end. Whatever path left them
 * there, a line that DECLARES its window derived must read as derived, so the
 * store runs this at the same doors as the other settle passes. A line without
 * the flag is the user's and is never touched. Returns the input array when
 * nothing moves, so a clean project cannot be marked dirty by it.
 */
export function settleFollowingCostWindows(
  costLines: readonly CostLine[],
  phases: readonly Pick<Phase, 'id' | 'constructionPeriods'>[],
): { costLines: CostLine[]; moved: number } {
  let moved = 0;
  const next = costLines.map((c) => {
    if (c.windowFollowsConstruction !== true) return c;
    const phase = phases.find((p) => p.id === c.phaseId);
    if (!phase) return c;
    const win = deriveCostWindow(deriveLineBaseId(c.id), phase.constructionPeriods);
    if (c.startPeriod === win.startPeriod && c.endPeriod === win.endPeriod) return c;
    moved += 1;
    return { ...c, ...win };
  });
  return { costLines: moved > 0 ? next : (costLines as CostLine[]), moved };
}

export function deriveCostWindow(
  baseId: string,
  constructionPeriods: number,
): { startPeriod: number; endPeriod: number } {
  const cp = Math.max(1, constructionPeriods);
  // The parcel-driven land rows and the transfer tax that follows them sit in
  // the Y0 lump slot; their timing is the parcel schedule, not a window.
  if (baseId === 'land-cash' || baseId === 'land-inkind' || baseId === 'rett') {
    return { startPeriod: 0, endPeriod: 0 };
  }
  let startPeriod = 1;
  if (baseId === 'landscaping' || baseId === 'marketing' || baseId === 'commission') {
    startPeriod = Math.max(1, Math.floor(cp / 2));
  } else if (baseId === 'pre-operating') {
    startPeriod = Math.max(1, cp - 6);
  }
  return { startPeriod, endPeriod: Math.max(startPeriod, cp) };
}

// constructionPeriods is read so endPeriod can default to the phase
// duration. If 0 (no phase yet), endPeriod defaults to 24 to match
// makeDefaultPhase.
export function makeDefaultCostLines(
  phaseId: string,
  constructionPeriods = 24,
  values: CostLineSeedValues = 'reference',
): CostLine[] {
  const cp = Math.max(1, constructionPeriods);
  // 2026-08-17: every window now comes from `deriveCostWindow`, and every
  // seeded line carries `windowFollowsConstruction: true` so it TRACKS the
  // phase rather than freezing the length the phase happened to have at seed
  // time. The wizard used to call this function without the second argument at
  // all, so the parameter default of 24 applied and a three-period phase was
  // seeded with lines running 1 to 25.
  //
  // (T3-defaults Fix 4's one-period buffer past construction is retired with
  // it; see deriveCostWindow for why.)
  const win = (baseId: StandardCostLineId): { startPeriod: number; endPeriod: number } =>
    deriveCostWindow(baseId, cp);
  // M2.0L (2026-05-11): every seed line id is composed with phaseId
  // so a multi-phase project produces globally unique ids.
  // selectedLineIds reference the phase-scoped peer ids in the SAME phase.
  const id = (baseId: StandardCostLineId): string => composeLineId(baseId, phaseId);
  // ── CATALOG ORDER (2026-08-17) ─────────────────────────────────────────
  //
  //   land -> hard -> soft -> developer fee -> contingency -> MARKETING LAST
  //
  // Order is not decoration here. A `percent_of_selected` line may charge only
  // on lines ABOVE it (see selectedBase.ts), so this list IS the default
  // cascade: the developer fee sits above the contingency so the contingency
  // can charge on it, and both sit above marketing.
  //
  // MARKETING LAST MEANS MARKETING IS OUTSIDE THE FEE AND CONTINGENCY BASES.
  // A reference budget does charge both on it, so this is a deliberate
  // departure, made because a positional rule the user can see beats a hidden
  // exception: a user who wants marketing in the base moves it up, and the row
  // says what the move changed. Nothing already saved is affected, because no
  // seeded selection has ever referenced the marketing line.
  const seeded: CostLine[] = [
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
    // ── Real estate transfer tax: NOT SEEDED (2026-08-17c) ──────────────
    //
    // It used to be seeded here, country gated, so it was PRESENT BUT
    // INVISIBLE on every project whose country did not match. That is what
    // made two silent defects possible: the engine charged it while the row
    // could not be seen (fixed 2026-08-17), and then selecting a country made
    // a tax line appear and double a cost the user had already entered by
    // hand (found 2026-08-17b).
    //
    // A transfer tax is a cost like any other. It lives in the catalog
    // (`BUILT_IN_COST_CATALOG`, id 'rett', which is what the row picker
    // offers), it is added when the project needs it, its rate is typed, and
    // it still follows the land cash outflow because the entry stamps
    // `phasingSource: 'land_cash'` onto the line. Nothing is gated, so no line
    // is ever present but invisible.
    //
    // ── Construction (BUA + Parking) ────────────────────────────────────
    {
      // THE REFERENCE BASES (2026-09-12, founder's decision): superstructure on
      // Main Asset GFA, parking on its area, landscape on its area, and no line
      // on a retired method (the two rate_per_nda lines seeded a method the
      // picker refuses to offer a new line). Values stay what they were; the
      // 'blank' mode every live caller uses zeroes them, so a new project
      // seeds the LINES and the BASES and the user types the rates. A plot
      // with no chain inputs derives no Main Asset GFA and its caption says so.
      id: id('construction-bua'), phaseId, name: 'Construction (BUA)',
      method: 'rate_x_main_asset_gfa', value: 4500,
      stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
      ...win('construction-bua'), phasing: 'even',
    },
    {
      id: id('construction-parking'), phaseId, name: 'Construction (Parking)',
      method: 'rate_x_parking_area', value: 25000,
      stage: 'hard', scope: 'direct', allocationBasis: 'per_asset',
      ...win('construction-parking'), phasing: 'even',
    },
    // ── Infrastructure / Landscaping ────────────────────────────────────
    {
      id: id('infrastructure'), phaseId, name: 'Infrastructure',
      method: 'rate_per_land', value: 250,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      ...win('infrastructure'), phasing: 'even',
    },
    {
      id: id('landscaping'), phaseId, name: 'Landscaping',
      method: 'rate_x_landscape_area', value: 75,
      stage: 'hard', scope: 'direct', allocationBasis: 'land_share',
      ...win('landscaping'), phasing: 'even',
    },
    // ── Pre-operating (% of Construction + Infra + Landscaping) ─────────
    {
      id: id('pre-operating'), phaseId, name: 'Pre-operating',
      method: 'percent_of_selected', value: 3,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      ...win('pre-operating'), phasing: 'even',
      selectedLineIds: [id('construction-bua'), id('construction-parking'), id('infrastructure'), id('landscaping')],
    },
    // ── Professional Fee (% of Construction BUA + Parking) ──────────────
    {
      id: id('professional-fee'), phaseId, name: 'Professional Fee',
      method: 'percent_of_selected', value: 6,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      ...win('professional-fee'), phasing: 'even',
      selectedLineIds: [id('construction-bua'), id('construction-parking')],
    },
    // ── Commission (% of Revenue) ───────────────────────────────────────
    // Sell + Sell+Manage only; calc engine zeroes out for non-Sell strategies.
    // Revenue source ships in Module 2.1; for now value × 0 (revenue stub) = 0.
    // 2026-08-15: like marketing, a percentage of cash RECEIVED, so its default
    // phasing follows collections. It used to spread across the back half of
    // the construction window, which is the wrong shape for a sales cost.
    {
      id: id('commission'), phaseId, name: 'Commission',
      method: 'percent_of_selected', value: 4,
      stage: 'soft', scope: 'indirect', allocationBasis: 'per_asset',
      ...win('commission'), phasing: 'even',
      phasingSource: 'collections',
      selectedLineIds: [],
    },
    // ── Developer Fee (% of the construction and soft costs above) ──────
    // 2026-08-17. New to the catalog. It seeds at ZERO like every other
    // editable rate, so it contributes nothing until a rate is typed, and its
    // base is the hard and soft lines ABOVE it: land and the transfer tax are
    // excluded (a fee on land value is a different agreement, and selecting it
    // by default would charge it the moment a rate was typed), and so is
    // commission, which is a selling cost like marketing.
    {
      id: id('developer-fee'), phaseId, name: 'Developer Fee',
      method: 'percent_of_selected', value: 0,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      ...win('developer-fee'), phasing: 'even',
      selectedLineIds: [
        id('construction-bua'), id('construction-parking'), id('infrastructure'),
        id('landscaping'), id('pre-operating'), id('professional-fee'),
      ],
    },
    // ── Contingency (% of everything above it except the selling costs) ─
    // 2026-08-17: the base now includes infrastructure, landscaping,
    // pre-operating, the professional fee and the DEVELOPER FEE, which is the
    // ordinary cascade a budget is built from and the reason the positional
    // rule replaced the old blanket ban on referencing another percent line.
    // New seeds only, and every rate in the chain is zero until typed.
    {
      id: id('contingency'), phaseId, name: 'Contingency',
      method: 'percent_of_selected', value: 5,
      stage: 'soft', scope: 'indirect', allocationBasis: 'bua_share',
      ...win('contingency'), phasing: 'even',
      selectedLineIds: [
        id('construction-bua'), id('construction-parking'), id('infrastructure'),
        id('landscaping'), id('pre-operating'), id('professional-fee'), id('developer-fee'),
      ],
    },
    // ── Marketing (% of Revenue). LAST, deliberately: see CATALOG ORDER ──
    // Paid out of cash received, so it arises WHEN COLLECTIONS ARRIVE rather
    // than across the build. Overridable per line.
    {
      id: id('marketing'), phaseId, name: 'Marketing',
      method: 'percent_of_revenue_sale', value: 0,
      // 2026-08-16: its own stage, so it stays OUT of construction cost.
      stage: 'marketing', scope: 'indirect', allocationBasis: 'per_asset',
      ...win('marketing'), phasing: 'even',
      phasingSource: 'collections',
    },
  ];
  // Every seeded line tracks the phase construction length until the user types
  // a window of their own. See `deriveCostWindow`.
  const catalog: CostLine[] = seeded.map((line) => ({ ...line, windowFollowsConstruction: true }));
  if (values === 'reference') return catalog;
  // Blank: the catalog structure survives, the rates do not. isLocked is the
  // discriminator rather than the line id, so a line that is genuinely a
  // derivation (the two land rows) keeps its coefficient and everything the
  // user can edit, switch off or delete starts at zero.
  return catalog.map((line) => (line.isLocked ? line : { ...line, value: 0 }));
}

/** The standard catalog with every editable rate at zero. What a NEW project,
 *  a new phase and a newly seeded legacy snapshot get, so no cost enters the
 *  model that the user did not type. See `CostLineSeedValues`. */
export function makeBlankCostLines(phaseId: string, constructionPeriods = 24): CostLine[] {
  return makeDefaultCostLines(phaseId, constructionPeriods, 'blank');
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

/**
 * THE RETAIL COMPANION ASSET (2026-09-09, consolidation step 4).
 *
 * The Lease sibling that HOLDS the ground-floor retail a consolidated line
 * builds, while the host stays Sell and its cost goes to cost of sales. One per
 * line, pooled from every plot on it; the rule that decides what to pool is
 * `src/core/calculations/retailCompanion.ts`, and this only turns a spec into
 * an Asset.
 *
 * THE AREAS USE THE PLATFORM'S FIELD NAMES, which invert the outer two tiers of
 * the industry vocabulary (CLAUDE.md), so this is worth stating rather than
 * leaving to be inferred:
 *   buaSqm        = Total GFA        = the retail floor area, parking excluded
 *   gfaSqm        = Total BUA        = that plus its parking area
 *   sellableBuaSqm= NSA or GLA       = the leasable area, which for a retail
 *                                      strip is its floor area (the chain takes
 *                                      no service deduction off retail)
 *
 * NO LAND AND NO COST. `landAllocation` is deliberately absent, the engine
 * gives a companion no land (Rule 2) and `computeAssetCost` short-circuits it
 * to an explicit empty breakdown, so this asset cannot charge anything. The
 * land carve-out and the cost lines are later steps.
 *
 * NO parentAssetId: a line has many hosts, and leaving it absent is what makes
 * the two Operate-companion sync passes skip this asset without either of them
 * learning that a second kind of companion exists.
 */
export function makeRetailCompanionAsset(spec: {
  id: string;
  lineKey: string;
  phaseId: string;
  typeLabel: string;
  hostAssetIds: string[];
  retailGfaSqm: number;
  retailParkingAreaSqm: number;
  retailParkingSlots: number;
}, existing?: Asset): Asset {
  return {
    // WHAT THE USER MAY OWN survives a re-derive: the name (they may rename the
    // strip), whether it is visible, and its status. Everything else is derived
    // from the line and is overwritten on every pass, which is what makes this
    // self-healing rather than a one-time seed.
    ...(existing ?? {}),
    id: spec.id,
    phaseId: spec.phaseId,
    name: existing?.name ?? `${spec.typeLabel} - Retail`,
    type: spec.typeLabel,
    strategy: 'Lease',
    visible: existing?.visible ?? true,
    status: existing?.status ?? 'planned',
    buaSqm: spec.retailGfaSqm,
    gfaSqm: spec.retailGfaSqm + spec.retailParkingAreaSqm,
    sellableBuaSqm: spec.retailGfaSqm,
    // THE PARKING AREA GOES IN THE FIELD THE ENGINE READS (step 6, 2026-09-10).
    // It was only ever inside `gfaSqm` (retail GFA plus parking), so the
    // difference was visible on screen while `rate_x_parking_area`, the cost
    // method whose whole job is to charge it, multiplied by an absent field and
    // charged nothing. A figure the model knows, in a field nothing read.
    parkingArea: spec.retailParkingAreaSqm,
    parkingBaysRequired: spec.retailParkingSlots,
    isCompanion: true,
    companionType: 'retail',
    retailLineKey: spec.lineKey,
    retailHostAssetIds: [...spec.hostAssetIds],
    // A LEASE ASSET NEEDS ITS LEASE BLOCK (step 6, 2026-09-10), or
    // `resolveLeaseConfig` returns null on the first line it reads and the
    // strip earns nothing however it is priced. Every hand-made Lease asset
    // carries one; it is created lazily by the Revenue tab the first time
    // someone edits a lease field, which a derived asset nobody has visited
    // never gets. SEEDED WITH THE TAB'S OWN DEFAULTS, nothing invented: rate 0,
    // occupancy zeros, arDays 30, no indexation. So it earns nothing until
    // somebody prices it, exactly like the sub-unit it reads, and setting a
    // rate and an occupancy is the same two edits any Lease asset needs.
    // WHAT THE USER OWNS SURVIVES a re-derive, like the name and the rate.
    revenue: {
      ...(existing?.revenue ?? {}),
      lease: existing?.revenue?.lease ?? {
        assetId: spec.id,
        baseRate: 0,
        rentIndexation: { method: 'none' as const },
        occupancyPerPeriod: [],
        arDays: 30,
      },
    },
  } as Asset;
}

/**
 * THE RETAIL COMPANION'S SUB-UNIT (2026-09-09, consolidation step 4b).
 *
 * WHY IT IS DERIVED RATHER THAN ADDED BY HAND. Its area is "the pooled retail
 * GFA", which is a figure the model already knows: asking a user to retype it
 * would put one fact in two places, the exact defect that just moved the retail
 * area-per-slot off the plot rows. The platform's existing answer to "a
 * companion needs sub-units" is already a derivation (`syncCompanionSubUnits`
 * mirrors the Operate companion's rows), so building this one by hand would be
 * a second answer to a settled question. And without a sub-unit the asset
 * cannot earn at all, so it would exist as a half-built thing a user has to
 * know to finish, with nothing on screen saying so.
 *
 * RATE ZERO. It earns nothing until somebody prices it, which is what keeps the
 * engine byte-identical while the row exists.
 *
 * PER SQM PER YEAR falls out of the existing rule rather than adding one:
 * category Leasable on an area metric is what `rateUnitLabel` already reads as
 * "per sqm/year", and `rateTimeBasis` already reads as a yearly flow, so the
 * blended figures on table 5 label it correctly with no new case.
 */
export function makeRetailCompanionSubUnit(
  companionAssetId: string,
  retailGfaSqm: number,
  existing?: SubUnit,
): SubUnit {
  return {
    // WHAT THE USER OWNS survives a re-derive: the name they gave the tenancy
    // and the RATE they set. Only the area follows the line, because only the
    // area is the line's to state.
    ...(existing ?? {}),
    id: `${companionAssetId}__sub`,
    assetId: companionAssetId,
    name: existing?.name ?? 'Retail',
    category: 'Leasable',
    metric: 'area',
    metricValue: Math.max(0, retailGfaSqm),
    unitPrice: existing?.unitPrice ?? 0,
  };
}
