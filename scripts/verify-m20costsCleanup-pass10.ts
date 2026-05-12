/* eslint-disable no-console */
/**
 * verify-m20costsCleanup-pass10.ts (M2.0 Costs Cleanup Pass 10, 2026-05-12)
 *
 * Sections:
 *   1. Mandatory pre-implementation audit doc present.
 *   2. Fix 6: collapsed-by-default state in Tab 2 Phase/Asset cards +
 *      Tab 3 cost line rows + Tab 4 Inputs Summary; bulk-event listener.
 *   3. Fix 1: collapsed cost row renders readonly numeric Value/Start/
 *      End/Phasing instead of dashes.
 *   4. Fix 9: computeAssetLandSqm falls back to equal-share when
 *      totalBua across phase assets is 0 (MAAD fixture proves
 *      non-zero land allocation with zero-BUA assets).
 *   5. Fix 2: addAsset auto-replicates per-asset cost lines from a
 *      phase peer (or makeDefaultCostLines fallback). removeAsset
 *      cascade-removes cost lines + child companion assets.
 *   6. Fix 5: NDA Recon adds Asset Land Cost column + Unassigned Land
 *      row; summary line uses NDA basis when projectNdaEnabled.
 *   7. Fix 7: AssetAreaReconciliationBlock surfaces Revenue field
 *      computed from revenue sub-units (Sellable / Operable /
 *      Leasable).
 *   8. Fix 4: makeCompanionAsset + Sell+Manage strategy bookkeeping
 *      in updateAsset (auto-create + cascade-remove on switch);
 *      computeAssetLandSqm filters companions out of phaseAssets.
 *   9. Fix 10: percent_of_revenue_cash / percent_of_revenue_sale
 *      CostMethod values + getTotalRevenueCashBasis /
 *      getTotalRevenueSaleBasis hooks added.
 *  10. Em-dash sweep across touched files + deferred Fix 3/8 notice.
 *
 * Deferred from Pass 10 (see CLAUDE-REFM.md):
 *   - Fix 3 hybrid project-wide + per-asset override architecture.
 *   - Fix 8 universal AccountingNumberInput sweep.
 *   - Playwright Land Zero screenshot proof. Section 4 verifies the
 *     calc math end-to-end on a MAAD fixture; manual UI verification
 *     pending post-deploy.
 *
 * Usage: npx tsx scripts/verify-m20costsCleanup-pass10.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Parcel,
  type Phase,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultProject,
  makeCompanionAsset,
  COST_METHODS,
  COST_METHOD_LABELS,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetLandSqm,
} from '../src/core/calculations';
import { createFinancingHooks } from '../src/hubs/modeling/platforms/refm/lib/financing-hooks';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };
const skip = (name: string, msg: string): void => { skipped++; console.log(`  SKIP  ${name}: ${msg}`); };

const COSTS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'), 'utf8');
const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const FINANCING_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx'), 'utf8');
const STORE_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');
const HOOKS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts'), 'utf8');

// ── Section 1: audit doc ─────────────────────────────────────────────────
console.log('\n[1/10] Mandatory pre-implementation audit');
{
  const auditPath = resolve(REPO_ROOT, 'docs/m20costs-pass10-regression-audit.md');
  if (existsSync(auditPath)) pass('docs/m20costs-pass10-regression-audit.md present');
  else fail('audit file', 'missing');
  const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
  if (audit.includes('Surface 1') && audit.includes('Surface 9')) {
    pass('audit covers 9 surfaces');
  } else fail('audit coverage', 'expected Surface 1..9');
  if (audit.includes('Implementation order')) pass('audit codifies implementation order');
  else fail('audit order', 'missing implementation order section');
}

// ── Section 2: Fix 6 collapse foundation ─────────────────────────────────
console.log('\n[2/10] Fix 6: collapsed-by-default + bulk events');
{
  if (ASSETS_SRC.includes('m20-phase-collapsed-') && ASSETS_SRC.includes('m20-asset-collapsed-')) {
    pass('Tab 2 phase + asset cards keyed via localStorage');
  } else fail('Tab 2 collapse keys', 'phase/asset localStorage keys missing');
  if (ASSETS_SRC.includes('m20-tab2-collapse-bulk')) pass('Tab 2 bulk event m20-tab2-collapse-bulk');
  else fail('Tab 2 bulk event', 'missing');
  if (ASSETS_SRC.includes('assets-expand-all') && ASSETS_SRC.includes('assets-collapse-all')) {
    pass('Tab 2 Expand all / Collapse all buttons rendered');
  } else fail('Tab 2 bulk buttons', 'missing testids');
  if (COSTS_SRC.includes('costs-expand-all') && COSTS_SRC.includes('costs-collapse-all')) {
    pass('Tab 3 Expand all / Collapse all buttons rendered');
  } else fail('Tab 3 bulk buttons', 'missing testids');
  if (FINANCING_SRC.includes('m20-financing-summary-collapsed') && FINANCING_SRC.includes('inputs-summary-tables-chevron')) {
    pass('Tab 4 Inputs Summary collapsible header + key');
  } else fail('Tab 4 summary collapse', 'missing key or chevron testid');
}

// ── Section 3: Fix 1 readonly collapsed cells ────────────────────────────
console.log('\n[3/10] Fix 1: collapsed rows show readonly Value/Start/End/Phasing');
{
  if (COSTS_SRC.includes('-value-collapsed')) pass('Value cell collapsed-state testid present');
  else fail('Value collapsed', 'missing -value-collapsed testid');
  if (COSTS_SRC.includes('-start-collapsed')) pass('Start cell collapsed-state testid present');
  else fail('Start collapsed', 'missing -start-collapsed testid');
  if (COSTS_SRC.includes('-end-collapsed')) pass('End cell collapsed-state testid present');
  else fail('End collapsed', 'missing -end-collapsed testid');
  if (COSTS_SRC.includes('-phasing-collapsed')) pass('Phasing cell collapsed-state testid present');
  else fail('Phasing collapsed', 'missing -phasing-collapsed testid');
  if (COSTS_SRC.includes("formatScaled(effValue, 'full', decimals)")) {
    pass('Value cell uses formatScaled for thousand separators');
  } else fail('Value format', 'formatScaled call missing');
}

// ── Section 4: Fix 9 Land Zero deeper fallback ───────────────────────────
console.log('\n[4/10] Fix 9: equal-share land fallback when totalBua=0');
{
  // Build a fixture where every asset has zero BUA (sub-units empty,
  // buaSqm=0). Pre-Pass-10 Fix 9 returns 0 for every asset; post-fix
  // returns agg.totalAreaSqm / phaseAssets.length per asset.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 0, overlapPeriods: 0 };
  const parcel: Parcel = {
    id: 'parcel-1', phaseId: phase.id, name: 'Parcel A',
    area: 22066, rate: 98450, cashPct: 80, inKindPct: 20,
  };
  const assetA: Asset = {
    id: 'a1', phaseId: phase.id, name: 'Asset A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  };
  const assetB: Asset = { ...assetA, id: 'a2', name: 'Asset B' };
  const subUnits: SubUnit[] = [];

  const landA = computeAssetLandSqm(assetA, [parcel], [assetA, assetB], subUnits, 'autoByBua');
  const landB = computeAssetLandSqm(assetB, [parcel], [assetA, assetB], subUnits, 'autoByBua');
  if (landA > 0 && landB > 0) {
    pass(`equal-share fallback yields non-zero land (A=${landA.toFixed(0)}, B=${landB.toFixed(0)})`);
  } else fail('equal-share fallback', `landA=${landA}, landB=${landB}; expected non-zero`);
  if (Math.abs(landA - landB) < 0.5) {
    pass('equal-share splits land evenly across phase assets');
  } else fail('equal-share even split', `landA=${landA}, landB=${landB}`);
  if (Math.abs((landA + landB) - parcel.area) < 1) {
    pass('equal-share sums to total parcel area');
  } else fail('equal-share sum', `${landA + landB} != ${parcel.area}`);

  // MAAD-shape fixture (one asset with sub-unit metricValue=0 but
  // buaSqm=130874) - existing Pass 9 Fix 8 path still works.
  const maadAsset: Asset = {
    id: 'maad', phaseId: phase.id, name: 'Branded Apt T2&T3', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0,
  };
  const maadStub: SubUnit = { id: 'stub', assetId: maadAsset.id, name: 'Stub', category: 'Sellable', metric: 'units', metricValue: 0, unitArea: 0, unitPrice: 0 };
  const maadLand = computeAssetLandSqm(maadAsset, [parcel], [maadAsset], [maadStub], 'autoByBua');
  if (maadLand > 0) pass(`MAAD fixture single-asset still resolves land (${maadLand.toFixed(0)} sqm)`);
  else fail('MAAD fixture', `landSqm=${maadLand}; expected ${parcel.area}`);
}

// ── Section 5: Fix 2 + Fix 3 addAsset behaviour ──────────────────────────
console.log('\n[5/10] Fix 2 + Fix 3: addAsset inherits project-wide masters + removeAsset cascades');
{
  // Pass 10 Fix 3 (hybrid revert) replaces Fix 2's per-asset cost
  // line replication with project-wide masters. New asset inherits
  // automatically via linesForAsset filter (c.targetAssetId ===
  // undefined). Seed makeDefaultCostLines only when the asset's
  // phase has zero cost lines yet (first asset in fresh phase).
  if (STORE_SRC.includes('phaseHasLines') && STORE_SRC.includes('makeDefaultCostLines(asset.phaseId')) {
    pass('addAsset seeds master catalog only when phase has no lines (hybrid)');
  } else fail('addAsset hybrid behaviour', 'phaseHasLines check or makeDefaultCostLines seed missing');
  if (STORE_SRC.includes('companionIds') && STORE_SRC.includes('removedIds')) {
    pass('removeAsset cascades to companions + cost lines + overrides');
  } else fail('removeAsset cascade', 'missing companion/removed ID logic');
  if (STORE_SRC.includes('migrateM20costsPass10Hybrid') || readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8').includes('migrateM20costsPass10Hybrid')) {
    pass('migrateM20costsPass10Hybrid wired into hydrate chain');
  } else fail('Pass 10 migration', 'migrateM20costsPass10Hybrid missing');
}

// ── Section 6: Fix 5 NDA Recon ────────────────────────────────────────────
console.log('\n[6/10] Fix 5: NDA Recon polish');
{
  if (ASSETS_SRC.includes('assetLandValueByAssetId')) pass('LandReconciliationBlock receives per-asset land VALUE map');
  else fail('NDA land value map', 'assetLandValueByAssetId prop missing');
  if (ASSETS_SRC.includes('recon-allocated-value')) pass('Total Allocated value cell testid present');
  else fail('NDA total value', 'recon-allocated-value testid missing');
  if (ASSETS_SRC.includes('recon-unassigned-sqm') || ASSETS_SRC.includes('recon-over-allocated-sqm')) {
    pass('Unassigned Land / Over-allocated row present');
  } else fail('Unassigned row', 'no recon-unassigned-sqm or recon-over-allocated-sqm testid');
  if (ASSETS_SRC.includes('projectNdaEnabled') && ASSETS_SRC.includes('over NDA by') && ASSETS_SRC.includes('matches NDA')) {
    pass('Top summary compares allocations against NDA when projectNdaEnabled');
  } else fail('NDA summary basis', 'NDA-aware summary suffix missing');
}

// ── Section 7: Fix 7 Revenue in sub-unit summary ─────────────────────────
console.log('\n[7/10] Fix 7: Revenue field in AssetAreaReconciliationBlock');
{
  if (ASSETS_SRC.includes('-recon-revenue')) pass('asset-{id}-recon-revenue testid present');
  else fail('Revenue testid', 'missing asset-{id}-recon-revenue');
  if (ASSETS_SRC.includes('totalRevenue: number')) pass('totalRevenue prop on AssetAreaReconciliationBlock');
  else fail('Revenue prop', 'totalRevenue not on props interface');
  if (ASSETS_SRC.includes("category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable'")) {
    pass('Revenue computed across Sellable/Operable/Leasable sub-units');
  } else fail('Revenue formula', 'category filter missing');
}

// ── Section 8: Fix 4 Sell+Manage companion ───────────────────────────────
console.log('\n[8/10] Fix 4: Sell+Manage auto-creates Operate companion');
{
  if (TYPES_SRC.includes('parentAssetId') && TYPES_SRC.includes('isCompanion') && TYPES_SRC.includes("companionType?: 'operate'")) {
    pass('Asset schema additions: parentAssetId / isCompanion / companionType');
  } else fail('schema additions', 'parentAssetId/isCompanion/companionType missing');
  if (TYPES_SRC.includes('export function makeCompanionAsset')) pass('makeCompanionAsset factory exported');
  else fail('makeCompanionAsset', 'factory missing');
  // Smoke-test the factory.
  const parent: Asset = {
    id: 'parent-1', phaseId: 'p1', name: 'Branded Tower', type: '',
    strategy: 'Sell + Manage', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0,
  };
  const companion = makeCompanionAsset(parent, 200);
  if (companion.name === 'Branded Tower - Operate' && companion.strategy === 'Operate'
      && companion.isCompanion === true && companion.parentAssetId === 'parent-1'
      && companion.unitsFromParent === 200) {
    pass('makeCompanionAsset returns correct shape (name/strategy/flags/units)');
  } else fail('companion shape', JSON.stringify(companion));

  if (STORE_SRC.includes('becomesSellManage') && STORE_SRC.includes('leavesSellManage')) {
    pass('updateAsset wires both Sell+Manage transitions (TO + AWAY)');
  } else fail('updateAsset transitions', 'missing becomesSellManage/leavesSellManage');
  if (STORE_SRC.includes('syncCompanionUnits')) pass('syncCompanionUnits helper wired into sub-unit mutations');
  else fail('syncCompanionUnits', 'helper not in store');
  if (CALC_SRC.includes('isCompanion === true) return 0') && CALC_SRC.includes('isCompanion !== true')) {
    pass('computeAssetLandSqm filters companions from land allocation');
  } else fail('companion land filter', 'isCompanion guard missing in calc engine');
  if (ASSETS_SRC.includes('asset-${asset.id}-companion-badge') || ASSETS_SRC.includes('companion-badge')) {
    pass('Tab 2 companion asset shows the auto-generated badge');
  } else fail('companion badge', 'missing data-testid');
}

// ── Section 9: Fix 10 revenue hooks ──────────────────────────────────────
console.log('\n[9/10] Fix 10: commission revenue hooks');
{
  if (COST_METHODS.includes('percent_of_revenue_cash') && COST_METHODS.includes('percent_of_revenue_sale')) {
    pass('CostMethod union includes percent_of_revenue_cash / _sale');
  } else fail('CostMethod', 'revenue methods missing');
  if (COST_METHOD_LABELS.percent_of_revenue_cash && COST_METHOD_LABELS.percent_of_revenue_sale) {
    pass('COST_METHOD_LABELS has user-facing labels for revenue methods');
  } else fail('CostMethod labels', 'revenue method labels missing');
  if (HOOKS_SRC.includes('getTotalRevenueCashBasis') && HOOKS_SRC.includes('getTotalRevenueSaleBasis')) {
    pass('financing-hooks declares getTotalRevenueCashBasis + _SaleBasis');
  } else fail('hooks', 'revenue hooks missing');
  // Confirm zero-stub return.
  const project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0 };
  const hooks = createFinancingHooks({
    project, phases: [phase], parcels: [], landAllocationMode: 'autoByBua',
    assets: [], subUnits: [], costLines: [], costOverrides: [],
    financingTranches: [], equityContributions: [],
  });
  const cashRev = hooks.getTotalRevenueCashBasis();
  const saleRev = hooks.getTotalRevenueSaleBasis();
  if (Array.isArray(cashRev) && cashRev.every((v) => v === 0)) pass('getTotalRevenueCashBasis returns zero-stub PeriodArray');
  else fail('cash-basis stub', `got ${JSON.stringify(cashRev.slice(0, 3))}...`);
  if (Array.isArray(saleRev) && saleRev.every((v) => v === 0)) pass('getTotalRevenueSaleBasis returns zero-stub PeriodArray');
  else fail('sale-basis stub', `got ${JSON.stringify(saleRev.slice(0, 3))}...`);

  const contractPath = resolve(REPO_ROOT, 'docs/cost-revenue-hooks.md');
  if (existsSync(contractPath)) pass('docs/cost-revenue-hooks.md contract published');
  else fail('hook contract', 'docs/cost-revenue-hooks.md missing');
}

// ── Section 10a: Fix 3 hybrid architecture markers ──────────────────────
console.log('\n[10a] Fix 3: hybrid project-wide + per-asset override surface');
{
  const migrateSrc = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'), 'utf8');
  if (migrateSrc.includes('migrateM20costsPass10Hybrid') && migrateSrc.includes('M20_PASS10_NOTICE')) {
    pass('migration helper + banner constant defined');
  } else fail('Pass 10 migration', 'helper or banner missing');
  if (migrateSrc.includes('snapshotNeedsPass10Migration')) pass('snapshotNeedsPass10Migration detector exported');
  else fail('detector', 'snapshotNeedsPass10Migration missing');
  // resolveBanner priority order: Pass 10 ahead of Pass 4.
  const m10Idx = migrateSrc.indexOf('snapshotNeedsPass10Migration(s)');
  const m4Idx = migrateSrc.indexOf('snapshotNeedsPass4FinancingMigration(s)');
  if (m10Idx > 0 && m4Idx > m10Idx) pass('resolveBanner prioritises Pass 10 ahead of Pass 4 Financing');
  else fail('banner priority', 'Pass 10 should resolve before Pass 4 Financing');
  // CostRow override toggle markers.
  if (COSTS_SRC.includes('-override') && COSTS_SRC.includes('-revert') && COSTS_SRC.includes('-override-active')) {
    pass('CostRow renders Override toggle + Revert + asset-specific marker');
  } else fail('override toggle UI', 'missing testid markers');
  if (COSTS_SRC.includes('startOverride')) pass('startOverride helper seeds CostOverride from master');
  else fail('startOverride', 'helper missing');
  // Module1Costs passes filtered overrides + real mutations.
  if (COSTS_SRC.includes('costOverrides.filter((o) => o.assetId === activeAsset.id)')) {
    pass('Module1Costs filters costOverrides to active asset');
  } else fail('override filtering', 'costOverrides filter missing');
  if (COSTS_SRC.includes('onUpdateOverride={(override) => setCostOverride(override)}')
      && COSTS_SRC.includes('onRemoveOverride={(assetId, lineId) => removeCostOverride(assetId, lineId)}')) {
    pass('AssetCostSection wires real setCostOverride / removeCostOverride mutations');
  } else fail('override mutations', 'no-op handlers still in place');
}

// ── Section 10b: Fix 8 accounting input sweep ────────────────────────────
console.log('\n[10b] Fix 8: AccountingNumberInput sweep on large-number inputs');
{
  // Tab 2 large-number inputs that should have migrated.
  const tab2Sweep = [
    'data-testid={`parcel-${parcel.id}-area`}',
    'data-testid={`subunit-${subUnit.id}-area-input`}',
    'data-testid={`subunit-${subUnit.id}-unitArea`}',
    'data-testid={`asset-${asset.id}-landAreaSqm`}',
    'data-testid={`asset-${asset.id}-supportArea`}',
    'data-testid={`asset-${asset.id}-parkingArea`}',
    'data-testid={`asset-${asset.id}-gfaSqm`}',
  ];
  let tab2Hits = 0;
  for (const needle of tab2Sweep) {
    // For each testid, check it appears in an AccountingNumberInput block
    // (not in a raw <input type="number">).
    const idx = ASSETS_SRC.indexOf(needle);
    if (idx === -1) continue;
    // Look backwards for the nearest opening tag.
    const before = ASSETS_SRC.lastIndexOf('<', idx);
    const tagSlice = ASSETS_SRC.slice(before, idx + needle.length + 1);
    if (tagSlice.includes('AccountingNumberInput')) tab2Hits++;
  }
  if (tab2Hits === tab2Sweep.length) pass(`Tab 2: ${tab2Hits}/${tab2Sweep.length} large-number inputs use AccountingNumberInput`);
  else fail('Tab 2 sweep', `only ${tab2Hits}/${tab2Sweep.length} migrated`);

  // Tab 4 sweep markers.
  if (FINANCING_SRC.includes('data-testid="m3-existing-cash"')
      && FINANCING_SRC.slice(0, FINANCING_SRC.indexOf('data-testid="m3-existing-cash"')).lastIndexOf('AccountingNumberInput')
         > FINANCING_SRC.slice(0, FINANCING_SRC.indexOf('data-testid="m3-existing-cash"')).lastIndexOf('<input ')) {
    pass('Tab 4: Existing Cash uses AccountingNumberInput');
  } else fail('Tab 4 existing cash', 'still bare number input');
  if (FINANCING_SRC.includes('data-testid="financing-min-cash-reserve"')) {
    const idx = FINANCING_SRC.indexOf('data-testid="financing-min-cash-reserve"');
    const before = FINANCING_SRC.slice(0, idx).lastIndexOf('<');
    const slice = FINANCING_SRC.slice(before, idx);
    if (slice.includes('AccountingNumberInput')) pass('Tab 4: Minimum Cash Reserve uses AccountingNumberInput');
    else fail('Tab 4 min cash', 'still bare number input');
  } else fail('Tab 4 min cash', 'testid missing');
}

// ── Section 10: em-dash sweep + deferred notice ──────────────────────────
console.log('\n[10/10] Em-dash sweep + deferred fixes documented');
{
  const touched = [
    'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',
    'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
    'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts',
    'docs/m20costs-pass10-regression-audit.md',
    'docs/cost-revenue-hooks.md',
  ];
  let emDashCount = 0;
  for (const file of touched) {
    const fp = resolve(REPO_ROOT, file);
    if (!existsSync(fp)) continue;
    const content = readFileSync(fp, 'utf8');
    const matches = content.match(/—/g);
    if (matches) emDashCount += matches.length;
  }
  if (emDashCount === 0) pass('no em-dashes in any touched Pass 10 file');
  else fail('em-dash sweep', `${emDashCount} em-dashes found across touched files`);

  // CLAUDE-REFM.md should record Pass 10 status + flag the
  // hybrid architecture + AccountingNumberInput sweep as shipped.
  const refmMd = resolve(REPO_ROOT, 'CLAUDE-REFM.md');
  const refm = existsSync(refmMd) ? readFileSync(refmMd, 'utf8') : '';
  if (refm.includes('Pass 10')) pass('CLAUDE-REFM.md mentions Pass 10');
  else fail('CLAUDE-REFM.md', 'Pass 10 status block missing');
  if (refm.includes('hybrid project-wide') && refm.includes('ships')) {
    pass('CLAUDE-REFM.md records Fix 3 hybrid architecture as shipped');
  } else fail('Fix 3 shipped status', 'CLAUDE-REFM.md does not record Fix 3 as shipped');
  if (refm.includes('AccountingNumberInput')) {
    pass('CLAUDE-REFM.md records Fix 8 AccountingNumberInput sweep');
  } else fail('Fix 8 shipped status', 'CLAUDE-REFM.md does not record Fix 8 sweep');
  // Playwright spec presence.
  const specPath = resolve(REPO_ROOT, 'tests/e2e/m20costs-pass10.spec.ts');
  if (existsSync(specPath)) pass('Playwright spec tests/e2e/m20costs-pass10.spec.ts present');
  else fail('Playwright spec', 'tests/e2e/m20costs-pass10.spec.ts missing');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
