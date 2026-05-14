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
  // Pass 30 (2026-05-14): Method 4 = user-specified Debt + Equity.
  const m4Cfg = financingConfig.fixedAmountConfig
    ?? { debtAmount: 0, equityAmount: 0, yoySchedule: [] };
  const m4DebtAmt = Math.max(0, m4Cfg.debtAmount ?? 0);
  const m4EquityAmt = Math.max(0, m4Cfg.equityAmount ?? 0);
  const m4 = m4DebtAmt + m4EquityAmt;

  const selectedMethodId = financingConfig.fundingMethod;
  const selected =
    selectedMethodId === 1 ? m1
    : selectedMethodId === 2 ? m2
    : selectedMethodId === 3 ? m3
    : m4;

  // debtPct / equityPct: Methods 1-3 read fixedRatio; Method 4 derives
  // from the user-specified amounts so downstream consumers (parcel
  // land split, IDC capitalisation) still see a meaningful ratio.
  let debtPct: number;
  let equityPct: number;
  if (selectedMethodId === 4) {
    debtPct = m4 > 0 ? (m4DebtAmt / m4) * 100 : 0;
    equityPct = m4 > 0 ? (m4EquityAmt / m4) * 100 : 0;
  } else {
    const ratio = financingConfig.fixedRatio ?? { debtPct: 70, equityPct: 30 };
    const debtPctRaw = Math.max(0, ratio.debtPct ?? 0);
    const equityPctRaw = Math.max(0, ratio.equityPct ?? 0);
    const sum = debtPctRaw + equityPctRaw;
    debtPct = sum > 0 ? (debtPctRaw / sum) * 100 : 0;
    equityPct = sum > 0 ? (equityPctRaw / sum) * 100 : 0;
  }

  const exclLandInKindByPeriod = capex.perPeriod.exclLandInKind;
  const N = exclLandInKindByPeriod.length;

  // Pass 30: Method 4 builds its per-period draw from the YoY schedule
  // (normalised to 100). Earlier methods drive selectedByPeriod from
  // capex; Method 4 drives it from the specified totals + curve.
  let selectedByPeriod: number[];
  let customDebtByPeriod: number[] | undefined;
  let customEquityByPeriod: number[] | undefined;
  if (selectedMethodId === 1) {
    selectedByPeriod = exclLandInKindByPeriod.slice();
  } else if (selectedMethodId === 4) {
    const raw = m4Cfg.yoySchedule ?? [];
    const padded = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) padded[i] = Math.max(0, raw[i] ?? 0);
    const sumW = padded.reduce((s, v) => s + v, 0);
    const norm = sumW > 0 ? padded.map((v) => v / sumW) : padded.map(() => N > 0 ? 1 / N : 0);
    selectedByPeriod = norm.map((w) => w * m4);
    customDebtByPeriod = norm.map((w) => w * m4DebtAmt);
    customEquityByPeriod = norm.map((w) => w * m4EquityAmt);
  } else {
    selectedByPeriod = new Array<number>(N).fill(0);
  }

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
    method4: m4,
    selected,
    selectedMethodId,
    debtPct,
    equityPct,
    minCashReserve,
    minCashByPeriod,
    selectedByPeriod,
    totalFundingNeedByPeriod,
    selectedWithMinCash,
    customDebtByPeriod,
    customEquityByPeriod,
  };
}
