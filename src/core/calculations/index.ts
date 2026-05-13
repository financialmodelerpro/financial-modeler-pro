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
 *   - computeFinancing(tranche, phase, capexPerPeriod, presalesPerPeriod,
 *                       project) -> drawdown + repayment + balance schedules
 *   - distributeEquity(contrib, constructionPeriods)
 *   - computeProjectEndDate(project, phases)
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
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  DEFAULT_USEFUL_LIFE_YEARS,
  PER_SUBUNIT_RATE_KEY_SUPPORT,
  PER_SUBUNIT_RATE_KEY_PARKING,
  deriveLineBaseId,
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
export function computeSubUnitArea(u: SubUnit): number {
  // Defensive: treat legacy 'count' the same as 'units'.
  const isUnitMode = u.metric === 'units' || (u.metric as unknown as string) === 'count';
  if (isUnitMode) {
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
  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
  return sum > 0 ? sum : Math.max(0, asset.buaSqm ?? 0);
}

export function computeAssetSellableBua(asset: Asset, subUnits: SubUnit[]): number {
  const phaseSubUnits = subUnits.filter(
    (u) => u.assetId === asset.id && u.category !== 'Support',
  );
  if (phaseSubUnits.length === 0) return Math.max(0, asset.sellableBuaSqm ?? 0);
  const sum = phaseSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
  return sum > 0 ? sum : Math.max(0, asset.sellableBuaSqm ?? 0);
}

// Sum of Sellable / Operable / Leasable units where metric === 'units'.
// Used by the rate_per_unit cost method. M2.0i Fix 6 (2026-05-07):
// 'units' is the canonical name; legacy 'count' still resolves.
export function computeAssetUnitCount(asset: Asset, subUnits: SubUnit[]): number {
  return subUnits
    .filter((u) => u.assetId === asset.id && (u.metric === 'units' || (u.metric as unknown as string) === 'count') && u.category !== 'Support')
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
export function computeAssetLandSqm(
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
  // Rule 1: explicit sqm wins.
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
}

export function computeAssetLandBreakdown(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): AssetLandBreakdown {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);

  // Branch 1: explicit multi-parcel splits.
  const splits = asset.landAllocation?.multiParcelSplits;
  if (splits && splits.length > 0) {
    const resolved = splits.map((sp) => {
      const parcel = phaseParcels.find((p) => p.id === sp.parcelId);
      const sqm = Math.max(0, sp.sqm);
      const rate = parcel ? Math.max(0, parcel.rate) : 0;
      return { parcelId: sp.parcelId, sqm, rate, value: sqm * rate };
    });
    const landSqm = resolved.reduce((s, r) => s + r.sqm, 0);
    const landValue = resolved.reduce((s, r) => s + r.value, 0);
    const rate = landSqm > 0 ? landValue / landSqm : 0;
    return { landSqm, landValue, rate, splits: resolved };
  }

  // M2.0g Fix 2: explicit custom rate sentinel.
  const PARCEL_WEIGHTED_AVG = '__weighted__';
  const PARCEL_CUSTOM_RATE = '__custom__';
  const singleParcelId = asset.landAllocation?.parcelId;
  const sqm = Math.max(0, asset.landAllocation?.sqm ?? asset.landAreaSqm ?? 0);

  if (mode === 'sqm' && singleParcelId === PARCEL_CUSTOM_RATE) {
    const rate = Math.max(0, asset.landAllocation?.customRate ?? 0);
    const value = sqm * rate;
    return { landSqm: sqm, landValue: value, rate, splits: [] };
  }

  // M2.0g Fix 2: explicit weighted-average sentinel (mode A).
  if (mode === 'sqm' && singleParcelId === PARCEL_WEIGHTED_AVG) {
    const agg = computeLandAggregate(phaseParcels);
    const rate = agg.weightedRate;
    const value = sqm * rate;
    return { landSqm: sqm, landValue: value, rate, splits: [] };
  }

  // Branch 2: single explicit parcel (mode A only).
  if (mode === 'sqm' && singleParcelId) {
    const parcel = phaseParcels.find((p) => p.id === singleParcelId);
    const rate = parcel ? Math.max(0, parcel.rate) : 0;
    const value = sqm * rate;
    return {
      landSqm: sqm,
      landValue: value,
      rate,
      splits: [{ parcelId: singleParcelId, sqm, rate, value }],
    };
  }

  // Branch 3: legacy / mode B / mode C - phase aggregate weighted average.
  const agg = computeLandAggregate(phaseParcels);
  const landSqm = computeAssetLandSqm(asset, parcels, assets, subUnits, mode);
  if (agg.totalAreaSqm <= 0 || landSqm <= 0) {
    return { landSqm, landValue: 0, rate: 0, splits: [] };
  }
  // Value share = landSqm / total, applied to total value.
  const valueShare = agg.totalAreaSqm > 0 ? landSqm / agg.totalAreaSqm : 0;
  const landValue = agg.totalValue * valueShare;
  const rate = landSqm > 0 ? landValue / landSqm : 0;
  return { landSqm, landValue, rate, splits: [] };
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
  supportArea: number;         // sub-unit Support + asset.supportArea
  parkingArea: number;         // asset.parkingArea (asset-level input)
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
  const sellableBua = my.filter((u) => u.category === 'Sellable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const operableBua = my.filter((u) => u.category === 'Operable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const leasableBua = my.filter((u) => u.category === 'Leasable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const subUnitsSupport = my.filter((u) => u.category === 'Support').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const subUnitsRevenue = sellableBua + operableBua + leasableBua;
  const supportArea = Math.max(0, asset.supportArea ?? 0);
  const parkingArea = Math.max(0, asset.parkingArea ?? 0);
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
  const sellableArea = my.filter((u) => u.category === 'Sellable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const operableArea = my.filter((u) => u.category === 'Operable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const leasableArea = my.filter((u) => u.category === 'Leasable').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const subUnitSupport = my.filter((u) => u.category === 'Support').reduce((s, u) => s + computeSubUnitArea(u), 0);
  const supportArea = subUnitSupport + Math.max(0, asset.supportArea ?? 0);
  const parkingArea = Math.max(0, asset.parkingArea ?? 0);
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

export function computeParcelNda(parcel: Parcel): ParcelNda {
  const area = Math.max(0, parcel.area);
  const rate = Math.max(0, parcel.rate);
  const totalCost = area * rate;
  if (parcel.hasNdaDeduction === true) {
    const roadsPct = Math.max(0, Math.min(100, parcel.roadsPct ?? 0));
    const parksPct = Math.max(0, Math.min(100, parcel.parksPct ?? 0));
    const totalDeductPct = Math.min(100, roadsPct + parksPct);
    const roadsArea = area * (roadsPct / 100);
    const parksArea = area * (parksPct / 100);
    const nda = area * (1 - totalDeductPct / 100);
    const effectiveNdaRate = nda > 0 ? totalCost / nda : 0;
    return { area, roadsArea, parksArea, nda, totalCost, effectiveNdaRate };
  }
  return {
    area,
    roadsArea: 0,
    parksArea: 0,
    nda: area,
    totalCost,
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
  // M2.0h Fix 4 (2026-05-07): NDA derives per-parcel via computeParcelNda
  // when the parcel has the NDA toggle set. Land allocation references
  // NDA (developable sqm) not gross parcel area; the per-asset effective
  // share follows the parcel-level inflation. project.projectRoadsPct
  // remains a project-wide knob for legacy snapshots that use the
  // rate_per_nda / rate_per_roads cost methods without per-parcel NDA.
  // When per-parcel NDA is set, m.ndaSqm reflects the parcel-derived
  // value; otherwise we fall back to the project-wide roads%.
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  let assetNda = landSqm;
  let assetRoads = 0;
  // M2.0M Pass 6 Fix 3 (2026-05-11): project-level NDA wins when
  // projectNdaEnabled is true. Apply (projectRoadsPct + projectParksPct)
  // uniformly to landSqm. Per-parcel toggles are ignored in this mode.
  const projectNda = project.projectNdaEnabled === true;
  const anyParcelHasNda = phaseParcels.some((p) => p.hasNdaDeduction === true);
  if (projectNda) {
    const roadsPct = Math.max(0, Math.min(100, project.projectRoadsPct ?? 0));
    const parksPct = Math.max(0, Math.min(100, project.projectParksPct ?? 0));
    const totalDeductPct = Math.min(100, roadsPct + parksPct);
    assetNda = landSqm * (1 - totalDeductPct / 100);
    assetRoads = landSqm - assetNda;
  } else if (anyParcelHasNda && breakdown.splits.length > 0) {
    // Multi-parcel splits: derive NDA per slice using each parcel's own
    // toggle. Asset's NDA = sum(slice.sqm × parcel.ndaFactor).
    assetNda = 0;
    for (const split of breakdown.splits) {
      const parcel = phaseParcels.find((p) => p.id === split.parcelId);
      if (!parcel) { assetNda += split.sqm; continue; }
      const pn = computeParcelNda(parcel);
      const ndaFactor = pn.area > 0 ? pn.nda / pn.area : 1;
      assetNda += split.sqm * ndaFactor;
    }
    assetRoads = landSqm - assetNda;
  } else if (anyParcelHasNda) {
    // Single parcel allocation: derive from the resolved single parcel
    // (or the asset's first phaseParcel as best-effort fallback).
    const single = breakdown.splits[0]
      ? phaseParcels.find((p) => p.id === breakdown.splits[0].parcelId)
      : phaseParcels.find((p) => p.id === asset.landAllocation?.parcelId) ?? phaseParcels[0];
    if (single && single.hasNdaDeduction) {
      const pn = computeParcelNda(single);
      const ndaFactor = pn.area > 0 ? pn.nda / pn.area : 1;
      assetNda = landSqm * ndaFactor;
      assetRoads = landSqm - assetNda;
    } else {
      const roadsPct = Math.max(0, Math.min(100, project.projectRoadsPct ?? 0));
      assetNda = landSqm * (1 - roadsPct / 100);
      assetRoads = landSqm - assetNda;
    }
  } else {
    const roadsPct = Math.max(0, Math.min(100, project.projectRoadsPct ?? 0));
    assetNda = landSqm * (1 - roadsPct / 100);
    assetRoads = landSqm - assetNda;
  }
  const ndaSqm = assetNda;
  const roadsSqm = assetRoads;
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
  const bua = Math.max(hierarchy.bua, Math.max(0, asset.buaSqm ?? 0));
  const nsa = Math.max(hierarchy.nsa, Math.max(0, asset.sellableBuaSqm ?? 0));
  const gfa = Math.max(hierarchy.gfa, Math.max(0, asset.gfaSqm ?? 0), bua);
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
    gfa,
    bua,
    nsa,
    unitCount,
    parkingBays: Math.max(0, asset.parkingBaysRequired ?? 0),
    supportArea: hierarchy.breakdown.supportArea,
    parkingArea: hierarchy.breakdown.parkingArea,
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
    case 'rate_x_specific_subunit': {
      const target = (ctx.subUnits ?? []).find((u) => u.id === line.subUnitId);
      if (!target) return 0;
      return safeV * computeSubUnitArea(target);
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
        total += Math.max(0, r) * computeSubUnitArea(u);
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
    case 'percent_of_total_revenue':
    case 'percent_of_revenue_cash':
    case 'percent_of_revenue_sale':
      return m.totalRevenue * (clamp(v, 0, 100) / 100);
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
  if (basis === 'bua_share') {
    const myBua = computeAssetBua(asset, subUnits);
    const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
    return totalBua > 0 ? myBua / totalBua : 0;
  }
  if (basis === 'gfa_share') {
    const myGfa = asset.gfaSqm;
    const totalGfa = phaseAssets.reduce((s, a) => s + a.gfaSqm, 0);
    return totalGfa > 0 ? myGfa / totalGfa : 0;
  }
  if (basis === 'land_share') {
    const myLand = computeAssetLandSqm(asset, parcels, phaseAssets, subUnits, mode);
    const totalLand = phaseAssets.reduce(
      (s, a) => s + computeAssetLandSqm(a, parcels, phaseAssets, subUnits, mode),
      0,
    );
    return totalLand > 0 ? myLand / totalLand : 0;
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
}

export function computeAssetCost(
  asset: Asset,
  project: Project,
  phase: Phase,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  costLines: CostLine[],
  costOverrides: CostOverride[],
  landAllocationMode: LandAllocationMode,
  // M2.0 Pass 14 (2026-05-13): parcel funding config, threaded in so
  // percent_of_cash_land lines can distribute deferred-payment parcel
  // slices via expandDeferredSchedule instead of lumping at Y0.
  // Optional: legacy callers (and tests that mock the engine) keep
  // the existing Y0 behaviour when omitted.
  parcelFunding?: ParcelFundingConfig[],
): AssetCostBreakdown {
  // T3-companion Fix 2 (2026-05-12): companion assets (Sell + Manage
  // Operate sibling, isCompanion === true) carry NO physical attributes
  // and inherit operating revenue from the parent. They must NOT pull
  // any cost line. Short-circuit the entire pipeline before any phase
  // line filter / metric resolution. Returns the canonical empty
  // breakdown so downstream consumers (UI render, Project Total
  // rollup, financing engine) see explicit zeros instead of any
  // accidentally inherited master totals.
  if (asset.isCompanion === true) {
    const cpZero = phase.constructionPeriods + 1;
    return {
      byLineId: {},
      byStage: { land: 0, hard: 0, soft: 0, operating: 0 },
      total: 0,
      perPeriod: new Array<number>(cpZero).fill(0),
      perPeriodLandTotal: new Array<number>(cpZero).fill(0),
      perPeriodLandInKind: new Array<number>(cpZero).fill(0),
      perLinePerPeriod: {},
    };
  }
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
  // M2.0d: filter targeted custom lines so each asset only sees its own
  // (untagged lines = project-wide and apply to all assets).
  const phaseLines = costLines.filter(
    (c) => c.phaseId === phase.id &&
      (c.targetAssetId === undefined || c.targetAssetId === asset.id),
  );
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
    const ctxStub: AssetCostContext = { asset, metrics, subUnits, resolvedDirectLineTotals: {} };
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
    .filter((r) => !['percent_of_selected', 'percent_of_construction'].includes(r.method) && r.line.stage === 'hard')
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
  for (const r of resolved) {
    if (r.method === 'percent_of_selected') {
      const ids = r.line.selectedLineIds ?? [];
      const base = ids.reduce(
        (s, id) => s + (directTotals[id] ?? percentTotals[id] ?? 0),
        0,
      );
      const v = clamp(r.value, 0, 100);
      percentTotals[r.line.id] = base * (v / 100);
    }
  }

  // Aggregate
  const byLineId: Record<string, number> = { ...directTotals, ...percentTotals };
  const byStage: Record<CostStage, number> = { land: 0, hard: 0, soft: 0, operating: 0 };
  let total = 0;
  for (const r of resolved) {
    const t = byLineId[r.line.id] ?? 0;
    total += t;
    byStage[r.line.stage] += t;
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
        const lim = Math.min(tmp.length, periodSlots);
        for (let i = 0; i < lim; i++) dist[i] += tmp[i] ?? 0;
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
    const lim = Math.min(dist.length, periodSlots);
    for (let i = 0; i < lim; i++) {
      const v = dist[i] ?? 0;
      perPeriod[i] += v;
      if (isLand) perPeriodLandTotal[i] += v;
      if (isInKindLand) perPeriodLandInKind[i] += v;
    }
  }

  return { byLineId, byStage, total, perPeriod, perPeriodLandTotal, perPeriodLandInKind, perLinePerPeriod };
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
  const byStage: Record<CostStage, number> = { land: 0, hard: 0, soft: 0, operating: 0 };
  let total = 0;
  const cp = phase.constructionPeriods;
  const perPeriod = new Array<number>(cp + 1).fill(0);

  for (const a of phaseAssets) {
    const breakdown = computeAssetCost(a, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode, parcelFunding);
    byAssetId[a.id] = breakdown;
    total += breakdown.total;
    for (const k of ['land', 'hard', 'soft', 'operating'] as CostStage[]) byStage[k] += breakdown.byStage[k];
    for (let i = 0; i <= cp; i++) perPeriod[i] += breakdown.perPeriod[i] ?? 0;
  }

  return { byAssetId, byStage, total, perPeriod };
}

// ── Financing (per-tranche, 5 drawdown × 5 repayment) ─────────────────────
export interface FinancingResult {
  periods: number;
  periodicRate: number;
  drawSchedule: number[];
  outstandingBalance: number[];
  interestAccrued: number[];
  interestCapitalized: number[];
  interestPaid: number[];
  principalRepaid: number[];
  totalDebt: number;
  totalInterest: number;
  totalRepayment: number;
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

/**
 * Year-on-Year % schedule normaliser. Pads / truncates to length `n`
 * and rescales so the result sums to exactly 100. Empty / all-zero
 * input falls back to an even distribution.
 */
export function normalizeYoYSchedule(raw: number[], n: number): number[] {
  if (n <= 0) return [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Array(n).fill(100 / n);
  }
  // Pad short, truncate long, clamp negatives.
  const padded = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) padded[i] = Math.max(0, raw[i] ?? 0);
  const sum = padded.reduce((s, v) => s + v, 0);
  if (sum < 1e-9) return new Array(n).fill(100 / n);
  const scale = 100 / sum;
  return padded.map((v) => v * scale);
}

export function computeFinancing(
  tranche: FinancingTranche,
  phase: Phase,
  capexPerPeriod: number[],
  presalesPerPeriod: number[],
  project: Project,
): FinancingResult {
  const constructionPeriods = phase.constructionPeriods;
  const operationsPeriods = phase.operationsPeriods;
  const overlap = phase.overlapPeriods;
  const totalPeriods = constructionPeriods + operationsPeriods - overlap;
  const periods = Math.max(0, totalPeriods);

  const periodicRate =
    project.modelType === 'monthly'
      ? Math.max(0, tranche.interestRatePct) / 100 / 12
      : Math.max(0, tranche.interestRatePct) / 100;

  const ltv = clamp(tranche.ltvPct, 0, 100) / 100;
  const totalCapex = capexPerPeriod.reduce((s, v) => s + v, 0);
  const totalPresales = presalesPerPeriod.reduce((s, v) => s + v, 0);

  // ── Existing Operations (2026-05-13) ─────────────────────────────────
  // When origin === 'existing', the facility carries an opening balance
  // at project Y0 and amortizes from there. No drawdown, no IDC, no
  // grace. remainingRepaymentPeriods replaces repaymentPeriods for
  // sizing the per-period principal slice.
  const isExisting = tranche.origin === 'existing';
  const effOpeningBalance = isExisting ? Math.max(0, tranche.openingBalance ?? 0) : 0;
  const effRepaymentPeriods = isExisting
    ? Math.max(0, tranche.remainingRepaymentPeriods ?? 0)
    : tranche.repaymentPeriods;

  // Drawdown schedule (length periods).
  const drawSchedule = new Array<number>(periods).fill(0);
  const drawWindow = isExisting ? 0 : Math.min(constructionPeriods, periods);

  // M2.0L (2026-05-11): resolved facility size (absolute principal
  // takes precedence over ltv-based when set).
  const resolvedPrincipal =
    typeof tranche.principal === 'number' && tranche.principal > 0
      ? tranche.principal
      : totalCapex * ltv;
  // M2.0L: availability window narrows when the user sets it
  // explicitly; defaults to the construction window for back-compat.
  const availWindow = Math.min(
    drawWindow,
    typeof tranche.availabilityPeriods === 'number' && tranche.availabilityPeriods > 0
      ? tranche.availabilityPeriods
      : drawWindow,
  );

  // Existing facilities skip the drawdown switch entirely (drawWindow=0).
  switch (isExisting ? '__skip_existing__' as never : tranche.drawdownMethod) {
    case 'capex_basis': {
      // Tracks capex × ltv per period.
      for (let i = 0; i < drawWindow; i++) {
        drawSchedule[i] = (capexPerPeriod[i] ?? 0) * ltv;
      }
      break;
    }
    case 'debt_equity_ratio': {
      // % of capex per period.
      for (let i = 0; i < drawWindow; i++) {
        drawSchedule[i] = (capexPerPeriod[i] ?? 0) * ltv;
      }
      break;
    }
    case 'capex_minus_presales':
    case 'cash_available': {
      // Net capex = capex - presales. If drawdownIncludeLand is false,
      // exclude the period-0 land lump from the capex base.
      // M2.0L: cash_available is the MAAD pattern alias.
      const includeLand = tranche.drawdownIncludeLand !== false;
      for (let i = 0; i < drawWindow; i++) {
        const cx = capexPerPeriod[i] ?? 0;
        const ps = presalesPerPeriod[i] ?? 0;
        const adj = !includeLand && i === 0 ? 0 : cx;
        const net = Math.max(0, adj - ps);
        drawSchedule[i] = net * ltv;
      }
      break;
    }
    case 'manual': {
      const dist = tranche.drawdownDistribution ?? [];
      const sum = dist.reduce((s, v) => s + (v ?? 0), 0);
      for (let i = 0; i < drawWindow; i++) {
        const w = sum > 0 ? (dist[i] ?? 0) / sum : 1 / drawWindow;
        drawSchedule[i] = resolvedPrincipal * w;
      }
      break;
    }
    case 'min_cash_floor': {
      // Maintain running cash >= floor; draws when cash dips below.
      // For now we approximate by drawing capex × ltv (same as capex_basis)
      // and let the floor kick in via the equity injection in callers.
      const floor = Math.max(0, tranche.drawdownMinCashFloor ?? 0);
      let cash = floor;
      for (let i = 0; i < drawWindow; i++) {
        const cx = capexPerPeriod[i] ?? 0;
        cash -= cx;
        if (cash < floor) {
          drawSchedule[i] = (floor - cash);
          cash = floor;
        }
      }
      break;
    }
    case 'front_loaded': {
      // M2.0L: 100% drawn in the first availability period.
      if (availWindow > 0) drawSchedule[0] = resolvedPrincipal;
      break;
    }
    case 'equal_periodic': {
      // M2.0L: equal slice across the availability window.
      const slice = availWindow > 0 ? resolvedPrincipal / availWindow : 0;
      for (let i = 0; i < availWindow; i++) drawSchedule[i] = slice;
      break;
    }
    case 'custom_schedule': {
      // M2.0L: per-period absolute amounts. Clipped to facility size.
      const sched = tranche.drawdownCustomSchedule ?? [];
      let drawn = 0;
      for (let i = 0; i < drawWindow; i++) {
        const want = Math.max(0, sched[i] ?? 0);
        const room = Math.max(0, resolvedPrincipal - drawn);
        const taken = Math.min(want, room);
        drawSchedule[i] = taken;
        drawn += taken;
      }
      break;
    }
  }

  // Total principal that the repayment schedule must amortize: for new
  // facilities it's the sum of drawdowns; for existing it's the opening
  // balance carried over from Y0.
  const totalDebtFromDraws = isExisting
    ? effOpeningBalance
    : drawSchedule.reduce((s, v) => s + v, 0);

  // Walk balance + interest + repayment.
  const outstanding = new Array<number>(periods).fill(0);
  const interestAccrued = new Array<number>(periods).fill(0);
  const interestCapitalized = new Array<number>(periods).fill(0);
  const interestPaid = new Array<number>(periods).fill(0);
  const principalRepaid = new Array<number>(periods).fill(0);

  // Pre-compute repayment baseline (where applicable). Index into the
  // total period array, not the construction window. Existing facilities
  // start amortizing at t=0 (no grace, no operations offset).
  const opsStartIdx = isExisting ? 0 : constructionPeriods - overlap;
  // M2.0L: grace period defers principal repayment within the
  // operations window. Falls back to no grace (=opsStartIdx) when
  // not set. Existing facilities have no grace.
  const graceEndIdx = isExisting ? 0 : opsStartIdx + Math.max(0, tranche.gracePeriods ?? 0);
  const repBudget = new Array<number>(periods).fill(0);
  if (tranche.repaymentMethod === 'manual') {
    const dist = tranche.repaymentManualDistribution ?? [];
    const sum = dist.reduce((s, v) => s + (Math.max(0, v ?? 0)), 0);
    for (let i = 0; i < periods; i++) {
      const w = sum > 0 ? Math.max(0, dist[i] ?? 0) / sum : 0;
      repBudget[i] = totalDebtFromDraws * w;
    }
  } else if (tranche.repaymentMethod === 'straight_line' && effRepaymentPeriods > 0) {
    const principalPerPeriod = totalDebtFromDraws / effRepaymentPeriods;
    for (let i = 0; i < effRepaymentPeriods && (graceEndIdx + i) < periods; i++) {
      repBudget[graceEndIdx + i] = principalPerPeriod;
    }
  } else if (tranche.repaymentMethod === 'equal_periodic_amortization' && effRepaymentPeriods > 0) {
    // Annuity: PMT = P × [r(1+r)^n] / [(1+r)^n - 1].
    const pmt = computeEqualPeriodicPayment(totalDebtFromDraws, periodicRate, effRepaymentPeriods);
    // Each repayment is the principal portion of PMT (PMT - interest on
    // running balance). We pre-fill repBudget with PMT here and let the
    // interest loop below subtract interest to derive principal share.
    for (let i = 0; i < effRepaymentPeriods && (graceEndIdx + i) < periods; i++) {
      repBudget[graceEndIdx + i] = pmt;
    }
  } else if (tranche.repaymentMethod === 'bullet') {
    // Bullet: principal due at last period of facility (or maturity).
    const maturity = Math.min(periods - 1, graceEndIdx + Math.max(0, effRepaymentPeriods) - 1);
    if (maturity >= 0) repBudget[maturity] = totalDebtFromDraws;
  } else if (tranche.repaymentMethod === 'balloon' && effRepaymentPeriods > 0) {
    // Balloon: small equal periodic + large balloon at maturity.
    const balloonShare = clamp(tranche.balloonPct ?? 30, 0, 100) / 100;
    const balloonAmt = totalDebtFromDraws * balloonShare;
    const periodicAmt = (totalDebtFromDraws - balloonAmt) / Math.max(1, effRepaymentPeriods - 1);
    for (let i = 0; i < effRepaymentPeriods - 1 && (graceEndIdx + i) < periods; i++) {
      repBudget[graceEndIdx + i] = periodicAmt;
    }
    const maturity = Math.min(periods - 1, graceEndIdx + effRepaymentPeriods - 1);
    if (maturity >= 0) repBudget[maturity] = balloonAmt;
  } else if (tranche.repaymentMethod === 'custom_schedule') {
    const sched = tranche.repaymentCustomSchedule ?? [];
    for (let i = 0; i < periods; i++) repBudget[i] = Math.max(0, sched[i] ?? 0);
  } else if (tranche.repaymentMethod === 'year_on_year_pct' && effRepaymentPeriods > 0) {
    // Year-on-Year % (2026-05-13): yearOnYearPctSchedule supplies per-
    // period % weights (sum = 100). normalizeYoYSchedule pads short
    // arrays with zeros, truncates long ones, and scales to 100 when
    // the user-entered sum doesn't reach it. Empty array -> even
    // distribution across effRepaymentPeriods.
    const schedule = normalizeYoYSchedule(tranche.yearOnYearPctSchedule ?? [], effRepaymentPeriods);
    for (let i = 0; i < effRepaymentPeriods && (graceEndIdx + i) < periods; i++) {
      repBudget[graceEndIdx + i] = totalDebtFromDraws * ((schedule[i] ?? 0) / 100);
    }
  }

  // M2.0L: resolve IDC treatment. New idcTreatment wins when set;
  // legacy idcCapitalize boolean is the fallback. Existing facilities
  // never accrue IDC (they amortize from project Y0 and pay interest
  // in cash, never capitalising) - force-expense regardless of stored
  // setting.
  const idcTreatment: 'capitalize' | 'expense' | 'mixed' = isExisting
    ? 'expense'
    : (tranche.idcTreatment ?? (tranche.idcCapitalize ? 'capitalize' : 'expense'));
  const idcSplitPeriod = tranche.idcMixedSplitPeriod ?? constructionPeriods;
  const sweepRatio = clamp(tranche.sweepRatio ?? 75, 0, 100) / 100;

  // Existing facilities seed their opening balance at t=0; new
  // facilities start at 0 and grow via drawSchedule.
  let balance = effOpeningBalance;
  for (let i = 0; i < periods; i++) {
    balance += drawSchedule[i] ?? 0;
    const interest = balance * periodicRate;
    interestAccrued[i] = interest;
    // M2.0L: 3-way IDC treatment. capitalize during construction (and
    // through idcSplitPeriod for mixed); expense otherwise.
    const inConstruction = i < constructionPeriods;
    let capitalize = false;
    if (idcTreatment === 'capitalize' && inConstruction) capitalize = true;
    else if (idcTreatment === 'mixed' && i <= idcSplitPeriod) capitalize = true;
    if (capitalize) {
      interestCapitalized[i] = interest;
      balance += interest;
    } else {
      interestPaid[i] = interest;
    }
    let repay = repBudget[i] ?? 0;
    // Annuity: subtract interest from PMT to get principal portion.
    if (tranche.repaymentMethod === 'equal_periodic_amortization' && i >= graceEndIdx && repay > 0) {
      repay = Math.max(0, repay - interest);
    }
    // Cash sweep variants: sweepRatio × straight-line over remaining periods
    // until Module 5 supplies the real cashflow surplus.
    if (tranche.repaymentMethod === 'cashsweep_continuous' && i >= graceEndIdx) {
      const remaining = Math.max(1, periods - i);
      repay = (balance / remaining) * sweepRatio;
    }
    if (tranche.repaymentMethod === 'cashsweep_from_period') {
      const start = Math.max(graceEndIdx, tranche.sweepStartPeriod ?? graceEndIdx);
      if (i >= start) {
        const remaining = Math.max(1, periods - i);
        repay = (balance / remaining) * sweepRatio;
      }
    }
    if (tranche.repaymentMethod === 'cashsweep_min_cash' && i >= graceEndIdx) {
      const remaining = Math.max(1, periods - i);
      repay = (balance / remaining) * sweepRatio;
    }
    // M2.0L: apply discrete prepayments before clamping.
    const prepay = (tranche.prepayments ?? []).filter((p) => p.period === i).reduce((s, p) => s + Math.max(0, p.amount), 0);
    repay += prepay;
    repay = Math.min(repay, balance);
    balance -= repay;
    principalRepaid[i] = repay;
    outstanding[i] = balance;
  }

  const totalInterest = interestAccrued.reduce((s, v) => s + v, 0);
  const totalRepayment = principalRepaid.reduce((s, v) => s + v, 0);

  return {
    periods,
    periodicRate,
    drawSchedule,
    outstandingBalance: outstanding,
    interestAccrued,
    interestCapitalized,
    interestPaid,
    principalRepaid,
    totalDebt: totalDebtFromDraws,
    totalInterest,
    totalRepayment,
  };
}

// ── M2.0L: Annuity payment ────────────────────────────────────────────────
// PMT = P × [r(1+r)^n] / [(1+r)^n - 1]. Returns 0-rate edge case (P/n)
// when periodicRate ~= 0.
export function computeEqualPeriodicPayment(principal: number, periodicRate: number, periods: number): number {
  if (periods <= 0) return 0;
  if (principal <= 0) return 0;
  if (periodicRate < 1e-9) return principal / periods;
  const factor = Math.pow(1 + periodicRate, periods);
  return (principal * periodicRate * factor) / (factor - 1);
}

// ── M2.0L: Capital stack summary ──────────────────────────────────────────
// Aggregates equity tranches + debt facilities + capex base into the
// sources / uses snapshot rendered at the top of Tab 4. LTV is computed
// against (cash land + in-kind land + total non-land capex) as the
// denominator.
export interface CapitalStackEntry {
  id: string;
  name: string;
  amount: number;
  pct: number;
  /** 'equity:cash' | 'equity:in_kind' | 'equity:jv' | 'debt:senior' | 'debt:mezz' | 'debt:bridge' | 'debt:bullet' | 'debt:other' */
  category: string;
}

export interface CapitalStackSummary {
  totalEquity: number;
  totalDebt: number;
  totalSources: number;
  totalUses: number;
  gap: number;
  ltvSenior: number;
  ltvTotal: number;
  equityBreakdown: CapitalStackEntry[];
  debtBreakdown: CapitalStackEntry[];
}

export function computeCapitalStack(
  tranches: FinancingTranche[],
  equityContribs: EquityContribution[],
  projectCapexTotal: number,
): CapitalStackSummary {
  const equityBreakdown: CapitalStackEntry[] = [];
  let totalEquity = 0;
  for (const e of equityContribs) {
    const amount = Math.max(0, e.amount);
    totalEquity += amount;
    const type = e.type ?? 'cash';
    equityBreakdown.push({
      id: e.id,
      name: e.name,
      amount,
      pct: 0,
      category: `equity:${type}`,
    });
  }
  const debtBreakdown: CapitalStackEntry[] = [];
  let totalDebt = 0;
  let seniorDebt = 0;
  for (const t of tranches) {
    const ltv = clamp(t.ltvPct, 0, 100) / 100;
    const fromPrincipal = typeof t.principal === 'number' && t.principal > 0 ? t.principal : 0;
    const amount = fromPrincipal > 0 ? fromPrincipal : projectCapexTotal * ltv;
    totalDebt += amount;
    const facilityType = t.facilityType ?? 'senior_construction';
    if (facilityType === 'senior_construction' || facilityType === 'senior_term') {
      seniorDebt += amount;
    }
    debtBreakdown.push({
      id: t.id,
      name: t.name,
      amount,
      pct: 0,
      category: `debt:${facilityType}`,
    });
  }
  const totalSources = totalEquity + totalDebt;
  const totalUses = Math.max(0, projectCapexTotal);
  const gap = totalSources - totalUses;
  // Re-compute pct now we know totalSources.
  const denom = totalSources > 0 ? totalSources : 1;
  for (const e of equityBreakdown) e.pct = (e.amount / denom) * 100;
  for (const d of debtBreakdown) d.pct = (d.amount / denom) * 100;
  return {
    totalEquity,
    totalDebt,
    totalSources,
    totalUses,
    gap,
    ltvSenior: totalUses > 0 ? (seniorDebt / totalUses) * 100 : 0,
    ltvTotal:  totalUses > 0 ? (totalDebt / totalUses) * 100 : 0,
    equityBreakdown,
    debtBreakdown,
  };
}

// ── M2.0L: IDC summary across facilities ──────────────────────────────────
// Aggregates the capitalised + expensed interest per facility and per
// period. The capitalised slice flows back to Tab 3 Costs as a read-only
// "Auto: IDC from <facility>" line per asset via applyIdcToCapex.
export interface IdcSummary {
  byFacility: Array<{
    id: string;
    name: string;
    capitalized: number;
    expensed: number;
    capitalizedPerPeriod: number[];
    expensedPerPeriod: number[];
  }>;
  totalCapitalized: number;
  totalExpensed: number;
}

// ── P2-Fix 1 (2026-05-11): uniform funding pipeline ──────────────────────
// All 4 funding methods produce the same output shape:
//   totalNeed         total cash funding need (currency)
//   periodArray       per-project-period allocation (matches capex schedule)
//   debtEquitySplit   { debt[], equity[] } per period
//
// Step 1 (method-specific) computes totalNeed and the period array.
// Steps 2-3 (uniform) apply the project ratio (or per-method ratio).
//
// When upstream engines ship (Revenue/OpEx/CF), Method 3 and Method 4
// pick up real pre-sales / OCF / closing cash via the hooks layer; the
// pipeline shape never changes for downstream consumers.
export interface FundingResult {
  method: FundingMethodId;
  totalNeed: number;
  periodArray: number[];
  debtEquitySplit: { debt: number[]; equity: number[] };
}

export interface ComputeFundingContext {
  method: FundingMethodId;
  financing: ProjectFinancingConfig;
  /** Pre-aggregated capex per project period (typically Excl. Land In-Kind). */
  capexPerPeriod: number[];
  /** Optional hooks for Method 3 / Method 4 (zero-stubs by default). */
  preSalesPerPeriod?: number[];
  operatingCFPerPeriod?: number[];
  closingCashBefore?: (prevPeriod: number) => number;
  /**
   * M2.0 Pass 13 (2026-05-13): two-rule split for Method 1.
   *
   * Method 1 splits capex into two streams:
   *   non-land     = capexPerPeriod - landCashPerPeriod (routed via fixedRatio)
   *   land cash    = landCashPerPeriod                  (routed per parcel funding type)
   *
   * When the caller omits these arrays, Method 1 falls back to the pre-
   * Pass-13 uniform behaviour (entire capexPerPeriod routed via
   * fixedRatio) so consumers that have not been updated still produce
   * the same numbers they used to.
   *
   * parcelCashPerPeriod splits landCashPerPeriod by parcel so per-
   * parcel ParcelFundingConfig (100pct_equity / 100pct_debt /
   * custom_split / in_kind / deferred_payment) can be applied
   * independently. Parcels with no ParcelFundingConfig entry default
   * to 100pct_equity (the schema default).
   */
  landCashPerPeriod?: number[];
  parcelCashPerPeriod?: Array<{ parcelId: string; perPeriod: number[] }>;
}

function pickRatio(method: FundingMethodId, f: ProjectFinancingConfig): { debt: number; equity: number } {
  if (method === 1) return { debt: f.fixedRatio?.debtPct ?? 70, equity: f.fixedRatio?.equityPct ?? 30 };
  if (method === 2) return { debt: f.netFundingConfig?.debtPct ?? 70, equity: f.netFundingConfig?.equityPct ?? 30 };
  return { debt: f.cashDeficitConfig?.debtPct ?? 70, equity: f.cashDeficitConfig?.equityPct ?? 30 };
}

function splitByRatio(periodArray: number[], debtPct: number, equityPct: number): { debt: number[]; equity: number[] } {
  const sum = debtPct + equityPct;
  const d = sum > 0 ? debtPct / sum : 0.7;
  const e = sum > 0 ? equityPct / sum : 0.3;
  return {
    debt: periodArray.map((v) => v * d),
    equity: periodArray.map((v) => v * e),
  };
}

/**
 * M2.0 Pass 13 (2026-05-13): per-parcel debt/equity split for Method 1.
 * M2.0 Pass 16 (2026-05-13): the Land Funding UI now writes direct
 * `debtPct` / `equityPct` fields. This resolver prefers them when set;
 * legacy snapshots still resolve via the `fundingType` enum until the
 * migration backfills the new fields. Default: 100% equity.
 */
function parcelDebtEquityFractions(
  cfg: ProjectFinancingConfig['parcelFunding'][number] | undefined,
): { debt: number; equity: number } {
  if (!cfg) return { debt: 0, equity: 1 };
  if (cfg.debtPct != null || cfg.equityPct != null) {
    const d = Math.max(0, cfg.debtPct ?? 0);
    const e = Math.max(0, cfg.equityPct ?? Math.max(0, 100 - d));
    const sum = d + e;
    if (sum <= 0) return { debt: 0, equity: 1 };
    return { debt: d / sum, equity: e / sum };
  }
  // Legacy fundingType resolution for pre-Pass-16 snapshots.
  switch (cfg.fundingType) {
    case '100pct_debt':
      return { debt: 1, equity: 0 };
    case '100pct_equity':
      return { debt: 0, equity: 1 };
    case 'custom_split': {
      const d = Math.max(0, cfg.customDebtPct ?? 0);
      const e = Math.max(0, cfg.customEquityPct ?? Math.max(0, 100 - d));
      const sum = d + e;
      if (sum <= 0) return { debt: 0, equity: 1 };
      return { debt: d / sum, equity: e / sum };
    }
    case 'in_kind':
    case 'deferred_payment':
    default:
      return { debt: 0, equity: 1 };
  }
}

export function computeFunding(ctx: ComputeFundingContext): FundingResult {
  const { method, financing, capexPerPeriod } = ctx;
  const preSales = ctx.preSalesPerPeriod ?? capexPerPeriod.map(() => 0);
  const ocf = ctx.operatingCFPerPeriod ?? capexPerPeriod.map(() => 0);
  const minCash = Math.max(0, financing.minimumCashReserve ?? 0);
  let totalNeed = 0;
  let periodArray: number[] = [];

  // M2.0 Pass 18 (2026-05-13): land/non-land split unified across all
  // three methods. When the caller supplies landCashPerPeriod +
  // parcelCashPerPeriod, the engine splits capex into a non-land slice
  // (sized per method's own logic) plus a land-cash slice routed
  // uniformly by per-parcel debt/equity ratios. The land contribution
  // is identical across all three methods because parcel routing has
  // nothing to do with how the rest of capex is sized.
  //
  // For Methods 2 + 3 the prior implementation applied method-specific
  // logic to the entire capex (including Land Cash), then routed the
  // whole thing through the project-wide ratio. That produced the wrong
  // Land Cash routing when parcels overrode the project ratio.
  //
  // Fallback path (when landCashPerPeriod is omitted) preserves the
  // pre-Pass-18 behaviour bit-for-bit so any consumer that has not
  // updated its call site produces the same numbers as before.
  if (ctx.landCashPerPeriod && ctx.parcelCashPerPeriod) {
    const totalPeriods = capexPerPeriod.length;
    const landCash = ctx.landCashPerPeriod;
    const parcelCash = ctx.parcelCashPerPeriod;
    const parcelFundingById = new Map(financing.parcelFunding.map((p) => [p.parcelId, p]));
    const nonLandCapex = capexPerPeriod.map((c, i) => Math.max(0, (c ?? 0) - Math.max(0, landCash[i] ?? 0)));

    // Land debt/equity per parcel ratio, period-by-period.
    const landDebt = new Array<number>(totalPeriods).fill(0);
    const landEquity = new Array<number>(totalPeriods).fill(0);
    for (let t = 0; t < totalPeriods; t++) {
      for (const pc of parcelCash) {
        const v = pc.perPeriod[t] ?? 0;
        if (v === 0) continue;
        const f = parcelDebtEquityFractions(parcelFundingById.get(pc.parcelId));
        landDebt[t] += v * f.debt;
        landEquity[t] += v * f.equity;
      }
    }

    // Non-land sized by method-specific logic, then split by method ratio.
    let nonLandPeriodArray: number[];
    let nonLandTotalNeed: number;
    if (method === 1) {
      nonLandPeriodArray = [...nonLandCapex];
      nonLandTotalNeed = nonLandPeriodArray.reduce((s, v) => s + v, 0);
    } else if (method === 2) {
      const existing = financing.netFundingConfig?.existingCash ?? 0;
      nonLandPeriodArray = nonLandCapex.map((c, i) => Math.max(0, c - (preSales[i] ?? 0) - (ocf[i] ?? 0)));
      nonLandTotalNeed = Math.max(0, nonLandPeriodArray.reduce((s, v) => s + v, 0) - existing + minCash);
    } else {
      const initial = financing.cashDeficitConfig?.initialCash ?? 0;
      nonLandPeriodArray = new Array<number>(totalPeriods).fill(0);
      let cash = initial;
      for (let t = 0; t < totalPeriods; t++) {
        const inflow = (preSales[t] ?? 0) + (ocf[t] ?? 0);
        const outflow = nonLandCapex[t] ?? 0;
        const projected = cash + inflow - outflow;
        const required = projected < minCash ? (minCash - projected) : 0;
        nonLandPeriodArray[t] = required;
        cash = projected + required;
      }
      nonLandTotalNeed = nonLandPeriodArray.reduce((s, v) => s + v, 0);
    }

    const r = pickRatio(method, financing);
    const sumR = r.debt + r.equity;
    const dF = sumR > 0 ? r.debt / sumR : 0.7;
    const eF = sumR > 0 ? r.equity / sumR : 0.3;

    const debt = new Array<number>(totalPeriods).fill(0);
    const equity = new Array<number>(totalPeriods).fill(0);
    for (let t = 0; t < totalPeriods; t++) {
      const nl = nonLandPeriodArray[t] ?? 0;
      debt[t] = nl * dF + (landDebt[t] ?? 0);
      equity[t] = nl * eF + (landEquity[t] ?? 0);
    }
    const combinedPeriod = debt.map((d, i) => d + (equity[i] ?? 0));
    const totalLand = landCash.reduce((s, v) => s + Math.max(0, v ?? 0), 0);
    return {
      method,
      totalNeed: nonLandTotalNeed + totalLand,
      periodArray: combinedPeriod,
      debtEquitySplit: { debt, equity },
    };
  }

  // Pre-Pass-18 fallback (no land split data supplied): apply method
  // logic uniformly across the entire capex array.
  if (method === 1) {
    periodArray = [...capexPerPeriod];
    totalNeed = periodArray.reduce((s, v) => s + v, 0);
  } else if (method === 2) {
    const existing = financing.netFundingConfig?.existingCash ?? 0;
    periodArray = capexPerPeriod.map((c, i) => Math.max(0, c - (preSales[i] ?? 0) - (ocf[i] ?? 0)));
    totalNeed = periodArray.reduce((s, v) => s + v, 0) - existing + minCash;
    totalNeed = Math.max(0, totalNeed);
  } else {
    const initial = financing.cashDeficitConfig?.initialCash ?? 0;
    periodArray = new Array(capexPerPeriod.length).fill(0);
    let cash = initial;
    for (let t = 0; t < capexPerPeriod.length; t++) {
      const inflow = (preSales[t] ?? 0) + (ocf[t] ?? 0);
      const outflow = capexPerPeriod[t] ?? 0;
      const projected = cash + inflow - outflow;
      const required = projected < minCash ? (minCash - projected) : 0;
      periodArray[t] = required;
      cash = projected + required;
    }
    totalNeed = periodArray.reduce((s, v) => s + v, 0);
  }

  const ratio = pickRatio(method, financing);
  const debtEquitySplit = splitByRatio(periodArray, ratio.debt, ratio.equity);
  return { method, totalNeed, periodArray, debtEquitySplit };
}

// ── P2-Fix 11 (2026-05-11): equity computation ───────────────────────────
// Total equity need = funding totalNeed * equity ratio.
// In-kind contribution = land-in-kind value (separate from cash equity).
// Cash equity = max(0, totalEquityNeed - inKindContribution).
// Cash distribution mirrors the debt drawdown timing (same period array,
// rescaled to cash equity total).
export interface EquityResult {
  totalEquityNeed: number;
  inKindContribution: number;
  cashContribution: number;
  cashPerPeriod: number[];
  inKindPerPeriod: number[];
  openingPerPeriod: number[];
  closingPerPeriod: number[];
}

export function computeEquity(
  financing: ProjectFinancingConfig,
  funding: FundingResult,
  landInKindValue: number,
): EquityResult {
  // M2.0 Pass 13 (2026-05-13): totalEquityNeed is read directly from
  // the funding split (Method 1's two-rule routing of Land Cash vs
  // non-land means the project-wide equityPct is no longer a clean
  // multiplier of totalNeed). Pre-Pass-13 callers that did not
  // populate the two-rule arrays still produce identical equity
  // numbers because computeFunding's fallback path applies a uniform
  // ratio (so the split sum still equals totalNeed * equityPct).
  const totalEquityNeed = funding.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
  const inKindContribution = Math.max(0, landInKindValue);
  const cashContribution = Math.max(0, totalEquityNeed - inKindContribution);
  const n = funding.periodArray.length;
  const periodWeights = funding.debtEquitySplit.equity;
  const weightSum = periodWeights.reduce((s, v) => s + v, 0);
  const cashPerPeriod: number[] = new Array(n).fill(0);
  if (weightSum > 0) {
    for (let i = 0; i < n; i++) {
      cashPerPeriod[i] = cashContribution * (periodWeights[i] / weightSum);
    }
  } else if (n > 0) {
    cashPerPeriod[0] = cashContribution;
  }
  // In-kind lump lands at period 0 by default (matches Land In-Kind cost line timing).
  const inKindPerPeriod: number[] = new Array(n).fill(0);
  if (n > 0) inKindPerPeriod[0] = inKindContribution;

  const openingPerPeriod: number[] = new Array(n).fill(0);
  const closingPerPeriod: number[] = new Array(n).fill(0);
  let running = 0;
  for (let i = 0; i < n; i++) {
    openingPerPeriod[i] = running;
    running += (cashPerPeriod[i] ?? 0) + (inKindPerPeriod[i] ?? 0);
    closingPerPeriod[i] = running;
  }
  return {
    totalEquityNeed,
    inKindContribution,
    cashContribution,
    cashPerPeriod,
    inKindPerPeriod,
    openingPerPeriod,
    closingPerPeriod,
  };
}

export function computeIdcSummary(
  tranches: FinancingTranche[],
  results: Map<string, FinancingResult>,
): IdcSummary {
  const byFacility: IdcSummary['byFacility'] = [];
  let totalCapitalized = 0;
  let totalExpensed = 0;
  for (const t of tranches) {
    const r = results.get(t.id);
    if (!r) continue;
    const capitalized = r.interestCapitalized.reduce((s, v) => s + v, 0);
    const expensed = r.interestPaid.reduce((s, v) => s + v, 0);
    totalCapitalized += capitalized;
    totalExpensed += expensed;
    byFacility.push({
      id: t.id,
      name: t.name,
      capitalized,
      expensed,
      capitalizedPerPeriod: [...r.interestCapitalized],
      expensedPerPeriod: [...r.interestPaid],
    });
  }
  return { byFacility, totalCapitalized, totalExpensed };
}

// ── M2.0L: IDC capitalized -> Tab 3 auto cost lines ───────────────────────
// For each facility with idcTreatment='capitalize' (or 'mixed' partial),
// generate a read-only cost line per asset in the phase the facility
// finances. Calc engine consumes these so Tab 3 Costs surface a
// rate-free auto-row showing the capitalized IDC.
//
// The cost line:
//   id:           `auto-idc__${facilityId}__${assetId}`
//   phaseId:      facility.phaseId
//   name:         `Auto: IDC from ${facility.name}`
//   method:       'fixed'
//   value:        per-asset share of capitalized IDC for that facility
//   stage:        'soft'    (cost of money)
//   scope:        'indirect'
//   allocationBasis: 'per_asset'
//   startPeriod, endPeriod: facility availability window
//   phasing:      'even'
//   isLocked:     true
//   targetAssetId: assetId
//
// Per-asset share: when facility.assetId is set, 100% to that asset;
// otherwise pro-rata by asset's BUA share within the phase.
export interface AutoIdcCostLineSeed {
  facilityId: string;
  facilityName: string;
  phaseId: string;
  perAsset: Array<{ assetId: string; amount: number; startPeriod: number; endPeriod: number }>;
}

export function applyIdcToCapex(
  tranches: FinancingTranche[],
  results: Map<string, FinancingResult>,
  assets: Asset[],
  subUnits: SubUnit[],
  phases: Phase[],
): AutoIdcCostLineSeed[] {
  const seeds: AutoIdcCostLineSeed[] = [];
  for (const t of tranches) {
    const treatment = t.idcTreatment ?? (t.idcCapitalize ? 'capitalize' : 'expense');
    if (treatment === 'expense') continue;
    if (t.autoGenerateIdcCostLine === false) continue;
    const r = results.get(t.id);
    if (!r) continue;
    const capitalizedTotal = r.interestCapitalized.reduce((s, v) => s + v, 0);
    if (capitalizedTotal <= 0) continue;
    const phase = phases.find((p) => p.id === t.phaseId);
    if (!phase) continue;
    const phaseAssets = assets.filter((a) => a.phaseId === t.phaseId && a.visible);
    if (phaseAssets.length === 0) continue;
    const perAsset: AutoIdcCostLineSeed['perAsset'] = [];
    if (t.assetId) {
      perAsset.push({
        assetId: t.assetId,
        amount: capitalizedTotal,
        startPeriod: 1,
        endPeriod: phase.constructionPeriods,
      });
    } else {
      // Pro-rata by BUA share. Falls back to even split when total BUA = 0.
      const buas = phaseAssets.map((a) => ({ a, bua: computeAssetBua(a, subUnits) }));
      const totalBua = buas.reduce((s, x) => s + x.bua, 0);
      for (const { a, bua } of buas) {
        const share = totalBua > 0 ? bua / totalBua : 1 / phaseAssets.length;
        perAsset.push({
          assetId: a.id,
          amount: capitalizedTotal * share,
          startPeriod: 1,
          endPeriod: phase.constructionPeriods,
        });
      }
    }
    seeds.push({
      facilityId: t.id,
      facilityName: t.name,
      phaseId: t.phaseId,
      perAsset,
    });
  }
  return seeds;
}

// ── M2.0L: Combined debt service across facilities ────────────────────────
export interface CombinedDebtService {
  periods: number;
  totalInterest: number[];
  totalPrincipal: number[];
  totalDebtService: number[];
  totalDrawdown: number[];
  outstandingBalance: number[];
}

export function computeCombinedDebtService(results: Map<string, FinancingResult>): CombinedDebtService {
  let maxPeriods = 0;
  for (const r of results.values()) {
    if (r.periods > maxPeriods) maxPeriods = r.periods;
  }
  const totalInterest = new Array<number>(maxPeriods).fill(0);
  const totalPrincipal = new Array<number>(maxPeriods).fill(0);
  const totalDrawdown = new Array<number>(maxPeriods).fill(0);
  const outstandingBalance = new Array<number>(maxPeriods).fill(0);
  for (const r of results.values()) {
    for (let i = 0; i < r.periods; i++) {
      totalInterest[i] += (r.interestPaid[i] ?? 0) + (r.interestCapitalized[i] ?? 0);
      totalPrincipal[i] += (r.principalRepaid[i] ?? 0);
      totalDrawdown[i] += (r.drawSchedule[i] ?? 0);
      outstandingBalance[i] += (r.outstandingBalance[i] ?? 0);
    }
  }
  const totalDebtService = totalInterest.map((v, i) => v + (totalPrincipal[i] ?? 0));
  return {
    periods: maxPeriods,
    totalInterest,
    totalPrincipal,
    totalDebtService,
    totalDrawdown,
    outstandingBalance,
  };
}

// ── Equity contribution distribution ───────────────────────────────────────
export function distributeEquity(
  contrib: EquityContribution,
  constructionPeriods: number,
): number[] {
  if (contrib.timing === 'upfront') {
    const out = new Array<number>(constructionPeriods).fill(0);
    if (constructionPeriods > 0) out[0] = contrib.amount;
    return out;
  }
  const weights = distribute(
    contrib.timing === 'evenOverPhase' ? 'even' : 'manual',
    constructionPeriods,
    contrib.distribution,
  );
  return weights.map((w) => w * contrib.amount);
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
  'construction-bua':     'hard',
  'construction-parking': 'hard',
  'infrastructure':       'hard',
  'landscaping':          'hard',
  'pre-operating':        'operating',
  'professional-fee':     'soft',
  'commission':           'soft',
  'contingency':          'soft',
};

export function deriveCostStage(line: CostLine): CostStage {
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
  if (driver === 'bua_share') {
    const myBua = computeAssetBua(asset, subUnits);
    const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
    return totalBua > 0 ? myBua / totalBua : 0;
  }
  if (driver === 'land_share') {
    const myLand = computeAssetLandSqm(asset, parcels, phaseAssets, subUnits, mode);
    const totalLand = phaseAssets.reduce(
      (s, a) => s + computeAssetLandSqm(a, parcels, phaseAssets, subUnits, mode),
      0,
    );
    return totalLand > 0 ? myLand / totalLand : 0;
  }
  // value_share: deferred to bua_share until M2.1 Revenue lands so the
  // asset's projected value is computable without a circular dependency
  // on costs.
  const myBua = computeAssetBua(asset, subUnits);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  return totalBua > 0 ? myBua / totalBua : 0;
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
  // endYear=2039 (the inclusive "Project End" caption MAAD expects).
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
// confused MAAD-shape readers. Now MAAD shape (start 2025-01-01, 4
// + 10 = 14 yrs) returns 2038-12-31.
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
// Module1Costs and by the verifier's MAAD-Spec example assertion.
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
    const area = computeSubUnitArea(u);
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

// ── M2.0i Fix 10: Operational phase opening balances + run-rate ───────────
// When phase.status === 'operational', period 0 (Y0) carries the sunk
// costs from before the reporting start. computePhaseHistorical returns
// the opening balances that Module 5 will seed into the cash flow +
// balance sheet at the project's first reported period.
export interface PhaseHistoricalOpeningBalances {
  cashOutflow: number;      // historicalCapexTotal already spent (sunk)
  equityIn: number;         // historicalEquityContributed
  debtDrawn: number;        // historicalDebtDrawn
  debtOutstanding: number;  // currentDebtOutstanding (after historical repayments)
  fixedAssetsNbv: number;   // netBookValueFixedAssets (post-depreciation NBV)
  accumulatedDepreciation: number;
}

export function computePhaseHistorical(phase: Phase): PhaseHistoricalOpeningBalances | null {
  if (phase.status !== 'operational') return null;
  const b = phase.historicalBaseline;
  if (!b) return null;
  return {
    cashOutflow:             Math.max(0, b.historicalCapexTotal),
    equityIn:                Math.max(0, b.historicalEquityContributed),
    debtDrawn:               Math.max(0, b.historicalDebtDrawn),
    debtOutstanding:         Math.max(0, b.currentDebtOutstanding),
    fixedAssetsNbv:          Math.max(0, b.netBookValueFixedAssets),
    accumulatedDepreciation: Math.max(0, b.cumulativeDepreciationCharged),
  };
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
}

// M2.0M Pass 9 Fix 5 (2026-05-12): caption drops the trailing
// "= result" part. The Total column already shows the resolved
// number; the caption only carries the formula (multiplier x metric)
// or the "no X defined yet" warning. Cleaner display, less duplication.
export function costLineCaption(input: CostLineCaptionInput): string {
  const { line, override, asset, metrics, parkingBays, resolvedTotal: _resolvedTotal, selectedTotal, perSubUnitRows } = input;
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
  switch (method) {
    case 'fixed':
      return 'Fixed';
    case 'rate_per_land':
      return metrics.landSqm > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.landSqm)} sqm Land` : noArea('Land area');
    case 'rate_per_nda':
      return metrics.ndaSqm > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.ndaSqm)} sqm NDA` : noArea('NDA');
    case 'rate_per_roads':
      return metrics.roadsSqm > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.roadsSqm)} sqm Roads` : noArea('Roads area');
    case 'rate_per_gfa':
      return metrics.gfa > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.gfa)} sqm GFA` : noArea('GFA');
    case 'rate_per_bua':
      return metrics.bua > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.bua)} sqm BUA` : noArea('BUA');
    case 'rate_per_nsa':
      return metrics.nsa > 0 ? `${fmt(value, 2)} x ${fmtArea(metrics.nsa)} sqm NSA` : noArea('NSA');
    case 'rate_per_unit':
      return metrics.unitCount > 0 ? `${fmt(value, 2)} x ${fmt(metrics.unitCount)} units` : noArea('Unit count');
    case 'rate_per_parking_bay':
      return parkingBays > 0 ? `${fmt(value, 2)} x ${fmt(parkingBays)} parking bays` : noArea('Parking bays');
    case 'rate_x_support_area': {
      const sa = Math.max(0, metrics.supportArea > 0 ? metrics.supportArea : (asset.supportArea ?? 0));
      return sa > 0 ? `${fmt(value, 2)} x ${fmtArea(sa)} sqm Support` : noArea('Support area');
    }
    case 'rate_x_parking_area': {
      const pa = Math.max(0, metrics.parkingArea > 0 ? metrics.parkingArea : (asset.parkingArea ?? 0));
      return pa > 0 ? `${fmt(value, 2)} x ${fmtArea(pa)} sqm Parking` : noArea('Parking area');
    }
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
      if (metrics.totalRevenue <= 0) return noArea('asset revenue (set sub-unit metric x price in Tab 2)');
      const basisLabel = method === 'percent_of_revenue_cash'
        ? 'revenue cash basis'
        : method === 'percent_of_revenue_sale' ? 'revenue sale basis' : 'total revenue';
      return `${fmt(value, 2)}% of ${fmtMoney(metrics.totalRevenue)} (${basisLabel})`;
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
