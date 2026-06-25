/* eslint-disable no-console */
/**
 * screenshot-platform-deeplink.tsx
 *
 * DOM screenshot proof for the platform deep-link:
 *   1. Cold /pricing (no ?platform) still shows the platform PICKER.
 *   2. /pricing?platform=real-estate lands DIRECTLY on Real Estate's plans view
 *      (no platform choice / no click), with the Trial / Professional / Firm
 *      cards and comparison. This is what the dashboard "Get access" card now
 *      links to, so a user who already chose a platform is not asked again.
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
  console.log(`1. cold: picker shown, plans-view-count=${coldHasPlans} -> ${coldOk ? 'OK' : 'FAIL'}`);
  ok = ok && coldOk;

  // 2. /pricing?platform=real-estate -> plans view directly (no click).
  console.log(`Loading ${BASE}/pricing?platform=real-estate (deep-link) ...`);
  await page.goto(`${BASE}/pricing?platform=real-estate`, { waitUntil: 'networkidle', timeout: 90000 });
  const plansView = page.locator('[data-testid="pricing-plans-view"]').first();
  await plansView.waitFor({ timeout: 30000 });
  const stillPicker = await page.locator('[data-testid="platform-picker"]').count();
  const planName = (await page.locator('[data-testid="selected-platform-name"]').innerText()).trim();
  const proCard = await page.locator('[data-testid="pricing-card-pro"]').count();
  const firmCard = await page.locator('[data-testid="pricing-card-firm"]').count();
  await page.waitForTimeout(400);
  await plansView.screenshot({ path: 'docs/screenshots/deeplink-plans-direct.png' });
  const deepOk = stillPicker === 0 && planName.length > 0 && proCard === 1 && firmCard === 1;
  console.log(`2. deep-link: pickerStillShown=${stillPicker} name="${planName}" pro=${proCard} firm=${firmCard} -> ${deepOk ? 'OK' : 'FAIL'}`);
  ok = ok && deepOk;

  await browser.close();
  console.log(ok ? '\n=== DEEP-LINK SCREENSHOT PROOF: PASS ===' : '\n=== DEEP-LINK SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
