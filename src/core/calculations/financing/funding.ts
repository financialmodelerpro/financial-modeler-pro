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
  return {
    method1: m1,
    method2: m2,
    method3: m3,
    selected,
    selectedMethodId,
    debtPct,
    equityPct,
  };
}
