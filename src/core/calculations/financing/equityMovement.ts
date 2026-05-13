import type { DebtEquitySplit, EquityMovement, ExistingAggregate, ProjectAxis } from './types';

/**
 * Period-by-period equity. Cash, in-kind and existing are additive
 * sources; in-kind never offsets cash (the Dec-26 zero-equity bug
 * Pass 20 locked in). Existing equity is the lump that operational
 * phases carry forward from before the reporting start.
 *
 *   cashPerPeriod            = debtEquitySplit.equity   verbatim
 *   inKindPerPeriod          = debtEquitySplit.inKind   verbatim (lump at col 0)
 *   existingEquityPerPeriod  = existing.equityTotal at col 0, zeros elsewhere
 *   totalPerPeriod           = cash + in-kind + existing
 */
export function computeEquityMovement(
  split: DebtEquitySplit,
  existing: ExistingAggregate,
  axis: ProjectAxis,
): EquityMovement {
  const N = axis.totalPeriods + 1;
  const cashPerPeriod          = new Array<number>(N).fill(0);
  const inKindPerPeriod        = new Array<number>(N).fill(0);
  const existingEquityPerPeriod = new Array<number>(N).fill(0);
  const totalPerPeriod         = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    cashPerPeriod[i]   = split.equity[i] ?? 0;
    inKindPerPeriod[i] = split.inKind[i] ?? 0;
  }
  if (N > 0) existingEquityPerPeriod[0] = existing.equityTotal;
  for (let i = 0; i < N; i++) {
    totalPerPeriod[i] = cashPerPeriod[i] + inKindPerPeriod[i] + existingEquityPerPeriod[i];
  }
  const totalCash     = cashPerPeriod.reduce((s, v) => s + v, 0);
  const totalInKind   = inKindPerPeriod.reduce((s, v) => s + v, 0);
  const totalExisting = existingEquityPerPeriod.reduce((s, v) => s + v, 0);
  return {
    cashPerPeriod,
    inKindPerPeriod,
    existingEquityPerPeriod,
    totalPerPeriod,
    totalCash,
    totalInKind,
    totalExisting,
    grandTotal: totalCash + totalInKind + totalExisting,
  };
}
