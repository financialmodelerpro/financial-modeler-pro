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
 *   Land in-kind:   never split; lump at axis col 0.
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

  let inKindLump = 0;
  for (const p of parcels) {
    const inKindValue = p.area * p.rate * (Math.max(0, Math.min(100, 100 - (p.cashPct ?? 0))) / 100);
    inKindLump += inKindValue;
  }

  for (let i = 0; i < N; i++) {
    nonLandDebt[i]   = capex.perPeriod.nonLand[i] * debtFrac;
    nonLandEquity[i] = capex.perPeriod.nonLand[i] * equityFrac;
    landDebt[i]      = capex.perPeriod.landCash[i] * landDebtFrac;
    landEquity[i]    = capex.perPeriod.landCash[i] * landEquityFrac;
    debt[i]   = nonLandDebt[i] + landDebt[i];
    equity[i] = nonLandEquity[i] + landEquity[i];
  }
  if (N > 0) inKind[0] = inKindLump;

  return { debt, equity, inKind, landDebt, landEquity, nonLandDebt, nonLandEquity };
}
