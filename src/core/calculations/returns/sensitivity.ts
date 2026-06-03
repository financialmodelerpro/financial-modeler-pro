/**
 * M5 Returns engine, Pass 2: two-way sensitivity grid.
 *
 * Re-computes Equity IRR (FCFE) across combinations of two variables, reusing
 * the shared sponsor-stream builder. Pure. Variables:
 *   exit_cap_rate        EXACT: terminal EV = stabilised NOI / cap rate.
 *   discount_rate        EXACT for perpetuity terminal (IRR is otherwise
 *                        discount-invariant); affects the perpetuity EV only.
 *   sales_price_pct      APPROXIMATE: scales operating cash + terminal NOI by
 *                        (1 + shock). A proportional cash-flow shock, not a
 *                        full re-forecast (opex does not rescale separately).
 *   adr_pct              APPROXIMATE: same lever as sales_price_pct (income).
 *   construction_cost_pct APPROXIMATE: scales capex (CFI) by (1 + shock).
 *
 * The base (unshocked) cell reproduces the headline Equity IRR exactly when an
 * axis carries its neutral value (0 for the % shocks; the base discount rate;
 * the method-implied cap rate for exit_cap_rate).
 */
import { irr, moic } from './irr';
import { buildSponsorStreamsForExit, type SponsorStreamInputs, type TerminalConfig } from './streamBuild';

export type SensitivityVariable =
  | 'exit_cap_rate'
  | 'discount_rate'
  | 'sales_price_pct'
  | 'adr_pct'
  | 'construction_cost_pct';

export interface SensitivityAxis {
  variable: SensitivityVariable;
  values: number[];
}

export interface SensitivityGrid {
  xVariable: SensitivityVariable;
  yVariable: SensitivityVariable;
  xValues: number[];
  yValues: number[];
  /** [yIndex][xIndex] = Equity IRR (decimal) or null. */
  irr: (number | null)[][];
  /** [yIndex][xIndex] = Equity MOIC. */
  moic: number[][];
  /** Unshocked Equity IRR (== the headline FCFE IRR). */
  baseEquityIrr: number | null;
  /** Cap rate implied by the base terminal value (the cap-rate axis neutral). */
  impliedExitCapRate: number | null;
}

function applyVar(
  inputs: SponsorStreamInputs,
  terminal: TerminalConfig,
  variable: SensitivityVariable,
  value: number,
): { inputs: SponsorStreamInputs; terminal: TerminalConfig } {
  switch (variable) {
    case 'exit_cap_rate':
      return { inputs, terminal: { ...terminal, capRateOverride: value } };
    case 'discount_rate':
      return { inputs, terminal: { ...terminal, discountRate: value } };
    case 'sales_price_pct':
    case 'adr_pct': {
      const f = 1 + value;
      return {
        inputs: { ...inputs, cfoAxis: inputs.cfoAxis.map((v) => v * f), noiPerPeriod: inputs.noiPerPeriod.map((v) => v * f) },
        terminal,
      };
    }
    case 'construction_cost_pct': {
      const f = 1 + value;
      return { inputs: { ...inputs, cfiAxis: inputs.cfiAxis.map((v) => v * f) }, terminal };
    }
    default:
      return { inputs, terminal };
  }
}

export function computeSensitivity(args: {
  inputs: SponsorStreamInputs;
  terminal: TerminalConfig;
  exitIdx: number;
  x: SensitivityAxis;
  y: SensitivityAxis;
}): SensitivityGrid {
  const { inputs, terminal, exitIdx, x, y } = args;
  const base = buildSponsorStreamsForExit(inputs, exitIdx, terminal);
  const baseEquityIrr = irr(base.fcfe);
  const impliedExitCapRate = base.terminalEnterpriseValue > 0 && base.stabilisedNOI > 0
    ? base.stabilisedNOI / base.terminalEnterpriseValue
    : null;

  const irrGrid: (number | null)[][] = [];
  const moicGrid: number[][] = [];
  for (const yv of y.values) {
    const afterY = applyVar(inputs, terminal, y.variable, yv);
    const irrRow: (number | null)[] = [];
    const moicRow: number[] = [];
    for (const xv of x.values) {
      const cell = applyVar(afterY.inputs, afterY.terminal, x.variable, xv);
      const s = buildSponsorStreamsForExit(cell.inputs, exitIdx, cell.terminal);
      irrRow.push(irr(s.fcfe));
      moicRow.push(moic(s.fcfe));
    }
    irrGrid.push(irrRow);
    moicGrid.push(moicRow);
  }

  return {
    xVariable: x.variable,
    yVariable: y.variable,
    xValues: x.values,
    yValues: y.values,
    irr: irrGrid,
    moic: moicGrid,
    baseEquityIrr,
    impliedExitCapRate,
  };
}

/** Default value range for a sensitivity variable (used by the resolver + UI). */
export function defaultSensitivityValues(variable: SensitivityVariable, baseDiscountRate: number): number[] {
  switch (variable) {
    case 'exit_cap_rate': return [0.07, 0.075, 0.08, 0.085, 0.09, 0.095, 0.10];
    case 'discount_rate': {
      const b = baseDiscountRate;
      return [b - 0.04, b - 0.02, b, b + 0.02, b + 0.04].map((v) => Math.max(0, Number(v.toFixed(4))));
    }
    default: return [-0.10, -0.05, 0, 0.05, 0.10]; // sales_price / adr / construction
  }
}
