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
import { colLetter } from '../styles';
import { terminalRefusal, terminalValueFormula } from './terminal';
import { citReliefF, citPoolF, taxF } from './taxRule';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { FUND_CAPITAL_LABELS } from '../../reports/m4Reports';
import { resolveCatalogId } from '../../state/costCatalog';
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
// Interest expensed is a positive row since 2026-11-19 (Financing 4.1: of which expensed), read negated by the P&L.
export const LOOP_NEGATIVE = new Set(['fnc:main:repay', 'fnc:main:div', 'fnc:main:sched', 'fnc:main:idcdisp']);
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
      if (!has(`trib:${t.id}`) || !has(`trsp:${t.id}`) || !has(`fl:tr:${t.id}:rate`)) refuse.push(`the rates of ${t.name} are not on Inputs and Financing`);
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
    for (const k of ['cx2:total', 'cx5:total:cash', 'cx5:total:inkind', 'schv:__project__:dep', 'rev|__project__|sum-cash|Total cash collected', has('ox|ap|close') ? 'ox|ap|paid' : 'ox|sum|opex', 'fl:capex', 'fl:need', 'fl:close']) if (!has(k)) refuse.push(`the ${k} row is not live`);
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
    // THE MINIMUM IN YEAR t (2026-11-18): from the year typed on Inputs, zero before it.
    const FROM = (): string => (has('fin:in:minFrom') ? `N(${IN('fin:in:minFrom')})` : '0');
    const MINT = (t: number): string => (has('fin:in:minFrom') ? `${MIN()}*(${Y(t)}>=${FROM()})` : MIN());
    const chain = (keys: Array<string | undefined>, t: number): string => keys.filter((k): k is string => !!k && has(k)).map((k) => P(k, t)).join('+') || '0';
    const CHAIN = 'Not a SUM: inside the financing loop a total adds its rows with + (Excel\'s iteration stalls on SUM there).';

    // ── Settings in force ────────────────────────────────────────────────────
    const psd = (): string => `YEAR(${w.ref('project:startDate')})`;
    // The latest handover year on Timeline (2026-11-15: short; each phase's handover year is a Timeline cell).
    putS('fl:lastCon', phases.every((p) => has(`tl:phase:${p.id}:hy`)) ? `MAX(${phases.map((p) => w.ref(`tl:phase:${p.id}:hy`)).join(',')})` : `MAX(${phases.map((p) => `MAX(0,YEAR(${w.ref(`tl:phase:${p.id}:cs`)})-${psd()})+MAX(0,${w.ref(`tl:phase:${p.id}:cp`)})`).join(',')})+${psd()}-1`);
    const lastCon = (): string => T('fl:lastCon');
    const D = (): string => `MAX(0,N(${IN('fin:in:debt')}))`, E = (): string => `MAX(0,N(${IN('fin:in:equity')}))`;
    putS('fl:dF', `IF(${D()}+${E()}>0,${D()}/(${D()}+${E()}),0)`); // no hidden default (2026-11-17): the engine reads a blank share as 0
    putS('fl:eF', `1-${T('fl:dF')}`);
    // THE IDC METHOD (2026-11-18): 1 where Inputs reads "excluding same-year IDC".
    if (has('fin:in:idcMethod')) putS('fl:idcExcl', `IF(ISNUMBER(SEARCH("excluding",${IN('fin:in:idcMethod')})),1,0)`);
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
      const dflt = `MAX(${Y0()},MIN(${YN()},MAX(${psd()},${lastCon()}+1)))`;
      const d = IN('fin:in:divStart');
      putS('fl:divStart', `IF(ISNUMBER(${d}),MAX(${Y0()},MIN(${YN()},${d})),${dflt})`);
    }
    const sweepRatio = (): string => (has('fl:sweepRatio') ? T('fl:sweepRatio') : `MAX(0,MIN(1,N(${IN('fin:in:sweepRatio')})))`);
    if (has('fl:sweepRatio')) putS('fl:sweepRatio', `MAX(0,MIN(1,N(${IN('fin:in:sweepRatio')})))`);
    const divOn = (): string => `IF(N(${IN('fin:in:divOn')})=1,1,0)`;
    putS('fl:payout', `MAX(0,MIN(1,N(${IN('fin:in:payout')})))`);
    const payout = (): string => (has('fl:payout') ? T('fl:payout') : `MAX(0,MIN(1,N(${IN('fin:in:payout')})))`);
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
      // The rate, on Financing: the interbank rate plus the spread typed on Inputs.
      putS(`fl:tr:${f.t.id}:rate`, `N(${w.ref(`trib:${f.t.id}`)})+N(${w.ref(`trsp:${f.t.id}`)})`);
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
    function rate(f: Fac): string { return `MAX(0,${T(`fl:tr:${f.t.id}:rate`)})`; }

    // ── Capex, the exit and the operating cash ───────────────────────────────
    // Capex paid in cash: Capex Table 2 less Table 5's in-kind land (2026-10-27).
    // A LINK TO ONE ROW (2026-11-19, founder): Capex's "Capex paid in cash (excluding land in kind)".
    put('fl:capex', (t) => (has('cx:cashCapex') ? P('cx:cashCapex', t) : `${P('cx2:total', t)}-${P('cx5:total:inkind', t)}`));
    put('fl:landCash', (t) => P('cx5:total:cash', t));
    // What the funding is sized on (2026-11-19, founder A2): the capex and the sales commission paid.
    if (has('fl:spend')) put('fl:spend', (t) => `${P('fl:capex', t)}${has('sell:comm') ? `+${P('sell:comm', t)}` : ''}`);
    const SPEND = has('fl:spend') ? 'fl:spend' : 'fl:capex';
    put('fl:nonLand', (t) => `MAX(0,${P(SPEND, t)}-${P('fl:landCash', t)})`);
    put('fl:inKind', (t) => P('cx5:total:inkind', t));
    // The held lines' income, from Revenue and Opex.
    const isRev = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id);
    const held = visible.filter((a) => (a.strategy === 'Operate' || a.strategy === 'Lease') && isRev(a));
    const heldRev = [...new Set(held.map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l).map((l) => (l.form === 'operate' ? `rvc:${l.key}:total` : `rvc:${l.key}:rev`)).filter(has))];
    const heldOpex = held.map((a) => `oxo:${a.id}:total`).filter(has);
    // THE HELD ASSETS' NOI FROM OPEX (2026-11-19, founder): each phase's "EBITDA (NOI)" row in Opex's summary by line,
    // never rebuilt from Revenue and Opex lines; the total adds the phases.
    void heldRev; void heldOpex;
    const noiPh = phases.filter((ph) => has(`fl:ph:${ph.id}:noi`) && has(`ox|sum|noi|${ph.id}`));
    for (const ph of noiPh) put(`fl:ph:${ph.id}:noi`, (t) => P(`ox|sum|noi|${ph.id}`, t));
    const noiSrc = noiPh.length ? noiPh.map((ph) => `fl:ph:${ph.id}:noi`) : phases.map((ph) => `ox|sum|noi|${ph.id}`).filter(has);
    put('fl:noi', (t) => noiSrc.map((k) => P(k, t)).join('+') || '0');
    // THE EXIT, WORKED OUT ONCE (2026-11-19, founder): the year capitalised, the income it capitalises, the gross value
    // at the exit terms, the selling costs and the net proceeds; each phase takes its share of the income capitalised.
    const basisIs = (): string => `${IN('ret:tvBasis')}="Exit year"`;
    if (has('fl:capYear') && has('inp=ret|Exit Year@4')) putS('fl:capYear', `${IN('inp=ret|Exit Year@4')}-IF(${basisIs()},0,1)`);
    const incOf = (k: string, t: number): string => `${exitF(t)}*IF(${basisIs()},${P(k, t)},N(${P(k, t, -1)}))`;
    const sellPct = (): string => (has('ret:sellCost') ? `MAX(0,MIN(1,N(${IN('ret:sellCost')})))` : '0');
    if (booked && has('fl:inc')) {
      put('fl:inc', (t) => incOf('fl:noi', t));
      put('fl:gross', (t) => terminalValueFormula(w, retCfg, P('fl:inc', t), true));
      put('fl:sell', (t) => `-${P('fl:gross', t)}*${sellPct()}`);
      put('fl:proceeds', (t) => `${P('fl:gross', t)}+${P('fl:sell', t)}`);
    } else put('fl:proceeds', (t) => {
      if (!booked) return '0';
      const income = `IF(${IN('ret:tvBasis')}="Exit year",${P('fl:noi', t)},N(${P('fl:noi', t, -1)}))`;
      const cost = has('ret:sellCost') ? `*(1-${sellPct()})` : '';
      return `${exitF(t)}*${terminalValueFormula(w, retCfg, income, true)}${cost}`;
    });
    for (const ph of phases) {
      const K = (x: string): string => `fl:ph:${ph.id}:${x}`;
      if (!has(K('proceeds'))) continue;
      // The total x the phase's share of the NOI capitalised (2026-11-19, founder B5).
      if (booked && has(K('noi')) && has('fl:inc')) put(K('proceeds'), (t) => `IF(${P('fl:inc', t)}=0,0,${P('fl:proceeds', t)}*${incOf(K('noi'), t)}/${P('fl:inc', t)})`);
      else put(K('proceeds'), () => '0');
      claim(`fnc:ph:${ph.id}:proceeds`, K('proceeds'));
    }
    if (has('fl:exitChk')) put('fl:exitChk', (t) => `${phases.map((ph) => `fl:ph:${ph.id}:proceeds`).filter(has).map((k) => P(k, t)).join('+') || '0'}-${P('fl:proceeds', t)}`);
    for (const [name, key] of [['fnc:inc', 'fl:inc'], ['fnc:gross', 'fl:gross'], ['fnc:sell', 'fl:sell'], ['fnc:capYear', 'fl:capYear']] as const) claim(name, key);
    put('fl:collected', (t) => P('rev|__project__|sum-cash|Total cash collected', t));
    // Payables at 0 days: opex is paid as incurred (2026-11-15), so the cash paid is the project opex.
    put('fl:opexPaid', (t) => `-${P(has('ox|ap|close') ? 'ox|ap|paid' : 'ox|sum|opex', t)}`);
    put('fl:mkt', (t) => (has('sell:total') ? `-${P('sell:total', t)}` : has('cx1e:total') ? `-${P('cx1e:total', t)}` : '0'));
    const escNet = 'esc||C. Cash Flow Impact (project totals)|Net escrow cash flow';
    put('fl:esc', (t) => (has(escNet) ? P(escNet, t) : '0'));
    // Paid in the year (0 payment days): the charge is the cash paid, so its row is read as the tax paid.
    if (!has('fl:taxPaid') && has('fl:tax')) { const a = w.addr('fl:tax'); w.claim('fl:taxPaid', a.sheet, a.row, 1); }
    put('fl:taxPaidOps', (t) => `-${P('fl:taxPaid', t)}`);
    put('fl:feeOps', (t) => `-${P('fl:feeTot', t)}`);
    put('fl:opIn', (t) => chain(['fl:collected', 'fl:opexPaid', 'fl:mkt', 'fl:esc', 'fl:taxPaidOps', 'fl:feeOps'], t));
    why('fl:opIn', CHAIN);
    // THE FUNDING TEST READS NO ZAKAT AND NO FUND FEE (2026-11-18): zakat is paid from cash on hand,
    // an equity-funded fee is drawn in full, and a deficit-funded fee is taken off below.
    put('fl:opSize', (t) => chain(['fl:collected', 'fl:opexPaid', 'fl:mkt', 'fl:esc'], t));

    // ── The funding need ─────────────────────────────────────────────────────
    // THE FUNDING TEST ONLY WHILE CAPEX IS STILL TO BE PAID (2026-11-17, founder): each row of it is 0 once no
    // capex is left (this year onward), so it reads blank after the build; inside the window the chain runs as before.
    const cxRow = w.addr(SPEND).row;
    const win = (t: number, e: string): string => `IF(SUM(${P(SPEND, t)}:$${colLetter(pc(N - 1))}$${cxRow})>0,${e},0)`;
    put('fl:open', (t) => win(t, `N(${P('fl:after', t, -1)})`), 'last');
    const fee = (t: number): string => (feeOn && has('fl:feeTot') ? P('fl:feeTot', t) : '0');
    const feeInNeed = feeOn && !byEq;
    put('fl:avail', (t) => win(t, `${P('fl:open', t)}+${P('fl:opSize', t)}${feeInNeed ? `-${fee(t)}` : ''}-${P('fl:capex', t)}+${P('fl:proceeds', t)}`), 'last');
    // A year needs funding only while capex (net of exit proceeds) is paid, to the cent.
    const spending = (t: number): string => `(ROUND(${P(SPEND, t)}-${P('fl:proceeds', t)},2)>0)`;
    put('fl:need', (t) => `IF(${spending(t)},MAX(0,${MINT(t)}-${P('fl:avail', t)}),0)`);
    // The fee-free walk: its own opening (last year's cash plus its need), no fee anywhere in it.
    put('fl:xAvail', (t) => win(t, `N(${P('fl:xAvail', t, -1)})+N(${P('fl:needExFee', t, -1)})+${P('fl:opSize', t)}-${P('fl:capex', t)}+${P('fl:proceeds', t)}`), 'last');
    put('fl:needExFee', (t) => `IF(${spending(t)},MAX(0,${MINT(t)}-${P('fl:xAvail', t)}),0)`);
    // Methods 1 and 2: the minimum cash, drawn in the first year capex is paid.
    // THE FIRST YEAR A ROW IS POSITIVE, WITH NO ARRAY FORMULA (2026-11-04): MATCH(TRUE, INDEX(...,0))
    // read #VALUE! outside Excel. SUMPRODUCT evaluates its argument as an array in Excel and LibreOffice
    // alike: the smallest year, every year where the test fails pushed out of reach; none, the first year.
    const firstYearWhere = (notIt: string): string => { const m = `SUMPRODUCT(MIN(${yearRow()}+(${notIt})*100000))`; return `IF(${m}>99999,${Y0()},${m})`; };
    const firstCapex = (): string => firstYearWhere(`${rowRange(SPEND)}<=0`);
    if (has('fl:firstSweep')) { const rep = w.reg.keys().filter((k) => /^fl:tr:.+:repaid$/.test(k)); if (rep.length) putS('fl:firstSweep', `IF(${rep.map((k) => `COUNTIF(${rowRange(k)},"<0")`).join('+')}=0,"never",${firstYearWhere(`(${rep.map((k) => rowRange(k)).join('+')})>=0`)})`); }
    // Raised in the first capex year, or the year the minimum starts to apply if later (2026-11-18).
    const minAt = (t: number): string => `IF(${Y(t)}=MAX(${firstCapex()},${FROM()}),${MIN()},0)`;
    if (METHOD === 2) {
      const cashPre = [...new Set(visible.filter((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l && has(`rvc:${l.key}:cashPre`)).map((l) => `rvc:${l.key}:cashPre`))];
      const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      put('fl:m2pre', (t) => `${cashPre.map((k) => P(k, t)).join('+') || '0'}${has(escB('Total Additions')) ? `-${P(escB('Total Additions'), t)}` : ''}${has(escB('Less: Release of Locked Funds')) ? `-${P(escB('Less: Release of Locked Funds'), t)}` : ''}`);
      put('fl:m2gap', (t) => `MAX(0,${P(SPEND, t)}-N(${P('fl:m2pre', t, -1)}))`);
    }
    const drawBase = (t: number): string => (METHOD === 3 ? P('fl:need', t) : METHOD === 2 ? `(${P('fl:m2gap', t)}+${minAt(t)})` : `(${P('fl:nonLand', t)}+${minAt(t)})`);
    put('fl:debtDraw', (t) => `${drawBase(t)}*${dF()}${METHOD === 1 ? `+${P('fl:landCash', t)}*${T('fl:landDebt')}` : ''}`);
    put('fl:eqDraw', (t) => `${drawBase(t)}*${eF()}${METHOD === 1 ? `+${P('fl:landCash', t)}*(1-${T('fl:landDebt')})` : ''}`);
    // The fund fees drawn from equity (2026-11-18): the whole fee in a year construction runs.
    // Construction running: a year up to the last construction year with capex in it.
    // A PHASE'S OWN CONSTRUCTION YEARS (2026-11-18, the engine's rule): some phase is building that year
    // (Timeline's construction flags) and capex is spent; a gap year paying only a commission is not construction.
    const conFlags = state.phases.filter((ph) => ph.status !== 'operational').map((ph) => `tl:flag:${ph.id}:con`).filter(has);
    const building = (t: number): string => (conFlags.length ? `,(${conFlags.map((k) => P(k, t)).join('+')})>0` : '');
    const running = (t: number): string => `AND(${Y(t)}<=${lastCon()}${building(t)},${P(SPEND, t)}+${P('fl:inKind', t)}>0)`;
    put('fl:feeDraw', (t) => `IF(${running(t)},${fee(t)},0)`);
    put('fl:after', (t) => win(t, `${P('fl:avail', t)}+${P('fl:need', t)}`), 'last');

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
      // NO CIRCULARITY (2026-11-18): construction charges rate x (opening + drawdown / 2), over
      // (1 - rate / 2) unless the IDC method excludes the year's own IDC; otherwise rate x opening.
      void before;
      const excl = has('fl:idcExcl') ? T('fl:idcExcl') : '0';
      put(f.charge, (t) => (f.isEx
        ? `${intFrom(t)}(${P(f.open, t)}+${P(f.draw, t)})*${rate(f)}`
        // The rate taken outside the IF (2026-11-19): the same figure, with the rate cells read twice, not three times,
        // so the formula stays under 200 characters with the input tab's longer name.
        : `${rate(f)}*IF(${running(t)},(${P(f.open, t)}+${P(f.draw, t)}/2)/(1-(1-${excl})*${rate(f)}/2),${P(f.open, t)})`));
      // Capitalised in full: the whole construction charge is drawn as debt.
      put(f.idc, (t) => (f.isEx ? '0' : `IF(${running(t)},${P(f.charge, t)},0)`));
    }
    // The sweep: from the cash above the minimum after this year's scheduled principal and the exit
    // repayment, each swept loan in turn from what the loans before it left.
    const schedTot = (t: number): string => fac.filter((f) => f.kind !== 'sweep').map((f) => `(-${P(f.repaid, t)})`).join('+') || '0';
    // NOT IN THE EXIT YEAR (2026-11-18): the exit repays the balance from the proceeds, so the sweep
    // never reads the exit repayment, which reads the balance the sweep sets.
    const preSweep = (t: number): string => `(1-${exitF(t)})*MAX(0,${P('fl:cash', t)}-(${schedTot(t)})-${MINT(t)})`;
    // Its own row (2026-11-15): the cash above the minimum a sweep may take.
    put('fl:sweepLeft', (t) => preSweep(t));
    const pre = (t: number): string => (has('fl:sweepLeft') ? P('fl:sweepLeft', t) : preSweep(t));
    for (const [j, f] of fac.entries()) {
      const swBefore = (t: number): string => fac.slice(0, j).filter((b) => b.kind === 'sweep').map((b) => `(-${P(b.repaid, t)})`).join('+') || '0';
      const left = (t: number): string => (swBefore(t) === '0' ? pre(t) : `MAX(0,${pre(t)}-(${swBefore(t)}))`);
      put(f.repaid, (t) => (f.kind === 'sweep'
        ? `-IF(AND(${Y(t)}>=${T('fl:sweepStart')},${owed(f, t)}>0),MIN(${owed(f, t)},${left(t)}*${sweepRatio()},${left(t)}),0)`
        : `-${sched(f, t)}`));
      // The platform's rule: a balance under 0.01% of the total drawn (between 1 and 1,000) is rounding and closes at zero.
      // The exit repayment inside the facility (2026-11-19): in the exit year it takes what is left, so Closing reads 0 from the exit.
      const xk = `fl:tr:${f.t.id}:exitRepaid`;
      put(xk, (t) => `-${exitF(t)}*(${owed(f, t)}+${P(f.repaid, t)})`);
      // The facility reads its repayment from section 4 (2026-11-19, founder B7).
      const ak = `fl:tr:${f.t.id}:repaidAll`;
      if (has(ak)) put(ak, (t) => `${P(f.repaid, t)}${has(xk) ? `+${P(xk, t)}` : ''}`);
      const bal = (t: number): string => (has(ak) ? `(${owed(f, t)}+${P(ak, t)})` : `(${owed(f, t)}+${P(f.repaid, t)}${has(xk) ? `+${P(xk, t)}` : ''})`);
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
    put('fl:intExp', (t) => `${interest(t)}-${P('fl:idcBasis', t)}`);
    // 4.1's check: capitalised plus expensed less the interest charged, 0 in every year.
    put('fl:intChk', (t) => `${P('fl:idcBasis', t)}+${P('fl:intExp', t)}-(${interest(t)})`, 'none');
    // ── 4.2 THE IDC ALLOCATION (2026-11-19, founder): each line's land area (Input column), its construction years (1 / 0),
    // and its share of the year's IDC only in a year with IDC (0, shown "-", in any other); 4.3 each line's IDC. ──
    const idcAssets = visible.filter(sharesCapitalisedInterest);
    const sqm = (a: Asset): string => (has(`land:${a.id}:sqm`) ? `MAX(0,N(${w.ref(`land:${a.id}:sqm`)}))` : '0');
    const conFlag = (a: Asset, t: number): string => (has(`tl:flag:${a.phaseId}:con`) ? P(`tl:flag:${a.phaseId}:con`, t) : '0');
    const lineAssets = pc0.idcLines.map((l) => l.assetIds.map((id) => idcAssets.find((a) => a.id === id)).filter((a): a is Asset => !!a));
    const DIN = (k: string): string => w.refA({ sheet: FIN, row: w.addr(k).row, col: 2 }, here);
    const span = (keys: string[], cell: (k: string) => string): string => {
      const rs = keys.map((k) => w.addr(k).row);
      const together = rs.length > 1 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1);
      return together ? `${cell(keys[0])}:${cell(keys[keys.length - 1])}` : '';
    };
    const areaK = lineAssets.map((_, i) => `fl:idcArea:${i}`).filter(has), flagK = lineAssets.map((_, i) => `fl:idcFlag:${i}`).filter(has);
    const tabled = areaK.length === lineAssets.length && flagK.length === lineAssets.length && lineAssets.length > 0;
    if (tabled) {
      lineAssets.forEach((as, i) => {
        // A GREEN LINK (2026-11-19, founder): the line's land on Land & Area (its one line row where it pools plots).
        const lk = `landline:${pc0.idcLines[i].key}:sqm`;
        const link = as.length === 1 && has(`land:${as[0].id}:sqm`) ? w.ref(`land:${as[0].id}:sqm`) : has(lk) ? w.ref(lk) : as.map(sqm).join('+') || '0';
        w.fA({ sheet: FIN, row: w.addr(`fl:idcArea:${i}`).row, col: 2 }, link, { numFmt: '#,##0' });
        put(`fl:idcFlag:${i}`, (t) => (as[0] ? conFlag(as[0], t) : '0'), 'none');
      });
      const areas = span(areaK, DIN);
      const areaSum = areas ? `SUM(${areas})` : areaK.map(DIN).join('+');
      const act = (t: number): string => { const fl = span(flagK, (k) => P(k, t)); return areas && fl ? `SUMPRODUCT(${areas},${fl})` : lineAssets.map((_, i) => `${DIN(`fl:idcArea:${i}`)}*${P(`fl:idcFlag:${i}`, t)}`).join('+'); };
      lineAssets.forEach((_, i) => {
        const a = DIN(`fl:idcArea:${i}`), f = (t: number): string => P(`fl:idcFlag:${i}`, t);
        put(`fl:idcShare:${i}`, (t) => `IF(${P('fl:idcBasis', t)}>0,IF(${act(t)}>0,${a}*${f(t)}/${act(t)},${a}/${areaSum}),0)`, 'none');
      });
      const shareK = lineAssets.map((_, i) => `fl:idcShare:${i}`);
      put('fl:idcShareChk', (t) => { const sp = span(shareK, (k) => P(k, t)); return `IF(${P('fl:idcBasis', t)}>0,${sp ? `SUM(${sp})` : shareK.map((k) => P(k, t)).join('+')}-1,0)`; }, 'none');
    }
    const idcK: string[] = [];
    pc0.idcLines.forEach((l, i) => {
      const k = `fl:idc:${i}`;
      if (!has(k)) return;
      const as = lineAssets[i];
      if (tabled) put(k, (t) => `${P('fl:idcBasis', t)}*${P(`fl:idcShare:${i}`, t)}`);
      else {
        // No allocation table (a line's assets in two phases): each line's land under construction, in the formula.
        const sq = as.map(sqm).join('+') || '0';
        const tot = idcAssets.map(sqm).join('+') || '0';
        const actv = (t: number): string => idcAssets.map((a) => `${conFlag(a, t)}*${sqm(a)}`).join('+') || '0';
        const flag = (t: number): string => (as[0] ? conFlag(as[0], t) : '0');
        put(k, (t) => `IF(${P('fl:idcBasis', t)}=0,0,IF((${actv(t)})>0,${flag(t)}*${P('fl:idcBasis', t)}*(${sq})/(${actv(t)}),${P('fl:idcBasis', t)}*(${sq})/(${tot})))`);
      }
      idcK.push(k);
      for (const id of l.assetIds) w.claim(`fnc:main:idc:${id}`, FIN, w.addr(k).row, 1);
    });
    put('fl:idcLinesTot', (t) => { const sp = span(idcK, (k) => P(k, t)); return sp ? `SUM(${sp})` : idcK.map((k) => P(k, t)).join('+') || '0'; });
    put('fl:idcLineChk', (t) => `${P('fl:idcLinesTot', t)}-${P('fl:idcBasis', t)}`, 'none');
    const idcPre = (t: number): string => `MAX(0,${P('schv:__project__:idcNbv', t, -1)}+${P('schv:__project__:idcAdd', t)}-${P('schv:__project__:idcDep', t)})`;
    put('fl:idcDisp', (t) => (has('schv:__project__:idcNbv') ? `-(${exitF(t)}*${idcPre(t)})` : '0'));

    // ── Zakat: the P&L's charge, read back (2026-11-15, founder; formulaWorkbook LOOP_LINKS) ──
    const plTax = 'pl|__all__||zakat';
    put('fl:tax', (t) => (has(plTax) ? `-${P(plTax, t)}` : '0'));
    // The exit year's zakat is paid in the exit year (2026-11-18): nothing payable from the exit on.
    put('fl:taxPay', (t) => `${P('fl:tax', t)}*MIN(365,MAX(0,N(${w.ref('project:taxDays')})))/365${booked && has('tl:flag:exit') ? `*(1-SUM(${w.rangeA(w.addr('tl:flag:exit').sheet, w.addr('tl:flag:exit').row, pc(0), pc(t))}))` : ''}`, 'last');
    if (has('fl:taxOpen')) put('fl:taxOpen', (t) => `N(${P('fl:taxPay', t, -1)})`, 'last');
    if (has('fl:taxPay')) put('fl:taxPaid', (t) => `${has('fl:taxOpen') ? `${P('fl:taxOpen', t)}+` : ''}${P('fl:tax', t)}-${P('fl:taxPay', t)}`);
    if (has('fl:taxChk')) put('fl:taxChk', (t) => `${P('fl:taxOpen', t)}+${P('fl:tax', t)}-${P('fl:taxPaid', t)}-${P('fl:taxPay', t)}`);

    // ── The fund fees ────────────────────────────────────────────────────────
    if (feeOn) {
      // The base: the funding need with the fees left out (Method 3), or the draws (Methods 1 and 2,
      // sized on capex and pre-sales, which the fees do not move). Its first year is the first draw.
      const baseKey = METHOD === 3 ? (byEq ? 'fl:need' : 'fl:needExFee') : undefined;
      const R = (): string => (baseKey ? T(baseKey) : `(${T('fl:debtDraw')}+${T('fl:eqDraw')})`);
      const notDrawn = baseKey ? `${rowRange(baseKey)}<=0` : `(${rowRange('fl:debtDraw')}+${rowRange('fl:eqDraw')})<=0`;
      putS('fl:firstDraw', firstYearWhere(notDrawn));
      putS('fl:feeEq', `${R()}*${eF()}`);
      putS('fl:feeDebt', `${R()}*${dF()}`);
      // The fund size is the fee-free funding need, debt and equity together (2026-11-19: the two halves only where a fee is charged on one).
      putS('fl:feeFund', fundTerms.fundSizeOverride ? `MAX(0,N(${w.ref('ft:Fund size (typed target)')}))` : has('fl:feeEq') && has('fl:feeDebt') ? `${T('fl:feeEq')}+${T('fl:feeDebt')}` : R());
      // THE BASES OF 2026-11-18 (founder): total development cost, debt share x cash cost, the total
      // facility (fee-free), and equity to date; the Inputs text picks the structure and arranging bases.
      // Development cost excludes the sales commission, a cost to sell (2026-11-18): its Capex rows come off.
      const commKeys = reg.keys().filter((k) => k.startsWith('cxc:') && k.split(':').length === 3 && (() => {
        const cl = state.costLines.find((x) => x.id === k.split(':')[2]);
        return !!cl && resolveCatalogId(cl) === 'commission';
      })());
      const lessComm = commKeys.length ? `-(${commKeys.map((k) => `SUM(${rowRange(k)})`).join('+')})` : '';
      // A LINK TO ONE ROW (2026-11-19, founder): Capex's "Total development cost (excl. selling costs)".
      putS('fl:feeTdc', has('cx:tdc') ? w.one('cx:tdc') : `SUM(${rowRange('cx2:total')})${lessComm}`);
      // Capex paid in cash already leaves the sales commission out (2026-11-19, founder A2).
      putS('fl:feeDsc', `${dF()}*SUM(${rowRange('fl:capex')})`);
      if (has('fl:xIdc')) {
        // The fee-free need (2026-11-18): its own row on the deficit path; on the equity path the funding need IS fee-free.
        const needK = has('fl:needExFee') ? 'fl:needExFee' : 'fl:need';
        const newT = tranches.filter((t) => t.origin !== 'existing');
        const shares = newT.map((t) => (anyShareTyped && has(`tr:${t.id}:share`) ? `MAX(0,N(${w.ref(`tr:${t.id}:share`)}))` : String(1 / Math.max(1, newT.length))));
        // ONE LOAN READS ITS OWN RATE; SEVERAL ARE WEIGHTED BY THEIR SHARE CELLS (2026-11-19, founder: no literal weights).
        putS('fl:xRate', newT.length === 1 ? T(`fl:tr:${newT[0].id}:rate`) : `IF((${shares.join('+')})>0,(${newT.map((t, j) => `${shares[j]}*${T(`fl:tr:${t.id}:rate`)}`).join('+')})/(${shares.join('+')}),0)`);
        const excl = has('fl:idcExcl') ? T('fl:idcExcl') : '0';
        put('fl:xIdc', (t) => `IF(${running(t)},${T('fl:xRate')}*(N(${P('fl:xBal', t, -1)})+${P(needK, t)}*${dF()}/2)/(1-(1-${excl})*${T('fl:xRate')}/2),0)`);
        put('fl:xBal', (t) => `N(${P('fl:xBal', t, -1)})+${P(needK, t)}*${dF()}+${P('fl:xIdc', t)}`, 'last');
        putS('fl:feeFac', `SUM(${rowRange(needK)})*${dF()}+SUM(${rowRange('fl:xIdc')})`);
      } else {
        putS('fl:feeFac', fac.filter((f) => !f.isEx).map((f) => `SUM(${rowRange(f.draw)})+SUM(${rowRange(f.idc)})`).join('+') || '0');
      }
      const eqBase = (t: number): string => (baseKey ? `SUM(${toNow(baseKey, t)})*${eF()}` : `SUM(${toNow('fl:eqDraw', t)})`);
      put('fl:feeEtd', (t) => `${has('tl:flag:upto') ? P('tl:flag:upto', t) : alive(t)}*(${eqBase(t)}+SUM(${toNow('fl:inKind', t)}))`);
      // A balance: its peak in the Total column, labelled "peak" in the Input column (2026-11-19, founder).
      if (has('fl:feeEtd')) { const ea = w.addr('fl:feeEtd'); w.fA({ sheet: FIN, row: ea.row, col: TOTAL_COL }, `MAX(${rowRange('fl:feeEtd')})`); const pk = w.cellA({ sheet: FIN, row: ea.row, col: 2 }); pk.value = 'peak'; pk.alignment = { horizontal: 'right' }; pk.font = { name: 'Calibri', size: 8, italic: true }; }
      const strBasis = has('ft:Structure fee basis') ? `ISNUMBER(SEARCH("development",${w.ref('ft:Structure fee basis')}))` : 'FALSE';
      const arrBasis = has('ft:Arranging fee basis') ? `ISNUMBER(SEARCH("cash",${w.ref('ft:Arranging fee basis')}))` : 'FALSE';
      const baseOf = (base: string, key: string): string => (key === 'fundStructureFeePct' ? `IF(${strBasis},${T('fl:feeTdc')},${T('fl:feeFund')})`
        : key === 'debtArrangingFeePct' ? `IF(${arrBasis},${T('fl:feeDsc')},${T('fl:feeFac')})`
        : base === 'fund_size' ? T('fl:feeFund') : base === 'total_equity' ? T('fl:feeEq') : base === 'debt_facility' ? T('fl:feeDebt') : '0');
      const feeKeys: string[] = [];
      FUND_FEE_SPECS.forEach((spec, i) => {
        const k = `fl:fee:${i}`;
        if (!has(k)) return;
        const rateIn = has(`ft:${spec.label}`) ? `N(${w.ref(`ft:${spec.label}`)})` : '0';
        put(k, (t) => {
          const when = spec.timing === 'one_time' ? `(${Y(t)}=${T('fl:firstDraw')})*` : '';
          if (spec.base === 'equity_to_date') return `${rateIn}*${P('fl:feeEtd', t)}`;
          return `${has('tl:flag:upto') ? P('tl:flag:upto', t) : alive(t)}*${when}${rateIn}${spec.kind === 'amount' ? '' : `*${baseOf(spec.base, spec.key)}`}`;
        });
        feeKeys.push(k);
        w.claim(`fnc:fee:${i}`, FIN, w.addr(k).row, 1);
      });
      // The manager's fees (2026-11-19, founder B8): every fee but the flat other expenses; the total adds those.
      const flatKeys = feeKeys.filter((k) => snap.fundFees.lines[Number(k.slice('fl:fee:'.length))]?.base === 'flat_amount');
      if (has('fl:feeMgr')) {
        put('fl:feeMgr', (t) => chain(feeKeys.filter((k) => !flatKeys.includes(k)), t));
        put('fl:feeTot', (t) => chain(['fl:feeMgr', ...flatKeys], t));
        claim('fnc:feeMgr', 'fl:feeMgr');
      } else put('fl:feeTot', (t) => chain(feeKeys, t));
      claim('fnc:feeTot', 'fl:feeTot');
      why('fl:feeTot', CHAIN);
      claim('fnc:fee:base', baseKey ?? 'fl:debtDraw');
      claim('fnc:fee:fundsize', 'fl:feeFund');
      // The capital bases the P&L block lists (FUND_CAPITAL_LABELS), each at its Financing cell.
      w.claim(`ftcap:${FUND_CAPITAL_LABELS.fundSize}`, FIN, w.addr('fl:feeFund').row, TOTAL_COL);
      w.claim(`ftcap:${FUND_CAPITAL_LABELS.tdc}`, FIN, w.addr('fl:feeTdc').row, TOTAL_COL);
      w.claim(`ftcap:${FUND_CAPITAL_LABELS.facility}`, FIN, w.addr('fl:feeFac').row, TOTAL_COL);
      w.claim(`ftcap:${FUND_CAPITAL_LABELS.dsc}`, FIN, w.addr('fl:feeDsc').row, TOTAL_COL);
      w.claim(`ftcap:${FUND_CAPITAL_LABELS.etdPeak}`, FIN, w.addr('fl:feeEtd').row, TOTAL_COL);
      claim('fnc:feeEtd', 'fl:feeEtd');
      for (const k of ['fl:feeFund', 'fl:feeTdc', 'fl:feeFac', 'fl:feeDsc', 'fl:firstDraw']) w.claim(`fnc:${k.slice(3)}`, FIN, w.addr(k).row, TOTAL_COL);
    }

    // ── The cash waterfall, the sweep and the dividends ──────────────────────
    put('fl:cwOpen', (t) => `N(${P('fl:close', t, -1)})`, 'last');
    // The fees paid read the fee total itself: the funding test's own row is blank after the build (2026-11-17).
    put('fl:cfo', (t) => (byEq ? `${P('fl:opIn', t)}-${fee(t)}` : P('fl:opIn', t)));
    put('fl:cfiCapex', (t) => `-${P('fl:capex', t)}`);
    put('fl:cfiExit', (t) => (has('fl:proceeds') ? P('fl:proceeds', t) : '0'));
    put('fl:eqCash', (t) => `${P('fl:eqDraw', t)}${byEq ? `+${P('fl:feeDraw', t)}` : ''}`);
    // SHARE CAPITAL ON FINANCING (2026-11-19, founder B7): opening, the cash equity, the land in kind, the return of
    // capital (a distribution beyond the retained earnings available), closing; the Balance Sheet links the closing.
    if (has('fl:sc:close')) {
      put('fl:sc:open', (t) => `N(${P('fl:sc:close', t, -1)})`, 'none');
      put('fl:sc:eqCapex', (t) => P('fl:eqDraw', t));
      if (has('fl:sc:eqFee')) put('fl:sc:eqFee', (t) => P('fl:feeDraw', t));
      put('fl:sc:kind', (t) => (has('fl:inKind') ? P('fl:inKind', t) : '0'));
      const before = (t: number): string => ['fl:sc:open', 'fl:sc:eqCapex', 'fl:sc:eqFee', 'fl:sc:kind'].filter(has).map((k) => P(k, t)).join('+');
      put('fl:sc:roc', (t) => (has('fl:reAvail') && has('fl:div') ? `-MAX(0,MIN(-${P('fl:div', t)}-MIN(-${P('fl:div', t)},${P('fl:reAvail', t)}),MAX(0,${before(t)})))` : '0'));
      put('fl:sc:close', (t) => `${before(t)}+${P('fl:sc:roc', t)}`, 'last');
    }
    put('fl:debtCash', (t) => (has('fl:drawAll') ? `${P('fl:drawAll', t)}+${P('fl:idcAll', t)}` : `${sumF(fac, 'draw', t)}+${sumF(newF, 'idc', t)}`));
    put('fl:intPaid', (t) => `-(${interest(t)})`);
    put('fl:cash', (t) => chain(['fl:cwOpen', 'fl:cfo', 'fl:cfiCapex', 'fl:cfiExit', 'fl:eqCash', 'fl:debtCash', 'fl:intPaid'], t), 'last');
    why('fl:cash', CHAIN);
    const exitKs = fac.map((f) => `fl:tr:${f.t.id}:exitRepaid`).filter(has);
    put('fl:exitRepay', (t) => (exitKs.length ? `-(${exitKs.map((k) => P(k, t)).join('+')})` : `${exitF(t)}*MAX(0,${sumF(fac, 'close', t)})`));
    put('fl:repaidCash', (t) => `${sumF(fac, 'repaid', t)}-${P('fl:exitRepay', t)}`);
    put('fl:forDiv', (t) => `${P('fl:cash', t)}+${P('fl:repaidCash', t)}`, 'last');
    // The cash above the minimum, to the cent: its own row, which every dividend reads.
    if (!has('fl:excess')) return values('The financing could not be made live for this model: the cash above the minimum has no row.');
    put('fl:excess', (t) => `IF(ROUND(${P('fl:forDiv', t)}-${MINT(t)},2)<=0,0,${P('fl:forDiv', t)}-${MINT(t)})`, 'last');
    const excess = (t: number): string => P('fl:excess', t);
    // ONE PROJECT DIVIDEND (2026-11-18, founder): a payout of the cash above the minimum, capped at the
    // retained earnings available (the Balance Sheet's own figure, which reads no dividend of this year)
    // unless Inputs allows dividends above them, when the excess is a return of capital.
    if (!has('fl:divP')) return values('The financing could not be made live for this model: the dividend has no row.');
    const E2 = (label: string): string => `sch|E2||${label}`;
    if (has('fl:reAvail')) {
      const bsOpen = E2('Opening'), bsPat = E2('PAT'), bsTr = E2('Transfer');
      if (!has(bsOpen) || !has(bsPat)) return values('The financing could not be made live for this model: the retained earnings rows are not on the Balance Sheet.');
      put('fl:reAvail', (t) => `MAX(0,${P(bsOpen, t)}+${P(bsPat, t)}${has(bsTr) ? `+${P(bsTr, t)}` : ''})`);
    }
    if (onEbitda) {
      const kPl = `pl|__all__||${labels.ebitda}`;
      if (!has('fl:ebitda') || !has(kPl)) return values('The financing could not be made live for this model: the project EBITDA is not on the P&L.');
      put('fl:ebitda', (t) => P(kPl, t));
    }
    put('fl:divP', (t) => {
      const ex = excess(t);
      const desired = onEbitda ? `MIN(MAX(0,${P('fl:ebitda', t)})*${payout()},${ex})` : `${ex}*${payout()}`;
      // Inputs: 1 pays above the retained earnings (the excess is a return of capital on the Balance Sheet).
      const above = has('fin:in:divAbove') ? `N(${IN('fin:in:divAbove')})` : '0';
      const cap = has('fl:reAvail') ? `IF(${above}=1,${desired},MIN(${desired},${P('fl:reAvail', t)}))` : desired;
      return `IF(AND(${divOn()}=1,${Y(t)}>=${T('fl:divStart')},${payout()}>0,${ex}>0),${cap},0)`;
    });
    const phaseSum = (t: number): string => P('fl:divP', t);
    put('fl:div', (t) => `-(${phaseSum(t)}+${exitF(t)}*IF(AND(${divOn()}=1,${excess(t)}>0,ROUND(${P('fl:forDiv', t)}-(${phaseSum(t)}),2)>0),${P('fl:forDiv', t)}-(${phaseSum(t)}),0))`);
    why('fl:div', 'The phases\' dividends, and in the exit year all the cash above the minimum.');
    put('fl:close', (t) => `${P('fl:forDiv', t)}+${P('fl:div', t)}`, 'last');
    for (const f of fac) put(`fl:tr:${f.t.id}:left`, (t) => `${booked ? `SUM(${toNow('tl:flag:exit', t)})` : '0'}*${P(f.close, t)}`, 'none');
    for (const f of fac) put(`fl:tr:${f.t.id}:bs`, (t) => `(1-${booked ? `SUM(${toNow('tl:flag:exit', t)})` : '0'})*${P(f.close, t)}`, 'last');
    put('fl:debtBs', (t) => { const ks = fac.map((f) => f.close).filter(has); const rs = ks.map((k) => w.addr(k).row); const tog = rs.length > 1 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1); return tog ? `SUM(${P(ks[0], t)}:${P(ks[ks.length - 1], t)})` : ks.map((k) => P(k, t)).join('+') || '0'; }, 'last');

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
    // A LINK, NOT A RECOMPUTATION (2026-11-19, founder): a line's IDC on Financing 4.3 is never negative.
    for (const l of lines.filter((x) => has(`cosc:${x.key}:idc`))) liveRow(`cosc:${l.key}:idc`, lineIdc(l.members.map((m) => m.id)));
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
    for (const gr of report.groups) for (const l of gr.lines) {
      if (!has(`schv:${l.hostId}:idcAdd`)) continue;
      const ids = l.memberIds.filter((id) => { const r0 = snap.idc.byAsset.get(id); return !!r0 && idcRowIsHeld(r0); });
      liveRow(`schv:${l.hostId}:idcAdd`, lineIdc(ids));
    }

    // A CIRCULAR CELL NEEDS A STARTING VALUE. Excel iterates a loop from each cell's cached result;
    // a formula written with none enters the first pass with nothing to start from and the loop never
    // recovers. Every formula on the tabs the loop runs through that carries no value starts from 0.
    for (const name of [FIN, 'Fixed Assets & Inventory']) {
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
