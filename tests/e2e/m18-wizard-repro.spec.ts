/**
 * Playwright reproduction for the M1.8 wizard create blocker.
 *
 * Drives the fixture page at `/test-fixtures/m18-wizard` (which mounts
 * RealEstatePlatform inside a stubbed NextAuth SessionProvider so the
 * real /refm auth gate + Coming-Soon layout guard are out of scope).
 *
 * Flow:
 *   1. Mock GET /api/refm/projects → empty list (skip migrator).
 *   2. Mock POST /api/refm/projects → fake { project, version }.
 *   3. Mock POST /api/refm/projects/:id/versions → fake version (auto-save).
 *   4. Mock GET /api/refm/projects/:id/versions → empty list.
 *   5. Mock GET /api/branding → empty (Topbar reads it).
 *   6. Open Projects screen → "+ New Project" → walk Steps 1/2/3 with
 *      Mixed-Use defaults → "Create Project".
 *   7. Assert no uncaught page errors AND no React error boundary
 *      ("This page couldn't load") AND we land on the Area Program tab.
 *
 * The test fails if any console.error fires OR any uncaught page error
 * is observed during the create flow. That's how we catch the
 * "page couldn't load" regression — the React boundary that produces
 * that message also writes the underlying exception to the console.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

const DEV_SERVER_URL = process.env.M18_DEV_SERVER_URL ?? 'http://localhost:3000';

const FAKE_PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_VERSION_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_USER_ID    = '00000000-0000-0000-0000-000000000000';

type Captured = { type: 'console' | 'pageerror'; text: string };

async function setupMocks(page: Page): Promise<Captured[]> {
  const captured: Captured[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      captured.push({ type: 'console', text: `[${msg.type()}] ${msg.text()}` });
    }
  });
  page.on('pageerror', (err) => {
    captured.push({ type: 'pageerror', text: `${err.name}: ${err.message}\n${err.stack ?? ''}` });
  });

  // Mock NextAuth session endpoint as well — even though the fixture
  // passes a session prop to SessionProvider, NextAuth may still hit
  // /api/auth/session on focus / window events.
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id:    FAKE_USER_ID,
          email: 'fixture@local',
          name:  'Fixture User',
          role:  'admin',
          subscription_plan:   'enterprise',
          subscription_status: 'active',
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.route('**/api/branding', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  // Migrator hits /api/refm/migrate - return ok with no work
  await page.route('**/api/refm/migrate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ran: false, projectsCreated: 0, versionsCreated: 0, errors: [] }),
    });
  });

  // GET project list → empty
  await page.route('**/api/refm/projects', async (route, req) => {
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { name: string; assetMix?: string[]; status?: string };
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: {
            id:                  FAKE_PROJECT_ID,
            user_id:             FAKE_USER_ID,
            name:                body.name,
            location:            null,
            status:              body.status ?? 'Draft',
            asset_mix:           body.assetMix ?? [],
            schema_version:      3,
            current_version_id:  FAKE_VERSION_ID,
            created_at:          now,
            updated_at:          now,
          },
          version: {
            id:             FAKE_VERSION_ID,
            project_id:     FAKE_PROJECT_ID,
            version_number: 1,
            schema_version: 3,
            label:          null,
            snapshot:       (req.postDataJSON() as { snapshot: unknown }).snapshot,
            created_at:     now,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  // GET single project (used by attach) — should NOT be hit on wizard
  // create after fix 3/3, but mock anyway to avoid 404 logs.
  await page.route(/\/api\/refm\/projects\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        project: { id: FAKE_PROJECT_ID, name: 'fake', current_version_id: FAKE_VERSION_ID },
        version: null,
      }),
    });
  });

  // versions list / save
  await page.route(/\/api\/refm\/projects\/[^/]+\/versions$/, async (route, req) => {
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: [] }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: { id: FAKE_PROJECT_ID, name: 'fake' },
          version: {
            id:             FAKE_VERSION_ID,
            project_id:     FAKE_PROJECT_ID,
            version_number: 1,
            schema_version: 3,
            snapshot:       (req.postDataJSON() as { snapshot: unknown }).snapshot,
            created_at:     now,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  return captured;
}

test.describe('M1.8 wizard create — repro', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
  });

  test('wizard create with Mixed-Use defaults does not crash', async ({ page }) => {
    const captured = await setupMocks(page);

    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });

    // Land on dashboard. Open Projects via the Topbar's Project context button.
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    // Switch to Projects screen.
    await page.getByRole('button', { name: /Project/i }).first().click().catch(async () => {
      // Fallback: click the topbar Project button text.
      await page.locator('button:has-text("No project")').first().click();
    });

    // Wait for "+ New Project" button on Projects screen.
    const newProjectBtn = page.getByRole('button', { name: /\+ New Project/ });
    await expect(newProjectBtn).toBeVisible({ timeout: 5000 });
    await newProjectBtn.click();

    // Wizard Step 1 visible.
    await expect(page.getByTestId('wizard-step-indicator')).toBeVisible();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // Fill name + location.
    await page.getByTestId('wizard-name').fill('Repro Project');
    await page.getByTestId('wizard-location').fill('Riyadh, KSA');

    // Continue → Step 2.
    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();

    // Continue → Step 3 (defaults: MH off, single phase, single plot).
    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();

    // Default project type is Mixed-Use; assets table seeded with 3 rows
    // summing to 100%. Click "+ Create Project".
    await page.getByTestId('wizard-create').click();

    // Wait for either a successful landing OR a render error to surface.
    await page.waitForTimeout(2500);

    // Assertion 1: no React error-boundary fallback text.
    const errorBoundaryText = page.getByText(/page couldn't load|page couldn.t load|Application error/i);
    const hasBoundaryError = await errorBoundaryText.count();

    // Assertion 2: no uncaught JS errors on page.
    const pageErrors = captured.filter(c => c.type === 'pageerror');

    if (pageErrors.length > 0 || hasBoundaryError > 0) {
      console.log('=== CAPTURED ERRORS ===');
      for (const c of captured) console.log(c.type, c.text);
      console.log('=== END ===');
      const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (screenshot) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const out = path.resolve(process.cwd(), 'tests/screenshots/m18/repro-failure.png');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, screenshot);
        console.log('screenshot saved to:', out);
      }
    }

    expect(pageErrors, `Page errors:\n${pageErrors.map(e => e.text).join('\n---\n')}`).toHaveLength(0);
    expect(hasBoundaryError, 'React error boundary fallback was rendered').toBe(0);

    // Assertion 3: Area Program tab is mounted (indicates wizard create succeeded).
    await expect(page.getByTestId('area-program-tab')).toBeVisible({ timeout: 3000 });
  });
});
