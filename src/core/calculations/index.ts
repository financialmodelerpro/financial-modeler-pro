/**
 * src/core/calculations/index.ts (v5 schema)
 *
 * Phase M2.0 (2026-05-06): complete rewrite.
 *
 * Pure calculation functions for the MAAD-Spec Module 1. Inputs are
 * always v5 HydrateSnapshot slices; no React state, no globals.
 *
 * Removed (versus v3/v4):
 *   - computePlotEnvelope
 *   - computeAreaCascade
 *   - computePlotParkingCapacity
 *   - allocateParking
 *   - calculateAreaHierarchy (FAR / Roads / NEA derivation)
 *   - calculateItemTotal (12-cost-line legacy method)
 *   - distributeCost (legacy phasing)
 *   - calcFinancing (single-tranche legacy)
 *
 * Added:
 *   - computeAssetLandCost
 *   - computeAssetBua
 *   - computeAssetSellableBua
 *   - computeAssetCost
 *   - computePhaseCost
 *   - computeFinancing (per-tranche)
 *   - distribute (5 methods: even / sameAsCost / frontloaded / backloaded / manual)
 */

import type {
  Project,
  Phase,
  Parcel,
  Asset,
  SubUnit,
  CostLine,
  CostOverride,
  CostLineKey,
  CostMethod,
  CostPhasing,
  FinancingTranche,
  EquityContribution,
  LandAllocationMode,
  DrawdownMethod,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

// ── Land aggregates ────────────────────────────────────────────────────────
// Project-level: total land area + total cash + in-kind values.
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

// ── Asset BUA + sellable BUA ───────────────────────────────────────────────
// Sum sub-unit area contributions:
//   metric === 'count' -> count * unitArea
//   metric === 'area'  -> metricValue (sqm directly)
// computeAssetBua sums every sub-unit. computeAssetSellableBua sums only
// 'Sellable' + 'Operable' + 'Leasable' categories (not 'Support').
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

// ── Asset land cost ────────────────────────────────────────────────────────
// Resolves each asset's share of total parcel value based on
// landAllocationMode:
//   'sqm'       -> asset.landAreaSqm / totalAreaSqm * totalValue
//   'percent'   -> asset.landAreaPct / 100 * totalValue
//   'autoByBua' -> assetBua / totalBua * totalValue
//
// Returns 0 when total area / total bua are zero (avoids divide-by-zero).
export function computeAssetLandCost(
  asset: Asset,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
  mode: LandAllocationMode,
): number {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const aggregate = computeLandAggregate(phaseParcels);
  if (aggregate.totalValue <= 0) return 0;

  if (mode === 'sqm') {
    if (aggregate.totalAreaSqm <= 0) return 0;
    const share = Math.max(0, asset.landAreaSqm ?? 0) / aggregate.totalAreaSqm;
    return aggregate.totalValue * share;
  }
  if (mode === 'percent') {
    return aggregate.totalValue * (Math.max(0, asset.landAreaPct ?? 0) / 100);
  }
  // autoByBua
  const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  if (totalBua <= 0) return 0;
  const myBua = computeAssetBua(asset, subUnits);
  return aggregate.totalValue * (myBua / totalBua);
}

// ── Cost line resolution ───────────────────────────────────────────────────
// Resolves a CostLine's currency total against the project context. Used
// by computePhaseCost to roll the 9 standard lines + any per-asset
// overrides into a phase total.
export interface CostContext {
  totalLandSqm: number;
  totalBuaSqm: number;
  totalParkingBays: number;
  totalLandValue: number;
  totalCashLandValue: number;
  totalInKindLandValue: number;
}

export function buildCostContext(
  phase: Phase,
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
): CostContext {
  const phaseParcels = parcels.filter((p) => p.phaseId === phase.id);
  const phaseAssets = assets.filter((a) => a.phaseId === phase.id);
  const land = computeLandAggregate(phaseParcels);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  const totalParking = phaseAssets.reduce((s, a) => s + Math.max(0, a.parkingBaysRequired), 0);
  return {
    totalLandSqm: land.totalAreaSqm,
    totalBuaSqm: totalBua,
    totalParkingBays: totalParking,
    totalLandValue: land.totalValue,
    totalCashLandValue: land.cashValue,
    totalInKindLandValue: land.inKindValue,
  };
}

// Resolves a cost line's gross currency total before % methods that
// reference other lines. Returns NaN when method requires a base it
// cannot reach without recursion (% of construction / % of total).
function resolveDirectCost(
  method: CostMethod,
  value: number,
  ctx: CostContext,
): number | null {
  switch (method) {
    case 'lumpsum':
      return Math.max(0, value);
    case 'rate_per_bua':
      return Math.max(0, value) * ctx.totalBuaSqm;
    case 'rate_per_park':
      return Math.max(0, value) * ctx.totalParkingBays;
    case 'rate_per_land':
      return Math.max(0, value) * ctx.totalLandSqm;
    case 'percent_of_construction':
    case 'percent_of_total_cost':
      return null;
  }
}

// ── Phase cost rollup ──────────────────────────────────────────────────────
// Two-pass: first resolve the direct lines, then resolve % methods using
// the direct sums. percent_of_construction sums constructionBua +
// constructionParking. percent_of_total_cost sums every direct line plus
// the percent_of_construction lines, but excludes other percent_of_total
// lines (so contingency on contingency doesn't compound).
export interface PhaseCostBreakdown {
  byLine: Record<CostLineKey, number>;
  constructionTotal: number;
  total: number;
}

export function computePhaseCost(
  phase: Phase,
  costLines: CostLine[],
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
): PhaseCostBreakdown {
  const ctx = buildCostContext(phase, parcels, assets, subUnits);
  const lines = costLines.filter((c) => c.phaseId === phase.id);
  const byLine: Record<CostLineKey, number> = {
    land: 0,
    constructionBua: 0,
    constructionParking: 0,
    infrastructure: 0,
    landscaping: 0,
    preOperating: 0,
    professionalFee: 0,
    commissionFee: 0,
    contingency: 0,
  };

  // Pass 1: direct lines
  for (const line of lines) {
    const direct = resolveDirectCost(line.method, line.value, ctx);
    if (direct !== null) byLine[line.key] = direct;
  }

  // Land line: if method is 'lumpsum' AND value is 0, fall back to the
  // phase's actual parcel total. This is the typical wizard-seeded path.
  const landLine = lines.find((c) => c.key === 'land');
  if (landLine && landLine.method === 'lumpsum' && landLine.value === 0) {
    byLine.land = ctx.totalLandValue;
  }

  const constructionTotal = byLine.constructionBua + byLine.constructionParking;

  // Pass 2: percent_of_construction
  for (const line of lines) {
    if (line.method === 'percent_of_construction') {
      byLine[line.key] = constructionTotal * (Math.max(0, line.value) / 100);
    }
  }

  // Pass 3: percent_of_total_cost. Base = sum of every line resolved so
  // far (direct + percent_of_construction).
  const baseForTotal = (Object.keys(byLine) as CostLineKey[])
    .filter((k) => {
      const line = lines.find((c) => c.key === k);
      return line ? line.method !== 'percent_of_total_cost' : true;
    })
    .reduce((s, k) => s + byLine[k], 0);

  for (const line of lines) {
    if (line.method === 'percent_of_total_cost') {
      byLine[line.key] = baseForTotal * (Math.max(0, line.value) / 100);
    }
  }

  const total = Object.values(byLine).reduce((s, v) => s + v, 0);
  return { byLine, constructionTotal, total };
}

// ── Per-asset cost (with overrides) ────────────────────────────────────────
// Resolves an asset's share of phase cost. For each cost line, if a
// per-asset override exists, that override's method/value applies in
// isolation (the asset gets exactly that override, not a share of the
// project line). Otherwise the asset's share is its BUA-weighted slice.
export interface AssetCostBreakdown {
  byLine: Record<CostLineKey, number>;
  total: number;
}

export function computeAssetCost(
  asset: Asset,
  costLines: CostLine[],
  costOverrides: CostOverride[],
  parcels: Parcel[],
  assets: Asset[],
  subUnits: SubUnit[],
): AssetCostBreakdown {
  const phase = { id: asset.phaseId } as Phase; // type-only stub (cost rollup only reads phase.id)
  const phaseLines = costLines.filter((c) => c.phaseId === asset.phaseId);
  const phaseAssets = assets.filter((a) => a.phaseId === asset.phaseId);
  const ctx = buildCostContext(
    { ...phase, name: '', constructionStart: 0, constructionPeriods: 0, operationsPeriods: 0, overlapPeriods: 0 },
    parcels,
    assets,
    subUnits,
  );
  const myBua = computeAssetBua(asset, subUnits);
  const totalBua = phaseAssets.reduce((s, a) => s + computeAssetBua(a, subUnits), 0);
  const buaShare = totalBua > 0 ? myBua / totalBua : 0;

  const phaseTotals = computePhaseCost(
    { ...phase, name: '', constructionStart: 0, constructionPeriods: 0, operationsPeriods: 0, overlapPeriods: 0 },
    costLines,
    parcels,
    assets,
    subUnits,
  );

  const byLine: Record<CostLineKey, number> = {
    land: 0,
    constructionBua: 0,
    constructionParking: 0,
    infrastructure: 0,
    landscaping: 0,
    preOperating: 0,
    professionalFee: 0,
    commissionFee: 0,
    contingency: 0,
  };

  for (const key of Object.keys(byLine) as CostLineKey[]) {
    const override = costOverrides.find(
      (o) => o.assetId === asset.id && o.key === key,
    );
    if (override) {
      const direct = resolveDirectCost(override.method, override.value, ctx);
      if (direct !== null) {
        byLine[key] = direct;
      } else if (override.method === 'percent_of_construction') {
        byLine[key] = phaseTotals.constructionTotal * (Math.max(0, override.value) / 100);
      } else {
        // percent_of_total_cost as override: share of phase total
        byLine[key] = phaseTotals.total * (Math.max(0, override.value) / 100);
      }
    } else if (key === 'land') {
      // Land always allocated by mode-driven allocation, not BUA share
      byLine[key] = 0; // computeAssetLandCost is called separately by callers
    } else {
      byLine[key] = phaseTotals.byLine[key] * buaShare;
    }
  }

  // Note: Land slot left at 0 here. Callers add computeAssetLandCost
  // for the land number.
  void phaseLines;
  const total = Object.values(byLine).reduce((s, v) => s + v, 0);
  return { byLine, total };
}

// ── Distribution curves ────────────────────────────────────────────────────
// Returns a unit vector of length n that sums to 1.0. Math:
//   even        -> [1/n, 1/n, ..., 1/n]
//   frontloaded -> S-curve weighted toward early periods (decay 0.85)
//   backloaded  -> reverse of frontloaded
//   manual      -> caller-supplied; normalized if it doesn't sum to 1
export function distribute(
  method: CostPhasing | DrawdownMethod | 'sameAsCost',
  n: number,
  manual?: number[],
): number[] {
  if (n <= 0) return [];
  if (method === 'manual') {
    if (!manual || manual.length === 0) return new Array(n).fill(1 / n);
    const padded = manual.slice(0, n);
    while (padded.length < n) padded.push(0);
    const sum = padded.reduce((s, v) => s + Math.max(0, v), 0);
    if (sum <= 0) return new Array(n).fill(1 / n);
    return padded.map((v) => Math.max(0, v) / sum);
  }
  if (method === 'frontloaded') {
    const decay = 0.85;
    const weights = Array.from({ length: n }, (_, i) => Math.pow(decay, i));
    const sum = weights.reduce((s, w) => s + w, 0);
    return weights.map((w) => w / sum);
  }
  if (method === 'backloaded') {
    const decay = 0.85;
    const weights = Array.from({ length: n }, (_, i) => Math.pow(decay, n - 1 - i));
    const sum = weights.reduce((s, w) => s + w, 0);
    return weights.map((w) => w / sum);
  }
  // 'even' and 'sameAsCost' (sameAsCost mirrors capex curve at the call site,
  // not here; treat as even for fallback)
  return new Array(n).fill(1 / n);
}

// ── Financing ──────────────────────────────────────────────────────────────
// Per-tranche debt math. Returns the per-period series for the model
// granularity (months for monthly, years for annual).
export interface FinancingResult {
  periods: number;                 // total period count (construction + operations - overlap)
  periodicRate: number;            // applied rate per period (annual / 12 for monthly)
  drawSchedule: number[];          // per-period debt drawdowns (sums to ltv * capex)
  outstandingBalance: number[];    // per-period closing balance
  interestAccrued: number[];       // per-period interest charge
  interestCapitalized: number[];   // per-period IDC added to principal (when idcCapitalize)
  interestPaid: number[];          // per-period interest paid in cash (non-IDC or post-construction)
  principalRepaid: number[];       // per-period principal repayment
  totalDebt: number;
  totalInterest: number;
  totalRepayment: number;
}

export function computeFinancing(
  tranche: FinancingTranche,
  phase: Phase,
  capexPerPeriod: number[],
  modelType: Project['modelType'],
): FinancingResult {
  const periods = phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods;
  const periodicRate =
    modelType === 'monthly'
      ? Math.max(0, tranche.interestRatePct) / 100 / 12
      : Math.max(0, tranche.interestRatePct) / 100;

  const totalCapex = capexPerPeriod.reduce((s, v) => s + v, 0);
  const totalDebt = totalCapex * (Math.max(0, Math.min(100, tranche.ltvPct)) / 100);

  // Drawdown schedule
  const drawSchedule = new Array<number>(periods).fill(0);
  if (tranche.drawdownMethod === 'sameAsCost') {
    const ratio = totalCapex > 0 ? totalDebt / totalCapex : 0;
    for (let i = 0; i < phase.constructionPeriods && i < periods; i++) {
      drawSchedule[i] = (capexPerPeriod[i] ?? 0) * ratio;
    }
  } else {
    const weights = distribute(
      tranche.drawdownMethod,
      phase.constructionPeriods,
      tranche.drawdownDistribution,
    );
    for (let i = 0; i < weights.length && i < periods; i++) {
      drawSchedule[i] = totalDebt * weights[i];
    }
  }

  // Repayment schedule baseline (refined per method)
  const opsStartIdx = phase.constructionStart - 1 + phase.constructionPeriods - phase.overlapPeriods;
  const repaymentBudget = new Array<number>(periods).fill(0);
  if (tranche.repaymentMethod === 'fixedSchedule' && tranche.repaymentPeriods > 0) {
    const principalPerPeriod = totalDebt / tranche.repaymentPeriods;
    for (let i = 0; i < tranche.repaymentPeriods && (opsStartIdx + i) < periods; i++) {
      repaymentBudget[opsStartIdx + i] = principalPerPeriod;
    }
  } else if (tranche.repaymentMethod === 'bullet' && tranche.repaymentPeriods > 0) {
    const idx = Math.min(periods - 1, opsStartIdx + tranche.repaymentPeriods - 1);
    if (idx >= 0) repaymentBudget[idx] = totalDebt;
  }
  // cashSweep: per-period principal driven by cash position; here we
  // treat it as straight-line over (periods - opsStartIdx) for the
  // current pass. Real cash-sweep math needs Module 3+ revenue inputs;
  // when those modules ship, this branch should consume the cashflow
  // surplus per period.

  // Walk the period series with running balance + interest accrual
  const outstanding = new Array<number>(periods).fill(0);
  const interestAccrued = new Array<number>(periods).fill(0);
  const interestCapitalized = new Array<number>(periods).fill(0);
  const interestPaid = new Array<number>(periods).fill(0);
  const principalRepaid = new Array<number>(periods).fill(0);

  let balance = 0;
  for (let i = 0; i < periods; i++) {
    balance += drawSchedule[i];
    const interest = balance * periodicRate;
    interestAccrued[i] = interest;
    if (tranche.idcCapitalize && i < phase.constructionPeriods) {
      interestCapitalized[i] = interest;
      balance += interest;
    } else {
      interestPaid[i] = interest;
    }
    let repay = repaymentBudget[i] ?? 0;
    if (tranche.repaymentMethod === 'cashSweep' && i >= opsStartIdx) {
      // Placeholder: split balance evenly across remaining periods
      const remainingPeriods = Math.max(1, periods - i);
      repay = balance / remainingPeriods;
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
    totalDebt,
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
  const end = new Date(start);
  if (project.modelType === 'monthly') {
    end.setMonth(end.getMonth() + maxOffset);
  } else {
    end.setFullYear(end.getFullYear() + maxOffset);
  }
  end.setDate(end.getDate() - 1);
  return end.toISOString().slice(0, 10);
}
