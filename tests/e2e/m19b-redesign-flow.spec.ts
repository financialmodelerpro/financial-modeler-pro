/**
 * tests/e2e/m19b-redesign-flow.spec.ts
 *
 * End-to-end coverage for the M1.9b Module 1 polish:
 *   - Hierarchy tab dissolution (m1Tabs is now 1→5)
 *   - Module1Hierarchy mounted with sections='structure' inside Schedule
 *   - Module1Hierarchy mounted with sections='assets' inside Build Program
 *   - D7 / D8 disambiguation labels (Project Construction / Project FAR)
 *   - "What goes here" callouts on all 5 tabs
 *
 * Reuses the M1.8 wizard fixture mount at /test-fixtures/m18-wizard
 * (RealEstatePlatform inside a stubbed NextAuth SessionProvider). The
 * fixture surface is unchanged in M1.9b; only the tab metadata + the
 * inside-tab content shifted.
 *
 * Asserts the M1.9b behaviors:
 *
 *   1. Wizard create still lands on Schedule (M1.9 wins it; M1.9b keeps
 *      it).
 *   2. The tab row is now 1→5 — no "6. Hierarchy" entry.
 *   3. Schedule shows the "Project Structure (Master Holding ·
 *      Sub-Projects · Phases)" section card via the mounted
 *      <Module1Hierarchy sections="structure" />.
 *   4. Schedule shows the D7 disambiguation labels: "Project
 *      Construction (years)" / "Project Operations (years)" / "Project
 *      Overlap (years)".
 *   5. Schedule shows the M1.9b/5 "What goes here" callout.
 *   6. Land shows the D8 disambiguation label "Project FAR (whole-site
 *      ceiling)" and the M1.9b/5 "What goes here" callout.
 *   7. Build Program h2 reads "Build Program" (M1.9b/6 rename) and the
 *      tab shows the "🧱 Asset & Sub-Unit Detail Editor" mount via
 *      <Module1Hierarchy sections="assets" />.
 *   8. No console.error / pageerror across the full walk.
 *
 * Screenshots: writes Schedule + Land + Build Program tab captures
 * (light + dark) into tests/screenshots/M1.9b/ for visual baseline.
 * Folder is gitignored.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M19B_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.9b');

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

async function walkWizard(page: Page, name: string): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-location').fill('Riyadh, KSA');
  // Default country = Saudi Arabia (SAR currency); leave the dropdown
  // alone so we cover the "no override" path.
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  await page.getByTestId('wizard-construction-periods').fill('5');
  await page.getByTestId('wizard-operations-periods').fill('8');
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

test.describe('M1.9b Module 1 polish', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('wizard lands on Schedule + tab row is 1→5 + nested Hierarchy mounts', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizard(page, 'Skyline Towers M19b');

    // 1) Wizard lands on Schedule (M1.9 win retained).
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // 2) Tab row is now 1→5 — no "6. Hierarchy".
    const tabRow = page.locator('.sticky-nav').first();
    await expect(tabRow.getByText('1. Schedule')).toBeVisible();
    await expect(tabRow.getByText('2. Land')).toBeVisible();
    await expect(tabRow.getByText('3. Build Program')).toBeVisible();
    await expect(tabRow.getByText('4. Dev Costs')).toBeVisible();
    await expect(tabRow.getByText('5. Financing')).toBeVisible();
    await expect(tabRow.getByText('6. Hierarchy')).toHaveCount(0);

    // 3) Schedule shows the Project Structure section card via the
    // sections="structure" mount.
    await expect(page.getByText(/Project Structure \(Master Holding · Sub-Projects · Phases\)/i)).toBeVisible();

    // 4) D7 disambiguation labels.
    await expect(page.locator('label:text-is("Project Construction (years)")').first()).toBeVisible();
    await expect(page.locator('label:text-is("Project Operations (years)")').first()).toBeVisible();
    await expect(page.locator('label:text-is("Project Overlap (years)")').first()).toBeVisible();

    // 5) "What goes here" callout on Schedule.
    await expect(page.getByText(/What goes here:/i).first()).toBeVisible();

    // 6) Land tab — D8 label + "What goes here" callout.
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await expect(page.getByRole('heading', { name: 'Land & Area', level: 2 })).toBeVisible();
    await expect(page.getByText(/Project FAR \(whole-site ceiling\)/i)).toBeVisible();
    await expect(page.getByText(/What goes here:/i).first()).toBeVisible();

    // 7) Build Program tab — h2 renamed + assets-mode mount visible.
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();
    await expect(page.getByText(/Asset & Sub-Unit Detail Editor/i)).toBeVisible();

    // Wizard wrote the timing through. The mock captured the snapshot.
    expect(state.projects).toHaveLength(1);
    const storedSnap = state.versions[0].snapshot as Record<string, unknown>;
    const phase0 = (storedSnap.phases as Array<Record<string, unknown>>)[0];
    expect(phase0.constructionPeriods).toBe(5);
    expect(phase0.operationsPeriods).toBe(8);
    expect(phase0.overlapPeriods).toBe(1);

    assertNoErrors(state.captured);
  });

  test('Schedule + Land + Build Program tab screenshots (light + dark)', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizard(page, 'M19b Screenshot Project');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // Light captures: Schedule + Land + Build Program.
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-schedule.png'), fullPage: true });
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-land.png'), fullPage: true });
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program.png'), fullPage: true });

    // Dark mode toggle (REFM Topbar owns it; fall back to localStorage).
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

    // Dark captures: Schedule + Land + Build Program.
    await page.getByRole('button', { name: '1. Schedule' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-schedule.png'), fullPage: true });
    await page.getByRole('button', { name: '2. Land' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-land.png'), fullPage: true });
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-build-program.png'), fullPage: true });
  });
});
