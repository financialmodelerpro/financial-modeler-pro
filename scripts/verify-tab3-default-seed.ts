/* eslint-disable no-console */
/**
 * verify-tab3-default-seed.ts (Tab 3 default cost line seed regression, 2026-05-12)
 *
 * Hydrates a snapshot with EMPTY costLines and verifies the migration
 * re-seeds the 10 default cost lines per phase. Covers the regression
 * where projects opened after Pass 10 hybrid migration could land with
 * costLines: [] and Tab 3 rendered with no cost lines.
 *
 * Sections:
 *   1. Helper presence + chain wiring.
 *   2. Empty single-phase snapshot -> 10 default lines for that phase.
 *   3. Empty multi-phase snapshot -> 10 default lines per phase, unique
 *      composed ids.
 *   4. Snapshot with some lines on phase A + empty phase B -> phase A
 *      preserved, phase B seeded.
 *   5. Snapshot with all phases populated -> migration is a no-op
 *      (idempotency).
 *   6. Locked land lines render correctly (Land Cash + Land In-Kind
 *      with isLocked=true, method=percent_of_cash_land/inkind_land).
 *   7. Em-dash sweep.
 *
 * Usage: npx tsx scripts/verify-tab3-default-seed.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type CostLine,
  type Phase,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');

// Helper: build a v8 loose snapshot with given phases + empty costLines.
function makeEmptySnap(phases: Phase[]): unknown {
  return {
    project: makeDefaultProject(),
    phases,
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [],
    subUnits: [],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
}

// ── Section 1: helper + chain wiring ─────────────────────────────────────
console.log('\n[1/7] Helper + chain wiring');
{
  if (MIGRATE_SRC.includes('function migrateT3DefaultCostLineSeed(')) {
    pass('migrateT3DefaultCostLineSeed defined');
  } else fail('migrateT3DefaultCostLineSeed', 'missing');
  const calls = (MIGRATE_SRC.match(/migrateT3DefaultCostLineSeed\(/g) ?? []).length;
  if (calls >= 4) pass(`wired ${calls} times (defn + 3 hydrate chains)`);
  else fail('migration wire count', `expected >=4, got ${calls}`);
}

// ── Section 2: empty single-phase snapshot ───────────────────────────────
console.log('\n[2/7] Empty single-phase snapshot seeds 10 default lines');
{
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const loose = makeEmptySnap([phase]);
  const out = hydrationFromAnySnapshot(loose);
  const lines = out.costLines as CostLine[];
  const phaseLines = lines.filter((c) => c.phaseId === 'phase-1');
  if (phaseLines.length === 10) pass(`phase-1 seeded with 10 default lines`);
  else fail('default line count', `expected 10, got ${phaseLines.length}`);

  // Spot-check each expected base id.
  const expectedBaseIds = [
    'land-cash', 'land-inkind', 'construction-bua', 'construction-parking',
    'infrastructure', 'landscaping', 'pre-operating', 'professional-fee',
    'commission', 'contingency',
  ];
  for (const baseId of expectedBaseIds) {
    const composedId = `${baseId}__phase-1`;
    const found = phaseLines.find((c) => c.id === composedId);
    if (found) pass(`  ${baseId} present (id=${composedId})`);
    else fail(`  ${baseId}`, 'missing');
  }
}

// ── Section 3: empty multi-phase snapshot ────────────────────────────────
console.log('\n[3/7] Empty multi-phase snapshot seeds per phase');
{
  const phase1: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const phase2: Phase = { ...makeDefaultPhase(), id: 'phase-2', name: 'Phase 2', constructionPeriods: 4, operationsPeriods: 10, overlapPeriods: 0 };
  const phase3: Phase = { ...makeDefaultPhase(), id: 'phase-3', name: 'Phase 3', constructionPeriods: 6, operationsPeriods: 12, overlapPeriods: 0 };
  const loose = makeEmptySnap([phase1, phase2, phase3]);
  const out = hydrationFromAnySnapshot(loose);
  const lines = out.costLines as CostLine[];
  for (const phaseId of ['phase-1', 'phase-2', 'phase-3']) {
    const slice = lines.filter((c) => c.phaseId === phaseId);
    if (slice.length === 10) pass(`${phaseId}: 10 lines seeded`);
    else fail(`${phaseId} count`, `expected 10, got ${slice.length}`);
  }
  if (lines.length === 30) pass(`total = 30 lines across 3 phases`);
  else fail('total count', `expected 30, got ${lines.length}`);

  // All ids must be unique.
  const idSet = new Set(lines.map((c) => c.id));
  if (idSet.size === lines.length) pass('all line ids unique across phases (composed ids)');
  else fail('id uniqueness', `${lines.length - idSet.size} duplicates`);
}

// ── Section 4: partial pre-existing lines (realistic: phase has assets) ─
console.log('\n[4/7] Phase A has lines + asset, Phase B empty + asset: A preserved, B seeded');
{
  const phase1: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const phase2: Phase = { ...makeDefaultPhase(), id: 'phase-2', name: 'Phase 2', constructionPeriods: 4, operationsPeriods: 10, overlapPeriods: 0 };
  // Real scenario: both phases have a visible asset (Pass 7 migration
  // drops master lines for phase-asset count 0, so we need an asset to
  // make this representative of an actual user project). phase-1 carries
  // its full default-shape catalog; phase-2 lost its lines (the
  // regression we're fixing).
  const phase1Defaults: CostLine[] = [{
    id: 'land-cash__phase-1', phaseId: 'phase-1', name: 'Land (Cash)',
    method: 'percent_of_cash_land', value: 100,
    stage: 'land', scope: 'direct', allocationBasis: 'land_share',
    startPeriod: 0, endPeriod: 0, phasing: 'even', isLocked: true,
  }];
  const loose: unknown = {
    ...(makeEmptySnap([phase1, phase2]) as Record<string, unknown>),
    assets: [
      { id: 'a1', phaseId: 'phase-1', name: 'Asset 1', type: '', strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 100, sellableBuaSqm: 80, parkingBaysRequired: 0 },
      { id: 'a2', phaseId: 'phase-2', name: 'Asset 2', type: '', strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 100, sellableBuaSqm: 80, parkingBaysRequired: 0 },
    ],
    costLines: phase1Defaults,
  };
  const out = hydrationFromAnySnapshot(loose);
  const lines = out.costLines as CostLine[];
  const phase1Lines = lines.filter((c) => c.phaseId === 'phase-1');
  const phase2Lines = lines.filter((c) => c.phaseId === 'phase-2');
  // Phase 1 has 1 user line going in. Pass 7 keeps it as a per-asset
  // replica (1 asset in phase-1). Pass 10 hybrid reverts it to master
  // (1 line). T3 seed sees 1 line in phase-1, skips. Result: 1.
  if (phase1Lines.length === 1) {
    pass(`phase-1 preserved (1 user line stayed; no default seed)`);
  } else fail('phase-1 preserved', `expected 1, got ${phase1Lines.length}`);
  // Phase 2 has 0 lines going in. T3 seed kicks in. Result: 10.
  if (phase2Lines.length === 10) pass('phase-2 seeded with 10 default lines');
  else fail('phase-2 seed', `expected 10, got ${phase2Lines.length}`);
}

// ── Section 5: idempotency ───────────────────────────────────────────────
console.log('\n[5/7] Idempotency: second hydrate is a no-op');
{
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const loose = makeEmptySnap([phase]);
  const out1 = hydrationFromAnySnapshot(loose);
  const out2 = hydrationFromAnySnapshot({ ...out1, version: 8, savedAt: '2026-05-12T00:00:00Z' });
  const lines1 = out1.costLines as CostLine[];
  const lines2 = out2.costLines as CostLine[];
  if (lines1.length === lines2.length) pass(`length stable: ${lines1.length} -> ${lines2.length}`);
  else fail('idempotency length', `${lines1.length} -> ${lines2.length}`);
  const ids1 = lines1.map((c) => c.id).sort();
  const ids2 = lines2.map((c) => c.id).sort();
  if (JSON.stringify(ids1) === JSON.stringify(ids2)) pass('ids stable across re-hydrate');
  else fail('idempotency ids', 'id set changed on second pass');
}

// ── Section 6: locked land lines correctness ─────────────────────────────
console.log('\n[6/7] Locked land lines have correct shape');
{
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 };
  const out = hydrationFromAnySnapshot(makeEmptySnap([phase]));
  const lines = (out.costLines as CostLine[]).filter((c) => c.phaseId === 'phase-1');
  const landCash = lines.find((c) => c.id === 'land-cash__phase-1');
  const landInKind = lines.find((c) => c.id === 'land-inkind__phase-1');
  if (landCash?.isLocked === true) pass('land-cash isLocked=true');
  else fail('land-cash lock', `isLocked=${landCash?.isLocked}`);
  if (landCash?.method === 'percent_of_cash_land' && landCash.value === 100) {
    pass('land-cash method=percent_of_cash_land, value=100');
  } else fail('land-cash shape', `method=${landCash?.method}, value=${landCash?.value}`);
  if (landInKind?.isLocked === true) pass('land-inkind isLocked=true');
  else fail('land-inkind lock', `isLocked=${landInKind?.isLocked}`);
  if (landInKind?.method === 'percent_of_inkind_land' && landInKind.value === 100) {
    pass('land-inkind method=percent_of_inkind_land, value=100');
  } else fail('land-inkind shape', `method=${landInKind?.method}, value=${landInKind?.value}`);
  // Construction BUA defaults: method=rate_per_bua, value=4500, stage=hard.
  const conBua = lines.find((c) => c.id === 'construction-bua__phase-1');
  if (conBua?.method === 'rate_per_bua' && conBua.value === 4500 && conBua.stage === 'hard') {
    pass('construction-bua rate_per_bua x 4500 (hard stage)');
  } else fail('construction-bua shape', `method=${conBua?.method}, value=${conBua?.value}, stage=${conBua?.stage}`);
}

// ── Section 7: em-dash sweep ─────────────────────────────────────────────
console.log('\n[7/7] Em-dash sweep');
{
  const files = [
    'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts',
    'scripts/verify-tab3-default-seed.ts',
  ];
  for (const rel of files) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    const t3Lines = txt.split(/\r?\n/).filter((l) => l.includes('T3-defaults') || l.includes('verify-tab3'));
    const offending = t3Lines.filter((l) => l.includes('—'));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T3 lines`);
    else fail(`${rel}: em-dashes`, `T3 lines: ${offending.length}`);
  }
}

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
