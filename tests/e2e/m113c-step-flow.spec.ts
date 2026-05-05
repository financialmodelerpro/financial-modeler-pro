/**
 * tests/e2e/m113c-step-flow.spec.ts
 *
 * M1.13c regression guard. Three contracts in one walking spec across
 * all 4 Module 1 tabs:
 *
 *   1. Three-element grouping. Every VerifiedResult render carries
 *      data-formula="true" + data-state + a data-result-chip child.
 *      The user sees formula + substituted values + result chip
 *      together as one verification unit.
 *
 *   2. Math operators. The display text uses Unicode operators (× ÷)
 *      not ASCII (* /), per the M1.13c brief.
 *
 *   3. Validation states. Pushing a Plot's coverage and floors past
 *      the FAR ceiling flips the Total Built GFA result chip to
 *      data-state="error" with an issue callout. The reverse (sane
 *      values) gives data-state="ok".
 *
 *   4. Live recompute. Editing a driving input changes the result
 *      chip text in place without unmount.
 *
 *   Light + dark screenshots, all 4 tabs + 1 validation state, into
 *   tests/screenshots/M1.13c/.
 */

import { test, expect, type ConsoleMessage, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEV_SERVER_URL = process.env.M113C_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(process.cwd(), 'tests/screenshots/M1.13c');

const FAKE_PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_VERSION_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_USER_ID    = '00000000-0000-0000-0000-000000000000';
const PROXIMITY_PX    = 200;

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
 * Asserts a VerifiedResult render carries the three required visual
 * elements: data-formula attribute, data-state, and a data-result-chip
 * child node.
 */
async function assertVerifiedShape(page: Page, testId: string, label: string): Promise<void> {
  const row = page.getByTestId(testId).first();
  await expect(row, `${label}: row missing`).toBeVisible();
  await expect(row, `${label}: row missing data-formula="true"`).toHaveAttribute('data-formula', 'true');
  const state = await row.getAttribute('data-state');
  expect(state, `${label}: row missing data-state attribute`).not.toBeNull();
  expect(['ok', 'warn', 'error'], `${label}: data-state must be ok|warn|error, got ${state}`).toContain(state);
  const chip = row.locator('[data-result-chip="true"]').first();
  await expect(chip, `${label}: result chip missing`).toBeVisible();
}

/**
 * Asserts the formula caption sits within PROXIMITY_PX vertical pixels
 * of the input's bottom edge, i.e. the user does not have to scroll
 * past unrelated content to read the formula.
 */
async function assertProximate(page: Page, inputSelector: string, formulaTestId: string, label: string): Promise<void> {
  const inputBox = await page.locator(inputSelector).first().boundingBox();
  const formulaBox = await page.getByTestId(formulaTestId).first().boundingBox();
  expect(inputBox, `${label}: input bounding box missing for ${inputSelector}`).not.toBeNull();
  expect(formulaBox, `${label}: formula bounding box missing for ${formulaTestId}`).not.toBeNull();
  if (!inputBox || !formulaBox) return;
  const verticalDistance = formulaBox.y - (inputBox.y + inputBox.height);
  expect(
    verticalDistance,
    `${label}: formula ${formulaTestId} sits ${verticalDistance}px below ${inputSelector}, must be in [0, ${PROXIMITY_PX})`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    verticalDistance,
    `${label}: formula ${formulaTestId} sits ${verticalDistance}px below ${inputSelector}, must be < ${PROXIMITY_PX}px.`,
  ).toBeLessThan(PROXIMITY_PX);
}

test.describe('M1.13c step-by-step verification flow (input + formula + result + state)', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('All 4 tabs: VerifiedResult shape + math operators + validation states + live recompute', async ({ page }) => {
    const state = await setupMocks(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await createWizardProject(page, 'M113C-Step');
    const main = page.getByRole('main');

    // ── Schedule tab ─────────────────────────────────────────────────
    // Three timeline VerifiedResults present + proximity to driving inputs.
    await assertVerifiedShape(page, 'timeline-formula-type',          'Schedule: granularity');
    await assertVerifiedShape(page, 'timeline-formula-end',           'Schedule: project end');
    await assertVerifiedShape(page, 'timeline-formula-total-periods', 'Schedule: total periods');
    await assertProximate(page,
      'input[type="date"]',
      'timeline-formula-end',
      'Schedule: Project Start input -> Project End',
    );
    await assertProximate(page,
      'input[type="number"][min="0"][max]',
      'timeline-formula-total-periods',
      'Schedule: Overlap input -> Total Periods',
    );
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-schedule.png'), fullPage: true });

    // ── Build Program tab ────────────────────────────────────────────
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

    // Verify shape on the 14 plot-formula testIds.
    for (const t of [
      `formula-max-gfa-${id}`, `formula-footprint-${id}`,
      `formula-podium-gfa-${id}`, `formula-public-area-${id}`,
      `formula-typical-gfa-${id}`, `formula-total-built-${id}`,
      `formula-floors-check-${id}`, `formula-landscape-${id}`,
      `formula-hardscape-${id}`, `formula-surface-parking-${id}`,
      `formula-surface-capacity-${id}`, `formula-vertical-capacity-${id}`,
      `formula-basement-usable-${id}`, `formula-basement-capacity-${id}`,
    ]) {
      await assertVerifiedShape(page, t, `Build Program: ${t}`);
    }

    // Math operators present in the rendered text (not just the source).
    await expect(page.getByTestId(`formula-max-gfa-${id}`))      .toContainText('×', { timeout: 3_000 });
    await expect(page.getByTestId(`formula-surface-capacity-${id}`)).toContainText('÷', { timeout: 3_000 });

    // Proximity contract still holds for the key chain points.
    await assertProximate(page, `#plot-${id}-maxFAR`,         `formula-max-gfa-${id}`,        'Build Program: Max FAR -> Max GFA');
    await assertProximate(page, `#plot-${id}-podiumFloors`,   `formula-podium-gfa-${id}`,     'Build Program: Podium Floors -> Podium GFA');
    await assertProximate(page, `#plot-${id}-typicalFloors`,  `formula-total-built-${id}`,    'Build Program: Typical Floors -> Total Built GFA');
    await assertProximate(page, `#plot-${id}-hardscapePct`,   `formula-surface-parking-${id}`,'Build Program: Hardscape -> Surface Parking');
    await assertProximate(page, `#plot-${id}-surfaceBaySqm`,  `formula-surface-capacity-${id}`,'Build Program: Surface Bay -> Surface Capacity');

    // Default state is 'ok' on a fresh plot.
    await expect(page.getByTestId(`formula-total-built-${id}`)).toHaveAttribute('data-state', 'ok');

    // ── Validation: push past FAR ceiling ────────────────────────────
    // Crank Max FAR very low and Typical Floors very high so cascade
    // utilization > 100 %. Total Built result chip flips to error.
    await page.locator(`#plot-${id}-maxFAR`).fill('1');
    await page.locator(`#plot-${id}-typicalFloors`).fill('20');
    await page.locator(`#plot-${id}-typicalCoveragePct`).fill('60');
    // Force a blur so the controlled input commits.
    await page.locator(`#plot-${id}-typicalCoveragePct`).press('Tab');
    const totalBuiltRow = page.getByTestId(`formula-total-built-${id}`);
    await expect(totalBuiltRow).toHaveAttribute('data-state', 'error', { timeout: 3_000 });
    await expect(totalBuiltRow.locator('[data-result-issue="true"]')).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program-overfar.png'), fullPage: true });

    // Reset to a sane configuration and confirm the chip flips back to ok.
    await page.locator(`#plot-${id}-maxFAR`).fill('3');
    await page.locator(`#plot-${id}-typicalFloors`).fill('6');
    await page.locator(`#plot-${id}-typicalCoveragePct`).fill('30');
    await page.locator(`#plot-${id}-typicalCoveragePct`).press('Tab');
    await expect(totalBuiltRow).toHaveAttribute('data-state', 'ok', { timeout: 3_000 });

    // Live recompute: edit Plot Area, Max GFA chip text changes in place.
    await page.locator(`#plot-${id}-plotArea`).fill('200000');
    await expect(page.getByTestId(`formula-max-gfa-${id}`)).toContainText('200,000 × 3', { timeout: 3_000 });

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-build-program.png'), fullPage: true });

    // ── Dev Costs tab ────────────────────────────────────────────────
    await main.getByRole('button', { name: '3. Dev Costs' }).first().click();
    await page.waitForTimeout(300);
    const costRows = page.locator('[data-testid^="cost-formula-"]');
    const costRowCount = await costRows.count();
    expect(costRowCount, 'Dev Costs should have at least one cost-formula row').toBeGreaterThanOrEqual(1);
    // First row carries data-formula + data-state + result chip.
    const firstCostRow = costRows.first();
    await expect(firstCostRow).toHaveAttribute('data-formula', 'true');
    await expect(firstCostRow.locator('[data-result-chip="true"]')).toBeVisible();
    // Grand total row also wired.
    await assertVerifiedShape(page, 'cost-grand-total-formula-residential', 'Dev Costs: residential grand total');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-dev-costs.png'), fullPage: true });

    // ── Financing tab ────────────────────────────────────────────────
    await main.getByRole('button', { name: '4. Financing' }).first().click();
    await page.waitForTimeout(300);
    await assertVerifiedShape(page, 'financing-formula-debt-equity',  'Financing: LTV');
    await assertVerifiedShape(page, 'financing-formula-periodic-rate','Financing: periodic rate');
    await assertVerifiedShape(page, 'financing-formula-repayment',    'Financing: repayment');
    // ÷ operator used in periodic-rate (monthly model) or repayment.
    await expect(page.getByTestId('financing-formula-repayment')).toContainText('÷', { timeout: 3_000 });

    // Debt Summary card still a clean roll-up (M1.13b F1 contract).
    const debtSummary = page.getByTestId('financing-debt-summary');
    await expect(debtSummary).toBeVisible();
    await expect(debtSummary.locator('[data-formula="true"]')).toHaveCount(0);

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'light-financing.png'), fullPage: true });

    // ── Dark-mode pass ──────────────────────────────────────────────
    await page.evaluate(() => {
      localStorage.setItem('refmDarkMode', 'true');
      document.body.setAttribute('data-refm-theme', 'dark');
    });
    await page.waitForTimeout(300);
    for (const [tabLabel, fileName] of [
      ['1. Schedule',      'dark-schedule.png'],
      ['2. Build Program', 'dark-build-program.png'],
      ['3. Dev Costs',     'dark-dev-costs.png'],
      ['4. Financing',     'dark-financing.png'],
    ] as const) {
      await main.getByRole('button', { name: tabLabel }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: resolve(SCREENSHOT_DIR, fileName), fullPage: true });
    }

    assertNoErrors(state.captured);
  });
});

// suppress unused-import warning in some CI configs
const _unused: Locator | undefined = undefined; void _unused;
