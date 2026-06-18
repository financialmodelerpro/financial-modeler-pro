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

// 23 features in seed order (mirrors migration 158 features_registry seed).
const features: MatrixFeature[] = [
  { feature_key: 'module_1',  label: 'Module 1: Project Setup and Financial Structure', category: 'module',   feature_type: 'gate',  build_status: 'live',           display_order: 1 },
  { feature_key: 'module_2',  label: 'Module 2: Revenue and Sales Projections',         category: 'module',   feature_type: 'gate',  build_status: 'in_development', display_order: 2 },
  { feature_key: 'module_3',  label: 'Module 3: Operating Expenses',                    category: 'module',   feature_type: 'gate',  build_status: 'in_development', display_order: 3 },
  { feature_key: 'module_4',  label: 'Module 4: Financial Statements',                  category: 'module',   feature_type: 'gate',  build_status: 'in_development', display_order: 4 },
  { feature_key: 'module_5',  label: 'Module 5: Returns and Valuation Analysis',        category: 'module',   feature_type: 'gate',  build_status: 'in_development', display_order: 5 },
  { feature_key: 'module_6',  label: 'Module 6: Scenario Analysis',                     category: 'module',   feature_type: 'gate',  build_status: 'live',           display_order: 6 },
  { feature_key: 'module_7',  label: 'Module 7: Reports and Visualizations',            category: 'module',   feature_type: 'gate',  build_status: 'needs_build',    display_order: 7 },
  { feature_key: 'module_8',  label: 'Module 8: Portfolio',                             category: 'module',   feature_type: 'gate',  build_status: 'needs_build',    display_order: 8 },
  { feature_key: 'module_9',  label: 'Module 9: Market Data',                           category: 'module',   feature_type: 'gate',  build_status: 'needs_build',    display_order: 9 },
  { feature_key: 'module_10', label: 'Module 10: Collaborate',                          category: 'module',   feature_type: 'gate',  build_status: 'needs_build',    display_order: 10 },
  { feature_key: 'module_11', label: 'Module 11: API Access',                           category: 'module',   feature_type: 'gate',  build_status: 'needs_build',    display_order: 11 },
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
  const markup = renderToStaticMarkup(
    React.createElement(PlanMatrix, { features, plans, cell: cellOf, readOnly: true }),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:24px;background:#F4F7FC;color:#0f172a}</style></head>
<body><h2 style="color:#0D2E5A">Admin Plan Builder matrix: Trial / Solo / Pro / Firm, 23 features</h2>${markup}</body></html>`;

  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/plan-matrix.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 1500 } });
  await page.goto('file://' + htmlPath);

  const planCols = await page.locator('[data-testid^="plan-col-"]').count();
  const featureRows = await page.locator('[data-testid^="feature-row-"]').count();
  const buildTags = await page.locator('[data-testid^="build-status-"]').count();
  const checkedFirmM11 = await page.locator('[data-testid="cell-firm-module_11"]').isChecked();
  const trialM7 = await page.locator('[data-testid="cell-trial-module_7"]').isChecked();
  const firmProjects = await page.locator('[data-testid="cell-firm-projects"]').inputValue();

  mkdirSync('docs/screenshots', { recursive: true });
  await page.locator('[data-testid="plan-matrix"]').screenshot({ path: 'docs/screenshots/plan-builder-matrix.png' });
  await browser.close();

  console.log(`plan columns      : ${planCols} (expect 4)`);
  console.log(`feature rows      : ${featureRows} (expect 23)`);
  console.log(`build_status tags : ${buildTags} (expect 23)`);
  console.log(`firm module_11    : ${checkedFirmM11} (expect true)`);
  console.log(`trial module_7    : ${trialM7} (expect false)`);
  console.log(`firm projects cap : ${firmProjects} (expect -1)`);

  const ok = planCols === 4 && featureRows === 23 && buildTags === 23 && checkedFirmM11 === true && trialM7 === false && firmProjects === '-1';
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
