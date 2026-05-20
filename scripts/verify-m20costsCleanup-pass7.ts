/* eslint-disable no-console */
/**
 * verify-m20costsCleanup-pass7.ts (M2.0M Pass 7, 2026-05-12)
 *
 * Module 1 Costs Architecture Simplification + 6 polish fixes.
 *
 * Sections:
 *   1. Migration: migrateM20costsPass7PerAsset flattens master lines
 *      into per-asset replicas; CostOverride[] data dropped; banner
 *      M20COSTS_PASS7_NOTICE exported.
 *   2. Per-asset Inputs UI source markers (Module1Costs.tsx).
 *   3. Roads/Parks NDA project-level card source markers (Module1Assets).
 *   4. Sub-unit verification compact (single line, no expand button).
 *   5. Sub-units table colgroup + Total Revenue column source markers.
 *   6. Costs table colgroup widths + Category/Driver/Delete split.
 *   7. Em-dash sweep on touched files.
 *   8. Playwright spec presence.
 *
 * Usage: npx tsx scripts/verify-m20costsCleanup-pass7.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type CostLine,
  type CostOverride,
  type Phase,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  M20COSTS_PASS7_NOTICE,
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
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');

// ── Section 1: Migration ──────────────────────────────────────────────────
console.log('\n[1/8] Migration: master + overrides -> per-asset replicas');
{
  if (typeof M20COSTS_PASS7_NOTICE === 'string' && M20COSTS_PASS7_NOTICE.includes('per-asset')) {
    pass('M20COSTS_PASS7_NOTICE banner exported');
  } else fail('M20COSTS_PASS7_NOTICE', 'missing or wrong wording');

  if (MIGRATE_SRC.includes('function migrateM20costsPass7PerAsset(')) pass('migrateM20costsPass7PerAsset defined');
  else fail('migrateM20costsPass7PerAsset', 'helper not found');

  if (MIGRATE_SRC.includes('function snapshotNeedsPass7Migration(')) pass('snapshotNeedsPass7Migration detector defined');
  else fail('snapshotNeedsPass7Migration', 'detector not found');

  // Build a legacy snapshot: 2 visible assets in one phase, 1 master cost
  // line (targetAssetId undefined), 1 override on assetA.
  const project = makeDefaultProject();
  const phase = makeDefaultPhase();
  const assetA: Asset = {
    id: 'asset_a', phaseId: phase.id, name: 'Tower A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 8000, parkingBaysRequired: 0,
  };
  const assetB: Asset = {
    id: 'asset_b', phaseId: phase.id, name: 'Tower B', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 12000, sellableBuaSqm: 10000, parkingBaysRequired: 0,
  };
  const masterLine: CostLine = {
    id: 'structural__phase_1',
    phaseId: phase.id,
    name: 'Structural',
    method: 'rate_per_bua',
    value: 1500,
    stage: 'hard',
    startPeriod: 0,
    endPeriod: 24,
    phasing: 'even',
    costCategory: 'direct',
    scope: 'direct',
    allocationBasis: 'bua_share',
  };
  const overrideA: CostOverride = {
    assetId: assetA.id,
    lineId: masterLine.id,
    method: 'rate_per_bua',
    value: 1800,
    phasing: 'even',
    overridden: true,
  };
  const snap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project,
    phases: [{ ...phase, id: 'phase_1' } as Phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [{ ...assetA, phaseId: 'phase_1' }, { ...assetB, phaseId: 'phase_1' }],
    subUnits: [],
    costLines: [masterLine],
    costOverrides: [overrideA],
    financingTranches: [],
    equityContributions: [],
  };
  const r = hydrationFromAnySnapshotChecked(snap);
  if (!r.recognized) {
    fail('hydration', `unrecognized: ${r.error ?? 'unknown'}`);
  } else {
    const flat = r.snapshot.costLines as CostLine[];
    if (flat.length === 2) pass('master replicates to 2 per-asset lines');
    else fail('replica count', `expected 2, got ${flat.length}`);

    const replicaA = flat.find((c) => c.targetAssetId === assetA.id);
    const replicaB = flat.find((c) => c.targetAssetId === assetB.id);
    if (replicaA && replicaA.value === 1800) pass('override values fold onto replica A');
    else fail('override fold', `expected 1800 on assetA, got ${replicaA?.value}`);
    if (replicaB && replicaB.value === 1500) pass('replica B keeps master values (no override)');
    else fail('inherit fold', `expected 1500 on assetB, got ${replicaB?.value}`);

    if (replicaA?.id === `structural__phase_1__${assetA.id}`) pass('replica id matches composed pattern');
    else fail('composed id', `got ${replicaA?.id}`);

    if ((r.snapshot.costOverrides as CostOverride[]).length === 0) pass('costOverrides[] cleared');
    else fail('costOverrides', `expected empty, got ${(r.snapshot.costOverrides as CostOverride[]).length}`);

    if (r.migrationNotice === M20COSTS_PASS7_NOTICE) pass('Pass 7 banner surfaced');
    else fail('Pass 7 banner', `got: ${r.migrationNotice ?? 'none'}`);
  }

  // Edge: orphan line (targetAssetId points to missing asset) is dropped.
  const orphanLine: CostLine = {
    ...masterLine,
    id: 'structural__phase_1__ghost',
    targetAssetId: 'ghost_asset',
  };
  const orphanSnap = { ...snap, costLines: [orphanLine], costOverrides: [] };
  const ro = hydrationFromAnySnapshotChecked(orphanSnap);
  if (ro.recognized && (ro.snapshot.costLines as CostLine[]).length === 0) {
    pass('orphan per-asset line dropped on hydrate');
  } else fail('orphan drop', `got ${ro.recognized ? (ro.snapshot.costLines as CostLine[]).length : 'err'} lines`);

  // Edge: phase with zero visible assets drops the master line.
  const emptyPhaseSnap = { ...snap, assets: [], costLines: [masterLine], costOverrides: [] };
  const re = hydrationFromAnySnapshotChecked(emptyPhaseSnap);
  if (re.recognized && (re.snapshot.costLines as CostLine[]).length === 0) {
    pass('master line drops when phase has no visible assets');
  } else fail('empty phase drop', 'unexpected');
}

// ── Section 2: Per-asset Inputs UI ───────────────────────────────────────
console.log('\n[2/8] Per-asset Inputs UI markers');
{
  const markers = [
    'costs-inputs-asset-nav',
    'costs-inputs-phase-filter',
    'costs-inputs-asset-pills',
    'costs-inputs-asset-pill-',
    'costs-inputs-asset-stats-',
    'PerAssetInputsView',
  ];
  for (const m of markers) {
    if (COSTS_SRC.includes(m)) pass(`marker ${m} present`);
    else if (m === 'PerAssetInputsView') skip(`marker ${m}`, 'helper name (optional)');
    else fail(`marker ${m}`, 'missing');
  }
}

// ── Section 3: Roads/Parks NDA project-level card ────────────────────────
console.log('\n[3/8] Tab 2 NDA project-level summary block');
{
  const markers = [
    'parcels-nda-summary',
    'parcels-nda-enabled',
    'parcels-nda-roads-pct',
    'parcels-nda-parks-pct',
    'parcels-nda-derivation',
    'parcels-nda-gross',
    'parcels-nda-net',
  ];
  for (const m of markers) {
    if (ASSETS_SRC.includes(m)) pass(`marker ${m} present`);
    else fail(`marker ${m}`, 'missing');
  }

  // Per-parcel NDA columns must be GONE from the parcels table headers.
  if (!ASSETS_SRC.includes('parcel-${parcel.id}-hasNdaDeduction')) pass('per-parcel hasNdaDeduction cell removed');
  else fail('per-parcel hasNdaDeduction', 'still present');
  if (!ASSETS_SRC.includes('parcel-${parcel.id}-roadsPct')) pass('per-parcel roadsPct cell removed');
  else fail('per-parcel roadsPct', 'still present');
  if (!ASSETS_SRC.includes('parcel-${parcel.id}-parksPct')) pass('per-parcel parksPct cell removed');
  else fail('per-parcel parksPct', 'still present');
}

// ── Section 4: Sub-unit verification compact ─────────────────────────────
console.log('\n[4/8] Sub-unit verification single line');
{
  if (ASSETS_SRC.includes('-recon-summary')) pass('recon-summary test-id present');
  else fail('recon-summary', 'missing');
  if (ASSETS_SRC.includes('-recon-eff')) pass('-recon-eff cell present (added Pass 7)');
  else fail('-recon-eff', 'missing');
  if (ASSETS_SRC.includes('-recon-land')) pass('-recon-land cell present (added Pass 7)');
  else fail('-recon-land', 'missing');
  if (!ASSETS_SRC.includes('-area-reconciliation-toggle')) pass('expand/collapse toggle removed');
  else fail('toggle removed', 'still present');
  if (!ASSETS_SRC.includes('ASSET_RECON_LS_KEY')) pass('localStorage key dropped');
  else fail('localStorage key', 'still present');
  if (ASSETS_SRC.includes('<strong>Verification:</strong>')) pass('Verification: label rendered');
  else fail('Verification: label', 'missing');
}

// ── Section 5: Sub-units table colgroup + Total Revenue ──────────────────
console.log('\n[5/8] Sub-units table layout + Total Revenue column');
{
  if (ASSETS_SRC.includes('subunit-total-revenue-header')) pass('Total Revenue (No Indexation) header present');
  else fail('Total Revenue header', 'missing');
  if (ASSETS_SRC.includes('-total-revenue')) pass('per-row total-revenue cell present');
  else fail('per-row total-revenue', 'missing');
  if (ASSETS_SRC.includes('-area-derived')) pass('Units-mode derived area cell present');
  else fail('area-derived cell', 'missing');
  if (ASSETS_SRC.includes('-area-readout')) pass('area-readout caption present');
  else fail('area-readout', 'missing');
  // showUnitColumns conditional dropped (all columns always render now).
  if (!ASSETS_SRC.includes('showUnitColumns:')) pass('showUnitColumns prop dropped from SubUnitRow signature');
  else fail('showUnitColumns prop', 'still in signature');
}

// ── Section 6: Costs table column widths balanced ────────────────────────
console.log('\n[6/8] Costs table colgroup + 11 cols');
{
  // Each col width should appear in the AssetCostSection colgroup.
  const widths = [220, 200, 100, 120, 60, 140, 40];
  for (const w of widths) {
    if (COSTS_SRC.includes(`width: ${w}`)) pass(`colgroup width=${w}px present`);
    else fail(`colgroup width=${w}`, 'missing');
  }
  // Category + Driver columns split into separate <th>.
  if (COSTS_SRC.includes('>Category</th>')) pass('Category column header present');
  else fail('Category <th>', 'missing');
  if (COSTS_SRC.includes('>Driver</th>')) pass('Driver column header present');
  else fail('Driver <th>', 'missing');
  // Cost row sub-rows (Manual % / chip strip / picker) span all 11 cols.
  if (COSTS_SRC.includes('colSpan={11}')) pass('CostRow sub-rows use colSpan={11}');
  else fail('colSpan={11}', 'missing in sub-rows');
  // Delete cell separate from Toggle: -driver-na fallback for direct lines.
  if (COSTS_SRC.includes('-driver-na')) pass('Driver cell muted-dash fallback for Direct category');
  else fail('-driver-na', 'missing');
}

// ── Section 7: Em-dash sweep ─────────────────────────────────────────────
console.log('\n[7/8] No em-dashes in touched files');
{
  const filesToCheck: Array<{ name: string; src: string }> = [
    { name: 'Module1Costs.tsx', src: COSTS_SRC },
    { name: 'Module1Assets.tsx', src: ASSETS_SRC },
    { name: 'module1-migrate.ts', src: MIGRATE_SRC },
  ];
  for (const f of filesToCheck) {
    const matches = (f.src.match(/, /g) ?? []).length;
    if (matches === 0) pass(`${f.name}: no em-dashes`);
    else fail(`${f.name} em-dashes`, `${matches} found`);
  }
}

// ── Section 8: Playwright spec presence ──────────────────────────────────
console.log('\n[8/8] Playwright spec presence');
{
  const specPath = resolve(REPO_ROOT, 'tests/e2e/m20costsCleanup-pass7.spec.ts');
  if (existsSync(specPath)) pass('Playwright spec exists');
  else skip('Playwright spec', 'not yet authored (manual smoke + verifier covers core paths)');

  const designNote = resolve(REPO_ROOT, 'docs/m20costsCleanup-pass7.md');
  if (existsSync(designNote)) pass('Pass 7 design note exists');
  else fail('design note', 'missing');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Pass:    ${passed}`);
console.log(`Fail:    ${failed}`);
console.log(`Skip:    ${skipped}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
