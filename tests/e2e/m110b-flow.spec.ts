/**
 * tests/e2e/m110b-flow.spec.ts
 *
 * End-to-end coverage for the M1.10b Plot Setup polish:
 *   - Plot Setup Wizard portals to document.body and centers in viewport
 *   - InputLabel tooltips open on hover, close on Esc / click-outside
 *   - Inline Plot form exposes the same 15 writable fields as the wizard
 *
 * Reuses the M1.8 fixture mount at /test-fixtures/m18-wizard.
 *
 * Spec 1, Plot Setup Wizard opens, modal bounding box is centered in
 *          viewport (regression guard for the M1.10b/1 ancestor
 *          containing-block bug). Tooltip on an InputLabel inside the
 *          wizard opens on click, dismisses on Esc.
 *
 * Spec 2, Build Program inline form exposes all 15 Plot writable fields
 *          (regression guard for M1.10b/2 reconciliation). Captures
 *          light + dark screenshots with a tooltip open.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M110B_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.10b');

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

test.describe('M1.10b Plot Setup polish', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('Plot Setup Wizard portal, modal centers in viewport, tooltip opens & Esc dismisses', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardMixedUse(page, 'M110B-Portal');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    // Scroll into Build Program where Plot rows live, then open the wizard.
    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();

    // Scroll the page so the plot row sits below the fold, pre-M1.10b the
    // wizard would inherit the parent transform/containing-block context
    // and render below the viewport. With createPortal it always centers.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);

    const wizBtn = page.locator('[data-testid^="plot-open-wizard-"]').first();
    await expect(wizBtn).toBeVisible();
    await wizBtn.click();

    const modal = page.getByTestId('plot-setup-wizard');
    await expect(modal).toBeVisible();

    // ── Portal regression guard: modal box is centered in the 1440x900
    // viewport (top within first half, bottom within viewport).
    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y, 'modal top should be within viewport (centered, not below the fold)')
        .toBeGreaterThanOrEqual(0);
      expect(box.y, 'modal top should sit in the top half of the viewport')
        .toBeLessThan(450);
      expect(box.y + box.height, 'modal bottom should be within viewport')
        .toBeLessThanOrEqual(900);
    }

    // ── Tooltip behaviour. Focus an InputLabel help button inside the
    // wizard (keyboard accessibility contract), confirm tooltip appears,
    // press Esc, confirm dismissal.
    const helpBtn = modal.locator('[data-testid^="input-help-tt_"]').first();
    await expect(helpBtn).toBeVisible();
    await helpBtn.focus();
    const tooltip = modal.locator('[data-testid^="input-tooltip-tt_"]').first();
    await expect(tooltip).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);

    // Close wizard.
    await page.getByTestId('plot-wizard-cancel').click();
    await expect(page.getByTestId('plot-setup-wizard')).toHaveCount(0);

    assertNoErrors(state.captured);
  });

  test('Inline Plot form exposes 15 fields + light/dark tooltip screenshots', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardMixedUse(page, 'M110B-Inline');
    await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '3. Build Program' }).first().click();
    await expect(page.getByRole('heading', { name: 'Build Program', level: 2 })).toBeVisible();

    // Inline Plot form labels, every one of the 15 visible labels should
    // be present inside the Build Program tab.
    const expectedLabels = [
      'Plot Buildable Area', 'Max FAR', 'Podium Coverage',
      'Total Floors', 'Podium Floors', 'Typical Floors', 'Typical Coverage',
      'Landscape', 'Hardscape',
      'Surface Bay', 'Vertical Bay', 'Basement Bay',
      'Basement Count', 'Basement Efficiency', 'Vertical Parking Floors',
    ];
    for (const lbl of expectedLabels) {
      const count = await page.getByText(lbl, { exact: false }).count();
      expect(count, `inline form should reference "${lbl}"`).toBeGreaterThan(0);
    }

    // Light-mode screenshot with a tooltip open. Click an inline help icon
    // on Build Program to capture tooltip rendering.
    const inlineHelp = page.locator('[data-testid^="input-help-tt_"]').first();
    await inlineHelp.scrollIntoViewIfNeeded();
    await inlineHelp.hover();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-tooltip-build-program.png'), fullPage: false });
    await page.keyboard.press('Escape');

    // Switch to dark mode.
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

    const inlineHelpDark = page.locator('[data-testid^="input-help-tt_"]').first();
    await inlineHelpDark.scrollIntoViewIfNeeded();
    await inlineHelpDark.hover();
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-tooltip-build-program.png'), fullPage: false });
    await page.keyboard.press('Escape');

    assertNoErrors(state.captured);
  });
});
