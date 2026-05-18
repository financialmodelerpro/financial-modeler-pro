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
  computeHospitalityAsset,
  resolveHandoverYear,
  buildAccountsReceivable,
  buildUnearnedRevenue,
  buildCostOfSales,
  type AssetSellConfig,
  type CashPaymentProfile,
  type HospitalityAssetResult,
  type HospitalityConfig,
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

/**
 * Pass 8b (2026-05-18): build a HospitalityConfig for the engine.
 * Reads asset.revenue.operate + sums keys across sub-units where
 * metric='units'. Operations window comes from the asset's phase
 * (operationsStart..operationsEnd, inclusive). Returns null when the
 * asset has no operate config yet.
 */
export function resolveHospitalityConfig(
  asset: Asset,
  phase: Phase,
  subUnits: SubUnit[],
  projectStartYear: number,
  axisLength: number,
): HospitalityConfig | null {
  const cfg = asset.revenue?.operate;
  if (!cfg) return null;
  const assetSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  const keys = assetSubUnits
    .filter((u) => u.metric === 'units')
    .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const constructionStartIdx = Math.max(0, Math.min(axisLength - 1, phaseStartYear - projectStartYear));
  const handoverYear = Math.max(constructionStartIdx, Math.min(axisLength - 1, constructionStartIdx + cp - 1));
  const opsStartIdx = Math.max(constructionStartIdx, Math.min(axisLength - 1, handoverYear + 1 - overlap));
  const opsEndIdx = Math.max(opsStartIdx, Math.min(axisLength - 1, opsStartIdx + op - 1));

  return {
    assetId: asset.id,
    keys,
    daysPerYear: cfg.daysPerYear ?? 365,
    startingADR: cfg.startingADR,
    adrIndexation: cfg.adrIndexation ?? DEFAULT_INDEXATION,
    occupancyPerPeriod: cfg.occupancyPerPeriod ?? new Array<number>(axisLength).fill(0),
    guestsPerOccupiedRoom: cfg.guestsPerOccupiedRoom ?? 1.5,
    fb: {
      mode: cfg.fb.mode,
      percentOfRooms: cfg.fb.percentOfRooms,
      ratePerGuest: cfg.fb.ratePerGuest,
      fixedAmountPerPeriod: cfg.fb.fixedAmountPerPeriod,
      indexation: cfg.fb.indexation,
    },
    otherRevenue: {
      mode: cfg.otherRevenue.mode,
      percentOfRooms: cfg.otherRevenue.percentOfRooms,
      ratePerGuest: cfg.otherRevenue.ratePerGuest,
      fixedAmountPerPeriod: cfg.otherRevenue.fixedAmountPerPeriod,
      indexation: cfg.otherRevenue.indexation,
    },
    opsStartIdx,
    opsEndIdx,
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
  // Pass 8b (2026-05-18): Hospitality (Operate-strategy) per-asset
  // results. Sell + Manage companions live here too (they're the
  // operate side of a sell parent). Includes pure Operate parents.
  byHospitalityAsset: Map<string, HospitalityAssetResult>;
  hospitalityProjectTotals: HospitalityAssetResult;
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
    presalesUnitsPerPeriodPerSubUnit: {},
    postSalesAreaPerPeriodPerSubUnit: {},
    postSalesRevenuePerPeriodPerSubUnit: {},
    postSalesUnitsPerPeriodPerSubUnit: {},
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
    mergeSU(result.presalesUnitsPerPeriodPerSubUnit, projectTotals.presalesUnitsPerPeriodPerSubUnit);
    mergeSU(result.postSalesAreaPerPeriodPerSubUnit, projectTotals.postSalesAreaPerPeriodPerSubUnit);
    mergeSU(result.postSalesRevenuePerPeriodPerSubUnit, projectTotals.postSalesRevenuePerPeriodPerSubUnit);
    mergeSU(result.postSalesUnitsPerPeriodPerSubUnit, projectTotals.postSalesUnitsPerPeriodPerSubUnit);
    // Vintage matrices accumulate by 2D sum
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      projectTotals.cashVintageMatrix[r][c] += result.cashVintageMatrix[r]?.[c] ?? 0;
      projectTotals.recognitionVintageMatrix[r][c] += result.recognitionVintageMatrix[r]?.[c] ?? 0;
    }
  }

  // Pass 8b (2026-05-18): Hospitality compute loop. Operate-strategy
  // parents + every companion (companions are the operate side of a
  // Sell + Manage parent, regardless of their own strategy field).
  const byHospitalityAsset = new Map<string, HospitalityAssetResult>();
  const hospitalityProjectTotals: HospitalityAssetResult = {
    assetId: '__project__',
    axisLength: N,
    availableRoomNightsPerPeriod: emptyArr(),
    occupiedRoomNightsPerPeriod: emptyArr(),
    occupancyPerPeriod: emptyArr(),
    adrPerPeriod: emptyArr(),
    guestsPerPeriod: emptyArr(),
    roomsRevenuePerPeriod: emptyArr(),
    fbRevenuePerPeriod: emptyArr(),
    otherRevenuePerPeriod: emptyArr(),
    totalRevenuePerPeriod: emptyArr(),
  };

  for (const a of assets) {
    if (a.visible === false) continue;
    const isOperate = a.strategy === 'Operate' || a.isCompanion === true;
    if (!isOperate) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const cfg = resolveHospitalityConfig(a, phase, subUnits, projectStartYear, N);
    if (!cfg) continue;
    const result = computeHospitalityAsset({ config: cfg, axisLength: N });
    byHospitalityAsset.set(a.id, result);
    const accH = (key: keyof HospitalityAssetResult): void => {
      const src = result[key] as number[];
      const dst = hospitalityProjectTotals[key] as number[];
      for (let i = 0; i < N; i++) dst[i] += src[i] ?? 0;
    };
    accH('availableRoomNightsPerPeriod');
    accH('occupiedRoomNightsPerPeriod');
    accH('guestsPerPeriod');
    accH('roomsRevenuePerPeriod');
    accH('fbRevenuePerPeriod');
    accH('otherRevenuePerPeriod');
    accH('totalRevenuePerPeriod');
    // occupancyPerPeriod + adrPerPeriod don't sum meaningfully across
    // assets (they're rates, not flows), so leave the project totals
    // at 0 for those two fields. Consumers should not read project-
    // level occupancy / ADR.
  }

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    bySellAsset,
    projectTotals,
    byHospitalityAsset,
    hospitalityProjectTotals,
  };
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
