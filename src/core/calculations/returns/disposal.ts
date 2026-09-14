/**
 * disposal.ts
 *
 * THE EXIT IS A DISPOSAL (2026-09-14, founder's direction, matching the
 * reference model).
 *
 * The reference treats the exit as a real sale of the held assets: the terminal
 * value (the prior year's hospitality EBITDA plus retail NOI, over the exit cap
 * rate) is PROCEEDS FROM DISPOSAL in the cash flow, the income statement carries
 * a gain on disposal (proceeds less the net book value in that year) below
 * interest and above zakat, and the fixed assets go to zero from the exit year.
 *
 * Until this change the terminal value existed only inside the Returns streams:
 * nothing reached the P&L, the cash flow or the balance sheet, and the metric
 * was the exit year's NOI or the best year before it, whichever was higher,
 * which is neither of the two conventions a modeller would choose.
 *
 * TWO RULES LIVE HERE, EACH ONCE:
 *   `valueAtExit`    the terminal value, on a stated BASIS: the year before the
 *                    exit (the reference) or the exit year itself. The financials
 *                    composer books it as proceeds and the Returns streams value
 *                    every candidate exit with it, so the two cannot disagree.
 *   `writeOffAtExit` a fixed asset series taken to zero at the exit: the closing
 *                    balance in the exit year is disposed, and anything after it
 *                    keeps only later additions, with no further depreciation.
 *
 * Pure. Imports only the terminal value formula.
 */
import { terminalEnterpriseValue } from './terminalValue';
import type { TerminalMethod } from './types';

export type TerminalValueBasis = 'prior_year' | 'exit_year';

/** The reference capitalises the year BEFORE the exit. */
export const DEFAULT_TERMINAL_VALUE_BASIS: TerminalValueBasis = 'prior_year';

/** The axis index whose income is capitalised. The prior year of a first-year
 *  exit is the exit year itself: there is no earlier year to read. */
export function terminalMetricIndex(exitIdx: number, basis: TerminalValueBasis | undefined): number {
  const exit = Math.max(0, Math.round(exitIdx));
  return (basis ?? DEFAULT_TERMINAL_VALUE_BASIS) === 'exit_year' ? exit : Math.max(0, exit - 1);
}

export interface TerminalValuationInput {
  exitIdx: number;
  basis?: TerminalValueBasis;
  method: TerminalMethod;
  /** Hospitality EBITDA plus retail NOI per axis period. */
  noiPerPeriod: readonly number[];
  /** Unlevered free cash flow per axis period, read by the perpetuity method. */
  fcffPerPeriod?: readonly number[];
  exitMultiple?: number;
  perpetuityGrowth?: number;
  discountRate?: number;
  capRate?: number;
  applyGrowth?: boolean;
}

export interface TerminalValuation {
  metricIdx: number;
  /** The income (or free cash flow, for perpetuity) that was capitalised. */
  exitMetric: number;
  enterpriseValue: number;
}

export function valueAtExit(i: TerminalValuationInput): TerminalValuation {
  const metricIdx = terminalMetricIndex(i.exitIdx, i.basis);
  const exitMetric = i.method === 'perpetuity'
    ? (i.fcffPerPeriod?.[metricIdx] ?? 0)
    : (i.noiPerPeriod[metricIdx] ?? 0);
  const enterpriseValue = terminalEnterpriseValue({
    method: i.method,
    exitMetric,
    exitMultiple: i.exitMultiple,
    perpetuityGrowth: i.perpetuityGrowth,
    discountRate: i.discountRate,
    capRate: i.capRate,
    applyGrowth: i.applyGrowth,
  });
  return { metricIdx, exitMetric, enterpriseValue };
}

export interface WriteOff {
  /** The series as the balance sheet carries it after the disposal. */
  adjustedPerPeriod: number[];
  /** The closing balance in the exit year, which is what was sold. */
  disposedAtExit: number;
  /** Depreciation charged AFTER the exit that no longer arises. */
  depreciationRemovedPerPeriod: number[];
}

/**
 * Take one fixed asset series to zero at the exit. Before the exit it is
 * untouched. From the exit on it holds only additions made after the exit,
 * because the depreciation the engine charged on the sold balance afterwards is
 * added back and the sold balance itself is taken out.
 */
export function writeOffAtExit(
  closingPerPeriod: readonly number[],
  depreciationPerPeriod: readonly number[] | undefined,
  exitIdx: number,
  axisLength: number,
): WriteOff {
  const N = Math.max(0, axisLength);
  const X = Math.max(0, Math.min(N - 1, Math.round(exitIdx)));
  const adjusted = new Array<number>(N).fill(0);
  const removed = new Array<number>(N).fill(0);
  const disposed = closingPerPeriod[X] ?? 0;
  let addBack = 0;
  for (let t = 0; t < N; t++) {
    if (t < X) { adjusted[t] = closingPerPeriod[t] ?? 0; continue; }
    if (t > X) {
      const dep = depreciationPerPeriod?.[t] ?? 0;
      removed[t] = dep;
      addBack += dep;
    }
    adjusted[t] = (closingPerPeriod[t] ?? 0) - disposed + addBack;
  }
  return { adjustedPerPeriod: adjusted, disposedAtExit: disposed, depreciationRemovedPerPeriod: removed };
}
