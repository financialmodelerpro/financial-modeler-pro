/**
 * stage3Opex.ts (2026-09-27, rebuilt 2026-10-14, made short 2026-10-28), FORMULA-LINKED EXPORT: OPEX.
 *
 * EVERY FIGURE ON THE OPEX TAB IS BUILT FROM ROWS ON THE TABS (founder,
 * 2026-10-14). There is no working sheet: each line's operating statement
 * carries the two things its costs read that no other tab shows (the years it
 * operates and its inflation factor), every cost line is a row, zeros and
 * switched-off lines included, and every total sums the rows above it.
 *
 *   In operations   the phase's handover and operating years on the Timeline,
 *                   from the line's operations start year on Revenue (the
 *                   engine's window, opex-resolvers `resolveOpsWindow`)
 *   Inflation       the factor while operating, counted from the later of the
 *                   year typed on Inputs and the line's first operating year
 *                   (assetOpex.ts, 2026-10-05): one exponent from MAX(the
 *                   Inputs year, the operations start, the handover year)
 *   A cost line     a fixed amount x the factor, a rate per key or per sqm of
 *                   leasable area (Revenue's drivers) x the factor, or a share
 *                   of a revenue row on this statement (zero outside
 *                   operations, so no flag); a line on GOP takes its share of
 *                   GOP. Off is zero.
 *   Totals          a group of two rows or more sums them (one row is its own
 *                   total); GOP and EBITDA follow; HQ overheads are a fixed
 *                   amount x the HQ factor or a share of the project sales value
 *   Summary         each line's revenue, opex and EBITDA, HQ and the project
 *   Payables        each line's and HQ's closing payable = opex x the days in
 *                   force (column B) / the days basis; one project roll-forward
 *                   whose cash paid is a positive row that is subtracted
 *
 * No input cards (2026-10-28, founder): the formulas read Inputs where each
 * value is typed: a line's value and On / Off (oxv| and oxon|), the inflation
 * rate and year, the DPO days and the days basis. The rows are keyed by
 * opexPlan.ts, which the builder lays out from. A line's mode and category are
 * the structure of its formula and are fixed at export.
 *
 * REFUSES by name (Opex stays values): the Timeline or Revenue rows it reads
 * are not live, a year-by-year rate, an inflation other than none, compounding
 * or one step, a line with its own inflation, a line on GOP that is itself a
 * departmental or undistributed cost (or sits on a lease line, which has no
 * GOP), a phase overlap, a line whose opex sits on more than one plot, an
 * asset running on the default seed the sheet does not show, an exit before
 * the last year, and a project start date in a different year from the first
 * phase's.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import type { CellAddr } from '../cellRegistry';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { normalizeOpexIndexation, hqOpexLinesInForce, type OpexLine } from '@/src/core/calculations/opex';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset, type RevenueLine } from '../../revenueLines';
import { HOSPITALITY_COST_GROUPS } from '../../reports/hospitalityStatement';
import { planOpexStatement, groupTotalKey, oxKey } from './opexPlan';
import { planReportLines } from '../../reports/lineRows';
import type { Asset, Phase } from '../../state/module1-types';

const OPEX = 'Opex';
const IDX_METHODS = new Set(['none', 'yoy_compound', 'single_rate']);
const FIXED_MODES = new Set(['fixed_baseline', 'per_room_year', 'per_sqm_year']);
const DIRECT = new Set(['direct_rooms', 'direct_fb', 'direct_other']);
const INDIRECT = new Set(['indirect_ga', 'indirect_it', 'indirect_sm', 'indirect_pom', 'indirect_energy', 'indirect_eosb']);

type Idx = { method?: string; rate?: number; startYear?: number };

export const stage3Opex: LiveLayer = {
  name: 'stage 3c: opex',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL, META_B } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const phases = state.phases as Phase[];
    const project = state.project;
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const values = (note: string) => [{ sheet: OPEX, status: 'values' as const, formulas: 0, note }];

    // ── Which assets carry opex, and refusals ────────────────────────────────
    const opexAssets = state.assets.filter((a) => (a.strategy === 'Operate' || a.strategy === 'Lease') && snap.opex.byAsset.has(a.id));
    const refuse: string[] = [];
    const idxOf = (cfg: unknown): Idx => normalizeOpexIndexation(cfg) as Idx;
    if (new Date(project.startDate).getUTCFullYear() !== snap.projectStartYear) refuse.push('the project start date falls in a different year from the first phase\'s start, which the operating years do not show');
    const cardHosts = new Set(planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease').map((l) => l.assetIds[0]));
    for (const a of opexAssets) {
      const name = a.name;
      const stored = (a.opex?.lines ?? []) as OpexLine[];
      if (stored.length === 0) { refuse.push(`${name}: opex runs on the default seed, which the sheet does not show`); continue; }
      if (!cardHosts.has(a.id)) refuse.push(`${name}: its opex sits on a line with more than one plot`);
      const l = lineForAsset(lines, a.id);
      if (l && l.members.filter((m) => opexAssets.includes(m)).length > 1) refuse.push(`${name}: its line carries opex on more than one plot`);
      const p = phases.find((x) => x.id === a.phaseId);
      if (p && (p.overlapPeriods ?? 0) !== 0) refuse.push(`${name}: a phase overlap, which the sheet does not show`);
      if (!has(`tl:flag:${a.phaseId}:ops`) || !has(`tl:flag:${a.phaseId}:hand`)) refuse.push(`${name}: the Timeline's operating years are not live`);
      const dflt = idxOf(a.opex?.defaultIndexation);
      if (!IDX_METHODS.has(dflt.method ?? 'none')) refuse.push(`${name}: inflation ${dflt.method}`);
      if ((dflt.method ?? 'none') !== 'none' && (!has(`oxin|${a.id}|rate`) || !has(`oxin|${a.id}|from`))) refuse.push(`${name}: its inflation has no rate on Inputs`);
      for (const ln of stored) {
        if (ln.rateMode === 'yoy') refuse.push(`${name}: ${ln.name} has year-by-year rates`);
        const own = ln.useAssetDefault === false && FIXED_MODES.has(ln.mode) && (ln.indexation?.method ?? 'none') !== 'none';
        if (own) refuse.push(`${name}: ${ln.name} has its own inflation`);
        if (ln.mode === 'pct_of_gop' && (a.strategy === 'Lease' || DIRECT.has(String(ln.category)) || INDIRECT.has(String(ln.category)))) refuse.push(`${name}: ${ln.name} is charged on GOP from inside GOP`);
      }
    }
    const hqStored = hqOpexLinesInForce(project.hqOpex?.lines as OpexLine[] | undefined);
    const hqDefault = idxOf(project.hqOpex?.defaultIndexation);
    if (!IDX_METHODS.has(hqDefault.method ?? 'none')) refuse.push(`HQ: inflation ${hqDefault.method}`);
    if ((hqDefault.method ?? 'none') !== 'none' && (!has('oxin|hq|rate') || !has('oxin|hq|from'))) refuse.push('HQ: its inflation has no rate on Inputs');
    for (const ln of hqStored) {
      if (ln.rateMode === 'yoy') refuse.push(`HQ: ${ln.name} has year-by-year rates`);
      if (ln.useAssetDefault === false && ln.mode === 'fixed_baseline' && (ln.indexation?.method ?? 'none') !== 'none') refuse.push(`HQ: ${ln.name} has its own inflation`);
    }
    if (!has('oxin|dpo|default') || !has('oxin|dpo|days')) refuse.push('the DPO days are not on Inputs');
    if (!has('rvc:__project__:salesValue')) refuse.push('Revenue\'s project sales value is not on the Revenue tab');
    // An exit before the last year stops the held assets trading after it (`stopAfterExit`).
    if (snap.disposal.booked && snap.disposal.exitIdx < N - 1 && opexAssets.length) refuse.push('the exit falls before the last year, which stops the held assets trading after it');
    if (refuse.length) return values(`Opex could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers ──────────────────────────────────────────────────────
    const at = (key: string, col: number): CellAddr => ({ sheet: w.addr(key).sheet, row: w.addr(key).row, col });
    /** This year's cell of a registered row, column relative (same sheet: no sheet name). */
    const P = (key: string, t: number): string => w.refP(at(key, pc(t)), OPEX);
    /** A fixed cell (a rate, a count, an Inputs value) of a registered row. */
    const A = (key: string, col: number): string => w.refA(at(key, col), OPEX);
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'first' | 'none' | ((t0: string, t1: string) => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: OPEX, row: r, col: pc(t) }, f(t));
      const T = { sheet: OPEX, row: r, col: TOTAL_COL };
      if (total === 'none') return;
      if (total === 'sum') w.fA(T, `SUM(${w.rangeA(OPEX, r, pc(0), pc(N - 1))})`);
      else if (total === 'last') w.fA(T, w.refA({ sheet: OPEX, row: r, col: pc(N - 1) }));
      else if (total === 'first') w.fA(T, w.refA({ sheet: OPEX, row: r, col: pc(0) }));
      else w.fA(T, total(colOf(pc(0)), colOf(pc(N - 1))));
    };
    /** A total of rows on this sheet, this year's column: one SUM over rows that sit together, else added. */
    const sumRows = (keys: string[], t: number): string => {
      const rows = keys.filter(has).map((k) => w.addr(k).row);
      if (!rows.length) return '0';
      const sorted = [...rows].sort((a, b) => a - b);
      const together = sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);
      if (together && sorted.length > 1) { for (const r of sorted) w.refP({ sheet: OPEX, row: r, col: pc(t) }, OPEX); const c = colOf(pc(t)); return `SUM(${c}$${sorted[0]}:${c}$${sorted[sorted.length - 1]})`; }
      return sorted.map((r) => w.refP({ sheet: OPEX, row: r, col: pc(t) }, OPEX)).join('+');
    };
    const sumAll = (k: string): string => `SUM(${w.rangeA(OPEX, w.addr(k).row, pc(0), pc(N - 1))})`;
    const ratioRow = (key: string, num: string, den: string): void => {
      row(key, (t) => `IF(${P(den, t)}>0,${P(num, t)}/${P(den, t)},0)`, () => `IF(${sumAll(den)}>0,${sumAll(num)}/${sumAll(den)},0)`);
    };
    const yearHere = (t: number): string => w.refP({ sheet: OPEX, row: 3, col: pc(t) }, OPEX);
    /** An Inputs cell, read where it is typed. */
    const IN = (key: string, col: number): string => A(key, col);

    // ── The statements ───────────────────────────────────────────────────────
    interface LineOut { asset: Asset; line: RevenueLine; total: string }
    const outs: LineOut[] = [];
    for (const l of lines) {
      const a = l.members.find((m) => opexAssets.includes(m));
      if (!a) continue;
      const K = (id: string): string => oxKey(l.key, id);
      if (!has(K('opex'))) continue;
      const isOp = a.strategy === 'Operate';
      const earner = state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
      // REVENUE'S ROWS BY THEIR KEYS (2026-10-27): the line's statement on Revenue (stage 3).
      const RV = (k: string): string => `rvc:${l.key}:${k}`;
      const rvP = (k: string, t: number): string => (earner && has(RV(k)) ? P(RV(k), t) : '0');
      const p = phases.find((x) => x.id === a.phaseId)!;

      // Operating years: the Timeline's handover and operating years, from the operations start on Revenue.
      const ops = (t: number): string => P(`tl:flag:${p.id}:ops`, t);
      const hand = (t: number): string => P(`tl:flag:${p.id}:hand`, t);
      const startKey = RV('opsStart');
      row(K('io'), (t) => (has(startKey) ? `(${hand(t)}+${ops(t)})*(${yearHere(t)}>=${A(startKey, TOTAL_COL)})` : ops(t)));
      const IO = (t: number): string => P(K('io'), t);
      // Inflation counts from the later of the year on Inputs and the first operating year (assetOpex.ts):
      // the operations start on Revenue, never before the handover year.
      const ix = idxOf(a.opex?.defaultIndexation);
      if (has(K('fac'))) {
        const rate = IN(`oxin|${a.id}|rate`, 2), from = IN(`oxin|${a.id}|from`, 2);
        const hy = has(`tl:phase:${p.id}:hy`) ? `,${w.ref(`tl:phase:${p.id}:hy`)}` : '';
        const base = has(startKey) ? `MAX(${from},${A(startKey, TOTAL_COL)}${hy})` : from;
        row(K('fac'), (t) => (ix.method === 'yoy_compound' ? `${IO(t)}*(1+${rate})^MAX(0,${yearHere(t)}-${base})` : `${IO(t)}*IF(${yearHere(t)}>=${base},1+${rate},1)`), 'none');
      }
      const FAC = (t: number): string => (has(K('fac')) ? P(K('fac'), t) : IO(t));

      // Revenue, from the Revenue tab.
      const revRows: Record<string, string> = {};
      if (isOp) {
        row(K('rev:rooms'), (t) => rvP('rooms', t));
        row(K('rev:fb'), (t) => rvP('fb', t));
        row(K('rev:other'), (t) => rvP('other', t));
        row(K('rev'), (t) => sumRows([K('rev:rooms'), K('rev:fb'), K('rev:other')], t));
        Object.assign(revRows, { pct_of_room_rev: K('rev:rooms'), pct_of_fb_rev: K('rev:fb'), pct_of_other_rev: K('rev:other'), pct_of_total_rev: K('rev') });
      } else {
        row(K('rev'), (t) => rvP('rev', t));
        Object.assign(revRows, { pct_of_lease_rev: K('rev'), pct_of_total_rev: K('rev') });
      }
      // Per key: the keys on Revenue's drivers. Per sqm: the lettable area there.
      const keys = isOp && earner && has(RV('keys')) ? A(RV('keys'), TOTAL_COL) : '0';
      const gla = !isOp && earner && has(RV('gla')) ? A(RV('gla'), TOTAL_COL) : '0';
      const stored = (a.opex?.lines ?? []) as OpexLine[];
      const plan = planOpexStatement(l.key, stored, isOp);
      const lineF = (i: number) => (t: number): string => {
        const ln = stored[i];
        const vK = `oxv|${a.id}|${i}`, onK = `oxon|${a.id}|${i}`;
        if (!has(vK) || !has(onK)) throw new Error(`opex Inputs cell missing: ${vK}`);
        // A revenue row is zero outside operations, and so is GOP: neither needs the flag.
        const rate = IN(vK, 5);
        let v: string;
        if (ln.mode === 'fixed_baseline') v = `${rate}*${FAC(t)}`;
        else if (ln.mode === 'per_room_year') v = keys === '0' ? '0' : `${rate}*${keys}*${FAC(t)}`;
        else if (ln.mode === 'per_sqm_year') v = gla === '0' ? '0' : `${rate}*${gla}*${FAC(t)}`;
        else if (ln.mode === 'pct_of_gop') v = `${rate}*MAX(0,${P(K('gop'), t)})`;
        else if (revRows[ln.mode]) v = `${rate}*${P(revRows[ln.mode], t)}`;
        else return '0';
        return v === '0' ? '0' : `IF(${IN(onK, 7)}="Off",0,${v})`;
      };
      for (const g of plan.groups) {
        for (const r of g.rows) row(r.key, (t) => { const parts = r.idxs.map((i) => lineF(i)(t)).filter((x) => x !== '0'); return parts.length ? parts.join('+') : '0'; });
        if (g.totalKey) row(g.totalKey, (t) => sumRows(g.rows.map((r) => r.key), t));
      }
      const GT = (group: string): string | undefined => { const g = plan.groups.find((x) => x.group === group); return g ? groupTotalKey(g) : undefined; };
      const gt = (group: string, t: number): string => { const k = GT(group); return k && has(k) ? P(k, t) : '0'; };
      const groupKeys = plan.groups.map(groupTotalKey).filter((k): k is string => !!k);
      if (isOp) {
        row(K('dp'), (t) => `${P(K('rev'), t)}-${gt('departmental', t)}`);
        row(K('gop'), (t) => `${P(K('dp'), t)}-${gt('undistributed', t)}`);
        ratioRow(K('gopm'), K('gop'), K('rev'));
        row(K('opex'), (t) => sumRows(groupKeys, t));
        row(K('ebitda'), (t) => `${P(K('gop'), t)}-${gt('management', t)}-${gt('fixed', t)}`);
        for (const g of HOSPITALITY_COST_GROUPS) { const k = GT(g); if (k && has(k)) w.claim(`oxo:${l.key}:grp:${g}`, OPEX, w.addr(k).row, 1); }
      } else {
        row(K('opex'), (t) => sumRows(groupKeys, t));
        row(K('ebitda'), (t) => `${P(K('rev'), t)}-${P(K('opex'), t)}`);
      }
      ratioRow(K('ebm'), K('ebitda'), K('rev'));
      outs.push({ asset: a, line: l, total: K('opex') });
    }

    // ── HQ, project-wide ─────────────────────────────────────────────────────
    if (has('ox|hq|fac')) {
      const rate = IN('oxin|hq|rate', 2), from = IN('oxin|hq|from', 2), axis = A('project:axisYear', 2);
      row('ox|hq|fac', (t) => (hqDefault.method === 'yoy_compound' ? `(1+${rate})^MAX(0,${yearHere(t)}-MAX(${from},${axis}))` : `IF(${yearHere(t)}>=MAX(${from},${axis}),1+${rate},1)`), 'none');
    }
    const salesValue = 'rvc:__project__:salesValue';
    const hqKeys: string[] = [];
    hqStored.forEach((ln, i) => {
      const k = `ox|hq|c${i}`;
      if (!has(k)) return;
      if (!has(`oxv|hq|${i}`) || !has(`oxon|hq|${i}`)) throw new Error(`HQ Inputs cell missing: ${i}`);
      const rate = IN(`oxv|hq|${i}`, 4);
      row(k, (t) => {
        const v = ln.mode === 'fixed_baseline' ? (has('ox|hq|fac') ? `${rate}*${P('ox|hq|fac', t)}` : rate) : ln.mode === 'pct_of_total_rev' ? `${rate}*${P(salesValue, t)}` : '';
        return v ? `IF(${IN(`oxon|hq|${i}`, 6)}="Off",0,${v})` : '0';
      });
      hqKeys.push(k);
    });
    row('ox|hq|total', (t) => sumRows(hqKeys, t));

    // ── The summary: each line's revenue, opex and EBITDA, HQ, the project ───
    for (const id of ['rev', 'opex', 'ebitda'] as const) {
      const ks: string[] = [];
      for (const o of outs) { const k = `ox|sum|${id}|${o.line.key}`; row(k, (t) => P(oxKey(o.line.key, id), t)); ks.push(k); }
      const hqK = `ox|sum|${id}|hq`;
      row(hqK, (t) => (has('ox|hq|total') ? P('ox|hq|total', t) : '0'));
      if (id === 'ebitda') row(`ox|sum|${id}`, (t) => `${sumRows(ks, t)}${has(hqK) ? `-${P(hqK, t)}` : ''}`);
      else row(`ox|sum|${id}`, (t) => sumRows([...ks, ...(id === 'opex' ? [hqK] : [])], t));
    }

    // ── Payables ─────────────────────────────────────────────────────────────
    // Each line's closing payable: its opex x the days in force (column B) / the days basis.
    const daysBasis = `MAX(1,${IN('oxin|dpo|days', 2)})`;
    const dflt = IN('oxin|dpo|default', 2);
    const closeKeys: string[] = [];
    const payable = (key: string, inc: (t: number) => string, daysF: string): void => {
      if (!has(key)) return;
      w.fA(at(key, META_B), daysF);
      const d = A(key, META_B);
      row(key, (t) => `${inc(t)}*${d}/${daysBasis}`, 'last');
      closeKeys.push(key);
    };
    for (const rl of planReportLines(lineState, (a) => snap.ap.byAsset.has(a.id))) {
      const o = outs.find((x) => rl.assetIds.includes(x.asset.id));
      const key = `ox|ap|${rl.assetIds.join('+')}`;
      const ov = o && has(`oxin|dpo|${o.asset.id}`) ? IN(`oxin|dpo|${o.asset.id}`, 2) : '';
      payable(key, (t) => (o ? P(o.total, t) : '0'), ov ? `IF(ISNUMBER(${ov}),${ov},${dflt})` : dflt);
      if (o && has(key)) w.claim(`oxo:ap:${o.asset.id}:close`, OPEX, w.addr(key).row, 1);
    }
    payable('ox|ap|hq', (t) => (has('ox|hq|total') ? P('ox|hq|total', t) : '0'), dflt);
    if (has('ox|ap|hq')) w.claim('oxo:ap:hq:close', OPEX, w.addr('ox|ap|hq').row, 1);
    // The project roll-forward: cash paid is what leaves, so the closing ties to the payables above.
    const prev = (k: string, t: number): string => `N(${w.refP({ sheet: OPEX, row: w.addr(k).row, col: pc(t) - 1 }, OPEX)})`;
    row('ox|ap|open', (t) => prev('ox|ap|close', t), 'first');
    row('ox|ap|inc', (t) => P('ox|sum|opex', t));
    row('ox|ap|paid', (t) => `${P('ox|ap|open', t)}+${P('ox|ap|inc', t)}-${sumRows(closeKeys, t)}`);
    row('ox|ap|close', (t) => `${P('ox|ap|open', t)}+${P('ox|ap|inc', t)}-${P('ox|ap|paid', t)}`, 'last');

    // ── What later tabs read: the visible rows, named once here ─────────────
    for (const o of outs) w.claim(`oxo:${o.asset.id}:total`, OPEX, w.addr(o.total).row, 1);
    if (has('ox|hq|total')) w.claim('oxo:hq:total', OPEX, w.addr('ox|hq|total').row, 1);

    const formulas = w.formulas.get(OPEX) ?? 0;
    return [{
      sheet: OPEX, status: 'live' as const, formulas,
      note: 'Opex: each line\'s operating statement shows the years it operates and its inflation factor, then revenue down to EBITDA; every cost line has a row (zeros included, switched-off lines at the foot), and every total sums the rows above it. HQ, one summary by line and the payables follow. A line\'s mode and category are fixed at export.',
    }];
  },
};
