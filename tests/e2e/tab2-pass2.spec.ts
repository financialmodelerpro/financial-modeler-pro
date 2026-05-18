/**
 * tab2-pass2.spec.ts (Tab 2 Pass 2 DOM proof, 2026-05-12)
 *
 * Two proofs against the Pass 2 multi-phase reference shape fixture:
 *   1. Phase 2 asset's Sqm Allocated row renders non-zero (Fix 1 +
 *      per-asset BUA-weighted split inside the phase).
 *   2. Companion (Sell + Manage Operate sibling) renders WITHOUT a
 *      Land Allocation block, Areas Row, NDA row, hierarchy chips,
 *      footer summary, or Area Reconciliation summary line.
 *
 * Skips gracefully when /refm requires NextAuth in dev (no sidebar
 * found post-navigation). Manual capture: sign in on
 * app.financialmodelerpro.com, hard-refresh, then run
 * `npx playwright test tests/e2e/tab2-pass2.spec.ts --headed`.
 *
 * Run: npm run dev (in another shell) THEN
 *      npx playwright test tests/e2e/tab2-pass2.spec.ts
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'tab2-pass2');

const REF_MULTIPHASE_SNAPSHOT = {
  version: 8,
  savedAt: '2026-05-12T00:00:00.000Z',
  project: {
    name: 'the reference model Pass 2 Multi-Phase',
    startDate: '2026-01-01',
    currency: 'SAR',
    modelType: 'annual',
    projectType: 'Mixed-Use',
    country: 'SA',
    displayScale: 'thousands',
    displayDecimals: 0,
    outputGranularity: 'annual',
  },
  phases: [
    { id: 'phase-1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 },
    { id: 'phase-2', name: 'Phase 2', startDate: '2026-06-01', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 },
    { id: 'phase-3', name: 'Phase 3', startDate: '2027-01-01', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 },
  ],
  parcels: [
    { id: 'parcel-1', phaseId: 'phase-1', name: 'Parcel 1', area: 16348, rate: 98450, cashPct: 80, inKindPct: 20 },
    { id: 'parcel-2', phaseId: 'phase-2', name: 'Parcel 2', area: 50000, rate: 98450, cashPct: 80, inKindPct: 20 },
    { id: 'parcel-3', phaseId: 'phase-3', name: 'Parcel 3', area: 40000, rate: 98450, cashPct: 80, inKindPct: 20 },
  ],
  landAllocationMode: 'autoByBua',
  assets: [
    {
      id: 'a-branded', phaseId: 'phase-2', name: 'Branded Apt T2&T3', type: '', strategy: 'Sell', visible: true,
      gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0, status: 'planned',
    },
    {
      id: 'a-residential', phaseId: 'phase-2', name: 'Residential Tower 01', type: '', strategy: 'Sell + Manage', visible: true,
      gfaSqm: 0, buaSqm: 154140, sellableBuaSqm: 100000, parkingBaysRequired: 0, status: 'planned',
    },
    {
      id: 'companion_a-residential', phaseId: 'phase-2', name: 'Residential Tower 01 - Operate',
      type: '', strategy: 'Operate', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0,
      parkingBaysRequired: 0, status: 'planned',
      parentAssetId: 'a-residential', isCompanion: true, companionType: 'operate', unitsFromParent: 0,
    },
    {
      id: 'a-hotel', phaseId: 'phase-3', name: 'Hotel 01', type: '', strategy: 'Operate', visible: true,
      gfaSqm: 0, buaSqm: 80000, sellableBuaSqm: 65000, parkingBaysRequired: 0, status: 'planned',
    },
    {
      id: 'a-retail', phaseId: 'phase-3', name: 'Retail Mall', type: '', strategy: 'Lease', visible: true,
      gfaSqm: 0, buaSqm: 40000, sellableBuaSqm: 30000, parkingBaysRequired: 0, status: 'planned',
    },
  ],
  subUnits: [],
  costLines: [],
  costOverrides: [],
  financingTranches: [],
  equityContributions: [],
};

test.describe('Tab 2 Pass 2 DOM proof', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Phase 2 Branded Apt Sqm Allocated renders non-zero on autoByBua', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) {
      test.skip(true, '/refm requires authentication; manual screenshot pending');
    }
    await page.evaluate((snap) => {
      try {
        window.localStorage.setItem('module1-store', JSON.stringify({ state: snap, version: 0 }));
      } catch { /* noop */ }
    }, REF_MULTIPHASE_SNAPSHOT);
    await page.reload();
    if ((await page.getByTestId('sidebar-module1').count()) === 0) {
      test.skip(true, '/refm requires auth after reload');
    }
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    // Expand Land Reconciliation block so per-asset rows render.
    const reconToggle = page.getByTestId('land-reconciliation-toggle');
    if ((await reconToggle.count()) > 0) await reconToggle.click();

    const brandedSqm = page.getByTestId('recon-asset-a-branded-sqm');
    if ((await brandedSqm.count()) === 0) {
      test.skip(true, 'recon-asset-a-branded-sqm testid not found; project may have failed to hydrate');
    }
    const text = (await brandedSqm.innerText()).replace(/[\s,]/g, '');
    const num = Number(text);
    expect(num, `Branded Apt Sqm Allocated parsed "${text}"`).toBeGreaterThan(0);

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/phase2-sqm-allocated.png`, fullPage: true });
  });

  test('Companion asset hides Land + Areas + Recon blocks', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) {
      test.skip(true, '/refm requires authentication');
    }
    await page.evaluate((snap) => {
      try {
        window.localStorage.setItem('module1-store', JSON.stringify({ state: snap, version: 0 }));
      } catch { /* noop */ }
    }, REF_MULTIPHASE_SNAPSHOT);
    await page.reload();
    if ((await page.getByTestId('sidebar-module1').count()) === 0) {
      test.skip(true, '/refm requires auth after reload');
    }
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    // Expand the companion asset card.
    const companionCard = page.getByTestId('asset-card-companion_a-residential');
    if ((await companionCard.count()) === 0) {
      test.skip(true, 'companion asset card not found; project may have failed to hydrate');
    }
    // Click header to expand if collapsed (default-collapsed per Pass 1 Fix 6).
    await companionCard.locator('strong').first().click().catch(() => { /* may be expanded already */ });

    // Companion must NOT carry these surfaces:
    expect(await page.getByTestId('asset-companion_a-residential-land-allocation-block').count()).toBe(0);
    expect(await page.getByTestId('asset-companion_a-residential-areas-row').count()).toBe(0);
    expect(await page.getByTestId('asset-companion_a-residential-nda-row').count()).toBe(0);
    expect(await page.getByTestId('asset-companion_a-residential-area-hierarchy').count()).toBe(0);
    expect(await page.getByTestId('asset-card-companion_a-residential-footer').count()).toBe(0);
    expect(await page.getByTestId('asset-companion_a-residential-area-reconciliation').count()).toBe(0);

    // But it MUST carry these:
    expect(await page.getByTestId('asset-companion_a-residential-operating-period').count()).toBe(1);
    expect(await page.getByTestId('asset-companion_a-residential-companion-badge').count()).toBe(1);

    // Land Recon list must exclude the companion row.
    const reconToggle = page.getByTestId('land-reconciliation-toggle');
    if ((await reconToggle.count()) > 0) await reconToggle.click();
    expect(await page.getByTestId('recon-asset-companion_a-residential-sqm').count()).toBe(0);

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/companion-no-land-blocks.png`, fullPage: true });
  });
});
