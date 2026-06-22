/**
 * screenshot-user-overrides.tsx
 *
 * DOM screenshot proof for the per-user override screen (Phase C). Renders the
 * REAL resolver (resolveEffectiveFeatures) output for a real-style user with one
 * GRANT (module_7, coming soon, not in plan) and one REVOKE (pdf_export, in
 * plan) over the SAME merged module + catalog list the Plan Builder uses, then
 * screenshots a faithful copy of the page's effective table and asserts the DOM:
 * grant shows Yes/override, revoke shows No/override, plan rows show via plan,
 * the hidden module is absent, and coming-soon is tagged.
 *
 * Run: npx tsx scripts/screenshot-user-overrides.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { deriveModuleFeatureRows, formatLimit, type LiveModuleInput } from '../src/shared/entitlements/moduleCatalog';
import {
  resolveEffectiveFeatures,
  type ResolveFeature,
  type PlanCell,
  type UserOverride,
} from '../src/shared/entitlements/resolveOverrides';

// Same live registry shape the Plan Builder proof uses: market-data hidden,
// reports/portfolio coming soon. Proves the module list mirrors live.
const liveModules: LiveModuleInput[] = [
  { slug: 'project-setup', number: 1,  name: 'Project Setup', short_name: 'Project Setup', status: 'live',        display_order: 1 },
  { slug: 'revenue',       number: 2,  name: 'Revenue',       short_name: 'Revenue',       status: 'live',        display_order: 2 },
  { slug: 'opex',          number: 3,  name: 'Operating Exp', short_name: 'Operating Expenses', status: 'live',   display_order: 3 },
  { slug: 'financials',    number: 4,  name: 'Financials',    short_name: 'Financial Statements', status: 'live', display_order: 4 },
  { slug: 'returns',       number: 5,  name: 'Returns',       short_name: 'Returns & Valuation', status: 'live',  display_order: 5 },
  { slug: 'scenarios',     number: 6,  name: 'Scenarios',     short_name: 'Scenario Analysis', status: 'live',    display_order: 6 },
  { slug: 'reports',       number: 7,  name: 'Reports',       short_name: 'Reports',       status: 'coming_soon', display_order: 7 },
  { slug: 'portfolio',     number: 8,  name: 'Portfolio',     short_name: 'Portfolio',     status: 'coming_soon', display_order: 8 },
  { slug: 'market-data',   number: 9,  name: 'Market Data',   short_name: 'Market Data',   status: 'hidden',      display_order: 9 },
  { slug: 'collaborate',   number: 10, name: 'Collaborate',   short_name: 'Collaborate',   status: 'pro',         display_order: 10 },
  { slug: 'api-access',    number: 11, name: 'API Access',    short_name: 'API Access',    status: 'enterprise',  display_order: 11 },
];
const moduleRows = deriveModuleFeatureRows(liveModules) as unknown as ResolveFeature[];

const nonModule: ResolveFeature[] = [
  { feature_key: 'pdf_export',    label: 'PDF Export',              category: 'export',   feature_type: 'gate',  display_order: 12 },
  { feature_key: 'excel_formula', label: 'Excel (formula linked)',  category: 'export',   feature_type: 'gate',  display_order: 14 },
  { feature_key: 'projects',      label: 'Saved Projects',          category: 'limits',   feature_type: 'limit', display_order: 18 },
];
const features: ResolveFeature[] = [...moduleRows, ...nonModule];

// Solo-like plan coverage: modules 1-6 + pdf_export, projects=3.
const planCells = new Map<string, PlanCell>([
  ['module_1', { included: true, limit_value: null }],
  ['module_2', { included: true, limit_value: null }],
  ['module_3', { included: true, limit_value: null }],
  ['module_4', { included: true, limit_value: null }],
  ['module_5', { included: true, limit_value: null }],
  ['module_6', { included: true, limit_value: null }],
  ['pdf_export', { included: true, limit_value: null }],
  ['projects', { included: true, limit_value: 3 }],
]);

// The brief's test case: one GRANT (module_7), one REVOKE (pdf_export), plus a
// limit override (projects -> 25) to show a cap change.
const overrides: UserOverride[] = [
  { feature_key: 'module_7', mode: 'grant', override_value: null, reason: 'beta access', expires_at: null },
  { feature_key: 'pdf_export', mode: 'revoke', override_value: null, reason: 'billing hold', expires_at: null },
  { feature_key: 'projects', mode: 'grant', override_value: 25, reason: 'power user', expires_at: null },
];

const NOW = Date.parse('2026-06-22T00:00:00Z');
const resolved = resolveEffectiveFeatures(features, planCells, overrides, NOW);

const MODULE_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  live: { label: 'Live', bg: '#dcfce7', fg: '#166534' },
  coming_soon: { label: 'Coming soon', bg: '#fef3c7', fg: '#92400e' },
  pro: { label: 'Pro', bg: '#ede9fe', fg: '#6d28d9' },
  enterprise: { label: 'Enterprise', bg: '#e0e7ff', fg: '#3730a3' },
};

function Table(): React.JSX.Element {
  const rows: React.JSX.Element[] = [];
  let lastCat = '';
  for (const r of resolved) {
    if (r.category !== lastCat) {
      lastCat = r.category;
      rows.push(
        <tr key={`cat-${r.category}`}><td colSpan={3} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#475569', background: '#f1f5f9' }}>{r.category}</td></tr>,
      );
    }
    const mod = r.moduleStatus ? MODULE_TAG[r.moduleStatus] : null;
    rows.push(
      <tr key={r.feature_key} data-testid={`resolved-row-${r.feature_key}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
        <td style={{ padding: '8px 12px', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            {mod && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: mod.bg, color: mod.fg }}>{mod.label}</span>}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.feature_key} ({r.feature_type})</div>
        </td>
        <td style={{ padding: '8px 12px', fontSize: 12 }} data-testid={`effective-${r.feature_key}`} data-included={String(r.included)} data-source={r.source}>
          {r.feature_type === 'limit'
            ? <span style={{ fontWeight: 700, color: r.included ? '#166534' : '#94a3b8' }}>{r.included ? formatLimit(r.value) : 'none'}</span>
            : <span style={{ fontWeight: 700, color: r.included ? '#166534' : '#b91c1c' }}>{r.included ? 'Yes' : 'No'}</span>}
          <span style={{ display: 'block', fontSize: 9, color: r.source === 'override' ? '#6d28d9' : '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>via {r.source}</span>
        </td>
        <td style={{ padding: '8px 12px', fontSize: 11, color: '#334155' }}>
          {r.override ? <b style={{ color: r.override.mode === 'grant' ? '#166534' : '#b91c1c' }}>{r.override.mode}{r.override.override_value !== null ? ` = ${formatLimit(r.override.override_value)}` : ''}</b> : ''}
        </td>
      </tr>,
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }} data-testid="resolved-table">
      <thead><tr style={{ background: '#f8fafc' }}>{['Feature', 'Effective', 'Override'].map((h) => <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#475569', textAlign: 'left' }}>{h}</th>)}</tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

async function main(): Promise<void> {
  const markup = renderToStaticMarkup(<Table />);
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:Inter,system-ui,sans-serif;margin:24px;background:#F4F7FC;color:#0f172a}</style></head>
<body>
<h2 style="color:#0D2E5A">User Access, effective entitlements (Solo plan + 1 grant + 1 revoke + 1 limit override)</h2>
<p style="font-size:13px;color:#475569">user: solo.user@example.com &middot; plan: solo/active</p>
${markup}</body></html>`;

  mkdirSync('scripts/.tmp', { recursive: true });
  const htmlPath = resolve('scripts/.tmp/user-overrides.html');
  writeFileSync(htmlPath, html, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await page.goto('file://' + htmlPath);

  const grantIncluded = await page.locator('[data-testid="effective-module_7"]').getAttribute('data-included');
  const grantSource = await page.locator('[data-testid="effective-module_7"]').getAttribute('data-source');
  const revokeIncluded = await page.locator('[data-testid="effective-pdf_export"]').getAttribute('data-included');
  const revokeSource = await page.locator('[data-testid="effective-pdf_export"]').getAttribute('data-source');
  const planModuleSource = await page.locator('[data-testid="effective-module_1"]').getAttribute('data-source');
  const limitText = await page.locator('[data-testid="effective-projects"]').innerText();
  const hiddenRows = await page.locator('[data-testid="resolved-row-module_9"]').count();
  const comingSoonTag = await page.locator('[data-testid="resolved-row-module_7"]').innerText();

  mkdirSync('docs/screenshots', { recursive: true });
  await page.locator('[data-testid="resolved-table"]').screenshot({ path: 'docs/screenshots/user-overrides.png' });
  await browser.close();

  console.log(`grant module_7 included : ${grantIncluded} via ${grantSource} (expect true / override)`);
  console.log(`revoke pdf_export incl. : ${revokeIncluded} via ${revokeSource} (expect false / override)`);
  console.log(`plan module_1 source    : ${planModuleSource} (expect plan)`);
  console.log(`limit projects effective: ${limitText.split('\n')[0]} (expect 25)`);
  console.log(`hidden module_9 rows    : ${hiddenRows} (expect 0)`);
  console.log(`coming-soon tag present : ${comingSoonTag.includes('Coming soon')} (expect true)`);

  const ok = grantIncluded === 'true' && grantSource === 'override'
    && revokeIncluded === 'false' && revokeSource === 'override'
    && planModuleSource === 'plan'
    && limitText.includes('25')
    && hiddenRows === 0
    && comingSoonTag.includes('Coming soon');
  console.log(ok ? '\n=== SCREENSHOT PROOF: PASS ===' : '\n=== SCREENSHOT PROOF: FAIL ===');
  process.exit(ok ? 0 : 1);
}

void main();
