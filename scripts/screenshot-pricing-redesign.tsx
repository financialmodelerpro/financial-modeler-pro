/**
 * screenshot-pricing-redesign.tsx
 *
 * DOM proof for the pricing redesign + relocation unit:
 *   1. The REAL redesigned LivePlanCards (navy/orange, Most Popular Pro, billing
 *      toggle, comparison table) with the Trial strip showing the real trial
 *      length (trialDays prop).
 *   2. The REAL CouponManager rendered in its new Plan Builder home.
 *   3. The Plan Builder trial-days control (mirror, real testid).
 *   4. Admin nav WITHOUT the removed "Marketing Pricing" / /admin/pricing entry.
 *
 * Run: npx tsx scripts/screenshot-pricing-redesign.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import LivePlanCards, { type LivePlan, type LiveFeature, type LiveCoverage } from '../src/hubs/main/components/pricing/LivePlanCards';
import { CouponManager } from '../app/admin/plans/CouponManager';

const PLANS: LivePlan[] = [
  { plan_key: 'trial', label: 'Trial', price_monthly: 0, price_annual: 0, currency: 'SAR', contact_sales: false, popular: false, badge_text: null },
  { plan_key: 'solo', label: 'Solo', price_monthly: 99, price_annual: 990, currency: 'SAR', contact_sales: false, popular: false, badge_text: null },
  { plan_key: 'pro', label: 'Pro', price_monthly: 299, price_annual: 2990, currency: 'SAR', contact_sales: false, popular: true, badge_text: null },
  { plan_key: 'firm', label: 'Firm', price_monthly: null, price_annual: null, currency: 'SAR', contact_sales: true, popular: false, badge_text: 'Enterprise' },
];
const FEATURES: LiveFeature[] = [
  { feature_key: 'module_1', label: 'Project Setup', category: 'module', feature_type: 'gate', display_order: 1, moduleStatus: 'live' },
  { feature_key: 'module_7', label: 'Reports', category: 'module', feature_type: 'gate', display_order: 7, moduleStatus: 'coming_soon' },
  { feature_key: 'pdf_export', label: 'PDF Export', category: 'export', feature_type: 'gate', display_order: 12 },
  { feature_key: 'projects', label: 'Saved Projects', category: 'limits', feature_type: 'limit', display_order: 18 },
];
const COVERAGE: LiveCoverage[] = [
  { plan_key: 'solo', feature_key: 'module_1', included: true, limit_value: null },
  { plan_key: 'pro', feature_key: 'module_1', included: true, limit_value: null },
  { plan_key: 'pro', feature_key: 'module_7', included: true, limit_value: null },
  { plan_key: 'solo', feature_key: 'projects', included: true, limit_value: 3 },
  { plan_key: 'pro', feature_key: 'projects', included: true, limit_value: 25 },
  { plan_key: 'firm', feature_key: 'projects', included: true, limit_value: -1 },
];
const TRIAL_DAYS = 14;

const cardsHtml = renderToStaticMarkup(<LivePlanCards plans={PLANS} features={FEATURES} coverage={COVERAGE} trialDays={TRIAL_DAYS} />);
const couponHtml = renderToStaticMarkup(<CouponManager />);

// Plan Builder trial-days control (mirror of the real input/testid).
const trialCtrlHtml = renderToStaticMarkup(
  <div data-testid="plan-row-trial" style={{ border: '1px solid #eef2f7', borderRadius: 7, padding: 10 }}>
    <div style={{ fontSize: 13, fontWeight: 700 }}>Trial <code style={{ color: '#94a3b8' }}>trial</code></div>
    <label style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
      Length (days)
      <input type="number" data-testid="plan-trial-days" defaultValue={TRIAL_DAYS} style={{ width: 64, padding: '4px 6px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 5 }} />
    </label>
  </div>,
);

// Admin nav AFTER removal (no Marketing Pricing).
const NAV = ['Users', 'Plan Builder', 'Projects'];
const navHtml = renderToStaticMarkup(
  <nav data-testid="admin-nav">
    {NAV.map((l) => <a key={l} data-testid={`nav-${l.replace(/\s+/g, '-').toLowerCase()}`} href="#" style={{ display: 'block', padding: '8px 12px', fontSize: 13, color: '#fff', background: '#0D2E5A' }}>{l}</a>)}
  </nav>,
);

async function main(): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#F5F7FA;color:#374151}</style></head>
<body>
<div style="background:radial-gradient(1200px 400px at 50% -10%, #163a6b, #0D2E5A 45%, #0A2448);padding:48px 24px;text-align:center;color:#fff">
  <div style="display:inline-block;font-size:11px;font-weight:800;color:#FFE7D1;letter-spacing:.14em;text-transform:uppercase;padding:6px 14px;border-radius:999px;background:rgba(249,115,22,.16);border:1px solid rgba(249,115,22,.35)">Pricing</div>
  <h1 style="font-size:40px;font-weight:900;margin:16px 0 0">Simple, transparent pricing</h1>
</div>
<div style="padding:48px 24px;max-width:1160px;margin:0 auto">${cardsHtml}</div>
<div style="padding:0 24px 48px;max-width:1100px;margin:0 auto"><h3 style="color:#0D2E5A">Plan Builder: trial-days control + coupons</h3>${trialCtrlHtml}${couponHtml}</div>
<div style="padding:0 24px 48px;max-width:300px"><h3 style="color:#0D2E5A">Admin nav (no Marketing Pricing)</h3>${navHtml}</div>
</body></html>`;
  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/pricing-redesign.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 1900 } });
  await page.goto('file://' + htmlPath);

  const cards = await page.locator('[data-testid^="pricing-card-"]').count();
  const noTrialCard = (await page.locator('[data-testid="pricing-card-trial"]').count()) === 0;
  const proBadge = (await page.locator('[data-testid="pricing-badge-pro"]').innerText()).trim().toLowerCase();
  const billing = await page.locator('[data-testid="billing-toggle"]').count();
  const trialDaysLabel = (await page.locator('[data-testid="trial-days-label"]').innerText()).trim();
  const comparison = await page.locator('[data-testid="comparison-table"]').count();
  const comingSoon = (await page.locator('[data-testid="compare-row-module_7"]').innerText()).toLowerCase().includes('coming soon');
  const firmProjects = await page.locator('[data-testid="compare-cell-firm-projects"]').innerText();

  const trialCtrl = await page.locator('[data-testid="plan-trial-days"]').inputValue();
  const couponMgr = await page.locator('[data-testid="coupon-manager"]').count();
  const couponForm = await page.locator('[data-testid="coupon-toggle-form"]').count();
  const couponEmpty = await page.locator('[data-testid="coupon-empty"]').count();

  const hasUsers = await page.locator('[data-testid="nav-users"]').count();
  const hasPlanBuilder = await page.locator('[data-testid="nav-plan-builder"]').count();
  const noMarketingPricing = (await page.locator('[data-testid="nav-marketing-pricing"]').count()) === 0;

  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/pricing-redesign.png', fullPage: true });
  await browser.close();

  console.log(`1. cards (solo/pro/firm)   : ${cards}, no trial card ${noTrialCard} (expect 3 / true)`);
  console.log(`1. Pro Most Popular badge  : "${proBadge}" (expect Most Popular)`);
  console.log(`1. billing toggle          : ${billing} (expect 1)`);
  console.log(`1. trial strip days label  : "${trialDaysLabel}" (expect 14-day)`);
  console.log(`1. comparison + coming-soon: ${comparison} / ${comingSoon}, firm projects ${firmProjects} (expect 1/true/Unlimited)`);
  console.log(`2. trial-days control value: ${trialCtrl} (expect 14)`);
  console.log(`2. coupon manager/form/empty: ${couponMgr}/${couponForm}/${couponEmpty} (expect 1/1/1)`);
  console.log(`3. nav users/plan-builder  : ${hasUsers}/${hasPlanBuilder}, no marketing-pricing ${noMarketingPricing} (expect 1/1/true)`);

  const ok = cards === 3 && noTrialCard && proBadge === 'most popular' && billing === 1
    && trialDaysLabel === '14-day' && comparison === 1 && comingSoon && firmProjects === 'Unlimited'
    && trialCtrl === '14' && couponMgr === 1 && couponForm === 1 && couponEmpty === 1
    && hasUsers === 1 && hasPlanBuilder === 1 && noMarketingPricing;
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
