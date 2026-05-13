import type { DebtEquitySplit, EquityMovement, ProjectAxis } from './types';

/**
 * Period-by-period equity. Cash and in-kind are additive sources;
 * in-kind never offsets cash (the Dec-26 zero-equity bug Pass 20
 * locked in). Engine returns full project-period arrays.
 *
 *   cashPerPeriod   = debtEquitySplit.equity   verbatim
 *   inKindPerPeriod = debtEquitySplit.inKind   verbatim (lump at col 0)
 *   totalPerPeriod  = cash + in-kind
 */
export function computeEquityMovement(
  split: DebtEquitySplit,
  axis: ProjectAxis,
): EquityMovement {
  const N = axis.totalPeriods + 1;
  const cashPerPeriod   = new Array<number>(N).fill(0);
  const inKindPerPeriod = new Array<number>(N).fill(0);
  const totalPerPeriod  = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    cashPerPeriod[i]   = split.equity[i] ?? 0;
    inKindPerPeriod[i] = split.inKind[i] ?? 0;
    totalPerPeriod[i]  = cashPerPeriod[i] + inKindPerPeriod[i];
  }
  const totalCash   = cashPerPeriod.reduce((s, v) => s + v, 0);
  const totalInKind = inKindPerPeriod.reduce((s, v) => s + v, 0);
  return {
    cashPerPeriod,
    inKindPerPeriod,
    totalPerPeriod,
    totalCash,
    totalInKind,
    grandTotal: totalCash + totalInKind,
  };
}
