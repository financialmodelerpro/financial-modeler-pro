/* eslint-disable no-console */
/**
 * verify-m20M.ts (M2.0M, 2026-05-11)
 *
 * Definitive Financing rewrite. First commit covers schema + migration
 * only; calc + hook layer + UI assertions land on follow-up commits.
 *
 * Sections:
 *   1. Schema: ProjectFinancingConfig + 4 method configs +
 *      ParcelFundingConfig types + enums + default constants exported.
 *   2. Migration: migrateM20MFinancing stamps default wrapper on legacy
 *      snapshots; M20M_FINANCING_NOTICE banner exported; idempotent.
 *   3. CostOverride.debtPctOverride / equityPctOverride present.
 *   4. Source markers: design notes + hook contract doc on disk.
 *   5. Em-dash sweep on the new files.
 *
 * Usage: npx tsx scripts/verify-m20M.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type FundingMethodId,
  type FundingMethod1Config,
  type FundingMethod2Config,
  type FundingMethod3Config,
  type FundingMethod4Config,
  type ParcelFundingType,
  type ParcelFundingConfig,
  type ProjectFinancingConfig,
  type FundingViewMode,
  type CostOverride,
  type CostLine,
  type Asset,
  type Project,
  FUNDING_METHOD_IDS,
  FUNDING_METHOD_LABELS,
  FUNDING_METHOD_DESCRIPTIONS,
  PARCEL_FUNDING_TYPES,
  PARCEL_FUNDING_TYPE_LABELS,
  FUNDING_VIEW_MODES,
  DEFAULT_FUNDING_METHOD_1_CONFIG,
  DEFAULT_FUNDING_METHOD_2_CONFIG,
  DEFAULT_FUNDING_METHOD_3_CONFIG,
  DEFAULT_FUNDING_METHOD_4_CONFIG,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  makeDefaultProject,
  makeDefaultPhase,
  makeDefaultParcel,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  M20M_FINANCING_NOTICE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

const REPO_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => {
  passed++;
  console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`);
};
const fail = (name: string, msg: string): void => {
  failed++;
  console.log(`  FAIL  ${name}: ${msg}`);
};
const skip = (name: string, msg: string): void => {
  skipped++;
  console.log(`  SKIP  ${name}: ${msg}`);
};

// ── Section 1: Schema + type surface ──────────────────────────────────────
console.log('\n[1/6] Schema + type surface');
{
  if (FUNDING_METHOD_IDS.length === 4 && FUNDING_METHOD_IDS.every((id, i) => id === (i + 1) as FundingMethodId)) {
    pass('FUNDING_METHOD_IDS = [1,2,3,4]');
  } else {
    fail('FUNDING_METHOD_IDS', `got ${JSON.stringify(FUNDING_METHOD_IDS)}`);
  }

  const labels = Object.keys(FUNDING_METHOD_LABELS);
  if (labels.length === 4) pass('FUNDING_METHOD_LABELS has 4 entries');
  else fail('FUNDING_METHOD_LABELS', `got ${labels.length} entries`);

  const descs = Object.keys(FUNDING_METHOD_DESCRIPTIONS);
  if (descs.length === 4) pass('FUNDING_METHOD_DESCRIPTIONS has 4 entries');
  else fail('FUNDING_METHOD_DESCRIPTIONS', `got ${descs.length} entries`);

  if (PARCEL_FUNDING_TYPES.length === 5) {
    pass('PARCEL_FUNDING_TYPES has 5 members', PARCEL_FUNDING_TYPES.join(','));
  } else {
    fail('PARCEL_FUNDING_TYPES', `got ${JSON.stringify(PARCEL_FUNDING_TYPES)}`);
  }

  const expectedParcelTypes: ParcelFundingType[] = [
    '100pct_equity', '100pct_debt', 'custom_split', 'in_kind', 'deferred_payment',
  ];
  const allParcelTypesPresent = expectedParcelTypes.every((t) => PARCEL_FUNDING_TYPES.includes(t));
  if (allParcelTypesPresent) pass('PARCEL_FUNDING_TYPES carries all 5 brief-mandated kinds');
  else fail('PARCEL_FUNDING_TYPES', 'missing one of the 5 kinds');

  if (Object.keys(PARCEL_FUNDING_TYPE_LABELS).length === 5) pass('PARCEL_FUNDING_TYPE_LABELS has 5 entries');
  else fail('PARCEL_FUNDING_TYPE_LABELS', `got ${Object.keys(PARCEL_FUNDING_TYPE_LABELS).length} entries`);

  if (FUNDING_VIEW_MODES.length === 2 && FUNDING_VIEW_MODES.includes('combined') && FUNDING_VIEW_MODES.includes('single_asset')) {
    pass('FUNDING_VIEW_MODES = [combined, single_asset]');
  } else {
    fail('FUNDING_VIEW_MODES', `got ${JSON.stringify(FUNDING_VIEW_MODES)}`);
  }

  if (
    DEFAULT_FUNDING_METHOD_1_CONFIG.debtPct === 70 &&
    DEFAULT_FUNDING_METHOD_1_CONFIG.equityPct === 30
  ) {
    pass('DEFAULT_FUNDING_METHOD_1_CONFIG 70/30');
  } else {
    fail('DEFAULT_FUNDING_METHOD_1_CONFIG', JSON.stringify(DEFAULT_FUNDING_METHOD_1_CONFIG));
  }

  if (Array.isArray(DEFAULT_FUNDING_METHOD_2_CONFIG.master) && DEFAULT_FUNDING_METHOD_2_CONFIG.master.length === 0) {
    pass('DEFAULT_FUNDING_METHOD_2_CONFIG has empty master[]');
  } else fail('DEFAULT_FUNDING_METHOD_2_CONFIG', 'master[] not empty');

  if (
    DEFAULT_FUNDING_METHOD_3_CONFIG.existingCash === 0 &&
    DEFAULT_FUNDING_METHOD_3_CONFIG.debtPct === 70 &&
    DEFAULT_FUNDING_METHOD_3_CONFIG.equityPct === 30
  ) {
    pass('DEFAULT_FUNDING_METHOD_3_CONFIG 0/70/30');
  } else fail('DEFAULT_FUNDING_METHOD_3_CONFIG', JSON.stringify(DEFAULT_FUNDING_METHOD_3_CONFIG));

  if (
    DEFAULT_FUNDING_METHOD_4_CONFIG.initialCash === 0 &&
    DEFAULT_FUNDING_METHOD_4_CONFIG.minimumCashReserve === 0 &&
    DEFAULT_FUNDING_METHOD_4_CONFIG.debtPct === 70 &&
    DEFAULT_FUNDING_METHOD_4_CONFIG.equityPct === 30
  ) {
    pass('DEFAULT_FUNDING_METHOD_4_CONFIG 0/0/70/30');
  } else fail('DEFAULT_FUNDING_METHOD_4_CONFIG', JSON.stringify(DEFAULT_FUNDING_METHOD_4_CONFIG));

  if (
    DEFAULT_PROJECT_FINANCING_CONFIG.fundingMethod === 1 &&
    DEFAULT_PROJECT_FINANCING_CONFIG.viewMode === 'combined' &&
    Array.isArray(DEFAULT_PROJECT_FINANCING_CONFIG.parcelFunding) &&
    DEFAULT_PROJECT_FINANCING_CONFIG.parcelFunding.length === 0
  ) {
    pass('DEFAULT_PROJECT_FINANCING_CONFIG defaults to Method 1, Combined, no parcels');
  } else fail('DEFAULT_PROJECT_FINANCING_CONFIG', JSON.stringify(DEFAULT_PROJECT_FINANCING_CONFIG));

  // Sanity construct a per-parcel deferred-payment config to verify the
  // structural shape (compile-time + runtime).
  const sampleParcel: ParcelFundingConfig = {
    parcelId: 'parcel_1',
    fundingType: 'deferred_payment',
    deferredSchedule: {
      type: 'manual_pct',
      startPeriod: 1,
      endPeriod: 24,
      distribution: Array(24).fill(100 / 24),
    },
    facilityId: 'tranche_1',
  };
  if (sampleParcel.deferredSchedule?.distribution?.length === 24) {
    pass('ParcelFundingConfig deferred_payment shape compiles');
  } else fail('ParcelFundingConfig deferred shape', 'unexpected');

  // CostOverride extension: debtPctOverride + equityPctOverride.
  const sampleOverride: CostOverride = {
    assetId: 'asset_1',
    lineId: 'construction-bua__phase_1',
    method: 'rate_per_bua',
    value: 1500,
    phasing: 'even',
    overridden: true,
    debtPctOverride: 80,
    equityPctOverride: 20,
  };
  if (sampleOverride.debtPctOverride === 80 && sampleOverride.equityPctOverride === 20) {
    pass('CostOverride.debtPctOverride + equityPctOverride accept values');
  } else fail('CostOverride debt/equity override', 'shape mismatch');
}

// ── Section 2: Migration ──────────────────────────────────────────────────
console.log('\n[2/6] Migration: migrateM20MFinancing wrapper + banner');
{
  // Test 2a: a v8 snapshot WITHOUT project.financing gets the wrapper
  // stamped + M20M banner surfaced.
  const legacyV8: Record<string, unknown> = {
    version: 8,
    savedAt: new Date().toISOString(),
    project: {
      name: 'Legacy Project',
      currency: 'SAR',
      modelType: 'annual',
      startDate: '2026-01-01',
      status: 'draft',
      location: '',
      outputGranularity: 'annual',
      displayScale: 'full',
      displayDecimals: 2,
      // NOTE: no financing field
    },
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

  const result = hydrationFromAnySnapshotChecked(legacyV8);
  const migratedProject = result.snapshot.project as Project;
  if (migratedProject.financing !== undefined) {
    pass('migrateM20MFinancing stamps financing wrapper');
  } else {
    fail('migrateM20MFinancing wrapper', 'financing still undefined');
  }

  if (migratedProject.financing?.fundingMethod === 1) {
    pass('Stamped wrapper defaults fundingMethod=1');
  } else fail('Stamped wrapper fundingMethod', `got ${migratedProject.financing?.fundingMethod}`);

  if (migratedProject.financing?.viewMode === 'combined') {
    pass('Stamped wrapper defaults viewMode=combined');
  } else fail('Stamped wrapper viewMode', `got ${migratedProject.financing?.viewMode}`);

  if (Array.isArray(migratedProject.financing?.parcelFunding) && migratedProject.financing?.parcelFunding.length === 0) {
    pass('Stamped wrapper defaults parcelFunding=[]');
  } else fail('Stamped wrapper parcelFunding', JSON.stringify(migratedProject.financing?.parcelFunding));

  if (
    migratedProject.financing?.fixedRatio?.debtPct === 70 &&
    migratedProject.financing?.fixedRatio?.equityPct === 30
  ) {
    pass('Stamped wrapper defaults fixedRatio=70/30');
  } else fail('Stamped wrapper fixedRatio', JSON.stringify(migratedProject.financing?.fixedRatio));

  if (result.migrationNotice === M20M_FINANCING_NOTICE) {
    pass('M20M_FINANCING_NOTICE surfaced on migration');
  } else {
    fail('M20M banner', `expected M20M notice, got ${result.migrationNotice}`);
  }

  // Test 2b: idempotency. Re-feeding the migrated snapshot through hydration
  // must not duplicate work or change the financing config.
  const reMigratable = {
    version: 8,
    savedAt: new Date().toISOString(),
    ...result.snapshot,
  };
  const result2 = hydrationFromAnySnapshotChecked(reMigratable);
  const reMigrated = result2.snapshot.project as Project;
  if (JSON.stringify(reMigrated.financing) === JSON.stringify(migratedProject.financing)) {
    pass('Idempotent: re-hydration leaves financing config bit-identical');
  } else {
    fail('Idempotent', 'second pass diverged');
  }
  if (result2.migrationNotice !== M20M_FINANCING_NOTICE) {
    pass('Idempotent: M20M banner does NOT re-fire after migration');
  } else {
    fail('Idempotent banner', 'M20M banner still firing on second pass');
  }
}

// ── Section 3: makeDefaultProject ─────────────────────────────────────────
console.log('\n[3/6] makeDefaultProject seeds financing wrapper');
{
  const fresh = makeDefaultProject();
  if (fresh.financing !== undefined) {
    pass('makeDefaultProject seeds project.financing');
  } else fail('makeDefaultProject', 'financing undefined on fresh project');

  if (fresh.financing?.fundingMethod === 1) pass('Fresh project defaults to Method 1');
  else fail('Fresh project method', `got ${fresh.financing?.fundingMethod}`);

  if (fresh.financing?.viewMode === 'combined') pass('Fresh project defaults to Combined view');
  else fail('Fresh project viewMode', `got ${fresh.financing?.viewMode}`);
}

// ── Section 4: Design notes + source markers on disk ──────────────────────
console.log('\n[4/6] Design notes + hook contract on disk');
{
  const archDoc = resolve(REPO_ROOT, 'docs/m20M-financing-architecture.md');
  if (existsSync(archDoc)) {
    const txt = readFileSync(archDoc, 'utf8');
    if (txt.includes('parameter-named hooks') || txt.includes('parameter-based hooks')) {
      pass('m20M-financing-architecture.md exists + mentions parameter-based hooks');
    } else {
      fail('architecture doc content', 'does not mention parameter-based hooks');
    }
    if (txt.includes('Method 1') && txt.includes('Method 2') && txt.includes('Method 3') && txt.includes('Method 4')) {
      pass('Architecture doc covers all 4 methods');
    } else fail('architecture doc methods', 'missing method section');
    if (txt.includes('ParcelFundingConfig')) pass('Architecture doc names ParcelFundingConfig');
    else fail('architecture doc ParcelFundingConfig', 'missing');
  } else {
    fail('architecture doc presence', 'docs/m20M-financing-architecture.md missing');
  }

  const hooksDoc = resolve(REPO_ROOT, 'docs/financing-hooks.md');
  if (existsSync(hooksDoc)) {
    const txt = readFileSync(hooksDoc, 'utf8');
    const requiredHooks = [
      'getCapexExclLandInKind',
      'getPreSalesCollections',
      'getOperatingCashFlow',
      'getClosingCashBalance',
      'getLandInKindValue',
    ];
    const missing = requiredHooks.filter((h) => !txt.includes(h));
    if (missing.length === 0) pass('financing-hooks.md documents all 5 core hooks');
    else fail('financing-hooks.md core hooks', `missing: ${missing.join(', ')}`);
  } else {
    fail('hooks doc presence', 'docs/financing-hooks.md missing');
  }
}

// ── Section 4b: Hook layer ───────────────────────────────────────────────
console.log('\n[5/6] Hook layer: createFinancingHooks contract');
{
  const hooksPath = resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts');
  if (!existsSync(hooksPath)) {
    fail('hook layer presence', 'financing-hooks.ts missing');
  } else {
    pass('financing-hooks.ts exists on disk');
  }

  // Dynamic import so verifier still runs section 1-4 even if hook
  // wiring fails at compile time.
  let mod: typeof import('../src/hubs/modeling/platforms/refm/lib/financing-hooks') | null = null;
  try {
    mod = require('../src/hubs/modeling/platforms/refm/lib/financing-hooks');
  } catch (e) {
    fail('hook layer import', `require failed: ${(e as Error).message}`);
  }

  if (mod) {
    if (typeof mod.createFinancingHooks === 'function') pass('createFinancingHooks exported as function');
    else fail('createFinancingHooks export', 'not a function');
    if (typeof mod.createNoopHooks === 'function') pass('createNoopHooks exported as function');
    else fail('createNoopHooks export', 'not a function');

    // Build a minimal source. Single phase, single asset, single
    // cost line. Total periods = 5 (4 construction + ramp). The
    // hook should return 5+1 = 6 length arrays.
    const project = makeDefaultProject();
    project.startDate = '2026-01-01';
    const phase = makeDefaultPhase();
    phase.startDate = '2026-01-01';
    phase.constructionPeriods = 4;
    phase.operationsPeriods = 1;
    phase.overlapPeriods = 0;
    const parcel = makeDefaultParcel(undefined, phase.id);
    const asset = {
      id: 'asset_1', phaseId: phase.id, name: 'Tower A', type: 'High-end Apartments',
      strategy: 'Sell' as const, visible: true,
      gfaSqm: 12000, buaSqm: 10000, sellableBuaSqm: 8000, parkingBaysRequired: 100,
    };
    const costLine = {
      id: 'construction-bua__phase_1',
      phaseId: phase.id,
      name: 'Construction (BUA)',
      method: 'rate_per_bua' as const,
      value: 1500,
      stage: 'hard' as const,
      scope: 'direct' as const,
      allocationBasis: 'per_asset' as const,
      startPeriod: 0,
      endPeriod: 3,
      phasing: 'even' as const,
      costCategory: 'direct' as const,
    };
    const source = {
      project,
      phases: [phase],
      parcels: [parcel],
      landAllocationMode: 'autoByBua' as const,
      assets: [asset as Asset],
      subUnits: [],
      costLines: [costLine] as CostLine[],
      costOverrides: [],
      financingTranches: [],
      equityContributions: [],
    };

    try {
      const hooks = mod.createFinancingHooks(source);
      const capexExclInKind = hooks.getCapexExclLandInKind();
      const capexIncl = hooks.getCapexInclLandInKind();
      const capexExclTotalLand = hooks.getCapexExclTotalLand();
      const landInKind = hooks.getLandInKindValue();
      const preSales = hooks.getPreSalesCollections();
      const ocf = hooks.getOperatingCashFlow();
      const cashAt2 = hooks.getClosingCashBalance(2);
      const depn = hooks.getDepreciationSchedule();
      const rev = hooks.getRevenueSchedule();
      const opex = hooks.getOperatingExpenses();

      if (Array.isArray(capexExclInKind) && capexExclInKind.length > 0) pass(`getCapexExclLandInKind returns PeriodArray len=${capexExclInKind.length}`);
      else fail('getCapexExclLandInKind', 'returned non-array or empty');

      // Expected: 1500 SAR/sqm x 10000 sqm = 15,000,000 SAR total cost,
      // distributed evenly across 4 construction periods = 3,750,000/yr.
      const sumExclInKind = capexExclInKind.reduce((a, b) => a + b, 0);
      if (Math.abs(sumExclInKind - 15_000_000) < 1_000) {
        pass(`getCapexExclLandInKind sums to expected 15M (got ${sumExclInKind.toLocaleString()})`);
      } else {
        fail('getCapexExclLandInKind total', `expected ~15M, got ${sumExclInKind}`);
      }

      const sumIncl = capexIncl.reduce((a, b) => a + b, 0);
      // With Parcel having no in-kind portion configured in the cost
      // lines, Incl should match Excl on this fixture (the parcel is
      // not auto-converted to a cost line). Allow equality or larger.
      if (sumIncl >= sumExclInKind) {
        pass(`getCapexInclLandInKind sum (${sumIncl.toLocaleString()}) >= Excl-In-Kind sum`);
      } else {
        fail('getCapexInclLandInKind sum', `${sumIncl} < ${sumExclInKind}`);
      }

      // Stubs return zero arrays.
      if (preSales.every((v) => v === 0)) pass('getPreSalesCollections is zero-stub');
      else fail('getPreSalesCollections', 'expected zeros');
      if (ocf.every((v) => v === 0)) pass('getOperatingCashFlow is zero-stub');
      else fail('getOperatingCashFlow', 'expected zeros');
      if (depn.every((v) => v === 0)) pass('getDepreciationSchedule is zero-stub');
      else fail('getDepreciationSchedule', 'expected zeros');
      if (rev.every((v) => v === 0)) pass('getRevenueSchedule is zero-stub');
      else fail('getRevenueSchedule', 'expected zeros');
      if (opex.every((v) => v === 0)) pass('getOperatingExpenses is zero-stub');
      else fail('getOperatingExpenses', 'expected zeros');

      // Closing cash sim: initialCash=0, ratio=0.7, capex=15M.
      // At t=2 (after periods 0..2), cumulative capex = 3*3.75M = 11.25M.
      // Equity contributed = 0.3 * 11.25M = 3.375M.
      // Debt drawn = 0.7 * 11.25M = 7.875M.
      // Net cash flow (excl. interest) = -11.25M + 3.375M + 7.875M = 0.
      // Plus tiny interest deduction. Should be slightly negative.
      if (cashAt2 <= 0 && cashAt2 > -2_000_000) {
        pass(`getClosingCashBalance(2) within expected tiny-deficit window (got ${cashAt2.toFixed(0)})`);
      } else {
        fail('getClosingCashBalance(2)', `unexpected value ${cashAt2.toFixed(0)}`);
      }

      // Land in-kind value: zero on this fixture (no in-kind cost lines).
      if (landInKind === 0) pass('getLandInKindValue=0 on no-in-kind fixture');
      else fail('getLandInKindValue', `expected 0, got ${landInKind}`);

      // Memoisation: re-invocation returns the same array reference.
      const second = hooks.getCapexExclLandInKind();
      if (second === capexExclInKind) pass('hook results are memoised (same reference on 2nd call)');
      else fail('memoisation', 'expected same array reference on 2nd call');

      // Period alignment: capex outflows live in periods 0..3 (zero in 4 and 5).
      if (capexExclInKind[0] > 0 && capexExclInKind[3] > 0 && (capexExclInKind[4] ?? 0) === 0) {
        pass('Capex period alignment: occupies periods 0..3, zero in 4+');
      } else {
        fail('capex period alignment', `got [${capexExclInKind.map((n) => n.toFixed(0)).join(', ')}]`);
      }

      // Land sanity: with no land cost lines on the fixture,
      // capexExclTotalLand should equal capexExclLandInKind.
      const exclTotalSum = capexExclTotalLand.reduce((a, b) => a + b, 0);
      if (Math.abs(exclTotalSum - sumExclInKind) < 1) {
        pass('getCapexExclTotalLand matches Excl-In-Kind on no-land fixture');
      } else {
        fail('getCapexExclTotalLand', `expected ${sumExclInKind}, got ${exclTotalSum}`);
      }
    } catch (e) {
      fail('hook execution', `threw: ${(e as Error).message}`);
    }

    // createNoopHooks contract.
    const noop = mod.createNoopHooks(10);
    if (noop.getCapexExclLandInKind().every((v) => v === 0)) pass('createNoopHooks zeros');
    else fail('createNoopHooks zeros', 'non-zero entry');
  }
}

// ── Section 6: Em-dash sweep on new files ─────────────────────────────────
console.log('\n[6/6] Em-dash sweep');
{
  const newFiles = [
    'docs/m20M-financing-architecture.md',
    'docs/financing-hooks.md',
    'scripts/verify-m20M.ts',
    'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts',
  ];
  let cleanCount = 0;
  for (const f of newFiles) {
    const p = resolve(REPO_ROOT, f);
    if (!existsSync(p)) {
      skip(`em-dash sweep ${f}`, 'file missing');
      continue;
    }
    const txt = readFileSync(p, 'utf8');
    const EM_DASH = String.fromCharCode(0x2014);
    if (txt.includes(EM_DASH)) {
      fail(`em-dash sweep ${f}`, 'contains em-dash');
    } else {
      cleanCount++;
    }
  }
  if (cleanCount === newFiles.length) pass(`em-dash sweep: all ${newFiles.length} new files clean`);
}

// ── Tally ─────────────────────────────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  verify-m20M.ts  ${passed} pass / ${failed} fail / ${skipped} skip`);
console.log('═══════════════════════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
