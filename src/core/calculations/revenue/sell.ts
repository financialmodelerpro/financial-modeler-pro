import { applyIndexation } from './indexation';
import { distributeCashCollection } from './payment';
import { buildRecognition } from './recognition';
import { buildEscrowMovement } from './escrow';
import type {
  AssetSellConfig,
  Cohort,
  SellAssetResult,
  SellSubUnitConfig,
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
 * / escrow stream. Pure: no store reads, no IO. The caller is
 * responsible for translating M1 store rows into SubUnitMaterial and
 * for resolving the handover year from the asset's phase
 * (constructionStart + constructionPeriods - 1, or
 * config.handoverYearOverride when set).
 *
 * Cohorts (Pass 4): when config.cohorts is non-empty, each cohort runs
 * its own cash + recognition pipeline using its own per-sub-unit
 * velocity, optional price overrides, and optional profile overrides.
 * Asset-level escrow + indexation are shared. When config.cohorts is
 * absent or empty, the top-level config.subUnits + profiles act as a
 * single implicit cohort (Pass 3 path).
 *
 * Velocity cap is global across cohorts per sub-unit so that the
 * platform-wide invariant "no sub-unit oversells" holds even when
 * volume is split across many cohort launches.
 */
export function computeSellAsset(inputs: ComputeSellInputs): SellAssetResult {
  const { config, subUnits, axisLength, handoverYear } = inputs;
  const N = Math.max(0, axisLength);

  const cohorts: Cohort[] = config.cohorts && config.cohorts.length > 0
    ? config.cohorts
    : [{
        id: '__implicit__',
        name: 'Default',
        subUnits: config.subUnits,
      }];

  const presalesUnits = new Array<number>(N).fill(0);
  const presalesArea = new Array<number>(N).fill(0);
  const presalesRevenue = new Array<number>(N).fill(0);
  const postSalesUnits = new Array<number>(N).fill(0);
  const postSalesArea = new Array<number>(N).fill(0);
  const postSalesRevenue = new Array<number>(N).fill(0);
  const cashCollectedPresales = new Array<number>(N).fill(0);
  const recognitionPresales = new Array<number>(N).fill(0);

  const cumulativeShareBySubUnit = new Map<string, number>();

  for (const cohort of cohorts) {
    const cohortCashProfile = cohort.cashPaymentProfile ?? config.cashPaymentProfile;
    const cohortRecProfile = cohort.recognitionProfile ?? config.recognitionProfile;
    const cohortPresalesRevenue = new Array<number>(N).fill(0);

    const subUnitConfigById = new Map<string, SellSubUnitConfig>(
      cohort.subUnits.map((s) => [s.subUnitId, s]),
    );

    for (const su of subUnits) {
      const cfg = subUnitConfigById.get(su.id);
      if (!cfg) continue;
      const totalArea = Math.max(0, su.area);
      const totalUnits = Math.max(0, su.count);
      const areaPerUnit = totalUnits > 0 ? totalArea / totalUnits : 0;
      const overridePrice = cohort.pricePerSubUnit?.[su.id];
      const baseRate = Math.max(0, overridePrice ?? su.ratePerArea);

      let cumShare = cumulativeShareBySubUnit.get(su.id) ?? 0;

      for (let yr = 0; yr < N; yr++) {
        const v = Math.max(0, cfg.preSalesVelocity[yr] ?? 0);
        if (v === 0) continue;
        const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
        cumShare += cappedV;
        const areaSold = totalArea * cappedV;
        const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
        const indexedRate = applyIndexation(baseRate, yr, config.indexation);
        const value = areaSold * indexedRate;
        presalesArea[yr] += areaSold;
        presalesUnits[yr] += unitsSold;
        presalesRevenue[yr] += value;
        cohortPresalesRevenue[yr] += value;
      }

      for (let yr = 0; yr < N; yr++) {
        const v = Math.max(0, cfg.postSalesVelocity[yr] ?? 0);
        if (v === 0) continue;
        const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
        if (cappedV === 0) continue;
        cumShare += cappedV;
        const areaSold = totalArea * cappedV;
        const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
        const indexedRate = applyIndexation(baseRate, yr, config.indexation);
        const value = areaSold * indexedRate;
        postSalesArea[yr] += areaSold;
        postSalesUnits[yr] += unitsSold;
        postSalesRevenue[yr] += value;
      }

      cumulativeShareBySubUnit.set(su.id, cumShare);
    }

    const cohortCash = distributeCashCollection(cohortPresalesRevenue, cohortCashProfile, N);
    const cohortRec = buildRecognition(cohortPresalesRevenue, cohortRecProfile, handoverYear, N);
    for (let i = 0; i < N; i++) {
      cashCollectedPresales[i] += cohortCash[i];
      recognitionPresales[i] += cohortRec[i];
    }
  }

  const cashCollected = cashCollectedPresales.map(
    (v, i) => v + (postSalesRevenue[i] ?? 0),
  );
  const recognition = recognitionPresales.map(
    (v, i) => v + (postSalesRevenue[i] ?? 0),
  );

  const escrow = buildEscrowMovement(cashCollectedPresales, config.escrow, N);
  const netCash = cashCollected.map((v, i) => v + (escrow.netAdjustment[i] ?? 0));

  return {
    assetId: config.assetId,
    axisLength: N,
    presalesUnitsPerPeriod: presalesUnits,
    presalesAreaPerPeriod: presalesArea,
    presalesRevenuePerPeriod: presalesRevenue,
    postSalesUnitsPerPeriod: postSalesUnits,
    postSalesAreaPerPeriod: postSalesArea,
    postSalesRevenuePerPeriod: postSalesRevenue,
    cashCollectedPerPeriod: cashCollected,
    recognitionPerPeriod: recognition,
    escrowHeldPerPeriod: escrow.held,
    escrowReleasedPerPeriod: escrow.released,
    escrowBalancePerPeriod: escrow.balance,
    netCashAvailablePerPeriod: netCash,
  };
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
