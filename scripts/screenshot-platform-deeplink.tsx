/* eslint-disable no-console */
/**
 * screenshot-platform-deeplink.tsx
 *
 * DOM screenshot proof for the path-based per-platform pricing URL:
 *   1. Cold /pricing (no platform) still shows the platform PICKER.
 *   2. /pricing/refm (source-derived segment = shortName lowercased) lands
 *      DIRECTLY on Real Estate's plans view (no platform choice / no click),
 *      with Trial / Professional / Firm cards. This is the canonical URL the
 *      dashboard "Get access" and the marketing site both link to.
 *   3. The legacy /pricing?platform=real-estate redirects to the path form and
 *      still lands on the plans view (no dead end).
 *
 * Run (server on :3000): npx tsx scripts/screenshot-platform-deeplink.tsx
 *
 * No em dashes in this file.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  mkdirSync('docs/screenshots', { recursive: true });
  let ok = true;

  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });

  // 1. Cold /pricing -> picker.
  console.log(`Loading ${BASE}/pricing (cold) ...`);
  await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle', timeout: 90000 });
  const picker = page.locator('[data-testid="platform-picker"]').first();
  await picker.waitFor({ timeout: 30000 });
  const coldHasPlans = await page.locator('[data-testid="pricing-plans-view"]').count();
  await page.locator('section').filter({ has: picker }).first().screenshot({ path: 'docs/screenshots/deeplink-cold-picker.png' });
  const coldOk = coldHasPlans === 0;
  console.log(`1. cold /pricing: picker shown, plans-view-count=${coldHasPlans} -> ${coldOk ? 'OK' : 'FAIL'}`);
  ok = ok && coldOk;

  // 2. /pricing/refm (path) -> plans view directly (no click).
  console.log(`Loading ${BASE}/pricing/refm (path-based) ...`);
  await page.goto(`${BASE}/pricing/refm`, { waitUntil: 'networkidle', timeout: 90000 });
  const plansView = page.locator('[data-testid="pricing-plans-view"]').first();
  await plansView.waitFor({ timeout: 30000 });
  const finalUrl = page.url();
  const stillPicker = await page.locator('[data-testid="platform-picker"]').count();
  const planName = (await page.locator('[data-testid="selected-platform-name"]').innerText()).trim();
  const proCard = await page.locator('[data-testid="pricing-card-pro"]').count();
  const firmCard = await page.locator('[data-testid="pricing-card-firm"]').count();
  await page.waitForTimeout(400);
  await plansView.screenshot({ path: 'docs/screenshots/deeplink-plans-direct.png' });
  const deepOk = finalUrl.includes('/pricing/refm') && stillPicker === 0 && planName.length > 0 && proCard === 1 && firmCard === 1;
  console.log(`2. /pricing/refm: url="${finalUrl}" pickerStillShown=${stillPicker} name="${planName}" pro=${proCard} firm=${firmCard} -> ${deepOk ? 'OK' : 'FAIL'}`);
  ok = ok && deepOk;

  // 3. Legacy query redirects to the path and still lands on plans.
  console.log(`Loading ${BASE}/pricing?platform=real-estate (legacy redirect) ...`);
  await page.goto(`${BASE}/pricing?platform=real-estate`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.locator('[data-testid="pricing-plans-view"]').first().waitFor({ timeout: 30000 });
  const legacyUrl = page.url();
  const legacyName = (await page.locator('[data-testid="selected-platform-name"]').innerText()).trim();
  const legacyOk = /\/pricing\/real-estate/.test(legacyUrl) && legacyName.length > 0;
  console.log(`3. legacy query: redirected to "${legacyUrl}" name="${legacyName}" -> ${legacyOk ? 'OK' : 'FAIL'}`);
  ok = ok && legacyOk;

  await browser.close();
  console.log(ok ? '\n=== PLATFORM PRICING PATH PROOF: PASS ===' : '\n=== PLATFORM PRICING PATH PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
