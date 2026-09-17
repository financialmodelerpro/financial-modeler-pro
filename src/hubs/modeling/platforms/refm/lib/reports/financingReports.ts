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
import { planReportLines, lineTitle, poolResults } from './lineRows';
import { idcWithDisposal, disposalContextOf } from './disposalSchedules';

/** `group` names the screen's group heading a table sits under (for example
 *  "Debt Movement - New Facilities"); a renderer with no group band ignores it. */
export interface ReportTable { title: string; rows: M4Row[]; group?: string }

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
  const tables: ReportTable[] = [];
  const last = (a: number[]): number => a[N - 1] ?? 0;

  /**
   * THE FACILITIES THE SCREEN SHOWS, IN ITS ORDER (2026-09-17): existing
   * facilities first, and only those with an opening balance or any activity
   * (an empty stub adds nothing), then every new facility. The Financing tab's
   * Schedules view filters and orders the same way.
   */
  const active = (id: string): boolean => {
    const f = fin.facilities.get(id);
    if (!f) return false;
    const tot = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + Math.abs(v ?? 0), 0);
    return tot(f.drawSchedule) > 0 || tot(f.interestPaid) > 0 || tot(f.interestCapitalized) > 0 || tot(f.principalRepaid) > 0;
  };
  const existing = state.financingTranches.filter((t) => t.origin === 'existing' && ((t.openingBalance ?? 0) > 0 || active(t.id)) && fin.facilities.has(t.id));
  const fresh = state.financingTranches.filter((t) => t.origin !== 'existing' && fin.facilities.has(t.id));
  const swept = (id: string): boolean => snap.cashSweep.eligibleTranches.some((e) => e.trancheId === id);
  const hasAnySweep = anyNonZero(fin.combined.totalSweepRepaid);

  // Debt Movement per facility. Opening and Closing are balances, so their
  // Total is the last period, as the screen prints it.
  const debtMovement = (t: (typeof state.financingTranches)[number], group: string): void => {
    const f = fin.facilities.get(t.id)!;
    const isExisting = t.origin === 'existing';
    const priorBal = isExisting ? Math.max(0, t.openingBalance ?? 0) : 0;
    const closing = sliceN(f.outstanding, N);
    const opening = openingSeries(closing, priorBal);
    const draw = sliceN(f.drawSchedule, N);
    const idc = sliceN(f.interestCapitalized, N);
    const totalDraw = draw.map((v, i) => v + (idc[i] ?? 0));
    const repaid = sliceN(f.principalRepaid, N);
    const share = fin.shares.get(t.id);
    const shareNote = !isExisting && fresh.length > 1 && share !== undefined ? ` (${share % 1 === 0 ? share : share.toFixed(1)}% of the project facility)` : '';
    tables.push({ group, title: `Debt Movement, ${t.name}${isExisting ? ' (existing)' : ''}${shareNote}`, rows: [
      { label: 'Opening', values: opening, totalOverride: fmt(last(opening)), ...(isExisting ? { priorValue: 0 } : {}) },
      { label: 'Capex Drawdown', values: draw, ...(isExisting ? { priorValue: 0 } : {}) },
      { label: 'IDC Drawdown (capitalized interest)', values: idc, ...(isExisting ? { priorValue: 0 } : {}) },
      { label: 'Total Drawdown', values: totalDraw, isSubtotal: true, ...(isExisting ? { priorValue: priorBal } : {}) },
      { label: swept(t.id) ? 'Principal Repaid (incl. cash sweep)' : 'Principal Repaid', values: neg(repaid), ...(isExisting ? { priorValue: 0 } : {}) },
      { label: 'Closing', values: closing, isTotal: true, totalOverride: fmt(last(closing)), ...(isExisting ? { priorValue: priorBal } : {}) },
    ] });
  };
  for (const t of existing) debtMovement(t, 'Debt Movement - Existing Facilities');
  for (const t of fresh) debtMovement(t, 'Debt Movement - New Facilities');

  // Combined Debt Service, each cash row split by origin as on the screen.
  const c = fin.combined;
  const totalDrawCapIdc = sliceN(c.totalDrawdown, N).map((v, i) => v + (sliceN(c.totalInterestCapitalized, N)[i] ?? 0));
  const cds: M4Row[] = [
    { label: 'Total Capex Drawdown', values: sliceN(c.totalDrawdown, N) },
    { label: 'Total IDC Drawdown', values: sliceN(c.totalInterestCapitalized, N) },
    { label: 'Total Drawdown (Capex + IDC)', values: totalDrawCapIdc, isSubtotal: true },
  ];
  if (existing.length) cds.push({ label: 'Interest Expensed - Existing', values: neg(sliceN(c.existingInterestExpensed, N)) });
  if (fresh.length) cds.push({ label: 'Interest Expensed - New', values: neg(sliceN(c.newInterestExpensed, N)) });
  cds.push({ label: 'Total Interest Expensed', values: neg(sliceN(c.totalInterestExpensed, N)), isSubtotal: true });
  if (existing.length) cds.push({ label: hasAnySweep ? 'Principal Repaid - Existing (incl. sweep)' : 'Principal Repaid - Existing', values: neg(sliceN(c.existingPrincipalRepaid, N)) });
  if (fresh.length) cds.push({ label: hasAnySweep ? 'Principal Repaid - New (incl. sweep)' : 'Principal Repaid - New', values: neg(sliceN(c.newPrincipalRepaid, N)) });
  cds.push({ label: 'Total Principal Repaid', values: neg(sliceN(c.totalPrincipalRepaid, N)), isSubtotal: true });
  if (existing.length) cds.push({ label: 'Debt Service - Existing', values: neg(sliceN(c.existingDebtServiceCash, N)) });
  if (fresh.length) cds.push({ label: 'Debt Service - New', values: neg(sliceN(c.newDebtServiceCash, N)) });
  cds.push({ label: 'Total Debt Service (Cash)', values: neg(sliceN(c.debtServiceCash, N)), isTotal: true });
  tables.push({ title: 'Combined Debt Service', rows: cds });

  // Finance Cost per facility (interest ledger): Opening + Charge - Paid =
  // Closing, as on the Financing screen. The capitalised figure FUNDS the
  // payment by drawing debt; deducting it as a second settlement walked the
  // balance to a stuck negative, so it is a memo.
  const ledger = (accrued: number[], paid: number[]): { opening: number[]; closing: number[] } => {
    const opening = new Array<number>(N).fill(0);
    const closing = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      opening[i] = i === 0 ? 0 : closing[i - 1];
      closing[i] = opening[i] + (accrued[i] ?? 0) - (paid[i] ?? 0);
    }
    return { opening, closing };
  };
  const financeCost = (t: (typeof state.financingTranches)[number], group: string): void => {
    const f = fin.facilities.get(t.id)!;
    const accrued = sliceN(f.interestAccrued, N);
    const capitalized = sliceN(f.interestCapitalized, N);
    const paid = sliceN(f.interestPaid, N);
    const { opening, closing } = ledger(accrued, paid);
    tables.push({ group, title: `Finance Cost, ${t.name}${t.origin === 'existing' ? ' (existing)' : ''}`, rows: [
      { label: 'Opening', values: opening, totalOverride: fmt(last(opening)) },
      { label: 'Charge (Accrued)', values: accrued },
      { label: 'Paid', values: neg(paid) },
      { label: '(memo) of which funded by drawing debt', values: capitalized, indent: 1 },
      { label: 'Closing', values: closing, isTotal: true, totalOverride: fmt(last(closing)) },
    ] });
  };
  for (const t of existing) financeCost(t, 'Finance Cost - Existing Facilities');
  for (const t of fresh) financeCost(t, 'Finance Cost - New Facilities');
  if (existing.length + fresh.length > 1) {
    const accrued = sliceN(c.totalInterestAccrued, N);
    const expensed = sliceN(c.totalInterestExpensed, N);
    const { opening, closing } = ledger(accrued, expensed);
    tables.push({ title: 'Combined Finance Cost (all facilities)', rows: [
      { label: 'Opening', values: opening, totalOverride: fmt(last(opening)) },
      { label: 'Charge (Accrued, all debts)', values: accrued },
      { label: 'Capitalized', values: neg(sliceN(c.totalInterestCapitalized, N)) },
      { label: 'Paid', values: neg(expensed) },
      { label: 'Closing', values: closing, isTotal: true, totalOverride: fmt(last(closing)) },
    ] });
  }

  // Equity Movement (cumulative). The cash row splits into development and the
  // fund management fee when the fee is drawn from equity, as on the screen.
  const eq = fin.equity;
  const dev = sliceN(eq.developmentPerPeriod, N);
  const fee = sliceN(eq.managementFeePerPeriod, N);
  const hasFee = (eq.totalManagementFee ?? 0) > 0.005;
  const inKind = sliceN(eq.inKindPerPeriod, N);
  const priorExisting = fin.existing.equityTotal;
  const closingEq = new Array<number>(N).fill(0);
  const openingEq = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    openingEq[i] = i === 0 ? priorExisting : closingEq[i - 1];
    closingEq[i] = openingEq[i] + (dev[i] ?? 0) + (fee[i] ?? 0) + (inKind[i] ?? 0);
  }
  const eqRows: M4Row[] = [
    { label: 'Opening (incl. existing carry-forward)', values: openingEq, totalOverride: fmt(last(openingEq)), priorValue: 0 },
    { label: hasFee ? 'Cash Contribution, development' : 'Cash Contribution', values: dev, priorValue: 0 },
  ];
  if (hasFee) eqRows.push({ label: 'Cash Contribution, fund management fee', values: fee, priorValue: 0 });
  eqRows.push({ label: 'In-Kind Contribution', values: inKind, priorValue: 0 });
  if (priorExisting > 0) eqRows.push({ label: 'Existing Equity (pre-axis carry-forward)', values: new Array<number>(N).fill(0), priorValue: priorExisting });
  eqRows.push({ label: 'Closing (cumulative equity)', values: closingEq, isTotal: true, totalOverride: fmt(last(closingEq)), priorValue: priorExisting });
  tables.push({ title: 'Equity Movement', rows: eqRows });

  return tables;
}

/**
 * IDC ALLOCATION, BY LINE (2026-09-17), the table the Financing Schedules
 * sub-tab shows between the finance cost ledgers and the equity movement: each
 * consolidated line's share of the capitalised construction interest (the
 * engine allocates per asset; a line's plots add), then where it is routed,
 * cost of sales for the lines that sell and fixed assets with their
 * depreciation, disposal and closing net book value for the lines that are
 * held. The disposal is the composer's own write-off at exit.
 */
export function buildIdcAllocationTables(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: (v: number) => string): ReportTable[] {
  const N = snap.yearLabels.length;
  const idc = snap.idc;
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const basisLabel = idc.allocationBasis === 'bua' ? 'BUA share' : 'Land share';
  const rows = planReportLines(lineState, (a) => idc.byAsset.has(a.id)).map((line) => {
    const members = line.assetIds.map((id) => idc.byAsset.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    return { ...poolResults(members), assetName: lineTitle(line, lineState), strategy: members[0].strategy };
  });
  const tables: ReportTable[] = [];
  const main: M4Row[] = rows.map((r) => ({
    label: `${r.assetName} (Land ${Math.round(r.physicalLandSqm).toLocaleString('en-US')} sqm, BUA ${Math.round(r.physicalBuaSqm).toLocaleString('en-US')} sqm, ${(r.shareOfTotalLand * 100).toFixed(2)}% ${basisLabel})`,
    values: sliceN(r.idcPerPeriod, N),
  }));
  if (rows.length) main.push({ label: 'Total IDC (allocated to assets)', values: sliceN(idc.totalIdcPerPeriod, N), isTotal: true });
  main.push({ label: idc.capitalize ? 'Memo: Total construction interest (accrual)' : 'Total construction interest to P&L Finance Cost', values: sliceN(idc.totalConstructionInterestPerPeriod, N) });
  tables.push({ title: `IDC Allocation, by Line (YoY + Total), basis ${idc.allocationBasis === 'bua' ? 'BUA Area' : 'Land Area'}, capitalised into asset cost, paid when it arises, debt drawn for the shortfall`, rows: main });

  const sum = (list: typeof rows): number[] => {
    const out = new Array<number>(N).fill(0);
    for (const r of list) for (let t = 0; t < N; t++) out[t] += r.idcPerPeriod[t] ?? 0;
    return out;
  };
  const sell = rows.filter((r) => r.strategy === 'Sell' || r.strategy === 'Sell + Manage');
  const held = rows.filter((r) => r.strategy === 'Operate' || r.strategy === 'Lease');
  if (idc.capitalize && sell.length) {
    tables.push({ title: 'Routed to CoS via Inventory (Sell / Sell+Manage, augments capex basis, unwinds via revenue recognition)', rows: [
      ...sell.map((r) => ({ label: r.assetName, values: sliceN(r.idcPerPeriod, N) })),
      { label: 'Subtotal: Sell IDC to CoS', values: sum(sell), isTotal: true },
    ] });
  }
  if (idc.capitalize && held.length) {
    const d = idcWithDisposal(idc, disposalContextOf(snap));
    const heldRows: M4Row[] = [
      ...held.map((r) => ({ label: `${r.assetName} (Additions)`, values: sliceN(r.idcPerPeriod, N) })),
      { label: 'Subtotal: Operate/Lease IDC to Fixed Assets', values: sum(held), isSubtotal: true },
      { label: 'Operate/Lease IDC Depreciation (charge to D&A)', values: neg(sliceN(d.depreciationPerPeriod, N)) },
    ];
    if (d.disposed) heldRows.push({ label: 'Disposed at Exit (capitalised interest sold with the asset)', values: neg(sliceN(d.disposalPerPeriod, N)) });
    const nbv = sliceN(d.closingPerPeriod, N);
    heldRows.push({ label: 'Operate/Lease IDC NBV (closing, sits on BS Fixed Assets)', values: nbv, isTotal: true, totalOverride: fmt(nbv[N - 1] ?? 0) });
    tables.push({ title: 'Routed to Fixed Assets to D&A (Operate / Lease, adds to depreciable basis at handover, straight-line over useful life)', rows: heldRows });
  }
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
  // SIGNS. `directCF.interestPaidPerPeriod` and `directCF.debtRepaymentPerPeriod`
  // are stored ALREADY NEGATIVE (see the FinancialsSnapshot field comments, and
  // every other consumer: returns-resolvers, icReport, the on-screen waterfall).
  // The per-facility `principalRepaid` and `dividends.totalDividendsPerPeriod`
  // are stored POSITIVE and still need `neg()` for display. Mixing the two
  // conventions is what previously ADDED interest and principal to the cash
  // available instead of subtracting them, which overstated every row below
  // "= Cash Available" by 2 x interest (and again by 2 x principal), and broke
  // the tie to closing cash that the last row claims.
  const interestPaid = sliceN(dcf.interestPaidPerPeriod, N);   // already negative
  const minCashArr = new Array<number>(N).fill(minCash);
  const cashAvailable = opening.map((v, i) => v + (cfo[i] ?? 0) + (cfi[i] ?? 0) + (equityCash[i] ?? 0) + (debtDraw[i] ?? 0) + (interestPaid[i] ?? 0));
  const headroom = cashAvailable.map((v, i) => v - minCashArr[i]);

  // Per-tranche Debt Paid, ordered existing-first then sweep priority then list.
  const trMeta = (id: string) => state.financingTranches.find((t) => t.id === id);
  const debtPaidRows: M4Row[] = [...fin.facilities.entries()]
    .filter(([, f]) => anyNonZero(f.principalRepaid))
    .map(([id, f], listIdx) => ({ id, f, isExisting: trMeta(id)?.origin === 'existing', priority: trMeta(id)?.cashSweepConfig?.priority ?? 100, listIdx }))
    .sort((a, b) => (a.isExisting !== b.isExisting ? (a.isExisting ? -1 : 1) : a.priority !== b.priority ? a.priority - b.priority : a.listIdx - b.listIdx))
    .map(({ id, f, isExisting }) => ({ label: `(-) Debt Paid: ${trName(id)}${isExisting ? ' (existing)' : ''}`, values: neg(sliceN(f.principalRepaid, N)), indent: 1 }));

  const debtPaidTotal = sliceN(dcf.debtRepaymentPerPeriod, N);   // already negative
  const cashForDividend = cashAvailable.map((v, i) => v + (debtPaidTotal[i] ?? 0));
  const dividends = neg(sliceN(div.totalDividendsPerPeriod, N)); // stored positive
  const closing = sliceN(dcf.closingCashPerPeriod, N);

  const waterfall: M4Row[] = [
    { label: 'Opening Cash', values: opening, totalOverride: fmt(opening[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal },
    { label: '(+) Cash from Operations', values: cfo },
    { label: '(-) Cash from Investing (capex)', values: cfi },
    { label: '(+) Equity Drawdown (Cash)', values: equityCash, priorValue: fin.existing.equityTotal },
  ];
  if (anyNonZero(inKind)) waterfall.push({ label: '(+) Equity In-Kind (memo, non-cash)', values: inKind, indent: 1 });
  // The minimum cash reserve is a RESERVATION, not a payment: it is never spent,
  // so it does not belong in the running chain (deducting it and then silently
  // ignoring it two rows later is what stopped the column reaching closing cash).
  // It rides alongside as an indented memo pair, exactly like the in-kind equity
  // row above. The chain is therefore:
  //   Opening + Ops + Inv + Equity + Debt Draw + Interest = Cash Available
  //   Cash Available + Debt Paid + Dividend Paid          = Closing Cash
  // Both a BALANCE, so their Total is the closing figure, never a 14-period sum
  // of a stock (the reserve summed to 700.0 against a standing 50.0 reserve).
  waterfall.push(
    { label: '(+) Debt Drawdown (incl. additional to maintain min cash)', values: debtDraw, priorValue: fin.existing.debtOutstandingTotal },
    { label: '(-) Interest Paid', values: interestPaid },
    { label: '= Cash Available', values: cashAvailable, isSubtotal: true, totalOverride: fmt(cashAvailable[N - 1] ?? 0) },
    { label: '(memo) Minimum Cash Requirement (reserved, not spent)', values: neg(minCashArr), indent: 1, totalOverride: fmt(-minCash) },
    { label: '(memo) Headroom above the minimum reserve', values: headroom, indent: 1, totalOverride: fmt(headroom[N - 1] ?? 0) },
    ...debtPaidRows,
    { label: '(-) Debt Paid (total principal incl. sweep)', values: debtPaidTotal, isSubtotal: true },
    { label: '= Cash Available for Dividend', values: cashForDividend, isSubtotal: true, totalOverride: fmt(cashForDividend[N - 1] ?? 0) },
  );
  if (div.enabled || anyNonZero(dividends)) waterfall.push({ label: '(-) Dividend Paid (per policy, EBITDA-capped)', values: dividends });
  waterfall.push({ label: '= Closing Cash (ties to Cash Flow tab + Balance Sheet)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  tables.push({ title: 'Cash Waterfall (Operations -> Debt -> Dividend -> Closing)', rows: waterfall });

  // Per-Tranche Sweep & Outstanding.
  if (sweep.enabled && sweep.eligibleTranches.length) {
    const rows: M4Row[] = [];
    for (const row of sweep.eligibleTranches) {
      rows.push({ label: `${row.trancheName}, Opening (pre-sweep)`, values: sliceN(row.preSweepOutstanding, N), totalOverride: fmt(sliceN(row.preSweepOutstanding, N)[N - 1] ?? 0) });
      rows.push({ label: `${row.trancheName}, Sweep Applied (${row.origin}, priority ${row.priority}, from ${row.startingYear})`, values: neg(sliceN(row.sweepPerPeriod, N)), indent: 1 });
      rows.push({ label: `${row.trancheName}, Closing (post-sweep)`, values: sliceN(row.postSweepOutstanding, N), isSubtotal: true, totalOverride: fmt(sliceN(row.postSweepOutstanding, N)[N - 1] ?? 0) });
    }
    rows.push({ label: 'Project total debt outstanding (post-sweep)', values: sliceN(sweep.adjustedDebtOutstanding, N), isTotal: true, totalOverride: fmt(sliceN(sweep.adjustedDebtOutstanding, N)[N - 1] ?? 0) });
    tables.push({ title: 'Per-Tranche Debt: Sweep & Outstanding', rows });
  }

  return tables;
}
