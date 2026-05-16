import { applyIndexation } from './indexation';
import { distributeCashCollection } from './payment';
import { buildRecognition } from './recognition';
import { buildEscrowMovement } from './escrow';
import type {
  AssetSellConfig,
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
 * / escrow stream. Pure: no store reads, no IO. The caller is
 * responsible for translating M1 store rows into SubUnitMaterial and
 * for resolving the handover year from the asset's phase
 * (constructionStart + constructionPeriods - 1, or
 * config.handoverYearOverride when set).
 *
 * Sub-unit value is derived from the sub-unit's effective rate per
 * area (which the M1 SubUnit can carry as ratePerArea or unitPrice /
 * area). The engine intentionally trusts the caller to pre-resolve
 * ratePerArea so the revenue layer never needs to reach into M1's
 * area/count math (matches the M1 resolver-helper convention).
 *
 * Pre-sales: per sub-unit per year, area sold = total area * velocity.
 * Sales value = area sold * indexed rate. Sums across sub-units form
 * the asset-level cohort. The cohort feeds cash + recognition.
 *
 * Post-sales: applies postSalesVelocity to the residual area left
 * over after the full pre-sales window, indexed at the post-sale
 * year. Post-sales recognition + cash are point-in-time (same year)
 * for the baseline.
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

  const subUnitConfigById = new Map(config.subUnits.map((s) => [s.subUnitId, s]));

  for (const su of subUnits) {
    const cfg = subUnitConfigById.get(su.id);
    if (!cfg) continue;
    const totalArea = Math.max(0, su.area);
    const totalUnits = Math.max(0, su.count);
    const areaPerUnit = totalUnits > 0 ? totalArea / totalUnits : 0;
    const baseRate = Math.max(0, su.ratePerArea);

    let preCumulativeShare = 0;
    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.preSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      const cappedV = Math.min(v, Math.max(0, 1 - preCumulativeShare));
      preCumulativeShare += cappedV;
      const areaSold = totalArea * cappedV;
      const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = areaSold * indexedRate;
      presalesArea[yr] += areaSold;
      presalesUnits[yr] += unitsSold;
      presalesRevenue[yr] += value;
    }

    const residualShare = Math.max(0, 1 - preCumulativeShare);
    let postCumulativeShare = 0;
    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.postSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      const cappedV = Math.min(v, Math.max(0, residualShare - postCumulativeShare));
      if (cappedV === 0) continue;
      postCumulativeShare += cappedV;
      const areaSold = totalArea * cappedV;
      const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = areaSold * indexedRate;
      postSalesArea[yr] += areaSold;
      postSalesUnits[yr] += unitsSold;
      postSalesRevenue[yr] += value;
    }
  }

  const cashCollectedPresales = distributeCashCollection(
    presalesRevenue,
    config.cashPaymentProfile,
    N,
  );
  // Post-sales: cash and recognition coincide at the sale year.
  const cashCollected = cashCollectedPresales.map(
    (v, i) => v + (postSalesRevenue[i] ?? 0),
  );

  const recognitionPresales = buildRecognition(
    presalesRevenue,
    config.recognitionProfile,
    handoverYear,
    N,
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
