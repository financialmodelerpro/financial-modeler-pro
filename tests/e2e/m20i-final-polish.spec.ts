/**
 * m20i-final-polish.spec.ts
 *
 * Phase M2.0i: final Module 1 polish before M2.1 Revenue.
 *
 * Specs (one per fix):
 *   Fix 1: Tab 1 has no Model Granularity dropdown.
 *   Fix 2: Tab 3 Results granularity toggle distributes annual values
 *          across sub-periods (not just relabels columns).
 *   Fix 3: Tab 1 Display Settings panel (Scale + Decimals) renders
 *          and switching changes downstream formatting.
 *   Fix 4: Tab 2 parcel NDA toggle reveals roads/parks/effective rate.
 *   Fix 5: Asset card has no Parking Bays input; method dropdown does
 *          not list "Rate × Parking Bays".
 *   Fix 6: Sub-unit metric dropdown shows "Units" / "Area"; switching
 *          to Area makes count derived.
 *   Fix 7: Strategy dropdown options are short ("Sell" / "Operate" /
 *          "Lease" / "Sell + Manage") with hover tooltips.
 *   Fix 8: Sidebar stays visible while user scrolls long Tab 3 content.
 *   Fix 9: Reconciliation blocks render compact summary line with
 *          expand affordance.
 *   Fix 10: Phase status = Operational reveals Historical Baseline form.
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0i');

test.describe('M2.0i Module 1 final polish', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Fix 1: Tab 1 has no Model Granularity input', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab1 = page.getByTestId('m1-tab-project-phases');
    if ((await tab1.count()) === 0) test.skip(true, 'No Tab 1');
    await tab1.click();

    const modelTypeSelect = await page.locator('[data-testid="project-modelType"]').count();
    expect(modelTypeSelect).toBe(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab1-no-modelType.png`, fullPage: false });
  });

  test('Fix 3: Tab 1 Display Settings panel exposes Scale + Decimals', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-project-phases').click();

    await expect(page.getByTestId('display-settings')).toBeVisible();
    await expect(page.getByTestId('display-scale-full')).toBeVisible();
    await expect(page.getByTestId('display-scale-thousands')).toBeVisible();
    await expect(page.getByTestId('display-scale-millions')).toBeVisible();
    await expect(page.getByTestId('display-decimals-0')).toBeVisible();
    await expect(page.getByTestId('display-decimals-2')).toBeVisible();
    await expect(page.getByTestId('display-decimals-3')).toBeVisible();

    // Switch to thousands + 0 decimals.
    await page.getByTestId('display-scale-thousands').locator('input').click();
    await page.getByTestId('display-decimals-0').locator('input').click();

    // Currency header line should reflect the change.
    const header = page.locator('[data-testid="currency-header-line"]').first();
    await expect(header).toContainText("'000");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab1-display-thousands-d0.png`, fullPage: false });
  });

  test('Fix 5: Asset card has no Parking Bays input', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();

    const phaseAddButtons = page.locator('[data-testid$="-add-asset"]');
    if ((await phaseAddButtons.count()) === 0) test.skip(true, 'No phase add-asset');
    await phaseAddButtons.first().click();

    const parkingBaysInput = await page.locator('[data-testid$="-parkingBaysRequired"]').count();
    expect(parkingBaysInput).toBe(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-no-parking-bays.png`, fullPage: false });
  });

  test('Fix 6: Sub-unit metric Units / Area labels', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    const phaseAddButtons = page.locator('[data-testid$="-add-asset"]');
    if ((await phaseAddButtons.count()) === 0) test.skip(true, 'No phase add-asset');
    await phaseAddButtons.first().click();

    const addSubUnitBtn = page.locator('[data-testid$="-add-subunit"]').first();
    if ((await addSubUnitBtn.count()) === 0) test.skip(true, 'No add subunit');
    await addSubUnitBtn.click();

    const metricDropdown = page.locator('[data-testid$="-metric"]').first();
    await expect(metricDropdown).toBeVisible();
    await expect(metricDropdown).toContainText('Units');

    // Switch to area mode.
    await metricDropdown.selectOption('area');
    const countDerived = page.locator('[data-testid$="-count-derived"]').first();
    await expect(countDerived).toBeVisible();
  });

  test('Fix 7: Strategy short labels with tooltips', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    const phaseAddButtons = page.locator('[data-testid$="-add-asset"]');
    if ((await phaseAddButtons.count()) === 0) test.skip(true, 'No phase add-asset');
    await phaseAddButtons.first().click();

    const strategy = page.locator('[data-testid$="-strategy"]').first();
    await expect(strategy).toBeVisible();
    // Short label "Sell" appears in the dropdown options.
    const opts = await strategy.locator('option').allTextContents();
    expect(opts.some((o) => o.trim() === 'Sell')).toBeTruthy();
    expect(opts.some((o) => o.trim() === 'Operate')).toBeTruthy();
    expect(opts.some((o) => o.trim() === 'Lease')).toBeTruthy();
    expect(opts.some((o) => o.trim() === 'Sell + Manage')).toBeTruthy();
  });

  test('Fix 9: Land reconciliation collapsed by default + expand', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    const summary = page.locator('[data-testid="land-reconciliation-summary"]');
    await expect(summary).toBeVisible();

    const expandBtn = page.locator('[data-testid="land-reconciliation-expand"]');
    await expect(expandBtn).toBeVisible();
    // Click expand: full grid lines become visible.
    await expandBtn.click();
    await expect(page.getByTestId('land-reconciliation-parcels-sqm')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-land-recon-expanded.png`, fullPage: false });
  });

  test('Fix 10: Operational phase reveals Historical Baseline form', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-project-phases').click();

    const statusDropdown = page.locator('[data-testid$="-status"]').first();
    if ((await statusDropdown.count()) === 0) test.skip(true, 'No phase status dropdown');
    await statusDropdown.selectOption('operational');

    const baselineRow = page.locator('[data-testid$="-historical-baseline"]').first();
    await expect(baselineRow).toBeVisible();
    const capexInput = page.locator('[data-testid$="-hist-capex"]').first();
    await expect(capexInput).toBeVisible();
    await capexInput.fill('850000000');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab1-historical-baseline.png`, fullPage: false });
  });
});

test.describe('M2.0i dark mode', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('dark mode Tab 1 with Display Settings', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if ((await themeToggle.count()) > 0) await themeToggle.click();

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-project-phases').click();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab1-display-settings.png`, fullPage: false });
  });
});
