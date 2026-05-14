import type {
  CapexAggregate,
  DebtEquitySplit,
  EquityMovement,
  ExistingAggregate,
  FacilityResult,
  FundingRequirement,
  ProjectAxis,
  Reconciliation,
} from './types';
import type { FinancingTranche } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

const EPS_ABS = 1e-2;
const EPS_REL = 1e-6;

function near(a: number, b: number, epsAbs = EPS_ABS): boolean {
  const d = Math.abs(a - b);
  if (d <= epsAbs) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return d / scale <= EPS_REL;
}

export function reconcile(
  axis: ProjectAxis,
  capex: CapexAggregate,
  funding: FundingRequirement,
  split: DebtEquitySplit,
  shares: Map<string, number>,
  facilities: Map<string, FacilityResult>,
  tranches: FinancingTranche[],
  equity: EquityMovement,
  existing: ExistingAggregate,
): Reconciliation {
  const issues: string[] = [];

  const sumExcl = capex.perPeriod.exclAllLand.reduce((s, v) => s + v, 0);
  const sumExclIK = capex.perPeriod.exclLandInKind.reduce((s, v) => s + v, 0);
  const sumIncl = capex.perPeriod.inclAllLand.reduce((s, v) => s + v, 0);
  if (!near(sumExcl, capex.totals.exclAllLand))
    issues.push(`Capex perPeriod.exclAllLand sum ${sumExcl} vs total ${capex.totals.exclAllLand}`);
  if (!near(sumExclIK, capex.totals.exclLandInKind))
    issues.push(`Capex perPeriod.exclLandInKind sum ${sumExclIK} vs total ${capex.totals.exclLandInKind}`);
  if (!near(sumIncl, capex.totals.inclAllLand))
    issues.push(`Capex perPeriod.inclAllLand sum ${sumIncl} vs total ${capex.totals.inclAllLand}`);

  const totalDebt = split.debt.reduce((s, v) => s + v, 0);
  const totalEquity = split.equity.reduce((s, v) => s + v, 0);
  // Pass 26 (2026-05-14): Min Cash Reserve is funded from the same
  // debt/equity split, so the identity expands to include it.
  // Pass 30 (2026-05-14): Method 4 sizes from user-specified amounts
  // (funding.method4) instead of capex; identity flips accordingly.
  const expectedFunding = funding.selectedMethodId === 4
    ? funding.method4 + (funding.minCashReserve ?? 0)
    : capex.totals.exclLandInKind + (funding.minCashReserve ?? 0);
  if (!near(totalDebt + totalEquity, expectedFunding))
    issues.push(`Debt+CashEquity ${totalDebt + totalEquity} vs Funding+MinCash ${expectedFunding}`);

  let shareSum = 0;
  for (const v of shares.values()) shareSum += v;
  if (shares.size > 0 && !near(shareSum, 100))
    issues.push(`Facility shares sum ${shareSum} (expected 100)`);

  const newTrancheIds = new Set(tranches.filter((t) => t.origin !== 'existing').map((t) => t.id));
  const N = axis.totalPeriods;
  if (newTrancheIds.size > 0) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const f of facilities.values()) {
        if (!newTrancheIds.has(f.trancheId)) continue;
        s += f.drawSchedule[i] ?? 0;
      }
      const expected = split.debt[i] ?? 0;
      if (!near(s, expected)) {
        issues.push(`Period ${i} new-facility drawdown sum ${s} vs split.debt ${expected}`);
        break;
      }
    }
  }

  for (const f of facilities.values()) {
    if (!newTrancheIds.has(f.trancheId)) continue;
    const expected = totalDebt * (f.sharePct / 100);
    if (!near(f.totalDrawn, expected))
      issues.push(`New facility ${f.trancheId} totalDrawn ${f.totalDrawn} vs share ${expected}`);
  }

  const existingTrancheIds = new Set(tranches.filter((t) => t.origin === 'existing').map((t) => t.id));
  for (const f of facilities.values()) {
    if (!existingTrancheIds.has(f.trancheId)) continue;
    const t = tranches.find((x) => x.id === f.trancheId);
    const expected = Math.max(0, t?.openingBalance ?? 0);
    if (!near(f.totalDrawn, expected))
      issues.push(`Existing facility ${f.trancheId} totalDrawn ${f.totalDrawn} vs openingBalance ${expected}`);
  }

  for (const f of facilities.values()) {
    const t = tranches.find((x) => x.id === f.trancheId);
    const openingInitial = t?.origin === 'existing' ? Math.max(0, t.openingBalance ?? 0) : 0;
    for (let i = 0; i < N; i++) {
      const opening = i === 0 ? openingInitial : (f.outstanding[i - 1] ?? 0);
      const expectedClosing = opening
        + (f.drawSchedule[i] ?? 0)
        + (f.interestCapitalized[i] ?? 0)
        - (f.principalRepaid[i] ?? 0);
      const actual = f.outstanding[i] ?? 0;
      // Pass 28b (2026-05-14): closing balance gets snapped to 0
      // when within ±1000 (rounding cleanup), so the identity may
      // diverge by up to that snap amount. Relax tolerance to match.
      if (!near(expectedClosing, actual, 1000)) {
        issues.push(`Closing balance identity broken at facility ${f.trancheId} period ${i}: ${expectedClosing} vs ${actual}`);
        break;
      }
    }
  }

  if (!near(equity.totalCash, totalEquity))
    issues.push(`EquityMovement.totalCash ${equity.totalCash} vs split.equity sum ${totalEquity}`);

  const inKindSum = split.inKind.reduce((s, v) => s + v, 0);
  if (!near(equity.totalInKind, inKindSum))
    issues.push(`EquityMovement.totalInKind ${equity.totalInKind} vs split.inKind sum ${inKindSum}`);

  if (!near(equity.totalExisting, existing.equityTotal))
    issues.push(`EquityMovement.totalExisting ${equity.totalExisting} vs existing.equityTotal ${existing.equityTotal}`);

  const selectedExpected =
    funding.selectedMethodId === 1 ? funding.method1
    : funding.selectedMethodId === 2 ? funding.method2
    : funding.selectedMethodId === 3 ? funding.method3
    : funding.method4;
  if (!near(funding.selected, selectedExpected))
    issues.push(`Funding.selected ${funding.selected} vs method${funding.selectedMethodId} ${selectedExpected}`);

  return { ok: issues.length === 0, issues };
}
