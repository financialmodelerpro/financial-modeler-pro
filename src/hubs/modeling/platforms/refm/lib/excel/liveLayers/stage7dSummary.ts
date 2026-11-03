/**
 * stage7dSummary.ts (2026-09-28, rebuilt 2026-11-03), FORMULA-LINKED EXPORT: THE SUMMARY.
 *
 * Writes every formula of the live Summary from `summaryPlan` (the platform's Project Overview,
 * the rows the builder printed): each figure a number that links the tab working it out (Returns,
 * Land & Area, the P&L, Capex, Financing, the Balance Sheet, Timeline). A rule that cannot find a
 * row it reads leaves the tab the platform's values.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot } from '../../returns-resolvers';
import { summaryPlan, type SEnv } from './summaryPlan';

const SUM = 'Summary';
const TL = 'Timeline';

export const stage7dSummary: LiveLayer = {
  name: 'stage 7d: the summary',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const w = new LiveWriter(wb, reg, ctx.pending);
    const values = (note: string) => [{ sheet: SUM, status: 'values' as const, formulas: 0, note }];
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    let rs: ReturnType<typeof computeReturnsSnapshot>;
    try { rs = computeReturnsSnapshot(snap, state.project); } catch { return values('The Summary stays the platform\'s values: the returns engine could not compute on this model.'); }
    if (!w.has('ret|h|fcff|4')) return values('The Summary stays the platform\'s values: the Returns tab is not live for this model.');
    const yearCol = (t: number): number => 6 + t;
    const E: SEnv = {
      has: (k) => w.has(k),
      ref: (k) => w.ref(k),
      tot: (k) => w.one(k),
      cell: (k, col) => w.refA(w.addr(`${k}|${col}`), SUM),
      per: (k, t) => w.per(k, t),
      rngY: (k) => w.perRange(k, N),
      yr: (t) => w.refA({ sheet: TL, row: 3, col: yearCol(t) }, SUM),
      yrRng: () => w.rangeA(TL, 3, yearCol(0), yearCol(N - 1)),
    };
    const rows = summaryPlan(state, snap, rs);
    const failed: string[] = [];
    const each = (write: boolean): void => {
      for (const row of rows) for (const c of row.cells ?? []) {
        if (!c.f) continue;
        try {
          w.reset();
          const at = w.addr(`${row.key}|${c.col}`);
          const f = c.f(E);
          if (write) w.fA(at, f);
        } catch (e) { if (!write) failed.push(`${row.label || row.key}: ${(e as Error).message.slice(0, 100)}`); }
      }
      w.reset();
    };
    each(false);
    if (failed.length) return values(`The Summary stays the platform's values: ${failed.slice(0, 4).join('; ')}${failed.length > 4 ? ` and ${failed.length - 4} more` : ''}.`);
    each(true);
    return [{
      sheet: SUM, status: 'live' as const, formulas: w.formulas.get(SUM) ?? 0,
      note: 'Live: every figure links the tab that works it out (Returns, Land & Area, the P&L, Capex, Financing, the Balance Sheet, Timeline), as a number under the units line.',
    }];
  },
};
