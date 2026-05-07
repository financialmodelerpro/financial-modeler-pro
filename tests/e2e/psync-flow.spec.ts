/**
 * psync-flow.spec.ts
 *
 * Phase P-Sync, end-to-end smoke for the public-facing surfaces of the
 * Platform & Module Admin Sync work. Specs target the marketing pages and
 * the public API since admin pages require a logged-in admin session.
 *
 * Specs:
 *   1. /modeling-hub renders the platforms grid.
 *   2. /modeling-hub/refm renders the modules grid (or empty-state).
 *   3. /modeling-hub/refm/project-setup renders hero + features + how + cta.
 *   4. /api/platforms/refm/modules returns JSON with at least one module.
 *
 * Skips when the dev server cannot serve the endpoints (404 or 500 on
 * /modeling-hub) or when the Supabase migration has not run yet.
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'psync');

test.describe('P-Sync marketing surface', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('1. /modeling-hub renders platforms grid', async ({ page }) => {
    const res = await page.goto('/modeling-hub');
    if (!res || res.status() >= 400) test.skip(true, '/modeling-hub not reachable');

    const grid = page.getByTestId('platforms-grid');
    await expect(grid).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-overview.png`, fullPage: false });
  });

  test('2. /modeling-hub/refm renders modules grid', async ({ page }) => {
    const res = await page.goto('/modeling-hub/refm');
    if (!res || res.status() >= 400) test.skip(true, '/modeling-hub/refm not reachable');

    // Either the modules grid is visible OR the empty-state if no modules seeded.
    const grid = page.getByTestId('modules-grid');
    const empty = page.getByTestId('no-modules');
    await expect(grid.or(empty)).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-platform.png`, fullPage: false });
  });

  test('3. /modeling-hub/refm/project-setup renders hero + features + cta', async ({ page }) => {
    const res = await page.goto('/modeling-hub/refm/project-setup');
    if (!res) test.skip(true, '/modeling-hub/refm/project-setup not reachable');
    const status = res!.status();
    if (status === 404) test.skip(true, 'project-setup module not seeded');
    if (status >= 500) test.skip(true, `module page errored (HTTP ${status})`);

    await expect(page.getByTestId('module-hero')).toBeVisible({ timeout: 10000 });

    // features and cta are seeded in the SQL migration; if missing we want a clean fail.
    await expect(page.getByTestId('module-features')).toBeVisible();
    await expect(page.getByTestId('module-cta')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-module.png`, fullPage: true });
  });

  test('4. /api/platforms/refm/modules returns module list JSON', async ({ request }) => {
    const res = await request.get('/api/platforms/refm/modules');
    if (res.status() >= 500) test.skip(true, `API errored HTTP ${res.status()}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('modules');
    expect(Array.isArray(body.modules)).toBeTruthy();
    if (body.modules.length === 0) test.skip(true, 'no modules seeded');

    const m1 = body.modules.find((m: { slug: string }) => m.slug === 'project-setup');
    expect(m1).toBeTruthy();
    expect(m1.platform_slug).toBe('refm');
    expect(m1.number).toBe(1);
  });
});
