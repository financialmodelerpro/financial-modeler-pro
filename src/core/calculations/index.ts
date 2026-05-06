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
  AllocationBasis,
  FinancingTranche,
  EquityContribution,
  LandAllocationMode,
  DrawdownMethod,
  RepaymentMethod,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { DEFAULT_USEFUL_LIFE_YEARS } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

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
export function computeSubUnitArea(u: SubUnit): number {
  if (u.metric === 'count') {
    return Math.max(0, u.metricValue) * Math.max(0, u.unitArea ?? 0);
  }
  return Math.max(0, u.metricValue);
}

export function computeAssetBua(asset: Asset, subUnits: SubUnit[]): number {
  if (asset.buaSqm > 0) return asset.buaSqm;
  return subUnits
    .filter((u) => u.assetId === asset.id)
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
}

export function computeAssetSellableBua(asset: Asset, subUnits: SubUnit[]): number {
  if (asset.sellableBuaSqm > 0) return asset.sellableBuaSqm;
  return subUnits
    .filter((u) => u.assetId === asset.id && u.category !== 'Support')
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
}

// Sum of Sellable / Operable / Leasable units where metric === 'count'.
// Used by the rate_per_unit cost method.
export function computeAssetUnitCount(asset: Asset, subUnits: SubUnit[]): number {
  return subUnits
    .filter((u) => u.assetId === asset.id && u.metric === 'count' && u.category !== 'Support')
    .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
}

// ── Asset land sqm + value ─────────────────────────────────────────────────
// Resolve each asset's land area in sqm based on landAllocationMode.
export function computeAssetLandSqm(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const agg = computeLandAggregate(phaseParcels);
  if (agg.totalAreaSqm <= 0) return 0;
  if (mode === 'sqm') {
    return Math.max(0, asset.landAreaSqm ?? 0);
  }
  if (mode === 'percent') {
    return agg.totalAreaSqm * (Math.max(0, asset.landAreaPct ?? 0) / 100);
  }
  // autoByBua
  const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  if (totalBua <= 0) return 0;
  const myBua = computeAssetBua(asset, subUnits);
  return agg.totalAreaSqm * (myBua / totalBua);
}

export function computeAssetLandCost(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const agg = computeLandAggregate(phaseParcels);
  if (agg.totalValue <= 0) return 0;
  if (mode === 'sqm') {
    if (agg.totalAreaSqm <= 0) return 0;
    return agg.totalValue * (Math.max(0, asset.landAreaSqm ?? 0) / agg.totalAreaSqm);
  }
  if (mode === 'percent') {
    return agg.totalValue * (Math.max(0, asset.landAreaPct ?? 0) / 100);
  }
  const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  if (totalBua <= 0) return 0;
  const myBua = computeAssetBua(asset, subUnits);
  return agg.totalValue * (myBua / totalBua);
}

// ── Asset area metrics ─────────────────────────────────────────────────────
// Resolves the area / value bases that the calc methods need for a single
// asset. Replaces the pre-M2.0 AreaMetrics interface.
export interface AssetAreaMetrics {
  landSqm: number;
  ndaSqm: number;
  roadsSqm: number;
  gfa: number;
  bua: number;
  nsa: number;
  unitCount: number;
  parkingBays: number;        // M2.0d: drives rate_per_parking_bay
  landValue: number;
  cashLandValue: number;
  inKindLandValue: number;
}

export function resolveAssetAreaMetrics(
  asset: Asset,
  project: Project,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): AssetAreaMetrics {
  const landSqm = computeAssetLandSqm(asset, parcels, assets, subUnits, mode);
  const roadsPct = Math.max(0, Math.min(100, project.projectRoadsPct ?? 0));
  const ndaSqm = landSqm * (1 - roadsPct / 100);
  const roadsSqm = landSqm - ndaSqm;
  const bua = computeAssetBua(asset, subUnits);
  const nsa = computeAssetSellableBua(asset, subUnits);
  const unitCount = computeAssetUnitCount(asset, subUnits);
  const landValue = computeAssetLandCost(asset, parcels, assets, subUnits, mode);
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const agg = computeLandAggregate(phaseParcels);
  // Cash / in-kind splits track the asset's land value share of agg.totalValue.
  const valueShare = agg.totalValue > 0 ? landValue / agg.totalValue : 0;
  const cashLandValue = agg.cashValue * valueShare;
  const inKindLandValue = agg.inKindValue * valueShare;
  return {
    landSqm,
    ndaSqm,
    roadsSqm,
    gfa: asset.gfaSqm,
    bua,
    nsa,
    unitCount,
    parkingBays: Math.max(0, asset.parkingBaysRequired ?? 0),
    landValue,
    cashLandValue,
    inKindLandValue,
  };
}

// ── Cost item total (per asset) ────────────────────────────────────────────
// ctx.assetMetrics + ctx.allLines lets the function resolve direct + % methods
// in one place. Returns currency total for the line as it applies to this
// asset (after override resolution by the caller).
export interface AssetCostContext {
  asset: Asset;
  metrics: AssetAreaMetrics;
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
// across the construction window (length = constructionPeriods + 1, index
// 0 = upfront / pre-construction). startPeriod = 0 means upfront-lump.
export function distributeItemCost(
  line: CostLine,
  total: number,
  constructionPeriods: number,
): number[] {
  const out = new Array<number>(constructionPeriods + 1).fill(0);
  if (line.startPeriod === 0 && line.endPeriod === 0) {
    out[0] = total;
    return out;
  }
  const start = clamp(line.startPeriod, 0, constructionPeriods);
  const end = clamp(line.endPeriod, start, constructionPeriods);
  const span = Math.max(1, end - start + 1);
  const weights = distribute(line.phasing, span, line.distribution);
  for (let i = 0; i < span; i++) {
    const p = start + i;
    if (p <= constructionPeriods) out[p] = total * (weights[i] ?? 0);
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
): AssetCostBreakdown {
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
  const phaseLines = costLines.filter((c) => c.phaseId === phase.id);
  const metrics = resolveAssetAreaMetrics(asset, project, parcels, phaseAssets, subUnits, landAllocationMode);

  // Resolve the per-asset method/value/phasing for each line, applying
  // overrides where present.
  const resolved: Array<{ line: CostLine; method: CostMethod; value: number; phasing: CostPhasing; distribution?: number[] }> = phaseLines.map((line) => {
    const ov = costOverrides.find((o) => o.assetId === asset.id && o.lineId === line.id);
    if (ov) {
      return { line, method: ov.method, value: ov.value, phasing: ov.phasing, distribution: ov.distribution };
    }
    return { line, method: line.method, value: line.value, phasing: line.phasing, distribution: line.distribution };
  });

  // Pass 1: direct methods (everything except percent_of_selected /
  // percent_of_construction). Apply allocation factor for project-level
  // lines (allocationBasis !== 'per_asset' && !== 'manual').
  const directTotals: Record<string, number> = {};
  for (const r of resolved) {
    const isPct = r.method === 'percent_of_selected' || r.method === 'percent_of_construction';
    if (isPct) continue;
    const ctxStub: AssetCostContext = { asset, metrics, resolvedDirectLineTotals: {} };
    const projectLevelTotal = calculateItemTotal(
      { ...r.line, method: r.method, value: r.value },
      ctxStub,
      true,
    );
    const allocFactor = resolveAllocationFactor(
      r.line.allocationBasis,
      asset,
      phaseAssets,
      parcels,
      subUnits,
      landAllocationMode,
    );
    directTotals[r.line.id] = projectLevelTotal * allocFactor;
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

  // Per-period schedule
  const cp = phase.constructionPeriods;
  const perPeriod = new Array<number>(cp + 1).fill(0);
  for (const r of resolved) {
    const t = byLineId[r.line.id] ?? 0;
    if (t === 0) continue;
    const dist = distributeItemCost(
      { ...r.line, phasing: r.phasing, distribution: r.distribution },
      t,
      cp,
    );
    for (let i = 0; i <= cp; i++) perPeriod[i] += dist[i] ?? 0;
  }

  return { byLineId, byStage, total, perPeriod };
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
): PhaseCostBreakdown {
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
  const byAssetId: Record<string, AssetCostBreakdown> = {};
  const byStage: Record<CostStage, number> = { land: 0, hard: 0, soft: 0, operating: 0 };
  let total = 0;
  const cp = phase.constructionPeriods;
  const perPeriod = new Array<number>(cp + 1).fill(0);

  for (const a of phaseAssets) {
    const breakdown = computeAssetCost(a, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode);
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

  // Drawdown schedule (length periods).
  const drawSchedule = new Array<number>(periods).fill(0);
  const drawWindow = Math.min(constructionPeriods, periods);

  switch (tranche.drawdownMethod) {
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
    case 'capex_minus_presales': {
      // Net capex = capex - presales. If drawdownIncludeLand is false,
      // exclude the period-0 land lump from the capex base.
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
      const totalDebt = totalCapex * ltv;
      const sum = dist.reduce((s, v) => s + (v ?? 0), 0);
      for (let i = 0; i < drawWindow; i++) {
        const w = sum > 0 ? (dist[i] ?? 0) / sum : 1 / drawWindow;
        drawSchedule[i] = totalDebt * w;
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
  }

  const totalDebtFromDraws = drawSchedule.reduce((s, v) => s + v, 0);

  // Walk balance + interest + repayment.
  const outstanding = new Array<number>(periods).fill(0);
  const interestAccrued = new Array<number>(periods).fill(0);
  const interestCapitalized = new Array<number>(periods).fill(0);
  const interestPaid = new Array<number>(periods).fill(0);
  const principalRepaid = new Array<number>(periods).fill(0);

  // Pre-compute repayment baseline (where applicable). Index into the
  // total period array, not the construction window.
  const opsStartIdx = constructionPeriods - overlap;
  const repBudget = new Array<number>(periods).fill(0);
  if (tranche.repaymentMethod === 'manual') {
    const dist = tranche.repaymentManualDistribution ?? [];
    for (let i = 0; i < periods; i++) repBudget[i] = Math.max(0, dist[i] ?? 0);
  } else if (tranche.repaymentMethod === 'straight_line' && tranche.repaymentPeriods > 0) {
    const principalPerPeriod = totalDebtFromDraws / tranche.repaymentPeriods;
    for (let i = 0; i < tranche.repaymentPeriods && (opsStartIdx + i) < periods; i++) {
      repBudget[opsStartIdx + i] = principalPerPeriod;
    }
  }

  let balance = 0;
  for (let i = 0; i < periods; i++) {
    balance += drawSchedule[i] ?? 0;
    const interest = balance * periodicRate;
    interestAccrued[i] = interest;
    if (tranche.idcCapitalize && i < constructionPeriods) {
      interestCapitalized[i] = interest;
      balance += interest;
    } else {
      interestPaid[i] = interest;
    }
    let repay = repBudget[i] ?? 0;
    // Cash sweep variants: simple approximation here, real cash sweep
    // needs Module 3 cashflow surplus per period.
    if (tranche.repaymentMethod === 'cashsweep_continuous' && i >= opsStartIdx) {
      const remaining = Math.max(1, periods - i);
      repay = balance / remaining;
    }
    if (tranche.repaymentMethod === 'cashsweep_from_period') {
      const start = Math.max(opsStartIdx, tranche.sweepStartPeriod ?? opsStartIdx);
      if (i >= start) {
        const remaining = Math.max(1, periods - i);
        repay = balance / remaining;
      }
    }
    if (tranche.repaymentMethod === 'cashsweep_min_cash' && i >= opsStartIdx) {
      // Cash above floor goes to principal. Approximate by sweeping
      // straight-line over remaining periods (Module 3 will refine).
      const remaining = Math.max(1, periods - i);
      repay = balance / remaining;
    }
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
  return STANDARD_STAGE_BY_ID[line.id] ?? line.stage;
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

// ── Project end date ───────────────────────────────────────────────────────
export function computeProjectEndDate(project: Project, phases: Phase[]): string {
  if (phases.length === 0) return project.startDate;
  const start = new Date(project.startDate);
  if (Number.isNaN(start.getTime())) return project.startDate;
  let maxOffset = 0;
  for (const phase of phases) {
    const offset =
      (phase.constructionStart - 1) +
      phase.constructionPeriods +
      phase.operationsPeriods -
      phase.overlapPeriods;
    if (offset > maxOffset) maxOffset = offset;
  }
  const out = new Date(start);
  if (project.modelType === 'monthly') {
    out.setMonth(out.getMonth() + maxOffset);
  } else {
    out.setFullYear(out.getFullYear() + maxOffset);
  }
  return out.toISOString().slice(0, 10);
}
