import type {
  Parcel,
  ParcelFundingConfig,
  Phase,
  Project,
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
  phases?: Phase[],
  project?: Project,
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

  // M4 Pass 2Z (2026-05-24): stamp in-kind per parcel at the OWNING
  // phase's projected i=0 axis index — mirrors the asset-side
  // projection rule in aggregateProjectCapex / fixed-assets-resolvers
  // (projIdx = Math.max(0, offset - 1) post Pass 2W). Previously the
  // sum lumped at axis[0] regardless of phase, leaving Phase 3+
  // (offset >= 2) with Y0 equity but no matching Land asset — peak
  // contributor to the user's 1.4M BS construction-year imbalance.
  const projStart = project?.startDate
    ? new Date(project.startDate).getUTCFullYear()
    : Number.NaN;
  let inKindLump = 0; // running total (for total-of-totals identity)
  const inKindByPeriod = new Array<number>(N).fill(0);
  for (const p of parcels) {
    const inKindValue = p.area * p.rate * (Math.max(0, Math.min(100, 100 - (p.cashPct ?? 0))) / 100);
    if (inKindValue <= 0) continue;
    inKindLump += inKindValue;
    let projIdx = 0;
    if (phases && Number.isFinite(projStart)) {
      const phase = phases.find((ph) => ph.id === p.phaseId);
      const psy = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projStart;
      const offset = Math.max(0, psy - projStart);
      projIdx = Math.max(0, offset - 1);
    }
    if (projIdx >= 0 && projIdx < N) inKindByPeriod[projIdx] += inKindValue;
  }

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
  void inKindLump; // running total kept above for clarity / future use

  return { debt, equity, inKind, landDebt, landEquity, nonLandDebt, nonLandEquity };
}
