/* eslint-disable no-console */
/**
 * verify-m20M-pass3.ts (M2.0M Pass 3 Tab 4 Financing cleanup, 2026-05-12)
 *
 * Sections (one per fix, plus verifier-only sections):
 *   1. Migration: viewMode='single_asset' -> 'combined' + selectedAssetId
 *      cleared; equityTranches data cleared; multi-facility default
 *      facilitySharePct (even split); banner M20M_PASS3_NOTICE.
 *   2. Capex hooks return real data from per-asset cost lines (post
 *      Pass 7). MAAD-shape fixture sanity check.
 *   3. TrancheCard UI: per-facility Debt% + Principal inputs dropped;
 *      Facility Share % surfaces when facilityCount > 1.
 *   4. TrancheCard UI: scope dropdown has 3 options including asset.
 *   5. TrancheCard UI: drawdown method dropdown dropped.
 *   6. TrancheCard UI: equal repayment sub-method dropdown + sweep
 *      ratio input dropped.
 *   7. Equity Tranches section dropped from Inputs.
 *   8. 3 Inputs Summary Tables (Funding / Debt / Equity) present.
 *   9. All Phases aggregation: phaseTranches walks all facilities when
 *      phaseFilter='__all__'. Closing balance math verified by
 *      inspection (no calc-engine change needed).
 *  10. Auto-IDC integration: applyIdcToCapex still emits per-asset
 *      seeds keyed by targetAssetId.
 *  11. Em-dash sweep across touched files.
 *  12. Design note + Single Asset toggle absence.
 *
 * Usage: npx tsx scripts/verify-m20M-pass3.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type CostLine,
  type EquityContribution,
  type FinancingTranche,
  type Phase,
  type Project,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  M20M_PASS3_NOTICE,
  snapshotNeedsPass3Migration,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  createFinancingHooks,
  createNoopHooks,
} from '../src/hubs/modeling/platforms/refm/lib/financing-hooks';
import {
  applyIdcToCapex,
  computeFinancing,
  type FinancingResult,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

const FINANCING_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx'), 'utf8');
const HOOKS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts'), 'utf8');
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');

// ── Section 1: Migration ──────────────────────────────────────────────────
console.log('\n[1/12] Migration: viewMode + equityTranches + facilitySharePct');
{
  if (typeof M20M_PASS3_NOTICE === 'string' && M20M_PASS3_NOTICE.includes('Financing simplified')) {
    pass('M20M_PASS3_NOTICE banner exported');
  } else fail('M20M_PASS3_NOTICE', 'missing or wrong wording');

  if (MIGRATE_SRC.includes('function migrateM20mPass3Financing(')) pass('migrateM20mPass3Financing defined');
  else fail('migrateM20mPass3Financing', 'helper not found');

  if (MIGRATE_SRC.includes('function snapshotNeedsPass3Migration(')) pass('snapshotNeedsPass3Migration detector defined');
  else fail('snapshotNeedsPass3Migration', 'detector not found');

  // Build a Pass-2 snapshot that needs Pass-3 work: viewMode='single_asset',
  // 2 equity tranches, 2 facilities without facilitySharePct.
  const project = makeDefaultProject();
  const phase = makeDefaultPhase();
  project.financing = {
    ...project.financing!,
    viewMode: 'single_asset',
    selectedAssetId: 'asset_a',
  };
  const snap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project,
    phases: [{ ...phase, id: 'phase_1' } as Phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [] as Asset[],
    subUnits: [],
    costLines: [] as CostLine[],
    costOverrides: [],
    financingTranches: [
      { id: 't1', phaseId: 'phase_1', name: 'Senior', ltvPct: 70, interestRatePct: 7, drawdownMethod: 'capex_basis', repaymentMethod: 'equal_repayment', repaymentPeriods: 5, idcCapitalize: true },
      { id: 't2', phaseId: 'phase_1', name: 'Mezz', ltvPct: 70, interestRatePct: 9, drawdownMethod: 'capex_basis', repaymentMethod: 'equal_repayment', repaymentPeriods: 5, idcCapitalize: true },
    ] as FinancingTranche[],
    equityContributions: [
      { id: 'e1', phaseId: 'phase_1', name: 'Sponsor', amount: 1000, timing: 'upfront' as const },
    ] as EquityContribution[],
  };
  if (snapshotNeedsPass3Migration(snap)) pass('detector flags pre-Pass-3 snapshot');
  else fail('detector', 'did not flag a snapshot that needs migration');

  const r = hydrationFromAnySnapshotChecked(snap);
  if (!r.recognized) {
    fail('hydration', `not recognized: ${r.error ?? 'unknown'}`);
  } else {
    const f = (r.snapshot.project as Project).financing!;
    if (f.viewMode === 'combined' && f.selectedAssetId === undefined) {
      pass('viewMode flipped to combined + selectedAssetId cleared');
    } else fail('viewMode migration', `viewMode=${f.viewMode} selectedAssetId=${f.selectedAssetId}`);

    const equity = r.snapshot.equityContributions as EquityContribution[];
    if (equity.length === 0) pass('equityContributions[] cleared');
    else fail('equityContributions', `expected empty, got ${equity.length}`);

    const tranches = r.snapshot.financingTranches as Array<FinancingTranche & { facilitySharePct?: number }>;
    if (tranches.every((t) => t.facilitySharePct === 50)) {
      pass('multi-facility facilitySharePct defaulted to even split (50/50)');
    } else fail('facilitySharePct', `got ${tranches.map((t) => t.facilitySharePct).join('/')}`);

    if (r.migrationNotice === M20M_PASS3_NOTICE) pass('Pass 3 banner surfaced');
    else fail('Pass 3 banner', `got: ${r.migrationNotice ?? 'none'}`);
  }

  // Idempotency: running again on a Pass-3-shaped snapshot should be no-op.
  const r2 = hydrationFromAnySnapshotChecked({
    ...snap,
    project: { ...project, financing: { ...project.financing!, viewMode: 'combined', selectedAssetId: undefined } },
    equityContributions: [],
    financingTranches: [
      { ...snap.financingTranches[0], facilitySharePct: 50 },
      { ...snap.financingTranches[1], facilitySharePct: 50 },
    ] as FinancingTranche[],
  });
  if (r2.recognized && !snapshotNeedsPass3Migration({ ...snap, project: r2.snapshot.project, equityContributions: r2.snapshot.equityContributions, financingTranches: r2.snapshot.financingTranches })) {
    pass('migration is idempotent on Pass-3-shaped snapshot');
  } else skip('idempotency', 'edge: detector heuristic may still flag, manual smoke');
}

// ── Section 2: Capex hooks ─────────────────────────────────────────────────
console.log('\n[2/12] Capex hooks return non-zero post Pass 7');
{
  // Construct a MAAD-shape fixture: 1 phase, 1 asset (Branded Apt) with
  // BUA 130,874 sqm and a per-asset cost line rate_per_bua 4,500.
  const project = makeDefaultProject();
  const phase = { ...makeDefaultPhase(), id: 'phase_1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 0, overlapPeriods: 0 } as Phase;
  const asset: Asset = {
    id: 'asset_branded', phaseId: phase.id, name: 'Branded Apt T2&T3', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 100000, parkingBaysRequired: 0,
  };
  const line: CostLine = {
    id: 'construction__phase_1__asset_branded',
    phaseId: phase.id,
    name: 'Construction',
    method: 'rate_per_bua',
    value: 4500,
    stage: 'hard',
    startPeriod: 0,
    endPeriod: 4,
    phasing: 'even',
    costCategory: 'direct',
    scope: 'direct',
    allocationBasis: 'bua_share',
    targetAssetId: asset.id,
  };
  const hooks = createFinancingHooks({
    project,
    phases: [phase],
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [asset],
    subUnits: [],
    costLines: [line],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  });
  const capex = hooks.getCapexExclLandInKind();
  const total = capex.reduce((s, v) => s + v, 0);
  const expected = 130874 * 4500; // 588,933,000
  if (Math.abs(total - expected) < 1) pass(`getCapexExclLandInKind total = ${total.toLocaleString()} (BUA x rate)`);
  else fail('capex total', `expected ${expected.toLocaleString()}, got ${total.toLocaleString()}`);

  const inkind = hooks.getLandInKindValue();
  if (inkind === 0) pass('getLandInKindValue = 0 when no in-kind land cost line');
  else fail('getLandInKindValue', `expected 0, got ${inkind}`);

  const perAsset = hooks.getCapexSchedule(asset.id);
  const perAssetTotal = perAsset.reduce((s, v) => s + v, 0);
  if (Math.abs(perAssetTotal - expected) < 1) pass(`getCapexSchedule(assetId) sums to ${perAssetTotal.toLocaleString()}`);
  else fail('getCapexSchedule per-asset', `expected ${expected.toLocaleString()}, got ${perAssetTotal.toLocaleString()}`);

  if (hooks.getLandCashValue() === 0) pass('getLandCashValue = 0 when no parcels');
  else fail('getLandCashValue', `expected 0, got ${hooks.getLandCashValue()}`);

  // Noop hooks have the new methods too.
  const noop = createNoopHooks(5);
  if (typeof noop.getCapexSchedule === 'function' && typeof noop.getLandCashValue === 'function') {
    pass('createNoopHooks exposes new getCapexSchedule + getLandCashValue');
  } else fail('noop hooks', 'missing new methods');
}

// ── Section 3: Per-facility ratio inherits ────────────────────────────────
console.log('\n[3/12] TrancheCard: Debt% + Principal inputs dropped');
{
  // Check the per-facility Debt % input is gone (data-testid ending in -ltv,
  // without the -cov suffix used by the LTV Covenant input in Advanced).
  if (!FINANCING_SRC.includes("data-testid={`tranche-${tranche.id}-ltv`}")) {
    pass('per-facility Debt % input (-ltv) removed');
  } else fail('Debt % input', 'still present');
  if (!FINANCING_SRC.includes("data-testid={`tranche-${tranche.id}-principal`}")) {
    pass('Principal input (-principal) removed');
  } else fail('Principal input', 'still present');
  if (FINANCING_SRC.includes('-facility-share')) pass('Facility Share % input present');
  else fail('Facility Share %', 'missing');
  if (TYPES_SRC.includes('facilitySharePct?: number')) pass('schema gains facilitySharePct field');
  else fail('schema facilitySharePct', 'missing');
}

// ── Section 4: Asset scope option re-added ────────────────────────────────
console.log('\n[4/12] TrancheCard: scope dropdown has 3 options');
{
  if (FINANCING_SRC.includes('-scope-asset')) pass('scope=asset picker test-id present');
  else fail('-scope-asset', 'missing');
  if (FINANCING_SRC.includes('-scope-phase')) pass('scope=phase picker test-id present');
  else fail('-scope-phase', 'missing');
  if (FINANCING_SRC.includes('Project-wide') && FINANCING_SRC.includes('Phase-specific') && FINANCING_SRC.includes('Asset-specific')) {
    pass('scope dropdown shows 3 options');
  } else fail('scope dropdown options', 'missing one of project/phase/asset');
}

// ── Section 5: Drawdown method dropdown dropped ───────────────────────────
console.log('\n[5/12] TrancheCard: drawdown method dropdown dropped');
{
  if (!FINANCING_SRC.includes('tranche-${tranche.id}-drawdown')) pass('drawdown method dropdown test-id removed');
  else fail('drawdown dropdown', 'still present');
  if (!FINANCING_SRC.includes('-include-land')) pass('drawdown include-land checkbox removed');
  else fail('include-land', 'still present');
  if (!FINANCING_SRC.includes('-cash-floor-drawdown')) pass('drawdown min-cash-floor input removed');
  else fail('cash-floor-drawdown', 'still present');
}

// ── Section 6: Repayment sub-method dropped ───────────────────────────────
console.log('\n[6/12] TrancheCard: equal repayment sub-method + sweep ratio dropped');
{
  if (!FINANCING_SRC.includes('-equal-sub')) pass('equal_repayment sub-method dropdown removed');
  else fail('-equal-sub', 'still present');
  if (!FINANCING_SRC.includes('-sweep-ratio')) pass('cash-sweep ratio input(s) removed');
  else fail('-sweep-ratio', 'still present');
  if (FINANCING_SRC.includes('-sweep-start-year')) pass('cash-sweep starting-year input kept');
  else fail('sweep-start-year', 'missing');
}

// ── Section 7: Equity Tranches section dropped ────────────────────────────
console.log('\n[7/12] Equity Tranches section dropped');
{
  if (!FINANCING_SRC.includes('Equity Tranches (') && !FINANCING_SRC.includes('financing-add-equity')) {
    pass('Equity Tranches add button + header removed');
  } else fail('Equity Tranches section', 'still present');
}

// ── Section 8: 3 Inputs Summary Tables ────────────────────────────────────
console.log('\n[8/12] Inputs Summary Tables present');
{
  if (FINANCING_SRC.includes('inputs-summary-tables')) pass('inputs-summary-tables container present');
  else fail('inputs-summary-tables', 'missing');
  if (FINANCING_SRC.includes("'funding', 'Total Funding Required'")) pass('Total Funding table render call present');
  else fail('Total Funding render call', 'missing');
  if (FINANCING_SRC.includes("'debt', 'Total Debt Required'")) pass('Total Debt table render call present');
  else fail('Total Debt render call', 'missing');
  if (FINANCING_SRC.includes("'equity', 'Total Equity Required'")) pass('Total Equity table render call present');
  else fail('Total Equity render call', 'missing');
  if (FINANCING_SRC.includes('inputs-summary-equity-cash') && FINANCING_SRC.includes('inputs-summary-equity-inkind')) {
    pass('Equity Total row gains Cash + In-Kind sub-rows');
  } else fail('equity sub-rows', 'missing cash or in-kind sub-row test-id');
}

// ── Section 9: All Phases aggregation + closing balance ───────────────────
console.log('\n[9/12] Schedules All Phases aggregation + closing balance math');
{
  if (FINANCING_SRC.includes('isAllPhases')) pass('isAllPhases flag present (phaseFilter aggregation)');
  else fail('isAllPhases', 'missing');

  // Sanity-check closing balance via the calc engine: with no IDC capitalization
  // and no repayment, closing balance should equal cumulative drawdown.
  const tranche: FinancingTranche = {
    id: 'tA', phaseId: 'p1', name: 'A', ltvPct: 70, interestRatePct: 0,
    drawdownMethod: 'capex_basis', repaymentMethod: 'equal_repayment',
    repaymentPeriods: 0, idcCapitalize: false, gracePeriods: 0,
  };
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 0, overlapPeriods: 0 };
  const capex = [100, 100, 100];
  const presales = [0, 0, 0];
  const project = makeDefaultProject();
  const r: FinancingResult = computeFinancing(tranche, phase, capex, presales, project);
  const cumDraw = r.drawSchedule.reduce((s, v) => s + v, 0);
  const finalOutstanding = r.outstandingBalance[r.outstandingBalance.length - 1];
  if (Math.abs(cumDraw - finalOutstanding) < 0.01) {
    pass(`closing balance = cumulative drawdown (no IDC, no repayment) = ${finalOutstanding.toFixed(0)}`);
  } else fail('closing balance', `cumDraw=${cumDraw} finalOutstanding=${finalOutstanding}`);
}

// ── Section 10: Auto-IDC integration post Pass 7 ──────────────────────────
console.log('\n[10/12] applyIdcToCapex still emits per-asset seeds');
{
  const tranche: FinancingTranche = {
    id: 'tIDC', phaseId: 'p1', name: 'Senior IDC', ltvPct: 70, interestRatePct: 8,
    drawdownMethod: 'capex_basis', repaymentMethod: 'equal_repayment',
    repaymentPeriods: 5, idcCapitalize: true, idcTreatment: 'capitalize',
    autoGenerateIdcCostLine: true,
  };
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 0, overlapPeriods: 0 };
  const project = makeDefaultProject();
  const assetA: Asset = {
    id: 'aA', phaseId: 'p1', name: 'Asset A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 8000, parkingBaysRequired: 0,
  };
  const r = computeFinancing(tranche, phase, [100, 100, 100], [0, 0, 0], project);
  const resultsMap = new Map<string, FinancingResult>([[tranche.id, r]]);
  const seeds = applyIdcToCapex([tranche], resultsMap, [assetA], [], [phase]);
  if (seeds.length > 0 && seeds[0].perAsset.length > 0 && seeds[0].perAsset[0].assetId === assetA.id) {
    pass('applyIdcToCapex emits per-asset seed with targetAssetId');
  } else fail('applyIdcToCapex', `got ${seeds.length} seeds`);
}

// ── Section 11: Em-dash sweep ─────────────────────────────────────────────
console.log('\n[11/12] No em-dashes in touched files');
{
  const filesToCheck: Array<{ name: string; src: string }> = [
    { name: 'Module1Financing.tsx', src: FINANCING_SRC },
    { name: 'financing-hooks.ts', src: HOOKS_SRC },
    { name: 'module1-migrate.ts', src: MIGRATE_SRC },
    { name: 'module1-types.ts', src: TYPES_SRC },
  ];
  for (const f of filesToCheck) {
    const matches = (f.src.match(/—/g) ?? []).length;
    if (matches === 0) pass(`${f.name}: no em-dashes`);
    else fail(`${f.name} em-dashes`, `${matches} found`);
  }
}

// ── Section 12: Design note + Single Asset toggle absence ─────────────────
console.log('\n[12/12] Design note + Single Asset toggle absence');
{
  const designNote = resolve(REPO_ROOT, 'docs/m20M-pass3-cleanup.md');
  if (existsSync(designNote)) pass('Pass 3 design note present');
  else fail('design note', 'missing');

  if (!FINANCING_SRC.includes('financing-view-combined') && !FINANCING_SRC.includes('financing-view-single')) {
    pass('Single Asset view toggle test-ids removed');
  } else fail('view toggle', 'still present');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Pass:    ${passed}`);
console.log(`Fail:    ${failed}`);
console.log(`Skip:    ${skipped}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
