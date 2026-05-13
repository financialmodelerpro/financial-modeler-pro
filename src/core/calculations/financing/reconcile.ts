import type {
  CapexAggregate,
  DebtEquitySplit,
  EquityMovement,
  FacilityResult,
  FundingRequirement,
  ProjectAxis,
  Reconciliation,
} from './types';

const EPS_ABS = 1e-2;
const EPS_REL = 1e-6;

function near(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  if (d <= EPS_ABS) return true;
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
  equity: EquityMovement,
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
  if (!near(totalDebt + totalEquity, capex.totals.exclLandInKind))
    issues.push(`Debt+CashEquity ${totalDebt + totalEquity} vs CapexExclInKind ${capex.totals.exclLandInKind}`);

  let shareSum = 0;
  for (const v of shares.values()) shareSum += v;
  if (shares.size > 0 && !near(shareSum, 100))
    issues.push(`Facility shares sum ${shareSum} (expected 100)`);

  const N = axis.totalPeriods + 1;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (const f of facilities.values()) s += f.drawSchedule[i] ?? 0;
    const expected = split.debt[i] ?? 0;
    let allExisting = true;
    for (const f of facilities.values()) {
      const d = (f.drawSchedule.reduce((a, v) => a + v, 0));
      if (d > 0) { allExisting = false; break; }
    }
    if (!allExisting && !near(s, expected))
      issues.push(`Period ${i} facility drawdown sum ${s} vs split.debt ${expected}`);
    if (allExisting) break;
  }

  for (const f of facilities.values()) {
    const expected = totalDebt * (f.sharePct / 100);
    if (f.totalDrawn > 0 && !near(f.totalDrawn, expected))
      issues.push(`Facility ${f.trancheId} totalDrawn ${f.totalDrawn} vs share ${expected}`);
  }

  if (!near(equity.totalCash, totalEquity))
    issues.push(`EquityMovement.totalCash ${equity.totalCash} vs split.equity sum ${totalEquity}`);

  const inKindSum = split.inKind.reduce((s, v) => s + v, 0);
  if (!near(equity.totalInKind, inKindSum))
    issues.push(`EquityMovement.totalInKind ${equity.totalInKind} vs split.inKind sum ${inKindSum}`);

  const selectedExpected =
    funding.selectedMethodId === 1 ? funding.method1
    : funding.selectedMethodId === 2 ? funding.method2
    : funding.method3;
  if (!near(funding.selected, selectedExpected))
    issues.push(`Funding.selected ${funding.selected} vs method${funding.selectedMethodId} ${selectedExpected}`);

  return { ok: issues.length === 0, issues };
}
