'use client';

/**
 * Module4CashFlow.tsx (M4 Pass 2d, 2026-05-20)
 *
 * Cash Flow surface with Direct + Indirect view toggle and an asset
 * filter dropdown (asset filter applies to the Direct view only;
 * the Indirect view is project-level because the working-capital
 * bridge composes across assets).
 *
 * Direct (matches the reference v1.16 CF layout):
 *   Revenue Received  −  Escrow adj  −  Opex Paid  −  Tax Paid
 *     = Cash from Operations
 *   −  Capex
 *     = Cash from Investment
 *   +  Equity drawdown  +  Debt drawdown  −  Debt repayment
 *     −  Interest paid
 *     = Cash from Financing
 *   = Net Cash Flow  →  Opening + Closing cash
 *
 * Indirect: PAT + D&A + Interest Expense − ΔWC = Cash from Operations,
 * then Investment + Financing as in Direct.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';

const SELECT_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 12,
  minWidth: 220,
};

type CFView = 'direct' | 'indirect';

export default function Module4CashFlow(): React.JSX.Element {
  const state = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      parcels: s.parcels,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
    })),
  );

  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);
  const project = state.project;
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = snap.axisLength;

  const terminology = project.financialTerminology ?? defaultTerminologyForCountry(project.country);
  const labels = getFinancialLabels(terminology);

  const [view, setView] = useState<CFView>('direct');
  // M4 Pass 2L (2026-05-20): phase filter replaces asset filter per
  // Ahmad. Buttons not dropdown; values are phase ids or '__all__'.
  const [filterPhaseId, setFilterPhaseId] = useState<string>('__all__');
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const phaseLabelFor = (phaseId: string): string => phaseById.get(phaseId)?.name ?? '';
  const phaseShort = (phaseId: string): string => {
    // Compact label for the Phase column: 'Phase 1' -> '1', else first
    // two chars of the name.
    const name = phaseLabelFor(phaseId);
    const m = name.match(/(\d+)/);
    return m ? m[1] : name.slice(0, 4);
  };

  const matchesPhase = (a: { phaseId: string }): boolean =>
    filterPhaseId === '__all__' || a.phaseId === filterPhaseId;
  const existingOpening = state.financingTranches
    .filter((t) => t.origin === 'existing')
    .reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);

  // ── Shared CASH FROM INVESTMENT / FINANCING row builders ──────────────
  // Investment + Financing are the SAME cash movements in the Direct and
  // Indirect methods, so BOTH views render them from here with identical
  // line-item detail (per-strategy capex; per-tranche existing / new debt with
  // IDC drawdown lines; equity cash + in-kind memo; dividends). Only the
  // Operations section differs by method. `capexSubtotal` / `cfiSubtotal` /
  // `cffSubtotal` are passed so each view supplies its own (filtered or
  // project-level) totals while the detail is derived from `snap`.
  const buildInvestmentRows = (capexSubtotal: number[], cfiSubtotal: number[]): M4Row[] => {
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
  };

  const buildFinancingRows = (cffSubtotal: number[]): M4Row[] => {
    const rows: M4Row[] = [];
    // Equity / in-kind / dividend series are method-independent cash; read
    // them off the Direct snapshot (identical to the Indirect arrays).
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
      // Capitalised IDC settles via additional drawdown, not cash; this memo
      // surfaces the matching outflow so finance cost is visible during
      // construction. Net cash effect = 0 against the Drawdown (IDC) row.
      if (drawIdc.some((v) => v !== 0)) rows.push({ label: `Finance Cost (Capitalised via IDC drawdown), ${label}`, values: drawIdc.map((v) => -v), indent: 1 });
    };
    pushDebtBucket('existing', 'Existing loans', existingOpening);
    pushDebtBucket('new', 'New loans');
    if (d.dividendsPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Dividends paid', values: d.dividendsPaidPerPeriod, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Financing', values: cffSubtotal, isSubtotal: true, priorValue: priorEquityTotal + existingOpening });
    return rows;
  };

  // Direct CF rows, project view (M4 Pass 2L 2026-05-20):
  //  - Phase filter narrows the asset rows shown.
  //  - Each asset row carries its phaseLabel.
  //  - Major sections (Revenue Received, Opex Paid, Capex,
  //    Financing) are collapsible; total subtotal stays visible.
  //  - Financing shows ONE row per tranche per cash-flow type:
  //    Equity drawdown total + per-debt-tranche drawdown (capex),
  //    drawdown (IDC), repayment, finance cost paid.
  const buildDirectProjectRows = (): M4Row[] => {
    const d = snap.directCF;
    const rows: M4Row[] = [];
    const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
    const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
    const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));

    // ── CASH FROM OPERATIONS ──────────────────────────────────────
    rows.push({ label: 'CASH FROM OPERATIONS', values: [], isSection: true });

    const pushAssetRow = (a: { id: string; name: string; phaseId: string }, key: keyof NonNullable<ReturnType<typeof snap.perAssetCF.get>>, group: string, sign = 1): boolean => {
      const cf = snap.perAssetCF.get(a.id);
      if (!cf) return false;
      const series = (cf[key] as number[] | undefined) ?? [];
      if (series.every((v) => v === 0)) return false;
      rows.push({
        label: a.name,
        values: sign === 1 ? series : series.map((v) => -v),
        indent: 2,
        phaseLabel: phaseShort(a.phaseId),
        collapseGroup: group,
        collapseRole: 'member',
      });
      return true;
    };

    // M4 Pass 2N (2026-05-21): per-strategy subtotals computed inline so
    // each collapsible bucket header carries its total directly (no
    // separate "Total X Received" row). Sections default-open.
    const sumAssetSeries = (
      list: Array<{ id: string; name: string; phaseId: string }>,
      key: keyof NonNullable<ReturnType<typeof snap.perAssetCF.get>>,
    ): number[] => {
      const out = new Array<number>(N).fill(0);
      for (const a of list) {
        const cf = snap.perAssetCF.get(a.id);
        if (!cf) continue;
        const series = (cf[key] as number[] | undefined) ?? [];
        for (let t = 0; t < N; t++) out[t] += series[t] ?? 0;
      }
      return out;
    };

    // Revenue received: one collapsible bucket per strategy with inline totals.
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

    // Operating expenses paid: per-strategy buckets with inline totals.
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

    rows.push(...buildInvestmentRows(d.capexPerPeriod, d.cashFromInvestmentPerPeriod));

    rows.push(...buildFinancingRows(d.cashFromFinancingPerPeriod));

    // M4 Pass 2R-Fix: prior-column subtotals (existing equity + debt +
    // pre-capex carried from before the project axis).
    const priorPreCapex = snap.financing.existing.preCapexTotal;
    const netPrior = -priorPreCapex + (snap.financing.existing.equityTotal + existingOpening);

    rows.push({ label: 'Net Cash Flow', values: d.netCashFlowPerPeriod, isTotal: true, priorValue: netPrior });
    rows.push({ label: 'Opening cash', values: d.openingCashPerPeriod, indent: 1, totalOverride: fmt(d.openingCashPerPeriod[0] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
    rows.push({ label: 'Closing cash', values: d.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(d.closingCashPerPeriod[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
    return rows;
  };

  // M4 Pass 2M-B2 (2026-05-20): Indirect CF gets phase column + phase
  // filter for parity with Direct + P&L. Per-asset-summable bridge
  // lines (Inventory change, AP change, Unearned change, Escrow
  // change, Capex) decompose to phase via the same per-asset slices
  // we use in the BS phase view. Per-tranche financing decomposes by
  // tranche.phaseId. PAT, D&A, Interest expense add-back, Operating
  // AR change, Cash interest paid, and Equity drawdown stay
  // project-level and carry a (project) tag under filter. The Net
  // Cash Flow subtotal may drift vs the Direct view under filter
  // because the project-level rows don't decompose cleanly.
  const buildIndirectRows = (): M4Row[] => {
    const ic = snap.indirectCF;
    const filtered = filterPhaseId !== '__all__';
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

    // Per-asset summable bridge lines.
    // Cost of sales add-back (2026-06-01): capex builds Sell Inventory and
    // its cash sits in Investing, so the operating section adds CoS back
    // (non-cash, like D&A) rather than subtracting the inventory build.
    // Mirrors the resolver's costOfSalesAddBackPerPeriod; CoS is already
    // per-period (no periodChange).
    const cosAddBackPhase = sumAssets((id) => snap.perAssetPL.get(id)?.cosPerPeriod);
    const apClosingPhase = sumAssets((id) => snap.ap.byAsset.get(id)?.result.perPeriod);
    const changeInAp = periodChange(apClosingPhase);
    const unearnedClosingPhase = sumAssets((id) => snap.byAssetSchedules.get(id)?.unearned.perPeriod);
    const changeInUnearned = periodChange(unearnedClosingPhase);
    const escrowClosingPhase = sumAssets((id) => snap.escrow.byAsset.get(id)?.result.cumulativeBalancePerPeriod);
    const changeInEscrow = periodChange(escrowClosingPhase);
    const capexFiltered = (() => {
      const out = zerosN();
      const assets = filtered
        ? visibleAssets.filter((a) => a.phaseId === filterPhaseId)
        : visibleAssets;
      for (const a of assets) {
        const cf = snap.perAssetCF.get(a.id);
        if (!cf) continue;
        for (let t = 0; t < N; t++) out[t] += -(cf.capexPerPeriod[t] ?? 0);
      }
      return out;
    })();

    // Per-tranche financing flows under filter.
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

    // Project-only lines stay project-level.
    const patPhase = ic.patPerPeriod;
    const daPhase = ic.daPerPeriod;
    const intExpPhase = ic.interestExpensePerPeriod;
    const changeArPhase = ic.changeInArPerPeriod;
    const equityDrawPhase = ic.equityDrawdownPerPeriod;

    // Recomputed subtotals when filtered; otherwise fall back to the snapshot.
    const cfoFiltered = zerosN();
    const cfiFiltered = capexFiltered.slice();
    const cffFiltered = zerosN();
    for (let t = 0; t < N; t++) {
      cfoFiltered[t] = (patPhase[t] ?? 0)
        + (daPhase[t] ?? 0)
        + (intExpPhase[t] ?? 0)
        - (changeArPhase[t] ?? 0)
        + cosAddBackPhase[t]
        + changeInAp[t]
        + changeInUnearned[t]
        + changeInEscrow[t];
      cffFiltered[t] = (equityDrawPhase[t] ?? 0)
        + debtDrawFiltered[t]
        + debtRepayFiltered[t]
        + interestPaidFiltered[t];
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

    const phaseLbl = (id: string): string => phaseShort(id);

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

    // Investment + Financing carry the SAME line-item detail as the Direct
    // view (identical cash movements), via the shared builders. Subtotals
    // come from the Indirect view's own (filtered or project-level) arrays.
    rows.push(...buildInvestmentRows(cpx, cfi));
    rows.push(...buildFinancingRows(cff));
    rows.push({ label: 'Net Cash Flow', values: netCf, isTotal: true });
    // Opening / Closing cash. Project view only: it must tie out to the
    // Direct method's closing balance (same closingCashAdj series).
    if (!filtered) {
      rows.push({ label: 'Opening cash', values: ic.openingCashPerPeriod, indent: 1, totalOverride: fmt(ic.openingCashPerPeriod[0] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
      rows.push({ label: 'Closing cash', values: ic.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(ic.closingCashPerPeriod[N - 1] ?? 0), priorValue: snap.bs.historicalOpeningCashTotal });
    }
    // Avoid unused-variable lint warning while the per-tranche detail
    // is folded into aggregate lines.
    void phaseLbl;
    return rows;
  };

  const rows = view === 'direct' ? buildDirectProjectRows() : buildIndirectRows();

  return (
    <div data-testid="module4-cashflow" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Cash Flow Statement</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Direct CF mirrors the reference v1.16 layout (literal cash in/out). Indirect CF reconstructs cash from
          {' '}{labels.pat} via D&A and working-capital changes. Both views end with the same Net Cash Flow per
          period, if they diverge there's a working-capital line missing in the bridge.
        </p>
      </div>

      {/* View toggle + asset filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600 }}>Method:</label>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {(['direct', 'indirect'] as const).map((m) => {
            const active = view === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                style={{
                  fontSize: 11,
                  padding: '6px 12px',
                  background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                  color: active ? 'var(--color-on-primary-navy)' : 'var(--color-navy)',
                  border: '1px solid var(--color-navy)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                data-testid={`m4-cf-view-${m}`}
              >
                {m === 'direct' ? 'Direct' : 'Indirect'}
              </button>
            );
          })}
        </div>
        {(view === 'direct' || view === 'indirect') && (
          <>
            <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600, marginLeft: 16 }}>Phase:</label>
            <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }} data-testid="m4-cf-phase-filter">
              {[{ id: '__all__', name: 'All' } as const, ...state.phases.map((p) => ({ id: p.id, name: p.name }))].map((opt) => {
                const active = filterPhaseId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFilterPhaseId(opt.id)}
                    style={{
                      fontSize: 11,
                      padding: '6px 12px',
                      background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                      color: active ? 'var(--color-on-primary-navy)' : 'var(--color-navy)',
                      border: '1px solid var(--color-navy)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    data-testid={`m4-cf-phase-filter-${opt.id}`}
                  >
                    {opt.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <M4PeriodTable
        title={view === 'direct'
          ? (filterPhaseId === '__all__' ? 'Cash Flow, Direct Method (project)' : `Cash Flow, Direct Method (${phaseLabelFor(filterPhaseId)})`)
          : (filterPhaseId === '__all__' ? 'Cash Flow, Indirect Method (project)' : `Cash Flow, Indirect Method (${phaseLabelFor(filterPhaseId)})`)}
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
        showPhaseColumn={view === 'direct'}
        rows={rows.length > 0 ? rows : [{ label: 'No data', values: new Array<number>(N).fill(0) }]}
      />
    </div>
  );
}
