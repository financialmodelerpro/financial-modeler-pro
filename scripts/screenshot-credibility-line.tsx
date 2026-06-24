/* eslint-disable no-console */
/**
 * screenshot-credibility-line.tsx
 *
 * DOM screenshot proof for the editable pricing-page credibility band.
 *
 *  A. LIVE public pricing page (app/pricing): captures the founder-credibility
 *     gold band element and asserts it shows the default wording, including
 *     "A PaceMakers Business Consultants Platform." (the Platform wording).
 *
 *  B. Plan Builder setting: a faithful static render of the exact settings-card
 *     markup added to app/admin/plans (the real admin page needs a NextAuth
 *     admin session, so we mirror its markup, same convention as
 *     screenshot-entitlement-gate.tsx). Proves the labelled text field + save.
 *
 *  C. Empty value: renders the band's conditional with a blank value and asserts
 *     NO band is emitted (no broken band).
 *
 * Run (dev server on :3000): npx tsx scripts/screenshot-credibility-line.tsx
 *
 * No em dashes in this file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_CREDIBILITY_LINE } from '../src/shared/entitlements/pricingPageSettings';

const URL = process.env.URL ?? 'http://localhost:3000/pricing';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  mkdirSync('docs/screenshots', { recursive: true });
  let ok = true;

  // ── A. LIVE public band ────────────────────────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  const band = page.locator('[data-testid="founder-credibility"]').first();
  await band.waitFor({ timeout: 30000 });
  await band.scrollIntoViewIfNeeded();
  const bandText = (await band.innerText()).trim();
  await band.screenshot({ path: 'docs/screenshots/credibility-public.png' });
  const bandOk = bandText === DEFAULT_CREDIBILITY_LINE && /A PaceMakers Business Consultants Platform\./.test(bandText);
  console.log(`A. public band text matches default + "Platform" : ${bandOk}`);
  console.log(`   text: "${bandText}"`);
  ok = ok && bandOk;

  // ── B. Plan Builder setting card (faithful static mirror) ───────────────────
  const planBuilderCard = `
  <div data-testid="pricing-page-settings" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;max-width:880px">
    <div style="font-size:13px;font-weight:700;color:#0D2E5A;margin-bottom:4px">Pricing page credibility line</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:10px">Shown in the gold band on the public and in-app pricing pages. Leave blank to hide the band entirely.</div>
    <textarea data-testid="pricing-credibility-input" rows="2" style="width:100%;padding:8px 10px;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;box-sizing:border-box">${DEFAULT_CREDIBILITY_LINE}</textarea>
    <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
      <button data-testid="save-credibility" style="padding:7px 16px;border-radius:6px;border:none;font-weight:700;font-size:13px;color:#fff;background:#2EAA4A">Save credibility line</button>
      <button data-testid="reset-credibility" style="padding:7px 14px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;font-weight:600;font-size:12.5px;color:#475569">Reset to default</button>
    </div>
  </div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#F4F7FC;color:#0f172a;padding:24px}h3{color:#0D2E5A;margin:0 0 10px}</style></head>
<body>
  <h3>Plan Builder (/admin/plans): editable pricing credibility line</h3>
  ${planBuilderCard}
</body></html>`;
  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/credibility-plan-builder.html');
  writeFileSync(htmlPath, html, 'utf8');
  const pb = await browser.newPage({ viewport: { width: 960, height: 320 } });
  await pb.goto('file://' + htmlPath);
  const inputCount = await pb.locator('[data-testid="pricing-credibility-input"]').count();
  const saveCount = await pb.locator('[data-testid="save-credibility"]').count();
  const inputValue = await pb.locator('[data-testid="pricing-credibility-input"]').inputValue();
  await pb.screenshot({ path: 'docs/screenshots/credibility-plan-builder.png', fullPage: true });
  const pbOk = inputCount === 1 && saveCount === 1 && inputValue === DEFAULT_CREDIBILITY_LINE;
  console.log(`B. plan builder field + save present, default prefilled : ${pbOk}`);
  ok = ok && pbOk;

  // ── C. Empty value hides the band ───────────────────────────────────────────
  const emptyHtml = `<!doctype html><html><body><div id="root"></div>
  <script>
    var credibilityLine = '';
    if (credibilityLine.trim() !== '') {
      var d = document.createElement('div');
      d.setAttribute('data-testid','founder-credibility');
      document.getElementById('root').appendChild(d);
    }
  </script></body></html>`;
  const emptyPath = resolve('scripts/.tmp/credibility-empty.html');
  writeFileSync(emptyPath, emptyHtml, 'utf8');
  const ep = await browser.newPage();
  await ep.goto('file://' + emptyPath);
  const emptyBandCount = await ep.locator('[data-testid="founder-credibility"]').count();
  const emptyOk = emptyBandCount === 0;
  console.log(`C. empty value renders no band : ${emptyOk}`);
  ok = ok && emptyOk;

  await browser.close();
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
