/**
 * stage5Statements.ts (2026-09-27; on the visible tabs 2026-10-15), FORMULA-LINKED EXPORT,
 * STAGE 5: THE STATEMENTS.
 *
 * Runs after the financing loop (stage 6), which it reads, and every layer before it.
 * Every row is one formula copied across the years (column-relative references), reading
 * the visible tabs; there is no working sheet.
 *
 * THE P&L, project and per phase, as `buildPLRows` builds it with every row a total reads
 * (zeros included): revenue per line and by section from Revenue (a Sell line earns its
 * recognition: pre-sales at handover plus sales after it; a hotel by department; a lease its
 * rent); cost of sales from Schedules; operating expenses per line, by hotel expense group
 * and HQ from Opex; selling and marketing expensed from Capex; EBITDA; depreciation from
 * Schedules; EBIT; interest, the fund fees and tax from the financing loop (its tax is on
 * the loop's own profit before tax, which Checks proves equals this one); the gain on
 * disposal as the exit proceeds less what Schedules writes off; profit after tax. A label
 * that carries a figure (a fee's rate and base, the tax rate) is a formula too.
 *
 * THE CASH FLOW, direct (project and per phase) and indirect: revenue received, the
 * operating receivables, opex paid through the payables, escrow, tax paid, capex per line
 * and land in kind from Capex, the financing flows from the loop, net, opening and closing
 * cash.
 *
 * THE BALANCE SHEET and its roll-forwards: land and depreciable NBV from Schedules, cash
 * from the Cash Flow, the receivables, inventory, escrow, payables and unearned revenue from
 * the tabs that make them, debt from the loop, and the equity, statutory reserve and
 * retained earnings roll-forwards beneath it, which close on its equity rows. The
 * reconciliation bridge reads each balance through the rule its row uses.
 *
 * Each group's rows are regenerated in the builder's own order and matched to the rows the
 * build emitted BY LABEL. A label that does not match refuses the layer rather than write a
 * formula on the wrong row.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';

import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';

import { computeFinancialsSnapshot } from '../../financials-resolvers';

import { plPlan } from './plPlan';
import { cfPlan } from './cfPlan';
import { bsPlan, E1, SR, E2 } from './bsPlan';




const PL = 'P&L';
const CF = 'Cash Flow';
const BS = 'Balance Sheet';
const ALL = '__all__';

type F = (t: number) => string;

export const stage5Statements: LiveLayer = {
  name: 'stage 5: statements',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL, LBL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);

    // ── Preconditions ────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (!has('schv:__project__:dep')) refuse.push('the Schedules fixed asset tables are not live');
    if (!w.reg.keys().some((k) => k.startsWith('oxo:'))) refuse.push('Opex is not live');
    if (!w.reg.keys().some((k) => k.startsWith('rvc:'))) refuse.push('Revenue is not live');
    if (!has('fnc:tax') || !has('fnc:main:intexp')) refuse.push('the financing loop is not live');
    if (!has('project:taxRate')) refuse.push('the tax rate is not on the Inputs sheet');
    if (!has('fl:taxPay')) refuse.push('the tax payable is not on the Financing sheet');
    if (refuse.length) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refuse.join('; ')}.` }];

    // ── References: column relative, so a row is one formula copied across ───
    // `here` is the tab being written (its own references drop the sheet name).
    let here = PL;
    const R = (key: string, t: number): string => {
      const a = w.addr(key);
      return w.refP({ sheet: a.sheet, row: a.row, col: (LiveWriter.isWorking(a.sheet) ? 4 : pc(0)) + t }, here);
    };
    const keyF = (k: string): F => (has(k) ? (t) => R(k, t) : () => '0');

    const expensedKeys = w.reg.keys().filter((k) => k.startsWith('cxe:') && k.split(':').length === 3);
    // A phase charges only the marketing its own plots spent (2026-10-25, m4Reports phaseSellingExpense):
    // the `cxe:<asset>:<line>` rows of the assets in that phase; the project view takes them all.
    const phaseOfAsset = new Map(state.assets.map((a) => [a.id, a.phaseId] as const));

    // ── THE P&L, ROW BY ROW FROM `plPlan` (2026-10-29) ────────────────────────
    // Each line links its source once (a cost is one minus sign), and every subtotal is a SUM of
    // the rows above it. The zakat label carries the rate on Inputs; column B carries each fee's
    // rate (and the zakat rate) as a number linked to Inputs.
    const q = (s: string): string => s.replace(/"/g, '""');
    const labelWrites: Array<{ sheet: string; key: string; formula: string }> = [];
    const writes: Array<[string, string, F, 'sum' | 'first' | 'last' | 'maxabs']> = [];
    let refused = '';
    /** A subtotal: SUM over a block of rows, or SUM of the rows named. */
    const sumOfF = (keys: string[]): F => (t) => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      const rows = ks.map((k) => w.addr(k).row);
      const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
      return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : `SUM(${ks.map((k) => R(k, t)).join(',')})`;
    };
    /** A cost: its source rows, negated once. */
    const costOf = (keys: string[]): F => (t) => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      return ks.length === 1 ? `-${R(ks[0], t)}` : `-(${ks.map((k) => R(k, t)).join('+')})`;
    };
    const rateWrites: Array<{ key: string; rateKey: string }> = [];
    for (const row of plPlan(state, snap)) {
      if (row.kind !== 'row') continue;
      if (!has(row.key)) { refused = `the row "${row.label}" is not on the P&L`; break; }
      let f: F | undefined;
      if (row.sum) f = sumOfF(row.sum);
      else if (row.src) {
        const s = row.src;
        switch (s.kind) {
          case 'rev': f = keyF(`rvc:${s.line}:recognised`); break;
          case 'cos': f = costOf([`cosc:${s.line}:cos`]); break;
          case 'opex': f = costOf(s.assetIds.map((id) => `oxo:${id}:total`)); break;
          case 'hq': f = costOf(['oxo:hq:total']); break;
          case 'mkt': f = costOf(s.phaseId === ALL && has('cx1e:total') ? ['cx1e:total'] : expensedKeys.filter((k) => s.phaseId === ALL || phaseOfAsset.get(k.split(':')[1]) === s.phaseId)); break;
          case 'fee': f = costOf([`fnc:fee:${s.index}`]); break;
          case 'dep': f = keyF('schv:__project__:dep'); break;
          case 'int': f = keyF('fnc:main:intexp'); break;
          case 'gain': f = keyF('fl:gain'); break;
          case 'tax': f = costOf(['fnc:tax']); break;
          case 'link': f = keyF(s.key); break;
          case 'diff': f = (t) => `${R(s.a, t)}-${R(s.b, t)}`; break;
        }
      }
      if (!f) { refused = `no rule for the P&L row "${row.label}"`; break; }
      writes.push([PL, row.key, f, 'sum']);
      if (row.rateKey) {
        if (!has(row.rateKey)) { refused = `the rate of "${row.label}" is not on Inputs`; break; }
        rateWrites.push({ key: row.key, rateKey: row.rateKey });
      }
      if (row.labelRate && row.rateKey) labelWrites.push({ sheet: PL, key: row.key, formula: `"${q(row.label)}, "&TEXT(N(${w.ref(row.rateKey)}),"0.0%")&" ${q(row.labelRate)}"` });
    }
    if (refused) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refused}.` }];
    const plWrites = writes.splice(0);
    const out: Array<{ sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number }> = [];

    // ── THE CASH FLOW, direct (project and per phase) and indirect ───────────
    let cfRefused = '';
    // ── THE CASH FLOW, ROW BY ROW FROM `cfPlan` (2026-10-29): a statement that only links ──
    // Each line links one row of the tab that works it out (a cost is one minus sign; opex paid is the
    // opex less the rise in its payable, the one working kept here); every subtotal is a SUM of the
    // rows above it; a year-before reference reads the prior column as it stands (no N()).
    {
      const sumOfF = (keys: string[]): F => (t) => {
        const ks = keys.filter(has);
        if (!ks.length) return '0';
        const rows = ks.map((k) => w.addr(k).row);
        const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
        return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : `SUM(${ks.map((k) => R(k, t)).join(',')})`;
      };
      /** A cell the year before, as it stands (the opening column holds the balance before the first year). */
      const prev = (key: string, t: number): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) - 1 }, here); };
      const costOf = (keys: string[]): F => (t) => {
        const ks = keys.filter(has);
        if (!ks.length) return '0';
        return ks.length === 1 ? `-${R(ks[0], t)}` : `-(${ks.map((k) => R(k, t)).join('+')})`;
      };
      const mktKeys = (phaseId: string | null): string[] => (phaseId === null && has('cx1e:total') ? ['cx1e:total']
        : expensedKeys.filter((k) => phaseId === null || phaseOfAsset.get(k.split(':')[1]) === phaseId));
      here = CF;
      for (const row of cfPlan(state, snap)) {
        if (row.kind !== 'row') continue;
        if (!has(row.key)) { cfRefused = `the row "${row.label}" is not on the Cash Flow`; break; }
        let f: F | undefined;
        if (row.sum) f = sumOfF(row.sum);
        else if (row.src) {
          const s = row.src;
          switch (s.kind) {
            case 'link': if (!has(s.key)) { cfRefused = `"${row.label}" has nothing to link (${s.key})`; break; } f = keyF(s.key); break;
            case 'add': f = (t) => s.keys.filter(has).map((k) => R(k, t)).join('+') || '0'; break;
            case 'cost': if (!s.keys.every(has)) { cfRefused = `"${row.label}" has nothing to link (${s.keys.join(', ')})`; break; } f = costOf(s.keys); break;
            case 'mkt': f = costOf(mktKeys(s.phaseId)); break;
            case 'cash': { if (!has(s.key)) { cfRefused = `"${row.label}" has nothing to link (${s.key})`; break; } const ls = s.less.filter(has); f = (t) => (ls.length ? `-(${R(s.key, t)}-${ls.map((k) => R(k, t)).join('-')})` : `-${R(s.key, t)}`); break; }
            case 'paid': f = costOf(s.keys); break;
            case 'rise': f = (t) => `${s.sign < 0 ? '-' : ''}(${R(s.key, t)}-${prev(s.key, t)})`; break;
            case 'prev': f = (t) => prev(s.key, t); break;
            case 'diff': f = (t) => `${R(s.a, t)}-${R(s.b, t)}`; break;
          }
        }
        if (cfRefused) break;
        if (!f) { cfRefused = `no rule for the Cash Flow row "${row.label}"`; break; }
        writes.push([CF, row.key, f, row.total ?? 'sum']);
      }
    }
    const cfWrites = cfRefused ? [] : writes.splice(0);
    if (cfRefused) writes.length = 0;

    // ── THE BALANCE SHEET, ROW BY ROW FROM `bsPlan` (2026-11-03): a statement that only links ──
    // Each balance links one row of the tab that works it out, every total is a SUM of the rows
    // above it, and the three equity roll-forwards beneath carry the platform's rules: the reserve
    // transfer (capped at the cap x share capital before this year's return), the dividend (the
    // distribution up to the retained earnings available) and the return of capital (the rest).
    let bsRefused = cfRefused ? 'the Cash Flow is not live' : '';
    if (!bsRefused && !['project:reserveRate', 'project:reserveCap', 'project:shareCapital', 'fl:div'].every(has)) bsRefused = 'the share capital, statutory reserve inputs or the dividends are not on the workbook';
    {
      here = BS;
      const prevCell = (key: string, t: number): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) - 1 }, here); };
      const sumOfF = (keys: string[]): F => (t) => {
        const ks = keys.filter(has);
        if (!ks.length) return '0';
        const rows = ks.map((k) => w.addr(k).row);
        const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
        return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : `SUM(${ks.map((k) => R(k, t)).join(',')})`;
      };
      const rate = `MAX(0,${w.ref('project:reserveRate')})`, cap = `MAX(0,${w.ref('project:reserveCap')})`;
      // Share capital before this year's return: the opening plus the equity drawn this year.
      const shareBefore = (t: number): string => `${R(E1('Opening'), t)}+${R(E1('Cash equity'), t)}+${R(E1('In-kind equity'), t)}`;
      const pat = (t: number): string => R(E2('PAT'), t);
      for (const row of bsPlan(state, snap)) {
        if (bsRefused) break;
        if (row.kind !== 'row') continue;
        if (!has(row.key)) { bsRefused = `the row "${row.label}" is not on the Balance Sheet`; break; }
        let f: F | undefined;
        if (row.sum) f = sumOfF(row.sum);
        else if (row.src) {
          const sr = row.src;
          switch (sr.kind) {
            case 'link':
              if (has(sr.key)) f = keyF(sr.key);
              else if ((row.values ?? []).every((v) => Math.abs(v) < 0.005)) f = () => '0';
              else bsRefused = `"${row.label}" has nothing to link (${sr.key})`;
              break;
            case 'neg': f = (t) => `-${R(sr.key, t)}`; break;
            case 'prev': f = (t) => prevCell(sr.key, t); break;
            case 'diff': f = (t) => `${R(sr.a, t)}-${R(sr.b, t)}`; break;
            case 'transfer': f = (t) => {
              const transfer = `MAX(0,${pat(t)})*${rate}`;
              return `IF(${cap}>0,MAX(0,MIN(${transfer},MAX(0,${shareBefore(t)})*${cap}-${R(SR('Opening'), t)})),${transfer})`;
            }; break;
            case 'roc': f = (t) => {
              const dist = `(-${R('fl:div', t)})`;
              const avail = `MAX(0,${R(E2('Opening'), t)}+${pat(t)}+${R(E2('Transfer'), t)})`;
              return `-MAX(0,MIN(${dist}-MIN(${dist},${avail}),MAX(0,${shareBefore(t)})))`;
            }; break;
            case 'div': f = (t) => `${R('fl:div', t)}-${R(E1('Return of capital'), t)}`; break;
          }
        }
        if (bsRefused) break;
        if (!f) { bsRefused = `no rule for the Balance Sheet row "${row.label}"`; break; }
        writes.push([BS, row.key, f, row.total ?? 'last']);
      }
    }
    const bsWrites = bsRefused ? [] : writes.splice(0);
    if (bsRefused) writes.length = 0;

    // ── Write ────────────────────────────────────────────────────────────────
    const apply = (list: Array<[string, string, F, string]>): void => {
      for (const [sheet, key, f, tot] of list) {
        here = sheet;
        const r = w.addr(key).row;
        for (let t = 0; t < N; t++) w.fA({ sheet, row: r, col: pc(t) }, f(t));
        const rng = w.rangeA(sheet, r, pc(0), pc(N - 1));
        const T = { sheet, row: r, col: TOTAL_COL };
        if (tot === 'first') w.fA(T, w.refA({ sheet, row: r, col: pc(0) }, sheet));
        else if (tot === 'last') w.fA(T, w.refA({ sheet, row: r, col: pc(N - 1) }, sheet));
        else if (tot === 'maxabs') w.fA(T, `MAX(ABS(MAX(${rng})),ABS(MIN(${rng})))`);
        // The opening column inside the sum (a blank or text there reads as nothing, as N did).
        else if (tot === 'sum') w.fA(T, `SUM(${w.rangeA(sheet, r, OPEN_COL, pc(N - 1))})`);
      }
    };
    apply(plWrites);
    for (const x of rateWrites) w.fA({ sheet: PL, row: w.addr(x.key).row, col: PERIOD_COLS.META_B }, `N(${w.ref(x.rateKey)})`);
    // The labels that carry a figure.
    for (const l of labelWrites) {
      const at = { sheet: l.sheet, row: w.addr(l.key).row, col: LBL_COL };
      w.fA(at, l.formula);
    }
    out.push({ sheet: PL, status: 'live', formulas: w.formulas.get(PL) ?? 0,
      note: 'Live: the income statement, project and per phase, every row one formula across the years over Revenue, Schedules, Opex, Capex and the financing loop, down to profit after tax; the fee and tax labels are formulas too.' });
    if (cfRefused) out.push({ sheet: CF, status: 'values' as const, formulas: 0, note: `The Cash Flow could not be made live for this model: ${cfRefused}.` });
    else {
      apply(cfWrites);
      out.push({ sheet: CF, status: 'live', formulas: w.formulas.get(CF) ?? 0,
        note: 'Live: the direct cash flow (revenue received, the operating receivables, opex paid through the payables, escrow, tax paid, capex per line and land in kind, the financing flows from the loop), the indirect cash flow from profit after tax, and net, opening and closing cash.' });
    }
    if (bsRefused) out.push({ sheet: BS, status: 'values' as const, formulas: 0, note: `The Balance Sheet could not be made live for this model: ${bsRefused}.` });
    else {
      apply(bsWrites);
      // The share capital before the first year: the amount typed on Inputs.
      w.fA({ sheet: BS, row: w.addr(E1('Closing')).row, col: OPEN_COL }, `MAX(0,${w.ref('project:shareCapital')})`);
      out.push({ sheet: BS, status: 'live', formulas: w.formulas.get(BS) ?? 0,
        note: 'Live: every balance links one row of Schedules, Revenue, Opex, Financing or the Cash Flow; the totals sum the rows above them; the share capital, statutory reserve and retained earnings roll-forwards carry the platform\'s rules for the reserve, the dividends and the return of capital; the balance check reads zero.' });
    }
    return out;
  },
};

