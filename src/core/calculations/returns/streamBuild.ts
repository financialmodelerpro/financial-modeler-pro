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
 *
 * 2026-08-18, matching the reference:
 *   FCFF = CFO (pre-interest) LESS FULL-COST CAPEX, where full cost is the cash
 *          capex plus the land contributed in kind plus the IDC. Inception is
 *          − existing pre-capex; the terminal ENTERPRISE value lands at exit.
 *   FCFE = FCFF + debt drawn for capex + debt drawn for IDC + principal repaid
 *          + the OPERATING finance cost, with the enterprise terminal backed
 *          out and the terminal EQUITY value (terminal value less closing
 *          debt) put in its place. Inception is − existing equity.
 *
 * TWO THINGS THAT MUST STAY TRUE, and each is deducted EXACTLY ONCE:
 *   - In-kind land is a real cost of the project, so FCFF carries it. FCFE
 *     inherits it through FCFF and must not charge it again.
 *   - The finance cost is SPLIT. The IDC half is inside FCFF (it is capex);
 *     only the operating half belongs in the FCFE step. Passing total interest
 *     there would deduct the IDC twice.
 * The algebra closes: FCFE = CFO − capexCash − inKind − IDC + capexDraw
 * + idcDraw − principal − operating interest, which is the equity holder's
 * actual net cash. `verify-returns-buildup` asserts exactly that.
 */
import { terminalEnterpriseValue, terminalEquityValue } from './terminalValue';
import type { TerminalMethod } from './types';

export interface SponsorStreamInputs {
  /** Axis arrays (index = axis period). Need entries through the exit index. */
  cfoAxis: number[];
  /** Cash construction capex, negative (Cash from Investing). */
  cfiAxis: number[];
  /** Land contributed in kind, POSITIVE magnitude. Deducted in FCFF. */
  inKindAxis: number[];
  /** IDC, POSITIVE magnitude. Deducted in FCFF: it is part of the cost of
   *  building, and it is NOT deducted again as a finance cost in FCFE. */
  idcAxis: number[];
  /** Debt drawn to fund CAPEX. */
  debtDrawAxis: number[];
  /** Debt drawn to fund IDC. Shown separately so a reader can see each. */
  idcDrawAxis: number[];
  principalAxis: number[];   // already negative
  /** OPERATING finance cost only, already negative. The IDC half is in FCFF. */
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

  const fullCapexAt = (t: number): number =>
    (inp.cfiAxis[t] ?? 0) - (inp.inKindAxis[t] ?? 0) - (inp.idcAxis[t] ?? 0);
  const exitFcff = (inp.cfoAxis[exit] ?? 0) + fullCapexAt(exit);
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
    const base = (inp.cfoAxis[t] ?? 0) + fullCapexAt(t);
    fcff[t + 1] = base;
    // FCFE is the SAME base plus the financing legs. In-kind and IDC are
    // already inside `base`, which is why neither appears again here.
    fcfe[t + 1] = base
      + (inp.debtDrawAxis[t] ?? 0) + (inp.idcDrawAxis[t] ?? 0)
      + (inp.principalAxis[t] ?? 0) + (inp.interestAxis[t] ?? 0);
  }
  fcff[exit + 1] += tvEnterprise;
  fcfe[exit + 1] += tvEquity;

  return { fcff, fcfe, stabilisedNOI, exitNOI, terminalEnterpriseValue: tvEnterprise, terminalEquityValue: tvEquity };
}
