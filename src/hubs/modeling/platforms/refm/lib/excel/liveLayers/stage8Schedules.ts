/**
 * stage8Schedules.ts (2026-09-28): STAGE 8, THE P&L FUND FEE BASIS, LIVE.
 *
 * The financing-fed Schedules tables this file also wrote are gone (2026-11-03): the debt by
 * facility sits on the Balance Sheet itself (bsPlan), and the equity, statutory reserve and
 * retained earnings roll-forwards close there too (stage 5).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { loopAt } from './stage6Loop';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';


/**
 * STAGE 8: THE P&L FUND FEE BASIS BLOCK, LIVE. The capital bases are the
 * Inputs sheet's resolved fund size, capex equity and debt facility (which the
 * financing solve writes); a percentage fee's basis in a year is its capital
 * base wherever its schedule charges (the first year for a one-time fee, every
 * year to the exit for an annual one), exactly the rule the solve charges it
 * by (stage 6); the charge is the solve's own fee row, and the total their sum.
 */
export const stage8FundFees: LiveLayer = {
  name: 'stage 8: the fund fee basis',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const state = ctx.opts.state;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const PL = 'P&L';
    const keys = reg.keys().filter((k) => k.startsWith('plfee|'));
    if (!keys.length) return [];
    const fundTerms = resolveFundTerms(state.project);
    const refuse: string[] = [];
    if (!fundTerms.enabled) refuse.push('the fund layer is off');
    if (!has('fnc:fee:base')) refuse.push('the financing solve is not live for this model');
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { OPEN_COL, TOTAL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const cfg = resolveReturnsConfig(state.project, N);
    const X = cfg.exitYearOffset;
    const booked = snap.disposal.booked;
    const capKey = (label: string): string | undefined => reg.keys().find((k) => k.startsWith(`ftcap:${label}`));
    const baseLabel: Record<string, string> = { fund_size: 'Fund size', total_equity: 'Capex equity', debt_facility: 'Debt facility' };
    for (const k of keys) {
      const m = /^plfee\|(cap|basis|fee)\|(.+)$/.exec(k);
      if (m?.[1] === 'cap' && !capKey(m[2])) refuse.push(`the capital base "${m[2]}" is not on the Inputs sheet`);
      if (m && m[1] !== 'cap' && !has(`fnc:fee:${m[2]}`)) refuse.push(`fee ${m[2]} has no row in the solve`);
      if (m?.[1] === 'basis') { const spec = FUND_FEE_SPECS[Number(m[2])]; if (!spec || !baseLabel[spec.base] || !capKey(baseLabel[spec.base])) refuse.push(`fee ${m[2]}'s base is not on the Inputs sheet`); }
    }
    if (refuse.length) return [{ sheet: PL, status: 'partial' as const, formulas: 0, note: `The Fund Fee Basis block stays the platform's values: ${[...new Set(refuse)].join('; ')}.` }];

    const cap = (label: string): string => `N(${w.ref(capKey(label)!)})`;
    const fee = (i: number, t: number): string => `N(${loopAt(w, `fnc:fee:${i}`, t)})`;
    const rowOf = (k: string): number => w.addr(k).row;
    const rng = (r: number): string => w.rangeA(PL, r, pc(0), pc(N - 1));
    for (const k of keys) {
      const [, kind, id] = /^plfee\|(cap|basis|fee|total)\|?(.*)$/.exec(k)!;
      const r = rowOf(k);
      if (kind === 'cap') { w.fA({ sheet: PL, row: r, col: TOTAL_COL }, cap(id)); continue; }
      if (kind === 'basis') {
        const spec = FUND_FEE_SPECS[Number(id)];
        // In force through the exit year, a one-time fee in the first year only: the Timeline's years, one formula across.
        const TY = (t: number): string => w.refP({ sheet: 'Timeline', row: 3, col: pc(t) }, PL);
        const TYA = (t: number): string => w.refA({ sheet: 'Timeline', row: 3, col: pc(t) }, PL);
        const gate = (t: number): string => `${booked ? `(${TY(t)}<=${TYA(X)})*` : ''}${spec.timing === 'one_time' ? `(${TY(t)}=${TYA(0)})*` : ''}`;
        for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, `${gate(t)}${cap(baseLabel[spec.base])}`);
        // A base is a stock: the lead cell is the base, not a sum of its copies.
        w.fA({ sheet: PL, row: r, col: TOTAL_COL }, cap(baseLabel[spec.base]));
        continue;
      }
      if (kind === 'fee') {
        for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, fee(Number(id), t));
        w.fA({ sheet: PL, row: r, col: TOTAL_COL }, `SUM(${rng(r)})`);
        continue;
      }
      // The total: every fee charged, a year at a time.
      const feeRows = keys.filter((x) => x.startsWith('plfee|fee|')).map(rowOf);
      for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, feeRows.map((fr) => w.refP({ sheet: PL, row: fr, col: pc(t) })).join('+') || '0');
      w.fA({ sheet: PL, row: r, col: TOTAL_COL }, `SUM(${rng(r)})`);
    }
    // The block was the last part of the P&L that was values, so the sheet is live.
    return [{ sheet: PL, status: 'live' as const, formulas: w.formulas.get(PL) ?? 0, note: 'Also live: the Fund Fee Basis block (the capital bases from the Inputs sheet, each fee\'s basis on its own schedule, the fees the solve charges, and their total).' }];
  },
};
