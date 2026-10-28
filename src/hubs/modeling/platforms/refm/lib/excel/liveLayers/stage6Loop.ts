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
 * THE FEES ARE CHARGED ON THE FEE-FREE SOLVE (2026-10-15): on Method 3 the platform sizes
 * them on its solve without fees, which draws, borrows and pays interest differently
 * (the fees move tax). That solve is its own loop on this tab, so the base re-solves when
 * an input moves; a re-walk of the funding need was exact only on the exported model.
 *
 * REFUSES by name (Financing stays the platform's values): a funding method other than
 * 1 to 3, a facility other than new loans (and existing ones raised inside the model)
 * at an interbank rate plus spread, a repayment method the sheet does not show,
 * parcel funding that varies within a phase or is deferred, monthly periods, an
 * operational phase or overlap, existing operations, a terminal value the sheet does
 * not state, an exit before the last year, a per-phase dividend policy, a fund fee on
 * NAV or a facility limit, interest allocated by GFA.
 *
 * No em dashes in this file.
 */
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS, FEE_FREE } from '../buildModelWorkbook';
import { vintageDepF, firstOperatingIdx, lifeInForce } from './stage4Schedules';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { terminalRefusal, terminalValueFormula } from './terminal';
import { citReliefF, citPoolF, taxF } from './taxRule';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
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
  const r = w.perP(key, t);
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
    const labels = getFinancialLabels(project.financialTerminology ?? defaultTerminologyForCountry(project.country));
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
    }
    if ((project.idcConfig?.allocationBasis ?? 'land') !== 'land') refuse.push('capitalised interest allocated by GFA');
    for (const k of [K.minCash, K.debtPct, K.equityPct, K.payout, K.divOn, K.divStartIn, K.lastCon, K.dF, K.eF, K.landDebt, K.divStart, K.capexAll, K.nonLand, K.landCash, K.inKind, K.noi, K.proceeds, K.exitRepay]) {
      if (!has(k)) refuse.push(`the row ${k.split('|').slice(1).join(' / ')} is not on the Financing sheet`);
    }
    for (const k of ['cx2:total', 'cx5:total:cash', 'cx5:total:inkind', 'schv:__project__:dep']) if (!has(k)) refuse.push(`the ${k} row is not live`);
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
    putS(K.lastCon, `MAX(${phases.map((p) => `MAX(0,YEAR(${w.ref(`tl:phase:${p.id}:cs`)})-${psd()})+MAX(0,${w.ref(`tl:phase:${p.id}:cp`)})`).join(',')})+${psd()}-1`);
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
    /** The Inputs cell that types a module setting (`inp=<key>@<col>`), as a reference, or undefined. */
    const inputsCellOf = (moduleKey: string): string | undefined => {
      const k = reg.keys().find((x) => x.startsWith(`inp=${moduleKey}@`));
      return k ? w.refA(reg.need(k), here) : undefined;
    };
    // The sweep and dividend starts: the year typed, else after construction (the default follows the
    // phases until a year is typed; a typed year is the one the Inputs carry).
    const startYear = (inKey: string, stored: number | undefined, dflt: () => string): string => {
      const shown = Number(w.platformValue(w.addr(inKey, TOTAL_COL)));
      const typed = `MAX(${Y0()},MIN(${YN()},N(${inp(inKey)})))`;
      return stored !== undefined ? typed : `IF(N(${inp(inKey)})=${shown},${dflt()},${typed})`;
    };
    const hasSweepIn = has(K.sweepStartIn);
    // A blank on Inputs sweeps from the year after construction (the engine's `??`: a typed 0 is a year).
    const inSw = inputsCellOf(K.sweepStartIn);
    const swDflt = `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`;
    if (has(K.sweepStart) && inSw) {
      putS(K.sweepStartIn, `IF(ISNUMBER(${inSw}),${inSw},${swDflt})`);
      putS(K.sweepStart, `IF(ISNUMBER(${inSw}),MAX(${Y0()},MIN(${YN()},${inSw})),${swDflt})`);
    } else if (has(K.sweepStart)) putS(K.sweepStart, hasSweepIn ? startYear(K.sweepStartIn, finCfg?.cashSweep?.startingYear, () => `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`) : `MAX(${Y0()},MIN(${YN()},${lastCon()}+1))`);
    {
      // A blank on Inputs pays from the year after construction (the engine's `??`: a typed 0 is a year).
      const dflt = (): string => `MAX(${Y0()},MIN(${YN()},MAX(${psd()},${phases.map((p) => `YEAR(${w.ref(`tl:phase:${p.id}:cs`)})+MAX(0,${w.ref(`tl:phase:${p.id}:cp`)})`).join(',')})))`;
      const inD = inputsCellOf(K.divStartIn);
      if (inD) {
        putS(K.divStartIn, `IF(ISNUMBER(${inD}),${inD},${dflt()})`);
        putS(K.divStart, `IF(ISNUMBER(${inD}),MAX(${Y0()},MIN(${YN()},${inD})),${dflt()})`);
      } else putS(K.divStart, startYear(K.divStartIn, project.dividendStartYear, dflt));
    }
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
      // THE DEFAULT IS WORKED OUT, NEVER TYPED (2026-10-20): a blank (or 0) on Inputs repays from
      // the year after the last construction year, the engine's rule (an existing loan from the
      // first model year); the module copy shows the year in force.
      const inS = inputsCellOf(startIn);
      if (inS) {
        putS(startIn, `IF(N(${inS})=0,${auto},N(${inS}))`);
        putS(f.keys.start, `IF(N(${inS})=0,${auto},MAX(${Y0()},MIN(${YN()}+1,N(${inS}))))`);
      } else {
        const typedS = `MAX(${Y0()},MIN(${YN()}+1,N(${inp(startIn)})))`;
        putS(f.keys.start, !has(startIn) ? auto : f.t.repaymentStartYear === undefined
          ? `IF(N(${inp(startIn)})=${Number(w.platformValue(w.addr(startIn, TOTAL_COL)))},${auto},${typedS})` : typedS);
      }
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
    // The lender, typed on Inputs.
    for (const f of fac) if (has(`fin|${f.band}|Lender`) && has(`trlender:${f.t.id}`)) putS(`fin|${f.band}|Lender`, `IF(${w.ref(`trlender:${f.t.id}`)}="","-",${w.ref(`trlender:${f.t.id}`)}&"")`);
    // The combined rate on Inputs: the interbank rate plus the spread typed beside it.
    for (const f of fac) if (has(`trrate:${f.t.id}`) && has(`trib:${f.t.id}`) && has(`trsp:${f.t.id}`)) w.fA(w.addr(`trrate:${f.t.id}`), `N(${w.ref(`trib:${f.t.id}`)})+N(${w.ref(`trsp:${f.t.id}`)})`);
    for (const f of fac) putS(`fin|${f.band}|Interest Rate %`, `MAX(0,N(${inp(`fin|${f.band}|Interbank Rate %`)})+N(${inp(`fin|${f.band}|Credit Spread %`)}))`);

    // ── Capex, the exit, the operating cash ──────────────────────────────────
    // Capex excluding land in kind: Capex Table 2 less Table 5's in-kind land (2026-10-27).
    put(K.capexAll, (t) => `${P('cx2:total', t)}-${P('cx5:total:inkind', t)}`);
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
    // Opex cash paid (2026-10-28): the opex less the rise in its closing payable on the Opex tab.
    const paidOf = (opexKey: string, closeKey: string, t: number): string => `${has(opexKey) ? P(opexKey, t) : '0'}-(${P(closeKey, t)}-N(${P(closeKey, t, -1)}))`;
    const opexPaid = (a: Asset): F => (has(`oxo:ap:${a.id}:close`) ? (t) => paidOf(`oxo:${a.id}:total`, `oxo:ap:${a.id}:close`, t) : () => '0');
    const classOf = (pick: (a: Asset) => boolean): F => (t) => visible.filter(pick).map((a) => `(${cashRev(a)(t)})-(${opexPaid(a)(t)})`).join('+') || '0';
    const kRes = find(M3, 'Residential cash collection'), kHosp = find(M3, 'Hospitality EBITDA'), kRet = find(M3, 'Retail NOI');
    const kFeeM3 = find(M3, '(-) Fund management fee'), kHq = find(M3, 'HQ overheads and marketing paid'), kEsc = find(M3, 'Escrow: pre-sales cash held and released'), kTaxM3 = find(M3, 'Tax paid');
    const kOpIn = find(M3, '= Total operating inflows');
    if (!kRes || !kHosp || !kRet || !kHq || !kEsc || !kTaxM3 || !kOpIn) return values('The financing could not be made live for this model: the Method 3 table does not carry the operating cash rows.');
    put(kRes, classOf((a) => operatingCashClass(a) === 'residential'));
    put(kHosp, classOf((a) => operatingCashClass(a) === 'hospitality'));
    put(kRet, classOf((a) => operatingCashClass(a) === 'retail'));
    // HQ overheads (Opex's cash paid) and the selling and marketing expensed as incurred (Capex's block).
    // The rise in the hotel and lease lines' receivables (Revenue's rows, each at its line's days).
    const kAr = find(M3, '(-) Rise in operating receivables (hotel and lease lines)');
    if (!kAr) return values('The financing could not be made live for this model: the Method 3 table does not carry the operating receivables row.');
    const arKeys = lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:opar`).filter(has);
    put(kAr, (t) => (arKeys.length ? `-(${arKeys.map((k) => `${P(k, t)}-N(${P(k, t, -1)})`).join('+')})` : '0'));
    put(kHq, (t) => `${has('oxo:ap:hq:close') ? `-(${paidOf('oxo:hq:total', 'oxo:ap:hq:close', t)})` : '0'}${has('cx1e:total') ? `-${P('cx1e:total', t)}` : ''}`);
    const escNet = 'esc||C. Cash Flow Impact (project totals)|Net escrow cash flow';
    put(kEsc, (t) => (has(escNet) ? P(escNet, t) : '0'));
    const kFeeTot = `fin|${FEES}|Total fund fees`;
    const fee = (t: number): string => (feeOn && has(kFeeTot) ? P(kFeeTot, t) : '0');
    if (kFeeM3) put(kFeeM3, (t) => (byEq ? '0' : `-${fee(t)}`));
    const kTaxPaid = `fin|${PBT}|Tax paid`;
    put(kTaxM3, (t) => `-${P(kTaxPaid, t)}`);
    put(kOpIn, (t) => sumP([kRes, kHosp, kRet, kFeeM3, kAr, kHq, kEsc, kTaxM3], t));
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
    // A YEAR-ON-YEAR facility: the % typed for each year from its repayment start, and that year's
    // share of the typed total (none typed repays evenly over the years left).
    for (const f of fac.filter((x) => x.kind === 'yoy')) {
      const sched = `fin|${f.band}|Year-on-Year % Schedule`;
      const kTyped = `fin|${SET}|${f.t.name}: repayment % typed for the year`, kShare = `fin|${SET}|${f.t.name}: share of the total repaid in the year`;
      if (!has(kTyped) || !has(kShare)) return values(`The financing could not be made live for this model: ${f.t.name}'s year-on-year rows are not on the Financing sheet.`);
      const st = (): string => T(f.keys.start);
      if (!has(`yoy:${f.t.id}`)) return values(`The financing could not be made live for this model: ${f.t.name}'s year-on-year schedule is not on the Inputs sheet.`);
      const inRow = w.addr(`yoy:${f.t.id}`);
      const inRange = w.rangeA(inRow.sheet, inRow.row, inRow.col, inRow.col + N - 1);
      put(sched, (t) => `IF(${Y(t)}>=${st()},MAX(0,N(INDEX(${inRange},1,${Y(t)}-${st()}+1))),0)`);
      put(kTyped, (t) => `IF(${Y(t)}>=${st()},MAX(0,N(${P(sched, t)})),0)`);
      put(kShare, (t) => `IF(${Y(t)}<${st()},0,IF(SUM(${rowRange(kTyped)})<0.000000001,1/MAX(1,${YN()}+1-${st()}),${P(kTyped, t)}/SUM(${rowRange(kTyped)})))`);
    }
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
    // Dividends by phase: a payout of the cash above the minimum capped at the phase's EBITDA to date,
    // LINKED to the phase P&L's EBITDA row (its own marketing charged, no HQ), never rebuilt here.
    const phaseDiv: string[] = [];
    const cosLine = (l: { key: string }): string => `cosc:${l.key}:cos`;
    for (const p of phases) {
      const kEb = `fin|Dividends by phase|${p.name}: EBITDA (per the phase P&L)`, kDiv = `fin|Dividends by phase|${p.name}: dividend`;
      const kPlEb = `pl|${p.id}||${labels.ebitda}`;
      if (!has(kEb) || !has(kDiv)) return values(`The financing could not be made live for this model: ${p.name} has no dividend rows.`);
      if (!has(kPlEb)) return values(`The financing could not be made live for this model: ${p.name} has no EBITDA row on its P&L.`);
      put(kEb, (t) => P(kPlEb, t));
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
    put(find('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)'), (t) => fac.map((f) => (f.keys.swClose ? P(f.keys.swClose, t) : `(1-${exitF(t)})*${P(f.keys.close!, t)}`)).join('+') || '0', 'last');
    why(find('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)'), 'Not a SUM: each swept facility\'s closing above, and a facility not on the sweep at its closing balance (nothing after the exit).');

    // ── The profit before tax inside the loop, and tax ───────────────────────
    const Q = (label: string): string => `fin|${PBT}|${label}`;
    const kEbit0 = Q('Revenue less operating expenses'), kCos = Q('(-) Cost of sales'), kFee = Q('(-) Fund management fees'), kDep = Q('(-) Depreciation (capex and capitalised interest)');
    const kInt = Q('(-) Interest expensed'), kGain = Q('(+) Gain on disposal'), kPbt = Q('= Profit before tax'), kTaxable = Q('Taxable profit'), kTax = Q('Tax');
    for (const k of [kEbit0, kCos, kFee, kDep, kInt, kGain, kPbt, kTaxable, kTax, kTaxPaid]) if (!has(k)) return values(`The financing could not be made live for this model: the row ${k.split('|').pop()} is not on the Financing sheet.`);
    // Revenue recognised, project total: Revenue's summary (the Schedules feed that copied it is gone, 2026-10-28).
    const revTot = 'rev|__project__|sum-rec|Total revenue recognised';
    const opexKeys = [...visible.map((a) => `oxo:${a.id}:total`), 'oxo:hq:total'].filter(has);
    put(kEbit0, (t) => `${has(revTot) ? P(revTot, t) : '0'}-(${opexKeys.map((k) => P(k, t)).join('+') || '0'})-${has('cx1e:total') ? P('cx1e:total', t) : '0'}`);
    const cosTot = 'cs|__project__|cos';
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
    const kTaxPay = Q('Tax payable at the year end');
    if (taxLagDays && !has(kTaxPay)) return values('The financing could not be made live for this model: the tax payable row is not on the Financing sheet.');
    put(kTaxPay, (t) => `${P(kTax, t)}*MIN(365,MAX(0,N(${w.ref('project:taxDays')})))/365`, 'last');
    put(kTaxPaid, (t) => (taxLagDays ? `${P(kTax, t)}-(${P(kTaxPay, t)}-N(${P(kTaxPay, t, -1)}))` : P(kTax, t)));
    if (taxLagDays) why(kTaxPaid, 'The tax less the rise in what is payable at the close.');
    why(kPbt, 'The loop\'s own profit before tax (Checks proves it equals the P&L every year).');

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

    // ── THE FEE-FREE SOLVE (Method 3, a fund project): the base the fund fees are charged on ──
    // The platform sizes the fees on its solve WITHOUT them (computeFeeFreeSnapshot). The fees move
    // tax, so that solve draws, borrows and pays interest differently: it is solved here as its own
    // loop, every row reading this world's own rows or the rows above that the fees do not move.
    const report0 = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
    let feeBase: string | undefined;
    if (feeOn && METHOD === 3) {
      const FF = (sec: string, label: string): string => `fin|${sec}|${label}`;
      const C0 = (label: string): string => FF(FEE_FREE.cash, label);
      const kOpBT = C0(FEE_FREE.opBeforeTax), kTaxF = C0('(-) Tax paid'), kOpF = C0('= Operating inflows'), kCapF = C0('(-) Cash capex less exit proceeds');
      const kOpenF = C0('Opening cash'), kAvailF = C0('= Cash before financing'), kNeedF = C0(FEE_FREE.need);
      const kDbF = C0('Debt draw (the debt share of the need)'), kEbF = C0('Equity draw (the equity share of the need)'), kAfterF = C0('Closing cash after funding');
      const W0 = (label: string): string => FF(FEE_FREE.waterfall, label);
      const L0 = (label: string): string => FF(FEE_FREE.lines, label);
      const T0 = (label: string): string => FF(FEE_FREE.pbt, label);
      const need: string[] = [kOpBT, kTaxF, kOpF, kCapF, kOpenF, kAvailF, kNeedF, kDbF, kEbF, kAfterF,
        W0('Interest charged, all facilities'), W0('Capitalised interest (new facilities, while construction runs)'), W0('(-) Interest expensed'),
        W0('Opening cash (after debt and dividends)'), W0('(+) Cash from operations'), W0('(-) Cash from investing'), W0('(+) Equity drawn'),
        W0('(+) Debt drawn (capex and interest)'), W0('(-) Interest paid'), W0('= Cash available'), W0('Debt repaid at the exit'),
        W0('(-) Debt repaid (scheduled, swept and at the exit)'), W0('= Cash available for dividend'), W0('(-) Dividends paid'), W0('= Closing cash'),
        T0('Revenue less operating expenses'), T0('(-) Cost of sales'), T0('(-) Depreciation (capex and capitalised interest)'), T0('(-) Interest expensed'),
        T0('(+) Gain on disposal'), T0('= Profit before tax'), T0('Taxable profit'), T0('Tax'), T0('Tax paid')];
      const missing = need.filter((k) => !has(k));
      if (missing.length) return values(`The financing could not be made live for this model: the fee-free solve has no row ${missing[0].split('|').slice(1).join(' / ')}.`);
      // The funding need without the fees.
      put(kOpBT, (t) => sumP([kRes, kHosp, kRet, kAr, kHq, kEsc], t));
      why(kOpBT, 'Not a SUM: the Method 3 operating rows above, every one but the fee and tax, which this solve has its own of.');
      put(kTaxF, (t) => `-${P(T0('Tax paid'), t)}`);
      put(kOpF, (t) => sumP([kOpBT, kTaxF], t));
      put(kCapF, (t) => `-${P(kCapexM3!, t)}`);
      put(kOpenF, (t) => P(kAfterF, t, -1), 'last');
      put(kAvailF, (t) => sumP([kOpF, kCapF, kOpenF], t), 'last');
      why(kAvailF, 'Not a SUM over a block: the operating inflows, the capex and the opening cash.');
      const spendF = (t: number): string => `(${P(kCapexM3!, t)}>0.005)`;
      put(kNeedF, (t) => `IF(${spendF(t)},MAX(0,${MIN()}-${P(kAvailF, t)}),0)`);
      const gapF = (): string => T(kNeedF);
      put(kDbF, (t) => `IF(${gapF()}>0,${P(kNeedF, t)}*${T(K.dF)},${onCapexD(t)})`);
      put(kEbF, (t) => `IF(${gapF()}>0,${P(kNeedF, t)}*${T(K.eF)},${onCapexE(t)})`);
      put(kAfterF, (t) => `${P(kAvailF, t)}+${P(kNeedF, t)}`, 'last');
      why(kAfterF, 'Not a SUM: the cash before financing plus the need.');
      feeBase = kNeedF;
      // Each facility, in the order the solve consumes the shared budgets.
      const headF = (t: number): string => `MAX(0,${P(kAfterF, t)}-${MIN()})`;
      const ffac = fac.map((f) => {
        const B = (label: string): string => FF(FEE_FREE.facility(f.t.name), label);
        return {
          f, open: B('Opening'), draw: B('Capex drawdown'), idc: B('Interest drawn as debt'), sched: B('(-) Scheduled principal'),
          sw: f.sweeps ? B('(-) Swept from surplus cash') : undefined, close: B('Closing'), charge: B('Interest charged'), td: B('Total drawn'), pmt: B('Scheduled payment'),
        };
      });
      for (const g of ffac) for (const k of [g.open, g.draw, g.idc, g.sched, g.close, g.charge, g.td, ...(g.sw ? [g.sw] : [])]) {
        if (!has(k)) return values(`The financing could not be made live for this model: the fee-free solve has no row ${k.split('|').slice(1).join(' / ')}.`);
      }
      const owedF = (g: typeof ffac[number], t: number): string => `(${P(g.open, t)}+${P(g.draw, t)}+${P(g.idc, t)})`;
      const schedF = (g: typeof ffac[number], t: number): string => {
        const f = g.f;
        if (f.kind === 'sweep') return '0';
        const st = T(f.keys.start), n = T(f.keys.n);
        const inWindow = `AND(${Y(t)}>=${st},${Y(t)}<${st}+${n})`;
        let due = '0';
        if (f.kind === 'annuity') due = `IF(${inWindow},MIN(${owedF(g, t)},MAX(0,${T(g.pmt)}-${P(g.charge, t)})),0)`;
        else if (f.kind === 'principal') due = `IF(${inWindow},MIN(${owedF(g, t)},${T(g.pmt)}),0)`;
        else if (f.kind === 'yoy') due = `MIN(${owedF(g, t)},${T(g.td)}*${P(`fin|${SET}|${f.t.name}: share of the total repaid in the year`, t)})`;
        return `IF(${Y(t)}=${T(f.keys.fin)},${owedF(g, t)},${due})`;
      };
      for (const [j, g] of ffac.entries()) {
        const f = g.f;
        put(g.open, (t) => P(g.close, t, -1), 'last');
        put(g.draw, (t) => (f.isEx ? P(f.keys.draw!, t) : `MAX(0,${P(kDbF, t)})*${shareOf(f)}`));
        const intStart = f.isEx && has(`fin|${f.band}|Interest Start Year`) ? `MAX(${Y0()},N(${inp(`fin|${f.band}|Interest Start Year`)}))` : null;
        put(g.charge, (t) => `${intStart ? `(${Y(t)}>=${intStart})*` : ''}(${P(g.open, t)}+${P(g.draw, t)})*${rate(f)}`);
        const paidBefore = (t: number): string => ffac.slice(0, j).filter((b) => !b.f.isEx).map((b) => `(${P(b.charge, t)}-${P(b.idc, t)})`).join('+') || '0';
        put(g.idc, (t) => (f.isEx ? '0' : `IF(${running(t)},MAX(0,${P(g.charge, t)}-MAX(0,${headF(t)}-(${paidBefore(t)}))),0)`));
        putS(g.td, `SUM(${rowRange(g.draw)})`);
        if (has(g.pmt)) {
          const n = (): string => T(f.keys.n);
          if (f.kind === 'annuity') putS(g.pmt, `IF(OR(${n()}<=0,${T(g.td)}<=0),0,IF(${rate(f)}<=0,${T(g.td)}/${n()},${T(g.td)}*${rate(f)}*(1+${rate(f)})^${n()}/((1+${rate(f)})^${n()}-1)))`);
          else if (f.kind === 'principal') putS(g.pmt, `IF(${n()}>0,${T(g.td)}/${n()},0)`);
        }
        put(g.sched, (t) => `-${schedF(g, t)}`);
      }
      const kCashF = W0('= Cash available'), kExitF = W0('Debt repaid at the exit');
      const preSweepF = (t: number): string => `MAX(0,${P(kCashF, t)}-(${ffac.map((g) => `(-${P(g.sched, t)})`).join('+') || '0'})-${P(kExitF, t)}-${MIN()})`;
      const tolF = (g: typeof ffac[number]): string => `MAX(1,MIN(1000,${T(g.td)}*0.0001))`;
      for (const [j, g] of ffac.entries()) {
        const balA = (t: number): string => `(${owedF(g, t)}+${P(g.sched, t)})`;
        const swBefore = (t: number): string => ffac.slice(0, j).filter((b) => b.sw).map((b) => `(-${P(b.sw!, t)})`).join('+') || '0';
        if (g.sw) put(g.sw, (t) => `-IF(AND(${Y(t)}>=${kSweepStart()},${balA(t)}>0),MIN(${balA(t)},MAX(0,${preSweepF(t)}-(${swBefore(t)}))*${sweepRatio()},MAX(0,${preSweepF(t)}-(${swBefore(t)}))),0)`);
        const swAbs = (t: number): string => (g.sw ? `(-${P(g.sw, t)})` : '0');
        put(g.close, (t) => `IF(ABS(${balA(t)}-${swAbs(t)})<${tolF(g)},0,${balA(t)}-${swAbs(t)})`, 'last');
        why(g.close, 'Not a SUM: the opening plus the drawdowns less the repayments, snapped to zero within a cent-scale tolerance as the platform does.');
      }
      // Interest, the cash waterfall and the dividends.
      const kChF = W0('Interest charged, all facilities'), kBasF = W0('Capitalised interest (new facilities, while construction runs)'), kExpF = W0('(-) Interest expensed');
      put(kChF, (t) => ffac.map((g) => P(g.charge, t)).join('+') || '0');
      why(kChF, 'Not a SUM over a block: each facility\'s interest charged, above.');
      put(kBasF, (t) => `IF(${running(t)},${ffac.filter((g) => !g.f.isEx).map((g) => P(g.charge, t)).join('+') || '0'},0)`);
      put(kExpF, (t) => `-(${P(kChF, t)}-${P(kBasF, t)})`);
      const kOpenW = W0('Opening cash (after debt and dividends)'), kCfoW = W0('(+) Cash from operations'), kCfiW = W0('(-) Cash from investing'), kEqW = W0('(+) Equity drawn');
      const kDebtW = W0('(+) Debt drawn (capex and interest)'), kIntW = W0('(-) Interest paid'), kPaidW = W0('(-) Debt repaid (scheduled, swept and at the exit)');
      const kForDivW = W0('= Cash available for dividend'), kDivW = W0('(-) Dividends paid'), kCloseW = W0('= Closing cash');
      put(kOpenW, (t) => P(kCloseW, t, -1), 'last');
      put(kCfoW, (t) => P(kOpF, t));
      put(kCfiW, cfi);
      put(kEqW, (t) => P(kEbF, t));
      put(kDebtW, (t) => ffac.map((g) => `${P(g.draw, t)}+${P(g.idc, t)}`).join('+') || '0');
      put(kIntW, (t) => `-${P(kChF, t)}`);
      put(kCashF, (t) => sumP([kOpenW, kCfoW, kCfiW, kEqW, kDebtW, kIntW], t), 'last');
      put(kExitF, (t) => `${exitF(t)}*MAX(0,${ffac.map((g) => P(g.close, t)).join('+') || '0'})`);
      put(kPaidW, (t) => `${ffac.map((g) => `${P(g.sched, t)}${g.sw ? `+${P(g.sw, t)}` : ''}`).join('+') || '0'}-${P(kExitF, t)}`);
      why(kPaidW, 'Not a SUM over a block: each facility\'s scheduled and swept principal, and the exit repayment above.');
      put(kForDivW, (t) => `${P(kCashF, t)}+${P(kPaidW, t)}`, 'last');
      const excessF = (t: number): string => `IF(${P(kForDivW, t)}-${MIN()}<0.005,0,${P(kForDivW, t)}-${MIN()})`;
      // This solve's cost of sales by line (its capitalised interest through the line's base).
      const idcRowF = new Map<string, string>();
      for (const l of idcLines) {
        const title = lineTitle(l, lineState);
        const k = L0(FEE_FREE.idcLine(title));
        const actual = idcRowOf.get(l.assetIds.join('|'));
        if (!has(k) || !actual) continue;
        const as = l.assetIds.map((id) => idcAssets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
        const sq = as.map(sqm).join('+') || '0';
        const flag = (t: number): string => (as[0] ? conFlag(as[0], t) : '0');
        put(k, (t) => `IF(${P(kBasF, t)}=0,0,IF(${P(K.sqmActive, t)}>0,${flag(t)}*${P(kBasF, t)}*(${sq})/${P(K.sqmActive, t)},IF(${T(K.sqmTot)}>0,${P(kBasF, t)}*(${sq})/${T(K.sqmTot)},0)))`);
        for (const id of l.assetIds) idcRowF.set(id, k);
      }
      const idcRowsOf = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => idcRowF.get(id)).filter((k): k is string => !!k))];
      const cosF = new Map<string, string>();
      for (const l of lines.filter((x) => x.form === 'sell')) {
        const k = L0(FEE_FREE.cos(revenueLineName(l)));
        if (!has(k)) continue;
        if (!has(`cosc:${l.key}:capex`)) return values(`The financing could not be made live for this model: ${revenueLineName(l)} has no cost of sales build on Schedules.`);
        const TB = `(${T(`cosc:${l.key}:capex`)}${idcRowsOf(l.members.map((m) => m.id)).map((x) => `+${T(x)}`).join('')})`;
        put(k, (t) => `IF(${TB}>0,${TB}*${P(`cosc:${l.key}:share`, t)},0)`);
        cosF.set(l.key, k);
      }
      // The held lines: this solve's capitalised interest, its depreciation, write-off and NBV.
      const heldF: Array<{ dep: string; off: string }> = [];
      for (const gr of report0.groups) for (const l of gr.lines) {
        const kAdd = L0(FEE_FREE.held(l.title, 'added')), kDep2 = L0(FEE_FREE.held(l.title, 'dep')), kOff = L0(FEE_FREE.held(l.title, 'off')), kNbv = L0(FEE_FREE.held(l.title, 'nbv'));
        if (!has(kAdd)) continue;
        if (![kDep2, kOff, kNbv].every(has) || !has(`fain:${l.hostId}`)) return values(`The financing could not be made live for this model: ${l.title} has no fee-free capitalised interest rows.`);
        const host = state.assets.find((a) => a.id === l.hostId)!;
        const ids = l.memberIds.filter((id) => { const r0 = snap.idc.byAsset.get(id); return !!r0 && idcRowIsHeld(r0); });
        const rows = idcRowsOf(ids);
        put(kAdd, (t) => rows.map((x) => P(x, t)).join('+') || '0');
        const idxAll = w.rangeA('Schedules', 4, pc(0), pc(N - 1));
        put(kDep2, (t) => vintageDepF(rowRange(kAdd), lifeInForce(w, host, here), firstOperatingIdx(w, host.phaseId, host.id), idxAll, w.refP({ sheet: 'Schedules', row: 4, col: pc(t) }, here)));
        const pre = (t: number): string => `MAX(0,${P(kNbv, t, -1)}+${P(kAdd, t)}-${P(kDep2, t)})`;
        put(kOff, (t) => `-(${exitF(t)}*${pre(t)})`);
        put(kNbv, (t) => `(1-${exitF(t)})*${pre(t)}`, 'last');
        heldF.push({ dep: kDep2, off: kOff });
      }
      // Dividends by phase, as above, on this solve's cash and cost of sales.
      const phaseDivF: string[] = [];
      for (const p of phases) {
        const kEbP = W0(`${p.name}: EBITDA (per the phase P&L)`), kDivP = W0(`${p.name}: dividend`);
        const kPlEb = `pl|${p.id}||${labels.ebitda}`;
        if (!has(kEbP) || !has(kDivP) || !has(kPlEb)) return values(`The financing could not be made live for this model: the fee-free solve has no dividend rows for ${p.name}.`);
        // The phase P&L EBITDA, with this solve's cost of sales in place of the P&L's.
        const pl = lines.filter((l) => l.phaseId === p.id && cosF.has(l.key) && has(cosLine(l)));
        put(kEbP, (t) => `${P(kPlEb, t)}${pl.map((l) => `+${P(cosLine(l), t)}-${P(cosF.get(l.key)!, t)}`).join('')}`);
        const before = [...phaseDivF];
        put(kDivP, (t) => {
          const ex = `(${excessF(t)}${before.map((k) => `-${P(k, t)}`).join('')})`;
          const budget = `MAX(0,SUM(${toNow(kEbP, t)})-SUM(${toPrev(kDivP, t)}))`;
          return `IF(AND(${divOn()}=1,${Y(t)}>=${T(K.divStart)},${payout()}>0,${ex}>0),MIN(${onEbitda ? `MAX(0,${P(kEbP, t)})` : ex}*${payout()},${ex},${budget}),0)`;
        });
        phaseDivF.push(kDivP);
      }
      const phaseSumF = (t: number): string => phaseDivF.map((k) => P(k, t)).join('+') || '0';
      put(kDivW, (t) => `-(${phaseSumF(t)}+${exitF(t)}*IF(AND(${divOn()}=1,${excessF(t)}>0,${P(kForDivW, t)}-(${phaseSumF(t)})>=0.005),${P(kForDivW, t)}-(${phaseSumF(t)}),0))`);
      why(kDivW, 'Not a SUM: the phases\' dividends, and in the exit year all the cash above the minimum.');
      put(kCloseW, (t) => `${P(kForDivW, t)}+${P(kDivW, t)}`, 'last');
      // Profit before tax and tax.
      const kE0 = T0('Revenue less operating expenses'), kCosF = T0('(-) Cost of sales'), kDepF = T0('(-) Depreciation (capex and capitalised interest)');
      const kIntF = T0('(-) Interest expensed'), kGainF = T0('(+) Gain on disposal'), kPbtF = T0('= Profit before tax'), kTxbF = T0('Taxable profit'), kTaxF2 = T0('Tax'), kPaidF = T0('Tax paid');
      put(kE0, (t) => P(kEbit0, t));
      put(kCosF, (t) => `-(${[...cosF.values()].map((k) => P(k, t)).join('+') || '0'})`);
      put(kDepF, (t) => (has('schv:__project__:idcDep')
        // Depreciation on capex is the total less the interest part (both on Schedules), then this solve's interest part.
        ? `${P('schv:__project__:dep', t)}+${P('schv:__project__:idcDep', t)}${heldF.map((x) => `-${P(x.dep, t)}`).join('')}`
        : P('schv:__project__:dep', t)));
      put(kIntF, (t) => P(kExpF, t));
      put(kGainF, (t) => `${P(kGain, t)}${kIdcDisp ? `-${P(kIdcDisp, t)}` : ''}${heldF.map((x) => `+${P(x.off, t)}`).join('')}`);
      why(kGainF, 'The loop\'s gain above, with this solve\'s capitalised interest written off in place of the loop\'s.');
      put(kPbtF, (t) => sumP([kE0, kCosF, kDepF, kIntF, kGainF], t));
      put(kTxbF, (t) => (taxed ? P(kPbtF, t) : `${P(kPbtF, t)}-${P(kGainF, t)}`));
      let reliefF: string | undefined;
      if (project.tax?.basis === 'cit') {
        const kPoolF = T0('Tax losses carried forward'), kRelF = T0('Tax loss relief');
        if (!has(kPoolF) || !has(kRelF)) return values('The financing could not be made live for this model: the fee-free tax loss rows are not on the Financing sheet.');
        put(kRelF, (t) => citReliefF(P(kTxbF, t), P(kPoolF, t, -1)));
        put(kPoolF, (t) => citPoolF(P(kTxbF, t), P(kPoolF, t, -1), P(kRelF, t)), 'last');
        reliefF = kRelF;
      }
      put(kTaxF2, (t) => taxF(P(kTxbF, t), rate0(), reliefF ? P(reliefF, t) : undefined));
      const kPayF = T0('Tax payable at the year end');
      if (taxLagDays && !has(kPayF)) return values('The financing could not be made live for this model: the fee-free tax payable row is not on the Financing sheet.');
      put(kPayF, (t) => `${P(kTaxF2, t)}*MIN(365,MAX(0,N(${w.ref('project:taxDays')})))/365`, 'last');
      put(kPaidF, (t) => (taxLagDays ? `${P(kTaxF2, t)}-(${P(kPayF, t)}-N(${P(kPayF, t, -1)}))` : P(kTaxF2, t)));
    }

    // ── The fund fees ────────────────────────────────────────────────────────
    if (feeOn) {
      const Fk = (label: string): string => `fin|${FEES}|${label}`;
      // The base: the fee-free solve's funding need (Method 3, above); Methods 1 and 2 draw on capex
      // and pre-sales, which the fees do not move, so their base is the draws.
      const kNff = feeBase ?? Fk(FEE_FREE.need);
      if (!has(kNff) || !has(kFeeTot)) return values('The financing could not be made live for this model: the fund fee rows are not on the Financing sheet.');
      if (!feeBase) put(kNff, (t) => `${P(kDebtReq, t)}+${P(kEqDev, t)}`);
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
    for (const f of fac) {
      claim(`fnc:main:tr:${f.t.id}:bal`, f.keys.close);
      claim(`fnc:tr:${f.t.id}:draw`, f.keys.draw); claim(`fnc:tr:${f.t.id}:idc`, f.keys.idc);
      claim(`fnc:tr:${f.t.id}:repaid`, f.keys.repaid); claim(`fnc:tr:${f.t.id}:charge`, f.keys.charge);
    }
    claim('fnc:tax', kTax); claim('fnc:taxpaid', kTaxPaid); claim('fnc:taxpay', kTaxPay);
    claim('fnc:eqclose', kEqClose);
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
    // Every pending cell of the earlier stages now reads the loop, so their notes stop saying they wait.
    ctx.settled.add('financing');
    return [{
      sheet: FIN, status: 'live' as const, formulas: w.formulas.get(FIN) ?? 0,
      note: 'Live: the financing is solved on this tab as circular formulas Excel iterates, the platform\'s fixed point (the funding need, the draws, each facility\'s interest and the interest drawn as debt, repayments and the sweep, the cash waterfall, the dividends by phase), from the rows of the tabs before it. The blocks at the foot hold the settings in force, the land the capitalised interest is shared on, the fund fees and their base, the profit before tax inside the loop and the exit.',
    }];
  },
};
