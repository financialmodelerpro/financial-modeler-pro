/**
 * M5 Returns engine, Pass 2: shared sponsor-stream builder.
 *
 * Builds the inception-prefixed FCFF + FCFE streams for a GIVEN exit index
 * from the project's axis component arrays. Extracted so the resolver's main
 * path, the exit-year analysis loop, and the sensitivity grid all produce
 * identical streams (no drift). Pure.
 *
 * Stream layout (length E+1, E = exitIdx+1): index 0 = inception
 * (projectStartYear − 1), indices 1..E = axis years through exit.
 *   FCFF inception: − existing pre-capex; axis: CFO + CFI; exit: + terminal EV
 *   FCFE inception: − existing pre-capex + existing debt opening;
 *                   axis: CFO + CFI + debt draw − principal − interest − in-kind;
 *                   exit: + terminal equity value
 */
import { terminalEnterpriseValue, terminalEquityValue } from './terminalValue';
import type { TerminalMethod } from './types';

export interface SponsorStreamInputs {
  /** Axis arrays (index = axis period). Need entries through the exit index. */
  cfoAxis: number[];
  cfiAxis: number[];
  inKindAxis: number[];
  debtDrawAxis: number[];
  principalAxis: number[];   // already negative
  interestAxis: number[];    // already negative
  noiPerPeriod: number[];
  debtOutstandingPerPeriod: number[];
  existingPreCapex: number;
  existingDebtOpening: number;
}

export interface TerminalConfig {
  method: TerminalMethod;
  exitMultiple: number;
  perpetuityGrowth: number;
  discountRate: number;
  /** When set (> 0), terminal EV = stabilised NOI / capRate, overriding the
   *  method (used by the exit-cap-rate sensitivity axis). */
  capRateOverride?: number;
}

export interface SponsorStreams {
  fcff: number[];
  fcfe: number[];
  stabilisedNOI: number;
  exitNOI: number;
  terminalEnterpriseValue: number;
  terminalEquityValue: number;
}

export function buildSponsorStreamsForExit(
  inp: SponsorStreamInputs,
  exitIdx: number,
  term: TerminalConfig,
): SponsorStreams {
  const exit = Math.max(0, exitIdx);
  const E = exit + 1;
  const noi = inp.noiPerPeriod;
  const exitNOI = noi[exit] ?? 0;
  const stabilisedNOI = Math.max(exitNOI, ...noi.slice(0, E), 0);

  const exitFcff = (inp.cfoAxis[exit] ?? 0) + (inp.cfiAxis[exit] ?? 0);
  let tvEnterprise: number;
  if (term.capRateOverride !== undefined && term.capRateOverride > 0) {
    tvEnterprise = stabilisedNOI > 0 ? stabilisedNOI / term.capRateOverride : 0;
  } else {
    tvEnterprise = terminalEnterpriseValue({
      method: term.method,
      exitMetric: term.method === 'perpetuity' ? exitFcff : stabilisedNOI,
      exitMultiple: term.exitMultiple,
      perpetuityGrowth: term.perpetuityGrowth,
      discountRate: term.discountRate,
    });
  }
  const debtAtExit = inp.debtOutstandingPerPeriod[exit] ?? 0;
  const tvEquity = terminalEquityValue(tvEnterprise, debtAtExit, 0);

  const fcff = new Array<number>(E + 1).fill(0);
  const fcfe = new Array<number>(E + 1).fill(0);
  fcff[0] = -inp.existingPreCapex;
  fcfe[0] = -inp.existingPreCapex + inp.existingDebtOpening;
  for (let t = 0; t < E; t++) {
    const base = (inp.cfoAxis[t] ?? 0) + (inp.cfiAxis[t] ?? 0);
    fcff[t + 1] = base;
    fcfe[t + 1] = base + (inp.debtDrawAxis[t] ?? 0) + (inp.principalAxis[t] ?? 0) + (inp.interestAxis[t] ?? 0) - (inp.inKindAxis[t] ?? 0);
  }
  fcff[exit + 1] += tvEnterprise;
  fcfe[exit + 1] += tvEquity;

  return { fcff, fcfe, stabilisedNOI, exitNOI, terminalEnterpriseValue: tvEnterprise, terminalEquityValue: tvEquity };
}
