/* eslint-disable no-console */
/**
 * screenshot-pricing-explorer.tsx
 *
 * DOM screenshot proof for the one-page pricing platform picker:
 *   1. The platform picker (step 1): REFM "Available now" + coming-soon disabled.
 *   2. The REFM plans view (step 2) after selecting REFM, with the back control.
 *   3. A footer showing the new "Platform" wording.
 *
 * Run (dev server on :3000): npx tsx scripts/screenshot-pricing-explorer.tsx
 *
 * No em dashes in this file.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:3000/pricing';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  mkdirSync('docs/screenshots', { recursive: true });
  let ok = true;

  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });

  // 1. Picker present: REFM live (clickable button) + a coming-soon platform.
  const picker = page.locator('[data-testid="platform-picker"]').first();
  await picker.waitFor({ timeout: 30000 });
  const refmCard = page.locator('[data-testid="platform-card-real-estate"]');
  const refmTag = (await page.locator('[data-testid="platform-status-real-estate"]').innerText()).trim();
  const refmIsButton = (await refmCard.evaluate((el) => el.tagName)).toUpperCase() === 'BUTTON';
  const bvmTag = (await page.locator('[data-testid="platform-status-business-valuation"]').innerText()).trim();
  const bvmDisabled = await page.locator('[data-testid="platform-card-business-valuation"]').getAttribute('aria-disabled');
  await page.locator('section').filter({ has: picker }).first().screenshot({ path: 'docs/screenshots/pricing-picker.png' });
  console.log(`1. REFM tag="${refmTag}" isButton=${refmIsButton} | BVM tag="${bvmTag}" disabled=${bvmDisabled}`);
  // innerText is uppercased by CSS text-transform; compare case-insensitively.
  const pickerOk = /^available now$/i.test(refmTag) && refmIsButton && /^coming soon$/i.test(bvmTag) && bvmDisabled === 'true';
  ok = ok && pickerOk;

  // 2. Select REFM -> plans view in place, with back control + scoped plans.
  await refmCard.click();
  const plansView = page.locator('[data-testid="pricing-plans-view"]').first();
  await plansView.waitFor({ timeout: 30000 });
  const hasBack = await page.locator('[data-testid="back-to-platforms"]').count();
  const planName = (await page.locator('[data-testid="selected-platform-name"]').innerText()).trim();
  const hasCards = await page.locator('[data-testid="live-plan-cards"]').count();
  const hasBand = await page.locator('[data-testid="founder-credibility"]').count();
  await page.waitForTimeout(400);
  await plansView.screenshot({ path: 'docs/screenshots/pricing-plans-view.png' });
  console.log(`2. back=${hasBack} name="${planName}" cards=${hasCards} credibilityBand=${hasBand}`);
  const plansOk = hasBack === 1 && planName.length > 0 && planName !== 'Modeling Platform' && hasCards === 1 && hasBand === 1;
  ok = ok && plansOk;

  // 3. Footer wording (new "Platform", not "product of").
  const footer = page.locator('footer').first();
  await footer.scrollIntoViewIfNeeded();
  const footerText = await footer.innerText();
  await footer.screenshot({ path: 'docs/screenshots/pricing-footer.png' });
  const footerOk = /platform/i.test(footerText) && !/product of/i.test(footerText);
  console.log(`3. footer wording ok=${footerOk}`);
  ok = ok && footerOk;

  await browser.close();
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
