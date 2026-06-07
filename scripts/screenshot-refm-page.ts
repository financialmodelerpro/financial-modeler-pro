/* eslint-disable no-console */
/**
 * screenshot-refm-page.ts
 *
 * Captures DOM screenshot proof of the public REFM platform page: the stats bar
 * and the module roadmap. Run locally (this environment is headless without a
 * browser); outputs PNGs next to the repo.
 *
 * Usage:
 *   npx tsx scripts/screenshot-refm-page.ts
 *   URL=https://app.financialmodelerpro.com/modeling/real-estate npx tsx scripts/screenshot-refm-page.ts
 *
 * Requires the Chromium browser binary once:
 *   npx playwright install chromium
 *
 * Output (in repo root):
 *   refm-page-full.png      full page
 *   refm-page-stats.png     stats bar section
 *   refm-page-modules.png   module roadmap section
 */
import { chromium } from '@playwright/test';
import path from 'path';

const URL = process.env.URL ?? 'https://app.financialmodelerpro.com/modeling/real-estate';
const OUT = process.cwd();

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

  // Full page.
  await page.screenshot({ path: path.join(OUT, 'refm-page-full.png'), fullPage: true });
  console.log('Saved refm-page-full.png');

  // Stats bar: the section right after the hero, containing the stat values.
  const stats = page.locator('section', { hasText: 'Live Modules' }).first();
  if (await stats.count()) {
    await stats.screenshot({ path: path.join(OUT, 'refm-page-stats.png') });
    console.log('Saved refm-page-stats.png');
  } else {
    console.log('Stats section not located by text; see refm-page-full.png');
  }

  // Module roadmap: the section containing the module guide heading.
  const modules = page.locator('section', { hasText: 'Module Guide' }).first();
  if (await modules.count()) {
    await modules.scrollIntoViewIfNeeded();
    await modules.screenshot({ path: path.join(OUT, 'refm-page-modules.png') });
    console.log('Saved refm-page-modules.png');
  } else {
    console.log('Module roadmap section not located by text; see refm-page-full.png');
  }

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
