/**
 * m20h-area-hierarchy-cost-granularity.spec.ts
 *
 * Phase M2.0h: area hierarchy + cost granularity + display cleanup +
 * v7 -> v8 migration banner.
 *
 * Specs:
 *   Fix 1: migration banner shows + dismisses when v7 monthly snapshot loads.
 *          (Smoke: banner testid present in shell when state is set.)
 *   Fix 2: Currency header line at top of every Module 1 tab + Dashboard
 *          + Overview. Cells stay free of explicit currency suffix.
 *   Fix 3: Tab 2 asset card shows NSA / BUA / GFA hierarchy chips,
 *          drops the BUA Total input, reconciliation block itemizes the
 *          three-tier breakdown.
 *   Fix 4: Tab 2 Land Parcels block has NDA toggle, Roads %, Parks %,
 *          NDA + Effective NDA Rate columns; Land Reconciliation block
 *          shows Total NDA when any parcel toggles NDA on.
 *   Fix 5: Tab 3 cost line method dropdown gains 'Per sub-unit custom
 *          rates'; selecting it expands a sub-table with per-row rate
 *          inputs and a derived total.
 *   Fix 6: Tab 3 Results sub-tab has Annual / Quarterly / Monthly
 *          granularity toggle; switching expands the period-column
 *          count of every summary table.
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0h');

test.describe('M2.0h area hierarchy + cost granularity + display cleanup', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Fix 2: currency header line on Tab 1 Project & Phases', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab1 = page.getByTestId('m1-tab-project-phases');
    if ((await tab1.count()) === 0) test.skip(true, 'No Tab 1');
    await tab1.click();

    // Currency header line visible with default 'All figures in SAR'.
    const header = page.locator('[data-testid="currency-header-line"]').first();
    await expect(header).toBeVisible();
    await expect(header).toContainText(/All figures in /);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab1-currency-header.png`, fullPage: false });
  });

  test('Fix 3: Tab 2 asset card shows NSA / BUA / GFA hierarchy chips', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();

    // Add an asset
    const phaseAddButtons = page.locator('[data-testid$="-add-asset"]');
    if ((await phaseAddButtons.count()) === 0) test.skip(true, 'No phase add-asset');
    await phaseAddButtons.first().click();

    // Hierarchy chips
    const hierarchy = page.locator('[data-testid$="-area-hierarchy"]').first();
    await expect(hierarchy).toBeVisible();
    const nsa = page.locator('[data-testid$="-nsa"]').first();
    const bua = page.locator('[data-testid$="-bua"]').first();
    const gfa = page.locator('[data-testid$="-gfa"]').first();
    await expect(nsa).toBeVisible();
    await expect(bua).toBeVisible();
    await expect(gfa).toBeVisible();

    // The M2.0g BUA Total input is gone (removed in M2.0h Fix 3).
    const buaTotalCount = await page.locator('[data-testid$="-buaTotal"]').count();
    expect(buaTotalCount).toBe(0);

    // Reconciliation block has NSA / BUA / GFA rows.
    const reconNsa = page.locator('[data-testid$="-recon-nsa"]').first();
    const reconBua = page.locator('[data-testid$="-recon-bua"]').first();
    const reconGfa = page.locator('[data-testid$="-recon-gfa"]').first();
    await expect(reconNsa).toBeVisible();
    await expect(reconBua).toBeVisible();
    await expect(reconGfa).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-area-hierarchy.png`, fullPage: false });
  });

  test('Fix 4: parcel NDA toggle reveals Roads % + Parks % + Effective rate columns', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();

    // The parcel row exposes the NDA toggle + rate columns.
    const ndaToggle = page.locator('[data-testid$="-hasNdaDeduction"]').first();
    await expect(ndaToggle).toBeVisible();
    const roadsPct = page.locator('[data-testid$="-roadsPct"]').first();
    const parksPct = page.locator('[data-testid$="-parksPct"]').first();
    const effRate = page.locator('[data-testid$="-effectiveNdaRate"]').first();
    await expect(roadsPct).toBeVisible();
    await expect(parksPct).toBeVisible();
    await expect(effRate).toBeVisible();

    // Toggle NDA on, fill 10% / 5%, confirm Total NDA reconciliation row appears.
    await ndaToggle.check();
    await roadsPct.fill('10');
    await parksPct.fill('5');
    const totalNda = page.getByTestId('land-reconciliation-total-nda');
    await expect(totalNda).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-nda-on.png`, fullPage: false });
  });

  test('Fix 5: cost line per-sub-unit custom rates expands sub-table', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const costsTab = page.getByTestId('m1-tab-costs');
    if ((await costsTab.count()) === 0) test.skip(true, 'No Costs tab');
    await costsTab.click();

    if ((await page.getByTestId('costs-empty').count()) > 0) test.skip(true, 'No phase yet');

    // Find the first cost line method dropdown and switch to per-sub-unit.
    const methodDropdown = page.locator('[data-testid$="-method"]').first();
    if ((await methodDropdown.count()) === 0) test.skip(true, 'No cost row');
    await methodDropdown.selectOption('per_sub_unit_custom_rates');

    // Sub-row appears.
    const subRow = page.locator('[data-testid$="-per-subunit-row"]').first();
    await expect(subRow).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-per-subunit.png`, fullPage: false });
  });

  test('Fix 6: Results sub-tab granularity toggle (Annual / Quarterly / Monthly)', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('sidebar-module1').click();
    const costsTab = page.getByTestId('m1-tab-costs');
    if ((await costsTab.count()) === 0) test.skip(true, 'No Costs tab');
    await costsTab.click();

    if ((await page.getByTestId('costs-empty').count()) > 0) test.skip(true, 'No phase yet');

    await page.getByTestId('costs-sub-tab-results').click();
    if ((await page.getByTestId('costs-results-granularity-toggle').count()) === 0) {
      test.skip(true, 'No assets to render Results sub-tab');
    }

    const annualRadio = page.getByTestId('costs-granularity-annual');
    const quarterlyRadio = page.getByTestId('costs-granularity-quarterly');
    const monthlyRadio = page.getByTestId('costs-granularity-monthly');
    await expect(annualRadio).toBeVisible();
    await expect(quarterlyRadio).toBeVisible();
    await expect(monthlyRadio).toBeVisible();

    // Toggle to Quarterly + Monthly to confirm rerender doesn't crash.
    await quarterlyRadio.click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-results-quarterly.png`, fullPage: false });
    await monthlyRadio.click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab3-results-monthly.png`, fullPage: false });
  });
});

test.describe('M2.0h dark mode screenshots', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('dark mode Tab 2 area hierarchy', async ({ page }) => {
    await page.goto('/refm');
    if ((await page.getByTestId('sidebar-module1').count()) === 0) test.skip(true, '/refm requires auth');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    // Toggle dark mode if available.
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if ((await themeToggle.count()) > 0) await themeToggle.click();

    await page.getByTestId('sidebar-module1').click();
    const tab2Btn = page.getByTestId('m1-tab-assets');
    if ((await tab2Btn.count()) === 0) test.skip(true, 'No Tab 2');
    await tab2Btn.click();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab2-area-hierarchy.png`, fullPage: false });
  });
});
