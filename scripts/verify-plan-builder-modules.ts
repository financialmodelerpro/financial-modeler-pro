/**
 * verify-plan-builder-modules.ts
 *
 * Pure tests for the Plan Builder live-module derivation (deriveModuleFeatureRows)
 * and the Unlimited formatting. No DB: proves hide drops a row, coming_soon is
 * tagged + still a gate row, reorder follows display_order, feature_key stays
 * stable (slug-derived) across reorder/renumber, and -1 formats as Unlimited.
 *
 * ALSO PINS THE POSITION / IDENTITY SPLIT (2026-09-03, migration 235). The
 * number a user SEES is a POSITION among the visible modules; the number in
 * feature_key is the slug-derived IDENTITY. They legitimately differ (with
 * portfolio and market-data hidden, module_10 shows as "Module 8"), and the
 * defect was never that they differ. It was that a THIRD copy of the number
 * sat frozen in features_registry.label, agreeing with neither and tracking
 * nothing. The live half at the end fails if a stored label carries one again.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-plan-builder-modules.ts
 */
import { readFileSync } from 'node:fs';
import { deriveModuleFeatureRows, moduleFeatureKey, formatLimit, type LiveModuleInput } from '../src/shared/entitlements/moduleCatalog';

/** Any module label that still spells a number, in any separator style. */
const NUMBER_IN_LABEL = /module\s*\d+/i;

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


// ── Position is NOT identity, and the gap is the whole point ────────────────
console.log('\n=== Position vs identity ===');
{
  // The live shape as of 2026-09-03: portfolio (8) and market-data (9) hidden.
  // Collaborate is component 10 and the EIGHTH visible module. Both numbers
  // are correct about different things, and this is the case that made a
  // frozen stored label wrong.
  const live: LiveModuleInput[] = base.map((m) =>
    m.slug === 'portfolio' || m.slug === 'market-data'
      ? { ...m, status: 'hidden' as const }
      : { ...m, status: 'live' as const });
  const lrows = deriveModuleFeatureRows(live);
  const collab = lrows.find((r) => r.feature_key === 'module_10');
  check('identity is the slug: collaborate keeps feature_key module_10', !!collab);
  check('position is what shows: collaborate renders as Module 8',
    !!collab && collab.label === 'Module 8: Collaborate', collab?.label);
  // Unhide portfolio and the same row slides to 9 while its key never moves.
  const unhidden = live.map((m) => (m.slug === 'portfolio' ? { ...m, status: 'coming_soon' as const } : m));
  const collab2 = deriveModuleFeatureRows(unhidden).find((r) => r.feature_key === 'module_10');
  check('unhiding a module moves the POSITION, never the key',
    !!collab2 && collab2.feature_key === 'module_10' && collab2.label === 'Module 9: Collaborate', collab2?.label);
}

// ── Module names are DERIVED, in every surface that names one ──────────────
console.log('\n=== No hand-written module label survives ===');
{
  // 2026-09-03: there were TWO hand-written module maps and they disagreed
  // inside one modal. The shared UpgradePrompt supplied the heading and the
  // platform's FEATURE_DISPLAY_LABELS the sentence under it, and the shared
  // one had module_4 crossed with module_5 and module_6 with module_7 against
  // the registry, ever since migration 157 moved reports and scenarios.
  //
  // The fix is not a corrected copy, which would go stale a third time. It is
  // that NEITHER MAP MAY CONTAIN A MODULE KEY: the name and number come from
  // the live registry through the nav list the sidebar already renders. These
  // checks fail if a module key is ever typed back into either file.
  const up = readFileSync('src/shared/components/UpgradePrompt.tsx', 'utf8');
  const fl = readFileSync('src/hubs/modeling/platforms/refm/lib/featureLabels.ts', 'utf8');
  const platform = readFileSync('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', 'utf8');
  const MODULE_ENTRY = /^\s*module_\d+:\s/m;

  check('shared UpgradePrompt holds no module label', !MODULE_ENTRY.test(up));
  check('platform FEATURE_DISPLAY_LABELS holds no module label', !MODULE_ENTRY.test(fl));
  check('UpgradePrompt accepts a resolved label', /label\?: string;/.test(up));
  check('the passed label WINS over the map',
    /const featureLabel = label \?\? FEATURE_LABELS\[featureKey\] \?\? featureKey;/.test(up));
  check('the platform resolves module labels from the live nav list',
    /dynamicSidebarModules\.find\(\(m\) => m\.featureKey === featureKey\)\?\.label/.test(platform));
  check('the heading and the sentence use the SAME resolution',
    (platform.match(/lockedFeatureLabel\(upgradePrompt\.featureKey\)/g) ?? []).length === 2);
  // shared/ CANNOT read the registry (eslint boundaries: shared imports only
  // core, shared, integ), so passing the label in is the only correct
  // direction, not a convenience. Pinned so a later reader does not "simplify"
  // it back into the shared component.
  check('the boundary reason is recorded where the map used to be',
    /shared` may import only|shared may import only/.test(up) || /eslint boundaries/.test(up));
  // The non-module keys the maps still own must survive.
  check('non-module keys still resolve in the shared map', /ai_contextual:/.test(up) && /pdf_basic:/.test(up));
  check('non-module keys still resolve in the platform map', /sensitivity:/.test(fl) && /versioning:/.test(fl));
}

// ── LIVE: storage carries no display number (migration 235) ─────────────────
async function liveChecks(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('\n[SKIP] live label check (no DB credentials).');
    return;
  }
  console.log('\n=== Live features_registry labels (migration 235) ===');
  const res = await fetch(url + '/rest/v1/features_registry?feature_key=like.module_*&select=feature_key,label',
    { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const rows = (await res.json()) as Array<{ feature_key: string; label: string }>;
  check('live: all 11 module rows found', Array.isArray(rows) && rows.length === 11, String(rows?.length));
  const numbered = (rows ?? []).filter((x) => NUMBER_IN_LABEL.test(x.label));
  check('live: no stored module label carries a number (mig 235 applied)',
    numbered.length === 0, numbered.map((x) => x.feature_key + '=' + x.label).join('; '));
  const collabRow = (rows ?? []).find((x) => x.feature_key === 'module_10');
  check('live: module_10 is stored as the NAME only, no number to contradict the position',
    !!collabRow && collabRow.label === 'Collaborate', collabRow?.label);
}
function report(): void {
  console.log('');
  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
}

// The live half is async, so the summary WAITS for it. Printing the total
// before the live checks had run would report a pass for checks that had not
// happened yet, which is the exact shape of TRAPS 3.20.
void liveChecks().then(report);
