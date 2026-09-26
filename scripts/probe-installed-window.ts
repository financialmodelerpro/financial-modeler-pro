/**
 * probe-installed-window.ts (2026-09-26)
 *
 * Renders the Modeling Hub sign-in page in a real Chromium TWICE: once as a
 * browser tab, once with the page's display mode emulated as "standalone"
 * (what an installed app window reports), and says what is visible in each.
 * Read-only: it loads pages and signs nobody in.
 *
 *   tab:       the website header, the Training Hub link, "Back to Home" all
 *              visible; the title is the page's own.
 *   installed: none of them visible; the sign-in form still is; the title is
 *              "Modeling Hub".
 *
 * Run against a dev server or production:
 *   BASE=http://localhost:3000 npx tsx scripts/probe-installed-window.ts
 * Not in the suite (it needs a running server).
 *
 * No em dashes in this file.
 */
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3000';
let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

async function snapshot(page: Page): Promise<Record<string, boolean | string>> {
  // A STRING, not a function: tsx rewrites named functions with a helper the page does not have.
  return page.evaluate(SNAPSHOT_JS) as Promise<Record<string, boolean | string>>;
}

const SNAPSHOT_JS = `(() => {
  function shown(el) { return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; }
  function byText(t) {
    return [...document.querySelectorAll('a, span, div, p')]
      .find(function (e) { return e.childElementCount === 0 && (e.textContent || '').trim().includes(t); }) || null;
  }
  return {
    header: shown(document.querySelector('nav[data-fmp-nav]')),
    trainingLink: shown(byText('Sign In here')),
    separateLine: shown(byText('separate from training hub')),
    backHome: shown(byText('Back to Home')),
    form: shown(document.querySelector('input[type="password"]')),
    title: document.title,
  };
})()`;

(async () => {
  const browser = await chromium.launch();
  try {
    // On the app host /signin is rewritten to /modeling/signin; on localhost it is not.
    const url = `${BASE}${/localhost|127.0.0.1/.test(BASE) ? "/modeling/signin" : "/signin"}`;
    const tab = await browser.newPage();
    await tab.goto(url, { waitUntil: 'networkidle' });
    const t = await snapshot(tab);
    console.log(`tab:       ${JSON.stringify(t)}`);
    check('TAB: the website header is visible', t.header === true);
    check('TAB: the Training Hub sign-in link and its line are visible', t.trainingLink === true && t.separateLine === true);
    check('TAB: "Back to Home" is visible', t.backHome === true);
    check('TAB: the title is the page\'s own, not the app\'s', t.title !== 'Modeling Hub', String(t.title));

    // The installed window. Headless Chromium cannot emulate display-mode (measured
    // 2026-09-26: setEmulatedMedia leaves it "browser"), so this drives the OTHER
    // half of the one detection rule, the one an iPhone home-screen app takes:
    // navigator.standalone === true before any page script runs. That exercises the
    // real client, the attribute and the SAME hiding selectors; the display-mode
    // media query around those selectors is pinned by verify-pwa H1/H2.
    const app = await browser.newPage();
    await app.addInitScript("Object.defineProperty(navigator, 'standalone', { get: function () { return true; } })");
    await app.goto(url, { waitUntil: 'networkidle' });
    const flagged = await app.evaluate("document.documentElement.hasAttribute('data-installed-app')");
    check('the installed-window path ran (the client marked <html>)', flagged === true);
    await app.waitForFunction("document.title === 'Modeling Hub'", null, { timeout: 5000 }).catch(() => undefined);
    const a = await snapshot(app);
    console.log(`installed: ${JSON.stringify(a)}`);
    check('INSTALLED: the website header is hidden', a.header === false);
    check('INSTALLED: the Training Hub sign-in link and its line are hidden', a.trainingLink === false && a.separateLine === false);
    check('INSTALLED: "Back to Home" is hidden', a.backHome === false);
    check('INSTALLED: the sign-in form is still there', a.form === true);
    check('INSTALLED: the window title is "Modeling Hub"', a.title === 'Modeling Hub', String(a.title));
  } finally {
    await browser.close();
  }
  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
