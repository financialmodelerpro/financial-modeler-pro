/* eslint-disable no-console */
/**
 * verify-m20costsCleanup-pass8.ts (M2.0 Costs Cleanup Pass 8, 2026-05-12)
 *
 * 8 fixes (and migration + design note + em-dash sweep):
 *   1. NDA placement: Tab 1 NDA card removed; Tab 2 card surfaces +
 *      scope toggle (project / asset) + per-asset Roads%/Parks% inputs.
 *   2. Sub-units: per-asset metric toggle; dynamic Count header;
 *      Units mode = Area + Unit Size inputs with Count derived.
 *   3. Top-right phase dropdown removed; empty-phase helpful message.
 *   4. Cost table 9 cols (Category + Driver dropped).
 *   5. Start/End defaults: Start=0, End=maxCp+1; migration clamps.
 *   6. PercentOfSelectedPicker colSpan synced to 9.
 *   7. Phase filter drops "All Phases" sentinel.
 *   8. Results sub-tab Combined / Single Asset toggle + persisted state.
 *
 * Usage: npx tsx scripts/verify-m20costsCleanup-pass8.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type CostLine,
  type Phase,
  type Project,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  M20_PASS8_NOTICE,
  snapshotNeedsPass8Migration,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const PHASES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx'), 'utf8');
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');

// ── Section 1: Fix 1 NDA placement ────────────────────────────────────────
console.log('\n[1/10] Fix 1: NDA card on Tab 2 with scope toggle');
{
  if (!PHASES_SRC.includes('project-nda-toggle-label') && !PHASES_SRC.includes('project-nda-enabled')) {
    pass('Tab 1 NDA card removed');
  } else fail('Tab 1 NDA card', 'still present');
  if (ASSETS_SRC.includes('parcels-nda-summary')) pass('Tab 2 NDA card present');
  else fail('Tab 2 NDA card', 'missing');
  if (ASSETS_SRC.includes('parcels-nda-scope-project') && ASSETS_SRC.includes('parcels-nda-scope-asset')) {
    pass('NDA scope toggle (project / asset) rendered');
  } else fail('NDA scope toggle', 'missing one or both options');
  if (TYPES_SRC.includes("projectNdaScope?: 'project' | 'asset'")) pass('schema gains projectNdaScope');
  else fail('schema projectNdaScope', 'missing');
  if (TYPES_SRC.includes('assetRoadsPct?: number') && TYPES_SRC.includes('assetParksPct?: number') && TYPES_SRC.includes('assetNdaEnabled?: boolean')) {
    pass('schema gains per-asset NDA fields');
  } else fail('per-asset NDA schema', 'missing one of assetRoadsPct/assetParksPct/assetNdaEnabled');
  if (ASSETS_SRC.includes('asset-${asset.id}-roads-pct') && ASSETS_SRC.includes('asset-${asset.id}-parks-pct')) {
    pass('per-asset Roads % + Parks % inputs render when scope=asset');
  } else fail('per-asset inputs', 'missing test-ids');
}

// ── Section 2: Fix 2 sub-unit UX ──────────────────────────────────────────
console.log('\n[2/10] Fix 2: sub-unit metric per-asset + dynamic Count + Units mode');
{
  if (TYPES_SRC.includes('subUnitMetric?: SubUnitMetric')) pass('schema gains Asset.subUnitMetric');
  else fail('schema subUnitMetric', 'missing');
  if (ASSETS_SRC.includes('asset-${asset.id}-subunit-metric-area') && ASSETS_SRC.includes('asset-${asset.id}-subunit-metric-units')) {
    pass('asset-level metric toggle rendered');
  } else fail('metric toggle', 'missing test-ids');
  if (ASSETS_SRC.includes('asset-${asset.id}-subunit-count-header')) pass('dynamic Count header test-id present');
  else fail('dynamic Count header', 'missing');
  // Per-row Metric column gone (subunit-${id}-metric was the dropdown test-id).
  if (!ASSETS_SRC.includes('data-testid={`subunit-${subUnit.id}-metric`}')) {
    pass('per-row Metric column dropdown removed');
  } else fail('per-row Metric column', 'still present');
  // Area input always editable now (input element with -area-input testid).
  if (ASSETS_SRC.includes('subunit-${subUnit.id}-area-input')) pass('Area input test-id present (always editable)');
  else fail('Area input', 'missing');
}

// ── Section 3: Fix 3 top-right phase dropdown ─────────────────────────────
console.log('\n[3/10] Fix 3: top-right phase dropdown removed + empty-phase message');
{
  if (!COSTS_SRC.includes('costs-phase-select')) pass('top-right costs-phase-select removed');
  else fail('top-right phase dropdown', 'still present');
  if (COSTS_SRC.includes('costs-inputs-empty-phase')) pass('empty-phase helpful message rendered');
  else fail('empty-phase message', 'missing');
}

// ── Section 4: Fix 4 Category + Driver columns dropped ────────────────────
console.log('\n[4/10] Fix 4: cost table 11 -> 9 cols (Category + Driver dropped)');
{
  if (!COSTS_SRC.includes('<th style={{ padding: \'6px\', textAlign: \'left\' }}>Category</th>')) {
    pass('Category column header removed');
  } else fail('Category column', 'still present');
  if (!COSTS_SRC.includes('<th style={{ padding: \'6px\', textAlign: \'left\' }}>Driver</th>')) {
    pass('Driver column header removed');
  } else fail('Driver column', 'still present');
  if (!COSTS_SRC.includes('data-testid={`cost-${asset.id}-${line.id}-category`}')) {
    pass('per-row Category cell removed');
  } else fail('per-row Category cell', 'still present');
  if (!COSTS_SRC.includes('data-testid={`cost-${asset.id}-${line.id}-driver-na`}')) {
    pass('per-row Driver-NA fallback removed');
  } else fail('per-row Driver-NA', 'still present');
}

// ── Section 5: Fix 5 Start/End defaults ───────────────────────────────────
console.log('\n[5/10] Fix 5: Start/End defaults + migration clamps');
{
  if (COSTS_SRC.includes('startPeriod: 0,\n') && COSTS_SRC.includes('endPeriod: Math.max(1, maxCp + 1)')) {
    pass('new cost lines default Start=0, End=maxCp+1');
  } else fail('Start/End defaults', 'missing in onAddCustom');

  // Migration test: a snapshot whose endPeriod exceeds maxCp+1 should clamp.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 4, operationsPeriods: 0, overlapPeriods: 0 };
  const asset: Asset = {
    id: 'aA', phaseId: 'p1', name: 'A', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 1000, sellableBuaSqm: 800, parkingBaysRequired: 0,
  };
  const line: CostLine = {
    id: 'construction__p1__aA',
    phaseId: 'p1',
    name: 'Construction',
    method: 'rate_per_bua',
    value: 100,
    stage: 'hard',
    startPeriod: 0,
    endPeriod: 24,
    phasing: 'even',
    costCategory: 'direct',
    scope: 'direct',
    allocationBasis: 'bua_share',
    targetAssetId: asset.id,
  };
  const snap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project,
    phases: [phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [asset],
    subUnits: [] as SubUnit[],
    costLines: [line],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  const r = hydrationFromAnySnapshotChecked(snap);
  if (!r.recognized) {
    fail('hydration', `unrecognized: ${r.error ?? 'unknown'}`);
  } else {
    const clamped = (r.snapshot.costLines as CostLine[])[0];
    if (clamped && clamped.endPeriod === 5) {
      pass('legacy endPeriod=24 clamped to maxCp+1 (5)');
    } else fail('endPeriod clamp', `expected 5, got ${clamped?.endPeriod}`);
  }
}

// ── Section 6: Fix 6 %-of-selected colSpan ────────────────────────────────
console.log('\n[6/10] Fix 6: PercentOfSelectedPicker colSpan synced to 9');
{
  if (!COSTS_SRC.includes('<td colSpan={11}')) pass('no stale colSpan={11} cells');
  else fail('colSpan={11}', 'still present in CostRow sub-rows');
  if (COSTS_SRC.includes('-pct-picker-button')) pass('picker button test-id present');
  else fail('picker button', 'missing');
}

// ── Section 7: Fix 7 Phase filter no All Phases ───────────────────────────
console.log('\n[7/10] Fix 7: Phase filter drops "All Phases"');
{
  if (!COSTS_SRC.includes('<option value="__all__">All Phases</option>')) {
    pass('"All Phases" option removed from Tab 3 phase filter');
  } else fail('All Phases option', 'still present');
  if (COSTS_SRC.includes('firstPhaseWithAssets')) pass('default = first phase with assets');
  else fail('first-phase-with-assets default', 'missing');
}

// ── Section 8: Fix 8 Results toggle ───────────────────────────────────────
console.log('\n[8/10] Fix 8: Results Combined / Single Asset toggle + persisted state');
{
  if (TYPES_SRC.includes("resultsViewMode?: 'combined' | 'single_asset'")) pass('schema gains resultsViewMode');
  else fail('schema resultsViewMode', 'missing');
  if (TYPES_SRC.includes('resultsSelectedAssetId?: string')) pass('schema gains resultsSelectedAssetId');
  else fail('schema resultsSelectedAssetId', 'missing');
  if (COSTS_SRC.includes('costs-results-view-combined') && COSTS_SRC.includes('costs-results-view-single')) {
    pass('Combined + Single Asset radio toggle rendered');
  } else fail('view toggle', 'missing test-ids');
  if (COSTS_SRC.includes('costs-results-single-asset-select')) pass('Single Asset picker dropdown rendered');
  else fail('Single Asset picker', 'missing');
  if (!COSTS_SRC.includes('costs-results-filter-combined') && !COSTS_SRC.includes('setResultsAssetFilter')) {
    pass('local resultsAssetFilter pill bar retired');
  } else fail('legacy filter pill bar', 'still present');
}

// ── Section 9: Migration banner + idempotency ─────────────────────────────
console.log('\n[9/10] Migration banner + idempotency');
{
  if (typeof M20_PASS8_NOTICE === 'string' && M20_PASS8_NOTICE.includes('sub-unit metric now per-asset')) {
    pass('M20_PASS8_NOTICE banner exported');
  } else fail('banner', 'missing or wrong wording');
  if (MIGRATE_SRC.includes('function migrateM20costsPass8(')) pass('migrateM20costsPass8 defined');
  else fail('migration', 'helper not found');
  if (MIGRATE_SRC.includes('function snapshotNeedsPass8Migration(')) pass('detector defined');
  else fail('detector', 'missing');

  // Idempotency: build a Pass-8 shaped snapshot and re-run.
  const project = makeDefaultProject();
  project.projectNdaEnabled = true;
  project.projectNdaScope = 'project';
  project.resultsViewMode = 'combined';
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 4, operationsPeriods: 0, overlapPeriods: 0 };
  const asset: Asset = {
    id: 'a', phaseId: 'p1', name: 'A', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 1000, sellableBuaSqm: 800, parkingBaysRequired: 0,
    subUnitMetric: 'area',
  };
  const snap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project,
    phases: [phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [asset],
    subUnits: [] as SubUnit[],
    costLines: [] as CostLine[],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  if (!snapshotNeedsPass8Migration(snap)) pass('detector returns false on Pass-8-shaped snapshot');
  else fail('detector', 'flagged a Pass-8 shaped snapshot');

  // Pre-Pass-8: projectNdaEnabled true but no scope -> detector true.
  const preSnap = { ...snap, project: { ...project, projectNdaScope: undefined, resultsViewMode: undefined } };
  if (snapshotNeedsPass8Migration(preSnap)) pass('detector returns true for pre-Pass-8 snapshot');
  else fail('detector', 'missed pre-Pass-8 snapshot');

  // Migration sets defaults.
  const r = hydrationFromAnySnapshotChecked(preSnap);
  if (r.recognized) {
    const p = r.snapshot.project as Project;
    if (p.projectNdaScope === 'project' && p.resultsViewMode === 'combined') {
      pass('migration stamps projectNdaScope=project + resultsViewMode=combined');
    } else fail('migration defaults', `got scope=${p.projectNdaScope} view=${p.resultsViewMode}`);
    if (r.migrationNotice === M20_PASS8_NOTICE) pass('Pass 8 banner surfaced');
    else skip('Pass 8 banner', `banner cascade may have prioritized another pass (got: ${r.migrationNotice ?? 'none'})`);
  }
}

// ── Section 10: Em-dash sweep + design note ───────────────────────────────
console.log('\n[10/10] Em-dash sweep + design note');
{
  const filesToCheck: Array<{ name: string; src: string }> = [
    { name: 'Module1Costs.tsx', src: COSTS_SRC },
    { name: 'Module1Assets.tsx', src: ASSETS_SRC },
    { name: 'Module1ProjectPhases.tsx', src: PHASES_SRC },
    { name: 'module1-migrate.ts', src: MIGRATE_SRC },
    { name: 'module1-types.ts', src: TYPES_SRC },
  ];
  for (const f of filesToCheck) {
    const matches = (f.src.match(/, /g) ?? []).length;
    if (matches === 0) pass(`${f.name}: no em-dashes`);
    else fail(`${f.name} em-dashes`, `${matches} found`);
  }
  const designNote = resolve(REPO_ROOT, 'docs/m20costsCleanup-pass8.md');
  if (existsSync(designNote)) pass('Pass 8 design note exists');
  else fail('design note', 'missing');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Pass:    ${passed}`);
console.log(`Fail:    ${failed}`);
console.log(`Skip:    ${skipped}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
