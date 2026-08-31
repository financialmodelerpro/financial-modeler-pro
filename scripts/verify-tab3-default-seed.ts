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
  STANDARD_COST_LINE_IDS,
  SEEDED_COST_LINE_IDS,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

// 2026-08-15: the catalog size is DERIVED, not hardcoded. It was written as a
// literal 10 (and 30 for three phases), so adding `rett` and `marketing` broke
// six checks that were not testing anything about the new lines. The size of
// the catalog is not the invariant; "the seed emits exactly the registered
// catalog" is, and that survives the next addition.
/**
 * WHAT THE SEED EMITS, not what the platform recognises (2026-08-31).
 *
 * This counted `STANDARD_COST_LINE_IDS`, which is the IDENTITY REGISTRY: every
 * id the platform knows, what an existing line resolves its behaviour through,
 * and what the row picker can offer. The SEED set is a different thing, and
 * conflating the two is what this file was doing. It expected 13 and the seeder
 * correctly produces 12.
 *
 * The difference is exactly `rett`, which is REGISTERED BUT NOT SEEDED since
 * 2026-08-17c. It used to be seeded and country gated, so on most projects it
 * was present but invisible, which let the engine charge a row nobody could see
 * and later let selecting a country double a cost the user had already entered.
 * A transfer tax is now added from the catalog like any other cost.
 *
 * `SEEDED_COST_LINE_IDS` is DERIVED from the seed, and verify-no-hidden-cost-lines
 * pins that it equals what the seeder actually emits, so this constant cannot
 * drift from the seeder the way a hand-kept number would. The three other
 * verifiers that count seeded lines (capex-phasing, new-project-defaults,
 * no-hidden-cost-lines) already use it; this file was the one holdout.
 */
const CATALOG = SEEDED_COST_LINE_IDS.length;
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
  if (phaseLines.length === CATALOG) pass(`phase-1 seeded with the full catalog (${CATALOG} lines)`);
  else fail('default line count', `expected ${CATALOG}, got ${phaseLines.length}`);

  // THE WHOLE SEED SET, IN ORDER, not ten of it. The hand-kept list below
  // covered ten of the twelve seeded ids and silently omitted developer-fee and
  // marketing, so either could have stopped seeding without this file noticing.
  // Reading the set from the same constant the count uses also means a line
  // added to the catalog cannot pass here by being absent from a literal.
  if (JSON.stringify(phaseLines.map((c) => c.id.split('__')[0])) === JSON.stringify([...SEEDED_COST_LINE_IDS])) {
    pass(`phase-1 seeds the whole seed set, in order (${CATALOG} lines)`);
  } else {
    fail('phase-1 seed set',
      `${phaseLines.map((c) => c.id.split('__')[0]).join(',')} vs ${SEEDED_COST_LINE_IDS.join(',')}`);
  }
  // The transfer tax is REGISTERED but must never arrive by seeding: that is
  // the present-but-invisible row this whole arrangement exists to prevent.
  if ((STANDARD_COST_LINE_IDS as readonly string[]).includes('rett')
    && !phaseLines.some((c) => c.id.split('__')[0] === 'rett')) {
    pass('the transfer tax stays a known id that is NOT seeded');
  } else fail('transfer tax', 'either it is no longer registered, or it was seeded');

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
    if (slice.length === CATALOG) pass(`${phaseId}: ${CATALOG} lines seeded`);
    else fail(`${phaseId} count`, `expected ${CATALOG}, got ${slice.length}`);
  }
  if (lines.length === CATALOG * 3) pass(`total = ${CATALOG * 3} lines across 3 phases`);
  else fail('total count', `expected ${CATALOG * 3}, got ${lines.length}`);

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
  if (phase2Lines.length === CATALOG) pass(`phase-2 seeded with the full catalog (${CATALOG} lines)`);
  else fail('phase-2 seed', `expected ${CATALOG}, got ${phase2Lines.length}`);
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
  // Construction BUA: method=rate_per_bua, stage=hard, and a rate of ZERO.
  //
  // 2026-08-15: this asserted value=4500, the reference benchmark rate. The seed
  // now ships blank on every product path, because the rows arrive switched On
  // and a seeded rate is indistinguishable from a typed one, so a user who did
  // not notice them was costing the scheme at a rate they never chose. The
  // SHAPE is still pinned here; only the rate changed, and it must be zero.
  const conBua = lines.find((c) => c.id === 'construction-bua__phase-1');
  if (conBua?.method === 'rate_per_bua' && conBua.value === 0 && conBua.stage === 'hard') {
    pass('construction-bua rate_per_bua, BLANK rate (hard stage)');
  } else fail('construction-bua shape', `method=${conBua?.method}, value=${conBua?.value}, stage=${conBua?.stage}`);
  // The land rows are the deliberate exception: locked derivations of the
  // parcels the user typed, asserted at 100 above. Nothing else may carry a rate.
  const seededRates = lines.filter((c) => c.isLocked !== true && c.value !== 0);
  if (seededRates.length === 0) pass('no editable seeded line carries a rate');
  else fail('blank seed', seededRates.map((c) => `${c.id}=${c.value}`).join(', '));
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
    const offending = t3Lines.filter((l) => l.includes('\u2014'));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T3 lines`);
    else fail(`${rel}: em-dashes`, `T3 lines: ${offending.length}`);
  }
}

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
