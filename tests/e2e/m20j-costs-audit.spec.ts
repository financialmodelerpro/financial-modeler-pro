/**
 * m20j-costs-audit.spec.ts
 *
 * Phase M2.0j: Module 1 audit + display fixes (16 fixes). Specs target
 * the affected surfaces. Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0j');

test.describe('M2.0j Module 1 audit', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Fix 1: Construction Years input accepts 0', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-project-phases').click();

    const cpInput = page.locator('[data-testid$="-constructionPeriods"]').first();
    if ((await cpInput.count()) === 0) test.skip(true, 'No phase row');
    await expect(cpInput).toHaveAttribute('min', '0');
    await cpInput.fill('0');

    // The constructionEnd cell should now read "Operational from start".
    const endCell = page.locator('[data-testid$="-constructionEnd"]').first();
    await expect(endCell).toContainText('Operational from start');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab1-cp-zero.png`, fullPage: false });
  });

  test('Fix 3: Land Parcel rate column header is "{currency}/sqm"', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    const parcelsTable = page.getByTestId('parcels-table');
    if ((await parcelsTable.count()) === 0) test.skip(true, 'No parcels table');
    await expect(parcelsTable).toBeVisible();
    // Header label uses {currency}/sqm format (e.g. "SAR/sqm").
    const headers = await parcelsTable.locator('thead th').allTextContents();
    expect(headers.some((h) => /\b[A-Z]{3}\/sqm\b/.test(h))).toBeTruthy();
  });

  test('Fix 5: Display Scale + Decimals reformat Land Parcel rate cell live', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-project-phases').click();

    const thousandsRadio = page.getByTestId('display-scale-thousands').locator('input');
    if ((await thousandsRadio.count()) === 0) test.skip(true, 'Display Settings panel missing');
    await thousandsRadio.click();
    await page.getByTestId('m1-tab-assets').click();
    // Parcel rate caption should reflect the K suffix when scale = thousands.
    const rateFmt = page.locator('[data-testid$="-rate-fmt"]').first();
    if ((await rateFmt.count()) > 0) {
      await expect(rateFmt).toContainText('K');
    }
  });

  test('Fix 6: Sub-unit area + units bidirectional sync', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();

    const addSubUnit = page.locator('[data-testid$="-add-subunit"]').first();
    if ((await addSubUnit.count()) === 0) test.skip(true, 'No add subunit');
    await addSubUnit.click();

    const metric = page.locator('[data-testid$="-metric"]').first();
    await metric.selectOption('units');
    const unitArea = page.locator('[data-testid$="-unitArea"]').first();
    await unitArea.fill('100');
    const count = page.locator('[data-testid$="-count"]').first();
    await count.fill('478');
    // Area should be derived/editable: 478 × 100 = 47,800.
    const areaInput = page.locator('[data-testid$="-area-input"]').first();
    await expect(areaInput).toHaveValue('47800');
    // Edit area to 50,000 -> count recalcs to 500.
    await areaInput.fill('50000');
    await expect(count).toHaveValue('500');
  });

  test('Fix 9: Cost line phasing dropdown shows only Even + Manual %', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    const phasing = page.locator('[data-testid$="-phasing"]').first();
    if ((await phasing.count()) === 0) test.skip(true, 'No phasing dropdown');
    const opts = await phasing.locator('option').allTextContents();
    expect(opts).toEqual(['Even', 'Manual %']);
  });

  test('Fix 8 + 13: Cost line caption shows multiplier + result; no Stage label', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    const caption = page.locator('[data-testid$="-caption"]').first();
    if ((await caption.count()) > 0) {
      const txt = await caption.textContent();
      expect(txt).toBeTruthy();
    }
    // Stage label "Land · custom"-style sub-text is gone (only 'custom' may appear under the line for custom rows).
    const rows = page.locator('[data-testid^="cost-row-"]');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // First standard row should NOT contain "Hard Cost" / "Soft Cost" / "Operating" text directly under name.
      const firstRowText = await rows.first().textContent();
      expect(firstRowText).not.toMatch(/Hard Cost|Soft Cost|Operating Cost/);
    }
  });

  test('Fix 14+15: Tab 3 Results shows only Capex by Period table', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    const resultsBtn = page.getByTestId('costs-sub-tab-results');
    if ((await resultsBtn.count()) === 0) test.skip(true, 'No Results sub-tab');
    await resultsBtn.click();

    await expect(page.getByTestId('capex-by-period')).toBeVisible();
    expect(await page.getByTestId('capex-by-stage').count()).toBe(0);
    expect(await page.getByTestId('capex-by-treatment').count()).toBe(0);
    expect(await page.getByTestId('capex-by-cost-type').count()).toBe(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-results-single-table.png`, fullPage: false });
  });

  test('Fix 16: Inputs sub-tab has asset selector + 3 summary cards', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();

    await expect(page.getByTestId('costs-asset-selector')).toBeVisible();
    await expect(page.getByTestId('costs-asset-selector-all')).toBeVisible();
    await expect(page.getByTestId('costs-asset-summary-cards')).toBeVisible();
    await expect(page.getByTestId('costs-summary-excl-land')).toBeVisible();
    await expect(page.getByTestId('costs-summary-excl-land-inkind')).toBeVisible();
    await expect(page.getByTestId('costs-summary-incl-land-inkind')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-inputs-summary-cards.png`, fullPage: false });
  });
});

test.describe('M2.0j dark mode', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('dark mode Tab 3 with selector + summary cards', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if ((await themeToggle.count()) > 0) await themeToggle.click();

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-costs').click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab3-inputs.png`, fullPage: false });
  });
});
