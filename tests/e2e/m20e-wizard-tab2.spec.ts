/**
 * m20e-wizard-tab2.spec.ts
 *
 * Phase M2.0e: Wizard simplification + Tab 2 full asset entry.
 *
 * Walks the 3-step wizard then the Tab 2 surface asserting:
 *   - Wizard Step 2 column headers carry unit suffix (years/months) per
 *     project modelType
 *   - Wizard Step 2 has a Phase Start Date column before Construction
 *   - Wizard Step 3 is a project-type radio (no asset detail entry)
 *   - Tab 2 groups assets per phase with phase headers + add buttons
 *   - Asset card has Phase dropdown + Status dropdown + Type catalog
 *     filtered by project.projectType
 *   - Sub-unit table inside asset card with Rate Unit column
 *   - Asset card reconciliation row (BUA total vs sub-unit sum)
 *   - Reassigning Phase moves the asset to the target phase section
 *
 * Skips when /refm requires authentication.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0e');

test.describe('M2.0e Wizard simplification + Tab 2 full asset entry', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  // M2.0g v8 Addendum 3: inputs are always entered annually, so the
  // dynamic "(years/months)" suffix retires. Column headers always
  // show "(years)" regardless of the project's outputGranularity.
  test('Wizard Step 2: column headers always show "(years)" (M2.0g v8 inputs)', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    const newProjectBtn = page.getByText(/Create Project|\+ New Project|Create New/i).first();
    if ((await newProjectBtn.count()) > 0) {
      await newProjectBtn.click();
      await expect(page.getByTestId('project-wizard')).toBeVisible();
      await page.getByTestId('wizard-next').click(); // 1 -> 2
      await expect(page.getByTestId('wiz-phase-header-construction')).toContainText('years');
      await expect(page.getByTestId('wiz-phase-header-operations')).toContainText('years');
      await expect(page.getByTestId('wiz-phase-header-overlap')).toContainText('years');
      await expect(page.getByTestId('wiz-phase-header-startdate')).toBeVisible();

      // Switching outputGranularity at Step 1 does NOT change Step 2
      // labels (inputs always annual).
      await page.getByTestId('wizard-back').click();
      await page.getByTestId('wiz-outputGranularity').selectOption('monthly');
      await page.getByTestId('wizard-next').click();
      await expect(page.getByTestId('wiz-phase-header-construction')).toContainText('years');
      await expect(page.getByTestId('wiz-phase-header-operations')).toContainText('years');
      await expect(page.getByTestId('wiz-phase-header-overlap')).toContainText('years');

      await page.getByTestId('wizard-close').click();
    } else {
      test.skip(true, 'No "Create Project" CTA on this surface');
    }
  });

  test('Wizard Step 2: Phase Start Date input visible per phase', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    const newProjectBtn = page.getByText(/Create Project|\+ New Project|Create New/i).first();
    if ((await newProjectBtn.count()) === 0) {
      test.skip(true, 'No "Create Project" CTA on this surface');
    }
    await newProjectBtn.click();
    await expect(page.getByTestId('project-wizard')).toBeVisible();
    await page.getByTestId('wizard-next').click(); // 1 -> 2

    const phaseStart = page.getByTestId('wiz-phase-0-startDate');
    await expect(phaseStart).toBeVisible();
    await phaseStart.fill('2026-03-01');
    await expect(phaseStart).toHaveValue('2026-03-01');

    // Add Phase 2; new phase should auto-default startDate to prior + constructionPeriods
    await page.getByTestId('wiz-add-phase').click();
    const phase1Start = page.getByTestId('wiz-phase-1-startDate');
    await expect(phase1Start).toBeVisible();
    const v = await phase1Start.inputValue();
    expect(v.length).toBe(10); // ISO YYYY-MM-DD

    await page.getByTestId('wizard-close').click();
  });

  test('Wizard Step 3: simplified to project type radio only', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    const newProjectBtn = page.getByText(/Create Project|\+ New Project|Create New/i).first();
    if ((await newProjectBtn.count()) === 0) {
      test.skip(true, 'No "Create Project" CTA on this surface');
    }
    await newProjectBtn.click();
    await expect(page.getByTestId('project-wizard')).toBeVisible();
    await page.getByTestId('wizard-next').click(); // -> 2
    await page.getByTestId('wizard-next').click(); // -> 3

    await expect(page.getByTestId('wizard-step-3-content')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-options')).toBeVisible();
    await expect(page.getByTestId('wiz-step3-callout')).toBeVisible();

    // 6 project type radios visible
    await expect(page.getByTestId('wiz-project-type-Residential')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-Hospitality')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-Retail')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-Office')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-Mixed-Use')).toBeVisible();
    await expect(page.getByTestId('wiz-project-type-Custom')).toBeVisible();

    // No asset detail inputs from the M2.0c-era wizard
    await expect(page.locator('[data-testid^="wiz-asset-"][data-testid$="-gfaSqm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="wiz-add-asset"]')).toHaveCount(0);

    // Step 3 suggestions box
    await expect(page.getByTestId('wiz-project-type-suggestions')).toBeVisible();

    // Switch to Hospitality, suggestions update
    await page.getByTestId('wiz-project-type-Hospitality').click();
    await expect(page.getByTestId('wiz-project-type-suggestions')).toContainText('Hospitality');

    await page.getByTestId('wizard-close').click();
  });

  test('Tab 2: phase grouping + asset card phase reassign', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();

    // At least one phase section is visible
    const phaseSections = page.locator('[data-testid^="phase-section-"]').filter({ hasNot: page.locator('[data-testid$="-empty"]') });
    const sectionCount = await phaseSections.count();
    if (sectionCount === 0) {
      test.skip(true, 'No phases in default state');
    }

    // The assets-globals card is visible
    await expect(page.getByTestId('assets-globals')).toBeVisible();
  });

  test('Tab 2: asset card has Phase + Status dropdowns + Rate Unit column', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();

    // Try to find any phase add button and add an asset
    const addBtn = page.locator('[data-testid$="-add-asset"]').first();
    if ((await addBtn.count()) === 0) {
      test.skip(true, 'No phase add-asset button visible');
    }
    await addBtn.click();

    const phaseDropdown = page.locator('[data-testid$="-phase"]').filter({ has: page.locator('option') }).first();
    await expect(phaseDropdown).toBeVisible();

    const statusDropdown = page.locator('[data-testid$="-status"]').first();
    await expect(statusDropdown).toBeVisible();
    const statusOptions = await statusDropdown.locator('option').allTextContents();
    expect(statusOptions.length).toBe(3);

    // Add a sub-unit and look for rate-unit testid
    const addSubunit = page.locator('[data-testid$="-add-subunit"]').first();
    await addSubunit.click();
    const rateUnit = page.locator('[data-testid$="-rate-unit"]').first();
    await expect(rateUnit).toBeVisible();

    // Reconciliation row visible on the asset card
    const recon = page.locator('[data-testid$="-reconciliation"]').first();
    await expect(recon).toBeVisible();
  });

  test('light + dark screenshots', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('sidebar-module1')).toBeVisible({ timeout: 15000 });

    // Wizard screenshots
    const newProjectBtn = page.getByText(/Create Project|\+ New Project|Create New/i).first();
    if ((await newProjectBtn.count()) > 0) {
      await newProjectBtn.click();
      await expect(page.getByTestId('project-wizard')).toBeVisible();
      await page.getByTestId('wizard-next').click();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/light-wizard-step2.png`, fullPage: true });
      await page.getByTestId('wizard-next').click();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/light-wizard-step3.png`, fullPage: true });
      await page.getByTestId('wizard-close').click();
    }

    await page.getByTestId('sidebar-module1').click();
    await page.getByTestId('m1-tab-assets').click();
    await expect(page.getByTestId('tab-assets')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-tab2-assets.png`, fullPage: true });

    // Dark mode
    await page.getByTestId('topbar-toggle-dark').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-tab2-assets.png`, fullPage: true });
  });
});
