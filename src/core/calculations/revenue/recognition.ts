import { buildCohortMatrix, columnSums } from './cohort';
import type { RecognitionProfile } from './types';

/**
 * Builds the per-period revenue recognition stream from cohort sales.
 *
 * Point-in-Time: 100% of every cohort lumps at one of three anchors:
 *   - 'handover'   : every cohort lumps at the asset's handover year
 *   - 'sale_year'  : each cohort lumps in its own sale year
 *   - 'custom'     : every cohort lumps at pointInTimeCustomYear
 *                    (absolute project year, e.g. 2030). Pass 9g-H
 *                    added so clients can pin recognition to any
 *                    contractually-specified year.
 *
 * Over-Time: reuses the shared cohort engine with the recognition
 * profile (absolute-year + catchup convention).
 */
export function buildRecognition(
  salesValuePerYear: number[],
  profile: RecognitionProfile,
  handoverYear: number,
  axisLength: number,
  projectStartYear?: number,
): number[] {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    // Resolve the absolute target index for 'handover' + 'custom' modes
    // (saleYear-anchored mode resolves per cohort below).
    let staticTarget: number | null = null;
    if (anchor === 'handover') {
      staticTarget = Math.max(0, Math.min(N - 1, handoverYear));
    } else if (anchor === 'custom') {
      const yr = profile.pointInTimeCustomYear;
      if (yr != null && projectStartYear != null) {
        staticTarget = Math.max(0, Math.min(N - 1, yr - projectStartYear));
      } else {
        // No custom year set -> fall through to handover so revenue is
        // never silently dropped. Engine still runs deterministically.
        staticTarget = Math.max(0, Math.min(N - 1, handoverYear));
      }
    }
    for (let saleYear = 0; saleYear < N; saleYear++) {
      const v = Math.max(0, salesValuePerYear[saleYear] ?? 0);
      if (v === 0) continue;
      const target = staticTarget != null ? staticTarget : saleYear;
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
