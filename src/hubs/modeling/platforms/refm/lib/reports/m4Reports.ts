/**
 * m4Reports.ts
 *
 * Single source of truth for the Module 4 financial-statement ROW MODELS
 * (P&L, Direct CF, Indirect CF, Balance Sheet). Both the on-screen tabs
 * (Module4PL / Module4CashFlow / Module4BalanceSheet) AND the PDF export
 * (generateProjectPdf) render from these pure builders, so any row added,
 * removed or relabelled here flows into BOTH surfaces automatically: the PDF
 * stays a faithful mirror of the platform without a second hand-maintained
 * copy of the structure.
 *
 * The builders are fmt-parametrised (the caller passes its own number
 * formatter): the on-screen tab passes the project display-scale formatter,
 * the PDF passes the export-scale formatter, and the emitted M4Row[] is
 * identical apart from the pre-formatted `totalOverride` strings.
 *
 * Pure: no React, no hooks, no DOM. Reads the financials snapshot + project
 * state only.
 */
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import { getFinancialLabels } from '@/src/core/calculations/financials';
import type { M4Row } from '../../components/modules/_shared/m4Table';

type Labels = ReturnType<typeof getFinancialLabels>;

export interface M4ReportCtx {
  snap: ProjectFinancialsSnapshot;
  state: FinancialsResolverState;
  labels: Labels;
  /** '__all__' for the consolidated view, or a phase id for a single phase. */
  filterPhaseId: string;
  /** Number formatter for pre-formatted Total/override cells. */
  fmt: (v: number) => string;
}

const ALL = '__all__';

/** Compact phase tag for the Phase column ('Phase 1' -> '1'). */
function phaseShortName(state: FinancialsResolverState, phaseId: string): string {
  const name = state.phases.find((p) => p.id === phaseId)?.name ?? '';
  const m = name.match(/(\d+)/);
  return m ? m[1] : name.slice(0, 4);
}

// ── Profit & Loss ─────────────────────────────────────────────────────────
export function buildPLRows(ctx: M4ReportCtx): M4Row[] {
  const { snap, state, labels, filterPhaseId } = ctx;
  const N = snap.axisLength;
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const phaseShort = (id: string): string => phaseShortName(state, id);
  const p = snap.pl;
  const rows: M4Row[] = [];
  const negArr = (arr: number[]): number[] => arr.map((v) => -v);
  const matchesPhase = (a: { phaseId: string }): boolean => filterPhaseId === ALL || a.phaseId === filterPhaseId;
  const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
  const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
  const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));
  const phaseFiltered = filterPhaseId !== ALL;
  const projTag = phaseFiltered ? ' (project)' : '';

  const zerosN = (): number[] => new Array<number>(N).fill(0);
  const sumAssetsSeries = (
    assets: Array<{ id: string }>,
    key: 'revenuePerPeriod' | 'cosPerPeriod' | 'opexPerPeriod',
  ): number[] => {
    const out = zerosN();
    for (const a of assets) {
      const pl = snap.perAssetPL.get(a.id);
      if (!pl) continue;
      for (let t = 0; t < N; t++) out[t] += pl[key][t] ?? 0;
    }
    return out;
  };

  const resRev = phaseFiltered ? sumAssetsSeries(residentialAssets, 'revenuePerPeriod') : p.residentialRevenuePerPeriod;
  const hospRev = phaseFiltered ? sumAssetsSeries(hospitalityAssets, 'revenuePerPeriod') : p.hospitalityRevenuePerPeriod;
  const retailRev = phaseFiltered ? sumAssetsSeries(retailAssets, 'revenuePerPeriod') : p.retailRevenuePerPeriod;
  const totalRev = phaseFiltered ? resRev.map((v, i) => v + hospRev[i] + retailRev[i]) : p.totalRevenuePerPeriod;
  const cosTotal = phaseFiltered ? sumAssetsSeries(residentialAssets, 'cosPerPeriod') : p.cosPerPeriod;
  const hospOpex = phaseFiltered ? sumAssetsSeries(hospitalityAssets, 'opexPerPeriod') : p.hospitalityOpexPerPeriod;
  const retailOpex = phaseFiltered ? sumAssetsSeries(retailAssets, 'opexPerPeriod') : p.retailOpexPerPeriod;
  const hqOpex = p.hqOpexPerPeriod;
  const totalOpex = hospOpex.map((v, i) => v + retailOpex[i] + hqOpex[i]);

  // D&A: per-asset depreciation + IDC NBV depreciation (IDC allocated by
  // phase land-sqm share under filter).
  const daAssets = zerosN();
  if (phaseFiltered) {
    const phaseAssetIds = new Set([...residentialAssets, ...hospitalityAssets, ...retailAssets].map((a) => a.id));
    for (const id of phaseAssetIds) {
      const fa = snap.fixedAssets.byAsset.get(id);
      if (!fa) continue;
      const dep = fa.depreciable.depreciationPerPeriod;
      for (let t = 0; t < N; t++) daAssets[t] += dep[t] ?? 0;
    }
    const totalLandSqm = Math.max(0, snap.idc.totalLandSqm);
    let phaseLandSqm = 0;
    for (const id of phaseAssetIds) phaseLandSqm += snap.idc.byAsset.get(id)?.landSqm ?? 0;
    const idcShare = totalLandSqm > 0 ? phaseLandSqm / totalLandSqm : 0;
    const idcDep = snap.idc.idcDepreciationPerPeriod;
    for (let t = 0; t < N; t++) daAssets[t] += (idcDep[t] ?? 0) * idcShare;
  }
  const da = phaseFiltered ? daAssets : p.daPerPeriod;

  // Interest expense: filter facilities by tranche.phaseId under a phase view.
  const interestExpense = zerosN();
  if (phaseFiltered) {
    const trancheIds = new Set(state.financingTranches.filter((t) => t.phaseId === filterPhaseId).map((t) => t.id));
    for (const id of trancheIds) {
      const fac = snap.financing.facilities.get(id);
      if (!fac) continue;
      for (let t = 0; t < N; t++) {
        const accrued = fac.interestAccrued[t + 1] ?? 0;
        const capitalised = fac.interestCapitalized[t + 1] ?? 0;
        interestExpense[t] += Math.max(0, accrued - capitalised);
      }
    }
  } else {
    for (let t = 0; t < N; t++) interestExpense[t] = p.interestExpensePerPeriod[t] ?? 0;
  }

  const ebitda = totalRev.map((v, i) => v - (cosTotal[i] ?? 0) - (totalOpex[i] ?? 0));
  const ebit = ebitda.map((v, i) => v - (da[i] ?? 0));
  const pbt = ebit.map((v, i) => v - (interestExpense[i] ?? 0));
  const taxArr = pbt.map((v) => Math.max(0, v) * p.taxRate);
  const pat = pbt.map((v, i) => v - (taxArr[i] ?? 0));

  // ── REVENUE ──────────────────────────────────────────────────────────────
  rows.push({ label: 'REVENUE', values: [], isSection: true });
  const pushAssetPL = (a: { id: string; name: string; phaseId: string }, key: 'revenuePerPeriod' | 'cosPerPeriod' | 'opexPerPeriod', group: string, sign = 1): void => {
    const pl = snap.perAssetPL.get(a.id);
    if (!pl) return;
    const series = pl[key];
    if (series.every((v) => v === 0)) return;
    rows.push({
      label: a.name,
      values: sign === 1 ? series : negArr(series),
      indent: 2,
      phaseLabel: phaseShort(a.phaseId),
      collapseGroup: group,
      collapseRole: 'member',
    });
  };

  if (residentialAssets.length > 0 && resRev.some((v) => v !== 0)) {
    rows.push({ label: 'Residential Revenue', values: resRev, isSection: true, collapseGroup: 'pl-rev-res', collapseRole: 'header', defaultCollapsed: false });
    for (const a of residentialAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-res');
  }
  if (hospitalityAssets.length > 0 && hospRev.some((v) => v !== 0)) {
    rows.push({ label: 'Hospitality Revenue', values: hospRev, isSection: true, collapseGroup: 'pl-rev-hosp', collapseRole: 'header', defaultCollapsed: false });
    for (const a of hospitalityAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-hosp');
  }
  if (retailAssets.length > 0 && retailRev.some((v) => v !== 0)) {
    rows.push({ label: 'Retail Revenue', values: retailRev, isSection: true, collapseGroup: 'pl-rev-ret', collapseRole: 'header', defaultCollapsed: false });
    for (const a of retailAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-ret');
  }
  rows.push({ label: 'Total Revenue', values: totalRev, isTotal: true });

  // ── COST OF SALES ──────────────────────────────────────────────────────
  if (cosTotal.some((v) => v !== 0)) {
    rows.push({ label: 'COST OF SALES', values: [], isSection: true });
    rows.push({ label: 'Residential cost of sales', values: negArr(cosTotal), isSection: true, collapseGroup: 'pl-cos', collapseRole: 'header', defaultCollapsed: false });
    for (const a of residentialAssets) pushAssetPL(a, 'cosPerPeriod', 'pl-cos', -1);
  }

  // ── OPERATING EXPENSES ──────────────────────────────────────────────────
  rows.push({ label: 'OPERATING EXPENSES', values: [], isSection: true });
  if (hospitalityAssets.length > 0 && hospOpex.some((v) => v !== 0)) {
    rows.push({ label: 'Hospitality operating expenses', values: negArr(hospOpex), isSection: true, collapseGroup: 'pl-opex-hosp', collapseRole: 'header', defaultCollapsed: false });
    for (const a of hospitalityAssets) pushAssetPL(a, 'opexPerPeriod', 'pl-opex-hosp', -1);
  }
  if (retailAssets.length > 0 && retailOpex.some((v) => v !== 0)) {
    rows.push({ label: 'Retail operating expenses', values: negArr(retailOpex), isSection: true, collapseGroup: 'pl-opex-ret', collapseRole: 'header', defaultCollapsed: false });
    for (const a of retailAssets) pushAssetPL(a, 'opexPerPeriod', 'pl-opex-ret', -1);
  }
  if (hqOpex.some((v) => v !== 0)) {
    rows.push({ label: `HQ Expenses${projTag}`, values: negArr(hqOpex), indent: 1 });
  }
  rows.push({ label: 'Total Operating Expenses', values: negArr(totalOpex), isSubtotal: true });

  rows.push({ label: labels.ebitda, values: ebitda, isTotal: true });

  // Phase-level P&L stops at EBITDA (D&A, interest, tax are project-level).
  if (phaseFiltered) return rows;

  rows.push({ label: 'Depreciation & Amortization', values: negArr(da), indent: 1 });
  rows.push({ label: labels.ebit, values: ebit, isSubtotal: true });

  rows.push({ label: 'Interest & financing cost', values: negArr(interestExpense), indent: 1 });
  if (p.interestIncomePerPeriod.some((v) => v !== 0)) {
    rows.push({ label: 'Interest income / other', values: p.interestIncomePerPeriod, indent: 1 });
  }
  rows.push({ label: labels.pbt, values: pbt, isSubtotal: true });

  rows.push({ label: `${labels.tax} (${(p.taxRate * 100).toFixed(2)}%)`, values: negArr(taxArr), indent: 1 });
  rows.push({ label: labels.pat, values: pat, isTotal: true });

  return rows;
}

// ── Cash Flow shared Investment / Financing sections ──────────────────────
function buildInvestmentRows(ctx: M4ReportCtx, capexSubtotal: number[], cfiSubtotal: number[]): M4Row[] {
  const { snap, state, filterPhaseId } = ctx;
  const N = snap.axisLength;
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const matchesPhase = (a: { phaseId: string }): boolean => filterPhaseId === ALL || a.phaseId === filterPhaseId;
  const phaseShort = (id: string): string => phaseShortName(state, id);
  const rows: M4Row[] = [];
  const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
  const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
  const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));
  const bucketTotal = (list: typeof residentialAssets): number[] => {
    const out = new Array<number>(N).fill(0);
    for (const a of list) {
      const series = snap.perAssetCF.get(a.id)?.capexPerPeriod ?? [];
      for (let t = 0; t < N; t++) out[t] += series[t] ?? 0;
    }
    return out;
  };
  const pushCapexBucket = (list: typeof residentialAssets, label: string, group: string): void => {
    if (list.length === 0) return;
    const total = bucketTotal(list);
    if (!total.some((v) => v !== 0)) return;
    rows.push({ label, values: total.map((v) => -v), isSection: true, collapseGroup: group, collapseRole: 'header', defaultCollapsed: false });
    for (const a of list) {
      const series = snap.perAssetCF.get(a.id)?.capexPerPeriod ?? [];
      if (series.every((v) => v === 0)) continue;
      rows.push({ label: a.name, values: series.map((v) => -v), indent: 2, phaseLabel: phaseShort(a.phaseId), collapseGroup: group, collapseRole: 'member' });
    }
  };
  rows.push({ label: 'CASH FROM INVESTMENT', values: [], isSection: true });
  pushCapexBucket(residentialAssets, 'Residential Capex', 'cf-capex-res');
  pushCapexBucket(hospitalityAssets, 'Hospitality Capex', 'cf-capex-hosp');
  pushCapexBucket(retailAssets, 'Retail Capex', 'cf-capex-ret');
  const priorPreCapex = snap.financing.existing.preCapexTotal;
  if (priorPreCapex > 0) {
    rows.push({ label: 'Pre-Capex (existing operations)', values: new Array<number>(N).fill(0), indent: 1, priorValue: -priorPreCapex });
  }
  rows.push({ label: 'Total Capex', values: capexSubtotal, isSubtotal: true, priorValue: -priorPreCapex });
  rows.push({ label: 'Cash Flow from Investment', values: cfiSubtotal, isTotal: true, priorValue: -priorPreCapex });
  return rows;
}

function buildFinancingRows(ctx: M4ReportCtx, cffSubtotal: number[]): M4Row[] {
  const { snap, state } = ctx;
  const N = snap.axisLength;
  const existingOpening = state.financingTranches
    .filter((t) => t.origin === 'existing')
    .reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);
  const rows: M4Row[] = [];
  const d = snap.directCF;
  rows.push({ label: 'CASH FROM FINANCING', values: [], isSection: true });
  const priorEquityTotal = snap.financing.existing.equityTotal;
  if (d.equityDrawdownPerPeriod.some((v) => v !== 0) || priorEquityTotal > 0) {
    rows.push({ label: 'Equity Drawdown (Cash)', values: d.equityDrawdownPerPeriod, indent: 1, priorValue: priorEquityTotal });
  }
  if (d.equityInKindDrawdownPerPeriod.some((v) => v !== 0)) {
    rows.push({ label: '(memo) In-Kind Equity (non-cash, see BS Schedules E1)', values: d.equityInKindDrawdownPerPeriod, indent: 2 });
  }
  const sumOrigin = (origin: 'existing' | 'new', key: 'drawSchedule' | 'interestCapitalized' | 'principalRepaid' | 'interestPaid'): number[] => {
    const out = new Array<number>(N).fill(0);
    for (const t of state.financingTranches) {
      if ((t.origin === 'existing' ? 'existing' : 'new') !== origin) continue;
      const f = snap.financing.facilities.get(t.id);
      if (!f) continue;
      const src = (f[key] as number[]).slice(0, N);
      for (let i = 0; i < N; i++) out[i] += src[i] ?? 0;
    }
    return out;
  };
  const pushDebtBucket = (origin: 'existing' | 'new', label: string, opening?: number): void => {
    const draw = sumOrigin(origin, 'drawSchedule');
    const drawIdc = sumOrigin(origin, 'interestCapitalized');
    const repaid = sumOrigin(origin, 'principalRepaid');
    const intPaid = sumOrigin(origin, 'interestPaid');
    if (draw.some((v) => v !== 0) || (opening ?? 0) > 0) {
      rows.push({ label: `Debt Drawdown, ${label}`, values: draw, indent: 1, ...(opening !== undefined ? { priorValue: opening } : {}) });
    }
    if (drawIdc.some((v) => v !== 0)) rows.push({ label: `Debt Drawdown (IDC), ${label}`, values: drawIdc, indent: 1 });
    if (repaid.some((v) => v !== 0)) rows.push({ label: `Debt Repayment, ${label}`, values: repaid.map((v) => -v), indent: 1 });
    if (intPaid.some((v) => v !== 0)) rows.push({ label: `Finance Cost Paid, ${label}`, values: intPaid.map((v) => -v), indent: 1 });
    if (drawIdc.some((v) => v !== 0)) rows.push({ label: `Finance Cost (Capitalised via IDC drawdown), ${label}`, values: drawIdc.map((v) => -v), indent: 1 });
  };
  pushDebtBucket('existing', 'Existing loans', existingOpening);
  pushDebtBucket('new', 'New loans');
  if (d.dividendsPaidPerPeriod.some((v) => v !== 0)) {
    rows.push({ label: 'Dividends paid', values: d.dividendsPaidPerPeriod, indent: 1 });
  }
  rows.push({ label: 'Cash Flow from Financing', values: cffSubtotal, isSubtotal: true, priorValue: priorEquityTotal + existingOpening });
  return rows;
}

// ── Direct Cash Flow ───────────────────────────────────────────────────────
export function buildDirectCFRows(ctx: M4ReportCtx): M4Row[] {
  const { snap, state, labels, filterPhaseId, fmt } = ctx;
  const N = snap.axisLength;
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const matchesPhase = (a: { phaseId: string }): boolean => filterPhaseId === ALL || a.phaseId === filterPhaseId;
  const phaseShort = (id: string): string => phaseShortName(state, id);
  const existingOpening = state.financingTranches
    .filter((t) => t.origin === 'existing')
    .reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);
  const d = snap.directCF;
  const rows: M4Row[] = [];
  const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
  const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
  const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));

  rows.push({ label: 'CASH FROM OPERATIONS', values: [], isSection: true });
  const pushAssetRow = (a: { id: string; name: string; phaseId: string }, key: 'revenueReceivedPerPeriod' | 'opexPaidPerPeriod', group: string, sign = 1): void => {
    const cf = snap.perAssetCF.get(a.id);
    if (!cf) return;
    const series = (cf[key] as number[] | undefined) ?? [];
    if (series.every((v) => v === 0)) return;
    rows.push({ label: a.name, values: sign === 1 ? series : series.map((v) => -v), indent: 2, phaseLabel: phaseShort(a.phaseId), collapseGroup: group, collapseRole: 'member' });
  };
  const sumAssetSeries = (list: Array<{ id: string }>, key: 'revenueReceivedPerPeriod' | 'opexPaidPerPeriod'): number[] => {
    const out = new Array<number>(N).fill(0);
    for (const a of list) {
      const cf = snap.perAssetCF.get(a.id);
      if (!cf) continue;
      const series = (cf[key] as number[] | undefined) ?? [];
      for (let t = 0; t < N; t++) out[t] += series[t] ?? 0;
    }
    return out;
  };

  if (residentialAssets.length > 0) {
    const resRev = sumAssetSeries(residentialAssets, 'revenueReceivedPerPeriod');
    if (resRev.some((v) => v !== 0)) {
      rows.push({ label: 'Residential revenue received', values: resRev, isSection: true, collapseGroup: 'cf-rev-res', collapseRole: 'header', defaultCollapsed: false });
      for (const a of residentialAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev-res');
    }
  }
  if (hospitalityAssets.length > 0) {
    const hospRev = sumAssetSeries(hospitalityAssets, 'revenueReceivedPerPeriod');
    if (hospRev.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality revenue received', values: hospRev, isSection: true, collapseGroup: 'cf-rev-hosp', collapseRole: 'header', defaultCollapsed: false });
      for (const a of hospitalityAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev-hosp');
    }
  }
  if (retailAssets.length > 0) {
    const retRev = sumAssetSeries(retailAssets, 'revenueReceivedPerPeriod');
    if (retRev.some((v) => v !== 0)) {
      rows.push({ label: 'Retail revenue received', values: retRev, isSection: true, collapseGroup: 'cf-rev-ret', collapseRole: 'header', defaultCollapsed: false });
      for (const a of retailAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev-ret');
    }
  }
  rows.push({ label: 'Total Revenue Received', values: d.revenueReceivedPerPeriod, isSubtotal: true });

  if (d.escrowHeldPerPeriod.some((v) => v !== 0) || d.escrowReleasePerPeriod.some((v) => v !== 0)) {
    rows.push({ label: 'Less: Inaccessible Funds Locked', values: d.escrowHeldPerPeriod, indent: 1 });
    rows.push({ label: 'Add: Release of Inaccessible Funds', values: d.escrowReleasePerPeriod, indent: 1 });
  }

  if (hospitalityAssets.length > 0) {
    const hospOpex = sumAssetSeries(hospitalityAssets, 'opexPaidPerPeriod');
    if (hospOpex.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality operating expenses paid', values: hospOpex.map((v) => -v), isSection: true, collapseGroup: 'cf-opex-hosp', collapseRole: 'header', defaultCollapsed: false });
      for (const a of hospitalityAssets) pushAssetRow(a, 'opexPaidPerPeriod', 'cf-opex-hosp', -1);
    }
  }
  if (retailAssets.length > 0) {
    const retOpex = sumAssetSeries(retailAssets, 'opexPaidPerPeriod');
    if (retOpex.some((v) => v !== 0)) {
      rows.push({ label: 'Retail operating expenses paid', values: retOpex.map((v) => -v), isSection: true, collapseGroup: 'cf-opex-ret', collapseRole: 'header', defaultCollapsed: false });
      for (const a of retailAssets) pushAssetRow(a, 'opexPaidPerPeriod', 'cf-opex-ret', -1);
    }
  }
  if (d.hqOpexPaidPerPeriod.some((v) => v !== 0)) {
    rows.push({ label: 'HQ Expenses', values: d.hqOpexPaidPerPeriod, indent: 1 });
  }
  rows.push({ label: 'Total Operating Expenses Paid', values: d.opexPaidPerPeriod.map((v, i) => v + (d.hqOpexPaidPerPeriod[i] ?? 0)), isSubtotal: true });

  if (d.taxPaidPerPeriod.some((v) => v !== 0)) {
    rows.push({ label: `${labels.taxPaid}`, values: d.taxPaidPerPeriod, indent: 1 });
  }
  rows.push({ label: 'Cash Flow from Operations', values: d.cashFromOperationsPerPeriod, isTotal: true });

  rows.push(...buildInvestmentRows(ctx, d.capexPerPeriod, d.cashFromInvestmentPerPeriod));

  // Phase-level CF stops at Investing; financing + net cash roll are
  // project-level only.
  if (filterPhaseId !== ALL) return rows;

  rows.push(...buildFinancingRows(ctx, d.cashFromFinancingPerPeriod));

  const priorPreCapex = snap.financing.existing.preCapexTotal;
  const netPrior = -priorPreCapex + (snap.financing.existing.equityTotal + existingOpening);
  rows.push({ label: 'Net Cash Flow', values: d.netCashFlowPerPeriod, isTotal: true, priorValue: netPrior });
  rows.push({ label: 'Opening cash', values: d.openingCashPerPeriod, indent: 1, totalOverride: fmt(d.openingCashPerPeriod[0] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  rows.push({ label: 'Closing cash', values: d.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(d.closingCashPerPeriod[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  return rows;
}

// ── Indirect Cash Flow ─────────────────────────────────────────────────────
export function buildIndirectCFRows(ctx: M4ReportCtx): M4Row[] {
  const { snap, state, labels, filterPhaseId, fmt } = ctx;
  const N = snap.axisLength;
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const ic = snap.indirectCF;
  const filtered = filterPhaseId !== ALL;
  const projTag = filtered ? ' (project)' : '';

  const zerosN = (): number[] => new Array<number>(N).fill(0);
  const sumAssets = (pick: (assetId: string) => number[] | undefined): number[] => {
    const out = zerosN();
    const assetIds = filtered
      ? visibleAssets.filter((a) => a.phaseId === filterPhaseId).map((a) => a.id)
      : visibleAssets.map((a) => a.id);
    for (const id of assetIds) {
      const v = pick(id);
      if (!v) continue;
      for (let t = 0; t < N; t++) out[t] += v[t] ?? 0;
    }
    return out;
  };
  const periodChange = (arr: number[]): number[] => {
    const out = zerosN();
    for (let t = 0; t < N; t++) out[t] = (arr[t] ?? 0) - (t === 0 ? 0 : arr[t - 1] ?? 0);
    return out;
  };

  const cosAddBackPhase = sumAssets((id) => snap.perAssetPL.get(id)?.cosPerPeriod);
  const apClosingPhase = sumAssets((id) => snap.ap.byAsset.get(id)?.result.perPeriod);
  const changeInAp = periodChange(apClosingPhase);
  const unearnedClosingPhase = sumAssets((id) => snap.byAssetSchedules.get(id)?.unearned.perPeriod);
  const changeInUnearned = periodChange(unearnedClosingPhase);
  const escrowClosingPhase = sumAssets((id) => snap.escrow.byAsset.get(id)?.result.cumulativeBalancePerPeriod);
  const changeInEscrow = periodChange(escrowClosingPhase);
  const capexFiltered = (() => {
    const out = zerosN();
    const assets = filtered ? visibleAssets.filter((a) => a.phaseId === filterPhaseId) : visibleAssets;
    for (const a of assets) {
      const cf = snap.perAssetCF.get(a.id);
      if (!cf) continue;
      for (let t = 0; t < N; t++) out[t] += -(cf.capexPerPeriod[t] ?? 0);
    }
    return out;
  })();

  const trancheIds = new Set(
    filtered
      ? state.financingTranches.filter((t) => t.phaseId === filterPhaseId).map((t) => t.id)
      : state.financingTranches.map((t) => t.id),
  );
  const debtDrawFiltered = zerosN();
  const debtRepayFiltered = zerosN();
  const interestPaidFiltered = zerosN();
  for (const tr of state.financingTranches) {
    if (!trancheIds.has(tr.id)) continue;
    const fac = snap.financing.facilities.get(tr.id);
    if (!fac) continue;
    for (let t = 0; t < N; t++) {
      debtDrawFiltered[t] += fac.drawSchedule[t + 1] ?? 0;
      debtRepayFiltered[t] += -(fac.principalRepaid[t + 1] ?? 0);
      interestPaidFiltered[t] += -(fac.interestPaid[t + 1] ?? 0);
    }
  }

  const patPhase = ic.patPerPeriod;
  const daPhase = ic.daPerPeriod;
  const intExpPhase = ic.interestExpensePerPeriod;
  const changeArPhase = ic.changeInArPerPeriod;
  const equityDrawPhase = ic.equityDrawdownPerPeriod;

  const cfoFiltered = zerosN();
  const cfiFiltered = capexFiltered.slice();
  const cffFiltered = zerosN();
  for (let t = 0; t < N; t++) {
    cfoFiltered[t] = (patPhase[t] ?? 0) + (daPhase[t] ?? 0) + (intExpPhase[t] ?? 0) - (changeArPhase[t] ?? 0)
      + cosAddBackPhase[t] + changeInAp[t] + changeInUnearned[t] + changeInEscrow[t];
    cffFiltered[t] = (equityDrawPhase[t] ?? 0) + debtDrawFiltered[t] + debtRepayFiltered[t] + interestPaidFiltered[t];
  }
  const netCfFiltered = zerosN();
  for (let t = 0; t < N; t++) netCfFiltered[t] = cfoFiltered[t] + cfiFiltered[t] + cffFiltered[t];

  const cfo = filtered ? cfoFiltered : ic.cashFromOperationsPerPeriod;
  const cfi = filtered ? cfiFiltered : ic.cashFromInvestmentPerPeriod;
  const cff = filtered ? cffFiltered : ic.cashFromFinancingPerPeriod;
  const netCf = filtered ? netCfFiltered : ic.netCashFlowPerPeriod;
  const cosAdd = filtered ? cosAddBackPhase : ic.costOfSalesAddBackPerPeriod;
  const ap = filtered ? changeInAp : ic.changeInApPerPeriod;
  const un = filtered ? changeInUnearned : ic.changeInUnearnedPerPeriod;
  const esc = filtered ? changeInEscrow : ic.changeInEscrowPerPeriod;
  const cpx = filtered ? capexFiltered : ic.capexPerPeriod;

  const rows: M4Row[] = [];
  rows.push({ label: 'CASH FROM OPERATIONS (INDIRECT)', values: [], isSection: true });
  rows.push({ label: `${labels.pat}${projTag}`, values: patPhase, indent: 1 });
  rows.push({ label: `(+) Depreciation & Amortization${projTag}`, values: daPhase, indent: 1 });
  rows.push({ label: `(+) Interest expense (add back)${projTag}`, values: intExpPhase, indent: 1 });
  rows.push({ label: `(−) Change in AR${projTag}`, values: changeArPhase, indent: 1 });
  rows.push({ label: '(+) Cost of sales (add back; capex in investing)', values: cosAdd, indent: 1 });
  rows.push({ label: '(+) Change in AP', values: ap, indent: 1 });
  rows.push({ label: '(+) Change in Unearned Revenue', values: un, indent: 1 });
  rows.push({ label: '(+) Change in Escrow balance', values: esc, indent: 1 });
  rows.push({ label: 'Cash Flow from Operations', values: cfo, isSubtotal: true });

  rows.push(...buildInvestmentRows(ctx, cpx, cfi));

  // Phase-level CF stops at Investing (mirrors the Direct view).
  if (filtered) return rows;

  rows.push(...buildFinancingRows(ctx, cff));
  rows.push({ label: 'Net Cash Flow', values: netCf, isTotal: true });
  rows.push({ label: 'Opening cash', values: ic.openingCashPerPeriod, indent: 1, totalOverride: fmt(ic.openingCashPerPeriod[0] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  rows.push({ label: 'Closing cash', values: ic.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(ic.closingCashPerPeriod[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
  return rows;
}

// ── Balance Sheet (consolidated only) ──────────────────────────────────────
export interface BSRowsResult {
  rows: M4Row[];
  balances: boolean;
  maxAbsDiff: number;
  priorYear: number;
  /** Per-period Assets − (Liabilities + Equity), for the BS-check diagnostic. */
  bsDiffPerPeriod: number[];
}

export function buildBSRows(ctx: M4ReportCtx): BSRowsResult {
  const { snap, state, fmt } = ctx;
  const N = snap.axisLength;
  const bs = snap.bs;

  const zerosN = (): number[] => new Array<number>(N).fill(0);
  const addInto = (acc: number[], src: number[] | undefined): void => {
    if (!src) return;
    for (let t = 0; t < N; t++) acc[t] += src[t] ?? 0;
  };
  const sumAssetsBy = (pick: (assetId: string) => number[] | undefined): number[] => {
    const out = zerosN();
    for (const a of state.assets) {
      if (a.visible === false) continue;
      addInto(out, pick(a.id));
    }
    return out;
  };

  const land = sumAssetsBy((id) => snap.fixedAssets.byAsset.get(id)?.land.closingPerPeriod);
  const nbv = sumAssetsBy((id) => snap.fixedAssets.byAsset.get(id)?.depreciable.closingNBVPerPeriod);
  const inventory = sumAssetsBy((id) => snap.perAssetCF.get(id)?.inventoryPerPeriod);
  const resReceivables = sumAssetsBy((id) => snap.byAssetSchedules.get(id)?.ar.perPeriod);
  const unearned = sumAssetsBy((id) => snap.byAssetSchedules.get(id)?.unearned.perPeriod);
  // AP links to the canonical project-wide total (includes HQ AP).
  const ap = snap.ap.projectTotals.closingApPerPeriod.slice(0, N);
  const escrow = sumAssetsBy((id) => snap.escrow.byAsset.get(id)?.result.cumulativeBalancePerPeriod);
  const idcNbv = snap.idc.idcNbvPerPeriod;
  const debt = bs.debtOutstandingPerPeriod;
  const cash = bs.cashPerPeriod;
  const arOperating = bs.arPerPeriod;
  const shareCapital = bs.shareCapitalPerPeriod;
  const reserve = bs.statutoryReservePerPeriod;
  const retained = bs.retainedEarningsPerPeriod;

  const totalFA = zerosN();
  const totalCA = zerosN();
  const totalAssets = zerosN();
  const totalCL = zerosN();
  const totalLiab = zerosN();
  const totalEquity = zerosN();
  const totalLandE = zerosN();
  const bsDiff = zerosN();
  for (let t = 0; t < N; t++) {
    totalFA[t] = land[t] + nbv[t] + idcNbv[t];
    totalCA[t] = cash[t] + escrow[t] + arOperating[t] + resReceivables[t] + inventory[t];
    totalAssets[t] = totalFA[t] + totalCA[t];
    totalCL[t] = ap[t] + unearned[t];
    totalLiab[t] = totalCL[t] + debt[t];
    totalEquity[t] = shareCapital[t] + reserve[t] + retained[t];
    totalLandE[t] = totalLiab[t] + totalEquity[t];
    bsDiff[t] = totalAssets[t] - totalLandE[t];
  }

  const priorYear = snap.projectStartYear - 1;
  const priorLand = snap.fixedAssets.projectTotals.land.openingAtAxisStart;
  const priorBuilding = snap.fixedAssets.projectTotals.depreciable.openingNBVPerPeriod[0] ?? 0;
  const priorFA = priorLand + priorBuilding;
  const priorCash = bs.historicalOpeningCashTotal;
  const priorCA = priorCash;
  const priorTotalAssets = priorFA + priorCA;
  const priorDebt = snap.financing.existing.debtOutstandingTotal;
  const priorEquity = snap.financing.existing.equityTotal;
  const priorLandE = priorDebt + priorEquity;

  const rows: M4Row[] = [];
  rows.push({ label: 'ASSETS', values: [], isSection: true });
  rows.push({ label: 'Fixed Assets', values: [], isSection: true });
  rows.push({ label: 'Land', values: land, indent: 1, totalOverride: fmt(land[N - 1] ?? 0), priorValue: priorLand });
  const nbvCombined = nbv.map((v, i) => v + (idcNbv[i] ?? 0));
  const fixedAssetsLabel = idcNbv.some((v) => v !== 0) ? 'Fixed Assets (NBV, incl. capitalised IDC)' : 'Fixed Assets (NBV)';
  rows.push({ label: fixedAssetsLabel, values: nbvCombined, indent: 1, totalOverride: fmt(nbvCombined[N - 1] ?? 0), priorValue: priorBuilding });
  rows.push({ label: 'Total Fixed Assets', values: totalFA, isSubtotal: true, totalOverride: fmt(totalFA[N - 1] ?? 0), priorValue: priorFA });

  rows.push({ label: 'Current Assets', values: [], isSection: true });
  rows.push({ label: 'Cash', values: cash, indent: 1, totalOverride: fmt(cash[N - 1] ?? 0), priorValue: priorCash });
  if (arOperating.some((v) => v !== 0)) {
    rows.push({ label: 'Accounts Receivable (Operating)', values: arOperating, indent: 1, totalOverride: fmt(arOperating[N - 1] ?? 0), priorValue: 0 });
  }
  rows.push({ label: 'Residential Sales Receivables', values: resReceivables, indent: 1, totalOverride: fmt(resReceivables[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Inventory (Residential WIP)', values: inventory, indent: 1, totalOverride: fmt(inventory[N - 1] ?? 0), priorValue: 0 });
  if (escrow.some((v) => v !== 0)) {
    rows.push({ label: 'Restricted Cash (Escrow)', values: escrow, indent: 1, totalOverride: fmt(escrow[N - 1] ?? 0), priorValue: 0 });
  }
  rows.push({ label: 'Total Current Assets', values: totalCA, isSubtotal: true, totalOverride: fmt(totalCA[N - 1] ?? 0), priorValue: priorCA });

  rows.push({ label: 'TOTAL ASSETS', values: totalAssets, isTotal: true, totalOverride: fmt(totalAssets[N - 1] ?? 0), priorValue: priorTotalAssets });

  rows.push({ label: 'LIABILITIES', values: [], isSection: true });
  rows.push({ label: 'Current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Accounts Payable', values: ap, indent: 1, totalOverride: fmt(ap[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Unearned Revenue (Off-plan advances)', values: unearned, indent: 1, totalOverride: fmt(unearned[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Total Current Liabilities', values: totalCL, isSubtotal: true, totalOverride: fmt(totalCL[N - 1] ?? 0), priorValue: 0 });

  rows.push({ label: 'Non-current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Debt (long-term)', values: debt, indent: 1, totalOverride: fmt(debt[N - 1] ?? 0), priorValue: priorDebt });
  rows.push({ label: 'TOTAL LIABILITIES', values: totalLiab, isTotal: true, totalOverride: fmt(totalLiab[N - 1] ?? 0), priorValue: priorDebt });

  rows.push({ label: 'SHAREHOLDERS EQUITY', values: [], isSection: true });
  rows.push({ label: 'Share Capital', values: shareCapital, indent: 1, totalOverride: fmt(shareCapital[N - 1] ?? 0), priorValue: priorEquity });
  rows.push({ label: 'Statutory Reserve', values: reserve, indent: 1, totalOverride: fmt(reserve[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Retained Earnings', values: retained, indent: 1, totalOverride: fmt(retained[N - 1] ?? 0), priorValue: 0 });
  rows.push({ label: 'Total Equity', values: totalEquity, isSubtotal: true, totalOverride: fmt(totalEquity[N - 1] ?? 0), priorValue: priorEquity });

  rows.push({ label: 'TOTAL LIABILITIES + EQUITY', values: totalLandE, isTotal: true, totalOverride: fmt(totalLandE[N - 1] ?? 0), priorValue: priorLandE });

  const maxAbsDiff = Math.max(...bsDiff.map((v) => Math.abs(v)));
  const bsTolerance = Math.max(1000, Math.abs(totalLandE[N - 1] ?? 0) * 1e-6);
  const balances = maxAbsDiff < bsTolerance;
  rows.push({ label: balances ? 'BS Check: BALANCED' : 'BS Check: OUT OF BALANCE', values: bsDiff, isTotal: true, totalOverride: fmt(maxAbsDiff), priorValue: priorTotalAssets - priorLandE });

  return { rows, balances, maxAbsDiff, priorYear, bsDiffPerPeriod: bsDiff };
}

// ── Balance-Sheet feeder schedules (shared: on-screen Module4BSFeeders +
//    Module4BalanceSheet reconciliation + the PDF export all render from here,
//    so the PDF matches the platform and cannot drift). Pure: no new math, each
//    builder reads the SAME snapshot feeders the on-screen tab used inline. ──

export interface M4FeederCtx {
  snap: ProjectFinancialsSnapshot;
  state: FinancialsResolverState;
  /** Pre-formats Total / override cells (display formatter). */
  fmt: (v: number) => string;
}

export type M4FeederSection = 'ASSETS' | 'LIABILITIES' | 'EQUITY' | 'MEMO';
export interface M4FeederTable {
  key: string;
  section: M4FeederSection;
  title: string;
  caption: string;
  rows: M4Row[];
}

/** A1. Residential Sales Receivables roll-forward (mirror of M2 Output Block 5). */
export function buildResidentialReceivablesRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, state, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const opening = zeros(), saleValue = zeros(), cashCollected = zeros(), closing = zeros();
  const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));
  for (const [assetId, bundle] of sellEntries) {
    const sell = snap.revenue.bySellAsset.get(assetId)!;
    for (let t = 0; t < N; t++) {
      opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
      saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
      cashCollected[t] += sell.presalesCashPerPeriod[t] ?? 0;
      closing[t] += bundle.ar.perPeriod[t] ?? 0;
    }
  }
  const rows: M4Row[] = [];
  rows.push({ label: 'Opening AR (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) });
  rows.push({ label: '(+) Pre-Sales Sale Value', values: saleValue, indent: 1 });
  rows.push({ label: '(−) Pre-Sales Cash Collected', values: cashCollected.map((v) => -v), indent: 1 });
  rows.push({ label: 'Closing AR (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
  if (sellEntries.length > 0) {
    rows.push({ label: 'Closing AR by asset', values: [], isSection: true });
    for (const [assetId, bundle] of sellEntries) {
      const asset = state.assets.find((a) => a.id === assetId);
      rows.push({ label: asset?.name ?? assetId, values: bundle.ar.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.ar.perPeriod[N - 1] ?? 0) });
    }
    rows.push({ label: 'Total Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
  }
  return rows;
}

/** A2. Operating Receivables (DSO) roll-forward. */
export function buildOperatingReceivablesRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const operatingRev = snap.pl.hospitalityRevenuePerPeriod.map((v, i) => v + (snap.pl.retailRevenuePerPeriod[i] ?? 0));
  const closing = snap.bs.arPerPeriod;
  const opening = zeros();
  for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
  const change = closing.map((v, i) => v - (opening[i] ?? 0));
  const cash = operatingRev.map((v, i) => v - (change[i] ?? 0));
  return [
    { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
    { label: '(+) Operating revenue billed', values: operatingRev, indent: 1 },
    { label: '(−) Cash collected', values: cash.map((v) => -v), indent: 1 },
    { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
  ];
}

/** A3. Inventory (Residential WIP) roll-forward. */
export function buildInventoryRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const closing = zeros();
  for (const cf of snap.perAssetCF.values()) for (let t = 0; t < N; t++) closing[t] += cf.inventoryPerPeriod[t] ?? 0;
  const opening = zeros();
  for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
  const cosTotal = snap.pl.cosPerPeriod;
  const capexCapitalized = zeros();
  for (let t = 0; t < N; t++) capexCapitalized[t] = (closing[t] - opening[t]) + (cosTotal[t] ?? 0);
  return [
    { label: 'Opening inventory', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
    { label: '(+) Capex capitalized', values: capexCapitalized, indent: 1 },
    { label: '(−) Released to Cost of Sales', values: cosTotal.map((v) => -v), indent: 1 },
    { label: 'Closing inventory', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
  ];
}

/** A4. Restricted Cash (Escrow) roll-forward. */
export function buildEscrowFeederRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const closing = snap.escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
  const opening = zeros();
  for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
  return [
    { label: 'Opening Balance', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
    { label: '(+) Held this period', values: snap.escrow.projectTotals.heldPerPeriod, indent: 1 },
    { label: '(−) Release', values: snap.escrow.projectTotals.releasePerPeriod.map((v) => -v), indent: 1 },
    { label: 'Closing Balance', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
  ];
}

/** L1. Accounts Payable (DPO) roll-forward. */
export function buildApFeederRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const t = snap.ap.projectTotals;
  return [
    { label: 'Opening AP', values: t.openingApPerPeriod, isSubtotal: true, totalOverride: fmt(t.openingApPerPeriod[0] ?? 0), priorValue: 0 },
    { label: '(+) Opex incurred', values: t.opexIncurredPerPeriod, indent: 1, priorValue: 0 },
    { label: '(−) Cash paid', values: t.cashPaidPerPeriod.map((v) => -v), indent: 1, priorValue: 0 },
    { label: 'Closing AP', values: t.closingApPerPeriod, isTotal: true, totalOverride: fmt(t.closingApPerPeriod[N - 1] ?? 0), priorValue: 0 },
  ];
}

/** L2. Unearned Revenue (off-plan advances) roll-forward. */
export function buildUnearnedRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, state, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const opening = zeros(), saleValue = zeros(), recognized = zeros(), closing = zeros();
  const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));
  for (const [assetId, bundle] of sellEntries) {
    const sell = snap.revenue.bySellAsset.get(assetId)!;
    for (let t = 0; t < N; t++) {
      opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
      saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
      recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
      closing[t] += bundle.unearned.perPeriod[t] ?? 0;
    }
  }
  const rows: M4Row[] = [];
  rows.push({ label: 'Opening unearned revenue (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) });
  rows.push({ label: '(+) Pre-sales contracts signed (sale value)', values: saleValue, indent: 1 });
  rows.push({ label: '(−) Revenue recognized (at handover)', values: recognized.map((v) => -v), indent: 1 });
  rows.push({ label: 'Closing unearned revenue (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
  if (sellEntries.length > 0) {
    rows.push({ label: 'Closing unearned revenue by asset', values: [], isSection: true });
    for (const [assetId, bundle] of sellEntries) {
      const asset = state.assets.find((a) => a.id === assetId);
      rows.push({ label: asset?.name ?? assetId, values: bundle.unearned.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.unearned.perPeriod[N - 1] ?? 0) });
    }
    rows.push({ label: 'Total Closing Unearned Revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
  }
  return rows;
}

/** L3. Debt Outstanding by tranche. */
export function buildDebtOutstandingRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, state, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const rows: M4Row[] = [];
  const totalOut = zeros();
  let totalPrior = 0;
  for (const t of state.financingTranches) {
    const f = snap.financing.facilities.get(t.id);
    if (!f) continue;
    const outRow = f.outstanding.slice(0, N);
    while (outRow.length < N) outRow.push(0);
    const facPrior = f.openingBalance ?? 0;
    rows.push({ label: t.name, values: outRow, indent: 1, totalOverride: fmt(outRow[N - 1] ?? 0), priorValue: facPrior });
    for (let i = 0; i < N; i++) totalOut[i] += outRow[i] ?? 0;
    totalPrior += facPrior;
  }
  rows.push({ label: 'Total Debt Outstanding', values: totalOut, isTotal: true, totalOverride: fmt(totalOut[N - 1] ?? 0), priorValue: totalPrior });
  return rows;
}

/** E1. Equity cumulative roll-forward (split by type). */
export function buildEquityRollForwardRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const cashDraws = snap.financing.equity.cashPerPeriod.slice(0, N);
  const inKindDraws = snap.financing.equity.inKindPerPeriod.slice(0, N);
  const existingDrawsRaw = snap.financing.equity.existingEquityPerPeriod.slice(0, N);
  while (cashDraws.length < N) cashDraws.push(0);
  while (inKindDraws.length < N) inKindDraws.push(0);
  while (existingDrawsRaw.length < N) existingDrawsRaw.push(0);
  const priorExisting = existingDrawsRaw.reduce((s, v) => s + v, 0);
  const existingAxisZeros = zeros();
  const priorClosing = priorExisting;
  const opening = zeros();
  const closing = zeros();
  let running = priorClosing;
  for (let t = 0; t < N; t++) {
    opening[t] = running;
    running += (cashDraws[t] ?? 0) + (inKindDraws[t] ?? 0);
    closing[t] = running;
  }
  const rows: M4Row[] = [
    { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0), priorValue: 0 },
    { label: '(+) Cash equity drawdown', values: cashDraws, indent: 1, priorValue: 0 },
    { label: '(+) In-Kind equity (land in-kind, non-cash)', values: inKindDraws, indent: 1, priorValue: 0 },
  ];
  if (Math.abs(priorExisting) > 0.5) {
    rows.push({ label: '(+) Existing equity (pre-axis carry-forward)', values: existingAxisZeros, indent: 1, priorValue: priorExisting });
  }
  rows.push({ label: 'Closing equity (cumulative)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: priorClosing });
  return rows;
}

/** E2. Retained Earnings roll-forward. */
export function buildRetainedEarningsRows(ctx: M4FeederCtx): M4Row[] {
  const { snap, fmt } = ctx;
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const pat = snap.pl.patPerPeriod.slice(0, N);
  const reserveTransfer = snap.bs.statutoryReserveTransferPerPeriod.slice(0, N);
  const dividends = snap.bs.dividendsPerPeriod.slice(0, N);
  const closing = snap.bs.retainedEarningsPerPeriod.slice(0, N);
  while (pat.length < N) pat.push(0);
  while (reserveTransfer.length < N) reserveTransfer.push(0);
  while (dividends.length < N) dividends.push(0);
  while (closing.length < N) closing.push(0);
  const opening = zeros();
  for (let t = 0; t < N; t++) opening[t] = t === 0 ? 0 : (closing[t - 1] ?? 0);
  return [
    { label: 'Opening retained earnings', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
    { label: '(+) PAT for the period', values: pat, indent: 1 },
    { label: '(−) Transfer to statutory reserve', values: reserveTransfer.map((v) => -v), indent: 1 },
    { label: '(−) Dividends declared', values: dividends.map((v) => -v), indent: 1 },
    { label: 'Closing retained earnings', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
  ];
}

/** Balance-check reconciliation bridge (per period). */
export function buildBsReconciliationRows(ctx: M4FeederCtx): M4Row[] {
  const r = ctx.snap.bsReconciliation;
  const neg = (a: number[]): number[] => a.map((v) => -v);
  return [
    { label: 'Net cash flow (Direct = Indirect)', values: r.netCashFlowPerPeriod },
    { label: '(−) Δ Liabilities + Equity', values: [], isSection: true },
    { label: 'Δ Debt outstanding', values: neg(r.deltaDebtPerPeriod), indent: 1 },
    { label: 'Δ Share capital', values: neg(r.deltaShareCapitalPerPeriod), indent: 1 },
    { label: 'Δ Reserve + Retained earnings', values: neg(r.deltaReserveRetainedPerPeriod), indent: 1 },
    { label: 'Δ Accounts payable', values: neg(r.deltaApPerPeriod), indent: 1 },
    { label: 'Δ Unearned revenue', values: neg(r.deltaUnearnedPerPeriod), indent: 1 },
    { label: '(+) Δ Non-cash assets', values: [], isSection: true },
    { label: 'Δ Restricted cash (escrow)', values: r.deltaEscrowPerPeriod, indent: 1 },
    { label: 'Δ AR (operating)', values: r.deltaArPerPeriod, indent: 1 },
    { label: 'Δ Receivables (residential)', values: r.deltaResidentialReceivablesPerPeriod, indent: 1 },
    { label: 'Δ Inventory', values: r.deltaInventoryPerPeriod, indent: 1 },
    { label: 'Δ Fixed assets NBV', values: r.deltaNbvPerPeriod, indent: 1 },
    { label: 'Δ Land', values: r.deltaLandPerPeriod, indent: 1 },
    { label: 'Δ Capitalised IDC NBV', values: r.deltaIdcNbvPerPeriod, indent: 1 },
    { label: '= Δ BS difference (this period)', values: r.bsDifferenceChangePerPeriod, isTotal: true },
    { label: 'Unexplained (must be 0)', values: r.unexplainedPerPeriod, isSubtotal: true },
    { label: 'BS difference (cumulative)', values: r.bsDifferencePerPeriod, isSubtotal: true },
  ];
}

/** All BS feeder schedules in on-screen order (ASSETS -> LIABILITIES -> EQUITY),
 *  each with its title + caption + rows, so the component and the PDF render the
 *  exact same set. The reconciliation bridge is returned separately by
 *  buildBsReconciliationRows (it lives on the Balance Sheet tab, not the feeder
 *  list). */
export function buildBsFeederTables(ctx: M4FeederCtx): M4FeederTable[] {
  return [
    { key: 'A1', section: 'ASSETS', title: 'A1. Residential Sales Receivables: Roll-Forward (project)', caption: 'Per-asset closing AR (mirror of M2 Revenue Output Block 5) + project total. AR forms ONLY on pre-sales. Opening + Pre-Sales Sale Value − Pre-Sales Cash Collected = Closing AR.', rows: buildResidentialReceivablesRows(ctx) },
    { key: 'A2', section: 'ASSETS', title: 'A2. Operating Receivables: Roll-Forward (project)', caption: 'DSO-driven for hospitality + lease revenue. Closing AR = Operating revenue × DSO / 365.', rows: buildOperatingReceivablesRows(ctx) },
    { key: 'A3', section: 'ASSETS', title: 'A3. Inventory (Residential WIP): Roll-Forward (project)', caption: 'Opening + Capex capitalized − Released to CoS = Closing. Floored at 0 once CoS has fully unwound the capex.', rows: buildInventoryRows(ctx) },
    { key: 'A4', section: 'ASSETS', title: 'A4. Restricted Cash (Escrow): Roll-Forward (project)', caption: 'Opening + Held − Release = Closing. Pre-sales cash held in escrow during construction, released back on each asset\'s Release Year. Restricted CASH (asset).', rows: buildEscrowFeederRows(ctx) },
    { key: 'L1', section: 'LIABILITIES', title: 'L1. Accounts Payable: Roll-Forward (project)', caption: 'DPO-driven AP. Opening + Opex Incurred − Cash Paid = Closing.', rows: buildApFeederRows(ctx) },
    { key: 'L2', section: 'LIABILITIES', title: 'L2. Unearned Revenue (Off-plan advances): Roll-Forward (project)', caption: 'Opening + Pre-sales contracts signed (sale value) − Revenue recognized at handover = Closing.', rows: buildUnearnedRows(ctx) },
    { key: 'L3', section: 'LIABILITIES', title: 'L3. Debt Outstanding by Tranche (project)', caption: 'Per-tranche outstanding balance. Drawdowns add; principal repayments subtract.', rows: buildDebtOutstandingRows(ctx) },
    { key: 'E1', section: 'EQUITY', title: 'E1. Equity Cumulative Roll-Forward (project, split by type)', caption: 'Opening + Cash + In-Kind + Existing = Closing. Cash flows through Cash Flow (financing); In-Kind is non-cash; Existing carries pre-axis equity forward at axis start.', rows: buildEquityRollForwardRows(ctx) },
    { key: 'E2', section: 'EQUITY', title: 'E2. Retained Earnings Roll-Forward (project)', caption: 'Opening RE + PAT − Statutory reserve transfer − Dividends = Closing RE.', rows: buildRetainedEarningsRows(ctx) },
  ];
}
