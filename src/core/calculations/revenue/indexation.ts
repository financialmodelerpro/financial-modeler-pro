import type { IndexationConfig } from './types';

/**
 * Applies an indexation factor to a base rate for a given absolute
 * project year index. Year 0 is the first active project period (axis
 * convention: no prior column).
 *
 * Methods:
 *   - none:            factor = 1.0 always.
 *   - single_rate:     factor = (1 + rate) for years >= startYear; 1.0 before.
 *   - yoy_compound:    factor = (1 + rate) ^ max(0, year - startYear).
 *   - step:            pickup the latest steps[i].factor where steps[i].year <= year.
 *   - yoy_per_period:  per-year variable growth from `growthPerPeriod`.
 *                      factor[startYear] = 1; factor[y] = factor[y-1] ×
 *                      (1 + growthPerPeriod[y]) for y > startYear. Each
 *                      growth value is clamped to ≥ -99% so the factor
 *                      cannot collapse to zero. Mirrors MAAD's OOD-style
 *                      column where each year carries its own escalation.
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
  if (config.method === 'yoy_per_period') {
    if (year <= start) return base;
    const growth = config.growthPerPeriod ?? [];
    let factor = 1;
    for (let i = start + 1; i <= year; i++) {
      const g = Math.max(-0.99, growth[i] ?? 0);
      factor *= 1 + g;
    }
    return base * factor;
  }
  return base;
}
