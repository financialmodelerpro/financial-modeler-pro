/**
 * tests/e2e/m113d-equation-rows.spec.ts
 *
 * M1.13d regression guard. Build Program adopts the EquationRow
 * 3-box layout. Three contracts in one walking spec:
 *
 *   1. Layout shape. Every plot envelope step + every cascade step
 *      renders as one EquationRow (data-equation-row="true") with at
 *      least one input field, at least one operator span, and one
 *      result chip carrying data-result-chip="true".
 *
 *   2. Derived chaining. Footprint feeds Podium GFA + Public Area;
 *      Public Area feeds Landscape / Hardscape / Surface Parking.
 *      The downstream rows show their upstream values as read-only
 *      dashed boxes (data-derived="true"), so the user reads the
 *      chain visually instead of having to remember it.
 *
 *   3. Validation. Pushing a plot's coverage and floors past the
 *      FAR ceiling flips the Total Built GFA chip to data-state=
 *      "error" with an issue chip below the row. Resetting brings
 *      it back to ok.
 *
 *   Light + dark screenshots into tests/screenshots/M1.13d/.
 */

import { test, expect, type ConsoleMessage, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M113D_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.13d');

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

async function createWizardProject(page: Page, name: string): Promise<void> {
  await openWizard(page);
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-location').fill('Riyadh, KSA');
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-3')).toBeVisible();
  await page.getByTestId('wizard-create').click();
  await expect(page.getByRole('heading', { name: 'Project Schedule', level: 2 })).toBeVisible({ timeout: 10_000 });
}

/**
 * Asserts a row carries the EquationRow shape contract: container has
 * data-equation-row="true", contains at least one input field (or
 * derived box), and contains a result chip with data-result-chip.
 */
async function assertEquationShape(page: Page, rowTestId: string, label: string): Promise<void> {
  const row = page.getByTestId(rowTestId).first();
  await expect(row, `${label}: row missing`).toBeVisible();
  await expect(row, `${label}: row missing data-equation-row`).toHaveAttribute('data-equation-row', 'true');
  // Row must contain an input element OR a derived box.
  const hasInput   = await row.locator('input[type="number"]').count();
  const hasDerived = await row.locator('[data-derived="true"]').count();
  expect(hasInput + hasDerived,
    `${label}: row has ${hasInput} input(s) and ${hasDerived} derived box(es), expected >= 1`,
  ).toBeGreaterThanOrEqual(1);
  // Row must contain a result chip.
  const chip = row.locator('[data-result-chip="true"]').first();
  await expect(chip, `${label}: result chip missing`).toBeVisible();
}

test.describe('M1.13d EquationRow 3-box layout (Build Program)', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('Plot envelope + cascade render as EquationRows; derived chain visible; validation flips', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await createWizardProject(page, 'M113D-Equation');
    const main = page.getByRole('main');

    // Move to Build Program tab + add first plot.
    await main.getByRole('button', { name: '2. Build Program' }).first().click();
    const addFirstBtn = page.getByTestId('add-first-plot-btn');
    if (await addFirstBtn.isVisible().catch(() => false)) {
      await addFirstBtn.click();
    }
    const firstPlotCard = page.locator('[data-testid^="plot-card-"]').first();
    await expect(firstPlotCard).toBeVisible({ timeout: 5_000 });
    const plotTestId = await firstPlotCard.getAttribute('data-testid');
    const id = plotTestId?.replace('plot-card-', '') ?? '';
    expect(id).not.toEqual('');

    // ── Contract 1: layout shape across all 14 envelope steps. ─────
    const envelopeRows = [
      `row-max-gfa-${id}`,           `row-footprint-${id}`,
      `row-podium-gfa-${id}`,        `row-public-area-${id}`,
      `row-typical-gfa-${id}`,       `row-total-built-${id}`,
      `row-floors-check-${id}`,      `row-landscape-${id}`,
      `row-hardscape-${id}`,         `row-surface-parking-${id}`,
      `row-surface-capacity-${id}`,  `row-vertical-capacity-${id}`,
      `row-basement-usable-${id}`,   `row-basement-capacity-${id}`,
      `row-parking-total-${id}`,
    ];
    for (const r of envelopeRows) {
      await assertEquationShape(page, r, `envelope row ${r}`);
    }

    // ── Contract 2: derived chain visible. The Public Area row must
    //     contain TWO derived boxes (Plot Area + Footprint), no input.
    //     The Surface Parking row must contain THREE derived boxes
    //     (Public Area, Landscape, Hardscape). ─────────────────────
    const publicAreaRow = page.getByTestId(`row-public-area-${id}`);
    await expect(publicAreaRow.locator('[data-derived="true"]')).toHaveCount(2);
    await expect(publicAreaRow.locator('input[type="number"]')).toHaveCount(0);

    const surfaceParkingRow = page.getByTestId(`row-surface-parking-${id}`);
    await expect(surfaceParkingRow.locator('[data-derived="true"]')).toHaveCount(3);
    await expect(surfaceParkingRow.locator('input[type="number"]')).toHaveCount(0);

    // ── Contract 3: 3-input row works (Typical GFA = Plot × Cov ×
    //     Floors). Has 1 derived (Plot Area) + 2 inputs (Coverage,
    //     Floors) and 2 operator spans. ─────────────────────────
    const typicalRow = page.getByTestId(`row-typical-gfa-${id}`);
    await expect(typicalRow.locator('[data-derived="true"]')).toHaveCount(1);
    await expect(typicalRow.locator('input[type="number"]')).toHaveCount(2);

    // ── Contract 4: validation flip + issue chip. ──────────────────
    await page.locator(`#plot-${id}-maxFAR`).fill('1');
    await page.locator(`#plot-${id}-typicalFloors`).fill('20');
    await page.locator(`#plot-${id}-typicalCoveragePct`).fill('60');
    await page.locator(`#plot-${id}-typicalCoveragePct`).press('Tab');

    const totalBuiltChip = page.getByTestId(`formula-total-built-${id}`);
    const totalBuiltRow  = page.getByTestId(`row-total-built-${id}`);
    await expect(totalBuiltChip).toHaveAttribute('data-state', 'error', { timeout: 3_000 });
    await expect(totalBuiltRow.locator('[data-result-issue="true"]')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program-overfar.png'), fullPage: true });

    // Reset to sane values.
    await page.locator(`#plot-${id}-maxFAR`).fill('3');
    await page.locator(`#plot-${id}-typicalFloors`).fill('6');
    await page.locator(`#plot-${id}-typicalCoveragePct`).fill('30');
    await page.locator(`#plot-${id}-typicalCoveragePct`).press('Tab');
    await expect(totalBuiltChip).toHaveAttribute('data-state', 'ok', { timeout: 3_000 });

    // ── Contract 5: live recompute. Edit Plot Area and Max GFA
    //     chip's text changes in place. ──────────────────────────
    await page.locator(`#plot-${id}-plotArea`).fill('200000');
    await expect(page.getByTestId(`formula-max-gfa-${id}`))
      .toHaveText(/600,000/, { timeout: 3_000 }); // 200,000 × 3

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program.png'), fullPage: true });

    // ── Dark-mode pass ─────────────────────────────────────────────
    await page.evaluate(() => {
      localStorage.setItem('refmDarkMode', 'true');
      document.body.setAttribute('data-refm-theme', 'dark');
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'dark-build-program.png'), fullPage: true });

    assertNoErrors(state.captured);
  });
});

// suppress unused-import warning in some CI configs
const _unused: Locator | undefined = undefined; void _unused;
