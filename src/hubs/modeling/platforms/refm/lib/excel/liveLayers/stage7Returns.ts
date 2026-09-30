/**
 * stage7Returns.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 7a: THE RETURNS.
 *
 * The Returns sheet's first sub-tab made live over the statements and the
 * financing solve, by the returns engine's own rules (`computeReturnsSnapshot`,
 * `buildSponsorStreamsForExit`, the waterfall, the partner split):
 *   - the three streams, built VISIBLY on the sheet's own build-up rows: FCFF
 *     (cash from operations, cash capex before the exit proceeds, land in kind,
 *     the terminal enterprise value), FCFE (FCFF before the terminal value, net
 *     debt, the full finance cost, the cash the project keeps, the terminal value
 *     less closing debt) and the distributed-equity stream (equity in, dividends,
 *     the terminal equity the exit dividend did not already pay out);
 *   - every IRR and MOIC read off those rows by Excel's IRR, printed in the
 *     platform's own words ("16.4%", "2.00x", "SAR 1,336.7 m");
 *   - the equity partners (the time-weighted shareholding from the shaded
 *     % share inputs, an agreed % typed over it, each partner's streams);
 *   - fund fee income, its capital bases and basis, the hurdle waterfall and the
 *     distributions after the performance fee;
 *   - sources and uses, development economics, the exit working and its per-line
 *     net book values;
 *   - the sensitivity grid (every cell rebuilds the FCFE stream with the shock and
 *     the cap rate at that point and solves its IRR), and the exit-year analysis
 *     (each candidate exit's streams rebuilt from the same rows, as the platform
 *     does: no second model run).
 * The RE Metrics and Case Comparison sub-tabs are stage 7b and values by design.
 *
 * Rows are found by their registered keys (retr / retg / retk / rett / retx and
 * ret|<label>), written only when every rule matched (a refusal leaves the sheet
 * as values, TRAPS 3.24).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { irrOf, pctT, irrT, multT, moicOf, moneyT as moneyWords, ratioT } from './excelText';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isLandValueLine } from '@/src/core/calculations';
import { defaultSensitivityValues } from '@/src/core/calculations/returns';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../../returns-resolvers';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import type { CostLine, Phase } from '../../state/module1-types';
import { METRIC_LABELS } from '../../reports/metricCaptions';

const RET = 'Returns';
const CALC = 'Returns Calc';

type F = (t: number) => string;

export const stage7Returns: LiveLayer = {
  name: 'stage 7a: the returns',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL, META_B } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const sc = (s: number): number => OPEN_COL + s; // stream basis: s = 0 is the inception column
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const project = state.project;
    const values = (note: string) => [{ sheet: RET, status: 'values' as const, formulas: 0, note }];
    if (!has('fnc:main:interest')) return values('The Returns sheet stays the platform\'s values: the financing solve is not live for this model.');
    let rs: ReturnType<typeof computeReturnsSnapshot>;
    try { rs = computeReturnsSnapshot(snap, project); } catch { return values('The Returns sheet stays the platform\'s values: the returns engine could not compute on this model.'); }
    const cfg = resolveReturnsConfig(project, N);
    const X = cfg.exitYearOffset;
    const M = cfg.terminalValueBasis === 'exit_year' ? X : Math.max(0, X - 1);
    const booked = snap.disposal.booked;
    const cur = project.currency || 'SAR';
    const fundOn = rs.waterfall.active;

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (X !== N - 1) refuse.push('an exit before the last year');
    if (!booked || cfg.terminalMethod !== 'cap_rate') refuse.push('a terminal value other than the exit cap rate');
    if (rs.fcffPerPeriod.length !== N + 1) refuse.push('a stream length other than the axis plus inception');
    for (const k of ['cf|direct||Cash Flow from Operations', 'cf|direct||Cash Flow from Investment', 'cf|direct||Closing cash', 'pl|__all__||Total Revenue', 'fnc:proceeds', 'fnc:noi', 'fnc:inkind', 'fnc:min', 'fnc:don']) if (!has(k)) refuse.push(`the ${k} cell is not live`);
    if (refuse.length) return values(`The Returns sheet stays the platform's values: ${[...new Set(refuse)].join('; ')}.`);

    // ── Excel text in the platform's words ───────────────────────────────────
    const moneyT = moneyWords(cur);

    // ── The working sheet ────────────────────────────────────────────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Returns working sheet: the streams\' components on the project axis (columns from D, year 1 onward) and the candidate exits and sensitivity streams on the stream basis (column D = inception). Hidden.';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const sc3 = (r: number): string => w.refA(C(r, 3));
    const rowA = (key: string, label: string, f: F): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t), { cached: 0 });
      return r;
    };
    const cellS = (key: string, label: string, f: () => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      w.fA(C(r, 3), f(), { cached: 0 });
      return r;
    };
    /** A stream-basis row: s = 0 (inception) .. last, from column D. */
    const rowS = (key: string, label: string, f: (s: number) => string, last = N): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      for (let s = 0; s <= last; s++) w.fA(C(r, 4 + s), f(s), { cached: 0 });
      return r;
    };
    const rngS = (r: number, last = N): string => w.rangeA(CALC, r, 4, 4 + last);
    const fnc = (key: string, t: number): string => w.refA({ sheet: 'Financing Calc', row: w.addr(key).row, col: 4 + t });
    const fnc3 = (key: string): string => w.refA({ sheet: 'Financing Calc', row: w.addr(key).row, col: 3 });
    const vis = (sheet: string, key: string, t: number): string => w.refA({ sheet, row: w.addr(key).row, col: pc(t) });
    const CF = (label: string, t: number): string => vis('Cash Flow', `cf|direct||${label}`, t);

    const proceedsKey = 'cf|direct||Proceeds from Disposal of Operating Assets';
    const cfo = rowA('rtc:cfo', 'cash from operations', (t) => CF('Cash Flow from Operations', t));
    // Cash capex, before the exit proceeds and WITHOUT the land in kind: the Cash Flow's
    // investing total prints the in-kind land as a (non-cash) row, the engine's does not.
    const cfi = rowA('rtc:cfi', 'cash from investing: cash capex, before the exit proceeds', (t) => `-${fnc('fnc:capex', t)}`);
    const inKind = rowA('rtc:inkind', 'land contributed in kind', (t) => fnc('fnc:inkind', t));
    const draw = rowA('rtc:draw', 'debt drawn for capex', (t) => fnc('fnc:main:draw', t));
    const idcDraw = rowA('rtc:idcdraw', 'debt drawn for capitalised interest', (t) => fnc('fnc:main:idcdraw', t));
    const principal = rowA('rtc:principal', 'principal repaid (negative)', (t) => `-${fnc('fnc:main:repay', t)}`);
    const finCost = rowA('rtc:fincost', 'finance cost, the full accrued charge', (t) => fnc('fnc:main:interest', t));
    const eqCash = rowA('rtc:eqcash', 'new cash equity (development and fee)', (t) => `${fnc('fnc:main:equity', t)}+${fnc('fnc:main:feedraw', t)}`);
    const div = rowA('rtc:div', 'dividends paid', (t) => fnc('fnc:main:div', t));
    const noi = rowA('rtc:noi', 'NOI of the held assets', (t) => w.refA({ sheet: 'Financing Calc', row: w.addr('fnc:noi').row, col: 4 + t }));
    const debtKey = has('bs|__all__||Debt (long-term)') ? 'bs|__all__||Debt (long-term)' : '';
    const debt = rowA('rtc:debt', 'debt outstanding', (t) => (debtKey ? vis('Balance Sheet', debtKey, t) : fnc('fnc:main:debtbs', t)));
    const close = rowA('rtc:close', 'closing cash', (t) => CF('Closing cash', t));
    const floor = cellS('rtc:floor', 'minimum cash reserve', () => fnc3('fnc:min'));
    // The cash the project keeps (trappedCashFrom): the required balance, then, only while
    // a loan sweeps, the sweep's claim over it. On a fixed schedule the lender has no claim
    // on the rest, so only the reserve is held.
    const sweeps = snap.cashSweep?.enabled === true;
    const level = rowA('rtc:trapLevel', sweeps ? 'cash held back (minimum reserve plus the sweep\'s claim)' : 'cash held back (the minimum reserve; no loan sweeps)', (t) =>
      `MIN(${sc3(floor)},MAX(0,${at(close, t)}))${sweeps ? `+MIN(MAX(0,MAX(0,${at(close, t)})-${sc3(floor)}),MAX(0,${at(debt, t)}))` : ''}`);
    const trap = rowA('rtc:trap', 'cash retained this year', (t) => `${at(level, t)}-${t === 0 ? '0' : at(level, t - 1)}`);
    const ffPre = rowA('rtc:ffpre', 'FCFF before the terminal value', (t) => `${at(cfo, t)}+${at(cfi, t)}-${at(inKind, t)}`);
    const fePre = rowA('rtc:fepre', 'FCFE before the terminal value and the cash released at the exit', (t) => `${at(ffPre, t)}-${at(finCost, t)}+${at(draw, t)}+${at(idcDraw, t)}+${at(principal, t)}-${at(trap, t)}`);
    const capRef = (): string => `N(${w.ref('ret|Exit Cap Rate (%)', TOTAL_COL)})`;
    const ev = cellS('rtc:ev', 'terminal enterprise value (the exit proceeds)', () => fnc('fnc:proceeds', X));
    const tvEq = cellS('rtc:tveq', 'terminal equity value (less the debt at the exit)', () => `MAX(0,${sc3(ev)}-MAX(0,${at(debt, X)}))`);
    const held = cellS('rtc:held', 'cash held back at the exit, released to equity', () => at(level, X));
    const paidOut = cellS('rtc:pd', 'the exit dividend already pays the proceeds out (1 = yes)', () => `IF(${fnc3('fnc:don')}=1,1,0)`);
    const tvDist = cellS('rtc:tvdist', 'terminal equity not already paid as a dividend', () => `IF(${sc3(paidOut)}=1,0,${sc3(tvEq)})`);
    // Stream-basis rows for the candidate exits and the sensitivity grid.
    const sbFf = rowS('rtc:s:ffpre', 'FCFF before the terminal value (stream basis)', (s) => (s === 0 ? '0' : at(ffPre, s - 1)));
    const sbFe = rowS('rtc:s:fepre', 'FCFE before the terminal value (stream basis)', (s) => (s === 0 ? '0' : at(fePre, s - 1)));
    const sbCfo = rowS('rtc:s:cfo', 'cash from operations (stream basis)', (s) => (s === 0 ? '0' : at(cfo, s - 1)));
    const sbEx = rowS('rtc:s:exit', 'the exit column (1 in the exit year)', (s) => (s === X + 1 ? '1' : '0'));

    // ── Visible rows ─────────────────────────────────────────────────────────
    const writes: Array<() => void> = [];
    const missing: string[] = [];
    const rowOf = (key: string): number | undefined => (has(key) ? w.addr(key).row : undefined);
    const need = (key: string): number | undefined => { const r = rowOf(key); if (r === undefined) missing.push(key); return r; };
    const retKeys = w.reg.keys();
    const findKey = (prefix: string, re: RegExp): string | undefined => retKeys.find((k) => k.startsWith(prefix) && re.test(k.slice(prefix.length)));
    const cellR = (r: number, c: number): string => w.refA({ sheet: RET, row: r, col: c });
    const rngR = (r: number, last = N): string => w.rangeA(RET, r, sc(0), sc(last));
    /** A stream row: per column s (0 = inception), then its lifetime total. Undefined leaves the cell as it is. */
    const streamRow = (r: number, f: (s: number) => string | undefined, total = true): void => {
      writes.push(() => {
        for (let s = 0; s <= N; s++) { const x = f(s); if (x !== undefined) w.fA({ sheet: RET, row: r, col: sc(s) }, x); }
        if (total) w.fA({ sheet: RET, row: r, col: TOTAL_COL }, `SUM(${rngR(r)})`);
      });
    };
    const axis = (f: F): ((s: number) => string | undefined) => (s) => (s === 0 ? undefined : f(s - 1));
    const onlyExit = (e: () => string): ((s: number) => string | undefined) => (s) => (s === X + 1 ? e() : undefined);
    const sumOf = (rows: number[]): ((s: number) => string) => (s) => rows.map((r) => cellR(r, sc(s))).join('+');
    const scalar = (key: string, f: () => string): void => { const r = need(key); if (r !== undefined) writes.push(() => w.fA({ sheet: RET, row: r, col: TOTAL_COL }, f())); };
    const cellAt = (key: string, col: number, f: () => string): void => { const r = need(key); if (r !== undefined) writes.push(() => w.fA({ sheet: RET, row: r, col }, f())); };
    const gridCell = (rowKey: string, i: number, f: () => string): void => {
      const key = `${rowKey}|${i}`;
      if (!has(key)) { missing.push(key); return; }
      const a = w.addr(key);
      writes.push(() => w.fA(a, f()));
    };
    const kpi = (sec: string, label: string, value: () => string, sub?: () => string): void => {
      const key = `retk|${sec}|${label}`;
      if (!has(key)) { missing.push(key); return; }
      const a = w.addr(key);
      writes.push(() => w.fA(a, value()));
      if (sub) { const sk = `retks|${sec}|${label}`; if (has(sk)) { const b = w.addr(sk); writes.push(() => w.fA(b, sub())); } }
    };

    // FCFF build-up.
    const FF = 'retr|FCFF Build-Up (unlevered, to all capital providers)|';
    const ffHist = need(`${FF}(-) Historical Development Investment`);
    const ffCfo = need(`${FF}(+) Cash from Operations (pre-interest)`);
    const ffCfi = need(`${FF}(-) Capex, cash (Cash from Investing)`);
    const ffKind = need(`${FF}(-) Land Contributed In-Kind (non-cash)`);
    const ffTv = need(`${FF}(+) Terminal Enterprise Value`);
    const ffTot = need(`${FF}= FCFF (unlevered project)`);
    // FCFE build-up.
    const FE = 'retr|FCFE Build-Up (levered, free cash to equity)|';
    const feEx = need(`${FE}(-) Existing Equity Investment (at inception)`);
    const feFf = need(`${FE}(=) FCFF (unlevered, before terminal value)`);
    const feDebt = need(`${FE}(+) Net Debt (total drawdown less principal repaid)`);
    const feCost = need(`${FE}(-) Finance Cost (full accrued charge, incl. IDC)`);
    const feCash = need(`${FE}(-) Restricted Cash (sweep and minimum balance)`);
    const feTv = need(`${FE}(+) Terminal Value less Closing Debt`);
    const feTot = need(`${FE}= FCFE (levered equity)`);
    // The distributed-equity build-up.
    const ddmSec = fundOn ? 'Dividend Discount Model (DDM), before performance fee' : 'Distributed Equity Build-Up (Dividend Discount Model)';
    const DD = `retr|${ddmSec}|`;
    const ddEx = need(`${DD}(-) Existing Equity Investment (at inception)`);
    const ddCash = need(`${DD}(-) New Cash Equity Investment`);
    const ddKind = need(`${DD}(-) In-Kind Equity Investment`);
    const ddDiv = need(`${DD}(+) Dividends Distributed (cash-sweep waterfall)`);
    const ddTv = need(`${DD}(+) Terminal Equity Value (not already paid as a dividend)`);
    const ddTot = need(`${DD}= Net Equity Cash Flow (dividend basis)`);
    if (missing.length) return values(`The Returns sheet stays the platform's values: the build-up rows were not found (${missing.slice(0, 4).join('; ')}).`);
    const R = (r: number | undefined): number => r!;

    streamRow(R(ffCfo), axis((t) => at(cfo, t)));
    streamRow(R(ffCfi), axis((t) => at(cfi, t)));
    streamRow(R(ffKind), axis((t) => `-${at(inKind, t)}`));
    streamRow(R(ffTv), onlyExit(() => sc3(ev)));
    streamRow(R(ffTot), sumOf([R(ffHist), R(ffCfo), R(ffCfi), R(ffKind), R(ffTv)]));
    streamRow(R(feFf), axis((t) => `${cellR(R(ffTot), pc(t))}-${cellR(R(ffTv), pc(t))}`));
    streamRow(R(feDebt), axis((t) => `${at(draw, t)}+${at(idcDraw, t)}+${at(principal, t)}`));
    streamRow(R(feCost), axis((t) => `-${at(finCost, t)}`));
    streamRow(R(feCash), axis((t) => `-${at(trap, t)}${t === X ? `+${sc3(held)}` : ''}`));
    streamRow(R(feTv), onlyExit(() => sc3(tvEq)));
    streamRow(R(feTot), sumOf([R(feEx), R(feFf), R(feDebt), R(feCost), R(feCash), R(feTv)]));
    streamRow(R(ddCash), axis((t) => `-${at(eqCash, t)}`));
    streamRow(R(ddKind), axis((t) => `-${at(inKind, t)}`));
    streamRow(R(ddDiv), axis((t) => at(div, t)));
    streamRow(R(ddTv), onlyExit(() => sc3(tvDist)));
    streamRow(R(ddTot), sumOf([R(ddEx), R(ddCash), R(ddKind), R(ddDiv), R(ddTv)]));
    const FCFF = (): string => rngR(R(ffTot)), FCFE = (): string => rngR(R(feTot)), DDM = (): string => rngR(R(ddTot));
    { const k = retKeys.find((x) => x.startsWith(`rett|${ddmSec}`)); if (k) cellAt(k, 1, () => `"DDM IRR${fundOn ? ' (before performance fee)' : ''} "&${irrT(DDM())}&" · MOIC "&${multT(moicOf(DDM()))}`); }

    // The streams as shown.
    const RS = findKey('retr|', /^Return Cash-Flow Streams .*\|FCFF, unlevered project$/);
    const streamsSec = RS ? RS.split('|')[1] : '';
    const mirror = (label: string, src: number): void => { const r = rowOf(`retr|${streamsSec}|${label}`); if (r === undefined) { missing.push(label); return; } streamRow(r, (s) => cellR(src, sc(s))); };
    // The distributed rows carry ", before performance fee" where the fund charges one
    // (distributedStreamLabel), so they are found by their fixed prefix.
    const distLabel = (sec: string): string => retKeys.find((k) => k.startsWith(`${sec}|Distributed Equity (realized distributions)`))?.slice(sec.length + 1) ?? 'Distributed Equity (realized distributions)';
    mirror('FCFF, unlevered project', R(ffTot));
    mirror('FCFE, levered equity', R(feTot));
    mirror(distLabel(`retr|${streamsSec}`), R(ddTot));
    { const r = rowOf(`retr|${streamsSec}|Memo: NOI (recurring)`); if (r !== undefined) streamRow(r, axis((t) => at(noi, t))); }

    // Returns by cash-flow basis.
    const basisRow = (label: string, rng: () => string): void => {
      const rk = `retg|Returns by Cash-Flow Basis|${label}`;
      gridCell(rk, 0, () => irrT(rng()));
      gridCell(rk, 1, () => multT(moicOf(rng())));
      gridCell(rk, 2, () => `-SUMIF(${rng()},"<0")`);
      gridCell(rk, 3, () => `SUMIF(${rng()},">0")`);
      gridCell(rk, 4, () => `SUMIF(${rng()},">0")+SUMIF(${rng()},"<0")`);
    };
    basisRow('FCFF (unlevered project)', FCFF);
    basisRow('FCFE (levered equity)', FCFE);
    basisRow(distLabel('retg|Returns by Cash-Flow Basis'), DDM);

    // Totals the cards read.
    const sumA = (r: number): string => w.rangeA(CALC, r, cT(0), cT(N - 1));
    const gdv = (): string => `SUM(${w.rangeA('P&L', w.addr('pl|__all__||Total Revenue').row, pc(0), pc(X))})`;
    const tdc = (): string => `SUM(${w.rangeA('Financing Calc', w.addr('fnc:capexall').row, 4, 4 + N - 1)})`;
    const tfc = (): string => `SUM(${w.rangeA('Financing Calc', w.addr('fnc:main:interest').row, 4, 4 + N - 1)})`;
    const invested = (): string => `MAX(0,SUM(${sumA(eqCash)})+SUM(${sumA(inKind)}))`;
    const distTotal = (): string => `(SUM(${sumA(div)})+${sc3(tvDist)})`;

    // The waterfall (fund layer) and the distributions after the fee.
    let netRng: (() => string) | null = null;
    let perfTotal: (() => string) | null = null;
    if (fundOn) {
      const WF = findKey('retr|', /^Performance Fee \(hold to .*\|Equity Drawn$/);
      const wsec = WF ? WF.split('|')[1] : '';
      const wr = (label: string): number | undefined => need(`retr|${wsec}|${label}`);
      const drawn = wr('Equity Drawn'), bop = wr('Unpaid Hurdle Balance BoP'), acc = wr('Hurdle Accrued'), owed = wr('Total Hurdle Owed');
      const paid = wr('Hurdle Paid'), eop = wr('Unpaid Hurdle Balance EoP'), excess = wr('Excess Distributions'), fee = wr('Performance Fee');
      const net = wr('Distributions Net of Performance Fee'), gross = wr('Memo: Distributions (gross, before fee)');
      const PF = 'retr|Dividend Discount Model (DDM), after performance fee|';
      const pfInv = need(`${PF}(-) Equity Investment (existing + new cash + in-kind)`);
      const pfNet = need(`${PF}(+) Distributions Net of Performance Fee (dividends, return of capital, terminal value)`);
      const pfTot = need(`${PF}= Net Cash Flow (after performance fee)`);
      if (!missing.length) {
        const h = (): string => `MAX(0,N(${w.ref('ft:Hurdle rate (preferred return)')}))`;
        const pf = (): string => `MAX(0,MIN(1,N(${w.ref('ft:Performance fee on the excess')})))`;
        scalar('ret|Hurdle rate (preferred return)', h);
        scalar('ret|Performance fee on the excess', pf);
        const hr = (): string => cellR(w.addr('ret|Hurdle rate (preferred return)').row, TOTAL_COL);
        const pr = (): string => cellR(w.addr('ret|Performance fee on the excess').row, TOTAL_COL);
        const e = (t: number): string => `(${at(eqCash, t)}+${at(inKind, t)})`;
        const c = (r: number | undefined, s: number): string => cellR(R(r), sc(s));
        streamRow(R(drawn), axis((t) => `MAX(0,${e(t)})+MAX(0,-${at(div, t)})`));
        streamRow(R(gross), axis((t) => `MAX(0,${at(div, t)})+MAX(0,-${e(t)})${t === X ? `+MAX(0,${sc3(tvDist)})` : ''}`));
        streamRow(R(bop), (s) => (s === 0 ? undefined : c(eop, s - 1)), false);
        streamRow(R(acc), (s) => `(${c(bop, s)}+${c(drawn, s)})*${hr()}`, false);
        streamRow(R(owed), (s) => `${c(drawn, s)}+${c(bop, s)}+${c(acc, s)}`, false);
        streamRow(R(paid), (s) => `MIN(${c(gross, s)},${c(owed, s)})`);
        streamRow(R(eop), (s) => `${c(owed, s)}-${c(paid, s)}`, false);
        streamRow(R(excess), (s) => `${c(gross, s)}-${c(paid, s)}`);
        streamRow(R(fee), (s) => `${c(excess, s)}*${pr()}`);
        streamRow(R(net), (s) => `${c(gross, s)}-${c(fee, s)}`);
        streamRow(R(pfInv), (s) => `-${c(drawn, s)}`);
        streamRow(R(pfNet), (s) => c(net, s));
        streamRow(R(pfTot), sumOf([R(pfInv), R(pfNet)]));
        netRng = () => rngR(R(pfTot));
        perfTotal = () => `SUM(${rngR(R(fee))})`;
        const k = retKeys.find((x) => x.startsWith('rett|Dividend Discount Model (DDM), after performance fee'));
        if (k) cellAt(k, 1, () => `"DDM IRR (after performance fee) "&${irrT(netRng!())}&" · MOIC "&${multT(moicOf(netRng!()))}`);
        // Gross vs net.
        const G = 'Fund Returns, Gross vs Net';
        kpi(G, 'Distributed Equity IRR (gross)', () => irrT(DDM()), () => `"MOIC "&${multT(moicOf(DDM()))}`);
        kpi(G, 'Distributed Equity IRR (net)', () => irrT(netRng!()), () => `"MOIC "&${multT(moicOf(netRng!()))}`);
        kpi(G, 'Performance Fee', () => moneyT(perfTotal!()));
        kpi(G, 'Unpaid Hurdle at Exit', () => moneyT(c(eop, N)), () => `IF(${c(eop, N)}>0,"hurdle not fully met","hurdle fully settled")`);
        const gn = (label: string, rng: () => string): void => {
          const rk = `retg|${G}|${label}`;
          gridCell(rk, 0, () => irrT(rng()));
          gridCell(rk, 1, () => multT(moicOf(rng())));
          gridCell(rk, 2, () => moneyT(`-SUMIF(${rng()},"<0")`));
          gridCell(rk, 3, () => moneyT(`SUMIF(${rng()},">0")`));
          gridCell(rk, 4, () => moneyT(`SUMIF(${rng()},">0")+SUMIF(${rng()},"<0")`));
        };
        gn('Excluding fund fees (gross)', DDM);
        gn('Net of performance fee', netRng);
      }
    }

    // Headline returns.
    kpi('Headline Returns', 'Project IRR (FCFF)', () => irrT(FCFF()), () => `"MOIC "&${multT(moicOf(FCFF()))}`);
    kpi('Headline Returns', 'Equity IRR (FCFE)', () => irrT(FCFE()), () => `"MOIC "&${multT(moicOf(FCFE()))}`);
    {
      const label = retKeys.find((k) => k.startsWith('retk|Headline Returns|Distributed Equity IRR'))?.split('|')[2];
      if (!label) missing.push('the distributed equity card');
      else if (netRng && perfTotal) {
        // The split follows the TERMS (distributedReturnPair, 2026-09-29): net and gross wherever a
        // performance fee is charged at all, equal while none arises.
        const nr = netRng, pt = perfTotal;
        const split = has('ft:Performance fee on the excess') ? `N(${w.ref('ft:Performance fee on the excess')})>0` : `${pt()}>0`;
        kpi('Headline Returns', label, () => `IF(${split},${irrT(nr())},${irrT(DDM())})`,
          () => `IF(${split},"MOIC "&${multT(moicOf(nr()))}&" · gross "&${irrT(DDM())}&" / MOIC "&${multT(moicOf(DDM()))},"MOIC "&${multT(moicOf(DDM()))})`);
      } else kpi('Headline Returns', label, () => irrT(DDM()), () => `"MOIC "&${multT(moicOf(DDM()))}`);
    }
    kpi('Headline Returns', 'Equity Multiple (distributions)', () => multT(`IF(${invested()}>0,${distTotal()}/${invested()},0)`));

    // Development economics.
    const DE = 'Development Economics';
    kpi(DE, 'Total Development Cost', () => moneyT(tdc()));
    kpi(DE, 'Total Financing Cost', () => moneyT(tfc()));
    kpi(DE, METRIC_LABELS.developmentSurplusBefore, () => moneyT(`(${gdv()}-${tdc()})`));
    kpi(DE, METRIC_LABELS.developmentSurplusAfter, () => moneyT(`(${gdv()}-${tdc()}-${tfc()})`));
    kpi(DE, 'Development Margin', () => ratioT(`${gdv()}-${tdc()}-${tfc()}`, gdv()));

    // Equity partners.
    {
      const ps = rs.partners;
      const effective = (project.partners ?? []).length ? (project.partners ?? []) : [{ id: 'sponsor', name: 'Sponsor' }];
      const EP = 'retg|Equity Partners|';
      const n = effective.length;
      const typeRow = (label: string, pctKey: string, total: () => string): void => {
        gridCell(`${EP}${label}`, 0, total);
        for (let j = 0; j < n; j++) gridCell(`${EP}${label}`, j + 1, () => `${cellR(w.addr(`${EP}${label}|0`).row, OPEN_COL)}*${w.ref(`${EP}${pctKey}|${j + 1}`)}`);
      };
      const cashT = (): string => `SUM(${sumA(eqCash)})`, kindT = (): string => `SUM(${sumA(inKind)})`;
      typeRow('New Cash Equity', '% share', cashT);
      typeRow('In-Kind Equity (land)', '% share~1', kindT);
      const pctCell = (k: string, j: number): string => `MAX(0,MIN(1,N(${w.ref(`${EP}${k}|${j + 1}`)})))`;
      // The time-weighted shareholding: each partner's capital-years over everyone's.
      const capYears = (r: number): string => `SUMPRODUCT(${w.rangeA(CALC, r, cT(0), cT(N - 1))},${N}-(COLUMN(${w.rangeA(CALC, r, cT(0), cT(N - 1))})-${cT(0)}))`;
      const capT = (j: number): string => `(IF(${cashT()}>0,${pctCell('% share', j)},0)*${capYears(eqCash)}+IF(${kindT()}>0,${pctCell('% share~1', j)},0)*${capYears(inKind)})`;
      const totCapT = (): string => Array.from({ length: n }, (_, j) => capT(j)).join('+');
      const investedJ = (j: number): string => `(MAX(0,${cellR(w.addr(`${EP}New Cash Equity|${j + 1}`).row, OPEN_COL + j + 1)})+MAX(0,${cellR(w.addr(`${EP}In-Kind Equity (land)|${j + 1}`).row, OPEN_COL + j + 1)}))`;
      const projEq = (): string => `(MAX(0,${cashT()})+MAX(0,${kindT()}))`;
      gridCell(`${EP}Total Invested`, 0, projEq);
      for (let j = 0; j < n; j++) gridCell(`${EP}Total Invested`, j + 1, () => investedJ(j));
      const wavg = (j: number): string => `IF((${totCapT()})>0,${capT(j)}/(${totCapT()}),IF(${projEq()}>0,${investedJ(j)}/${projEq()},0))`;
      for (let j = 0; j < n; j++) gridCell(`${EP}Weighted-Avg %`, j + 1, () => wavg(j));
      gridCell(`${EP}Weighted-Avg %`, 0, () => `SUM(${w.rangeA(RET, w.addr(`${EP}Weighted-Avg %|1`).row, OPEN_COL + 1, OPEN_COL + n)})`);
      const agreedCell = (j: number): string => w.ref(`${EP}Agreed % (override)|${j + 1}`);
      const agreed = (j: number): string => `IF(ISNUMBER(${agreedCell(j)}),MAX(0,${agreedCell(j)}),${cellR(w.addr(`${EP}Weighted-Avg %|${j + 1}`).row, OPEN_COL + j + 1)})`;
      gridCell(`${EP}Agreed % (override)`, 0, () => Array.from({ length: n }, (_, j) => agreed(j)).join('+'));
      // Each partner's results.
      const partnerRows = ps.partners;
      const occ = new Map<string, number>();
      const fcfeRows: number[] = [], ddmRows: number[] = [];
      const FS = 'retr|FCFE Streams by Partner|', DS = 'retr|Distributed-Equity (DDM) Streams by Partner|';
      partnerRows.forEach((p, j) => {
        const k = occ.get(p.name) ?? 0; occ.set(p.name, k + 1);
        const nm = k ? `${p.name}~${k}` : p.name;
        const share = (): string => agreed(j);
        const fr = need(`${FS}${nm}`), dr = need(`${DS}${nm}`);
        if (fr === undefined || dr === undefined) return;
        streamRow(fr, (s) => `${share()}*${cellR(R(feTot), sc(s))}`);
        streamRow(dr, (s) => `${share()}*${cellR(R(ddTot), sc(s))}`);
        writes.push(() => w.fA({ sheet: RET, row: fr, col: META_B }, `"IRR "&${irrT(rngR(fr))}`));
        writes.push(() => w.fA({ sheet: RET, row: dr, col: META_B }, `"IRR "&${irrT(rngR(dr))}`));
        fcfeRows.push(fr); ddmRows.push(dr);
        const PR = `${EP}${nm}`;
        gridCell(PR, 0, () => investedJ(j));
        gridCell(PR, 1, share);
        gridCell(PR, 2, () => irrT(rngR(fr)));
        gridCell(PR, 3, () => multT(moicOf(rngR(fr))));
        gridCell(PR, 4, () => multT(moicOf(rngR(fr))));
        gridCell(PR, 5, () => irrT(rngR(dr)));
        gridCell(PR, 6, () => `${share()}*${distTotal()}`);
      });
      const ft = need(`${FS}Total`), dt = need(`${DS}Total`);
      if (ft !== undefined && dt !== undefined) {
        streamRow(ft, sumOf(fcfeRows));
        streamRow(dt, sumOf(ddmRows));
        writes.push(() => w.fA({ sheet: RET, row: ft, col: META_B }, `"IRR "&${irrT(FCFE())}`));
        writes.push(() => w.fA({ sheet: RET, row: dt, col: META_B }, `"IRR "&${irrT(DDM())}`));
      }
    }

    // Fund fee income, its capital bases and basis.
    if (rs.feeEarners.active) {
      const feeRow = (i: number, t: number): string => fnc(`fnc:fee:${i}`, t);
      const R0 = (): string => fnc3('fnc:fee:base');
      const baseOf = (base: string): string => (base === 'fund_size' ? fnc3('fnc:fee:fundsize') : base === 'total_equity' ? `${R0()}*${fnc3('fnc:eF')}` : base === 'debt_facility' ? `${R0()}*${fnc3('fnc:dF')}` : '0');
      // The capital block (equity + debt = fund size) is printed only where the parts sum
      // to the total (buildFundCapitalRows); a TYPED fund size is not their sum, so under
      // the override the platform omits it and its absence is the answer, not a gap.
      const capital = state.project.fundTerms?.fundSizeOverride === true
        ? (key: string, f: () => string): void => { if (has(key)) scalar(key, f); }
        : scalar;
      capital('ret|Capex equity', () => baseOf('total_equity'));
      capital('ret|Debt facility', () => baseOf('debt_facility'));
      capital('ret|= Fund size', () => baseOf('fund_size'));
      const fbSec = findKey('retr|', /^Fund Fee Basis \(what each fee is charged on\)\|/) ? 'Fund Fee Basis (what each fee is charged on)' : '';
      snap.fundFees.lines.forEach((line, i) => {
        const charged = rowOf(`retr|${fbSec}|${line.label}: charged`);
        if (charged !== undefined) streamRow(charged, axis((t) => feeRow(i, t)));
        const basis = rowOf(`retr|${fbSec}|${line.label}: basis`);
        if (basis !== undefined) {
          const oneTime = line.timing === 'one_time';
          writes.push(() => {
            for (let t = 0; t < N; t++) w.fA({ sheet: RET, row: basis, col: pc(t) }, oneTime && t > 0 ? '0' : baseOf(line.base));
            w.fA({ sheet: RET, row: basis, col: TOTAL_COL }, baseOf(line.base));
          });
        }
        const inc = rowOf(`retr|Fee Income by Period|${line.label}`);
        if (inc !== undefined) streamRow(inc, axis((t) => feeRow(i, t)));
      });
      const FI = 'retr|Fee Income by Period|';
      const feeRowsVis = snap.fundFees.lines.map((l) => rowOf(`${FI}${l.label}`)).filter((x): x is number => x !== undefined);
      const tm = rowOf(`${FI}= Total Management Fees`), pfr = rowOf(`${FI}Performance Fee`), tf = rowOf(`${FI}= Total Fee Income`);
      if (tm !== undefined) streamRow(tm, sumOf(feeRowsVis));
      const wfFee = findKey('retr|', /^Performance Fee \(hold to .*\|Performance Fee$/);
      if (pfr !== undefined && wfFee) streamRow(pfr, (s) => cellR(w.addr(wfFee).row, sc(s)));
      if (tf !== undefined && tm !== undefined && pfr !== undefined) streamRow(tf, sumOf([tm, pfr]));
      // Who earns them.
      const EA = 'retg|Fund Fee Income by Earner|';
      const totMgmt = (): string => (tm !== undefined ? `SUM(${rngR(tm)})` : '0');
      const totPerf = (): string => (pfr !== undefined ? `SUM(${rngR(pfr)})` : '0');
      const eocc = new Map<string, number>();
      const pShares: string[] = [];
      for (const e of rs.feeEarners.earners) {
        const k = eocc.get(e.name) ?? 0; eocc.set(e.name, k + 1);
        const rk = `${EA}${k ? `${e.name}~${k}` : e.name}`;
        if (!has(`${rk}|1`)) { missing.push(rk); continue; }
        const mS = (): string => `IFERROR(VALUE(${w.ref(`${rk}|1`)}),0)`;
        const pS = (): string => `MAX(0,IFERROR(VALUE(${w.ref(`${rk}|3`)}),0))`;
        pShares.push(`${rk}|3`);
        gridCell(rk, 2, () => moneyT(`${mS()}*${totMgmt()}`));
        gridCell(rk, 4, () => moneyT(`${pS()}*${totPerf()}`));
        gridCell(rk, 5, () => moneyT(`(${mS()}*${totMgmt()}+${pS()}*${totPerf()})`));
      }
      const shareSum = (): string => pShares.map((k) => `MAX(0,IFERROR(VALUE(${w.ref(k)}),0))`).join('+') || '0';
      if (has(`${EA}Unallocated|3`)) {
        gridCell(`${EA}Unallocated`, 3, () => pctT(`MAX(0,1-(${shareSum()}))`));
        gridCell(`${EA}Unallocated`, 4, () => moneyT(`MAX(0,${totPerf()}-(${shareSum()})*${totPerf()})`));
        gridCell(`${EA}Unallocated`, 5, () => moneyT(`MAX(0,${totPerf()}-(${shareSum()})*${totPerf()})`));
      }
      gridCell(`${EA}Total`, 2, () => moneyT(totMgmt()));
      gridCell(`${EA}Total`, 4, () => moneyT(totPerf()));
      gridCell(`${EA}Total`, 5, () => moneyT(`(${totMgmt()}+${totPerf()})`));
    }

    // Sources and uses.
    {
      const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
      const sells = state.assets.filter((a) => a.visible !== false && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'));
      const preKeys = [...new Set(sells.map((a) => lineForAsset(lines, a.id)?.key).filter((k): k is string => !!k && has(`rvc:${k}:cashPre`)))];
      const rvSum = (k: string): string => `SUM(${w.rangeA('Revenue Calc', w.addr(k).row, 4, 4 + N - 1)})`;
      const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      const revSum = (key: string): string => (has(key) ? `SUM(${w.rangeA('Revenue', w.addr(key).row, pc(0), pc(N - 1))})` : '0');
      const collections = (): string => `MAX(0,${preKeys.map((k) => rvSum(`rvc:${k}:cashPre`)).join('+') || '0'}-(${revSum(escB('Total Additions'))})-(${revSum(escB('Less: Release of Locked Funds'))}))`;
      const P0 = w.addr('cxc:P0').col;
      const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
      const visibleIds = new Set(state.assets.filter((a) => a.visible !== false).map((a) => a.id));
      const landKeys = retKeys.filter((k) => k.startsWith('cxc:') && k.split(':').length === 3 && !k.startsWith('cxc:ph:') && visibleIds.has(k.split(':')[1]) && isLandValueLine(costLineOf(k.split(':')[2])));
      const land = (): string => landKeys.map((k) => `SUM(${w.rangeA('Capex Calc', w.addr(k).row, P0, P0 + N - 1)})`).join('+') || '0';
      const cashEq = (): string => `SUM(${sumA(eqCash)})`, kindEq = (): string => `SUM(${sumA(inKind)})`;
      const newDebt = (): string => `SUM(${sumA(draw)})+SUM(${sumA(idcDraw)})`;
      const idc = (): string => `SUM(${w.rangeA('Financing Calc', w.addr('fnc:main:basis').row, 4, 4 + N - 1)})`;
      const uses = (): string => `(${tdc()}+${idc()})`;
      const nonOp = (): string => `(${cashEq()}+${kindEq()}+${newDebt()}+${collections()})`;
      scalar('ret|New Equity (cash)', cashEq);
      scalar('ret|In-Kind Equity (land)', kindEq);
      scalar('ret|New Debt (incl. capitalised IDC)', newDebt);
      scalar('ret|Customer Collections / Pre-Sales', collections);
      scalar('ret|Operating Cash Generated', () => `MAX(0,${uses()}-${nonOp()})`);
      scalar('ret|Total Sources', () => `${nonOp()}+MAX(0,${uses()}-${nonOp()})`);
      scalar('ret|Land', land);
      scalar('ret|Construction & Infrastructure', () => `${tdc()}-(${land()})`);
      scalar('ret|IDC Capitalized During Construction', idc);
      scalar('ret|Reserves / Distributions', () => `MAX(0,${nonOp()}-${uses()})`);
      scalar('ret|Total Uses', () => `${uses()}+MAX(0,${nonOp()}-${uses()})`);
    }

    // A cap rate nobody typed follows the discount rate less growth (resolveCapRate), so it is a formula.
    if (cfg.capRateSource === 'derived') scalar('ret|Exit Cap Rate (%)', () => `MAX(0,N(${w.ref('ret|Discount Rate (%)', TOTAL_COL)})-N(${w.ref('ret|Growth g (%)', TOTAL_COL)}))`);

    // The exit working.
    {
      const x = (label: string): string => `retx|${label}`;
      const exitCell = (label: string, f: () => string): void => { if (has(x(label))) { const a = w.addr(x(label)); writes.push(() => w.fA(a, f())); } };
      const my = snap.yearLabels[M];
      const plAt = (key: string, t: number): string => (has(key) ? vis('P&L', key, t) : '0');
      const hosp = (): string => `(${plAt('pl|__all__||Hospitality Revenue', M)}+${plAt('pl|__all__||Hospitality operating expenses', M)})`;
      exitCell(`Hospitality EBITDA, ${my}`, hosp);
      exitCell(`Retail NOI, ${my}`, () => `${at(noi, M)}-${hosp()}`);
      exitCell('Income capitalised', () => at(noi, M));
      exitCell('Exit cap rate', capRef);
      exitCell('Terminal value, booked as proceeds from disposal', () => sc3(ev));
      const sg = (k: string): string => (has(k) ? w.refA({ sheet: 'Schedules Calc', row: w.addr(k).row, col: 4 + X }) : '0');
      const bld = (): string => sg('schg:__project__:cap:disp'), lnd = (): string => sg('schg:__project__:land:disp');
      const cint = (): string => fnc('fnc:main:idcdisp', X);
      const nbv = (): string => `(${bld()}+${lnd()}+${cint()})`;
      exitCell('Building', bld);
      exitCell('Land', lnd);
      exitCell('Capitalised interest', cint);
      exitCell('Total net book value', nbv);
      exitCell('Proceeds from disposal', () => sc3(ev));
      exitCell('Less net book value disposed', () => `-${nbv()}`);
      exitCell(snap.disposal.gain >= 0 ? 'Gain on disposal' : 'Loss on disposal', () => `${sc3(ev)}-${nbv()}`);
      exitCell('Debt repaid from the proceeds', () => `-${fnc('fnc:main:exitrepay', X)}`);
      exitCell('Proceeds left after debt', () => `${sc3(ev)}-${fnc('fnc:main:exitrepay', X)}`);
      const gainPl = (): string => plAt('pl|__all__||Gain on Disposal of Operating Assets', X);
      const cfProc = (): string => (has(proceedsKey) ? vis('Cash Flow', proceedsKey, X) : '0');
      const tvRet = (): string => cellR(R(ffTv), pc(X));
      const faBs = (): string => (has('bs|__all__||Total Fixed Assets') ? vis('Balance Sheet', 'bs|__all__||Total Fixed Assets', X) : '0');
      exitCell('P&L: Gain on Disposal of Operating Assets', gainPl);
      exitCell('Cash flow: Proceeds from Disposal of Operating Assets', cfProc);
      exitCell('Returns: terminal enterprise value', tvRet);
      exitCell('Balance sheet: fixed assets after the exit', faBs);
      exitCell('Check, every booking against this working (should be 0)', () => `ABS(${gainPl()}-(${sc3(ev)}-${nbv()}))+ABS(${cfProc()}-${sc3(ev)})+ABS(${tvRet()}-${sc3(ev)})+ABS(${faBs()})`);
      // Per line.
      const lineState = { assets: state.assets.filter((a) => a.visible !== false), phases: state.phases, parcels: state.parcels };
      const G = 'retg|Exit: terminal value and gain on disposal|';
      const soldRows: number[] = [];
      for (const l of planReportLines(lineState)) {
        const rk = `${G}${lineTitle(l, lineState)}`;
        if (!has(`${rk}|0`)) continue;
        // The line's fixed asset schedule is keyed by its first member that has one (stage 4).
        const host = l.assetIds.find((id) => has(`schg:${id}:cap:disp`));
        if (!host) { missing.push(`the fixed asset schedule of ${lineTitle(l, lineState)}`); continue; }
        const rr = w.addr(`${rk}|0`).row;
        soldRows.push(rr);
        gridCell(rk, 0, () => sg(`schg:${host}:cap:disp`));
        gridCell(rk, 1, () => sg(`schg:${host}:land:disp`));
        gridCell(rk, 2, () => (has(`schg:${host}:idc:disp`) ? sg(`schg:${host}:idc:disp`) : '0'));
        gridCell(rk, 3, () => `SUM(${w.rangeA(RET, rr, OPEN_COL, OPEN_COL + 2)})`);
      }
      if (has(`${G}Total|0`)) for (let i = 0; i < 4; i++) gridCell(`${G}Total`, i, () => soldRows.map((rr) => cellR(rr, OPEN_COL + i)).join('+') || '0');
    }

    // Sensitivity: each cell rebuilds the FCFE stream with its shock and its cap rate.
    {
      const SE = 'retg|Sensitivity, Equity IRR (FCFE)|';
      const ys = defaultSensitivityValues('sales_price_pct', cfg.discountRate);
      const xs = defaultSensitivityValues('exit_cap_rate', cfg.discountRate);
      const yLabel = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
      for (const y of ys) {
        const rk = `${SE}${yLabel(y)}`;
        if (!has(`${rk}|0`)) continue;
        xs.forEach((xv, i) => gridCell(rk, i, () => {
          const evx = `MAX(0,${at(noi, M)}*${1 + y}/${xv})`;
          const eq = `MAX(0,${evx}-MAX(0,${at(debt, X)}))`;
          const stream = `${rngS(sbFe)}+${y}*${rngS(sbCfo)}+${rngS(sbEx)}*(${eq}+${sc3(held)})`;
          return `IFERROR(${irrOf(stream)},"n/a")`;
        }));
      }
      void sbFf;
    }

    if (missing.length) return values(`The Returns sheet stays the platform's values: rows were not found (${missing.slice(0, 6).join('; ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}).`);
    for (const fn of writes) fn();
    for (let col = 1; col <= 4 + N; col++) cs.getColumn(col).width = col <= 3 ? 30 : 14;
    return [{
      sheet: RET, status: 'partial' as const, formulas: w.formulas.get(RET) ?? 0,
      note: 'Live: 1. Returns (the three streams built on their own rows, every IRR and MOIC, the equity partners, fund fee income, the hurdle waterfall, sources and uses, development economics, the exit working and the sensitivity grid). The figures quoted inside explanatory notes are as of export.',
    }];
  },
};
