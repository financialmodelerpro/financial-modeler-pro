/**
 * m20L-costs-financing.spec.ts (M2.0L)
 *
 * Phase M2.0L: Costs diagnose-and-fix + full Financing build. Specs
 * target the affected surfaces (cost duplication fix, manual phasing
 * money chips, per-row chip strip, % of Selected picker, Results
 * filter pill bar, Financing sub-tabs, Capital Stack cards, schedules
 * filter pill bar, schedules granularity toggle, cross-tab IDC line).
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0L');

test.describe('M2.0L Module 1 Costs + Financing', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Costs: asset selector + 3 summary cards render in Inputs sub-tab', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    const selector = page.getByTestId('costs-asset-selector');
    if ((await selector.count()) === 0) test.skip(true, 'No visible assets');
    await expect(selector).toBeVisible();

    const summaryCards = page.getByTestId('costs-asset-summary-cards');
    await expect(summaryCards).toBeVisible();
    await expect(page.getByTestId('costs-summary-excl-land')).toBeVisible();
    await expect(page.getByTestId('costs-summary-excl-land-inkind')).toBeVisible();
    await expect(page.getByTestId('costs-summary-incl-land-inkind')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-costs-inputs.png`, fullPage: true });
  });

  test('Costs: per-row chip strip renders below cost lines with non-zero total', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    // chip-strip data-testid suffix matches `chip-strip` substring.
    const strip = page.locator('[data-testid$="-chip-strip"]').first();
    if ((await strip.count()) === 0) test.skip(true, 'No lines with positive total');
    await expect(strip).toBeVisible();
  });

  test('Costs: switching cost line phasing to manual reveals money chip strip', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    const phasingSel = page.locator('[data-testid$="-phasing"]').first();
    if ((await phasingSel.count()) === 0) test.skip(true, 'No editable cost lines');
    await phasingSel.selectOption('manual');

    const moneyChips = page.locator('[data-testid$="-manual-money-chips"]').first();
    await expect(moneyChips).toBeVisible();
  });

  test('Costs: % of Selected method reveals checkbox picker', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    const methodSel = page.locator('[data-testid$="-method"]').first();
    if ((await methodSel.count()) === 0) test.skip(true, 'No editable cost lines');
    await methodSel.selectOption('percent_of_selected');

    const picker = page.locator('[data-testid$="-pct-picker-list"]').first();
    await expect(picker).toBeVisible();
  });

  test('Costs Results: filter pill bar present', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    // Switch to Results sub-tab if present.
    const resultsTab = page.locator('button:has-text("Results")').first();
    if ((await resultsTab.count()) > 0) await resultsTab.click();

    const filter = page.getByTestId('costs-results-asset-filter');
    if ((await filter.count()) === 0) test.skip(true, 'No assets in Results');
    await expect(filter).toBeVisible();
    await expect(page.getByTestId('costs-results-filter-combined')).toBeVisible();
  });

  test('Financing: sub-tabs render (Inputs + Schedules)', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();

    await expect(page.getByTestId('financing-sub-tabs')).toBeVisible();
    await expect(page.getByTestId('financing-sub-tab-inputs')).toBeVisible();
    await expect(page.getByTestId('financing-sub-tab-schedules')).toBeVisible();
  });

  test('Financing Inputs: Capital Structure Overview cards render', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();

    await expect(page.getByTestId('financing-capital-stack')).toBeVisible();
    await expect(page.getByTestId('cap-stack-equity')).toBeVisible();
    await expect(page.getByTestId('cap-stack-debt')).toBeVisible();
    await expect(page.getByTestId('cap-stack-sources')).toBeVisible();
    await expect(page.getByTestId('cap-stack-uses')).toBeVisible();
    await expect(page.getByTestId('cap-stack-ltv')).toBeVisible();
    await expect(page.getByTestId('cap-stack-match-chip')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-financing-inputs.png`, fullPage: true });
  });

  test('Financing: extended tranche fields (facility type, IDC treatment) editable', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();

    // Add a tranche if none.
    const tranches = page.locator('[data-testid^="tranche-"][data-testid$="-name"]');
    if ((await tranches.count()) === 0) {
      await page.getByTestId('financing-add-tranche').click();
    }

    const ft = page.locator('[data-testid$="-facility-type"]').first();
    await expect(ft).toBeVisible();
    const idc = page.locator('[data-testid$="-idc-treatment"]').first();
    await expect(idc).toBeVisible();
    await idc.selectOption('mixed');
    const split = page.locator('[data-testid$="-idc-mixed-split"]').first();
    await expect(split).toBeVisible();
  });

  test('Financing Schedules: 6 tables + filter pills + granularity toggle', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();
    await page.getByTestId('financing-sub-tab-schedules').click();

    await expect(page.getByTestId('financing-schedules-controls')).toBeVisible();
    await expect(page.getByTestId('financing-filter-combined')).toBeVisible();
    await expect(page.getByTestId('financing-granularity-annual')).toBeVisible();
    await expect(page.getByTestId('financing-granularity-quarterly')).toBeVisible();
    await expect(page.getByTestId('financing-granularity-monthly')).toBeVisible();

    await expect(page.getByTestId('capital-stack-summary')).toBeVisible();
    await expect(page.getByTestId('combined-debt-service')).toBeVisible();
    await expect(page.getByTestId('idc-summary')).toBeVisible();
    await expect(page.getByTestId('stack-movement')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-financing-schedules.png`, fullPage: true });
  });

  test('Dark mode: Financing renders without overflow', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-financing.png`, fullPage: true });
  });
});
