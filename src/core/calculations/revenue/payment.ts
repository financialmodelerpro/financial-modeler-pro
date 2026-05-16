import { buildCohortMatrix, columnSums } from './cohort';
import type { CashPaymentProfile } from './types';

/**
 * Distributes per-cohort sale values across collection periods using
 * the cash payment milestone profile. Delegates to the shared cohort
 * engine so the absolute-year-with-catchup convention is identical
 * between cash and recognition.
 */
export function distributeCashCollection(
  salesValuePerYear: number[],
  profile: CashPaymentProfile,
  axisLength: number,
): number[] {
  const matrix = buildCohortMatrix(
    salesValuePerYear,
    {
      percentages: profile.percentages,
      positions: profile.positions,
      profileMode: profile.profileMode,
    },
    axisLength,
  );
  return columnSums(matrix, axisLength);
}
