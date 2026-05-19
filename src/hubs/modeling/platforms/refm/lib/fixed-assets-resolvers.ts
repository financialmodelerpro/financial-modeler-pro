/**
 * Module 4 Pass 1b — Fixed Assets + Depreciation resolver (refactor).
 *
 * Bridges the M1 store to the depreciation engine and composes the
 * three views the M4 UI / future P&L + BS + CF need:
 *
 *   1. Land roll-forward (pure additive; never depreciates)
 *        opening[0] = asset.historicalPreCapexLand
 *        opening[t] = closing[t-1]
 *        closing[t] = opening[t] + landAdditions[t]
 *
 *   2. Depreciable roll-forward (via the engine)
 *        opening[0] = asset.historicalPreCapexBuilding
 *        engine handles vintage SL + opening NBV writeoff over
 *        usefulLifeYears.
 *
 *   3. Combined Total Fixed Assets
 *        opening[t] = landOpening[t] + depreciableOpening[t]
 *        closing[t] = landClosing[t] + depreciableClosing[t]
 *
 * Scope:
 *   - Hospitality (Operate) + Retail (Lease) + Sell+Manage companions.
 *   - Sell + Sell+Manage parents excluded entirely (capex flows
 *     through M2 Cost of Sales; no Fixed Assets line).
 *
 * Capex per-period projection onto the project axis mirrors
 * aggregateProjectCapex in financing/capex.ts so Module 4 reconciles
 * column-for-column with Module 1 Tab 4.
 */

import {
  computeAssetCost,
  computeProjectTimeline,
  resolveUsefulLifeYears,
} from '@/src/core/calculations';
import {
  computeAssetFixedAssets,
  type AssetFixedAssetResult,
} from '@/src/core/calculations/depreciation';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase } from './state/module1-types';

export interface LandRollForward {
  openingPerPeriod: number[];
  additionsPerPeriod: number[];
  closingPerPeriod: number[];
  /** Opening at axis index 0 (= asset.historicalPreCapexLand). */
  openingAtAxisStart: number;
  /** Total Land additions across the axis. */
  totalAdditions: number;
  /** Closing at last axis idx (= openingAtAxisStart + totalAdditions). */
  closingAtAxisEnd: number;
}

export interface AssetFixedAssetRow {
  assetId: string;
  asset: Asset;
  /** Useful life resolved via resolveUsefulLifeYears(). */
  usefulLifeYears: number;
  land: LandRollForward;
  depreciable: AssetFixedAssetResult;
  /** Combined opening (Land + depreciable NBV). */
  combinedOpeningPerPeriod: number[];
  /** Combined closing (Land + depreciable NBV). */
  combinedClosingPerPeriod: number[];
}

export interface ProjectFixedAssetSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  /** Per-asset row, keyed by asset id. Order matches insertion order. */
  byAsset: Map<string, AssetFixedAssetRow>;
  /** Project totals across every asset row. */
  projectTotals: {
    land: LandRollForward;
    depreciable: {
      additionsPerPeriod: number[];
      depreciationPerPeriod: number[];
      accumDepPerPeriod: number[];
      openingNBVPerPeriod: number[];
      closingNBVPerPeriod: number[];
    };
    combinedOpeningPerPeriod: number[];
    combinedClosingPerPeriod: number[];
  };
}

type ResolverState = Pick<
  Module1Store,
  | 'project'
  | 'phases'
  | 'assets'
  | 'subUnits'
  | 'parcels'
  | 'costLines'
  | 'costOverrides'
  | 'landAllocationMode'
>;

function zeros(n: number): number[] { return new Array<number>(n).fill(0); }

function isDepreciableAsset(a: Asset): boolean {
  if (a.visible === false) return false;
  if (a.isCompanion === true) return true; // companion strategy is always 'Operate'
  return a.strategy === 'Operate' || a.strategy === 'Lease';
}

/**
 * Project a phase-local per-period array onto the project axis using
 * the same offset rule as financing/capex.ts::aggregateProjectCapex.
 *   - Local i = 0 (Y0 upfront): placed at projIdx = offset - 1; Phase 1
 *     (offset === 0) drops the Y0 lump entirely.
 *   - Local i >= 1: projIdx = offset + i - 1.
 */
function projectOntoAxis(local: number[] | undefined, offset: number, N: number): number[] {
  const out = zeros(N);
  if (!local) return out;
  for (let i = 0; i < local.length; i++) {
    const projIdx = i === 0 ? offset - 1 : offset + i - 1;
    if (projIdx < 0 || projIdx >= N) continue;
    out[projIdx] += local[i] ?? 0;
  }
  return out;
}

function buildLandRollForward(openingAtAxisStart: number, additionsPerPeriod: number[]): LandRollForward {
  const N = additionsPerPeriod.length;
  const opening = zeros(N);
  const closing = zeros(N);
  let prev = Math.max(0, openingAtAxisStart);
  let total = 0;
  for (let t = 0; t < N; t++) {
    opening[t] = prev;
    const add = Math.max(0, additionsPerPeriod[t] ?? 0);
    const close = prev + add;
    closing[t] = close;
    prev = close;
    total += add;
  }
  return {
    openingPerPeriod: opening,
    additionsPerPeriod,
    closingPerPeriod: closing,
    openingAtAxisStart: Math.max(0, openingAtAxisStart),
    totalAdditions: total,
    closingAtAxisEnd: closing[N - 1] ?? Math.max(0, openingAtAxisStart),
  };
}

export function computeAllFixedAssetResults(state: ResolverState): ProjectFixedAssetSnapshot {
  const { project, phases, assets } = state;

  // ── Project axis (matches revenue-resolvers convention) ─────────
  const timeline = computeProjectTimeline(project, phases);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  let maxEnd = Math.max(1, timeline.totalPeriods);
  for (const p of phases) {
    const ps = p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear;
    const psIdx = Math.max(0, ps - projectStartYear);
    const phaseLen = Math.max(0, (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) - (p.overlapPeriods ?? 0));
    if (psIdx + phaseLen > maxEnd) maxEnd = psIdx + phaseLen;
  }
  const N = maxEnd;
  const yearLabels = Array.from({ length: N }, (_, i) => projectStartYear + i);

  const phaseMap = new Map<string, Phase>();
  for (const p of phases) phaseMap.set(p.id, p);

  const byAsset = new Map<string, AssetFixedAssetRow>();
  const totals = {
    land: buildLandRollForward(0, zeros(N)),  // placeholder, rebuilt below
    depreciable: {
      additionsPerPeriod: zeros(N),
      depreciationPerPeriod: zeros(N),
      accumDepPerPeriod: zeros(N),
      openingNBVPerPeriod: zeros(N),
      closingNBVPerPeriod: zeros(N),
    },
    combinedOpeningPerPeriod: zeros(N),
    combinedClosingPerPeriod: zeros(N),
  };

  // Accumulators (rebuild totals.land at the end so the running
  // additive sum stays consistent across multi-asset projects).
  let projectOpeningLand = 0;
  const projectLandAdditions = zeros(N);

  for (const asset of assets) {
    if (!isDepreciableAsset(asset)) continue;
    const phase = phaseMap.get(asset.phaseId);
    if (!phase) continue;

    const phaseStartYear = phase.startDate
      ? new Date(phase.startDate).getUTCFullYear()
      : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const handoverIdx = Math.max(0, Math.min(N - 1, offset + cp - 1));

    // Per-asset capex breakdown (phase-local arrays).
    const breakdown = computeAssetCost(
      asset,
      project,
      phase,
      state.parcels,
      assets,
      state.subUnits,
      state.costLines,
      state.costOverrides,
      state.landAllocationMode,
      project.financing?.parcelFunding,
    );

    // Project onto the project axis.
    const additionsAll = projectOntoAxis(breakdown.perPeriod, offset, N);
    const additionsLand = projectOntoAxis(breakdown.perPeriodLandTotal, offset, N);
    const additionsDepreciable = additionsAll.map((v, i) => Math.max(0, v - (additionsLand[i] ?? 0)));

    // Existing operations: Pass 56 split.
    const openingLand = Math.max(0, asset.historicalPreCapexLand ?? 0);
    const openingBuilding = Math.max(0, asset.historicalPreCapexBuilding ?? 0);

    // Land roll-forward (pure additive).
    const land = buildLandRollForward(openingLand, additionsLand);

    // Depreciable roll-forward (engine).
    const usefulLifeYears = resolveUsefulLifeYears(asset);
    const method = asset.depreciationMethod ?? 'straight_line';
    const depreciable = computeAssetFixedAssets({
      assetId: asset.id,
      axisLength: N,
      startIdx: handoverIdx,
      additionsPerPeriod: additionsDepreciable,
      usefulLifeYears,
      openingNBV: openingBuilding,
      method,
      reducingBalanceRate: asset.depreciationRate,
    });

    // Combined per-period totals.
    const combinedOpening = zeros(N);
    const combinedClosing = zeros(N);
    for (let t = 0; t < N; t++) {
      combinedOpening[t] = (land.openingPerPeriod[t] ?? 0) + (depreciable.openingNBVPerPeriod[t] ?? 0);
      combinedClosing[t] = (land.closingPerPeriod[t] ?? 0) + (depreciable.closingNBVPerPeriod[t] ?? 0);
    }

    byAsset.set(asset.id, {
      assetId: asset.id,
      asset,
      usefulLifeYears,
      land,
      depreciable,
      combinedOpeningPerPeriod: combinedOpening,
      combinedClosingPerPeriod: combinedClosing,
    });

    // Accumulate project totals.
    projectOpeningLand += openingLand;
    for (let t = 0; t < N; t++) {
      projectLandAdditions[t] += additionsLand[t] ?? 0;
      totals.depreciable.additionsPerPeriod[t] += depreciable.additionsPerPeriod[t] ?? 0;
      totals.depreciable.depreciationPerPeriod[t] += depreciable.depreciationPerPeriod[t] ?? 0;
      totals.depreciable.openingNBVPerPeriod[t] += depreciable.openingNBVPerPeriod[t] ?? 0;
      totals.depreciable.closingNBVPerPeriod[t] += depreciable.closingNBVPerPeriod[t] ?? 0;
    }
  }

  totals.land = buildLandRollForward(projectOpeningLand, projectLandAdditions);
  // Project accumDep is the cum-sum of the project dep stream.
  let cum = 0;
  for (let t = 0; t < N; t++) {
    cum += totals.depreciable.depreciationPerPeriod[t];
    totals.depreciable.accumDepPerPeriod[t] = cum;
  }
  // Project combined opening / closing.
  for (let t = 0; t < N; t++) {
    totals.combinedOpeningPerPeriod[t] = (totals.land.openingPerPeriod[t] ?? 0) + (totals.depreciable.openingNBVPerPeriod[t] ?? 0);
    totals.combinedClosingPerPeriod[t] = (totals.land.closingPerPeriod[t] ?? 0) + (totals.depreciable.closingNBVPerPeriod[t] ?? 0);
  }

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    byAsset,
    projectTotals: totals,
  };
}
