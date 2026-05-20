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
    const matchesPhase = (a: { phaseId: string }): boolean =>
      filterPhaseId === '__all__' || a.phaseId === filterPhaseId;
    const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
    const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
    const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));

    // ── CASH FROM OPERATIONS ──────────────────────────────────────
    rows.push({ label: 'CASH FROM OPERATIONS', values: [], isSection: true });

    // Revenue received - collapsible group, asset details under each
    // strategy header.
    rows.push({
      label: 'Revenue received',
      values: [],
      isSection: true,
      collapseGroup: 'cf-rev',
      collapseRole: 'header',
      defaultCollapsed: true,
    });
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
    if (residentialAssets.length > 0) {
      rows.push({ label: 'Residential revenue', values: [], isSection: true, collapseGroup: 'cf-rev', collapseRole: 'member' });
      for (const a of residentialAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev');
    }
    if (hospitalityAssets.length > 0) {
      rows.push({ label: 'Hospitality revenue', values: [], isSection: true, collapseGroup: 'cf-rev', collapseRole: 'member' });
      for (const a of hospitalityAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev');
    }
    if (retailAssets.length > 0) {
      rows.push({ label: 'Retail revenue', values: [], isSection: true, collapseGroup: 'cf-rev', collapseRole: 'member' });
      for (const a of retailAssets) pushAssetRow(a, 'revenueReceivedPerPeriod', 'cf-rev');
    }
    rows.push({ label: 'Total Revenue Received', values: d.revenueReceivedPerPeriod, isSubtotal: true });

    if (d.escrowHeldPerPeriod.some((v) => v !== 0) || d.escrowReleasePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Less: Inaccessible Funds Locked', values: d.escrowHeldPerPeriod, indent: 1 });
      rows.push({ label: 'Add: Release of Inaccessible Funds', values: d.escrowReleasePerPeriod, indent: 1 });
    }

    // Operating expenses paid - collapsible group.
    rows.push({
      label: 'Operating expenses paid',
      values: [],
      isSection: true,
      collapseGroup: 'cf-opex',
      collapseRole: 'header',
      defaultCollapsed: true,
    });
    if (hospitalityAssets.length > 0) {
      rows.push({ label: 'Hospitality', values: [], isSection: true, collapseGroup: 'cf-opex', collapseRole: 'member' });
      for (const a of hospitalityAssets) pushAssetRow(a, 'opexPaidPerPeriod', 'cf-opex', -1);
    }
    if (retailAssets.length > 0) {
      rows.push({ label: 'Retail', values: [], isSection: true, collapseGroup: 'cf-opex', collapseRole: 'member' });
      for (const a of retailAssets) pushAssetRow(a, 'opexPaidPerPeriod', 'cf-opex', -1);
    }
    if (d.hqOpexPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({
        label: 'HQ Expenses',
        values: d.hqOpexPaidPerPeriod,
        indent: 2,
        collapseGroup: 'cf-opex',
        collapseRole: 'member',
      });
    }
    rows.push({ label: 'Total Operating Expenses Paid', values: d.opexPaidPerPeriod.map((v, i) => v + (d.hqOpexPaidPerPeriod[i] ?? 0)), isSubtotal: true });

    if (d.taxPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: `${labels.taxPaid}`, values: d.taxPaidPerPeriod, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Operations', values: d.cashFromOperationsPerPeriod, isTotal: true });

    // ── CASH FROM INVESTMENT ──────────────────────────────────────
    rows.push({ label: 'CASH FROM INVESTMENT', values: [], isSection: true });
    rows.push({
      label: 'Capital expenditure excl. inventory cost',
      values: [],
      isSection: true,
      collapseGroup: 'cf-capex',
      collapseRole: 'header',
      defaultCollapsed: true,
    });
    if (residentialAssets.length > 0) {
      rows.push({ label: 'Residential Capex', values: [], isSection: true, collapseGroup: 'cf-capex', collapseRole: 'member' });
      for (const a of residentialAssets) pushAssetRow(a, 'capexPerPeriod', 'cf-capex', -1);
    }
    if (hospitalityAssets.length > 0) {
      rows.push({ label: 'Hospitality Capex', values: [], isSection: true, collapseGroup: 'cf-capex', collapseRole: 'member' });
      for (const a of hospitalityAssets) pushAssetRow(a, 'capexPerPeriod', 'cf-capex', -1);
    }
    if (retailAssets.length > 0) {
      rows.push({ label: 'Retail Capex', values: [], isSection: true, collapseGroup: 'cf-capex', collapseRole: 'member' });
      for (const a of retailAssets) pushAssetRow(a, 'capexPerPeriod', 'cf-capex', -1);
    }
    rows.push({ label: 'Total Capex', values: d.capexPerPeriod, isSubtotal: true });
    rows.push({ label: 'Cash Flow from Investment', values: d.cashFromInvestmentPerPeriod, isTotal: true });

    // ── CASH FROM FINANCING ───────────────────────────────────────
    // Each debt tranche shows: Drawdown (Capex), Drawdown (IDC),
    // Repayment, Finance Cost Paid as separate rows. Equity stays as
    // one aggregate line (engine doesn't break equity per tranche).
    rows.push({ label: 'CASH FROM FINANCING', values: [], isSection: true });
    // M4 Pass 2M-A3 (2026-05-20): equity decomposition.
    // The engine emits a single project-level equity cash array; the
    // store carries an EquityContribution[] with per-contribution
    // amount + phase + name. Display-only decomposition: pro-rate each
    // period's equity cash by contribution amount weight. Totals stay
    // identical to the aggregate. If only one contribution (or no
    // contributions), keep the aggregate row.
    if (d.equityDrawdownPerPeriod.some((v) => v !== 0)) {
      const contribs = state.equityContributions ?? [];
      const totalAmount = contribs.reduce((s, c) => s + Math.max(0, c.amount ?? 0), 0);
      if (contribs.length >= 2 && totalAmount > 0) {
        rows.push({ label: 'Equity Drawdown (Total)', values: d.equityDrawdownPerPeriod, indent: 1, isSubtotal: true, collapseGroup: 'cf-equity', collapseRole: 'header' });
        for (const c of contribs) {
          const w = Math.max(0, c.amount ?? 0) / totalAmount;
          if (w <= 0) continue;
          const perPeriod = d.equityDrawdownPerPeriod.map((v) => v * w);
          const phaseLabel = phaseShort(c.phaseId);
          rows.push({ label: `Equity Drawdown, ${c.name || 'Equity'}`, values: perPeriod, indent: 2, phaseLabel, collapseGroup: 'cf-equity', collapseRole: 'member' });
        }
      } else {
        rows.push({ label: 'Equity Drawdown', values: d.equityDrawdownPerPeriod, indent: 1 });
      }
    }
    // Per-tranche debt detail.
    // M4 Pass 2M-A2 (2026-05-20): split Finance Cost Paid into two
    // window-scoped lines per tranche so the user sees IDC-window
    // (construction) interest separately from Operations-window cash
    // interest. Window is derived from the tranche's phase: IDC =
    // [phaseOffset, phaseOffset + cp); Operations = [phaseOffset + cp,
    // N). The split mirrors v1.16's two-row finance-cost layout.
    const projectStartYearForSplit = snap.projectStartYear;
    for (const t of state.financingTranches) {
      const f = snap.financing.facilities.get(t.id);
      if (!f) continue;
      // Slice off the financing engine's prior column (idx 0) to align
      // with the project axis.
      const drawCapex = f.drawSchedule.slice(1, 1 + N);
      while (drawCapex.length < N) drawCapex.push(0);
      const drawIdc = f.interestCapitalized.slice(1, 1 + N);
      while (drawIdc.length < N) drawIdc.push(0);
      const repaid = f.principalRepaid.slice(1, 1 + N);
      while (repaid.length < N) repaid.push(0);
      const intPaid = f.interestPaid.slice(1, 1 + N);
      while (intPaid.length < N) intPaid.push(0);
      const phaseLabel = phaseShort(t.phaseId);

      const ph = phaseById.get(t.phaseId);
      const phaseStartYear = ph?.startDate ? new Date(ph.startDate).getUTCFullYear() : projectStartYearForSplit;
      const phaseOffset = Math.max(0, phaseStartYear - projectStartYearForSplit);
      const cp = Math.max(0, ph?.constructionPeriods ?? 0);
      const idcEnd = Math.min(N, phaseOffset + cp);
      const intPaidIdc: number[] = new Array(N).fill(0);
      const intPaidOps: number[] = new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        if (i < phaseOffset) continue;
        if (i < idcEnd) intPaidIdc[i] = intPaid[i] ?? 0;
        else intPaidOps[i] = intPaid[i] ?? 0;
      }

      if (drawCapex.some((v) => v !== 0)) {
        rows.push({ label: `Debt Drawdown, ${t.name}`, values: drawCapex, indent: 1, phaseLabel });
      }
      if (drawIdc.some((v) => v !== 0)) {
        rows.push({ label: `Debt Drawdown, ${t.name} (IDC)`, values: drawIdc, indent: 1, phaseLabel });
      }
      if (repaid.some((v) => v !== 0)) {
        rows.push({ label: `Debt Repayment, ${t.name}`, values: repaid.map((v) => -v), indent: 1, phaseLabel });
      }
      if (intPaidIdc.some((v) => v !== 0)) {
        rows.push({ label: `Finance Cost Paid (IDC), ${t.name}`, values: intPaidIdc.map((v) => -v), indent: 1, phaseLabel });
      }
      if (intPaidOps.some((v) => v !== 0)) {
        rows.push({ label: `Finance Cost Paid (Operations), ${t.name}`, values: intPaidOps.map((v) => -v), indent: 1, phaseLabel });
      }
    }
    rows.push({ label: 'Cash Flow from Financing', values: d.cashFromFinancingPerPeriod, isSubtotal: true });

    rows.push({ label: 'Net Cash Flow', values: d.netCashFlowPerPeriod, isTotal: true });
    rows.push({ label: 'Opening cash', values: d.openingCashPerPeriod, indent: 1, totalOverride: fmt(d.openingCashPerPeriod[0] ?? 0) });
    rows.push({ label: 'Closing cash', values: d.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(d.closingCashPerPeriod[N - 1] ?? 0) });
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
    const inventoryClosingPhase = sumAssets((id) => snap.perAssetCF.get(id)?.inventoryPerPeriod);
    const changeInInventory = periodChange(inventoryClosingPhase);
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
    const interestPaidProjPhase = ic.interestPaidPerPeriod;
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
        - changeInInventory[t]
        + changeInAp[t]
        + changeInUnearned[t]
        + changeInEscrow[t]
        - (interestPaidProjPhase[t] ?? 0);
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
    const inv = filtered ? changeInInventory : ic.changeInInventoryPerPeriod;
    const ap = filtered ? changeInAp : ic.changeInApPerPeriod;
    const un = filtered ? changeInUnearned : ic.changeInUnearnedPerPeriod;
    const esc = filtered ? changeInEscrow : ic.changeInEscrowPerPeriod;
    const cpx = filtered ? capexFiltered : ic.capexPerPeriod;
    const debtDraw = filtered ? debtDrawFiltered : ic.debtDrawdownPerPeriod;
    const debtRepay = filtered ? debtRepayFiltered : ic.debtRepaymentPerPeriod;
    const intPaidFin = filtered ? interestPaidFiltered : ic.interestPaidPerPeriod;

    const phaseLbl = (id: string): string => phaseShort(id);

    const rows: M4Row[] = [];
    rows.push({ label: 'CASH FROM OPERATIONS (INDIRECT)', values: [], isSection: true });
    rows.push({ label: `${labels.pat}${projTag}`, values: patPhase, indent: 1 });
    rows.push({ label: `(+) Depreciation & Amortization${projTag}`, values: daPhase, indent: 1 });
    rows.push({ label: `(+) Interest expense (add back)${projTag}`, values: intExpPhase, indent: 1 });
    rows.push({ label: `(−) Change in AR${projTag}`, values: changeArPhase, indent: 1 });
    rows.push({ label: '(−) Change in Inventory', values: inv, indent: 1 });
    rows.push({ label: '(+) Change in AP', values: ap, indent: 1 });
    rows.push({ label: '(+) Change in Unearned Revenue', values: un, indent: 1 });
    rows.push({ label: '(+) Change in Escrow balance', values: esc, indent: 1 });
    rows.push({ label: `(−) Cash interest paid${projTag}`, values: interestPaidProjPhase, indent: 1 });
    rows.push({ label: 'Cash Flow from Operations', values: cfo, isSubtotal: true });

    rows.push({ label: 'CASH FROM INVESTMENT', values: [], isSection: true });
    rows.push({ label: 'Capital expenditure', values: cpx, indent: 1 });
    rows.push({ label: 'Cash Flow from Investment', values: cfi, isSubtotal: true });

    rows.push({ label: 'CASH FROM FINANCING', values: [], isSection: true });
    if (equityDrawPhase.some((v) => v !== 0)) {
      rows.push({ label: `Equity drawdown${projTag}`, values: equityDrawPhase, indent: 1 });
    }
    if (debtDraw.some((v) => v !== 0)) {
      rows.push({ label: 'Debt drawdown', values: debtDraw, indent: 1 });
    }
    if (debtRepay.some((v) => v !== 0)) {
      rows.push({ label: 'Debt repayment', values: debtRepay, indent: 1 });
    }
    if (intPaidFin.some((v) => v !== 0)) {
      rows.push({ label: 'Finance cost paid', values: intPaidFin, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Financing', values: cff, isSubtotal: true });
    rows.push({ label: 'Net Cash Flow', values: netCf, isTotal: true });
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
