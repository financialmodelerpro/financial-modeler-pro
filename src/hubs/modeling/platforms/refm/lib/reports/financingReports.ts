/**
 * financingReports.ts
 *
 * Shared pure builder for the Module 1 Financing Schedules + Cash Sweep tabs, so
 * the PDF mirrors the platform (per-facility Debt Movement + Finance Cost ledger,
 * Combined Debt Service, Equity Movement, the Cash Waterfall and per-tranche
 * Sweep & Outstanding). All data is on the financials snapshot; this only shapes
 * it into the platform's row layout. fmt-parametrised for the Total/override cells.
 *
 * Pure: reads the snapshot + state only.
 */
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';

export interface ReportTable { title: string; rows: M4Row[] }

const neg = (a: number[]): number[] => a.map((v) => -v);
const sliceN = (a: number[] | undefined, N: number): number[] => (a ?? []).slice(0, N);
const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);
/** Opening series chained from a closing series (opening[0]=initial, opening[i]=closing[i-1]). */
function openingSeries(closing: number[], initial: number): number[] {
  const out = new Array<number>(closing.length).fill(0);
  out[0] = initial;
  for (let i = 1; i < closing.length; i++) out[i] = closing[i - 1] ?? 0;
  return out;
}

export function buildFinancingScheduleTables(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: (v: number) => string): ReportTable[] {
  const N = snap.yearLabels.length;
  const fin = snap.financing;
  const tr = (id: string) => state.financingTranches.find((t) => t.id === id);
  const trName = (id: string): string => tr(id)?.name ?? id;
  const tables: ReportTable[] = [];

  const ordered = [...fin.facilities.entries()]
    .filter(([id, f]) => anyNonZero(f.drawSchedule) || anyNonZero(f.outstanding) || (tr(id)?.openingBalance ?? 0) > 0)
    .sort(([a], [b]) => ((tr(a)?.origin === 'existing' ? 0 : 1) - (tr(b)?.origin === 'existing' ? 0 : 1)));

  // Debt Movement per facility.
  for (const [id, f] of ordered) {
    const origin = tr(id)?.origin;
    const priorBal = origin === 'existing' ? Math.max(0, tr(id)?.openingBalance ?? 0) : 0;
    const closing = sliceN(f.outstanding, N);
    const opening = openingSeries(closing, priorBal);
    const draw = sliceN(f.drawSchedule, N);
    const idc = sliceN(f.interestCapitalized, N);
    const totalDraw = draw.map((v, i) => v + (idc[i] ?? 0));
    const repaid = sliceN(f.principalRepaid, N);
    tables.push({ title: `Debt Movement, ${trName(id)}${origin === 'existing' ? ' (existing)' : ''}`, rows: [
      { label: 'Opening', values: opening, totalOverride: fmt(priorBal), priorValue: priorBal },
      { label: 'Capex Drawdown', values: draw },
      { label: 'IDC Drawdown (capitalised interest)', values: idc },
      { label: 'Total Drawdown', values: totalDraw, isSubtotal: true },
      { label: 'Principal Repaid (incl. cash sweep)', values: neg(repaid) },
      { label: 'Closing', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: priorBal },
    ] });
  }

  // Finance Cost per facility (interest ledger).
  for (const [id, f] of ordered) {
    const accrued = sliceN(f.interestAccrued, N);
    const capitalized = sliceN(f.interestCapitalized, N);
    const paid = sliceN(f.interestPaid, N);
    if (!anyNonZero(accrued)) continue;
    const opening = new Array<number>(N).fill(0);
    const closing = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      opening[i] = i === 0 ? 0 : closing[i - 1];
      closing[i] = opening[i] + (accrued[i] ?? 0) - (capitalized[i] ?? 0) - (paid[i] ?? 0);
    }
    tables.push({ title: `Finance Cost, ${trName(id)}${tr(id)?.origin === 'existing' ? ' (existing)' : ''}`, rows: [
      { label: 'Opening', values: opening, totalOverride: fmt(0) },
      { label: 'Charge (Accrued)', values: accrued },
      { label: 'Capitalized', values: neg(capitalized) },
      { label: 'Paid', values: neg(paid) },
      { label: 'Closing', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ] });
  }

  // Combined Debt Service.
  const c = fin.combined;
  const totalDrawCapIdc = sliceN(c.totalDrawdown, N).map((v, i) => v + (sliceN(c.totalInterestCapitalized, N)[i] ?? 0));
  tables.push({ title: 'Combined Debt Service', rows: [
    { label: 'Total Capex Drawdown', values: sliceN(c.totalDrawdown, N) },
    { label: 'Total IDC Drawdown', values: sliceN(c.totalInterestCapitalized, N) },
    { label: 'Total Drawdown (Capex + IDC)', values: totalDrawCapIdc, isSubtotal: true },
    { label: 'Total Interest Expensed', values: neg(sliceN(c.totalInterestExpensed, N)), isSubtotal: true },
    { label: 'Total Principal Repaid', values: neg(sliceN(c.totalPrincipalRepaid, N)), isSubtotal: true },
    { label: 'Total Debt Service (Cash)', values: neg(sliceN(c.debtServiceCash, N)), isTotal: true },
  ] });

  // Equity Movement (cumulative).
  const eq = fin.equity;
  const cash = sliceN(eq.cashPerPeriod, N);
  const inKind = sliceN(eq.inKindPerPeriod, N);
  const priorExisting = fin.existing.equityTotal;
  const closingEq = new Array<number>(N).fill(0);
  const openingEq = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    openingEq[i] = i === 0 ? priorExisting : closingEq[i - 1];
    closingEq[i] = openingEq[i] + (cash[i] ?? 0) + (inKind[i] ?? 0);
  }
  tables.push({ title: 'Equity Movement', rows: [
    { label: 'Opening (incl. existing carry-forward)', values: openingEq, totalOverride: fmt(priorExisting), priorValue: priorExisting },
    { label: 'Cash Contribution', values: cash },
    { label: 'In-Kind Contribution', values: inKind },
    { label: 'Closing (cumulative equity)', values: closingEq, isTotal: true, totalOverride: fmt(closingEq[N - 1] ?? 0), priorValue: priorExisting },
  ] });

  return tables;
}

export function buildCashSweepTables(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: (v: number) => string): ReportTable[] {
  const N = snap.yearLabels.length;
  const fin = snap.financing;
  const dcf = snap.directCF;
  const sweep = snap.cashSweep;
  const div = snap.dividends;
  const trName = (id: string): string => state.financingTranches.find((t) => t.id === id)?.name ?? id;
  const minCash = state.project.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0;
  const tables: ReportTable[] = [];

  const opening = sliceN(dcf.openingCashPerPeriod, N);
  const cfo = sliceN(dcf.cashFromOperationsPerPeriod, N);
  const cfi = sliceN(dcf.cashFromInvestmentPerPeriod, N);
  const equityCash = sliceN(dcf.equityDrawdownPerPeriod, N);
  const inKind = sliceN(fin.equity.inKindPerPeriod, N);
  const debtDraw = sliceN(dcf.debtDrawdownPerPeriod, N);
  const interestPaid = sliceN(dcf.interestPaidPerPeriod, N);
  const minCashArr = new Array<number>(N).fill(minCash);
  const cashAvailable = opening.map((v, i) => v + (cfo[i] ?? 0) + (cfi[i] ?? 0) + (equityCash[i] ?? 0) + (debtDraw[i] ?? 0) - (interestPaid[i] ?? 0));
  const cashForDebtDiv = cashAvailable.map((v, i) => v - minCashArr[i]);

  // Per-tranche Debt Paid, ordered existing-first then sweep priority then list.
  const trMeta = (id: string) => state.financingTranches.find((t) => t.id === id);
  const debtPaidRows: M4Row[] = [...fin.facilities.entries()]
    .filter(([, f]) => anyNonZero(f.principalRepaid))
    .map(([id, f], listIdx) => ({ id, f, isExisting: trMeta(id)?.origin === 'existing', priority: trMeta(id)?.cashSweepConfig?.priority ?? 100, listIdx }))
    .sort((a, b) => (a.isExisting !== b.isExisting ? (a.isExisting ? -1 : 1) : a.priority !== b.priority ? a.priority - b.priority : a.listIdx - b.listIdx))
    .map(({ id, f, isExisting }) => ({ label: `Debt Paid: ${trName(id)}${isExisting ? ' (existing)' : ''}`, values: neg(sliceN(f.principalRepaid, N)), indent: 1 }));

  const debtPaidTotal = neg(sliceN(dcf.debtRepaymentPerPeriod, N));
  const cashForDividend = cashForDebtDiv.map((v, i) => v + (debtPaidTotal[i] ?? 0));
  const dividends = neg(sliceN(div.totalDividendsPerPeriod, N));
  const closing = sliceN(dcf.closingCashPerPeriod, N);

  const waterfall: M4Row[] = [
    { label: 'Opening Cash', values: opening, totalOverride: fmt(opening[0] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal },
    { label: '(+) Cash from Operations', values: cfo },
    { label: '(-) Cash from Investing (capex)', values: cfi },
    { label: '(+) Equity Drawdown (Cash)', values: equityCash, priorValue: fin.existing.equityTotal },
  ];
  if (anyNonZero(inKind)) waterfall.push({ label: '(+) Equity In-Kind (memo, non-cash)', values: inKind, indent: 1 });
  waterfall.push(
    { label: '(+) Debt Drawdown', values: debtDraw, priorValue: fin.existing.debtOutstandingTotal },
    { label: '(-) Interest Paid', values: neg(interestPaid) },
    { label: '= Cash Available', values: cashAvailable, isSubtotal: true },
    { label: '(-) Minimum Cash Requirement', values: neg(minCashArr) },
    { label: '= Cash Available for Debt + Dividend', values: cashForDebtDiv, isSubtotal: true },
    ...debtPaidRows,
    { label: '(-) Debt Paid (total principal incl. sweep)', values: debtPaidTotal, isSubtotal: true },
    { label: '= Cash Available for Dividend', values: cashForDividend, isSubtotal: true },
  );
  if (anyNonZero(dividends)) waterfall.push({ label: '(-) Dividend Paid (per policy)', values: dividends });
  waterfall.push({ label: '= Closing Cash (ties to CF + BS)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  tables.push({ title: 'Cash Waterfall (Operations -> Debt -> Dividend -> Closing)', rows: waterfall });

  // Per-Tranche Sweep & Outstanding.
  if (sweep.eligibleTranches.length) {
    const rows: M4Row[] = [];
    for (const row of sweep.eligibleTranches) {
      rows.push({ label: `${row.trancheName}, Opening (pre-sweep)`, values: sliceN(row.preSweepOutstanding, N) });
      rows.push({ label: `${row.trancheName}, Sweep Applied (${row.origin}, priority ${row.priority}, from ${row.startingYear})`, values: neg(sliceN(row.sweepPerPeriod, N)), indent: 1 });
      rows.push({ label: `${row.trancheName}, Closing (post-sweep)`, values: sliceN(row.postSweepOutstanding, N), isSubtotal: true, totalOverride: fmt(sliceN(row.postSweepOutstanding, N)[N - 1] ?? 0) });
    }
    rows.push({ label: 'Project total debt outstanding (post-sweep)', values: sliceN(sweep.adjustedDebtOutstanding, N), isTotal: true, totalOverride: fmt(sliceN(sweep.adjustedDebtOutstanding, N)[N - 1] ?? 0) });
    tables.push({ title: 'Per-Tranche Debt, Sweep & Outstanding', rows });
  }

  return tables;
}
