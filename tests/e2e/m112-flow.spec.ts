/**
 * tests/e2e/m112-flow.spec.ts
 *
 * M1.12 regression guard. Three contracts:
 *
 *   Spec 1: Wizard Step 2 captures Land Parcels. Assert the parcels
 *           section + add/remove handlers + totals row are present and
 *           that the wizard can successfully create with a custom 2-
 *           parcel mix.
 *
 *   Spec 2: After create, lands on Schedule. Tab row has 4 numbered
 *           tabs (no "Land"). Build Program shows the Land Parcels
 *           section at the top with 2 parcels carried over from the
 *           wizard. Light + dark screenshots saved into
 *           tests/screenshots/M1.12/.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M112_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.12');

const FAKE_PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_VERSION_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_USER_ID    = '00000000-0000-0000-0000-000000000000';

type Captured = { type: 'console' | 'pageerror'; text: string };

interface MockState {
  projects: Array<{ id: string; name: string; location: string | null; status: string; asset_mix: string[]; current_version_id: string | null; created_at: string; updated_at: string; schema_version: number; user_id: string }>;
  versions: Array<{ id: string; project_id: string; version_number: number; schema_version: number; label: string | null; snapshot: unknown; created_at: string }>;
  captured: Captured[];
}

async function setupMocks(page: Page): Promise<MockState> {
  const state: MockState = { projects: [], versions: [], captured: [] };

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      state.captured.push({ type: 'console', text: `[${msg.type()}] ${msg.text()}` });
    }
  });
  page.on('pageerror', (err) => {
    state.captured.push({ type: 'pageerror', text: `${err.name}: ${err.message}\n${err.stack ?? ''}` });
  });

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: FAKE_USER_ID, email: 'fixture@local', name: 'Fixture User', role: 'admin',
          subscription_plan: 'enterprise', subscription_status: 'active',
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.route('**/api/branding', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/refm/migrate', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ran: false, projectsCreated: 0, versionsCreated: 0, errors: [] }),
    });
  });

  await page.route('**/api/refm/projects', async (route, req) => {
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ projects: state.projects.map(({ user_id: _u, ...rest }) => rest) }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as {
        name: string; snapshot: unknown; location?: string | null; status?: string; assetMix?: string[];
      };
      const now = new Date().toISOString();
      const project = {
        id: FAKE_PROJECT_ID, user_id: FAKE_USER_ID, name: body.name, location: body.location ?? null,
        status: body.status ?? 'Draft', asset_mix: body.assetMix ?? [], schema_version: 4,
        current_version_id: FAKE_VERSION_ID, created_at: now, updated_at: now,
      };
      const version = {
        id: FAKE_VERSION_ID, project_id: FAKE_PROJECT_ID, version_number: 1, schema_version: 4,
        label: null, snapshot: body.snapshot, created_at: now,
      };
      state.projects.push(project);
      state.versions.push(version);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project, version }) });
      return;
    }
    await route.continue();
  });

  await page.route(/\/api\/refm\/projects\/[^/]+$/, async (route, req) => {
    const m = req.url().match(/\/api\/refm\/projects\/([^/?]+)/);
    const pid = m ? decodeURIComponent(m[1]) : '';
    const project = state.projects.find(p => p.id === pid);
    if (req.method() === 'GET') {
      if (!project) { await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) }); return; }
      const version = state.versions.filter(v => v.project_id === pid).slice(-1)[0] ?? null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project, version }) });
      return;
    }
    await route.continue();
  });

  await page.route(/\/api\/refm\/projects\/[^/]+\/versions$/, async (route, req) => {
    const m = req.url().match(/\/api\/refm\/projects\/([^/?]+)\/versions/);
    const pid = m ? decodeURIComponent(m[1]) : '';
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ versions: state.versions.filter(v => v.project_id === pid).map(({ snapshot: _s, ...rest }) => rest) }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { snapshot: unknown; label?: string | null; assetMix?: string[] };
      const now = new Date().toISOString();
      const nextNum = (state.versions.filter(v => v.project_id === pid).slice(-1)[0]?.version_number ?? 0) + 1;
      const version = {
        id: `${FAKE_VERSION_ID}-${nextNum}`, project_id: pid, version_number: nextNum,
        schema_version: 4, label: body.label ?? null, snapshot: body.snapshot, created_at: now,
      };
      state.versions.push(version);
      const project = state.projects.find(p => p.id === pid);
      if (project) {
        project.current_version_id = version.id;
        project.updated_at = now;
        if (body.assetMix) project.asset_mix = body.assetMix;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project, version }) });
      return;
    }
    await route.continue();
  });

  return state;
}

async function openWizard(page: Page): Promise<void> {
  // Mirror the M1.11 / M1.8 fixture flow: dashboard lands on Topbar +
  // Sidebar; clicking the Topbar Project context (or its "No project"
  // placeholder) switches to the Projects screen where +New Project lives.
  await page.getByRole('button', { name: /Project/i }).first().click().catch(async () => {
    await page.locator('button:has-text("No project")').first().click();
  });
  const newProjectBtn = page.getByRole('button', { name: /\+ New Project/ });
  await expect(newProjectBtn).toBeVisible({ timeout: 5000 });
  await newProjectBtn.click();
  await expect(page.getByTestId('wizard-step-indicator')).toBeVisible();
}

function assertNoErrors(captured: Captured[]): void {
  const fatal = captured.filter(c => {
    if (c.type === 'pageerror') return true;
    if (c.type === 'console' && c.text.includes('getSnapshot should be cached')) return true;
    if (c.type === 'console' && c.text.includes('Maximum update depth')) return true;
    return false;
  });
  expect(
    fatal,
    `Unexpected page errors / fatal warnings:\n${fatal.map(e => e.text).join('\n---\n')}`,
  ).toHaveLength(0);
}

test.describe('M1.12 Land tab elimination + 4-tab consolidation', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('Wizard Step 2 captures Land Parcels (add + remove + totals)', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await page.getByTestId('wizard-name').fill('M112-WizardParcels');
    await page.getByTestId('wizard-location').fill('Riyadh, KSA');
    await page.getByTestId('wizard-continue').click();

    // Step 2 land parcels block visible.
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await expect(page.getByTestId('wizard-parcels-section')).toBeVisible();
    await expect(page.getByTestId('wizard-parcel-row-1')).toBeVisible();
    await expect(page.getByTestId('wizard-parcels-totals')).toBeVisible();

    // Add a second parcel via the +Add Parcel button.
    await page.getByTestId('wizard-add-parcel').click();
    await expect(page.getByTestId('wizard-parcel-row-2')).toBeVisible();

    // Edit row 2 area to confirm the row is interactive.
    await page.getByTestId('wizard-parcel-2-area').fill('40000');
    await page.getByTestId('wizard-parcel-2-rate').fill('450');

    // Totals row should reflect the new total area (100000 + 40000 = 140000).
    await expect(page.getByTestId('wizard-parcels-totals')).toContainText('140,000');

    // Remove row 2 via the per-row × button; row should disappear.
    await page.getByTestId('wizard-parcel-2-remove').click();
    await expect(page.getByTestId('wizard-parcel-row-2')).toHaveCount(0);

    assertNoErrors(state.captured);
  });

  test('After create: 4 tabs, no Land, parcels visible on Build Program (light + dark)', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await page.getByTestId('wizard-name').fill('M112-FlowProject');
    await page.getByTestId('wizard-location').fill('Riyadh, KSA');
    await page.getByTestId('wizard-continue').click();

    // Add a second parcel so we know two rows render on Build Program.
    await page.getByTestId('wizard-add-parcel').click();
    await page.getByTestId('wizard-parcel-2-area').fill('40000');
    await page.getByTestId('wizard-parcel-2-rate').fill('450');

    await page.getByTestId('wizard-continue').click();
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();
    await page.getByTestId('wizard-create').click();

    // Lands on Schedule (M1.9 contract).
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // Tab row: 4 entries, no "2. Land". Scope to <main> so the Sidebar's
    // identical "1. Schedule" / "2. Build Program" / etc. nav buttons
    // (which are also visible to tab() / getByRole) don't match.
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: '1. Schedule' })).toBeVisible();
    await expect(main.getByRole('button', { name: '2. Build Program' })).toBeVisible();
    await expect(main.getByRole('button', { name: '3. Dev Costs' })).toBeVisible();
    await expect(main.getByRole('button', { name: '4. Financing' })).toBeVisible();
    await expect(main.getByRole('button', { name: /^2\. Land$/ })).toHaveCount(0);

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-schedule.png'), fullPage: true });

    // Open Build Program: parcel block at top with 2 parcel rows.
    await main.getByRole('button', { name: '2. Build Program' }).first().click();
    await expect(page.getByTestId('build-program-land-parcels')).toBeVisible();
    await expect(page.getByTestId('bp-parcel-row-1')).toBeVisible();
    await expect(page.getByTestId('bp-parcel-row-2')).toBeVisible();
    await expect(page.getByTestId('bp-add-parcel')).toBeVisible();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program.png'), fullPage: true });

    // Dev Costs + Financing screenshots for completeness.
    await main.getByRole('button', { name: '3. Dev Costs' }).first().click();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-dev-costs.png'), fullPage: true });
    await main.getByRole('button', { name: '4. Financing' }).first().click();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-financing.png'), fullPage: true });

    // Dark-mode pass: same 4 tabs, parcel block stays visible.
    await page.evaluate(() => {
      localStorage.setItem('refmDarkMode', 'true');
      document.body.setAttribute('data-refm-theme', 'dark');
    });
    await page.waitForTimeout(300);
    for (const [tabLabel, fileName] of [
      ['1. Schedule', 'dark-schedule.png'],
      ['2. Build Program', 'dark-build-program.png'],
      ['3. Dev Costs', 'dark-dev-costs.png'],
      ['4. Financing', 'dark-financing.png'],
    ] as const) {
      await main.getByRole('button', { name: tabLabel }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: resolve(SCREENSHOT_DIR, fileName), fullPage: true });
    }

    // Build Program in dark mode still shows parcel block.
    await main.getByRole('button', { name: '2. Build Program' }).first().click();
    await expect(page.getByTestId('build-program-land-parcels')).toBeVisible();

    assertNoErrors(state.captured);
  });
});
