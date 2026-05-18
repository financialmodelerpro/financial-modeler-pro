/**
 * Shared number formatters for Module 2 surfaces (Revenue, CoS,
 * Schedules). Extracted in the M2 lock cleanup so the same rounding
 * + display rules apply uniformly:
 *
 *   - ZERO_SNAP_THRESHOLD: any raw value with |x| < 1 currency unit
 *     renders as "-". Mirrors the financing/schedule.ts:266 convention
 *     (|bal| < 1000 → 0 on debt balances) but tuned for revenue-side
 *     rollups where sub-unit residuals come from float math, not from
 *     interest accrual rounding.
 *   - makeFmt(scale, decimals): currency formatter with snap-to-zero.
 *     Pulls `scale` and `decimals` from project.displayScale /
 *     project.displayDecimals so every per-asset surface shows the
 *     same values.
 *   - makePctFmt(decimals): percentage formatter that respects the
 *     same project.displayDecimals (per [[feedback_ui_universal_defaults]]
 *     rule "all % follow project.displayDecimals"). 1e-9 threshold
 *     suppresses cumulative-rollup float noise on % rows.
 */

import { formatAccounting, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';

/** Sub-unit-of-currency residuals (|x| < 1) suppress to dash. */
export const ZERO_SNAP_THRESHOLD = 1;

export function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (Math.abs(v) < ZERO_SNAP_THRESHOLD) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

export function makePctFmt(decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '-';
    return `${(v * 100).toFixed(decimals)}%`;
  };
}
