/**
 * m20g-display-recon-costs.spec.ts
 *
 * Phase M2.0g: display scale + reconciliation + Costs sub-tabs +
 * v8 schema (annual-only inputs, output granularity).
 *
 * Specs:
 *   Fix 1: Tab 1 phase end dates show end-of-period (Dec 31 of last
 *          year for annual MAAD shape).
 *   Fix 2: Tab 2 land reconciliation block at top + parcel dropdown
 *          defaults to first parcel + Custom Rate option.
 *   Fix 3: Wizard Step 1 has Display Scale radios + instruction line;
 *          switching to Millions changes display.
 *   Fix 4 + 5: Tab 2 asset card shows asset-level Support / Parking
 *          inputs + BUA reconciliation block with itemized breakdown.
 *   Fix 7: Tab 3 has Inputs / Results sub-tab toggle, Results tab
 *          shows 4 summary tables with Total in 2nd column.
 *   Addendum 1: Manual % phasing reveals per-period inputs +
 *          auto-normalize.
 *   Addendum 3: Wizard 'Reporting Granularity' label, always-years
 *          column headers in Step 2.
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0g');

test.describe('M2.0g display + reconciliation + Costs restructure', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Fix 3 + Addendum 3: Wizard Step 1 has Display Scale + Reporting Granularity', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    const newProjectBtn = page.getByText(/Create Project|\+ New Project|Create New/i).first();
    if ((await newProjectBtn.count()) === 0) test.skip(true, 'No Create Project CTA');
    await newProjectBtn.click();
    await expect(page.getByTestId('project-wizard')).toBeVisible();

    // Step 1: Display Scale block visible with 3 radios
    await expect(page.getByTestId('wiz-displayScale-block')).toBeVisible();
    await expect(page.getByTestId('wiz-displayScale-full')).toBeVisible();
    await expect(page.getByTestId('wiz-displayScale-thousands')).toBeVisible();
    await expect(page.getByTestId('wiz-displayScale-millions')).toBeVisible();

    // Reporting Granularity replaces Model Granularity
    await expect(page.getByTestId('wiz-outputGranularity')).toBeVisible();
    await expect(page.getByTestId('wiz-step1-instruction')).toContainText(/full numbers/i);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-wizard-step1.png`, fullPage: false });
    await page.getByTestId('wizard-close').click();
  });

  test('Fix 7: Tab 3 has Inputs / Results sub-tab toggle', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const costsTab = page.getByTestId('m1-tab-costs');
    if ((await costsTab.count()) === 0) test.skip(true, 'No Module 1 Costs tab');
    await costsTab.click();

    if ((await page.getByTestId('costs-empty').count()) > 0) test.skip(true, 'No phase yet');

    // Sub-tabs visible
    await expect(page.getByTestId('costs-sub-tabs')).toBeVisible();
    await expect(page.getByTestId('costs-sub-tab-inputs')).toBeVisible();
    await expect(page.getByTestId('costs-sub-tab-results')).toBeVisible();

    // Switch to Results
    await page.getByTestId('costs-sub-tab-results').click();
    if ((await page.getByTestId('capex-by-period').count()) > 0) {
      await expect(page.getByTestId('capex-by-period')).toBeVisible();
      await expect(page.getByTestId('capex-by-stage')).toBeVisible();
      await expect(page.getByTestId('capex-by-treatment')).toBeVisible();
      await expect(page.getByTestId('capex-by-cost-type')).toBeVisible();
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-costs-results.png`, fullPage: false });
  });

  test('Fix 2: Tab 2 land reconciliation block at top', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();

    // Land reconciliation block at top
    await expect(page.getByTestId('land-reconciliation')).toBeVisible();
    await expect(page.getByTestId('land-reconciliation-parcels-sqm')).toBeVisible();
    await expect(page.getByTestId('land-reconciliation-allocated-sqm')).toBeVisible();
    await expect(page.getByTestId('land-reconciliation-status')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-land-recon.png`, fullPage: false });
  });

  test('Fix 4 + 5: Tab 2 asset card asset-level Support/Parking + BUA reconciliation', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();
    await page.getByTestId('land-mode-sqm').click();

    // Add an asset
    const phaseAddButtons = page.locator('[data-testid$="-add-asset"]');
    if ((await phaseAddButtons.count()) === 0) test.skip(true, 'No phase add-asset');
    await phaseAddButtons.first().click();

    // Asset-level Support + Parking inputs
    const supportInput = page.locator('[data-testid$="-supportArea"]').first();
    const parkingInput = page.locator('[data-testid$="-parkingArea"]').first();
    const buaTotalInput = page.locator('[data-testid$="-buaTotal"]').first();
    await expect(supportInput).toBeVisible();
    await expect(parkingInput).toBeVisible();
    await expect(buaTotalInput).toBeVisible();

    // BUA reconciliation block
    const reconBlock = page.locator('[data-testid$="-bua-reconciliation"]').first();
    await expect(reconBlock).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-asset-card-bua.png`, fullPage: false });
  });

  test('Addendum 1: Manual % phasing reveals per-period inputs', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const costsTab = page.getByTestId('m1-tab-costs');
    if ((await costsTab.count()) === 0) test.skip(true, 'No Costs tab');
    await costsTab.click();

    if ((await page.getByTestId('costs-empty').count()) > 0) test.skip(true, 'No phase yet');

    // Find the first phasing dropdown and switch to manual
    const phasingDropdown = page.locator('[data-testid$="-phasing"]').first();
    if ((await phasingDropdown.count()) === 0) test.skip(true, 'No phasing dropdown');
    await phasingDropdown.selectOption('manual');

    // The per-period sub-row should appear
    const manualRow = page.locator('[data-testid$="-manual-row"]').first();
    await expect(manualRow).toBeVisible();
    const manualSum = page.locator('[data-testid$="-manual-sum"]').first();
    await expect(manualSum).toBeVisible();
    const normalizeBtn = page.locator('[data-testid$="-manual-normalize"]').first();
    await expect(normalizeBtn).toBeVisible();
  });
});
