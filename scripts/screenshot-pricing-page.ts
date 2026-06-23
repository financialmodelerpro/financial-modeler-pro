/* eslint-disable no-console */
/**
 * screenshot-pricing-page.ts
 *
 * DOM screenshot proof of the PUBLIC pricing page (app/pricing). Captures the
 * live plan cards + comparison block at desktop and at a narrow width, proving:
 * four cards (Trial / Analyst / Professional / Firm) aligned one-to-one with the
 * four comparison columns, and the navy + brand-gold palette (no orange).
 *
 * Usage (with the local dev server running on :3000):
 *   npx tsx scripts/screenshot-pricing-page.ts
 *   URL=http://localhost:3000/pricing npx tsx scripts/screenshot-pricing-page.ts
 *
 * Output (in repo root):
 *   pricing-desktop.png   1280px viewport, the cards + comparison block
 *   pricing-narrow.png    560px viewport, alignment preserved (scrolls together)
 */
import { chromium } from '@playwright/test';
import path from 'path';

const URL = process.env.URL ?? 'http://localhost:3000/pricing';
const OUT = process.cwd();

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // Desktop.
  const desk = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  console.log(`Loading ${URL} (desktop) ...`);
  await desk.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  const cards = desk.locator('[data-testid="live-plan-cards"]').first();
  await cards.waitFor({ timeout: 30000 });
  await cards.scrollIntoViewIfNeeded();
  await desk.waitForTimeout(400);
  await cards.screenshot({ path: path.join(OUT, 'pricing-desktop.png') });
  console.log('Saved pricing-desktop.png');

  // Narrow / mobile width.
  const narrow = await browser.newPage({ viewport: { width: 560, height: 1000 } });
  console.log(`Loading ${URL} (narrow) ...`);
  await narrow.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  const cardsN = narrow.locator('[data-testid="live-plan-cards"]').first();
  await cardsN.waitFor({ timeout: 30000 });
  await cardsN.scrollIntoViewIfNeeded();
  await narrow.waitForTimeout(400);
  await cardsN.screenshot({ path: path.join(OUT, 'pricing-narrow.png') });
  console.log('Saved pricing-narrow.png');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
