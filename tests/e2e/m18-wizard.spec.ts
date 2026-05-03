/**
 * tests/e2e/m18-wizard.spec.ts
 *
 * Playwright spec for the Phase M1.8 Smart Project Creation Wizard.
 *
 * Today this spec exercises only the UI surfaces that don't require an
 * authenticated REFM session: the public sign-in page (light + dark
 * screenshots) and the gate that redirects /refm without a session.
 *
 * Deeper wizard interactions — clicking + New Project, filling Steps
 * 1-3, asserting Area Program tab landing, asserting "+ Add Phase" /
 * "Enable Master Holding" reveals the right surfaces — are gated on a
 * NextAuth fixture-login or cookie-injection helper that lands in a
 * later phase. They appear in this file as test.skip() entries so the
 * full intended coverage is documented and easy to enable once the
 * auth-bypass primitive lands.
 *
 * Run:
 *   npx playwright test tests/e2e/m18-wizard.spec.ts
 *
 * Requires: dev server on M18_DEV_SERVER_URL (defaults to
 * http://localhost:3000). Skips via test.skip when the server isn't up.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M18_DEV_SERVER_URL ?? 'http://localhost:3000';
const SHOT_DIR       = resolve(process.cwd(), 'tests/screenshots/m18');
if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

test.describe('Phase M1.8 — Smart Project Creation Wizard', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
  });

  test('public sign-in page screenshots — light mode', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${DEV_SERVER_URL}/modeling/signin`);
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });
    await page.screenshot({ path: resolve(SHOT_DIR, 'light-signin.png'), fullPage: true });
    await ctx.close();
  });

  test('public sign-in page screenshots — dark mode', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${DEV_SERVER_URL}/modeling/signin`);
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });
    await page.screenshot({ path: resolve(SHOT_DIR, 'dark-signin.png'), fullPage: true });
    await ctx.close();
  });

  test('/refm without session redirects to auth', async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/refm`);
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });
    await expect(page).toHaveURL(/signin|login|register/i);
  });

  // ── Authed-session spec (skipped until fixture-login lands) ──
  test.skip('Wizard end-to-end: create project via Mixed-Use defaults', async ({ page }) => {
    // INTENT (TODO: enable when NextAuth cookie injection / fixture
    // login is available):
    //
    // 1. Sign in as the test user (cookie injection or fixture login).
    // 2. Navigate to /refm → Projects screen.
    // 3. Click "+ New Project" → assert ProjectWizard opens (data-testid
    //    "wizard-step-indicator").
    // 4. Step 1: fill wizard-name + wizard-location, leave currency /
    //    model-type / start-date / status at defaults. Click
    //    wizard-continue → assert wizard-step-2 visible.
    // 5. Step 2: leave defaults (MH off, single phase, single plot).
    //    Click wizard-continue → assert wizard-step-3 visible.
    // 6. Step 3: confirm wizard-project-type-mixeduse is active (default),
    //    confirm wizard-assets-list shows 3 rows summing to 100%
    //    (wizard-asset-total reads "Total: 100.00% ✓"). Click
    //    wizard-create.
    // 7. Assert toast appears with "✓ Project ... created with 3 assets".
    // 8. Assert active tab = Area Program (data-testid="module1-area-program-tab")
    //    and Hierarchy tab shows 3 assets (selectAssetsForPhase=3).
    // 9. Switch to Hierarchy tab → assert no Master Holding card
    //    visible (progressive disclosure hides MH when disabled).
    // 10. Click hierarchy-enable-mh → assert MH card now visible.
    // 11. Click hierarchy-add-phase → assert phases.length === 2.
    // 12. Take screenshots: tests/screenshots/m18/light-after-wizard.png
    //     + tests/screenshots/m18/dark-after-wizard.png.
  });

  test.skip('Wizard end-to-end: Custom type with manual asset entry', async () => {
    // TODO (post fixture-login):
    // 1. Open wizard, advance to Step 3, click wizard-project-type-custom.
    // 2. Assert wizard-assets-list shows the empty-state message.
    // 3. Click wizard-asset-add twice → assert 2 rows, total = 0% (red).
    // 4. Click wizard-asset-autobalance → assert total = 100% (green).
    // 5. Continue to create; assert project lands on Area Program with
    //    2 assets bound to Plot 1 / Phase 1.
  });

  test.skip('Wizard end-to-end: Multi-phase + Multi-plot + MH on', async () => {
    // TODO (post fixture-login):
    // 1. Open wizard, fill Step 1, advance to Step 2.
    // 2. Toggle wizard-mh-toggle ON, switch wizard-phases-multiple
    //    (set wizard-phase-count = 3), switch wizard-plots-multiple
    //    (set wizard-plot-count = 4).
    // 3. Continue through Step 3 with default assets, click create.
    // 4. Assert Hierarchy tab now shows MH card (because MH is enabled),
    //    3 phases under the sub-project, 4 plots under Phase 1.
  });
});
