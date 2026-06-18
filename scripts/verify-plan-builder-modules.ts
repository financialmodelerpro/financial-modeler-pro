/**
 * verify-plan-builder-modules.ts
 *
 * Pure tests for the Plan Builder live-module derivation (deriveModuleFeatureRows)
 * and the Unlimited formatting. No DB: proves hide drops a row, coming_soon is
 * tagged + still a gate row, reorder follows display_order, feature_key stays
 * stable (slug-derived) across reorder/renumber, and -1 formats as Unlimited.
 *
 * Run: npx tsx scripts/verify-plan-builder-modules.ts
 */
import { deriveModuleFeatureRows, moduleFeatureKey, formatLimit, type LiveModuleInput } from '../src/shared/entitlements/moduleCatalog';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

// A representative live registry (with the scenario/reports swap reflected).
const base: LiveModuleInput[] = [
  { slug: 'project-setup', number: 1,  name: 'Project Setup',  short_name: 'Setup',       status: 'live',        display_order: 1 },
  { slug: 'revenue',       number: 2,  name: 'Revenue',        short_name: 'Revenue',     status: 'live',        display_order: 2 },
  { slug: 'opex',          number: 3,  name: 'Operating Exp',  short_name: 'OpEx',        status: 'live',        display_order: 3 },
  { slug: 'financials',    number: 4,  name: 'Financials',     short_name: 'Financials',  status: 'live',        display_order: 4 },
  { slug: 'returns',       number: 5,  name: 'Returns',        short_name: 'Returns',     status: 'live',        display_order: 5 },
  { slug: 'scenarios',     number: 6,  name: 'Scenarios',      short_name: 'Scenarios',   status: 'live',        display_order: 6 },
  { slug: 'reports',       number: 7,  name: 'Reports',        short_name: 'Reports',     status: 'coming_soon', display_order: 7 },
  { slug: 'portfolio',     number: 8,  name: 'Portfolio',      short_name: 'Portfolio',   status: 'coming_soon', display_order: 8 },
  { slug: 'market-data',   number: 9,  name: 'Market Data',    short_name: 'Market',      status: 'hidden',      display_order: 9 },
  { slug: 'collaborate',   number: 10, name: 'Collaborate',    short_name: 'Collaborate', status: 'pro',         display_order: 10 },
  { slug: 'api-access',    number: 11, name: 'API Access',     short_name: 'API',         status: 'enterprise',  display_order: 11 },
];

console.log('=== Plan Builder live-module derivation ===');

// Hide drops the row entirely.
const rows = deriveModuleFeatureRows(base);
check('hidden module (market-data) is dropped', !rows.some((r) => r.feature_key === 'module_9'), rows.map((r) => r.feature_key).join(','));
check('visible module count = 10 (11 minus 1 hidden)', rows.length === 10, String(rows.length));

// Coming soon is tagged and remains a gate row (assignable).
const reports = rows.find((r) => r.feature_key === 'module_7');
check('coming_soon module present with moduleStatus tag', !!reports && reports.moduleStatus === 'coming_soon');
check('coming_soon module is a gate row (assignable)', !!reports && reports.feature_type === 'gate');

// pro / enterprise modules still appear (visible, just gated).
check('pro module (collaborate -> module_10) appears', rows.some((r) => r.feature_key === 'module_10' && r.moduleStatus === 'pro'));
check('enterprise module (api-access -> module_11) appears', rows.some((r) => r.feature_key === 'module_11' && r.moduleStatus === 'enterprise'));

// feature_key is slug-derived and matches the gate keys module_1..module_11.
check('feature_key derived from slug (scenarios -> module_6)', moduleFeatureKey('scenarios', 6) === 'module_6');
check('feature_key stable even if number is wrong (scenarios number=7 still module_6)', moduleFeatureKey('scenarios', 7) === 'module_6');

// Reorder: move returns (component 5) to the front. Order follows display_order;
// feature_key stays module_5 (stable), only displayed position changes.
const reordered: LiveModuleInput[] = base.map((m) =>
  m.slug === 'returns' ? { ...m, display_order: 0 } : m);
const rrows = deriveModuleFeatureRows(reordered);
check('reorder: returns now first in the derived list', rrows[0].feature_key === 'module_5', rrows[0].feature_key);
check('reorder: returns feature_key unchanged (module_5)', rrows.some((r) => r.feature_key === 'module_5'));
check('reorder: displayed label position is 1-based (Module 1: Returns)', rrows[0].label.startsWith('Module 1:'));
check('reorder: still 10 visible modules', rrows.length === 10, String(rrows.length));

// Empty registry -> empty derived list (API falls back to catalog separately).
check('empty registry derives no module rows', deriveModuleFeatureRows([]).length === 0);

// Unlimited formatting.
check('formatLimit(-1) = Unlimited', formatLimit(-1) === 'Unlimited');
check('formatLimit(25) = 25', formatLimit(25) === '25');
check('formatLimit(null) = empty', formatLimit(null) === '');

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
