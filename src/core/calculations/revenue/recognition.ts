import { buildCohortMatrix, columnSums } from './cohort';
import type { RecognitionProfile } from './types';

/**
 * Builds the per-period revenue recognition stream from cohort sales.
 *
 * Point-in-Time: 100% of every cohort lumps at either the handover
 * year (constant across cohorts) or the cohort's own sale year.
 *
 * Over-Time: reuses the shared cohort engine with the recognition
 * profile, matching MAAD rows 176-184 (absolute-year + catchup).
 */
export function buildRecognition(
  salesValuePerYear: number[],
  profile: RecognitionProfile,
  handoverYear: number,
  axisLength: number,
): number[] {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    for (let saleYear = 0; saleYear < N; saleYear++) {
      const v = Math.max(0, salesValuePerYear[saleYear] ?? 0);
      if (v === 0) continue;
      const target = anchor === 'handover'
        ? Math.max(0, Math.min(N - 1, handoverYear))
        : saleYear;
      out[target] += v;
    }
    return out;
  }

  // Over-time: shared cohort engine.
  const matrix = buildCohortMatrix(
    salesValuePerYear,
    {
      percentages: profile.percentages ?? [],
      positions: profile.positions,
      profileMode: profile.profileMode,
    },
    N,
  );
  return columnSums(matrix, N);
}
