/**
 * stage3Cos.ts (2026-09-27; on the visible tabs 2026-10-15), FORMULA-LINKED EXPORT,
 * STAGE 3b: escrow. (2026-10-28: selling costs are Capex's rows and are not echoed;
 * cost of sales and inventory are written by stage4Schedules; the schedule feeds,
 * copies of Revenue's rows, are gone.)
 *
 * Runs AFTER Capex and Revenue, since it reads both. In the live layout the first
 * three sit on Schedules (they read Capex, which comes after Revenue in the flow);
 * escrow reads only Revenue and stays there. Every figure is a row on a visible tab:
 *
 *   SELLING COSTS: each line's marketing and commission, the rate, the sale revenue
 *     it charges on and the cost, read from the plots' rows on Capex, and the
 *     year-on-year schedule, the same rows by year.
 *   COST OF SALES, per Sell line as `buildAssetCostOfSales` builds it: the line's
 *     capex (Capex's subtotal for the line, else its plots' rows) plus its
 *     capitalised interest is the base; the recognition share is each year's
 *     revenue recognised over the lifetime's; cost of sales is the base times the
 *     share; the vintage matrix is each year's base times the share (one formula per
 *     row); inventory rolls forward from its own previous column. A plot of a merged
 *     line with capex and no rows releases on the line's sales, so the line is the unit.
 *   THE FEEDS: the income statement, balance sheet and cash flow feeds per line; an
 *     operating line's receivable and cash are its rows on Revenue (revenue x its days
 *     over 365, and revenue less the rise in it), linked here.
 *   ESCROW: pre-sales cash held at the effective held % through the held-until year
 *     and released, all held so far, in the release year; both years clamped to the
 *     workbook's years by its own header row.
 *
 * WAITS FOR THE FINANCING: capitalised interest comes out of the circular solve.
 * Its row holds the platform's values, marked pending, until the financing layer
 * writes its formula into the same cells (`cosc:<line>:idc`).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { planReportLines } from '../../reports/lineRows';
import type { Asset } from '../../state/module1-types';

const REV = 'Revenue';

export const stage3Cos: LiveLayer = {
  name: 'stage 3b: selling costs, cost of sales, schedule feeds, escrow',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const has = (k: string): boolean => w.has(k);

    if (!w.reg.keys().some((k) => k.startsWith('cxc:')) || !w.reg.keys().some((k) => k.startsWith('rvc:'))) {
      return [{ sheet: REV, status: 'partial' as const, formulas: 0, note: 'Selling costs, Cost of Sales, the Schedules feeds and Escrow stay the platform\'s values: Capex or Revenue is not live for this model.' }];
    }

    // ── Writing helpers: one formula per row, period references column relative ──
    let here = REV;
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** Year t of a registered row (dt = -1: the column before), column relative. */
    const p = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | (() => string) = 'sum'): void => {
      if (!has(key)) return;
      const a = w.addr(key);
      here = a.sheet;
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: pc(t) }, f(t));
      const T = { sheet: a.sheet, row: a.row, col: TOTAL_COL };
      if (total === 'sum') w.fA(T, `SUM(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))})`);
      else if (total === 'last') w.fA(T, w.refA({ sheet: a.sheet, row: a.row, col: pc(N - 1) }, here));
      else if (typeof total === 'function') w.fA(T, total());
    };
    /** The sum of rows in one year: a SUM over a block where they are contiguous on one tab. */
    const sumKeys = (keys: string[], t: number): string => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      const addrs = ks.map((k) => w.addr(k));
      const sheet = addrs[0].sheet;
      const rs = addrs.map((a) => a.row).sort((x, y) => x - y);
      if (addrs.every((a) => a.sheet === sheet) && rs.length > 1 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1)) {
        for (const r of rs) w.refP({ sheet, row: r, col: pc(t) }, here);
        return `SUM(${sheet === here ? '' : `'${sheet}'!`}${colOf(pc(t))}$${rs[0]}:${colOf(pc(t))}$${rs[rs.length - 1]})`;
      }
      return ks.map((k) => p(k, t)).join('+');
    };
    const lineOfAsset = (id: string): RevenueLine | undefined => lines.find((l) => l.members.some((m) => m.id === id));

    // ── Escrow (Revenue) ─────────────────────────────────────────────────────
    const escLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
    // THE INPUTS ARE READ WHERE THEY ARE TYPED (2026-10-27): Revenue no longer echoes them, so the
    // project defaults and each line's overrides are Inputs cells; a blank override is "auto".
    if (escLines.length && has('escin|pct')) {
      here = REV;
      const pct = (): string => w.refA(w.addr('escin|pct'), REV);
      const dUntil = (): string => w.refA(w.addr('escin|until'), REV);
      const dRelease = (): string => w.refA(w.addr('escin|release'), REV);
      // The workbook's first and last years, from its own header row (the Timeline's).
      const Y = (t: number): string => w.refP({ sheet: REV, row: 3, col: pc(t) }, REV);
      const Y0 = (): string => w.refA({ sheet: REV, row: 3, col: pc(0) }, REV), YN = (): string => w.refA({ sheet: REV, row: 3, col: pc(N - 1) }, REV);
      const Bk = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      const Cc = (label: string): string => `esc||C. Cash Flow Impact (project totals)|${label}`;
      const heldKeys: string[] = [];
      const releases: Array<{ held: string; rel: () => string; line: string }> = [];
      for (const el of escLines) {
        const host = state.assets.find((a) => a.id === el.assetIds[0]) as Asset;
        const rl = lineOfAsset(host.id);
        if (!rl || !has(`rvc:${rl.key}:cashPre`)) continue;
        const name = revenueLineName(rl);
        const inKey = `esc|||${name}`;
        if (!has(inKey) || !has(Bk(`${name}: held`))) continue;
        const r = w.addr(inKey).row;
        const ov = (k: 'held' | 'until' | 'release'): string => (has(`escin|${name}|${k}`) ? w.refA(w.addr(`escin|${name}|${k}`), REV) : '""');
        const cell = (c: number): string => w.refA({ sheet: REV, row: r, col: c }, REV);
        const p0 = state.phases.find((x) => x.id === host.phaseId)!;
        const handover = (): string => w.ref(`tl:phase:${p0.id}:hy`);
        here = REV;
        // The terms in force: the line's override where typed, else the project default, else the handover rule.
        w.fA({ sheet: REV, row: r, col: TOTAL_COL }, `IF(AND(ISNUMBER(${ov('held')}),N(${ov('held')})>=0),${ov('held')},MAX(0,N(${pct()})))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL }, `IF(ISNUMBER(${ov('until')}),${ov('until')},IF(ISNUMBER(${dUntil()}),${dUntil()},${handover()}))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL + 1 }, `IF(ISNUMBER(${ov('release')}),${ov('release')},IF(ISNUMBER(${dRelease()}),${dRelease()},${handover()}+1))`);
        const eff = (): string => cell(TOTAL_COL), until = (): string => cell(OPEN_COL), relY = (): string => cell(OPEN_COL + 1);
        row(Bk(`${name}: held`), (t) => `IF(${Y(t)}<=MAX(${Y0()},MIN(${YN()},${until()})),MAX(0,${p(`rvc:${rl.key}:cashPre`, t)})*MAX(0,${eff()}),0)`);
        heldKeys.push(Bk(`${name}: held`));
        releases.push({ held: Bk(`${name}: held`), rel: relY, line: rl.key });
        w.claim(`escc:${rl.key}:held`, REV, w.addr(Bk(`${name}: held`)).row, 1);
        w.claim(`escc:${rl.key}:in`, REV, r, 1);
        // The release year in force, by its own key: the phase cash flows read it (never a column offset).
        w.claim(`escc:${rl.key}:release`, REV, r, OPEN_COL + 1);
      }
      row(Bk('Total Additions'), (t) => sumKeys(heldKeys, t));
      // A line releases everything it has held so far, in its release year (clamped to the workbook's years):
      // one row per line (the phase cash flows link it), and the total is their SUM.
      const relKeys: string[] = [];
      for (const x of releases) {
        const k = x.held.replace(/: held$/, ': released');
        if (!has(k)) continue;
        const hr = w.addr(x.held).row;
        row(k, (t) => { w.refP({ sheet: REV, row: hr, col: pc(t) }, REV); return `(${Y(t)}=MAX(${Y0()},MIN(${YN()},${x.rel()})))*SUM($${colOf(pc(0))}$${hr}:${colOf(pc(t))}$${hr})`; });
        relKeys.push(k);
        w.claim(`escc:${x.line}:released`, REV, w.addr(k).row, 1);
      }
      row(Bk('Less: Release of Locked Funds'), (t) => `-(${sumKeys(relKeys, t)})`);
      row(Bk('Closing Balance'), (t) => `MAX(0,${p(Bk('Closing Balance'), t, -1)}+${p(Bk('Total Additions'), t)}+${p(Bk('Less: Release of Locked Funds'), t)})`, 'last');
      row(Bk('Opening Balance'), (t) => p(Bk('Closing Balance'), t, -1), 'none');
      row(Cc('Less: cash locked in escrow'), (t) => `-${p(Bk('Total Additions'), t)}`);
      row(Cc('Add: cash released from escrow'), (t) => `-${p(Bk('Less: Release of Locked Funds'), t)}`);
      row(Cc('Net escrow cash flow'), (t) => `${p(Cc('Less: cash locked in escrow'), t)}+${p(Cc('Add: cash released from escrow'), t)}`);
    }

    return [{ sheet: REV, status: 'partial' as const, formulas: w.formulas.get(REV) ?? 0,
      note: 'Also live: escrow (pre-sales cash held at each line held % through its held-until year and released in its release year).' }];
  },
};
