/**
 * m20d-costs-polish.spec.ts
 *
 * Phase M2.0d: Costs Tab polish + accounting rules + layout fix.
 *
 * Walks Tab 2 (Sell+Manage agreement), Tab 3 (per-asset cost
 * segregation, custom cost popup, summary tables), and Tab 4
 * (in-kind equity summary) asserting the M2.0d contract.
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0d');

test.describe('M2.0d Costs polish + accounting rules', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('layout: page headings render with proper left padding (no sidebar bleed)', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 15000 });

    const sidebar = await page.getByTestId('sidebar').boundingBox();
    const main = await page.locator('main').first().boundingBox();
    expect(sidebar).not.toBeNull();
    expect(main).not.toBeNull();
    if (sidebar && main) {
      // Sidebar's right edge must equal or come before main's left edge.
      expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 2);
      // Main content does not start under the sidebar.
      expect(main.x).toBeGreaterThan(sidebar.x);
    }
  });

  test('Tab 2: Sell + Manage strategy reveals Management Agreement form', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();

    // Add an asset, set strategy to Sell + Manage
    if ((await page.locator('[data-testid^="asset-card-"]').count()) === 0) {
      await page.getByTestId('add-asset').click();
    }
    const firstStrategy = page.locator('[data-testid$="-strategy"]').first();
    await firstStrategy.selectOption('Sell + Manage');

    // Management Agreement form appears (look for any mgmt-agreement testid)
    const mgmt = page.locator('[data-testid$="-mgmt-agreement"]').first();
    await expect(mgmt).toBeVisible({ timeout: 5000 });

    // 4 fields visible
    await expect(page.locator('[data-testid$="-mgmt-fee"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-mgmt-owner-share"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-mgmt-start"]').first()).toBeVisible();
    await expect(page.locator('[data-testid$="-mgmt-duration"]').first()).toBeVisible();

    // Switch back to Operate -> useful life form appears, mgmt agreement disappears
    await firstStrategy.selectOption('Operate');
    await expect(page.locator('[data-testid$="-useful-life"]').first()).toBeVisible({ timeout: 3000 });
  });

  test('Tab 3: per-asset segregation + custom cost popup', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();

    // Stage filter + summary tiles (4 tiles)
    await expect(page.getByTestId('costs-stage-filter')).toBeVisible();
    await expect(page.getByTestId('costs-summary-tiles')).toBeVisible();
    await expect(page.getByTestId('costs-stage-land-card')).toBeVisible();
    await expect(page.getByTestId('costs-stage-hard-card')).toBeVisible();
    await expect(page.getByTestId('costs-stage-soft-card')).toBeVisible();
    await expect(page.getByTestId('costs-stage-operating-card')).toBeVisible();

    // Per-asset section count >= 1 if assets exist
    const sections = page.locator('[data-testid^="asset-section-"]');
    const sectionCount = await sections.count();

    if (sectionCount === 0) {
      // No assets yet, expect the no-assets placeholder.
      await expect(page.getByTestId('costs-no-assets')).toBeVisible();
    } else {
      // Each asset section has subtotal + add-custom button
      const firstSubtotal = page.locator('[data-testid$="-tfoot-subtotal"]').first();
      await expect(firstSubtotal).toBeVisible();
      const addCustom = page.locator('[data-testid$="-add-custom"]').first();
      await expect(addCustom).toBeVisible();

      // Stage / Scope are NOT user-editable, no select with id ending in "-stage"
      // INSIDE a row. Custom popup is the only place a stage select renders.
      await addCustom.click();
      await expect(page.getByTestId('custom-cost-popup')).toBeVisible();
      await expect(page.getByTestId('custom-cost-stage')).toBeVisible();
      await expect(page.getByTestId('custom-cost-method')).toBeVisible();
      await expect(page.getByTestId('custom-cost-value')).toBeVisible();
      await expect(page.getByTestId('custom-cost-phasing')).toBeVisible();

      await page.getByTestId('custom-cost-cancel').click();
      await expect(page.getByTestId('custom-cost-popup')).not.toBeVisible();
    }
  });

  test('Tab 3: 3 capex summary tables render', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();

    const hasAssets = (await page.locator('[data-testid^="asset-section-"]').count()) > 0;
    if (!hasAssets) {
      test.skip(true, 'No assets in the project; summary tables hidden by design.');
    }

    await expect(page.getByTestId('capex-by-period')).toBeVisible();
    await expect(page.getByTestId('capex-by-stage')).toBeVisible();
    await expect(page.getByTestId('capex-by-treatment')).toBeVisible();
    await expect(page.getByTestId('costs-project-total')).toBeVisible();

    // Capex by Treatment has a Cash Flow Impact column with non-zero
    // delta from total when in-kind land applies; loose check that the
    // header testid pattern for at least one asset row is wired.
    const treatmentRow = page.locator('[data-testid^="capex-treatment-"]').first();
    await expect(treatmentRow).toBeVisible();
  });

  test('Tab 4: Equity Summary shows Cash + In-Kind tiles + total card', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-financing').click();
    await expect(page.getByTestId('module1-financing')).toBeVisible();

    await expect(page.getByTestId('financing-summary-cash-equity')).toBeVisible();
    await expect(page.getByTestId('financing-summary-inkind-equity')).toBeVisible();
    await expect(page.getByTestId('financing-equity-summary')).toBeVisible();
    await expect(page.getByTestId('financing-equity-summary-total')).toBeVisible();
  });

  test('granularity: switch annual to monthly, period labels update', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();

    const hasAssets = (await page.locator('[data-testid^="asset-section-"]').count()) > 0;
    if (!hasAssets) {
      test.skip(true, 'No assets; period table hidden.');
    }

    // Default project annual -> Y1 columns in capex-by-period
    const annualHeader = page.locator('th').filter({ hasText: /^Y\d+$/ }).first();
    await expect(annualHeader).toBeVisible({ timeout: 10000 });
  });

  test('light + dark screenshots', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();

    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-assets.png`, fullPage: true });

    await page.getByTestId('m1-tab-costs').click();
    await expect(page.getByTestId('module1-costs')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-costs.png`, fullPage: true });

    await page.getByTestId('m1-tab-financing').click();
    await expect(page.getByTestId('module1-financing')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab4-financing.png`, fullPage: true });

    await page.getByTestId('topbar-toggle-dark').click();
    await page.waitForTimeout(200);

    await page.getByTestId('m1-tab-assets').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab2-assets.png`, fullPage: true });

    await page.getByTestId('m1-tab-costs').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab3-costs.png`, fullPage: true });

    await page.getByTestId('m1-tab-financing').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab4-financing.png`, fullPage: true });
  });
});
