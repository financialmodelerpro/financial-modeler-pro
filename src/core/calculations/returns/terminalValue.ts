/**
 * M5 Returns engine, terminal (exit) value.
 *
 * Two methods the user picks between:
 *   exit_multiple -> Terminal EV = exit-year metric (stabilised EBITDA /
 *                    NOI) × exit multiple.
 *   perpetuity    -> Gordon growth: Terminal EV = exit FCF × (1 + g) /
 *                    (r − g).
 * `none` returns 0 (no terminal value booked).
 */
import type { TerminalValueInput } from './types';

/** Enterprise (firm-level) terminal value at the exit year. */
export function terminalEnterpriseValue(input: TerminalValueInput): number {
  const metric = input.exitMetric ?? 0;
  if (input.method === 'exit_multiple') {
    return Math.max(0, metric) * Math.max(0, input.exitMultiple ?? 0);
  }
  if (input.method === 'perpetuity') {
    const r = input.discountRate ?? 0;
    const g = input.perpetuityGrowth ?? 0;
    const spread = r - g;
    if (spread <= 1e-9) return 0; // undefined / non-convergent; guard to 0
    return Math.max(0, (metric * (1 + g)) / spread);
  }
  return 0;
}

/**
 * Equity terminal value = Enterprise terminal value − debt outstanding at
 * exit + free cash on the balance sheet at exit. Floored at 0 (equity
 * cannot be worth less than nothing to the holder at exit).
 */
export function terminalEquityValue(
  enterpriseValue: number,
  debtOutstandingAtExit: number,
  cashAtExit: number,
): number {
  return Math.max(0, enterpriseValue - Math.max(0, debtOutstandingAtExit) + Math.max(0, cashAtExit));
}
