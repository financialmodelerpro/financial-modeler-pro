/**
 * stage6Financing.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 6a: THE CIRCULAR FINANCING.
 *
 * The platform solves the financing to a FIXED POINT (`computeFinancialsSnapshot`):
 * the Method 3 deficit, the capitalised-interest cash budget and the sweep budget
 * each come from a pass's own cash waterfall and are fed into the next pass until
 * nothing moves (on Marina Gate it lands exactly: another pass changes no cell).
 * Here those three are CIRCULAR FORMULAS, resolved by Excel's iterative
 * calculation, as the reference model does it.
 *
 * ONE SOLVE, WRITTEN ONCE, BUILT TWICE (`solveBlock`), on a hidden working sheet
 * ("Financing Calc"):
 *   - the FEE-FREE solve, whose total funding requirement is the base every fund
 *     fee is charged on (the platform freezes the fee schedule from a fee-free
 *     pass so a fee can never feed its own base);
 *   - the REAL solve, with those fees, which the statements read.
 * Each block holds, per year: interest capitalised into each asset by land area
 * among the assets under construction; cost of sales on the capex plus that
 * interest; its depreciation on the held assets; the P&L down to tax; cash from
 * operations; the Method 3 waterfall (opening cash, the deficit in a spending
 * year, the management fee drawn from equity, the headroom that pays interest in
 * cash); debt and equity at the method's ratio; the facility (interest on the
 * balance after the draw, paid from the headroom during construction and drawn
 * as debt for the rest, the cash sweep from the surplus above the minimum, the
 * balance repaid at the exit); dividends per phase (payout of the cash above the
 * minimum, capped at the phase's cumulative EBITDA, everything above the floor
 * in the exit year); closing cash.
 *
 * The exit proceeds go live here too (the terminal value: the NOI of the year
 * before the exit over the exit cap rate), because the Method 3 requirement is a
 * sum over every year and a pending exit figure would hold the whole solve.
 *
 * The pending cells of stages 3 to 5 become formulas over the REAL block:
 * capitalised interest (Cost of Sales and the held assets' schedules), interest,
 * the cash flow's financing rows, debt, share capital and the fund fees.
 *
 * REFUSES by name (financing stays as it was): a funding method other than 3, a
 * facility other than one new cash-sweep loan with an interbank rate and spread,
 * existing operations, parcel funding, monthly periods, an operational phase, a
 * terminal value other than the cap rate without growth, dividends on EBITDA, a
 * fund fee charged on NAV or a facility limit, a fund size override, IDC
 * allocated by BUA, a stored sweep or dividend start the sheet does not show.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isRevenueSubUnit, resolveUsefulLifeYears, isLandValueLine } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { planReportLines } from '../../reports/lineRows';
import type { Asset, CostLine, Phase } from '../../state/module1-types';

const CALC = 'Financing Calc';
const CF = 'Cash Flow';
const PL = 'P&L';

type F = (t: number) => string;

export const stage6Financing: LiveLayer = {
  name: 'stage 6a: the circular financing',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const project = state.project;
    const phases = state.phases as Phase[];
    const visible = state.assets.filter((a) => a.visible !== false);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
    const finCfg = project.financing;
    const tranches = state.financingTranches ?? [];
    const fundTerms = resolveFundTerms(project);
    const retCfg = resolveReturnsConfig(project, N);
    const X = retCfg.exitYearOffset;
    const booked = retCfg.terminalMethod !== 'none';
    const values = (note: string) => [{ sheet: 'Financing', status: 'values' as const, formulas: 0, note }];

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    const K = {
      minCash: 'fin|1. Project Financing Settings|Minimum Cash Reserve',
      debtPct: 'fin|2a. Method 3 Configuration|Debt %',
      equityPct: 'fin|2a. Method 3 Configuration|Equity %',
      sweepStart: 'fin|Cash Sweep Settings|Sweep Starting Year (calendar)',
      sweepRatio: 'fin|Cash Sweep Settings|Sweep Ratio (% of excess cash)',
      divOn: 'fin|Dividend Policy|Pay Dividends',
      payout: 'fin|Dividend Policy|Payout Ratio',
      divStart: 'fin|Dividend Policy|Start Year',
      capRate: 'ret|Exit Cap Rate (%)',
    };
    const tr = tranches[0];
    if (finCfg?.fundingMethod !== 3) refuse.push(`funding method ${finCfg?.fundingMethod ?? 'unset'} (only Method 3, cash deficit, is expressed)`);
    if (tranches.length !== 1 || !tr) refuse.push('a number of facilities other than one');
    else {
      if (tr.origin === 'existing') refuse.push('an existing facility');
      if (tr.repaymentMethod !== 'cash_sweep') refuse.push(`repayment method ${tr.repaymentMethod}`);
      if (tr.interbankRatePct === undefined && tr.creditSpreadPct === undefined) refuse.push('a facility rate not stated as interbank plus spread');
      if (tr.cashSweepConfig?.startingYear !== undefined || tr.cashSweepConfig?.sweepRatio !== undefined) refuse.push('a sweep set on the facility rather than the project');
      if (!has(`fin|${tr.name} (new facility)|Interbank Rate %`)) refuse.push('the facility rates are not on the Financing sheet');
    }
    if ((finCfg?.parcelFunding ?? []).length) refuse.push('parcel funding');
    if (project.modelType === 'monthly') refuse.push('monthly periods');
    if (phases.some((p) => p.status === 'operational' || (p.overlapPeriods ?? 0) !== 0)) refuse.push('an operational phase or a phase overlap');
    if (snap.bs.historicalOpeningCashTotal !== 0 || snap.financing.existing.equityTotal !== 0) refuse.push('existing operations');
    if (booked && (retCfg.terminalMethod !== 'cap_rate' || retCfg.applyGrowthToTerminal)) refuse.push(`a terminal value by ${retCfg.terminalMethod}${retCfg.applyGrowthToTerminal ? ' with growth' : ''}`);
    if (booked && X < N - 1) refuse.push('an exit before the last year');
    const dp = project.dividendPolicy;
    if (!dp) refuse.push('no project dividend policy');
    else if (dp.mode === 'pct_of_ebitda') refuse.push('dividends on EBITDA');
    if (fundTerms.enabled) {
      for (const spec of FUND_FEE_SPECS) {
        const v = Number((fundTerms as unknown as Record<string, number>)[spec.key]) || 0;
        if (v !== 0 && (spec.base === 'opening_nav' || spec.base === 'facility_limit')) refuse.push(`a fund fee charged on ${spec.base}`);
        if (v !== 0 && !has(`ft:${spec.label}`)) refuse.push(`the ${spec.label} rate is not on the Inputs sheet`);
      }
      if (fundTerms.fundSizeOverride) refuse.push('a fund size override');
    }
    if ((project.idcConfig?.allocationBasis ?? 'land') !== 'land') refuse.push('capitalised interest allocated by BUA');
    if (project.financing?.cashSweep?.startingYear !== undefined && !has(K.sweepStart)) refuse.push('a sweep start the sheet does not show');
    for (const k of [K.minCash, K.debtPct, K.equityPct, K.payout, K.divOn, K.divStart]) if (!has(k)) refuse.push(`the input ${k.split('|').pop()} is not on the Financing sheet`);
    if (booked && !has(K.capRate)) refuse.push('the exit cap rate is not on the Returns sheet');
    for (const k of ['stc:interest', 'stc:proceeds', 'schg:__project__:dep', `cf|direct||Total Revenue Received`, `pl|__all__||Total Revenue`]) if (!has(k)) refuse.push(`the ${k} cell is not live`);
    if (refuse.length) return values(`The circular financing could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── The working sheet ────────────────────────────────────────────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Financing working sheet: the platform\'s fixed-point financing solve, as circular formulas Excel iterates. Two blocks: the fee-free solve (the fund fee base) and the real one. Hidden.';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    for (let t = 0; t < N; t++) cs.getCell(cr, cT(t)).value = `Year ${t + 1}`;
    cr += 1;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const rng = (r: number, t0 = 0, t1 = N - 1): string => w.rangeA(CALC, r, cT(t0), cT(t1));
    /** A row, one formula per year, cached with the platform's value where one is given. */
    const row = (key: string, label: string, f: F, cached?: readonly number[]): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t), cached ? { cached: cached[t] ?? 0 } : {});
      return r;
    };
    /** A single figure in column C. */
    const cell = (key: string, label: string, formula: () => string, cached?: number): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      w.fA(C(r, 3), formula(), cached !== undefined ? { cached } : {});
      return r;
    };
    const sc3 = (r: number): string => w.refA(C(r, 3));
    const prev = (r: number, t: number): string => (t === 0 ? '0' : at(r, t - 1));
    const sheetAt = (sheet: string, key: string, t: number): string => w.refA({ sheet, row: w.addr(key).row, col: 4 + t });
    const visCell = (sheet: string, key: string, t: number): string => w.refA({ sheet, row: w.addr(key).row, col: pc(t) });
    const sumF = (fs: F[]): F => (t) => fs.map((f) => f(t)).join('+') || '0';
    const zero: F = () => '0';

    // ── Shared pieces (the same in both solves) ──────────────────────────────
    const inp = (k: string, col = PERIOD_COLS.TOTAL_COL): string => w.ref(k, col);
    const minCash = cell('fnc:min', 'minimum cash reserve', () => `MAX(0,N(${inp(K.minCash)}))`);
    const MIN = (): string => sc3(minCash);
    const dFrac = cell('fnc:dF', 'debt share (Method 3)', () => `IF(MAX(0,N(${inp(K.debtPct)}))+MAX(0,N(${inp(K.equityPct)}))>0,MAX(0,N(${inp(K.debtPct)}))/(MAX(0,N(${inp(K.debtPct)}))+MAX(0,N(${inp(K.equityPct)}))),0.7)`);
    const eFrac = cell('fnc:eF', 'equity share (Method 3)', () => `1-${sc3(dFrac)}`);
    const band = `fin|${tr!.name} (new facility)`;
    const rate = cell('fnc:rate', 'facility rate', () => `MAX(0,N(${inp(`${band}|Interbank Rate %`)})+N(${inp(`${band}|Credit Spread %`)}))`);
    const taxRate = cell('fnc:tax', 'tax rate', () => `MAX(0,N(${w.ref('project:taxRate')}))`);
    const AXIS = (): string => w.ref('project:axisYear');
    // Construction end (the facility's): the latest phase offset plus construction years.
    const cend = cell('fnc:cend', 'construction end index', () => `MAX(${phases.map((p) => `MAX(0,YEAR(${w.ref(`phase:${p.id}:start`)})-YEAR(${w.ref('project:startDate')}))+MAX(0,${w.ref(`phase:${p.id}:cp`)})`).join(',')})`);
    const defaultStartYear = (): string => `MAX(YEAR(${w.ref('project:startDate')}),${phases.map((p) => `YEAR(${w.ref(`phase:${p.id}:start`)})+MAX(0,${w.ref(`phase:${p.id}:cp`)})`).join(',')})`;
    // Sweep start: the default follows the phases until someone types a year (then it is stored).
    const sweepStart = cell('fnc:sws', 'sweep start index', () => {
      if (!has(K.sweepStart)) return `MAX(0,MIN(${N - 1},${sc3(cend)}))`;
      const shown = w.platformValue(w.addr(K.sweepStart, PERIOD_COLS.TOTAL_COL));
      const stored = project.financing?.cashSweep?.startingYear;
      const typed = `MAX(0,MIN(${N - 1},N(${inp(K.sweepStart)})-YEAR(${w.ref('project:startDate')})))`;
      return stored !== undefined ? typed : `IF(N(${inp(K.sweepStart)})=${Number(shown)},MAX(0,MIN(${N - 1},${sc3(cend)})),${typed})`;
    });
    const sweepRatio = cell('fnc:swr', 'sweep ratio', () => (has(K.sweepRatio) ? `MAX(0,MIN(1,N(${inp(K.sweepRatio)})))` : '1'));
    const divStart = cell('fnc:dvs', 'dividend start index', () => {
      const shown = w.platformValue(w.addr(K.divStart, PERIOD_COLS.TOTAL_COL));
      const derived = `MAX(0,MIN(${N - 1},${defaultStartYear()}-${AXIS()}))`;
      const typed = `MAX(0,MIN(${N - 1},N(${inp(K.divStart)})-${AXIS()}))`;
      return project.dividendStartYear !== undefined ? typed : `IF(N(${inp(K.divStart)})=${Number(shown)},${derived},${typed})`;
    });
    const divOn = cell('fnc:don', 'dividends on', () => `IF(${inp(K.divOn)}="On",1,0)`);
    const payout = cell('fnc:dvp', 'payout ratio', () => `MAX(0,MIN(1,N(${inp(K.payout)})))`);

    // Capex on the axis, from the Cash Flow's own rows (cash, and in kind).
    const landInKindKey = w.reg.keys().find((k) => k.startsWith('cf|direct||Land In-Kind'));
    const inKind = row('fnc:inkind', 'land in kind', (t) => (landInKindKey ? `-${visCell(CF, landInKindKey, t)}` : '0'));
    const capexCash = row('fnc:capex', 'capex, cash (excl. land in kind)', (t) => `-${visCell(CF, 'cf|direct||Total Capex', t)}-${at(inKind, t)}`);
    const capexAll = row('fnc:capexall', 'capex incl. all land', (t) => `${at(capexCash, t)}+${at(inKind, t)}`);

    // The exit: the NOI of the basis year over the cap rate.
    const rv = (key: string, t: number): string => sheetAt('Revenue Calc', key, t);
    const earner = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const assetRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !earner(a)) return zero;
      if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') return has(`rvc:${l.key}:recPre`) ? (t) => `${rv(`rvc:${l.key}:recPre`, t)}+${rv(`rvc:${l.key}:postRev`, t)}` : zero;
      if (a.strategy === 'Operate') return has(`rvc:${l.key}:total`) ? (t) => rv(`rvc:${l.key}:total`, t) : zero;
      if (a.strategy === 'Lease') return has(`rvc:${l.key}:rev`) ? (t) => rv(`rvc:${l.key}:rev`, t) : zero;
      return zero;
    };
    const assetOpex = (a: Asset): F => (has(`oxc:${a.id}:total`) ? (t) => sheetAt('Opex Calc', `oxc:${a.id}:total`, t) : zero);
    const held = visible.filter((a) => a.strategy === 'Operate' || a.strategy === 'Lease');
    const noi = row('fnc:noi', 'NOI of the held assets', (t) => `${sumF(held.map(assetRev))(t)}-(${sumF(held.map(assetOpex))(t)})`);
    const metricIdx = retCfg.terminalValueBasis === 'exit_year' ? X : Math.max(0, X - 1);
    const proceedsCached = Array.from({ length: N }, (_, t) => (booked && t === X ? snap.disposal.proceeds : 0));
    const proceeds = row('fnc:proceeds', 'exit proceeds (terminal value)', (t) => (booked && t === X
      ? `IF(N(${w.ref(K.capRate, PERIOD_COLS.TOTAL_COL)})<=0.000000001,0,MAX(0,${at(noi, metricIdx)}/N(${w.ref(K.capRate, PERIOD_COLS.TOTAL_COL)})))`
      : '0'), proceedsCached);
    const cfi = row('fnc:cfi', 'cash from investing', (t) => `-${at(capexCash, t)}+${at(proceeds, t)}`);
    // Operating cash that does not depend on the financing (revenue received, escrow, opex paid).
    // The escrow rows print only while non-zero, so an absent one is taken from the Revenue sheet's escrow roll-forward.
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const escrowF: F = (t) => (!has('cf|direct||Less: Inaccessible Funds Locked') && has(escB('Total Additions'))
      ? `-${visCell('Revenue', escB('Total Additions'), t)}-${visCell('Revenue', escB('Less: Release of Locked Funds'), t)}` : '0');
    const opsBase = row('fnc:opsbase', 'operating cash before fees and tax', (t) => `${['cf|direct||Total Revenue Received', 'cf|direct||Less: Inaccessible Funds Locked', 'cf|direct||Add: Release of Inaccessible Funds', 'cf|direct||Total Operating Expenses Paid'].filter(has).map((k) => visCell(CF, k, t)).join('+')}+${escrowF(t)}`);
    const ebitdaBase = row('fnc:ebitdabase', 'revenue less opex (P&L)', (t) => `${visCell(PL, 'pl|__all__||Total Revenue', t)}+${visCell(PL, 'pl|__all__||Total Operating Expenses', t)}`);

    // Capitalised interest: land area and construction window of each non-companion asset.
    const idcAssets = visible.filter((a) => a.isCompanion !== true);
    const sqmOf = (a: Asset): string => (has(`land:${a.id}:sqm`) ? `MAX(0,N(${w.ref(`land:${a.id}:sqm`)}))` : '0');
    const winRow = new Map<string, number>();
    for (const a of idcAssets) {
      const p = phases.find((x) => x.id === a.phaseId);
      if (!p) continue;
      const r = cr++; cs.getCell(r, 1).value = `${a.name}: construction window (start, end), land sqm`; w.claim(`fnc:win:${a.id}`, CALC, r, 1);
      w.fA(C(r, 2), `MAX(0,MIN(${N - 1},YEAR(${w.ref(`phase:${p.id}:start`)})-${AXIS()}))`);
      w.fA(C(r, 3), `IF(${w.ref(`phase:${p.id}:cp`)}>0,MIN(${N - 1},MAX(0,YEAR(${w.ref(`phase:${p.id}:start`)})-${AXIS()})+${w.ref(`phase:${p.id}:cp`)}-1),-1)`);
      w.fA(C(r, 4), sqmOf(a));
      winRow.set(a.id, r);
    }
    const inWin = (a: Asset, t: number): string => { const r = winRow.get(a.id)!; return `AND(${t}>=${w.refA(C(r, 2))},${t}<=${w.refA(C(r, 3))},${w.refA(C(r, 4))}>0)`; };
    const sqmCell = (a: Asset): string => w.refA(C(winRow.get(a.id)!, 4));
    const winAssets = idcAssets.filter((a) => winRow.has(a.id));
    const activeDenom = row('fnc:idcden', 'land sqm of the assets under construction', (t) => winAssets.map((a) => `IF(${inWin(a, t)},${sqmCell(a)},0)`).join('+') || '0');
    const totalDenom = cell('fnc:idctot', 'land sqm of every non-companion asset', () => winAssets.map(sqmCell).join('+') || '0');

    // The cost of sales each Sell plot releases, on its line's recognition.
    const sellParts = visible.filter((a) => has(`cosc:${a.id}:capex`));
    const lineRec = (a: Asset): number | undefined => { const l = lineForAsset(lines, a.id); return l && has(`cosc:${l.key}:rec`) ? w.addr(`cosc:${l.key}:rec`).row : undefined; };
    const CSC = 'Cost of Sales Calc';
    // The held assets' depreciation: start and life.
    const faLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.fixedAssets.byAsset.has(a.id));
    const lifeKeyOf = new Map<string, string>();
    for (const l of faLines) for (const id of l.assetIds) if (has(`schc:${l.assetIds[0]}:life`)) lifeKeyOf.set(id, `schc:${l.assetIds[0]}:life`);
    const heldIdc = held.filter((a) => a.isCompanion !== true);

    // ── ONE SOLVE ────────────────────────────────────────────────────────────
    interface Block {
      idc: Map<string, number>; idcDepProj: number; idcAddHeld: number; idcNbvProj: number; idcDisp: number; intExp: number; interest: number;
      draw: number; idcDraw: number; repay: number; equityDev: number; feeDraw: number; netReq: number; divTotal: number; bal: number; debtBs: number;
      cos: Map<string, number>; tax: number; idcDepByAsset: Map<string, number>; idcNbvByAsset: Map<string, number>;
    }
    const cachedFrom = (tag: string, a: readonly number[] | undefined): readonly number[] | undefined => (tag === 'main' ? a : undefined);
    const solveBlock = (tag: 'ff' | 'main', fee: F, feeByEquity: boolean): Block => {
      const k = (s: string): string => `fnc:${tag}:${s}`;
      const L = (s: string): string => `${tag === 'ff' ? 'fee-free' : 'real'}: ${s}`;
      const fin = snap.financing.combined;
      // Rows the block writes before the rows they read (the circular chain), claimed first.
      const claimRow = (key: string, label: string): number => { const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1); return r; };
      const rInterest = claimRow(k('interest'), L('interest (on the balance after the draw)'));
      const rRunning = claimRow(k('running'), L('construction running (spend and before construction end)'));
      const rBasis = claimRow(k('basis'), L('interest capitalised into the assets'));
      const rHead = claimRow(k('head'), L('headroom above the minimum (pays interest in cash)'));
      const rFromCash = claimRow(k('fromcash'), L('interest paid from cash'));
      const rIdcDraw = claimRow(k('idcdraw'), L('interest drawn as debt'));
      const rDraw = claimRow(k('draw'), L('debt drawn (capex share of the deficit)'));
      const rBalPre = claimRow(k('balpre'), L('balance after the draw'));
      const rSweep = claimRow(k('sweep'), L('cash sweep'));
      const rBal = claimRow(k('bal'), L('balance, closing'));
      const rClose = claimRow(k('close'), L('closing cash (after dividends)'));
      const rDiv = claimRow(k('div'), L('dividends'));

      // Capitalised interest by asset.
      const idc = new Map<string, number>();
      for (const a of winAssets) {
        idc.set(a.id, row(k(`idc:${a.id}`), L(`${a.name}: capitalised interest`), (t) => `IF(${at(rBasis, t)}=0,0,IF(${at(activeDenom, t)}>0,IF(${inWin(a, t)},${at(rBasis, t)}*${sqmCell(a)}/${at(activeDenom, t)},0),IF(${sc3(totalDenom)}>0,${at(rBasis, t)}*${sqmCell(a)}/${sc3(totalDenom)},0)))`,
          cachedFrom(tag, snap.idc.byAsset.get(a.id)?.idcPerPeriod)));
      }
      // Cost of sales per Sell plot: (capex + interest) released on the line's recognition.
      const cos = new Map<string, number>();
      for (const a of sellParts) {
        const rr = lineRec(a);
        const capR = w.addr(`cosc:${a.id}:capex`).row;
        const idcR = idc.get(a.id);
        const B = (): string => `(SUM(${w.rangeA(CSC, capR, 4, 4 + N - 1)})${idcR ? `+SUM(${rng(idcR)})` : ''})`;
        cos.set(a.id, row(k(`cos:${a.id}`), L(`${a.name}: cost of sales`), (t) => (rr === undefined ? '0'
          : `IF(AND(SUM(${w.rangeA(CSC, rr, 4, 4 + N - 1)})>0,${B()}>0),${B()}*(MAX(0,${w.refA({ sheet: CSC, row: rr, col: 4 + t })})/SUM(${w.rangeA(CSC, rr, 4, 4 + N - 1)})),0)`),
          cachedFrom(tag, snap.byAssetCostOfSales.get(a.id)?.cos.perPeriod)));
      }
      const cosTotal = row(k('cos'), L('cost of sales'), (t) => [...cos.values()].map((r) => at(r, t)).join('+') || '0');
      // Depreciation of the interest capitalised into the held assets.
      const idcDepByAsset = new Map<string, number>(), idcNbvByAsset = new Map<string, number>(), idcAddByAsset = new Map<string, number>();
      for (const a of heldIdc) {
        const p = phases.find((x) => x.id === a.phaseId)!;
        const add = idc.get(a.id);
        if (!add) continue;
        const life = (): string => (lifeKeyOf.has(a.id) ? sheetAt('Schedules Calc', lifeKeyOf.get(a.id)!, -1) : String(resolveUsefulLifeYears(a)));
        const vs = row(k(`vs:${a.id}`), L(`${a.name}: vintage start`), (t) => `MAX(${t},MAX(0,YEAR(${w.ref(`phase:${p.id}:start`)})-${AXIS()})+MAX(0,${w.ref(`phase:${p.id}:cp`)}))`);
        const dep = row(k(`idcdep:${a.id}`), L(`${a.name}: interest depreciation`), (t) => `IF(${life()}>0,SUMPRODUCT((${rng(add)}>0)*${rng(add)}/MAX(1,${life()})*(${rng(vs)}<=${t})*(${rng(vs)}+MAX(1,INT(${life()}))>${t})),0)`,
          cachedFrom(tag, snap.idc.byAsset.get(a.id)?.depreciationPerPeriod));
        const nbv = row(k(`idcnbv:${a.id}`), L(`${a.name}: interest NBV`), (t) => `MAX(0,${t === 0 ? '0' : at(cr - 1, t - 1)}+${at(add, t)}-${at(dep, t)})`,
          cachedFrom(tag, snap.idc.byAsset.get(a.id)?.closingNbvPerPeriod));
        idcDepByAsset.set(a.id, dep); idcNbvByAsset.set(a.id, nbv); idcAddByAsset.set(a.id, add);
      }
      const idcDepProj = row(k('idcdep'), L('interest depreciation, held assets'), (t) => [...idcDepByAsset.values()].map((r) => at(r, t)).join('+') || '0');
      const idcAddHeld = row(k('idcadd'), L('interest capitalised into held assets'), (t) => [...idcAddByAsset.values()].map((r) => at(r, t)).join('+') || '0');
      const idcNbvProj = row(k('idcnbv'), L('interest NBV, held assets'), (t) => [...idcNbvByAsset.values()].map((r) => at(r, t)).join('+') || '0');
      const idcDisp = row(k('idcdisp'), L('interest NBV disposed at the exit'), (t) => (booked && t === X ? at(idcNbvProj, t) : '0'));
      // The P&L down to tax.
      const capexDep: F = (t) => sheetAt('Schedules Calc', 'schg:__project__:dep', t);
      const disposedFixed: F = (t) => ['schg:__project__:land:disp', 'schg:__project__:cap:disp'].filter(has).map((kk) => sheetAt('Schedules Calc', kk, t)).join('+') || '0';
      const intExp = row(k('intexp'), L('interest expensed'), (t) => `${at(rInterest, t)}-${at(rBasis, t)}`, cachedFrom(tag, snap.pl.interestExpensePerPeriod));
      const gain = row(k('gain'), L('gain on disposal'), (t) => (booked && t === X ? `${at(proceeds, t)}-(${disposedFixed(t)})-${at(idcDisp, t)}` : '0'));
      const pbt = row(k('pbt'), L('profit before tax'), (t) => `${at(ebitdaBase, t)}-${at(cosTotal, t)}-(${fee(t)})-${capexDep(t)}-${at(idcDepProj, t)}-${at(intExp, t)}+${at(gain, t)}`);
      const taxed = project.tax?.applyToDisposalGain === true;
      const tax = row(k('tax'), L('tax'), (t) => `MAX(0,${at(pbt, t)}${taxed ? '' : `-${at(gain, t)}`})*${sc3(taxRate)}`, cachedFrom(tag, snap.pl.taxPerPeriod));
      const cfo = row(k('cfo'), L('cash from operations'), (t) => `${at(opsBase, t)}-(${fee(t)})-${at(tax, t)}`, cachedFrom(tag, snap.directCF.cashFromOperationsPerPeriod));
      // Method 3: the waterfall.
      const rOpen = claimRow(k('open'), L('opening cash (waterfall)'));
      const cashAvail = row(k('avail'), L('cash before new funding'), (t) => `${at(rOpen, t)}+${at(cfo, t)}${feeByEquity ? `+(${fee(t)})` : ''}+${at(cfi, t)}`);
      const spending: F = (t) => `(${at(cfi, t)}<-0.005)`;
      const netReq = row(k('netreq'), L('development funding need'), (t) => `IF(${spending(t)},MAX(0,${MIN()}-${at(cashAvail, t)}),0)`);
      const afterBase: F = (t) => `(${at(cashAvail, t)}+${at(netReq, t)})`;
      const feeDraw = row(k('feedraw'), L('fund fee drawn from equity'), (t) => (feeByEquity ? `IF(AND(${spending(t)},(${fee(t)})>0),MIN(${fee(t)},MAX(0,${MIN()}-(${afterBase(t)}-(${fee(t)})))),0)` : '0'));
      const afterFee: F = (t) => (feeByEquity ? `(${afterBase(t)}-(${fee(t)})+${at(feeDraw, t)})` : afterBase(t));
      for (let t = 0; t < N; t++) {
        w.fA(C(rOpen, cT(t)), t === 0 ? '0' : afterFee(t - 1));
        w.fA(C(rHead, cT(t)), `MAX(0,${afterFee(t)}-${MIN()})`);
      }
      // Funding at the ratio (the deficit when there is one, capex otherwise).
      const gapTot = cell(k('gaptot'), L('total development funding need'), () => `SUM(${rng(netReq)})`);
      const firstCapex = cell(k('first'), L('first year with capex'), () => `IFERROR(MATCH(TRUE,INDEX(${rng(capexCash)}>0,0),0)-1,0)`);
      const minAt: F = (t) => `IF(${t}=${sc3(firstCapex)},${MIN()},0)`;
      const nonLand = row(k('nonland'), L('capex excl. land (fallback split)'), (t) => `MAX(0,${at(capexCash, t)}-(${landCashF(t)}))`);
      const debtRow = row(k('debt'), L('debt requirement'), (t) => `IF(${sc3(gapTot)}>0,${at(netReq, t)}*${sc3(dFrac)},(${at(nonLand, t)}+${minAt(t)})*${sc3(dFrac)})`, cachedFrom(tag, snap.financing.debtEquitySplit.debt));
      const equityDev = row(k('equity'), L('equity requirement'), (t) => `IF(${sc3(gapTot)}>0,${at(netReq, t)}*${sc3(eFrac)},(${at(nonLand, t)}+${minAt(t)})*${sc3(eFrac)}+${landCashF(t)})`, cachedFrom(tag, snap.financing.equity.developmentPerPeriod));
      // The facility.
      const snapTol = cell(k('snaptol'), L('balance snap tolerance'), () => `MAX(1,MIN(1000,SUM(${rng(rDraw)})*0.0001))`);
      for (let t = 0; t < N; t++) {
        w.fA(C(rDraw, cT(t)), `MAX(0,${at(debtRow, t)})`, cachedFrom(tag, fin.totalDrawdown) ? { cached: fin.totalDrawdown[t] ?? 0 } : {});
        w.fA(C(rBalPre, cT(t)), `${prev(rBal, t)}+${at(rDraw, t)}`);
        w.fA(C(rInterest, cT(t)), `${at(rBalPre, t)}*${sc3(rate)}`, tag === 'main' ? { cached: fin.totalInterestAccrued[t] ?? 0 } : {});
        w.fA(C(rRunning, cT(t)), `IF(AND(${t}<${sc3(cend)},${at(capexAll, t)}>0),1,0)`);
        w.fA(C(rBasis, cT(t)), `IF(${at(rRunning, t)}=1,${at(rInterest, t)},0)`, tag === 'main' ? { cached: fin.totalInterestForAssetBasis[t] ?? 0 } : {});
        w.fA(C(rFromCash, cT(t)), `IF(${at(rRunning, t)}=1,MIN(${at(rInterest, t)},MAX(0,${at(rHead, t)})),0)`);
        w.fA(C(rIdcDraw, cT(t)), `IF(${at(rRunning, t)}=1,${at(rInterest, t)}-${at(rFromCash, t)},0)`, tag === 'main' ? { cached: fin.totalIdcDrawdown[t] ?? 0 } : {});
      }
      // THE SWEEP BUDGET: the cash above the minimum before this year's sweep and
      // dividends. The platform reads it off its converged snapshot as closing cash
      // + this year's sweep + this year's dividends; written that way here, the sweep
      // reads itself one iteration late and Excel oscillates between two states
      // (sweep the debt, or pay it out as a dividend). So it is built from its parts:
      // last year's closing cash before dividends, plus this year's operating,
      // investing and financing cash EXCLUDING the sweep, less the dividends already
      // paid. The same quantity at the fixed point, with no self-reference.
      const balA: F = (t) => `(${at(rBalPre, t)}+${at(rIdcDraw, t)})`;
      const rCffEx = claimRow(k('cffex'), L('cash from financing before the sweep and dividends'));
      const rPreSweep = claimRow(k('presweep'), L("cash before this year's sweep and dividends"));
      const rClosePre = claimRow(k('closepre'), L('closing cash before dividends'));
      for (let t = 0; t < N; t++) {
        const avail = `MAX(0,${at(rPreSweep, t)}-${MIN()})`;
        w.fA(C(rSweep, cT(t)), `IF(AND(${t}>=${sc3(sweepStart)},${balA(t)}>0),MIN(${balA(t)},${avail}*${sc3(sweepRatio)},${avail}),0)`, tag === 'main' ? { cached: fin.totalSweepRepaid[t] ?? 0 } : {});
        w.fA(C(rBal, cT(t)), `IF(ABS(${balA(t)}-${at(rSweep, t)})<${sc3(snapTol)},0,${balA(t)}-${at(rSweep, t)})`);
      }
      const exitRepay = row(k('exitrepay'), L('debt repaid at the exit'), (t) => (booked && t === X ? `MAX(0,${at(rBal, t)})` : '0'));
      const repay = row(k('repay'), L('principal repaid (sweep and exit)'), (t) => `${at(rSweep, t)}+${at(exitRepay, t)}`);
      // Cash: before dividends, then the waterfall of dividends by phase.
      const cumDiv: F = (t) => (t === 0 ? '0' : `SUM(${rng(rDiv, 0, t - 1)})`);
      for (let t = 0; t < N; t++) {
        w.fA(C(rCffEx, cT(t)), `${at(equityDev, t)}+${at(feeDraw, t)}+${at(rDraw, t)}+${at(rIdcDraw, t)}-${at(exitRepay, t)}-${at(rInterest, t)}`);
        w.fA(C(rPreSweep, cT(t)), `${prev(rClosePre, t)}+${at(cfo, t)}+${at(cfi, t)}+${at(rCffEx, t)}-(${cumDiv(t)})`);
        w.fA(C(rClosePre, cT(t)), `${prev(rClosePre, t)}+${at(cfo, t)}+${at(cfi, t)}+${at(rCffEx, t)}-${at(rSweep, t)}`);
      }
      const closePre = rClosePre;
      const cashBefore = row(k('cashbefore'), L('cash before this year\'s dividends'), (t) => `${at(closePre, t)}-(${cumDiv(t)})`);
      const excess0 = row(k('excess'), L('cash above the minimum'), (t) => `MAX(0,${at(cashBefore, t)}-${MIN()})`);
      // Phase EBITDA (revenue less cost of sales less opex, its own assets).
      const phaseDiv: number[] = [];
      for (const p of phases) {
        const pa = visible.filter((a) => a.phaseId === p.id);
        const eb = row(k(`ebitda:${p.id}`), L(`${p.name}: EBITDA`), (t) => `${sumF(pa.map(assetRev))(t)}-(${pa.map((a) => (cos.has(a.id) ? at(cos.get(a.id)!, t) : '0')).join('+') || '0'})-(${sumF(pa.map(assetOpex))(t)})`);
        const d = claimRow(k(`div:${p.id}`), L(`${p.name}: dividend`));
        const before = [...phaseDiv];
        for (let t = 0; t < N; t++) {
          const ex = `(${at(excess0, t)}${before.map((r) => `-${at(r, t)}`).join('')})`;
          const budget = `MAX(0,SUM(${rng(eb, 0, t)})-(${t === 0 ? '0' : `SUM(${rng(d, 0, t - 1)})`}))`;
          w.fA(C(d, cT(t)), `IF(AND(${sc3(divOn)}=1,${t}>=${sc3(divStart)},${sc3(payout)}>0,${ex}>0),MIN(${ex}*${sc3(payout)},${ex},${budget}),0)`);
        }
        phaseDiv.push(d);
      }
      for (let t = 0; t < N; t++) {
        const phaseSum = phaseDiv.map((r) => at(r, t)).join('+') || '0';
        const terminal = t === X ? `+IF(AND(${sc3(divOn)}=1,${at(excess0, t)}>0),MAX(0,${at(cashBefore, t)}-(${phaseSum})),0)` : '';
        w.fA(C(rDiv, cT(t)), `${phaseSum}${terminal}`, tag === 'main' ? { cached: snap.dividends.totalDividendsPerPeriod[t] ?? 0 } : {});
        w.fA(C(rClose, cT(t)), `${at(cashBefore, t)}-${at(rDiv, t)}`, tag === 'main' ? { cached: snap.directCF.closingCashPerPeriod[t] ?? 0 } : {});
      }
      const debtBs = row(k('debtbs'), L('debt outstanding (balance sheet)'), (t) => (booked && t >= X ? '0' : at(rBal, t)), cachedFrom(tag, snap.bs.debtOutstandingPerPeriod));
      return { idc, idcDepProj, idcAddHeld, idcNbvProj, idcDisp, intExp, interest: rInterest, draw: rDraw, idcDraw: rIdcDraw, repay, equityDev, feeDraw, netReq, divTotal: rDiv, bal: rBal, debtBs, cos, tax, idcDepByAsset, idcNbvByAsset };
    };
    // Land cash per period (the fallback split's land): the land value lines, cash half, from the Capex working sheet.
    const P0 = w.addr('cxc:P0').col;
    const landKeys = w.reg.keys().filter((kk) => kk.startsWith('cxc:') && kk.split(':').length === 3 && !kk.startsWith('cxc:ph:')
      && isLandValueLine((state.costLines as CostLine[]).find((x) => x.id === kk.split(':')[2]) ?? { id: kk.split(':')[2] })
      && w.platformValue({ sheet: 'Capex Calc', row: w.addr(kk).row, col: 3 }) !== 'percent_of_inkind_land'
      && visible.some((a) => kk.startsWith(`cxc:${a.id}:`)));
    const landCashRow = row('fnc:landcash', 'land cash', (t) => landKeys.map((kk) => w.refA({ sheet: 'Capex Calc', row: w.addr(kk).row, col: P0 + t })).join('+') || '0');
    const landCashF: F = (t) => at(landCashRow, t);

    // ── The two solves ───────────────────────────────────────────────────────
    const ff = solveBlock('ff', zero, false);
    // The fee schedule, from the fee-free requirement (frozen before the real solve).
    const feeByEquity = fundTerms.enabled && fundTerms.managementFeeFunding === 'equity';
    const feeRows: number[] = [];
    let feeTotal: F = zero;
    if (fundTerms.enabled) {
      const R = cell('fnc:fee:base', 'fund size: the fee-free funding requirement', () => `SUM(${rng(ff.netReq)})`, snap.fundFees.fundSize.amount);
      const baseOf = (base: string): string => (base === 'fund_size' ? sc3(R) : base === 'total_equity' ? `${sc3(R)}*${sc3(eFrac)}` : base === 'debt_facility' ? `${sc3(R)}*${sc3(dFrac)}` : '0');
      FUND_FEE_SPECS.forEach((spec, i) => {
        const inputCell = (): string => (has(`ft:${spec.label}`) ? `N(${w.ref(`ft:${spec.label}`)})` : '0');
        feeRows.push(row(`fnc:fee:${i}`, `${spec.label}`, (t) => {
          if (booked && t > X) return '0';
          if (spec.kind === 'amount') return spec.timing === 'one_time' ? (t === 0 ? inputCell() : '0') : inputCell();
          if (spec.timing === 'one_time') return t === 0 ? `${inputCell()}*${baseOf(spec.base)}` : '0';
          return `${inputCell()}*${baseOf(spec.base)}`;
        }, snap.fundFees.lines[i]?.amountPerPeriod));
      });
      feeTotal = (t) => feeRows.map((r) => at(r, t)).join('+');
      // The resolved capital bases on the Inputs sheet.
      for (const [label, f] of [['Fund size', () => sc3(R)], ['Capex equity', () => `${sc3(R)}*${sc3(eFrac)}`], ['Debt facility', () => `${sc3(R)}*${sc3(dFrac)}`]] as Array<[string, () => string]>) {
        const key = w.reg.keys().find((kk) => kk.startsWith(`ftcap:${label}`));
        if (key) w.f(key, f());
      }
    }
    const main = solveBlock('main', feeTotal, feeByEquity);
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;
    // A CIRCULAR CELL NEEDS A STARTING VALUE. Excel iterates a loop from each cell's
    // cached result; a formula written with none enters the first pass with nothing
    // to start from and the loop never recovers. Every working cell that carries no
    // platform value starts from 0.
    cs.eachRow((r) => r.eachCell((c) => {
      const v = c.value as unknown as { formula?: string; result?: unknown } | null;
      if (v && typeof v === 'object' && 'formula' in v && (v.result === undefined || v.result === null)) c.value = { formula: v.formula, result: 0 } as never;
    }));

    // ── The pending cells of stages 3 to 5 become formulas over the real solve ─
    const live = (key: string, f: F, col0 = 4): void => {
      if (!has(key)) return;
      const a = w.addr(key);
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: col0 + t }, f(t));
    };
    for (const [id, r] of main.idc) live(`cosc:${id}:idc`, (t) => `MAX(0,${at(r, t)})`);
    for (const [id, r] of main.idc) live(`schc:${id}:idcAdd`, (t) => at(r, t));
    for (const [id, r] of main.idcDepByAsset) live(`schc:${id}:idcDep`, (t) => at(r, t));
    for (const [id, r] of main.idcNbvByAsset) live(`schc:${id}:idcClose`, (t) => at(r, t));
    live('schg:__project__:idcAdd', (t) => at(main.idcAddHeld, t));
    live('schg:__project__:idcDep', (t) => at(main.idcDepProj, t));
    live('schg:__project__:idcClose', (t) => at(main.idcNbvProj, t));
    live('stc:interest', (t) => at(main.intExp, t));
    live('stc:proceeds', (t) => at(proceeds, t));
    feeRows.forEach((r, i) => live(`stc:fee:${i}`, (t) => at(r, t)));
    live('stc:bs:debt', (t) => at(main.debtBs, t));
    live('stc:bs:share', (t) => `${Math.max(0, project.shareCapital ?? 0)}+SUM(${rng(main.equityDev, 0, t)})+SUM(${rng(main.feeDraw, 0, t)})+SUM(${rng(inKind, 0, t)})`);
    const cfPending = (label: string, f: F): void => live(`stc:cf:${label}`, f);
    cfPending('Equity Drawdown, development', (t) => at(main.equityDev, t));
    cfPending('Equity Drawdown (Cash)', (t) => `${at(main.equityDev, t)}+${at(main.feeDraw, t)}`);
    cfPending('Equity Drawdown, management fee', (t) => at(main.feeDraw, t));
    cfPending(`Debt Drawdown, New loans`, (t) => `${at(main.draw, t)}+${at(main.idcDraw, t)}`);
    cfPending(`Debt Repayment, New loans`, (t) => `-${at(main.repay, t)}`);
    cfPending(`Interest Paid, New loans`, (t) => `-${at(main.interest, t)}`);
    cfPending('Dividends paid', (t) => `-${at(main.divTotal, t)}`);

    // The Financing sheet's own status is set by the layer that makes its tables live (stage6bFinancingSheet).
    return [];
  },
};
