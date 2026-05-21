import type { ProfileMode } from './types';

/**
 * Shared cohort matrix engine. Builds the matrix[salesYear][collectionYear]
 * for a given per-year sales value array and a milestone profile. Both
 * the cash distribution and the over-time recognition pipelines reuse
 * this helper.
 *
 * profileMode = 'absolute_with_catchup' (default convention):
 *   percentages[k] is keyed at the absolute project period positions[k]
 *   (defaults to k). A cohort with sale year N pays / recognizes the
 *   sum of percentages whose position <= N as a single lump at year N
 *   (catchup), then per-percentage at each later position. Sum across
 *   the row still equals 100% of the cohort value.
 *
 * profileMode = 'relative_to_sale':
 *   percentages[k] is keyed at offset positions[k] (defaults to k)
 *   FROM the cohort sale year. cell[N][N + positions[k]] gets
 *   cohort * percentages[k]. No catchup logic.
 */
export interface ProfileSpec {
  percentages: number[];
  positions?: number[];
  profileMode?: ProfileMode;
}

export function buildCohortMatrix(
  salesValuePerYear: number[],
  profile: ProfileSpec,
  axisLength: number,
): number[][] {
  const N = Math.max(0, axisLength);
  const out: number[][] = [];
  for (let i = 0; i < N; i++) out.push(new Array<number>(N).fill(0));

  const pct = profile.percentages ?? [];
  const pos = profile.positions ?? pct.map((_, k) => k);
  const mode: ProfileMode = profile.profileMode ?? 'absolute_with_catchup';

  if (pct.length === 0 || pos.length !== pct.length) return out;

  const orderedPairs = pct
    .map((p, k) => ({ p, pos: pos[k] ?? k }))
    .filter((x) => Number.isFinite(x.pos))
    .sort((a, b) => a.pos - b.pos);

  for (let saleYear = 0; saleYear < N; saleYear++) {
    const cohortValue = Math.max(0, salesValuePerYear[saleYear] ?? 0);
    if (cohortValue === 0) continue;

    if (mode === 'absolute_with_catchup') {
      let catchup = 0;
      // M4 Pass 2N-Fix (2026-05-21): tailCatchup accumulates any
      // percentages scheduled at positions BEYOND the project axis
      // (position >= N). Previously these were silently dropped,
      // which left AR stuck at the un-collected residual forever
      // (e.g., total sale value 838,611 vs cash 712,819 = 125,792
      // leak on Residential Tower 01). Now we deposit the residual
      // at the last axis year so every cohort's row still sums to
      // 100% of cohortValue and AR settles to 0 by end of axis.
      let tailCatchup = 0;
      for (const { p, pos: position } of orderedPairs) {
        if (position < saleYear) {
          catchup += p;
        } else if (position === saleYear) {
          out[saleYear][saleYear] += cohortValue * (catchup + p);
          catchup = 0;
        } else if (position < N) {
          out[saleYear][position] += cohortValue * p;
        } else {
          // position >= N: defer to tail catchup at last axis year.
          tailCatchup += p;
        }
      }
      // If sale year is past every position, dump full catchup at sale year.
      if (catchup > 0) {
        out[saleYear][saleYear] += cohortValue * catchup;
      }
      if (tailCatchup > 0 && N > 0) {
        out[saleYear][N - 1] += cohortValue * tailCatchup;
      }
    } else {
      // relative_to_sale: same tail-catchup semantics. Offsets that
      // push past axis end accumulate at N-1 so AR settles.
      let tailCatchup = 0;
      for (const { p, pos: offset } of orderedPairs) {
        const col = saleYear + offset;
        if (col >= 0 && col < N) {
          out[saleYear][col] += cohortValue * p;
        } else if (col >= N) {
          tailCatchup += p;
        }
      }
      if (tailCatchup > 0 && N > 0) {
        out[saleYear][N - 1] += cohortValue * tailCatchup;
      }
    }
  }

  return out;
}

export function columnSums(matrix: number[][], axisLength: number): number[] {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < row.length && c < N; c++) {
      out[c] += row[c] ?? 0;
    }
  }
  return out;
}
