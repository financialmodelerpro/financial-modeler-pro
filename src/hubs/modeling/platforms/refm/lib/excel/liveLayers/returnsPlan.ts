/**
 * returnsPlan.ts (2026-11-03), THE LIVE RETURNS TAB, ROW BY ROW.
 *
 * One list of the rows the live Returns tab carries, each with the platform's value and the rule
 * that writes its formula: the builder (`addReturnsLive`) prints the values, the layer
 * (stage7Returns) writes every formula from the same row, so the two cannot disagree about what a
 * row is.
 *
 * THE STREAMS ARE BUILT ONCE (2026-11-03, founder): FCFF, FCFE and the distributions each have one
 * block, its rows linking the tab that works each figure out (the Cash Flow, Financing, the
 * Balance Sheet), every row following the exit year on Inputs (the hold flag: 1 up to the exit
 * year) and the exit value landing in the year the Timeline flags. Each stream's IRR, MOIC and NPV
 * is computed ONCE, in the headline table; every other place that shows a return links it. NPV is
 * a formula on the discount rate on Inputs. Figures are numbers with formats (money in millions,
 * the units line at the top); labels carry no typed figures.
 *
 * No em dashes in this file.
 */
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../../financials-resolvers';
import type { computeReturnsSnapshot } from '../../returns-resolvers';
import { trappedCashFrom } from '../../returns-resolvers';
import { resolveFundTerms, isFundManagerRow, resolveCommissionSplit, DEVELOPER_EARNER_ID } from '../../fundTerms';
import { resolveCatalogId } from '../../state/costCatalog';
import { covenantSeries, evaluateCovenant, type CovenantInputs } from '../../covenants';
import { DEFAULT_COVENANTS, type CostLine, type Phase } from '../../state/module1-types';
import { isLandValueLine, computePhaseTimeline } from '@/src/core/calculations';
import { bsTotalDebtKey } from './bsPlan';
import { featureUsed } from '../exportScope';
import { planReportLines, lineOfAsset } from '../../reports/lineRows';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;
type RS = ReturnType<typeof computeReturnsSnapshot>;

/** Number formats: money in millions (the units line says so), percentages, multiples, years, counts. */
export const RF = {
  money: '#,##0.0,,_);(#,##0.0,,);"-"_)',
  rate: '#,##0_);(#,##0);"-"_)',
  pct: '0.00%;-0.00%;"-"',
  mult: '0.00"x";-0.00"x";"-"',
  year: '0',
  int: '#,##0_);(#,##0);"-"_)',
  text: '@',
} as const;

/** What the layer gives a row's rule to write its formula with. */
export interface REnv {
  has(key: string): boolean;
  /** A Returns row, the column of stream index s (0 = the inception column), column relative. */
  s(key: string, s: number): string;
  /** A Returns row, stream index s, absolute. */
  sA(key: string, s: number): string;
  /** A Returns row's value cell (column D), absolute. */
  d(key: string): string;
  /** A cell of a Returns table row, absolute. */
  cell(key: string, col: number): string;
  /** A Returns row's stream range, inception to stream index `last` (default the last year). */
  rng(key: string, last?: number): string;
  /** A Returns row's years (no inception column). */
  rngY(key: string): string;
  /** A Returns row's years from the first to stream index `last`. */
  rngYTo(key: string, last: number): string;
  /** Another tab's row at stream index s (year s-1), column relative. */
  x(key: string, s: number): string;
  /** Another tab's row at stream index s, absolute. */
  xA(key: string, s: number): string;
  /** Another tab's row, its years as one range. */
  xr(key: string): string;
  /** A financing figure at stream index s (an outflow row read negated). */
  loop(key: string, s: number): string;
  /** One registered cell, absolute. */
  ref(key: string): string;
  /** The Timeline year at stream index s, column relative; its range; the exit flag at s and its range. */
  yr(s: number): string;
  yrA(s: number): string;
  yrRng(): string;
  ex(s: number): string;
  exRng(): string;
  /** Every registered key. */
  keys(): string[];
  /** Another tab's row, the year before each year (its opening column to the year before the last). */
  prevRange(key: string): string;
  /** Another tab's row, its one figure. */
  xo(key: string): string;
  /** The Timeline years from the inception column to stream index s. */
  yrRngTo(s: number): string;
  /** A Returns row's stream range from index s0 to the last year. */
  rngFrom(key: string, s0: number): string;
  /** The terminal value of an income, by the model's method (terminal.ts). */
  tvOf(income: string): string;
}

type Fx = (E: REnv) => string;
type FxS = (E: REnv, s: number) => string;

export interface RetCell { col: number; v: number | string | null; fmt?: string; f?: Fx; bold?: boolean }
export interface RetRow {
  key: string;
  label: string;
  kind: 'section' | 'head' | 'cols' | 'p' | 'cells' | 'gap';
  /** 'p': one value per stream index 0..N (0 = the inception column); null leaves the cell blank. */
  values?: Array<number | null>;
  /** 'p': what an unmeasured year (a null value) prints: '-' for a ratio, '' for a blank. */
  nullAs?: string;
  /** 'p': the first stream index with a formula (1 = the years only, the default). */
  from?: 0 | 1;
  fs?: FxS;
  total?: 'sum' | 'last' | 'none';
  fmt?: string;
  cells?: RetCell[];
  cols?: Array<[number, string]>;
  style?: 'total' | 'subtotal';
  indent?: number;
}

/** Column letters for the tables: D (the Total column) and the next ones. */
const D = 4;

export interface ReturnsPlan { rows: RetRow[]; refused: string[] }

export function returnsPlan(state: FinancialsResolverState, snap: Snap, rs: RS, opts: { includeSensitivity: boolean }): ReturnsPlan {
  void opts;
  const N = snap.axisLength;
  const p = state.project;
  const cfg = rs.config;
  const X = cfg.exitYearOffset;
  const booked = snap.disposal.booked;
  const fundOn = rs.waterfall.active;
  // An existing position is built only where the project has one (2026-11-17, founder: off is not built).
  const exOn = featureUsed(state as never, 'existing');
  const rows: RetRow[] = [];
  const refused: string[] = [];
  const years = snap.yearLabels;
  const exitYear = years[X] ?? 0;
  const basisYear = cfg.terminalValueBasis === 'exit_year' ? exitYear : exitYear - 1;

  // ── Value helpers ────────────────────────────────────────────────────────
  const stream = (a: readonly number[] | undefined): number[] => Array.from({ length: N + 1 }, (_, s) => Number(a?.[s] ?? 0));
  const yearsToStream = (a: readonly number[] | undefined): Array<number | null> => [null, ...Array.from({ length: N }, (_, t) => Number(a?.[t] ?? 0))];
  const hold = Array.from({ length: N }, (_, t) => (t <= X ? 1 : 0));
  const sumOf = (a: ReadonlyArray<number | null>): number => a.reduce<number>((s, v) => s + (v ?? 0), 0);
  const irrNum = (v: number | null | undefined): number | string => (v == null || !Number.isFinite(v) ? 'n/a' : v);

  const section = (key: string, label: string): void => { rows.push({ key, label, kind: 'section' }); };
  const head = (key: string, label: string): void => { rows.push({ key, label, kind: 'head' }); };
  const gap = (key: string): void => { rows.push({ key, label: '', kind: 'gap' }); };
  const pRow = (key: string, label: string, values: Array<number | null>, fs: FxS, o: Partial<RetRow> = {}): void => {
    rows.push({ key, label, kind: 'p', values, fs, total: 'sum', fmt: RF.money, ...o });
  };
  const one = (key: string, label: string, v: number | string | null, f: Fx | undefined, fmt: string = RF.money, o: Partial<RetRow> = {}): void => {
    rows.push({ key, label, kind: 'cells', cells: [{ col: D, v, fmt, f }], ...o });
  };

  // ── The streams' sources, by year ───────────────────────────────────────
  const bu = rs.buildup;
  const trapped = trappedCashFrom(snap, N);
  const level: number[] = []; { let run = 0; for (let t = 0; t < N; t++) { run += t <= X ? (trapped[t] ?? 0) : 0; level.push(t <= X ? run : 0); } }
  // The level as the engine holds it to the exit; the workbook carries the balance every year.
  const levelAll: number[] = []; { let run = 0; for (let t = 0; t < N; t++) { run += trapped[t] ?? 0; levelAll.push(run); } }

  // Each stream's IRR, MOIC and NPV, computed once, in the row under the stream (2026-11-16, founder).
  const rate = (E: REnv): string => E.ref('inp=ret|Discount Rate (%)@4');
  // THE EQUITY STREAMS DISCOUNT AT THE COST OF EQUITY (2026-11-18); the project stream at the discount rate.
  const coe = (E: REnv): string => `IF(N(${E.ref('ret:coe')})>0,${E.ref('ret:coe')},${rate(E)})`;
  const results = (key: string, label: string, src: string, r: RS['result']['fcff'], rateOf: (E: REnv) => string = rate): void => {
    rows.push({ key: `${key}#cols`, label: '', kind: 'cols', cols: [[D, 'IRR'], [D + 1, 'MOIC'], [D + 2, 'NPV']] });
    const rng = (E: REnv): string => E.rng(src);
    rows.push({ key, label, kind: 'cells', style: 'subtotal', cells: [
      { col: D, v: irrNum(r.irr), fmt: RF.pct, f: (E) => `IFERROR(IRR(${rng(E)},0.1),"n/a")`, bold: true },
      { col: D + 1, v: r.moic, fmt: RF.mult, f: (E) => `IF(-SUMIF(${rng(E)},"<0")>0,SUMIF(${rng(E)},">0")/-SUMIF(${rng(E)},"<0"),0)` },
      { col: D + 2, v: r.npv, fmt: RF.money, f: (E) => `${E.sA(src, 0)}+NPV(${rateOf(E)},${E.rngFrom(src, 1)})` },
    ] });
  };

  // ════ ASSUMPTIONS (the Inputs cells, linked) ════════════════════════════
  section('ret|#section', 'Returns');
  head('ret|#assumptions', 'Assumptions (from Inputs)');
  one('ret|Discount Rate (%)', 'Discount rate', cfg.discountRate, undefined, RF.pct);
  one('ret|Cost of equity (%)', 'Cost of equity (the equity NPVs)', cfg.costOfEquity, (E) => coe(E), RF.pct);
  one('ret|Exit Year', 'Exit year', exitYear, undefined, RF.year);
  const methodLabel: Record<string, string> = { exit_multiple: 'Exit Multiple', cap_rate: 'Exit Cap Rate', perpetuity: 'Perpetuity (Gordon)', none: 'None' };
  one('ret|Terminal Value Method', 'Terminal value method', methodLabel[cfg.terminalMethod] ?? cfg.terminalMethod, (E) => E.ref('ret:tvMethod'), RF.text);
  if (cfg.terminalMethod !== 'none') one('ret|Terminal value basis', 'Terminal value basis', cfg.terminalValueBasis === 'exit_year' ? 'Exit year' : 'Year before exit', (E) => E.ref('ret:tvBasis'), RF.text);
  const manualCap = cfg.capRateSource === 'manual';
  if (cfg.terminalMethod === 'cap_rate') {
    one('ret|Exit Cap Rate (%)', manualCap ? 'Exit cap rate' : 'Exit cap rate (discount rate less growth)', manualCap ? cfg.capRate : cfg.capRateDerived,
      manualCap ? undefined : (E) => `MAX(0,${E.ref('inp=ret|Discount Rate (%)@4')}-${E.ref('inp=ret|Growth g (%)@4')})`, RF.pct);
  }
  if (cfg.terminalMethod === 'exit_multiple') one('ret|Exit Multiple (x stabilised NOI)', 'Exit multiple', cfg.exitMultiple, undefined, RF.mult);
  // GROWTH ONLY WHERE THE METHOD USES IT (2026-11-16, founder): a typed cap rate on income as stated reads no growth.
  const growthUsed = cfg.terminalMethod === 'perpetuity' || (cfg.terminalMethod === 'cap_rate' && (!manualCap || cfg.applyGrowthToTerminal));
  if (growthUsed) one('ret|Growth g (%)', 'Growth', cfg.perpetuityGrowth, undefined, RF.pct);
  if (cfg.terminalMethod !== 'none') one('ret|Terminal metric', 'Terminal metric', cfg.applyGrowthToTerminal ? 'Grown by (1 + g)' : 'As stated, not grown', (E) => E.ref('ret:tvMetric'), RF.text);
  one('ret|Basis year', 'Year the terminal value capitalises', basisYear, (E) => `${E.d('ret|Exit Year')}-IF(${E.d('ret|Terminal value basis')}="Exit year",0,1)`, RF.year);
  if (!booked) refused.push('no terminal value');
  if (cfg.terminalMethod !== 'cap_rate' && cfg.terminalMethod !== 'exit_multiple') refused.push(`a terminal value by ${cfg.terminalMethod}`);
  gap('ret|gap|a');

  // ════ EXIT VALUE: the income capitalised gives the terminal value; less the debt, the exit equity ══
  const d = snap.disposal;
  const atBasis = (E: REnv, rng: string): string => `SUMPRODUCT((${E.yrRng()}=${E.d('ret|Basis year')})*${rng})`;
  const atExit = (E: REnv, rng: string): string => `SUMPRODUCT(${E.exRng()},${rng})`;
  head('ret|#exit', 'Exit value');
  pRow('rs|noi', 'Held assets\' income (NOI)', yearsToStream(rs.noiPerPeriod), (E, s) => E.loop('fnc:noi', s), { total: 'sum' });
  one('ret|x|inc', 'Income capitalised (the NOI of the year above)', d.exitMetric, (E) => atBasis(E, E.rngY('rs|noi')));
  one('ret|x|tv', cfg.terminalMethod === 'exit_multiple' ? 'Terminal value, gross (income x the exit multiple)' : 'Terminal value, gross (income / the exit cap rate)', d.grossValue,
    (E) => E.tvOf(E.d('ret|x|inc')), RF.money, { style: 'subtotal' });
  // SELLING COSTS AT EXIT (2026-11-18): the gross less the share on Inputs is the net exit value, the proceeds.
  one('ret|x|cost', 'Less: selling costs at exit', -d.sellingCosts, (E) => `-${E.d('ret|x|tv')}*MAX(0,MIN(1,N(${E.ref('ret:sellCost')})))`);
  one('ret|x|net', 'Net exit value', d.proceeds, (E) => `${E.d('ret|x|tv')}+${E.d('ret|x|cost')}`, RF.money, { style: 'subtotal' });
  pRow('rs|debt', 'Debt outstanding', yearsToStream(snap.bs.debtOutstandingPerPeriod), (E, s) => E.x(bsTotalDebtKey(state), s), { total: 'none' });
  const debtX = Math.max(0, snap.bs.debtOutstandingPerPeriod[X] ?? 0);
  one('ret|x|debtX', 'Less: debt at the exit', debtX, (E) => `MAX(0,${atExit(E, E.rngY('rs|debt'))})`);
  one('ret|x|eq', 'Exit equity value', Math.max(0, d.proceeds - debtX), (E) => `MAX(0,${E.d('ret|x|net')}-${E.d('ret|x|debtX')})`, RF.money, { style: 'subtotal' });
  gap('ret|gap|b');

  // ════ FCFF ══════════════════════════════════════════════════════════════
  head('ret|#fcff', 'FCFF, unlevered project');
  pRow('rs|hold', 'In the hold (1 up to the exit year)', [null, ...hold], (E, s) => `IF(${E.yr(s)}<=${E.d('ret|Exit Year')},1,0)`, { total: 'none', fmt: RF.int });
  const H = (E: REnv, s: number): string => E.s('rs|hold', s);
  pRow('rs|ff:cfo', 'Cash from operations', stream(bu.cfoPerPeriod), (E, s) => `${H(E, s)}*${E.x('cf|direct||Cash Flow from Operations', s)}`, { indent: 1 });
  pRow('rs|ff:capex', 'Capex paid in cash', stream(bu.cfiPerPeriod), (E, s) => `${H(E, s)}*${E.x('cf|direct||Total capex paid in cash', s)}`, { indent: 1 });
  pRow('rs|ff:kind', 'Land contributed in kind', stream(bu.inKindLandPerPeriod), (E, s) => `-${H(E, s)}*${E.x('cx5:total:inkind', s)}`, { indent: 1 });
  pRow('rs|ff:pre', 'FCFF before the exit value', stream(bu.fcffSubtotalPerPeriod).map((v, s) => (s === 0 ? -(rs.buildup.existingPreCapexPerPeriod?.[0] ?? 0) : v)),
    (E, s) => (s === 0 ? (exOn ? `-${E.ref('retin:hist')}` : '0') : `SUM(${E.s('rs|ff:cfo', s)}:${E.s('rs|ff:kind', s)})`), { from: 0, style: 'subtotal' });
  pRow('rs|ff:tv', 'Terminal value (exit proceeds)', stream(bu.terminalEnterprisePerPeriod), (E, s) => E.loop('fnc:proceeds', s), { indent: 1 });
  pRow('rs|fcff', 'FCFF', stream(rs.fcffPerPeriod), (E, s) => `${E.s('rs|ff:pre', s)}+${E.s('rs|ff:tv', s)}`, { from: 0, style: 'total' });
  results('ret|h|fcff', 'Project returns (FCFF)', 'rs|fcff', rs.result.fcff);
  gap('ret|gap|c');

  // ════ FCFE ══════════════════════════════════════════════════════════════
  head('ret|#fcfe', 'FCFE, levered equity');
  pRow('rs|fe:debt', 'Net debt (drawn less principal repaid)', stream(bu.netDebtPerPeriod),
    (E, s) => `${H(E, s)}*(${E.loop('fnc:main:draw', s)}+${E.loop('fnc:main:idcdraw', s)}-${E.loop('fnc:main:repay', s)})`, { indent: 1 });
  pRow('rs|fe:int', 'Finance cost (the full accrued charge)', stream(bu.financeCostPerPeriod), (E, s) => `-${H(E, s)}*${E.loop('fnc:main:interest', s)}`, { indent: 1 });
  // The cash the model holds back: the minimum reserve, and the sweep's claim where a sweep runs.
  pRow('rs|close', 'Closing cash', yearsToStream(snap.directCF.closingCashPerPeriod), (E, s) => E.x('cf|direct||Closing cash', s), { total: 'none', indent: 1 });
  const sweeps = snap.cashSweep?.enabled === true;
  one('rs|floor', 'Minimum cash reserve', Number(p.financing?.minimumCashReserve ?? snap.financing.funding.minCashReserve ?? 0), (E) => `MAX(0,${E.ref('fin:in:min')})`, RF.money, { indent: 1 });
  pRow('rs|level', sweeps ? 'Cash held back (the reserve and the sweep\'s claim)' : 'Cash held back (the minimum reserve)', [null, ...levelAll],
    (E, s) => `MIN(${E.d('rs|floor')},MAX(0,${E.s('rs|close', s)}))${sweeps ? `+MIN(MAX(0,MAX(0,${E.s('rs|close', s)})-${E.d('rs|floor')}),MAX(0,${E.s('rs|debt', s)}))` : ''}`, { total: 'none', indent: 1 });
  const retained = [null, ...Array.from({ length: N }, (_, t) => (t <= X ? -(trapped[t] ?? 0) : 0))];
  pRow('rs|fe:held', 'Cash held back this year', retained, (E, s) => `-${H(E, s)}*(${E.s('rs|level', s)}-${s === 1 ? '0' : E.s('rs|level', s - 1)})`, { indent: 1 });
  const fePre = stream(rs.fcfePerPeriod).map((v, s) => v - (bu.terminalEquityPerPeriod?.[s] ?? 0) - (s === X + 1 ? (level[X] ?? 0) : 0));
  pRow('rs|fe:pre', 'FCFE before the exit value', fePre,
    (E, s) => (s === 0 ? (exOn ? `-(${E.ref('retin:hist')}-${E.ref('retin:debt')})` : '0') : `${E.s('rs|ff:pre', s)}+${E.s('rs|fe:debt', s)}+${E.s('rs|fe:int', s)}+${E.s('rs|fe:held', s)}`), { from: 0, style: 'subtotal' });
  pRow('rs|fe:tv', 'Exit equity value', stream(bu.terminalEquityPerPeriod), (E, s) => `${E.ex(s)}*${E.d('ret|x|eq')}`, { indent: 1 });
  pRow('rs|fe:rel', 'Cash held back, released at the exit', [null, ...Array.from({ length: N }, (_, t) => (t === X ? (level[X] ?? 0) : 0))],
    (E, s) => `${E.ex(s)}*${E.s('rs|level', s)}`, { indent: 1 });
  pRow('rs|fcfe', 'FCFE', stream(rs.fcfePerPeriod), (E, s) => `${E.s('rs|fe:pre', s)}+${E.s('rs|fe:tv', s)}+${E.s('rs|fe:rel', s)}`, { from: 0, style: 'total' });
  results('ret|h|fcfe', 'Equity returns (FCFE)', 'rs|fcfe', rs.result.fcfe, coe);
  gap('ret|gap|d');

  // ════ DISTRIBUTIONS AND THE PERFORMANCE FEE ═════════════════════════════
  head('ret|#ddm', fundOn ? 'Distributions to equity, before the performance fee' : 'Distributions to equity');
  pRow('rs|dd:cash', 'Cash equity invested', stream(bu.equityCashPerPeriod), (E, s) => `-${H(E, s)}*(${E.loop('fnc:main:equity', s)}+${E.loop('fnc:main:feedraw', s)})`, { indent: 1 });
  pRow('rs|dd:kind', 'Land contributed in kind', stream(bu.equityInKindPerPeriod), (E, s) => E.s('rs|ff:kind', s), { indent: 1 });
  pRow('rs|dd:div', 'Dividends paid', stream(bu.dividendsDistributedPerPeriod), (E, s) => `${H(E, s)}*${E.loop('fnc:main:div', s)}`, { indent: 1 });
  pRow('rs|dd:tv', 'Exit equity not already paid as a dividend', stream(bu.terminalEquityDistributedPerPeriod),
    (E, s) => `IF(${E.ref('fin:in:divOn')}=1,0,${E.s('rs|fe:tv', s)})`, { indent: 1 });
  pRow('rs|ddm', 'Distributions, net cash flow to equity', stream(rs.dividendStreamPerPeriod),
    (E, s) => (s === 0 ? (exOn ? `-(${E.ref('retin:hist')}-${E.ref('retin:debt')})` : '0') : `SUM(${E.s('rs|dd:cash', s)}:${E.s('rs|dd:tv', s)})`), { from: 0, style: 'total' });
  results('ret|h|ddm', fundOn ? 'Distribution returns, before the performance fee' : 'Distribution returns', 'rs|ddm', rs.result.dividends, coe);

  if (fundOn) {
    const w = rs.waterfall;
    const W = (a: readonly number[]): number[] => stream(a);
    const unpaid = W(w.unpaidHurdlePerPeriod);
    head('ret|#wf', 'Performance fee (the hurdle waterfall)');
    const h = (E: REnv): string => `MAX(0,${E.ref('ft:Hurdle rate (preferred return)')})`;
    const pf = (E: REnv): string => `MAX(0,MIN(1,${E.ref('ft:Performance fee on the excess')}))`;
    pRow('rs|wf:drawn', 'Equity drawn', W(w.equityDrawnPerPeriod),
      (E, s) => (s === 0 ? (exOn ? `MAX(0,${E.ref('retin:hist')}-${E.ref('retin:debt')})` : '0') : `MAX(0,-(${E.s('rs|dd:cash', s)}+${E.s('rs|dd:kind', s)}))+MAX(0,-${E.s('rs|dd:div', s)})`), { from: 0, indent: 1 });
    pRow('rs|wf:gross', 'Distributions before the fee', W(w.distributionPerPeriod),
      (E, s) => (s === 0 ? '0' : `MAX(0,${E.s('rs|dd:div', s)})+MAX(0,${E.s('rs|dd:cash', s)}+${E.s('rs|dd:kind', s)})+MAX(0,${E.s('rs|dd:tv', s)})`), { from: 0, indent: 1 });
    pRow('rs|wf:bop', 'Unpaid hurdle, opening', unpaid.map((_, s) => (s === 0 ? 0 : unpaid[s - 1] ?? 0)), (E, s) => (s === 0 ? '0' : E.s('rs|wf:eop', s - 1)), { from: 0, indent: 1, total: 'none' });
    pRow('rs|wf:acc', 'Hurdle accrued', W(w.hurdleAccruedPerPeriod), (E, s) => `${E.s('rs|wf:bop', s)}*${h(E)}`, { from: 0, indent: 1 });
    pRow('rs|wf:owed', 'Hurdle owed', W(w.totalHurdleOwedPerPeriod), (E, s) => `${E.s('rs|wf:drawn', s)}+${E.s('rs|wf:bop', s)}+${E.s('rs|wf:acc', s)}`, { from: 0, indent: 1, total: 'none' });
    pRow('rs|wf:paid', 'Hurdle paid', W(w.hurdlePaidPerPeriod), (E, s) => `MIN(${E.s('rs|wf:gross', s)},${E.s('rs|wf:owed', s)})`, { from: 0, indent: 1 });
    pRow('rs|wf:eop', 'Unpaid hurdle, closing', unpaid, (E, s) => `${E.s('rs|wf:owed', s)}-${E.s('rs|wf:paid', s)}`, { from: 0, indent: 1, total: 'last' });
    pRow('rs|wf:excess', 'Distributions above the hurdle', W(w.excessDistributionsPerPeriod), (E, s) => `${E.s('rs|wf:gross', s)}-${E.s('rs|wf:paid', s)}`, { from: 0, indent: 1 });
    pRow('rs|wf:fee', 'Performance fee', W(w.performanceFeePerPeriod), (E, s) => `${E.s('rs|wf:excess', s)}*${pf(E)}`, { from: 0, indent: 1 });
    pRow('rs|wf:net', 'Distributions net of the fee', W(w.netDistributionPerPeriod), (E, s) => `${E.s('rs|wf:gross', s)}-${E.s('rs|wf:fee', s)}`, { from: 0, indent: 1 });
    pRow('rs|ddmnet', 'Distributions net of the fee, net cash flow to equity', W(rs.netDividendStreamPerPeriod),
      (E, s) => `${E.s('rs|wf:net', s)}-${E.s('rs|wf:drawn', s)}`, { from: 0, style: 'total' });
    results('ret|h|net', 'Distribution returns, net of the performance fee', 'rs|ddmnet', rs.resultNetDividends, coe);
  }
  gap('ret|gap|e');

  // ════ EQUITY PARTNERS: invested, the share used, and the returns ════════
  {
    const ps = rs.partners;
    const partners = (p.partners ?? []).length ? (p.partners ?? []) : [{ id: 'sponsor', name: 'Sponsor', cashPct: 100, inKindPct: 100, existingPct: 100 }];
    const pc = (j: number): number => D + 1 + j;
    head('ret|#partners', 'Equity partners');
    rows.push({ key: 'ret|#pcols', label: 'Equity type', kind: 'cols', cols: [[D, 'Total'], ...partners.map((q, j) => [pc(j), q.name] as [number, string])] });
    const pctOf = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) / 100 : 0);
    const cashT = sumOf(stream(bu.equityCashPerPeriod).map((v) => -v)), kindT = sumOf(stream(bu.equityInKindPerPeriod).map((v) => -v));
    const exT = snap.financing.equity.totalExisting;
    const allTypeRows: Array<[string, string, number, string, (q: typeof partners[number]) => number, Fx]> = [
      ['cash', 'New cash equity', cashT, 'cash', (q) => pctOf(q.cashPct), (E) => `-SUM(${E.rngY('rs|dd:cash')})`],
      ['kind', 'In-kind equity (land)', kindT, 'kind', (q) => pctOf(q.inKindPct), (E) => `-SUM(${E.rngY('rs|dd:kind')})`],
      ['ex', 'Existing equity', exT, 'ex', (q) => pctOf(q.existingPct), (E) => E.ref('retin:equity')],
    ];
    const typeRows = allTypeRows.filter(([id]) => id !== 'ex' || exOn);
    const invIds = typeRows.map(([id]) => id);
    for (const [id, label, tot, sfx, share, ft] of typeRows) {
      rows.push({ key: `ret|pt|${id}`, label, kind: 'cells', cells: [{ col: D, v: tot, fmt: RF.money, f: ft },
        ...partners.map((q, j) => ({ col: pc(j), v: tot * share(q), fmt: RF.money, f: (E: REnv) => `${E.cell(`ret|pt|${id}`, D)}*${E.cell(`ret|pt|${id}:share`, pc(j))}` }))] });
      rows.push({ key: `ret|pt|${id}:share`, label: 'Share', kind: 'cells', indent: 1, cells: partners.map((q, j) => ({ col: pc(j), v: share(q), fmt: RF.pct,
        f: (E: REnv) => `MAX(0,MIN(1,${E.ref(`retin:share:${sfx}:${j}`)}))` })) });
    }
    const investedJ = partners.map((q) => cashT * pctOf(q.cashPct) + kindT * pctOf(q.inKindPct) + exT * pctOf(q.existingPct));
    rows.push({ key: 'ret|pt|inv', label: 'Total invested', kind: 'cells', style: 'subtotal', cells: [{ col: D, v: cashT + kindT + exT, fmt: RF.money, f: (E) => `SUM(${invIds.map((id) => E.cell(`ret|pt|${id}`, D)).join(',')})` },
      ...partners.map((_q, j) => ({ col: pc(j), v: investedJ[j], fmt: RF.money, f: (E: REnv) => `SUM(${invIds.map((id) => E.cell(`ret|pt|${id}`, pc(j))).join(',')})` }))] });
    // Capital-years: each year's equity in, by the years it is held to the end of the axis. Not built where every
    // partner has an agreed share typed (2026-11-17, founder): the time-weighted share then decides nothing.
    const allAgreed = ps.partners.length > 0 && ps.partners.every((q) => q.shareholdingIsManual === true);
    if (!allAgreed) {
    const cashS = stream(bu.equityCashPerPeriod), kindS = stream(bu.equityInKindPerPeriod);
    const cy = (a: number[]): number => a.reduce((s2, v, s) => s2 + (s === 0 ? 0 : -v * (N - (s - 1))), 0);
    const cyC = cy(cashS), cyK = cy(kindS);
    const cyJ = partners.map((q) => (cashT > 0 ? pctOf(q.cashPct) : 0) * cyC + (kindT > 0 ? pctOf(q.inKindPct) : 0) * cyK);
    const cyRow = (E: REnv, key: string): string => `-SUMPRODUCT(${E.rngY(key)},MAX(${E.yrRng()})+1-${E.yrRng()})`;
    for (const [sfx, dd, t0] of [['cash', 'rs|dd:cash', cashT], ['kind', 'rs|dd:kind', kindT]] as const) {
      const per0 = partners.map((q) => (t0 > 0 ? pctOf(sfx === 'cash' ? q.cashPct : q.inKindPct) : 0) * (sfx === 'cash' ? cyC : cyK));
      rows.push({ key: `ret|pt|cy:${sfx}`, label: `Capital-years, ${sfx === 'cash' ? 'cash' : 'in-kind'} equity`, kind: 'cells', indent: 1, cells: partners.map((_q, j) => ({ col: pc(j), v: per0[j], fmt: RF.money,
        f: (E: REnv) => `IF(${E.cell(`ret|pt|${sfx}`, D)}>0,${E.cell(`ret|pt|${sfx}:share`, pc(j))},0)*${cyRow(E, dd)}` })) });
    }
    rows.push({ key: 'ret|pt|cy', label: 'Capital-years (each amount x the years it is held)', kind: 'cells', cells: [{ col: D, v: sumOf(cyJ), fmt: RF.money, f: (E) => `SUM(${partners.map((_q, j) => E.cell('ret|pt|cy', pc(j))).join(',')})` },
      ...partners.map((_q, j) => ({ col: pc(j), v: cyJ[j], fmt: RF.money,
        f: (E: REnv) => `${E.cell('ret|pt|cy:cash', pc(j))}+${E.cell('ret|pt|cy:kind', pc(j))}` }))] });
    rows.push({ key: 'ret|pt|tw', label: 'Time-weighted share', kind: 'cells', cells: partners.map((_q, j) => ({ col: pc(j), v: ps.partners[j]?.weightedAvgShareholdingPct ?? 0, fmt: RF.pct,
      f: (E: REnv) => `IF(${E.cell('ret|pt|cy', D)}>0,${E.cell('ret|pt|cy', pc(j))}/${E.cell('ret|pt|cy', D)},IF(${E.cell('ret|pt|inv', D)}>0,${E.cell('ret|pt|inv', pc(j))}/${E.cell('ret|pt|inv', D)},0))` })) });
    }
    rows.push({ key: 'ret|pt|share', label: 'Share used (the agreed share where one is typed)', kind: 'cells', style: 'subtotal', cells: partners.map((_q, j) => ({ col: pc(j), v: ps.partners[j]?.shareholdingPct ?? 0, fmt: RF.pct,
      f: (E: REnv) => { const a = E.ref(`retin:agreed:${j}`); return allAgreed ? a : `IF(ISNUMBER(${a}),${a},${E.cell('ret|pt|tw', pc(j))})`; } })) });
    // A FIXED SHARE OF A STREAM HAS THE STREAM'S IRR AND MOIC (2026-11-16, founder): each partner links the
    // equity returns above; only the distributions received are the partner's own figure.
    rows.push({ key: 'ret|#prcols', label: 'Partner', kind: 'cols', cols: [[D, 'Invested'], [D + 1, 'Share'], [D + 2, 'FCFE IRR'], [D + 3, 'FCFE MOIC'], [D + 4, 'Distribution IRR'], [D + 5, 'Distribution MOIC'], [D + 6, 'Distributions']] });
    ps.partners.forEach((q, j) => {
      rows.push({ key: `ret|pr|${j}`, label: q.name, kind: 'cells', cells: [
        { col: D, v: investedJ[j], fmt: RF.money, f: (E) => E.cell('ret|pt|inv', pc(j)) },
        { col: D + 1, v: q.shareholdingPct, fmt: RF.pct, f: (E) => E.cell('ret|pt|share', pc(j)) },
        { col: D + 2, v: irrNum(q.fcfeIrr), fmt: RF.pct, f: (E) => E.cell('ret|h|fcfe', D) },
        { col: D + 3, v: q.fcfeMoic, fmt: RF.mult, f: (E) => E.cell('ret|h|fcfe', D + 1) },
        { col: D + 4, v: irrNum(q.irr), fmt: RF.pct, f: (E) => E.cell('ret|h|ddm', D) },
        { col: D + 5, v: q.moic, fmt: RF.mult, f: (E) => E.cell('ret|h|ddm', D + 1) },
        { col: D + 6, v: sumOf(stream(q.cashFlowStream).map((v) => Math.max(0, v))), fmt: RF.money, f: (E) => `${E.cell(`ret|pr|${j}`, D + 1)}*SUMIF(${E.rng('rs|ddm')},">0")` },
      ] });
    });
  }
  gap('ret|gap|f');

  // ════ FUND FEES AND WHO EARNS THEM (fund layer) ═════════════════════════
  if (rs.feeEarners.active) {
    const terms = resolveFundTerms(p);
    const fe0 = rs.feeEarners;
    head('ret|#fees', fundOn ? 'Fees and who earns them' : 'Developer fee, sales commission and who earns them');
    // The manager's fees (2026-11-18): every fund fee line but the flat other expenses, which pay third parties.
    const mg = yearsToStream(fe0.managementFeePerPeriod.slice(1));
    if (fundOn) {
      pRow('rs|fee:mgmt', 'Management fees', mg, (E, s) => snap.fundFees.lines.map((l, i) => (l.base === 'flat_amount' ? '' : E.loop(`fnc:fee:${i}`, s))).filter(Boolean).join('+') || '0', { indent: 1 });
      pRow('rs|fee:perf', 'Performance fee', stream(rs.waterfall.performanceFeePerPeriod).map((v, s) => (s === 0 ? null : v)), (E, s) => E.s('rs|wf:fee', s), { indent: 1 });
    }
    // THE DEVELOPER FEE AND THE SALES COMMISSION (2026-11-18, founder), each the Capex rows of its lines.
    const identityKeys = (E: REnv, ident: string): string[] => KEYS.cxc(E).filter((k) => {
      const lineId = k.split(':')[2];
      const cl = (state.costLines as CostLine[]).find((x) => x.id === lineId);
      return !!cl && resolveCatalogId(cl) === ident;
    });
    const dvS = [null, ...fe0.developerFeePerPeriod.slice(1, N + 1)];
    const cmS = [null, ...fe0.commissionPerPeriod.slice(1, N + 1)];
    const hasDev = fe0.totalDeveloperFee > 0.005, hasCom = fe0.totalCommission > 0.005;
    if (hasDev) pRow('rs|fee:dev', 'Developer fee', dvS, (E, s) => identityKeys(E, 'developer-fee').map((k) => E.x(k, s)).join('+') || '0', { indent: 1 });
    if (hasCom) pRow('rs|fee:com', 'Sales commission', cmS, (E, s) => identityKeys(E, 'commission').map((k) => E.x(k, s)).join('+') || '0', { indent: 1 });
    const feeKeys = [fundOn ? 'rs|fee:mgmt' : '', fundOn ? 'rs|fee:perf' : '', hasDev ? 'rs|fee:dev' : '', hasCom ? 'rs|fee:com' : ''].filter(Boolean);
    pRow('rs|fee:all', 'Total fee income', [null, ...Array.from({ length: N }, (_, t) => (fundOn ? (mg[t + 1] ?? 0) + (rs.waterfall.performanceFeePerPeriod[t + 1] ?? 0) : 0) + (dvS[t + 1] ?? 0) + (cmS[t + 1] ?? 0))],
      (E, s) => feeKeys.map((k) => E.s(k, s)).join('+') || '0', { style: 'subtotal' });
    // Who earns them: the Fund Manager takes the management fees; the performance fee and the developer
    // fee follow the shares typed on Inputs; the commission follows the project's split.
    rows.push({ key: 'ret|#ecols', label: 'Earner', kind: 'cols', cols: [[D, 'Management fees'], [D + 1, 'Performance fee'], [D + 2, 'Developer fee'], [D + 3, 'Sales commission'], [D + 4, 'Total']] });
    const matrix = fundOn ? (terms.feeDistribution ?? []) : [];
    const devCells = (E: REnv): string[] => matrix.map((_m, i) => `ftm:${i}:dev`).filter((k) => E.has(k)).map((k) => E.ref(k));
    const devShareF = (e: typeof fe0.earners[number]): Fx => (E) => {
      const i = matrix.findIndex((m) => (e.kind === 'fund_manager' ? isFundManagerRow(m) : m.partyId === e.entityId && !isFundManagerRow(m)));
      if (i >= 0 && E.has(`ftm:${i}:dev`)) return `MAX(0,${E.ref(`ftm:${i}:dev`)})`;
      if (e.entityId === DEVELOPER_EARNER_ID) { const cs = devCells(E); return cs.length ? `IF((${cs.map((c) => `(${c}>0)`).join('+')})>0,0,1)` : '1'; }
      return '0';
    };
    const splitRows = resolveCommissionSplit(p);
    const comShareF = (e: typeof fe0.earners[number]): Fx => (E) => {
      const j = splitRows.findIndex((x) => x.entityId === e.entityId);
      if (j < 0) return '0';
      return E.has(`csplit:${j}`) ? `MAX(0,${E.ref(`csplit:${j}`)})` : String(splitRows[j].share);
    };
    const perfCells = (E: REnv): string[] => matrix.map((_m, i) => E.ref(`ftm:${i}:perf`));
    // The Fund Manager takes the whole performance fee by default only where no share is typed at all.
    const anyTyped = (E: REnv): string => `IF((${perfCells(E).map((c) => `(${c}>0)`).join('+')})>0,0,1)`;
    const fe = rs.feeEarners;
    const shareF = (e: typeof fe.earners[number]): Fx => (E) => {
      const i = matrix.findIndex((m) => (e.kind === 'fund_manager' ? isFundManagerRow(m) : m.partyId === e.entityId && !isFundManagerRow(m)));
      const typed = i >= 0 ? `MAX(0,${E.ref(`ftm:${i}:perf`)})` : '0';
      return e.kind === 'fund_manager' ? `${typed}+${matrix.length ? anyTyped(E) : '1'}` : typed;
    };
    fe.earners.forEach((e, k) => {
      rows.push({ key: `ret|fe|${k}`, label: e.name, kind: 'cells', cells: [
        { col: D, v: e.totalManagementFeeIncome, fmt: RF.money, f: (E) => (fundOn && e.managementFeeShare > 0 ? E.d('rs|fee:mgmt') : '0') },
        { col: D + 1, v: e.totalPerformanceFeeIncome, fmt: RF.money, f: (E) => (fundOn ? `(${shareF(e)(E)})*${E.d('rs|fee:perf')}` : '0') },
        { col: D + 2, v: e.totalDeveloperFeeIncome, fmt: RF.money, f: (E) => (hasDev ? `(${devShareF(e)(E)})*${E.d('rs|fee:dev')}` : '0') },
        { col: D + 3, v: e.totalCommissionIncome, fmt: RF.money, f: (E) => (hasCom ? `(${comShareF(e)(E)})*${E.d('rs|fee:com')}` : '0') },
        { col: D + 4, v: e.totalFeeIncome, fmt: RF.money, f: (E) => `SUM(${E.cell(`ret|fe|${k}`, D)}:${E.cell(`ret|fe|${k}`, D + 3)})` },
      ] });
    });
    // Not built where the shares assign the whole fee by set-up (2026-11-17, founder): none typed (the Fund
    // Manager takes it all) or the typed shares add to 100% or more.
    const perfSum = matrix.reduce((a, m) => a + Math.max(0, (m as { performanceFeePct?: number }).performanceFeePct ?? 0), 0);
    if (fundOn && !(perfSum === 0 || perfSum >= 1 - 1e-9)) rows.push({ key: 'ret|fe|un', label: 'Performance fee no earner takes', kind: 'cells', cells: [
      { col: D + 1, v: fe.unallocatedPerformanceFee, fmt: RF.money, f: (E) => `MAX(0,${E.d('rs|fee:perf')}-SUM(${fe.earners.map((_e, k) => E.cell(`ret|fe|${k}`, D + 1)).join(',')}))` },
      { col: D + 4, v: fe.unallocatedPerformanceFee, fmt: RF.money, f: (E) => E.cell('ret|fe|un', D + 1) },
    ] });
    // THE TOTAL IS THE FEE CHARGED here too: a developer fee or commission share short of 100% leaves the
    // rest earned by no one, its own row below the earners (2026-11-18).
    const devT = fe.totalDeveloperFee, comT = fe.totalCommission;
    const devUn = Math.max(0, devT - fe.earners.reduce((a, e) => a + e.totalDeveloperFeeIncome, 0));
    const comUn = Math.max(0, comT - fe.earners.reduce((a, e) => a + e.totalCommissionIncome, 0));
    if (devUn > 0.5 || comUn > 0.5) rows.push({ key: 'ret|fe|un2', label: 'Developer fee or commission no earner takes', kind: 'cells', cells: [
      { col: D + 2, v: devUn, fmt: RF.money, f: (E) => (hasDev ? `MAX(0,SUM(${E.rng('rs|fee:dev')})-SUM(${fe.earners.map((_e, k) => E.cell(`ret|fe|${k}`, D + 2)).join(',')}))` : '0') },
      { col: D + 3, v: comUn, fmt: RF.money, f: (E) => (hasCom ? `MAX(0,SUM(${E.rng('rs|fee:com')})-SUM(${fe.earners.map((_e, k) => E.cell(`ret|fe|${k}`, D + 3)).join(',')}))` : '0') },
      { col: D + 4, v: devUn + comUn, fmt: RF.money, f: (E) => `${E.cell('ret|fe|un2', D + 2)}+${E.cell('ret|fe|un2', D + 3)}` },
    ] });
    rows.push({ key: 'ret|fe|tot', label: 'Total', kind: 'cells', style: 'subtotal', cells: [D, D + 1, D + 2, D + 3, D + 4].map((c, i) => ({ col: c,
      v: [fe.totalManagementFee, fe.totalPerformanceFee, devT, comT, fe.totalManagementFee + fe.totalPerformanceFee + devT + comT][i], fmt: RF.money,
      // THE TOTAL IS THE FEE CHARGED (2026-11-03), as the platform states it: with shares typed over
      // 100% the earners' rows add to more than the fund pays, and the total must not follow them.
      f: (E: REnv) => [fundOn ? E.d('rs|fee:mgmt') : '0', fundOn ? E.d('rs|fee:perf') : '0',
        hasDev ? `SUM(${E.rng('rs|fee:dev')})` : '0', hasCom ? `SUM(${E.rng('rs|fee:com')})` : '0',
        `SUM(${E.cell('ret|fe|tot', D)}:${E.cell('ret|fe|tot', D + 3)})`][i] })) });
    gap('ret|gap|g');
  }

  // ════ SOURCES AND USES, OVER CONSTRUCTION ═══════════════════════════════
  // The cash in and out from the model start to the last year any capex is spent (the engine's
  // sourcesUses), each a sum of the Cash Flow over that window, so the totals meet with no balancing row.
  {
    const su = rs.sourcesUses;
    head('ret|#su', 'Sources and uses of capital, over construction');
    const L = years.indexOf(su.constructionEndYear);
    pRow('rs|con', 'In the construction window (1 up to the last construction year)', [null, ...Array.from({ length: N }, (_, t) => (t <= L ? 1 : 0))],
      (E, s) => `IF(${E.yr(s)}<=${E.d('ret|su|end')},1,0)`, { total: 'none', fmt: RF.int });
    // NO ARRAY FORMULA (2026-11-04, founder): MAX(INDEX(...,0)) read #VALUE! outside Excel. A 1/0 row says
    // which years spend capex (cash or in kind), and the end is the largest of that row times the year.
    // A CONSTRUCTION YEAR THAT BUILDS (2026-11-18, founder): up to Financing's last construction year (Timeline) and
    // spending, the engine's idcPeriodMask; a commission paid as units sell after it no longer stretches the window.
    const mask = snap.financing.idcPeriodMask ?? [];
    const capexOn = [null, ...Array.from({ length: N }, (_, t) => (mask[t] ? 1 : 0))];
    const conKeys = (E: REnv): string[] => state.phases.filter((ph) => ph.status !== 'operational').map((ph) => `tl:flag:${ph.id}:con`).filter((k) => E.has(k));
    pRow('rs|cxon', 'Construction year with spend (1 = yes)', capexOn, (E, s) => {
      const ks = conKeys(E);
      const bld = ks.length ? `,(${ks.map((k) => E.x(k, s)).join('+')})>0` : '';
      return `IF(AND(ABS(${E.s('rs|ff:capex', s)})+ABS(${E.s('rs|ff:kind', s)})>0.5${bld}),1,0)`;
    }, { total: 'none', fmt: RF.int });
    one('ret|su|end', 'Construction window ends (the last construction year)', su.constructionEndYear,
      (E) => `SUMPRODUCT(MAX(${E.rngY('rs|cxon')}*${E.yrRng()}))`, RF.year);
    rows.push({ key: 'ret|#sucols', label: '', kind: 'cols', cols: [[D, 'Amount'], [D + 1, '% of total']] });
    const win = (E: REnv, key: string): string => `SUMPRODUCT(${E.rngY('rs|con')},${E.xr(key)})`;
    const cf = (k: string): string => `cf|direct||${k}`;
    const escKeys = (E: REnv): string[] => [cf('Escrow: cash held'), cf('Escrow: cash released')].filter((k) => E.has(k));
    const collected = (E: REnv): string => [cf('Total cash collected'), ...escKeys(E)].map((k) => win(E, k)).join('+');
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const visibleIds = new Set(state.assets.filter((a) => a.visible !== false).map((a) => a.id));
    const landKeysOf = (E: REnv): string[] => KEYS.cxc(E).filter((k) => visibleIds.has(k.split(':')[1]) && isLandValueLine(costLineOf(k.split(':')[2])));
    // A LINE THAT CANNOT APPLY IS LEFT OUT (2026-11-16, founder): the position at the model start exists
    // only with existing operations.
    const existing = featureUsed(state as never, 'existing');
    const src: Array<[string, string, number, Fx, boolean]> = [
      ['ret|Existing Equity', 'Existing equity', su.existingEquity, (E) => E.ref('retin:equity'), existing],
      ['ret|New Equity (cash)', 'Cash equity', su.newEquityCash, (E) => win(E, cf('Equity drawn in cash')), true],
      ['ret|In-Kind Equity (land)', 'Land contributed in kind', su.inKindEquity, (E) => win(E, 'fl:inKind'), true],
      ['ret|Existing Debt', 'Existing debt', su.existingDebt, (E) => E.ref('retin:debt'), existing],
      ['ret|su|debtCapex', 'Debt drawn for capex', su.newDebtCapex, (E) => `${win(E, cf('Debt drawn'))}-${win(E, 'fnc:main:idcdraw')}`, true],
      ['ret|su|debtInt', 'Debt drawn for capitalised interest', su.newDebtInterest, (E) => win(E, 'fnc:main:idcdraw'), true],
      ['ret|su|open', 'Cash held at the model start', su.openingCash, (E) => E.xA(cf('Opening cash'), 1), existing],
      // "Net of escrow" only where escrow is held (2026-11-17, founder, step 7).
      ['ret|Customer Collections / Pre-Sales', `Customer collections during construction${featureUsed(state as never, 'escrow') ? ' (net of escrow)' : ''}`, su.customerCollections, collected, true],
      ['ret|su|proceeds', 'Disposal proceeds during construction', su.disposalProceeds, (E) => win(E, cf('Proceeds from Disposal of Operating Assets')), true],
    ];
    const use: Array<[string, string, number, Fx, boolean]> = [
      ['ret|su|existing', 'Development in place at the model start', su.existingInvestment, (E) => E.ref('retin:hist'), existing],
      // OVER THE WINDOW (2026-11-18), as the engine sums them: a cost paid after the last construction year is not a use.
      ['ret|Land', 'Land (cash and in kind)', su.land, // Capex's land value totals where it has them (2026-11-19): a window over the cash and the in-kind total, not one
      // per plot line, so the formula stays under 200 characters on a model with many plots.
      (E) => (E.has('cx5:total:cash') && E.has('cx5:total:inkind') ? `${win(E, 'cx5:total:cash')}+${win(E, 'cx5:total:inkind')}` : landKeysOf(E).map((k) => win(E, k)).join('+') || '0'), true],
      ['ret|Construction & Infrastructure', 'Construction', su.construction, (E) => `${win(E, 'fnc:capexall')}-${E.d('ret|Land')}`, true],
      ['ret|su|interest', 'Interest paid during construction', su.interestPaid, (E) => `-${win(E, cf('Interest paid'))}`, true],
      ['ret|su|opcost', 'Operating costs paid during construction', su.operatingCosts, (E) => `${collected(E)}-${win(E, cf('Cash Flow from Operations'))}`, true],
      ['ret|su|repaid', 'Debt repaid during construction', su.debtRepaid, (E) => `-${win(E, cf('Debt repaid'))}`, true],
      ['ret|su|dist', 'Distributions during construction', su.distributions, (E) => `-${win(E, cf('Dividends paid'))}`, true],
      ['ret|su|held', 'Cash held at the end of construction', su.cashHeldAtEnd, (E) => `SUMPRODUCT((${E.yrRng()}=${E.d('ret|su|end')})*${E.xr(cf('Closing cash'))})`, true],
    ];
    const block = (list: Array<[string, string, number, Fx, boolean]>, totKey: string, totLabel: string, total: number): void => {
      const shown = list.filter((x) => x[4]);
      for (const [k, label, v, f] of shown) {
        rows.push({ key: k, label, kind: 'cells', indent: 1, cells: [
          { col: D, v, fmt: RF.money, f },
          { col: D + 1, v: total ? v / total : 0, fmt: RF.pct, f: (E) => `IF(${E.d(totKey)}<>0,${E.d(k)}/${E.d(totKey)},0)` },
        ] });
      }
      rows.push({ key: totKey, label: totLabel, kind: 'cells', style: 'subtotal', cells: [
        { col: D, v: total, fmt: RF.money, f: (E) => `SUM(${E.d(shown[0][0])}:${E.d(shown[shown.length - 1][0])})` },
        { col: D + 1, v: total ? 1 : 0, fmt: RF.pct, f: (E) => `SUM(${E.cell(shown[0][0], D + 1)}:${E.cell(shown[shown.length - 1][0], D + 1)})` },
      ] });
    };
    block(src, 'ret|Total Sources', 'Total sources', su.totalSources);
    block(use, 'ret|Total Uses', 'Total uses', su.totalUses);
    one('ret|S&U check', 'Sources less uses (should be zero)', su.totalSources - su.totalUses, (E) => `${E.d('ret|Total Sources')}-${E.d('ret|Total Uses')}`);
    gap('ret|gap|h');
  }

  // ════ KEY METRICS ═══════════════════════════════════════════════════════
  {
    const m = rs.result.realEstate;
    const de = rs.developmentEconomics;
    const covInputs: CovenantInputs = { dscrPerPeriod: m.dscrPerPeriod, icrPerPeriod: m.icrPerPeriod, noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod, gdvValue: de.gdv, ltvAtExit: m.ltvAtExit };
    const phases = state.phases as Phase[];
    section('ret|#metrics', 'Key metrics');

    // Development economics: the Summary links these rows.
    head('ret|#de', 'Development economics');
    const holdSum = (E: REnv, key: string): string => `SUMPRODUCT(${E.rngY('rs|hold')},${E.xr(key)})`;
    one('ret|de|gdv', 'Gross development value (revenue over the hold)', de.gdv, (E) => holdSum(E, 'pl|__all__||Total Revenue'));
    one('ret|de|tdc', 'Total development cost', de.totalDevelopmentCost, (E) => `SUM(${E.xr('fnc:capexall')})`);
    one('ret|de|opex', 'Operating expenses over the hold', de.operatingExpenses, (E) => `-${holdSum(E, 'pl|__all__||Total Operating Expenses')}`);
    one('ret|de|before', 'Development surplus before finance', de.profitBeforeFinancing, (E) => `${E.d('ret|de|gdv')}-${E.d('ret|de|tdc')}-${E.d('ret|de|opex')}`, RF.money, { style: 'subtotal' });
    one('ret|de|fin', 'Total financing cost', de.totalFinancingCost, (E) => `SUM(${E.xr('fnc:main:interest')})`);
    one('ret|de|after', 'Development surplus after finance', de.profitAfterFinancing, (E) => `${E.d('ret|de|before')}-${E.d('ret|de|fin')}`, RF.money, { style: 'subtotal' });
    one('ret|de|margin', 'Development margin', de.developmentMargin ?? 'n/a', (E) => `IF(${E.d('ret|de|gdv')}>0,${E.d('ret|de|after')}/${E.d('ret|de|gdv')},"n/a")`, RF.pct);
    one('ret|de|ctv', 'Cost to value', de.costToValue ?? 'n/a', (E) => `IF(${E.d('ret|de|gdv')}>0,${E.d('ret|de|tdc')}/${E.d('ret|de|gdv')},"n/a")`, RF.pct);

    // Yield on cost and the development spread.
    head('ret|#yoc', 'Yield on cost and development spread');
    const heldIds = [...snap.perAssetPL.values()].filter((q) => q.strategy === 'Operate' || q.strategy === 'Lease').map((q) => q.assetId);
    const heldCost = m.yieldOnCost ? rs.stabilisedNOI / m.yieldOnCost : 0;
    // ONE ROW PER LINE, NAMED ONE WAY (2026-11-17, founder, step 7): "[Line], Phase N", never a plot
    // ("Land 3") and never the retired Asset.name. A line's plots add into its one row.
    const multiPhase = phases.length > 1;
    const heldLines: Array<{ label: string; ids: string[] }> = [];
    {
      const lines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels ?? [] });
      const byKey = new Map<string, { label: string; ids: string[] }>();
      for (const id of heldIds) {
        const line = lineOfAsset(lines, id);
        const key = line?.key ?? id;
        if (!byKey.has(key)) {
          const bare = line ? line.label.replace(new RegExp(`^${line.phaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*`), '') : id;
          const g = { label: line && multiPhase && line.phaseName ? `${bare}, ${line.phaseName}` : bare, ids: [] as string[] };
          byKey.set(key, g); heldLines.push(g);
        }
        byKey.get(key)!.ids.push(id);
      }
    }
    heldLines.forEach((g, i) => one(`rm|heldcost:${i}`, `Held cost, ${g.label}`, Math.max(0, g.ids.reduce((s, id) => s + (snap.perAssetCF.get(id)?.capexPerPeriod ?? []).reduce((a, b) => a + (b ?? 0), 0), 0)),
      (E) => { const ks = KEYS.cxc(E).filter((k) => g.ids.some((id) => k.startsWith(`cxc:${id}:`))); return ks.length ? `MAX(0,${ks.map((k) => `SUM(${E.xr(k)})`).join('+')})` : '0'; }, RF.money, { indent: 2 }));
    one('rm|heldcost', 'Held assets\' cost (hotel and lease lines, land included)', heldCost,
      (E) => heldLines.map((_g, i) => E.d(`rm|heldcost:${i}`)).join('+') || '0', RF.money, { indent: 1 });
    one('rm|yoc', 'Yield on cost (income capitalised over the held cost)', m.yieldOnCost ?? 'n/a', (E) => `IF(${E.d('rm|heldcost')}>0,${E.d('ret|x|inc')}/${E.d('rm|heldcost')},"n/a")`, RF.pct);
    one('rm|cap', 'Cap rate at exit', m.capRateAtExit ?? 'n/a', (E) => `IF(${E.d('ret|x|tv')}>0,${E.d('ret|x|inc')}/${E.d('ret|x|tv')},"n/a")`, RF.pct);
    one('rm|spread', 'Development spread (yield on cost less cap rate)', m.developmentSpread ?? 'n/a', (E) => `IF(AND(ISNUMBER(${E.d('rm|yoc')}),ISNUMBER(${E.d('rm|cap')})),${E.d('rm|yoc')}-${E.d('rm|cap')},"n/a")`, RF.pct);

    // Coverage by year, and the worst year against each covenant.
    head('ret|#cov', 'Debt cover by year');
    const opV = Array.from({ length: N }, (_, t) => (phases.some((ph) => { const tl = computePhaseTimeline(ph, p); const y = years[t]; return y >= new Date(tl.operationsStart).getUTCFullYear() && y <= new Date(tl.operationsEnd).getUTCFullYear(); }) ? 1 : 0));
    pRow('rm|op', 'Operating year (any phase operating)', [null, ...opV], (E, s) => (phases.every((ph) => E.has(`tl:flag:${ph.id}:ops`))
      ? `MIN(1,${phases.map((ph) => E.x(`tl:flag:${ph.id}:ops`, s)).join('+')})`
      : `IF(OR(${phases.map((ph) => `AND(${E.yr(s)}>=YEAR(${E.ref(`phase:${ph.id}:oStart`)}),${E.yr(s)}<=YEAR(${E.ref(`phase:${ph.id}:oEnd`)}))`).join(',')}),1,0)`), { total: 'none', fmt: RF.int });
    const dash = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
    const series = (metric: string): Array<number | null> => [null, ...covenantSeries(metric as never, covInputs).map((v) => dash(v as number | null))];
    pRow('rm|ds', 'Scheduled debt service (sweep excluded)', yearsToStream(rs.scheduledDebtServicePerPeriod), (E, s) => ['fnc:main:interest', 'fnc:main:sched', 'fnc:main:exitrepay'].filter((k) => E.has(k)).map((k) => E.loop(k, s)).join('+') || '0');
    const ebitdaKey = 'pl|__all__||EBITDA';
    const measured = (v: string): string => `IF(ABS(${v})<0.000000001,"-",${v})`;
    pRow('rm|dscr', 'DSCR', series('dscr'), (E, s) => `IF(AND(${E.s('rm|op', s)}=1,${E.s('rm|ds', s)}>0.000001),${measured(`${E.x(ebitdaKey, s)}/${E.s('rm|ds', s)}`)},"-")`, { nullAs: '-', total: 'none', fmt: RF.mult });
    pRow('rm|icr', 'Interest cover', series('icr'), (E, s) => `IF(ABS(${E.loop('fnc:main:intexp', s)})>0.000001,${measured(`${E.x(ebitdaKey, s)}/ABS(${E.loop('fnc:main:intexp', s)})`)},"-")`, { nullAs: '-', total: 'none', fmt: RF.mult });
    pRow('rm|dy', 'Debt yield', series('debt_yield'), (E, s) => `IF(AND(${E.s('rs|debt', s)}>0.000000001,${E.s('rs|noi', s)}>0.000000001),${E.s('rs|noi', s)}/${E.s('rs|debt', s)},"-")`, { nullAs: '-', total: 'none', fmt: RF.pct });
    pRow('rm|ltv', 'LTV (debt over the gross development value)', series('ltv'), (E, s) => `IF(AND(${E.d('ret|de|gdv')}>0.000000001,${E.s('rs|debt', s)}>0.000000001),${E.s('rs|debt', s)}/${E.d('ret|de|gdv')},"-")`, { nullAs: '-', total: 'none', fmt: RF.pct });
    // With no debt in any year, LTV is measured at the exit (debt over the exit value).
    one('rm|ltvexit', 'LTV at the exit (debt over the exit value)', m.ltvAtExit ?? '-', (E) => `IF(${E.d('ret|x|tv')}>0,${E.d('ret|x|debtX')}/${E.d('ret|x|tv')},"-")`, RF.pct, { indent: 1 });
    const covenants = p.covenants ?? DEFAULT_COVENANTS;
    const rowOf: Record<string, string> = { dscr: 'rm|dscr', icr: 'rm|icr', debt_yield: 'rm|dy', ltv: 'rm|ltv' };
    rows.push({ key: 'ret|#covcols', label: 'Covenant', kind: 'cols', cols: [[D, 'Threshold'], [D + 1, 'Worst year'], [D + 2, 'Pass or fail']] });
    covenants.forEach((cov, ci) => {
      const sr = rowOf[cov.metric];
      if (!sr) return;
      const ev = evaluateCovenant(cov, covInputs);
      const fmt = cov.metric === 'ltv' || cov.metric === 'debt_yield' ? RF.pct : RF.mult;
      const fn = cov.operator === 'min' ? 'MIN' : 'MAX';
      const key = `ret|cov|${ci}`;
      const worst = (E: REnv): string => (cov.metric === 'ltv' ? `IF(COUNT(${E.rngY(sr)})=0,${E.d('rm|ltvexit')},${fn}(${E.rngY(sr)}))` : `IF(COUNT(${E.rngY(sr)})=0,"-",${fn}(${E.rngY(sr)}))`);
      rows.push({ key, label: cov.label, kind: 'cells', cells: [
        { col: D, v: cov.threshold, fmt, f: (E) => E.ref(`retin:cov:${cov.label}`) },
        { col: D + 1, v: ev.worst ?? '-', fmt, f: worst },
        { col: D + 2, v: ev.pass == null ? 'n/a' : ev.pass ? 'Pass' : 'Fail', fmt: RF.text,
          f: (E) => `IF(ISNUMBER(${E.cell(key, D + 1)}),IF(${E.cell(key, D + 1)}${cov.operator === 'min' ? '>=' : '<='}${E.cell(key, D)},"Pass","Fail"),"n/a")` },
      ] });
    });

    // Peak equity: the largest equity invested to date.
    head('ret|#peq', 'Peak equity');
    const cumEq = (() => { let r = 0; const c = stream(bu.equityCashPerPeriod), k = stream(bu.equityInKindPerPeriod); return [null, ...Array.from({ length: N }, (_, t) => (r += -(c[t + 1] ?? 0) - (k[t + 1] ?? 0)))]; })();
    pRow('rm|cumeq', 'Cumulative equity invested', cumEq, (E, s) => `${s === 1 ? '0' : E.s('rm|cumeq', s - 1)}-${E.s('rs|dd:cash', s)}-${E.s('rs|dd:kind', s)}`, { total: 'last' });
    one('rm|peakeq', 'Peak equity', m.peakEquity, (E) => `MAX(0,MAX(${E.rngY('rm|cumeq')}))`, RF.money, { style: 'subtotal' });
  }
  return { rows, refused };
}

/** Registered keys the rules search, through the environment. */
const KEYS = {
  all: (E: REnv): string[] => E.keys(),
  cxc: (E: REnv): string[] => KEYS.all(E).filter((k) => k.startsWith('cxc:') && k.split(':').length === 3 && !k.startsWith('cxc:ph:')),
};
