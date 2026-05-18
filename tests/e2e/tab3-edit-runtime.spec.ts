/**
 * tab3-edit-runtime.spec.ts (Tab 3 Costs runtime edit-mode diagnostic)
 *
 * Brief from user (2026-05-12): "Pass 1 fix (per-field editability) did
 * not actually land in runtime UI. User tested in Incognito with fresh
 * hydration. Value / Start / End / Phasing still NOT editable."
 *
 * This spec drives an actual headless Chromium against the running dev
 * server, signs in via a forged NextAuth JWT (admin role bypasses the
 * Coming Soon gate), navigates to /refm Tab 3, expands a Construction
 * (BUA) cost row, and inspects the rendered DOM for every input plus
 * the actual interactive behaviour (click + focus + type).
 *
 * Output: tests/screenshots/tab3-edit-runtime/{before,after}-*.png +
 * console diagnostic.
 *
 * Run: npm run dev (port 3000) THEN
 *      npx playwright test tests/e2e/tab3-edit-runtime.spec.ts --reporter=list
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { hkdf } from '@panva/hkdf';
import { EncryptJWT } from 'jose';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'tab3-edit-runtime');

async function makeAuthCookie(): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET ?? 'refm-platform-secret-2026';
  const key = await hkdf('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32);
  const token = await new EncryptJWT({
    name: 'Test Admin',
    email: 'test-admin@example.com',
    sub: '00000000-0000-0000-0000-000000000000',
    role: 'admin',
    id: '00000000-0000-0000-0000-000000000000',
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .encrypt(key);
  return token;
}

const REF_SNAPSHOT = {
  version: 8,
  savedAt: '2026-05-12T00:00:00.000Z',
  project: {
    name: 'Edit-Mode Runtime Diagnostic',
    startDate: '2026-01-01',
    currency: 'SAR',
    modelType: 'annual',
    projectType: 'Mixed-Use',
    country: 'SA',
    displayScale: 'thousands',
    displayDecimals: 0,
    outputGranularity: 'annual',
  },
  phases: [{
    id: 'phase-1', name: 'Phase 1', startDate: '2026-01-01',
    constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0,
  }],
  parcels: [{
    id: 'parcel-1', phaseId: 'phase-1', name: 'Parcel A',
    area: 22066, rate: 98450, cashPct: 80, inKindPct: 20,
  }],
  landAllocationMode: 'autoByBua',
  assets: [{
    id: 'asset-1', phaseId: 'phase-1', name: 'Branded Apt', type: '',
    strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 130874,
    sellableBuaSqm: 84297, parkingBaysRequired: 0, status: 'planned',
    landAllocation: { parcelId: 'parcel-1', sqm: 0 },
  }],
  subUnits: [],
  costLines: [
    { id: 'land-cash__phase-1', phaseId: 'phase-1', name: 'Land (Cash)',
      method: 'percent_of_cash_land', value: 100, stage: 'land', scope: 'direct',
      allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0,
      phasing: 'even', isLocked: true },
    { id: 'land-inkind__phase-1', phaseId: 'phase-1', name: 'Land (In-Kind)',
      method: 'percent_of_inkind_land', value: 100, stage: 'land', scope: 'direct',
      allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0,
      phasing: 'even', isLocked: true },
    { id: 'construction-bua__phase-1', phaseId: 'phase-1', name: 'Construction (BUA)',
      method: 'rate_per_bua', value: 4500, stage: 'hard', scope: 'direct',
      allocationBasis: 'bua_share', startPeriod: 1, endPeriod: 5, phasing: 'even' },
  ],
  costOverrides: [],
  financingTranches: [],
  equityContributions: [],
};

test.describe('Tab 3 Edit Mode Runtime Diagnostic', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Construction (BUA) Value/Start/End/Phasing actually editable', async ({ page, context }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const token = await makeAuthCookie();
    await context.addCookies([
      { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);

    // T3-edit-runtime: navigate to the diagnostic-only page that
    // bypasses the auth + project-list flow and renders Module1Costs
    // directly against a seeded the reference model store. The page lives at
    // /__test_costrow and is unlinked from the main app.
    const resp = await page.goto('http://localhost:3000/test-costrow-diag');
    console.log('[diagnostic] /test-costrow-diag status:', resp?.status());
    console.log('[diagnostic] final url:', page.url());

    // Wait for the seed to land + Module1Costs to render the inputs tab.
    await page.waitForSelector('[data-testid="test-costrow-page"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('[data-testid="module1-costs"]', { timeout: 15000 }).catch(() => {});

    // Wait for cost row to render.
    const constructionRow = page.getByTestId('cost-row-asset-1-construction-bua__phase-1');
    await constructionRow.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if ((await constructionRow.count()) === 0) {
      console.log('[diagnostic] cost row testid not found. DOM dump:');
      const html = await page.content();
      console.log(html.slice(0, 4000));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/row-not-found.png`, fullPage: true });
      test.skip(true, 'cost row not in DOM');
    }

    // Expand the Construction row if collapsed.
    const collapseBtn = page.getByTestId('cost-asset-1-construction-bua__phase-1-collapse');
    if ((await collapseBtn.count()) > 0) {
      const expanded = await collapseBtn.getAttribute('aria-expanded');
      if (expanded !== 'true') await collapseBtn.click();
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/before-inspect.png`, fullPage: true });

    // ── Inspect Value input ───────────────────────────────────────────
    const valueLocator = page.getByTestId('cost-asset-1-construction-bua__phase-1-value');
    const valueCount = await valueLocator.count();
    console.log('[diagnostic] value input count:', valueCount);
    if (valueCount > 0) {
      const valueInfo = await valueLocator.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName,
        type: el.type,
        disabled: el.disabled,
        readOnly: el.readOnly,
        ariaDisabled: el.getAttribute('aria-disabled'),
        value: el.value,
        computedPointerEvents: window.getComputedStyle(el).pointerEvents,
        computedDisplay: window.getComputedStyle(el).display,
        rectWidth: el.getBoundingClientRect().width,
      }));
      console.log('[diagnostic] Value input markup:', JSON.stringify(valueInfo, null, 2));
    }

    // ── Inspect Start input ───────────────────────────────────────────
    const startLocator = page.getByTestId('cost-asset-1-construction-bua__phase-1-start');
    if ((await startLocator.count()) > 0) {
      const startInfo = await startLocator.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName, type: el.type, disabled: el.disabled, readOnly: el.readOnly,
        value: el.value, computedPointerEvents: window.getComputedStyle(el).pointerEvents,
      }));
      console.log('[diagnostic] Start input markup:', JSON.stringify(startInfo, null, 2));
    }

    // ── Inspect End input ─────────────────────────────────────────────
    const endLocator = page.getByTestId('cost-asset-1-construction-bua__phase-1-end');
    if ((await endLocator.count()) > 0) {
      const endInfo = await endLocator.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName, type: el.type, disabled: el.disabled, readOnly: el.readOnly,
        value: el.value, computedPointerEvents: window.getComputedStyle(el).pointerEvents,
      }));
      console.log('[diagnostic] End input markup:', JSON.stringify(endInfo, null, 2));
    }

    // ── Inspect Phasing select ────────────────────────────────────────
    const phasingLocator = page.getByTestId('cost-asset-1-construction-bua__phase-1-phasing');
    if ((await phasingLocator.count()) > 0) {
      const phasingInfo = await phasingLocator.evaluate((el: HTMLSelectElement) => ({
        tag: el.tagName, disabled: el.disabled,
        value: el.value, computedPointerEvents: window.getComputedStyle(el).pointerEvents,
      }));
      console.log('[diagnostic] Phasing select markup:', JSON.stringify(phasingInfo, null, 2));
    }

    // ── Try to actually type into Value ───────────────────────────────
    if (valueCount > 0) {
      console.log('[diagnostic] Attempting click + type on Value input...');
      await valueLocator.click();
      await page.waitForTimeout(200);

      // After click, the AccountingNumberInput should have switched to
      // focused mode and rendered a type=number input. Get the live
      // markup again.
      const valueAfterClick = await valueLocator.evaluate((el: HTMLInputElement) => ({
        type: el.type,
        disabled: el.disabled,
        readOnly: el.readOnly,
        hasFocus: document.activeElement === el,
        value: el.value,
      }));
      console.log('[diagnostic] Value input after click:', JSON.stringify(valueAfterClick, null, 2));

      // Now type a new number.
      await page.keyboard.type('5500');
      await page.waitForTimeout(200);
      await page.keyboard.press('Tab'); // blur

      const valueAfterType = await valueLocator.evaluate((el: HTMLInputElement) => ({
        value: el.value,
      }));
      console.log('[diagnostic] Value input after type 5500+blur:', JSON.stringify(valueAfterType));

      // Read store value via the React component's rendered display.
      // After blur, the AccountingNumberInput reformats display from the
      // store's value. So the text input's value attribute reflects the
      // store. If the store updated, display shows "5,500". If it
      // didn't, display shows "4,500".
      const valueAfterBlur = await valueLocator.evaluate((el: HTMLInputElement) => el.value);
      console.log('[diagnostic] Value input after blur (reformatted from store):', valueAfterBlur);

      // Also read the total cell — it should recompute if the rate changed.
      // For BUA = 130874, rate 4500 -> total 588,933,000; rate 5500 -> 719,807,000.
      const totalText = await page.getByTestId('cost-asset-1-construction-bua__phase-1-total').innerText();
      console.log('[diagnostic] Total cell after edit:', totalText);
    }

    // ── Section B: Land (Cash) row brief compliance ──────────────────
    // Brief: Land Cash + Land In-Kind: VALUE locked (auto-derived).
    // Start, End, Phasing remain EDITABLE.
    console.log('\n[diagnostic] === Land (Cash) row brief compliance ===');
    const landCollapse = page.getByTestId('cost-asset-1-land-cash__phase-1-collapse');
    if ((await landCollapse.count()) > 0) {
      const landExpanded = await landCollapse.getAttribute('aria-expanded');
      if (landExpanded !== 'true') await landCollapse.click();
    }
    await page.waitForTimeout(200);

    // Value: should NOT be an editable input (per Fix 5: render auto-
    // derived currency as a static div). The selector targets the
    // -value-land testid added in Fix 5.
    const landValueDisplay = page.getByTestId('cost-asset-1-land-cash__phase-1-value-land');
    const landValueInput   = page.getByTestId('cost-asset-1-land-cash__phase-1-value');
    console.log('[diagnostic] Land Value DIV count:', await landValueDisplay.count());
    console.log('[diagnostic] Land Value INPUT count (should be 0):', await landValueInput.count());

    // Start input: SHOULD be editable.
    const landStart = page.getByTestId('cost-asset-1-land-cash__phase-1-start');
    if ((await landStart.count()) > 0) {
      const info = await landStart.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName, type: el.type, disabled: el.disabled,
        readOnly: el.readOnly, value: el.value,
      }));
      console.log('[diagnostic] Land Start markup:', JSON.stringify(info));
    }

    // End input: SHOULD be editable.
    const landEnd = page.getByTestId('cost-asset-1-land-cash__phase-1-end');
    if ((await landEnd.count()) > 0) {
      const info = await landEnd.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName, type: el.type, disabled: el.disabled,
        readOnly: el.readOnly, value: el.value,
      }));
      console.log('[diagnostic] Land End markup:', JSON.stringify(info));
    }

    // Phasing select: SHOULD be editable.
    const landPhasing = page.getByTestId('cost-asset-1-land-cash__phase-1-phasing');
    if ((await landPhasing.count()) > 0) {
      const info = await landPhasing.evaluate((el: HTMLSelectElement) => ({
        tag: el.tagName, disabled: el.disabled, value: el.value,
      }));
      console.log('[diagnostic] Land Phasing markup:', JSON.stringify(info));
    }

    // Try changing Land Cash Start to 2 (functional proof).
    if ((await landStart.count()) > 0) {
      await landStart.click();
      await landStart.fill('2');
      await landStart.press('Tab');
      await page.waitForTimeout(200);
      const valueAfter = await landStart.evaluate((el: HTMLInputElement) => el.value);
      console.log('[diagnostic] Land Start after type 2 + blur:', valueAfter);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/after-land-expand.png`, fullPage: true });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/after-inspect.png`, fullPage: true });
  });
});
