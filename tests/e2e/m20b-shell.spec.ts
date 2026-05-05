/**
 * m20b-shell.spec.ts
 *
 * M2.0b application shell smoke. Walks the brand-styled shell
 * (Topbar, Sidebar, Dashboard) without creating a project, so the
 * spec stays fast and not coupled to ProjectWizard. Covers:
 *
 *   1. Topbar brand identity is visible (FMP logo + project /
 *      version context buttons + Save / Export pills + RBAC badge
 *      + theme toggle + Sign Out).
 *   2. Sidebar pv panel + module list + role indicator.
 *   3. Dashboard KPI grid + module roadmap + module cards.
 *   4. Dark mode toggle flips body[data-refm-theme="dark"].
 *   5. ProjectModal + RbacModal + ExportModal open/close cleanly.
 *   6. Light + dark screenshots for visual regression.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'M2.0b');

test.describe('M2.0b brand-styled shell smoke', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('topbar + sidebar + dashboard render with brand chrome', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15000 });

    // Topbar
    await expect(page.getByTestId('topbar')).toBeVisible();
    await expect(page.getByTestId('topbar-open-project')).toBeVisible();
    await expect(page.getByTestId('topbar-open-version')).toBeVisible();
    await expect(page.getByTestId('topbar-open-rbac')).toBeVisible();
    await expect(page.getByTestId('topbar-toggle-dark')).toBeVisible();
    await expect(page.getByTestId('topbar-signout')).toBeVisible();

    // Sidebar pv panel + module list + role indicator
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-pv-project')).toBeVisible();
    await expect(page.getByTestId('sidebar-pv-version')).toBeVisible();
    await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
    await expect(page.getByTestId('sidebar-module1')).toBeVisible();
    await expect(page.getByTestId('sidebar-role-indicator')).toBeVisible();

    // Dashboard KPI grid + module cards + roadmap
    await expect(page.getByTestId('dashboard-kpi-grid')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-module1')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-projects')).toBeVisible();
    await expect(page.getByTestId('dashboard-roadmap')).toBeVisible();
    await expect(page.getByTestId('dashboard-roadmap-module1')).toBeVisible();
  });

  test('dark mode toggle flips body data-refm-theme', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 15000 });

    // Light is the default (no body attribute)
    let theme = await page.evaluate(() => document.body.getAttribute('data-refm-theme'));
    expect(theme).toBeNull();

    await page.getByTestId('topbar-toggle-dark').click();
    theme = await page.evaluate(() => document.body.getAttribute('data-refm-theme'));
    expect(theme).toBe('dark');

    await page.getByTestId('topbar-toggle-dark').click();
    theme = await page.evaluate(() => document.body.getAttribute('data-refm-theme'));
    expect(theme).toBeNull();
  });

  test('modals (project picker, RBAC, export) open and close', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 15000 });

    // ProjectModal via topbar context
    await page.getByTestId('topbar-open-project').click();
    await expect(page.getByTestId('project-modal')).toBeVisible();
    await page.getByTestId('project-modal-close').click();
    await expect(page.getByTestId('project-modal')).not.toBeVisible();

    // RbacModal
    await page.getByTestId('topbar-open-rbac').click();
    await expect(page.getByTestId('rbac-modal')).toBeVisible();
    await expect(page.getByTestId('rbac-role-admin')).toBeVisible();
    await page.getByTestId('rbac-cancel').click();
    await expect(page.getByTestId('rbac-modal')).not.toBeVisible();

    // ExportModal via topbar
    await page.getByTestId('topbar-open-export').click();
    await expect(page.getByTestId('export-modal')).toBeVisible();
    // Every option row is rendered
    await expect(page.locator('[data-testid^="export-option-"]')).toHaveCount(5);
    await page.getByTestId('export-modal-close').click();
    await expect(page.getByTestId('export-modal')).not.toBeVisible();
  });

  test('light + dark screenshots for visual regression', async ({ page }) => {
    await page.goto('/refm');
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-dashboard.png`, fullPage: true });

    await page.getByTestId('topbar-toggle-dark').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-dashboard.png`, fullPage: true });

    // Navigate to projects + capture both modes
    await page.getByTestId('topbar-toggle-dark').click(); // back to light
    await page.getByTestId('sidebar-projects').click();
    await expect(page.getByTestId('projects-screen')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light-projects.png`, fullPage: true });

    await page.getByTestId('topbar-toggle-dark').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark-projects.png`, fullPage: true });
  });
});
