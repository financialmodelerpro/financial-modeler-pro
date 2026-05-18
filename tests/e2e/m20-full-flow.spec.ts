/**
 * m20-full-flow.spec.ts
 *
 * M2.0 (spec) full first-time flow walkthrough.
 *
 * 1. Open /refm
 * 2. Open the wizard from Dashboard
 * 3. Walk Step 1 -> Step 2 -> Step 3
 * 4. Create the project
 * 5. Verify the 4-tab row renders (no Land / no Build Program / no Hierarchy)
 * 6. Walk each tab and capture light + dark screenshots
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0');

async function setColorMode(page: import('@playwright/test').Page, mode: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate((m) => {
    document.documentElement.setAttribute('data-theme', m);
  }, mode);
}

test.describe('M2.0 4-tab spec module 1', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('wizard creates project + 4 tabs render with v5 testIds', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });

    // Open wizard
    await page.getByTestId('dashboard-create').click();
    await expect(page.getByTestId('project-wizard')).toBeVisible();

    // Step 1: basics
    await page.getByTestId('wiz-projectName').fill('M2.0 Smoke Test');
    await page.getByTestId('wiz-currency').fill('SAR');
    await page.getByTestId('wiz-modelType').selectOption('annual');
    await page.getByTestId('wiz-location').fill('Riyadh');
    await page.getByTestId('wizard-next').click();

    // Step 2: phase + parcel defaults are seeded
    await expect(page.getByTestId('wiz-phase-row-0')).toBeVisible();
    await expect(page.getByTestId('wiz-parcel-row-0')).toBeVisible();
    await page.getByTestId('wiz-phase-0-constructionPeriods').fill('3');
    await page.getByTestId('wiz-phase-0-operationsPeriods').fill('5');
    await page.getByTestId('wiz-land-mode-autoByBua').click();
    await page.getByTestId('wizard-next').click();

    // Step 3: asset
    await expect(page.getByTestId('wiz-asset-row-0')).toBeVisible();
    await page.getByTestId('wiz-asset-0-name').fill('Apartments');
    await page.getByTestId('wiz-asset-0-strategy').selectOption('Sell');
    await page.getByTestId('wiz-asset-0-subUnitMetricValue').fill('100');
    await page.getByTestId('wizard-create').click();

    // Module 1 shell with 4 tabs (no Land / no Build Program / no Hierarchy)
    await expect(page.getByTestId('module1-shell')).toBeVisible();
    await expect(page.getByTestId('m1-tab-project-phases')).toBeVisible();
    await expect(page.getByTestId('m1-tab-assets')).toBeVisible();
    await expect(page.getByTestId('m1-tab-costs')).toBeVisible();
    await expect(page.getByTestId('m1-tab-financing')).toBeVisible();

    // Land + Build Program + Hierarchy tabs MUST NOT render
    await expect(page.getByText('Land', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Build Program', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Hierarchy', { exact: false })).toHaveCount(0);

    // Tab 1: Project & Phases
    await expect(page.getByTestId('tab-project-phases')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveValue('M2.0 Smoke Test');
    await setColorMode(page, 'light');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-tab1-project-phases.png'), fullPage: true });
    await setColorMode(page, 'dark');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-tab1-project-phases.png'), fullPage: true });
    await setColorMode(page, 'light');

    // Tab 2: Assets & Sub-units
    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();
    await expect(page.getByTestId('parcels-section')).toBeVisible();
    await expect(page.getByTestId('land-allocation-section')).toBeVisible();
    await expect(page.getByTestId('assets-section')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-tab2-assets.png'), fullPage: true });
    await setColorMode(page, 'dark');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-tab2-assets.png'), fullPage: true });
    await setColorMode(page, 'light');

    // Tab 3: Costs
    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('tab-costs')).toBeVisible();
    await expect(page.getByTestId('cost-lines-section')).toBeVisible();
    // 9 standard cost lines
    for (const key of [
      'land',
      'constructionBua',
      'constructionParking',
      'infrastructure',
      'landscaping',
      'preOperating',
      'professionalFee',
      'commissionFee',
      'contingency',
    ]) {
      await expect(page.getByTestId(`cost-line-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('phase-total-cost')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-tab3-costs.png'), fullPage: true });
    await setColorMode(page, 'dark');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-tab3-costs.png'), fullPage: true });
    await setColorMode(page, 'light');

    // Tab 4: Financing
    await page.getByTestId('m1-tab-financing').click();
    await expect(page.getByTestId('tab-financing')).toBeVisible();
    await expect(page.getByTestId('tranches-section')).toBeVisible();
    await expect(page.getByTestId('equity-section')).toBeVisible();
    await expect(page.getByTestId('financing-summary')).toBeVisible();
    await expect(page.getByTestId('summary-total-debt')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-tab4-financing.png'), fullPage: true });
    await setColorMode(page, 'dark');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-tab4-financing.png'), fullPage: true });
  });

  test('live recompute: editing GFA in Tab 2 updates Tab 3 phase total', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('dashboard-create').click();
    await page.getByTestId('wiz-projectName').fill('Live Recompute');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-create').click();

    await expect(page.getByTestId('module1-shell')).toBeVisible();
    await page.getByTestId('m1-tab-assets').click();

    // Bump asset GFA, then check costs total updates
    const assetCard = page.locator('[data-testid^="asset-card-"]').first();
    const assetId = (await assetCard.getAttribute('data-testid'))?.replace('asset-card-', '');
    if (!assetId) throw new Error('No asset card mounted');
    await page.getByTestId(`asset-${assetId}-gfaSqm`).fill('20000');
    await page.getByTestId(`asset-${assetId}-buaSqm`).fill('15000');

    await page.getByTestId('m1-tab-costs').click();
    const total = page.getByTestId('phase-total-cost');
    const text = await total.textContent();
    if (!text || /^0\b/.test(text.trim())) {
      throw new Error(`Phase total expected > 0 after BUA edit, got "${text}"`);
    }
  });
});
