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
import { resolveFundTerms, isFundManagerRow } from '../../fundTerms';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { buildDisposalWorking } from '../../reports/disposalReport';
import { buildOperatingKpis } from '../../reports/operatingKpis';
import { covenantSeries, reduceWorst, reduceAvg, evaluateCovenant, type CovenantInputs } from '../../covenants';
import { DEFAULT_COVENANTS, type CostLine, type Phase } from '../../state/module1-types';
import { isLandValueLine, computePhaseTimeline } from '@/src/core/calculations';
import { assetLabel } from '@/src/core/calculations/assetName';
import { defaultSensitivityValues } from '@/src/core/calculations/returns';
import { computeReturnsSensitivity } from '../../returns-resolvers';
import { STABILISATION_GROWTH_TOLERANCE } from '@/src/core/calculations/returns/analytics';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';

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
  const N = snap.axisLength;
  const p = state.project;
  const cfg = rs.config;
  const X = cfg.exitYearOffset;
  const booked = snap.disposal.booked;
  const fundOn = rs.waterfall.active;
  const rows: RetRow[] = [];
  const refused: string[] = [];
  const years = snap.yearLabels;
  const exitYear = years[X] ?? 0;
  const basisYear = cfg.terminalValueBasis === 'exit_year' ? exitYear : exitYear - 1;
  const M = Math.max(0, cfg.terminalValueBasis === 'exit_year' ? X : X - 1);

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

  // ════ ASSUMPTIONS (the Inputs cells, linked) ════════════════════════════
  section('ret|#section', 'Returns');
  head('ret|#assumptions', 'Returns assumptions (from Inputs)');
  one('ret|Discount Rate (%)', 'Discount rate', cfg.discountRate, undefined, RF.pct);
  one('ret|Exit Year', 'Exit year', exitYear, undefined, RF.year);
  const methodLabel: Record<string, string> = { exit_multiple: 'Exit Multiple', cap_rate: 'Exit Cap Rate', perpetuity: 'Perpetuity (Gordon)', none: 'None' };
  one('ret|Terminal Value Method', 'Terminal value method', methodLabel[cfg.terminalMethod] ?? cfg.terminalMethod, (E) => E.ref('ret:tvMethod'), RF.text);
  if (cfg.terminalMethod !== 'none') one('ret|Terminal value basis', 'Terminal value basis', cfg.terminalValueBasis === 'exit_year' ? 'Exit year' : 'Year before exit', (E) => E.ref('ret:tvBasis'), RF.text);
  if (cfg.terminalMethod === 'cap_rate') {
    const manual = cfg.capRateSource === 'manual';
    one('ret|Exit Cap Rate (%)', manual ? 'Exit cap rate' : 'Exit cap rate (discount rate less growth)', manual ? cfg.capRate : cfg.capRateDerived,
      manual ? undefined : (E) => `MAX(0,${E.ref('inp=ret|Discount Rate (%)@4')}-${E.ref('inp=ret|Growth g (%)@4')})`, RF.pct);
  }
  if (cfg.terminalMethod === 'exit_multiple') one('ret|Exit Multiple (x stabilised NOI)', 'Exit multiple', cfg.exitMultiple, undefined, RF.mult);
  if (cfg.terminalMethod === 'cap_rate' || cfg.terminalMethod === 'perpetuity') one('ret|Growth g (%)', 'Growth', cfg.perpetuityGrowth, undefined, RF.pct);
  if (cfg.terminalMethod !== 'none') one('ret|Terminal metric', 'Terminal metric', cfg.applyGrowthToTerminal ? 'Grown by (1 + g)' : 'As stated, not grown', (E) => E.ref('ret:tvMetric'), RF.text);
  one('ret|Basis year', 'Year the terminal value capitalises', basisYear, (E) => `${E.d('ret|Exit Year')}-IF(${E.d('ret|Terminal value basis')}="Exit year",0,1)`, RF.year);
  if (!booked) refused.push('no terminal value');
  if (cfg.terminalMethod !== 'cap_rate' && cfg.terminalMethod !== 'exit_multiple') refused.push(`a terminal value by ${cfg.terminalMethod}`);
  gap('ret|gap|a');

  // ════ THE STREAMS ═══════════════════════════════════════════════════════
  head('ret|#streams', 'Cash flow streams');
  pRow('rs|hold', 'In the hold (1 up to the exit year)', [null, ...hold], (E, s) => `IF(${E.yr(s)}<=${E.d('ret|Exit Year')},1,0)`, { total: 'none', fmt: RF.int });
  const H = (E: REnv, s: number): string => E.s('rs|hold', s);
  // The figures the streams read, every year as the source tab has them.
  pRow('rs|noi', 'Held assets\' income (NOI)', yearsToStream(rs.noiPerPeriod), (E, s) => E.loop('fnc:noi', s), { total: 'sum' });
  pRow('rs|debt', 'Debt outstanding', yearsToStream(snap.bs.debtOutstandingPerPeriod), (E, s) => E.x('bs|__all__||Debt (long-term)', s), { total: 'none' });
  pRow('rs|close', 'Closing cash', yearsToStream(snap.directCF.closingCashPerPeriod), (E, s) => E.x('cf|direct||Closing cash', s), { total: 'none' });
  const sweeps = snap.cashSweep?.enabled === true;
  one('rs|floor', 'Minimum cash reserve', Number(p.financing?.minimumCashReserve ?? snap.financing.funding.minCashReserve ?? 0), (E) => `MAX(0,${E.ref('fin:in:min')})`);
  pRow('rs|level', sweeps ? 'Cash held back (the minimum reserve and the sweep\'s claim)' : 'Cash held back (the minimum reserve)', [null, ...levelAll],
    (E, s) => `MIN(${E.d('rs|floor')},MAX(0,${E.s('rs|close', s)}))${sweeps ? `+MIN(MAX(0,MAX(0,${E.s('rs|close', s)})-${E.d('rs|floor')}),MAX(0,${E.s('rs|debt', s)}))` : ''}`, { total: 'none' });

  // FCFF.
  head('ret|#fcff', 'FCFF, unlevered project');
  pRow('rs|ff:cfo', 'Cash from operations', stream(bu.cfoPerPeriod), (E, s) => `${H(E, s)}*${E.x('cf|direct||Cash Flow from Operations', s)}`, { indent: 1 });
  pRow('rs|ff:capex', 'Capex paid in cash', stream(bu.cfiPerPeriod), (E, s) => `${H(E, s)}*${E.x('cf|direct||Total capex paid in cash', s)}`, { indent: 1 });
  pRow('rs|ff:kind', 'Land contributed in kind', stream(bu.inKindLandPerPeriod), (E, s) => `${H(E, s)}*${E.x('cf|direct||Land in kind (investing)', s)}`, { indent: 1 });
  pRow('rs|ff:pre', 'FCFF before the exit value', stream(bu.fcffSubtotalPerPeriod).map((v, s) => (s === 0 ? -(rs.buildup.existingPreCapexPerPeriod?.[0] ?? 0) : v)),
    (E, s) => (s === 0 ? `-${E.ref('retin:hist')}` : `SUM(${E.s('rs|ff:cfo', s)}:${E.s('rs|ff:kind', s)})`), { from: 0, style: 'subtotal' });
  pRow('rs|ff:tv', 'Terminal enterprise value (exit proceeds)', stream(bu.terminalEnterprisePerPeriod), (E, s) => E.loop('fnc:proceeds', s), { indent: 1 });
  pRow('rs|fcff', 'FCFF', stream(rs.fcffPerPeriod), (E, s) => `${E.s('rs|ff:pre', s)}+${E.s('rs|ff:tv', s)}`, { from: 0, style: 'total' });

  // FCFE.
  head('ret|#fcfe', 'FCFE, levered equity');
  pRow('rs|fe:debt', 'Net debt (drawn less principal repaid)', stream(bu.netDebtPerPeriod),
    (E, s) => `${H(E, s)}*(${E.loop('fnc:main:draw', s)}+${E.loop('fnc:main:idcdraw', s)}-${E.loop('fnc:main:repay', s)})`, { indent: 1 });
  pRow('rs|fe:int', 'Finance cost (the full accrued charge)', stream(bu.financeCostPerPeriod), (E, s) => `-${H(E, s)}*${E.loop('fnc:main:interest', s)}`, { indent: 1 });
  const retained = [null, ...Array.from({ length: N }, (_, t) => (t <= X ? -(trapped[t] ?? 0) : 0))];
  pRow('rs|fe:held', 'Cash held back this year', retained, (E, s) => `-${H(E, s)}*(${E.s('rs|level', s)}-${s === 1 ? '0' : E.s('rs|level', s - 1)})`, { indent: 1 });
  const fePre = stream(rs.fcfePerPeriod).map((v, s) => v - (bu.terminalEquityPerPeriod?.[s] ?? 0) - (s === X + 1 ? (level[X] ?? 0) : 0));
  pRow('rs|fe:pre', 'FCFE before the exit value', fePre,
    (E, s) => (s === 0 ? `-(${E.ref('retin:hist')}-${E.ref('retin:debt')})` : `${E.s('rs|ff:pre', s)}+SUM(${E.s('rs|fe:debt', s)}:${E.s('rs|fe:held', s)})`), { from: 0, style: 'subtotal' });
  pRow('rs|fe:tv', 'Exit equity value (terminal value less the debt at the exit)', stream(bu.terminalEquityPerPeriod),
    (E, s) => `${E.ex(s)}*MAX(0,${E.s('rs|ff:tv', s)}-MAX(0,${E.s('rs|debt', s)}))`, { indent: 1 });
  pRow('rs|fe:rel', 'Cash held back, released at the exit', [null, ...Array.from({ length: N }, (_, t) => (t === X ? (level[X] ?? 0) : 0))],
    (E, s) => `${E.ex(s)}*${E.s('rs|level', s)}`, { indent: 1 });
  pRow('rs|fcfe', 'FCFE', stream(rs.fcfePerPeriod), (E, s) => `${E.s('rs|fe:pre', s)}+${E.s('rs|fe:tv', s)}+${E.s('rs|fe:rel', s)}`, { from: 0, style: 'total' });

  // Distributions.
  head('ret|#ddm', fundOn ? 'Distributions to equity, before the performance fee' : 'Distributions to equity');
  pRow('rs|dd:cash', 'Cash equity invested', stream(bu.equityCashPerPeriod), (E, s) => `-${H(E, s)}*(${E.loop('fnc:main:equity', s)}+${E.loop('fnc:main:feedraw', s)})`, { indent: 1 });
  pRow('rs|dd:kind', 'Land contributed in kind', stream(bu.equityInKindPerPeriod), (E, s) => E.s('rs|ff:kind', s), { indent: 1 });
  pRow('rs|dd:div', 'Dividends paid', stream(bu.dividendsDistributedPerPeriod), (E, s) => `${H(E, s)}*${E.loop('fnc:main:div', s)}`, { indent: 1 });
  pRow('rs|dd:tv', 'Exit equity not already paid as a dividend', stream(bu.terminalEquityDistributedPerPeriod),
    (E, s) => `IF(${E.ref('fin:in:divOn')}=1,0,${E.s('rs|fe:tv', s)})`, { indent: 1 });
  pRow('rs|ddm', 'Distributions, net cash flow to equity', stream(rs.dividendStreamPerPeriod),
    (E, s) => (s === 0 ? `-(${E.ref('retin:hist')}-${E.ref('retin:debt')})` : `SUM(${E.s('rs|dd:cash', s)}:${E.s('rs|dd:tv', s)})`), { from: 0, style: 'total' });
  pRow('rs|cumfe', 'Cumulative FCFE', (() => { let r = 0; return stream(rs.fcfePerPeriod).map((v) => (r += v)); })(),
    (E, s) => (s === 0 ? E.s('rs|fcfe', 0) : `${E.s('rs|cumfe', s - 1)}+${E.s('rs|fcfe', s)}`), { from: 0, total: 'none' });

  // The performance fee waterfall (fund layer).
  if (fundOn) {
    const w = rs.waterfall;
    const W = (a: readonly number[]): number[] => stream(a);
    const unpaid = W(w.unpaidHurdlePerPeriod);
    head('ret|#wf', 'Performance fee (the hurdle waterfall)');
    const h = (E: REnv): string => `MAX(0,${E.ref('ft:Hurdle rate (preferred return)')})`;
    const pf = (E: REnv): string => `MAX(0,MIN(1,${E.ref('ft:Performance fee on the excess')}))`;
    pRow('rs|wf:drawn', 'Equity drawn', W(w.equityDrawnPerPeriod),
      (E, s) => (s === 0 ? `MAX(0,${E.ref('retin:hist')}-${E.ref('retin:debt')})` : `MAX(0,-(${E.s('rs|dd:cash', s)}+${E.s('rs|dd:kind', s)}))+MAX(0,-${E.s('rs|dd:div', s)})`), { from: 0, indent: 1 });
    pRow('rs|wf:gross', 'Distributions before the fee', W(w.distributionPerPeriod),
      (E, s) => (s === 0 ? '0' : `MAX(0,${E.s('rs|dd:div', s)})+MAX(0,${E.s('rs|dd:cash', s)}+${E.s('rs|dd:kind', s)})+MAX(0,${E.s('rs|dd:tv', s)})`), { from: 0, indent: 1 });
    pRow('rs|wf:bop', 'Unpaid hurdle, opening', unpaid.map((_, s) => (s === 0 ? 0 : unpaid[s - 1] ?? 0)), (E, s) => (s === 0 ? '0' : E.s('rs|wf:eop', s - 1)), { from: 0, indent: 1, total: 'none' });
    pRow('rs|wf:acc', 'Hurdle accrued', W(w.hurdleAccruedPerPeriod), (E, s) => `(${E.s('rs|wf:bop', s)}+${E.s('rs|wf:drawn', s)})*${h(E)}`, { from: 0, indent: 1 });
    pRow('rs|wf:owed', 'Hurdle owed', W(w.totalHurdleOwedPerPeriod), (E, s) => `${E.s('rs|wf:drawn', s)}+${E.s('rs|wf:bop', s)}+${E.s('rs|wf:acc', s)}`, { from: 0, indent: 1, total: 'none' });
    pRow('rs|wf:paid', 'Hurdle paid', W(w.hurdlePaidPerPeriod), (E, s) => `MIN(${E.s('rs|wf:gross', s)},${E.s('rs|wf:owed', s)})`, { from: 0, indent: 1 });
    pRow('rs|wf:eop', 'Unpaid hurdle, closing', unpaid, (E, s) => `${E.s('rs|wf:owed', s)}-${E.s('rs|wf:paid', s)}`, { from: 0, indent: 1, total: 'last' });
    pRow('rs|wf:excess', 'Distributions above the hurdle', W(w.excessDistributionsPerPeriod), (E, s) => `${E.s('rs|wf:gross', s)}-${E.s('rs|wf:paid', s)}`, { from: 0, indent: 1 });
    pRow('rs|wf:fee', 'Performance fee', W(w.performanceFeePerPeriod), (E, s) => `${E.s('rs|wf:excess', s)}*${pf(E)}`, { from: 0, indent: 1 });
    pRow('rs|wf:net', 'Distributions net of the fee', W(w.netDistributionPerPeriod), (E, s) => `${E.s('rs|wf:gross', s)}-${E.s('rs|wf:fee', s)}`, { from: 0, indent: 1 });
    pRow('rs|ddmnet', 'Distributions net of the fee, net cash flow to equity', W(rs.netDividendStreamPerPeriod),
      (E, s) => `${E.s('rs|wf:net', s)}-${E.s('rs|wf:drawn', s)}`, { from: 0, style: 'total' });
  }
  gap('ret|gap|b');

  // ════ HEADLINE RETURNS: each stream's IRR, MOIC and NPV, computed once ══
  head('ret|#headline', 'Returns by stream');
  rows.push({ key: 'ret|#headcols', label: 'Stream', kind: 'cols', cols: [[D, 'IRR'], [D + 1, 'MOIC'], [D + 2, 'NPV'], [D + 3, 'Invested'], [D + 4, 'Returned'], [D + 5, 'Net']] });
  const rate = (E: REnv): string => E.ref('inp=ret|Discount Rate (%)@4');
  const headline = (key: string, label: string, src: string, r: RS['result']['fcff']): void => {
    const rng = (E: REnv): string => E.rng(src);
    rows.push({ key, label, kind: 'cells', cells: [
      { col: D, v: irrNum(r.irr), fmt: RF.pct, f: (E) => `IFERROR(IRR(${rng(E)},0.1),"n/a")`, bold: true },
      { col: D + 1, v: r.moic, fmt: RF.mult, f: (E) => `IF(-SUMIF(${rng(E)},"<0")>0,SUMIF(${rng(E)},">0")/-SUMIF(${rng(E)},"<0"),0)` },
      { col: D + 2, v: r.npv, fmt: RF.money, f: (E) => `${E.sA(src, 0)}+NPV(${rate(E)},${E.rngFrom(src, 1)})` },
      { col: D + 3, v: r.totalOutflow, fmt: RF.money, f: (E) => `-SUMIF(${rng(E)},"<0")` },
      { col: D + 4, v: r.totalInflow, fmt: RF.money, f: (E) => `SUMIF(${rng(E)},">0")` },
      { col: D + 5, v: r.netProfit, fmt: RF.money, f: (E) => `SUM(${rng(E)})` },
    ] });
  };
  headline('ret|h|fcff', 'Project (FCFF)', 'rs|fcff', rs.result.fcff);
  headline('ret|h|fcfe', 'Equity (FCFE)', 'rs|fcfe', rs.result.fcfe);
  headline('ret|h|ddm', fundOn ? 'Distributions, before the performance fee' : 'Distributions', 'rs|ddm', rs.result.dividends);
  if (fundOn) headline('ret|h|net', 'Distributions, net of the performance fee', 'rs|ddmnet', rs.resultNetDividends);
  gap('ret|gap|c');

  // ════ EQUITY PARTNERS ═══════════════════════════════════════════════════
  {
    const ps = rs.partners;
    const partners = (p.partners ?? []).length ? (p.partners ?? []) : [{ id: 'sponsor', name: 'Sponsor', cashPct: 100, inKindPct: 100, existingPct: 100 }];
    const n = partners.length;
    const pc = (j: number): number => D + 1 + j;
    head('ret|#partners', 'Equity partners');
    rows.push({ key: 'ret|#pcols', label: 'Equity type', kind: 'cols', cols: [[D, 'Total'], ...partners.map((q, j) => [pc(j), q.name] as [number, string])] });
    const pctOf = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) / 100 : 0);
    const cashT = sumOf(stream(bu.equityCashPerPeriod).map((v) => -v)), kindT = sumOf(stream(bu.equityInKindPerPeriod).map((v) => -v));
    const exT = snap.financing.equity.totalExisting;
    const typeRows: Array<[string, string, number, string, (q: typeof partners[number]) => number, Fx]> = [
      ['cash', 'New cash equity', cashT, 'cash', (q) => pctOf(q.cashPct), (E) => `-SUM(${E.rngY('rs|dd:cash')})`],
      ['kind', 'In-kind equity (land)', kindT, 'kind', (q) => pctOf(q.inKindPct), (E) => `-SUM(${E.rngY('rs|dd:kind')})`],
      ['ex', 'Existing equity', exT, 'ex', (q) => pctOf(q.existingPct), (E) => E.ref('retin:equity')],
    ];
    for (const [id, label, tot, sfx, share, ft] of typeRows) {
      rows.push({ key: `ret|pt|${id}`, label, kind: 'cells', cells: [{ col: D, v: tot, fmt: RF.money, f: ft },
        ...partners.map((q, j) => ({ col: pc(j), v: tot * share(q), fmt: RF.money, f: (E: REnv) => `${E.cell(`ret|pt|${id}`, D)}*${E.cell(`ret|pt|${id}:share`, pc(j))}` }))] });
      rows.push({ key: `ret|pt|${id}:share`, label: 'Share', kind: 'cells', indent: 1, cells: partners.map((q, j) => ({ col: pc(j), v: share(q), fmt: RF.pct,
        f: (E: REnv) => `MAX(0,MIN(1,${E.ref(`retin:share:${sfx}:${j}`)}))` })) });
    }
    const investedJ = partners.map((q) => cashT * pctOf(q.cashPct) + kindT * pctOf(q.inKindPct) + exT * pctOf(q.existingPct));
    rows.push({ key: 'ret|pt|inv', label: 'Total invested', kind: 'cells', style: 'subtotal', cells: [{ col: D, v: cashT + kindT + exT, fmt: RF.money, f: (E) => `SUM(${E.cell('ret|pt|cash', D)},${E.cell('ret|pt|kind', D)},${E.cell('ret|pt|ex', D)})` },
      ...partners.map((_q, j) => ({ col: pc(j), v: investedJ[j], fmt: RF.money, f: (E: REnv) => `SUM(${E.cell('ret|pt|cash', pc(j))},${E.cell('ret|pt|kind', pc(j))},${E.cell('ret|pt|ex', pc(j))})` }))] });
    // Capital-years: each year's equity in, by the years it is held to the end of the axis.
    const cashS = stream(bu.equityCashPerPeriod), kindS = stream(bu.equityInKindPerPeriod);
    const cy = (a: number[]): number => a.reduce((s2, v, s) => s2 + (s === 0 ? 0 : -v * (N - (s - 1))), 0);
    const cyC = cy(cashS), cyK = cy(kindS);
    const cyJ = partners.map((q) => (cashT > 0 ? pctOf(q.cashPct) : 0) * cyC + (kindT > 0 ? pctOf(q.inKindPct) : 0) * cyK);
    const cyRow = (E: REnv, key: string): string => `-SUMPRODUCT(${E.rngY(key)},${N}+1-(COLUMN(${E.rngY(key)})-COLUMN(${E.sA(key, 1)})+1))`;
    rows.push({ key: 'ret|pt|cy', label: 'Capital-years (each amount x the years it is held)', kind: 'cells', cells: [{ col: D, v: sumOf(cyJ), fmt: RF.money, f: (E) => `SUM(${partners.map((_q, j) => E.cell('ret|pt|cy', pc(j))).join(',')})` },
      ...partners.map((_q, j) => ({ col: pc(j), v: cyJ[j], fmt: RF.money,
        f: (E: REnv) => `IF(${E.cell('ret|pt|cash', D)}>0,${E.cell('ret|pt|cash:share', pc(j))},0)*${cyRow(E, 'rs|dd:cash')}+IF(${E.cell('ret|pt|kind', D)}>0,${E.cell('ret|pt|kind:share', pc(j))},0)*${cyRow(E, 'rs|dd:kind')}` }))] });
    rows.push({ key: 'ret|pt|tw', label: 'Time-weighted share', kind: 'cells', cells: partners.map((_q, j) => ({ col: pc(j), v: ps.partners[j]?.weightedAvgShareholdingPct ?? 0, fmt: RF.pct,
      f: (E: REnv) => `IF(${E.cell('ret|pt|cy', D)}>0,${E.cell('ret|pt|cy', pc(j))}/${E.cell('ret|pt|cy', D)},IF(${E.cell('ret|pt|inv', D)}>0,${E.cell('ret|pt|inv', pc(j))}/${E.cell('ret|pt|inv', D)},0))` })) });
    rows.push({ key: 'ret|pt|share', label: 'Share used (the agreed share where one is typed)', kind: 'cells', style: 'subtotal', cells: partners.map((_q, j) => ({ col: pc(j), v: ps.partners[j]?.shareholdingPct ?? 0, fmt: RF.pct,
      f: (E: REnv) => { const a = E.ref(`retin:agreed:${j}`); return `IF(ISNUMBER(${a}),MAX(0,${a}),${E.cell('ret|pt|tw', pc(j))})`; } })) });
    // Each partner's streams: the share x the stream.
    head('ret|#pstreams', 'Each partner\'s streams');
    ps.partners.forEach((q, j) => {
      pRow(`rs|pfe:${j}`, `${q.name}: FCFE`, stream(q.fcfeStream), (E, s) => `${E.cell('ret|pt|share', pc(j))}*${E.s('rs|fcfe', s)}`, { from: 0, indent: 1 });
      pRow(`rs|pdd:${j}`, `${q.name}: distributions`, stream(q.cashFlowStream), (E, s) => `${E.cell('ret|pt|share', pc(j))}*${E.s('rs|ddm', s)}`, { from: 0, indent: 1 });
    });
    rows.push({ key: 'ret|#prcols', label: 'Partner', kind: 'cols', cols: [[D, 'Invested'], [D + 1, 'Share'], [D + 2, 'FCFE IRR'], [D + 3, 'FCFE MOIC'], [D + 4, 'Distribution IRR'], [D + 5, 'Distribution MOIC'], [D + 6, 'Distributions']] });
    ps.partners.forEach((q, j) => {
      const irr = (k: string): Fx => (E) => `IFERROR(IRR(${E.rng(k)},0.1),"n/a")`;
      const moic = (k: string): Fx => (E) => `IF(-SUMIF(${E.rng(k)},"<0")>0,SUMIF(${E.rng(k)},">0")/-SUMIF(${E.rng(k)},"<0"),0)`;
      rows.push({ key: `ret|pr|${j}`, label: q.name, kind: 'cells', cells: [
        { col: D, v: investedJ[j], fmt: RF.money, f: (E) => E.cell('ret|pt|inv', pc(j)) },
        { col: D + 1, v: q.shareholdingPct, fmt: RF.pct, f: (E) => E.cell('ret|pt|share', pc(j)) },
        { col: D + 2, v: irrNum(q.fcfeIrr), fmt: RF.pct, f: irr(`rs|pfe:${j}`) },
        { col: D + 3, v: q.fcfeMoic, fmt: RF.mult, f: moic(`rs|pfe:${j}`) },
        { col: D + 4, v: irrNum(q.irr), fmt: RF.pct, f: irr(`rs|pdd:${j}`) },
        { col: D + 5, v: q.moic, fmt: RF.mult, f: moic(`rs|pdd:${j}`) },
        { col: D + 6, v: sumOf(stream(q.cashFlowStream).map((v) => Math.max(0, v))), fmt: RF.money, f: (E) => `SUMIF(${E.rng(`rs|pdd:${j}`)},">0")` },
      ] });
    });
    void n;
  }
  gap('ret|gap|d');

  // ════ FUND FEE INCOME (fund layer) ══════════════════════════════════════
  if (fundOn && rs.feeEarners.active) {
    const terms = resolveFundTerms(p);
    head('ret|#fees', 'Fund fee income by year');
    const lines = snap.fundFees.lines;
    lines.forEach((l, i) => pRow(`rs|fee:${i}`, l.label, yearsToStream(snap.fundFees.lines[i]?.amountPerPeriod ?? []), (E, s) => E.loop(`fnc:fee:${i}`, s), { indent: 1 }));
    const mg = yearsToStream(rs.feeEarners.managementFeePerPeriod.slice(1));
    pRow('rs|fee:mgmt', 'Management fees', mg, (E, s) => `SUM(${E.s('rs|fee:0', s)}:${E.s(`rs|fee:${lines.length - 1}`, s)})`, { style: 'subtotal' });
    pRow('rs|fee:perf', 'Performance fee', stream(rs.waterfall.performanceFeePerPeriod).map((v, s) => (s === 0 ? null : v)), (E, s) => E.s('rs|wf:fee', s), { indent: 1 });
    pRow('rs|fee:all', 'Total fee income', [null, ...Array.from({ length: N }, (_, t) => (mg[t + 1] ?? 0) + (rs.waterfall.performanceFeePerPeriod[t + 1] ?? 0))],
      (E, s) => `${E.s('rs|fee:mgmt', s)}+${E.s('rs|fee:perf', s)}`, { style: 'total' });
    // Who earns them: the Fund Manager takes the management fees; the performance fee follows the
    // shares typed on Inputs (an empty column is the manager's by default).
    head('ret|#earners', 'Fee income by earner');
    rows.push({ key: 'ret|#ecols', label: 'Earner', kind: 'cols', cols: [[D, 'Management fees'], [D + 1, 'Performance fee'], [D + 2, 'Total']] });
    const matrix = terms.feeDistribution ?? [];
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
        { col: D, v: e.totalManagementFeeIncome, fmt: RF.money, f: (E) => (e.managementFeeShare > 0 ? `SUM(${E.rngY('rs|fee:mgmt')})` : '0') },
        { col: D + 1, v: e.totalPerformanceFeeIncome, fmt: RF.money, f: (E) => `(${shareF(e)(E)})*SUM(${E.rngY('rs|fee:perf')})` },
        { col: D + 2, v: e.totalFeeIncome, fmt: RF.money, f: (E) => `${E.cell(`ret|fe|${k}`, D)}+${E.cell(`ret|fe|${k}`, D + 1)}` },
      ] });
    });
    rows.push({ key: 'ret|fe|un', label: 'Performance fee no earner takes', kind: 'cells', cells: [
      { col: D + 1, v: fe.unallocatedPerformanceFee, fmt: RF.money, f: (E) => `MAX(0,SUM(${E.rngY('rs|fee:perf')})-SUM(${fe.earners.map((_e, k) => E.cell(`ret|fe|${k}`, D + 1)).join(',')}))` },
      { col: D + 2, v: fe.unallocatedPerformanceFee, fmt: RF.money, f: (E) => E.cell('ret|fe|un', D + 1) },
    ] });
    rows.push({ key: 'ret|fe|tot', label: 'Total', kind: 'cells', style: 'subtotal', cells: [D, D + 1, D + 2].map((c, i) => ({ col: c,
      v: [fe.totalManagementFee, fe.totalPerformanceFee, fe.totalManagementFee + fe.totalPerformanceFee][i], fmt: RF.money,
      // THE TOTAL IS THE FEE CHARGED (2026-11-03), as the platform states it: with shares typed over
      // 100% the earners' rows add to more than the fund pays, and the total must not follow them.
      f: (E: REnv) => [`SUM(${E.rngY('rs|fee:mgmt')})`, `SUM(${E.rngY('rs|fee:perf')})`, `${E.cell('ret|fe|tot', D)}+${E.cell('ret|fe|tot', D + 1)}`][i] })) });
    gap('ret|gap|e');
  }

  // ════ SOURCES AND USES, OVER CONSTRUCTION ═══════════════════════════════
  // The cash in and out from the model start to the last year any capex is spent (the engine's
  // sourcesUses), each a sum of the Cash Flow over that window, so the totals meet with no balancing row.
  {
    const su = rs.sourcesUses;
    head('ret|#su', 'Sources and uses of capital, over construction');
    const L = years.indexOf(su.constructionEndYear);
    pRow('rs|con', 'In the construction window (1 up to the last capex year)', [null, ...Array.from({ length: N }, (_, t) => (t <= L ? 1 : 0))],
      (E, s) => `IF(${E.yr(s)}<=${E.d('ret|su|end')},1,0)`, { total: 'none', fmt: RF.int });
    // NO ARRAY FORMULA (2026-11-04, founder): MAX(INDEX(...,0)) read #VALUE! outside Excel. A 1/0 row says
    // which years spend capex (cash or in kind), and the end is the largest of that row times the year.
    const capexOn = [null, ...Array.from({ length: N }, (_, t) => (Math.abs(stream(bu.cfiPerPeriod)[t + 1] ?? 0) + Math.abs(stream(bu.inKindLandPerPeriod)[t + 1] ?? 0) > 0.5 ? 1 : 0))];
    pRow('rs|cxon', 'Capex spent (1 = yes)', capexOn, (E, s) => `IF(ABS(${E.s('rs|ff:capex', s)})+ABS(${E.s('rs|ff:kind', s)})>0.5,1,0)`, { total: 'none', fmt: RF.int });
    one('ret|su|end', 'Construction window ends (the last capex year)', su.constructionEndYear,
      (E) => `SUMPRODUCT(MAX(${E.rngY('rs|cxon')}*${E.yrRng()}))`, RF.year);
    const win = (E: REnv, key: string): string => `SUMPRODUCT(${E.rngY('rs|con')},${E.xr(key)})`;
    const cf = (k: string): string => `cf|direct||${k}`;
    const escKeys = (E: REnv): string[] => [cf('Escrow: cash held'), cf('Escrow: cash released')].filter((k) => E.has(k));
    const collected = (E: REnv): string => [cf('Total cash collected'), ...escKeys(E)].map((k) => win(E, k)).join('+');
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, p);
    void lines; void lineForAsset;
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const visibleIds = new Set(state.assets.filter((a) => a.visible !== false).map((a) => a.id));
    const landKeysOf = (E: REnv): string[] => KEYS.cxc(E).filter((k) => visibleIds.has(k.split(':')[1]) && isLandValueLine(costLineOf(k.split(':')[2])));
    const src: Array<[string, string, number, Fx]> = [
      ['ret|Existing Equity', 'Existing equity', su.existingEquity, (E) => E.ref('retin:equity')],
      ['ret|New Equity (cash)', 'Cash equity', su.newEquityCash, (E) => win(E, cf('Equity drawn in cash'))],
      ['ret|In-Kind Equity (land)', 'Land contributed in kind', su.inKindEquity, (E) => win(E, cf('Land contributed in kind'))],
      ['ret|Existing Debt', 'Existing debt', su.existingDebt, (E) => E.ref('retin:debt')],
      ['ret|su|debtCapex', 'Debt drawn for capex', su.newDebtCapex, (E) => `${win(E, cf('Debt drawn'))}-${win(E, 'fnc:main:idcdraw')}`],
      ['ret|su|debtInt', 'Debt drawn for capitalised interest', su.newDebtInterest, (E) => win(E, 'fnc:main:idcdraw')],
      ['ret|su|open', 'Cash held at the model start', su.openingCash, (E) => E.xA(cf('Opening cash'), 1)],
      ['ret|Customer Collections / Pre-Sales', 'Customer collections during construction (net of escrow)', su.customerCollections, collected],
      ['ret|su|proceeds', 'Disposal proceeds during construction', su.disposalProceeds, (E) => win(E, cf('Proceeds from Disposal of Operating Assets'))],
    ];
    for (const [k, label, v, f] of src) one(k, label, v, f, RF.money, { indent: 1 });
    one('ret|Total Sources', 'Total sources', su.totalSources, (E) => `SUM(${E.d(src[0][0])}:${E.d(src[src.length - 1][0])})`, RF.money, { style: 'subtotal' });
    const use: Array<[string, string, number, Fx]> = [
      ['ret|su|existing', 'Development in place at the model start', su.existingInvestment, (E) => E.ref('retin:hist')],
      ['ret|Land', 'Land (cash and in kind)', su.land, (E) => landKeysOf(E).map((k) => `SUM(${E.xr(k)})`).join('+') || '0'],
      ['ret|Construction & Infrastructure', 'Construction', su.construction, (E) => `SUM(${E.xr('fnc:capexall')})-${E.d('ret|Land')}`],
      ['ret|su|interest', 'Interest paid during construction', su.interestPaid, (E) => `-${win(E, cf('Interest paid'))}`],
      ['ret|su|opcost', 'Operating costs paid during construction', su.operatingCosts, (E) => `${collected(E)}-${win(E, cf('Cash Flow from Operations'))}`],
      ['ret|su|repaid', 'Debt repaid during construction', su.debtRepaid, (E) => `-${win(E, cf('Debt repaid'))}`],
      ['ret|su|dist', 'Distributions during construction', su.distributions, (E) => `-${win(E, cf('Dividends paid'))}`],
      ['ret|su|held', 'Cash held at the end of construction', su.cashHeldAtEnd, (E) => `SUMPRODUCT((${E.yrRng()}=${E.d('ret|su|end')})*${E.xr(cf('Closing cash'))})`],
    ];
    for (const [k, label, v, f] of use) one(k, label, v, f, RF.money, { indent: 1 });
    one('ret|Total Uses', 'Total uses', su.totalUses, (E) => `SUM(${E.d(use[0][0])}:${E.d(use[use.length - 1][0])})`, RF.money, { style: 'subtotal' });
    one('ret|S&U check', 'Sources less uses (should be zero)', su.totalSources - su.totalUses, (E) => `${E.d('ret|Total Sources')}-${E.d('ret|Total Uses')}`);
    gap('ret|gap|f');
  }

  // ════ DEVELOPMENT ECONOMICS ═════════════════════════════════════════════
  {
    const de = rs.developmentEconomics;
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
    gap('ret|gap|g');
  }

  // ════ THE EXIT ══════════════════════════════════════════════════════════
  {
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const rl = planReportLines(lineState);
    const labelOf = (id: string): string => { const a = state.assets.find((x) => x.id === id); return a ? assetLabel(a, { parcels: state.parcels, phases: state.phases }) : id; };
    const groupOf = (id: string): { key: string; label: string } | undefined => { const l = rl.find((x) => x.assetIds.includes(id)); return l ? { key: l.key, label: lineTitle(l, lineState) } : undefined; };
    const dw = buildDisposalWorking(snap, rs, labelOf, groupOf);
    const d = snap.disposal;
    const val = (label: string): number => Number(dw.rows.find((r) => r.label === label)?.value ?? 0);
    const atBasis = (E: REnv, rng: string): string => `SUMPRODUCT((${E.yrRng()}=${E.d('ret|Basis year')})*${rng})`;
    const atExit = (E: REnv, rng: string): string => `SUMPRODUCT(${E.exRng()},${rng})`;
    head('ret|#exit', 'The exit: terminal value and gain on disposal');
    const hospKeys = ['pl|__all__||Hospitality Revenue', 'pl|__all__||Hospitality operating expenses'];
    const hospV = (snap.pl.hospitalityRevenuePerPeriod[M] ?? 0) - (snap.pl.hospitalityOpexPerPeriod[M] ?? 0);
    one('ret|x|hosp', 'Hospitality EBITDA in that year', hospV, (E) => hospKeys.filter((k) => E.has(k)).map((k) => atBasis(E, E.xr(k))).join('+') || '0', RF.money, { indent: 1 });
    one('ret|x|retail', 'Retail NOI in that year', d.exitMetric - hospV, (E) => `${E.d('ret|x|inc')}-${E.d('ret|x|hosp')}`, RF.money, { indent: 1 });
    one('ret|x|inc', 'Income capitalised', d.exitMetric, (E) => atBasis(E, E.rngY('rs|noi')), RF.money, { style: 'subtotal' });
    one('ret|x|tv', 'Terminal value, booked as proceeds from disposal', d.proceeds, (E) => `SUM(${E.rngY('rs|ff:tv')})`, RF.money, { style: 'total' });
    // Net book value disposed: each held line, then the project as their sum.
    rows.push({ key: 'ret|#nbvcols', label: 'Net book value disposed, by held line', kind: 'cols', cols: [[D, 'Building'], [D + 1, 'Land'], [D + 2, 'Capitalised interest'], [D + 3, 'Total']] });
    const lineRows: string[] = [];
    const idcDisp = (E: REnv, base: string): string => (E.has(`schv:${base}:idcNbv`)
      ? `MAX(0,SUMPRODUCT(${E.exRng()},${rangePrev(E, `schv:${base}:idcNbv`)}+${E.xr(`schv:${base}:idcAdd`)}-${E.xr(`schv:${base}:idcDep`)}))` : '0');
    for (const l of rl) {
      const host = l.assetIds.find((id) => d.byAsset.some((a) => a.assetId === id));
      const pooled = dw.byAsset.find((a) => a.label === lineTitle(l, lineState));
      if (!host || !pooled) continue;
      const key = `ret|nbv|${l.key}`;
      lineRows.push(key);
      const hostOf = (E: REnv): string => l.assetIds.find((id) => E.has(`schv:${id}:close`)) ?? host;
      rows.push({ key, label: pooled.label, kind: 'cells', indent: 1, cells: [
        { col: D, v: pooled.building, fmt: RF.money, f: (E) => `${E.has(`schv:${hostOf(E)}:disp`) ? `-SUM(${E.xr(`schv:${hostOf(E)}:disp`)})` : '0'}-${E.cell(key, D + 2)}` },
        { col: D + 1, v: pooled.land, fmt: RF.money, f: (E) => (E.has(`schv:${hostOf(E)}:landDisp`) ? `-SUM(${E.xr(`schv:${hostOf(E)}:landDisp`)})` : '0') },
        { col: D + 2, v: pooled.capitalisedInterest, fmt: RF.money, f: (E) => idcDisp(E, hostOf(E)) },
        { col: D + 3, v: pooled.total, fmt: RF.money, f: (E) => `SUM(${E.cell(key, D)}:${E.cell(key, D + 2)})` },
      ] });
    }
    rows.push({ key: 'ret|nbv|tot', label: 'Total net book value disposed', kind: 'cells', style: 'subtotal', cells: [0, 1, 2, 3].map((i) => ({ col: D + i,
      v: [d.netBookValue.building, d.netBookValue.land, d.netBookValue.capitalisedInterest, d.netBookValue.total][i], fmt: RF.money,
      f: (E: REnv) => (lineRows.length ? `SUM(${E.cell(lineRows[0], D + i)}:${E.cell(lineRows[lineRows.length - 1], D + i)})` : '0') })) });
    one('ret|x|gain', 'Gain or loss on disposal (proceeds less the net book value)', d.gain, (E) => `${E.d('ret|x|tv')}-${E.cell('ret|nbv|tot', D + 3)}`, RF.money, { style: 'subtotal' });
    if (d.gainTaxed) {
      if ((p.tax?.basis ?? 'zakat') === 'cit') refused.push('tax on the disposal gain on the corporate income tax basis');
      one('ret|x|gaintax', 'Zakat charged on the gain', val('Zakat charged on the gain'),
        (E) => `-(${atExit(E, E.xr('fl:tax'))}-MAX(0,${atExit(E, E.xr('fl:taxable'))}-${E.d('ret|x|gain')})*MAX(0,${E.ref('project:taxRate')}))`, RF.money, { indent: 1 });
    }
    one('ret|x|repaid', 'Debt repaid from the proceeds', val('Debt repaid from the proceeds'), (E) => `-SUM(${E.xr('fnc:main:exitrepay')})`, RF.money, { indent: 1 });
    one('ret|x|left', 'Proceeds left after the debt', val('Proceeds left after debt'), (E) => `${E.d('ret|x|tv')}+${E.d('ret|x|repaid')}`, RF.money, { style: 'subtotal' });
    one('ret|x|debtX', 'Debt at the exit (after its repayment)', Math.max(0, snap.bs.debtOutstandingPerPeriod[X] ?? 0), (E) => `MAX(0,${atExit(E, E.rngY('rs|debt'))})`, RF.money, { indent: 1 });
    one('ret|x|heldX', 'Cash held back at the exit', level[X] ?? 0, (E) => atExit(E, E.rngY('rs|level')), RF.money, { indent: 1 });
    // Every booking against this working.
    const plGain = val('P&L: Gain on Disposal of Operating Assets'), cfProc = val('Cash flow: Proceeds from Disposal of Operating Assets'), faX = val('Balance sheet: fixed assets after the exit');
    one('ret|x|pl', 'P&L: gain on disposal', plGain, (E) => `SUM(${E.xr('pl|__all__||Gain on Disposal of Operating Assets')})`, RF.money, { indent: 1 });
    one('ret|x|cf', 'Cash flow: disposal proceeds', cfProc, (E) => `SUM(${E.xr('cf|direct||Proceeds from Disposal of Operating Assets')})`, RF.money, { indent: 1 });
    one('ret|x|bs', 'Balance sheet: fixed assets after the exit', faX, (E) => atExit(E, E.xr('bs|__all__||Total Fixed Assets')), RF.money, { indent: 1 });
    one('ret|x|check', 'Check: every booking against this working (should be zero)', Math.abs(plGain - d.gain) + Math.abs(cfProc - d.proceeds) + Math.abs(faX),
      (E) => `ABS(${E.d('ret|x|pl')}-${E.d('ret|x|gain')})+ABS(${E.d('ret|x|cf')}-${E.d('ret|x|tv')})+ABS(${E.d('ret|x|bs')})`);
    gap('ret|gap|h');
  }

  // ════ SENSITIVITY: EQUITY IRR ═══════════════════════════════════════════
  if (opts.includeSensitivity) {
    const ys = defaultSensitivityValues('sales_price_pct', cfg.discountRate);
    const xs = defaultSensitivityValues('exit_cap_rate', cfg.discountRate);
    let grid: ReturnType<typeof computeReturnsSensitivity> | null = null;
    try { grid = computeReturnsSensitivity(snap, p, 'exit_cap_rate', 'sales_price_pct'); } catch { grid = null; }
    if (!grid) refused.push('the sensitivity grid could not be computed');
    head('ret|#sens', 'Sensitivity: equity IRR (FCFE) by operating cash flow and exit cap rate');
    const g = cfg.applyGrowthToTerminal;
    // One FCFE stream per case: the base before the exit value, the operating cash scaled, and the
    // exit equity at that case's income and cap rate plus the cash released.
    ys.forEach((yv, i) => xs.forEach((xv, j) => {
      const key = `rs|sens:${i}:${j}`;
      const vals = (() => {
        const shocked = stream(rs.fcfePerPeriod).map((_v, s) => {
          if (s === 0) return fePre[0];
          const t = s - 1;
          const cfo = stream(bu.cfoPerPeriod)[s] ?? 0;
          const eq = t === X ? Math.max(0, Math.max(0, ((rs.noiPerPeriod?.[M] ?? 0) * (1 + yv) * (g ? 1 + cfg.perpetuityGrowth : 1)) / xv) - Math.max(0, snap.bs.debtOutstandingPerPeriod[X] ?? 0)) + (level[X] ?? 0) : 0;
          return (fePre[s] ?? 0) + yv * cfo + eq;
        });
        return shocked;
      })();
      rows.push({ key, label: 'Case: operating cash change, exit cap rate', kind: 'p', values: vals, from: 0, total: 'none', fmt: RF.money,
        cells: [{ col: 2, v: yv, fmt: RF.pct, f: (E) => E.ref(`sensin:price:${i}`) }, { col: 3, v: xv, fmt: RF.pct, f: (E) => E.ref(`sensin:cap:${j}`) }],
        fs: (E, s) => {
          const y = E.cell(key, 2), x = E.cell(key, 3);
          const eq = `MAX(0,MAX(0,${E.d('ret|x|inc')}*(1+${y})${g ? `*(1+${E.ref('inp=ret|Growth g (%)@4')})` : ''}/${x})-${E.d('ret|x|debtX')})+${E.d('ret|x|heldX')}`;
          return `${E.s('rs|fe:pre', s)}${s === 0 ? '' : `+${y}*${E.s('rs|ff:cfo', s)}+${E.ex(s)}*(${eq})`}`;
        },
      });
    }));
    rows.push({ key: 'ret|#senscols', label: 'Operating cash flow change \\ exit cap rate', kind: 'cells', cells: xs.map((xv, j) => ({ col: D + j, v: xv, fmt: RF.pct, f: (E: REnv) => E.ref(`sensin:cap:${j}`), bold: true })) });
    ys.forEach((yv, i) => {
      rows.push({ key: `ret|sens|${i}`, label: '', kind: 'cells', cells: [{ col: 3, v: yv, fmt: RF.pct, f: (E) => E.ref(`sensin:price:${i}`), bold: true },
        ...xs.map((_xv, j) => ({ col: D + j, v: irrNum(grid?.irr[i]?.[j]), fmt: RF.pct, f: (E: REnv) => `IFERROR(IRR(${E.rng(`rs|sens:${i}:${j}`)},${E.cell('ret|h|fcfe', D)}),"n/a")` }))] });
    });
    gap('ret|gap|i');
  }

  // ════ REAL ESTATE METRICS ═══════════════════════════════════════════════
  {
    const m = rs.result.realEstate;
    const de = rs.developmentEconomics;
    const covInputs: CovenantInputs = { dscrPerPeriod: m.dscrPerPeriod, icrPerPeriod: m.icrPerPeriod, noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod, gdvValue: de.gdv, ltvAtExit: m.ltvAtExit };
    const phases = state.phases as Phase[];
    section('ret|#metrics', 'Real estate metrics');
    head('ret|#cov', 'Coverage by year');
    const opV = Array.from({ length: N }, (_, t) => (phases.some((ph) => { const tl = computePhaseTimeline(ph, p); const y = years[t]; return y >= new Date(tl.operationsStart).getUTCFullYear() && y <= new Date(tl.operationsEnd).getUTCFullYear(); }) ? 1 : 0));
    pRow('rm|op', 'Operating year (any phase operating)', [null, ...opV], (E, s) => `IF(OR(${phases.map((ph) => `AND(${E.yr(s)}>=YEAR(${E.ref(`phase:${ph.id}:oStart`)}),${E.yr(s)}<=YEAR(${E.ref(`phase:${ph.id}:oEnd`)}))`).join(',')}),1,0)`, { total: 'none', fmt: RF.int });
    const dash = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
    const series = (metric: string): Array<number | null> => [null, ...covenantSeries(metric as never, covInputs).map((v) => dash(v as number | null))];
    const dsV = rs.scheduledDebtServicePerPeriod;
    pRow('rm|ds', 'Scheduled debt service (sweep excluded)', yearsToStream(dsV), (E, s) => ['fnc:main:interest', 'fnc:main:sched', 'fnc:main:exitrepay'].filter((k) => E.has(k)).map((k) => E.loop(k, s)).join('+') || '0');
    const ebitdaKey = 'pl|__all__||EBITDA';
    const measured = (v: string): string => `IF(ABS(${v})<0.000000001,"-",${v})`;
    pRow('rm|dscr', 'DSCR', series('dscr'), (E, s) => `IF(AND(${E.s('rm|op', s)}=1,${E.s('rm|ds', s)}>0.000001),${measured(`${E.x(ebitdaKey, s)}/${E.s('rm|ds', s)}`)},"-")`, { nullAs: '-', total: 'none', fmt: RF.mult });
    pRow('rm|icr', 'Interest cover', series('icr'), (E, s) => `IF(ABS(${E.loop('fnc:main:intexp', s)})>0.000001,${measured(`${E.x(ebitdaKey, s)}/ABS(${E.loop('fnc:main:intexp', s)})`)},"-")`, { nullAs: '-', total: 'none', fmt: RF.mult });
    pRow('rm|dy', 'Debt yield', series('debt_yield'), (E, s) => `IF(AND(${E.s('rs|debt', s)}>0.000000001,${E.s('rs|noi', s)}>0.000000001),${E.s('rs|noi', s)}/${E.s('rs|debt', s)},"-")`, { nullAs: '-', total: 'none', fmt: RF.pct });
    pRow('rm|ltv', 'LTV (debt over the gross development value)', series('ltv'), (E, s) => `IF(AND(${E.d('ret|de|gdv')}>0.000000001,${E.s('rs|debt', s)}>0.000000001),${E.s('rs|debt', s)}/${E.d('ret|de|gdv')},"-")`, { nullAs: '-', total: 'none', fmt: RF.pct });
    const cumEq = (() => { let r = 0; const c = stream(bu.equityCashPerPeriod), k = stream(bu.equityInKindPerPeriod); return [null, ...Array.from({ length: N }, (_, t) => (r += -(c[t + 1] ?? 0) - (k[t + 1] ?? 0)))]; })();
    pRow('rm|cumeq', 'Cumulative equity invested', cumEq, (E, s) => `${s === 1 ? '0' : E.s('rm|cumeq', s - 1)}-${E.s('rs|dd:cash', s)}-${E.s('rs|dd:kind', s)}`, { total: 'last' });
    pRow('rm|coc', 'Cash on cash (years with a dividend)', [null, ...Array.from({ length: N }, (_, t) => { const dv = stream(bu.dividendsDistributedPerPeriod)[t + 1] ?? 0, ce = cumEq[t + 1] ?? 0; return ce > 0.000001 && dv > 0 ? dv / ce : null; })],
      (E, s) => `IF(AND(${E.s('rm|cumeq', s)}>0.000001,${E.s('rs|dd:div', s)}>0),${E.s('rs|dd:div', s)}/${E.s('rm|cumeq', s)},"")`, { nullAs: '', total: 'none', fmt: RF.pct });
    // Covenants: the threshold on Inputs, the worst and average year, pass or breach.
    const covenants = p.covenants ?? DEFAULT_COVENANTS;
    const rowOf: Record<string, string> = { dscr: 'rm|dscr', icr: 'rm|icr', debt_yield: 'rm|dy', ltv: 'rm|ltv' };
    rows.push({ key: 'ret|#covcols', label: 'Covenant', kind: 'cols', cols: [[D, 'Threshold'], [D + 1, 'Worst'], [D + 2, 'Average'], [D + 3, 'Status']] });
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
        { col: D + 2, v: ev.avg ?? '-', fmt, f: (E) => (cov.metric === 'ltv' ? `IF(COUNT(${E.rngY(sr)})=0,${E.d('rm|ltvexit')},AVERAGE(${E.rngY(sr)}))` : `IF(COUNT(${E.rngY(sr)})=0,"-",AVERAGE(${E.rngY(sr)}))`) },
        { col: D + 3, v: ev.pass == null ? 'n/a' : ev.pass ? 'Pass' : 'Breach', fmt: RF.text,
          f: (E) => `IF(ISNUMBER(${E.cell(key, D + 1)}),IF(${E.cell(key, D + 1)}${cov.operator === 'min' ? '>=' : '<='}${E.cell(key, D)},"Pass","Breach"),"n/a")` },
      ] });
    });
    // The cards.
    head('ret|#cards', 'Metrics');
    const heldIds = [...snap.perAssetPL.values()].filter((q) => q.strategy === 'Operate' || q.strategy === 'Lease').map((q) => q.assetId);
    const heldCost = m.yieldOnCost ? rs.stabilisedNOI / m.yieldOnCost : 0;
    one('rm|heldcost', 'Held assets\' cost (hotel and lease lines, land included)', heldCost,
      (E) => heldIds.map((id) => { const ks = KEYS.cxc(E).filter((k) => k.startsWith(`cxc:${id}:`)); return ks.length ? `MAX(0,${ks.map((k) => `SUM(${E.xr(k)})`).join('+')})` : '0'; }).join('+') || '0', RF.money, { indent: 1 });
    one('rm|ltvexit', 'LTV at the exit (debt over the exit value)', m.ltvAtExit ?? '-', (E) => `IF(${E.d('ret|x|tv')}>0,${E.d('ret|x|debtX')}/${E.d('ret|x|tv')},"-")`, RF.pct, { indent: 1 });
    one('rm|stabnoi', 'Stabilised NOI (the income capitalised)', rs.stabilisedNOI, (E) => E.d('ret|x|inc'));
    one('rm|exitnoi', 'Exit-year NOI', rs.exitNOI, (E) => `SUMPRODUCT(${E.exRng()},${E.rngY('rs|noi')})`);
    one('rm|yoc', 'Yield on cost', m.yieldOnCost ?? 'n/a', (E) => `IF(${E.d('rm|heldcost')}>0,${E.d('rm|stabnoi')}/${E.d('rm|heldcost')},"n/a")`, RF.pct);
    one('rm|cap', 'Cap rate at exit', m.capRateAtExit ?? 'n/a', (E) => `IF(${E.d('ret|x|tv')}>0,${E.d('rm|stabnoi')}/${E.d('ret|x|tv')},"n/a")`, RF.pct);
    one('rm|spread', 'Development spread (yield on cost less cap rate)', m.developmentSpread ?? 'n/a', (E) => `IF(AND(ISNUMBER(${E.d('rm|yoc')}),ISNUMBER(${E.d('rm|cap')})),${E.d('rm|yoc')}-${E.d('rm|cap')},"n/a")`, RF.pct);
    one('rm|pm', 'Profit margin (profit after tax over revenue)', m.profitMargin ?? 'n/a',
      (E) => `IF(${E.d('ret|de|gdv')}>0,SUMPRODUCT(${E.rngY('rs|hold')},${E.xr(`pl|__all__||${patLabel(state)}`)})/${E.d('ret|de|gdv')},"n/a")`, RF.pct);
    one('rm|poc', 'Profit on cost', m.profitOnCost ?? 'n/a', (E) => `IF(${E.d('ret|de|tdc')}>0,(${E.d('ret|de|gdv')}-${E.d('ret|de|tdc')})/${E.d('ret|de|tdc')},"n/a")`, RF.pct);
    const sv = (fn: string, r: string, fmt: string, label: string, key: string, v: number | string): void => one(key, label, v, (E) => `IF(COUNT(${E.rngY(r)})=0,"n/a",${fn}(${E.rngY(r)}))`, fmt);
    sv('MIN', 'rm|dscr', RF.mult, 'Minimum DSCR', 'rm|dscrmin', reduceWorst(covenantSeries('dscr', covInputs), 'min') ?? 'n/a');
    sv('AVERAGE', 'rm|dscr', RF.mult, 'Average DSCR', 'rm|dscravg', reduceAvg(covenantSeries('dscr', covInputs)) ?? 'n/a');
    sv('MIN', 'rm|icr', RF.mult, 'Minimum interest cover', 'rm|icrmin', reduceWorst(covenantSeries('icr', covInputs), 'min') ?? 'n/a');
    sv('MIN', 'rm|dy', RF.pct, 'Debt yield (worst year)', 'rm|dymin', reduceWorst(covenantSeries('debt_yield', covInputs), 'min') ?? 'n/a');
    const ltvPeak = reduceWorst(covenantSeries('ltv', covInputs), 'max');
    one('rm|ltvpeak', 'LTV at peak debt', ltvPeak ?? (m.ltvAtExit ?? 'n/a'), (E) => `IF(COUNT(${E.rngY('rm|ltv')})>0,MAX(${E.rngY('rm|ltv')}),${E.d('rm|ltvexit')})`, RF.pct);
    sv('AVERAGE', 'rm|coc', RF.pct, 'Average cash on cash', 'rm|cocavg', m.cashOnCashAvg ?? 'n/a');
    one('rm|peakeq', 'Peak equity', m.peakEquity, (E) => `MAX(0,MAX(${E.rngY('rm|cumeq')}))`);
    one('rm|maxneg', 'Largest cumulative FCFE shortfall', rs.equityExposure.maxNegativeCumulativeCF, (E) => `MAX(0,-MIN(${E.rng('rs|cumfe')}))`);
    // The stabilisation year: walking back from the capitalised year while growth stays steady.
    const noiS = stream([0, ...(rs.noiPerPeriod ?? [])]);
    const steadyV = M > 0 && (rs.noiPerPeriod?.[M - 1] ?? 0) > 0 ? (rs.noiPerPeriod[M] ?? 0) / rs.noiPerPeriod[M - 1] - 1 + STABILISATION_GROWTH_TOLERANCE : 0;
    const passV = [null, ...Array.from({ length: N }, (_, t) => (years[t] <= basisYear && (noiS[t] ?? 0) > 0 && (rs.noiPerPeriod?.[M - 1] ?? 0) > 0 ? ((noiS[t + 1] ?? 0) / (noiS[t] ?? 1) - 1 <= steadyV ? 1 : 0) : 0))];
    const runV: Array<number | null> = [null]; for (let t = 0; t < N; t++) runV.push(passV[t + 1] === 1 ? (runV[t] ?? 0) + 1 : 0);
    one('rm|prevnoi', 'NOI the year before the year capitalised', M > 0 ? (rs.noiPerPeriod?.[M - 1] ?? 0) : 0, (E) => `SUMPRODUCT((${E.yrRng()}=${E.d('ret|Basis year')}-1)*${E.rngY('rs|noi')})`, RF.money, { indent: 1 });
    pRow('rm|pass', 'Stabilisation: growth at most the steady growth', passV,
      (E, s) => `IF(AND(${E.yr(s)}<=${E.d('ret|Basis year')},${s === 1 ? '0' : E.s('rs|noi', s - 1)}>0,${E.d('rm|prevnoi')}>0),IF(${E.s('rs|noi', s)}/${s === 1 ? '1' : E.s('rs|noi', s - 1)}-1<=${E.d('ret|x|inc')}/${E.d('rm|prevnoi')}-1+${STABILISATION_GROWTH_TOLERANCE},1,0),0)`, { total: 'none', fmt: RF.int });
    pRow('rm|run', 'Stabilisation: years in a row at steady growth', runV, (E, s) => `IF(${E.s('rm|pass', s)}=1,${s === 1 ? '0' : E.s('rm|run', s - 1)}+1,0)`, { total: 'none', fmt: RF.int });
    const stabY = rs.stabilization.stabilizationYear;
    const noiV = stream(rs.noiPerPeriod ? [0, ...rs.noiPerPeriod] : undefined);
    pRow('rm|at95', 'NOI at 95% of the stabilised NOI or more (1 = yes)', [null, ...Array.from({ length: N }, (_, t) => (rs.stabilisedNOI > 0 && (noiV[t + 1] ?? 0) >= rs.stabilisedNOI * 0.95 ? 1 : 0))],
      (E, s) => `IF(AND(${E.d('rm|stabnoi')}>0,${E.s('rs|noi', s)}>=${E.d('rm|stabnoi')}*0.95),1,0)`, { total: 'none', fmt: RF.int });
    one('rm|stabyear', 'Stabilisation year', stabY ?? 'n/a',
      (E) => `IF(AND(COUNTIF(${E.rngY('rs|noi')},">0")>0,${E.d('rm|stabnoi')}>0),IF(${E.d('rm|prevnoi')}>0,${E.d('ret|Basis year')}-SUMIF(${E.yrRng()},${E.d('ret|Basis year')},${E.rngY('rm|run')}),IFERROR(INDEX(${E.yrRng()},MATCH(1,${E.rngY('rm|at95')},0)),"n/a")),"n/a")`, RF.year);
    // Funding mix, of the sources above.
    const su = (k: string): Fx => (E) => `IF(${E.d('ret|Total Sources')}>0,(${k.split('+').map((x) => E.d(x)).join('+')})/${E.d('ret|Total Sources')},"n/a")`;
    one('rm|mixdebt', 'Funding mix: debt', rs.fundingMix.debtPct ?? 'n/a', su('ret|Existing Debt+ret|su|debtCapex+ret|su|debtInt'), RF.pct);
    one('rm|mixcash', 'Funding mix: cash equity', rs.fundingMix.cashEquityPct ?? 'n/a', su('ret|Existing Equity+ret|New Equity (cash)'), RF.pct);
    one('rm|mixkind', 'Funding mix: in-kind equity', rs.fundingMix.inKindEquityPct ?? 'n/a', su('ret|In-Kind Equity (land)'), RF.pct);
    one('rm|mixcust', 'Funding mix: customer collections', rs.fundingMix.customerFundingPct ?? 'n/a', su('ret|Customer Collections / Pre-Sales'), RF.pct);

    // Operating KPIs, from the Revenue tab's own rows.
    const ok = buildOperatingKpis(snap, state);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, p);
    const keysOf = (E: REnv, sfx: string): string[] => [...new Set(lines.map((l) => l.key))].filter((k) => E.has(`rvc:${k}:${sfx}`)).map((k) => `rvc:${k}:${sfx}`);
    const sumK = (E: REnv, sfx: string): string => keysOf(E, sfx).map((k) => `SUM(${E.xr(k)})`).join('+') || '0';
    if (ok.hospitality) {
      const h = ok.hospitality;
      head('ret|#kh', 'Hospitality');
      one('rm|k:occ', 'Occupancy', h.occupancy ?? 'n/a', (E) => `IF((${sumK(E, 'arn')})>0,(${sumK(E, 'orn')})/(${sumK(E, 'arn')}),"n/a")`, RF.pct);
      one('rm|k:adr', 'ADR (per occupied night)', h.adr ?? 'n/a', (E) => `IF((${sumK(E, 'orn')})>0,(${sumK(E, 'rooms')})/(${sumK(E, 'orn')}),"n/a")`, RF.rate);
      one('rm|k:revpar', 'RevPAR (per available night)', h.revpar ?? 'n/a', (E) => `IF((${sumK(E, 'arn')})>0,(${sumK(E, 'rooms')})/(${sumK(E, 'arn')}),"n/a")`, RF.rate);
      one('rm|k:rooms', 'Rooms revenue', h.roomsRevenue, (E) => sumK(E, 'rooms'));
      one('rm|k:fb', 'F&B revenue', h.fbRevenue, (E) => sumK(E, 'fb'));
      one('rm|k:other', 'Other revenue', h.otherRevenue, (E) => sumK(E, 'other'));
      one('rm|k:htot', 'Total hospitality revenue', h.totalRevenue, (E) => sumK(E, 'total'));
      one('rm|k:arn', 'Available room nights', h.availableRoomNights, (E) => sumK(E, 'arn'), RF.int);
    }
    if (ok.residential) {
      const r = ok.residential;
      head('ret|#kr', 'Residential (for sale)');
      one('rm|k:gdv', 'Residential sale value', r.saleValue, (E) => `${sumK(E, 'preRev')}+${sumK(E, 'postRev')}`);
      one('rm|k:pre', 'Pre-sales share', r.preSalesPct ?? 'n/a', (E) => `IF(${E.d('rm|k:gdv')}>0,(${sumK(E, 'preRev')})/${E.d('rm|k:gdv')},"n/a")`, RF.pct);
      // Units only where a line sells by units: Revenue's unit rows.
      if (r.unitsSold > 0) {
        const unitKeys = (E: REnv): string[] => KEYS.all(E).filter((k) => /^rvc:.+:(pre|post):units$/.test(k));
        one('rm|k:units', 'Units sold', r.unitsSold, (E) => unitKeys(E).map((k) => `SUM(${E.xr(k)})`).join('+') || '0', RF.int);
        one('rm|k:ppu', 'Average sale price per unit', r.pricePerUnit ?? 'n/a', (E) => `IF(${E.d('rm|k:units')}>0,${E.d('rm|k:gdv')}/${E.d('rm|k:units')},"n/a")`, RF.rate);
      }
    }
    if (ok.lease) {
      const l = ok.lease;
      head('ret|#kl', 'Lease (retail and office)');
      const lk = (E: REnv): string[] => [...new Set(lines.map((x) => x.key))].filter((k) => E.has(`rvc:${k}:gla`) && E.has(`rvc:${k}:occupied`) && E.has(`rvc:${k}:rev`));
      one('rm|k:gla', 'Total lettable area (sqm)', l.gla, (E) => lk(E).map((k) => E.xo(`rvc:${k}:gla`)).join('+') || '0', RF.int);
      const let_ = (E: REnv): string => lk(E).map((k) => `SUM(${E.xr(`rvc:${k}:occupied`)})`).join('+') || '0';
      // A one-cell formula needs no anchors; without them four lines stay under the 200-character rule (2026-11-12).
      const avail = (E: REnv): string => (lk(E).map((k) => `${E.xo(`rvc:${k}:gla`)}*COUNTIF(${E.xr(`rvc:${k}:occupied`)},">0")`).join('+') || '0').replace(/\$/g, '');
      // The platform's figures behind its averages: area let = revenue over rent per sqm, available = let over occupancy.
      const letV = l.rentPerSqm && l.rentPerSqm > 0 ? l.totalRevenue / l.rentPerSqm : 0;
      const availV = l.avgOccupancy && l.avgOccupancy > 0 ? letV / l.avgOccupancy : 0;
      one('rm|k:lavail', 'Area available to let over the hold (sqm-years)', availV, (E) => avail(E), RF.int, { indent: 1 });
      one('rm|k:llet', 'Area let over the hold (sqm-years)', letV, (E) => let_(E), RF.int, { indent: 1 });
      one('rm|k:locc', 'Average occupancy', l.avgOccupancy ?? 'n/a', (E) => `IF(${E.d('rm|k:lavail')}>0,${E.d('rm|k:llet')}/${E.d('rm|k:lavail')},"n/a")`, RF.pct);
      one('rm|k:lrev', 'Total lease revenue', l.totalRevenue, (E) => lk(E).map((k) => `SUM(${E.xr(`rvc:${k}:rev`)})`).join('+') || '0');
      one('rm|k:rent', 'Rent per sqm let, per year', l.rentPerSqm ?? 'n/a', (E) => `IF(${E.d('rm|k:llet')}>0,${E.d('rm|k:lrev')}/${E.d('rm|k:llet')},"n/a")`, RF.rate);
    }
    gap('ret|gap|j');
  }

  // ════ EXIT-YEAR ANALYSIS: one row per candidate year ════════════════════
  {
    head('ret|#ey', 'Exit-year analysis (selling at the end of each year)');
    // SHORT, AND NO ARRAY ARITHMETIC (2026-11-04, founder): which years are candidates is one 1/0
    // column; each candidate's project and equity cash flows are helper rows below the table, which
    // the IRR and MOIC cells read as plain ranges (IRR and SUMIF ignore the "" beyond the exit).
    const noiOn = [null, ...Array.from({ length: N }, (_, t) => ((rs.noiPerPeriod?.[t] ?? 0) > 0 ? 1 : 0))];
    pRow('ret|ey|on', 'NOI positive (1 = yes)', noiOn, (E, s) => `IF(${E.s('rs|noi', s)}>0,1,0)`, { total: 'none', fmt: RF.int });
    const midI = Math.min(N - 1, Math.max(0, Math.floor(N / 2)));
    // The first candidate: the first year whose capitalised income is positive (the year's own NOI
    // under the exit-year basis, the year before's under the prior-year basis, the first year reading
    // its own), else the model midpoint.
    const exitBasis = cfg.terminalValueBasis === 'exit_year';
    const capOn = noiOn.map((v, s) => (s === 0 ? null : exitBasis ? v : noiOn[s === 1 ? 1 : s - 1]));
    const firstCap = capOn.findIndex((v, s) => s > 0 && v === 1);
    pRow('ret|ey|cap', 'Capitalised income positive (1 = yes)', capOn,
      (E, s) => `IF(${E.d('ret|Terminal value basis')}="Exit year",${E.s('ret|ey|on', s)},${s === 1 ? E.s('ret|ey|on', 1) : E.s('ret|ey|on', s - 1)})`, { total: 'none', fmt: RF.int });
    one('ret|ey|first', 'First candidate exit year', years[firstCap > 0 ? firstCap - 1 : midI],
      (E) => `IFERROR(INDEX(${E.yrRng()},MATCH(1,${E.rngY('ret|ey|cap')},0)),${E.yrA(midI + 1)})`, RF.year, { indent: 1 });
    rows.push({ key: 'ret|#eycols', label: 'Exit year', kind: 'cols', cols: [[D, 'Enterprise value'], [D + 1, 'Equity value'], [D + 2, 'Project IRR'], [D + 3, 'Equity IRR'], [D + 4, 'Equity MOIC'], [D + 5, 'Selected'], [D + 6, 'Candidate (1 = yes)']] });
    // EVERY MODEL YEAR HAS A ROW (2026-11-03): the first candidate moves with the timing (a shorter
    // construction makes a year earlier one), so the rows cannot start where the export found it. A
    // year is a candidate by the platform's rule (returns-resolvers): from the first year whose
    // capitalised income is positive (the model midpoint where none is) up to the chosen exit, and
    // the chosen exit always; any other year reads "-".
    void X;
    for (let e = 0; e < N; e++) {
      const x = rs.exitYears.find((q) => q.exitIdx === e);
      const key = `ret|ey|${e}`;
      const flag = (E: REnv): string => E.cell(key, D + 6);
      const blank = (f: Fx): Fx => (E) => `IF(${flag(E)}=0,"-",${f(E)})`;
      const income = (E: REnv): string => `IF(${E.d('ret|Terminal value basis')}="Exit year",${E.sA('rs|noi', e + 1)},${e > 0 ? E.sA('rs|noi', e) : '0'})`;
      const guess = (E: REnv): string => `MAX(-0.9,${E.cell(key, D + 4)}^(2/${e + 2})-1)`;
      const moic = (r: string): string => `IF(SUMIF(${r},"<0")<0,SUMIF(${r},">0")/-SUMIF(${r},"<0"),0)`;
      rows.push({ key, label: '', kind: 'cells', cells: [
        { col: 1, v: years[e], fmt: RF.year, f: (E) => E.yrA(e + 1) },
        { col: D, v: x ? x.enterpriseValue : '-', fmt: RF.money, f: blank((E) => E.tvOf(income(E))) },
        { col: D + 1, v: x ? x.equityValue : '-', fmt: RF.money, f: blank((E) => `MAX(0,${E.cell(key, D)}-MAX(0,${E.sA('rs|debt', e + 1)}))`) },
        { col: D + 2, v: x ? irrNum(x.fcffIrr) : '-', fmt: RF.pct, f: blank((E) => `IFERROR(IRR(${E.rng(`ret|eyf|${e}`)},${guess(E)}),"n/a")`) },
        { col: D + 3, v: x ? irrNum(x.fcfeIrr) : '-', fmt: RF.pct, f: blank((E) => `IFERROR(IRR(${E.rng(`ret|eye|${e}`)},${guess(E)}),"n/a")`) },
        { col: D + 4, v: x ? x.equityMoic : '-', fmt: RF.mult, f: blank((E) => moic(E.rng(`ret|eye|${e}`))) },
        { col: D + 5, v: x?.isSelected ? 'Yes' : 'No', fmt: RF.text, f: (E) => `IF(${E.yrA(e + 1)}=${E.d('ret|Exit Year')},"Yes","No")` },
        { col: D + 6, v: x ? 1 : 0, fmt: RF.int, f: (E) => `IF(AND(${E.yrA(e + 1)}<=${E.d('ret|Exit Year')},OR(${E.yrA(e + 1)}=${E.d('ret|Exit Year')},AND(${E.d('ret|ey|first')}>0,${E.yrA(e + 1)}>=${E.d('ret|ey|first')}))),1,0)` },
      ] });
    }
    // The cash flows each candidate's IRR and MOIC read: the stream to its year, the sale in it.
    head('ret|#eyf', 'Exit-year analysis: the cash flows behind each row');
    for (let e = 0; e < N; e++) {
      const key = `ret|ey|${e}`;
      const x = rs.exitYears.find((q) => q.exitIdx === e);
      // The platform's figures: the stream to the candidate's year, the sale added in it; "" elsewhere.
      const srcV = (k: string): Array<number | null> => ((rows.find((r) => r.key === k) as { values?: Array<number | null> } | undefined)?.values ?? []);
      const valuesOf = (k: string, sale: number): Array<number | null> => Array.from({ length: N + 1 }, (_, s) => (!x || s > e + 1 ? null : (srcV(k)[s] ?? 0) + (s === e + 1 ? sale : 0)));
      const cfRow = (k: string, label: string, src: string, add: (E: REnv) => string): void => pRow(k, label, valuesOf(src, k.startsWith('ret|eyf') ? (x?.enterpriseValue ?? 0) : (x?.equityValue ?? 0) + (level[e] ?? 0)),
        (E, s) => `IF(${E.cell(key, D + 6)}=0,"",IF(${E.yr(s)}<=${E.yrA(e + 1)},${E.s(src, s)}+IF(${E.yr(s)}=${E.yrA(e + 1)},${add(E)},0),""))`, { from: 0, total: 'none', indent: 1, nullAs: '' });
      cfRow(`ret|eyf|${e}`, `Project cash flow, sold in ${years[e]}`, 'rs|ff:pre', (E) => `N(${E.cell(key, D)})`);
      cfRow(`ret|eye|${e}`, `Equity cash flow, sold in ${years[e]}`, 'rs|fe:pre', (E) => `N(${E.cell(key, D + 1)})+${E.sA('rs|level', e + 1)}`);
    }
  }
  return { rows, refused };
}

/** The label of the P&L's profit after tax row. */
function patLabel(state: FinancialsResolverState): string {
  return getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country)).pat;
}

/** Registered keys the rules search, through the environment. */
const KEYS = {
  all: (E: REnv): string[] => E.keys(),
  cxc: (E: REnv): string[] => KEYS.all(E).filter((k) => k.startsWith('cxc:') && k.split(':').length === 3 && !k.startsWith('cxc:ph:')),
};

/** A row's years shifted back one (the opening column to the year before the last). */
function rangePrev(E: REnv, key: string): string { return E.prevRange(key); }


