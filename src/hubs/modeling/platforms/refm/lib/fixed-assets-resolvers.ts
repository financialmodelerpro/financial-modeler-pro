/**
 * Module 4 Pass 1b: Fixed Assets + Depreciation resolver (refactor).
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
  operationsStartIndex,
  computeProjectTimeline,
  resolveUsefulLifeYears,
} from '@/src/core/calculations';
import { collectionsForAssetAtOffset, type CollectionsSource } from '@/src/core/calculations/capexPhasing';
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
> & {
  /**
   * 2026-08-16: the revenue engine's per-asset output, used ONLY to phase cost
   * lines that follow collections. Fixed assets capitalise capex, so WHEN a
   * cost lands changes the additions schedule and therefore depreciation;
   * without this a collections-following line built the asset on a different
   * curve here than in the P&L. Optional so a caller that has no revenue yet
   * still resolves, leaving such lines on their own curve.
   */
  revenue?: CollectionsSource;
};

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
    // M4 Pass 2W (2026-05-24): rescue Phase 1's i=0 lump (see capex.ts).
    const projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1;
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
    // DEPRECIATION BEGINS WHEN THE ASSET IS AVAILABLE FOR USE (2026-08-19),
    // which is the FIRST OPERATING period, `offset + cp`.
    //
    // It used to be `offset + cp - 1`, the LAST CONSTRUCTION period. That index
    // is the M2 PIT REVENUE-RECOGNITION handover, a deliberate and
    // verifier-pinned convention (A2-1..A2-5) for when a unit is handed to a
    // buyer, and it was reused here for a different question. Revenue is
    // recognised on handover; depreciation starts when the asset can be used.
    // One index was answering two rules, so every Operate and Lease asset was
    // charged a full year of depreciation while it was still being built.
    //
    // Measured before the change: 5.791m charged in 2030 on FMP - MARINA GATE
    // (construction ran to 2030, operations start 2031) and 14.294m in 2029 on
    // FMP RE HUB.
    //
    // NO CLAMP TO `N - 1`. The old clamp did two wrong things quietly. A phase
    // with `cp = 0` gave `-1`, which `Math.max(0, ...)` turned into index 0, a
    // guess dressed as an answer; `offset + cp` gives `offset`, which is the
    // right answer for an asset available from the phase start. And a phase
    // whose operations begin beyond the axis gave `N - 1`, starting a year of
    // depreciation in the final period for an asset that never opens; the engine
    // already returns all zeros for a start index past the axis
    // (`buildStraightLine`: `if (start >= out.length) return out`), which is the
    // honest answer. The floor at zero stays, for a phase starting before the
    // project axis.
    //
    // The engine takes this as a FLOOR, not a fixed date: each addition
    // depreciates from `max(its own period, startIdx)`, so capex spent after
    // operations begin still starts in its own period, and an existing asset's
    // opening NBV is unaffected because it depreciates from index 0 regardless.
    //
    // 2026-08-19b: this derived `offset + cp` by hand, which is right only when
    // `overlapPeriods` is zero. It now calls the ONE shared definition, which
    // reads the canonical phase timeline. There was a second hand-rolled copy in
    // the IDC depreciation block, and fixing only this one left depreciation
    // still landing in the last construction year.
    const operationsStartIdx = operationsStartIndex(phase, offset);

    // Per-asset capex breakdown (phase-local arrays).
    const breakdown = computeAssetCost({
      asset,
      project,
      phase,
      parcels: state.parcels,
      assets,
      subUnits: state.subUnits,
      costLines: state.costLines,
      costOverrides: state.costOverrides,
      landAllocationMode: state.landAllocationMode,
      parcelFunding: project.financing?.parcelFunding,
      collectionsPerPeriod: collectionsForAssetAtOffset(state.revenue, asset.id, offset, phase),
      revenue: state.revenue,
    });

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
      startIdx: operationsStartIdx,
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
