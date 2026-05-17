import { applyIndexation } from './indexation';
import { distributeCashCollection } from './payment';
import { buildRecognition } from './recognition';
import { buildCohortMatrix } from './cohort';
import type {
  AssetSellConfig,
  RecognitionProfile,
  SellAssetResult,
  SubUnitMaterial,
} from './types';

export interface ComputeSellInputs {
  config: AssetSellConfig;
  subUnits: SubUnitMaterial[];
  axisLength: number;
  handoverYear: number;
}

/**
 * Computes the full per-period Sell-asset revenue / cash / recognition
 * stream. Pure: no store reads, no IO. The caller is responsible for
 * translating M1 store rows into SubUnitMaterial and for resolving the
 * handover year from the asset's phase (constructionStart +
 * constructionPeriods - 1, or config.handoverYearOverride when set).
 *
 * Pass 7d (2026-05-17): single implicit cohort. Multi-cohort + Wafi
 * escrow removed. Cohort engine helper (buildCohortMatrix) is still
 * used to produce the vintage matrices.
 */
export function computeSellAsset(inputs: ComputeSellInputs): SellAssetResult {
  const { config, subUnits, axisLength, handoverYear } = inputs;
  const N = Math.max(0, axisLength);

  const presalesUnits = new Array<number>(N).fill(0);
  const presalesArea = new Array<number>(N).fill(0);
  const presalesRevenue = new Array<number>(N).fill(0);
  const postSalesUnits = new Array<number>(N).fill(0);
  const postSalesArea = new Array<number>(N).fill(0);
  const postSalesRevenue = new Array<number>(N).fill(0);

  const presalesAreaPerSU: Record<string, number[]> = {};
  const presalesRevenuePerSU: Record<string, number[]> = {};
  const postSalesAreaPerSU: Record<string, number[]> = {};
  const postSalesRevenuePerSU: Record<string, number[]> = {};

  const cumulativeShareBySubUnit = new Map<string, number>();
  const subUnitConfigById = new Map(config.subUnits.map((s) => [s.subUnitId, s]));

  for (const su of subUnits) {
    const cfg = subUnitConfigById.get(su.id);
    if (!cfg) continue;
    const totalArea = Math.max(0, su.area);
    const totalUnits = Math.max(0, su.count);
    const areaPerUnit = totalUnits > 0 ? totalArea / totalUnits : 0;
    const baseRate = Math.max(0, su.ratePerArea);

    const preAreaSU = presalesAreaPerSU[su.id] ?? new Array<number>(N).fill(0);
    const preRevSU = presalesRevenuePerSU[su.id] ?? new Array<number>(N).fill(0);
    const postAreaSU = postSalesAreaPerSU[su.id] ?? new Array<number>(N).fill(0);
    const postRevSU = postSalesRevenuePerSU[su.id] ?? new Array<number>(N).fill(0);

    let cumShare = cumulativeShareBySubUnit.get(su.id) ?? 0;

    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.preSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
      cumShare += cappedV;
      const areaSold = totalArea * cappedV;
      // Pass 7e (2026-05-17): residential units are integer entities.
      // Round per-period unit count so the UI shows whole units only
      // (3 not 2.71). Area + revenue stay fractional (computed off
      // cappedV * totalArea so they reflect the actual share sold).
      const unitsSold = areaPerUnit > 0 ? Math.round(areaSold / areaPerUnit) : 0;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = areaSold * indexedRate;
      presalesArea[yr] += areaSold;
      presalesUnits[yr] += unitsSold;
      presalesRevenue[yr] += value;
      preAreaSU[yr] += areaSold;
      preRevSU[yr] += value;
    }

    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.postSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
      if (cappedV === 0) continue;
      cumShare += cappedV;
      const areaSold = totalArea * cappedV;
      const unitsSold = areaPerUnit > 0 ? Math.round(areaSold / areaPerUnit) : 0;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = areaSold * indexedRate;
      postSalesArea[yr] += areaSold;
      postSalesUnits[yr] += unitsSold;
      postSalesRevenue[yr] += value;
      postAreaSU[yr] += areaSold;
      postRevSU[yr] += value;
    }

    presalesAreaPerSU[su.id] = preAreaSU;
    presalesRevenuePerSU[su.id] = preRevSU;
    postSalesAreaPerSU[su.id] = postAreaSU;
    postSalesRevenuePerSU[su.id] = postRevSU;
    cumulativeShareBySubUnit.set(su.id, cumShare);
  }

  const cashCollectedPresales = distributeCashCollection(presalesRevenue, config.cashPaymentProfile, N);
  const recognitionPresales = buildRecognition(presalesRevenue, config.recognitionProfile, handoverYear, N);

  // Pass 7f (2026-05-17): post-sales convention. Post-handover sales
  // collect and recognize in the same period (operating sales, no
  // milestone schedule). Pre + post components sum to the aggregate.
  const postSalesCash = postSalesRevenue.slice();
  const postSalesRecognition = postSalesRevenue.slice();
  const cashCollected = cashCollectedPresales.map((v, i) => v + (postSalesCash[i] ?? 0));
  const recognition = recognitionPresales.map((v, i) => v + (postSalesRecognition[i] ?? 0));

  const cashVintageMatrix = buildCohortMatrix(presalesRevenue, config.cashPaymentProfile, N);
  const recognitionVintageMatrix = buildRecognitionMatrix(presalesRevenue, config.recognitionProfile, handoverYear, N);

  return {
    assetId: config.assetId,
    axisLength: N,
    presalesUnitsPerPeriod: presalesUnits,
    presalesAreaPerPeriod: presalesArea,
    presalesRevenuePerPeriod: presalesRevenue,
    postSalesUnitsPerPeriod: postSalesUnits,
    postSalesAreaPerPeriod: postSalesArea,
    postSalesRevenuePerPeriod: postSalesRevenue,
    presalesAreaPerPeriodPerSubUnit: presalesAreaPerSU,
    presalesRevenuePerPeriodPerSubUnit: presalesRevenuePerSU,
    postSalesAreaPerPeriodPerSubUnit: postSalesAreaPerSU,
    postSalesRevenuePerPeriodPerSubUnit: postSalesRevenuePerSU,
    cashCollectedPerPeriod: cashCollected,
    presalesCashPerPeriod: cashCollectedPresales,
    postSalesCashPerPeriod: postSalesCash,
    recognitionPerPeriod: recognition,
    presalesRecognitionPerPeriod: recognitionPresales,
    postSalesRecognitionPerPeriod: postSalesRecognition,
    presalesSalesValuePerPeriod: presalesRevenue.slice(),
    cashVintageMatrix,
    recognitionVintageMatrix,
  };
}

/**
 * Recognition vintage matrix builder. PIT lumps cohort on a single
 * column (handover or sale year). Over-Time uses the shared cohort
 * engine with the recognition profile.
 */
function buildRecognitionMatrix(
  salesValuePerYear: number[],
  profile: RecognitionProfile,
  handoverYear: number,
  axisLength: number,
): number[][] {
  const N = Math.max(0, axisLength);
  const out: number[][] = [];
  for (let i = 0; i < N; i++) out.push(new Array<number>(N).fill(0));

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    for (let saleYear = 0; saleYear < N; saleYear++) {
      const v = Math.max(0, salesValuePerYear[saleYear] ?? 0);
      if (v === 0) continue;
      const target = anchor === 'handover'
        ? Math.max(0, Math.min(N - 1, handoverYear))
        : saleYear;
      out[saleYear][target] += v;
    }
    return out;
  }

  return buildCohortMatrix(
    salesValuePerYear,
    { percentages: profile.percentages ?? [], positions: profile.positions, profileMode: profile.profileMode },
    N,
  );
}

export function resolveHandoverYear(
  axisLength: number,
  phaseStartYear: number,
  phaseConstructionPeriods: number,
  projectStartYear: number,
  override?: number,
): number {
  if (override != null && Number.isFinite(override)) return Math.max(0, Math.min(axisLength - 1, override));
  const handoverAbsYear = phaseStartYear + Math.max(0, phaseConstructionPeriods - 1);
  return Math.max(0, Math.min(axisLength - 1, handoverAbsYear - projectStartYear));
}
