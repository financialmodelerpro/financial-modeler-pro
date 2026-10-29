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
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../../financials-resolvers';
import { resolveFundTerms, FUND_FEE_SPECS } from '../../fundTerms';
import { resolveReturnsConfig } from '../../returns-resolvers';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import { buildIdcAllocationTables } from '../../reports/financingReports';
import { sharesCapitalisedInterest } from '@/src/core/calculations/capitalisedInterest';
import type { FinancingTranche } from '../../state/module1-types';
import { expensedRowsOf } from '../expensedRows';

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
  const taxLag = (p.tax?.paymentDays ?? 0) > 0;
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
  scalar('fl:dF', 'Debt share of the funding', dF, 'pct', 'Debt % over debt % plus equity % on Inputs; 70% where neither is typed, the platform\'s default');
  scalar('fl:eF', 'Equity share of the funding', 1 - dF, 'pct', 'One less the debt share');
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
  const idcAssets = [...snap.idc.byAsset.values()];
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const idcLines = planReportLines(lineState, (a) => snap.idc.byAsset.has(a.id)).map((l) => ({ title: lineTitle(l, lineState), assetIds: [...l.assetIds] }));
  if (idcAssets.length) {
    scalar('fl:sqmTot', 'Land of the assets that share capitalised interest (sqm)', idcAssets.reduce((a, x) => a + x.landSqm, 0), 'int', 'Each asset\'s land, the basis the interest is shared on');
    const active = zeros();
    for (const x of idcAssets) {
      const a = state.assets.find((y) => y.id === x.assetId);
      const ph = a && state.phases.find((q) => q.id === a.phaseId);
      if (!ph || !a || !sharesCapitalisedInterest(a)) continue;
      const s0 = clamp(yearOf(ph) - Y0, 0, N1), cp = ph.constructionPeriods ?? 0;
      for (let t = s0; t <= (cp > 0 ? Math.min(N1, s0 + cp - 1) : -1); t++) active[t] += x.landSqm;
    }
    per('fl:sqmActive', 'Land under construction (sqm)', active, 'The land of the assets building in the year');
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
      const M = snap.disposal.metricIdx;
      for (const ph of state.phases) {
        const v = zeros();
        for (const pa of snap.perAssetPL.values()) {
          if (pa.strategy !== 'Operate' && pa.strategy !== 'Lease') continue;
          if (state.assets.find((a) => a.id === pa.assetId)?.phaseId !== ph.id) continue;
          for (let t = 0; t < N; t++) v[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
        }
        per(`fl:ph:${ph.id}:noi`, `${ph.name}: income of its held assets (NOI)`, v, 'Revenue less opex of the phase\'s hotel and lease lines', { indent: 1 });
        const share = (noi[M] ?? 0) !== 0 ? (v[M] ?? 0) / noi[M] : 0;
        per(`fl:ph:${ph.id}:proceeds`, `${ph.name}: exit proceeds`, proceeds.map((x) => x * share), 'The exit proceeds x the phase\'s share of the income in the basis year', { indent: 1 });
      }
    }
  }
  per('fl:collected', 'Revenue: cash collected', sl(dcf.revenueReceivedPerPeriod), 'Revenue: each line\'s cash collected');
  per('fl:opexPaid', '(-) Opex paid, lines and HQ', add(sl(dcf.opexPaidPerPeriod), sl(dcf.hqOpexPaidPerPeriod)), 'Opex: each line\'s opex less the rise in its payable');
  // Selling and marketing expensed has a block on Capex only where a line is expensed; escrow on Revenue only where a line holds escrow.
  if (expensedRowsOf(state, snap, state.assets.filter((a) => a.visible !== false).map((a) => a.id), (_a, _l, valued) => valued).length) per('fl:mkt', '(-) Selling and marketing paid as incurred', sl(dcf.sellingExpensePaidPerPeriod), 'Capex: selling and marketing expensed');
  if (snap.escrow.byAsset.size > 0) per('fl:esc', 'Escrow: pre-sales cash held back and released', sl(dcf.netRevenueAdjustmentPerPeriod), 'Revenue: net escrow cash flow');
  per('fl:taxPaidOps', `(-) ${TAX} paid`, sl(dcf.taxPaidPerPeriod), `The ${TAX.toLowerCase()} paid, below`);
  if (feeOn && !feeByEquity) per('fl:feeOps', '(-) Fund fees paid', sl(dcf.fundFeesPaidPerPeriod), 'The fund fees, below: inside the funding need');
  const opIn = sl(w.operatingInflowsPerPeriod);
  per('fl:opIn', '= Operating cash before financing', opIn, 'The rows above', { style: 'subtotal' });
  gapRow();

  // ── The funding need ──────────────────────────────────────────────────────
  title('fl:t:need', method === 3 ? 'The funding need (Method 3: the cash short of the minimum)' : 'Cash short of the minimum (sizes the interest drawn as debt)');
  per('fl:open', 'Opening cash', sl(w.openingCashPerPeriod), 'The year before: cash after funding', { balance: true });
  per('fl:avail', '= Cash before financing', sl(w.cashAvailableBeforeNewDebtPerPeriod), 'Opening cash plus operating cash, less capex, plus exit proceeds', { balance: true, style: 'subtotal' });
  per('fl:need', 'Funding need: the cash short of the minimum, in a year capex is paid', sl(w.netCashRequiredPerPeriod), 'Minimum cash on Inputs less the cash before financing, where capex exceeds exit proceeds', { style: 'total' });
  if (feeOn && !feeByEquity && method === 3) per('fl:needExFee', 'Funding need with the fund fees left out (the fee base)', sl(w.feeBaseRequirementPerPeriod), 'As above, with the fees added back to the cash');
  if (method === 2) {
    per('fl:m2pre', 'Pre-sales cash collected, net of escrow', sl(gap.preSalesNetPerPeriod), 'Revenue: pre-sales cash, less escrow held, plus escrow released');
    per('fl:m2gap', 'Funding gap: capex less last year\'s net pre-sales', sl(gap.methodAGapPerPeriod), 'Method 2: never below zero');
  }
  per('fl:debtDraw', 'Debt drawn for the funding', sl(fin.debtEquitySplit.debt), method === 3 ? 'The funding need x the debt share' : method === 2 ? 'The gap (plus the minimum cash in the first capex year) x the debt share' : 'Capex excluding land (plus the minimum cash in the first capex year) x the debt share, and land cash x its debt share');
  per('fl:eqDraw', 'Equity drawn for the funding', sl(fin.equity.developmentPerPeriod), method === 3 ? 'The funding need x the equity share' : 'As the debt, at the equity share');
  if (feeByEquity) {
    per('fl:feeDraw', 'Equity drawn for the fund fees', sl(w.managementFeeEquityDrawPerPeriod), 'While capex is paid, as far as keeps cash at the minimum once the fees are paid');
    per('fl:feePaid', '(-) Fund fees paid', neg(sl(w.fundFeesPerPeriod)), 'The fund fees, below: drawn from equity outside the funding need');
  }
  per('fl:after', 'Cash after funding, before interest', sl(w.closingCashAfterFundingPerPeriod), 'Cash before financing plus the funding need', { balance: true, style: 'subtotal' });
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
    per(`fl:tr:${t.id}:idc`, 'Interest drawn as debt', sl(f.interestCapitalized), 'Construction interest the cash above the minimum cannot pay');
    per(`fl:tr:${t.id}:repaid`, kind === 'sweep' ? '(-) Swept from cash above the minimum' : '(-) Scheduled principal', neg(sl(f.principalRepaid)), kind === 'sweep' ? 'From the sweep start, the cash above the minimum after debt service x the sweep %' : 'The repayment terms on Inputs');
    per(`fl:tr:${t.id}:close`, 'Closing', closing, 'Opening plus the draws less the principal repaid', { balance: true, style: 'subtotal' });
    per(`fl:tr:${t.id}:charge`, 'Interest charged', sl(f.interestAccrued), 'Opening plus the capex drawdown, at the rate on Inputs (interbank plus spread)');
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
    idcLines.forEach((l, i) => {
      const row = tbl?.rows[i];
      if (row) per(`fl:idc:${i}`, `${l.title}: capitalised interest`, sl(row.values), FEEDS_SCHEDULES, { indent: 1 });
    });
    if (snap.idc.capitalize) {
      const heldIdc = idcLines.some((l) => l.assetIds.some((id) => { const a = state.assets.find((x) => x.id === id); return a?.strategy === 'Operate' || a?.strategy === 'Lease'; }));
      const tables = buildIdcAllocationTables(snap, state, String);
      const disp = tables.flatMap((t) => t.rows).find((r) => r.label.startsWith('Disposed at Exit'));
      if (heldIdc && booked) per('fl:idcDisp', '(-) Capitalised interest written off at the exit', sl(disp?.values ?? zeros()), 'Schedules: the held lines\' capitalised interest left at the exit, sold with the asset');
    }
  }
  gapRow();

  // ── Profit before zakat, inside the loop ──────────────────────────────────
  const pl = snap.pl;
  title('fl:t:pbt', `Profit before ${TAX.toLowerCase()}, inside the financing loop`);
  per('fl:ebit0', 'Revenue less operating expenses', add(sl(pl.ebitdaBeforeFundFeesPerPeriod), sl(pl.cosPerPeriod)), 'Revenue recognised, less Opex (lines and HQ) and the selling and marketing expensed');
  per('fl:cos', '(-) Cost of sales', neg(sl(pl.cosPerPeriod)), 'Schedules');
  if (feeOn) per('fl:feeExp', '(-) Fund fees', neg(sl(snap.fundFees.totalPerPeriod)), 'The fund fees, below');
  per('fl:dep', '(-) Depreciation (capex and capitalised interest)', neg(sl(pl.daPerPeriod)), 'Schedules');
  per('fl:int', '(-) Interest expensed', neg(sl(pl.interestExpensePerPeriod)), 'Above');
  per('fl:gain', '(+) Gain on disposal', sl(pl.gainOnDisposalPerPeriod), 'Exit proceeds less what the exit writes off (Schedules)');
  per('fl:pbt', `= Profit before ${TAX.toLowerCase()}`, sl(pl.pbtPerPeriod), 'The rows above (Checks proves it equals the P&L)', { style: 'subtotal' });
  const taxedGain = p.tax?.applyToDisposalGain === true;
  per('fl:taxable', zakat ? 'Profit zakat is charged on' : 'Taxable profit', sl(pl.pbtPerPeriod).map((v, t) => v - (taxedGain ? 0 : (sl(pl.gainOnDisposalPerPeriod)[t] ?? 0))), taxedGain ? 'Profit before it, gain included' : 'Profit before it, less the gain on disposal');
  if (cit) {
    per('fl:taxPool', 'Tax losses carried forward', sl(pl.taxLossCarriedForwardPerPeriod), 'Losses not yet relieved', { balance: true });
    per('fl:taxRel', 'Tax loss relief', sl(pl.taxLossReliefPerPeriod), 'The smaller of the losses and 25% of the year\'s profit');
  }
  per('fl:tax', TAX, sl(pl.taxPerPeriod), zakat ? 'The rate on Inputs x the profit above, where positive (each year on its own)' : 'The rate on Inputs x the profit less the relief');
  if (taxLag) per('fl:taxPay', `${TAX} payable at the year end`, sl(snap.bs.taxPayablePerPeriod), 'The charge x the payment days on Inputs over 365', { balance: true });
  per('fl:taxPaid', `${TAX} paid`, neg(sl(dcf.taxPaidPerPeriod)), taxLag ? 'The charge less the rise in what is payable' : 'Paid in the year charged');
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
  per('fl:cwOpen', 'Opening cash', sl(dcf.openingCashPerPeriod), 'The closing cash of the year before', { balance: true });
  per('fl:cfo', '(+) Cash from operations', sl(dcf.cashFromOperationsPerPeriod), feeByEquity ? 'Operating cash before financing, less the fund fees' : 'Operating cash before financing');
  per('fl:cfi', '(+) Exit proceeds less capex paid', sl(dcf.cashFromInvestmentPerPeriod), 'Above');
  per('fl:eqCash', '(+) Equity drawn in cash', sl(dcf.equityDrawdownPerPeriod), feeByEquity ? 'For the funding and for the fund fees' : 'For the funding');
  per('fl:debtCash', '(+) Debt drawn (capex and interest)', sl(dcf.debtDrawdownPerPeriod), 'Every facility\'s capex drawdown and interest drawn as debt');
  per('fl:intPaid', '(-) Interest paid', sl(dcf.interestPaidPerPeriod), 'Interest charged, all facilities');
  per('fl:cash', '= Cash available', add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod)), 'The rows above', { balance: true, style: 'subtotal' });
  per('fl:exitRepay', 'Debt repaid at the exit', sl(snap.disposal.debtRepaidPerPeriod), 'Timeline\'s exit year: every balance still outstanding');
  per('fl:repaidCash', '(-) Debt repaid (scheduled, swept and at the exit)', sl(dcf.debtRepaymentPerPeriod), 'Each facility\'s principal repaid, and the exit repayment');
  const forDiv = add(sl(dcf.openingCashPerPeriod), sl(dcf.cashFromOperationsPerPeriod), sl(dcf.cashFromInvestmentPerPeriod), sl(dcf.equityDrawdownPerPeriod), sl(dcf.debtDrawdownPerPeriod), sl(dcf.interestPaidPerPeriod), sl(dcf.debtRepaymentPerPeriod));
  per('fl:forDiv', '= Cash available for dividends', forDiv, 'Cash available less the debt repaid', { balance: true, style: 'subtotal' });
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
  per('fl:debtBs', 'Debt outstanding after the exit repayment', add(...tranches.map((t) => sl(fin.facilities.get(t.id)?.outstanding))).map((v, t) => (snap.disposal.booked && t >= snap.disposal.exitIdx ? 0 : v)), 'Every facility\'s closing balance, nothing from the exit year (the Balance Sheet)', { balance: true });

  return { rows, ctx: { method, feeOn, feeByEquity, zakat, cit, taxLag, anySweep, booked, idcLines } };
}
