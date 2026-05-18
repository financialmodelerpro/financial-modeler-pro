/**
 * Project-wide HQ / corporate opex.
 *
 * Same line primitives as the per-asset engine but no per-asset
 * drivers (keys, leasable sqm). The only valid modes for HQ lines:
 *   - fixed_baseline      (with indexation)
 *   - pct_of_total_rev    (% of project total revenue)
 * Other modes resolve to zero (engine defends against bad config).
 */

import { applyIndexation } from '@/src/core/calculations/revenue/indexation';
import type { HQOpexInputs, HQOpexResult } from './types';

export function computeHQOpex(inputs: HQOpexInputs): HQOpexResult {
  const { lines, axisLength, projectTotalRevenuePerPeriod } = inputs;
  const N = Math.max(0, axisLength);
  const start = Math.max(0, Math.min(N - 1, inputs.opsStartIdx ?? 0));
  const end = Math.max(start, Math.min(N - 1, inputs.opsEndIdx ?? N - 1));

  const zeros = (): number[] => new Array<number>(N).fill(0);
  const perLine: number[][] = lines.map(() => zeros());
  const total = zeros();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.disabled) continue;
    const out = perLine[i];
    for (let t = start; t <= end; t++) {
      const factor = applyIndexation(1.0, t, line.indexation);
      let v = 0;
      if (line.mode === 'fixed_baseline') {
        v = Math.max(0, line.value) * factor;
      } else if (line.mode === 'pct_of_total_rev') {
        const rev = Math.max(0, projectTotalRevenuePerPeriod[t] ?? 0);
        v = Math.max(0, line.value) * rev * factor;
      }
      out[t] = v;
      total[t] += v;
    }
  }

  return { perLinePerPeriod: perLine, totalOpexPerPeriod: total };
}
