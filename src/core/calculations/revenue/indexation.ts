import type { IndexationConfig } from './types';

/**
 * Applies an indexation factor to a base rate for a given absolute
 * project year index. Year 0 is the first active project period (axis
 * convention: no prior column).
 *
 * Methods:
 *   - none:           factor = 1.0 always.
 *   - single_rate:    factor = (1 + rate) for years >= startYear; 1.0 before.
 *   - yoy_compound:   factor = (1 + rate) ^ max(0, year - startYear).
 *   - step:           pickup the latest steps[i].factor where steps[i].year <= year.
 */
export function applyIndexation(
  baseRate: number,
  year: number,
  config: IndexationConfig,
): number {
  const base = Math.max(0, baseRate);
  if (!config || config.method === 'none') return base;
  const start = Math.max(0, config.startYear ?? 0);
  const rate = config.rate ?? 0;
  if (config.method === 'single_rate') {
    return year >= start ? base * (1 + rate) : base;
  }
  if (config.method === 'yoy_compound') {
    const n = Math.max(0, year - start);
    return base * Math.pow(1 + rate, n);
  }
  if (config.method === 'step') {
    const steps = (config.steps ?? []).slice().sort((a, b) => a.year - b.year);
    let factor = 1;
    for (const s of steps) {
      if (s.year <= year) factor = s.factor;
    }
    return base * factor;
  }
  return base;
}
