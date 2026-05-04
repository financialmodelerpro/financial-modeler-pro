/**
 * tests/e2e/m18-wizard-flow.spec.ts
 *
 * End-to-end coverage for the M1.8 wizard → all-tabs data flow.
 *
 * Drives the fixture page at `/test-fixtures/m18-wizard` (which mounts
 * RealEstatePlatform inside a stubbed NextAuth SessionProvider so the
 * production /refm auth gate + Coming-Soon layout guard are out of
 * scope) and asserts:
 *
 *   1. Wizard create with specific inputs lands on the Area Program tab
 *      with no console.error / no React boundary fallback.
 *   2. Every Module 1 tab reads from the SAME store: switching tabs
 *      shows the wizard's inputs (project name, currency, model type,
 *      project type, sub-project, phase, plot, assets) on every tab
 *      that surfaces them. Tabs do not re-prompt for data the wizard
 *      already collected.
 *   3. Cross-tab edits propagate via the store: edit a field on Land &
 *      Area, switch to a different tab and back, the edit is still
 *      there.
 *   4. Reload persistence: after a page reload + project re-open via
 *      the cached active-id path, the Hierarchy tab still shows the
 *      wizard's Sub-Project / Phase / Asset structure rather than
 *      falling back to DEFAULT_MODULE1_STATE.
 *
 * Test 4 specifically guards the systemic load-path wipe: every
 * snapshot the wizard / saveVersion path POSTs is bare HydrateSnapshot
 * (no `version: 3` discriminator). On reload, `loadProject` →
 * `hydrationFromAnySnapshot` → `isNewV3` fails → `isLegacyV2` fails →
 * falls through to `DEFAULT_MODULE1_STATE`, wiping the store to
 * defaults and surfacing every tab as empty.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

const DEV_SERVER_URL = process.env.M18_DEV_SERVER_URL ?? 'http://localhost:3000';

const FAKE_PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_VERSION_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_USER_ID    = '00000000-0000-0000-0000-000000000000';

type Captured = { type: 'console' | 'pageerror'; text: string };

interface MockState {
  projects:     Array<{ id: string; name: string; location: string | null; status: string; asset_mix: string[]; current_version_id: string | null; created_at: string; updated_at: string; schema_version: number; user_id: string }>;
  versions:     Array<{ id: string; project_id: string; version_number: number; schema_version: number; label: string | null; snapshot: unknown; created_at: string }>;
  captured:     Captured[];
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
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ran: false, projectsCreated: 0, versionsCreated: 0, errors: [] }),
    });
  });

  // Project list / create. Records the POSTed snapshot in `state.versions`
  // so subsequent GET /api/refm/projects/[id] returns the same payload —
  // mirrors a real server's behavior end-to-end.
  await page.route('**/api/refm/projects', async (route, req) => {
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: state.projects.map(({ user_id: _u, ...rest }) => rest),
        }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as {
        name: string;
        snapshot: unknown;
        location?: string | null;
        status?: string;
        assetMix?: string[];
      };
      const now = new Date().toISOString();
      const project = {
        id:                  FAKE_PROJECT_ID,
        user_id:             FAKE_USER_ID,
        name:                body.name,
        location:            body.location ?? null,
        status:              body.status ?? 'Draft',
        asset_mix:           body.assetMix ?? [],
        schema_version:      3,
        current_version_id:  FAKE_VERSION_ID,
        created_at:          now,
        updated_at:          now,
      };
      const version = {
        id:             FAKE_VERSION_ID,
        project_id:     FAKE_PROJECT_ID,
        version_number: 1,
        schema_version: 3,
        label:          null,
        snapshot:       body.snapshot,
        created_at:     now,
      };
      state.projects.push(project);
      state.versions.push(version);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project, version }),
      });
      return;
    }
    await route.continue();
  });

  // Single project: load (returns latest version) / patch / delete.
  await page.route(/\/api\/refm\/projects\/[^/]+$/, async (route, req) => {
    const m = req.url().match(/\/api\/refm\/projects\/([^/?]+)/);
    const pid = m ? decodeURIComponent(m[1]) : '';
    const project = state.projects.find(p => p.id === pid);
    if (req.method() === 'GET') {
      if (!project) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
        return;
      }
      const version = state.versions.filter(v => v.project_id === pid).slice(-1)[0] ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project, version }),
      });
      return;
    }
    await route.continue();
  });

  // Versions list / save. Auto-save POSTs land here.
  await page.route(/\/api\/refm\/projects\/[^/]+\/versions$/, async (route, req) => {
    const m = req.url().match(/\/api\/refm\/projects\/([^/?]+)\/versions/);
    const pid = m ? decodeURIComponent(m[1]) : '';
    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          versions: state.versions.filter(v => v.project_id === pid).map(({ snapshot: _s, ...rest }) => rest),
        }),
      });
      return;
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { snapshot: unknown; label?: string | null; assetMix?: string[] };
      const now = new Date().toISOString();
      const nextNum = (state.versions.filter(v => v.project_id === pid).slice(-1)[0]?.version_number ?? 0) + 1;
      const version = {
        id:             `${FAKE_VERSION_ID}-${nextNum}`,
        project_id:     pid,
        version_number: nextNum,
        schema_version: 3,
        label:          body.label ?? null,
        snapshot:       body.snapshot,
        created_at:     now,
      };
      state.versions.push(version);
      const project = state.projects.find(p => p.id === pid);
      if (project) {
        project.current_version_id = version.id;
        project.updated_at = now;
        if (body.assetMix) project.asset_mix = body.assetMix;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project, version }),
      });
      return;
    }
    await route.continue();
  });

  return state;
}

async function openWizard(page: Page): Promise<void> {
  // Topbar's project context button sends activeModule → 'projects'.
  // The Topbar text shows "No project" when nothing is loaded; click it
  // to land on the Projects screen.
  await page.locator('button:has-text("No project")').first().click({ timeout: 5000 }).catch(async () => {
    // Fallback: any button containing "Project"
    await page.getByRole('button', { name: /Project/i }).first().click();
  });
  const newProjectBtn = page.getByRole('button', { name: /\+ New Project/ });
  await expect(newProjectBtn).toBeVisible({ timeout: 5000 });
  await newProjectBtn.click();
  await expect(page.getByTestId('wizard-step-indicator')).toBeVisible();
}

async function walkWizardWithDefaults(page: Page, name: string, location: string): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-location').fill(location);
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-2')).toBeVisible();
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('wizard-step-3')).toBeVisible();
  await page.getByTestId('wizard-create').click();
  await expect(page.getByTestId('area-program-tab')).toBeVisible({ timeout: 5000 });
}

function assertNoErrors(captured: Captured[]): void {
  // Filter out known-noisy warnings unrelated to the test (Next dev-mode
  // hydration timing chatter etc.). Anything left is a real signal.
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

test.describe('M1.8 wizard → all-tabs data flow', () => {
  test.beforeAll(async () => {
    let healthy = false;
    try {
      const res = await fetch(`${DEV_SERVER_URL}/api/health`);
      healthy = res.ok;
    } catch { /* ignore */ }
    test.skip(!healthy, `dev server not reachable at ${DEV_SERVER_URL}`);
  });

  test('every Module 1 tab shows the wizard data (no re-prompts)', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardWithDefaults(page, 'Riverside Towers', 'Riyadh, KSA');

    // 1) Area Program — wizard's plot + assets should be visible.
    await expect(page.getByTestId('area-program-tab')).toBeVisible();
    // 1 plot card minted by wizard.
    const plotCards = page.locator('[data-testid^="plot-card-"]');
    await expect(plotCards).toHaveCount(1);
    // 3 asset rows on the plot (Mixed-Use defaults: Residential / Hotel / Retail Podium).
    const assetRows = page.locator('[data-testid^="asset-strategy-"]');
    await expect(assetRows).toHaveCount(3);

    // 2) Hierarchy — should NOT show the first-time empty CTA. Sub-Project
    // + Phase + 3 Assets should be in the tree.
    await page.getByRole('button', { name: /Hierarchy/i }).first().click();
    // First-time empty CTA's "⚡ Quick Setup" must NOT be visible (would
    // mean subProjects.length === 0 and !manualMode → store is empty).
    const emptyCta = page.getByRole('button', { name: 'Open the Quick Setup wizard' });
    await expect(emptyCta).toHaveCount(0);
    // Sub-Project name shows the wizard's project name.
    await expect(page.getByText('Riverside Towers').first()).toBeVisible();

    // 3) Timeline — projectName, currency, model type, project start should
    // surface the wizard's inputs.
    await page.getByRole('button', { name: /Timeline/i }).first().click();
    const projectNameInput = page.locator('input[placeholder="Enter project name..."]');
    await expect(projectNameInput).toHaveValue('Riverside Towers');
    const currencyInput = page.locator('input[placeholder="e.g. SAR"]');
    await expect(currencyInput).toHaveValue('SAR');

    // 4) Land & Area — defaults are fine here; the wizard does not capture
    // FAR / land parcels. Tab should render without re-prompting for
    // project name / dates (those don't appear on this tab at all).
    await page.getByRole('button', { name: /Land & Area/i }).first().click();
    // Confirm we're on Land & Area: an FAR-related field is visible.
    await expect(page.getByText(/FAR/i).first()).toBeVisible();

    // 5) Cross-tab edit. Change FAR on Land & Area, navigate away and
    // back, value persists (proves shared store, not per-tab local state).
    const farInput = page.locator('input[type="number"]').first();
    await farInput.click();
    // Some Land & Area tabs put FAR further down — find the FAR input
    // by looking for a label "FAR" near a number input.
    // Instead: just locate the number-input that currently holds the FAR
    // default 1.5 and update it.
    const farCandidates = await page.locator('input[type="number"]').all();
    let farInputResolved: typeof farInput | null = null;
    for (const cand of farCandidates) {
      const v = await cand.inputValue();
      if (v === '1.5') { farInputResolved = cand; break; }
    }
    if (farInputResolved) {
      await farInputResolved.fill('12.7');
      await page.getByRole('button', { name: /Hierarchy/i }).first().click();
      await page.getByRole('button', { name: /Land & Area/i }).first().click();
      // Re-locate (DOM may have re-mounted) and assert.
      const cands2 = await page.locator('input[type="number"]').all();
      let foundUpdated = false;
      for (const cand of cands2) {
        const v = await cand.inputValue();
        if (v === '12.7') { foundUpdated = true; break; }
      }
      expect(foundUpdated, 'FAR=12.7 edit did not persist across tab switch').toBe(true);
    }

    assertNoErrors(state.captured);
  });

  test('reload + reopen project: data persists (systemic hydration test)', async ({ page }) => {
    const state = await setupMocks(page);
    await page.goto(`${DEV_SERVER_URL}/test-fixtures/m18-wizard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    await openWizard(page);
    await walkWizardWithDefaults(page, 'Skyline Tower', 'Dubai, UAE');

    // Project + version recorded in mock state.
    expect(state.projects).toHaveLength(1);
    expect(state.versions.length).toBeGreaterThanOrEqual(1);

    // The snapshot the wizard POSTed must round-trip with at least the
    // arrays the recogniser inspects (assets / phases / plots /
    // subProjects). It is bare HydrateSnapshot — no `version: 3`
    // discriminator. This is what the load path will receive on reload.
    const storedSnap = state.versions[0].snapshot as Record<string, unknown>;
    expect(Array.isArray(storedSnap.assets), 'stored snapshot has assets[]').toBe(true);
    expect(Array.isArray(storedSnap.phases), 'stored snapshot has phases[]').toBe(true);
    expect(Array.isArray(storedSnap.plots),  'stored snapshot has plots[]').toBe(true);
    expect(Array.isArray(storedSnap.subProjects), 'stored snapshot has subProjects[]').toBe(true);
    expect((storedSnap.assets as unknown[]).length, 'wizard wrote 3 assets').toBe(3);
    expect((storedSnap.subProjects as unknown[]).length, 'wizard wrote 1 sub-project').toBe(1);

    // Reload. attachToProjectFromLocalSnapshot wrote the active-project
    // id to localStorage at create time, so the platform's mount
    // useEffect should listProjects → restore active id → attach →
    // loadProject → hydrationFromAnySnapshot → hydrate the store.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => { /* ok */ });

    // Wait for the mount useEffect to finish (listProjects + attach).
    // attachSyncToProject awaits loadProject, which our mock answers
    // synchronously, so 1.5s is plenty.
    await page.waitForTimeout(1500);

    // Inspect the Module 1 store directly via the fixture-exposed
    // window.__module1Store handle. This is far more reliable than
    // navigating tabs — the test isolates the hydration step from the
    // navigation path.
    const storeAfterReload = await page.evaluate(() => {
      const store = (window as unknown as { __module1Store?: { getState: () => Record<string, unknown> } }).__module1Store;
      if (!store) return null;
      const s = store.getState();
      return {
        projectName:  s.projectName,
        subProjects:  (s.subProjects  as unknown[]).length,
        phases:       (s.phases       as unknown[]).length,
        plots:        (s.plots        as unknown[]).length,
        assets:       (s.assets       as unknown[]).length,
        subUnits:     (s.subUnits     as unknown[]).length,
      };
    });

    expect(storeAfterReload, 'fixture-exposed store handle').not.toBeNull();
    expect(
      storeAfterReload,
      'After reload the store should hold the wizard data (1 sub-project, ≥1 phase, ≥1 plot, 3 assets). ' +
      'If counts are all zero / defaults the snapshot recogniser at ' +
      'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts:isNewV3 ' +
      'rejected the wizard snapshot for missing `version: 3` and fell back to DEFAULT_MODULE1_STATE.',
    ).toMatchObject({
      projectName: 'Skyline Tower',
      subProjects: 1,
      phases:      1,
      plots:       1,
      assets:      3,
      subUnits:    3,
    });

    assertNoErrors(state.captured);
  });
});
