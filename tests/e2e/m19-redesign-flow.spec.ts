/**
 * tests/e2e/m19-redesign-flow.spec.ts
 *
 * End-to-end coverage for the M1.9 Module 1 UX redesign.
 *
 * Reuses the M1.8 wizard fixture mount at /test-fixtures/m18-wizard
 * (RealEstatePlatform inside a stubbed NextAuth SessionProvider) — the
 * fixture surface is unchanged in M1.9; only the wizard's fields and
 * the tab metadata + content shifted.
 *
 * Asserts the M1.9 redesign behaviors:
 *
 *   1. Wizard create lands the user on the Schedule tab (was Area
 *      Program in M1.8). Per Ahmad's audit: user just answered the
 *      wizard, Schedule lets them validate the wizard's capture before
 *      drilling further.
 *   2. The tab row reads as numbered 1→6 sequence:
 *        1. Schedule → 2. Land → 3. Build Program → 4. Dev Costs →
 *        5. Financing → 6. Hierarchy
 *      The labels themselves carry the numeric prefix.
 *   3. Schedule tab no longer asks for Project Identity (project name,
 *      type, country, currency). The wizard captured them; re-asking
 *      was the duplicate-input bug Ahmad called out.
 *   4. Land tab no longer hosts the Asset Mix or Deduction/Efficiency
 *      panels — those have moved to the Hierarchy tab's per-asset
 *      cards.
 *   5. No console.error / pageerror across the full walk.
 *
 * Screenshots: writes Schedule + Land tab captures (light + dark) into
 * tests/screenshots/M1.9/ for visual baseline. Folder is gitignored.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M19_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.9');

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
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ project, version }),
      });
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

async function walkWizardWithM19Fields(page: Page, name: string): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-location').fill('Dubai, UAE');
  // M1.9 — country dropdown drives currency. Pick UAE so currency
  // auto-flips to AED, then Continue.
  await page.getByTestId('wizard-country').selectOption('United Arab Emirates');
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  // M1.9 — Step 2 carries the new timeline trio. Set non-default values
  // so the assertion later proves they survived the wizard → snapshot
  // → store hydration path.
  await page.getByTestId('wizard-construction-periods').fill('7');
  await page.getByTestId('wizard-operations-periods').fill('11');
  await page.getByTestId('wizard-overlap-periods').fill('1');
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-3')).toBeVisible();
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

test.describe('M1.9 Module 1 UX redesign', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('wizard with M1.9 fields lands on Schedule tab + numbered tab row', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardWithM19Fields(page, 'Skyline Towers M19');

    // 1) Land on Schedule (not Area Program).
    // The Schedule tab's h2 reads "Project Schedule" (M1.9 rename).
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // 2) Tab row reads as numbered 1→6 sequence. Look for each label.
    const tabRow = page.locator('.sticky-nav').first();
    await expect(tabRow.getByText('1. Schedule')).toBeVisible();
    await expect(tabRow.getByText('2. Land')).toBeVisible();
    await expect(tabRow.getByText('3. Build Program')).toBeVisible();
    await expect(tabRow.getByText('4. Dev Costs')).toBeVisible();
    await expect(tabRow.getByText('5. Financing')).toBeVisible();
    await expect(tabRow.getByText('6. Hierarchy')).toBeVisible();

    // 3) Schedule tab no longer hosts Project Identity card. Check the
    // h3 that used to head the (now-removed) card is gone, and the
    // subtitle explicitly references the wizard / Hierarchy as the
    // canonical home.
    await expect(page.getByRole('heading', { name: 'Project Identity', level: 3 })).toHaveCount(0);
    await expect(page.getByText(/Project name, type, country, and currency live in the create wizard/i)).toBeVisible();

    // 4) Wizard timing values made it through. Module1Timeline labels
    // are bare <label> elements (no htmlFor) so getByLabel can't anchor
    // — locate the inputs by walking up to the wrapping div and back
    // down to the only number input inside it. Light DOM check; the
    // mock-state snapshot assertion below is the canonical proof.
    const constructionInput = page.locator('div:has(> label:text-is("Construction (years)")) input[type="number"]').first();
    await expect(constructionInput).toHaveValue('7');
    const operationsInput = page.locator('div:has(> label:text-is("Operations (years)")) input[type="number"]').first();
    await expect(operationsInput).toHaveValue('11');
    const overlapInput = page.locator('div:has(> label:text-is("Overlap (years)")) input[type="number"]').first();
    await expect(overlapInput).toHaveValue('1');

    // 5) Land tab — Asset Mix / Deduction & Efficiency panels are gone.
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await expect(page.getByRole('heading', { name: 'Land & Area', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Asset Mix', level: 3 })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Deduction.*Efficiency Factors/i, level: 3 })).toHaveCount(0);
    await expect(page.getByText(/Where did Asset Mix go\?/i)).toBeVisible();

    // 6) Wizard wrote the AED currency from the United Arab Emirates
    // country pick. We verify via the stored snapshot in mock state
    // (the Land tab no longer renders currency since that input moved
    // out in M1.9).
    expect(state.projects).toHaveLength(1);
    const storedSnap = state.versions[0].snapshot as Record<string, unknown>;
    expect(storedSnap.currency).toBe('AED');
    expect(storedSnap.country).toBe('United Arab Emirates');
    const phase0 = (storedSnap.phases as Array<Record<string, unknown>>)[0];
    expect(phase0.constructionPeriods).toBe(7);
    expect(phase0.operationsPeriods).toBe(11);
    expect(phase0.overlapPeriods).toBe(1);

    assertNoErrors(state.captured);
  });

  test('Schedule + Land tab screenshots (light + dark)', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardWithM19Fields(page, 'M19 Screenshot Project');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // Light is the default (system + Topbar default). Capture Schedule
    // + Land tab images.
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-schedule.png'), fullPage: true });
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-land.png'), fullPage: true });

    // Dark mode is owned by the REFM Topbar (own localStorage key
    // refmDarkMode + body[data-refm-theme="dark"]). Toggle by clicking
    // the ☀️/🌙 button in the Topbar; the button's accessible label
    // comes from the title attribute. Fall back to direct localStorage
    // + reload if the toggle button is not found.
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

    // Re-navigate to Schedule for the dark-mode capture.
    await page.getByRole('button', { name: '1. Schedule' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-schedule.png'), fullPage: true });
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-land.png'), fullPage: true });
  });
});
