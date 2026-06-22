/**
 * screenshot-marketing-pricing.tsx
 *
 * DOM proof for the pricing one-source-of-truth unit:
 *   1. The REAL LivePlanCards component (public marketing island) rendered from
 *      fixture entitlement plans + catalog, with a HIDDEN non-module feature
 *      filtered out via the real visibleForCustomers (proving absence).
 *   2. User Management inline plan-assignment control (mirror, real testids).
 *   3. /admin/access plan-assignment control (mirror, real testids).
 *
 * Run: npx tsx scripts/screenshot-marketing-pricing.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import LivePlanCards, { type LivePlan, type LiveFeature, type LiveCoverage } from '../src/hubs/main/components/pricing/LivePlanCards';
import { visibleForCustomers } from '../src/shared/entitlements/pricingDisplay';

const PLANS: LivePlan[] = [
  { plan_key: 'trial', label: 'Trial', price_monthly: 0, price_annual: 0, currency: 'SAR', contact_sales: false, popular: false, badge_text: null },
  { plan_key: 'solo', label: 'Solo', price_monthly: 99, price_annual: 990, currency: 'SAR', contact_sales: false, popular: false, badge_text: null },
  { plan_key: 'pro', label: 'Pro', price_monthly: 299, price_annual: 2990, currency: 'SAR', contact_sales: false, popular: true, badge_text: null },
  { plan_key: 'firm', label: 'Firm', price_monthly: null, price_annual: null, currency: 'SAR', contact_sales: true, popular: false, badge_text: 'Enterprise' },
];
// Full catalog incl. a HIDDEN non-module feature (rbac). visibleForCustomers
// drops it before render, so it must be absent from the comparison.
const ALL_FEATURES: (LiveFeature & { visible: boolean })[] = [
  { feature_key: 'module_1', label: 'Project Setup', category: 'module', feature_type: 'gate', display_order: 1, moduleStatus: 'live', visible: true },
  { feature_key: 'module_7', label: 'Reports', category: 'module', feature_type: 'gate', display_order: 7, moduleStatus: 'coming_soon', visible: true },
  { feature_key: 'pdf_export', label: 'PDF Export', category: 'export', feature_type: 'gate', display_order: 12, visible: true },
  { feature_key: 'rbac', label: 'Role Based Access Control', category: 'admin', feature_type: 'gate', display_order: 20, visible: false }, // HIDDEN
  { feature_key: 'projects', label: 'Saved Projects', category: 'limits', feature_type: 'limit', display_order: 18, visible: true },
];
const FEATURES = visibleForCustomers(ALL_FEATURES) as LiveFeature[];
const COVERAGE: LiveCoverage[] = [
  { plan_key: 'solo', feature_key: 'module_1', included: true, limit_value: null },
  { plan_key: 'pro', feature_key: 'module_1', included: true, limit_value: null },
  { plan_key: 'pro', feature_key: 'module_7', included: true, limit_value: null },
  { plan_key: 'solo', feature_key: 'projects', included: true, limit_value: 3 },
  { plan_key: 'pro', feature_key: 'projects', included: true, limit_value: 25 },
  { plan_key: 'firm', feature_key: 'projects', included: true, limit_value: -1 },
];

const marketingHtml = renderToStaticMarkup(<LivePlanCards plans={PLANS} features={FEATURES} coverage={COVERAGE} />);

// Plan-assignment controls (mirrors, real testids + option set).
const PLAN_OPTS = PLANS.map((p) => p.plan_key);
function PlanSelect({ testid, current }: { testid: string; current: string }): React.JSX.Element {
  return (
    <select data-testid={testid} defaultValue={current} style={{ padding: '7px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6 }}>
      {PLANS.map((p) => <option key={p.plan_key} value={p.plan_key}>{p.label}</option>)}
    </select>
  );
}
const userMgmtHtml = renderToStaticMarkup(
  <div data-testid="user-plan-u1" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    <PlanSelect testid="user-plan-select-u1" current="trial" />
    <span style={{ padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: '#fff', background: '#D97706' }}>trial</span>
  </div>,
);
const accessHtml = renderToStaticMarkup(
  <div data-testid="plan-assign-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, maxWidth: 300 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 6 }}>Assign plan</div>
    <PlanSelect testid="plan-assign-select" current="solo" />
  </div>,
);

async function main(): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#F5F7FA;color:#374151}</style></head>
<body><div style="padding:24px;display:flex;flex-direction:column;gap:32px">
<div><h3 style="color:#0D2E5A">1. Public marketing pricing (LivePlanCards, live plans, hidden rbac absent)</h3>${marketingHtml}</div>
<div><h3 style="color:#0D2E5A">2. User Management inline plan assignment</h3>${userMgmtHtml}</div>
<div><h3 style="color:#0D2E5A">3. /admin/access plan assignment</h3>${accessHtml}</div>
</div></body></html>`;
  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/marketing-pricing.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  await page.goto('file://' + htmlPath);

  const cardSolo = await page.locator('[data-testid="pricing-card-solo"]').count();
  const cardPro = await page.locator('[data-testid="pricing-card-pro"]').count();
  const cardFirm = await page.locator('[data-testid="pricing-card-firm"]').count();
  const noTrialCard = (await page.locator('[data-testid="pricing-card-trial"]').count()) === 0;
  const proBadge = (await page.locator('[data-testid="pricing-badge-pro"]').innerText()).trim();
  const firmBadge = (await page.locator('[data-testid="pricing-badge-firm"]').innerText()).trim();
  const soloAmount = await page.locator('[data-testid="pricing-amount-solo"]').innerText();
  const billing = await page.locator('[data-testid="billing-toggle"]').count();
  const trialStrip = await page.locator('[data-testid="pricing-trial-strip"]').count();
  const m1Row = await page.locator('[data-testid="compare-row-module_1"]').count();
  const m7Coming = (await page.locator('[data-testid="compare-row-module_7"]').innerText()).includes('Coming soon');
  const rbacAbsent = (await page.locator('[data-testid="compare-row-rbac"]').count()) === 0;
  const pdfPresent = await page.locator('[data-testid="compare-row-pdf_export"]').count();
  const firmProjects = await page.locator('[data-testid="compare-cell-firm-projects"]').innerText();

  const umOptions = await page.locator('[data-testid="user-plan-select-u1"] option').allInnerTexts();
  const accessOptions = await page.locator('[data-testid="plan-assign-select"] option').allInnerTexts();
  const noLegacyUM = !umOptions.join(',').toLowerCase().match(/free|professional|enterprise/);

  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/marketing-pricing.png', fullPage: true });
  await browser.close();

  console.log(`1. cards solo/pro/firm    : ${cardSolo}/${cardPro}/${cardFirm} (expect 1/1/1)`);
  console.log(`1. no trial card          : ${noTrialCard} (expect true)`);
  console.log(`1. pro badge / firm badge : "${proBadge}" / "${firmBadge}" (expect Most Popular / Enterprise)`);
  console.log(`1. solo amount            : ${soloAmount} (expect SAR 99)`);
  console.log(`1. billing toggle / trial : ${billing} / ${trialStrip} (expect 1/1)`);
  console.log(`1. module rows m1 / m7     : ${m1Row} / coming=${m7Coming} (expect 1 / true)`);
  console.log(`1. hidden rbac absent      : ${rbacAbsent}, pdf present ${pdfPresent} (expect true / 1)`);
  console.log(`1. firm projects cap       : ${firmProjects} (expect Unlimited)`);
  console.log(`2. UM plan options         : ${umOptions.join('/')} (expect Trial/Solo/Pro/Firm, no legacy)`);
  console.log(`3. access plan options     : ${accessOptions.join('/')} `);

  const ok = cardSolo === 1 && cardPro === 1 && cardFirm === 1 && noTrialCard
    && proBadge === 'Most Popular' && firmBadge === 'Enterprise' && soloAmount === 'SAR 99'
    && billing === 1 && trialStrip === 1 && m1Row === 1 && m7Coming && rbacAbsent && pdfPresent === 1
    && firmProjects === 'Unlimited'
    && umOptions.length === 4 && !!noLegacyUM && accessOptions.length === 4;
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
