/**
 * Module 4 Pass 1 — Fixed Assets + Depreciation resolver.
 *
 * Bridges the M1 Zustand store (project / phases / assets / parcels /
 * costLines / costOverrides / parcelFunding / land mode) into the pure
 * depreciation engine in src/core/calculations/depreciation/.
 *
 * Scope (Pass 1):
 *   - Hospitality (Operate) + Retail (Lease) assets only. Sell + Sell
 *     + Manage parents are excluded entirely — their capex flows
 *     through Cost of Sales in M2 (no Fixed Assets line on the BS).
 *   - Sell + Manage companions (isCompanion === true, strategy 'Operate')
 *     do roll through here, mirroring how revenue / opex treat them.
 *   - Straight-line method with per-asset useful life via
 *     resolveUsefulLifeYears(). DEFAULT_USEFUL_LIFE_YEARS supplies the
 *     fallback (Hospitality 20 / Retail 25 / Office 25 / Residential 30).
 *   - Existing-operations opening NBV comes from
 *     asset.historicalPreCapexBuilding (the depreciable half of the
 *     Pass 56 split; Land is the non-depreciable half).
 *   - Axis: project-axis convention (`arr[0]` = first active year).
 *     Capex per-period projection mirrors aggregateProjectCapex in
 *     src/core/calculations/financing/capex.ts so Module 4 numbers
 *     reconcile column-for-column with Module 1 Tab 4 Costs.
 *
 * Result snapshot parallels the Revenue / Opex snapshots so the M4 P&L
 * + BS + CF surfaces can consume it the same way.
 */

import {
  computeAssetCost,
  computeProjectTimeline,
  resolveUsefulLifeYears,
} from '@/src/core/calculations';
import {
  computeAssetFixedAssets,
  type AssetFixedAssetResult,
  type ProjectFixedAssetTotals,
} from '@/src/core/calculations/depreciation';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase } from './state/module1-types';

export interface ProjectFixedAssetSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  /** Per-asset depreciation roll-forward, keyed by asset id. */
  byAsset: Map<string, AssetFixedAssetResult>;
  /** Project totals across every Hospitality + Lease asset. */
  projectTotals: ProjectFixedAssetTotals;
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

/**
 * True when the asset's capex should depreciate (rather than flow
 * through CoS). Sell + Sell + Manage PARENTS are CoS. Sell + Manage
 * COMPANIONS (isCompanion === true) and pure Operate / Lease assets
 * carry Fixed Assets + D&A.
 */
function isDepreciableAsset(a: Asset): boolean {
  if (a.visible === false) return false;
  if (a.isCompanion === true) return true; // companion strategy is always 'Operate'
  return a.strategy === 'Operate' || a.strategy === 'Lease';
}

/**
 * Project an asset's phase-local per-period array onto the project
 * axis using the same offset rule as
 * `src/core/calculations/financing/capex.ts::aggregateProjectCapex`:
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

  // Phase lookup
  const phaseMap = new Map<string, Phase>();
  for (const p of phases) phaseMap.set(p.id, p);

  const byAsset = new Map<string, AssetFixedAssetResult>();
  const totals: ProjectFixedAssetTotals = {
    axisLength: N,
    additionsPerPeriod: zeros(N),
    additionsLandPerPeriod: zeros(N),
    depreciableAdditionsPerPeriod: zeros(N),
    depreciationPerPeriod: zeros(N),
    accumDepPerPeriod: zeros(N),
    openingNBVPerPeriod: zeros(N),
    closingNBVPerPeriod: zeros(N),
  };

  for (const asset of assets) {
    if (!isDepreciableAsset(asset)) continue;
    const phase = phaseMap.get(asset.phaseId);
    if (!phase) continue;

    // Phase offset on the project axis (same convention as
    // aggregateProjectCapex / revenue resolvers).
    const phaseStartYear = phase.startDate
      ? new Date(phase.startDate).getUTCFullYear()
      : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    // Handover index = LAST construction year on the project axis. New
    // additions before handover sit as WIP and start depreciating from
    // handover; additions after handover (e.g. operating-stage capex /
    // FF&E replacement) depreciate from their own spend year.
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

    // Project onto project axis.
    const additionsPerPeriod = projectOntoAxis(breakdown.perPeriod, offset, N);
    const additionsLandPerPeriod = projectOntoAxis(breakdown.perPeriodLandTotal, offset, N);

    // Existing-operations opening NBV. The Pass 56 split keeps Land
    // separate (Land never depreciates); only the Building portion
    // seeds the opening NBV.
    const openingNBV = Math.max(0, asset.historicalPreCapexBuilding ?? 0);

    const usefulLifeYears = resolveUsefulLifeYears(asset);

    const result = computeAssetFixedAssets({
      assetId: asset.id,
      axisLength: N,
      startIdx: handoverIdx,
      additionsPerPeriod,
      additionsLandPerPeriod,
      usefulLifeYears,
      openingNBV,
      // openingAccumDep + openingRemainingLife left undefined for Pass
      // 1; the engine treats opening NBV as fully fresh basis spread
      // over usefulLifeYears, matching the reference model behaviour
      // for pre-existing assets that the user enters as a single NBV
      // line without service-life metadata.
    });
    byAsset.set(asset.id, result);

    // Accumulate project totals.
    for (let t = 0; t < N; t++) {
      totals.additionsPerPeriod[t] += result.additionsPerPeriod[t] ?? 0;
      totals.additionsLandPerPeriod[t] += result.additionsLandPerPeriod[t] ?? 0;
      totals.depreciableAdditionsPerPeriod[t] += result.depreciableAdditionsPerPeriod[t] ?? 0;
      totals.depreciationPerPeriod[t] += result.depreciationPerPeriod[t] ?? 0;
      totals.openingNBVPerPeriod[t] += result.openingNBVPerPeriod[t] ?? 0;
      totals.closingNBVPerPeriod[t] += result.closingNBVPerPeriod[t] ?? 0;
    }
  }

  // Cumulative project accumDep is derived from the project dep stream
  // (cum-sum is associative across assets so summing per-asset
  // accumDep matches a fresh cum-sum of the project dep stream).
  let cum = 0;
  for (let t = 0; t < N; t++) {
    cum += totals.depreciationPerPeriod[t];
    totals.accumDepPerPeriod[t] = cum;
  }

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    byAsset,
    projectTotals: totals,
  };
}
