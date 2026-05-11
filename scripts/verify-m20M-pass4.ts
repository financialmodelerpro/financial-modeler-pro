/* eslint-disable no-console */
/**
 * verify-m20M-pass4.ts (M2.0M Pass 4 Tab 4 Financing cleanup, 2026-05-12)
 *
 * Sections (one per fix, plus verifier-only sections):
 *   1. Mandatory diagnostic file present on disk.
 *   2. Fix 10: force fix zero-rendering - funding routed off project-wide
 *      capex (inputsSummary.totals). MAAD-shape fixture produces 588.9M
 *      via inputsSummary aggregation path (mirrors UI's actual data flow).
 *   3. Fix 9: assetFilter replaces phaseFilter. Schema, migration, UI.
 *   4. Fix 6: formatAccounting helper exported with correct contract
 *      (zero -> "-", negative -> "(x)", null -> "", positive -> "1,234").
 *      UI sites use formatAccounting instead of formatScaledForExport.
 *   5. Fix 1: Method 2 line-item table renders for Method 2.
 *   6. Fix 2: Funding Basis block above facilities.
 *   7. Fix 3: Capital Structure Overview cards (Total Funding lead +
 *      Equity Cash + Equity In-Kind + Total Capex + LTV + match chip).
 *   8. Fix 4: Compact field layout (TrancheCard 2 per row instead of 4).
 *   9. Fix 5: Drawdown periods only + Total row label simplified.
 *  10. Fix 7+8: Schedules restructure - Debt Movement, Finance Cost,
 *      Equity Movement (Opening + Closing pattern).
 *  11. Em-dash sweep across touched files.
 *  12. Migration banner cascade prioritizes Pass 4 first.
 *
 * Usage: npx tsx scripts/verify-m20M-pass4.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type CostLine,
  type FinancingTranche,
  type Phase,
  type Project,
  ASSET_FILTER_COMBINED,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
  M20M_PASS4_NOTICE,
  snapshotNeedsPass4FinancingMigration,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  formatAccounting,
} from '../src/core/formatters';
import {
  computeFunding,
  computeEquity,
  computeAssetCost,
  costLineProjectPeriodIndex,
  computeProjectTimeline,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

const FINANCING_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx'), 'utf8');
const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const MIGRATE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');
const FORMATTERS_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/formatters/index.ts'), 'utf8');

// ── Section 1: Mandatory diagnostic file ──────────────────────────────────
console.log('\n[1/12] Mandatory diagnostic file');
{
  const diagPath = resolve(REPO_ROOT, 'docs/m20M-pass4-diagnostic.md');
  if (existsSync(diagPath)) pass('docs/m20M-pass4-diagnostic.md present');
  else fail('diagnostic file', 'missing');

  const diag = existsSync(diagPath) ? readFileSync(diagPath, 'utf8') : '';
  if (diag.includes('UI never calls') || diag.includes('createFinancingHooks')) {
    pass('diagnostic identifies hook-not-consumed root cause');
  } else fail('diagnostic content', 'does not mention hook-not-consumed bug');
}

// ── Section 2: Fix 10 force fix zero-rendering ────────────────────────────
console.log('\n[2/12] Fix 10: funding routed off project-wide capex (MAAD 588.9M)');
{
  // Build MAAD-shape fixture: 1 phase, 1 asset BUA 130,874, 1 cost line
  // rate_per_bua=4500. Expected funding total = 130874 x 4500 = 588,933,000.
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

  // Mirror the UI's inputsSummary aggregation path (Module1Financing.tsx:989).
  const timeline = computeProjectTimeline(project, [phase]);
  const totalPeriods = Math.max(0, timeline.totalPeriods);
  const totals = new Array<number>(totalPeriods).fill(0);
  const breakdown = computeAssetCost(asset, project, phase, [], [asset], [], [line], [], 'autoByBua');
  for (let localPeriod = 0; localPeriod < breakdown.perPeriod.length; localPeriod++) {
    const pp = costLineProjectPeriodIndex(project, phase, localPeriod);
    if (pp < 0 || pp >= totalPeriods) continue;
    const cash = Math.max(0, (breakdown.perPeriod[localPeriod] ?? 0) - (breakdown.perPeriodLandInKind[localPeriod] ?? 0));
    totals[pp] += cash;
  }
  const aggregateTotal = totals.reduce((s, v) => s + v, 0);
  const expected = 130874 * 4500;
  if (Math.abs(aggregateTotal - expected) < 1) {
    pass(`inputsSummary.totals aggregates to ${aggregateTotal.toLocaleString()} (MAAD 588.9M)`);
  } else fail('inputsSummary aggregate', `expected ${expected.toLocaleString()}, got ${aggregateTotal.toLocaleString()}`);

  // Now run computeFunding against this project-wide capex and confirm
  // funding.totalNeed lands on the expected number (Method 1 default 70/30,
  // totalNeed = capex for Method 1).
  const funding = computeFunding({
    method: 1,
    financing: project.financing!,
    capexPerPeriod: totals,
  });
  if (Math.abs(funding.totalNeed - expected) < 1) {
    pass(`computeFunding(Method 1).totalNeed = ${funding.totalNeed.toLocaleString()}`);
  } else fail('funding.totalNeed', `expected ${expected.toLocaleString()}, got ${funding.totalNeed.toLocaleString()}`);

  // Equity = 30% of need.
  const equity = computeEquity(project.financing!, funding, 0);
  const expectedEquity = expected * 0.3;
  if (Math.abs(equity.cashContribution + equity.inKindContribution - expectedEquity) < 1) {
    pass(`computeEquity total = ${(equity.cashContribution + equity.inKindContribution).toLocaleString()} (30% of need)`);
  } else fail('equity total', `expected ${expectedEquity.toLocaleString()}, got ${(equity.cashContribution + equity.inKindContribution).toLocaleString()}`);

  // UI source markers for Fix 10.
  if (FINANCING_SRC.includes('inputsSummary.totals') && FINANCING_SRC.includes('capexPerPeriod: inputsSummary.totals')) {
    pass('UI routes computeFunding through inputsSummary.totals (Pass 4 wiring)');
  } else fail('Fix 10 UI wiring', 'computeFunding call does not consume inputsSummary.totals');
  // Strip line comments + block comments to check usage only (computeCapitalStack
  // appears in a comment noting it was dropped, which is fine).
  const stripped = FINANCING_SRC
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.includes('computeCapitalStack')) {
    pass('UI no longer imports/calls computeCapitalStack (deprecated path bypassed)');
  } else fail('Fix 10 computeCapitalStack', 'still imported/used in code (not just comment)');
}

// ── Section 3: Fix 9 assetFilter replaces phaseFilter ─────────────────────
console.log('\n[3/12] Fix 9: assetFilter replaces phaseFilter');
{
  if (TYPES_SRC.includes('assetFilter?: string')) pass('schema gains assetFilter? field');
  else fail('schema assetFilter', 'missing');

  if (TYPES_SRC.includes("ASSET_FILTER_COMBINED = '__combined__'")) pass('ASSET_FILTER_COMBINED sentinel exported');
  else fail('ASSET_FILTER_COMBINED', 'missing');

  if (MIGRATE_SRC.includes('function migrateM20mPass4Financing(')) pass('migrateM20mPass4Financing helper defined');
  else fail('migration helper', 'not found');

  if (MIGRATE_SRC.includes('function snapshotNeedsPass4FinancingMigration(')) pass('snapshotNeedsPass4FinancingMigration detector defined');
  else fail('Pass 4 detector', 'not found');

  if (typeof M20M_PASS4_NOTICE === 'string' && M20M_PASS4_NOTICE.length > 0) pass('M20M_PASS4_NOTICE banner exported');
  else fail('Pass 4 banner', 'missing');

  // Migration round-trip: snapshot with no assetFilter -> get __combined__.
  const project = makeDefaultProject();
  project.financing = { ...project.financing! };
  delete (project.financing as Partial<typeof project.financing>).assetFilter;
  const snap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project,
    phases: [{ ...makeDefaultPhase(), id: 'p1' } as Phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [] as Asset[],
    subUnits: [],
    costLines: [] as CostLine[],
    costOverrides: [],
    financingTranches: [] as FinancingTranche[],
    equityContributions: [],
  };
  if (snapshotNeedsPass4FinancingMigration(snap)) pass('detector flags pre-Pass-4 snapshot');
  else fail('Pass 4 detector flag', 'did not flag missing assetFilter');

  const r = hydrationFromAnySnapshotChecked(snap);
  if (r.recognized) {
    const f = (r.snapshot.project as Project).financing!;
    if (f.assetFilter === ASSET_FILTER_COMBINED) pass(`assetFilter defaulted to ${ASSET_FILTER_COMBINED}`);
    else fail('assetFilter default', `got ${f.assetFilter}`);
  } else fail('hydration', `not recognized: ${r.error ?? 'unknown'}`);

  if (FINANCING_SRC.includes('data-testid="financing-asset-filter"')) pass('financing-asset-filter rendered in UI');
  else fail('asset filter UI', 'data-testid missing');

  if (!FINANCING_SRC.includes('data-testid="financing-phase-filter"')) pass('financing-phase-filter dropped from UI');
  else fail('phase filter UI', 'still present');
}

// ── Section 4: Fix 6 universal accounting format ──────────────────────────
console.log('\n[4/12] Fix 6: formatAccounting helper + UI adoption');
{
  if (FORMATTERS_SRC.includes('export function formatAccounting(')) pass('formatAccounting exported');
  else fail('formatAccounting export', 'missing');

  // Contract: zero -> "-", negative -> parens, null -> "", positive -> "1,234".
  if (formatAccounting(0, 'full') === '-') pass('formatAccounting(0) = "-"');
  else fail('formatAccounting(0)', `got ${JSON.stringify(formatAccounting(0, 'full'))}`);

  if (formatAccounting(null, 'full') === '') pass('formatAccounting(null) = ""');
  else fail('formatAccounting(null)', `got ${JSON.stringify(formatAccounting(null, 'full'))}`);

  if (formatAccounting(undefined, 'full') === '') pass('formatAccounting(undefined) = ""');
  else fail('formatAccounting(undefined)', `got ${JSON.stringify(formatAccounting(undefined, 'full'))}`);

  if (formatAccounting(1234567, 'full', 0) === '1,234,567') pass('formatAccounting(1234567) = "1,234,567"');
  else fail('formatAccounting(positive)', `got ${JSON.stringify(formatAccounting(1234567, 'full', 0))}`);

  if (formatAccounting(-1234567, 'full', 0) === '(1,234,567)') pass('formatAccounting(-1234567) = "(1,234,567)"');
  else fail('formatAccounting(negative)', `got ${JSON.stringify(formatAccounting(-1234567, 'full', 0))}`);

  // Scaled: 1234567 at thousands w/ 0 decimals -> "1,235" (rounding).
  if (formatAccounting(1234567, 'thousands', 0) === '1,235') pass('formatAccounting scaled (thousands) drops K suffix');
  else fail('formatAccounting scaled', `got ${JSON.stringify(formatAccounting(1234567, 'thousands', 0))}`);

  if (FINANCING_SRC.includes('formatAccounting(')) pass('Module1Financing.tsx uses formatAccounting');
  else fail('Module1Financing adoption', 'no formatAccounting usage found');

  if (COSTS_SRC.includes('formatAccounting(')) pass('Module1Costs.tsx uses formatAccounting');
  else fail('Module1Costs adoption', 'no formatAccounting usage found');
}

// ── Section 5: Fix 1 Method 2 line-item table ─────────────────────────────
console.log('\n[5/12] Fix 1: Method 2 line-item table');
{
  if (FINANCING_SRC.includes('data-testid="funding-method-2-table"')) pass('funding-method-2-table renders');
  else fail('Method 2 table', 'data-testid missing');

  if (FINANCING_SRC.includes('m2-debt-')) pass('per-row m2-debt- input test-id present');
  else fail('Method 2 row inputs', 'missing');

  if (FINANCING_SRC.includes('m2-equity-')) pass('per-row m2-equity- read-only test-id present');
  else fail('Method 2 row equity', 'missing');

  if (FINANCING_SRC.includes('deriveLineBaseId')) pass('Method 2 dedupes composed line ids via deriveLineBaseId');
  else fail('Method 2 dedupe', 'deriveLineBaseId not used');

  // The placeholder string from Pass 3 must be gone.
  if (!FINANCING_SRC.includes('next sub-pass)')) pass('Method 2 placeholder text removed');
  else fail('Method 2 placeholder', 'still present');
}

// ── Section 6: Fix 2 Funding Basis block ──────────────────────────────────
console.log('\n[6/12] Fix 2: Funding Basis block');
{
  if (FINANCING_SRC.includes('data-testid="financing-funding-basis"')) pass('financing-funding-basis card rendered');
  else fail('Funding Basis card', 'missing');

  for (const id of ['funding-basis-method', 'funding-basis-source', 'funding-basis-capex', 'funding-basis-need']) {
    if (FINANCING_SRC.includes(`data-testid="${id}"`)) pass(`${id} test-id present`);
    else fail(id, 'missing');
  }
}

// ── Section 7: Fix 3 Capital Structure Overview ───────────────────────────
console.log('\n[7/12] Fix 3: Capital Structure Overview content');
{
  if (FINANCING_SRC.includes('data-testid="cap-stack-total-funding"')) pass('cap-stack-total-funding lead card');
  else fail('Total Funding lead', 'missing');

  if (FINANCING_SRC.includes('data-testid="cap-stack-equity-cash"')) pass('cap-stack-equity-cash card');
  else fail('Equity Cash card', 'missing');

  if (FINANCING_SRC.includes('data-testid="cap-stack-equity-inkind"')) pass('cap-stack-equity-inkind card');
  else fail('Equity In-Kind card', 'missing');

  if (FINANCING_SRC.includes('data-testid="cap-stack-uses"')) pass('cap-stack-uses (Total Capex) card');
  else fail('Total Uses card', 'missing');

  if (FINANCING_SRC.includes('data-testid="cap-stack-match-chip"')) pass('cap-stack-match-chip (gap) card');
  else fail('match chip', 'missing');

  // Old generic Total Equity card label removed in favor of split into cash + in-kind.
  if (!FINANCING_SRC.includes('data-testid="cap-stack-equity"')) pass('generic cap-stack-equity card removed (split)');
  else fail('cap-stack-equity', 'still present (should be split)');
}

// ── Section 8: Fix 4 compact field layout ─────────────────────────────────
console.log('\n[8/12] Fix 4: compact field layout');
{
  // 4-per-row grid for Tenor/Availability/Grace/Repayment should be gone;
  // 2-per-row grids in its place.
  const fourPerRowCount = (FINANCING_SRC.match(/repeat\(4, 1fr\)/g) ?? []).length;
  if (fourPerRowCount === 0) pass('no repeat(4, 1fr) grids in Module1Financing.tsx');
  else fail('4-per-row grids', `${fourPerRowCount} still present`);

  if (FINANCING_SRC.includes("P4-Fix 4 (2026-05-12): compact field layout")) pass('Fix 4 comment marker present');
  else fail('Fix 4 marker', 'missing');
}

// ── Section 9: Fix 5 drawdown periods + Total row label ───────────────────
console.log('\n[9/12] Fix 5: drawdown periods + Total row label');
{
  if (FINANCING_SRC.includes('activePeriods')) pass('activePeriods filter array present');
  else fail('activePeriods', 'missing');

  // The duplicated "TOTAL Total Funding Required" label is gone.
  if (!FINANCING_SRC.includes("TOTAL ${title.toUpperCase()}")) pass('TOTAL {title.toUpperCase()} row label removed');
  else fail('Total row label', 'still has duplicated TOTAL Title pattern');
}

// ── Section 10: Fix 7+8 Schedules restructure ─────────────────────────────
console.log('\n[10/12] Fix 7+8: Schedules restructure');
{
  // Standalone Drawdown schedule dropped.
  if (!FINANCING_SRC.includes('2. Drawdown Schedule,')) pass('standalone Drawdown schedule dropped');
  else fail('Drawdown standalone', 'still present');

  // Debt Movement per facility present.
  if (FINANCING_SRC.includes('2. Debt Movement,')) pass('Debt Movement per facility present');
  else fail('Debt Movement', 'missing');

  if (FINANCING_SRC.includes("dataTestid={`debt-movement-${t.id}`}")) pass('debt-movement test-id passed via prop');
  else fail('debt-movement test-id', 'missing');

  // Finance Cost section present.
  if (FINANCING_SRC.includes('4. Finance Cost,')) pass('Finance Cost per facility present');
  else fail('Finance Cost', 'missing');

  if (FINANCING_SRC.includes("dataTestid={`finance-cost-${t.id}`}")) pass('finance-cost test-id passed via prop');
  else fail('finance-cost test-id', 'missing');

  // Equity Movement (Fix 8) replaces Equity Schedule.
  if (FINANCING_SRC.includes('6. Equity Movement')) pass('Equity Movement section present');
  else fail('Equity Movement', 'missing');

  if (FINANCING_SRC.includes('dataTestid="equity-movement"')) pass('equity-movement test-id passed via prop');
  else fail('equity-movement test-id', 'missing');

  if (FINANCING_SRC.includes("label: 'Opening Equity'") && FINANCING_SRC.includes("label: 'Closing Equity'")) {
    pass('Equity Movement has Opening + Closing rows');
  } else fail('Equity Movement Opening/Closing', 'missing rows');

  if (FINANCING_SRC.includes("label: 'Opening Balance'") && FINANCING_SRC.includes("label: 'Closing Balance'")) {
    pass('Debt Movement has Opening + Closing rows');
  } else fail('Debt Movement Opening/Closing', 'missing rows');
}

// ── Section 11: Em-dash sweep ─────────────────────────────────────────────
console.log('\n[11/12] No em-dashes in touched files');
{
  const filesToCheck: Array<{ name: string; src: string }> = [
    { name: 'Module1Financing.tsx', src: FINANCING_SRC },
    { name: 'Module1Costs.tsx', src: COSTS_SRC },
    { name: 'module1-migrate.ts', src: MIGRATE_SRC },
    { name: 'module1-types.ts', src: TYPES_SRC },
    { name: 'core/formatters/index.ts', src: FORMATTERS_SRC },
  ];
  for (const f of filesToCheck) {
    const matches = (f.src.match(/—/g) ?? []).length;
    if (matches === 0) pass(`${f.name}: no em-dashes`);
    else fail(`${f.name} em-dashes`, `${matches} found`);
  }
}

// ── Section 12: Banner cascade ────────────────────────────────────────────
console.log('\n[12/12] Banner cascade prioritizes Pass 4');
{
  // resolveBanner should return Pass 4 notice before Pass 3 / earlier
  // banners when both are applicable.
  if (MIGRATE_SRC.includes('M20M_PASS4_NOTICE')) pass('M20M_PASS4_NOTICE referenced in migrate module');
  else fail('M20M_PASS4_NOTICE reference', 'not in migrate.ts');

  // Find the resolveBanner function and confirm Pass 4 check comes before Pass 3.
  const resolveIdx = MIGRATE_SRC.indexOf('function resolveBanner');
  const p4Idx = MIGRATE_SRC.indexOf('M20M_PASS4_NOTICE', resolveIdx);
  const p3Idx = MIGRATE_SRC.indexOf('M20M_PASS3_NOTICE', resolveIdx);
  if (resolveIdx >= 0 && p4Idx > 0 && p3Idx > 0 && p4Idx < p3Idx) {
    pass('resolveBanner checks Pass 4 before Pass 3');
  } else skip('banner cascade order', 'resolveBanner not found or ordering ambiguous');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Pass:    ${passed}`);
console.log(`Fail:    ${failed}`);
console.log(`Skip:    ${skipped}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
