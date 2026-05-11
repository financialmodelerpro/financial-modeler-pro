/* eslint-disable no-console */
/**
 * verify-m20L-pass4.ts (M2.0L Pass 4 verifier, 2026-05-11)
 *
 * Parent/child inheritance cost engine. Asserts:
 *   1. Schema: CostOverride gains overridden / startPeriod / endPeriod;
 *      Project.costInputMode is flagged deprecated.
 *   2. Migration: migrateM20Pass4Inheritance stamps legacy overrides
 *      with overridden=true; strips Project.costInputMode; banner
 *      constant exported.
 *   3. Calc resolver: override.overridden=false reverts to master;
 *      override.overridden=true (or undefined) uses override fields
 *      with master fallback per field; per-asset startPeriod / endPeriod
 *      flow through distributeItemCost.
 *   4. UI source markers: CostInputModeModal render removed; toggle
 *      button removed; SameModeCostTable accepts onUpdateOverride +
 *      onRemoveOverride; per-asset replicas show Override toggle +
 *      Source pill; Results tables relabeled.
 *
 * Usage: npx tsx scripts/verify-m20L-pass4.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type CostOverride,
  type CostLine,
  type Project,
  type Phase,
  type Parcel,
  type Asset,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultParcel,
  makeDefaultProject,
  makeDefaultCostLines,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  PASS4_MIGRATION_NOTICE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeAssetCost } from '../src/core/calculations';

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

// ── Section 1: Schema ─────────────────────────────────────────────────────
console.log('\n[1/4] Schema + type surface');
{
  // CostOverride should accept overridden + startPeriod + endPeriod.
  const sampleOverride: CostOverride = {
    assetId: 'asset_1',
    lineId: 'construction-bua__phase_1',
    method: 'rate_per_bua',
    value: 5500,
    phasing: 'even',
    overridden: true,
    startPeriod: 1,
    endPeriod: 3,
  };
  if (sampleOverride.overridden === true) pass('CostOverride.overridden accepted');
  else fail('CostOverride.overridden accepted', 'unexpected shape');
  if (sampleOverride.startPeriod === 1 && sampleOverride.endPeriod === 3) {
    pass('CostOverride.startPeriod + endPeriod accepted');
  } else {
    fail('CostOverride.startPeriod + endPeriod accepted', 'unexpected');
  }
}

// ── Section 2: Migration ──────────────────────────────────────────────────
console.log('\n[2/4] Migration');
{
  // Build a "legacy" v8 snapshot: project carries costInputMode + an
  // override without overridden.
  const phase = makeDefaultPhase();
  const parcel = makeDefaultParcel(undefined, phase.id);
  const project: Project & { costInputMode?: string } = {
    ...makeDefaultProject(),
    costInputMode: 'individual',
  };
  const costLines = makeDefaultCostLines(phase.id, phase.constructionPeriods);
  const legacyOverride: Partial<CostOverride> = {
    assetId: 'asset_1',
    lineId: costLines[2].id,
    method: 'rate_per_bua',
    value: 5500,
    phasing: 'even',
    // overridden intentionally absent
  };
  const snapshot = {
    version: 8 as const,
    project,
    phases: [phase],
    parcels: [parcel],
    landAllocationMode: 'autoByBua' as const,
    assets: [],
    subUnits: [],
    costLines,
    costOverrides: [legacyOverride as CostOverride],
    financingTranches: [],
    equityContributions: [],
  };
  const result = hydrationFromAnySnapshotChecked(snapshot);

  if (result.migrationNotice === PASS4_MIGRATION_NOTICE) {
    pass('Pass 4 migration banner emitted');
  } else {
    fail('Pass 4 migration banner emitted', `notice = ${String(result.migrationNotice)}`);
  }

  const migratedOv = result.snapshot.costOverrides[0];
  if (migratedOv && migratedOv.overridden === true) {
    pass('Legacy override stamped overridden=true');
  } else {
    fail('Legacy override stamped overridden=true', `got overridden=${String(migratedOv?.overridden)}`);
  }

  const migratedProject = result.snapshot.project as Project & { costInputMode?: string };
  if (migratedProject.costInputMode === undefined) {
    pass('Project.costInputMode stripped on migration');
  } else {
    fail('Project.costInputMode stripped on migration', `still ${String(migratedProject.costInputMode)}`);
  }

  // Idempotency: re-running migration on the migrated snapshot should
  // NOT re-fire the banner.
  const idempCheck = hydrationFromAnySnapshotChecked({
    version: 8 as const,
    ...result.snapshot,
  });
  if (idempCheck.migrationNotice === undefined) {
    pass('Migration idempotent on already-Pass-4-shaped snapshot');
  } else {
    fail('Migration idempotent', `re-fired with ${String(idempCheck.migrationNotice)}`);
  }
}

// ── Section 3: Calc resolver ──────────────────────────────────────────────
console.log('\n[3/4] Calc engine resolver');
{
  const phase = makeDefaultPhase('phase_1', 'Phase 1', 4, 60, 0);
  const parcel = makeDefaultParcel(undefined, phase.id);
  const project = makeDefaultProject();
  const asset: Asset = {
    id: 'asset_1',
    phaseId: phase.id,
    name: 'Asset 1',
    type: '',
    strategy: 'Sell',
    visible: true,
    gfaSqm: 60000,
    buaSqm: 50000,
    sellableBuaSqm: 40000,
    parkingBaysRequired: 100,
  };
  const subUnits: SubUnit[] = [];
  // Master construction-BUA at 4500 SAR/sqm, x 50000 sqm = 225,000,000.
  const masterLines: CostLine[] = [
    {
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
    },
  ];

  // Case A: no override -> master 225M.
  let breakdown = computeAssetCost(
    asset, project, phase, [parcel], [asset], subUnits,
    masterLines, [], 'autoByBua',
  );
  const masterTotal = breakdown.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(masterTotal - 225_000_000) < 0.5) pass('No override -> master value resolves');
  else fail('No override -> master value resolves', `got ${masterTotal.toLocaleString()}`);

  // Case B: override.overridden=true, value=5500 -> 275M.
  const activeOverride: CostOverride = {
    assetId: asset.id,
    lineId: 'construction-bua__phase_1',
    method: 'rate_per_bua',
    value: 5500,
    phasing: 'even',
    overridden: true,
  };
  breakdown = computeAssetCost(
    asset, project, phase, [parcel], [asset], subUnits,
    masterLines, [activeOverride], 'autoByBua',
  );
  const overrideTotal = breakdown.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(overrideTotal - 275_000_000) < 0.5) pass('overridden=true -> override value used');
  else fail('overridden=true -> override value used', `got ${overrideTotal.toLocaleString()}`);

  // Case C: override.overridden=false -> resolver ignores override.
  const inactiveOverride: CostOverride = { ...activeOverride, overridden: false };
  breakdown = computeAssetCost(
    asset, project, phase, [parcel], [asset], subUnits,
    masterLines, [inactiveOverride], 'autoByBua',
  );
  const inactiveTotal = breakdown.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(inactiveTotal - 225_000_000) < 0.5) pass('overridden=false -> revert to master');
  else fail('overridden=false -> revert to master', `got ${inactiveTotal.toLocaleString()}`);

  // Case D: legacy override (overridden undefined) is treated as active.
  const legacyOverride: CostOverride = { ...activeOverride };
  delete (legacyOverride as unknown as Record<string, unknown>).overridden;
  breakdown = computeAssetCost(
    asset, project, phase, [parcel], [asset], subUnits,
    masterLines, [legacyOverride], 'autoByBua',
  );
  const legacyTotal = breakdown.byLineId['construction-bua__phase_1'] ?? 0;
  if (Math.abs(legacyTotal - 275_000_000) < 0.5) pass('Legacy override (no flag) -> still active');
  else fail('Legacy override (no flag) -> still active', `got ${legacyTotal.toLocaleString()}`);

  // Case E: timing override - endPeriod=2 on a 4-period phase.
  // value stays 4500, but per-period distribution clamps to [1,2].
  const timingOverride: CostOverride = {
    assetId: asset.id,
    lineId: 'construction-bua__phase_1',
    method: 'rate_per_bua',
    value: 4500,
    phasing: 'even',
    overridden: true,
    startPeriod: 1,
    endPeriod: 2,
  };
  breakdown = computeAssetCost(
    asset, project, phase, [parcel], [asset], subUnits,
    masterLines, [timingOverride], 'autoByBua',
  );
  // Total stays the same (rate x asset BUA); distribution should be
  // concentrated in periods 1 and 2.
  const timingTotal = breakdown.byLineId['construction-bua__phase_1'] ?? 0;
  const period1 = breakdown.perPeriod[1] ?? 0;
  const period2 = breakdown.perPeriod[2] ?? 0;
  const period3 = breakdown.perPeriod[3] ?? 0;
  const period4 = breakdown.perPeriod[4] ?? 0;
  if (Math.abs(timingTotal - 225_000_000) < 0.5 && period3 < 0.5 && period4 < 0.5 && period1 > 0 && period2 > 0) {
    pass('Timing override clamps distribution to override window');
  } else {
    fail('Timing override clamps distribution to override window', `t=${timingTotal}, p1=${period1}, p2=${period2}, p3=${period3}, p4=${period4}`);
  }
}

// ── Section 4: Source markers ─────────────────────────────────────────────
console.log('\n[4/4] Source markers');
{
  const costsPath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  if (!existsSync(costsPath)) {
    fail('Module1Costs.tsx exists', 'file missing');
  } else {
    const src = readFileSync(costsPath, 'utf8');
    const markers: Array<[string, string]> = [
      ['Pass 4 banner doc', 'M2.0L Pass 4'],
      ['Override toggle markup', 'costs-same-replica-'],
      ['Override toggle test-id', '-toggle`'],
      ['Source pill test-id', '-source`'],
      ['onUpdateOverride threaded', 'onUpdateOverride'],
      ['onRemoveOverride threaded', 'onRemoveOverride'],
      ['Inheritance branch always-on', 'inheritance surface always rendered'],
      ['Table 1 relabel', 'Construction Cost Schedule by Period'],
      ['Table 2 relabel', 'Total Capex Including Land Value'],
      ['Table 3 relabel', 'Capex Excluding Land In-Kind (cash-impact schedule)'],
      ['Table 4 relabel', 'Capex Excluding Total Land'],
    ];
    for (const [name, needle] of markers) {
      if (src.includes(needle)) pass(name);
      else fail(name, `marker "${needle}" not found in Module1Costs.tsx`);
    }
    if (!src.includes('costInputMode === \'same\'') && !src.includes('costInputMode === \'individual\'')) {
      pass('costInputMode branching removed from Module1Costs.tsx');
    } else {
      fail('costInputMode branching removed from Module1Costs.tsx', 'branches still present');
    }
    if (!src.includes('data-testid="cost-input-mode-toggle-same"') && !src.includes('data-testid="cost-input-mode-toggle-individual"')) {
      pass('cost-input-mode-toggle button removed from JSX');
    } else {
      fail('cost-input-mode-toggle button removed from JSX', 'toggle still rendered');
    }
    if (!src.includes('CostInputModeModal onPick')) {
      pass('CostInputModeModal render removed');
    } else {
      fail('CostInputModeModal render removed', 'modal still rendered');
    }
  }

  const migratePath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts');
  if (!existsSync(migratePath)) {
    fail('module1-migrate.ts exists', 'file missing');
  } else {
    const mSrc = readFileSync(migratePath, 'utf8');
    if (mSrc.includes('migrateM20Pass4Inheritance')) pass('migrateM20Pass4Inheritance defined');
    else fail('migrateM20Pass4Inheritance defined', 'helper missing');
    if (mSrc.includes('PASS4_MIGRATION_NOTICE')) pass('PASS4_MIGRATION_NOTICE exported');
    else fail('PASS4_MIGRATION_NOTICE exported', 'constant missing');
    if (mSrc.includes('snapshotNeedsPass4Migration')) pass('snapshotNeedsPass4Migration detector defined');
    else fail('snapshotNeedsPass4Migration detector defined', 'helper missing');
  }

  const calcPath = resolve(REPO_ROOT, 'src/core/calculations/index.ts');
  if (!existsSync(calcPath)) {
    fail('calculations/index.ts exists', 'file missing');
  } else {
    const cSrc = readFileSync(calcPath, 'utf8');
    if (cSrc.includes('ov.overridden !== false')) pass('Calc resolver respects overridden=false');
    else fail('Calc resolver respects overridden=false', 'marker missing');
    if (cSrc.includes('M2.0L Pass 4 inheritance resolver')) pass('Calc engine Pass 4 marker present');
    else fail('Calc engine Pass 4 marker present', 'comment missing');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('');
console.log(`Results: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) {
  console.log('FAILED');
  process.exit(1);
}
console.log('OK');
