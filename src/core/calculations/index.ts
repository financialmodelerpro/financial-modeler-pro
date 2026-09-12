/**
 * src/core/calculations/index.ts (v7 schema)
 *
 * Phase M2.0d (2026-05-06): adds the M2.0d Costs polish helpers:
 *   - deriveCostStage(line) -> 'land' | 'hard' | 'soft' | 'operating'
 *     by id (the M2.0d standard 9-line catalog uses stable ids; custom
 *     user lines retain their user-picked stage).
 *   - deriveCostScope(line) -> 'direct' | 'indirect' | 'allocated'
 *     by allocationBasis ('per_asset' / 'manual' = direct, everything
 *     else = indirect).
 *   - classifyAssetCapex(asset, capexBasis, landTotal, usefulLife):
 *     splits per-asset capex into accounting destinations per strategy
 *     (COGS / FixedAssets / Depreciation per period). Land excluded
 *     from depreciation base regardless of strategy.
 *   - computeCashFlowImpact(asset, capexBasis, landInKindPortion):
 *     splits capex into cash outflow vs in-kind equity contribution.
 *     Land in-kind portion is excluded from cash outflow and added to
 *     equityInKind.
 *   - resolveUsefulLifeYears(asset): reads asset.usefulLifeYears or
 *     falls back to DEFAULT_USEFUL_LIFE_YEARS keyed by strategy.
 *
 * Phase M2.0c (2026-05-06): rewrite for the v6 cost-line catalog (12+
 * open lines) and 5×5 financing matrix. The pre-M2.0 cost engine
 * (calculateItemTotal / distributeCost / buildAssetFinancing) is
 * restored, adapted to read v5 Asset / Parcel / SubUnit instead of
 * the legacy AreaMetrics. Granularity (annual / monthly) flows from
 * Project.modelType through Phase.constructionPeriods, since periods
 * are integer counts in the model granularity.
 *
 * Public API:
 *   - computeLandAggregate(parcels, phaseId?)
 *   - computeSubUnitArea(u)
 *   - computeAssetBua(asset, subUnits)
 *   - computeAssetSellableBua(asset, subUnits)
 *   - computeAssetUnitCount(asset, subUnits)  // sum of Sellable count metric
 *   - computeAssetLandSqm(asset, parcels, assets, subUnits, mode)
 *   - computeAssetLandCost(asset, parcels, assets, subUnits, mode)
 *   - resolveAssetAreaMetrics(asset, project, parcels, assets, subUnits, mode)
 *   - calculateItemTotal(line, asset, ctx) -> currency
 *   - distributeItemCost(line, asset, ctx) -> number[] over construction window
 *   - computeAssetCost(asset, ...) -> per-line breakdown + total
 *   - computePhaseCost(phase, ...) -> aggregated phase capex
 *   - computeProjectEndDate(project, phases)
 *
 * Tab 4 Financing rebuild (2026-05-13): all Tab 4 engine helpers
 * (computeFinancing, computeFunding, computeEquity,
 * computeCombinedDebtService, computeIdcSummary, applyIdcToCapex,
 * computeCapitalStack, distributeEquity, normalizeYoYSchedule,
 * computeEqualPeriodicPayment, parcelDebtEquityFractions,
 * computePhaseHistorical) were deleted from this file. The
 * replacement engine lives in src/core/calculations/financing/.
 * expandDeferredSchedule stays here, still consumed by computeAssetCost
 * for percent_of_cash_land deferred-payment parcels.
 */

import type {
  Project,
  Phase,
  Parcel,
  Asset,
  AssetStrategy,
  SubUnit,
  CostLine,
  CostOverride,
  CostMethod,
  CostPhasing,
  CostStage,
  CostScope,
  CostAssetScope,
  CostType,
  CostCategory,
  CostDriver,
  AllocationBasis,
  FinancingTranche,
  EquityContribution,
  LandAllocationMode,
  DrawdownMethod,
  RepaymentMethod,
  OutputGranularity,
  FundingMethodId,
  ParcelFundingConfig,
  ProjectFinancingConfig,
  CapexPhasingSource,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  capexPhasingIsInert,
  resolveLinePhasing,
  isParcelDrivenLandLine,
  type CapexPhasingContext,
} from './capexPhasing';
import { assetVisibleLines, allowedSelectedIds, deriveAssetScope } from './selectedBase';
// Consolidation step 5: the retail land carve-out. Both halves come from ONE
// function; the two wrappers below are the only places it reaches the engine.
import {
  carveRetailLand,
  isRetailCompanion,
  type RetailLandCarve,
  type RetailLandHostResult,
} from './retailCompanion';
import { computeLandChain } from './landChain';
import {
  resolveSellingCostBasis,
  sellingCostAmount,
  type RevenueSource,
} from './revenue/sellingCosts';
// Re-exported so every existing caller keeps its import, while the derivation
// itself has exactly ONE implementation (see selectedBase.ts for why).
export { deriveAssetScope };
import {
  DEFAULT_USEFUL_LIFE_YEARS,
  assetStrategySells,
  SELLING_ONLY_BASE_IDS,
  PER_SUBUNIT_RATE_KEY_SUPPORT,
  PER_SUBUNIT_RATE_KEY_PARKING,
  COST_STAGES,
  deriveLineBaseId,
  PARCEL_WEIGHTED_AVG,
  PARCEL_WEIGHTED_AVG_ALL,
  PARCEL_CUSTOM_RATE,
  isParcelSentinel,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

// ── Operating end date (T2P3 Fix 3) ───────────────────────────────────────
// Computed from phase.startDate + (constructionPeriods + operatingPeriods).
// Phases are annual since M2.0i so each period == 1 year. Operations begin
// the year after construction ends (overlap subtracted); operations end
// the LAST day of `startDate.year + constructionPeriods - overlap +
// operatingPeriods - 1`. Returns null when the phase is missing or
// operatingPeriods <= 0 (asset is not operational). M5 / terminal-value
// consumers can read getOperatingEndDate(assetId) to anchor cash-flow
// horizons.
export function computeOperatingEndDate(
  asset: Asset,
  phase: Phase | undefined,
): Date | null {
  if (!phase) return null;
  const ops = Math.max(0, phase.operationsPeriods ?? 0);
  if (ops <= 0) return null;
  if (!phase.startDate) return null;
  const start = new Date(phase.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const construction = Math.max(0, phase.constructionPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  // Operations start year: start.year + construction - overlap.
  // Operations end year (inclusive): start.year + construction - overlap + ops - 1.
  // Operating End Date = Dec 31 of that year (last day of the operating window).
  const endYear = start.getUTCFullYear() + construction - overlap + ops - 1;
  return new Date(Date.UTC(endYear, 11, 31));
}

// Display-format helper. Returns 'Mon YYYY' (e.g. 'Dec 2039'). Falls back
// to '-' when the date is null.
export function formatOperatingEndDate(date: Date | null): string {
  if (!date) return '-';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ── Land aggregates ────────────────────────────────────────────────────────
export interface LandAggregate {
  totalAreaSqm: number;
  totalValue: number;
  cashValue: number;
  inKindValue: number;
  weightedRate: number;
}

export function computeLandAggregate(parcels: Parcel[], phaseId?: string): LandAggregate {
  const filtered = phaseId === undefined
    ? parcels
    : parcels.filter((p) => p.phaseId === phaseId);
  let totalArea = 0;
  let totalValue = 0;
  let cashValue = 0;
  let inKindValue = 0;
  for (const p of filtered) {
    const a = Math.max(0, p.area);
    const r = Math.max(0, p.rate);
    const v = a * r;
    totalArea += a;
    totalValue += v;
    cashValue += v * (Math.max(0, p.cashPct) / 100);
    inKindValue += v * (Math.max(0, p.inKindPct) / 100);
  }
  const weightedRate = totalArea > 0 ? totalValue / totalArea : 0;
  return { totalAreaSqm: totalArea, totalValue, cashValue, inKindValue, weightedRate };
}

// ── Sub-unit area ──────────────────────────────────────────────────────────
// M2.0i Fix 6 (2026-05-07): metric 'units' replaces legacy 'count'.
// When metric='units': metricValue is the integer count, unitArea is
// the per-unit floor area, and computed area = count × unitSize.
// When metric='area': metricValue is the total sqm directly. Legacy
// snapshots with metric='count' continue to compute via the same
// formula (the rename only affects the type name + UI label).
/**
 * THE METRIC IS THE ASSET'S WHERE IT STATES ONE (docs/TRAPS.md 7.32).
 *
 * `Asset.subUnitMetric` is an asset-level override: it says how THIS asset's
 * parts are measured, and the tab, the sub-unit table and the land-planning
 * rules have all read it that way for months. `computeSubUnitArea` did not: it
 * asked the ROW alone, so the two disagreed exactly where a user had switched
 * an asset from counting units to stating areas and the rows kept their old
 * metric. That is not hypothetical. On the live reference project one row, "2
 * BR" on Marina Residences, carries `metric: 'units'` under an asset whose
 * metric is 'area', so the engine read its 10,808.64 sqm as a COUNT of units
 * and multiplied by the unit size: 1.84m sqm of BUA and 8.12bn of hard cost on
 * one asset, while every screen showed the right area.
 *
 * ONE ANSWER, IN CORE, and the platform's own table rules import it rather than
 * keeping the private copy they had. The asset is REQUIRED below rather than
 * optional: an optional parameter is a defect waiting for one caller to forget
 * (TRAPS 7.7), and making it required is what put every one of the twenty-odd
 * call sites in front of the compiler instead of in front of a reviewer.
 */
/**
 * THE PARKING AN ASSET HAS: what the user typed, else what the chain derived.
 *
 * TYPED WINS, and "typed" means GREATER THAN ZERO rather than "present". The
 * asset factory seeds `parkingBaysRequired: 0` and an old migration wrote
 * `parkingArea: 0` on assets that had none, so a stored zero is the platform's
 * own seed and cannot be told from a decision. That is exactly the trap the
 * seeded `landAllocation.sqm: 0` set (see `resolveAssetPlotDraw`), and it is
 * read the same way here: zero means nobody has said.
 *
 * THE DERIVED FIGURES LIVE IN THEIR OWN BAG, never in the user's field, so this
 * precedence is a READ rule rather than an invariant every write path has to
 * remember. Clearing a derived value is safe; nothing the platform wrote can
 * masquerade as something a person typed.
 */
export function resolveAssetParkingArea(asset: Asset): number {
  const typed = Math.max(0, asset.parkingArea ?? 0);
  if (typed > 0) return typed;
  return Math.max(0, asset.derivedAreas?.parkingAreaSqm ?? 0);
}

export function resolveAssetParkingBays(asset: Asset): number {
  const typed = Math.max(0, asset.parkingBaysRequired ?? 0);
  if (typed > 0) return typed;
  return Math.max(0, asset.derivedAreas?.parkingBays ?? 0);
}

/** The three the chain alone produces: there is no typed counterpart, so an
 *  absent derivation is simply zero and the cost line charges nothing. */
export function resolveAssetNetDevelopableArea(asset: Asset): number {
  return Math.max(0, asset.derivedAreas?.netDevelopableSqm ?? 0);
}
export function resolveAssetFootprintArea(asset: Asset): number {
  return Math.max(0, asset.derivedAreas?.footprintSqm ?? 0);
}
export function resolveAssetLandscapeArea(asset: Asset): number {
  return Math.max(0, asset.derivedAreas?.landscapeSqm ?? 0);
}

export function resolveSubUnitMetric(u: SubUnit, asset: Asset | undefined): 'area' | 'units' {
  const fromAsset = asset?.subUnitMetric;
  const raw = fromAsset ?? u.metric;
  // Defensive: legacy 'count' is 'units'.
  return raw === 'units' || (raw as unknown as string) === 'count' ? 'units' : 'area';
}

export function computeSubUnitArea(u: SubUnit, asset: Asset | undefined): number {
  if (resolveSubUnitMetric(u, asset) === 'units') {
    return Math.max(0, u.metricValue) * Math.max(0, u.unitArea ?? 0);
  }
  return Math.max(0, u.metricValue);
}

// M2.0f Fix 6 (2026-05-06): asset BUA = sum of sub-unit areas. The
// asset.buaSqm field stays on the schema for v7 compat (legacy
// snapshots may have a hand-typed value) but the calc engine now
// treats sub-units as the source of truth. Same for sellable BUA.
//
// Behaviour: prefer the sub-unit sum unconditionally. Fall back to
// asset.buaSqm only when the asset has no sub-units yet (so empty-
// asset placeholders show the user-entered hint, not 0).
// M2.0M Pass 9 Fix 8 (2026-05-12): fallback widens. When sub-units
// exist but every row has metricValue=0 (stub rows from "Add sub-unit"
// before the user fills in area), fall back to asset.buaSqm rather
// than returning 0. resolveAssetAreaMetrics already does this widening
// at src/core/calculations/index.ts:649-652; computeAssetBua was the
// missing link that caused autoByBua land allocation (via
// computeAssetLandSqm) to compute landSqm=0 even when asset.buaSqm
// carries the real entered area. See docs/m20costs-pass9-land-zero-
// diagnostic.md for the full trace.
export function computeAssetBua(asset: Asset, subUnits: SubUnit[]): number {
  const phaseSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  if (phaseSubUnits.length === 0) return Math.max(0, asset.buaSqm ?? 0);
  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  return sum > 0 ? sum : Math.max(0, asset.buaSqm ?? 0);
}

export function computeAssetSellableBua(asset: Asset, subUnits: SubUnit[]): number {
  const phaseSubUnits = subUnits.filter(
    (u) => u.assetId === asset.id && u.category !== 'Support',
  );
  if (phaseSubUnits.length === 0) return Math.max(0, asset.sellableBuaSqm ?? 0);
  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  return sum > 0 ? sum : Math.max(0, asset.sellableBuaSqm ?? 0);
}

/**
 * Sum of Sellable / Operable / Leasable UNITS. Used by the rate_per_unit cost
 * method and by the land chain, which takes it as a unit-count override.
 *
 * THE ASSET'S METRIC DECIDES, and until 2026-09-09 this asked the ROW.
 *
 * A sub-unit carries its own `metric`, but every surface on the assets tab
 * resolves it as `asset.subUnitMetric ?? u.metric`: the asset wins, because the
 * asset is what the column headings and the area sums are written against. This
 * function asked `u.metric` alone, so a row whose own metric was left at 'units'
 * while its asset counts AREA was an area on screen and a COUNT here.
 *
 * MEASURED, not reasoned about. Marina Residences counts area; its "2 BR" row
 * still said 'units' and held 12,599.1, which is its area in sqm. This returned
 * 12,599.1, the chain took it as a unit-count override and printed it verbatim
 * in Units or Keys, so a line with 19,999 sqm of NSA at 170 sqm a unit reported
 * 12,599 units instead of 118. Its neighbour, with no sub-units and so no
 * override, reported 7,600 over 260 correctly.
 *
 * ONE ANSWER NOW: the same resolution the screen uses. Measured across all six
 * live projects before changing it, exactly one count moves (that one, to 0, so
 * the chain derives 118 instead), and NO live project carries a rate_per_unit
 * cost line, so no money moves today.
 *
 * M2.0i Fix 6 (2026-05-07): 'units' is the canonical name; legacy 'count' still
 * resolves, on the row and on the asset alike.
 */
export function computeAssetUnitCount(asset: Asset, subUnits: SubUnit[]): number {
  const isUnitsMetric = (m: unknown): boolean => m === 'units' || m === 'count';
  return subUnits
    .filter((u) => u.assetId === asset.id && u.category !== 'Support')
    .filter((u) => isUnitsMetric(asset.subUnitMetric ?? u.metric))
    .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
}

// T3-edit-runtime v7 (2026-05-13): asset revenue used by commission
// cost lines (% of total revenue / % of revenue cash / % of revenue
// sale). Mirrors the Tab 2 AssetAreaReconciliationBlock formula:
// sum of (metricValue x unitPrice) across revenue sub-unit categories
// (Sellable / Operable / Leasable). Support + Parking excluded.
// Until M2.1 ships proper period-by-period revenue arrays, all three
// commission methods resolve to this asset-level total. The cash-basis
// vs sale-basis distinction stays on the schema for forward-compat;
// today both produce the same number.
export function computeAssetRevenue(asset: Asset, subUnits: SubUnit[]): number {
  return subUnits
    .filter((u) => u.assetId === asset.id && (u.category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable'))
    .reduce((s, u) => s + Math.max(0, u.metricValue) * Math.max(0, u.unitPrice ?? 0), 0);
}

// ── Asset land sqm + value ─────────────────────────────────────────────────
// Resolve each asset's land area in sqm based on landAllocationMode.
//
// M2.0f Fix 2 (2026-05-06): when asset.landAllocation.parcelId or
// asset.landAllocation.multiParcelSplits is populated, the asset
// pulls land sqm + cost from those specific parcels at each parcel's
// own rate (not the phase-weighted average). Falls back to the
// project-wide allocation rules (sqm / percent / autoByBua) when
// neither is set, so legacy v7 snapshots stay correct.
/**
 * How many sqm an asset draws from the plot it NAMES, and where that came
 * from. `undefined` when the asset names no real plot (none, or one of the
 * custom-rate / weighted-average sentinels), which is when the older
 * phase-share rules still apply.
 *
 * THIS EXISTS BECAUSE TWO FUNCTIONS ANSWERED THE SAME QUESTION DIFFERENTLY.
 * computeAssetLandBreakdown took the explicit sqm verbatim; computeAssetLandSqm
 * required it to be > 0 and otherwise fell through to a phase-wide share. On a
 * live project that split the answer in half: FMP RE HUB's Hotel Phase 1, the
 * only asset on a 16,348 sqm plot with a seeded sqm of 0, resolved to 0 in the
 * cost engine and to 16,348 in the reconciliation table, on the same screen.
 * Both now call this.
 *
 * A SEEDED ZERO IS NOT A DECISION. The asset factory used to write
 * `landAllocation: { parcelId, sqm: 0 }`, so a stored 0 is the platform's own
 * seed rather than anything a person typed, and it is read here as "not
 * decided". The factory no longer writes it. An asset that genuinely draws
 * nothing from a plot is an asset with no plot, which the picker offers.
 *
 * SOLE OCCUPANT DRAWS THE WHOLE PLOT. One asset on a plot has nothing to split
 * with, so typing its area is busywork and leaving it blank reads as an
 * under-drawn plot that is not actually under-drawn. The default is DERIVED,
 * never written: moving the asset to another plot re-derives it there, and a
 * figure someone typed can never be overwritten because nothing is written at
 * all. As soon as a second asset names the plot the default stops and the
 * split has to be typed, which is what the plot check on the row above
 * reports.
 */
export interface AssetPlotDraw {
  sqm: number;
  source: 'typed' | 'whole_plot' | 'unset';
}

export function resolveAssetPlotDraw(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
): AssetPlotDraw | undefined {
  if (asset.isCompanion === true) return undefined;
  const parcelId = asset.landAllocation?.parcelId;
  if (!parcelId
    || parcelId === PARCEL_CUSTOM_RATE
    || parcelId === PARCEL_WEIGHTED_AVG
    || parcelId === PARCEL_WEIGHTED_AVG_ALL) return undefined;
  const typed = asset.landAllocation?.sqm ?? asset.landAreaSqm;
  if (typeof typed === 'number' && typed > 0) return { sqm: Math.max(0, typed), source: 'typed' };
  const parcel = parcels.find((p) => p.id === parcelId);
  if (!parcel) return { sqm: 0, source: 'unset' };
  // Everyone who NAMES this plot, companions excluded (they carry no land) and
  // hidden assets excluded (they are not on the model).
  const sharers = assets.filter((a) => a.isCompanion !== true
    && a.visible !== false
    && a.landAllocation?.parcelId === parcelId);
  if (sharers.length === 1 && sharers[0].id === asset.id) {
    return { sqm: Math.max(0, parcel.area), source: 'whole_plot' };
  }
  return { sqm: 0, source: 'unset' };
}

/**
 * THE LAND AN ASSET DRAWS BEFORE ANY RETAIL CARVE-OUT.
 *
 * Split out on 2026-09-09 (consolidation step 5) so the carve has something to
 * take a share OF without calling back into the function that applies it. The
 * body below is unchanged; every rule, comment and precedence is the one that
 * was there.
 */
function computeAssetLandSqmGross(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  // T2P2 Fix 1 (2026-05-12): data-ownership rewrite per
  // Tab2_Pass2_Data_Rules.md. Resolution order matches the user's
  // pseudocode exactly so the function is predictable across every
  // call site (Land Recon table, cost engine, area metrics):
  //
  //   Rule 2  -> companion has NO land. Return 0 first.
  //   M2.0f   -> multiParcelSplits explicit. Return their sum.
  //   Rule 1  -> explicit sqm wins when > 0.
  //   Rule 4b -> no parcels in phase. Return 0.
  //   Crit    -> no non-companion assets in phase. Return 0.
  //   Rule 1.b-> explicit percent wins when > 0 (proportional to gross).
  //   Rule 2  -> autoByBua bua-share when totalBua > 0.
  //   Rule 3  -> equal-share fallback when totalBua = 0.
  //
  // Each gate is an early return so the function reads top-to-bottom
  // in priority order. Sqm/percent modes with 0 explicit input fall
  // through to autoByBua so brand-new projects (default autoByBua mode
  // OR sqm-mode with no input) show a meaningful per-asset value.
  // This preserves the Pass 1 Fix 1 behaviour the user explicitly
  // asked for (no more "Sqm Allocated: 0" rows when the user has not
  // typed explicit values yet) while making the data ownership
  // boundaries crisp.
  //
  // Rule 2: companion has no land.
  if (asset.isCompanion === true) return 0;
  // M2.0f Fix 2: multi-parcel splits are explicit allocations.
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    return splits.reduce((s, sp) => s + Math.max(0, sp.sqm), 0);
  }
  // Rule 1: the plot draw, when the asset names a real plot. Typed wins, a
  // sole occupant takes the whole plot, and anything else is 0 with the plot
  // check reporting the gap. Authoritative: falling through to a phase-wide
  // share from here is what used to disagree with the breakdown.
  if (mode === 'sqm') {
    const draw = resolveAssetPlotDraw(asset, parcels, assets);
    if (draw) return draw.sqm;
  }
  const explicitSqm = asset.landAllocation?.sqm ?? asset.landAreaSqm ?? 0;
  if (mode === 'sqm' && explicitSqm > 0) {
    return Math.max(0, explicitSqm);
  }
  // Rule 4b: no parcels in this asset's phase = no land.
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  if (phaseParcels.length === 0) return 0;
  const agg = computeLandAggregate(phaseParcels);
  if (agg.totalAreaSqm <= 0) return 0;
  // Rule 1.b: explicit percent wins (proportional to phase parcel gross).
  const explicitPct = asset.landAllocation?.pct ?? asset.landAreaPct ?? 0;
  if (mode === 'percent' && explicitPct > 0) {
    return agg.totalAreaSqm * (Math.max(0, explicitPct) / 100);
  }
  // Crit: phase with NO non-companion assets has NO allocation. Should
  // never happen for a non-companion asset (the asset itself is in the
  // list) but defensive.
  const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId && a.isCompanion !== true);
  if (phaseAssets.length === 0) return 0;
  // Rule 2 + 3: autoByBua bua-share, or equal-share fallback when
  // totalBua = 0. phaseLandSqm uses gross parcel area; NDA reduces
  // the developable read elsewhere (recon table) but cost basis and
  // bua-share denominator stay on gross so Land (Cash) + Land
  // (In-Kind) cost lines render correctly.
  const phaseLandSqm = agg.totalAreaSqm;
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  if (totalBua <= 0) {
    return phaseLandSqm / phaseAssets.length;
  }
  const myBua = computeAssetBua(asset, subUnits);
  return phaseLandSqm * (myBua / totalBua);
}

// M2.0f Fix 2: per-asset land breakdown for cost engine + UI display.
// Returns the resolved land area + value plus an optional per-parcel
// breakdown when multiParcelSplits is in use. The resolved rate is the
// value-weighted average across the slices, useful for the asset card
// summary line.
export interface AssetLandBreakdown {
  landSqm: number;
  landValue: number;
  rate: number;
  splits: { parcelId: string; sqm: number; rate: number; value: number }[];
  /**
   * WHY THE RATE IS ZERO, when it is (2026-08-17).
   *
   * A land rate of zero is indistinguishable from a land rate the user has not
   * typed yet, and until this field existed the difference was invisible
   * everywhere: a parcel reference that matched nothing resolved to rate 0,
   * value 0, and no banner, no check and no cell said so. That is the third
   * silent zero of this family (after the allocation-share zero of 2026-08-15
   * and the `Number(null)` discount zero of 2026-08-09), so the reason is now
   * part of the return value rather than something a caller could forget to
   * work out.
   *
   * Absent means the rate resolved from something real, including a genuine
   * zero the user typed on a parcel (that is `zero_parcel_rate`, which is
   * reported too: it is a real answer, but a reader still deserves to know the
   * cost is zero because the rate is).
   */
  rateIssue?: LandRateIssue;
}

/** Machine-readable reasons a resolved land rate is zero. */
export type LandRateIssue =
  /** The asset points at a parcel id that exists nowhere in the project. */
  | 'parcel_missing'
  /** The parcel resolved, but its rate is zero. */
  | 'zero_parcel_rate'
  /** Weighted average selected, but the scope it averages over holds no parcels. */
  | 'no_parcels_in_scope'
  /** Custom rate selected and left at zero. */
  | 'zero_custom_rate';

/** One sentence, for a UI that must explain the zero it is showing. Shared so
 *  the asset card, the reconciliation block and the verifier all say the same
 *  thing. */
export function landRateIssueText(issue: LandRateIssue): string {
  switch (issue) {
    case 'parcel_missing':
      return 'This asset points at a land parcel that no longer exists, so its land cost is zero. Pick a parcel.';
    case 'zero_parcel_rate':
      return 'The selected parcel has a rate of 0, so this asset carries no land cost.';
    case 'no_parcels_in_scope':
      return 'Weighted average over a scope that contains no parcels, so the rate is zero. Pick a parcel, or the all-parcels weighted average.';
    case 'zero_custom_rate':
      return 'Custom rate is 0, so this asset carries no land cost.';
  }
}

/**
 * The land breakdown BEFORE any retail carve-out, for the same reason as
 * computeAssetLandSqmGross above. Body unchanged.
 */
function computeAssetLandBreakdownGross(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): AssetLandBreakdown {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);

  // A PARCEL IS PROJECT-WIDE, NOT PHASE-WIDE (2026-08-17).
  //
  // An explicit parcel reference now resolves against EVERY parcel in the
  // project. Land is bought once and built on over several phases, which is the
  // ordinary case, and scoping the lookup to the asset's own phase made a Phase
  // 2 asset resolve to `undefined` -> rate 0 -> land value 0, silently. It was
  // reachable by doing nothing at all: the asset factory seeds
  // `landAllocation.parcelId` from `phaseParcels[0] ?? parcels[0]`, and that
  // fallback crosses phases, so a Phase 2 asset was BORN holding a reference
  // this lookup could not resolve.
  //
  // Only the EXPLICIT lookup widens. The implicit allocation rules
  // (autoByBua / percent / equal share) keep their phase scoping, so no model
  // that was resolving correctly moves.
  const findParcel = (id: string): Parcel | undefined => parcels.find((p) => p.id === id);

  // Branch 1: explicit multi-parcel splits.
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    let missing = false;
    const resolved = splits.map((sp) => {
      const parcel = findParcel(sp.parcelId);
      if (!parcel) missing = true;
      const sqm = Math.max(0, sp.sqm);
      const rate = parcel ? Math.max(0, parcel.rate) : 0;
      return { parcelId: sp.parcelId, sqm, rate, value: sqm * rate };
    });
    const landSqm = resolved.reduce((s, r) => s + r.sqm, 0);
    const landValue = resolved.reduce((s, r) => s + r.value, 0);
    const rate = landSqm > 0 ? landValue / landSqm : 0;
    const rateIssue: LandRateIssue | undefined = missing
      ? 'parcel_missing'
      : (rate <= 0 && landSqm > 0 ? 'zero_parcel_rate' : undefined);
    return { landSqm, landValue, rate, splits: resolved, rateIssue };
  }

  const singleParcelId = asset.landAllocation?.parcelId;
  const sqm = Math.max(0, asset.landAllocation?.sqm ?? asset.landAreaSqm ?? 0);

  // M2.0g Fix 2: explicit custom rate sentinel.
  if (mode === 'sqm' && singleParcelId === PARCEL_CUSTOM_RATE) {
    const rate = Math.max(0, asset.landAllocation?.customRate ?? 0);
    const value = sqm * rate;
    return { landSqm: sqm, landValue: value, rate, splits: [], rateIssue: rate > 0 ? undefined : 'zero_custom_rate' };
  }

  // M2.0g Fix 2: explicit weighted-average sentinel (mode A), scoped to the
  // asset's own phase. 2026-08-17: `PARCEL_WEIGHTED_AVG_ALL` is the same thing
  // over every parcel in the project, which is the only weighted answer a phase
  // holding no parcels of its own can give.
  if (mode === 'sqm' && (singleParcelId === PARCEL_WEIGHTED_AVG || singleParcelId === PARCEL_WEIGHTED_AVG_ALL)) {
    const scope = singleParcelId === PARCEL_WEIGHTED_AVG_ALL ? parcels : phaseParcels;
    const agg = computeLandAggregate(scope);
    const rate = agg.weightedRate;
    const value = sqm * rate;
    const rateIssue: LandRateIssue | undefined = rate > 0
      ? undefined
      : (agg.totalAreaSqm > 0 ? 'zero_parcel_rate' : 'no_parcels_in_scope');
    return { landSqm: sqm, landValue: value, rate, splits: [], rateIssue };
  }

  // Branch 2: single explicit parcel (mode A only). The sqm comes from the ONE
  // plot-draw rule, so this and computeAssetLandSqm cannot give two answers.
  if (mode === 'sqm' && singleParcelId) {
    const parcel = findParcel(singleParcelId);
    const rate = parcel ? Math.max(0, parcel.rate) : 0;
    const draw = resolveAssetPlotDraw(asset, parcels, assets);
    const drawSqm = draw ? draw.sqm : sqm;
    const value = drawSqm * rate;
    return {
      landSqm: drawSqm,
      landValue: value,
      rate,
      splits: [{ parcelId: singleParcelId, sqm: drawSqm, rate, value }],
      rateIssue: parcel ? (rate > 0 ? undefined : 'zero_parcel_rate') : 'parcel_missing',
    };
  }

  // Branch 3: legacy / mode B / mode C - phase aggregate weighted average.
  const agg = computeLandAggregate(phaseParcels);
  const landSqm = computeAssetLandSqmGross(asset, parcels, assets, subUnits, mode);
  if (agg.totalAreaSqm <= 0 || landSqm <= 0) {
    // A zero here is only worth explaining when the asset HAS land to value.
    return {
      landSqm, landValue: 0, rate: 0, splits: [],
      rateIssue: landSqm > 0 ? 'no_parcels_in_scope' : undefined,
    };
  }
  // Value share = landSqm / total, applied to total value.
  const valueShare = agg.totalAreaSqm > 0 ? landSqm / agg.totalAreaSqm : 0;
  const landValue = agg.totalValue * valueShare;
  const rate = landSqm > 0 ? landValue / landSqm : 0;
  return { landSqm, landValue, rate, splits: [], rateIssue: rate > 0 ? undefined : 'zero_parcel_rate' };
}

// ── THE RETAIL LAND CARVE-OUT (2026-09-09, consolidation step 5) ──────────
//
// The retail companion holds floor area that sits ON its hosts' land, so it
// takes a share of that land and every host loses EXACTLY what it gains. The
// arithmetic is ONE function in `retailCompanion.ts` which returns both halves
// together; these two wrappers are the only places it reaches the engine, and
// each of them reads one side of the same result.
//
// THIS IS THE FIRST STEP THAT MOVES MONEY. A host's land value falls and the
// companion's rises by the same amount, at the same plot's own rate, so the
// project land total is unchanged by construction. That is exactly why the
// reconciliation cannot live on a total: a total that still foots while two
// assets are wrong is the failure this is shaped to prevent, so the per-asset
// comparison is a verifier's job.

/** Every retail companion, indexed by the hosts it carves from. */
function retailCarveContext(
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
  companion: Asset,
): RetailLandCarve {
  const hostIds = new Set(companion.retailHostAssetIds ?? []);
  const hosts = assets.filter((a) => hostIds.has(a.id)).map((h) => {
    const grossSqm = computeAssetLandSqmGross(h, parcels, assets, subUnits, mode);
    // THE SHARE COMES FROM THE CHAIN, not from a formula restated here, so
    // "what is retail GFA" has one definition. Only the massing inputs matter
    // for the two figures it needs, so the standards are deliberately empty.
    const chain = computeLandChain(grossSqm, h.landChain, {}, undefined);
    const named = h.landAllocation?.parcelId;
    const parcel = named && !isParcelSentinel(named) ? parcels.find((p) => p.id === named) : undefined;
    return {
      assetId: h.id,
      parcelId: parcel?.id,
      grossSqm,
      rate: parcel ? Math.max(0, parcel.rate) : 0,
      retailGfaSqm: chain.retailGfaSqm,
      totalGfaSqm: chain.totalGfaSqm,
    };
  });
  return carveRetailLand(hosts);
}

/** What THIS host gives up, or undefined when it hosts no retail companion. */
function retailCarveForHost(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): RetailLandHostResult | undefined {
  if (asset.isCompanion === true) return undefined;
  for (const c of assets) {
    if (!isRetailCompanion(c)) continue;
    if (!(c.retailHostAssetIds ?? []).includes(asset.id)) continue;
    const carve = retailCarveContext(parcels, assets, subUnits, mode, c);
    return carve.hosts.find((h) => h.assetId === asset.id);
  }
  return undefined;
}

export function computeAssetLandSqm(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  // A RETAIL COMPANION IS THE ONE COMPANION WITH LAND, and only what its hosts
  // gave up. Rule 2 still holds for every other companion.
  if (isRetailCompanion(asset)) {
    return retailCarveContext(parcels, assets, subUnits, mode, asset).companionSqm;
  }
  const gross = computeAssetLandSqmGross(asset, parcels, assets, subUnits, mode);
  const carved = retailCarveForHost(asset, parcels, assets, subUnits, mode);
  return carved ? Math.max(0, gross - carved.carvedSqm) : gross;
}

export function computeAssetLandBreakdown(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): AssetLandBreakdown {
  if (isRetailCompanion(asset)) {
    const carve = retailCarveContext(parcels, assets, subUnits, mode, asset);
    const landSqm = carve.companionSqm;
    const landValue = carve.companionValue;
    return {
      landSqm,
      landValue,
      // A BLENDED RATE, value over area, never an average of the plots' rates:
      // the same rule the line's own land pooling uses.
      rate: landSqm > 0 ? landValue / landSqm : 0,
      splits: carve.companionSplits,
      rateIssue: landSqm > 0 && landValue <= 0 ? 'zero_parcel_rate' : undefined,
    };
  }
  const gross = computeAssetLandBreakdownGross(asset, parcels, assets, subUnits, mode);
  const carved = retailCarveForHost(asset, parcels, assets, subUnits, mode);
  if (!carved || carved.carvedSqm <= 0) return gross;
  // THE HOST LOSES EXACTLY WHAT THE COMPANION GAINED, at the same plot's own
  // rate, so the two subtractions above and here are one arithmetic and the
  // project total cannot drift.
  const landSqm = Math.max(0, gross.landSqm - carved.carvedSqm);
  const landValue = Math.max(0, gross.landValue - carved.carvedValue);
  return {
    ...gross,
    landSqm,
    landValue,
    rate: landSqm > 0 ? landValue / landSqm : gross.rate,
    splits: gross.splits.map((sp) => {
      const share = gross.landSqm > 0 ? sp.sqm / gross.landSqm : 0;
      const sqm = Math.max(0, sp.sqm - carved.carvedSqm * share);
      return { ...sp, sqm, value: sqm * sp.rate };
    }),
  };
}


// M2.0g Fix 2 (2026-05-06): project-level land reconciliation. Renders
// at top of Tab 2 above the asset list.
export interface LandReconciliation {
  parcelsTotalSqm: number;
  parcelsTotalValue: number;
  assetsAllocatedSqm: number;
  assetsAllocatedValue: number;
  matches: boolean;
  shortBy: number; // positive when assets allocated less than parcels total
  overBy: number;  // positive when assets allocated more than parcels total
}

export function computeLandReconciliation(
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): LandReconciliation {
  const parcelsTotalSqm = parcels.reduce((s, p) => s + Math.max(0, p.area), 0);
  const parcelsTotalValue = parcels.reduce((s, p) => s + Math.max(0, p.area) * Math.max(0, p.rate), 0);
  let assetsAllocatedSqm = 0;
  let assetsAllocatedValue = 0;
  for (const a of assets) {
    if (!a.visible) continue;
    const breakdown = computeAssetLandBreakdown(a, parcels, assets, subUnits, mode);
    assetsAllocatedSqm += breakdown.landSqm;
    assetsAllocatedValue += breakdown.landValue;
  }
  const diffSqm = assetsAllocatedSqm - parcelsTotalSqm;
  const matches = Math.abs(diffSqm) < 0.5;
  return {
    parcelsTotalSqm,
    parcelsTotalValue,
    assetsAllocatedSqm,
    assetsAllocatedValue,
    matches,
    shortBy: diffSqm < -0.5 ? Math.abs(diffSqm) : 0,
    overBy:  diffSqm >  0.5 ? diffSqm           : 0,
  };
}

export function computeAssetLandCost(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  return computeAssetLandBreakdown(asset, parcels, assets, subUnits, mode).landValue;
}

// M2.0f Fix 2: asset land allocation total exceeds available parcel
// area? Returns the over-/under-allocation summary used for UI
// validation banners. Only counts assets whose allocation exists
// (multiParcelSplits, parcelId+sqm, or legacy landAreaSqm in mode A).
export interface LandAllocationValidation {
  parcelTotalSqm: number;
  allocatedSqm: number;
  unallocatedSqm: number;     // parcelTotal - allocated (positive = under)
  overAllocatedSqm: number;   // allocated - parcelTotal (positive = over)
  status: 'ok' | 'under' | 'over';
}

export function validateLandAllocation(
  parcels: Parcel[],
  assets: Asset[],
  mode: LandAllocationMode,
): LandAllocationValidation {
  const parcelTotalSqm = parcels.reduce((s, p) => s + Math.max(0, p.area), 0);
  let allocatedSqm = 0;
  for (const a of assets) {
    if (!a.visible) continue;
    const splits = a.landAllocation?.multiParcelSplits;
    if (splits && splits.length > 0) {
      allocatedSqm += splits.reduce((s, sp) => s + Math.max(0, sp.sqm), 0);
      continue;
    }
    if (mode === 'sqm') {
      const sqm = a.landAllocation?.sqm ?? a.landAreaSqm ?? 0;
      allocatedSqm += Math.max(0, sqm);
    }
  }
  const overAllocatedSqm = Math.max(0, allocatedSqm - parcelTotalSqm);
  const unallocatedSqm = Math.max(0, parcelTotalSqm - allocatedSqm);
  const status: LandAllocationValidation['status'] =
    overAllocatedSqm > 0.5 ? 'over' : unallocatedSqm > 0.5 ? 'under' : 'ok';
  return { parcelTotalSqm, allocatedSqm, unallocatedSqm, overAllocatedSqm, status };
}

// ── Asset area metrics ─────────────────────────────────────────────────────
// Resolves the area / value bases that the calc methods need for a single
// asset. Replaces the pre-M2.0 AreaMetrics interface.
// M2.0L Pass2 Fix 4 (2026-05-11): aggregate per-asset metrics across
// a phase. Used by Same-mode rendering to show the master cost table
// caption with summed multipliers (e.g. "x 280,000 sqm BUA aggregated"
// instead of one asset's slice).
export function aggregatePhaseMetrics(
  phaseAssets: Asset[],
  metricsByAsset: Map<string, AssetAreaMetrics>,
): AssetAreaMetrics {
  const agg: AssetAreaMetrics = {
    landSqm: 0, ndaSqm: 0, roadsSqm: 0,
    gfa: 0, bua: 0, nsa: 0,
    unitCount: 0, parkingBays: 0,
    supportArea: 0, parkingArea: 0,
    netDevelopableArea: 0, footprintArea: 0, landscapeArea: 0,
    mainAssetGfa: 0, retailParkingArea: 0, retailGfa: 0,
    landValue: 0, cashLandValue: 0, inKindLandValue: 0,
    totalRevenue: 0,
  };
  for (const a of phaseAssets) {
    const m = metricsByAsset.get(a.id);
    if (!m) continue;
    agg.landSqm += m.landSqm;
    agg.ndaSqm += m.ndaSqm;
    agg.roadsSqm += m.roadsSqm;
    agg.gfa += m.gfa;
    agg.bua += m.bua;
    agg.nsa += m.nsa;
    agg.unitCount += m.unitCount;
    agg.parkingBays += m.parkingBays;
    agg.supportArea += m.supportArea;
    agg.parkingArea += m.parkingArea;
    agg.netDevelopableArea += m.netDevelopableArea;
    agg.footprintArea += m.footprintArea;
    agg.landscapeArea += m.landscapeArea;
    agg.mainAssetGfa += m.mainAssetGfa;
    agg.retailParkingArea += m.retailParkingArea;
    agg.retailGfa += m.retailGfa;
    agg.landValue += m.landValue;
    agg.cashLandValue += m.cashLandValue;
    agg.inKindLandValue += m.inKindLandValue;
    agg.totalRevenue += m.totalRevenue;
  }
  return agg;
}

export interface AssetAreaMetrics {
  landSqm: number;
  ndaSqm: number;              // M2.0h Fix 4: parcel-level NDA aware
  roadsSqm: number;
  // M2.0h Fix 3: three-tier hierarchy. NSA ⊂ BUA ⊂ GFA where
  //   nsa = sub-units (Sellable + Operable + Leasable)
  //   bua = nsa + Support (sub-unit Support + asset.supportArea)
  //   gfa = bua + Parking (asset.parkingArea)
  gfa: number;
  bua: number;
  nsa: number;
  unitCount: number;
  parkingBays: number;         // M2.0d: drives rate_per_parking_bay
  // M2.0g Fix 4 additions: kept for cost methods that target a specific
  // tier (rate_x_support_area / rate_x_parking_area).
  supportArea: number;         // the chain's service area, else sub-unit Support + asset.supportArea
  parkingArea: number;         // MAIN parking: the chain's, else typed; ZERO on a retail companion
  // 2026-09-12: two more of the tab's columns, each charged by one method.
  mainAssetGfa: number;        // the chain's main asset GFA; nothing typed stands in for it
  retailParkingArea: number;   // the retail COMPANION's parking; ZERO on a host, whose strip carries it
  retailGfa: number;           // the retail COMPANION's ground-floor GFA, the floor area it was built with; ZERO on a host
  // 2026-09-10: the three the chain alone produces. Zero when it derived none
  // (or the project has not opted in), so their methods charge nothing rather
  // than guessing.
  netDevelopableArea: number;
  footprintArea: number;
  landscapeArea: number;
  landValue: number;
  cashLandValue: number;
  inKindLandValue: number;
  // T3-edit-runtime v7 (2026-05-13): asset revenue (sum of metricValue
  // x unitPrice across Sellable / Operable / Leasable sub-units).
  // Powers the commission cost methods until M2.1 ships proper period-
  // by-period revenue arrays.
  totalRevenue: number;
}

// M2.0g Fix 4 (2026-05-06): asset BUA + sub-unit reconciliation.
// Sub-units describe REVENUE-generating units; Support + Parking are
// asset-level inputs. The reconciliation block contrasts the user-
// entered asset.buaTotal against (sub-units + support + parking) so
// the user can verify their inputs without double-entry pressure.
export interface AssetAreaTotals {
  buaTotal: number;            // resolved BUA (asset.buaTotal if set, else derived)
  sellableBua: number;         // sub-units category=Sellable
  operableBua: number;         // sub-units category=Operable
  leasableBua: number;         // sub-units category=Leasable
  subUnitsRevenue: number;     // sellable + operable + leasable
  subUnitsSupport: number;     // sub-units category=Support
  supportArea: number;         // asset.supportArea
  parkingArea: number;         // asset.parkingArea
  derivedTotal: number;        // subUnitsRevenue + subUnitsSupport + supportArea + parkingArea
  enteredTotal: number;        // asset.buaTotal (0 if not set)
  matches: boolean;            // |derived - entered| < 1 sqm OR enteredTotal === 0
  mismatchSqm: number;         // entered - derived
}

export function computeAssetAreaTotals(asset: Asset, subUnits: SubUnit[]): AssetAreaTotals {
  const my = subUnits.filter((u) => u.assetId === asset.id);
  const sellableBua = my.filter((u) => u.category === 'Sellable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const operableBua = my.filter((u) => u.category === 'Operable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const leasableBua = my.filter((u) => u.category === 'Leasable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const subUnitsSupport = my.filter((u) => u.category === 'Support').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const subUnitsRevenue = sellableBua + operableBua + leasableBua;
  const supportArea = Math.max(0, asset.supportArea ?? 0);
  const parkingArea = resolveAssetParkingArea(asset);
  const derivedTotal = subUnitsRevenue + subUnitsSupport + supportArea + parkingArea;
  const enteredTotal = Math.max(0, asset.buaTotal ?? 0);
  // Resolved BUA: explicit asset.buaTotal wins; otherwise derived sum.
  const buaTotal = enteredTotal > 0 ? enteredTotal : derivedTotal;
  const mismatchSqm = enteredTotal > 0 ? enteredTotal - derivedTotal : 0;
  const matches = enteredTotal === 0 || Math.abs(mismatchSqm) < 1;
  return {
    buaTotal,
    sellableBua,
    operableBua,
    leasableBua,
    subUnitsRevenue,
    subUnitsSupport,
    supportArea,
    parkingArea,
    derivedTotal,
    enteredTotal,
    matches,
    mismatchSqm,
  };
}

// ── M2.0h Fix 3: three-tier area hierarchy ─────────────────────────────────
// Real estate convention from Ahmad's M2.0h brief:
//   NSA (Net Sellable) ⊂ BUA (Built-Up) ⊂ GFA (Gross Floor)
//   NSA = sum of revenue sub-units (Sellable + Operable + Leasable)
//   BUA = NSA + Support (sub-unit Support + asset.supportArea)
//   GFA = BUA + Parking (asset.parkingArea)
//
// This supersedes the M2.0g convention where BUA included Parking;
// from v8 onward Parking is GFA-only. computeAssetAreaTotals.buaTotal
// (which also included Parking) is preserved for the M2.0g
// reconciliation block but new hierarchy callers should consume
// computeAssetAreaHierarchy.
export interface AssetAreaHierarchy {
  nsa: number;
  bua: number;
  gfa: number;
  breakdown: {
    sellableArea: number;
    operableArea: number;
    leasableArea: number;
    supportArea: number;   // sub-unit Support + asset.supportArea
    parkingArea: number;   // asset.parkingArea
  };
}

export function computeAssetAreaHierarchy(asset: Asset, subUnits: SubUnit[]): AssetAreaHierarchy {
  const my = subUnits.filter((u) => u.assetId === asset.id);
  const sellableArea = my.filter((u) => u.category === 'Sellable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const operableArea = my.filter((u) => u.category === 'Operable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const leasableArea = my.filter((u) => u.category === 'Leasable').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const subUnitSupport = my.filter((u) => u.category === 'Support').reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const supportArea = subUnitSupport + Math.max(0, asset.supportArea ?? 0);
  const parkingArea = resolveAssetParkingArea(asset);
  const nsa = sellableArea + operableArea + leasableArea;
  const bua = nsa + supportArea;
  const gfa = bua + parkingArea;
  return {
    nsa,
    bua,
    gfa,
    breakdown: { sellableArea, operableArea, leasableArea, supportArea, parkingArea },
  };
}

// ── M2.0h Fix 4: parcel NDA derivation ─────────────────────────────────────
// When the parcel has hasNdaDeduction === true, NDA = area × (1 - roads%
// - parks%); otherwise NDA = area. effectiveNdaRate = totalCost / NDA so
// the full parcel cost flows to assets even when NDA < area (the per-sqm
// rate that multiplies against the developable area is inflated).
export interface ParcelNda {
  area: number;
  roadsArea: number;
  parksArea: number;
  nda: number;
  totalCost: number;
  effectiveNdaRate: number;
}

/**
 * THE ROADS AND PARKS DEDUCTION IS RETIRED (2026-09-08, founder's decision).
 *
 * It carved roads and parks out of gross land to give a developable area. That
 * is LAND development; this platform models VERTICAL development, and the area
 * chain's Land Utilisation % now states the same thing at asset level. Two
 * controls answering "how much of this land is developable" on one screen is
 * one rule in two places, which is the shape of most defects in this codebase.
 *
 * The deduction is removed rather than defaulted, so a parcel's developable
 * area IS its area. Parcel.hasNdaDeduction, roadsPct and parksPct stay on
 * the type as deprecated and are no longer read: dropping stored fields would
 * rewrite history, and every live version carries them as absent or zero.
 *
 * PROVED INERT BEFORE REMOVAL: 1,008 versions across all 6 projects scanned;
 * no parcel or asset anywhere sets a non-zero roads or parks share, and the one
 * project with the toggle on (archived) has both percentages at 0. So NDA
 * already equalled gross land everywhere and this changes no number.
 */
export function computeParcelNda(parcel: Parcel): ParcelNda {
  const area = Math.max(0, parcel.area);
  const rate = Math.max(0, parcel.rate);
  return {
    area,
    roadsArea: 0,
    parksArea: 0,
    nda: area,
    totalCost: area * rate,
    effectiveNdaRate: rate,
  };
}

export function resolveAssetAreaMetrics(
  asset: Asset,
  project: Project,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): AssetAreaMetrics {
  // M2.0f Fix 2: when explicit per-parcel splits are present, cash /
  // in-kind splits track each source parcel's own cashPct / inKindPct;
  // otherwise the legacy phase-level value share applies.
  const breakdown = computeAssetLandBreakdown(asset, parcels, assets, subUnits, mode);
  const landSqm = breakdown.landSqm;
  const landValue = breakdown.landValue;
  // NET DEVELOPABLE AREA IS GROSS LAND. The roads and parks deduction that
  // used to reduce it is retired (see computeParcelNda above), so the four
  // precedence branches that used to live here (project toggle, per-parcel
  // toggle across splits, single parcel, and a fallback that applied
  // projectRoadsPct even with the toggle OFF while silently ignoring parks)
  // collapse to one statement. Nothing is left to disagree with.
  const ndaSqm = landSqm;
  const roadsSqm = 0;
  // Still needed below by the cash / in-kind split, which was reading a
  // binding the retired NDA block happened to declare.
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);

  // M2.0h Fix 3 (2026-05-07): BUA / NSA / GFA from the three-tier
  // hierarchy. NSA = revenue sub-units only; BUA = NSA + Support;
  // GFA = BUA + Parking. Replaces the M2.0g convention where BUA
  // included Parking. asset.gfaSqm input still wins when > 0; when
  // blank, GFA derives from the hierarchy.
  // M2.0L Fix 4 (2026-05-11) + Pass 3 widening (2026-05-11): area
  // metrics ALWAYS fall back to the asset-level legacy inputs when the
  // sub-unit-derived value is zero, regardless of whether sub-units
  // exist. Reason: users frequently add a stub sub-unit (placeholder
  // row from "Add sub-unit") and forget to fill unitArea / count,
  // leaving hierarchy.bua = 0 while asset.buaSqm carries the real
  // entered area. The narrow Pass 2 fallback only fired when the asset
  // had ZERO sub-units, which left these stubbed projects with x 0
  // multipliers across every rate_per_X cost line.
  const hierarchy = computeAssetAreaHierarchy(asset, subUnits);
  // P11 Fix 10 (2026-05-13): universal area-picking rule. Previously
  //   bua = hierarchy.bua > 0 ? hierarchy.bua : asset.buaSqm
  // which let a partially-filled sub-unit table (e.g. one Sellable row
  // with metric='units' + metricValue=100 but unitArea blank, yielding
  // a TINY non-zero hierarchy.bua) drown out the real value the user
  // had typed into the asset-level buaSqm field. Different phases
  // exhibited the discrepancy depending on whether the user filled
  // sub-units or the asset-level inputs first.
  //
  // Universal rule: pick whichever input carries the meaningful value
  // (Math.max). If only sub-units are filled, hierarchy wins. If only
  // the asset-level input is filled, asset wins. If both, the larger
  // wins (sub-unit total typically dominates once rows are complete).
  // GFA cascades through bua so it never reads smaller than BUA.
  /**
   * THE ASSETS TAB IS THE ONE SOURCE OF AREA (2026-09-12). Where the chain
   * derived a figure, that figure is priced; where it derived nothing (an
   * asset with no chain inputs, which is every asset on one live project),
   * the sub-units and typed fields stand exactly as they did. So a hand-typed
   * parking area no longer outranks the chain, and a project with no chain is
   * untouched.
   *
   * NSA IS THE SUB-UNITS' (table 5), not the chain's. The store keeps a
   * line's sub-unit areas equal to the line's NSA through their shares, so the
   * sub-units ARE the NSA statement, and pricing the chain's own figure here
   * would be a second copy of the same number one edit away from disagreeing.
   *
   * EACH FIGURE IS CHARGED ONCE ACROSS A HOST AND ITS RETAIL STRIP. The
   * host's Total GFA excludes the retail GFA its companion carries, and its
   * parking excludes the retail parking its companion carries, exactly as the
   * land carve already splits the plot. A companion has no chain of its own;
   * it reads the retail figures the factory stamped onto it.
   */
  const d = asset.derivedAreas;
  const companion = isRetailCompanion(asset);
  const has = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  const nsa = Math.max(hierarchy.nsa, Math.max(0, asset.sellableBuaSqm ?? 0));
  const supportArea = has(d?.serviceAreaSqm) ? d.serviceAreaSqm : hierarchy.breakdown.supportArea;
  // Main parking: the chain's, else typed; a strip's parking is retail parking.
  const mainParking = companion ? 0 : (has(d?.parkingAreaSqm) ? d.parkingAreaSqm : resolveAssetParkingArea(asset));
  // Retail parking: the strip's stamped figure. A host reads 0: its strip carries it.
  const retailParkingArea = companion ? resolveAssetParkingArea(asset) : 0;
  // Total GFA (platform bua): the chain's less the retail its strip carries, else the hierarchy.
  const bua = has(d?.totalGfaSqm)
    ? Math.max(0, d.totalGfaSqm - (has(d?.retailGfaSqm) ? d.retailGfaSqm : 0))
    : Math.max(hierarchy.bua, Math.max(0, asset.buaSqm ?? 0));
  // Total BUA (platform gfa): that plus the parking this asset itself carries.
  const gfa = has(d?.totalGfaSqm)
    ? bua + mainParking + retailParkingArea
    : Math.max(hierarchy.gfa, Math.max(0, asset.gfaSqm ?? 0), bua);
  const mainAssetGfa = companion ? 0 : (has(d?.mainAssetGfaSqm) ? d.mainAssetGfaSqm : 0);
  // Retail GFA: the strip's own floor area, which is the pooled retail GFA the
  // factory built it with (its Total GFA and its Retail GFA are ONE figure). A
  // host reads 0: its strip carries the retail, exactly as with parking.
  const retailGfa = companion ? bua : 0;
  const unitCount = computeAssetUnitCount(asset, subUnits);

  // T3-edit-runtime v7 (2026-05-13): per-asset cash / in-kind split.
  // When the asset has explicit multi-parcel splits, each slice picks
  // up its parcel's specific cashPct / inKindPct (preserves the
  // per-parcel intent). Otherwise (autoByBua + single-parcel modes
  // without explicit splits), use the PROJECT-WIDE weighted-avg
  // cashPct so an asset in a phase whose parcels have cashPct=0 still
  // surfaces a cash share via the project blend. Matches user spec:
  // "Cash Value = Land Value x weighted-avg cashPct / 100".
  let cashLandValue = 0;
  let inKindLandValue = 0;
  if (breakdown.splits.length > 0 && breakdown.splits.some((s) => phaseParcels.find((p) => p.id === s.parcelId))) {
    for (const split of breakdown.splits) {
      const parcel = phaseParcels.find((p) => p.id === split.parcelId);
      if (!parcel) continue;
      cashLandValue += split.value * (Math.max(0, parcel.cashPct) / 100);
      inKindLandValue += split.value * (Math.max(0, parcel.inKindPct) / 100);
    }
  } else {
    const projAgg = computeLandAggregate(parcels);
    const cashShare = projAgg.totalValue > 0 ? projAgg.cashValue / projAgg.totalValue : 0;
    const inKindShare = projAgg.totalValue > 0 ? projAgg.inKindValue / projAgg.totalValue : 0;
    cashLandValue = landValue * cashShare;
    inKindLandValue = landValue * inKindShare;
  }

  return {
    landSqm,
    ndaSqm,
    roadsSqm,
    netDevelopableArea: resolveAssetNetDevelopableArea(asset),
    footprintArea: resolveAssetFootprintArea(asset),
    landscapeArea: resolveAssetLandscapeArea(asset),
    gfa,
    bua,
    nsa,
    unitCount,
    parkingBays: companion ? 0 : (has(d?.parkingBays) ? d.parkingBays : resolveAssetParkingBays(asset)),
    supportArea,
    parkingArea: mainParking,
    mainAssetGfa,
    retailParkingArea,
    retailGfa,
    landValue,
    cashLandValue,
    inKindLandValue,
    totalRevenue: computeAssetRevenue(asset, subUnits),
  };
}

// ── Cost item total (per asset) ────────────────────────────────────────────
// ctx.assetMetrics + ctx.allLines lets the function resolve direct + % methods
// in one place. Returns currency total for the line as it applies to this
// asset (after override resolution by the caller).
export interface AssetCostContext {
  asset: Asset;
  metrics: AssetAreaMetrics;
  // M2.0g Fix 4: sub-units list so 'rate_x_specific_subunit' can look
  // up the area of a specific sub-unit by id.
  subUnits?: SubUnit[];
  // All cost lines for this phase (post-override per-asset). Used by
  // percent_of_selected / percent_of_construction / etc. The caller must
  // pre-resolve the per-asset values for each line so percent methods
  // can refer back to them without recursion.
  resolvedDirectLineTotals: Record<string, number>;
  /**
   * THE REVENUE SNAPSHOT (2026-08-19, Pass C). ONE input, not three derived
   * numbers, and that is what makes a percent-of-revenue base impossible to
   * forget: a call site either has revenue in scope or it does not, with no set
   * of individually-omittable figures to get half right.
   *
   * It replaced `collectionsTotal`, `saleRevenueTotal` and `totalRevenueTotal`,
   * which existed for one day, during which five of eleven call sites passed
   * them and six did not, so the financing aggregate and the per-asset Cash
   * Flow reported capex figures 497,134.24 apart on a live project.
   *
   * The bases are resolved by `revenue/sellingCosts.ts`, which is also what the
   * Module 2 Revenue display calls, so the screen and the model are one
   * calculation rather than two that agree.
   *
   * Absent means no revenue in scope, and every method falls back to
   * `metrics.totalRevenue` exactly as it did before the link.
   */
  revenue?: RevenueSource;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function calculateItemTotal(
  line: CostLine,
  ctx: AssetCostContext,
  asResolveDirect = false,
): number {
  const v = Number.isFinite(line.value) ? line.value : 0;
  const m = ctx.metrics;
  const safeV = Math.max(0, v);
  switch (line.method) {
    case 'fixed':
      return safeV;
    case 'rate_per_land':
      return safeV * m.landSqm;
    // LEGACY, KEPT RESOLVING. rate_per_nda now multiplies gross land, which
    // is what it already did on every live project, so stored lines are
    // unchanged to the cent. rate_per_roads multiplies a roads area that is
    // now always zero; nothing uses it and the picker no longer offers it.
    case 'rate_per_nda':
      return safeV * m.ndaSqm;
    case 'rate_per_roads':
      return safeV * m.roadsSqm;
    case 'rate_per_gfa':
      return safeV * m.gfa;
    case 'rate_per_bua':
      return safeV * m.bua;
    case 'rate_per_nsa':
      return safeV * m.nsa;
    case 'rate_per_unit':
      return safeV * m.unitCount;
    case 'rate_per_parking_bay':
      return safeV * m.parkingBays;
    case 'rate_x_support_area':
      return safeV * m.supportArea;
    case 'rate_x_parking_area':
      return safeV * m.parkingArea;
    // THE THREE THE CHAIN ALONE PRODUCES (2026-09-10). Each multiplies a figure
    // from the asset DERIVED bag, so a project that never opted in charges
    // nothing on them rather than charging a guess.
    case 'rate_x_net_developable_area':
      return safeV * m.netDevelopableArea;
    case 'rate_x_footprint_area':
      return safeV * m.footprintArea;
    case 'rate_x_landscape_area':
      return safeV * m.landscapeArea;
    case 'rate_x_main_asset_gfa':
      return safeV * m.mainAssetGfa;
    case 'rate_x_retail_parking_area':
      return safeV * m.retailParkingArea;
    case 'rate_x_retail_gfa':
      return safeV * m.retailGfa;
    case 'rate_x_specific_subunit': {
      const target = (ctx.subUnits ?? []).find((u) => u.id === line.subUnitId);
      if (!target) return 0;
      return safeV * computeSubUnitArea(target, ctx.asset);
    }
    case 'per_sub_unit_custom_rates': {
      // M2.0h Fix 5: sum of (sub-unit area × per-sub-unit rate) across
      // all revenue + Support sub-units PLUS the asset-level Support
      // and Parking rows. Missing rates fall back to line.value as
      // default.
      const rates = line.perSubUnitRates ?? {};
      const defaultRate = safeV;
      const my = (ctx.subUnits ?? []).filter((u) => u.assetId === ctx.asset.id);
      let total = 0;
      for (const u of my) {
        const r = rates[u.id] ?? defaultRate;
        total += Math.max(0, r) * computeSubUnitArea(u, ctx.asset);
      }
      // Asset-level Support row (excluded if already covered by Support
      // sub-units; Support sub-unit areas are kept distinct from
      // asset.supportArea per the M2.0g schema, so both contribute).
      const aSupport = Math.max(0, ctx.asset.supportArea ?? 0);
      if (aSupport > 0) {
        const r = rates[PER_SUBUNIT_RATE_KEY_SUPPORT] ?? defaultRate;
        total += Math.max(0, r) * aSupport;
      }
      const aParking = Math.max(0, ctx.asset.parkingArea ?? 0);
      if (aParking > 0) {
        const r = rates[PER_SUBUNIT_RATE_KEY_PARKING] ?? defaultRate;
        total += Math.max(0, r) * aParking;
      }
      return total;
    }
    case 'percent_of_total_land':
      return m.landValue * (clamp(v, 0, 100) / 100);
    case 'percent_of_cash_land':
      return m.cashLandValue * (clamp(v, 0, 100) / 100);
    case 'percent_of_inkind_land':
      return m.inKindLandValue * (clamp(v, 0, 100) / 100);
    case 'percent_of_selected': {
      if (asResolveDirect) return 0;
      const ids = line.selectedLineIds ?? [];
      const base = ids.reduce((s, id) => s + (ctx.resolvedDirectLineTotals[id] ?? 0), 0);
      return base * (clamp(v, 0, 100) / 100);
    }
    case 'percent_of_construction': {
      if (asResolveDirect) return 0;
      // sum of all stage='hard' direct line totals
      const base = Object.entries(ctx.resolvedDirectLineTotals).reduce((s, [, val]) => s + val, 0);
      // The caller passes a context whose resolvedDirectLineTotals is
      // already filtered to stage='hard'; if not, computePhaseCost
      // ensures the right base is computed in pass 2.
      return base * (clamp(v, 0, 100) / 100);
    }
    // T3-edit-runtime v7 (2026-05-13): revenue-driven commission cost
    // methods all resolve to the same per-asset total revenue (from
    // Tab 2 sub-units) until M2.1 ships period-by-period revenue
    // arrays. Cash basis vs sale basis distinction kept on the schema
    // for forward-compat. computeAssetRevenue mirrors the Tab 2
    // AssetAreaReconciliationBlock formula: sum of metricValue x
    // unitPrice across revenue sub-unit categories.
    case 'percent_of_revenue_cash':
    case 'percent_of_total_revenue':
    case 'percent_of_revenue_sale':
      // ALL THREE GO THROUGH ONE FUNCTION (2026-08-19, Pass C).
      //
      // `revenue/sellingCosts.ts` owns the basis resolution AND the
      // multiplication, and the Module 2 Revenue display calls the same pair, so
      // the figure on the screen and the figure in the model are one calculation
      // rather than two that agree. Nothing is multiplied here.
      //
      // A HELD ASSET RESOLVES TO ZERO on the sale basis, which is the true
      // answer: there is no sale for a selling cost to be a percentage of. That
      // is distinct from "no revenue snapshot", which falls back to
      // `m.totalRevenue`, and conflating the two is what charged a marketing
      // budget on a hotel's nightly rate.
      //
      // The cash and sale bases coincide whenever every sale is collected inside
      // the hold, which is the ordinary case; they part company on escrow held
      // past exit, exit truncation, or revenue never collected. `checksReport`
      // surfaces that divergence rather than leaving it silent.
      return sellingCostAmount(
        resolveSellingCostBasis(
          ctx.revenue, ctx.asset.id, line.method, m.totalRevenue, !assetStrategySells(ctx.asset.strategy),
        ),
        v,
      );
  }
}

// ── Distribution helpers (5 phasing modes + manual) ───────────────────────
// distribute() returns weights summing to 1 across `periods` slots.
export function distribute(method: CostPhasing, periods: number, manual?: number[]): number[] {
  if (periods <= 0) return [];
  const out = new Array<number>(periods).fill(0);
  if (method === 'manual') {
    const m = manual ?? [];
    for (let i = 0; i < periods; i++) out[i] = Math.max(0, m[i] ?? 0);
    const sum = out.reduce((s, v) => s + v, 0);
    if (sum > 0) for (let i = 0; i < periods; i++) out[i] /= sum;
    return out;
  }
  if (method === 'even' || method === 'phase_aligned') {
    for (let i = 0; i < periods; i++) out[i] = 1 / periods;
    return out;
  }
  if (method === 'frontloaded') {
    // Linear declining weights
    const total = (periods * (periods + 1)) / 2;
    for (let i = 0; i < periods; i++) out[i] = (periods - i) / total;
    return out;
  }
  if (method === 'backloaded') {
    const total = (periods * (periods + 1)) / 2;
    for (let i = 0; i < periods; i++) out[i] = (i + 1) / total;
    return out;
  }
  if (method === 'sCurve') {
    // Bell-shape, peak in the middle. Normalised cosine bump.
    const peaks = new Array<number>(periods);
    const mid = (periods - 1) / 2;
    let sum = 0;
    for (let i = 0; i < periods; i++) {
      // 0.5 - 0.5 cos(2π * i / (periods - 1)) shifted: produces bell with 0 at edges
      const x = mid > 0 ? Math.abs(i - mid) / mid : 0;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x);
      peaks[i] = w;
      sum += w;
    }
    for (let i = 0; i < periods; i++) out[i] = sum > 0 ? peaks[i] / sum : 1 / periods;
    return out;
  }
  // fallback even
  for (let i = 0; i < periods; i++) out[i] = 1 / periods;
  return out;
}

// distributeItemCost returns a per-period schedule of the line's currency
// across the line's full [startPeriod, endPeriod] range. The output
// array is sized to max(constructionPeriods, line.endPeriod) + 1 so
// that costs phased into operations periods (e.g. commissioning fees,
// post-handover Operate costs) are captured in their actual period.
// Index 0 is the upfront / pre-construction lump.
//
// T3-edit-runtime v6 (2026-05-12): drop the end <= constructionPeriods
// clamp per user "sometime we pay costs after construction period so,
// user can select whatever start and end period wants". Even / Manual %
// distribute across (endPeriod - startPeriod + 1), not the construction
// window.
export function distributeItemCost(
  line: CostLine,
  total: number,
  constructionPeriods: number,
): number[] {
  // Output array size accommodates whichever is bigger: the construction
  // window OR the line's actual span. Caller usually passes cp from the
  // phase; result may be longer.
  const start = Math.max(0, Math.floor(line.startPeriod));
  const endRaw = Math.max(start, Math.floor(line.endPeriod));
  const outLen = Math.max(constructionPeriods + 1, endRaw + 1);
  const out = new Array<number>(outLen).fill(0);
  if (line.startPeriod === 0 && line.endPeriod === 0) {
    out[0] = total;
    return out;
  }
  const span = Math.max(1, endRaw - start + 1);
  const weights = distribute(line.phasing, span, line.distribution);
  for (let i = 0; i < span; i++) {
    const p = start + i;
    if (p < outLen) out[p] = total * (weights[i] ?? 0);
  }
  return out;
}

// ── Allocation helpers ─────────────────────────────────────────────────────
/**
 * Equal split across a phase's real assets, used when a share basis has a
 * DEGENERATE DENOMINATOR (2026-08-15).
 *
 * WHY THIS EXISTS. Every share basis was written as
 * `return total > 0 ? mine / total : 0`, which returns 0 for EVERY asset when
 * the total is zero. The shares then sum to 0 instead of 1, and a project-level
 * lump sum allocated on that basis is not allocated to anybody: it is silently
 * dropped from the model. Measured before the fix, with one asset and a phase
 * carrying no land: a `fixed` cost line of 1,000,000 on `land_share` moved
 * total capex by 0.000m, while the same line on `bua_share` or `per_asset`
 * moved it by the full 1,000,000. Money the user typed left the model with no
 * warning anywhere.
 *
 * This is reachable on any phase whose basis quantity is genuinely zero (no
 * parcels yet, an operational asset with no new build, areas not entered yet),
 * and it became the ordinary case once a new project stopped pre-filling a land
 * parcel.
 *
 * The equal split is not a new convention: `computeAssetLandSqm` already falls
 * back to `phaseLandSqm / phaseAssets.length` when total BUA is zero, and the
 * `category` basis is already `1 / sameCat.length`. Companions are excluded
 * because they carry no land, BUA or GFA by construction, so an area-based cost
 * is not theirs to take; the eligible assets then split the whole cost and the
 * factors still sum to exactly 1.
 *
 * Returns 0 when there is nobody to allocate to, which is the one case where
 * dropping the cost is the only option.
 */
function equalPhaseShare(asset: Asset, phaseAssets: Asset[]): number {
  const eligible = phaseAssets.filter((a) => a.isCompanion !== true && a.visible);
  if (eligible.length === 0) return 0;
  return eligible.some((a) => a.id === asset.id) ? 1 / eligible.length : 0;
}

// Resolve an asset's share factor (0..1) for a project-level cost line
// based on its allocationBasis.
export function resolveAllocationFactor(
  basis: AllocationBasis,
  asset: Asset,
  phaseAssets: Asset[],
  parcels: Parcel[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  if (basis === 'per_asset') return 1;
  if (basis === 'manual') return 1; // overrides supply explicit values
  if (basis === 'category') {
    const cat = asset.strategy;
    const sameCat = phaseAssets.filter((a) => a.strategy === cat && a.visible);
    if (sameCat.length === 0) return 0;
    return 1 / sameCat.length;
  }
  // Each share basis falls back to an equal split rather than 0 when its
  // denominator is degenerate, so a lump sum is never dropped. See
  // equalPhaseShare.
  if (basis === 'bua_share') {
    const myBua = computeAssetBua(asset, subUnits);
    const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
    return totalBua > 0 ? myBua / totalBua : equalPhaseShare(asset, phaseAssets);
  }
  if (basis === 'gfa_share') {
    const myGfa = asset.gfaSqm;
    const totalGfa = phaseAssets.reduce((s, a) => s + a.gfaSqm, 0);
    return totalGfa > 0 ? myGfa / totalGfa : equalPhaseShare(asset, phaseAssets);
  }
  if (basis === 'land_share') {
    const myLand = computeAssetLandSqm(asset, parcels, phaseAssets, subUnits, mode);
    const totalLand = phaseAssets.reduce(
      (s, a) => s + computeAssetLandSqm(a, parcels, phaseAssets, subUnits, mode),
      0,
    );
    return totalLand > 0 ? myLand / totalLand : equalPhaseShare(asset, phaseAssets);
  }
  return 0;
}

// ── Per-asset cost rollup ──────────────────────────────────────────────────
export interface AssetCostBreakdown {
  byLineId: Record<string, number>;
  byStage: Record<CostStage, number>;
  total: number;
  perPeriod: number[]; // length = constructionPeriods + 1
  // M2.0L Pass2 Fix 9 (2026-05-11): per-period land splits powering the
  // three new CAPEX Summary tables (Excl All Land / Excl Land In-Kind /
  // Incl All Land). perPeriodLandTotal sums every stage='land' line's
  // per-period contribution; perPeriodLandInKind sums only the
  // 'percent_of_inkind_land' method (or any future in-kind-tagged
  // lines via tagging convention).
  perPeriodLandTotal: number[];
  perPeriodLandInKind: number[];
  // P11 Fix 6 (2026-05-13): per-line per-period currency schedule keyed
  // by costLine.id. Each entry is the exact distribution returned by
  // distributeItemCost for that line (phase-relative, length =
  // periodSlots = max(cp, maxLineEnd) + 1). Exists so Module1Costs
  // Table 1 per-line nested rows can render the LINE's own phasing
  // curve instead of smearing the line total proportional to the
  // asset-wide perPeriod (which destroyed manual % and single-period
  // line curves for multi-line assets). One source of truth: the
  // engine's existing distributeItemCost call inside the per-period
  // loop fills both perPeriod (aggregated) and this map.
  perLinePerPeriod: Record<string, number[]>;
  /**
   * THE WINDOW EACH LINE ACTUALLY SPENT IN (2026-08-17).
   *
   * A followed source replaces the WINDOW, not just the shape (see
   * capexPhasing.ts), so a line following collections has not spent in the
   * window stored on it since that mechanism shipped. The row went on rendering
   * the STORED window in two editable boxes, which is how a marketing line
   * showed periods 1 to 25 while the engine spent it when cash arrived.
   *
   * The engine now reports what it decided, and the screen renders THAT, so the
   * two cannot disagree. `source` and `degraded` come straight from the same
   * resolution, which is what lets the row say "follows collections, none yet"
   * instead of silently showing a construction window.
   */
  resolvedWindowByLineId: Record<string, ResolvedLineWindow>;
  /**
   * The base amount each `percent_of_selected` line charged on (2026-08-17).
   *
   * The row caption has always been able to say "10% x <base>" and has always
   * been handed `undefined`, so every such row read "10% x 0" whatever the base
   * was. Reported from the pass that computes it rather than recomputed at the
   * caption, so the number shown is the number used.
   */
  selectedBaseByLineId: Record<string, number>;
}

export interface ResolvedLineWindow {
  startPeriod: number;
  endPeriod: number;
  /** `own` / `inherit` / `land_cash` / `collections`. */
  source: CapexPhasingSource;
  /** True when the line follows a source that yielded nothing and fell through. */
  degraded: boolean;
  /** Plain sentence from the shared resolver. */
  reason: string;
}

/**
 * Everything `computeAssetCost` needs, as ONE NAMED OBJECT (2026-08-16).
 *
 * WHY THIS IS NOT POSITIONAL ANY MORE. The signature had grown to eleven
 * positional parameters across ten call sites, the last two optional. At that
 * width a site that omits an optional input is INDISTINGUISHABLE from one that
 * passes it, and the two most recent additions (`parcelFunding`, then
 * `collectionsPerPeriod`) were each wired at a subset of sites, so the same
 * asset could be costed one way in the P&L path and another in the financing
 * path with nothing to show for it. Named fields make a missing input a
 * deliberate absence rather than a positional accident, and make the next
 * addition a one-line change at the definition instead of ten edits that must
 * all be got right.
 */
export interface ComputeAssetCostInput {
  asset: Asset;
  project: Project;
  phase: Phase;
  parcels: Parcel[];
  assets: Asset[];
  subUnits: SubUnit[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
  landAllocationMode: LandAllocationMode;
  /**
   * M2.0 Pass 14 (2026-05-13): parcel funding config, so percent_of_cash_land
   * lines distribute deferred-payment parcel slices via expandDeferredSchedule
   * instead of lumping at Y0. Omitted keeps the Y0 behaviour.
   */
  parcelFunding?: ParcelFundingConfig[];
  /**
   * 2026-08-15: sales cash COLLECTED for this asset, per phase-relative period.
   * The one input the phasing resolution cannot derive for itself, because it
   * comes from the revenue engine. That engine runs BEFORE costs and reads no
   * cost input, so there is no circularity.
   *
   * A line set to follow collections with none supplied degrades to the asset
   * curve and then to its own setting, and the resolver reports that rather
   * than silently phasing it to nothing.
   */
  collectionsPerPeriod?: number[];
  /**
   * THE REVENUE SNAPSHOT (2026-08-19, Pass C), the base for every
   * percent-of-revenue method. ONE input, so a call site cannot pass half of
   * what it needs; see the note on `AssetCostContext.revenue` for the day the
   * three separate figures existed and six of eleven sites omitted them.
   *
   * SEPARATE from `collectionsPerPeriod`, which stays: that one is windowed to
   * the phase because it drives PHASING, and a total must not lose cash
   * arriving outside the window. Two different questions, two inputs, on
   * purpose.
   */
  revenue?: RevenueSource;
}

export function computeAssetCost(input: ComputeAssetCostInput): AssetCostBreakdown {
  const {
    asset, project, phase, parcels, assets, subUnits, costLines, costOverrides,
    landAllocationMode, parcelFunding, collectionsPerPeriod, revenue,
  } = input;
  // T3-companion Fix 2 (2026-05-12): companion assets (Sell + Manage
  // Operate sibling, isCompanion === true) carry NO physical attributes
  // and inherit operating revenue from the parent. They must NOT pull
  // any cost line. Short-circuit the entire pipeline before any phase
  // line filter / metric resolution. Returns the canonical empty
  // breakdown so downstream consumers (UI render, Project Total
  // rollup, financing engine) see explicit zeros instead of any
  // accidentally inherited master totals.
  //
  // ── CONSOLIDATION STEP 6 (2026-09-10): A RETAIL COMPANION IS NOT ONE OF
  //    THESE. It has land (step 5), floor area and parking of its own, it is
  //    held on Lease, and it is the ONLY companion that is a building rather
  //    than a second treatment of one. So it falls through to the ordinary
  //    pipeline below and is costed exactly like any other asset: the same
  //    phase lines, the same scope rule (a SELLING line drops out for a Lease
  //    asset without anything here knowing about retail), the same soft
  //    percentages, and its own rate through the ordinary per-asset override.
  //    That is the whole of step 6 in this file: one predicate, narrowed.
  //
  //    The Operate companion is untouched. It carries NO physical attributes
  //    and inherits its parent's revenue, so charging it any line would double
  //    count the parent's building.
  if (asset.isCompanion === true && !isRetailCompanion(asset)) {
    const cpZero = phase.constructionPeriods + 1;
    return {
      byLineId: {},
      byStage: { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0 },
      total: 0,
      perPeriod: new Array<number>(cpZero).fill(0),
      perPeriodLandTotal: new Array<number>(cpZero).fill(0),
      perPeriodLandInKind: new Array<number>(cpZero).fill(0),
      perLinePerPeriod: {},
      resolvedWindowByLineId: {},
      selectedBaseByLineId: {},
    };
  }
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
  // M2.0d: filter targeted custom lines so each asset only sees its own
  // (untagged lines = project-wide and apply to all assets).
  //
  // ── 2026-08-17: THE SAME FILTER THE SCREEN USES, INCLUDING THE COUNTRY GATE ──
  //
  // This list used to filter on phase and target asset only, while
  // `assetVisibleLines` (the shared rule the picker uses, and which this very
  // function already uses for the percent-of-selected base thirty lines below)
  // also drops a line whose `requiresCountry` does not match the project. So
  // ONE function answered "which lines exist here" two different ways, and a
  // country-gated line was CHARGED while being invisible in the inputs table,
  // uneditable and undeletable.
  //
  // Measured on a live project: `rett__phase_2` carries 5% and the project
  // country is empty, so the Phase 2 hotel was charged 937,500 for a Real Estate
  // Transfer Tax row it does not show, ON TOP of the user's own RETT line at the
  // same rate. RETT was double-charged, and every downstream surface (financing,
  // P&L, cash flow, returns, both exports) carried the doubled figure while the
  // only three places that applied the gate were input-side filters in the
  // Costs tab. The rate reaches that state simply by being typed while the
  // country matched and left behind when it stopped matching.
  //
  // A gate that hides a row must also stop its money, or it is not a gate.
  const phaseLines = assetVisibleLines(costLines, phase.id, asset.id, asset.strategy);
  const metrics = resolveAssetAreaMetrics(asset, project, parcels, phaseAssets, subUnits, landAllocationMode);

  // Resolve the per-asset method/value/phasing/timing for each line.
  //
  // M2.0L Pass 4 inheritance resolver:
  //   - override.overridden === false -> inactive, read master.
  //   - override.overridden !== false (true or legacy undefined) -> active.
  //     Every defined field on the override replaces the master; undefined
  //     fields fall back to master. Optional startPeriod / endPeriod on
  //     the override carry through to the per-period distribution loop
  //     below.
  // M2.0d: line.disabled OR override.disabled zeros the row out (kept
  // in resolved[] for stage / phase indexing but the value is forced
  // to 0).
  const resolved: Array<{
    line: CostLine; method: CostMethod; value: number;
    phasing: CostPhasing; distribution?: number[]; disabled: boolean;
    startPeriod: number; endPeriod: number;
  }> = phaseLines.map((line) => {
    const ov = costOverrides.find((o) => o.assetId === asset.id && o.lineId === line.id);
    const isActive = ov !== undefined && ov.overridden !== false;
    const disabled = line.disabled === true || (isActive && ov?.disabled === true);
    if (isActive && ov) {
      return {
        line,
        method:      ov.method      ?? line.method,
        value:       disabled ? 0 : (ov.value      ?? line.value),
        phasing:     ov.phasing     ?? line.phasing,
        distribution: ov.distribution ?? line.distribution,
        disabled,
        startPeriod: ov.startPeriod ?? line.startPeriod,
        endPeriod:   ov.endPeriod   ?? line.endPeriod,
      };
    }
    return {
      line,
      method:      line.method,
      value:       disabled ? 0 : line.value,
      phasing:     line.phasing,
      distribution: line.distribution,
      disabled,
      startPeriod: line.startPeriod,
      endPeriod:   line.endPeriod,
    };
  });


  // Pass 1: direct methods (everything except percent_of_selected /
  // percent_of_construction).
  //
  // M2.0L Pass2 Fix 3 (2026-05-11): allocation factor previously
  // multiplied EVERY method's total, even asset-specific ones whose
  // value already encodes the asset's share (rate_per_bua reads
  // m.bua = THIS asset's BUA; percent_of_cash_land reads
  // m.cashLandValue = THIS asset's cash land slice). The double-apply
  // halved or quartered cost line totals on multi-asset phases.
  //
  // The correct semantics: only the `fixed` method delivers a project-
  // wide lump sum that needs distributing via allocationBasis. Every
  // other method (rate_per_X, percent_of_X_land, etc.) already returns
  // the asset's contribution because m.X is asset-scoped via
  // resolveAssetAreaMetrics. allocationBasis stays on the schema for
  // back-compat + the `fixed` distribution path; for asset-specific
  // methods we ignore it (allocFactor = 1).
  const FIXED_METHODS_NEEDING_ALLOC = new Set<CostMethod>(['fixed']);
  // M2.0L Pass 5 (2026-05-11): aggregated metrics for the phase. Used
  // as the calculateItemTotal context for Allocated lines so the pool
  // value reflects project-wide totals (e.g. rate_per_bua x sum(bua)
  // across phaseAssets), then driver-share splits per asset.
  const phaseMetricsByAsset = new Map<string, AssetAreaMetrics>();
  for (const a of phaseAssets) {
    phaseMetricsByAsset.set(a.id, resolveAssetAreaMetrics(a, project, parcels, phaseAssets, subUnits, landAllocationMode));
  }
  const aggregatedMetrics = aggregatePhaseMetrics(phaseAssets, phaseMetricsByAsset);
  // Single asset to use as the "stub" carrier for aggregated calc (the
  // calculateItemTotal switch needs an Asset object even though it
  // mostly reads metrics; pick the first phase asset for shape).
  const aggregateAsset: Asset = phaseAssets[0] ?? asset;

  const directTotals: Record<string, number> = {};
  for (const r of resolved) {
    const isPct = r.method === 'percent_of_selected' || r.method === 'percent_of_construction';
    if (isPct) continue;
    const category = resolveCostCategory(r.line);
    if (category === 'allocated') {
      // Pool = compute against aggregated phase metrics, then driver-
      // share to this asset.
      const aggCtx: AssetCostContext = {
        asset: aggregateAsset,
        metrics: aggregatedMetrics,
        subUnits,
        resolvedDirectLineTotals: {},
        // NOTE: `revenue` is deliberately NOT set. An `allocated` line computes its pool against
        // AGGREGATED PHASE metrics, and this asset's revenue is not the phase's.
        // Leaving them undefined falls back to the aggregated gross figure,
        // which is the correct pool basis; the driver share then splits it. A
        // phase-wide revenue total would be the right input here and is not
        // plumbed because no allocated line uses a revenue base today. Flagged
        // rather than guessed, and the fallback is a PHASE-level figure so it is
        // not the per-asset defect described on the fields themselves.
      };
      const pool = calculateItemTotal(
        { ...r.line, method: r.method, value: r.value },
        aggCtx,
        true,
      );
      const driver = resolveCostDriver(r.line);
      const driverShare = resolveDriverFactor(driver, asset, phaseAssets, parcels, subUnits, landAllocationMode);
      directTotals[r.line.id] = pool * driverShare;
      continue;
    }
    // Direct category (default + Pass 3 semantics preserved):
    const ctxStub: AssetCostContext = { asset, metrics, subUnits, resolvedDirectLineTotals: {}, revenue };
    const lineTotal = calculateItemTotal(
      { ...r.line, method: r.method, value: r.value },
      ctxStub,
      true,
    );
    const needsAlloc = FIXED_METHODS_NEEDING_ALLOC.has(r.method);
    const allocFactor = needsAlloc
      ? resolveAllocationFactor(
          r.line.allocationBasis,
          asset,
          phaseAssets,
          parcels,
          subUnits,
          landAllocationMode,
        )
      : 1;
    directTotals[r.line.id] = lineTotal * allocFactor;
  }

  // Pass 2: percent_of_construction = % × sum of stage='hard' direct totals.
  const constructionBase = resolved
    // 2026-08-17: derived stage, so a line the user has reclassified as hard
    // enters the construction base and one reclassified away from hard leaves
    // it. Was the raw field, the second of the two readers that bypassed the
    // shared derivation.
    .filter((r) => !['percent_of_selected', 'percent_of_construction'].includes(r.method) && deriveCostStage(r.line) === 'hard')
    .reduce((s, r) => s + (directTotals[r.line.id] ?? 0), 0);

  const percentTotals: Record<string, number> = {};
  for (const r of resolved) {
    if (r.method === 'percent_of_construction') {
      const v = clamp(r.value, 0, 100);
      percentTotals[r.line.id] = constructionBase * (v / 100);
    }
  }

  // Pass 3: percent_of_selected = % × sum of selected line ids' totals.
  // selectedLineIds come from the BASE line (overrides don't change them).
  //
  // 2026-08-15: the ORDERING RULE IS ENFORCED HERE, not just offered by the
  // picker. A line may charge only on lines ABOVE it. This pass has always
  // been a single forward sweep reading a map filled as it goes, so a
  // downward reference already read an absent entry and contributed ZERO, with
  // no warning: measured on construction 1000 / dev fee 10% / contingency 5%,
  // moving the dev fee below contingency changed contingency from 55.00 to
  // 50.00, and a two-line cycle produced 500 and 750, both artefacts of array
  // position.
  //
  // THIS IS NOT PURELY A TIDY-UP, and the distinction matters. A downward
  // reference to another PERCENT line already contributed zero, so filtering it
  // moves nothing. A downward reference to a DIRECT-method line is different:
  // `directTotals` is fully populated in Pass 1, before this pass runs, so the
  // old code read a REAL number for it and computed a genuinely wrong base. The
  // old picker offered lines below, so that state was reachable. On
  // build 1000 / contingency 10% selecting a 500 line BELOW it, the base was
  // 1500 and the answer 150; it is now 1000 and 100. Any model carrying such a
  // selection WILL move, and should.
  //
  // Upward-only references also make a cycle unrepresentable, which is why the
  // picker no longer needs to ban a whole method to stay safe.
  // `phaseLines` IS the visible list since 2026-08-17, so this is the same
  // set. Kept as its own name because it says what it is for.
  const visibleForBase = phaseLines;
  const selectedBaseByLineId: Record<string, number> = {};
  for (const r of resolved) {
    if (r.method === 'percent_of_selected') {
      const ids = allowedSelectedIds(visibleForBase, r.line.id, r.line.selectedLineIds);
      const base = ids.reduce(
        (s, id) => s + (directTotals[id] ?? percentTotals[id] ?? 0),
        0,
      );
      const v = clamp(r.value, 0, 100);
      selectedBaseByLineId[r.line.id] = base;
      percentTotals[r.line.id] = base * (v / 100);
    }
  }

  // Aggregate
  const byLineId: Record<string, number> = { ...directTotals, ...percentTotals };
  const byStage: Record<CostStage, number> = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0 };
  let total = 0;
  for (const r of resolved) {
    const t = byLineId[r.line.id] ?? 0;
    total += t;
    // 2026-08-17: `deriveCostStage`, not the raw field. This rollup was the one
    // reader of `line.stage` that bypassed the shared derivation, so a line
    // whose stored stage differed from its derived one was counted in one
    // bucket and displayed in another (measured on `pre-operating`, seeded soft
    // and mapped operating). It is also what makes a user's stage choice reach
    // the Capex-by-Stage table at all.
    byStage[deriveCostStage(r.line)] += t;
  }

  // Per-period schedule. T3-edit-runtime v6 (2026-05-12): size the
  // perPeriod array to span the construction window OR the latest cost
  // line endPeriod, whichever is larger. Lines phased into operations
  // (endPeriod > cp) populate the trailing slots.
  const cp = phase.constructionPeriods;
  const maxLineEnd = resolved.reduce((m, r) => Math.max(m, r.endPeriod), 0);
  const periodSlots = Math.max(cp, maxLineEnd) + 1;
  const perPeriod = new Array<number>(periodSlots).fill(0);
  const perPeriodLandTotal = new Array<number>(periodSlots).fill(0);
  const perPeriodLandInKind = new Array<number>(periodSlots).fill(0);
  // M2.0 Pass 14 (2026-05-13): per-parcel cash-share fractions for this
  // asset, used to decompose a percent_of_cash_land line by parcel so
  // deferred-payment parcels can distribute via expandDeferredSchedule
  // instead of lumping at Y0. Sums to 1.0 across the asset's phase
  // parcels' cash slices (or stays empty when no parcel info is
  // available, in which case the loop below falls back to the
  // single-distributeItemCost path).
  const phaseCashFractions = new Map<string, number>();
  if (parcelFunding && parcelFunding.length > 0) {
    const phaseParcels = parcels.filter((p) => p.phaseId === phase.id);
    const landBd = computeAssetLandBreakdown(asset, parcels, assets, subUnits, landAllocationMode);
    let total = 0;
    const cashByParcel: Record<string, number> = {};
    if (landBd.splits.length > 0) {
      for (const sp of landBd.splits) {
        const parcel = phaseParcels.find((p) => p.id === sp.parcelId);
        if (!parcel) continue;
        const slice = sp.value * Math.max(0, parcel.cashPct) / 100;
        cashByParcel[sp.parcelId] = slice;
        total += slice;
      }
    } else {
      // Fallback: distribute the asset's cashLandValue across phase
      // parcels pro-rata by each parcel's cash value within the phase.
      // Mirrors the aggregate path in resolveAssetAreaMetrics so the
      // per-parcel decomposition stays consistent with the total.
      for (const p of phaseParcels) {
        const slice = Math.max(0, p.area) * Math.max(0, p.rate) * Math.max(0, p.cashPct) / 100;
        cashByParcel[p.id] = slice;
        total += slice;
      }
    }
    if (total > 0) {
      for (const [pid, v] of Object.entries(cashByParcel)) {
        phaseCashFractions.set(pid, v / total);
      }
    }
  }

  // P11 Fix 6 (2026-05-13): retain the per-line schedule so Module1
  // Costs Table 1 per-line nested rows can render the line's own
  // phasing curve. Same distributeItemCost call powers both the
  // aggregated perPeriod accumulators above AND this map - one source
  // of truth for per-line per-period.
  // ── Capex phasing resolution (2026-08-15) ─────────────────────────────────
  //
  // One asset curve inherited by every line, RETT following the land cash
  // outflow, marketing and commission following collections, any line
  // breakable out. See capexPhasing.ts for the rules.
  //
  // IT SITS HERE, INSIDE THE ENGINE, ON PURPOSE. computeAssetCost has ten
  // production call sites (the financials resolver, the capex and CoS report
  // builders, two financing hooks, fixed assets, revenue, and three module
  // screens). Resolving at the call sites would be ten adoption points, and one
  // missed site would make the screen and the export disagree about WHEN money
  // moves. Resolving once here makes every caller correct by construction.
  //
  // IT SITS AT THIS POINT IN THE FUNCTION on purpose too: after the totals are
  // final and immediately before the only loop that reads a curve. Phasing
  // cannot change any total (weights sum to 1), so nothing above is affected.
  //
  // NO MATHS CHANGED. The resolution only rewrites the phasing / distribution /
  // window fields that distributeItemCost already reads, and it is SKIPPED
  // ENTIRELY when nothing opts in, which is every line on every project that
  // predates this. `capexPhasingIsInert` is checked rather than trusting the
  // resolution to be an identity: "we did not run" is a stronger guarantee than
  // "we ran and it cancelled out".
  // What the engine decided about each line's timing, reported to the screen.
  // Filled by the resolution below when it runs, and from the lines' own
  // windows when it does not, so the map is complete either way.
  const resolvedWindowByLineId: Record<string, ResolvedLineWindow> = {};
  if (!capexPhasingIsInert(asset, phaseLines, costOverrides)) {
    // The land cash SHAPE, taken from the land lines' own resolved windows and
    // any deferred parcel schedule. Shape only: RETT follows when the land cash
    // moves, not how much of it there is.
    const landShape = new Array<number>(periodSlots).fill(0);
    for (const r of resolved) {
      // THE LAND LINE, NOT THE METHOD (2026-08-17b). This selected every line
      // whose METHOD is `percent_of_cash_land`, which is also RETT's method,
      // because a transfer tax IS a percentage of the cash land value. So RETT
      // was half of the shape it was supposed to be following: measured on a
      // live project, phase 2 land cash sat entirely in period 0 while RETT
      // resolved to 0..3 as 468,750 / 156,250 / 156,250 / 156,250, which is the
      // real land cash at period 0 blended with RETT's OWN construction spread.
      //
      // `isParcelDrivenLandLine` is the one definition of which lines are the
      // land value, and its own docstring says that method is the wrong
      // discriminator for exactly this reason. In-kind land is excluded by the
      // same helper's companion test below: RETT follows the CASH outflow.
      if (!isParcelDrivenLandLine(r.line) || r.method !== 'percent_of_cash_land') continue;
      const own = distributeItemCost(
        { ...r.line, phasing: r.phasing, distribution: r.distribution, startPeriod: r.startPeriod, endPeriod: r.endPeriod },
        1,
        cp,
      );
      const lim = Math.min(own.length, periodSlots);
      for (let i = 0; i < lim; i += 1) landShape[i] += own[i] ?? 0;
    }
    if (parcelFunding && phaseCashFractions.size > 0) {
      for (const [parcelId, frac] of phaseCashFractions) {
        const cfg = parcelFunding.find((pf) => pf.parcelId === parcelId);
        if (cfg?.fundingType !== 'deferred_payment' || !cfg.deferredSchedule) continue;
        const w = expandDeferredSchedule(cfg.deferredSchedule, periodSlots);
        for (let i = 0; i < periodSlots; i += 1) landShape[i] += frac * (w[i] ?? 0);
      }
    }
    const phasingCtx: CapexPhasingContext = {
      landCashPerPeriod: landShape,
      collectionsPerPeriod: collectionsPerPeriod,
    };
    for (const r of resolved) {
      const ov = costOverrides.find((o) => o.assetId === asset.id && o.lineId === r.line.id);
      const decision = resolveLinePhasing(
        r.line,
        { phasing: r.phasing, distribution: r.distribution, startPeriod: r.startPeriod, endPeriod: r.endPeriod },
        asset,
        phasingCtx,
        ov,
      );
      r.phasing = decision.effective.phasing;
      r.distribution = decision.effective.distribution;
      r.startPeriod = decision.effective.startPeriod;
      r.endPeriod = decision.effective.endPeriod;
      resolvedWindowByLineId[r.line.id] = {
        startPeriod: decision.effective.startPeriod,
        endPeriod: decision.effective.endPeriod,
        source: decision.source,
        degraded: decision.resolution.degraded,
        reason: decision.resolution.reason,
      };
    }
  }
  for (const r of resolved) {
    if (resolvedWindowByLineId[r.line.id]) continue;
    resolvedWindowByLineId[r.line.id] = {
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      source: 'own',
      degraded: false,
      reason: 'This line spends on its own window.',
    };
  }

  const perLinePerPeriod: Record<string, number[]> = {};
  for (const r of resolved) {
    const t = byLineId[r.line.id] ?? 0;
    if (t === 0) continue;
    let dist: number[];
    // M2.0 Pass 14 (2026-05-13): percent_of_cash_land lines decompose
    // by parcel so deferred-payment parcels can spread via
    // expandDeferredSchedule. Non-deferred parcel slices fall back to
    // the line's existing schedule (default = Y0 lump). When no
    // parcelFunding is supplied or no parcel has deferred config, the
    // line takes the unchanged single distributeItemCost path so
    // existing callers / fixtures stay bit-identical.
    if (
      r.method === 'percent_of_cash_land' &&
      phaseCashFractions.size > 0 &&
      parcelFunding &&
      parcelFunding.some((pf) =>
        pf.fundingType === 'deferred_payment' &&
        phaseCashFractions.has(pf.parcelId),
      )
    ) {
      dist = new Array<number>(periodSlots).fill(0);
      let nonDeferredTotal = 0;
      for (const [parcelId, frac] of phaseCashFractions) {
        const slice = t * frac;
        const cfg = parcelFunding.find((pf) => pf.parcelId === parcelId);
        if (cfg?.fundingType === 'deferred_payment' && cfg.deferredSchedule) {
          const weights = expandDeferredSchedule(cfg.deferredSchedule, periodSlots);
          for (let i = 0; i < periodSlots; i++) dist[i] += slice * (weights[i] ?? 0);
        } else {
          nonDeferredTotal += slice;
        }
      }
      if (nonDeferredTotal > 0) {
        const tmp = distributeItemCost(
          { ...r.line, phasing: r.phasing, distribution: r.distribution, startPeriod: r.startPeriod, endPeriod: r.endPeriod },
          nonDeferredTotal,
          cp,
        );
        // GROW, never truncate: see the note on the aggregation loop below.
        for (let i = 0; i < tmp.length; i++) dist[i] = (dist[i] ?? 0) + (tmp[i] ?? 0);
      }
    } else {
      dist = distributeItemCost(
        { ...r.line, phasing: r.phasing, distribution: r.distribution, startPeriod: r.startPeriod, endPeriod: r.endPeriod },
        t,
        cp,
      );
    }
    perLinePerPeriod[r.line.id] = dist;
    const isLand = deriveCostStage(r.line) === 'land';
    const isInKindLand = r.method === 'percent_of_inkind_land';
    // GROW the aggregate to fit the line, never truncate it to the window.
    //
    // `periodSlots` is sized from constructionPeriods and the latest cost-line
    // endPeriod, but a line that FOLLOWS a phasing source (a selling cost on
    // `percent_of_revenue_sale` following collections, say) is distributed over
    // that source's window, which can run past both. The old
    // `Math.min(dist.length, periodSlots)` silently dropped the overhang, so
    // `total` (accumulated separately, from the resolved line values) no longer
    // equalled the sum of the periods beside it. Measured live before the fix:
    // Marina Gate's "Marketing Cost" lost 6,561,759 and RE HUB's "Commission"
    // lost 10,632,560, and because the balance sheet builds inventory as
    // cumulative capex minus cumulative cost of sales, Marina Gate closed on an
    // inventory of exactly -6,561,759. A negative closing inventory was the
    // visible end of a silent truncation.
    for (let i = 0; i < dist.length; i++) {
      const v = dist[i] ?? 0;
      perPeriod[i] = (perPeriod[i] ?? 0) + v;
      if (isLand) perPeriodLandTotal[i] = (perPeriodLandTotal[i] ?? 0) + v;
      if (isInKindLand) perPeriodLandInKind[i] = (perPeriodLandInKind[i] ?? 0) + v;
    }
  }
  // A grown array can carry holes if one line reached further than another; fill
  // them so every consumer reads numbers rather than undefined.
  const widest = Math.max(perPeriod.length, perPeriodLandTotal.length, perPeriodLandInKind.length);
  for (let i = 0; i < widest; i++) {
    perPeriod[i] = perPeriod[i] ?? 0;
    perPeriodLandTotal[i] = perPeriodLandTotal[i] ?? 0;
    perPeriodLandInKind[i] = perPeriodLandInKind[i] ?? 0;
  }

  return {
    byLineId, byStage, total, perPeriod, perPeriodLandTotal, perPeriodLandInKind,
    perLinePerPeriod, resolvedWindowByLineId, selectedBaseByLineId,
  };
}

// ── Phase cost rollup ──────────────────────────────────────────────────────
export interface PhaseCostBreakdown {
  byAssetId: Record<string, AssetCostBreakdown>;
  byStage: Record<CostStage, number>;
  total: number;
  perPeriod: number[]; // length = constructionPeriods + 1
}

export function computePhaseCost(
  phase: Phase,
  project: Project,
  costLines: CostLine[],
  costOverrides: CostOverride[],
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  landAllocationMode: LandAllocationMode = 'autoByBua',
  // M2.0 Pass 14 (2026-05-13): pass-through for deferred-payment Land
  // Cash distribution. Forwarded as-is to computeAssetCost per asset.
  parcelFunding?: ParcelFundingConfig[],
): PhaseCostBreakdown {
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
  const byAssetId: Record<string, AssetCostBreakdown> = {};
  const byStage: Record<CostStage, number> = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0 };
  let total = 0;
  const cp = phase.constructionPeriods;
  const perPeriod = new Array<number>(cp + 1).fill(0);

  for (const a of phaseAssets) {
    const breakdown = computeAssetCost({
      asset: a, project, phase, parcels, assets, subUnits, costLines, costOverrides,
      landAllocationMode, parcelFunding,
    });
    byAssetId[a.id] = breakdown;
    total += breakdown.total;
    // 2026-08-16: iterate COST_STAGES, never a literal. This was
    // `['land','hard','soft','operating'] as CostStage[]`, which silently
    // dropped `marketing` from the PHASE-level rollup. The cast is what hid it:
    // it ASSERTS the array is exhaustive, so the compiler cannot check the one
    // thing that matters. Third occurrence of this family in three days.
    for (const k of COST_STAGES) byStage[k] += breakdown.byStage[k];
    for (let i = 0; i <= cp; i++) perPeriod[i] += breakdown.perPeriod[i] ?? 0;
  }

  return { byAssetId, byStage, total, perPeriod };
}

/**
 * Deferred Payment land schedule expander (2026-05-13).
 *
 * Returns an array of length `totalPeriods` representing the share of
 * a parcel's cash value that lands in each project period (weights
 * sum to 1.0 within the [startPeriod, endPeriod] window, zeros
 * elsewhere). Consumers multiply this by the parcel's cash value to
 * derive the per-period contribution.
 *
 *   type === 'even'        -> each period in [start, end] gets
 *                              1 / (end - start + 1).
 *   type === 'manual_pct'  -> distribution array is auto-normalised
 *                              (negatives clamped, then rescaled so
 *                              the sum equals 1.0). When the input
 *                              sums to zero, falls back to even.
 *
 * Window is clamped to [0, totalPeriods - 1]; out-of-range entries
 * are silently dropped.
 *
 * Wired into computeAssetCost (M2.0 Pass 14, 2026-05-13): the
 * percent_of_cash_land line decomposes by parcel and applies these
 * weights to any parcel whose fundingType === 'deferred_payment'.
 * Non-deferred parcels keep the line's existing schedule (default
 * = Y0 lump via distributeItemCost short-circuit).
 */
export function expandDeferredSchedule(
  schedule: { type: 'even' | 'manual_pct'; startPeriod: number; endPeriod: number; distribution?: number[] } | undefined,
  totalPeriods: number,
): number[] {
  const out = new Array<number>(Math.max(0, totalPeriods)).fill(0);
  if (!schedule || totalPeriods <= 0) return out;
  const start = Math.max(0, Math.min(totalPeriods - 1, Math.floor(schedule.startPeriod)));
  const end = Math.max(start, Math.min(totalPeriods - 1, Math.floor(schedule.endPeriod)));
  const span = end - start + 1;
  if (span <= 0) return out;
  if (schedule.type === 'even') {
    const w = 1 / span;
    for (let i = start; i <= end; i++) out[i] = w;
    return out;
  }
  // manual_pct: clamp negatives, normalise to sum 1.0.
  const dist = schedule.distribution ?? [];
  const cleaned = new Array<number>(span).fill(0);
  for (let i = 0; i < span; i++) cleaned[i] = Math.max(0, dist[i] ?? 0);
  const sum = cleaned.reduce((s, v) => s + v, 0);
  if (sum < 1e-9) {
    const w = 1 / span;
    for (let i = start; i <= end; i++) out[i] = w;
    return out;
  }
  for (let i = 0; i < span; i++) out[start + i] = cleaned[i] / sum;
  return out;
}

// ── M2.0d: Stage / Scope auto-derivation ──────────────────────────────────
// The M2.0d Costs UI hides Stage + Scope dropdowns from the standard 9-line
// catalog (the user's request: "Stage and Scope shouldn't be user input,
// should be rule-derived"). Custom user-added lines retain a user-picked
// stage at create time (the popup form requires it). These helpers are
// the single source of truth so the UI tooltips and the calc engine agree.

const STANDARD_STAGE_BY_ID: Record<string, CostStage> = {
  'land-cash':            'land',
  'land-inkind':          'land',
  // 2026-08-15: a transfer tax is a cost of acquiring the land, so it buckets
  // with land rather than with soft costs.
  'rett':                 'land',
  // 2026-08-16: marketing is a SELLING cost, not a construction cost, so it
  // buckets on its own and stays out of "construction cost excluding land".
  'marketing':            'marketing',
  'construction-bua':     'hard',
  'construction-parking': 'hard',
  'infrastructure':       'hard',
  'landscaping':          'hard',
  // 2026-08-17: SOFT, not operating. The map and the catalog seed had disagreed
  // since the map was written (the seed has always said 'soft'), and because
  // the engine's stage rollup read the raw `line.stage` while the row badge,
  // the stage filter and deriveCostType read this map, one line was soft in the
  // Capex-by-Stage table and operating everywhere else. Pre-operating is a
  // development cost incurred before operations begin, and soft is what the
  // catalog already seeds, so settling on soft moves the fewest surfaces: the
  // stage rollup is unchanged and the badge / filter / cost type now agree
  // with it.
  'pre-operating':        'soft',
  'professional-fee':     'soft',
  'commission':           'soft',
  // 2026-08-17: new to the catalog. A developer fee is a soft cost.
  'developer-fee':        'soft',
  'contingency':          'soft',
};

export function deriveCostStage(line: CostLine): CostStage {
  // 2026-08-17: the USER'S OWN classification outranks everything. Rows can be
  // added, renamed and deleted, so the catalog's answer is a default, not a
  // fact, and a modeller must be able to say that a line is marketing.
  //
  // `stageOverride` is a separate field rather than a write to `stage` on
  // purpose: the id map below outranks `stage`, and that precedence is how the
  // 2026-08-16 reclassification of marketing reached every already-saved
  // project with no migration. See the field's own note in module1-types.
  if (line.stageOverride) return line.stageOverride;
  // Standard line -> id-derived. Custom line -> user-picked stage on
  // the line (set when the popup added it). Fallback: stored stage.
  // M2.0L (2026-05-11): ids are now phase-scoped (`baseId__phaseId`);
  // strip the suffix before looking up the stage map. Legacy bare ids
  // still resolve via the same map.
  const baseId = deriveLineBaseId(line.id);
  return STANDARD_STAGE_BY_ID[baseId] ?? STANDARD_STAGE_BY_ID[line.id] ?? line.stage;
}

export function deriveCostScope(line: CostLine): CostScope {
  // Per-asset allocations are direct to that asset. Project-level
  // allocations (bua_share, gfa_share, land_share, category) are
  // indirect (allocated across assets). Manual is treated as direct
  // because the user supplies explicit per-asset values.
  if (line.allocationBasis === 'per_asset' || line.allocationBasis === 'manual') {
    return 'direct';
  }
  return 'indirect';
}

// M2.0L Pass 5 (2026-05-11): auto-derived Cost Type. Internal, not
// user-visible. Powers Results tables + future M5 benchmark callouts.
//   - method === 'percent_of_cash_land'   -> land_cash
//   - method === 'percent_of_inkind_land' -> land_in_kind
//   - stage === 'operating'               -> operating
//   - stage === 'soft'                    -> soft
//   - everything else (default hard stage) -> hard
export function deriveCostType(line: CostLine): CostType {
  if (line.method === 'percent_of_cash_land')   return 'land_cash';
  if (line.method === 'percent_of_inkind_land') return 'land_in_kind';
  const stage = deriveCostStage(line);
  if (stage === 'operating') return 'operating';
  if (stage === 'soft')      return 'soft';
  // 2026-08-16: the marketing stage maps to the SOFT cost type. CostType is a
  // coarser internal classification with no marketing member, and the default
  // branch below returns 'hard', which would have made a selling cost read as
  // a hard cost anywhere CostType is consulted. Soft is the honest nearest
  // neighbour; the stage carries the finer distinction.
  if (stage === 'marketing') return 'soft';
  return 'hard';
}

// M2.0L Pass 5: resolved category + driver for a line. Helpers used
// by computeAssetCost to route Direct vs Allocated math.
export function resolveCostCategory(line: CostLine): CostCategory {
  return line.costCategory ?? 'direct';
}

export function resolveCostDriver(line: CostLine): CostDriver {
  return line.costDriver ?? 'bua_share';
}

// M2.0L Pass 5: given an allocated line + its driver, compute the
// asset's share of the project-wide pool. Direct lines never call this
// (they ignore driver). value_share currently falls back to bua_share
// until M2.1 Revenue ships a per-asset projected value; documented as
// a known limitation.
export function resolveDriverFactor(
  driver: CostDriver,
  asset: Asset,
  phaseAssets: Asset[],
  parcels: Parcel[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  // Same degenerate-denominator fallback as resolveAllocationFactor: an
  // Allocated line's pool must reach the assets even when its driver quantity
  // is zero, or the pool is silently dropped. See equalPhaseShare.
  if (driver === 'bua_share') {
    const myBua = computeAssetBua(asset, subUnits);
    const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
    return totalBua > 0 ? myBua / totalBua : equalPhaseShare(asset, phaseAssets);
  }
  if (driver === 'land_share') {
    const myLand = computeAssetLandSqm(asset, parcels, phaseAssets, subUnits, mode);
    const totalLand = phaseAssets.reduce(
      (s, a) => s + computeAssetLandSqm(a, parcels, phaseAssets, subUnits, mode),
      0,
    );
    return totalLand > 0 ? myLand / totalLand : equalPhaseShare(asset, phaseAssets);
  }
  // value_share: deferred to bua_share until M2.1 Revenue lands so the
  // asset's projected value is computable without a circular dependency
  // on costs.
  const myBua = computeAssetBua(asset, subUnits);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  return totalBua > 0 ? myBua / totalBua : equalPhaseShare(asset, phaseAssets);
}

// ── M2.0d: Useful life resolution ─────────────────────────────────────────
// Asset.usefulLifeYears is optional; when undefined, fall back by strategy.
// Sell + Sell + Manage technically don't depreciate (the asset is sold), but
// returning a sane number lets callers compute a hypothetical schedule for
// what-if analysis without divide-by-zero hazards.
export function resolveUsefulLifeYears(asset: Asset): number {
  if (asset.usefulLifeYears && asset.usefulLifeYears > 0) return asset.usefulLifeYears;
  switch (asset.strategy) {
    case 'Operate':       return DEFAULT_USEFUL_LIFE_YEARS.hospitality;
    case 'Lease':         return DEFAULT_USEFUL_LIFE_YEARS.retail;
    case 'Sell':          return DEFAULT_USEFUL_LIFE_YEARS.residential;
    case 'Sell + Manage': return DEFAULT_USEFUL_LIFE_YEARS.residential;
    default:              return DEFAULT_USEFUL_LIFE_YEARS.default;
  }
}

// ── M2.0d: Capex classification by accounting treatment ───────────────────
// All cost lines (Land, Construction BUA, Construction Parking, Infrastructure,
// Landscaping, Pre-operating, Professional Fee, Commission, Contingency,
// custom) get CAPITALIZED into the asset's total cost basis. None are
// expensed during construction.
//
// Strategy determines where the capitalized basis lands:
//   - Sell:          COGS at unit sale (proportional to sellable BUA sold)
//   - Operate:       Fixed Assets, depreciated over usefulLifeYears
//   - Lease:         Fixed Assets, depreciated over usefulLifeYears
//   - Sell + Manage: COGS at unit sale (developer doesn't own units
//                    post-sale; no Fixed Assets, no depreciation)
//
// Land is NEVER depreciated regardless of strategy, so the depreciation
// base subtracts landTotal even when the rest of the basis depreciates.
//
// Module 5 (Statements) consumes this. Module 2 (Revenue) decides the
// pace at which Sell-strategy COGS recognises against unit sales.
export interface AssetCapexClassification {
  strategy: AssetStrategy;
  capexBasis: number;       // total capitalized basis = sum of all cost lines
  cogs: number;             // COGS-eligible portion (Sell + Sell+Manage)
  fixedAssets: number;      // Fixed Assets portion (Operate + Lease)
  depreciationBase: number; // capex minus landTotal (for Operate / Lease)
  annualDepreciation: number; // depreciationBase / usefulLifeYears
  usefulLifeYears: number;
  landTotal: number;        // pass-through, not deducted from basis
}

export function classifyAssetCapex(
  asset: Asset,
  capexBasis: number,
  landTotal: number,
): AssetCapexClassification {
  const usefulLifeYears = resolveUsefulLifeYears(asset);
  const safeLand = Math.max(0, landTotal);
  const safeBasis = Math.max(0, capexBasis);
  const isSellish = asset.strategy === 'Sell' || asset.strategy === 'Sell + Manage';
  if (isSellish) {
    return {
      strategy: asset.strategy,
      capexBasis: safeBasis,
      cogs: safeBasis,
      fixedAssets: 0,
      depreciationBase: 0,
      annualDepreciation: 0,
      usefulLifeYears,
      landTotal: safeLand,
    };
  }
  // Operate / Lease: capitalize into Fixed Assets, depreciate non-land.
  const depreciationBase = Math.max(0, safeBasis - safeLand);
  const annualDepreciation = usefulLifeYears > 0 ? depreciationBase / usefulLifeYears : 0;
  return {
    strategy: asset.strategy,
    capexBasis: safeBasis,
    cogs: 0,
    fixedAssets: safeBasis,
    depreciationBase,
    annualDepreciation,
    usefulLifeYears,
    landTotal: safeLand,
  };
}

// ── M2.0d: Cash flow impact (in-kind equity segregation) ───────────────────
// Land in-kind portion is part of the capex basis (the asset's total cost
// basis still includes the in-kind land), but it does NOT consume cash.
// Instead, it shows up as Equity-In-Kind contribution in Tab 4 Financing.
//
// For each asset:
//   capexBasis             = total capitalized basis (from computeAssetCost)
//   landInKindPortion      = asset's slice of parcels.inKindValue (from
//                            resolveAssetAreaMetrics.inKindLandValue)
//   cashOutflow            = capexBasis - landInKindPortion  (Cash Flow line)
//   equityInKind           = landInKindPortion              (Equity-in-kind)
//
// Module 5 (Cash Flow + Statements) reads this. The total "Equity (cash +
// in-kind)" line in Tab 4 Financing summary aggregates equityInKind across
// every asset.
export interface AssetCashFlowImpact {
  capexBasis: number;
  cashOutflow: number;
  equityInKind: number;
}

export function computeCashFlowImpact(
  capexBasis: number,
  landInKindPortion: number,
): AssetCashFlowImpact {
  const safeBasis = Math.max(0, capexBasis);
  const safeInKind = Math.max(0, Math.min(landInKindPortion, safeBasis));
  return {
    capexBasis: safeBasis,
    cashOutflow: Math.max(0, safeBasis - safeInKind),
    equityInKind: safeInKind,
  };
}

// ── M2.0e: Per-phase timeline ─────────────────────────────────────────────
// When phase.startDate is set (M2.0e wizard captures it per phase),
// computePhaseTimeline returns concrete construction / operations dates
// derived from the phase's own start. When unset (legacy snapshots),
// falls back to project.startDate + (constructionStart - 1) periods so
// the project-level seed continues to seed phase 1's first day.
//
// Period unit follows project.modelType: 'monthly' = +N months, 'annual'
// = +N years. operationsStart precedes the phase's constructionEnd by
// overlapPeriods so that, e.g., Tower A can begin selling while Tower B
// is still under construction.
export interface PhaseTimeline {
  constructionStart: string;  // ISO date (phase's own startDate or fallback)
  constructionEnd:   string;
  operationsStart:   string;
  operationsEnd:     string;
}

function addPeriods(isoDate: string, n: number, modelType: Project['modelType']): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  if (modelType === 'monthly') d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

// M2.0g Fix 1 (2026-05-06): end-of-period date helper. Returns the
// LAST DAY of the period span: (start + periods periods) - 1 day.
// For Jan 1 starts this gives Dec 31 of the last year (annual) or
// the last day of the last month (monthly), matching standard
// accounting end-of-period convention. For mid-year starts the
// result is exactly 1 day before the next period would begin.
//
// Examples:
//   periodEndDate('2025-01-01', 4, 'annual')   -> '2028-12-31'
//   periodEndDate('2025-01-01', 48, 'monthly') -> '2028-12-31'
//   periodEndDate('2027-06-01', 3, 'annual')   -> '2030-05-31'
export function periodEndDate(startIso: string, periods: number, modelType: Project['modelType']): string {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return startIso;
  const safe = Math.max(0, periods);
  if (safe === 0) return startIso;
  // Step 1: jump forward by periods periods (lands on start of next period).
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (modelType === 'annual') next.setUTCFullYear(next.getUTCFullYear() + safe);
  else next.setUTCMonth(next.getUTCMonth() + safe);
  // Step 2: subtract 1 day to land on the period's last day.
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

// M2.0g Fix 1: operations start = day after construction end. For
// annual: Jan 1 of (constructionEnd.year + 1). For monthly: 1st of
// (constructionEnd.month + 1).
function addOneDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * THE AXIS INDEX AT WHICH A PHASE'S OPERATIONS BEGIN, and therefore the period
 * from which its assets may be depreciated (2026-08-19).
 *
 * ONE definition, because there were two and both were wrong the same way. The
 * fixed-asset resolver and the IDC depreciation block each derived a start by
 * hand as `offset + cp - 1`, the LAST CONSTRUCTION period. That index is the M2
 * PIT REVENUE-RECOGNITION handover, a deliberate and verifier-pinned convention
 * for when a unit is handed to a BUYER, reused to answer when an asset may be
 * DEPRECIATED. Fixing one copy left the other charging a full year of IDC
 * depreciation during construction, which is how the defect survived its first
 * fix and was reported a second time.
 *
 * IT WORKS IN PERIODS, NOT DATES, and that is deliberate. The obvious
 * implementation reads `computePhaseTimeline().operationsStart` and differences
 * the YEARS. That is wrong for any model that is not annual:
 * `computePhaseTimeline` defaults to MONTHLY when `project.modelType` is absent,
 * so a four-period construction resolves to four MONTHS and the index collapses
 * to zero. The first version of this helper did exactly that and the verifier
 * fixture caught it. Every caller already holds the phase offset in axis
 * periods, so the arithmetic belongs in the same unit.
 *
 * The rule is `computePhaseTimeline`'s, expressed in periods:
 *
 *   cp === 0            operations begin at the phase start, nothing to follow
 *   overlapPeriods > 0  operations begin BEFORE construction ends, so the first
 *                       operating period is EARLIER than `offset + cp`
 *   otherwise           the period after construction ends
 *
 * The result may be at or past `axisLength`, which is correct and deliberate: a
 * phase opening beyond the model horizon depreciates nothing, and the engine
 * already returns zeros for a start past the axis. Clamping to the last period
 * would charge a year of depreciation for an asset that never opens.
 */
export function operationsStartIndex(phase: Phase, phaseOffsetPeriods: number): number {
  const offset = Math.max(0, phaseOffsetPeriods);
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  if (cp === 0) return offset;
  const overlap = Math.max(0, Math.min(cp, phase.overlapPeriods ?? 0));
  return Math.max(offset, offset + cp - overlap);
}

export function computePhaseTimeline(phase: Phase, project: Project): PhaseTimeline {
  const fallbackOffsetPeriods = Math.max(0, phase.constructionStart - 1);
  const start = phase.startDate && phase.startDate.length === 10
    ? phase.startDate
    : addPeriods(project.startDate, fallbackOffsetPeriods, project.modelType);
  // M2.0g Fix 1: end dates use periodEndDate (Dec 31 / last day of
  // month) instead of addPeriods which gave start-of-next-period.
  const cp = Math.max(0, phase.constructionPeriods);
  const constructionEnd = periodEndDate(start, cp, project.modelType);
  // M2.0j Fix 1: when constructionPeriods === 0 the phase is operational
  // from the start; operations begin exactly on phase.startDate (no
  // addOneDay or overlap math, since there's nothing to overlap).
  let operationsStart: string;
  if (cp === 0) {
    operationsStart = start;
  } else {
    // Operations start = day after construction end, minus overlap periods.
    const opsStartAfterConstruction = addOneDay(constructionEnd);
    operationsStart = phase.overlapPeriods > 0
      ? addPeriods(opsStartAfterConstruction, -phase.overlapPeriods, project.modelType)
      : opsStartAfterConstruction;
  }
  const operationsEnd = periodEndDate(operationsStart, Math.max(0, phase.operationsPeriods), project.modelType);
  return { constructionStart: start, constructionEnd, operationsStart, operationsEnd };
}

// Project-wide timeline = min(phase.constructionStart) -> max(phase.operationsEnd).
// "span" returned in the project's modelType units for caption use.
//
// M2.0f Fix 5 (2026-05-06): adds explicit `startDate` / `endDate` /
// `endYear` / `totalPeriods` fields. The pre-M2.0f shape exposed
// `start` / `end` / `spanPeriods` only; callers wanting the inclusive
// "Project End = 2039" caption had to compute getFullYear() themselves
// (and a few callers happened to add +1 turning 2039 into 2040). Now
// endYear is the single source of truth: getFullYear() with no offset.
// Legacy fields kept as aliases so M2.0e callers / verifiers continue
// to compile.
export interface ProjectTimeline {
  /** M2.0f: ISO date of the earliest phase start. */
  startDate: string;
  /** M2.0f: ISO date of the latest phase operations end. */
  endDate: string;
  /** M2.0f: endDate.getFullYear() with NO +1 offset. Display caption. */
  endYear: number;
  /** M2.0f: total span in modelType units (rename of spanPeriods). */
  totalPeriods: number;

  // ── Legacy aliases (kept stable for M2.0e callers) ────────────────
  /** Legacy alias for startDate. */
  start: string;
  /** Legacy alias for endDate. */
  end: string;
  /** Legacy alias for totalPeriods. */
  spanPeriods: number;
}

export function computeProjectTimeline(project: Project, phases: Phase[]): ProjectTimeline {
  if (phases.length === 0) {
    return {
      startDate: project.startDate,
      endDate:   project.startDate,
      endYear:   new Date(project.startDate).getFullYear() || 0,
      totalPeriods: 0,
      start:        project.startDate,
      end:          project.startDate,
      spanPeriods:  0,
    };
  }
  const tls = phases.map((p) => computePhaseTimeline(p, project));
  const startMs = Math.min(...tls.map((t) => new Date(t.constructionStart).getTime()));
  const endMs   = Math.max(...tls.map((t) => new Date(t.operationsEnd).getTime()));
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const endDate   = new Date(endMs).toISOString().slice(0, 10);
  // Total span in modelType units.
  const startD = new Date(startDate);
  const endD   = new Date(endDate);
  let totalPeriods = 0;
  if (project.modelType === 'monthly') {
    totalPeriods = (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth());
  } else {
    totalPeriods = endD.getFullYear() - startD.getFullYear();
  }
  totalPeriods = Math.max(0, totalPeriods);
  // M2.0f Fix 5: endYear comes straight from endDate.getFullYear() with
  // no +1 / no rounding. For phase startDate=2025-01-01, construction=4,
  // operations=10, overlap=0 the chain produces endDate=2039-01-01 and
  // endYear=2039 (the inclusive "Project End" caption).
  const endYear = endD.getFullYear() || 0;
  return {
    startDate,
    endDate,
    endYear,
    totalPeriods,
    start:       startDate,
    end:         endDate,
    spanPeriods: totalPeriods,
  };
}

// ── Project end date ───────────────────────────────────────────────────────
// M2.0g Fix 1 (2026-05-06): delegates to computePhaseTimeline so the
// end-of-period convention (Dec 31 of last year, last day of last
// month) flows through to the project-end caption. Pre-M2.0g this
// returned a "start of next period" date (e.g. 2040-01-01) that
// confused downstream readers. Now (start 2025-01-01, 4 + 10 = 14 yrs)
// returns 2038-12-31.
export function computeProjectEndDate(project: Project, phases: Phase[]): string {
  if (phases.length === 0) return project.startDate;
  let endIso = project.startDate;
  for (const phase of phases) {
    const tl = computePhaseTimeline(phase, project);
    if (tl.operationsEnd > endIso) endIso = tl.operationsEnd;
  }
  return endIso;
}

// ── M2.0h Fix 5: Per-sub-unit custom cost rates breakdown ─────────────────
// Returns the resolved row list (sub-unit + Support + Parking) with each
// row's area, rate, and total. Used by the Cost row sub-table UI in
// Module1Costs and by the verifier's reference example assertion.
export interface CostLinePerSubUnitRow {
  key: string;          // sub-unit id, or '__support__' / '__parking__'
  label: string;        // display label
  category?: string;    // sub-unit category for ordering (Sellable / Operable / Leasable / Support)
  area: number;
  rate: number;
  total: number;
}

export interface CostLinePerSubUnitBreakdown {
  rows: CostLinePerSubUnitRow[];
  totalCost: number;
}

export function computeCostLinePerSubUnit(
  line: CostLine,
  asset: Asset,
  subUnits: SubUnit[],
): CostLinePerSubUnitBreakdown {
  const rates = line.perSubUnitRates ?? {};
  const defaultRate = Math.max(0, line.value ?? 0);
  const my = subUnits.filter((u) => u.assetId === asset.id);
  const rows: CostLinePerSubUnitRow[] = [];
  // Sub-unit rows (in the order they appear in subUnits).
  for (const u of my) {
    const area = computeSubUnitArea(u, asset);
    if (area <= 0) continue;
    const rate = Math.max(0, rates[u.id] ?? defaultRate);
    rows.push({
      key: u.id,
      label: `${u.name || 'Sub-unit'} (${u.category})`,
      category: u.category,
      area,
      rate,
      total: area * rate,
    });
  }
  // Asset-level Support row (separate from any Support sub-unit).
  const aSupport = Math.max(0, asset.supportArea ?? 0);
  if (aSupport > 0) {
    const rate = Math.max(0, rates[PER_SUBUNIT_RATE_KEY_SUPPORT] ?? defaultRate);
    rows.push({
      key: PER_SUBUNIT_RATE_KEY_SUPPORT,
      label: 'Support Area (asset-level)',
      area: aSupport,
      rate,
      total: aSupport * rate,
    });
  }
  // Asset-level Parking row.
  const aParking = Math.max(0, asset.parkingArea ?? 0);
  if (aParking > 0) {
    const rate = Math.max(0, rates[PER_SUBUNIT_RATE_KEY_PARKING] ?? defaultRate);
    rows.push({
      key: PER_SUBUNIT_RATE_KEY_PARKING,
      label: 'Parking Area (asset-level)',
      area: aParking,
      rate,
      total: aParking * rate,
    });
  }
  const totalCost = rows.reduce((s, r) => s + r.total, 0);
  return { rows, totalCost };
}

// ── M2.0h Fix 6: Runtime granularity transformation ───────────────────────
// All inputs in v8 are entered annually. For display, the user can
// toggle output granularity to quarterly (4× per year) or monthly (12×
// per year). distributeAnnualToPeriods takes an annual value array (one
// entry per project year) and a phasing curve, and returns a per-period
// array at the chosen granularity by applying the same phasing curve at
// the sub-period level within each year.
//
// 'annual' returns the input unchanged (no transform).
// 'quarterly' returns 4 sub-periods per year using `distribute(phasing, 4)`.
// 'monthly'   returns 12 sub-periods per year using `distribute(phasing, 12)`.
//
// When phasing === 'manual' on annual inputs we cannot guess a per-month
// curve, so we fall back to 'even' inside each year. The user retains
// the option to pick S-curve / front-loaded / back-loaded and have the
// curve applied to the sub-periods.
export function distributeAnnualToPeriods(
  annualValues: number[],
  granularity: OutputGranularity,
  phasing: CostPhasing = 'even',
): number[] {
  if (granularity === 'annual') return [...annualValues];
  const sub = granularity === 'quarterly' ? 4 : 12;
  // Manual annual inputs map to even within-year for the sub-periods.
  const subPhasing: CostPhasing = phasing === 'manual' ? 'even' : phasing;
  const out: number[] = [];
  const subWeights = distribute(subPhasing, sub);
  for (const annual of annualValues) {
    for (let i = 0; i < sub; i++) {
      out.push(annual * (subWeights[i] ?? 0));
    }
  }
  return out;
}

// formatPeriodLabel: column header for a period date at given granularity.
// 'annual'    -> 'Dec 25'
// 'quarterly' -> 'Q1 25', 'Q2 25', ...
// 'monthly'   -> 'Jan 25', 'Feb 25', ...
//
// The inputDate is interpreted as the LAST DAY of the period (end-of-
// period convention from M2.0g Fix 1). For mid-year quarters we map the
// month back to the quarter index (Mar -> Q1, Jun -> Q2, etc.).
export function formatPeriodLabel(
  inputDate: string,
  granularity: OutputGranularity,
): string {
  const d = new Date(inputDate);
  if (Number.isNaN(d.getTime())) return inputDate;
  const yy = String(d.getUTCFullYear()).slice(-2);
  if (granularity === 'annual') return `Dec ${yy}`;
  if (granularity === 'quarterly') {
    const qIdx = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${qIdx} ${yy}`;
  }
  // monthly
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${yy}`;
}

// computeOperationalRunRate: roll forward the last-12-months revenue
// and opex from the historical baseline to a target reporting period
// using simple compound growth. Defaults: 3% revenue growth, 2% opex
// growth (the spec calls them "overridable per asset"; today we apply
// the same rate uniformly, callers can pass overrides).
export interface OperationalRunRatePoint {
  period: number;           // 0-indexed reporting period
  revenue: number;
  opex: number;
}

export function computeOperationalRunRate(
  baseline: { last12MonthsRevenue: number; last12MonthsOpex: number },
  period: number,
  revenueGrowthPct = 3,
  opexGrowthPct    = 2,
): OperationalRunRatePoint {
  const safePeriod = Math.max(0, period);
  const revenue = Math.max(0, baseline.last12MonthsRevenue) * Math.pow(1 + revenueGrowthPct / 100, safePeriod);
  const opex    = Math.max(0, baseline.last12MonthsOpex)    * Math.pow(1 + opexGrowthPct    / 100, safePeriod);
  return { period: safePeriod, revenue, opex };
}

/**
 * WHAT A RATE LINE CHARGES ON, WITHOUT THE RATE (2026-09-11).
 *
 * ONE definition, read twice: by the caption below, for the plot a user is
 * looking at, and by the Costs screen for the CONSOLIDATION LINE's pooled
 * figure beside it, so the two can never state the quantity two ways.
 *
 * A RATE IS NEVER APPLIED TO THE POOLED FIGURE, and this returns no rate so it
 * cannot be. Two plots on one line can carry different per-asset overrides, so
 * a pooled rate x quantity would name a number the engine never charged, which
 * is the defect the revenue-basis captions were fixed for on 2026-08-19.
 *
 * THE TWO OUTER TIERS ARE THE ASSETS TAB'S, AND THEY CROSS. Platform gfa is
 * nsa + support + parking, which that tab calls TOTAL BUA; platform bua is
 * nsa + support, which it calls TOTAL GFA. The method labels and the export
 * basis column were corrected on 2026-09-11 (06aded4c); this caption was a
 * FOURTH surface and was missed, so until now the Costs screen called
 * rate_per_gfa "Total GFA" while the picker directly above it called the same
 * method "Rate x Total BUA" and charged the outermost tier.
 * verify-capex-structure P4h proves the arithmetic; P4i ties this caption to
 * the same sums.
 *
 * Returns null for a method with no quantity to state: a fixed lump, the
 * percent family (whose basis is money, not an area), the retired roads area
 * and the two sub-unit methods.
 */
export interface CostLineBasisQuantity {
  /** What the rate multiplies. */
  value: number;
  /** The unit, in the words the assets tab uses. */
  unit: string;
  /** What to name when the quantity is zero. */
  missing: string;
  /** True for the three figures the area chain derives and no field holds, so
   *  "not defined yet" would send a reader looking for an input that does not
   *  exist. */
  derived?: boolean;
}
export function costLineBasisQuantity(
  method: CostMethod | undefined,
  metrics: AssetAreaMetrics,
  fallbacks: { parkingBays: number; supportArea?: number; parkingArea?: number },
): CostLineBasisQuantity | null {
  const or0 = (a: number, b: number | undefined): number => Math.max(0, a > 0 ? a : (b ?? 0));
  switch (method) {
    case 'rate_per_land': return { value: metrics.landSqm, unit: 'sqm Plot Area', missing: 'Plot area' };
    case 'rate_per_nda': return { value: metrics.ndaSqm, unit: 'sqm Plot Area (legacy NDA method)', missing: 'Land area' };
    case 'rate_per_gfa': return { value: metrics.gfa, unit: 'sqm Total BUA', missing: 'Total BUA' };
    case 'rate_per_bua': return { value: metrics.bua, unit: 'sqm Total GFA', missing: 'Total GFA' };
    case 'rate_per_nsa': return { value: metrics.nsa, unit: 'sqm NSA or GLA', missing: 'NSA or GLA' };
    case 'rate_per_unit': return { value: metrics.unitCount, unit: 'units', missing: 'Unit count' };
    case 'rate_per_parking_bay': return { value: Math.max(0, fallbacks.parkingBays), unit: 'parking bays', missing: 'Parking bays' };
    case 'rate_x_support_area': return { value: or0(metrics.supportArea, fallbacks.supportArea), unit: 'sqm Support', missing: 'Support area' };
    case 'rate_x_parking_area': return { value: or0(metrics.parkingArea, fallbacks.parkingArea), unit: 'sqm Parking', missing: 'Parking area' };
    case 'rate_x_net_developable_area': return { value: metrics.netDevelopableArea, unit: 'sqm Net Developable Area', missing: 'Net developable area', derived: true };
    case 'rate_x_footprint_area': return { value: metrics.footprintArea, unit: 'sqm Building Footprint', missing: 'Building footprint', derived: true };
    case 'rate_x_landscape_area': return { value: metrics.landscapeArea, unit: 'sqm Landscape and Open Area', missing: 'Landscape and open area', derived: true };
    case 'rate_x_main_asset_gfa': return { value: metrics.mainAssetGfa, unit: 'sqm Main Asset GFA', missing: 'Main asset GFA', derived: true };
    case 'rate_x_retail_parking_area': return { value: metrics.retailParkingArea, unit: 'sqm Retail Parking', missing: 'Retail parking (charged on the retail strip, 0 on a host)' };
    case 'rate_x_retail_gfa': return { value: metrics.retailGfa, unit: 'sqm Retail GFA', missing: 'Retail GFA (charged on the retail strip, 0 on a host)' };
    default: return null;
  }
}

// ── M2.0j Fix 8: Cost line caption ────────────────────────────────────────
// Returns a human-readable formula caption describing how a cost line's
// total resolves for a given asset. Renders inline below the value
// input so the user can verify "× 130,874 sqm BUA = 588,933,000 SAR"
// at a glance without leaving Tab 3.
export interface CostLineCaptionInput {
  line: CostLine;
  override?: { method?: CostMethod; value?: number };
  asset: Asset;
  metrics: AssetAreaMetrics;
  parkingBays: number;
  resolvedTotal: number;       // already-computed asset's contribution to this line
  // Optional, for percent_of_selected and per_sub_unit_custom_rates only.
  selectedTotal?: number;
  perSubUnitRows?: number;
  /**
   * The revenue bases the engine charged on (2026-08-19), so the caption states
   * the SAME figure the maths used. Before this it printed
   * `metrics.totalRevenue` whatever the method, which is now the FALLBACK only,
   * so a caption could name a number the engine had not used.
   */
  /** The revenue snapshot, so the caption states the SAME basis the engine
   *  charged on rather than a figure the maths did not use. */
  revenue?: RevenueSource;
}

// M2.0M Pass 9 Fix 5 (2026-05-12): caption drops the trailing
// "= result" part. The Total column already shows the resolved
// number; the caption only carries the formula (multiplier x metric)
// or the "no X defined yet" warning. Cleaner display, less duplication.
export function costLineCaption(input: CostLineCaptionInput): string {
  const { line, override, asset, metrics, parkingBays, resolvedTotal: _resolvedTotal, selectedTotal, perSubUnitRows,
    revenue } = input;
  void _resolvedTotal; // retained on interface for API stability; no longer used in caption.
  const method = override?.method ?? line.method;
  const value = override?.value ?? line.value;
  const fmt = (n: number, d = 0): string => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '0';
  const fmtArea = (n: number): string => fmt(n, 0);
  const fmtMoney = (n: number): string => fmt(n, 0);
  // M2.0L Fix 4 (2026-05-11): when the area metric is 0 for an area-
  // driven method, surface a "no X defined yet" warning so the user
  // knows to add sub-units / set the asset-level input rather than
  // wondering why the total is 0.
  const noArea = (label: string): string => `${fmt(value, 2)} x - (no ${label} defined yet)`;
  // A CHAIN-ONLY FIGURE HAS NO FIELD TO DEFINE (2026-09-11), so 'not defined
  // yet' sends a reader looking for an input that does not exist. Landscape,
  // footprint and net developable area come from the area chain and reach the
  // engine only through the derived bag, which is written when a project opts
  // in. Measured: all three are ZERO on every asset of both live projects,
  // because neither has opted in, so the method is selectable and multiplies
  // nothing. The line says which switch to throw, the way the retired roads
  // method says why it charges nothing.
  const noDerived = (label: string): string =>
    `${fmt(value, 2)} x - (${label} is derived by the area chain on the assets tab; this plot states no chain inputs, so there is nothing to derive it from)`;
  // THE QUANTITY IS RESOLVED ONCE, by the shared rule above, so this caption
  // and the pooled line figure beside it cannot name two different areas.
  const q = costLineBasisQuantity(method, metrics, {
    parkingBays,
    supportArea: asset.supportArea,
    parkingArea: resolveAssetParkingArea(asset),
  });
  if (q) {
    if (q.value > 0) return fmt(value, 2) + ' x ' + fmtArea(q.value) + ' ' + q.unit;
    // A RETAIL STRIP HAS NO CHAIN OF ITS OWN (2026-09-12), so 'states no chain
    // inputs' would send its reader to a plot row it does not have. Its floor
    // area is the Retail GFA its hosts derived, and that is the method to pick.
    if (q.derived === true && isRetailCompanion(asset)) {
      return `${fmt(value, 2)} x - (${q.missing} is 0 on a retail strip, which has no chain of its own; its floor area is its Retail GFA, priced by Rate \u00d7 Retail GFA)`;
    }
    return q.derived === true ? noDerived(q.missing) : noArea(q.missing);
  }
  switch (method) {
    case 'fixed':
      return 'Fixed';
    // SAYS SO RATHER THAN PRINTING A CONFIDENT ZERO. The roads area is retired,
    // so this line charges nothing, and a reader is told why instead of being
    // shown a 0 that looks like a rate nobody filled in.
    case 'rate_per_roads':
      return `${fmt(value, 2)} x 0 (the roads area is retired; this line charges nothing)`;
    case 'rate_x_specific_subunit':
      return _resolvedTotal > 0 ? 'Rate x specific sub-unit' : noArea('selected sub-unit');
    case 'per_sub_unit_custom_rates':
      return (perSubUnitRows ?? 0) > 0 ? `Sum of ${perSubUnitRows ?? 0} sub-unit rows` : noArea('sub-unit rates');
    case 'percent_of_selected':
      return `${fmt(value, 2)}% x ${fmtMoney(selectedTotal ?? 0)} (selected lines)`;
    case 'percent_of_construction':
      return `${fmt(value, 2)}% x construction subtotal`;
    case 'percent_of_total_land':
      if (metrics.landValue <= 0) {
        return metrics.landSqm > 0
          ? noArea('parcel rate')
          : noArea('land allocation');
      }
      return `${fmt(value, 2)}% x ${fmtMoney(metrics.landValue)} (land value)`;
    case 'percent_of_cash_land': {
      // T3-regr-2 Fix 3 (2026-05-12): caption shows the value (percent)
      // applied to the asset's cash land share, per brief format:
      // "100% of 1,737,918,160 (this asset's cash land share)".
      if (metrics.cashLandValue <= 0) {
        if (metrics.landSqm <= 0) return noArea('land allocation to this asset');
        if (metrics.landValue <= 0) return noArea('parcel rate');
        return `${fmt(value, 2)}% of ${fmtMoney(0)} (cash portion = 0; check parcel cashPct)`;
      }
      return `${fmt(value, 2)}% of ${fmtMoney(metrics.cashLandValue)} (this asset's cash land share)`;
    }
    case 'percent_of_total_revenue':
    case 'percent_of_revenue_cash':
    case 'percent_of_revenue_sale': {
      // THE CAPTION NAMES THE FIGURE THE ENGINE USED (2026-08-19), and each of
      // THE CAPTION READS THE SAME RESOLVER THE ENGINE DOES, so it cannot name a
      // figure the maths did not use.
      const b = resolveSellingCostBasis(
        revenue, asset.id, method, metrics.totalRevenue, !assetStrategySells(asset.strategy),
      );
      // ZERO IS AN ANSWER, NOT AN ABSENCE, and the two need different captions.
      if (b.amount <= 0) {
        if (b.reason === 'no_sale_on_held_asset') {
          return `${fmt(value, 2)}% of 0 (no sale value: this asset is held, not sold)`;
        }
        return noArea('asset revenue (set sub-unit metric x price in Tab 2)');
      }
      return `${fmt(value, 2)}% of ${fmtMoney(b.amount)} (${b.label})`;
    }
    case 'percent_of_inkind_land': {
      if (metrics.inKindLandValue <= 0) {
        if (metrics.landSqm <= 0) return noArea('land allocation to this asset');
        if (metrics.landValue <= 0) return noArea('parcel rate');
        return `${fmt(value, 2)}% of ${fmtMoney(0)} (in-kind portion = 0; check parcel inKindPct)`;
      }
      return `${fmt(value, 2)}% of ${fmtMoney(metrics.inKindLandValue)} (this asset's in-kind land share)`;
    }
    default:
      return '';
  }
}

// ── M2.0j Fix 10: Period date alignment to phase start ────────────────────
// Cost lines on a phase have Start/End periods relative to the PHASE
// start date, not the project start date. This helper returns the
// end-of-period date for a given period index measured from the phase's
// start, used to render the small caption under Start / End cells.
export function costLinePeriodEndDate(
  phase: Phase,
  project: Project,
  periodIndex: number,
): string {
  const phaseStart = phase.startDate && phase.startDate.length === 10
    ? phase.startDate
    : project.startDate;
  return periodEndDate(phaseStart, Math.max(0, periodIndex), project.modelType);
}

// For project-wide tables (Capex by Period), each cost line on a phase
// must allocate to the project period that maps to (phaseStartYear -
// projectStartYear) + lineLocalPeriod. Returns -1 when the date math
// fails (caller should treat as "drop this allocation").
export function costLineProjectPeriodIndex(
  project: Project,
  phase: Phase,
  lineLocalPeriod: number,
): number {
  const phaseStart = phase.startDate && phase.startDate.length === 10
    ? phase.startDate
    : project.startDate;
  const ps = new Date(phaseStart);
  const pp = new Date(project.startDate);
  if (Number.isNaN(ps.getTime()) || Number.isNaN(pp.getTime())) return Math.max(0, lineLocalPeriod);
  const offset = ps.getUTCFullYear() - pp.getUTCFullYear();
  return offset + Math.max(0, lineLocalPeriod);
}

// ── M2.0j Fix 16: Asset cost summary cards ────────────────────────────────
// Three totals shown beneath the cost lines for the active asset on
// Tab 3 Inputs. Sums across cost stage classification:
//   exclLand          = construction + soft + operating (anything stage != 'land')
//   exclLandInKind    = exclLand + cash-land portion
//   inclLandInKind    = exclLandInKind + in-kind-land portion (= total basis)
export interface AssetCostSummaryTotals {
  exclLand: number;
  exclLandInKind: number;
  inclLandInKind: number;
}

export function computeAssetCostSummaryFromBreakdown(
  byStage: Record<CostStage, number>,
  cashLandValue: number,
  inKindLandValue: number,
): AssetCostSummaryTotals {
  const nonLand = (byStage.hard ?? 0) + (byStage.soft ?? 0) + (byStage.operating ?? 0);
  const exclLand = nonLand;
  const exclLandInKind = exclLand + Math.max(0, cashLandValue);
  const inclLandInKind = exclLandInKind + Math.max(0, inKindLandValue);
  return { exclLand, exclLandInKind, inclLandInKind };
}

// Generate N period labels starting from a project start date, at the
// chosen granularity. Used by Module1Costs Results sub-tab + Module1-
// Financing schedules to render column headers.
export function generatePeriodLabels(
  startIso: string,
  numAnnualPeriods: number,
  granularity: OutputGranularity,
): string[] {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return [];
  const labels: string[] = [];
  const startYear = start.getUTCFullYear();
  if (granularity === 'annual') {
    for (let y = 0; y < numAnnualPeriods; y++) {
      labels.push(`Dec ${String((startYear + y) % 100).padStart(2, '0')}`);
    }
    return labels;
  }
  if (granularity === 'quarterly') {
    for (let y = 0; y < numAnnualPeriods; y++) {
      for (let q = 1; q <= 4; q++) {
        labels.push(`Q${q} ${String((startYear + y) % 100).padStart(2, '0')}`);
      }
    }
    return labels;
  }
  // monthly
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let y = 0; y < numAnnualPeriods; y++) {
    for (let m = 0; m < 12; m++) {
      labels.push(`${months[m]} ${String((startYear + y) % 100).padStart(2, '0')}`);
    }
  }
  return labels;
}
