/**
 * disposalSchedules.ts (2026-09-16, step 10)
 *
 * A SCHEDULE THAT SHOWS THE DISPOSAL THE BALANCE SHEET ALREADY BOOKED.
 *
 * The exit sells the held assets: the balance sheet takes their land, their
 * depreciable net book value and their capitalised interest to zero in the exit
 * year (`writeOffAtExit`, the same rule the composer runs). The SCHEDULES kept
 * showing the engine's own roll-forward, so a fixed asset table carried a
 * closing balance and a depreciation charge in years the balance sheet had
 * nothing at all, and the two disagreed with no row to explain it.
 *
 * This builder runs THE SAME pure function on one schedule and returns the rows
 * a reader needs: the disposal itself, no depreciation after it, and a closing
 * balance that ties to the balance sheet. Every series still foots:
 *
 *   closing[t] = opening[t] + additions[t] - depreciation[t] - disposal[t]
 *
 * With no terminal value, or an exit in the last year, every series comes back
 * as the engine computed it and the disposal row is all zeros.
 *
 * No em dashes in this file.
 */
import { writeOffAtExit } from '@/src/core/calculations/returns/disposal';

export interface DisposalContext {
  /** False when the terminal method is 'none': nothing is sold. */
  booked: boolean;
  exitIdx: number;
  axisLength: number;
}

export interface ScheduleWithDisposal {
  openingPerPeriod: number[];
  additionsPerPeriod: number[];
  /** Positive. Zero after the exit on what was sold. */
  depreciationPerPeriod: number[];
  /** Positive, in the exit year only: the balance the buyer took. */
  disposalPerPeriod: number[];
  closingPerPeriod: number[];
  /** Cumulative depreciation, zeroed from the exit with the asset it belonged to. */
  accumDepPerPeriod: number[];
  /** True when this schedule actually carried something into the exit year. */
  disposed: boolean;
}

interface ScheduleInput {
  openingPerPeriod?: readonly number[];
  additionsPerPeriod: readonly number[];
  depreciationPerPeriod?: readonly number[];
  closingPerPeriod: readonly number[];
  accumDepPerPeriod?: readonly number[];
  /** The balance carried in before the axis starts (a pre-axis asset). */
  openingAtAxisStart?: number;
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

/**
 * One schedule with its disposal. `depreciationPerPeriod` absent means the
 * balance does not depreciate (land, and the land half of a combined table).
 */
export function scheduleWithDisposal(input: ScheduleInput, ctx: DisposalContext): ScheduleWithDisposal {
  const N = Math.max(0, ctx.axisLength);
  const closing = input.closingPerPeriod.slice(0, N);
  const additions = input.additionsPerPeriod.slice(0, N);
  const depreciation = (input.depreciationPerPeriod ?? zeros(N)).slice(0, N);
  const accum = (input.accumDepPerPeriod ?? zeros(N)).slice(0, N);
  const openingAt0 = input.openingPerPeriod?.[0] ?? input.openingAtAxisStart ?? 0;
  const openingOf = (series: readonly number[]): number[] => series.map((_, t) => (t === 0 ? openingAt0 : series[t - 1] ?? 0));
  // A DISPOSAL IN THE LAST YEAR IS STILL A DISPOSAL (2026-09-16). The trading cut
  // (`stopAfterExit`) has nothing to stop when the exit is the last year, and this
  // guard was copied from it. The balance sheet writes the assets off in the exit
  // year whichever year that is, so measured on the live project, whose exit IS the
  // last year, the schedule showed 306.05m of fixed assets where the balance sheet
  // showed zero. Only "nothing was sold" leaves a schedule untouched.
  if (!ctx.booked) {
    return {
      openingPerPeriod: input.openingPerPeriod ? input.openingPerPeriod.slice(0, N) : openingOf(closing),
      additionsPerPeriod: additions,
      depreciationPerPeriod: depreciation,
      disposalPerPeriod: zeros(N),
      closingPerPeriod: closing,
      accumDepPerPeriod: accum,
      disposed: false,
    };
  }
  const X = Math.max(0, Math.min(N - 1, Math.round(ctx.exitIdx)));
  const w = writeOffAtExit(closing, input.depreciationPerPeriod ? depreciation : undefined, X, N);
  const disposal = zeros(N);
  disposal[X] = w.disposedAtExit;
  const nextDep = depreciation.map((v, t) => (t > X ? v - (w.depreciationRemovedPerPeriod[t] ?? 0) : v));
  const nextAccum = accum.map((v, t) => (t >= X ? 0 : v));
  return {
    openingPerPeriod: openingOf(w.adjustedPerPeriod),
    additionsPerPeriod: additions,
    depreciationPerPeriod: nextDep,
    disposalPerPeriod: disposal,
    closingPerPeriod: w.adjustedPerPeriod,
    accumDepPerPeriod: nextAccum,
    disposed: Math.abs(w.disposedAtExit) > 0.005,
  };
}

/** The capitalised interest pool as a schedule: additions are the interest capitalised. */
export function idcWithDisposal(
  idc: { totalIdcPerPeriod?: readonly number[]; idcPerPeriod?: readonly number[]; depreciationPerPeriod?: readonly number[]; idcDepreciationPerPeriod?: readonly number[]; closingNbvPerPeriod?: readonly number[]; idcNbvPerPeriod?: readonly number[] },
  ctx: DisposalContext,
): ScheduleWithDisposal {
  const N = Math.max(0, ctx.axisLength);
  return scheduleWithDisposal({
    additionsPerPeriod: (idc.totalIdcPerPeriod ?? idc.idcPerPeriod ?? zeros(N)),
    depreciationPerPeriod: (idc.idcDepreciationPerPeriod ?? idc.depreciationPerPeriod ?? zeros(N)),
    closingPerPeriod: (idc.idcNbvPerPeriod ?? idc.closingNbvPerPeriod ?? zeros(N)),
  }, ctx);
}

/** The disposal context from a financials snapshot, for any surface that holds one. */
export function disposalContextOf(snap: { axisLength: number; disposal?: { booked: boolean; exitIdx: number } }): DisposalContext {
  return { booked: snap.disposal?.booked === true, exitIdx: snap.disposal?.exitIdx ?? snap.axisLength - 1, axisLength: snap.axisLength };
}
