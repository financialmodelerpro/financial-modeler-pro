'use client';

/**
 * Module4BSFeeders.tsx (M4 Pass 2i, 2026-05-20)
 *
 * Read-only consolidator of every schedule that feeds the Balance
 * Sheet, ordered by BS sequence (Assets → Liabilities → Equity →
 * Memo). No new math: each section is a collapsible PhaseSection
 * holding one or more PeriodTables wired to the financials snapshot.
 *
 * Layout:
 *   ASSETS:
 *     A1. Residential Sales Receivables (M2 milestone)
 *     A2. Operating Receivables (M4 Pass 2g DSO)
 *     A3. Inventory (Residential WIP, M2 CoS)
 *     A4. Restricted Cash (Escrow), M2 Pass 9h; restricted-cash asset
 *   LIABILITIES:
 *     L1. Accounts Payable (M3 Pass 2a DPO)
 *     L2. Unearned Revenue (M2 off-plan advances)
 *     L3. Debt Outstanding (M1 financing)
 *   EQUITY:
 *     E1. Equity Roll-Forward (M1 cumulative drawdowns)
 *   MEMO:
 *     M1. Capitalised Interest (IDC) Allocation (M4 Pass 2f)
 *
 * Fixed Assets + Depreciation lives in the sibling "Fixed Assets & D&A"
 * sub-tab so this view stays focused on the working-capital + financing
 * feeders. Both tabs are rendered by Module4Schedules (parent shell).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable } from './_shared/m4Table';
import { buildBsFeederTables } from '../../lib/reports/m4Reports';

export default function Module4BSFeeders(): React.JSX.Element {
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

  // M4 Pass 2j (2026-05-20): prior-year column = projectStartYear - 1.
  const priorYear = snap.projectStartYear - 1;

  // Rows come from the SHARED builders (lib/reports/m4Reports.buildBsFeederTables),
  // the SAME source the PDF export uses, so the on-screen tab and the PDF cannot
  // drift. Titles / captions below are the on-screen wording (kept verbatim).
  const feederRows = Object.fromEntries(buildBsFeederTables({ snap, state, fmt }).map((f) => [f.key, f.rows]));

  return (
    <div data-testid="module4-bs-feeders" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Schedules sourced from Modules 1-3 + M4 Pass 1, ordered top-to-bottom by Balance Sheet sequence. Configure
          the underlying inputs in their home modules (AP days in M3 Opex Output, DSO in this module's Balance
          Sheet tab, Escrow in M2 Escrow, etc.). Fixed Assets &amp; Depreciation lives on the sibling sub-tab.
        </p>
      </div>

      {/* ─── ASSETS ──────────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-assets" title="ASSETS" meta="Current asset schedules" storageKey="fmp:m4:bs:assets:collapsed">
        {/* A1: Residential Sales Receivables */}
        <M4PeriodTable
          title="A1. Residential Sales Receivables: Roll-Forward (project)"
          caption="Per-asset closing AR (mirror of M2 Revenue Output Block 5) + project total. AR forms ONLY on pre-sales (sale value lumps at sale year, cash collects via milestone profile). Post-handover sales (SDO) recognise revenue = cash same period and never accrue AR. Opening + Pre-Sales Sale Value − Pre-Sales Cash Collected = Closing AR."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.A1}
        />

        {/* A2: Operating Receivables (DSO) */}
        <M4PeriodTable
          title="A2. Operating Receivables: Roll-Forward (project)"
          caption="DSO-driven for hospitality + lease revenue. Closing AR = Operating revenue × DSO / 365. Configure DSO in the Balance Sheet tab → Working Capital Inputs."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.A2}
        />

        {/* A3: Inventory */}
        <M4PeriodTable
          title="A3. Inventory (Residential WIP): Roll-Forward (project)"
          caption="Opening + Capex capitalized − Released to CoS = Closing. Floored at 0 once CoS has fully unwound the capex."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.A3}
        />

        {/* A4: Restricted Cash (Escrow), the developer's pre-sales cash
            held in escrow and released back per milestones. It is an
            ASSET (restricted cash), not a liability. */}
        <M4PeriodTable
          title="A4. Restricted Cash (Escrow): Roll-Forward (project)"
          caption="Opening + Held − Release = Closing. Pre-sales cash held in escrow during construction, released back to the developer on each asset's Release Year. Restricted CASH (asset), not a liability. See the M2 Escrow tab for inputs."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.A4}
        />
      </PhaseSection>

      {/* ─── LIABILITIES ─────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-liabs" title="LIABILITIES" meta="Current + non-current liability schedules" storageKey="fmp:m4:bs:liabs:collapsed">
        {/* L1: Accounts Payable */}
        <M4PeriodTable
          title="L1. Accounts Payable: Roll-Forward (project)"
          caption="DPO-driven AP. Opening + Opex Incurred − Cash Paid = Closing. Configure DPO in M3 Opex Output."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.L1}
        />

        {/* L2: Unearned Revenue */}
        <M4PeriodTable
          title="L2. Unearned Revenue (Off-plan advances): Roll-Forward (project)"
          caption="Opening + Pre-sales contracts signed (sale value) − Revenue recognized at handover = Closing. Liability until residential units hand over."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.L2}
        />

        {/* L3: Debt Outstanding */}
        <M4PeriodTable
          title="L3. Debt Outstanding by Tranche (project)"
          caption="Per-tranche outstanding balance. Drawdowns add; principal repayments subtract; interest is recorded in the P&L."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.L3}
        />
      </PhaseSection>

      {/* ─── EQUITY ──────────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-equity" title="EQUITY" meta="Equity roll-forward + Retained Earnings schedule" storageKey="fmp:m4:bs:equity:collapsed">
        {/* E1: Equity Roll-Forward split by type (Pass 2P) */}
        <M4PeriodTable
          title="E1. Equity Cumulative Roll-Forward (project, split by type)"
          caption="Opening + Cash + In-Kind + Existing = Closing. Cash equity flows through Cash Flow (financing block); In-Kind equity is non-cash (land contributed in-kind, recognised on BS as Land + Share Capital simultaneously); Existing equity carries pre-existing operational-phase equity forward at axis start."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.E1}
        />

        {/* E2: Retained Earnings Schedule (Pass 2P) */}
        <M4PeriodTable
          title="E2. Retained Earnings Roll-Forward (project)"
          caption="Opening RE + PAT − Statutory reserve transfer − Dividends = Closing RE. Dividends are zero today (Dividend policy lands in a follow-up pass); the row is present so the schedule is wired end-to-end."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={feederRows.E2}
        />
      </PhaseSection>

      {/* M4 Pass 2O (2026-05-24): IDC Allocation moved to Module 1
          Financing → Schedules → IDC Allocation. The MEMO section here
          previously duplicated that breakdown; removed to avoid two
          sources of truth. */}
    </div>
  );
}
