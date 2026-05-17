import type {
  AssetSellConfig,
  ReconcileIdentity,
  ReconcileReport,
  SellAssetResult,
} from './types';

const EPS_ABS = 1e-2;
const EPS_REL = 1e-6;

function near(a: number, b: number, epsAbs = EPS_ABS): boolean {
  const d = Math.abs(a - b);
  if (d <= epsAbs) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return d / scale <= EPS_REL;
}

function sumOf(arr: number[]): number {
  return arr.reduce((s, v) => s + (v ?? 0), 0);
}

/**
 * Reconciliation identities for a single Sell asset baseline.
 *
 * Pass 7d (2026-05-17): escrow identities removed (Wafi feature gone),
 * cross-cohort velocity identity simplified to single-cohort sum.
 */
export function reconcileSellAsset(
  result: SellAssetResult,
  config: AssetSellConfig,
): ReconcileReport {
  const identities: ReconcileIdentity[] = [];

  // 1. Sum of cash collected = sum of total sales value (pre + post)
  const totalSalesValue = sumOf(result.presalesRevenuePerPeriod) + sumOf(result.postSalesRevenuePerPeriod);
  const totalCash = sumOf(result.cashCollectedPerPeriod);
  identities.push({
    id: 'cash-equals-sales',
    ok: near(totalCash, totalSalesValue, 1),
    message: `cashTotal=${totalCash.toFixed(2)} vs salesTotal=${totalSalesValue.toFixed(2)}`,
  });

  // 2. Sum of recognition = sum of total sales value
  const totalRecognition = sumOf(result.recognitionPerPeriod);
  identities.push({
    id: 'recognition-equals-sales',
    ok: near(totalRecognition, totalSalesValue, 1),
    message: `recogTotal=${totalRecognition.toFixed(2)} vs salesTotal=${totalSalesValue.toFixed(2)}`,
  });

  // 3. Per sub-unit: sum of (pre + post velocity) <= 1.0
  const aggBySubUnit = new Map<string, { pre: number; post: number }>();
  for (const su of config.subUnits) {
    aggBySubUnit.set(su.subUnitId, {
      pre: (su.preSalesVelocity ?? []).reduce((s, v) => s + Math.max(0, v), 0),
      post: (su.postSalesVelocity ?? []).reduce((s, v) => s + Math.max(0, v), 0),
    });
  }
  let velOk = true;
  const violators: string[] = [];
  for (const [suId, { pre, post }] of aggBySubUnit) {
    if (pre + post > 1 + 1e-6) {
      velOk = false;
      violators.push(`${suId} (pre+post=${(pre + post).toFixed(3)})`);
    }
  }
  identities.push({
    id: 'velocity-sum-bound',
    ok: velOk,
    message: velOk ? 'every sub-unit pre+post velocity <= 1.0' : `velocity overflow: ${violators.join(', ')}`,
  });

  return {
    ok: identities.every((x) => x.ok),
    identities,
  };
}
