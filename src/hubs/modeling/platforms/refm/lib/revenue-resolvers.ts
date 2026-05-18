/**
 * Revenue resolvers.
 *
 * Bridge between the M1 Zustand store (project / phases / assets /
 * subUnits / costLines / costOverrides / parcelFunding / land mode) and
 * the pure revenue engine in src/core/calculations/revenue.
 *
 * Two responsibilities:
 *   1. computeAllSellResults(state) -> Map of every Sell-strategy
 *      asset's per-period revenue / cash / recognition / escrow stream.
 *   2. computeAssetCapex(state, assetId) -> total capex for an asset
 *      (drives Cost of Sales in M2 Tab 3).
 *
 * Engine helpers stay pure; the bridge stays here so the engine never
 * imports from src/hubs (matches the M1.7 resolver pattern).
 */

import {
  computeProjectTimeline,
  computeAssetCost,
  computeSubUnitArea,
} from '@/src/core/calculations';
import {
  computeSellAsset,
  resolveHandoverYear,
  buildAccountsReceivable,
  buildUnearnedRevenue,
  buildCostOfSales,
  type AssetSellConfig,
  type CashPaymentProfile,
  type IndexationConfig,
  type RecognitionProfile,
  type SellAssetResult,
  type SubUnitMaterial,
  type AccountsReceivableResult,
  type UnearnedRevenueResult,
  type CostOfSalesResult,
} from '@/src/core/calculations/revenue';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase, Project, SubUnit } from './state/module1-types';

/**
 * Default Sell asset seed used when fields are missing on a fresh
 * asset. Pass 7g (2026-05-17) removed the project-wide template; each
 * asset owns its own cash + recognition + indexation. The DEFAULT_*
 * objects below are the empty / "no schedule" baselines that the
 * resolver returns when the asset hasn't been edited yet.
 *
 * Exported because the Output tab uses them as render fallbacks when
 * the user hasn't filled a profile yet.
 */
const DEFAULT_CASH_PROFILE: CashPaymentProfile = { percentages: [], profileMode: 'absolute_with_catchup' };
const DEFAULT_RECOGNITION_PROFILE: RecognitionProfile = { method: 'point_in_time', pointInTimeYear: 'handover' };
const DEFAULT_INDEXATION: IndexationConfig = { method: 'none' };
export const DEFAULT_SELL_TEMPLATE = {
  cashPaymentProfile: DEFAULT_CASH_PROFILE,
  recognitionProfile: DEFAULT_RECOGNITION_PROFILE,
  indexation: DEFAULT_INDEXATION,
} as const;

/**
 * Build an AssetSellConfig for the engine. Pass 7g: reads cash +
 * recognition + indexation directly from the asset; defaults fill
 * unset fields. No project-level template, no override flag.
 */
export function resolveSellConfig(asset: Asset, _project: Project): AssetSellConfig | null {
  const cfg = asset.revenue?.sell;
  if (!cfg) return null;
  return {
    assetId: asset.id,
    subUnits: cfg.subUnits,
    cashPaymentProfile: cfg.cashPaymentProfile ?? DEFAULT_CASH_PROFILE,
    recognitionProfile: cfg.recognitionProfile ?? DEFAULT_RECOGNITION_PROFILE,
    indexation: cfg.indexation ?? DEFAULT_INDEXATION,
    handoverYearOverride: cfg.handoverYearOverride,
  };
}

function makeSubUnitMaterial(u: SubUnit): SubUnitMaterial {
  const area = computeSubUnitArea(u);
  if (u.metric === 'units') {
    const count = Math.max(0, u.metricValue);
    const unitArea = Math.max(0, u.unitArea ?? 0);
    const ratePerArea = unitArea > 0 ? u.unitPrice / unitArea : 0;
    return { id: u.id, area, count, ratePerArea, ratePerUnit: u.unitPrice, metric: u.metric };
  }
  return { id: u.id, area, count: 0, ratePerArea: u.unitPrice, ratePerUnit: 0, metric: u.metric };
}

export interface ProjectRevenueSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  bySellAsset: Map<string, SellAssetResult>;
  projectTotals: SellAssetResult;
}

export function computeAllSellResults(state: Pick<Module1Store, 'project' | 'phases' | 'assets' | 'subUnits'>): ProjectRevenueSnapshot {
  const { project, phases, assets, subUnits } = state;
  const timeline = computeProjectTimeline(project, phases);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  // Mirror buildProjectAxis: inclusive slot count derived from
  // max(phaseOffset + cp + op - overlap), not endYear - startYear (which
  // is years elapsed and off-by-one for the last operating year).
  let maxEnd = Math.max(1, timeline.totalPeriods);
  for (const p of phases) {
    const ps = p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear;
    const psIdx = Math.max(0, ps - projectStartYear);
    const phaseLen = Math.max(0, (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) - (p.overlapPeriods ?? 0));
    if (psIdx + phaseLen > maxEnd) maxEnd = psIdx + phaseLen;
  }
  const N = maxEnd;
  const yearLabels = Array.from({ length: N }, (_, i) => projectStartYear + i);

  const bySellAsset = new Map<string, SellAssetResult>();
  const emptyArr = (): number[] => new Array<number>(N).fill(0);
  const emptyMatrix = (): number[][] => { const m: number[][] = []; for (let i = 0; i < N; i++) m.push(new Array<number>(N).fill(0)); return m; };

  const projectTotals: SellAssetResult = {
    assetId: '__project__',
    axisLength: N,
    presalesUnitsPerPeriod: emptyArr(),
    presalesAreaPerPeriod: emptyArr(),
    presalesRevenuePerPeriod: emptyArr(),
    postSalesUnitsPerPeriod: emptyArr(),
    postSalesAreaPerPeriod: emptyArr(),
    postSalesRevenuePerPeriod: emptyArr(),
    presalesAreaPerPeriodPerSubUnit: {},
    presalesRevenuePerPeriodPerSubUnit: {},
    postSalesAreaPerPeriodPerSubUnit: {},
    postSalesRevenuePerPeriodPerSubUnit: {},
    cashCollectedPerPeriod: emptyArr(),
    presalesCashPerPeriod: emptyArr(),
    postSalesCashPerPeriod: emptyArr(),
    recognitionPerPeriod: emptyArr(),
    presalesRecognitionPerPeriod: emptyArr(),
    postSalesRecognitionPerPeriod: emptyArr(),
    presalesSalesValuePerPeriod: emptyArr(),
    cashVintageMatrix: emptyMatrix(),
    recognitionVintageMatrix: emptyMatrix(),
  };

  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    // Pass 7w (2026-05-18): Sell + Manage parents share the same
    // sell-side revenue mechanics as pure Sell (Pre-Sales velocity +
    // Sales During Operation + cash + recognition + indexation). The
    // companion (operate side) wires in at Pass 10 and lives in
    // Hospitality / Operations.
    if (a.strategy !== 'Sell' && a.strategy !== 'Sell + Manage') continue;
    const cfg = resolveSellConfig(a, project);
    if (!cfg) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;

    const phaseStartYear = phase.startDate
      ? new Date(phase.startDate).getUTCFullYear()
      : projectStartYear;
    const handoverYear = resolveHandoverYear(
      N,
      phaseStartYear,
      phase.constructionPeriods ?? 0,
      projectStartYear,
      cfg.handoverYearOverride,
    );
    const assetSubUnits = subUnits.filter((u) => u.assetId === a.id);
    const subUnitMaterials = assetSubUnits.map(makeSubUnitMaterial);

    const result = computeSellAsset({
      config: cfg,
      subUnits: subUnitMaterials,
      axisLength: N,
      handoverYear,
    });
    bySellAsset.set(a.id, result);

    const acc = (key: keyof SellAssetResult): void => {
      const src = result[key] as number[];
      const dst = projectTotals[key] as number[];
      for (let i = 0; i < N; i++) dst[i] += src[i] ?? 0;
    };
    acc('presalesUnitsPerPeriod');
    acc('presalesAreaPerPeriod');
    acc('presalesRevenuePerPeriod');
    acc('postSalesUnitsPerPeriod');
    acc('postSalesAreaPerPeriod');
    acc('postSalesRevenuePerPeriod');
    acc('cashCollectedPerPeriod');
    acc('presalesCashPerPeriod');
    acc('postSalesCashPerPeriod');
    acc('recognitionPerPeriod');
    acc('presalesRecognitionPerPeriod');
    acc('postSalesRecognitionPerPeriod');
    acc('presalesSalesValuePerPeriod');
    // Per-sub-unit maps: merge by sub-unit id (sub-unit ids are unique
    // across the project so cross-asset collisions cannot happen).
    const mergeSU = (src: Record<string, number[]>, dst: Record<string, number[]>): void => {
      for (const [id, arr] of Object.entries(src)) {
        if (!dst[id]) dst[id] = new Array<number>(N).fill(0);
        for (let i = 0; i < N; i++) dst[id][i] += arr[i] ?? 0;
      }
    };
    mergeSU(result.presalesAreaPerPeriodPerSubUnit, projectTotals.presalesAreaPerPeriodPerSubUnit);
    mergeSU(result.presalesRevenuePerPeriodPerSubUnit, projectTotals.presalesRevenuePerPeriodPerSubUnit);
    mergeSU(result.postSalesAreaPerPeriodPerSubUnit, projectTotals.postSalesAreaPerPeriodPerSubUnit);
    mergeSU(result.postSalesRevenuePerPeriodPerSubUnit, projectTotals.postSalesRevenuePerPeriodPerSubUnit);
    // Vintage matrices accumulate by 2D sum
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      projectTotals.cashVintageMatrix[r][c] += result.cashVintageMatrix[r]?.[c] ?? 0;
      projectTotals.recognitionVintageMatrix[r][c] += result.recognitionVintageMatrix[r]?.[c] ?? 0;
    }
  }

  return { axisLength: N, projectStartYear, yearLabels, bySellAsset, projectTotals };
}

/**
 * Total capex for an asset by summing computeAssetCost(asset).total.
 * Returns 0 when the asset is a companion or its phase is missing.
 */
export type ResolverState = Pick<
  Module1Store,
  'project' | 'phases' | 'assets' | 'subUnits' | 'parcels' | 'costLines' | 'costOverrides' | 'landAllocationMode'
>;

export function computeAssetCapex(state: ResolverState, assetId: string): number {
  const asset: Asset | undefined = state.assets.find((a) => a.id === assetId);
  if (!asset) return 0;
  const phase: Phase | undefined = state.phases.find((p) => p.id === asset.phaseId);
  if (!phase) return 0;

  const bd = computeAssetCost(
    asset,
    state.project,
    phase,
    state.parcels,
    state.assets,
    state.subUnits,
    state.costLines,
    state.costOverrides,
    state.landAllocationMode,
    state.project.financing?.parcelFunding,
  );
  return Math.max(0, bd.total);
}

export interface AssetScheduleBundle {
  assetId: string;
  ar: AccountsReceivableResult;
  unearned: UnearnedRevenueResult;
  cos: CostOfSalesResult;
}

/**
 * Convenience: per-asset AR + Unearned + Cost of Sales bundle. Reads
 * the asset's SellAssetResult (recognition + cash) and its total capex,
 * then runs the three schedule builders.
 */
export function computeAssetScheduleBundle(
  state: ResolverState,
  result: SellAssetResult,
): AssetScheduleBundle {
  const N = result.axisLength;
  // Pass 7q: sale value drives both AR + UR (gross obligation).
  // AR unwinds via cash; Unearned unwinds via recognition.
  const ar = buildAccountsReceivable(
    result.presalesRevenuePerPeriod,
    result.presalesCashPerPeriod,
    N,
  );
  const unearned = buildUnearnedRevenue(
    result.presalesRecognitionPerPeriod,
    result.presalesRevenuePerPeriod,
    N,
  );
  const capex = computeAssetCapex(state, result.assetId);
  const cos = buildCostOfSales(result.recognitionPerPeriod, capex, N);
  return { assetId: result.assetId, ar, unearned, cos };
}
