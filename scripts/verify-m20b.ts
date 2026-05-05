/* eslint-disable no-console */
/**
 * verify-m20b.ts (M2.0b verifier)
 *
 * 5-section per-phase verifier for the brand-styled shell
 * restoration. Calc engine + v5 schema are unchanged from M2.0,
 * so sections 1-3 are smoke-only. Section 4 covers the new
 * shell components + RealEstatePlatform rewire. Section 5 runs
 * the M2.0b Playwright spec.
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-m20b.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import { SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';

const REPO_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name: string, msg = ''): void {
  passed++;
  console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`);
}
function fail(name: string, msg: string): void {
  failed++;
  console.log(`  FAIL  ${name}: ${msg}`);
}
function skip(name: string, msg: string): void {
  skipped++;
  console.log(`  SKIP  ${name}: ${msg}`);
}

// ── Section 1: schema unchanged from M2.0 ─────────────────────────────────
console.log('\n[1/5] Schema (carry-over from M2.0)');
if (SCHEMA_VERSION === 5) pass('SCHEMA_VERSION still 5');
else fail('SCHEMA_VERSION', `expected 5, got ${SCHEMA_VERSION}`);

// ── Section 2: route smoke (gated on dev server) ──────────────────────────
console.log('\n[2/5] Route smoke');
let serverUp = false;
let routeOk = false;
try {
  const code = execSync('curl -s -o NUL -w "%{http_code}" http://localhost:3000/refm', {
    timeout: 3000,
    encoding: 'utf8',
  }).trim();
  serverUp = code !== '';
  routeOk = code === '200' || code === '302' || code === '307';
  if (routeOk) pass(`/refm responsive (HTTP ${code})`);
  else if (serverUp) skip('/refm', `dev server returned HTTP ${code}; sign-in required for full smoke`);
  else skip('/refm', 'dev server not reachable');
} catch {
  skip('/refm', 'dev server not reachable; route smoke skipped');
}

// ── Section 3: snapshot baseline bit-identical ────────────────────────────
console.log('\n[3/5] Snapshot baseline');
try {
  const out = execSync('npx tsx scripts/module1-v5-diff.ts', { encoding: 'utf8', timeout: 30000 });
  if (out.includes('OK: bit-identical with baseline')) {
    pass('module1-v5-diff bit-identical');
  } else {
    fail('module1-v5-diff', out.slice(0, 200));
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 4: source-file markers (M2.0b shell restoration) ──────────────
console.log('\n[4/5] Source-file markers (M2.0b)');

interface Marker {
  label: string;
  path: string;
  needle: string;
  negate?: boolean;
}

const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const modalRoot = `${componentRoot}/modals`;

const markers: Marker[] = [
  // Topbar (M2.0b/1)
  { label: 'T1: Topbar pm-toolbar', path: `${componentRoot}/Topbar.tsx`, needle: 'pm-toolbar' },
  { label: 'T2: Topbar pm-brand', path: `${componentRoot}/Topbar.tsx`, needle: 'pm-brand' },
  { label: 'T3: Topbar context buttons', path: `${componentRoot}/Topbar.tsx`, needle: 'topbar-open-project' },
  { label: 'T4: Topbar save pill', path: `${componentRoot}/Topbar.tsx`, needle: 'topbar-save' },
  { label: 'T5: Topbar export pill', path: `${componentRoot}/Topbar.tsx`, needle: 'topbar-open-export' },
  { label: 'T6: Topbar RBAC badge', path: `${componentRoot}/Topbar.tsx`, needle: 'rbac-badge role-' },
  { label: 'T7: Topbar dark toggle', path: `${componentRoot}/Topbar.tsx`, needle: 'topbar-toggle-dark' },
  { label: 'T8: Topbar Sign Out', path: `${componentRoot}/Topbar.tsx`, needle: 'topbar-signout' },
  { label: 'T9: Topbar full prop set', path: `${componentRoot}/Topbar.tsx`, needle: 'hasUnsaved: boolean' },

  // Sidebar (M2.0b/1)
  { label: 'S1: Sidebar sb-pv-panel', path: `${componentRoot}/Sidebar.tsx`, needle: 'sb-pv-panel' },
  { label: 'S2: Sidebar pv-project row', path: `${componentRoot}/Sidebar.tsx`, needle: 'sidebar-pv-project' },
  { label: 'S3: Sidebar pv-version row', path: `${componentRoot}/Sidebar.tsx`, needle: 'sidebar-pv-version' },
  { label: 'S4: Sidebar collapsed pills', path: `${componentRoot}/Sidebar.tsx`, needle: 'sb-pv-collapsed' },
  { label: 'S5: Sidebar PlanBadge import', path: `${componentRoot}/Sidebar.tsx`, needle: "import PlanBadge" },
  { label: 'S6: Sidebar role indicator', path: `${componentRoot}/Sidebar.tsx`, needle: 'sidebar-role-indicator' },
  { label: 'S7: Sidebar canSeeModule prop', path: `${componentRoot}/Sidebar.tsx`, needle: 'canSeeModule' },
  { label: 'S8: Sidebar onLockedModuleClick', path: `${componentRoot}/Sidebar.tsx`, needle: 'onLockedModuleClick' },

  // Dashboard (M2.0b/2)
  { label: 'D1: Dashboard kpi-card grid', path: `${componentRoot}/Dashboard.tsx`, needle: 'dashboard-kpi-grid' },
  { label: 'D2: Dashboard module-card grid', path: `${componentRoot}/Dashboard.tsx`, needle: 'dashboard-card-module1' },
  { label: 'D3: Dashboard roadmap', path: `${componentRoot}/Dashboard.tsx`, needle: 'dashboard-roadmap' },
  { label: 'D4: Dashboard live KPI compute', path: `${componentRoot}/Dashboard.tsx`, needle: 'computeLandAggregate' },
  { label: 'D5: Dashboard formatCurrency', path: `${componentRoot}/Dashboard.tsx`, needle: 'formatCurrency' },

  // ProjectsScreen (M2.0b/2)
  { label: 'P1: ProjectsScreen pm-project-card', path: `${componentRoot}/ProjectsScreen.tsx`, needle: 'pm-project-card' },
  { label: 'P2: ProjectsScreen status pill', path: `${componentRoot}/ProjectsScreen.tsx`, needle: 'STATUS_COLORS' },
  { label: 'P3: ProjectsScreen search', path: `${componentRoot}/ProjectsScreen.tsx`, needle: 'projects-search' },
  { label: 'P4: ProjectsScreen RBAC gate', path: `${componentRoot}/ProjectsScreen.tsx`, needle: "can('canCreateProject')" },

  // OverviewScreen (M2.0b/2)
  { label: 'O1: OverviewScreen kpi-grid', path: `${componentRoot}/OverviewScreen.tsx`, needle: 'overview-kpi-grid' },
  { label: 'O2: OverviewScreen quick links', path: `${componentRoot}/OverviewScreen.tsx`, needle: 'overview-quick-links' },
  { label: 'O3: OverviewScreen phase summary', path: `${componentRoot}/OverviewScreen.tsx`, needle: 'overview-phases' },
  { label: 'O4: OverviewScreen versions', path: `${componentRoot}/OverviewScreen.tsx`, needle: 'overview-versions' },
  { label: 'O5: OverviewScreen v5 quicklinks', path: `${componentRoot}/OverviewScreen.tsx`, needle: 'project-phases' },

  // Modals (M2.0b/3)
  { label: 'M1: ProjectModal pm-modal', path: `${modalRoot}/ProjectModal.tsx`, needle: 'pm-modal-overlay' },
  { label: 'M2: ProjectModal search', path: `${modalRoot}/ProjectModal.tsx`, needle: 'project-modal-search' },
  { label: 'M3: VersionModal tabs', path: `${modalRoot}/VersionModal.tsx`, needle: 'version-tab-${t}' },
  { label: 'M4: VersionModal save handler', path: `${modalRoot}/VersionModal.tsx`, needle: 'onSave?: (versionName' },
  { label: 'M5: RbacModal rbac-modal', path: `${modalRoot}/RbacModal.tsx`, needle: 'rbac-modal-overlay' },
  { label: 'M6: RbacModal perm pills', path: `${modalRoot}/RbacModal.tsx`, needle: 'rbac-perm-tag' },
  { label: 'M7: ExportModal options', path: `${modalRoot}/ExportModal.tsx`, needle: 'export-option-${opt.key}' },
  { label: 'M8: ExportModal plan badges', path: `${modalRoot}/ExportModal.tsx`, needle: 'PLAN_LABEL' },

  // RealEstatePlatform (M2.0b/4)
  { label: 'R1: Shell darkMode state', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'data-refm-theme' },
  { label: 'R2: Shell can() helper', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'PERMISSIONS[currentUserRole]' },
  { label: 'R3: Shell canSeeModule helper', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'MODULE_VISIBILITY[currentUserRole]' },
  { label: 'R4: Shell hasUnsaved tracking', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'useModule1Store.subscribe' },
  { label: 'R5: Shell handleSaveVersion', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'handleSaveVersion' },
  { label: 'R6: Shell handleDeleteProject', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'pclient.deleteProject' },
  { label: 'R7: Shell .app-shell wrapper', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'className="app-shell"' },
  { label: 'R8: Shell wires all 5 surfaces', path: `${componentRoot}/RealEstatePlatform.tsx`, needle: 'activeProjectName=' },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) {
    fail(m.label, `file missing: ${m.path}`);
    continue;
  }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle}`);
}

// Em-dash sweep across the restored shell files
const emDashFiles = [
  `${componentRoot}/Topbar.tsx`,
  `${componentRoot}/Sidebar.tsx`,
  `${componentRoot}/Dashboard.tsx`,
  `${componentRoot}/ProjectsScreen.tsx`,
  `${componentRoot}/OverviewScreen.tsx`,
  `${componentRoot}/RealEstatePlatform.tsx`,
  `${modalRoot}/ProjectModal.tsx`,
  `${modalRoot}/VersionModal.tsx`,
  `${modalRoot}/RbacModal.tsx`,
  `${modalRoot}/ExportModal.tsx`,
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('X1: em-dash sweep, zero hits across M2.0b files');
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash (U+2014)`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20b-shell.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20b-shell.spec.ts not found');
} else {
  pass('m20b-shell.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20b-shell.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 120000,
      });
      pass('Playwright m20b-shell.spec.ts');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fail('Playwright', msg.slice(0, 200));
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
process.exit(0);
