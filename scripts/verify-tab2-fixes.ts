/* eslint-disable no-console */
/**
 * verify-tab2-fixes.ts (Tab 2 Focused Fixes, 2026-05-12)
 *
 * Verifies the 5 Tab 2-only fixes that ship together. No Tab 1, Tab 3,
 * or Tab 4 surface is touched.
 *
 * Sections:
 *   1. Fix 1: computeAssetLandSqm sqm/percent modes fall through to
 *      autoByBua when allocation is 0 (so the per-asset Sqm Allocated
 *      row in Land Reconciliation is non-zero on autoByBua projects).
 *   2. Fix 2 + 3: Land Recon 3-col table markers + Equal/Under/Over
 *      chip helpers applied on both Sqm and Land Value columns +
 *      Unassigned Land row + status footer.
 *   3. Fix 4: Revenue field still rendered in AssetAreaReconciliationBlock
 *      summary line.
 *   4. Fix 5a: Land Allocation block hidden when asset.isCompanion.
 *   5. Fix 5b: Operating Period chip from parent phase's
 *      operationsPeriods replaces UsefulLifeForm on companion.
 *   6. Fix 5c schema: SubUnit gains parentSubUnitId + startingAdr;
 *      makeCompanionSubUnit factory exists; companion sub-unit row
 *      branch renders read-only mirrors + ADR-only editable cell.
 *   7. Fix 5c store: syncCompanionSubUnits + addSubUnit / updateSubUnit
 *      / removeSubUnit chain it; updateAsset becomesSellManage seeds
 *      the initial mirror.
 *   8. Fix 5c migration: migrateT2CompanionSubUnits wired into all 3
 *      hydrate chains; preserves ADR by parentSubUnitId then by name;
 *      drops sub-units whose parent has been removed; idempotent.
 *   9. Em-dash sweep on touched files.
 *
 * Usage: npx tsx scripts/verify-tab2-fixes.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Parcel,
  type Phase,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultProject,
  makeCompanionAsset,
  makeCompanionSubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetLandSqm,
} from '../src/core/calculations';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');
const STORE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts'), 'utf8');
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');

// ── Section 1: Fix 1 ──────────────────────────────────────────────────────
console.log('\n[1/9] Fix 1: computeAssetLandSqm fall-through on sqm/percent=0');
{
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0 };
  const parcel: Parcel = { id: 'parcel-1', phaseId: phase.id, name: 'Parcel A', area: 22066, rate: 98450, cashPct: 80, inKindPct: 20 };
  // Asset with sqm mode allocation but sqm=0 (the failure mode).
  const asset: Asset = {
    id: 'a1', phaseId: phase.id, name: 'Apt', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 100000, sellableBuaSqm: 80000, parkingBaysRequired: 0,
    landAllocation: { parcelId: 'parcel-1', sqm: 0 },
  };
  // Without Fix 1: returns 0 because sqm mode short-circuits. With Fix 1:
  // falls through to autoByBua which uses the asset's BUA share of the
  // parcel area (only asset, so 100% share = 22066).
  const sqm = computeAssetLandSqm(asset, [parcel], [asset], [], 'sqm');
  if (sqm > 0) pass(`sqm-mode fallback returns ${sqm} (parcel area shared via autoByBua)`);
  else fail('sqm-mode fallback', `expected >0, got ${sqm}`);

  // Source marker: Pass 2 rewrite header sits at top of computeAssetLandSqm.
  if (CALC_SRC.includes('T2P2 Fix 1 (2026-05-12)')) pass('CALC_SRC carries T2P2 Fix 1 rewrite header');
  else fail('CALC_SRC T2P2 marker', 'missing');
}

// ── Section 2: Fix 2 + 3 Land Recon table ─────────────────────────────────
console.log('\n[2/9] Fix 2 + 3: Land Recon 3-col table + chips + status footer');
{
  const needles = [
    'land-reconciliation-table',
    'recon-status-footer',
    'recon-unassigned',
    'recon-allocated',
    "gridTemplateColumns: 'minmax(0, 1fr) auto auto'",
    'chipFor',
  ];
  for (const n of needles) {
    if (ASSETS_SRC.includes(n)) pass(`marker "${n}"`);
    else fail(`marker "${n}"`, 'missing in Module1Assets.tsx');
  }
}

// ── Section 3: Fix 4 Revenue in summary ───────────────────────────────────
console.log('\n[3/9] Fix 4: Revenue in AssetAreaReconciliationBlock summary line');
{
  const needles = [
    '-recon-revenue',
    "category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable'",
    'totalRevenue',
  ];
  for (const n of needles) {
    if (ASSETS_SRC.includes(n)) pass(`marker "${n}"`);
    else fail(`marker "${n}"`, 'missing in Module1Assets.tsx');
  }
}

// ── Section 4: Fix 5a Land Allocation hidden on companion ─────────────────
console.log('\n[4/9] Fix 5a: Land Allocation block hidden on companion');
{
  if (ASSETS_SRC.includes('{!asset.isCompanion && (')) pass('!asset.isCompanion guard wraps Land Allocation block');
  else fail('Land Allocation guard', 'missing');
  if (ASSETS_SRC.includes('T2-Fix 5a (2026-05-12): hidden on companion assets')) pass('Fix 5a marker comment present');
  else fail('Fix 5a marker', 'missing');
}

// ── Section 5: Fix 5b Operating chip from parent phase ────────────────────
// T2P3 Fix 3 (2026-05-12) supersedes the period-count chip with an
// Operating End Date sourced from the phase. The hospitality assets
// still get a phase-sourced chip; the labels just shifted.
console.log('\n[5/9] Fix 5b (superseded by T2P3 Fix 3): hospitality chip sourced from phase');
{
  const needles = [
    'operating-end-date',
    'operating-end-date-value',
    'Operating end date from Phase Setup',
    'computeOperatingEndDate(asset, phase)',
  ];
  for (const n of needles) {
    if (ASSETS_SRC.includes(n)) pass(`marker "${n}"`);
    else fail(`marker "${n}"`, 'missing in Module1Assets.tsx');
  }
}

// ── Section 6: Fix 5c schema + factory + row branch ───────────────────────
console.log('\n[6/9] Fix 5c: SubUnit schema + factory + companion row branch');
{
  if (TYPES_SRC.includes('parentSubUnitId?: string')) pass('SubUnit.parentSubUnitId field present');
  else fail('SubUnit.parentSubUnitId', 'missing');
  if (TYPES_SRC.includes('startingAdr?: number')) pass('SubUnit.startingAdr field present');
  else fail('SubUnit.startingAdr', 'missing');
  if (TYPES_SRC.includes('export function makeCompanionSubUnit(')) pass('makeCompanionSubUnit factory exported');
  else fail('makeCompanionSubUnit', 'missing');

  // Factory math: count derives from parent metricValue when metric='units'.
  const parentSub: SubUnit = { id: 's1', assetId: 'a1', name: 'Hotel Twin', category: 'Sellable', metric: 'units', metricValue: 120, unitArea: 50, unitPrice: 0 };
  const mirror = makeCompanionSubUnit(parentSub, 'companion_a1', 350);
  if (mirror.metricValue === 120) pass('mirror.metricValue = parent.metricValue when metric=units');
  else fail('mirror.metricValue', `expected 120, got ${mirror.metricValue}`);
  if (mirror.metric === 'units') pass('mirror.metric = units');
  else fail('mirror.metric', `expected units, got ${mirror.metric}`);
  if (mirror.unitArea === 0) pass('mirror.unitArea = 0 (no Area input on companion)');
  else fail('mirror.unitArea', `expected 0, got ${mirror.unitArea}`);
  if (mirror.parentSubUnitId === 's1') pass('mirror.parentSubUnitId = parent.id');
  else fail('mirror.parentSubUnitId', `expected s1, got ${mirror.parentSubUnitId}`);
  if (mirror.startingAdr === 350) pass('mirror.startingAdr preserves preservedAdr arg');
  else fail('mirror.startingAdr', `expected 350, got ${mirror.startingAdr}`);
  if (mirror.unitPrice === 350) pass('mirror.unitPrice mirrors startingAdr');
  else fail('mirror.unitPrice', `expected 350, got ${mirror.unitPrice}`);

  // Row branch markers.
  if (ASSETS_SRC.includes('if (isCompanionSub) {')) pass('SubUnitRow companion-sub branch present');
  else fail('SubUnitRow companion-sub branch', 'missing');
  if (ASSETS_SRC.includes('-startingAdr`}')) pass('startingAdr input data-testid wired');
  else fail('startingAdr data-testid', 'missing');
  if (ASSETS_SRC.includes('companion-subunit-note')) pass('Sub-units header note on companion');
  else fail('companion-subunit-note', 'missing');
}

// ── Section 7: Fix 5c store integration ───────────────────────────────────
console.log('\n[7/9] Fix 5c: store syncCompanionSubUnits + mutators + Sell-Manage TO seed');
{
  if (STORE_SRC.includes('function syncCompanionSubUnits(')) pass('syncCompanionSubUnits helper defined');
  else fail('syncCompanionSubUnits', 'missing');
  // Mutators chain syncCompanionSubUnits.
  const callCount = (STORE_SRC.match(/syncCompanionSubUnits\(/g) ?? []).length;
  if (callCount >= 4) pass(`syncCompanionSubUnits called ${callCount} times (add/update/remove sub-unit + Sell-Manage TO seed)`);
  else fail('syncCompanionSubUnits call count', `expected >=4, got ${callCount}`);
  if (STORE_SRC.includes('makeCompanionSubUnit')) pass('store imports makeCompanionSubUnit');
  else fail('makeCompanionSubUnit import in store', 'missing');
  if (STORE_SRC.includes('mirror parent Sellable sub-units onto the')) pass('Sell-Manage TO branch seeds companion sub-units');
  else fail('Sell-Manage TO mirror seed', 'missing');
}

// ── Section 8: Fix 5c migration ───────────────────────────────────────────
console.log('\n[8/9] Fix 5c: migration migrateT2CompanionSubUnits');
{
  if (MIGRATE_SRC.includes('function migrateT2CompanionSubUnits(')) pass('migrateT2CompanionSubUnits defined');
  else fail('migrateT2CompanionSubUnits', 'missing');
  const wireCount = (MIGRATE_SRC.match(/migrateT2CompanionSubUnits\(/g) ?? []).length;
  if (wireCount >= 4) pass(`migrateT2CompanionSubUnits wired ${wireCount} times (defn + 3 hydrate chains)`);
  else fail('migration wire count', `expected >=4, got ${wireCount}`);
  if (MIGRATE_SRC.includes('adrByName')) pass('migration preserves ADR by name fallback');
  else fail('adrByName fallback', 'missing in migration');

  // End-to-end migration smoke test.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', operationsPeriods: 8 };
  const parent: Asset = {
    id: 'parent-a', phaseId: phase.id, name: 'Tower', type: '', strategy: 'Sell + Manage',
    visible: true, gfaSqm: 0, buaSqm: 50000, sellableBuaSqm: 40000, parkingBaysRequired: 0,
  };
  const companion = makeCompanionAsset(parent, 100);
  // Parent has 2 Sellable sub-units.
  const sellA: SubUnit = { id: 'su-a', assetId: parent.id, name: 'Studio', category: 'Sellable', metric: 'units', metricValue: 60, unitArea: 40, unitPrice: 1000000 };
  const sellB: SubUnit = { id: 'su-b', assetId: parent.id, name: 'Hotel Twin', category: 'Sellable', metric: 'units', metricValue: 40, unitArea: 45, unitPrice: 1500000 };
  // Companion has one matching shadow (by name) + one stale row (parent gone).
  const compMirrorByName: SubUnit = { id: 'old-1', assetId: companion.id, name: 'Studio', category: 'Operable', metric: 'units', metricValue: 0, unitArea: 0, unitPrice: 0, startingAdr: 500 };
  const compStale: SubUnit = { id: 'old-2', assetId: companion.id, name: 'Demolished', category: 'Operable', metric: 'units', metricValue: 0, unitArea: 0, unitPrice: 0, startingAdr: 99 };

  const loose: unknown = {
    project,
    phases: [phase],
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [parent, companion],
    subUnits: [sellA, sellB, compMirrorByName, compStale],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  const migrated = hydrationFromAnySnapshot(loose);
  const out = migrated.subUnits.filter((u: SubUnit) => u.assetId === companion.id);
  if (out.length === 2) pass('after migration, companion has exactly 2 sub-units (1 per parent Sellable)');
  else fail('post-migration count', `expected 2, got ${out.length}`);
  const studioMirror = out.find((u: SubUnit) => u.parentSubUnitId === sellA.id);
  if (studioMirror && studioMirror.startingAdr === 500) pass('ADR preserved by name fallback (Studio: 500)');
  else fail('ADR preserve', `expected studio.startingAdr=500, got ${studioMirror?.startingAdr}`);
  const towerMirror = out.find((u: SubUnit) => u.parentSubUnitId === sellB.id);
  if (towerMirror && (towerMirror.startingAdr ?? 0) === 0) pass('new parent Sellable mirror lands with ADR=0');
  else fail('new mirror ADR=0', `expected hotel.startingAdr=0, got ${towerMirror?.startingAdr}`);
  const stale = out.find((u: SubUnit) => u.id === 'old-2');
  if (!stale) pass('stale companion sub-unit (no matching parent) dropped');
  else fail('stale drop', 'companion sub-unit whose parent vanished still present');

  // Idempotency: running migration twice yields identical subUnits array.
  // Wrap migrated back into a v8-shaped snapshot so hydrationFromAnySnapshot
  // recognises it as already-current.
  const migratedAgain = hydrationFromAnySnapshot({ ...migrated, version: 8, savedAt: '2026-05-12T00:00:00Z' });
  const equalLengths = migratedAgain.subUnits.length === migrated.subUnits.length;
  if (equalLengths) pass('migration idempotent (run twice = same length)');
  else fail('migration idempotent', `lengths differ: ${migrated.subUnits.length} vs ${migratedAgain.subUnits.length}`);
}

// ── Section 9: em-dash sweep ──────────────────────────────────────────────
console.log('\n[9/9] Em-dash sweep on touched files');
{
  const files = [
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
    'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts',
    'src/core/calculations/index.ts',
    'scripts/verify-tab2-fixes.ts',
  ];
  for (const rel of files) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    // Only flag em-dashes added on T2 lines: we cannot diff easily here,
    // so just check that the FILE contains no em-dashes at all in T2
    // contexts. The repo retains legacy em-dashes; sweep checks just
    // the new T2-Fix markers / docs.
    const t2Lines = txt.split(/\r?\n/).filter((l) => l.includes('T2-Fix'));
    const offending = t2Lines.filter((l) => l.includes('—'));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T2-Fix lines`);
    else fail(`${rel}: em-dashes`, `T2 lines: ${offending.length}`);
  }
}

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
