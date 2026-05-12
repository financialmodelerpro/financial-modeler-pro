/* eslint-disable no-console */
/**
 * verify-m20costsCleanup-pass9.ts (M2.0 Costs Cleanup Pass 9, 2026-05-12)
 *
 * Sections:
 *   1. Mandatory diagnostic file present.
 *   2. Fix 8: computeAssetBua + computeAssetSellableBua fallback to
 *      asset.buaSqm / sellableBuaSqm when sub-units sum to 0. MAAD
 *      fixture: Land (Cash) total renders non-zero through
 *      computeAssetCost end-to-end.
 *   3. Fix 1: derived Count rounds to integer.
 *   4. Fix 2: NDA recon walk markers (Total - Roads - Parks = NDA +
 *      asset allocations sum to NDA).
 *   5. Fix 3: End period max cap dropped; warning/error chip markers.
 *   6. Fix 4: cell rendering uses formatAccounting, not formatScaled.
 *   7. Fix 5: costLineCaption drops the trailing "= result" suffix.
 *   8. Fix 6: collapsible cost line row markers + localStorage key.
 *   9. Fix 7: empty-phase Tab 3 Inputs guards (no TypeError on Phase 3).
 *  10. Em-dash sweep on touched files.
 *
 * Usage: npx tsx scripts/verify-m20costsCleanup-pass9.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type CostLine,
  type Phase,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetBua,
  computeAssetSellableBua,
  computeAssetCost,
  costLineCaption,
  resolveAssetAreaMetrics,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');
const FORMATTERS_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/formatters/index.ts'), 'utf8');

// ── Section 1: diagnostic file ────────────────────────────────────────────
console.log('\n[1/10] Mandatory diagnostic file');
{
  const diagPath = resolve(REPO_ROOT, 'docs/m20costs-pass9-land-zero-diagnostic.md');
  if (existsSync(diagPath)) pass('docs/m20costs-pass9-land-zero-diagnostic.md present');
  else fail('diagnostic file', 'missing');

  const diag = existsSync(diagPath) ? readFileSync(diagPath, 'utf8') : '';
  if (diag.includes('computeAssetBua') && diag.includes('asset.buaSqm')) {
    pass('diagnostic identifies computeAssetBua fallback gap');
  } else fail('diagnostic content', 'does not mention computeAssetBua fallback');
}

// ── Section 2: Fix 8 Land zero forced fix ─────────────────────────────────
console.log('\n[2/10] Fix 8: Land zero forced fix - computeAssetBua fallback');
{
  // Build a fixture with a SUB-UNIT that has metricValue=0 (the failure
  // mode from the user report) and asset.buaSqm = 130874. Pre-Fix 8
  // this returned 0; post-Fix 8 returns 130874.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 0, overlapPeriods: 0 };
  const asset: Asset = {
    id: 'a1', phaseId: phase.id, name: 'Branded Apt', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 100000, parkingBaysRequired: 0,
  };
  const stubSubUnit: SubUnit = {
    id: 'su1', assetId: asset.id, name: 'Stub', category: 'Sellable',
    metric: 'units', metricValue: 0, unitArea: 0, unitPrice: 0,
  };

  const buaWithStub = computeAssetBua(asset, [stubSubUnit]);
  if (buaWithStub === 130874) pass('computeAssetBua falls back to asset.buaSqm when stub sub-units sum to 0');
  else fail('computeAssetBua fallback', `expected 130874, got ${buaWithStub}`);

  const nsaWithStub = computeAssetSellableBua(asset, [stubSubUnit]);
  if (nsaWithStub === 100000) pass('computeAssetSellableBua falls back to asset.sellableBuaSqm');
  else fail('computeAssetSellableBua fallback', `expected 100000, got ${nsaWithStub}`);

  // End-to-end: with the fallback, autoByBua land allocation produces
  // non-zero cashLandValue, and computeAssetCost emits non-zero for
  // the Land (Cash) cost line.
  const parcels = [{ id: 'parcel_1', phaseId: phase.id, name: 'Plot 01', area: 22066, rate: 98450, cashPct: 80, inKindPct: 20 }];
  const landCashLine: CostLine = {
    id: 'land-cash__p1__a1',
    phaseId: phase.id,
    name: 'Land (Cash)',
    method: 'percent_of_cash_land', value: 100,
    stage: 'land', scope: 'direct', allocationBasis: 'land_share',
    startPeriod: 0, endPeriod: 0, phasing: 'even',
    isLocked: true, targetAssetId: asset.id,
  };
  const landInKindLine: CostLine = {
    id: 'land-inkind__p1__a1',
    phaseId: phase.id,
    name: 'Land (In-Kind)',
    method: 'percent_of_inkind_land', value: 100,
    stage: 'land', scope: 'direct', allocationBasis: 'land_share',
    startPeriod: 0, endPeriod: 0, phasing: 'even',
    isLocked: true, targetAssetId: asset.id,
  };

  const metrics = resolveAssetAreaMetrics(asset, project, parcels, [asset], [stubSubUnit], 'autoByBua');
  if (metrics.cashLandValue > 0) pass(`resolveAssetAreaMetrics.cashLandValue > 0 (got ${Math.round(metrics.cashLandValue).toLocaleString()})`);
  else fail('cashLandValue', `expected > 0, got ${metrics.cashLandValue}`);

  const breakdown = computeAssetCost(asset, project, phase, parcels, [asset], [stubSubUnit], [landCashLine, landInKindLine], [], 'autoByBua');
  const landCashTotal = breakdown.byLineId[landCashLine.id] ?? 0;
  const landInKindTotal = breakdown.byLineId[landInKindLine.id] ?? 0;
  const expectedCash = 22066 * 98450 * 0.8;   // 1,737,750,160
  const expectedInKind = 22066 * 98450 * 0.2; // 434,437,540
  if (Math.abs(landCashTotal - expectedCash) < 10) pass(`Land (Cash) total = ${Math.round(landCashTotal).toLocaleString()}`);
  else fail('Land (Cash) total', `expected ~${Math.round(expectedCash).toLocaleString()}, got ${Math.round(landCashTotal).toLocaleString()}`);
  if (Math.abs(landInKindTotal - expectedInKind) < 10) pass(`Land (In-Kind) total = ${Math.round(landInKindTotal).toLocaleString()}`);
  else fail('Land (In-Kind) total', `expected ~${Math.round(expectedInKind).toLocaleString()}, got ${Math.round(landInKindTotal).toLocaleString()}`);
}

// ── Section 3: Fix 1 Count rounding ───────────────────────────────────────
console.log('\n[3/10] Fix 1: derived Count rounds to integer');
{
  if (ASSETS_SRC.includes('isUnits ? Math.round(rawCount) : rawCount')) {
    pass('SubUnitRow rounds derived Count via Math.round');
  } else fail('Count rounding', 'Math.round(rawCount) not found in Module1Assets.tsx');

  if (ASSETS_SRC.includes('isUnits\n    ? count * subUnit.unitPrice') ||
      ASSETS_SRC.includes('totalRevenueNoIdx = isUnits')) {
    pass('Total Revenue uses rounded count when in Units mode');
  } else fail('Total Revenue uses rounded count', 'pattern not found');
}

// ── Section 4: Fix 2 NDA Recon walk ───────────────────────────────────────
console.log('\n[4/10] Fix 2: NDA Recon walk markers');
{
  for (const id of ['land-reconciliation-nda-walk', 'recon-total-land', 'recon-roads', 'recon-parks', 'recon-nda', 'recon-allocated']) {
    if (ASSETS_SRC.includes(`data-testid="${id}"`)) pass(`${id} test-id present`);
    else fail(id, 'missing');
  }
  if (ASSETS_SRC.includes('recon-asset-')) pass('per-asset recon test-id present');
  else fail('per-asset recon test-id', 'missing');
  if (ASSETS_SRC.includes('matches NDA')) pass('recon shows ✓ matches NDA when balanced');
  else fail('recon matches NDA', 'string missing');
}

// ── Section 5: Fix 3 End period max cap dropped ───────────────────────────
console.log('\n[5/10] Fix 3: End period max cap dropped');
{
  // The End input no longer carries max attribute. Look for the
  // specific input declaration without max.
  if (COSTS_SRC.includes('-end-error')) pass('End < Start blocking error chip test-id present');
  else fail('end-error chip', 'missing');

  if (COSTS_SRC.includes('extends into operations period')) pass('End > maxCp informational chip present');
  else fail('end-warning chip', 'missing');

  // Negative: the old "Clamp" button + "-end-clamp" test-id are gone.
  if (!COSTS_SRC.includes('-end-clamp')) pass('Clamp button test-id removed');
  else fail('Clamp button', 'still present');
}

// ── Section 6: Fix 4 K/M strip ────────────────────────────────────────────
console.log('\n[6/10] Fix 4: Universal K/M suffix strip');
{
  // formatScaledCurrency now calls formatAccounting internally.
  if (FORMATTERS_SRC.includes('Pass 9 Fix 4') && FORMATTERS_SRC.includes('formatAccounting')) {
    pass('formatScaledCurrency delegates to formatAccounting');
  } else fail('formatScaledCurrency delegate', 'pattern not found in formatters');

  // Module1Costs has no formatScaled( cell calls remaining (formatScaled
  // can still appear in import/comment lines).
  const stripped = COSTS_SRC
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^.*from '@\/src\/core\/formatters.*$/m, '');
  if (!/\bformatScaled\(/.test(stripped)) pass('Module1Costs.tsx: no formatScaled( cell calls remaining');
  else fail('Module1Costs formatScaled', 'formatScaled( still called');

  const strippedA = ASSETS_SRC
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^.*from '@\/src\/core\/formatters.*$/m, '');
  if (!/\bformatScaled\(/.test(strippedA)) pass('Module1Assets.tsx: no formatScaled( cell calls remaining');
  else fail('Module1Assets formatScaled', 'formatScaled( still called');
}

// ── Section 7: Fix 5 caption drops = result ───────────────────────────────
console.log('\n[7/10] Fix 5: costLineCaption drops "= result" suffix');
{
  // Captions should NOT contain ` = ` followed by a number string.
  const project = makeDefaultProject();
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Test', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 100000, parkingBaysRequired: 0,
  };
  void project;
  const line: CostLine = {
    id: 'l1', phaseId: 'p1', name: 'Construction',
    method: 'rate_per_bua', value: 4500,
    stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 1, endPeriod: 5, phasing: 'even',
  };
  const metrics = {
    landSqm: 0, ndaSqm: 0, roadsSqm: 0, gfa: 130874, bua: 130874, nsa: 100000,
    unitCount: 0, parkingBays: 0, supportArea: 0, parkingArea: 0,
    landValue: 0, cashLandValue: 0, inKindLandValue: 0,
    totalRevenue: 0,
  };
  const caption = costLineCaption({ line, asset, metrics, parkingBays: 0, resolvedTotal: 588933000 });
  if (caption === '4,500 x 130,874 sqm BUA') {
    pass('rate_per_bua caption shows formula only, no = result');
  } else fail('caption no = result', `got "${caption}"`);

  const fixedLine: CostLine = { ...line, method: 'fixed' };
  const fixedCaption = costLineCaption({ line: fixedLine, asset, metrics, parkingBays: 0, resolvedTotal: 588933000 });
  if (fixedCaption === 'Fixed') pass('fixed caption is just "Fixed"');
  else fail('fixed caption', `got "${fixedCaption}"`);
}

// ── Section 8: Fix 6 collapsible cost line rows ───────────────────────────
console.log('\n[8/10] Fix 6: collapsible cost line rows');
{
  if (COSTS_SRC.includes('m20-cost-row-collapsed-')) pass('per-row collapse localStorage key prefix present');
  else fail('collapse key', 'missing');

  if (COSTS_SRC.includes('${line.id}-collapse`')) pass('per-row chevron test-id present');
  else fail('chevron test-id', 'missing');

  if (COSTS_SRC.includes('-expand-all') && COSTS_SRC.includes('-collapse-all')) {
    pass('Expand all / Collapse all bulk buttons present');
  } else fail('bulk buttons', 'missing');

  if (COSTS_SRC.includes('m20-cost-row-collapse-bulk')) pass('bulk-event listener wired');
  else fail('bulk-event listener', 'missing');

  if (COSTS_SRC.includes('-value-collapsed')) pass('collapsed-state Value cell test-id present');
  else fail('value-collapsed', 'missing');
}

// ── Section 9: Fix 7 empty-phase guards ───────────────────────────────────
console.log('\n[9/10] Fix 7: Phase 3 click empty-phase guards');
{
  // Pre-Fix 7 line was `phases.find((p) => p.id === activeAsset.phaseId)`.
  // Post-Fix 7 wraps with `activeAsset ? ... : undefined`.
  if (COSTS_SRC.includes('activeAsset ? phases.find')) pass('assetPhase guards activeAsset undefined');
  else fail('assetPhase guard', 'missing');

  if (COSTS_SRC.includes('activeAsset\n          ? costLines') ||
      COSTS_SRC.includes('activeAsset\n          ? costLines.filter') ||
      COSTS_SRC.includes('const assetLines = activeAsset')) {
    pass('assetLines guards activeAsset undefined');
  } else fail('assetLines guard', 'missing');

  if (COSTS_SRC.includes('costs-inputs-empty-phase')) pass('empty-phase message still rendered');
  else fail('empty-phase message', 'missing');
}

// ── Section 10: Em-dash sweep ─────────────────────────────────────────────
console.log('\n[10/10] No em-dashes in touched files');
{
  const filesToCheck: Array<{ name: string; src: string }> = [
    { name: 'Module1Costs.tsx', src: COSTS_SRC },
    { name: 'Module1Assets.tsx', src: ASSETS_SRC },
    { name: 'core/calculations/index.ts', src: CALC_SRC },
    { name: 'core/formatters/index.ts', src: FORMATTERS_SRC },
  ];
  for (const f of filesToCheck) {
    const matches = (f.src.match(/—/g) ?? []).length;
    if (matches === 0) pass(`${f.name}: no em-dashes`);
    else fail(`${f.name} em-dashes`, `${matches} found`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Pass:    ${passed}`);
console.log(`Fail:    ${failed}`);
console.log(`Skip:    ${skipped}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
void skip;
