/**
 * financingPlan.ts (2026-10-29), THE LIVE FINANCING TAB, ROW BY ROW.
 *
 * One list of the rows the live Financing tab carries, with the platform's value for each. The
 * builder (`addFinancingLive`) prints them; the loop layer (stage6Loop.ts) writes each row's
 * formula by its key, so the two cannot disagree about what a row is.
 *
 * ONE LOOP (2026-10-29, founder): cash before financing, the funding need, the equity and debt
 * drawn, interest and the interest drawn as debt, the sweep, zakat inside the loop, dividends and
 * closing cash, each worked out once. The structure follows the financing the platform holds:
 * a row the chosen structure does not use is not printed (a scheduled-principal row under a cash
 * sweep, the land split under Method 3, the deficit-path fee base on the equity path).
 *
 * Keys are `fl:<name>`, a facility's `fl:tr:<id>:<name>`, a phase's `fl:ph:<id>:<name>`, a fee's
 * `fl:fee:<index>`, a line's capitalised interest `fl:idc:<n>`.
 *
 * No em dashes in this file.
 */
import { escrowInForce, featureUsed } from '../exportScope';
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../../financials-resolvers';
import { heldIncomePerPeriod, phaseProceedsShare } from '../../reports/phaseProceeds';
import { resolveFundTerms, FUND_FEE_SPECS, FEE_BASE_LABELS, feeBaseFor } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { buildIdcAllocationTables } from '../../reports/financingReports';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import type { FinancingTranche } from '../../state/module1-types';
import { expensedRowsOf } from '../expensedRows';
import { effectiveTrancheRatePct } from '@/src/core/calculations/financing';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;
export type FinFmt = 'money' | 'pct' | 'year' | 'int' | 'idc';
/** The IDC method's 1 / 0 printed as its words. */
export const IDC_METHOD_FMT = '"Mid-year on draws, excluding same-year IDC";;"Mid-year on draws, including same-year IDC"';
export interface FinRow {
  key: string;
  label: string;
  basis?: string;
  /** 'units': a sub-table's units row; 'note': a sentence under a table; 'meta': a figure in the Input column only. */
  kind: 'title' | 'period' | 'scalar' | 'gap' | 'units' | 'note' | 'meta';
  values?: number[];
  value?: number;
  fmt?: FinFmt;
  /** A balance: its Total is the last year, never a sum. */
  balance?: boolean;
  /** A balance shown with its peak in the Total column, "peak" in the Input column (2026-11-19, founder). */
  peak?: boolean;
  /** A value the row reads from another tab, shown in its Input column (a line's land, 2026-11-15). */
  metaB?: number;
  style?: 'total' | 'subtotal';
  indent?: number;
}

/** The loop's capitalised interest, sent back to Schedules and Capex: the row says so. */
export const FEEDS_SCHEDULES = 'Feeds Fixed Assets & Inventory';

export type FacilityKind = 'sweep' | 'annuity' | 'principal' | 'bullet' | 'yoy';
export const sweeps = (t: { repaymentMethod: string; cashSweepConfig?: { enabled?: boolean } }): boolean =>
  t.repaymentMethod === 'cash_sweep' || t.cashSweepConfig?.enabled === true;
export function facilityKind(t: FinancingTranche): FacilityKind {
  if (sweeps(t)) return 'sweep';
  if (t.repaymentMethod === 'year_on_year_pct') return 'yoy';
  if (t.repaymentMethod === 'bullet') return 'bullet';
  const sub = t.repaymentMethod === 'equal_repayment' ? (t.equalRepaymentSubMethod ?? 'equal_total') : '';
  return t.repaymentMethod === 'equal_periodic_amortization' || sub === 'equal_total' ? 'annuity' : 'principal';
}
/** The facilities in the order the engine consumes the shared budgets: existing first, then sweep priority, then as listed. */
export function orderedFacilities(tranches: readonly FinancingTranche[]): FinancingTranche[] {
  const exFirst = (t: { origin?: string }): number => (t.origin === 'existing' ? 0 : 1);
  return tranches.map((t, i) => ({ t, i }))
    .sort((a, b) => (exFirst(a.t) - exFirst(b.t)) || ((a.t.cashSweepConfig?.priority ?? 100) - (b.t.cashSweepConfig?.priority ?? 100)) || (a.i - b.i))
    .map((x) => x.t);
}

export interface FinPlanContext {
  method: number;
  feeOn: boolean;
  /** The fund fees are drawn from equity outside the funding need. */
  feeByEquity: boolean;
  zakat: boolean;
  cit: boolean;
  taxLag: boolean;
  anySweep: boolean;
  booked: boolean;
  /** Lines that share capitalised interest, in Financing's order: their title and asset ids. */
  idcLines: Array<{ title: string; assetIds: string[]; key: string }>;
}

export function financingPlan(state: FinancialsResolverState, snap: Snap = computeFinancialsSnapshot(state)): { rows: FinRow[]; ctx: FinPlanContext } {
  const N = snap.axisLength;
  const p = state.project;
  const fin = snap.financing;
  const gap = computeFundingGap(snap);
  const w = gap.method3Waterfall;
  const dcf = snap.directCF;
  const sl = (a: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, t) => Number(a?.[t] ?? 0));
  const neg = (a: readonly number[]): number[] => a.map((v) => -(v ?? 0));
  const add = (...xs: Array<readonly number[]>): number[] => Array.from({ length: N }, (_, t) => xs.reduce((s, x) => s + (x[t] ?? 0), 0));
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const method = (fin.funding.selectedMethodId ?? p.financing?.fundingMethod ?? 1) as number;
  const fundTerms = resolveFundTerms(p);
  const feeOn = fundTerms.enabled;
  const feeByEquity = feeOn && fundTerms.managementFeeFunding === 'equity';
  const zakat = (p.tax?.basis ?? 'zakat') !== 'cit';
  const cit = !zakat;
  // The zakat payable is always worked out (2026-11-03): zero days pays it in the year.
  const taxLag = true;
  const retCfg = resolveReturnsConfig(p, N);
  const booked = retCfg.terminalMethod !== 'none';
  const tranches = orderedFacilities(state.financingTranches ?? []);
  const anySweep = tranches.some(sweeps);
  const Y0 = snap.projectStartYear;
  const yearOf = (ph: { startDate?: string }): number => (ph.startDate ? new Date(ph.startDate).getUTCFullYear() : Y0);
  const cend = Math.max(...state.phases.map((ph) => Math.max(0, yearOf(ph) - Y0) + Math.max(0, ph.constructionPeriods ?? 0)));
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const N1 = N - 1;
  const TAX = zakat ? 'Zakat' : 'Tax';
  const rows: FinRow[] = [];
  const title = (key: string, label: string): void => { rows.push({ key, label, kind: 'title' }); };
  const gapRow = (): void => { rows.push({ key: `fl:gap:${rows.length}`, label: '', kind: 'gap' }); };
  const scalar = (key: string, label: string, value: number, fmt: FinFmt, basis: string): void => { rows.push({ key, label, kind: 'scalar', value, fmt, basis }); };
  const per = (key: string, label: string, values: number[], basis: string, o: Partial<FinRow> = {}): void => { rows.push({ key, label, kind: 'period', values, basis, ...o }); };
  // A NUMBERED SUB-TABLE (2026-11-19, founder): its sub-heading (numbered x.1, x.2 by the reference layout), its units
  // row, and one blank row before it unless it is the section's first.
  const sub = (key: string, label: string, units: string): void => {
    if (rows.length && rows[rows.length - 1].kind !== 'title') gapRow();
    rows.push({ key, label, kind: 'title' });
    rows.push({ key: `${key}:u`, label: units, kind: 'units' });
  };
  const note = (key: string, label: string): void => { rows.push({ key, label, kind: 'note' }); };
  const meta = (key: string, label: string, v: number, basis: string): void => { rows.push({ key, label, kind: 'meta', metaB: v, basis, fmt: 'int' }); };
  const CCY = p.currency ?? 'SAR';

  // ── Settings in force ──────────────────────────────────────────────────────
  title('fl:t:set', 'Settings in force (worked out from Inputs)');
  scalar('fl:lastCon', 'Last construction year', Y0 + cend - 1, 'year', 'The latest phase\'s start plus its construction years, less one');
  const dF = Math.max(0, fin.funding.debtPct ?? 0) / 100;
  scalar('fl:dF', 'Debt share of the funding', dF, 'pct', 'Debt % over debt % plus equity % on Inputs; 0 where neither is typed');
  scalar('fl:eF', 'Equity share of the funding', 1 - dF, 'pct', 'One less the debt share');
  // SHOWN AS ITS WORDS (2026-11-19, founder): the cell holds 1 or 0 for the formulas and its format prints the method.
  scalar('fl:idcExcl', 'IDC method', p.idcConfig?.interestMethod === 'mid_year_excl' ? 1 : 0, 'idc', 'The IDC method on Project Inputs');
  if (method !== 3) {
    const pf = p.financing?.parcelFunding ?? [];
    const typed = (c: { debtPct?: number; equityPct?: number }): boolean => typeof c.debtPct === 'number' || typeof c.equityPct === 'number';
    const shareOf = (c: (typeof pf)[number] | undefined): number => {
      if (!c) return 0;
      if (typed(c)) { const d = Math.max(0, c.debtPct ?? 0), e = Math.max(0, c.equityPct ?? 0); return d + e > 0 ? d / (d + e) : 0; }
      if (c.fundingType === '100pct_debt') return 1;
      if (c.fundingType !== 'custom_split') return 0;
      const d = Math.max(0, c.customDebtPct ?? 0), e = Math.max(0, c.customEquityPct ?? 100 - (c.customDebtPct ?? 0));
      return d + e > 0 ? d / (d + e) : 0;
    };
    const plots = state.parcels.map((x) => ({ x, cash: Math.max(0, (x.area ?? 0) * (x.rate ?? 0) * Math.max(0, Math.min(100, x.cashPct ?? 0)) / 100) }));
    const tot = plots.reduce((a, y) => a + y.cash, 0);
    scalar('fl:landDebt', 'Land cash funded by debt (share)', tot > 0 ? plots.reduce((a, y) => a + y.cash * shareOf(pf.find((c) => c.parcelId === y.x.id)), 0) / tot : 0, 'pct', 'Each phase\'s debt % on Inputs, weighted by its plots\' cash land value');
  }
  if (anySweep) {
    const cs = p.financing?.cashSweep?.startingYear;
    scalar('fl:sweepStart', 'Sweep starts (year)', Y0 + (cs !== undefined ? clamp(cs - Y0, 0, N1) : clamp(cend, 0, N1)), 'year', 'The year on Inputs, else the year after construction');
  }
  {
    const dflt = Math.max(Y0, ...state.phases.map((ph) => yearOf(ph) + Math.max(0, ph.constructionPeriods ?? 0)));
    const sy = p.dividendStartYear;
    scalar('fl:divStart', 'Dividends start (year)', Y0 + (sy !== undefined ? clamp(sy - Y0, 0, N1) : clamp(dflt - Y0, 0, N1)), 'year', 'The year on Inputs, else the year after construction');
  }
  // The fee base series (the funding need with the fees left out) and its first draw.
  const feeBasePer = method === 3 ? sl(w.feeBaseRequirementPerPeriod) : add(sl(fin.debtEquitySplit.debt), sl(fin.equity.developmentPerPeriod));
  if (feeOn) {
    const fd = feeBasePer.findIndex((v) => v > 0);
    scalar('fl:firstDraw', 'First draw (year): the one-off fund fees are charged in it', Y0 + (fd >= 0 ? fd : 0), 'year', 'The first year the funding need is drawn');
  }
  for (const t of tranches) {
    const f = fin.facilities.get(t.id);
    if (!f) continue;
    const kind = facilityKind(t);
    const isEx = t.origin === 'existing';
    const td = sl(f.drawSchedule).reduce((a, v) => a + v, 0);
    scalar(`fl:tr:${t.id}:rate`, `${t.name}: interest rate`, effectiveTrancheRatePct(t) / 100, 'pct', 'The interbank rate plus the credit spread, both typed on Inputs');
    scalar(`fl:tr:${t.id}:td`, `${t.name}: total drawn`, td, 'money', 'The facility\'s capex drawdowns over the years');
    if (kind === 'sweep') continue;
    const start = t.repaymentStartYear === undefined ? (isEx ? 0 : clamp(cend, 0, N)) : clamp(t.repaymentStartYear - Y0, 0, N);
    const nTyped = Math.max(0, (isEx ? t.remainingRepaymentPeriods : t.repaymentPeriods) ?? 0);
    const n = kind === 'yoy' ? 0 : isEx ? nTyped : nTyped > 0 ? nTyped : Math.max(0, N - start);
    const finY = n > 0 ? Math.min(N1, start + n - 1) : N1;
    scalar(`fl:tr:${t.id}:start`, `${t.name}: repayment starts (year)`, Y0 + start, 'year', 'The year on Inputs, else the year after construction');
    if (kind !== 'yoy') scalar(`fl:tr:${t.id}:n`, `${t.name}: repayment periods`, n, 'int', 'As typed on Inputs; none typed repays over the years left');
    scalar(`fl:tr:${t.id}:fin`, `${t.name}: final repayment (year)`, Y0 + finY, 'year', 'The last scheduled year, when the rest of the balance is due');
    if (kind === 'annuity' || kind === 'principal') {
      const rate = Math.max(0, ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0)) / 100);
      const pmt = kind === 'annuity' ? (n <= 0 || td <= 0 ? 0 : rate <= 0 ? td / n : td * rate * Math.pow(1 + rate, n) / (Math.pow(1 + rate, n) - 1)) : (n > 0 ? td / n : 0);
      scalar(`fl:tr:${t.id}:pmt`, `${t.name}: scheduled payment`, pmt, 'money', kind === 'annuity' ? 'An annuity on the total drawn over the periods' : 'The total drawn over the periods');
    }
    if (kind === 'yoy') {
      const sch = t.yearOnYearPctSchedule ?? [];
      const typed = zeros();
      for (let u = 0; u < N; u++) { const k = u - start; if (u >= start && k >= 0) typed[u] = Math.max(0, sch[k] ?? 0) / 100; }
      const tot = typed.reduce((x, v) => x + v, 0);
      per(`fl:tr:${t.id}:yoyTyped`, `${t.name}: repayment % typed for the year`, typed, 'Inputs: each repayment year\'s %, from the repayment start');
      per(`fl:tr:${t.id}:yoyShare`, `${t.name}: share of the total repaid in the year`, typed.map((v, u) => (u < start ? 0 : tot === 0 ? 1 / Math.max(1, N - start) : v / tot)), 'The typed % over its total; none typed repays evenly over the years left');
    }
  }
  let sqmActive: number[] | null = null;
  let idcSqmTot = 0;
  const idcAssets = [...snap.idc.byAsset.values()];
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const idcLines = planReportLines(lineState, (a) => snap.idc.byAsset.has(a.id)).map((l) => ({ title: lineTitle(l, lineState).replace(/\s*\((?:Land|Plot)[^)]*\)\s*$/, ''), assetIds: [...l.assetIds], key: l.key }));
  if (idcAssets.length) {
    // ONE LAND ROW PER LINE (2026-11-07): the total, the land under construction and each line's
    // share of the interest read these, so no formula repeats every plot's land.
    idcSqmTot = idcAssets.reduce((a, x) => a + x.landSqm, 0);
    const active = zeros();
    for (const x of idcAssets) {
      const a = state.assets.find((y) => y.id === x.assetId);
      const ph = a && state.phases.find((q) => q.id === a.phaseId);
      if (!ph || !a || !sharesCapitalisedInterest(a)) continue;
      const s0 = clamp(yearOf(ph) - Y0, 0, N1), cp = ph.constructionPeriods ?? 0;
      for (let t = s0; t <= (cp > 0 ? Math.min(N1, s0 + cp - 1) : -1); t++) active[t] += x.landSqm;
    }
    sqmActive = active;
  }
  gapRow();

  // ── 1. Operating cash, capex and the exit (2026-11-19, founder): three sub-tables, each figure a link to its one source ──
  title('fl:t:ops', 'Operating cash, capex and the exit');
  sub('fl:t:ops:cash', 'Operating cash', CCY);
  per('fl:collected', 'Revenue: cash collected', sl(dcf.revenueReceivedPerPeriod), 'Revenue: each line\'s cash collected');
  per('fl:opexPaid', 'Opex paid: lines and HQ', add(sl(dcf.opexPaidPerPeriod), sl(dcf.hqOpexPaidPerPeriod)), 'Opex: each line\'s opex less the rise in its payable');
  if (expensedRowsOf(state, snap, state.assets.filter((a) => a.visible !== false).map((a) => a.id), (_a, _l, valued) => valued).length) per('fl:mkt', 'Selling and marketing paid: as incurred', sl(dcf.sellingExpensePaidPerPeriod), 'Revenue: selling and marketing expensed');
  if (snap.escrow.byAsset.size > 0 && escrowInForce(state as never)) per('fl:esc', 'Escrow: pre-sales cash held back and released', sl(dcf.netRevenueAdjustmentPerPeriod), 'Revenue: net escrow cash flow');
  per('fl:taxPaidOps', `${TAX} paid`, sl(dcf.taxPaidPerPeriod), `5.3, ${TAX.toLowerCase()} paid`);
  if (feeOn && !feeByEquity) per('fl:feeOps', 'Fund fees paid', sl(dcf.fundFeesPaidPerPeriod), 'The fund fees, 6.3: inside the funding need');
  const opIn = add(sl(dcf.cashFromOperationsPerPeriod), feeOn && feeByEquity ? neg(sl(dcf.fundFeesPaidPerPeriod)) : zeros());
  per('fl:opIn', 'Operating cash before financing', opIn, 'The rows above', { style: 'subtotal' });

  sub('fl:t:ops:capex', 'Capex', CCY);
  per('fl:capex', 'Capex paid in cash (excluding land in kind)', sl(fin.capex.perPeriod.exclLandInKind), 'Capex: the row of that name in the capex summary');
  if (method !== 3) {
    per('fl:landCash', 'Of which: land paid in cash', sl(fin.capex.perPeriod.landCash), 'Capex: land, cash', { indent: 1 });
    per('fl:nonLand', 'Of which: capex excluding land', sl(fin.capex.perPeriod.exclAllLand), 'Capex paid in cash less the land paid in cash', { indent: 1 });
  }
  per('fl:inKind', 'Land contributed in kind (memo)', sl(fin.equity.inKindPerPeriod), 'Capex: total land, in-kind');

  // THE ONLY PLACE THE EXIT VALUE IS WORKED OUT (2026-11-19, founder): the held assets' NOI from Opex, the income the
  // exit capitalises, the gross value, the selling costs and the net proceeds, by phase and in total. Returns links here.
  sub('fl:t:ops:exit', 'Held assets and the exit', CCY);
  {
    const noi = zeros();
    for (const pa of snap.perAssetPL.values()) if (pa.strategy === 'Operate' || pa.strategy === 'Lease') for (let t = 0; t < N; t++) noi[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
    const proceeds = zeros();
    if (snap.disposal.booked) proceeds[snap.disposal.exitIdx] = snap.disposal.proceeds;
    const X = snap.disposal.exitIdx;
    const sc = Math.max(0, Math.min(1, retCfg.exitSellingCostRate ?? 0));
    const basisIdx = retCfg.terminalValueBasis === 'exit_year' ? X : X - 1;
    const phs = state.phases.map((ph) => ({ ph, noi: heldIncomePerPeriod(snap, state, ph.id), share: phaseProceedsShare(snap, state, ph.id) })).filter((x) => x.noi.some((v) => Math.abs(v) > 0.005));
    const multi = state.phases.length > 1;
    for (const x of phs) per(`fl:ph:${x.ph.id}:noi`, `EBITDA (NOI): ${x.ph.name}`, x.noi, 'Opex: EBITDA (NOI) of the phase, in the summary by line', { indent: 1 });
    per('fl:noi', multi ? 'EBITDA (NOI): held assets, total' : 'EBITDA (NOI): held assets', noi, multi ? 'The phases above' : 'Opex: EBITDA (NOI), in the summary by line');
    if (booked) {
      scalar('fl:capYear', 'Year capitalised', snap.projectStartYear + Math.max(0, basisIdx), 'year', 'The exit year on Project Inputs, less one where the basis is the year before the exit');
      const at = (v: number): number[] => { const o = zeros(); if (snap.disposal.booked && X >= 0 && X < N) o[X] = v; return o; };
      const incTot = snap.disposal.booked && basisIdx >= 0 ? noi[basisIdx] ?? 0 : 0;
      const gross = snap.disposal.booked ? snap.disposal.proceeds / Math.max(1e-12, 1 - sc) : 0;
      for (const x of phs) per(`fl:ph:${x.ph.id}:inc`, `Income capitalised: ${x.ph.name}`, at(snap.disposal.booked && basisIdx >= 0 ? x.noi[basisIdx] ?? 0 : 0), 'In the exit year: the phase\'s NOI of the year capitalised', { indent: 1 });
      per('fl:inc', multi ? 'Income capitalised: total' : 'Income capitalised', at(incTot), 'In the exit year: the NOI of the year capitalised');
      for (const x of phs) per(`fl:ph:${x.ph.id}:gross`, `Gross exit value: ${x.ph.name}`, at(gross * x.share), 'The gross exit value x the phase\'s share of the income capitalised', { indent: 1 });
      per('fl:gross', multi ? 'Gross exit value: total' : 'Gross exit value', at(gross), 'The income capitalised at the exit terms on Project Inputs');
      for (const x of phs) per(`fl:ph:${x.ph.id}:sell`, `Less selling costs at exit: ${x.ph.name}`, at(-gross * x.share * sc), 'The phase\'s gross value x the selling cost % on Project Inputs', { indent: 1 });
      per('fl:sell', multi ? 'Less selling costs at exit: total' : 'Less selling costs at exit', at(-gross * sc), 'The gross value x the selling cost % on Project Inputs');
    }
    for (const x of phs) per(`fl:ph:${x.ph.id}:proceeds`, `Net exit proceeds: ${x.ph.name}`, proceeds.map((v) => v * x.share), 'Its gross value less its selling costs', { indent: 1 });
    per('fl:proceeds', multi ? 'Net exit proceeds: total' : 'Net exit proceeds', proceeds, 'The gross value less the selling costs, in the exit year on Timeline', { style: 'subtotal' });
  }
  gapRow();

  // ── The funding need ──────────────────────────────────────────────────────
  title('fl:t:need', method === 3 ? 'The funding need (Method 3: the cash short of the minimum)' : 'Cash short of the minimum');
  // THE FUNDING TEST ONLY WHILE CAPEX IS STILL TO BE PAID (2026-11-17, founder): 0 after the last capex year.
  const capexS = sl(fin.capex.perPeriod.exclLandInKind);
  let lastCx = -1; capexS.forEach((v, t) => { if (Math.abs(v ?? 0) > 0.005) lastCx = t; });
  const inWin = (a: number[]): number[] => a.map((v, t) => (t <= lastCx ? v : 0));
  // ZAKAT IS PAID FROM CASH ON HAND, NEVER FUNDED (2026-11-18), and an equity-funded fund fee is
  // drawn in full: neither enters the funding test, so the test reads no figure that reads it back.
  per('fl:opSize', 'Operating cash for the funding test (before ' + TAX.toLowerCase() + ' and fund fees)', add(sl(dcf.cashFromOperationsPerPeriod), neg(sl(dcf.taxPaidPerPeriod)), neg(sl(dcf.fundFeesPaidPerPeriod))), 'Cash collected less opex, selling and marketing, and escrow');
  per('fl:open', 'Opening cash', inWin(sl(w.openingCashPerPeriod)), 'The year before: cash after funding', { balance: true });
  per('fl:avail', '= Cash before financing', inWin(sl(w.cashAvailableBeforeNewDebtPerPeriod)), feeOn && !feeByEquity ? 'Opening cash plus the operating cash above, less the fund fees and capex, plus exit proceeds' : 'Opening cash plus the operating cash above, less capex, plus exit proceeds', { balance: true, style: 'subtotal' });
  per('fl:need', 'Funding need: the cash short of the minimum, in a year capex is paid', sl(w.netCashRequiredPerPeriod), 'Minimum cash on Inputs less the cash before financing, where capex exceeds exit proceeds', { style: 'total' });
  if (feeOn && !feeByEquity && method === 3) {
    // THE FEE-FREE WALK (2026-11-18): the same test with no fund fee in the cash at all, carried
    // from its own close, so the fee base never reads a fee.
    per('fl:xAvail', 'Cash before financing, with no fund fee paid', inWin(sl(w.feeFreeCashAvailablePerPeriod)), 'The figure a year earlier plus its funding need, plus the operating cash above, less capex, plus exit proceeds', { balance: true });
    per('fl:needExFee', 'Funding need with no fund fee paid (the fee base)', sl(w.feeBaseRequirementPerPeriod), 'Minimum cash less the row above, in a year capex is paid');
  }
  if (method === 2) {
    per('fl:m2pre', 'Pre-sales cash collected, net of escrow', sl(gap.preSalesNetPerPeriod), 'Revenue: pre-sales cash, less escrow held, plus escrow released');
    per('fl:m2gap', 'Funding gap: capex less last year\'s net pre-sales', sl(gap.methodAGapPerPeriod), 'Method 2: never below zero');
  }
  per('fl:debtDraw', 'Debt drawn for the funding', sl(fin.debtEquitySplit.debt), method === 3 ? 'The funding need x the debt share' : method === 2 ? 'The gap (plus the minimum cash in the first capex year) x the debt share' : 'Capex excluding land (plus the minimum cash in the first capex year) x the debt share, and land cash x its debt share');
  per('fl:eqDraw', 'Equity drawn for the funding', sl(fin.equity.developmentPerPeriod), method === 3 ? 'The funding need x the equity share' : 'As the debt, at the equity share');
  if (feeByEquity) {
    per('fl:feeDraw', 'Equity drawn for the fund fees', sl(w.managementFeeEquityDrawPerPeriod), 'The whole fee, in a year construction runs; outside the funding need');
  }
  per('fl:after', 'Cash after funding', inWin(sl(w.closingCashAfterFundingPerPeriod)), 'Cash before financing plus the funding need', { balance: true, style: 'subtotal' });
  note('fl:needNote', `${TAX} is paid from cash on hand and is not part of the funding need.`);
  gapRow();

  // ── Each facility ─────────────────────────────────────────────────────────
  const chargeRows: Array<{ key: string; label: string; values: number[]; basis: string }> = [];
  for (const t of tranches) {
    const f = fin.facilities.get(t.id);
    if (!f) continue;
    const isEx = t.origin === 'existing';
    const kind = facilityKind(t);
    title(`fl:t:tr:${t.id}`, `Debt: ${t.name}${isEx ? ' (existing)' : ''}`);
    const closing = sl(f.outstanding);
    per(`fl:tr:${t.id}:open`, 'Opening', closing.map((_, i) => (i === 0 ? 0 : closing[i - 1])), 'The closing balance of the year before', { balance: true });
    per(`fl:tr:${t.id}:draw`, isEx ? 'Drawn in its origination year' : 'Capex drawdown', sl(f.drawSchedule), isEx ? 'The opening balance on Inputs, in the origination year on Inputs' : 'Debt drawn for the funding x the facility\'s share');
    per(`fl:tr:${t.id}:idc`, 'IDC added', sl(f.interestCapitalized), isEx ? 'None: an existing loan pays its interest in cash' : 'The interest charged in a year construction runs, capitalised in full');
    per(`fl:tr:${t.id}:repaid`, kind === 'sweep' ? 'Swept from cash above the minimum' : 'Scheduled principal repaid', neg(sl(f.principalRepaid)), kind === 'sweep' ? 'From the sweep start, the cash above the minimum after debt service x the sweep %' : 'The repayment terms on Inputs');
    // THE EXIT REPAYMENT IN THE FACILITY (2026-11-19, founder: one closing balance, the one the Balance Sheet links).
    const X0 = snap.disposal.booked ? snap.disposal.exitIdx : -1;
    if (X0 >= 0) per(`fl:tr:${t.id}:exitRepaid`, 'Repaid at the exit', closing.map((x, u) => (u === X0 ? -x : 0)), 'Timeline\'s exit year: the balance still outstanding, from the exit proceeds');
    const afterX = closing.map((x, u) => (X0 >= 0 && u >= X0 ? 0 : x));
    per(`fl:tr:${t.id}:close`, 'Closing', afterX, 'Opening plus the draws less the principal repaid, and nothing from the exit (the Balance Sheet)', { balance: true, style: 'subtotal' });
    per(`fl:tr:${t.id}:left`, `Check: ${t.name} after the exit, should be 0`, zeros(), 'Its closing balance in and after the exit year', { balance: true });
    chargeRows.push({ key: `fl:tr:${t.id}:charge`, label: tranches.length > 1 ? `Interest charged: ${t.name}` : 'Interest charged', values: sl(f.interestAccrued), basis: isEx ? 'Opening plus the drawdown, at the rate on Inputs (interbank plus spread)' : 'Construction: rate x (opening + drawdown / 2), divided by (1 - rate / 2) unless the IDC method excludes same-year IDC. Otherwise rate x opening' });
  }
  if (tranches.length > 1) per('fl:debtBs', 'Debt outstanding after the exit repayment', (() => { const v = add(...tranches.map((t) => sl(fin.facilities.get(t.id)?.outstanding))); return v.map((x, u) => (snap.disposal.booked && u >= snap.disposal.exitIdx ? 0 : x)); })(), 'The facilities above', { balance: true });
  gapRow();

  // ── 4. Interest and capitalised interest (2026-11-19, founder): 4.1 the interest and its split, 4.2 the IDC allocation
  // on land area, 4.3 the IDC by line, each with its check. ──
  title('fl:t:int', 'Interest and capitalised interest');
  const c = fin.combined;
  sub('fl:t:int:1', 'Interest', CCY);
  for (const cr of chargeRows) per(cr.key, cr.label, cr.values, cr.basis);
  if (tranches.length > 1) {
    per('fl:drawAll', 'Capex drawdown: all facilities', sl(c.totalDrawdown), 'The facilities in section 3');
    per('fl:idcAll', 'IDC added: all facilities', sl(c.totalInterestCapitalized), 'The facilities in section 3');
    per('fl:intAll', 'Interest charged: all facilities', add(...tranches.map((t) => sl(fin.facilities.get(t.id)?.interestAccrued))), 'The rows above');
  }
  if (tranches.some((t) => facilityKind(t) !== 'sweep') && tranches.length > 1) {
    per('fl:sched', 'Scheduled principal repaid: all facilities', neg(sl(c.totalPrincipalRepaid.map((v, i) => Math.max(0, (v ?? 0) - (c.totalSweepRepaid[i] ?? 0))))), 'The facilities repaid on a schedule');
  }
  per('fl:idcBasis', 'Of which capitalised (IDC)', sl(snap.idc.totalIdcPerPeriod), 'The new facilities\' interest in a year construction runs');
  per('fl:intExp', 'Of which expensed (P&L)', sl(c.totalInterestExpensed), 'Interest charged less what is capitalised');
  per('fl:intChk', 'Check: capitalised + expensed - charged = 0', zeros(), 'Must read 0 in every year');
  {
    const tbl = buildIdcAllocationTables(snap, state, String)[0];
    // 4.2: each line's land (Input column), its construction years, and its share of the year's IDC, only in a year
    // with IDC; the check that the shares add to 100%.
    if (sqmActive && idcLines.length) {
      sub('fl:t:int:2', 'IDC allocation, by land area', 'sqm; 1 = under construction; % of the year\'s IDC');
      note('fl:idcBasisNote', 'Basis: land area, as set on Project Inputs.');
      const idcOn = sl(snap.idc.totalIdcPerPeriod).map((v) => Math.abs(v) > 0.005);
      const landUC: number[][] = [];
      idcLines.forEach((l, i) => {
        const sqmOfLine = idcAssets.filter((x) => l.assetIds.includes(x.assetId)).reduce((a, x) => a + x.landSqm, 0);
        meta(`fl:idcArea:${i}`, `Land area: ${l.title}`, sqmOfLine, 'Land & Area: the plots of the line');
      });
      idcLines.forEach((l, i) => {
        const a0 = state.assets.find((y) => y.id === l.assetIds.find((id) => idcAssets.some((x) => x.assetId === id)));
        const ph = a0 && state.phases.find((q) => q.id === a0.phaseId);
        const v = zeros();
        if (ph) { const s0 = clamp(yearOf(ph) - Y0, 0, N1), cp = ph.constructionPeriods ?? 0; for (let t = s0; t <= (cp > 0 ? Math.min(N1, s0 + cp - 1) : -1); t++) v[t] = 1; }
        const sqmOfLine = idcAssets.filter((x) => l.assetIds.includes(x.assetId)).reduce((a, x) => a + x.landSqm, 0);
        landUC.push(v.map((f) => f * sqmOfLine));
        per(`fl:idcFlag:${i}`, `Under construction: ${l.title}`, v, 'Timeline: the line\'s construction years', { fmt: 'int' });
      });
      const shareRows: number[][] = [];
      idcLines.forEach((l, i) => {
        const sqmOfLine = idcAssets.filter((x) => l.assetIds.includes(x.assetId)).reduce((a, x) => a + x.landSqm, 0);
        const sh = sqmActive!.map((act, t) => (!idcOn[t] ? 0 : act > 0 ? landUC[i][t] / act : idcSqmTot > 0 ? sqmOfLine / idcSqmTot : 0));
        shareRows.push(sh);
        per(`fl:idcShare:${i}`, `IDC share: ${l.title}`, sh, 'Its land x under construction over the lines\' total, in a year with IDC', { fmt: 'pct' });
      });
      per('fl:idcShareChk', 'Check: IDC shares - 100% = 0', zeros(), 'The shares add to 100% in every year with IDC', { fmt: 'pct' });
    }
    // 4.3: each line's IDC, the total and its check.
    if (idcLines.some((_l, i) => tbl?.rows[i])) {
      sub('fl:t:int:3', 'IDC by line', CCY);
      const tot = zeros();
      idcLines.forEach((l, i) => {
        const row = tbl?.rows[i];
        if (row) { per(`fl:idc:${i}`, `IDC: ${l.title}`, sl(row.values), FEEDS_SCHEDULES); sl(row.values).forEach((v, t) => { tot[t] += v; }); }
      });
      per('fl:idcLinesTot', 'IDC by line: total', tot, 'The lines above', { style: 'subtotal' });
      per('fl:idcLineChk', 'Check: IDC by line - capitalised = 0', zeros(), 'Must read 0 in every year');
    }
  }
  gapRow();

  // ── Zakat: worked out on the P&L, read back here for the cash (2026-11-15, founder) ──
  const pl = snap.pl;
  title('fl:t:pbt', TAX);
  sub('fl:t:pbt:1', `${TAX} from the P&L`, CCY);
  per('fl:tax', `${TAX} charge, from the P&L`, sl(pl.taxPerPeriod), 'The charge on the P&L');
  // Paid in the year (0 payment days): no payable, and the charge is what is paid (2026-11-15, founder).
  if (featureUsed(state as never, 'taxPayable')) {
    sub('fl:t:pbt:2', 'Payable at the year end', CCY);
    per('fl:taxPay', `${TAX} payable at the year end`, sl(snap.bs.taxPayablePerPeriod), 'The charge x the payment days on Inputs over 365', { balance: true });
    sub('fl:t:pbt:3', `${TAX} paid`, CCY);
    per('fl:taxPaid', `${TAX} paid`, neg(sl(dcf.taxPaidPerPeriod)), 'The charge less the rise in what is payable');
  }
  gapRow();

  // ── The fund fees ─────────────────────────────────────────────────────────
  if (feeOn) {
    title('fl:t:fee', 'Fund fees');
    const ff = snap.fundFees;
    sub('fl:t:fee:1', 'Fee bases', CCY);
    scalar('fl:feeFund', 'Fund size', ff.fundSize.amount, 'money', fundTerms.fundSizeOverride ? 'The fund size typed on Project Inputs' : 'The funding need with no fund fee in it (debt and equity)');
    scalar('fl:feeTdc', 'Total development cost (excl. selling costs)', ff.totalDevelopmentCost, 'money', 'Capex: the row of that name in the capex summary');
    scalar('fl:feeDsc', 'Debt share x cash development cost', ff.debtShareCashCost, 'money', 'The debt share x the capex paid in cash, less the sales commission');
    if (method === 3) {
      // THE SHADOW FACILITY (2026-11-18): the fee-free draws and the interest capitalised on them.
      let wS = 0, rS = 0;
      for (const t of tranches) { if (t.origin === 'existing') continue; const sh = fin.shares.get(t.id) ?? 0; wS += sh; rS += sh * effectiveTrancheRatePct(t) / 100; }
      const rW = wS > 0 ? rS / wS : 0;
      per('fl:feeEtd', 'Equity to date (cash equity for capex plus land in kind)', sl(ff.equityToDatePerPeriod), 'Cumulative capex equity of the fee-free funding plus land in kind, up to the exit; its peak in Total', { peak: true });
      sub('fl:t:fee:2', 'Fee-free facility, for the arranging fee only', CCY);
      scalar('fl:xRate', 'Interest rate, share-weighted across the loans', rW, 'pct', 'Each new loan\'s rate on Inputs, weighted by its share of the debt');
      const dFv = Math.max(0, fin.funding.debtPct ?? 0) / 100;
      // THE ENGINE'S SHADOW, READ (2026-11-19): the export printed its own working of it, which a monthly model did
      // not reproduce; the engine publishes the series it sizes the facility on (TRAPS 7.60).
      const xIdc = zeros(), xBal = zeros();
      if (ff.shadowIdcPerPeriod && ff.shadowDebtBalancePerPeriod) { sl(ff.shadowIdcPerPeriod).forEach((v, t) => { xIdc[t] = v; }); sl(ff.shadowDebtBalancePerPeriod).forEach((v, t) => { xBal[t] = v; }); }
      else { let b = 0; const excl = p.idcConfig?.interestMethod === 'mid_year_excl'; const need = sl(w.feeBaseRequirementPerPeriod);
        for (let t = 0; t < N; t++) { const d = (need[t] ?? 0) * dFv; const i = fin.idcPeriodMask[t] ? rW * (b + d / 2) / (excl ? 1 : 1 - rW / 2) : 0; b += d + i; xIdc[t] = i; xBal[t] = b; } }
      per('fl:xIdc', 'Capitalised interest on the fee-free debt', xIdc, 'In a year construction runs: the rate x (last year\'s balance + the fee-free debt drawn / 2), by the IDC method');
      per('fl:xBal', 'Fee-free debt balance (construction)', xBal, 'Last year\'s balance plus the fee-free debt drawn and its capitalised interest', { balance: true });
    }
    scalar('fl:feeFac', 'Total facility (capex debt + IDC)', ff.totalFacility, 'money', method === 3 ? 'The fee-free debt drawn plus its capitalised interest' : 'Every new loan\'s capex drawdown plus its interest drawn as debt');
    if (!rows.some((x) => x.key === 'fl:feeEtd')) per('fl:feeEtd', 'Equity to date (cash equity for capex plus land in kind)', sl(ff.equityToDatePerPeriod), 'Cumulative capex equity of the fee-free funding plus land in kind, up to the exit; its peak in Total', { peak: true });
    if (method === 3) note('fl:xNote', 'Shadow walk without fees or the sweep, so the arranging fee does not depend on itself (keeps the model non-circular).');
    sub('fl:t:fee:3', 'Fees', CCY);
    FUND_FEE_SPECS.forEach((spec, i) => {
      const base = (FEE_BASE_LABELS[feeBaseFor(spec, fundTerms)] ?? spec.base).toLowerCase();
      per(`fl:fee:${i}`, spec.label, sl(ff.lines[i]?.amountPerPeriod), spec.kind === 'amount' ? 'The amount on Inputs, each year to the exit' : spec.timing === 'one_time' ? `The rate on Inputs x the basis on Inputs, in the first draw year (now the ${base})` : `The rate on Inputs x the ${base}, each year to the exit`, { indent: 1 });
    });
    per('fl:feeTot', 'Fund fees: total', sl(ff.totalPerPeriod), 'The fees above', { style: 'subtotal' });
    gapRow();
  }

  // ── The cash waterfall, the sweep and dividends ───────────────────────────
  title('fl:t:cw', 'Cash waterfall: debt service, the sweep and dividends');
  scalar('fl:payout', 'Dividend payout ratio', Math.max(0, Math.min(1, (p.dividendPolicy?.payoutRatio ?? 0) / 100)), 'pct', 'The ratio on Inputs, between 0% and 100%');
  per('fl:cwOpen', 'Opening cash', sl(dcf.openingCashPerPeriod), 'The closing cash of the year before', { balance: true });
  per('fl:cfo', '(+) Cash from operations', sl(dcf.cashFromOperationsPerPeriod), feeByEquity ? 'Operating cash before financing, less the fund fees' : 'Operating cash before financing');
  // Two rows, one each (2026-11-15, founder): the capex paid in cash, and the exit proceeds.
  {
    const capexCash = sl(fin.capex.perPeriod.exclLandInKind);
    const cfi = sl(dcf.cashFromInvestmentPerPeriod);
    per('fl:cfiCapex', '(-) Capex paid in cash', capexCash.map((v) => -v), 'Above');
    per('fl:cfiExit', '(+) Exit proceeds', cfi.map((v, t) => v + (capexCash[t] ?? 0)), 'Above');
  }
  per('fl:eqCash', '(+) Equity drawn in cash', sl(dcf.equityDrawdownPerPeriod), feeByEquity ? 'For the funding and for the fund fees' : 'For the funding');
  per('fl:debtCash', '(+) Debt drawn (capex and interest)', sl(dcf.debtDrawdownPerPeriod), 'Every facility\'s capex drawdown and interest drawn as debt');
  per('fl:intPaid', '(-) Interest paid', sl(dcf.interestPaidPerPeriod), 'Interest charged, all facilities');
  per('fl:cash', '= Cash available', add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod)), 'The rows above', { balance: true, style: 'subtotal' });
  per('fl:exitRepay', 'Debt repaid at the exit', sl(snap.disposal.debtRepaidPerPeriod), 'Timeline\'s exit year: every balance still outstanding');
  if (anySweep) {
    // The cash above the minimum after the scheduled principal and the exit repayment: what a sweep may take.
    const cashV = add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod));
    const schedV = sl(c.totalPrincipalRepaid.map((v, i) => Math.max(0, (v ?? 0) - (c.totalSweepRepaid[i] ?? 0))));
    const exitV = sl(snap.disposal.debtRepaidPerPeriod);
    const minR = Math.max(0, p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0);
    void exitV;
    const exitAt = snap.disposal.booked ? snap.disposal.exitIdx : -1;
    // THE ENGINE'S FIGURE (2026-11-18): the cash sweep's own "sweep available", which the formula restates.
    void cashV; void schedV; void minR; void exitAt;
    per('fl:sweepLeft', 'Cash above the minimum, before the sweep', sl(snap.cashSweep.sweepAvailablePerPeriod ?? []), 'Cash available less the scheduled principal and the minimum cash; none in the exit year');
  }
  per('fl:repaidCash', '(-) Debt repaid (scheduled, swept and at the exit)', sl(dcf.debtRepaymentPerPeriod), 'Each facility\'s principal repaid, and the exit repayment');
  const forDiv = add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod), sl(dcf.debtRepaymentPerPeriod));
  per('fl:forDiv', '= Cash available for dividends', forDiv, 'Cash available less the debt repaid', { balance: true, style: 'subtotal' });
  {
    // The cash above the minimum (2026-11-07): each phase's dividend and the exit sweep read this row.
    const minRes = Math.max(0, Number(state.project.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0) || 0);
    const from = snap.cashSweep.minCashFromIdx ?? 0;
    per('fl:excess', 'Cash above the minimum balance', forDiv.map((v, t) => { const m = t >= from ? minRes : 0; return Math.round((v - m) * 100) / 100 <= 0 ? 0 : v - m; }), 'Cash available for dividends less the minimum cash on Inputs, never below zero', { indent: 1, balance: true });
  }
  {
    // ONE PROJECT DIVIDEND, CAPPED AT THE RETAINED EARNINGS (2026-11-18, founder): no per-phase cap.
    const row = snap.dividends.afterSweepPhases[0];
    const above = p.dividendPolicy?.allowAboveRetainedEarnings === true;
    if (p.dividendPolicy?.mode === 'pct_of_ebitda') per('fl:ebitda', 'Project EBITDA (the P&L)', sl(snap.pl.ebitdaPerPeriod), 'P&L: the project EBITDA, after the fund fees', { indent: 1 });
    {
      const re = sl(snap.bs.retainedEarningsPerPeriod);
      const transfer = sl(snap.bs.statutoryReserveTransferPerPeriod);
      const pat = sl(snap.pl.patPerPeriod);
      // THE ENGINE'S FIGURE (2026-11-18): the cap the dividend read (createEquitySplitter.available), which the formula restates.
      void pat; void re; void transfer;
      per('fl:reAvail', 'Retained earnings, from the Balance Sheet', sl(snap.dividends.retainedEarningsAvailablePerPeriod ?? []), 'Retained earnings a year earlier plus the profit after tax of the year, less the reserve transfer, never below zero', { indent: 1 });
    }
    per('fl:divP', 'Dividend before the exit', sl(row?.dividendsPerPeriod), above ? 'The payout of the cash above the minimum; the part beyond the retained earnings is a return of capital' : 'The payout of the cash above the minimum, up to the retained earnings available', { indent: 1 });
  }
  per('fl:div', '(-) Dividends paid', neg(sl(snap.dividends.totalDividendsPerPeriod)), 'The dividend, and in the exit year all the cash above the minimum');
  per('fl:close', '= Closing cash', sl(dcf.closingCashPerPeriod), 'Cash available for dividends less the dividends (ties to the Cash Flow and the Balance Sheet)', { balance: true, style: 'total' });
  // Each facility's balance after the exit repayment sits in section 3 (2026-11-19, founder).

  // A SETTING SITS IN THE SECTION THAT USES IT (2026-11-15, founder): no settings block on top. A plain copy
  // of an Inputs cell is not a row at all (the live workbook links Inputs directly: formulaWorkbook.ts).
  const place = (pred: (k: string) => boolean, after: (k: string) => boolean): void => {
    const moving = rows.filter((x) => pred(x.key));
    if (!moving.length) return;
    for (const m of moving) rows.splice(rows.indexOf(m), 1);
    const at = rows.findIndex((x) => after(x.key));
    if (at < 0) { rows.unshift(...moving); return; }
    rows.splice(at + 1, 0, ...moving);
  };
  const setIdx = rows.findIndex((x) => x.key === 'fl:t:set');
  if (setIdx >= 0) rows.splice(setIdx, 1);
  place((k) => ['fl:dF', 'fl:eF', 'fl:landDebt'].includes(k), (k) => k === 'fl:t:need');
  place((k) => ['fl:lastCon', 'fl:sweepStart'].includes(k), (k) => k.startsWith('fl:t:tr:'));
  for (const t of tranches) place((k) => new RegExp(`^fl:tr:${t.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(rate|td|start|n|fin|pmt)$`).test(k), (k) => k === `fl:t:tr:${t.id}`);
  place((k) => k === 'fl:divStart', (k) => k === 'fl:payout');
  place((k) => k === 'fl:firstDraw', (k) => k === 'fl:t:fee:1:u');
  place((k) => k === 'fl:idcExcl', (k) => k === 'fl:t:int:1:u');
  // The first gap row a removed block leaves at the top goes.
  while (rows[0]?.kind === 'gap') rows.shift();
  return { rows, ctx: { method, feeOn, feeByEquity, zakat, cit, taxLag, anySweep, booked, idcLines } };
}
