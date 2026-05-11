/* eslint-disable no-console */
/**
 * verify-m20L-pass5.ts (M2.0L Pass 5 verifier, 2026-05-11)
 *
 * Cost Category + Driver + auto-derived Type. Layers on top of Pass 4
 * inheritance (NOT a rewrite). Asserts:
 *   1. Schema: CostLine gains costCategory + costDriver; new
 *      CostCategory / CostDriver / CostType enums + label maps.
 *   2. Migration: migrateM20Pass5Categories stamps legacy lines with
 *      costCategory='direct'; PASS5_MIGRATION_NOTICE banner exported.
 *   3. Calc engine: Allocated lines pool via aggregated metrics +
 *      driver-share per asset; Direct lines preserve Pass 3 semantics
 *      (rate x asset.metric, no allocation factor on non-fixed methods).
 *   4. UI source markers: Category + Driver dropdowns on master row;
 *      Category badge in per-asset replicas; sub-unit Units-mode area
 *      caption row.
 *
 * Usage: npx tsx scripts/verify-m20L-pass5.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type CostCategory,
  type CostDriver,
  type CostType,
  type CostLine,
  type CostOverride,
  type Asset,
  type SubUnit,
  COST_CATEGORIES,
  COST_DRIVERS,
  COST_TYPES,
  makeDefaultPhase,
  makeDefaultParcel,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  PASS5_MIGRATION_NOTICE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  computeAssetCost,
  deriveCostType,
  resolveCostCategory,
  resolveCostDriver,
  resolveDriverFactor,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

// ── Section 1: Schema ─────────────────────────────────────────────────────
console.log('\n[1/4] Schema + type surface');
{
  if (COST_CATEGORIES.length === 2 && COST_CATEGORIES.includes('direct') && COST_CATEGORIES.includes('allocated')) {
    pass('COST_CATEGORIES enum has 2 members');
  } else fail('COST_CATEGORIES enum', `got ${JSON.stringify(COST_CATEGORIES)}`);

  if (COST_DRIVERS.length === 3 && COST_DRIVERS.includes('bua_share') && COST_DRIVERS.includes('land_share') && COST_DRIVERS.includes('value_share')) {
    pass('COST_DRIVERS enum has 3 members');
  } else fail('COST_DRIVERS enum', `got ${JSON.stringify(COST_DRIVERS)}`);

  if (COST_TYPES.length === 5) pass('COST_TYPES enum has 5 members');
  else fail('COST_TYPES enum', `got ${JSON.stringify(COST_TYPES)}`);

  const sampleLine: CostLine = {
    id: 'land-cash__phase_1',
    phaseId: 'phase_1',
    name: 'Land (Cash)',
    method: 'percent_of_cash_land',
    value: 100,
    stage: 'land',
    scope: 'direct',
    allocationBasis: 'land_share',
    startPeriod: 0,
    endPeriod: 0,
    phasing: 'even',
    costCategory: 'direct',
    costDriver: undefined,
  };
  if (sampleLine.costCategory === 'direct') pass('CostLine.costCategory accepted');
  else fail('CostLine.costCategory', 'unexpected');

  if (deriveCostType(sampleLine) === 'land_cash') pass('deriveCostType -> land_cash for percent_of_cash_land');
  else fail('deriveCostType land_cash', `got ${deriveCostType(sampleLine)}`);

  const inkindLine: CostLine = { ...sampleLine, id: 'land-inkind__phase_1', method: 'percent_of_inkind_land' };
  if (deriveCostType(inkindLine) === 'land_in_kind') pass('deriveCostType -> land_in_kind');
  else fail('deriveCostType land_in_kind', `got ${deriveCostType(inkindLine)}`);

  const hardLine: CostLine = { ...sampleLine, id: 'construction-bua__phase_1', method: 'rate_per_bua', stage: 'hard' };
  if (deriveCostType(hardLine) === 'hard') pass('deriveCostType -> hard for stage=hard');
  else fail('deriveCostType hard', `got ${deriveCostType(hardLine)}`);

  const softLine: CostLine = { ...sampleLine, id: 'professional-fee__phase_1', method: 'percent_of_selected', stage: 'soft' };
  if (deriveCostType(softLine) === 'soft') pass('deriveCostType -> soft for stage=soft');
  else fail('deriveCostType soft', `got ${deriveCostType(softLine)}`);
}

// ── Section 2: Migration ──────────────────────────────────────────────────
console.log('\n[2/4] Migration');
{
  const phase = makeDefaultPhase();
  const parcel = makeDefaultParcel(undefined, phase.id);
  const project = makeDefaultProject();
  const legacyLine: Partial<CostLine> = {
    id: 'construction-bua__phase_1',
    phaseId: phase.id,
    name: 'Construction (BUA)',
    method: 'rate_per_bua',
    value: 4500,
    stage: 'hard',
    scope: 'direct',
    allocationBasis: 'bua_share',
    startPeriod: 1,
    endPeriod: 4,
    phasing: 'even',
    // costCategory intentionally absent
  };
  const snapshot = {
    version: 8 as const,
    project,
    phases: [phase],
    parcels: [parcel],
    landAllocationMode: 'autoByBua' as const,
    assets: [],
    subUnits: [],
    costLines: [legacyLine as CostLine],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };

  const result = hydrationFromAnySnapshotChecked(snapshot);
  if (result.migrationNotice === PASS5_MIGRATION_NOTICE) pass('Pass 5 banner emitted');
  else fail('Pass 5 banner emitted', `notice = ${String(result.migrationNotice)}`);

  const migrated = result.snapshot.costLines[0];
  if (migrated && migrated.costCategory === 'direct') pass('Legacy line stamped costCategory=direct');
  else fail('Legacy line stamped costCategory=direct', `got costCategory=${String(migrated?.costCategory)}`);

  // Idempotency
  const idemp = hydrationFromAnySnapshotChecked({ version: 8 as const, ...result.snapshot });
  if (idemp.migrationNotice === undefined) pass('Migration idempotent on already-Pass-5-shaped snapshot');
  else fail('Migration idempotent', `re-fired with ${String(idemp.migrationNotice)}`);
}

// ── Section 3: Calc engine routing ────────────────────────────────────────
console.log('\n[3/4] Calc engine - Direct vs Allocated routing');
{
  const phase = makeDefaultPhase('phase_1', 'Phase 1', 4, 60, 0);
  const parcel = makeDefaultParcel(undefined, phase.id);
  const project = makeDefaultProject();

  const assetA: Asset = {
    id: 'asset_a',
    phaseId: phase.id,
    name: 'Asset A',
    type: '',
    strategy: 'Sell',
    visible: true,
    gfaSqm: 60000,
    buaSqm: 50000,
    sellableBuaSqm: 40000,
    parkingBaysRequired: 100,
  };
  const assetB: Asset = { ...assetA, id: 'asset_b', name: 'Asset B', buaSqm: 30000, sellableBuaSqm: 25000 };
  const subUnits: SubUnit[] = [];

  // Direct rate_per_bua, value 4500. Each asset's contribution = 4500 x asset.bua.
  const directLine: CostLine = {
    id: 'construction-bua__phase_1',
    phaseId: phase.id,
    name: 'Construction (BUA) Direct',
    method: 'rate_per_bua',
    value: 4500,
    stage: 'hard',
    scope: 'direct',
    allocationBasis: 'per_asset',
    startPeriod: 1,
    endPeriod: 4,
    phasing: 'even',
    costCategory: 'direct',
  };
  const bdDirectA = computeAssetCost(assetA, project, phase, [parcel], [assetA, assetB], subUnits, [directLine], [], 'autoByBua');
  const bdDirectB = computeAssetCost(assetB, project, phase, [parcel], [assetA, assetB], subUnits, [directLine], [], 'autoByBua');
  const dirA = bdDirectA.byLineId['construction-bua__phase_1'] ?? 0;
  const dirB = bdDirectB.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(dirA - 225_000_000) < 0.5) pass('Direct A = 4500 x 50,000 = 225M');
  else fail('Direct A = 225M', `got ${dirA.toLocaleString()}`);
  if (Math.abs(dirB - 135_000_000) < 0.5) pass('Direct B = 4500 x 30,000 = 135M');
  else fail('Direct B = 135M', `got ${dirB.toLocaleString()}`);

  // Allocated rate_per_bua with bua_share driver. Pool = 4500 x 80,000 = 360M.
  // Asset A share = 50/80 = 62.5% -> 225M. Asset B = 30/80 = 37.5% -> 135M.
  // (Equivalent to Direct because driver matches the method - intentional, test validates the math route.)
  const allocBua: CostLine = { ...directLine, name: 'Allocated BUA pool', costCategory: 'allocated', costDriver: 'bua_share' };
  const bdAllocA = computeAssetCost(assetA, project, phase, [parcel], [assetA, assetB], subUnits, [allocBua], [], 'autoByBua');
  const bdAllocB = computeAssetCost(assetB, project, phase, [parcel], [assetA, assetB], subUnits, [allocBua], [], 'autoByBua');
  const allA = bdAllocA.byLineId['construction-bua__phase_1'] ?? 0;
  const allB = bdAllocB.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(allA - 225_000_000) < 0.5 && Math.abs(allB - 135_000_000) < 0.5) {
    pass('Allocated rate_per_bua + bua_share = same as Direct equivalent');
  } else {
    fail('Allocated rate_per_bua + bua_share', `A=${allA.toLocaleString()}, B=${allB.toLocaleString()}`);
  }

  // Allocated fixed pool 1,000,000 + bua_share. A = 50/80 x 1M = 625k. B = 375k.
  const allocFixed: CostLine = {
    ...directLine, method: 'fixed', value: 1_000_000, name: 'Allocated Fixed Pool',
    costCategory: 'allocated', costDriver: 'bua_share', allocationBasis: 'per_asset',
  };
  const bdFA = computeAssetCost(assetA, project, phase, [parcel], [assetA, assetB], subUnits, [allocFixed], [], 'autoByBua');
  const bdFB = computeAssetCost(assetB, project, phase, [parcel], [assetA, assetB], subUnits, [allocFixed], [], 'autoByBua');
  const fA = bdFA.byLineId['construction-bua__phase_1'] ?? 0;
  const fB = bdFB.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(fA - 625_000) < 0.5 && Math.abs(fB - 375_000) < 0.5) {
    pass('Allocated fixed 1M + bua_share = 625k / 375k');
  } else {
    fail('Allocated fixed + bua_share', `A=${fA.toLocaleString()}, B=${fB.toLocaleString()}`);
  }

  // Driver factor helpers direct test
  const buaShareA = resolveDriverFactor('bua_share', assetA, [assetA, assetB], [parcel], subUnits, 'autoByBua');
  if (Math.abs(buaShareA - 0.625) < 1e-4) pass('resolveDriverFactor bua_share matches 50/80');
  else fail('resolveDriverFactor bua_share', `got ${buaShareA}`);

  // resolveCostCategory + resolveCostDriver defaults
  if (resolveCostCategory({ ...directLine, costCategory: undefined as unknown as CostCategory }) === 'direct') {
    pass('resolveCostCategory default = direct');
  } else fail('resolveCostCategory default', 'unexpected');
  if (resolveCostDriver({ ...directLine, costDriver: undefined }) === 'bua_share') {
    pass('resolveCostDriver default = bua_share');
  } else fail('resolveCostDriver default', 'unexpected');
}

// ── Section 4: Source markers ─────────────────────────────────────────────
console.log('\n[4/4] Source markers');
{
  const costsPath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  const assetsPath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx');
  const calcPath = resolve(REPO_ROOT, 'src/core/calculations/index.ts');
  const migPath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts');

  if (!existsSync(costsPath)) { fail('Module1Costs.tsx exists', 'missing'); }
  else {
    const src = readFileSync(costsPath, 'utf8');
    const markers: Array<[string, string]> = [
      ['Category dropdown markup', 'data-testid={`cost-${asset.id}-${line.id}-category`}'],
      ['Driver dropdown markup', 'data-testid={`cost-${asset.id}-${line.id}-driver`}'],
      ['Pass 5 master row note', 'M2.0L Pass 5'],
      ['Replica category badge', 'category-badge'],
      ['effCategory wiring', 'effCategory'],
      ['effDriver wiring', 'effDriver'],
    ];
    for (const [name, needle] of markers) {
      if (src.includes(needle)) pass(name);
      else fail(name, `marker "${needle}" not found`);
    }
  }

  if (!existsSync(assetsPath)) { fail('Module1Assets.tsx exists', 'missing'); }
  else {
    const src = readFileSync(assetsPath, 'utf8');
    if (src.includes('subunit-row-${subUnit.id}-caption')) pass('Sub-unit caption row testid present');
    else fail('Sub-unit caption row testid present', 'marker missing');
    if (src.includes('Derived area:')) pass('Sub-unit Derived area caption text present');
    else fail('Sub-unit Derived area caption text present', 'string missing');
  }

  if (!existsSync(calcPath)) { fail('calculations/index.ts exists', 'missing'); }
  else {
    const src = readFileSync(calcPath, 'utf8');
    if (src.includes('resolveDriverFactor')) pass('resolveDriverFactor exported');
    else fail('resolveDriverFactor exported', 'helper missing');
    if (src.includes('deriveCostType')) pass('deriveCostType exported');
    else fail('deriveCostType exported', 'helper missing');
    if (src.includes('aggregatePhaseMetrics(phaseAssets, phaseMetricsByAsset)')) pass('Allocated path uses aggregated metrics');
    else fail('Allocated path uses aggregated metrics', 'wire missing');
  }

  if (!existsSync(migPath)) { fail('module1-migrate.ts exists', 'missing'); }
  else {
    const src = readFileSync(migPath, 'utf8');
    if (src.includes('migrateM20Pass5Categories')) pass('migrateM20Pass5Categories defined');
    else fail('migrateM20Pass5Categories defined', 'helper missing');
    if (src.includes('PASS5_MIGRATION_NOTICE')) pass('PASS5_MIGRATION_NOTICE exported');
    else fail('PASS5_MIGRATION_NOTICE exported', 'constant missing');
  }
}

console.log('');
console.log(`Results: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) { console.log('FAILED'); process.exit(1); }
console.log('OK');
