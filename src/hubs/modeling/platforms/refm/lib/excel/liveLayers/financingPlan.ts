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
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { buildIdcAllocationTables } from '../../reports/financingReports';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import type { FinancingTranche } from '../../state/module1-types';
import { expensedRowsOf } from '../expensedRows';
import { effectiveTrancheRatePct } from '@/src/core/calculations/financing';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;
export type FinFmt = 'money' | 'pct' | 'year' | 'int';
export interface FinRow {
  key: string;
  label: string;
  basis?: string;
  kind: 'title' | 'period' | 'scalar' | 'gap';
  values?: number[];
  value?: number;
  fmt?: FinFmt;
  /** A balance: its Total is the last year, never a sum. */
  balance?: boolean;
  /** A value the row reads from another tab, shown in its Input column (a line's land, 2026-11-15). */
  metaB?: number;
  style?: 'total' | 'subtotal';
  indent?: number;
}

/** The loop's capitalised interest, sent back to Schedules and Capex: the row says so. */
export const FEEDS_SCHEDULES = 'Feeds Schedules (interest loop)';

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
  idcLines: Array<{ title: string; assetIds: string[] }>;
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

  // ── Settings in force ──────────────────────────────────────────────────────
  title('fl:t:set', 'Settings in force (worked out from Inputs)');
  scalar('fl:lastCon', 'Last construction year', Y0 + cend - 1, 'year', 'The latest phase\'s start plus its construction years, less one');
  const dF = Math.max(0, fin.funding.debtPct ?? 0) / 100;
  scalar('fl:dF', 'Debt share of the funding', dF, 'pct', 'Debt % over debt % plus equity % on Inputs; 0 where neither is typed');
  scalar('fl:eF', 'Equity share of the funding', 1 - dF, 'pct', 'One less the debt share');
  scalar('fl:idcExcl', 'IDC method excludes same-year IDC (1 = yes)', p.idcConfig?.interestMethod === 'mid_year_excl' ? 1 : 0, 'int', 'The IDC method on Inputs: 1 where it reads "excluding same-year IDC"');
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
  const idcLines = planReportLines(lineState, (a) => snap.idc.byAsset.has(a.id)).map((l) => ({ title: lineTitle(l, lineState), assetIds: [...l.assetIds] }));
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

  // ── Capex, the exit and the operating cash ────────────────────────────────
  title('fl:t:ops', 'Capex, the exit and operating cash');
  per('fl:capex', 'Capex paid in cash', sl(fin.capex.perPeriod.exclLandInKind), 'Capex: Table 2 less the land contributed in kind (Table 5)');
  if (method !== 3) {
    per('fl:landCash', '  of which land paid in cash', sl(fin.capex.perPeriod.landCash), 'Capex Table 5', { indent: 1 });
    per('fl:nonLand', '  of which capex excluding land', sl(fin.capex.perPeriod.exclAllLand), 'Capex paid in cash less the land paid in cash', { indent: 1 });
  }
  per('fl:inKind', 'Land contributed in kind (equity, not cash)', sl(fin.equity.inKindPerPeriod), 'Capex Table 5');
  {
    const noi = zeros();
    for (const pa of snap.perAssetPL.values()) if (pa.strategy === 'Operate' || pa.strategy === 'Lease') for (let t = 0; t < N; t++) noi[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
    per('fl:noi', 'Income of the held assets (NOI)', noi, 'Revenue less opex of the hotel and lease lines');
    const proceeds = zeros();
    if (snap.disposal.booked) proceeds[snap.disposal.exitIdx] = snap.disposal.proceeds;
    per('fl:proceeds', 'Exit proceeds (the held assets sold, in the exit year)', proceeds, 'Timeline\'s exit year: the income of the year Inputs names (the exit year or the year before) valued at the exit terms');
    // EXIT PROCEEDS BY PHASE (2026-10-29): each phase's share of the proceeds is its held lines'
    // income in the basis year over the project's, so the phases add to the project exactly.
    if (state.phases.length > 1) {
      for (const ph of state.phases) {
        const v = heldIncomePerPeriod(snap, state, ph.id);
        per(`fl:ph:${ph.id}:noi`, `${ph.name}: income of its held assets (NOI)`, v, 'Revenue less opex of the phase\'s hotel and lease lines', { indent: 1 });
        const share = phaseProceedsShare(snap, state, ph.id);
        per(`fl:ph:${ph.id}:proceeds`, `${ph.name}: exit proceeds`, proceeds.map((x) => x * share), 'The exit proceeds x the phase\'s share of the income in the basis year', { indent: 1 });
      }
    }
  }
  per('fl:collected', 'Revenue: cash collected', sl(dcf.revenueReceivedPerPeriod), 'Revenue: each line\'s cash collected');
  per('fl:opexPaid', '(-) Opex paid, lines and HQ', add(sl(dcf.opexPaidPerPeriod), sl(dcf.hqOpexPaidPerPeriod)), 'Opex: each line\'s opex less the rise in its payable');
  // Selling and marketing expensed has a block on Capex only where a line is expensed; escrow on Revenue only where a line holds escrow.
  if (expensedRowsOf(state, snap, state.assets.filter((a) => a.visible !== false).map((a) => a.id), (_a, _l, valued) => valued).length) per('fl:mkt', '(-) Selling and marketing paid as incurred', sl(dcf.sellingExpensePaidPerPeriod), 'Capex: selling and marketing expensed');
  if (snap.escrow.byAsset.size > 0 && escrowInForce(state as never)) per('fl:esc', 'Escrow: pre-sales cash held back and released', sl(dcf.netRevenueAdjustmentPerPeriod), 'Revenue: net escrow cash flow');
  per('fl:taxPaidOps', `(-) ${TAX} paid`, sl(dcf.taxPaidPerPeriod), `The ${TAX.toLowerCase()} paid, below`);
  if (feeOn && !feeByEquity) per('fl:feeOps', '(-) Fund fees paid', sl(dcf.fundFeesPaidPerPeriod), 'The fund fees, below: inside the funding need');
  const opIn = add(sl(dcf.cashFromOperationsPerPeriod), feeOn && feeByEquity ? neg(sl(dcf.fundFeesPaidPerPeriod)) : zeros());
  per('fl:opIn', '= Operating cash before financing', opIn, 'The rows above', { style: 'subtotal' });
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
    per('fl:feeDraw', 'Equity drawn for the fund fees', sl(w.managementFeeEquityDrawPerPeriod), 'The whole fee, in a year capex is paid; outside the funding need');
  }
  per('fl:after', 'Cash after funding', inWin(sl(w.closingCashAfterFundingPerPeriod)), 'Cash before financing plus the funding need', { balance: true, style: 'subtotal' });
  gapRow();

  // ── Each facility ─────────────────────────────────────────────────────────
  for (const t of tranches) {
    const f = fin.facilities.get(t.id);
    if (!f) continue;
    const isEx = t.origin === 'existing';
    const kind = facilityKind(t);
    title(`fl:t:tr:${t.id}`, `Debt: ${t.name}${isEx ? ' (existing)' : ''}`);
    const closing = sl(f.outstanding);
    per(`fl:tr:${t.id}:open`, 'Opening', closing.map((_, i) => (i === 0 ? 0 : closing[i - 1])), 'The closing balance of the year before', { balance: true });
    per(`fl:tr:${t.id}:draw`, isEx ? 'Drawn in its origination year' : 'Capex drawdown', sl(f.drawSchedule), isEx ? 'The opening balance on Inputs, in the origination year on Inputs' : 'Debt drawn for the funding x the facility\'s share');
    per(`fl:tr:${t.id}:idc`, 'Interest drawn as debt', sl(f.interestCapitalized), isEx ? 'None: an existing loan pays its interest in cash' : 'The interest charged in a year construction runs, capitalised in full');
    per(`fl:tr:${t.id}:repaid`, kind === 'sweep' ? '(-) Swept from cash above the minimum' : '(-) Scheduled principal', neg(sl(f.principalRepaid)), kind === 'sweep' ? 'From the sweep start, the cash above the minimum after debt service x the sweep %' : 'The repayment terms on Inputs');
    per(`fl:tr:${t.id}:close`, 'Closing', closing, 'Opening plus the draws less the principal repaid', { balance: true, style: 'subtotal' });
    per(`fl:tr:${t.id}:charge`, 'Interest charged', sl(f.interestAccrued), isEx ? 'Opening plus the drawdown, at the rate on Inputs (interbank plus spread)' : 'Construction: rate x (opening + drawdown / 2), divided by (1 - rate / 2) unless the IDC method excludes same-year IDC. Otherwise rate x opening');
  }
  gapRow();

  // ── Interest ──────────────────────────────────────────────────────────────
  title('fl:t:int', 'Interest');
  const c = fin.combined;
  if (tranches.length > 1) {
    per('fl:drawAll', 'Capex drawdown, all facilities', sl(c.totalDrawdown), 'The facilities above');
    per('fl:idcAll', 'Interest drawn as debt, all facilities', sl(c.totalInterestCapitalized), 'The facilities above');
    per('fl:intAll', 'Interest charged, all facilities', add(...tranches.map((t) => sl(fin.facilities.get(t.id)?.interestAccrued))), 'The facilities above');
  }
  if (tranches.some((t) => facilityKind(t) !== 'sweep') && tranches.length > 1) {
    per('fl:sched', '(-) Scheduled principal, all facilities', neg(sl(c.totalPrincipalRepaid.map((v, i) => Math.max(0, (v ?? 0) - (c.totalSweepRepaid[i] ?? 0))))), 'The facilities repaid on a schedule');
  }
  per('fl:idcBasis', 'Capitalised interest', sl(snap.idc.totalIdcPerPeriod), 'The new facilities\' interest in a year construction runs');
  per('fl:intExp', '(-) Interest expensed', neg(sl(c.totalInterestExpensed)), 'Interest charged less what is capitalised');
  {
    const tbl = buildIdcAllocationTables(snap, state, String)[0];
    // THE IDC ALLOCATION BY LINE (2026-11-12, founder: kept, compact): one row per line under one heading.
    if (idcLines.some((_l, i) => tbl?.rows[i])) title('fl:t:idc', 'Capitalised interest (IDC) allocated by line');
    // THE IDC ALLOCATION IN SIMPLE ROWS (2026-11-15, founder): each line's land under construction (its land
    // from Land & Area in the Input column), the total, each line's share, then its IDC (rows below).
    if (sqmActive) {
      scalar('fl:sqmTot', 'Land of the assets that share capitalised interest (sqm)', idcSqmTot, 'int', 'The lines\' land below');
      const landUC: number[][] = [];
      idcLines.forEach((l, i) => {
        const sqmOfLine = idcAssets.filter((x) => l.assetIds.includes(x.assetId)).reduce((a, x) => a + x.landSqm, 0);
        const a0 = state.assets.find((y) => y.id === l.assetIds.find((id) => idcAssets.some((x) => x.assetId === id)));
        const ph = a0 && state.phases.find((q) => q.id === a0.phaseId);
        const v = zeros();
        if (ph) { const s0 = clamp(yearOf(ph) - Y0, 0, N1), cp = ph.constructionPeriods ?? 0; for (let t = s0; t <= (cp > 0 ? Math.min(N1, s0 + cp - 1) : -1); t++) v[t] = sqmOfLine; }
        landUC.push(v);
        per(`fl:idcLand:${i}`, `${l.title}: land under construction (sqm)`, v, 'Its land (Input column) in its construction years', { fmt: 'int', metaB: sqmOfLine, indent: 1 });
      });
      per('fl:sqmActive', 'Land under construction (sqm)', sqmActive, 'The lines above', { fmt: 'int' });
      idcLines.forEach((l, i) => {
        const sqmOfLine = idcAssets.filter((x) => l.assetIds.includes(x.assetId)).reduce((a, x) => a + x.landSqm, 0);
        const sh = sqmActive!.map((act, t) => (act > 0 ? landUC[i][t] / act : idcSqmTot > 0 ? sqmOfLine / idcSqmTot : 0));
        per(`fl:idcShare:${i}`, `${l.title}: share of the capitalised interest`, sh, 'Its land under construction over the total', { fmt: 'pct', indent: 1 });
      });
    }
    idcLines.forEach((l, i) => {
      const row = tbl?.rows[i];
      if (row) per(`fl:idc:${i}`, l.title, sl(row.values), FEEDS_SCHEDULES, { indent: 1 });
    });
    if (snap.idc.capitalize) {
      const heldIdc = idcLines.some((l) => l.assetIds.some((id) => { const a = state.assets.find((x) => x.id === id); return a?.strategy === 'Operate' || a?.strategy === 'Lease'; }));
      const tables = buildIdcAllocationTables(snap, state, String);
      const disp = tables.flatMap((t) => t.rows).find((r) => r.label.startsWith('Disposed at Exit'));
      // Read by nothing (2026-11-15, founder): Schedules writes the capitalised interest off at the exit.
      if (heldIdc && booked && (false as boolean)) per('fl:idcDisp', '(-) Capitalised interest written off at the exit', sl(disp?.values ?? zeros()), 'Schedules: the held lines\' capitalised interest left at the exit, sold with the asset');
    }
  }
  gapRow();

  // ── Zakat: worked out on the P&L, read back here for the cash (2026-11-15, founder) ──
  const pl = snap.pl;
  title('fl:t:pbt', TAX);
  per('fl:tax', `${TAX} (the P&L)`, sl(pl.taxPerPeriod), 'The charge on the P&L');
  // Paid in the year (0 payment days): no payable, and the charge is what is paid (2026-11-15, founder).
  if (featureUsed(state as never, 'taxPayable')) {
    per('fl:taxPay', `${TAX} payable at the year end`, sl(snap.bs.taxPayablePerPeriod), 'The charge x the payment days on Inputs over 365', { balance: true });
    per('fl:taxPaid', `${TAX} paid`, neg(sl(dcf.taxPaidPerPeriod)), 'The charge less the rise in what is payable');
  }
  gapRow();

  // ── The fund fees ─────────────────────────────────────────────────────────
  if (feeOn) {
    title('fl:t:fee', 'Fund fees (on the funding need with the fees left out)');
    const ff = snap.fundFees;
    scalar('fl:feeEq', 'Capex equity', ff.totalEquity.amount, 'money', 'The fee base x the equity share');
    scalar('fl:feeDebt', 'Debt facility', ff.debtFacility.amount, 'money', 'The fee base x the debt share');
    scalar('fl:feeFund', '= Fund size', ff.fundSize.amount, 'money', fundTerms.fundSizeOverride ? 'The fund size typed on Inputs' : 'Capex equity plus the debt facility');
    FUND_FEE_SPECS.forEach((spec, i) => per(`fl:fee:${i}`, spec.label, sl(ff.lines[i]?.amountPerPeriod), spec.kind === 'amount' ? 'The amount on Inputs, each year to the exit' : spec.timing === 'one_time' ? `The rate on Inputs x the ${spec.base.replace(/_/g, ' ')}, in the first draw year` : `The rate on Inputs x the ${spec.base.replace(/_/g, ' ')}, each year to the exit`, { indent: 1 }));
    per('fl:feeTot', 'Total fund fees', sl(ff.totalPerPeriod), 'The fees above', { style: 'subtotal' });
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
    per('fl:sweepLeft', 'Cash above the minimum, before the sweep', cashV.map((v, t) => Math.max(0, v - (schedV[t] ?? 0) - (exitV[t] ?? 0) - minR)), 'Cash available less the scheduled principal, the exit repayment and the minimum cash');
  }
  per('fl:repaidCash', '(-) Debt repaid (scheduled, swept and at the exit)', sl(dcf.debtRepaymentPerPeriod), 'Each facility\'s principal repaid, and the exit repayment');
  const forDiv = add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod), sl(dcf.debtRepaymentPerPeriod));
  per('fl:forDiv', '= Cash available for dividends', forDiv, 'Cash available less the debt repaid', { balance: true, style: 'subtotal' });
  {
    // The cash above the minimum (2026-11-07): each phase's dividend and the exit sweep read this row.
    const minRes = Math.max(0, Number(state.project.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0) || 0);
    per('fl:excess', 'Cash above the minimum balance', forDiv.map((v) => (Math.round((v - minRes) * 100) / 100 <= 0 ? 0 : v - minRes)), 'Cash available for dividends less the minimum cash on Inputs, never below zero', { indent: 1, balance: true });
  }
  {
    const rowsP = [...snap.dividends.beforeSweepPhases, ...snap.dividends.afterSweepPhases];
    for (const ph of state.phases) {
      const rp = rowsP.find((x) => x.phaseId === ph.id);
      const eb = rp ? sl(rp.phaseEbitdaPerPeriod) : (() => {
        const v = zeros();
        for (const a of state.assets.filter((x) => x.visible !== false && x.phaseId === ph.id)) {
          const pa = snap.perAssetPL.get(a.id);
          if (pa) for (let t = 0; t < N; t++) v[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.cosPerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
        }
        const own = snap.pl.sellingExpenseByPhase?.[ph.id] ?? [];
        for (let t = 0; t < N; t++) v[t] -= own[t] ?? 0;
        return v;
      })();
      per(`fl:ph:${ph.id}:ebitda`, `${ph.name}: EBITDA (the phase P&L)`, eb, 'P&L: the phase\'s EBITDA, its own marketing charged and no HQ', { indent: 1 });
      per(`fl:ph:${ph.id}:div`, `${ph.name}: dividend`, sl(rp?.dividendsPerPeriod), 'The payout of the cash above the minimum, capped at the phase\'s EBITDA to date', { indent: 1 });
    }
  }
  per('fl:div', '(-) Dividends paid', neg(sl(snap.dividends.totalDividendsPerPeriod)), 'The phases\' dividends, and in the exit year all the cash above the minimum');
  per('fl:close', '= Closing cash', sl(dcf.closingCashPerPeriod), 'Cash available for dividends less the dividends (ties to the Cash Flow and the Balance Sheet)', { balance: true, style: 'total' });
  // Each facility's balance after the exit repayment (2026-11-03): the Balance Sheet links each one.
  const afterExit = (v: number[]): number[] => v.map((x, t) => (snap.disposal.booked && t >= snap.disposal.exitIdx ? 0 : x));
  for (const t of tranches) per(`fl:tr:${t.id}:bs`, `${t.name}: outstanding after the exit repayment`, afterExit(sl(fin.facilities.get(t.id)?.outstanding)), 'Its closing balance, nothing from the exit year (the Balance Sheet)', { balance: true, indent: 1 });
  // With one facility its own row says it (2026-11-15, founder).
  if (tranches.length > 1) per('fl:debtBs', 'Debt outstanding after the exit repayment', afterExit(add(...tranches.map((t) => sl(fin.facilities.get(t.id)?.outstanding)))), 'The facilities above', { balance: true });

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
  place((k) => k === 'fl:firstDraw', (k) => k === 'fl:t:fee');
  // The first gap row a removed block leaves at the top goes.
  while (rows[0]?.kind === 'gap') rows.shift();
  return { rows, ctx: { method, feeOn, feeByEquity, zakat, cit, taxLag, anySweep, booked, idcLines } };
}
