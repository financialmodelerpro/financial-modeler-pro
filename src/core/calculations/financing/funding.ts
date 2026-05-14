import type { ProjectFinancingConfig } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { CapexAggregate, FundingRequirement } from './types';

/**
 * Funding Requirement table feed.
 *
 *   Method 1 (Fixed Debt-to-Equity Ratio): need = capex excl land in-kind.
 *     debtPct + equityPct come from fixedRatio config.
 *   Method 2 (Net Funding Requirement): need = capex excl land in-kind
 *     minus pre-sales minus operating CF minus existing cash. Returns 0
 *     today, blocked on M2 Revenue + M4 FS; the row renders blank in UI.
 *   Method 3 (Cash Deficit Funding): period-by-period draw. Returns 0
 *     today, blocked on M2 Revenue + M4 FS.
 *
 * Pass 26 (2026-05-14): Minimum Cash Reserve from financingConfig adds
 * a one-shot buffer on top of the selected method's curve. The buffer
 * is lumped at the first non-zero capex period (axis-indexed) so the
 * project starts operations with the configured cash on hand. Methods
 * 1 + 2 add it explicitly via `totalFundingNeedByPeriod`; Method 3
 * (Cash Deficit) absorbs it implicitly when it lands.
 *
 * `selected` mirrors the method the user picked in financingConfig.
 */
export function computeFundingRequirement(
  capex: CapexAggregate,
  financingConfig: ProjectFinancingConfig,
): FundingRequirement {
  const m1 = capex.totals.exclLandInKind;
  const m2 = 0;
  const m3 = 0;
  const selectedMethodId = financingConfig.fundingMethod;
  const selected = selectedMethodId === 1 ? m1 : selectedMethodId === 2 ? m2 : m3;
  const ratio = financingConfig.fixedRatio ?? { debtPct: 70, equityPct: 30 };
  const debtPctRaw = Math.max(0, ratio.debtPct ?? 0);
  const equityPctRaw = Math.max(0, ratio.equityPct ?? 0);
  const sum = debtPctRaw + equityPctRaw;
  const debtPct = sum > 0 ? (debtPctRaw / sum) * 100 : 0;
  const equityPct = sum > 0 ? (equityPctRaw / sum) * 100 : 0;

  const exclLandInKindByPeriod = capex.perPeriod.exclLandInKind;
  const N = exclLandInKindByPeriod.length;
  const selectedByPeriod = selectedMethodId === 1
    ? exclLandInKindByPeriod.slice()
    : new Array<number>(N).fill(0);

  const minCashReserve = Math.max(0, financingConfig.minimumCashReserve ?? 0);
  const minCashByPeriod = new Array<number>(N).fill(0);
  if (minCashReserve > 0 && N > 0) {
    let firstCapexIdx = -1;
    for (let i = 0; i < N; i++) {
      if ((exclLandInKindByPeriod[i] ?? 0) > 0) { firstCapexIdx = i; break; }
    }
    minCashByPeriod[firstCapexIdx >= 0 ? firstCapexIdx : 0] = minCashReserve;
  }
  const totalFundingNeedByPeriod = selectedByPeriod.map((v, i) => v + (minCashByPeriod[i] ?? 0));
  const selectedWithMinCash = selected + (selectedMethodId === 3 ? 0 : minCashReserve);

  return {
    method1: m1,
    method2: m2,
    method3: m3,
    selected,
    selectedMethodId,
    debtPct,
    equityPct,
    minCashReserve,
    minCashByPeriod,
    selectedByPeriod,
    totalFundingNeedByPeriod,
    selectedWithMinCash,
  };
}
