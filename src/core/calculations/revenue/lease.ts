/**
 * M2 Pass 9g (2026-05-18): Retail / Office Lease revenue engine.
 *
 * Pure function. No store coupling. Caller resolves per-sub-unit GLA +
 * base rate + indexation + occupancy ramp + ops window from M1 sub-units
 * + asset.revenue.lease and hands them to computeLeaseAsset.
 *
 * Math per project-axis period y (inside [opsStart, opsEnd]):
 *   For each sub-unit i:
 *     factor_i[y]   = applyIndexation(1, y, rentIndexation_i)
 *     indexed_i[y]  = baseRate_i × factor_i[y]
 *     occupied_i[y] = gla_i × clamp(occupancy[y], 0..1)
 *     revenue_i[y]  = occupied_i[y] × indexed_i[y]
 *
 *   Asset-level aggregates:
 *     occupied[y]       = sum(occupied_i[y])
 *     revenue[y]        = sum(revenue_i[y])
 *     indexedRate[y]    = sum(gla_i × indexed_i[y]) / sum(gla_i)   (GLA-weighted avg)
 *     rentFactor[y]     = sum(gla_i × factor_i[y]) / sum(gla_i)
 *
 * Outside [opsStartIdx, opsEndIdx] every output is 0.
 *
 * Convention: under operating-sales (matching Sell's SDO + Hospitality
 * since Pass 7r / 8a), revenue = recognition = same period. Cash =
 * revenue collected on `arDays` delay via the existing DSO engine,
 * wired on the Schedules tab (not in this engine).
 */

import { applyIndexation } from './indexation';
import type { LeaseAssetResult, LeaseConfig } from './types';

export interface ComputeLeaseInputs {
  config: LeaseConfig;
  axisLength: number;
}

export function computeLeaseAsset(inputs: ComputeLeaseInputs): LeaseAssetResult {
  const { config, axisLength } = inputs;
  const N = Math.max(0, axisLength);

  const occupiedArea = new Array<number>(N).fill(0);
  const occ = new Array<number>(N).fill(0);
  const indexedRate = new Array<number>(N).fill(0);
  const rentFactor = new Array<number>(N).fill(0);
  const revenue = new Array<number>(N).fill(0);

  const startIdx = Math.max(0, Math.min(N - 1, config.opsStartIdx));
  const endIdx = Math.max(startIdx, Math.min(N - 1, config.opsEndIdx));

  // Empty subUnits collapses to a single virtual sub-unit using the
  // asset-level gla + baseRate (legacy single-zone fallback). Mirrors
  // the hospitality engine's empty-subUnits handling.
  const subUnits = config.subUnits.length > 0
    ? config.subUnits
    : [{
        id: '__asset__',
        gla: Math.max(0, config.gla),
        baseRate: Math.max(0, config.baseRate),
        rentIndexation: config.rentIndexation,
      }];

  const perSubUnit: LeaseAssetResult['perSubUnit'] = {};
  for (const su of subUnits) {
    perSubUnit[su.id] = {
      gla: Math.max(0, su.gla),
      occupiedAreaPerPeriod: new Array<number>(N).fill(0),
      indexedRatePerPeriod: new Array<number>(N).fill(0),
      rentIndexationFactorPerPeriod: new Array<number>(N).fill(0),
      revenuePerPeriod: new Array<number>(N).fill(0),
    };
  }

  const totalGla = subUnits.reduce((s, u) => s + Math.max(0, u.gla), 0);

  for (let y = startIdx; y <= endIdx; y++) {
    const rawOcc = config.occupancyPerPeriod[y] ?? 0;
    const occClamped = Math.max(0, Math.min(1, rawOcc));

    let totalOccupiedY = 0;
    let totalRevenueY = 0;
    let weightedRateSum = 0;    // sum(gla_i × indexedRate_i)
    let weightedFactorSum = 0;  // sum(gla_i × factor_i)

    for (const su of subUnits) {
      const suGla = Math.max(0, su.gla);
      const suOccupied = suGla * occClamped;
      const idx = su.rentIndexation ?? config.rentIndexation;
      const suFactor = applyIndexation(1, y, idx);
      const suRate = Math.max(0, su.baseRate) * suFactor;
      const suRevenue = suOccupied * suRate;

      totalOccupiedY += suOccupied;
      totalRevenueY += suRevenue;
      weightedRateSum += suGla * suRate;
      weightedFactorSum += suGla * suFactor;

      const sub = perSubUnit[su.id];
      sub.occupiedAreaPerPeriod[y] = suOccupied;
      sub.indexedRatePerPeriod[y] = suRate;
      sub.rentIndexationFactorPerPeriod[y] = suFactor;
      sub.revenuePerPeriod[y] = suRevenue;
    }

    occupiedArea[y] = totalOccupiedY;
    occ[y] = occClamped;
    // GLA-weighted average rate + factor. When totalGla=0 (degenerate
    // empty asset) both default to 0 — no revenue anyway.
    indexedRate[y] = totalGla > 0 ? weightedRateSum / totalGla : 0;
    rentFactor[y] = totalGla > 0 ? weightedFactorSum / totalGla : 0;
    revenue[y] = totalRevenueY;
  }

  return {
    assetId: config.assetId,
    axisLength: N,
    occupiedAreaPerPeriod: occupiedArea,
    occupancyPerPeriod: occ,
    indexedRatePerPeriod: indexedRate,
    rentIndexationFactorPerPeriod: rentFactor,
    totalRevenuePerPeriod: revenue,
    perSubUnit,
  };
}
