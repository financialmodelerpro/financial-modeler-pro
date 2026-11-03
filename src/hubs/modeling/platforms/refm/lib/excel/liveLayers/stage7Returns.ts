/**
 * stage7Returns.ts (2026-09-27, rebuilt 2026-11-03), FORMULA-LINKED EXPORT, STAGE 7: THE RETURNS.
 *
 * Writes every formula of the live Returns tab from `returnsPlan` (the same rows the builder
 * printed): the three streams over the Cash Flow, Financing and the Balance Sheet, each following
 * the exit year on Inputs; one IRR, MOIC and NPV per stream; the partners, the fee split, sources
 * and uses, development economics, the exit, the sensitivity grid, the real estate metrics and the
 * exit-year analysis. A rule that cannot find a row it reads refuses the tab (it stays the
 * platform's values) rather than write a formula on the wrong row.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { loopAt } from './stage6Loop';
import { LiveWriter } from './writer';
import { terminalValueFormula } from './terminal';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot } from '../../returns-resolvers';
import { returnsPlan, type REnv } from './returnsPlan';

const RET = 'Returns';
const TL = 'Timeline';

export const stage7Returns: LiveLayer = {
  name: 'stage 7: the returns',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const values = (note: string) => [{ sheet: RET, status: 'values' as const, formulas: 0, note }];
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    if (!has('fnc:main:interest')) return values('The Returns sheet stays the platform\'s values: the financing solve is not live for this model.');
    if (!has('tl:flag:exit')) return values('The Returns sheet stays the platform\'s values: the Timeline shows no exit year.');
    const snap = computeFinancialsSnapshot(state);
    let rs: ReturnType<typeof computeReturnsSnapshot>;
    try { rs = computeReturnsSnapshot(snap, state.project); } catch { return values('The Returns sheet stays the platform\'s values: the returns engine could not compute on this model.'); }
    const N = snap.axisLength;
    const { OPEN_COL, TOTAL_COL } = PERIOD_COLS;
    const plan = returnsPlan(state, snap, rs, { includeSensitivity: ctx.opts.includeSensitivity === true });
    if (plan.refused.length) return values(`The Returns sheet stays the platform's values: ${plan.refused.join('; ')}.`);

    // ── The environment the rules write with ─────────────────────────────────
    const C = (r: number, c: number) => ({ sheet: RET, row: r, col: c });
    const rowOf = (key: string): number => { const a = w.addr(key); if (a.sheet !== RET) throw new Error(`${key} is not on Returns`); return a.row; };
    const sc = (s: number): number => OPEN_COL + s;
    const exitRow = (): number => w.addr('tl:flag:exit').row;
    const E: REnv = {
      has,
      s: (key, s) => w.refP(C(rowOf(key), sc(s)), RET),
      sA: (key, s) => w.refA(C(rowOf(key), sc(s)), RET),
      d: (key) => w.refA(C(rowOf(key), TOTAL_COL), RET),
      cell: (key, col) => w.refA(w.addr(`${key}|${col}`), RET),
      rng: (key, last = N) => w.rangeA(RET, rowOf(key), sc(0), sc(last)),
      rngFrom: (key, s0) => w.rangeA(RET, rowOf(key), sc(s0), sc(N)),
      rngY: (key) => w.rangeA(RET, rowOf(key), sc(1), sc(N)),
      x: (key, s) => w.perP(key, s - 1),
      xA: (key, s) => w.per(key, s - 1),
      xr: (key) => w.perRange(key, N),
      xo: (key) => w.one(key),
      loop: (key, s) => loopAt(w, key, s - 1),
      ref: (key) => w.ref(key),
      yr: (s) => w.refP({ sheet: TL, row: 3, col: sc(s) }, RET),
      yrA: (s) => w.refA({ sheet: TL, row: 3, col: sc(s) }, RET),
      yrRng: () => w.rangeA(TL, 3, sc(1), sc(N)),
      yrRngTo: (s) => w.rangeA(TL, 3, sc(0), sc(s)),
      ex: (s) => w.refP({ sheet: TL, row: exitRow(), col: sc(s) }, RET),
      exRng: () => w.rangeA(TL, exitRow(), sc(1), sc(N)),
      keys: () => w.reg.keys(),
      prevRange: (key) => { const a = w.addr(key); const c0 = (LiveWriter.isWorking(a.sheet) ? 4 : 6) - 1; return w.rangeA(a.sheet, a.row, c0, c0 + N - 1); },
      tvOf: (income) => terminalValueFormula(w, rs.config, income, true),
    };

    // ── Two passes: a dry run finds any rule that cannot find its rows (the tab then stays the
    // platform's values), then each formula is built and written at once, so the writer records
    // the cells that formula reads.
    const failed: string[] = [];
    const each = (write: boolean): void => {
      const put = (what: string, at: { sheet: string; row: number; col: number } | null, fn: () => string): void => {
        try {
          w.reset();
          const where = at ?? null;
          const f = fn();
          if (write && where) w.fA(where, f);
        } catch (e) { if (!write) failed.push(`${what}: ${(e as Error).message.slice(0, 120)}`); }
      };
      for (const row of plan.rows) {
        if (row.kind === 'p' && row.fs) {
          let r = -1;
          try { r = rowOf(row.key); } catch (e) { if (!write) failed.push(`${row.key}: ${(e as Error).message}`); continue; }
          for (let s = row.from ?? 1; s <= N; s++) put(`${row.label} (${s})`, C(r, sc(s)), () => row.fs!(E, s));
          const tot = row.total ?? 'sum';
          if (tot === 'sum') put(row.label, C(r, TOTAL_COL), () => `SUM(${w.rangeA(RET, r, sc(row.from ?? 1), sc(N))})`);
          else if (tot === 'last') put(row.label, C(r, TOTAL_COL), () => w.refA(C(r, sc(N)), RET));
        }
        for (const c of row.cells ?? []) {
          if (!c.f) continue;
          let at: { sheet: string; row: number; col: number } | null = null;
          try { at = w.addr(`${row.key}|${c.col}`); } catch (e) { if (!write) failed.push(`${row.key}|${c.col}: ${(e as Error).message}`); continue; }
          put(`${row.label || row.key} (column ${c.col})`, at, () => c.f!(E));
        }
      }
      w.reset();
    };
    each(false);
    if (failed.length) return values(`The Returns sheet stays the platform's values: ${failed.slice(0, 4).join('; ')}${failed.length > 4 ? ` and ${failed.length - 4} more` : ''}.`);
    each(true);
    return [{
      sheet: RET, status: 'live' as const, formulas: w.formulas.get(RET) ?? 0,
      note: 'Live: the FCFF, FCFE and distribution streams over the Cash Flow, Financing and the Balance Sheet, each following the exit year on Inputs; one IRR, MOIC and NPV per stream (NPV on the discount rate on Inputs); the partners, the fee split from the shares on Inputs, sources and uses, development economics, the exit, the sensitivity grid, the real estate metrics and the exit-year analysis.',
    }];
  },
};
