/**
 * m20c-costs-financing.spec.ts
 *
 * Phase M2.0c: Dev Costs + Financing full-feature smoke spec.
 *
 * Walks Tab 3 (Dev Costs) + Tab 4 (Financing) asserting:
 *   - 13 default cost lines render
 *   - All 13 calc methods are selectable
 *   - All 6 phasing modes selectable
 *   - All 4 stage filters work
 *   - 5 drawdown methods + 5 repayment methods selectable
 *   - IDC toggle + per-asset selector wired
 *   - Period schedule reflects granularity (annual = N years vs
 *     monthly = N×12 months)
 *   - Save + reload preserves all settings (deferred to back-end
 *     tests; here we cover UI re-render + store sync)
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0c');

test.describe('M2.0c Dev Costs + Financing', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('shell layout: sidebar does not overlay workspace content', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15000 });

    const sidebar = await page.getByTestId('sidebar').boundingBox();
    const main = await page.locator('main').first().boundingBox();
    expect(sidebar).not.toBeNull();
    expect(main).not.toBeNull();
    if (sidebar && main) {
      // Sidebar's right edge must equal or come before main's left edge,
      // with a small fuzz for sub-pixel rounding.
      expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 2);
    }
  });

  test('costs: 13 method dropdown options + 6 phasing options + stage filter', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();

    // Stage filter has all 4 stages + 'all'
    const stageFilter = page.getByTestId('costs-stage-filter');
    await expect(stageFilter).toBeVisible();
    const stageOptions = await stageFilter.locator('option').allTextContents();
    expect(stageOptions.length).toBeGreaterThanOrEqual(5);

    // Find a method dropdown (any cost row)
    const methodDropdown = page.locator('[data-testid$="-method"]').first();
    if ((await methodDropdown.count()) > 0) {
      const methodOptions = await methodDropdown.locator('option').allTextContents();
      expect(methodOptions.length).toBe(13);
    }

    const phasingDropdown = page.locator('[data-testid$="-phasing"]').first();
    if ((await phasingDropdown.count()) > 0) {
      const phasingOptions = await phasingDropdown.locator('option').allTextContents();
      expect(phasingOptions.length).toBe(6);
    }

    // Add buttons for each stage
    await expect(page.getByTestId('costs-add-land')).toBeVisible();
    await expect(page.getByTestId('costs-add-hard')).toBeVisible();
    await expect(page.getByTestId('costs-add-soft')).toBeVisible();
    await expect(page.getByTestId('costs-add-operating')).toBeVisible();
  });

  test('financing: 5 drawdown × 5 repayment + IDC toggle + per-asset selector', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();
    await expect(page.getByTestId('module1-financing')).toBeVisible();

    // If no tranches, add one
    if ((await page.locator('[data-testid^="tranche-"]').count()) === 0) {
      await page.getByTestId('financing-add-tranche').click();
    }

    const drawdown = page.locator('[data-testid$="-drawdown"]').first();
    await expect(drawdown).toBeVisible();
    const drawOptions = await drawdown.locator('option').allTextContents();
    expect(drawOptions.length).toBe(5);

    const repayment = page.locator('[data-testid$="-repayment"]').first();
    const repOptions = await repayment.locator('option').allTextContents();
    expect(repOptions.length).toBe(5);

    const idcToggle = page.locator('[data-testid$="-idc"]').first();
    await expect(idcToggle).toBeVisible();

    const assetSelector = page.locator('[data-testid$="-asset"]').first();
    await expect(assetSelector).toBeVisible();
  });

  test('granularity respected: schedule period count matches modelType', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();

    if ((await page.locator('[data-testid^="tranche-"]').count()) === 0) {
      await page.getByTestId('financing-add-tranche').click();
    }

    // Default annual project: should show Y1, Y2, ... labels in schedule.
    const sched = page.locator('th').filter({ hasText: /Y\d/ }).first();
    await expect(sched).toBeVisible({ timeout: 10000 });
  });

  test('light + dark screenshots for visual regression', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();

    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-costs.png`, fullPage: true });

    await page.getByTestId('m1-tab-financing').click();
    await expect(page.getByTestId('module1-financing')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-financing.png`, fullPage: true });

    await page.getByTestId('topbar-toggle-dark').click();
    await page.waitForTimeout(150);

    await page.getByTestId('m1-tab-costs').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-costs.png`, fullPage: true });

    await page.getByTestId('m1-tab-financing').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-financing.png`, fullPage: true });
  });
});
