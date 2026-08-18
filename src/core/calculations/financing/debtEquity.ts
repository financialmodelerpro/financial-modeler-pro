import type {
  Parcel,
  ParcelFundingConfig,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type {
  CapexAggregate,
  DebtEquitySplit,
  FundingRequirement,
  ProjectAxis,
} from './types';

interface ParcelDeb {
  debt: number;
  equity: number;
}

function parcelDebtEquity(cfg: ParcelFundingConfig | undefined): ParcelDeb {
  if (!cfg) return { debt: 0, equity: 100 };
  if (typeof cfg.debtPct === 'number' || typeof cfg.equityPct === 'number') {
    const d = Math.max(0, cfg.debtPct ?? 0);
    const e = Math.max(0, cfg.equityPct ?? 100 - d);
    const s = d + e;
    return s > 0 ? { debt: (d / s) * 100, equity: (e / s) * 100 } : { debt: 0, equity: 100 };
  }
  switch (cfg.fundingType) {
    case '100pct_debt':   return { debt: 100, equity: 0 };
    case '100pct_equity': return { debt: 0,   equity: 100 };
    case 'in_kind':       return { debt: 0,   equity: 100 };
    case 'custom_split': {
      const d = Math.max(0, cfg.customDebtPct ?? 0);
      const e = Math.max(0, cfg.customEquityPct ?? 100 - d);
      const s = d + e;
      return s > 0 ? { debt: (d / s) * 100, equity: (e / s) * 100 } : { debt: 0, equity: 100 };
    }
    case 'deferred_payment':
    default:
      return { debt: 0, equity: 100 };
  }
}

/**
 * Two-rule debt/equity split.
 *
 *   Non-land capex: project-wide ratio from FundingRequirement.
 *   Land cash:      per-parcel ratio (debtPct / equityPct on the
 *                   ParcelFundingConfig).
 *   Land in-kind:   never split; recognised period by period on
 *                   `capex.perPeriod.landInKind`, i.e. when the land is
 *                   capitalised, so the equity credit and the asset it
 *                   creates land in the same column of the Balance Sheet.
 *
 * Aggregates parcel-level cash-land ratios into a project-period
 * blended ratio: weight each parcel's debt% by that parcel's share
 * of total land-cash capex (split evenly across periods when the
 * per-parcel curve isn't separately tracked).
 *
 * Returns project-period arrays of length axis.totalPeriods + 1.
 */
export function computeDebtEquitySplit(
  capex: CapexAggregate,
  funding: FundingRequirement,
  parcels: Parcel[],
  parcelFunding: ParcelFundingConfig[],
  axis: ProjectAxis,
): DebtEquitySplit {
  const N = axis.totalPeriods;
  const debt        = new Array<number>(N).fill(0);
  const equity      = new Array<number>(N).fill(0);
  const inKind      = new Array<number>(N).fill(0);
  const landDebt    = new Array<number>(N).fill(0);
  const landEquity  = new Array<number>(N).fill(0);
  const nonLandDebt   = new Array<number>(N).fill(0);
  const nonLandEquity = new Array<number>(N).fill(0);

  const debtFrac   = funding.debtPct   / 100;
  const equityFrac = funding.equityPct / 100;

  let totalCashLand = 0;
  let totalDebtWeighted = 0;
  for (const p of parcels) {
    const cashValue = p.area * p.rate * (Math.max(0, Math.min(100, p.cashPct ?? 0)) / 100);
    if (cashValue <= 0) continue;
    const cfg = parcelFunding.find((pf) => pf.parcelId === p.id);
    const r = parcelDebtEquity(cfg);
    totalCashLand += cashValue;
    totalDebtWeighted += cashValue * (r.debt / 100);
  }
  const landDebtFrac = totalCashLand > 0 ? totalDebtWeighted / totalCashLand : 0;
  const landEquityFrac = 1 - landDebtFrac;

  // In-kind equity is recognised in the period the in-kind land is
  // CAPITALISED, and that is a single series the capex engine already
  // produces: `capex.perPeriod.landInKind`.
  //
  // 2026-08-18. This used to be a SECOND definition of the same rule: a walk
  // over the parcels, valuing each one itself and stamping it at its OWNING
  // phase's i=0 index. That was written when a parcel belonged to its phase.
  // Since 2026-08-17 A PARCEL IS PROJECT-WIDE, so an asset in a later phase
  // may draw on an earlier phase's land, and when it does the capex engine
  // capitalises that slice in the CONSUMING asset's window while this walk
  // credited the equity in the OWNING parcel's window. The Balance Sheet was
  // then out by the slice, for every period between the two.
  //
  // Measured on the live project (one Phase 1 parcel, 50% in kind, two Phase 2
  // assets drawing on it): equity recognised the whole 60,000,000 at t=0 while
  // the land arrived 35,000,000 at t=0 and 25,000,000 at t=1, and the Balance
  // Sheet was out by exactly -25,000,000 in the construction year and balanced
  // from t=1 on. Reading the capex series makes the two sides ONE number, so
  // the identity holds by construction rather than by two rules agreeing.
  //
  // No fallback to the parcel valuation when the capex series is empty: land
  // that no asset capitalises is not on the Balance Sheet, so crediting equity
  // for it is precisely the imbalance this removes.
  const inKindByPeriod = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) inKindByPeriod[i] = capex.perPeriod.landInKind[i] ?? 0;

  // Pass 30 (2026-05-14): when Method 4 (Specified Debt + Equity) is
  // selected, the user-supplied per-period arrays drive the split.
  // We skip the capex-derived path and let the custom curve own both
  // non-land + land treatment - the user is taking responsibility for
  // sizing total debt + equity directly.
  const useCustom = !!funding.customDebtByPeriod && !!funding.customEquityByPeriod;
  if (useCustom) {
    const cd = funding.customDebtByPeriod ?? [];
    const ce = funding.customEquityByPeriod ?? [];
    for (let i = 0; i < N; i++) {
      const minCashAt = funding.minCashByPeriod[i] ?? 0;
      // Min cash buffer still splits at the project ratio on top of
      // the user-specified curve.
      nonLandDebt[i]   = (cd[i] ?? 0) + minCashAt * debtFrac;
      nonLandEquity[i] = (ce[i] ?? 0) + minCashAt * equityFrac;
      landDebt[i]      = 0;
      landEquity[i]    = 0;
      debt[i]   = nonLandDebt[i];
      equity[i] = nonLandEquity[i];
    }
    for (let i = 0; i < N; i++) inKind[i] = inKindByPeriod[i] ?? 0;
    return { debt, equity, inKind, landDebt, landEquity, nonLandDebt, nonLandEquity };
  }

  for (let i = 0; i < N; i++) {
    // Pass 26 (2026-05-14): Min Cash Reserve lump (per-period, axis-
    // indexed) is treated as additional non-land funding, split at
    // the project ratio so the bank's drawdown sizing covers it.
    const minCashAt = funding.minCashByPeriod[i] ?? 0;
    const nonLandFundingAt = (capex.perPeriod.nonLand[i] ?? 0) + minCashAt;
    nonLandDebt[i]   = nonLandFundingAt * debtFrac;
    nonLandEquity[i] = nonLandFundingAt * equityFrac;
    landDebt[i]      = capex.perPeriod.landCash[i] * landDebtFrac;
    landEquity[i]    = capex.perPeriod.landCash[i] * landEquityFrac;
    debt[i]   = nonLandDebt[i] + landDebt[i];
    equity[i] = nonLandEquity[i] + landEquity[i];
  }
  for (let i = 0; i < N; i++) inKind[i] = inKindByPeriod[i] ?? 0;

  return { debt, equity, inKind, landDebt, landEquity, nonLandDebt, nonLandEquity };
}
