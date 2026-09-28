/**
 * stage8Schedules.ts (2026-09-28)
 *
 * STAGE 8: THE SCHEDULES TABLES THE FINANCING FEEDS, LIVE. Stage 4 made the
 * roll-forwards the operating model owns live; these four read the financing
 * solve (stage 6), so they waited for it:
 *
 *   - the capitalised interest (IDC) pool: construction interest capitalised
 *     per asset, split into held fixed assets and Sell inventory, and the held
 *     pool rolled forward (opening, additions, depreciation, the write-off at
 *     the exit, closing), from the solve's own rows;
 *   - L3, debt outstanding by tranche: the balance sheet's debt (the live
 *     financing takes exactly one facility, so the tranche IS the total);
 *   - E1, equity: cash drawn (development and management fee) and land in kind
 *     from the Cash Flow, closing on the balance sheet's share capital;
 *   - E2, retained earnings: profit after tax from the P&L, the statutory
 *     reserve transfer and the dividends paid, closing on the balance sheet.
 *
 * Each table is a roll-forward whose closing row reads the statement it feeds,
 * so a table that stopped footing would show it in its own rows. A row this
 * layer has no rule for leaves its table the platform's values, and says so.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';

const SCH = 'Schedules';
type F = (t: number) => string;

export const stage8Schedules: LiveLayer = {
  name: 'stage 8: the financing-fed schedules',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const state = ctx.opts.state;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    if (!has('fnc:main:interest')) return [];
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { OPEN_COL, TOTAL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const labels = getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));

    // A visible statement row, a year at a time; a solve row on its working sheet.
    const vis = (key: string): F | null => (has(key) ? (t) => `N(${w.refA({ sheet: w.addr(key).sheet, row: w.addr(key).row, col: pc(t) })})` : null);
    const calc = (key: string): F | null => (has(key) ? (t) => `N(${w.refA({ sheet: w.addr(key).sheet, row: w.addr(key).row, col: 4 + t })})` : null);
    const sumF = (fs: F[]): F => (t) => (fs.length ? `(${fs.map((f) => f(t)).join('+')})` : '0');
    const neg = (f: F): F => (t) => `-(${f(t)})`;

    const done: string[] = [], kept: string[] = [];
    /**
     * One roll-forward table: the rules for each of its rows by label, the
     * opening chained to the closing of the year before. Every row the table
     * carries must have a rule, or the whole table stays the platform's values.
     */
    const table = (name: string, prefix: string, rules: Record<string, F | null | 'opening'>, closingLabel?: string): void => {
      const keys = reg.keys().filter((k) => k.startsWith(prefix));
      const label = (k: string): string => k.slice(prefix.length);
      const missing = keys.filter((k) => !(label(k) in rules) || rules[label(k)] === null);
      if (!keys.length || missing.length) { kept.push(`${name}${missing.length ? ` (no rule for ${missing.map(label).join(', ')})` : ''}`); return; }
      const closeKey = closingLabel ? `${prefix}${closingLabel}` : null;
      if (closeKey && !has(closeKey)) { kept.push(name); return; }
      for (const k of keys) {
        const rule = rules[label(k)]!;
        const r = w.addr(k).row;
        for (let t = 0; t < N; t++) {
          const f = rule === 'opening'
            ? (t === 0 ? `N(${w.refA({ sheet: SCH, row: r, col: OPEN_COL })})` : w.refA({ sheet: SCH, row: w.addr(closeKey!).row, col: pc(t - 1) }))
            : rule(t);
          w.fA({ sheet: SCH, row: r, col: pc(t) }, f);
        }
      }
      done.push(name);
    };

    // ── The capitalised interest pool ─────────────────────────────────────────
    {
      const idcKeys = reg.keys().filter((k) => /^fnc:main:idc:[^:]+$/.test(k));
      const sellIds = new Set(state.assets.filter((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a) => a.id));
      const idcOf = (pred: (id: string) => boolean): F[] => idcKeys.filter((k) => pred(k.split(':')[3])).map((k) => calc(k)!);
      const held = calc('fnc:main:idcadd'), dep = calc('fnc:main:idcdep'), disp = calc('fnc:main:idcdisp');
      const P = 'sch|__project__|idc|';
      const opening = `${P}Opening IDC NBV (held)`;
      const rolled: F | null = held && dep && disp ? (t) => `${w.refA({ sheet: SCH, row: w.addr(opening).row, col: pc(t) })}+${held(t)}-${dep(t)}-${disp(t)}` : null;
      table('the capitalised interest pool', P, {
        'Construction interest': idcKeys.length ? sumF(idcOf(() => true)) : null,
        'Capitalised to held fixed assets (Operate / Lease)': held,
        'Capitalised to Sell inventory (released through Cost of Sales, memo)': sumF(idcOf((id) => sellIds.has(id))),
        'Opening IDC NBV (held)': 'opening',
        '(+) IDC Additions (held)': held,
        '(−) IDC Depreciation': dep ? neg(dep) : null,
        '(−) Disposed at Exit (capitalised interest)': disp ? neg(disp) : null,
        'Closing IDC NBV (held)': rolled,
      }, 'Closing IDC NBV (held)');
    }

    // ── L3, debt outstanding by tranche ───────────────────────────────────────
    {
      const debt = vis('bs|__all__||Debt (long-term)');
      const tranches = state.financingTranches ?? [];
      const rules: Record<string, F | null> = { 'Total Debt Outstanding': debt };
      // The live financing takes one facility (stage 6 refuses more), so it is the total.
      if (tranches.length === 1) rules[tranches[0].name] = debt;
      table('debt outstanding by tranche', 'sch|L3||', rules);
    }

    // ── E1, the equity roll-forward ───────────────────────────────────────────
    {
      const cash = [vis('cf|direct||Equity Drawdown, development'), vis('cf|direct||Equity Drawdown, management fee')].filter((f): f is F => !!f);
      const kind = vis('cf|direct||In-Kind Equity (non-cash, matched by Land In-Kind above)');
      const share = vis('bs|__all__||Share Capital');
      table('the equity roll-forward', 'sch|E1||', {
        'Opening equity': 'opening',
        '(+) Cash equity drawdown': cash.length ? sumF(cash) : null,
        '(+) In-Kind equity (land in-kind, non-cash)': kind,
        'Closing equity (cumulative)': share,
      }, 'Closing equity (cumulative)');
    }

    // ── E2, the retained earnings roll-forward ────────────────────────────────
    {
      const pat = vis(`pl|__all__||${labels.pat}`);
      const transfer = has('stc:bs:transfer') ? calc('stc:bs:transfer') : null;
      table('the retained earnings roll-forward', 'sch|E2||', {
        'Opening retained earnings': 'opening',
        '(+) PAT for the period': pat,
        '(−) Transfer to statutory reserve': transfer ? neg(transfer) : null,
        '(−) Dividends declared': vis('cf|direct||Dividends paid'),
        'Closing retained earnings': vis('bs|__all__||Retained Earnings'),
      }, 'Closing retained earnings');
    }

    void TOTAL_COL;
    if (!done.length) return [];
    return [{
      sheet: SCH, status: 'partial' as const, formulas: w.formulas.get(SCH) ?? 0,
      note: `Also live: ${done.join(', ')}, from the financing solve, the Cash Flow and the balance sheet, each closing on the statement it feeds.${kept.length ? ` The platform's values: ${kept.join('; ')}.` : ''}`,
    }];
  },
};

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
    const fee = (i: number, t: number): string => `N(${w.refA({ sheet: 'Financing Calc', row: w.addr(`fnc:fee:${i}`).row, col: 4 + t })})`;
    const rowOf = (k: string): number => w.addr(k).row;
    const rng = (r: number): string => w.rangeA(PL, r, pc(0), pc(N - 1));
    for (const k of keys) {
      const [, kind, id] = /^plfee\|(cap|basis|fee|total)\|?(.*)$/.exec(k)!;
      const r = rowOf(k);
      if (kind === 'cap') { w.fA({ sheet: PL, row: r, col: TOTAL_COL }, cap(id)); continue; }
      if (kind === 'basis') {
        const spec = FUND_FEE_SPECS[Number(id)];
        const active = (t: number): boolean => !(booked && t > X) && (spec.timing !== 'one_time' || t === 0);
        for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, active(t) ? cap(baseLabel[spec.base]) : '0');
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
      for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, feeRows.map((fr) => w.refA({ sheet: PL, row: fr, col: pc(t) })).join('+') || '0');
      w.fA({ sheet: PL, row: r, col: TOTAL_COL }, `SUM(${rng(r)})`);
    }
    // The block was the last part of the P&L that was values, so the sheet is live.
    return [{ sheet: PL, status: 'live' as const, formulas: w.formulas.get(PL) ?? 0, note: 'Also live: the Fund Fee Basis block (the capital bases from the Inputs sheet, each fee\'s basis on its own schedule, the fees the solve charges, and their total).' }];
  },
};
