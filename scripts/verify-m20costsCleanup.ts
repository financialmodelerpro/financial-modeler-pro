/* eslint-disable no-console */
/**
 * verify-m20costsCleanup.ts (M2.0M Pass 6, 2026-05-11)
 *
 * Module 1 Costs cleanup pass covering 9 targeted fixes.
 *
 * Sections (one per fix):
 *   1. Dynamic count caption helper exposed in Module1Assets source.
 *   2. Default displayScale='thousands' + displayDecimals=0 on
 *      makeDefaultProject; smart migration preserves user customisation.
 *   3. projectNdaEnabled + projectParksPct on schema; project-level
 *      NDA wins in calc engine; legacy per-parcel toggles migrate to
 *      project-level weighted average.
 *   4. Method column width: master colgroup + replica max-width source
 *      markers.
 *   5. Land cost derivation captions: percent_of_cash_land /
 *      percent_of_inkind_land emit "{landSqm} sqm x {effRate}/sqm"
 *      format; no-allocation / no-rate paths emit warning text.
 *   6. PercentOfSelectedPicker rebuilt as dropdown button + chip
 *      strip + popover (source markers).
 *   7. Override toggle: replica rows with line.isLocked=true render
 *      a "Locked" chip instead of the Override button.
 *   8. Period column reducer: phaseStartYear-aware; multi-phase
 *      projects extend columns through the latest phase end.
 *   9. Results cells use formatScaledForExport (no K/M suffix).
 *
 * Usage: npx tsx scripts/verify-m20costsCleanup.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Project,
  type Parcel,
  type SubUnit,
  makeDefaultProject,
  makeDefaultPhase,
  makeDefaultParcel,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  resolveAssetAreaMetrics,
  computeAssetCost,
  costLineCaption,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const PHASES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx'), 'utf8');

// ── Fix 1: dynamic count caption ─────────────────────────────────────────
console.log('\n[1/9] Fix 1: dynamic count caption');
{
  if (ASSETS_SRC.includes('function countUnitLabel(')) pass('countUnitLabel helper defined');
  else fail('countUnitLabel helper', 'not found');
  if (ASSETS_SRC.includes('keys')) pass('label catalog includes "keys"');
  else fail('label catalog "keys"', 'missing');
  if (ASSETS_SRC.includes('beds')) pass('label catalog includes "beds"');
  else fail('label catalog "beds"', 'missing');
  if (ASSETS_SRC.includes('tenants')) pass('label catalog includes "tenants"');
  else fail('label catalog "tenants"', 'missing');
  if (ASSETS_SRC.includes('-count-unit')) pass('per-row count-unit caption test-id present');
  else fail('count-unit caption test-id', 'missing');
}

// ── Fix 2: default display + smart migration ─────────────────────────────
console.log('\n[2/9] Fix 2: default displayScale=thousands + decimals=0');
{
  const fresh = makeDefaultProject();
  if (fresh.displayScale === 'thousands') pass('makeDefaultProject defaults displayScale=thousands');
  else fail('default displayScale', `got ${fresh.displayScale}`);
  if (fresh.displayDecimals === 0) pass('makeDefaultProject defaults displayDecimals=0');
  else fail('default displayDecimals', `got ${fresh.displayDecimals}`);

  // Legacy combo (full/2) should migrate.
  const legacyDefault = {
    version: 8,
    savedAt: new Date().toISOString(),
    project: { ...fresh, displayScale: 'full', displayDecimals: 2 },
    phases: [makeDefaultPhase()],
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [],
    subUnits: [],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  const r1 = hydrationFromAnySnapshotChecked(legacyDefault);
  const p1 = r1.snapshot.project as Project;
  if (p1.displayScale === 'thousands' && p1.displayDecimals === 0) {
    pass('Legacy default combo (full+2) migrates to thousands+0');
  } else fail('legacy default migration', `got ${p1.displayScale}/${p1.displayDecimals}`);

  // Custom combo (millions+1) must be preserved.
  const customised = {
    ...legacyDefault,
    project: { ...fresh, displayScale: 'millions', displayDecimals: 1 },
  };
  const r2 = hydrationFromAnySnapshotChecked(customised);
  const p2 = r2.snapshot.project as Project;
  if (p2.displayScale === 'millions' && p2.displayDecimals === 1) {
    pass('Custom combo (millions+1) preserved verbatim');
  } else fail('custom combo preservation', `got ${p2.displayScale}/${p2.displayDecimals}`);

  // Edge case: full+1 (non-default decimals). Should stay.
  const fullOne = {
    ...legacyDefault,
    project: { ...fresh, displayScale: 'full', displayDecimals: 1 },
  };
  const r3 = hydrationFromAnySnapshotChecked(fullOne);
  const p3 = r3.snapshot.project as Project;
  if (p3.displayScale === 'full' && p3.displayDecimals === 1) {
    pass('Partial-custom combo (full+1) preserved verbatim');
  } else fail('partial-custom preservation', `got ${p3.displayScale}/${p3.displayDecimals}`);
}

// ── Fix 3: project-level NDA ─────────────────────────────────────────────
console.log('\n[3/9] Fix 3: project-level NDA');
{
  const fresh = makeDefaultProject();
  fresh.projectNdaEnabled = true;
  fresh.projectRoadsPct = 10;
  fresh.projectParksPct = 5;
  const phase = makeDefaultPhase();
  const parcel = { ...makeDefaultParcel(undefined, phase.id), area: 100000, rate: 1000 };
  const asset: Asset = {
    id: 'asset_1', phaseId: phase.id, name: 'Tower A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 8000, parkingBaysRequired: 0,
  };
  const m = resolveAssetAreaMetrics(asset, fresh, [parcel], [asset], [], 'autoByBua');
  // landSqm via autoByBua = 100000 * (10000/10000) = 100000
  // ndaSqm = 100000 * (1 - 0.15) = 85000
  if (Math.abs(m.ndaSqm - 85000) < 1) pass('Project NDA applied: 100k * (1 - 15%) = 85k');
  else fail('project NDA calc', `expected 85000, got ${m.ndaSqm}`);
  if (Math.abs(m.roadsSqm - 15000) < 1) pass('roadsSqm derives from total deduct');
  else fail('roadsSqm', `expected 15000, got ${m.roadsSqm}`);

  // Migration: legacy parcel with hasNdaDeduction=true (roads 20, parks 0)
  // -> project ends up with projectNdaEnabled=true + roads=20 + parks=0.
  const legacyParcel: Parcel = {
    id: 'parcel_1', phaseId: phase.id, name: 'Land 1',
    area: 50000, rate: 1000, cashPct: 60, inKindPct: 40,
    hasNdaDeduction: true, roadsPct: 20, parksPct: 0,
  };
  const legacySnap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project: makeDefaultProject(),
    phases: [phase],
    parcels: [legacyParcel],
    landAllocationMode: 'autoByBua' as const,
    assets: [],
    subUnits: [] as SubUnit[],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  };
  const r = hydrationFromAnySnapshotChecked(legacySnap);
  const proj = r.snapshot.project as Project;
  if (proj.projectNdaEnabled === true) pass('Legacy per-parcel NDA migrates to projectNdaEnabled=true');
  else fail('projectNdaEnabled migration', `got ${proj.projectNdaEnabled}`);
  if (Math.abs((proj.projectRoadsPct ?? 0) - 20) < 0.01) pass('Weighted roads% = 20 from single legacy parcel');
  else fail('weighted roads%', `got ${proj.projectRoadsPct}`);

  // Migration: parcel with hasNdaDeduction=false on every parcel ->
  // projectNdaEnabled=false stamped.
  const noNdaSnap = { ...legacySnap, parcels: [{ ...legacyParcel, hasNdaDeduction: false }] };
  const r2 = hydrationFromAnySnapshotChecked(noNdaSnap);
  if ((r2.snapshot.project as Project).projectNdaEnabled === false) {
    pass('No-NDA snapshot stamps projectNdaEnabled=false');
  } else fail('no-NDA stamp', 'expected false');

  // Schema + UI markers.
  if (PHASES_SRC.includes('project-nda-enabled')) pass('Tab 1 project-nda toggle present');
  else fail('project-nda toggle in Tab 1', 'missing');
  if (PHASES_SRC.includes('project-parks-pct')) pass('Tab 1 parks input present');
  else fail('parks input', 'missing');
  if (ASSETS_SRC.includes('parcels-project-nda-notice')) pass('Tab 2 per-parcel NDA notice present');
  else fail('Tab 2 NDA notice', 'missing');
}

// ── Fix 4: method column width ───────────────────────────────────────────
console.log('\n[4/9] Fix 4: method column width');
{
  if (COSTS_SRC.includes("tableLayout: 'fixed'")) pass('master table uses tableLayout=fixed');
  else fail('master tableLayout fixed', 'missing');
  if (COSTS_SRC.includes('<colgroup>')) pass('master colgroup present');
  else fail('colgroup', 'missing');
  if (COSTS_SRC.includes('maxWidth: 200, overflow:')) pass('replica method cell max-width + overflow');
  else fail('replica method ellipsis', 'missing');
}

// ── Fix 5: land cost captions ────────────────────────────────────────────
console.log('\n[5/9] Fix 5: land cost derivation captions');
{
  const project = makeDefaultProject();
  const phase = makeDefaultPhase();
  const parcel: Parcel = {
    id: 'parcel_1', phaseId: phase.id, name: 'Land 1',
    area: 100000, rate: 1000, cashPct: 60, inKindPct: 40,
  };
  const asset: Asset = {
    id: 'asset_1', phaseId: phase.id, name: 'Tower A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 8000, parkingBaysRequired: 0,
  };
  const m = resolveAssetAreaMetrics(asset, project, [parcel], [asset], [], 'autoByBua');
  // landSqm = 100000, landValue = 100M, cash = 60M, in-kind = 40M.
  if (m.landSqm > 0 && m.cashLandValue > 0) pass(`autoByBua fallback yields landSqm=${m.landSqm.toFixed(0)}, cashLandValue=${m.cashLandValue.toFixed(0)}`);
  else fail('autoByBua fallback land', `landSqm=${m.landSqm}, cash=${m.cashLandValue}`);

  const cap = costLineCaption({
    line: {
      id: 'land-cash__phase_1', phaseId: phase.id, name: 'Land (Cash)',
      method: 'percent_of_cash_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even', isLocked: true,
    },
    asset, metrics: m, parkingBays: 0, resolvedTotal: m.cashLandValue,
  });
  if (cap.includes('sqm') && (cap.includes('cash') || cap.includes('/sqm'))) {
    pass(`Land cash caption shows derivation: "${cap}"`);
  } else fail('land cash caption derivation', `got "${cap}"`);

  // Zero-land warning.
  const zeroMetrics = { ...m, landSqm: 0, landValue: 0, cashLandValue: 0, inKindLandValue: 0 };
  const zeroCap = costLineCaption({
    line: {
      id: 'land-cash__phase_1', phaseId: phase.id, name: 'Land (Cash)',
      method: 'percent_of_cash_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
    },
    asset, metrics: zeroMetrics, parkingBays: 0, resolvedTotal: 0,
  });
  if (zeroCap.includes('no')) pass('Zero-land caption surfaces "no" warning');
  else fail('zero-land caption', `got "${zeroCap}"`);
}

// ── Fix 6: % of Selected dropdown ────────────────────────────────────────
console.log('\n[6/9] Fix 6: % of Selected dropdown picker');
{
  const needles = [
    '-pct-picker-button',
    '-pct-picker-popover',
    '-pct-picker-chips',
    '-pct-picker-backdrop',
    '-pct-picker-close',
  ];
  for (const n of needles) {
    if (COSTS_SRC.includes(n)) pass(`picker marker: ${n}`);
    else fail(`picker marker: ${n}`, 'missing');
  }
}

// ── Fix 7: locked-line override block ────────────────────────────────────
console.log('\n[7/9] Fix 7: locked-line override blocked');
{
  if (COSTS_SRC.includes('isLockedLine')) pass('isLockedLine guard variable present');
  else fail('isLockedLine guard', 'missing');
  if (COSTS_SRC.includes('if (isLockedLine) return;')) pass('toggleOverride early-returns for locked');
  else fail('toggleOverride early-return', 'missing');
  if (COSTS_SRC.includes('-row-${line.id}-locked')) pass('locked chip test-id present');
  else fail('locked chip', 'missing');
}

// ── Fix 8: period reducer ────────────────────────────────────────────────
console.log('\n[8/9] Fix 8: period column reducer');
{
  if (COSTS_SRC.includes('phaseStartYear - projectStartYear')) {
    pass('reducer reads phaseStartYear offset');
  } else fail('reducer phaseStartYear offset', 'missing');
  if (COSTS_SRC.includes('Math.max(max, offset + p.constructionPeriods)')) {
    pass('reducer takes offset + cp');
  } else fail('reducer offset + cp', 'missing');
}

// ── Fix 9: plain numbers in Results cells ────────────────────────────────
console.log('\n[9/9] Fix 9: Results cells use formatScaledForExport');
{
  if (COSTS_SRC.includes('formatScaledForExport')) pass('formatScaledForExport imported into Module1Costs');
  else fail('formatScaledForExport import', 'missing');
  if (COSTS_SRC.includes('formatScaledForExport(v, scale, decimals)')) {
    pass('SummaryTables fmt uses formatScaledForExport');
  } else fail('SummaryTables fmt swap', 'missing');
}

// ── Tally ────────────────────────────────────────────────────────────────
console.log('');
console.log('=======================================================');
console.log(`  verify-m20costsCleanup.ts  ${passed} pass / ${failed} fail`);
console.log('=======================================================');
process.exit(failed === 0 ? 0 : 1);
