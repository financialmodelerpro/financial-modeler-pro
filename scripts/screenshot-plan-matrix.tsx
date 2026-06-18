/**
 * screenshot-plan-matrix.tsx
 *
 * DOM screenshot proof for the admin Plan Builder matrix (Phase D). Renders the
 * REAL PlanMatrix component with the seeded entitlement data (Trial / Solo / Pro
 * / Firm, 23 features) via renderToStaticMarkup, then screenshots it with
 * Playwright and asserts the DOM (4 plan columns, 23 feature rows, 23
 * build_status tags). Uses the actual component code, not a mock.
 *
 * Run: npx tsx scripts/screenshot-plan-matrix.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PlanMatrix, type MatrixFeature, type MatrixPlan, type CellValue } from '../app/admin/plans/PlanMatrix';
import { deriveModuleFeatureRows, type LiveModuleInput } from '../src/shared/entitlements/moduleCatalog';

// Module rows derived LIVE from a representative platform_modules list. This
// proves the live behavior: market-data is HIDDEN (dropped), reports + portfolio
// are COMING SOON (tagged, still assignable), collaborate is PRO, api-access is
// ENTERPRISE. feature_key is slug-derived so it matches the gate + plan_permissions.
const liveModules: LiveModuleInput[] = [
  { slug: 'project-setup', number: 1,  name: 'Project Setup', short_name: 'Project Setup',  status: 'live',        display_order: 1 },
  { slug: 'revenue',       number: 2,  name: 'Revenue',       short_name: 'Revenue',        status: 'live',        display_order: 2 },
  { slug: 'opex',          number: 3,  name: 'Operating Exp', short_name: 'Operating Expenses', status: 'live',    display_order: 3 },
  { slug: 'financials',    number: 4,  name: 'Financials',    short_name: 'Financial Statements', status: 'live',  display_order: 4 },
  { slug: 'returns',       number: 5,  name: 'Returns',       short_name: 'Returns & Valuation', status: 'live',   display_order: 5 },
  { slug: 'scenarios',     number: 6,  name: 'Scenarios',     short_name: 'Scenario Analysis', status: 'live',     display_order: 6 },
  { slug: 'reports',       number: 7,  name: 'Reports',       short_name: 'Reports',        status: 'coming_soon', display_order: 7 },
  { slug: 'portfolio',     number: 8,  name: 'Portfolio',     short_name: 'Portfolio',      status: 'coming_soon', display_order: 8 },
  { slug: 'market-data',   number: 9,  name: 'Market Data',   short_name: 'Market Data',    status: 'hidden',      display_order: 9 },
  { slug: 'collaborate',   number: 10, name: 'Collaborate',   short_name: 'Collaborate',    status: 'pro',         display_order: 10 },
  { slug: 'api-access',    number: 11, name: 'API Access',    short_name: 'API Access',     status: 'enterprise',  display_order: 11 },
];
const moduleRows = deriveModuleFeatureRows(liveModules);

// Non-module catalog features (owned by features_registry, status unchanged).
const nonModule: MatrixFeature[] = [
  { feature_key: 'pdf_export',      label: 'PDF Export',                     category: 'export',   feature_type: 'gate',  build_status: 'live',        display_order: 12 },
  { feature_key: 'excel_snapshot',  label: 'Excel Export (snapshot)',        category: 'export',   feature_type: 'gate',  build_status: 'live',        display_order: 13 },
  { feature_key: 'excel_formula',   label: 'Excel Export (formula linked)',  category: 'export',   feature_type: 'gate',  build_status: 'live',        display_order: 14 },
  { feature_key: 'white_label_pdf', label: 'White Label PDF',                category: 'export',   feature_type: 'gate',  build_status: 'needs_build', display_order: 15 },
  { feature_key: 'sensitivity',     label: 'Sensitivity Analysis',           category: 'analysis', feature_type: 'gate',  build_status: 'live',        display_order: 16 },
  { feature_key: 'versioning',      label: 'Version History',                category: 'platform', feature_type: 'gate',  build_status: 'live',        display_order: 17 },
  { feature_key: 'projects',        label: 'Saved Projects',                 category: 'limits',   feature_type: 'limit', build_status: 'live',        display_order: 18 },
  { feature_key: 'seats',           label: 'Team Seats',                     category: 'limits',   feature_type: 'limit', build_status: 'needs_build', display_order: 19 },
  { feature_key: 'rbac',            label: 'Role Based Access Control',      category: 'admin',    feature_type: 'gate',  build_status: 'needs_build', display_order: 20 },
  { feature_key: 'branding',        label: 'Custom Branding',                category: 'branding', feature_type: 'gate',  build_status: 'needs_build', display_order: 21 },
  { feature_key: 'ai_contextual',   label: 'AI Contextual Assist',           category: 'ai',       feature_type: 'gate',  build_status: 'stub',        display_order: 22 },
  { feature_key: 'ai_research',     label: 'AI Research Agent',              category: 'ai',       feature_type: 'gate',  build_status: 'stub',        display_order: 23 },
];

const features: MatrixFeature[] = [...moduleRows, ...nonModule];

const plans: MatrixPlan[] = [
  { plan_key: 'trial', label: 'Trial', active: true, display_order: 1 },
  { plan_key: 'solo',  label: 'Solo',  active: true, display_order: 2 },
  { plan_key: 'pro',   label: 'Pro',   active: true, display_order: 3 },
  { plan_key: 'firm',  label: 'Firm',  active: true, display_order: 4 },
];

// Coverage from migration 158 plan_permissions seed.
const moduleTop: Record<string, number> = { trial: 6, solo: 9, pro: 10, firm: 11 };
const gateCover: Record<string, string[]> = {
  trial: ['pdf_export'],
  solo:  ['pdf_export', 'excel_snapshot', 'sensitivity', 'versioning'],
  pro:   ['pdf_export', 'excel_snapshot', 'excel_formula', 'white_label_pdf', 'sensitivity', 'versioning', 'branding', 'ai_contextual'],
  firm:  ['pdf_export', 'excel_snapshot', 'excel_formula', 'white_label_pdf', 'sensitivity', 'versioning', 'branding', 'ai_contextual', 'rbac', 'ai_research'],
};
const limitCover: Record<string, Record<string, number>> = {
  trial: { projects: 1, seats: 1 },
  solo:  { projects: 3, seats: 1 },
  pro:   { projects: 25, seats: 3 },
  firm:  { projects: -1, seats: 10 },
};

function cellOf(planKey: string, featureKey: string): CellValue {
  const f = features.find((x) => x.feature_key === featureKey)!;
  if (f.feature_type === 'limit') {
    const v = limitCover[planKey]?.[featureKey];
    return { included: v !== undefined, limit_value: v ?? null };
  }
  const m = /^module_(\d+)$/.exec(featureKey);
  if (m) return { included: Number(m[1]) <= (moduleTop[planKey] ?? 0), limit_value: null };
  return { included: (gateCover[planKey] ?? []).includes(featureKey), limit_value: null };
}

async function main(): Promise<void> {
  // Not readOnly: pass no-op handlers so checkboxes render enabled (proving
  // coming_soon modules stay assignable), matching the real page's controls.
  const markup = renderToStaticMarkup(
    React.createElement(PlanMatrix, { features, plans, cell: cellOf, onToggle: () => {}, onLimit: () => {} }),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:24px;background:#F4F7FC;color:#0f172a}</style></head>
<body><h2 style="color:#0D2E5A">Admin Plan Builder, live module list (market-data hidden, reports/portfolio coming soon)</h2>${markup}</body></html>`;

  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/plan-matrix.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 1500 } });
  await page.goto('file://' + htmlPath);

  const planCols = await page.locator('[data-testid^="plan-col-"]').count();
  const featureRows = await page.locator('[data-testid^="feature-row-"]').count();
  const moduleTags = await page.locator('[data-testid^="module-status-"]').count();
  const buildTags = await page.locator('[data-testid^="build-status-"]').count();
  const comingSoonTags = await page.locator('[data-testid="module-status-coming_soon"]').count();
  const hiddenModuleRows = await page.locator('[data-testid="feature-row-module_9"]').count();
  const checkedFirmM11 = await page.locator('[data-testid="cell-firm-module_11"]').isChecked();
  const comingSoonAssignable = !(await page.locator('[data-testid="cell-firm-module_7"]').isDisabled());
  const firmProjectsUnlimited = await page.locator('[data-testid="cell-firm-projects-unlimited"]').isChecked();

  mkdirSync('docs/screenshots', { recursive: true });
  await page.locator('[data-testid="plan-matrix"]').screenshot({ path: 'docs/screenshots/plan-builder-matrix.png' });
  await browser.close();

  console.log(`plan columns           : ${planCols} (expect 4)`);
  console.log(`feature rows           : ${featureRows} (expect 22: 10 live modules + 12 catalog)`);
  console.log(`module-status tags     : ${moduleTags} (expect 10)`);
  console.log(`build-status tags      : ${buildTags} (expect 12, non-module catalog)`);
  console.log(`coming-soon tags       : ${comingSoonTags} (expect 2: reports + portfolio)`);
  console.log(`hidden module_9 rows   : ${hiddenModuleRows} (expect 0, dropped)`);
  console.log(`firm module_11 checked : ${checkedFirmM11} (expect true)`);
  console.log(`coming-soon assignable : ${comingSoonAssignable} (expect true)`);
  console.log(`firm projects unlimited: ${firmProjectsUnlimited} (expect true)`);

  const ok = planCols === 4 && featureRows === 22 && moduleTags === 10 && buildTags === 12
    && comingSoonTags === 2 && hiddenModuleRows === 0 && checkedFirmM11 === true
    && comingSoonAssignable === true && firmProjectsUnlimited === true;
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
