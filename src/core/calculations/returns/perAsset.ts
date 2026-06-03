/**
 * M5 Returns engine, Pass 2: per-asset economics.
 *
 * Project-level financing is not cleanly isolable per asset, so this reports
 * the unlevered drivers that ARE per-asset: Revenue, Cost (capex), Profit,
 * Profit Margin, and Yield on Cost (income assets only). No per-asset IRR is
 * attempted (financing + cash timing are project-level). Pure: the resolver
 * passes the per-asset P&L revenue / opex + per-asset capex it already has.
 */
import { safeRatio } from './metrics';

export interface AssetReturnInput {
  assetId: string;
  assetName: string;
  phaseId: string;
  phaseName: string;
  strategy: string;
  revenuePerPeriod: number[];
  opexPerPeriod: number[];
  /** Per-asset capex (negative = cash outflow). */
  capexPerPeriod: number[];
}

export interface AssetReturnRow {
  assetId: string;
  assetName: string;
  phaseId: string;
  phaseName: string;
  strategy: string;
  totalRevenue: number;
  totalCost: number;
  profit: number;
  profitMargin: number | null;
  /** Income assets (Operate / Lease) only; null otherwise. */
  yieldOnCost: number | null;
  isIncomeAsset: boolean;
}

export interface PerAssetSnapshot {
  rows: AssetReturnRow[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

export function computePerAssetReturns(assets: AssetReturnInput[]): PerAssetSnapshot {
  const rows: AssetReturnRow[] = assets.map((a) => {
    const totalRevenue = sum(a.revenuePerPeriod);
    const totalCost = Math.max(0, -sum(a.capexPerPeriod)); // capex is a negative outflow
    const profit = totalRevenue - totalCost;
    const isIncomeAsset = a.strategy === 'Operate' || a.strategy === 'Lease';
    // Stabilised NOI per asset = peak (revenue − opex), floored at 0.
    let stabilisedNOI = 0;
    if (isIncomeAsset) {
      for (let t = 0; t < a.revenuePerPeriod.length; t++) {
        const noi = (a.revenuePerPeriod[t] ?? 0) - (a.opexPerPeriod[t] ?? 0);
        if (noi > stabilisedNOI) stabilisedNOI = noi;
      }
    }
    return {
      assetId: a.assetId,
      assetName: a.assetName,
      phaseId: a.phaseId,
      phaseName: a.phaseName,
      strategy: a.strategy,
      totalRevenue,
      totalCost,
      profit,
      profitMargin: safeRatio(profit, totalRevenue),
      yieldOnCost: isIncomeAsset ? safeRatio(stabilisedNOI, totalCost) : null,
      isIncomeAsset,
    };
  });
  return {
    rows,
    totalRevenue: rows.reduce((s, r) => s + r.totalRevenue, 0),
    totalCost: rows.reduce((s, r) => s + r.totalCost, 0),
    totalProfit: rows.reduce((s, r) => s + r.profit, 0),
  };
}
