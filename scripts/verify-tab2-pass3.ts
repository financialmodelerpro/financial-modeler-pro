/* eslint-disable no-console */
/**
 * verify-tab2-pass3.ts (Tab 2 Pass 3 Quick Fixes, 2026-05-12)
 *
 * Asserts each of the 3 quick fixes:
 *   1. Fix 1: 1000-unit tolerance band on Land Recon Equal chip +
 *      "(within rounding tolerance)" captions.
 *   2. Fix 2: makeCompanionAsset uses parent.type; updateAsset
 *      propagates type changes; migrateT2P3CompanionType wired into
 *      all 3 hydrate chains; idempotent.
 *   3. Fix 3: computeOperatingEndDate + formatOperatingEndDate
 *      helpers exist and produce correct dates; AssetCard renders
 *      Operating End Date testid for Operate + companion; M5 hook doc
 *      present.
 *
 * Usage: npx tsx scripts/verify-tab2-pass3.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Phase,
  makeDefaultPhase,
  makeCompanionAsset,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeOperatingEndDate,
  formatOperatingEndDate,
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

// ── Section 1: Fix 1 tolerance band ───────────────────────────────────────
console.log('\n[1/4] Fix 1: 1000-unit tolerance band on Land Recon');
{
  const needles = [
    'SQM_EPSILON = 1000',
    'VALUE_EPSILON = 1000',
    'sqmWithinTolerance',
    'valueWithinTolerance',
    'recon-sqm-tolerance-caption',
    'recon-value-tolerance-caption',
    '(within rounding tolerance)',
  ];
  for (const n of needles) {
    if (ASSETS_SRC.includes(n)) pass(`marker "${n}"`);
    else fail(`marker "${n}"`, 'missing in Module1Assets.tsx');
  }
}

// ── Section 2: Fix 2 companion type inheritance ───────────────────────────
console.log('\n[2/4] Fix 2: companion.type inherits from parent.type');
{
  // Factory
  if (TYPES_SRC.includes('type: parent.type ?? \'\'')) pass('makeCompanionAsset uses parent.type');
  else fail('factory parent.type', 'missing');
  const parent: Asset = {
    id: 'p1', phaseId: 'phase-1', name: 'Residential Tower 01', type: 'Residential',
    strategy: 'Sell + Manage', visible: true, gfaSqm: 0, buaSqm: 50000, sellableBuaSqm: 40000, parkingBaysRequired: 0,
  };
  const comp = makeCompanionAsset(parent, 100);
  if (comp.type === 'Residential') pass(`companion factory inherits type ("${comp.type}")`);
  else fail('companion factory type', `expected "Residential", got "${comp.type}"`);

  // Store live propagation marker
  if (STORE_SRC.includes("if ('type' in patch)")) pass('updateAsset propagates type to companions');
  else fail('updateAsset type propagation', 'guard not found');

  // Migration
  if (MIGRATE_SRC.includes('function migrateT2P3CompanionType(')) pass('migrateT2P3CompanionType defined');
  else fail('migrateT2P3CompanionType', 'missing');
  const wireCount = (MIGRATE_SRC.match(/migrateT2P3CompanionType\(/g) ?? []).length;
  if (wireCount >= 4) pass(`migration wired ${wireCount} times (defn + 3 hydrate chains)`);
  else fail('migration wire count', `expected >=4, got ${wireCount}`);

  // End-to-end migration smoke test: legacy snapshot has companion with empty type;
  // parent has type='Residential'. After hydration, companion.type === 'Residential'.
  const loose: unknown = {
    project: {
      name: 'Test', startDate: '2026-01-01', currency: 'SAR', modelType: 'annual',
      projectType: 'Mixed-Use', country: 'SA', displayScale: 'thousands', displayDecimals: 0,
      outputGranularity: 'annual',
    },
    phases: [{ id: 'phase-1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 8, overlapPeriods: 0 }],
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [
      { ...parent },
      { id: 'companion_p1', phaseId: 'phase-1', name: 'Residential Tower 01 - Operate', type: '', strategy: 'Operate', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, parentAssetId: 'p1', isCompanion: true, companionType: 'operate', unitsFromParent: 100 },
    ],
    subUnits: [],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  const migrated = hydrationFromAnySnapshot(loose);
  const migratedCompanion = migrated.assets.find((a: Asset) => a.isCompanion === true);
  if (migratedCompanion && migratedCompanion.type === 'Residential') {
    pass('migration retroactively inherits parent type ("Residential")');
  } else {
    fail('migration retroactive', `companion.type = "${migratedCompanion?.type}"`);
  }

  // Idempotency.
  const migratedAgain = hydrationFromAnySnapshot({ ...migrated, version: 8, savedAt: '2026-05-12T00:00:00Z' });
  const againCompanion = migratedAgain.assets.find((a: Asset) => a.isCompanion === true);
  if (againCompanion && againCompanion.type === 'Residential') {
    pass('migration idempotent (second pass keeps Residential)');
  } else {
    fail('migration idempotent', `companion.type after 2nd pass = "${againCompanion?.type}"`);
  }
}

// ── Section 3: Fix 3 Operating End Date ───────────────────────────────────
console.log('\n[3/4] Fix 3: Operating End Date helper + UI');
{
  // Phase startDate 2026-01-01, construction 4, overlap 0, ops 8.
  // end_year = 2026 + (4 - 0) + 8 - 1 = 2037. End = Dec 31 2037.
  const phase: Phase = { ...makeDefaultPhase(), id: 'phase-1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 8, overlapPeriods: 0 };
  const asset: Asset = {
    id: 'a1', phaseId: 'phase-1', name: 'Hotel 01', type: 'Hospitality', strategy: 'Operate',
    visible: true, gfaSqm: 0, buaSqm: 80000, sellableBuaSqm: 65000, parkingBaysRequired: 0,
  };
  const end = computeOperatingEndDate(asset, phase);
  if (end && end.getUTCFullYear() === 2037 && end.getUTCMonth() === 11 && end.getUTCDate() === 31) {
    pass(`computeOperatingEndDate -> 2037-12-31 (${end.toISOString().slice(0, 10)})`);
  } else {
    fail('computeOperatingEndDate', `expected 2037-12-31, got ${end?.toISOString()}`);
  }
  const display = formatOperatingEndDate(end);
  if (display === 'Dec 2037') pass(`formatOperatingEndDate -> "Dec 2037"`);
  else fail('formatOperatingEndDate', `expected "Dec 2037", got "${display}"`);

  // Null cases.
  const noOps: Phase = { ...phase, operationsPeriods: 0 };
  if (computeOperatingEndDate(asset, noOps) === null) pass('ops=0 returns null');
  else fail('ops=0 null', 'did not return null');
  if (computeOperatingEndDate(asset, undefined) === null) pass('missing phase returns null');
  else fail('missing phase null', 'did not return null');

  // Overlap subtracts.
  // startDate 2026-01-01, construction 5, overlap 1, ops 8 -> 2026 + (5-1) + 8 - 1 = 2037.
  const overlapped: Phase = { ...phase, constructionPeriods: 5, overlapPeriods: 1 };
  const endOverlap = computeOperatingEndDate(asset, overlapped);
  if (endOverlap && endOverlap.getUTCFullYear() === 2037) pass('overlap subtracts from end year');
  else fail('overlap subtract', `got ${endOverlap?.getUTCFullYear()}`);

  // UI markers.
  if (ASSETS_SRC.includes('-operating-end-date`}')) pass('AssetCard renders operating-end-date testid');
  else fail('UI testid', 'missing');
  if (ASSETS_SRC.includes('-operating-end-date-value`}')) pass('AssetCard renders end-date-value testid');
  else fail('UI value testid', 'missing');
  // T2P3 follow-up (2026-05-12): universal (no strategy gate). Operating
  // End Date renders for every asset regardless of strategy.
  if (ASSETS_SRC.includes('Universal Operating End Date')) {
    pass('AssetCard surfaces end date universally (no strategy gate)');
  } else fail('UI universal end-date', 'marker not found');
  if (ASSETS_SRC.includes('Operating end date from Phase Setup')) pass('AssetCard caption matches brief');
  else fail('UI caption', 'missing');
  // UsefulLifeForm is retired, no longer called from any branch.
  if (!ASSETS_SRC.includes('<UsefulLifeForm')) {
    pass('UsefulLifeForm retired (no render call)');
  } else fail('UsefulLifeForm retired', 'still rendered somewhere');

  // M5 doc.
  const docPath = resolve(REPO_ROOT, 'docs/operating-end-date-hook.md');
  if (existsSync(docPath)) pass('M5 hook doc present');
  else fail('M5 hook doc', 'missing');
  const doc = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
  if (doc.includes('computeOperatingEndDate') && doc.includes('getOperatingEndDate') && doc.includes('terminal')) {
    pass('M5 hook doc references helper + contract + terminal value');
  } else fail('M5 hook doc content', 'missing references');
}

// ── Section 4: em-dash sweep on touched files ─────────────────────────────
console.log('\n[4/4] Em-dash sweep on touched files');
{
  const files = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
    'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts',
    'scripts/verify-tab2-pass3.ts',
    'docs/operating-end-date-hook.md',
  ];
  for (const rel of files) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    const t2Lines = txt.split(/\r?\n/).filter((l) => l.includes('T2P3') || l.includes('Tab2_Pass3') || l.includes('tab2-pass3'));
    const offending = t2Lines.filter((l) => l.includes('\u2014'));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T2P3 lines`);
    else fail(`${rel}: em-dashes`, `T2P3 lines: ${offending.length}`);
  }
}

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
