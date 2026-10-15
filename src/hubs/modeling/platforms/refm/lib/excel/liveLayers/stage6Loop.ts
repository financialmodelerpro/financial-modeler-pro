/**
 * stage6Loop.ts (2026-10-15), FORMULA-LINKED EXPORT, STAGE 6: THE FINANCING LOOP, ON
 * THE FINANCING TAB.
 *
 * The platform solves the financing to a FIXED POINT (`computeFinancialsSnapshot`):
 * the Method 3 deficit, the capitalised-interest cash budget and the sweep budget
 * each come from a pass's own cash waterfall and feed the next until nothing moves.
 * Here those are circular formulas Excel iterates, written into the Financing tab's
 * own rows (the founder, 2026-10-14: no hidden sheets): the funding need, the debt
 * and equity drawn, each facility's interest, the interest drawn as debt, its
 * repayments and sweep, the cash waterfall, the dividends by phase. The rows the
 * platform's tables do not carry are in the blocks at the foot of the tab: the
 * settings in force, the land the capitalised interest is shared on, the fund fees,
 * the profit before tax inside the loop and the exit.
 *
 * THE LOOP READS ONLY EARLIER TABS (Revenue, Capex, Opex, Schedules), never the
 * statements: its operating cash is Revenue's collections, Opex's cash paid and the
 * escrow; its profit before tax is revenue less opex, cost of sales and depreciation
 * (Schedules), the fees and the interest expensed. Checks proves it equals the P&L
 * every year. ITS ONE BACKWARD LINK: the capitalised interest allocated to each line,
 * which Schedules reads (cost of sales and the held lines' additions) and Capex's
 * Table 7; the Guide lists them.
 *
 * THE FEES NEED NO SECOND PASS (measured 2026-10-14): the base is the funding need
 * re-walked with the fee rows added back, which equals the platform's fee-free
 * requirement; where it would not (the layer re-walks the platform's own figures and
 * compares), the tab is refused by name.
 *
 * REFUSES by name (Financing stays the platform's values): a funding method other than
 * 1 to 3, a facility other than new loans (and existing ones raised inside the model)
 * at an interbank rate plus spread, a repayment method the sheet does not show,
 * parcel funding that varies within a phase or is deferred, monthly periods, an
 * operational phase or overlap, existing operations, a terminal value the sheet does
 * not state, an exit before the last year, a per-phase dividend policy, a fund fee on
 * NAV or a facility limit, interest allocated by GFA, the fee base above.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { terminalRefusal, terminalValueFormula } from './terminal';
import { citReliefF, citPoolF, taxF } from './taxRule';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot, computeFundingGap } from '../../financials-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { buildFixedAssetReport, idcRowIsHeld } from '../../reports/fixedAssetReports';
import { disposalContextOf } from '../../reports/disposalSchedules';
import { operatingCashClass } from '../../reports/financingReports';
import { ARGB } from '../styles';
import type { Asset, Phase } from '../../state/module1-types';

const FIN = 'Financing';
type F = (t: number) => string;

/** Repayment the live solve expresses: the sweep, and the fixed-count schedules (computeFacilitySchedule). */
const LIVE_REPAYMENT = new Set(['cash_sweep', 'equal_repayment', 'straight_line', 'equal_periodic_amortization', 'bullet', 'year_on_year_pct']);
const bandOf = (t: { name: string; origin?: string }): string => `${t.name} (${t.origin === 'existing' ? 'existing' : 'new'} facility)`;
const SWEEPS = (t: { repaymentMethod: string; cashSweepConfig?: { enabled?: boolean } }): boolean =>
  t.repaymentMethod === 'cash_sweep' || t.cashSweepConfig?.enabled === true;

/**
 * THE LOOP'S FIGURES BY KEY, FOR THE LAYERS AFTER IT. A key is claimed at its visible row;
 * where the row prints the figure as an outflow (negative) the reader negates it here, so
 * every reader sees the quantity the key names.
 */
export const LOOP_NEGATIVE = new Set(['fnc:main:repay', 'fnc:main:intexp', 'fnc:main:div', 'fnc:main:sched', 'fnc:main:idcdisp']);
export function loopAt(w: LiveWriter, key: string, t: number): string {
  const r = w.per(key, t);
  return LOOP_NEGATIVE.has(key) ? `(-${r})` : r;
}
/** A single figure of the loop (its Total column), or the setting it names. */
export function loopOne(w: LiveWriter, key: string): string {
  if (key === 'fnc:don') return `IF(${w.one('fin|Dividend Policy|Pay Dividends')}="On",1,0)`;
  if (key === 'fnc:min') return `MAX(0,N(${w.one('fin|1. Project Financing Settings|Minimum Cash Reserve')}))`;
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
    const phases = state.phases as Phase[];
    const visible = state.assets.filter((a) => a.visible !== false);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
    const finCfg = project.financing;
    const tranches = state.financingTranches ?? [];
    const fundTerms = resolveFundTerms(project);
    const retCfg = resolveReturnsConfig(project, N);
    const X = retCfg.exitYearOffset;
    const booked = retCfg.terminalMethod !== 'none';
    const taxLagDays = (project.tax?.paymentDays ?? 0) > 0;
    const values = (note: string) => [{ sheet: FIN, status: 'values' as const, formulas: 0, note }];
    const METHOD = (finCfg?.fundingMethod ?? 1) as number;
    const feeOn = fundTerms.enabled;
    const byEq = feeOn && fundTerms.managementFeeFunding === 'equity';

    // ── Rows by key ──────────────────────────────────────────────────────────
    const finKeys = reg.keys().filter((k) => k.startsWith('fin|'));
    const strip = (s: string): string => s.replace(/~\d+$/, '');
    const find = (sec: string | RegExp, label: string | RegExp): string | undefined => finKeys.find((k) => {
      const [, s, l] = k.split('|');
      return (typeof sec === 'string' ? s === sec : sec.test(s)) && (typeof label === 'string' ? strip(l) === label : label.test(strip(l)));
    });
    const SET = 'Settings in force (worked out from the inputs above)';
    const FEES = 'Fund fees (charged on the funding need without the fees)';
    const PBT = 'Profit before tax inside the financing loop';
    const M3 = 'Method 3, Cash Deficit Funding (Drawdown Sizing)';
    const CW = /^Cash Waterfall/;
    const IDC = /^IDC Allocation, by Line/;
    const K = {
      minCash: 'fin|1. Project Financing Settings|Minimum Cash Reserve',
      debtPct: `fin|2a. Method ${METHOD} Configuration|Debt %`,
      equityPct: `fin|2a. Method ${METHOD} Configuration|Equity %`,
      sweepStartIn: 'fin|Cash Sweep Settings|Sweep Starting Year (calendar)',
      sweepRatio: 'fin|Cash Sweep Settings|Sweep Ratio (% of excess cash)',
      divOn: 'fin|Dividend Policy|Pay Dividends',
      payout: 'fin|Dividend Policy|Payout Ratio',
      divStartIn: 'fin|Dividend Policy|Start Year',
      lastCon: `fin|${SET}|Last construction year`,
      dF: `fin|${SET}|Debt share of the funding`,
      eF: `fin|${SET}|Equity share of the funding`,
      landDebt: `fin|${SET}|Land cash funded by debt (share)`,
      sweepStart: `fin|${SET}|Sweep starts (year)`,
      divStart: `fin|${SET}|Dividends start (year)`,
      sqmTot: `fin|${SET}|Land of the assets that share capitalised interest (sqm)`,
      sqmActive: `fin|${SET}|Land under construction (sqm)`,
      capexAll: 'fin|6. Capex Breakdown|Total Capex Incl Cash Land',
      nonLand: 'fin|6. Capex Breakdown|Capex (excluding Land)',
      landCash: 'fin|6. Capex Breakdown|Land Cash Value',
      inKind: 'fin|9. Total Equity Required|In-Kind Equity',
      noi: 'fin|Exit|Income of the held assets (NOI)',
      proceeds: 'fin|Exit|Exit proceeds (terminal value, in the exit year)',
      exitRepay: 'fin|Exit|Debt repaid at the exit',
    };

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (![1, 2, 3].includes(METHOD)) refuse.push(`funding method ${METHOD} (specified debt and equity amounts)`);
    if (!tranches.length) refuse.push('no facility');
    const psyNum = Number(w.platformValue(w.addr('project:axisYear')));
    for (const t of tranches) {
      if (t.origin === 'existing' && !(Number.isFinite(t.originationYear) && (t.originationYear as number) >= psyNum && (t.originationYear as number) < psyNum + N)) refuse.push('an existing loan raised before the model starts (existing operations)');
      if (t.origin === 'existing' && !has(`fin|${bandOf(t)}|Opening Balance`)) refuse.push(`the opening balance of ${t.name} is not on the Financing sheet`);
      if (!LIVE_REPAYMENT.has(t.repaymentMethod)) refuse.push(`repayment method ${t.repaymentMethod}`);
      if (t.interbankRatePct === undefined && t.creditSpreadPct === undefined) refuse.push('a facility rate not stated as interbank plus spread');
      if (t.cashSweepConfig?.startingYear !== undefined || t.cashSweepConfig?.sweepRatio !== undefined) refuse.push('a sweep set on the facility rather than the project');
      if (!has(`fin|${bandOf(t)}|Interbank Rate %`)) refuse.push(`the rates of ${t.name} are not on the Financing sheet`);
      const yoy = t.repaymentMethod === 'year_on_year_pct' && !SWEEPS(t);
      if (!SWEEPS(t) && !yoy && !has(`fin|${bandOf(t)}|Repayment Periods`)) refuse.push(`the repayment terms of ${t.name} are not on the Financing sheet`);
      if (yoy) {
        const yk = `fin|${bandOf(t)}|Year-on-Year % Schedule`;
        const shownStart = has(`fin|${bandOf(t)}|Repayment Start Year`) ? Number(w.platformValue(w.addr(`fin|${bandOf(t)}|Repayment Start Year`, TOTAL_COL))) : NaN;
        const room = N - (shownStart - psyNum);
        if (!has(yk) || !Number.isFinite(shownStart)) refuse.push(`the year-on-year schedule of ${t.name} is not on the Financing sheet`);
        else if ((t.yearOnYearPctSchedule ?? []).some((v, i) => i >= room && (v ?? 0) > 0)) refuse.push(`a year-on-year schedule of ${t.name} longer than the years the workbook shows`);
      }
      if (!has(`fin|${SET}|${t.name}: repayment starts (year)`)) refuse.push(`the settings of ${t.name} are not on the Financing sheet`);
    }
    if (new Set(tranches.map((t) => t.name)).size !== tranches.length) refuse.push('two facilities with the same name');
    const pf = finCfg?.parcelFunding ?? [];
    if (pf.some((c) => c.fundingType === 'deferred_payment')) refuse.push('a plot paid on a deferred schedule');
    const typedSplit = (c: { debtPct?: number; equityPct?: number }): boolean => typeof c.debtPct === 'number' || typeof c.equityPct === 'number';
    for (const ph of phases) {
      const cfgs = (state.parcels as Array<{ id: string; phaseId?: string }>).filter((p) => p.phaseId === ph.id).map((p) => pf.find((c) => c.parcelId === p.id));
      const typed = cfgs.filter((c): c is NonNullable<typeof c> => !!c && typedSplit(c));
      if (typed.length && (typed.length !== cfgs.length || typed.some((c) => c.debtPct !== typed[0].debtPct || c.equityPct !== typed[0].equityPct))) refuse.push(`${ph.name}'s plots state different land funding splits`);
    }
    if (project.modelType === 'monthly') refuse.push('monthly periods');
    if (phases.some((p) => p.status === 'operational' || (p.overlapPeriods ?? 0) !== 0)) refuse.push('an operational phase or a phase overlap');
    if (snap.bs.historicalOpeningCashTotal !== 0 || snap.financing.existing.equityTotal !== 0) refuse.push('existing operations');
    { const why = booked ? terminalRefusal(retCfg, has) : null; if (why) refuse.push(why); }
    if (booked && X < N - 1) refuse.push('an exit before the last year');
    if (booked && !has('tl:flag:exit')) refuse.push('the Timeline shows no exit year');
    if (!project.dividendPolicy && phases.some((ph) => ph.dividendPolicy?.enabled === true)) refuse.push('a per-phase dividend policy (set one project policy on Financing)');
    if (feeOn) {
      for (const spec of FUND_FEE_SPECS) {
        const v = Number((fundTerms as unknown as Record<string, number>)[spec.key]) || 0;
        if (v !== 0 && (spec.base === 'opening_nav' || spec.base === 'facility_limit')) refuse.push(`a fund fee charged on ${spec.base}`);
        if (v !== 0 && !has(`ft:${spec.label}`)) refuse.push(`the ${spec.label} rate is not on the Inputs sheet`);
      }
      if (fundTerms.fundSizeOverride && !has('ft:Fund size (typed target)')) refuse.push('a fund size override the Inputs sheet does not state as a number');
      // THE FEE BASE: the platform's figures re-walked with the fee rows added back must equal
      // its fee-free requirement, or a fee would be charged on a different base here.
      if (METHOD === 3) {
        const g = computeFundingGap(snap).method3Waterfall;
        const fees = snap.fundFees.totalPerPeriod;
        let open = 0, R = 0;
        for (let t = 0; t < N; t++) {
          const avail = open + (g.operatingInflowsPerPeriod[t] ?? 0) + (byEq ? 0 : (fees[t] ?? 0)) + (g.cashFromInvPerPeriod[t] ?? 0);
          const need = (g.cashFromInvPerPeriod[t] ?? 0) < -0.005 ? Math.max(0, g.minCashReserve - avail) : 0;
          R += need; open = avail + need;
        }
        const engine = (snap.fundFees.totalEquity?.amount ?? 0) + (snap.fundFees.debtFacility?.amount ?? 0);
        if (Math.abs(R - engine) > Math.max(1, Math.abs(engine) * 1e-9)) refuse.push(`the fund fee base: the funding need without the fees is ${Math.round(R).toLocaleString('en-US')} against the platform's fee-free ${Math.round(engine).toLocaleString('en-US')} (a construction year whose tax or cash moves with the fees)`);
      }
    }
    if ((project.idcConfig?.allocationBasis ?? 'land') !== 'land') refuse.push('capitalised interest allocated by GFA');
    for (const k of [K.minCash, K.debtPct, K.equityPct, K.payout, K.divOn, K.divStartIn, K.lastCon, K.dF, K.eF, K.landDebt, K.divStart, K.capexAll, K.nonLand, K.landCash, K.inKind, K.noi, K.proceeds, K.exitRepay]) {
      if (!has(k)) refuse.push(`the row ${k.split('|').slice(1).join(' / ')} is not on the Financing sheet`);
    }
    for (const k of ['cx3:total', 'cx5:total:cash', 'cx5:total:inkind', 'schv:__project__:dep', 'schv:__project__:capDep']) if (!has(k)) refuse.push(`the ${k} row is not live`);
    if (refuse.length) return values(`The financing could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers ──────────────────────────────────────────────────────
    const here = FIN;
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** Year t of a row (dt = -1: the year before), column relative. */
    const P = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    /** The Total (or the setting) of a row. */
    const T = (key: string): string => { const a = w.addr(key); return w.refA({ sheet: a.sheet, row: a.row, col: TOTAL_COL }, here); };
    const rowRange = (key: string): string => { const a = w.addr(key); return w.rangeA(a.sheet, a.row, pc(0), pc(N - 1)); };
    /** Year 0 to t of a row: $F$r:F$r. */
    const toNow = (key: string, t: number): string => { const a = w.addr(key); w.refP({ sheet: a.sheet, row: a.row, col: pc(t) }, here); return `${a.sheet === here ? '' : `'${a.sheet}'!`}$${colOf(pc(0))}$${a.row}:${colOf(pc(t))}$${a.row}`; };
    /** The opening column to the year before t: $E$r:E$r (t = 0) .. a row's sum to date, with no self-reference. */
    const toPrev = (key: string, t: number): string => { const a = w.addr(key); w.refP({ sheet: a.sheet, row: a.row, col: pc(t) - 1 }, here); return `${a.sheet === here ? '' : `'${a.sheet}'!`}$${colOf(OPEN_COL)}$${a.row}:${colOf(pc(t) - 1)}$${a.row}`; };
    const Y = (t: number): string => w.refP({ sheet: FIN, row: 3, col: pc(t) }, here);
    const Y0 = (): string => w.refA({ sheet: FIN, row: 3, col: pc(0) }, here);
    const YN = (): string => w.refA({ sheet: FIN, row: 3, col: pc(N - 1) }, here);
    const exitF = (t: number): string => (booked ? P('tl:flag:exit', t) : '0');
    /** A period row: its formula each year, and its Total. */
    const put = (key: string | undefined, f: F, tot: 'sum' | 'last' | 'none' = 'sum'): void => {
      if (!key || !has(key)) return;
      const a = w.addr(key);
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: pc(t) }, f(t));
      const Tc = { sheet: a.sheet, row: a.row, col: TOTAL_COL };
      if (tot === 'sum') w.fA(Tc, `SUM(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))})`);
      else if (tot === 'last') w.fA(Tc, w.refA({ sheet: a.sheet, row: a.row, col: pc(N - 1) }, here));
    };
    const putS = (key: string | undefined, formula: string): void => { if (key && has(key)) w.fA({ sheet: w.addr(key).sheet, row: w.addr(key).row, col: TOTAL_COL }, formula); };
    /** A note on a total built from rows that are not a block (so it is not a SUM). */
    const why = (key: string | undefined, text: string): void => {
      if (!key || !has(key)) return;
      const c: ExcelJS.Cell = w.cellA(w.addr(key));
      c.note = { texts: [{ text }] } as ExcelJS.Comment;
    };
    void ARGB;
    const claim = (name: string, key: string | undefined): void => { if (key && has(key)) { const a = w.addr(key); w.claim(name, a.sheet, a.row, 1); } };
    const inp = (k: string): string => T(k);
    const MIN = (): string => `MAX(0,N(${inp(K.minCash)}))`;
    const sumP = (keys: Array<string | undefined>, t: number): string => keys.filter((k): k is string => !!k && has(k)).map((k) => P(k, t)).join('+') || '0';

    // ── Settings in force ────────────────────────────────────────────────────
    const psd = (): string => `YEAR(${w.ref('project:startDate')})`;
    putS(K.lastCon, `MAX(${phases.map((p) => `MAX(0,YEAR(${w.ref(`phase:${p.id}:start`)})-${psd()})+MAX(0,${w.ref(`phase:${p.id}:cp`)})`).join(',')})+${psd()}-1`);
    const D = (): string => `MAX(0,N(${inp(K.debtPct)}))`, E = (): string => `MAX(0,N(${inp(K.equityPct)}))`;
    putS(K.dF, `IF(${D()}+${E()}>0,${D()}/(${D()}+${E()}),0.7)`);
    putS(K.eF, `1-${T(K.dF)}`);
    {
      const shareOf = (parcel: { id: string; phaseId?: string }): string => {
        const c = pf.find((x) => x.parcelId === parcel.id);
        if (!c) return '0';
        const ph = phases.find((x) => x.id === parcel.phaseId);
        const band = '4. Land Funding (per phase, from the Capex results)';
        const dk = ph ? `fin|${band}|${ph.name}, Debt %` : '', ek = ph ? `fin|${band}|${ph.name}, Equity %` : '';
        if (typedSplit(c) && has(dk) && has(ek)) { const d = `MAX(0,N(${inp(dk)}))`, e = `MAX(0,N(${inp(ek)}))`; return `IF(${d}+${e}>0,${d}/(${d}+${e}),0)`; }
        return c.fundingType === '100pct_debt' ? '1'
          : c.fundingType === 'custom_split' ? String(Math.max(0, c.customDebtPct ?? 0) / Math.max(1e-9, Math.max(0, c.customDebtPct ?? 0) + Math.max(0, c.customEquityPct ?? 100 - (c.customDebtPct ?? 0)))) : '0';
      };
      const plots = (state.parcels as Array<{ id: string; phaseId?: string }>).filter((x) => has(`parcel:${x.id}:cashValue`));
      const cv = (x: { id: string }): string => `MAX(0,N(${w.ref(`parcel:${x.id}:cashValue`)}))`;
      const tot = plots.map(cv).join('+');
      putS(K.landDebt, plots.length ? `IF((${tot})>0,(${plots.map((x) => `${cv(x)}*${shareOf(x)}`).join('+')})/(${tot}),0)` : '0');
    }
    const lastCon = (): string => T(K.lastCon);
    // The sweep and dividend starts: the year typed, else after construction (the default follows the
    // phases until a year is typed; a typed year is the one the Inputs carry).
    const startYear = (inKey: string, stored: number | undefined, dflt: () => string): string => {
      const shown = Number(w.platformValue(w.addr(inKey, TOTAL_COL)));
      const typed = `MAX(${Y0()},MIN(${YN()},N(${inp(inKey)})))`;
      return stored !== undefined ? typed : `IF(N(${inp(inKey)})=${shown},${dflt()},${typed})`;
    };
    const hasSweepIn = has(K.sweepStartIn);
    if (has(K.sweepStart)) putS(K.sweepStart, hasSweepIn ? startYear(K.sweepStartIn, finCfg?.cashSweep?.startingYear, () => `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`) : `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`);
    putS(K.divStart, startYear(K.divStartIn, project.dividendStartYear, () => `MAX(${Y0()},MIN(${YN()},MAX(${psd()},${phases.map((p) => `YEAR(${w.ref(`phase:${p.id}:start`)})+MAX(0,${w.ref(`phase:${p.id}:cp`)})`).join(',')})))`));
    const sweepRatio = (): string => (has(K.sweepRatio) ? `MAX(0,MIN(1,N(${inp(K.sweepRatio)})))` : '1');
    const divOn = (): string => `IF(${inp(K.divOn)}="On",1,0)`;
    const payout = (): string => `MAX(0,MIN(1,N(${inp(K.payout)})))`;
    const onEbitda = project.dividendPolicy?.mode === 'pct_of_ebitda';

    // ── The facilities, in the order the engine consumes the shared budgets ────
    const exFirst = (t: { origin?: string }): number => (t.origin === 'existing' ? 0 : 1);
    const ordered = tranches.map((t, i) => ({ t, i })).sort((a, b) => (exFirst(a.t) - exFirst(b.t)) || ((a.t.cashSweepConfig?.priority ?? 100) - (b.t.cashSweepConfig?.priority ?? 100)) || (a.i - b.i)).map((x) => x.t);
    const newCount = Math.max(1, tranches.filter((t) => t.origin !== 'existing').length);
    const anyShareTyped = tranches.some((t) => t.origin !== 'existing' && typeof t.facilitySharePct === 'number');
    const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fac = ordered.map((t) => {
      const band = bandOf(t);
      const isEx = t.origin === 'existing';
      const sweeps = SWEEPS(t);
      const sub = t.repaymentMethod === 'equal_repayment' ? (t.equalRepaymentSubMethod ?? 'equal_total') : '';
      const kind: 'sweep' | 'annuity' | 'principal' | 'bullet' | 'yoy' = sweeps ? 'sweep'
        : t.repaymentMethod === 'year_on_year_pct' ? 'yoy' : t.repaymentMethod === 'bullet' ? 'bullet'
          : t.repaymentMethod === 'equal_periodic_amortization' || sub === 'equal_total' ? 'annuity' : 'principal';
      const S = (s: string): string => `fin|${SET}|${t.name}: ${s}`;
      const DM = new RegExp(`^Debt Movement, ${esc(t.name)}( \\(.*\\))?$`);
      const FC = new RegExp(`^Finance Cost, ${esc(t.name)}( \\(.*\\))?$`);
      const keys = {
        open: find(DM, 'Opening'), draw: find(DM, 'Capex Drawdown'), idc: find(DM, 'IDC Drawdown (capitalized interest)'), tdraw: find(DM, 'Total Drawdown'),
        repaid: find(DM, /^Principal Repaid/), close: find(DM, 'Closing'),
        fcOpen: find(FC, 'Opening'), charge: find(FC, 'Charge (Accrued)'), paid: find(FC, 'Paid'), memo: find(FC, '(memo) of which funded by drawing debt'), fcClose: find(FC, 'Closing'),
        req: find('8. Total Debt Required', t.name),
        swOpen: find('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(t.name)}, Opening \\(pre-sweep\\)$`)),
        sw: find('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(t.name)}, Sweep Applied \\(`)),
        swClose: find('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(t.name)}, Closing \\(post-sweep\\)$`)),
        cwPaid: find(CW, new RegExp(`^\\(-\\) Debt Paid: ${esc(t.name)}`)),
        start: S('repayment starts (year)'), n: S('repayment periods'), fin: S('final repayment (year)'), td: S('total drawn'), pmt: S('scheduled payment'),
      };
      return { t, band, isEx, sweeps, kind, keys };
    });
    for (const f of fac) for (const k of ['open', 'draw', 'idc', 'tdraw', 'repaid', 'close', 'charge', 'start', 'n', 'fin', 'td'] as const) {
      if (!f.keys[k] || !has(f.keys[k]!)) return values(`The financing could not be made live for this model: ${f.t.name}'s ${k} row is not on the Financing sheet.`);
    }
    if (fac.some((f) => f.sweeps && !f.keys.sw)) return values('The financing could not be made live for this model: a swept facility has no sweep row.');
    // Their settings.
    for (const f of fac) {
      const bk = (s: string): string => `fin|${f.band}|${s}`;
      const startIn = bk('Repayment Start Year'), perIn = bk('Repayment Periods');
      const auto = f.isEx ? Y0() : `MIN(${YN()}+1,${lastCon()}+1)`;
      const typedS = `MAX(${Y0()},MIN(${YN()}+1,N(${inp(startIn)})))`;
      putS(f.keys.start, !has(startIn) ? auto : f.t.repaymentStartYear === undefined
        ? `IF(N(${inp(startIn)})=${Number(w.platformValue(w.addr(startIn, TOTAL_COL)))},${auto},${typedS})` : typedS);
      const st = (): string => T(f.keys.start);
      putS(f.keys.n, f.sweeps || !has(perIn) ? '0' : f.isEx ? `MAX(0,N(${inp(perIn)}))` : `IF(MAX(0,N(${inp(perIn)}))>0,MAX(0,N(${inp(perIn)})),MAX(0,${YN()}+1-${st()}))`);
      const n = (): string => T(f.keys.n);
      putS(f.keys.fin, f.sweeps ? YN() : `IF(${n()}>0,MIN(${YN()},${st()}+${n()}-1),${YN()})`);
      putS(f.keys.td, `SUM(${rowRange(f.keys.draw!)})`);
      const rt = `MAX(0,N(${inp(bk('Interbank Rate %'))})+N(${inp(bk('Credit Spread %'))}))`;
      if (f.kind === 'annuity') putS(f.keys.pmt, `IF(OR(${n()}<=0,${T(f.keys.td)}<=0),0,IF(${rt}<=0,${T(f.keys.td)}/${n()},${T(f.keys.td)}*${rt}*(1+${rt})^${n()}/((1+${rt})^${n()}-1)))`);
      else if (f.kind === 'principal') putS(f.keys.pmt, `IF(${n()}>0,${T(f.keys.td)}/${n()},0)`);
    }
    const rate = (f: typeof fac[number]): string => T(`fin|${f.band}|Interest Rate %`);
    for (const f of fac) putS(`fin|${f.band}|Interest Rate %`, `MAX(0,N(${inp(`fin|${f.band}|Interbank Rate %`)})+N(${inp(`fin|${f.band}|Credit Spread %`)}))`);

    // ── Capex, the exit, the operating cash ──────────────────────────────────
    put(K.capexAll, (t) => P('cx3:total', t));
    put(K.landCash, (t) => P('cx5:total:cash', t));
    put(K.nonLand, (t) => `MAX(0,${P(K.capexAll, t)}-${P(K.landCash, t)})`);
    put(K.inKind, (t) => P('cx5:total:inkind', t));
    put(find('4. Land Funding (per phase, from the Capex results)', 'Total, Land Cash'), (t) => P('cx5:total:cash', t));
    put(find('4. Land Funding (per phase, from the Capex results)', 'Total, Land In-Kind'), (t) => P('cx5:total:inkind', t));
    for (const p of phases) {
      put(find('4. Land Funding (per phase, from the Capex results)', `${p.name}, Land Cash (Capex Table 5)`), (t) => (has(`cx5:${p.id}:cash`) ? P(`cx5:${p.id}:cash`, t) : '0'));
      put(find('4. Land Funding (per phase, from the Capex results)', `${p.name}, Land In-Kind (Capex Table 5)`), (t) => (has(`cx5:${p.id}:inkind`) ? P(`cx5:${p.id}:inkind`, t) : '0'));
    }
    // Revenue earned and opex, by asset, from Revenue and Opex.
    const earner = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const assetRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !earner(a)) return () => '0';
      if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') return has(`rvc:${l.key}:recPre`) ? (t) => `${P(`rvc:${l.key}:recPre`, t)}+${P(`rvc:${l.key}:postRev`, t)}` : () => '0';
      if (a.strategy === 'Operate') return has(`rvc:${l.key}:total`) ? (t) => P(`rvc:${l.key}:total`, t) : () => '0';
      if (a.strategy === 'Lease') return has(`rvc:${l.key}:rev`) ? (t) => P(`rvc:${l.key}:rev`, t) : () => '0';
      return () => '0';
    };
    const assetOpex = (a: Asset): F => (has(`oxo:${a.id}:total`) ? (t) => P(`oxo:${a.id}:total`, t) : () => '0');
    const held = visible.filter((a) => a.strategy === 'Operate' || a.strategy === 'Lease');
    put(K.noi, (t) => `${held.map((a) => assetRev(a)(t)).join('+') || '0'}-(${held.map((a) => assetOpex(a)(t)).join('+') || '0'})`);
    const metricIdx = retCfg.terminalValueBasis === 'exit_year' ? X : Math.max(0, X - 1);
    put(K.proceeds, (t) => (booked ? `${exitF(t)}*${terminalValueFormula(w, retCfg, w.refA({ sheet: FIN, row: w.addr(K.noi).row, col: pc(metricIdx) }, here), true)}` : '0'));
    // Operating cash by class (Revenue's collections less Opex's cash paid), HQ, escrow and tax.
    const cashRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !state.subUnits.some((u) => u.assetId === a.id)) return () => '0';
      if (a.strategy === 'Operate') return has(`rvc:${l.key}:total`) ? (t) => P(`rvc:${l.key}:total`, t) : () => '0';
      if (a.strategy === 'Lease') return has(`rvc:${l.key}:rev`) ? (t) => P(`rvc:${l.key}:rev`, t) : () => '0';
      return has(`rvc:${a.id}:cash`) ? (t) => P(`rvc:${a.id}:cash`, t) : () => '0';
    };
    const opexPaid = (a: Asset): F => (has(`oxo:ap:${a.id}:lessPaid`) ? (t) => `-${P(`oxo:ap:${a.id}:lessPaid`, t)}` : () => '0');
    const classOf = (pick: (a: Asset) => boolean): F => (t) => visible.filter(pick).map((a) => `(${cashRev(a)(t)})-(${opexPaid(a)(t)})`).join('+') || '0';
    const kRes = find(M3, 'Residential cash collection'), kHosp = find(M3, 'Hospitality EBITDA'), kRet = find(M3, 'Retail NOI');
    const kFeeM3 = find(M3, '(-) Fund management fee'), kHq = find(M3, 'HQ overheads and marketing paid'), kEsc = find(M3, 'Escrow: pre-sales cash held and released'), kTaxM3 = find(M3, 'Tax paid');
    const kOpIn = find(M3, '= Total operating inflows');
    if (!kRes || !kHosp || !kRet || !kHq || !kEsc || !kTaxM3 || !kOpIn) return values('The financing could not be made live for this model: the Method 3 table does not carry the operating cash rows.');
    put(kRes, classOf((a) => operatingCashClass(a) === 'residential'));
    put(kHosp, classOf((a) => operatingCashClass(a) === 'hospitality'));
    put(kRet, classOf((a) => operatingCashClass(a) === 'retail'));
    // HQ overheads (Opex's cash paid) and the selling and marketing expensed as incurred (Capex's block).
    put(kHq, (t) => `${has('oxo:ap:hq:lessPaid') ? P('oxo:ap:hq:lessPaid', t) : '0'}${has('cx1e:total') ? `-${P('cx1e:total', t)}` : ''}`);
    const escNet = 'esc||C. Cash Flow Impact (project totals)|Net Cash Flow Adjustment (to M4)';
    put(kEsc, (t) => (has(escNet) ? P(escNet, t) : '0'));
    const kFeeTot = `fin|${FEES}|Total fund fees`;
    const fee = (t: number): string => (feeOn && has(kFeeTot) ? P(kFeeTot, t) : '0');
    if (kFeeM3) put(kFeeM3, (t) => (byEq ? '0' : `-${fee(t)}`));
    const kTaxPaid = `fin|${PBT}|Tax paid`;
    put(kTaxM3, (t) => `-${P(kTaxPaid, t)}`);
    put(kOpIn, (t) => sumP([kRes, kHosp, kRet, kFeeM3, kHq, kEsc, kTaxM3], t));
    why(kOpIn, byEq ? 'Not a SUM: the fund fee is drawn from equity outside the deficit, so its row reads zero here.' : 'The operating inflows above.');
    // Cash from operations: the operating inflows, less the fee where equity funds it.
    const cfo = (t: number): string => (byEq ? `${P(kOpIn, t)}-${fee(t)}` : P(kOpIn, t));
    const cfi = (t: number): string => `${P(K.proceeds, t)}-${P(K.capexAll, t)}`;

    // ── Method 3: the deficit walk ───────────────────────────────────────────
    const kCapexM3 = find(M3, 'Cash Capex (construction, land cash, RETT)'), kPre = find(M3, '= Pre-financing net cash (inflows less cash capex)');
    const kMin = find(M3, 'Minimum cash target'), kOpen = find(M3, 'Opening cash'), kExE = find(M3, '(+) Existing equity opening'), kExD = find(M3, '(+) Existing debt opening balance');
    const kAvail = find(M3, '= Cash before financing'), kNeed = find(M3, /^Development funding need = /), kDb = find(M3, /^Debt draw, base/), kEb = find(M3, /^Equity draw, base/);
    const kDcap = find(M3, 'Debt Drawdown, capex'), kDidc = find(M3, /^Debt Drawdown, IDC/), kDtot = find(M3, '= Total Debt Drawdown');
    const kEdev = find(M3, 'Equity Drawdown, development'), kEfee = find(M3, /^Equity Drawdown, fund management fee/), kEtot = find(M3, '= Total Equity Drawdown');
    const kFeeCash = find(M3, '(-) Fund management fee paid from cash (not drawn)'), kAfter = find(M3, /^Closing cash \(after funding/);
    for (const [n, k] of Object.entries({ kCapexM3, kPre, kMin, kOpen, kAvail, kNeed, kDb, kEb, kDcap, kDidc, kDtot, kEdev, kEtot, kAfter })) if (!k) return values(`The financing could not be made live for this model: the Method 3 table has no ${n} row.`);
    put(kCapexM3, (t) => `${P(K.capexAll, t)}-${P(K.proceeds, t)}`);
    put(kPre, (t) => `${P(kOpIn, t)}-${P(kCapexM3!, t)}`);
    put(kMin, () => MIN(), 'last');
    put(kOpen, (t) => P(kAfter!, t, -1), 'last');
    put(kExE, () => '0'); put(kExD, () => '0');
    put(kAvail, (t) => `${P(kOpen!, t)}+${P(kPre!, t)}${kExE ? `+${P(kExE, t)}` : ''}${kExD ? `+${P(kExD, t)}` : ''}`, 'last');
    why(kAvail, 'Not a SUM: the opening cash plus the pre-financing net cash (the rows between are memos).');
    const spending = (t: number): string => `(${P(kCapexM3!, t)}>0.005)`;
    put(kNeed, (t) => `IF(${spending(t)},MAX(0,${MIN()}-${P(kAvail!, t)}),0)`);
    const gapTot = (): string => T(kNeed!);
    // The draws, by method: on capex (Method 1, or 2 and 3 with no gap) excluding land at the ratio plus
    // the minimum in the first capex year, land cash at the plots' split; on a gap, the gap at the ratio.
    const firstCapex = (): string => `IFERROR(INDEX(${w.rangeA(FIN, 3, pc(0), pc(N - 1))},MATCH(TRUE,INDEX(${rowRange(K.capexAll)}>0,0),0)),${Y0()})`;
    const minAt = (t: number): string => `IF(${Y(t)}=${firstCapex()},${MIN()},0)`;
    const kGap2 = find('Method 2, Net Funding Requirement (Capex vs Pre-Sales)', /^Funding gap = MAX/);
    const onCapexD = (t: number): string => `(${P(K.nonLand, t)}+${minAt(t)})*${T(K.dF)}+${P(K.landCash, t)}*${T(K.landDebt)}`;
    const onCapexE = (t: number): string => `(${P(K.nonLand, t)}+${minAt(t)})*${T(K.eF)}+${P(K.landCash, t)}*(1-${T(K.landDebt)})`;
    const gapD = (t: number): string => (METHOD === 3 ? `IF(${gapTot()}>0,${P(kNeed!, t)}*${T(K.dF)},${onCapexD(t)})`
      : METHOD === 2 && kGap2 ? `IF(${T(kGap2)}>0,(${P(kGap2, t)}+${minAt(t)})*${T(K.dF)},${onCapexD(t)})` : onCapexD(t));
    const gapE = (t: number): string => (METHOD === 3 ? `IF(${gapTot()}>0,${P(kNeed!, t)}*${T(K.eF)},${onCapexE(t)})`
      : METHOD === 2 && kGap2 ? `IF(${T(kGap2)}>0,(${P(kGap2, t)}+${minAt(t)})*${T(K.eF)},${onCapexE(t)})` : onCapexE(t));
    const kDebtReq = find('8. Total Debt Required', 'Capex Drawdown Subtotal');
    const kEqDev = find('9. Total Equity Required', /^Cash Equity(, development.*)?$/);
    if (!kDebtReq || !kEqDev) return values('The financing could not be made live for this model: the debt and equity required rows are not on the Financing sheet.');
    put(kDebtReq, gapD);
    put(kEqDev, gapE);
    put(kDb, (t) => (METHOD === 3 ? P(kDebtReq, t) : `${P(kNeed!, t)}*${T(K.dF)}`));
    put(kEb, (t) => (METHOD === 3 ? P(kEqDev, t) : `${P(kNeed!, t)}*${T(K.eF)}`));
    put(kDcap, (t) => P(kDb!, t));
    put(kEdev, (t) => P(kEb!, t));
    // The fee drawn from equity: as far as keeps cash at the minimum, while construction spends.
    const kFeeDraw = find('9. Total Equity Required', /^Cash Equity, fund management fee/);
    put(kEfee, (t) => (byEq ? `IF(AND(${spending(t)},${fee(t)}>0),MIN(${fee(t)},MAX(0,${MIN()}-(${P(kAvail!, t)}+${P(kNeed!, t)}-${fee(t)}))),0)` : '0'));
    put(kFeeDraw, (t) => (kEfee ? P(kEfee, t) : '0'));
    put(kFeeCash, (t) => `-(${fee(t)}-${kEfee ? P(kEfee, t) : '0'})`);
    put(kEtot, (t) => `${P(kEdev!, t)}${kEfee ? `+${P(kEfee, t)}` : ''}`);
    put(kAfter, (t) => `${P(kAvail!, t)}+${P(kNeed!, t)}${byEq && kFeeCash ? `+${P(kFeeCash, t)}` : ''}`, 'last');
    why(kAfter, byEq ? 'Not a SUM: the cash before financing plus the funding need, less the fee paid from cash.' : 'Not a SUM: the cash before financing plus the funding need.');
    const head = (t: number): string => `MAX(0,${P(kAfter!, t)}-${MIN()})`;
    // Construction running: a year up to the last construction year with capex in it.
    const running = (t: number): string => `AND(${Y(t)}<=${lastCon()},${P(K.capexAll, t)}+${P(K.inKind, t)}>0)`;

    // ── Each facility ────────────────────────────────────────────────────────
    const kSweepStart = (): string => (has(K.sweepStart) ? T(K.sweepStart) : `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`);
    const kCash = find(CW, '= Cash Available');
    if (!kCash) return values('The financing could not be made live for this model: the cash waterfall has no Cash Available row.');
    const shareOf = (f: typeof fac[number]): string => (f.isEx ? '0' : anyShareTyped && has(`tr:${f.t.id}:share`) ? `MAX(0,N(${w.ref(`tr:${f.t.id}:share`)}))` : String(1 / newCount));
    const owed = (f: typeof fac[number], t: number): string => `(${P(f.keys.open!, t)}+${P(f.keys.draw!, t)}+${P(f.keys.idc!, t)})`;
    const yoyRow = (f: typeof fac[number]): string | undefined => (f.kind === 'yoy' ? `fin|${f.band}|Year-on-Year % Schedule` : undefined);
    const sched = (f: typeof fac[number], t: number): string => {
      if (f.kind === 'sweep') return '0';
      const st = T(f.keys.start), n = T(f.keys.n);
      const inWindow = `AND(${Y(t)}>=${st},${Y(t)}<${st}+${n})`;
      let due = '0';
      if (f.kind === 'annuity') due = `IF(${inWindow},MIN(${owed(f, t)},MAX(0,${T(f.keys.pmt)}-${P(f.keys.charge!, t)})),0)`;
      else if (f.kind === 'principal') due = `IF(${inWindow},MIN(${owed(f, t)},${T(f.keys.pmt)}),0)`;
      else if (f.kind === 'yoy') due = `MIN(${owed(f, t)},${T(f.keys.td)}*${P(`fin|${SET}|${f.t.name}: share of the total repaid in the year`, t)})`;
      return `IF(${Y(t)}=${T(f.keys.fin)},${owed(f, t)},${due})`;
    };
    for (const [j, f] of fac.entries()) {
      const before = fac.slice(0, j);
      const kk = f.keys;
      put(kk.draw, (t) => (f.isEx ? `(${Y(t)}=${Number(f.t.originationYear)})*MAX(0,N(${inp(`fin|${f.band}|Opening Balance`)}))` : `MAX(0,${P(kDebtReq, t)})*${shareOf(f)}`));
      put(kk.open, (t) => P(kk.close!, t, -1), 'last');
      const intStart = f.isEx && has(`fin|${f.band}|Interest Start Year`) ? `MAX(${Y0()},N(${inp(`fin|${f.band}|Interest Start Year`)}))` : null;
      put(kk.charge, (t) => `${intStart ? `(${Y(t)}>=${intStart})*` : ''}(${P(kk.open!, t)}+${P(kk.draw!, t)})*${rate(f)}`);
      // The interest the headroom above the minimum cannot pay is drawn as debt while construction runs.
      const paidBefore = (t: number): string => before.filter((b) => !b.isEx).map((b) => `(${P(b.keys.charge!, t)}-${P(b.keys.idc!, t)})`).join('+') || '0';
      put(kk.idc, (t) => (f.isEx ? '0' : `IF(${running(t)},MAX(0,${P(kk.charge!, t)}-MAX(0,${head(t)}-(${paidBefore(t)}))),0)`));
      put(kk.tdraw, (t) => `${P(kk.draw!, t)}+${P(kk.idc!, t)}`);
      put(kk.memo, (t) => P(kk.idc!, t));
      put(kk.fcOpen, () => '0', 'last'); put(kk.fcClose, () => '0', 'last');
      put(kk.paid, (t) => `-${P(kk.charge!, t)}`);
      put(kk.req, (t) => P(kk.draw!, t));
    }
    // The sweep: from the cash above the minimum after this year's scheduled principal and exit
    // repayment, each swept loan in turn from what the loans before it left.
    const schedTot = (t: number): string => fac.map((f) => sched(f, t)).join('+') || '0';
    const preSweep = (t: number): string => `MAX(0,${P(kCash, t)}-(${schedTot(t)})-${P(K.exitRepay, t)}-${MIN()})`;
    const tol = (f: typeof fac[number]): string => `MAX(1,MIN(1000,${T(f.keys.td)}*0.0001))`;
    for (const [j, f] of fac.entries()) {
      const kk = f.keys;
      const balA = (t: number): string => `(${owed(f, t)}-${sched(f, t)})`;
      const swBefore = (t: number): string => fac.slice(0, j).filter((b) => b.sweeps && b.keys.sw).map((b) => `(-${P(b.keys.sw!, t)})`).join('+') || '0';
      if (kk.sw) put(kk.sw, (t) => (f.sweeps ? `-IF(AND(${Y(t)}>=${kSweepStart()},${balA(t)}>0),MIN(${balA(t)},MAX(0,${preSweep(t)}-(${swBefore(t)}))*${sweepRatio()},MAX(0,${preSweep(t)}-(${swBefore(t)}))),0)` : '0'));
      const swAbs = (t: number): string => (kk.sw ? `(-${P(kk.sw, t)})` : '0');
      put(kk.repaid, (t) => `-(${sched(f, t)}+${swAbs(t)})`);
      put(kk.close, (t) => `IF(ABS(${balA(t)}-${swAbs(t)})<${tol(f)},0,${balA(t)}-${swAbs(t)})`, 'last');
      why(kk.close, 'Not a SUM: the opening plus the drawdowns less the repayments, snapped to zero within a cent-scale tolerance as the platform does.');
      put(kk.swOpen, (t) => `${P(kk.swClose!, t)}+${swAbs(t)}`, 'last');
      put(kk.swClose, (t) => `(1-${exitF(t)})*${P(kk.close!, t)}`, 'last');
      put(kk.cwPaid, (t) => P(kk.repaid!, t));
    }
    // The totals.
    const CD = 'Combined Debt Service';
    const newF = fac.filter((f) => !f.isEx), exF = fac.filter((f) => f.isEx);
    const sumF = (fs: typeof fac, k: 'draw' | 'idc' | 'charge' | 'repaid' | 'close', t: number): string => fs.map((f) => P(f.keys[k]!, t)).join('+') || '0';
    const kTotDraw = find(CD, 'Total Capex Drawdown'), kTotIdc = find(CD, 'Total IDC Drawdown');
    put(kTotDraw, (t) => sumF(fac, 'draw', t));
    put(kTotIdc, (t) => sumF(fac, 'idc', t));
    put(find(CD, 'Total Drawdown (Capex + IDC)'), (t) => `${P(kTotDraw!, t)}+${P(kTotIdc!, t)}`);
    const kBasis = find(IDC, 'Total IDC (allocated to assets)');
    if (!kBasis) return values('The financing could not be made live for this model: the IDC allocation has no total row.');
    put(kBasis, (t) => `IF(${running(t)},${sumF(newF, 'charge', t)},0)`);
    put(find(IDC, /^(Memo: Total construction interest \(accrual\)|Total construction interest to P&L Finance Cost)$/), (t) => P(kBasis, t));
    const interest = (t: number): string => sumF(fac, 'charge', t);
    const kIntExp = find(CD, /^(Total )?Interest Expensed$/);
    put(kIntExp, (t) => `-(${interest(t)}-${P(kBasis, t)})`);
    put(find(CD, 'Interest Expensed - New'), (t) => `-(${sumF(newF, 'charge', t)}-${P(kBasis, t)})`);
    put(find(CD, 'Interest Expensed - Existing'), (t) => `-(${sumF(exF, 'charge', t)})`);
    const kTotRepaid = find(CD, 'Total Principal Repaid'), kOfSweep = find(CD, '  of which repaid by cash sweep'), kOfSched = find(CD, '  of which scheduled amortisation');
    put(kTotRepaid, (t) => sumF(fac, 'repaid', t));
    put(kOfSweep, (t) => fac.filter((f) => f.keys.sw).map((f) => P(f.keys.sw!, t)).join('+') || '0');
    put(kOfSched, (t) => `${P(kTotRepaid!, t)}-${kOfSweep ? P(kOfSweep, t) : '0'}`);
    put(find(CD, /^Principal Repaid - New/), (t) => sumF(newF, 'repaid', t));
    put(find(CD, /^Principal Repaid - Existing/), (t) => sumF(exF, 'repaid', t));
    put(find(CD, 'Total Debt Service (Cash)'), (t) => `${P(kTotRepaid!, t)}-(${interest(t)})`);
    put(find(CD, 'Debt Service - New'), (t) => `${sumF(newF, 'repaid', t)}-(${sumF(newF, 'charge', t)})`);
    put(find(CD, 'Debt Service - Existing'), (t) => `${sumF(exF, 'repaid', t)}-(${sumF(exF, 'charge', t)})`);
    put(find(CD, 'Scheduled Debt Service (covenant basis)'), (t) => `${kOfSched ? P(kOfSched, t) : '0'}-(${interest(t)})`);
    const CFC = 'Combined Finance Cost (all facilities)';
    put(find(CFC, 'Opening'), () => '0', 'last'); put(find(CFC, 'Closing'), () => '0', 'last');
    put(find(CFC, /^Charge \(Accrued/), interest);
    put(find(CFC, 'Paid'), (t) => `-(${interest(t)})`);
    put(find(CFC, '(memo) of which funded by drawing debt'), (t) => P(kTotIdc!, t));
    // The exit repays what is left.
    put(K.exitRepay, (t) => `${exitF(t)}*MAX(0,${sumF(fac, 'close', t)})`);
    put(kDidc, (t) => P(kTotIdc!, t));
    put(kDtot, (t) => `${P(kDcap!, t)}+${P(kDidc!, t)}`);
    put(find('8. Total Debt Required', 'IDC Drawdown (capitalized interest)'), (t) => P(kTotIdc!, t));
    put(find('8. Total Debt Required', 'Total Debt Required (new draws + IDC)'), (t) => `${P(kDebtReq, t)}+${P(kTotIdc!, t)}`);
    put(find('8. Total Debt Required', 'Existing Debt (opening balance, pre-axis)'), () => '0');
    put(find('9. Total Equity Required', 'Total Equity Required'), (t) => `${P(kEqDev, t)}${kFeeDraw ? `+${P(kFeeDraw, t)}` : ''}+${P(K.inKind, t)}`);

    // ── The cash waterfall and the dividends ─────────────────────────────────
    const kCwOpen = find(CW, 'Opening Cash'), kCwCfo = find(CW, '(+) Cash from Operations'), kCwCfi = find(CW, '(-) Cash from Investing (capex)');
    const kCwEq = find(CW, '(+) Equity Drawdown (Cash)'), kCwInk = find(CW, '(+) Equity In-Kind (memo, non-cash)'), kCwDebt = find(CW, /^\(\+\) Debt Drawdown/), kCwInt = find(CW, '(-) Interest Paid');
    const kCwPaid = find(CW, '(-) Debt Paid (total principal incl. sweep)'), kCwDiv = find(CW, /^\(-\) Dividend Paid/), kCwClose = find(CW, /^= Closing Cash/), kCwForDiv = find(CW, '= Cash Available for Dividend');
    for (const [n, k] of Object.entries({ kCwOpen, kCwCfo, kCwCfi, kCwEq, kCwDebt, kCwInt, kCwPaid, kCwDiv, kCwClose, kCwForDiv })) if (!k) return values(`The financing could not be made live for this model: the cash waterfall has no ${n} row.`);
    put(kCwOpen, (t) => P(kCwClose!, t, -1), 'last');
    put(kCwCfo, cfo);
    put(kCwCfi, cfi);
    put(kCwEq, (t) => `${P(kEqDev, t)}${kFeeDraw ? `+${P(kFeeDraw, t)}` : ''}`);
    put(kCwInk, (t) => P(K.inKind, t));
    put(kCwDebt, (t) => `${P(kTotDraw!, t)}+${P(kTotIdc!, t)}`);
    put(kCwInt, (t) => `-(${interest(t)})`);
    put(kCash, (t) => `${P(kCwOpen!, t)}+${P(kCwCfo!, t)}+${P(kCwCfi!, t)}+${P(kCwEq!, t)}+${P(kCwDebt!, t)}+${P(kCwInt!, t)}`, 'last');
    why(kCash, 'Not a SUM: the in-kind equity row above is a memo, not cash, so it is left out.');
    put(find(CW, /^\(memo\) Minimum Cash Requirement/), () => `-${MIN()}`, 'last');
    put(find(CW, /^\(memo\) Headroom above/), (t) => `${P(kCash, t)}-${MIN()}`, 'last');
    put(kCwPaid, (t) => `${P(kTotRepaid!, t)}-${P(K.exitRepay, t)}`);
    put(kCwForDiv, (t) => `${P(kCash, t)}+${P(kCwPaid!, t)}`, 'last');
    why(kCwForDiv, 'Not a SUM: the cash available less the principal paid (the memos and the per-facility lines between are not added again).');
    const excess = (t: number): string => `IF(${P(kCwForDiv!, t)}-${MIN()}<0.005,0,${P(kCwForDiv!, t)}-${MIN()})`;
    // Dividends by phase: EBITDA from its lines, a payout of the cash above the minimum capped at its EBITDA to date.
    const phaseDiv: string[] = [];
    const cosLine = (l: { key: string }): string => `cosc:${l.key}:cos`;
    for (const p of phases) {
      const kEb = `fin|Dividends by phase|${p.name}: EBITDA (revenue less cost of sales less opex)`, kDiv = `fin|Dividends by phase|${p.name}: dividend`;
      if (!has(kEb) || !has(kDiv)) return values(`The financing could not be made live for this model: ${p.name} has no dividend rows.`);
      const pa = visible.filter((a) => a.phaseId === p.id);
      const pl = lines.filter((l) => l.phaseId === p.id && has(cosLine(l)));
      put(kEb, (t) => `${pa.map((a) => assetRev(a)(t)).join('+') || '0'}-(${pl.map((l) => P(cosLine(l), t)).join('+') || '0'})-(${pa.map((a) => assetOpex(a)(t)).join('+') || '0'})`);
      const before = [...phaseDiv];
      put(kDiv, (t) => {
        const ex = `(${excess(t)}${before.map((k) => `-${P(k, t)}`).join('')})`;
        const budget = `MAX(0,SUM(${toNow(kEb, t)})-SUM(${toPrev(kDiv, t)}))`;
        return `IF(AND(${divOn()}=1,${Y(t)}>=${T(K.divStart)},${payout()}>0,${ex}>0),MIN(${onEbitda ? `MAX(0,${P(kEb, t)})` : ex}*${payout()},${ex},${budget}),0)`;
      });
      phaseDiv.push(kDiv);
    }
    const phaseSum = (t: number): string => phaseDiv.map((k) => P(k, t)).join('+') || '0';
    put(kCwDiv, (t) => `-(${phaseSum(t)}+${exitF(t)}*IF(AND(${divOn()}=1,${excess(t)}>0,${P(kCwForDiv!, t)}-(${phaseSum(t)})>=0.005),${P(kCwForDiv!, t)}-(${phaseSum(t)}),0))`);
    put(kCwClose, (t) => `${P(kCwForDiv!, t)}+${P(kCwDiv!, t)}`, 'last');
    put(find(CW, '(memo) IDC paid in cash'), (t) => newF.map((f) => `IF(${running(t)},${P(f.keys.charge!, t)}-${P(f.keys.idc!, t)},0)`).join('+') || '0');
    put(find(CW, '(memo) IDC capitalised to debt'), (t) => P(kTotIdc!, t));
    put(find('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)'), (t) => fac.map((f) => P(f.keys.swClose!, t)).join('+') || '0', 'last');

    // ── The profit before tax inside the loop, and tax ───────────────────────
    const Q = (label: string): string => `fin|${PBT}|${label}`;
    const kEbit0 = Q('Revenue less operating expenses'), kCos = Q('(-) Cost of sales'), kFee = Q('(-) Fund management fees'), kDep = Q('(-) Depreciation (capex and capitalised interest)');
    const kInt = Q('(-) Interest expensed'), kGain = Q('(+) Gain on disposal'), kPbt = Q('= Profit before tax'), kTaxable = Q('Taxable profit'), kTax = Q('Tax');
    for (const k of [kEbit0, kCos, kFee, kDep, kInt, kGain, kPbt, kTaxable, kTax, kTaxPaid]) if (!has(k)) return values(`The financing could not be made live for this model: the row ${k.split('|').pop()} is not on the Financing sheet.`);
    const S1 = 'sched|Income Statement Feed';
    const revTot = `${S1}|Revenue (P&L)|Total Revenue`;
    const opexKeys = [...visible.map((a) => `oxo:${a.id}:total`), 'oxo:hq:total'].filter(has);
    put(kEbit0, (t) => `${has(revTot) ? P(revTot, t) : '0'}-(${opexKeys.map((k) => P(k, t)).join('+') || '0'})-${has('cx1e:total') ? P('cx1e:total', t) : '0'}`);
    const cosTot = 'cos|__project__|Project Total Cost of Sales|Total Cost of Sales';
    put(kCos, (t) => (has(cosTot) ? `-${P(cosTot, t)}` : '0'));
    put(kFee, (t) => `-${fee(t)}`);
    put(kDep, (t) => P('schv:__project__:dep', t));
    put(kInt, (t) => P(kIntExp!, t));
    put(kGain, (t) => `${P(K.proceeds, t)}${has('schv:__project__:landDisp') ? `+${P('schv:__project__:landDisp', t)}` : ''}${has('schv:__project__:disp') ? `+${P('schv:__project__:disp', t)}` : ''}`);
    put(kPbt, (t) => sumP([kEbit0, kCos, kFee, kDep, kInt, kGain], t));
    const taxed = project.tax?.applyToDisposalGain === true;
    put(kTaxable, (t) => (taxed ? P(kPbt, t) : `${P(kPbt, t)}-${P(kGain, t)}`));
    const rate0 = (): string => `MAX(0,N(${w.ref('project:taxRate')}))`;
    let relief: string | undefined;
    if (project.tax?.basis === 'cit') {
      const kPool = Q('Tax losses carried forward'), kRel = Q('Tax loss relief');
      if (!has(kPool) || !has(kRel)) return values('The financing could not be made live for this model: the tax loss rows are not on the Financing sheet.');
      put(kRel, (t) => citReliefF(P(kTaxable, t), P(kPool, t, -1)));
      put(kPool, (t) => citPoolF(P(kTaxable, t), P(kPool, t, -1), P(kRel, t)), 'last');
      relief = kRel;
    }
    put(kTax, (t) => taxF(P(kTaxable, t), rate0(), relief ? P(relief, t) : undefined));
    const lag = (t: number, dt = 0): string => `${P(kTax, t, dt)}*MIN(365,MAX(0,N(${w.ref('project:taxDays')})))/365`;
    put(kTaxPaid, (t) => (taxLagDays ? `${P(kTax, t)}-(${lag(t)}-${lag(t, -1)})` : P(kTax, t)));
    why(kPbt, 'The loop\'s own profit before tax (Checks proves it equals the P&L every year).');

    // ── The fund fees ────────────────────────────────────────────────────────
    if (feeOn) {
      const Fk = (label: string): string => `fin|${FEES}|${label}`;
      const kAffd = Fk('Cash before funding, without the fund fees'), kNff = Fk('Funding need without the fund fees');
      if (!has(kAffd) || !has(kNff) || !has(kFeeTot)) return values('The financing could not be made live for this model: the fund fee rows are not on the Financing sheet.');
      // The deficit walk with the fee rows added back (Method 3); Methods 1 and 2 size without interest, so the base is the draws.
      put(kAffd, (t) => (METHOD === 3 ? `${P(kAffd, t, -1)}+${P(kNff, t, -1)}+${P(kOpIn, t)}${byEq ? '' : `+${fee(t)}`}-${P(kCapexM3!, t)}` : '0'), 'last');
      put(kNff, (t) => (METHOD === 3 ? `IF(${spending(t)},MAX(0,${MIN()}-${P(kAffd, t)}),0)` : `${P(kDebtReq, t)}+${P(kEqDev, t)}`));
      const R = (): string => T(kNff);
      const capOf = (label: string): string | undefined => find(FEES, label) ?? find(FEES, `= ${label}`);
      const kEqB = capOf('Capex equity'), kDbB = capOf('Debt facility'), kFsB = capOf('Fund size');
      putS(kEqB, `${R()}*${T(K.eF)}`);
      putS(kDbB, `${R()}*${T(K.dF)}`);
      putS(kFsB, fundTerms.fundSizeOverride ? `MAX(0,N(${w.ref('ft:Fund size (typed target)')}))` : (kEqB && kDbB ? `${T(kEqB)}+${T(kDbB)}` : R()));
      const baseOf = (base: string): string => (base === 'fund_size' ? (kFsB ? T(kFsB) : (fundTerms.fundSizeOverride ? `MAX(0,N(${w.ref('ft:Fund size (typed target)')}))` : R()))
        : base === 'total_equity' ? (kEqB ? T(kEqB) : `${R()}*${T(K.eF)}`) : base === 'debt_facility' ? (kDbB ? T(kDbB) : `${R()}*${T(K.dF)}`) : '0');
      const feeKeys: string[] = [];
      FUND_FEE_SPECS.forEach((spec, i) => {
        const k = Fk(spec.label);
        if (!has(k)) return;
        const rateIn = (): string => (has(`ft:${spec.label}`) ? `N(${w.ref(`ft:${spec.label}`)})` : '0');
        put(k, (t) => {
          const first = spec.timing === 'one_time' ? `(${Y(t)}=${Y0()})*` : '';
          return spec.kind === 'amount' ? `${first}${rateIn()}` : `${first}${rateIn()}*${baseOf(spec.base)}`;
        });
        feeKeys.push(k);
        w.claim(`fnc:fee:${i}`, FIN, w.addr(k).row, 1);
      });
      put(kFeeTot, (t) => sumP(feeKeys, t));
      claim('fnc:fee:base', kNff);
      claim('fnc:fee:fundsize', kFsB);
      if (kEqB) w.claim('ftcap:Capex equity', FIN, w.addr(kEqB).row, TOTAL_COL);
      if (kDbB) w.claim('ftcap:Debt facility', FIN, w.addr(kDbB).row, TOTAL_COL);
      if (kFsB) w.claim('ftcap:Fund size', FIN, w.addr(kFsB).row, TOTAL_COL);
    }

    // ── Capitalised interest, by line on land under construction ─────────────
    const idcAssets = visible.filter(sharesCapitalisedInterest);
    const sqm = (a: Asset): string => (has(`land:${a.id}:sqm`) ? `MAX(0,N(${w.ref(`land:${a.id}:sqm`)}))` : '0');
    const conFlag = (a: Asset, t: number): string => (has(`tl:flag:${a.phaseId}:con`) ? P(`tl:flag:${a.phaseId}:con`, t) : '0');
    if (has(K.sqmTot)) putS(K.sqmTot, idcAssets.map(sqm).join('+') || '0');
    if (has(K.sqmActive)) put(K.sqmActive, (t) => idcAssets.map((a) => `${conFlag(a, t)}*${sqm(a)}`).join('+') || '0');
    const idcLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.idc.byAsset.has(a.id));
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const idcRowOf = new Map<string, string>();
    for (const l of idcLines) {
      const title = lineTitle(l, lineState);
      const k = find(IDC, new RegExp(`^${esc(title)} \\(Land `));
      if (!k) continue;
      const as = l.assetIds.map((id) => idcAssets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
      const sq = as.map(sqm).join('+') || '0';
      const flag = (t: number): string => (as[0] ? conFlag(as[0], t) : '0');
      put(k, (t) => `IF(${P(kBasis, t)}=0,0,IF(${P(K.sqmActive, t)}>0,${flag(t)}*${P(kBasis, t)}*(${sq})/${P(K.sqmActive, t)},IF(${T(K.sqmTot)}>0,${P(kBasis, t)}*(${sq})/${T(K.sqmTot)},0)))`);
      idcRowOf.set(l.assetIds.join('|'), k);
      for (const id of l.assetIds) w.claim(`fnc:main:idc:${id}`, FIN, w.addr(k).row, 1);
      put(find(/^Routed to CoS via Inventory/, title), (t) => P(k, t));
      put(find(/^Routed to Fixed Assets/, `${title} (Additions)`), (t) => P(k, t));
    }
    const heldIds = (ids: readonly string[]): boolean => ids.some((id) => { const a = state.assets.find((x) => x.id === id); return a?.strategy === 'Operate' || a?.strategy === 'Lease'; });
    const idcOf = (pred: (ids: readonly string[]) => boolean) => (t: number): string => idcLines.filter((l) => pred(l.assetIds) && idcRowOf.has(l.assetIds.join('|'))).map((l) => P(idcRowOf.get(l.assetIds.join('|'))!, t)).join('+') || '0';
    put(find(/^Routed to CoS via Inventory/, 'Subtotal: Sell IDC to CoS'), idcOf((ids) => !heldIds(ids)));
    put(find(/^Routed to Fixed Assets/, 'Subtotal: Operate/Lease IDC to Fixed Assets'), idcOf(heldIds));
    put(find(/^Routed to Fixed Assets/, 'Operate/Lease IDC Depreciation (charge to D&A)'), (t) => (has('schv:__project__:idcDep') ? `-${P('schv:__project__:idcDep', t)}` : '0'));
    const idcPre = (t: number): string => `MAX(0,${P('schv:__project__:idcNbv', t, -1)}+${P('schv:__project__:idcAdd', t)}-${P('schv:__project__:idcDep', t)})`;
    const kIdcDisp = find(/^Routed to Fixed Assets/, /^Disposed at Exit/);
    put(kIdcDisp, (t) => (has('schv:__project__:idcNbv') ? `-(${exitF(t)}*${idcPre(t)})` : '0'));
    put(find(/^Routed to Fixed Assets/, /^Operate\/Lease IDC NBV/), (t) => (has('schv:__project__:idcNbv') ? P('schv:__project__:idcNbv', t) : '0'), 'last');

    // ── Equity, Method 2, the summary, the funding basis ─────────────────────
    const eq = (t: number): string => `${P(kEqDev, t)}${kFeeDraw ? `+${P(kFeeDraw, t)}` : ''}+${P(K.inKind, t)}`;
    const kEqClose = find('Equity Movement', 'Closing (cumulative equity)');
    put(find('Equity Movement', 'Opening (incl. existing carry-forward)'), (t) => P(kEqClose!, t, -1), 'last');
    put(find('Equity Movement', /^Cash Contribution(, development)?$/), (t) => P(kEqDev, t));
    put(find('Equity Movement', 'Cash Contribution, fund management fee'), (t) => (kFeeDraw ? P(kFeeDraw, t) : '0'));
    put(find('Equity Movement', 'In-Kind Contribution'), (t) => P(K.inKind, t));
    put(kEqClose, (t) => `${P(kEqClose!, t, -1)}+${eq(t)}`, 'last');
    const M2 = 'Method 2, Net Funding Requirement (Capex vs Pre-Sales)';
    const cashPre = (t: number): string => [...new Set(visible.filter((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a) => lineForAsset(lines, a.id)).filter((l): l is NonNullable<typeof l> => !!l && has(`rvc:${l.key}:cashPre`)).map((l) => `rvc:${l.key}:cashPre`))].map((k) => P(k, t)).join('+') || '0';
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const kM2cap = find(M2, 'Total project capex (excl land in-kind)'), kM2g = find(M2, 'Advance received from customer (gross)'), kM2h = find(M2, 'Less: Inaccessible funds locked (escrow held)');
    const kM2r = find(M2, 'Add: Release of inaccessible funds (escrow release)'), kM2n = find(M2, 'Advance received from customer (net)');
    put(kM2cap, (t) => P(K.capexAll, t));
    put(kM2g, cashPre);
    put(kM2h, (t) => (has(escB('Total Additions')) ? `-${P(escB('Total Additions'), t)}` : '0'));
    put(kM2r, (t) => (has(escB('Less: Release of Locked Funds')) ? `-${P(escB('Less: Release of Locked Funds'), t)}` : '0'));
    put(kM2n, (t) => sumP([kM2g, kM2h, kM2r], t));
    put(find(M2, /^Funding requirement fulfilled by pre-sales/), (t) => `MIN(${P(kM2cap!, t)},MAX(0,${kM2n ? P(kM2n, t, -1) : '0'}))`);
    put(kGap2, (t) => `MAX(0,${P(kM2cap!, t)}-${kM2n ? P(kM2n, t, -1) : '0'})`);
    put(find(M2, 'Cumulative Funding Gap (A)'), (t) => `SUM(${toNow(kGap2!, t)})`, 'last');
    const FR = '7. Funding Requirement';
    const kM1 = find(FR, 'Method 1, Fixed Debt-to-Equity Ratio');
    put(kM1, (t) => P(K.capexAll, t));
    put(find(FR, 'Method 2, Net Funding Requirement'), (t) => (kGap2 ? P(kGap2, t) : '0'));
    put(find(FR, 'Method 3, Cash Deficit Funding'), (t) => P(kNeed!, t));
    put(find(FR, 'Method 4, Specified Debt + Equity (manual)'), () => '0');
    const kSel = find(FR, /^Selected \(Method \d\)$/);
    const selected = (t: number): string => (METHOD === 3 ? `IF(${gapTot()}>0,${P(kNeed!, t)},${P(K.capexAll, t)})`
      : METHOD === 2 && kGap2 ? `IF(${T(kGap2)}>0,${P(kGap2, t)},${P(K.capexAll, t)})` : P(K.capexAll, t));
    put(kSel, selected);
    const kMinR = find(FR, '+ Minimum Cash Reserve');
    put(kMinR, (t) => (METHOD === 3 ? '0' : minAt(t)));
    const kNeedTot = find(FR, 'Total Funding Need');
    put(kNeedTot, (t) => `${P(kSel!, t)}${kMinR ? `+${P(kMinR, t)}` : ''}`);
    const need = (): string => (METHOD === 3 ? T(kNeed!) : kNeedTot ? T(kNeedTot) : `${T(kSel!)}+${MIN()}`);
    const capexTotal = (): string => T(K.capexAll);
    putS(find('3. Funding Basis', 'Total Capex (excl Land In-Kind)'), capexTotal());
    putS(find('3. Funding Basis', 'Total Funding Need'), need());
    putS(find('3. Funding Basis', 'Funded from Project Cash'), `(${capexTotal()})+${MIN()}-(${need()})`);
    { const src = `(${T(kDebtReq)}+${T(kEqDev)})`; putS(find('3. Funding Basis', 'Sources vs Uses'), `IF(ABS(${src}-${need()})<1,"Match ("&TEXT(ROUND(${src},0),"#,##0")&")","Gap "&TEXT(ROUND(${src}-${need()},0),"#,##0"))`); }
    const sumDebt = (): string => `${T(kTotDraw!)}+${T(kTotIdc!)}`;
    const sumEquity = (): string => `${T(kEqDev)}${kFeeDraw ? `+${T(kFeeDraw)}` : ''}+${T(K.inKind)}`;
    putS(find('Summary', 'Total Funding'), `${sumDebt()}+${sumEquity()}`);
    putS(find('Summary', 'Total Debt'), sumDebt());
    putS(find('Summary', 'Total Equity'), sumEquity());
    putS(find('Summary', 'IDC (Construction)'), T(kBasis));
    putS(find('Summary', 'Finance Cost (New)'), newF.map((f) => T(f.keys.charge!)).join('+') || '0');
    putS(find('Summary', 'Finance Cost (Existing)'), exF.map((f) => T(f.keys.charge!)).join('+') || '0');

    // ── The keys the later layers read ───────────────────────────────────────
    claim('fnc:capex', K.capexAll);
    claim('fnc:inkind', K.inKind);
    claim('fnc:noi', K.noi);
    claim('fnc:proceeds', K.proceeds);
    claim('fnc:main:exitrepay', K.exitRepay);
    claim('fnc:main:netreq', kNeed);
    claim('fnc:main:draw', kTotDraw);
    claim('fnc:main:idcdraw', kTotIdc);
    claim('fnc:main:basis', kBasis);
    claim('fnc:main:intexp', kIntExp);
    claim('fnc:main:sched', kOfSched);
    claim('fnc:main:repay', kCwPaid);
    claim('fnc:main:div', kCwDiv);
    claim('fnc:main:equity', kEqDev);
    claim('fnc:main:feedraw', kFeeDraw);
    claim('fnc:main:debtbs', find('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)'));
    claim('fnc:main:idcdisp', kIdcDisp);
    claim('fnc:dF', K.dF); claim('fnc:eF', K.eF);
    // The minimum cash and the dividend switch are read through loopOne, by name; claimed so a reader can test for them.
    claim('fnc:min', K.minCash); claim('fnc:don', K.divOn);
    claim('fnc:capexall', 'cx2:total');
    for (const f of fac) claim(`fnc:main:tr:${f.t.id}:bal`, f.keys.close);
    // Interest: the facility's own ledger where there is one facility, the combined one otherwise.
    claim('fnc:main:interest', fac.length === 1 ? fac[0].keys.charge : find(CFC, /^Charge \(Accrued/));
    claim('fnc:main:idcdep', 'schv:__project__:idcDep');
    claim('fnc:main:idcadd', 'schv:__project__:idcAdd');

    // ── The loop's output, written back: capitalised interest into Schedules ──
    // (the one backward link: the interest each line capitalises), and the statements' pending cells.
    const liveRow = (key: string, f: F): void => {
      if (!has(key)) return;
      const a = w.addr(key);
      const c0 = LiveWriter.isWorking(a.sheet) ? 4 : PERIOD_COLS.OPEN_COL + 1;
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: c0 + t }, f(t));
    };
    const lineIdc = (ids: readonly string[]) => (t: number): string => {
      const rows = [...new Set(ids.filter((id) => has(`fnc:main:idc:${id}`)).map((id) => w.addr(`fnc:main:idc:${id}`).row))];
      return rows.map((r) => w.refA({ sheet: FIN, row: r, col: pc(t) })).join('+') || '0';
    };
    for (const l of lines.filter((x) => has(`cosc:${x.key}:idc`))) liveRow(`cosc:${l.key}:idc`, (t) => `MAX(0,${lineIdc(l.members.map((m) => m.id))(t)})`);
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
    for (const gr of report.groups) for (const l of gr.lines) {
      if (!has(`schv:${l.hostId}:idcAdd`)) continue;
      const ids = l.memberIds.filter((id) => { const r0 = snap.idc.byAsset.get(id); return !!r0 && idcRowIsHeld(r0); });
      liveRow(`schv:${l.hostId}:idcAdd`, lineIdc(ids));
    }
    const abs = (k: string | undefined, t: number): string => (k ? w.refA({ sheet: FIN, row: w.addr(k).row, col: pc(t) }) : '0');
    liveRow('stc:interest', (t) => `-${abs(kIntExp, t)}`);
    liveRow('stc:proceeds', (t) => abs(K.proceeds, t));
    FUND_FEE_SPECS.forEach((_, i) => { if (has(`fnc:fee:${i}`)) liveRow(`stc:fee:${i}`, (t) => w.refA({ sheet: FIN, row: w.addr(`fnc:fee:${i}`).row, col: pc(t) })); });
    liveRow('stc:bs:debt', (t) => abs(find('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)'), t));
    liveRow('stc:bs:share', (t) => `${Math.max(0, project.shareCapital ?? 0)}+SUM(${w.rangeA(FIN, w.addr(kEqDev).row, pc(0), pc(t))})${kFeeDraw ? `+SUM(${w.rangeA(FIN, w.addr(kFeeDraw).row, pc(0), pc(t))})` : ''}+SUM(${w.rangeA(FIN, w.addr(K.inKind).row, pc(0), pc(t))})`);
    const cfPending = (label: string, f: F): void => liveRow(`stc:cf:${label}`, f);
    cfPending('Equity Drawdown, development', (t) => abs(kEqDev, t));
    cfPending('Equity Drawdown (Cash)', (t) => `${abs(kEqDev, t)}+${abs(kFeeDraw, t)}`);
    cfPending('Equity Drawdown, management fee', (t) => abs(kFeeDraw, t));
    const byOrigin = (fs: typeof fac) => ({
      draw: (t: number): string => fs.map((f) => `${abs(f.keys.draw, t)}+${abs(f.keys.idc, t)}`).join('+') || '0',
      repay: (t: number): string => `${fs.map((f) => `-${abs(f.keys.repaid, t)}`).join('') || '0'}${booked ? `+${w.refA({ sheet: 'Timeline', row: w.addr('tl:flag:exit').row, col: pc(t) })}*MAX(0,${fs.map((f) => abs(f.keys.close, t)).join('+') || '0'})` : ''}`,
      int: (t: number): string => fs.map((f) => abs(f.keys.charge, t)).join('+') || '0',
    });
    const nw = byOrigin(newF);
    cfPending('Debt Drawdown, New loans', nw.draw);
    cfPending('Debt Repayment, New loans', (t) => `-(${nw.repay(t)})`);
    cfPending('Interest Paid, New loans', (t) => `-(${nw.int(t)})`);
    if (exF.length) {
      const ex = byOrigin(exF);
      cfPending('Debt Drawdown, Existing loans', ex.draw);
      cfPending('Debt Repayment, Existing loans', (t) => `-(${ex.repay(t)})`);
      cfPending('Interest Paid, Existing loans', (t) => `-(${ex.int(t)})`);
    }
    cfPending('Dividends paid', (t) => abs(kCwDiv, t));

    // A CIRCULAR CELL NEEDS A STARTING VALUE. Excel iterates a loop from each cell's cached result;
    // a formula written with none enters the first pass with nothing to start from and the loop never
    // recovers. Every formula on the tabs the loop runs through that carries no value starts from 0.
    for (const name of [FIN, 'Schedules', 'Statements Calc']) {
      wb.getWorksheet(name)?.eachRow((r) => r.eachCell((c) => {
        const v = c.value as unknown as { formula?: string; result?: unknown } | null;
        if (v && typeof v === 'object' && 'formula' in v && (v.result === undefined || v.result === null)) c.value = { formula: v.formula, result: 0 } as never;
      }));
    }
    // Every pending cell of the earlier stages now reads the loop, so their notes stop saying they wait.
    ctx.settled.add('financing');
    return [{
      sheet: FIN, status: 'live' as const, formulas: w.formulas.get(FIN) ?? 0,
      note: 'Live: the financing is solved on this tab as circular formulas Excel iterates, the platform\'s fixed point (the funding need, the draws, each facility\'s interest and the interest drawn as debt, repayments and the sweep, the cash waterfall, the dividends by phase), from the rows of the tabs before it. The blocks at the foot hold the settings in force, the land the capitalised interest is shared on, the fund fees and their base, the profit before tax inside the loop and the exit.',
    }];
  },
};
