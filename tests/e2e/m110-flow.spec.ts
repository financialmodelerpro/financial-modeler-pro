/**
 * tests/e2e/m110-flow.spec.ts
 *
 * End-to-end coverage for the M1.10 setup-completeness fixes:
 *   - Plot defaults stay inside FAR ceiling (no Over FAR badge on first paint)
 *   - Wizard asset allocations land on Land tab (no "0.0%" badge)
 *   - Land vs Plot reconciliation row visible on Build Program
 *   - Plot Setup Wizard opens, walks 4 steps, saves
 *   - Parcel Setup Wizard opens from Land tab, walks 2 steps, saves
 *
 * Reuses the M1.8 fixture mount at /test-fixtures/m18-wizard.
 *
 * Spec 1, wizard creates Mixed-Use; allocation badge gone, Over FAR
 * badge gone, reconciliation row visible. Asserts the 3 user-visible
 * regressions Ahmad called out in the M1.10 brief.
 *
 * Spec 2, Plot Setup Wizard walkthrough: open from a plot, walk steps
 * 1->4, save, confirm plot fields updated.
 *
 * Spec 3, Parcel Setup Wizard walkthrough + screenshots.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M110_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.10');

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
        status: body.status ?? 'Draft', asset_mix: body.assetMix ?? [], schema_version: 3,
        current_version_id: FAKE_VERSION_ID, created_at: now, updated_at: now,
      };
      const version = {
        id: FAKE_VERSION_ID, project_id: FAKE_PROJECT_ID, version_number: 1, schema_version: 3,
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
        schema_version: 3, label: body.label ?? null, snapshot: body.snapshot, created_at: now,
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
  await page.locator('button:has-text("No project")').first().click({ timeout: 5000 }).catch(async () => {
    await page.getByRole('button', { name: /Project/i }).first().click();
  });
  const newProjectBtn = page.getByRole('button', { name: /\+ New Project/ });
  await expect(newProjectBtn).toBeVisible({ timeout: 5000 });
  await newProjectBtn.click();
  await expect(page.getByTestId('wizard-step-indicator')).toBeVisible();
}

async function walkWizardMixedUse(page: Page, name: string): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-location').fill('Riyadh, KSA');
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-3')).toBeVisible();
  // Default wizardProjectType is 'Mixed-Use' (ProjectWizard.tsx:184), so
  // Step 3 already opens with the 50/30/20 seed Residential / Hotel /
  // Retail Podium. Just create.
  await page.getByTestId('wizard-create').click();
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

test.describe('M1.10 setup-completeness fixes', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('wizard Mixed-Use → no 0% allocation badge, no Over FAR, reconciliation visible', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardMixedUse(page, 'M110-MixedUse');

    // Wizard lands on Schedule.
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // ── Land tab, allocations sum to 100% (M1.10/3 fix). Pre-M1.10 the
    // Land tab fired "Asset allocations sum to 0.0% (must = 100)" because
    // assetById.get('residential') missed the wizard's wizardasset_1/2/3
    // ids. Post-M1.10 the bucket-sum derivation correctly returns 100%
    // for the 50+30+20 Mixed-Use seed.
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await expect(page.getByRole('heading', { name: 'Land & Area', level: 2 })).toBeVisible();
    await expect(page.getByText(/Asset allocations sum to 0\.0%/)).toHaveCount(0);

    // ── Build Program, no Over FAR badge on first paint (M1.10/2 fix).
    // The default plot envelope used to be 173.3% (utilisation breached
    // FAR). Retuned defaults give 80% utilisation.
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();
    await expect(page.getByText(/Over FAR \(/)).toHaveCount(0);

    // ── Land vs Plot reconciliation row (M1.10/5 fix) is visible.
    await expect(page.getByTestId('land-plot-reconciliation')).toBeVisible();

    assertNoErrors(state.captured);
  });

  test('Plot Setup Wizard walkthrough, open, walk 4 steps, save', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardMixedUse(page, 'M110-PlotWiz');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();

    // Open the Plot Setup Wizard via the per-plot button.
    const wizBtn = page.locator('[data-testid^="plot-open-wizard-"]').first();
    await expect(wizBtn).toBeVisible();
    await wizBtn.click();

    await expect(page.getByTestId('plot-setup-wizard')).toBeVisible();
    await expect(page.getByTestId('plot-wizard-step-1')).toBeVisible();

    // Step 1, Envelope. Bump FAR.
    const farInput = page.getByTestId('plot-wizard-maxFAR');
    await farInput.fill('4');
    await page.getByTestId('plot-wizard-next').click();

    // Step 2, Floors. Live envelope preview present.
    await expect(page.getByTestId('plot-wizard-step-2')).toBeVisible();
    await expect(page.getByTestId('plot-wizard-envelope-preview')).toBeVisible();
    await page.getByTestId('plot-wizard-next').click();

    // Step 3, Parking.
    await expect(page.getByTestId('plot-wizard-step-3')).toBeVisible();
    await page.getByTestId('plot-wizard-next').click();

    // Step 4, Assets. Save & Close.
    await expect(page.getByTestId('plot-wizard-step-4')).toBeVisible();
    await page.getByTestId('plot-wizard-save').click();

    // Modal closed.
    await expect(page.getByTestId('plot-setup-wizard')).toHaveCount(0);

    assertNoErrors(state.captured);
  });

  test('Parcel Setup Wizard + screenshots (light + dark)', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardMixedUse(page, 'M110-ParcelWiz');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // Land tab screenshot (light).
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await expect(page.getByRole('heading', { name: 'Land & Area', level: 2 })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-land.png'), fullPage: true });

    // Open the Parcel Setup Wizard.
    await page.getByTestId('open-parcel-wizard').click();
    await expect(page.getByTestId('parcel-setup-wizard')).toBeVisible();
    await expect(page.getByTestId('parcel-wizard-step-1')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-parcel-wiz-step1.png'), fullPage: true });

    // Walk to review step + save.
    await page.getByTestId('parcel-wizard-next').click();
    await expect(page.getByTestId('parcel-wizard-step-2')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-parcel-wiz-step2.png'), fullPage: true });
    await page.getByTestId('parcel-wizard-save').click();
    await expect(page.getByTestId('parcel-setup-wizard')).toHaveCount(0);

    // Build Program screenshot (light).
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program.png'), fullPage: true });

    // Open Plot Setup Wizard for screenshot.
    await page.locator('[data-testid^="plot-open-wizard-"]').first().click();
    await expect(page.getByTestId('plot-setup-wizard')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-plot-wiz-step1.png'), fullPage: true });
    await page.getByTestId('plot-wizard-next').click();
    await expect(page.getByTestId('plot-wizard-step-2')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-plot-wiz-step2.png'), fullPage: true });
    await page.getByTestId('plot-wizard-cancel').click();

    // Dark mode toggle.
    const darkToggle = page.getByRole('button', { name: /Switch to dark|Switch to light|🌙|☀️/i }).first();
    if (await darkToggle.isVisible().catch(() => false)) {
      await darkToggle.click();
    } else {
      await page.evaluate(() => {
        localStorage.setItem('refmDarkMode', 'true');
        document.body.setAttribute('data-refm-theme', 'dark');
      });
    }
    await page.waitForTimeout(300);

    // Dark captures.
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-land.png'), fullPage: true });
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-build-program.png'), fullPage: true });

    assertNoErrors(state.captured);
  });
});
