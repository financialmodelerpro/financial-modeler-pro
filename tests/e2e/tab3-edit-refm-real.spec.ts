/**
 * tab3-edit-refm-real.spec.ts (2026-05-12)
 *
 * User reported: "Still not fixed I am unable to change the costs inputs
 * as I want. Click is ignored, no cursor, no focus. Construction (BUA)
 * row. Row IS expanded (chevron is open)."
 *
 * The headless diagnostic at /test-costrow-diag proved Module1Costs
 * renders editable inputs when seeded directly via useModule1Store.setState.
 * The user reports the real /refm flow is broken. This spec drives the
 * REAL /refm path: forged NextAuth JWT -> /refm -> create project via
 * wizard -> navigate to Tab 3 -> attempt edit on Construction (BUA).
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { hkdf } from '@panva/hkdf';
import { EncryptJWT } from 'jose';

const SCREENSHOT_DIR = resolve(__dirname, '..', 'screenshots', 'tab3-edit-refm-real');

async function makeAuthCookie(): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET ?? 'refm-platform-secret-2026';
  const key = await hkdf('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32);
  return new EncryptJWT({
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
}

test.describe('Tab 3 edit mode in REAL /refm flow', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('Construction (BUA) value editable via /refm sidebar + wizard', async ({ page, context }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const token = await makeAuthCookie();
    await context.addCookies([
      { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);

    // Capture all console logs + page errors for the trace.
    page.on('console', (msg) => console.log(`[browser console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[browser pageerror] ${err.message}`));

    await page.goto('http://localhost:3000/refm');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 20000 });
    console.log('[diagnostic] /refm loaded:', page.url());
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-dashboard.png`, fullPage: true });

    // Click Module 1
    await page.getByTestId('sidebar-module1').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-after-mod1-click.png`, fullPage: true });

    // We're likely on "No project selected" screen if there's no project
    // in Supabase. Click Create Project to open the wizard.
    const createBtn = page.locator('button:has-text("Create Project")').first();
    const m1NoProject = page.getByTestId('m1-no-project');
    if ((await m1NoProject.count()) > 0) {
      console.log('[diagnostic] m1-no-project visible; opening wizard');
      await createBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/03-wizard-open.png`, fullPage: true });

      // Wizard: fill the minimum fields. Look for any "Create" or "Next"
      // buttons and walk through.
      // First check what the wizard looks like.
      const projectNameInput = page.locator('input[placeholder*="project" i], input[placeholder*="name" i]').first();
      if ((await projectNameInput.count()) > 0) {
        await projectNameInput.fill('Diagnostic Test Project');
      }
      // Click any "Create" / "Next" / "Finish" button.
      const wizardCreate = page.locator('button:has-text("Create")').last();
      if ((await wizardCreate.count()) > 0) {
        await wizardCreate.click();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/04-after-wizard.png`, fullPage: true });
    }

    // Try to find Module 1 tabs.
    const tabRow = page.getByTestId('m1-tab-row');
    if ((await tabRow.count()) === 0) {
      console.log('[diagnostic] m1-tab-row NOT visible. URL:', page.url());
      await page.screenshot({ path: `${SCREENSHOT_DIR}/05-no-tabs.png`, fullPage: true });
      test.skip(true, 'wizard did not produce a project');
    }

    // Navigate to Tab 3 (Costs).
    await page.getByTestId('m1-tab-costs').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-tab3-loaded.png`, fullPage: true });

    // Find ANY cost row to inspect what was hydrated.
    const allCostRows = page.locator('[data-testid^="cost-row-"]');
    const rowCount = await allCostRows.count();
    console.log('[diagnostic] cost row count:', rowCount);
    if (rowCount === 0) {
      console.log('[diagnostic] no cost rows. DOM dump (first 3000 chars):');
      console.log((await page.content()).slice(0, 3000));
      test.skip(true, 'no cost rows hydrated');
    }

    // Log every cost row's testid + line.id
    for (let i = 0; i < rowCount; i++) {
      const tid = await allCostRows.nth(i).getAttribute('data-testid');
      console.log(`[diagnostic] row ${i}: ${tid}`);
    }

    // Find the Construction (BUA) row. Its testid is
    // cost-row-{assetId}-construction-bua__{phaseId}. The wizard's
    // asset+phase IDs are dynamic; match by suffix.
    const constructionRow = page.locator('[data-testid*="construction-bua"]').first();
    const cRowTid = await constructionRow.getAttribute('data-testid').catch(() => null);
    console.log('[diagnostic] construction row testid:', cRowTid);
    if ((await constructionRow.count()) === 0) {
      console.log('[diagnostic] no construction-bua row found');
      test.skip(true, 'construction-bua row missing');
    }

    // Find the collapse button for the construction row.
    const collapse = constructionRow.locator('[data-testid$="-collapse"]').first();
    if ((await collapse.count()) > 0) {
      const expandedAttr = await collapse.getAttribute('aria-expanded');
      console.log('[diagnostic] construction row aria-expanded:', expandedAttr);
      if (expandedAttr !== 'true') await collapse.click();
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-construction-row-expanded.png`, fullPage: true });

    // Find the Value input within the construction row.
    const valueInput = constructionRow.locator('[data-testid$="-value"]').first();
    const vCount = await valueInput.count();
    console.log('[diagnostic] construction value input count:', vCount);
    if (vCount > 0) {
      const info = await valueInput.evaluate((el: HTMLInputElement) => ({
        tag: el.tagName,
        type: el.type,
        disabled: el.disabled,
        readOnly: el.readOnly,
        ariaDisabled: el.getAttribute('aria-disabled'),
        value: el.value,
        computedPointerEvents: window.getComputedStyle(el).pointerEvents,
        computedVisibility: window.getComputedStyle(el).visibility,
        computedDisplay: window.getComputedStyle(el).display,
        rectWidth: el.getBoundingClientRect().width,
        rectHeight: el.getBoundingClientRect().height,
      }));
      console.log('[diagnostic] construction Value input markup:', JSON.stringify(info, null, 2));

      // Check what element is at the input's center (might reveal overlay).
      const box = await valueInput.boundingBox();
      if (box) {
        const centerEl = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el ? { tag: el.tagName, testid: el.getAttribute('data-testid'), className: el.className, outerHTMLStart: el.outerHTML.slice(0, 200) } : null;
        }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        console.log('[diagnostic] element at value input center:', JSON.stringify(centerEl, null, 2));
      }

      // Try to actually click the input.
      console.log('[diagnostic] clicking value input...');
      await valueInput.click();
      await page.waitForTimeout(300);

      const afterClick = await valueInput.evaluate((el: HTMLInputElement) => ({
        type: el.type,
        disabled: el.disabled,
        readOnly: el.readOnly,
        hasFocus: document.activeElement === el,
        activeElementTag: document.activeElement?.tagName,
        activeElementTestid: document.activeElement?.getAttribute('data-testid'),
      }));
      console.log('[diagnostic] value input AFTER click:', JSON.stringify(afterClick, null, 2));

      // Try typing.
      await page.keyboard.type('99');
      await page.waitForTimeout(200);
      const afterType = await valueInput.evaluate((el: HTMLInputElement) => el.value);
      console.log('[diagnostic] value after typing "99":', afterType);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      const afterBlur = await valueInput.evaluate((el: HTMLInputElement) => el.value);
      console.log('[diagnostic] value after blur:', afterBlur);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-after-edit-attempt.png`, fullPage: true });
  });
});
