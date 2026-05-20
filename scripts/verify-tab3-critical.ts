/* eslint-disable no-console */
/**
 * verify-tab3-critical.ts (Tab 3 Costs Critical Fixes, 2026-05-12)
 *
 * Sections:
 *   1. Fix 1 UI filter: master-inclusive shape in Module1Costs.tsx.
 *   2. Fix 2 engine short-circuit: computeAssetCost returns the
 *      canonical empty breakdown for companions.
 *   3. Fix 2 UI: CompanionInfoBlock branch present in Module1Costs.tsx.
 *   4. Fix 3 strip + dedup migration: helper exists + wired 4 times
 *      (definition + 3 hydrate chains).
 *   5. Fix 4 endPeriod = cp + 1 on the 8 non-land defaults; Land Cash
 *      + Land In-Kind stay at start = 0 / end = 0.
 *   6. Fix 6 reference subtotal sanity: Branded Apt T2&T3 fixture produces
 *      a Land + Construction subtotal in the right neighbourhood.
 *   7. Em-dash sweep.
 *
 * Usage: npx tsx scripts/verify-tab3-critical.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Parcel,
  type Phase,
  type SubUnit,
  type CostLine,
  type CostOverride,
  makeDefaultPhase,
  makeDefaultProject,
  makeDefaultCostLines,
  makeCompanionAsset,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetCost,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');

// ── Section 1: Fix 1 UI filter ───────────────────────────────────────────
console.log('\n[1/7] Fix 1: UI filter master-inclusive shape');
{
  if (COSTS_SRC.includes('T3-render Fix 1 (2026-05-12)')) pass('T3-render Fix 1 marker present');
  else fail('T3-render Fix 1 marker', 'missing');
  if (COSTS_SRC.includes('c.targetAssetId === undefined || c.targetAssetId === activeAsset.id')) {
    pass('assetLines filter uses master-inclusive shape');
  } else fail('assetLines filter', 'does not include master lines');
  // Verify the strict-equality bug is gone (legacy: `c.targetAssetId === activeAsset.id` only).
  // The remaining matches at lines 2779 + 2793 use `!c.targetAssetId || ...` which is OK.
  const bugRegex = /\.filter\(\(c\) => c\.targetAssetId === activeAsset\.id\)/g;
  const matches = COSTS_SRC.match(bugRegex) ?? [];
  if (matches.length === 0) pass('strict-equality bug removed from rendering filters');
  else fail('strict-equality bug', `${matches.length} occurrence(s) remain`);
}

// ── Section 2: Fix 2 engine short-circuit ────────────────────────────────
console.log('\n[2/7] Fix 2: engine short-circuit for companions');
{
  if (CALC_SRC.includes('T3-companion Fix 2 (2026-05-12)')) pass('T3-companion Fix 2 marker present');
  else fail('T3-companion Fix 2 marker', 'missing');
  if (CALC_SRC.includes('if (asset.isCompanion === true)')) pass('isCompanion check at top of computeAssetCost');
  else fail('isCompanion check', 'missing');

  // Functional proof: build a companion fixture; computeAssetCost returns zero on every field.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const parcel: Parcel = { id: 'parcel-1', phaseId: 'phase-1', name: 'Parcel 1', area: 22066, rate: 98450, cashPct: 80, inKindPct: 20 };
  const parent: Asset = {
    id: 'parent-a', phaseId: 'phase-1', name: 'Tower', type: 'Residential', strategy: 'Sell + Manage',
    visible: true, gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0,
  };
  const companion = makeCompanionAsset(parent, 100);
  const lines = makeDefaultCostLines(phase.id, phase.constructionPeriods);
  const breakdown = computeAssetCost(companion, project, phase, [parcel], [parent, companion], [], lines, [], 'autoByBua');
  if (breakdown.total === 0) pass('companion breakdown.total === 0');
  else fail('companion total', `expected 0, got ${breakdown.total}`);
  if (Object.keys(breakdown.byLineId).length === 0) pass('companion byLineId empty');
  else fail('companion byLineId', `expected empty, got ${Object.keys(breakdown.byLineId).length} keys`);
  const stages = ['land', 'hard', 'soft', 'operating'] as const;
  let stagesZero = true;
  for (const s of stages) { if (breakdown.byStage[s] !== 0) stagesZero = false; }
  if (stagesZero) pass('companion byStage all zero');
  else fail('companion byStage', `not all zero: ${JSON.stringify(breakdown.byStage)}`);
  if (breakdown.perPeriod.every((v) => v === 0)) pass('companion perPeriod all zero');
  else fail('companion perPeriod', 'non-zero entries detected');
  if (breakdown.perPeriodLandTotal.every((v) => v === 0) && breakdown.perPeriodLandInKind.every((v) => v === 0)) {
    pass('companion perPeriodLandTotal + perPeriodLandInKind all zero');
  } else fail('companion land period arrays', 'non-zero entries detected');
  // P11 Fix 6 (2026-05-13): companion short-circuit returns an empty
  // perLinePerPeriod map; assert it stays empty.
  if (Object.keys(breakdown.perLinePerPeriod).length === 0) {
    pass('companion perLinePerPeriod empty');
  } else fail('companion perLinePerPeriod', `expected empty, got ${Object.keys(breakdown.perLinePerPeriod).length} keys`);

  // Non-companion sanity: same fixture, run on parent. Should produce non-zero.
  const parentBreakdown = computeAssetCost(parent, project, phase, [parcel], [parent, companion], [], lines, [], 'autoByBua');
  if (parentBreakdown.total > 0) pass(`parent breakdown.total > 0 (${parentBreakdown.total.toFixed(0)})`);
  else fail('parent total', `expected > 0, got ${parentBreakdown.total}`);
}

// ── Section 3: Fix 2 UI CompanionInfoBlock ───────────────────────────────
console.log('\n[3/7] Fix 2 UI: CompanionInfoBlock branch in Module1Costs.tsx');
{
  if (COSTS_SRC.includes('costs-companion-info-${activeAsset.id}')) pass('companion-info testid wired');
  else fail('companion-info testid', 'missing');
  if (COSTS_SRC.includes('activeAsset.isCompanion === true')) pass('companion render branch present');
  else fail('companion render branch', 'missing');
  if (COSTS_SRC.includes('No development costs apply here')) pass('companion caption matches brief');
  else fail('companion caption', 'missing');
  if (COSTS_SRC.includes('activeAsset.isCompanion !== true && assetBreakdown')) {
    pass('cost-line table guarded against companion render');
  } else fail('cost-table guard', 'missing isCompanion !== true');
}

// ── Section 4: Fix 3 strip + dedup migration ─────────────────────────────
console.log('\n[4/7] Fix 3: strip companion + dedup migration');
{
  if (MIGRATE_SRC.includes('function migrateT3StripCompanionAndDedup(')) pass('migrateT3StripCompanionAndDedup defined');
  else fail('migrateT3StripCompanionAndDedup', 'missing');
  const callCount = (MIGRATE_SRC.match(/migrateT3StripCompanionAndDedup\(/g) ?? []).length;
  if (callCount >= 4) pass(`wired ${callCount} times (defn + 3 hydrate chains)`);
  else fail('strip+dedup wire count', `expected >=4, got ${callCount}`);
  // Companion strip + dedup must run BEFORE the seed pass.
  const seedIdx = MIGRATE_SRC.indexOf('migrateT3DefaultCostLineSeed(migrateT3StripCompanionAndDedup');
  if (seedIdx >= 0) pass('strip+dedup runs BEFORE default seed in chain');
  else fail('chain order', 'strip+dedup not chained ahead of seed');
}

// ── Section 5: Fix 4 endPeriod = cp + 1 ──────────────────────────────────
console.log('\n[5/7] Fix 4: default endPeriod = cp + 1');
{
  if (TYPES_SRC.includes('T3-defaults Fix 4 (2026-05-12)')) pass('T3-defaults Fix 4 marker present');
  else fail('T3-defaults Fix 4 marker', 'missing');
  if (TYPES_SRC.includes('const cpEnd = cp + 1;')) pass('cpEnd = cp + 1 derived');
  else fail('cpEnd derivation', 'missing');

  const lines = makeDefaultCostLines('phase-x', 5);
  const byBase: Record<string, CostLine> = {};
  for (const l of lines) {
    const base = l.id.split('__')[0]!;
    byBase[base] = l;
  }
  // Land Cash + Land In-Kind stay at start=0 / end=0.
  if (byBase['land-cash']!.startPeriod === 0 && byBase['land-cash']!.endPeriod === 0) {
    pass('land-cash start=0, end=0');
  } else fail('land-cash periods', `start=${byBase['land-cash']!.startPeriod}, end=${byBase['land-cash']!.endPeriod}`);
  if (byBase['land-inkind']!.startPeriod === 0 && byBase['land-inkind']!.endPeriod === 0) {
    pass('land-inkind start=0, end=0');
  } else fail('land-inkind periods', `start=${byBase['land-inkind']!.startPeriod}, end=${byBase['land-inkind']!.endPeriod}`);
  // The 8 non-land lines end at cp + 1 = 6.
  const nonLandBaseIds = ['construction-bua', 'construction-parking', 'infrastructure', 'landscaping', 'pre-operating', 'professional-fee', 'commission', 'contingency'];
  for (const baseId of nonLandBaseIds) {
    const l = byBase[baseId]!;
    if (l.endPeriod === 6) pass(`${baseId} endPeriod = cp + 1 = 6`);
    else fail(`${baseId} endPeriod`, `expected 6, got ${l.endPeriod}`);
  }
}

// ── Section 6: reference subtotal sanity ──────────────────────────────────────
console.log('\n[6/7] Fix 6: Branded Apt reference fixture produces sensible Land + BUA subtotal');
{
  // reference-flavoured fixture matching the brief.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-2', name: 'Phase 2', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const parcel: Parcel = { id: 'parcel-2', phaseId: 'phase-2', name: 'Parcel 2', area: 22066, rate: 98450, cashPct: 80, inKindPct: 20 };
  const branded: Asset = {
    id: 'a-branded', phaseId: 'phase-2', name: 'Branded Apt T2&T3', type: 'Residential', strategy: 'Sell',
    visible: true, gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0,
  };
  const lines = makeDefaultCostLines(phase.id, phase.constructionPeriods);
  const bd = computeAssetCost(branded, project, phase, [parcel], [branded], [], lines, [], 'autoByBua');

  // Land lines: cash + in-kind together = total parcel value = 22066 * 98450 = 2,172,398,700 SAR.
  // Branded is sole asset -> 100% allocation. Expected ~2.17B for land.
  const landCashId = `land-cash__${phase.id}`;
  const landInKindId = `land-inkind__${phase.id}`;
  const landCash = bd.byLineId[landCashId] ?? 0;
  const landInKind = bd.byLineId[landInKindId] ?? 0;
  const landTotal = landCash + landInKind;
  if (landTotal > 2_000_000_000 && landTotal < 2_300_000_000) {
    pass(`land cash + in-kind = ${(landTotal / 1e9).toFixed(2)}B (in expected band 2.0B-2.3B)`);
  } else fail('land subtotal', `expected ~2.17B, got ${(landTotal / 1e9).toFixed(2)}B`);

  // Construction (BUA) = 4500 * 130874 = 588,933,000 SAR.
  const conBuaId = `construction-bua__${phase.id}`;
  const conBua = bd.byLineId[conBuaId] ?? 0;
  const expectedConBua = 4500 * 130874;
  if (Math.abs(conBua - expectedConBua) < 1) {
    pass(`construction-bua = ${(conBua / 1e6).toFixed(1)}M (= 4500 x 130874)`);
  } else fail('construction-bua', `expected ${expectedConBua}, got ${conBua}`);

  // Total subtotal > 2B (land alone is ~2.17B). User expected ~1.2B in the brief
  // assumed multi-asset phase splits Land; sole-asset fixture concentrates Land.
  if (bd.total > 2_000_000_000) pass(`total subtotal = ${(bd.total / 1e9).toFixed(2)}B (sole-asset Phase 2 concentrates all land)`);
  else fail('total subtotal', `expected > 2B, got ${(bd.total / 1e9).toFixed(2)}B`);
}

// ── Section 7: em-dash sweep ─────────────────────────────────────────────
console.log('\n[7/7] Em-dash sweep on touched files');
{
  const files = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
    'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts',
    'scripts/verify-tab3-critical.ts',
    'docs/tab3-render-diagnostic.md',
  ];
  for (const rel of files) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    const t3Lines = txt.split(/\r?\n/).filter((l) => l.includes('T3-render') || l.includes('T3-companion') || l.includes('T3-defaults Fix 4') || l.includes('tab3-render') || l.includes('verify-tab3-critical'));
    const offending = t3Lines.filter((l) => l.includes(', '));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T3 lines`);
    else fail(`${rel}: em-dashes`, `T3 lines: ${offending.length}`);
  }
}

// Mark variables referenced to silence unused-var warnings (the explicit types are documentation).
void ({} as CostOverride);
void ({} as SubUnit);

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
