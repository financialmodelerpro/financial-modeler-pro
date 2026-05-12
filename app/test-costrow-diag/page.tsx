'use client';

/**
 * Test page for Tab 3 Costs edit-mode runtime diagnostic.
 * Seeds the module1-store with a MAAD-shape fixture and renders
 * Module1Costs directly. Bypasses auth + project list flow so a
 * Playwright spec can navigate to /test-costrow-diag and inspect the
 * actual rendered CostRow DOM without signing in.
 *
 * Used by tests/e2e/tab3-edit-runtime.spec.ts as a runtime regression
 * guard for the Pass 1 per-field editability fix. Unlinked from the
 * main app navigation. Safe to leave in production (no external links;
 * no destructive actions).
 */

import React, { useEffect, useState } from 'react';
import Module1Costs from '@/src/hubs/modeling/platforms/refm/components/modules/Module1Costs';
import { useModule1Store } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';

const MAAD_SEED = {
  project: {
    name: 'Diagnostic Project',
    startDate: '2026-01-01',
    currency: 'SAR' as const,
    modelType: 'annual' as const,
    projectType: 'Mixed-Use',
    country: 'SA',
    displayScale: 'thousands' as const,
    displayDecimals: 0 as const,
    outputGranularity: 'annual' as const,
  },
  phases: [{
    id: 'phase-1', name: 'Phase 1', startDate: '2026-01-01',
    constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0,
  }],
  parcels: [{
    id: 'parcel-1', phaseId: 'phase-1', name: 'Parcel A',
    area: 22066, rate: 98450, cashPct: 80, inKindPct: 20,
  }],
  landAllocationMode: 'autoByBua' as const,
  activePhaseId: 'phase-1',
  assets: [{
    id: 'asset-1', phaseId: 'phase-1', name: 'Branded Apt', type: '',
    strategy: 'Sell' as const, visible: true, gfaSqm: 0, buaSqm: 130874,
    sellableBuaSqm: 84297, parkingBaysRequired: 0,
    landAllocation: { parcelId: 'parcel-1', sqm: 0 },
  }],
  subUnits: [],
  costLines: [
    { id: 'land-cash__phase-1', phaseId: 'phase-1', name: 'Land (Cash)',
      method: 'percent_of_cash_land' as const, value: 100,
      stage: 'land' as const, scope: 'direct' as const,
      allocationBasis: 'land_share' as const,
      startPeriod: 0, endPeriod: 0, phasing: 'even' as const, isLocked: true },
    { id: 'land-inkind__phase-1', phaseId: 'phase-1', name: 'Land (In-Kind)',
      method: 'percent_of_inkind_land' as const, value: 100,
      stage: 'land' as const, scope: 'direct' as const,
      allocationBasis: 'land_share' as const,
      startPeriod: 0, endPeriod: 0, phasing: 'even' as const, isLocked: true },
    { id: 'construction-bua__phase-1', phaseId: 'phase-1', name: 'Construction (BUA)',
      method: 'rate_per_bua' as const, value: 4500,
      stage: 'hard' as const, scope: 'direct' as const,
      allocationBasis: 'bua_share' as const,
      startPeriod: 1, endPeriod: 5, phasing: 'even' as const },
  ],
  costOverrides: [],
  financingTranches: [],
  equityContributions: [],
};

export default function TestCostRowDiagPage(): React.JSX.Element {
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    // Cast through unknown because the seed fixture only partially
    // populates the store schema. This is a diagnostic-only render path
    // so the missing optional fields are acceptable.
    useModule1Store.setState((s) => ({
      ...s,
      ...(MAAD_SEED as unknown as Partial<typeof s>),
    }));
    setSeeded(true);
  }, []);

  if (!seeded) return <div data-testid="seeding">Seeding...</div>;
  return (
    <div data-testid="test-costrow-page" style={{ padding: 20 }}>
      <h1>Tab 3 Edit-Mode Diagnostic</h1>
      <Module1Costs />
    </div>
  );
}
// touch
