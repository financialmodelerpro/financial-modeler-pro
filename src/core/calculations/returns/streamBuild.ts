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
 * 2026-08-18b, matching the reference models:
 *   FCFF = CFO (pre-interest) LESS CAPEX INCLUDING IN-KIND LAND, plus the
 *          terminal ENTERPRISE value. Inception is − existing pre-capex.
 *          THERE IS NO INTEREST LINE OF ANY KIND IN FCFF, and none belongs:
 *          it is an UNLEVERED measure, so the whole finance cost including the
 *          IDC lives in FCFE. In-kind land DOES stay, because it is a real
 *          resource the project consumed, not a financing charge.
 *   FCFE = FCFF, less the FULL accrued finance cost (which carries the IDC),
 *          plus the debt drawn for capex, plus the debt drawn for IDC, less
 *          principal repaid, with the enterprise terminal backed out and the
 *          terminal EQUITY value put in its place. Inception is − existing
 *          equity.
 *
 * WHY THE IDC DRAWDOWN IS A ROW HERE. FCFE deducts the whole charge, but only
 * part of it left the bank; the rest was funded by drawing debt. Showing both
 * the gross charge and the drawdown that funded it nets to the cash actually
 * paid, and keeps the reader able to see each. The capitalised slice is not
 * lost: it grew the balance and leaves later as PRINCIPAL, which is why the
 * principal row is what ultimately carries it.
 *
 * The algebra closes: FCFE = CFO − capexCash − inKind − cashInterest
 * − principal + capexDraw, which is the equity holder's actual net cash.
 * `verify-returns-buildup` asserts exactly that.
 */
import { terminalEquityValue } from './terminalValue';
import { valueAtExit, type TerminalValueBasis } from './disposal';
import type { TerminalMethod } from './types';

export interface SponsorStreamInputs {
  /** Axis arrays (index = axis period). Need entries through the exit index. */
  cfoAxis: number[];
  /** Cash construction capex, negative (Cash from Investing). */
  cfiAxis: number[];
  /** Land contributed in kind, POSITIVE magnitude. Deducted in FCFF. */
  inKindAxis: number[];
  /** The FULL accrued finance cost, POSITIVE magnitude: operating plus IDC.
   *  Deducted in FCFE and NOWHERE in FCFF. */
  financeCostAxis: number[];
  /** Debt drawn to fund CAPEX. */
  debtDrawAxis: number[];
  /** Debt drawn to fund IDC. NOT a cash inflow on the cash statement; here it
   *  is the add-back that turns the gross charge into the cash actually paid. */
  idcDrawAxis: number[];
  principalAxis: number[];   // already negative
  /** The CHANGE per period in cash COMMITTED TO FUTURE DEBT REPAYMENT, positive
   *  as the commitment grows. REQUIRED, so the compiler enumerates every place
   *  a sponsor stream is assembled.
   *
   *  WHY FCFE DEDUCTS IT (2026-09-22). Under a cash sweep, cash above the
   *  minimum reserve is contractually the lender's the moment the sweep starts,
   *  so it was never the equity holder's to take. FCFE without this row showed
   *  it paid out in the year it was earned and clawed back in the year it
   *  actually repaid the debt: on the live model 192.3m out in 2030 and 192.3m
   *  back in 2031, and a year of free money is worth 2.69 points of IRR.
   *
   *  WHAT IT MUST NOT BECOME (the defect this replaces, same day). The first
   *  cut deducted the whole movement in cash, which is a different and wrong
   *  rule: it makes FCFE "cash actually paid to equity", which is the DIVIDEND
   *  stream. Measured, FCFE then equalled DDM to 0.00 in every period under
   *  BOTH repayment methods and the two IRRs were identical (18.39% on the
   *  sweep, 25.47% on a fixed schedule). Two streams that answer different
   *  questions had been collapsed into one.
   *
   *  SO THE TEST OF THIS ROW IS THAT IT IS NARROW. Under a fixed schedule
   *  nothing is committed and this is all zeros, so FCFE is cash after that
   *  year's interest and scheduled principal. A project that then retains cash
   *  rather than paying a dividend still counts it FREE, and FCFE and DDM
   *  differ, which is the point of having both. The minimum cash reserve is NOT
   *  committed either: it is an operating floor, not a debt payment.
   *
   *  It is PURE TIMING: whatever is committed is released at the exit, so the
   *  lifetime FCFE total cannot move.
   *
   *  FCFF does not deduct it and must not: FCFF is unlevered, and cash a
   *  LENDER has a claim on is still the firm's. */
  trappedCashAxis: number[];
  noiPerPeriod: number[];
  debtOutstandingPerPeriod: number[];
  existingPreCapex: number;
  existingDebtOpening: number;
  /** Tax charged on a disposal gain, per period (2026-09-14). Added back to the
   *  perpetuity metric, which the composer values before that tax exists. */
  gainTaxAxis?: number[];
}

export interface TerminalConfig {
  method: TerminalMethod;
  exitMultiple: number;
  perpetuityGrowth: number;
  discountRate: number;
  /** The exit cap rate (decimal), used when `method` is `cap_rate`. */
  capRate?: number;
  /** Grow the exit metric by (1 + g) before capitalising. */
  applyGrowth?: boolean;
  /** Which year's income the terminal value capitalises (2026-09-14). Absent
   *  means the year before the exit, as the financials composer books it. */
  basis?: TerminalValueBasis;
  /** When set (> 0), FORCES the cap-rate valuation whatever the method. Used by
   *  the exit-cap-rate sensitivity axis, which sweeps the rate on a model whose
   *  own method may be something else. It routes through the SAME
   *  `terminalEnterpriseValue` call below rather than computing its own
   *  `NOI / rate`, so the axis cannot drift from the model it is sweeping. */
  capRateOverride?: number;
}

export interface SponsorStreams {
  fcff: number[];
  /** FCFF BEFORE the terminal value, which is the row the FCFE chain starts
   *  from. The reference keeps these as two rows (its FCFF subtotal is
   *  pre-terminal and its "FCFF Incl. Terminal Value" is the next line down),
   *  and having it lets FCFE chain cleanly instead of backing the enterprise
   *  terminal out again. */
  fcffBeforeTerminal: number[];
  fcfe: number[];
  /** The FCFE cash-retention row, signed as FCFE reads it: negative while the
   *  project holds cash back, positive as it releases, and carrying the whole
   *  closing balance at the exit. Sums to zero over the stream by construction,
   *  which is the property that makes this timing and not value. */
  cashRetained: number[];
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

  // Capex INCLUDING in-kind land. No IDC: FCFF is unlevered.
  const fullCapexAt = (t: number): number =>
    (inp.cfiAxis[t] ?? 0) - (inp.inKindAxis[t] ?? 0);
  // The sensitivity axis forces the cap-rate method; everything else follows the
  // model's own. ONE call either way, so the swept value and the model value are
  // the same calculation.
  const sweeping = term.capRateOverride !== undefined && term.capRateOverride > 0;
  const method = sweeping ? 'cap_rate' : term.method;
  // THE TERMINAL VALUE IS THE DISPOSAL PROCEEDS (2026-09-14): the SAME rule the
  // financials composer books as proceeds from disposal, on the same basis (the
  // year before the exit by default). The perpetuity metric is that year's FCFF
  // before any tax on the disposal gain, which is added back because the
  // composer valued it before that tax existed.
  const fcffForMetric = inp.cfoAxis.map((v, t) => (v ?? 0) + (inp.gainTaxAxis?.[t] ?? 0) + fullCapexAt(t));
  const valuation = valueAtExit({
    exitIdx: exit, basis: term.basis, method, noiPerPeriod: noi, fcffPerPeriod: fcffForMetric,
    exitMultiple: term.exitMultiple, perpetuityGrowth: term.perpetuityGrowth, discountRate: term.discountRate,
    capRate: sweeping ? term.capRateOverride : term.capRate, applyGrowth: term.applyGrowth,
  });
  const tvEnterprise = valuation.enterpriseValue;
  // The income that was capitalised, so the implied cap rate is the one used. It
  // was the higher of the exit year and the best year before it, a third
  // convention nobody chose; retired.
  const stabilisedNOI = noi[valuation.metricIdx] ?? 0;
  const debtAtExit = inp.debtOutstandingPerPeriod[exit] ?? 0;
  const tvEquity = terminalEquityValue(tvEnterprise, debtAtExit, 0);

  const fcff = new Array<number>(E + 1).fill(0);
  const fcffBeforeTerminal = new Array<number>(E + 1).fill(0);
  const fcfe = new Array<number>(E + 1).fill(0);
  // Cash the project is holding on the equity holder's behalf. Accumulated as
  // it is retained and returned in one go at the exit, so the treatment moves
  // WHEN the cash reaches equity and never HOW MUCH.
  const cashRetained = new Array<number>(E + 1).fill(0);
  let cashHeld = 0;
  fcff[0] = -inp.existingPreCapex;
  fcffBeforeTerminal[0] = -inp.existingPreCapex;
  fcfe[0] = -inp.existingPreCapex + inp.existingDebtOpening;
  for (let t = 0; t < E; t++) {
    const base = (inp.cfoAxis[t] ?? 0) + fullCapexAt(t);
    fcff[t + 1] = base;
    fcffBeforeTerminal[t + 1] = base;
    // FCFE = FCFF, plus net debt, less the finance cost, plus (at exit) the
    // levered terminal. NET DEBT is the TOTAL drawdown, capex plus IDC, less
    // principal repaid: the reference sums exactly those two rows into one
    // "Net Debt" line.
    //
    // NO IN-KIND CREDIT. 2026-08-18f, reverting an add-back that was built the
    // same day and never asked for. FCFF charges the full land including the
    // in-kind portion and FCFE inherits that charge, which is what the
    // reference does (its Returns R104 = the FCFF subtotal, and R105 / R106
    // are debt and finance cost only). FCFE is therefore the return on TOTAL
    // equity, cash plus in-kind; the reference measures the same thing.
    const retained = inp.trappedCashAxis[t] ?? 0;
    cashHeld += retained;
    cashRetained[t + 1] = -retained;
    fcfe[t + 1] = base
      - (inp.financeCostAxis[t] ?? 0)
      + (inp.debtDrawAxis[t] ?? 0) + (inp.idcDrawAxis[t] ?? 0)
      + (inp.principalAxis[t] ?? 0)
      - retained;
  }
  fcff[exit + 1] += tvEnterprise;
  // The balance goes with the project at the exit, alongside the terminal
  // EQUITY value. No double count: the terminal value capitalises income, it
  // does not include the bank account.
  cashRetained[exit + 1] += cashHeld;
  fcfe[exit + 1] += tvEquity + cashHeld;

  return { fcff, fcffBeforeTerminal, fcfe, cashRetained, stabilisedNOI, exitNOI, terminalEnterpriseValue: tvEnterprise, terminalEquityValue: tvEquity };
}
