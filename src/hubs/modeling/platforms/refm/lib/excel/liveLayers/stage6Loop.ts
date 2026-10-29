/**
 * stage6Loop.ts (2026-10-15, rebuilt 2026-10-29), FORMULA-LINKED EXPORT, STAGE 6: THE FINANCING
 * LOOP, ON THE FINANCING TAB.
 *
 * The platform solves the financing to a FIXED POINT (`computeFinancialsSnapshot`): the funding
 * need, the capitalised-interest cash budget, the sweep budget and (on a fund) the fee base each
 * come from a pass's own cash and feed the next until nothing moves. Here they are circular
 * formulas Excel iterates, ONE LOOP written into the rows `financingPlan` lays out: operating cash,
 * the funding need, the equity and debt drawn, each facility's interest and interest drawn as debt,
 * its repayment or sweep, zakat inside the loop, the fund fees, the dividends by phase and closing
 * cash, each worked out once (2026-10-29, founder: the fee-free second loop is gone, the platform
 * sizes the fees on this same solve).
 *
 * THE LOOP READS ONLY EARLIER TABS AND INPUTS (Revenue's cash collected, Opex's cash paid, Capex,
 * escrow, Schedules' cost of sales and depreciation), never the statements, except each phase's
 * dividend cap, which links to the phase P&L's EBITDA (2026-10-25). Checks proves its profit before
 * zakat equals the P&L every year. ITS ONE BACKWARD LINK: the capitalised interest each line takes,
 * which Schedules and Capex Table 7 read; those rows say "Feeds Schedules (interest loop)".
 *
 * REFUSES by name (Financing stays the platform's values): a funding method other than 1 to 3, a
 * facility other than new loans (and existing ones raised inside the model) at an interbank rate
 * plus spread, a repayment method the sheet does not show, parcel funding that varies within a
 * phase or is deferred, monthly periods, an operational phase or overlap, existing operations, a
 * terminal value the sheet does not state, a per-phase dividend policy, a fund fee on NAV or a
 * facility limit, interest allocated by GFA.
 *
 * No em dashes in this file.
 */
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { terminalRefusal, terminalValueFormula } from './terminal';
import { citReliefF, citPoolF, taxF } from './taxRule';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { buildFixedAssetReport, idcRowIsHeld } from '../../reports/fixedAssetReports';
import { disposalContextOf } from '../../reports/disposalSchedules';
import { financingPlan, facilityKind, orderedFacilities } from './financingPlan';
import type { Asset, Phase } from '../../state/module1-types';

const FIN = 'Financing';
type F = (t: number) => string;

/** Repayment the live solve expresses: the sweep, and the fixed-count schedules (computeFacilitySchedule). */
const LIVE_REPAYMENT = new Set(['cash_sweep', 'equal_repayment', 'straight_line', 'equal_periodic_amortization', 'bullet', 'year_on_year_pct']);

/**
 * THE LOOP'S FIGURES BY KEY, FOR THE LAYERS AFTER IT. A key is claimed at its visible row; where the
 * row prints the figure as an outflow (negative) the reader negates it here, so every reader sees
 * the quantity the key names.
 */
export const LOOP_NEGATIVE = new Set(['fnc:main:repay', 'fnc:main:intexp', 'fnc:main:div', 'fnc:main:sched', 'fnc:main:idcdisp']);
export function loopAt(w: LiveWriter, key: string, t: number): string {
  const r = w.perP(key, t);
  return LOOP_NEGATIVE.has(key) ? `(-${r})` : r;
}
/** A single figure of the loop (its Total column), or the Inputs setting it names. */
export function loopOne(w: LiveWriter, key: string): string {
  if (key === 'fnc:don') return `IF(N(${w.ref('fin:in:divOn')})=1,1,0)`;
  if (key === 'fnc:min') return `MAX(0,N(${w.ref('fin:in:min')}))`;
  return w.one(key);
}

export const stage6Loop: LiveLayer = {
  name: 'stage 6: the financing loop',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { OPEN_COL, TOTAL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const project = state.project;
    const labels = getFinancialLabels(project.financialTerminology ?? defaultTerminologyForCountry(project.country));
    const phases = state.phases as Phase[];
    const visible = state.assets.filter((a) => a.visible !== false);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
    const finCfg = project.financing;
    const tranches = orderedFacilities(state.financingTranches ?? []);
    const fundTerms = resolveFundTerms(project);
    const retCfg = resolveReturnsConfig(project, N);
    const booked = retCfg.terminalMethod !== 'none';
    const values = (note: string) => [{ sheet: FIN, status: 'values' as const, formulas: 0, note }];
    const { ctx: pc0 } = financingPlan(state, snap);
    const METHOD = pc0.method;
    const feeOn = pc0.feeOn, byEq = pc0.feeByEquity;

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (![1, 2, 3].includes(METHOD)) refuse.push(`funding method ${METHOD} (specified debt and equity amounts)`);
    if (!tranches.length) refuse.push('no facility');
    const psyNum = snap.projectStartYear;
    for (const t of tranches) {
      if (t.origin === 'existing' && !(Number.isFinite(t.originationYear) && (t.originationYear as number) >= psyNum && (t.originationYear as number) < psyNum + N)) refuse.push('an existing loan raised before the model starts (existing operations)');
      if (!LIVE_REPAYMENT.has(t.repaymentMethod)) refuse.push(`repayment method ${t.repaymentMethod}`);
      if (t.interbankRatePct === undefined && t.creditSpreadPct === undefined) refuse.push('a facility rate not stated as interbank plus spread');
      if (t.cashSweepConfig?.startingYear !== undefined || t.cashSweepConfig?.sweepRatio !== undefined) refuse.push('a sweep set on the facility rather than the project');
      if (!has(`trib:${t.id}`) || !has(`trsp:${t.id}`) || !has(`trrate:${t.id}`)) refuse.push(`the rates of ${t.name} are not on Inputs`);
      const k = facilityKind(t);
      if (k !== 'sweep' && !has(`fin:in:tr:${t.id}:start`)) refuse.push(`the repayment start of ${t.name} is not on Inputs`);
      if (k !== 'sweep' && k !== 'yoy' && !has(`fin:in:tr:${t.id}:n`)) refuse.push(`the repayment periods of ${t.name} are not on Inputs`);
      if (k === 'yoy') {
        if (!has(`yoy:${t.id}`)) refuse.push(`the year-on-year schedule of ${t.name} is not on Inputs`);
        const start = t.repaymentStartYear ?? 0;
        const room = start ? N - (start - psyNum) : N;
        if ((t.yearOnYearPctSchedule ?? []).some((v, i) => i >= room && (v ?? 0) > 0)) refuse.push(`a year-on-year schedule of ${t.name} longer than the years the workbook shows`);
      }
      if (t.origin === 'existing' && !['open', 'orig', 'intStart'].every((x) => has(`fin:in:tr:${t.id}:${x}`))) refuse.push(`the terms of the existing loan ${t.name} are not on Inputs`);
    }
    if (new Set(tranches.map((t) => t.name)).size !== tranches.length) refuse.push('two facilities with the same name');
    const pf = finCfg?.parcelFunding ?? [];
    if (pf.some((c) => c.fundingType === 'deferred_payment')) refuse.push('a plot paid on a deferred schedule');
    const typedSplit = (c: { debtPct?: number; equityPct?: number }): boolean => typeof c.debtPct === 'number' || typeof c.equityPct === 'number';
    if (METHOD !== 3) for (const ph of phases) {
      const cfgs = (state.parcels as Array<{ id: string; phaseId?: string }>).filter((p) => p.phaseId === ph.id).map((p) => pf.find((c) => c.parcelId === p.id));
      const typed = cfgs.filter((c): c is NonNullable<typeof c> => !!c && typedSplit(c));
      if (typed.length && (typed.length !== cfgs.length || typed.some((c) => c.debtPct !== typed[0].debtPct || c.equityPct !== typed[0].equityPct))) refuse.push(`${ph.name}'s plots state different land funding splits`);
    }
    if (project.modelType === 'monthly') refuse.push('monthly periods');
    if (phases.some((p) => p.status === 'operational' || (p.overlapPeriods ?? 0) !== 0)) refuse.push('an operational phase or a phase overlap');
    if (snap.bs.historicalOpeningCashTotal !== 0 || snap.financing.existing.equityTotal !== 0) refuse.push('existing operations');
    { const why = booked ? terminalRefusal(retCfg, has) : null; if (why) refuse.push(why); }
    if (booked && !has('tl:flag:exit')) refuse.push('the Timeline shows no exit year');
    if (booked && !has('ret:tvBasis')) refuse.push('the terminal value basis is not on Inputs');
    if (!project.dividendPolicy && phases.some((ph) => ph.dividendPolicy?.enabled === true)) refuse.push('a per-phase dividend policy (set one project policy on Financing)');
    if (feeOn) {
      for (const spec of FUND_FEE_SPECS) {
        const v = Number((fundTerms as unknown as Record<string, number>)[spec.key]) || 0;
        if (v !== 0 && (spec.base === 'opening_nav' || spec.base === 'facility_limit')) refuse.push(`a fund fee charged on ${spec.base}`);
        if (v !== 0 && !has(`ft:${spec.label}`)) refuse.push(`the ${spec.label} rate is not on the Inputs sheet`);
      }
      if (fundTerms.fundSizeOverride && !has('ft:Fund size (typed target)')) refuse.push('a fund size override the Inputs sheet does not state as a number');
    }
    if ((project.idcConfig?.allocationBasis ?? 'land') !== 'land') refuse.push('capitalised interest allocated by GFA');
    for (const k of ['fin:in:debt', 'fin:in:equity', 'fin:in:min', 'fin:in:divOn', 'fin:in:payout', 'fin:in:divStart']) if (!has(k)) refuse.push(`the ${k} cell is not on Inputs`);
    if (pc0.anySweep && !(has('fin:in:sweepStart') && has('fin:in:sweepRatio'))) refuse.push('the sweep settings are not on Inputs');
    for (const k of ['cx2:total', 'cx5:total:cash', 'cx5:total:inkind', 'schv:__project__:dep', 'rev|__project__|sum-cash|Total cash collected', 'ox|ap|paid', 'fl:capex', 'fl:need', 'fl:close']) if (!has(k)) refuse.push(`the ${k} row is not live`);
    if (refuse.length) return values(`The financing could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers ──────────────────────────────────────────────────────
    const here = FIN;
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** Year t of a row (dt = -1: the year before), column relative. */
    const P = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    /** The Total (or the setting) of a Financing row. */
    const T = (key: string): string => { const a = w.addr(key); return w.refA({ sheet: a.sheet, row: a.row, col: TOTAL_COL }, here); };
    /** An Inputs cell (or any single registered cell), absolute. */
    const IN = (key: string): string => w.refA(w.addr(key), here);
    const rowRange = (key: string): string => { const a = w.addr(key); return w.rangeA(a.sheet, a.row, pc(0), pc(N - 1)); };
    const toNow = (key: string, t: number): string => { const a = w.addr(key); w.refP({ sheet: a.sheet, row: a.row, col: pc(t) }, here); return `${a.sheet === here ? '' : `'${a.sheet}'!`}$${colOf(pc(0))}$${a.row}:${colOf(pc(t))}$${a.row}`; };
    const toPrev = (key: string, t: number): string => { const a = w.addr(key); w.refP({ sheet: a.sheet, row: a.row, col: pc(t) - 1 }, here); return `${a.sheet === here ? '' : `'${a.sheet}'!`}$${colOf(OPEN_COL)}$${a.row}:${colOf(pc(t) - 1)}$${a.row}`; };
    const Y = (t: number): string => w.refP({ sheet: FIN, row: 3, col: pc(t) }, here);
    const Y0 = (): string => w.refA({ sheet: FIN, row: 3, col: pc(0) }, here);
    const YN = (): string => w.refA({ sheet: FIN, row: 3, col: pc(N - 1) }, here);
    const yearRow = (): string => w.rangeA(FIN, 3, pc(0), pc(N - 1));
    const exitF = (t: number): string => (booked ? P('tl:flag:exit', t) : '0');
    /** 1 up to and including the exit year, 0 after it (the fund stops charging at the exit). */
    const alive = (t: number): string => (booked ? `(1-SUM(${toPrev('tl:flag:exit', t)}))` : '1');
    const put = (key: string | undefined, f: F, tot: 'sum' | 'last' | 'none' = 'sum'): void => {
      if (!key || !has(key)) return;
      const a = w.addr(key);
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: pc(t) }, f(t));
      const Tc = { sheet: a.sheet, row: a.row, col: TOTAL_COL };
      if (tot === 'sum') w.fA(Tc, `SUM(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))})`);
      else if (tot === 'last') w.fA(Tc, w.refA({ sheet: a.sheet, row: a.row, col: pc(N - 1) }, here));
    };
    const putS = (key: string | undefined, formula: string): void => { if (key && has(key)) w.fA({ sheet: w.addr(key).sheet, row: w.addr(key).row, col: TOTAL_COL }, formula); };
    /** A note on a total inside the loop: its rows are added with + (a SUM leaves Excel's iteration at #VALUE!). */
    const why = (key: string | undefined, text: string): void => {
      if (!key || !has(key)) return;
      const c: ExcelJS.Cell = w.cellA(w.addr(key));
      c.note = { texts: [{ text }] } as ExcelJS.Comment;
    };
    const claim = (name: string, key: string | undefined): void => { if (key && has(key)) { const a = w.addr(key); w.claim(name, a.sheet, a.row, 1); } };
    const MIN = (): string => `MAX(0,N(${IN('fin:in:min')}))`;
    const chain = (keys: Array<string | undefined>, t: number): string => keys.filter((k): k is string => !!k && has(k)).map((k) => P(k, t)).join('+') || '0';
    const CHAIN = 'Not a SUM: inside the financing loop a total adds its rows with + (Excel\'s iteration stalls on SUM there).';

    // ── Settings in force ────────────────────────────────────────────────────
    const psd = (): string => `YEAR(${w.ref('project:startDate')})`;
    putS('fl:lastCon', `MAX(${phases.map((p) => `MAX(0,YEAR(${w.ref(`tl:phase:${p.id}:cs`)})-${psd()})+MAX(0,${w.ref(`tl:phase:${p.id}:cp`)})`).join(',')})+${psd()}-1`);
    const lastCon = (): string => T('fl:lastCon');
    const D = (): string => `MAX(0,N(${IN('fin:in:debt')}))`, E = (): string => `MAX(0,N(${IN('fin:in:equity')}))`;
    putS('fl:dF', `IF(${D()}+${E()}>0,${D()}/(${D()}+${E()}),0.7)`);
    putS('fl:eF', `1-${T('fl:dF')}`);
    const dF = (): string => T('fl:dF'), eF = (): string => T('fl:eF');
    if (has('fl:landDebt')) {
      const shareOf = (parcel: { id: string; phaseId?: string }): string => {
        const c = pf.find((x) => x.parcelId === parcel.id);
        if (!c) return '0';
        const dk = `fin:in:land:${parcel.phaseId}:debt`, ek = `fin:in:land:${parcel.phaseId}:equity`;
        if (typedSplit(c) && has(dk) && has(ek)) { const d = `MAX(0,N(${IN(dk)}))`, e = `MAX(0,N(${IN(ek)}))`; return `IF(${d}+${e}>0,${d}/(${d}+${e}),0)`; }
        if (c.fundingType === '100pct_debt') return '1';
        if (c.fundingType !== 'custom_split') return '0';
        const dd = Math.max(0, c.customDebtPct ?? 0), ee = Math.max(0, c.customEquityPct ?? 100 - (c.customDebtPct ?? 0));
        return String(dd + ee > 0 ? dd / (dd + ee) : 0);
      };
      const plots = (state.parcels as Array<{ id: string; phaseId?: string }>).filter((x) => has(`parcel:${x.id}:cashValue`));
      const cv = (x: { id: string }): string => `MAX(0,N(${w.ref(`parcel:${x.id}:cashValue`)}))`;
      const tot = plots.map(cv).join('+');
      putS('fl:landDebt', plots.length ? `IF((${tot})>0,(${plots.map((x) => `${cv(x)}*${shareOf(x)}`).join('+')})/(${tot}),0)` : '0');
    }
    if (has('fl:sweepStart')) { const s = IN('fin:in:sweepStart'); putS('fl:sweepStart', `IF(ISNUMBER(${s}),MAX(${Y0()},MIN(${YN()},${s})),MAX(${Y0()},MIN(${YN()},${lastCon()}+1)))`); }
    {
      const dflt = `MAX(${Y0()},MIN(${YN()},MAX(${psd()},${phases.map((p) => `YEAR(${w.ref(`tl:phase:${p.id}:cs`)})+MAX(0,${w.ref(`tl:phase:${p.id}:cp`)})`).join(',')})))`;
      const d = IN('fin:in:divStart');
      putS('fl:divStart', `IF(ISNUMBER(${d}),MAX(${Y0()},MIN(${YN()},${d})),${dflt})`);
    }
    const sweepRatio = (): string => `MAX(0,MIN(1,N(${IN('fin:in:sweepRatio')})))`;
    const divOn = (): string => `IF(N(${IN('fin:in:divOn')})=1,1,0)`;
    const payout = (): string => `MAX(0,MIN(1,N(${IN('fin:in:payout')})))`;
    const onEbitda = project.dividendPolicy?.mode === 'pct_of_ebitda';

    // ── The facilities, in the order the engine consumes the shared budgets ────
    const newCount = Math.max(1, tranches.filter((t) => t.origin !== 'existing').length);
    const anyShareTyped = tranches.some((t) => t.origin !== 'existing' && typeof t.facilitySharePct === 'number');
    const fac = tranches.map((t) => {
      const K = (s: string): string => `fl:tr:${t.id}:${s}`;
      return {
        t, isEx: t.origin === 'existing', kind: facilityKind(t),
        open: K('open'), draw: K('draw'), idc: K('idc'), repaid: K('repaid'), close: K('close'), charge: K('charge'),
        td: K('td'), start: K('start'), n: K('n'), fin: K('fin'), pmt: K('pmt'), yoyTyped: K('yoyTyped'), yoyShare: K('yoyShare'),
      };
    });
    type Fac = typeof fac[number];
    for (const f of fac) for (const k of [f.open, f.draw, f.idc, f.repaid, f.close, f.charge, f.td]) if (!has(k)) return values(`The financing could not be made live for this model: ${f.t.name}'s ${k.split(':').pop()} row is not on the Financing sheet.`);
    for (const f of fac) {
      // The rate on Inputs: the interbank rate plus the spread typed beside it.
      w.fA(w.addr(`trrate:${f.t.id}`), `N(${w.ref(`trib:${f.t.id}`)})+N(${w.ref(`trsp:${f.t.id}`)})`);
      putS(f.td, `SUM(${rowRange(f.draw)})`);
      if (f.kind === 'sweep') continue;
      const inS = IN(`fin:in:tr:${f.t.id}:start`);
      const auto = f.isEx ? Y0() : `MIN(${YN()}+1,${lastCon()}+1)`;
      putS(f.start, `IF(N(${inS})=0,${auto},MAX(${Y0()},MIN(${YN()}+1,N(${inS}))))`);
      const st = (): string => T(f.start);
      if (has(f.n)) {
        const inN = `MAX(0,N(${IN(`fin:in:tr:${f.t.id}:n`)}))`;
        putS(f.n, f.isEx ? inN : `IF(${inN}>0,${inN},MAX(0,${YN()}+1-${st()}))`);
        putS(f.fin, `IF(${T(f.n)}>0,MIN(${YN()},${st()}+${T(f.n)}-1),${YN()})`);
      } else putS(f.fin, YN());
      const rt = rate(f);
      const n = (): string => T(f.n);
      if (f.kind === 'annuity') putS(f.pmt, `IF(OR(${n()}<=0,${T(f.td)}<=0),0,IF(${rt}<=0,${T(f.td)}/${n()},${T(f.td)}*${rt}*(1+${rt})^${n()}/((1+${rt})^${n()}-1)))`);
      else if (f.kind === 'principal') putS(f.pmt, `IF(${n()}>0,${T(f.td)}/${n()},0)`);
      if (f.kind === 'yoy') {
        const inRow = w.addr(`yoy:${f.t.id}`);
        const inRange = w.rangeA(inRow.sheet, inRow.row, inRow.col, inRow.col + N - 1);
        put(f.yoyTyped, (t) => `IF(${Y(t)}>=${st()},MAX(0,N(INDEX(${inRange},1,${Y(t)}-${st()}+1))),0)`);
        put(f.yoyShare, (t) => `IF(${Y(t)}<${st()},0,IF(SUM(${rowRange(f.yoyTyped)})=0,1/MAX(1,${YN()}+1-${st()}),${P(f.yoyTyped, t)}/SUM(${rowRange(f.yoyTyped)})))`);
      }
    }
    function rate(f: Fac): string { return `MAX(0,${w.ref(`trrate:${f.t.id}`)})`; }

    // ── Capex, the exit and the operating cash ───────────────────────────────
    // Capex paid in cash: Capex Table 2 less Table 5's in-kind land (2026-10-27).
    put('fl:capex', (t) => `${P('cx2:total', t)}-${P('cx5:total:inkind', t)}`);
    put('fl:landCash', (t) => P('cx5:total:cash', t));
    put('fl:nonLand', (t) => `MAX(0,${P('fl:capex', t)}-${P('fl:landCash', t)})`);
    put('fl:inKind', (t) => P('cx5:total:inkind', t));
    // The held lines' income, from Revenue and Opex.
    const isRev = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id);
    const held = visible.filter((a) => (a.strategy === 'Operate' || a.strategy === 'Lease') && isRev(a));
    const heldRev = [...new Set(held.map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => (l.form === 'operate' ? `rvc:${l.key}:total` : `rvc:${l.key}:rev`)).filter(has))];
    const heldOpex = held.map((a) => `oxo:${a.id}:total`).filter(has);
    put('fl:noi', (t) => `${heldRev.map((k) => P(k, t)).join('+') || '0'}-(${heldOpex.map((k) => P(k, t)).join('+') || '0'})`);
    // Exit proceeds: in Timeline's exit year, the terminal value of the income of the year Inputs names.
    put('fl:proceeds', (t) => {
      if (!booked) return '0';
      const income = `IF(${IN('ret:tvBasis')}="Exit year",${P('fl:noi', t)},N(${P('fl:noi', t, -1)}))`;
      return `${exitF(t)}*${terminalValueFormula(w, retCfg, income, true)}`;
    });
    // Exit proceeds by phase: the proceeds x the phase's share of the held income in the basis year.
    {
      const basisOf = (key: string, t: number): string => `IF(${IN('ret:tvBasis')}="Exit year",${P(key, t)},N(${P(key, t, -1)}))`;
      for (const ph of phases) {
        const kN = `fl:ph:${ph.id}:noi`, kP = `fl:ph:${ph.id}:proceeds`;
        if (!has(kN) || !has(kP)) continue;
        const hp = held.filter((a) => a.phaseId === ph.id);
        const rev = [...new Set(hp.map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => (l.form === 'operate' ? `rvc:${l.key}:total` : `rvc:${l.key}:rev`)).filter(has))];
        const opx = hp.map((a) => `oxo:${a.id}:total`).filter(has);
        put(kN, (t) => `${rev.map((k) => P(k, t)).join('+') || '0'}-(${opx.map((k) => P(k, t)).join('+') || '0'})`);
        put(kP, (t) => (booked ? `IF(${basisOf('fl:noi', t)}=0,0,${P('fl:proceeds', t)}*${basisOf(kN, t)}/${basisOf('fl:noi', t)})` : '0'));
        claim(`fnc:ph:${ph.id}:proceeds`, kP);
      }
    }
    put('fl:collected', (t) => P('rev|__project__|sum-cash|Total cash collected', t));
    put('fl:opexPaid', (t) => `-${P('ox|ap|paid', t)}`);
    put('fl:mkt', (t) => (has('cx1e:total') ? `-${P('cx1e:total', t)}` : '0'));
    const escNet = 'esc||C. Cash Flow Impact (project totals)|Net escrow cash flow';
    put('fl:esc', (t) => (has(escNet) ? P(escNet, t) : '0'));
    put('fl:taxPaidOps', (t) => `-${P('fl:taxPaid', t)}`);
    put('fl:feeOps', (t) => `-${P('fl:feeTot', t)}`);
    put('fl:opIn', (t) => chain(['fl:collected', 'fl:opexPaid', 'fl:mkt', 'fl:esc', 'fl:taxPaidOps', 'fl:feeOps'], t));
    why('fl:opIn', CHAIN);

    // ── The funding need ─────────────────────────────────────────────────────
    put('fl:open', (t) => `N(${P('fl:after', t, -1)})`, 'last');
    put('fl:avail', (t) => `${P('fl:open', t)}+${P('fl:opIn', t)}-${P('fl:capex', t)}+${P('fl:proceeds', t)}`, 'last');
    why('fl:avail', CHAIN);
    // A year needs funding only while capex (net of exit proceeds) is paid, to the cent.
    const spending = (t: number): string => `(ROUND(${P('fl:capex', t)}-${P('fl:proceeds', t)},2)>0)`;
    put('fl:need', (t) => `IF(${spending(t)},MAX(0,${MIN()}-${P('fl:avail', t)}),0)`);
    put('fl:needExFee', (t) => `IF(${spending(t)},MAX(0,${MIN()}-(${P('fl:avail', t)}+${P('fl:feeTot', t)})),0)`);
    // Methods 1 and 2: the minimum cash, drawn in the first year capex is paid.
    const firstCapex = (): string => `IFERROR(INDEX(${yearRow()},MATCH(TRUE,INDEX(${rowRange('fl:capex')}>0,0),0)),${Y0()})`;
    const minAt = (t: number): string => `IF(${Y(t)}=${firstCapex()},${MIN()},0)`;
    if (METHOD === 2) {
      const cashPre = [...new Set(visible.filter((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l && has(`rvc:${l.key}:cashPre`)).map((l) => `rvc:${l.key}:cashPre`))];
      const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      put('fl:m2pre', (t) => `${cashPre.map((k) => P(k, t)).join('+') || '0'}${has(escB('Total Additions')) ? `-${P(escB('Total Additions'), t)}` : ''}${has(escB('Less: Release of Locked Funds')) ? `-${P(escB('Less: Release of Locked Funds'), t)}` : ''}`);
      put('fl:m2gap', (t) => `MAX(0,${P('fl:capex', t)}-N(${P('fl:m2pre', t, -1)}))`);
    }
    const drawBase = (t: number): string => (METHOD === 3 ? P('fl:need', t) : METHOD === 2 ? `(${P('fl:m2gap', t)}+${minAt(t)})` : `(${P('fl:nonLand', t)}+${minAt(t)})`);
    put('fl:debtDraw', (t) => `${drawBase(t)}*${dF()}${METHOD === 1 ? `+${P('fl:landCash', t)}*${T('fl:landDebt')}` : ''}`);
    put('fl:eqDraw', (t) => `${drawBase(t)}*${eF()}${METHOD === 1 ? `+${P('fl:landCash', t)}*(1-${T('fl:landDebt')})` : ''}`);
    const fee = (t: number): string => (feeOn && has('fl:feeTot') ? P('fl:feeTot', t) : '0');
    // The fund fees drawn from equity: while capex is paid, as far as keeps cash at the minimum.
    put('fl:feeDraw', (t) => `IF(AND(${spending(t)},${fee(t)}>0),MIN(${fee(t)},MAX(0,${MIN()}-(${P('fl:avail', t)}+${P('fl:need', t)}-${fee(t)}))),0)`);
    put('fl:feePaid', (t) => `-${fee(t)}`);
    put('fl:after', (t) => `${P('fl:avail', t)}+${P('fl:need', t)}${byEq ? `+${P('fl:feeDraw', t)}+${P('fl:feePaid', t)}` : ''}`, 'last');
    why('fl:after', CHAIN);
    const head = (t: number): string => `MAX(0,${P('fl:after', t)}-${MIN()})`;
    // Construction running: a year up to the last construction year with capex in it.
    const running = (t: number): string => `AND(${Y(t)}<=${lastCon()},${P('fl:capex', t)}+${P('fl:inKind', t)}>0)`;

    // ── Each facility ────────────────────────────────────────────────────────
    const shareOf = (f: Fac): string => (f.isEx ? '0' : anyShareTyped && has(`tr:${f.t.id}:share`) ? `MAX(0,N(${w.ref(`tr:${f.t.id}:share`)}))` : newCount === 1 ? '' : String(1 / newCount));
    const owed = (f: Fac, t: number): string => `(${P(f.open, t)}+${P(f.draw, t)}+${P(f.idc, t)})`;
    const sched = (f: Fac, t: number): string => {
      const st = T(f.start);
      let due = '0';
      if (f.kind === 'annuity' || f.kind === 'principal') {
        const inWindow = `AND(${Y(t)}>=${st},${Y(t)}<${st}+${T(f.n)})`;
        due = f.kind === 'annuity' ? `IF(${inWindow},MIN(${owed(f, t)},MAX(0,${T(f.pmt)}-${P(f.charge, t)})),0)` : `IF(${inWindow},MIN(${owed(f, t)},${T(f.pmt)}),0)`;
      } else if (f.kind === 'yoy') due = `MIN(${owed(f, t)},${T(f.td)}*${P(f.yoyShare, t)})`;
      return `IF(${Y(t)}=${T(f.fin)},${owed(f, t)},${due})`;
    };
    for (const [j, f] of fac.entries()) {
      const before = fac.slice(0, j);
      put(f.open, (t) => `N(${P(f.close, t, -1)})`, 'last');
      const sh = shareOf(f);
      put(f.draw, (t) => (f.isEx ? `(${Y(t)}=N(${IN(`fin:in:tr:${f.t.id}:orig`)}))*MAX(0,N(${IN(`fin:in:tr:${f.t.id}:open`)}))` : `MAX(0,${P('fl:debtDraw', t)})${sh ? `*${sh}` : ''}`));
      const intFrom = (t: number): string => (f.isEx ? `(${Y(t)}>=MAX(${Y0()},N(${IN(`fin:in:tr:${f.t.id}:intStart`)})))*` : '');
      put(f.charge, (t) => `${intFrom(t)}(${P(f.open, t)}+${P(f.draw, t)})*${rate(f)}`);
      // The interest the cash above the minimum cannot pay is drawn as debt while construction runs.
      const paidBefore = (t: number): string => before.filter((b) => !b.isEx).map((b) => `(${P(b.charge, t)}-${P(b.idc, t)})`).join('+') || '0';
      put(f.idc, (t) => (f.isEx ? '0' : `IF(${running(t)},MAX(0,${P(f.charge, t)}-MAX(0,${head(t)}-(${paidBefore(t)}))),0)`));
    }
    // The sweep: from the cash above the minimum after this year's scheduled principal and the exit
    // repayment, each swept loan in turn from what the loans before it left.
    const schedTot = (t: number): string => fac.filter((f) => f.kind !== 'sweep').map((f) => `(-${P(f.repaid, t)})`).join('+') || '0';
    const preSweep = (t: number): string => `MAX(0,${P('fl:cash', t)}-(${schedTot(t)})-${P('fl:exitRepay', t)}-${MIN()})`;
    for (const [j, f] of fac.entries()) {
      const swBefore = (t: number): string => fac.slice(0, j).filter((b) => b.kind === 'sweep').map((b) => `(-${P(b.repaid, t)})`).join('+') || '0';
      const left = (t: number): string => `MAX(0,${preSweep(t)}-(${swBefore(t)}))`;
      put(f.repaid, (t) => (f.kind === 'sweep'
        ? `-IF(AND(${Y(t)}>=${T('fl:sweepStart')},${owed(f, t)}>0),MIN(${owed(f, t)},${left(t)}*${sweepRatio()},${left(t)}),0)`
        : `-${sched(f, t)}`));
      // The platform's rule: a balance under 0.01% of the total drawn (between 1 and 1,000) is rounding and closes at zero.
      const bal = (t: number): string => `(${owed(f, t)}+${P(f.repaid, t)})`;
      put(f.close, (t) => `IF(ABS(${bal(t)})<MAX(1,MIN(1000,0.0001*${T(f.td)})),0,${bal(t)})`, 'last');
      why(f.close, 'Opening plus the draws less the principal repaid; a remainder under 0.01% of the total drawn (between 1 and 1,000) closes at zero, the platform\'s rule.');
    }
    // ── Interest ─────────────────────────────────────────────────────────────
    const newF = fac.filter((f) => !f.isEx);
    const sumF = (fs: Fac[], k: 'draw' | 'idc' | 'charge' | 'repaid' | 'close', t: number): string => fs.map((f) => P(f[k], t)).join('+') || '0';
    put('fl:drawAll', (t) => sumF(fac, 'draw', t));
    put('fl:idcAll', (t) => sumF(newF, 'idc', t));
    put('fl:intAll', (t) => sumF(fac, 'charge', t));
    put('fl:sched', (t) => sumF(fac.filter((f) => f.kind !== 'sweep'), 'repaid', t));
    const interest = (t: number): string => (has('fl:intAll') ? P('fl:intAll', t) : sumF(fac, 'charge', t));
    put('fl:idcBasis', (t) => `IF(${running(t)},${sumF(newF, 'charge', t)},0)`);
    put('fl:intExp', (t) => `-(${interest(t)}-${P('fl:idcBasis', t)})`);
    // Capitalised interest by line, on the land under construction. Each row feeds Schedules (the loop).
    const idcAssets = visible.filter(sharesCapitalisedInterest);
    const sqm = (a: Asset): string => (has(`land:${a.id}:sqm`) ? `MAX(0,N(${w.ref(`land:${a.id}:sqm`)}))` : '0');
    const conFlag = (a: Asset, t: number): string => (has(`tl:flag:${a.phaseId}:con`) ? P(`tl:flag:${a.phaseId}:con`, t) : '0');
    putS('fl:sqmTot', idcAssets.map(sqm).join('+') || '0');
    put('fl:sqmActive', (t) => idcAssets.map((a) => `${conFlag(a, t)}*${sqm(a)}`).join('+') || '0');
    pc0.idcLines.forEach((l, i) => {
      const k = `fl:idc:${i}`;
      if (!has(k)) return;
      const as = l.assetIds.map((id) => idcAssets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
      const sq = as.map(sqm).join('+') || '0';
      const flag = (t: number): string => (as[0] ? conFlag(as[0], t) : '0');
      put(k, (t) => `IF(${P('fl:idcBasis', t)}=0,0,IF(${P('fl:sqmActive', t)}>0,${flag(t)}*${P('fl:idcBasis', t)}*(${sq})/${P('fl:sqmActive', t)},IF(${T('fl:sqmTot')}>0,${P('fl:idcBasis', t)}*(${sq})/${T('fl:sqmTot')},0)))`);
      for (const id of l.assetIds) w.claim(`fnc:main:idc:${id}`, FIN, w.addr(k).row, 1);
    });
    const idcPre = (t: number): string => `MAX(0,${P('schv:__project__:idcNbv', t, -1)}+${P('schv:__project__:idcAdd', t)}-${P('schv:__project__:idcDep', t)})`;
    put('fl:idcDisp', (t) => (has('schv:__project__:idcNbv') ? `-(${exitF(t)}*${idcPre(t)})` : '0'));

    // ── Profit before zakat inside the loop, and zakat ───────────────────────
    const revTot = 'rev|__project__|sum-rec|Total revenue recognised';
    const opexKeys = [...visible.map((a) => `oxo:${a.id}:total`), 'oxo:hq:total'].filter(has);
    put('fl:ebit0', (t) => `${has(revTot) ? P(revTot, t) : '0'}-(${opexKeys.map((k) => P(k, t)).join('+') || '0'})${has('cx1e:total') ? `-${P('cx1e:total', t)}` : ''}`);
    put('fl:cos', (t) => (has('cs|__project__|cos') ? `-${P('cs|__project__|cos', t)}` : '0'));
    put('fl:feeExp', (t) => `-${fee(t)}`);
    put('fl:dep', (t) => P('schv:__project__:dep', t));
    put('fl:int', (t) => P('fl:intExp', t));
    put('fl:gain', (t) => `${P('fl:proceeds', t)}${has('schv:__project__:landDisp') ? `+${P('schv:__project__:landDisp', t)}` : ''}${has('schv:__project__:disp') ? `+${P('schv:__project__:disp', t)}` : ''}`);
    put('fl:pbt', (t) => chain(['fl:ebit0', 'fl:cos', 'fl:feeExp', 'fl:dep', 'fl:int', 'fl:gain'], t));
    why('fl:pbt', `${CHAIN} Checks proves it equals the P&L every year.`);
    const taxedGain = project.tax?.applyToDisposalGain === true;
    put('fl:taxable', (t) => (taxedGain ? P('fl:pbt', t) : `${P('fl:pbt', t)}-${P('fl:gain', t)}`));
    const rate0 = (): string => `MAX(0,N(${w.ref('project:taxRate')}))`;
    if (pc0.cit) {
      put('fl:taxRel', (t) => citReliefF(P('fl:taxable', t), `N(${P('fl:taxPool', t, -1)})`));
      put('fl:taxPool', (t) => citPoolF(P('fl:taxable', t), `N(${P('fl:taxPool', t, -1)})`, P('fl:taxRel', t)), 'last');
    }
    put('fl:tax', (t) => taxF(P('fl:taxable', t), rate0(), pc0.cit ? P('fl:taxRel', t) : undefined));
    put('fl:taxPay', (t) => `${P('fl:tax', t)}*MIN(365,MAX(0,N(${w.ref('project:taxDays')})))/365`, 'last');
    put('fl:taxPaid', (t) => (pc0.taxLag ? `${P('fl:tax', t)}-(${P('fl:taxPay', t)}-N(${P('fl:taxPay', t, -1)}))` : P('fl:tax', t)));

    // ── The fund fees ────────────────────────────────────────────────────────
    if (feeOn) {
      // The base: the funding need with the fees left out (Method 3), or the draws (Methods 1 and 2,
      // sized on capex and pre-sales, which the fees do not move). Its first year is the first draw.
      const baseKey = METHOD === 3 ? (byEq ? 'fl:need' : 'fl:needExFee') : undefined;
      const R = (): string => (baseKey ? T(baseKey) : `(${T('fl:debtDraw')}+${T('fl:eqDraw')})`);
      const firstRow = baseKey ? `INDEX(${rowRange(baseKey)}>0,0)` : `INDEX((${rowRange('fl:debtDraw')}+${rowRange('fl:eqDraw')})>0,0)`;
      putS('fl:firstDraw', `IFERROR(INDEX(${yearRow()},MATCH(TRUE,${firstRow},0)),${Y0()})`);
      putS('fl:feeEq', `${R()}*${eF()}`);
      putS('fl:feeDebt', `${R()}*${dF()}`);
      putS('fl:feeFund', fundTerms.fundSizeOverride ? `MAX(0,N(${w.ref('ft:Fund size (typed target)')}))` : `${T('fl:feeEq')}+${T('fl:feeDebt')}`);
      const baseOf = (base: string): string => (base === 'fund_size' ? T('fl:feeFund') : base === 'total_equity' ? T('fl:feeEq') : base === 'debt_facility' ? T('fl:feeDebt') : '0');
      const feeKeys: string[] = [];
      FUND_FEE_SPECS.forEach((spec, i) => {
        const k = `fl:fee:${i}`;
        if (!has(k)) return;
        const rateIn = has(`ft:${spec.label}`) ? `N(${w.ref(`ft:${spec.label}`)})` : '0';
        put(k, (t) => {
          const when = spec.timing === 'one_time' ? `(${Y(t)}=${T('fl:firstDraw')})*` : '';
          return `${alive(t)}*${when}${rateIn}${spec.kind === 'amount' ? '' : `*${baseOf(spec.base)}`}`;
        });
        feeKeys.push(k);
        w.claim(`fnc:fee:${i}`, FIN, w.addr(k).row, 1);
      });
      put('fl:feeTot', (t) => chain(feeKeys, t));
      why('fl:feeTot', CHAIN);
      claim('fnc:fee:base', baseKey ?? 'fl:debtDraw');
      claim('fnc:fee:fundsize', 'fl:feeFund');
      w.claim('ftcap:Capex equity', FIN, w.addr('fl:feeEq').row, TOTAL_COL);
      w.claim('ftcap:Debt facility', FIN, w.addr('fl:feeDebt').row, TOTAL_COL);
      w.claim('ftcap:Fund size', FIN, w.addr('fl:feeFund').row, TOTAL_COL);
    }

    // ── The cash waterfall, the sweep and the dividends ──────────────────────
    put('fl:cwOpen', (t) => `N(${P('fl:close', t, -1)})`, 'last');
    put('fl:cfo', (t) => (byEq ? `${P('fl:opIn', t)}+${P('fl:feePaid', t)}` : P('fl:opIn', t)));
    put('fl:cfi', (t) => `${P('fl:proceeds', t)}-${P('fl:capex', t)}`);
    put('fl:eqCash', (t) => `${P('fl:eqDraw', t)}${byEq ? `+${P('fl:feeDraw', t)}` : ''}`);
    put('fl:debtCash', (t) => (has('fl:drawAll') ? `${P('fl:drawAll', t)}+${P('fl:idcAll', t)}` : `${sumF(fac, 'draw', t)}+${sumF(newF, 'idc', t)}`));
    put('fl:intPaid', (t) => `-(${interest(t)})`);
    put('fl:cash', (t) => chain(['fl:cwOpen', 'fl:cfo', 'fl:cfi', 'fl:eqCash', 'fl:debtCash', 'fl:intPaid'], t), 'last');
    why('fl:cash', CHAIN);
    put('fl:exitRepay', (t) => `${exitF(t)}*MAX(0,${sumF(fac, 'close', t)})`);
    put('fl:repaidCash', (t) => `${sumF(fac, 'repaid', t)}-${P('fl:exitRepay', t)}`);
    put('fl:forDiv', (t) => `${P('fl:cash', t)}+${P('fl:repaidCash', t)}`, 'last');
    // The cash above the minimum, to the cent.
    const excess = (t: number): string => `IF(ROUND(${P('fl:forDiv', t)}-${MIN()},2)<=0,0,${P('fl:forDiv', t)}-${MIN()})`;
    // Dividends by phase: a payout of the cash above the minimum, capped at the phase's EBITDA to date,
    // LINKED to the phase P&L's EBITDA row (its own marketing charged, no HQ), never rebuilt here.
    const phaseDiv: string[] = [];
    for (const p of phases) {
      const kEb = `fl:ph:${p.id}:ebitda`, kDiv = `fl:ph:${p.id}:div`;
      const kPlEb = `pl|${p.id}||${labels.ebitda}`;
      if (!has(kEb) || !has(kDiv)) return values(`The financing could not be made live for this model: ${p.name} has no dividend rows.`);
      if (!has(kPlEb)) return values(`The financing could not be made live for this model: ${p.name} has no EBITDA row on its P&L.`);
      put(kEb, (t) => P(kPlEb, t));
      const before = [...phaseDiv];
      put(kDiv, (t) => {
        const ex = `(${excess(t)}${before.map((k) => `-${P(k, t)}`).join('')})`;
        const budget = `MAX(0,SUM(${toNow(kEb, t)})-SUM(${toPrev(kDiv, t)}))`;
        return `IF(AND(${divOn()}=1,${Y(t)}>=${T('fl:divStart')},${payout()}>0,${ex}>0),MIN(${onEbitda ? `MAX(0,${P(kEb, t)})` : ex}*${payout()},${ex},${budget}),0)`;
      });
      phaseDiv.push(kDiv);
    }
    const phaseSum = (t: number): string => phaseDiv.map((k) => P(k, t)).join('+') || '0';
    put('fl:div', (t) => `-(${phaseSum(t)}+${exitF(t)}*IF(AND(${divOn()}=1,${excess(t)}>0,ROUND(${P('fl:forDiv', t)}-(${phaseSum(t)}),2)>0),${P('fl:forDiv', t)}-(${phaseSum(t)}),0))`);
    why('fl:div', 'The phases\' dividends, and in the exit year all the cash above the minimum.');
    put('fl:close', (t) => `${P('fl:forDiv', t)}+${P('fl:div', t)}`, 'last');
    put('fl:debtBs', (t) => `(1-${booked ? `SUM(${toNow('tl:flag:exit', t)})` : '0'})*(${sumF(fac, 'close', t)})`, 'last');

    // ── The keys the later layers read ───────────────────────────────────────
    claim('fnc:capex', 'fl:capex');
    claim('fnc:inkind', 'fl:inKind');
    claim('fnc:noi', 'fl:noi');
    claim('fnc:proceeds', 'fl:proceeds');
    claim('fnc:main:exitrepay', 'fl:exitRepay');
    claim('fnc:main:netreq', 'fl:need');
    claim('fnc:main:draw', has('fl:drawAll') ? 'fl:drawAll' : fac[0].draw);
    if (has('fl:idcAll')) claim('fnc:main:idcdraw', 'fl:idcAll'); else if (newF[0]) claim('fnc:main:idcdraw', newF[0].idc);
    claim('fnc:main:basis', 'fl:idcBasis');
    claim('fnc:main:intexp', 'fl:intExp');
    {
      const sch = fac.filter((f) => f.kind !== 'sweep');
      if (has('fl:sched')) claim('fnc:main:sched', 'fl:sched'); else if (sch.length === 1) claim('fnc:main:sched', sch[0].repaid);
    }
    claim('fnc:main:repay', 'fl:repaidCash');
    claim('fnc:main:div', 'fl:div');
    claim('fnc:main:equity', 'fl:eqDraw');
    claim('fnc:main:feedraw', 'fl:feeDraw');
    claim('fnc:main:debtbs', 'fl:debtBs');
    claim('fnc:main:idcdisp', 'fl:idcDisp');
    claim('fnc:dF', 'fl:dF'); claim('fnc:eF', 'fl:eF');
    // The minimum cash and the dividend switch are read through loopOne, by name; claimed so a reader can test for them.
    for (const [name, key] of [['fnc:min', 'fin:in:min'], ['fnc:don', 'fin:in:divOn']] as const) { const a = w.addr(key); w.claim(name, a.sheet, a.row, a.col); }
    claim('fnc:capexall', 'cx2:total');
    claim('fnc:pbt', 'fl:pbt');
    for (const f of fac) {
      claim(`fnc:main:tr:${f.t.id}:bal`, f.close);
      claim(`fnc:tr:${f.t.id}:draw`, f.draw); claim(`fnc:tr:${f.t.id}:idc`, f.idc);
      claim(`fnc:tr:${f.t.id}:repaid`, f.repaid); claim(`fnc:tr:${f.t.id}:charge`, f.charge);
    }
    claim('fnc:tax', 'fl:tax'); claim('fnc:taxpaid', 'fl:taxPaid'); claim('fnc:taxpay', 'fl:taxPay');
    claim('fnc:main:interest', has('fl:intAll') ? 'fl:intAll' : fac[0].charge);
    claim('fnc:main:idcdep', 'schv:__project__:idcDep');
    claim('fnc:main:idcadd', 'schv:__project__:idcAdd');

    // ── The loop's output, written back: capitalised interest into Schedules ──
    const liveRow = (key: string, f: F): void => {
      if (!has(key)) return;
      const a = w.addr(key);
      const c0 = LiveWriter.isWorking(a.sheet) ? 4 : PERIOD_COLS.OPEN_COL + 1;
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: c0 + t }, f(t));
    };
    const lineIdc = (ids: readonly string[]) => (t: number): string => {
      const rows = [...new Set(ids.filter((id) => has(`fnc:main:idc:${id}`)).map((id) => w.addr(`fnc:main:idc:${id}`).row))];
      return rows.map((r) => w.refP({ sheet: FIN, row: r, col: pc(t) })).join('+') || '0';
    };
    for (const l of lines.filter((x) => has(`cosc:${x.key}:idc`))) liveRow(`cosc:${l.key}:idc`, (t) => `MAX(0,${lineIdc(l.members.map((m) => m.id))(t)})`);
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
    for (const gr of report.groups) for (const l of gr.lines) {
      if (!has(`schv:${l.hostId}:idcAdd`)) continue;
      const ids = l.memberIds.filter((id) => { const r0 = snap.idc.byAsset.get(id); return !!r0 && idcRowIsHeld(r0); });
      liveRow(`schv:${l.hostId}:idcAdd`, lineIdc(ids));
    }

    // A CIRCULAR CELL NEEDS A STARTING VALUE. Excel iterates a loop from each cell's cached result;
    // a formula written with none enters the first pass with nothing to start from and the loop never
    // recovers. Every formula on the tabs the loop runs through that carries no value starts from 0.
    for (const name of [FIN, 'Schedules']) {
      wb.getWorksheet(name)?.eachRow((r) => r.eachCell((c) => {
        const v = c.value as unknown as { formula?: string; result?: unknown } | null;
        if (v && typeof v === 'object' && 'formula' in v && (v.result === undefined || v.result === null)) c.value = { formula: v.formula, result: 0 } as never;
      }));
    }
    ctx.settled.add('financing');
    return [{
      sheet: FIN, status: 'live' as const, formulas: w.formulas.get(FIN) ?? 0,
      note: 'Live: one financing loop solved on this tab as circular formulas Excel iterates, the platform\'s fixed point (operating cash, the funding need, the equity and debt drawn, each facility\'s interest and interest drawn as debt, its repayment or sweep, zakat, the fund fees, the dividends by phase and closing cash), from the tabs before it and Inputs.',
    }];
  },
};
