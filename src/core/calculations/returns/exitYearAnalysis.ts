/**
 * M5 Returns engine, Pass 2: multi-year exit analysis.
 *
 * Loops candidate exit years, rebuilds the sponsor streams for each via the
 * shared builder, and reports terminal value + Project IRR (FCFF) + Equity IRR
 * (FCFE) + Equity MOIC so the user can compare hold-vs-sell timing. Pure.
 */
import { irr, moic } from './irr';
import { buildSponsorStreamsForExit, type SponsorStreamInputs, type TerminalConfig } from './streamBuild';

export interface ExitYearRow {
  exitYearLabel: number;
  exitIdx: number;
  enterpriseValue: number;
  equityValue: number;
  fcffIrr: number | null;
  fcfeIrr: number | null;
  equityMoic: number;
  /** True for the user's currently selected exit year. */
  isSelected: boolean;
}

export function exitYearAnalysis(args: {
  inputs: SponsorStreamInputs;
  terminal: Omit<TerminalConfig, 'capRateOverride'>;
  candidateExitIdxs: number[];
  selectedExitIdx: number;
  axisYearLabels: number[];
}): ExitYearRow[] {
  const { inputs, terminal, candidateExitIdxs, selectedExitIdx, axisYearLabels } = args;
  const uniq = Array.from(new Set(candidateExitIdxs.filter((i) => i >= 0))).sort((a, b) => a - b);
  return uniq.map((e) => {
    const s = buildSponsorStreamsForExit(inputs, e, terminal);
    return {
      exitYearLabel: axisYearLabels[e] ?? e,
      exitIdx: e,
      enterpriseValue: s.terminalEnterpriseValue,
      equityValue: s.terminalEquityValue,
      fcffIrr: irr(s.fcff),
      fcfeIrr: irr(s.fcfe),
      equityMoic: moic(s.fcfe),
      isSelected: e === selectedExitIdx,
    };
  });
}
