'use client';

/**
 * Module4BSFeeders.tsx (M4 Pass 2i, 2026-05-20)
 *
 * Read-only consolidator of every schedule that feeds the Balance
 * Sheet, ordered by BS sequence (Assets → Liabilities → Equity).
 * No new math: each section is a collapsible PhaseSection holding one
 * or more PeriodTables wired to the financials snapshot.
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
 *     E2. Retained Earnings Roll-Forward
 *
 * TITLES, CAPTIONS AND ROWS ARE ALL THE SHARED BUILDER'S (2026-09-17):
 * `buildBsFeederTables` is what the PDF and the workbook render, so the three
 * surfaces carry one wording. This tab used to type its own captions beside the
 * builder's, and its E2 caption still said dividends were zero after the
 * dividend policy shipped.
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
import { buildBsFeederTables, BS_FEEDER_SECTIONS } from '../../lib/reports/m4Reports';

const SECTION_IDS: Record<string, { phaseId: string; storageKey: string }> = {
  ASSETS: { phaseId: 'm4-bs-assets', storageKey: 'fmp:m4:bs:assets:collapsed' },
  LIABILITIES: { phaseId: 'm4-bs-liabs', storageKey: 'fmp:m4:bs:liabs:collapsed' },
  EQUITY: { phaseId: 'm4-bs-equity', storageKey: 'fmp:m4:bs:equity:collapsed' },
};

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

  const tables = buildBsFeederTables({ snap, state, fmt });

  return (
    <div data-testid="module4-bs-feeders" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Schedules sourced from Modules 1-3 + M4 Pass 1, ordered top-to-bottom by Balance Sheet sequence. Configure
          the underlying inputs in their home modules (AP days in M3 Opex Output, DSO in this module's Balance
          Sheet tab, Escrow in M2 Escrow, etc.). Fixed Assets &amp; Depreciation lives on the sibling sub-tab.
        </p>
      </div>

      {BS_FEEDER_SECTIONS.map((sec) => (
        <PhaseSection
          key={sec.section}
          phaseId={SECTION_IDS[sec.section].phaseId}
          title={sec.section}
          meta={sec.meta}
          storageKey={SECTION_IDS[sec.section].storageKey}
        >
          {tables.filter((t) => t.section === sec.section).map((t) => (
            <M4PeriodTable
              key={t.key}
              title={t.title}
              caption={t.caption}
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              priorYearLabel={priorYear}
              rows={t.rows}
            />
          ))}
        </PhaseSection>
      ))}

      {/* M4 Pass 2O (2026-05-24): IDC Allocation moved to Module 1
          Financing → Schedules → IDC Allocation. The MEMO section here
          previously duplicated that breakdown; removed to avoid two
          sources of truth. */}
    </div>
  );
}
