/**
 * terminal.ts (2026-10-11), THE TERMINAL VALUE AS ONE EXCEL FORMULA.
 *
 * The engine's `terminalEnterpriseValue` (core/calculations/returns/terminalValue.ts)
 * has its formula twin here, ONE place, read by the financing solve (the exit
 * proceeds) and the exit-year analysis (each candidate exit). Two methods are
 * live, the two a held asset is valued on:
 *   cap rate       income / cap rate (0 when the rate is not positive)
 *   exit multiple  MAX(0, income) x MAX(0, multiple)
 * with the one growth step on top when the model capitalises forward income.
 * The perpetuity (Gordon) method values the year's free cash flow and stays
 * refused by name.
 *
 * No em dashes in this file.
 */
import type { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';

export const TV_KEYS = {
  capRate: 'ret|Exit Cap Rate (%)',
  multiple: 'ret|Exit Multiple (x stabilised NOI)',
  growth: 'ret|Growth g (%)',
};

interface TvConfig { terminalMethod: string; applyGrowthToTerminal?: boolean }

/** Why the terminal value cannot be written live, or null when it can. */
export function terminalRefusal(cfg: TvConfig, has: (k: string) => boolean): string | null {
  const m = cfg.terminalMethod;
  if (m === 'none') return null;
  if (m !== 'cap_rate' && m !== 'exit_multiple') return `a terminal value by ${m}`;
  if (m === 'cap_rate' && !has(TV_KEYS.capRate)) return 'the exit cap rate is not on the Returns sheet';
  if (m === 'exit_multiple' && !has(TV_KEYS.multiple)) return 'the exit multiple is not on the Returns sheet';
  if (cfg.applyGrowthToTerminal && !has(TV_KEYS.growth)) return 'income grown before capitalising, with no growth rate on the Returns sheet';
  return null;
}

/** The terminal enterprise value of `income` (an Excel expression), by the model's method. */
export function terminalValueFormula(w: LiveWriter, cfg: TvConfig, income: string): string {
  const inc = cfg.applyGrowthToTerminal ? `${income}*(1+${w.ref(TV_KEYS.growth, PERIOD_COLS.TOTAL_COL)})` : income;
  if (cfg.terminalMethod === 'exit_multiple') return `MAX(0,${inc})*MAX(0,${w.ref(TV_KEYS.multiple, PERIOD_COLS.TOTAL_COL)})`;
  const cap = w.ref(TV_KEYS.capRate, PERIOD_COLS.TOTAL_COL);
  return `IF(${cap}<=0.000000001,0,MAX(0,${inc}/${cap}))`;
}
