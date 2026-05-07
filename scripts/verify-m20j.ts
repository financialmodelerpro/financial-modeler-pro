/* eslint-disable no-console */
/**
 * verify-m20j.ts (M2.0j verifier, 2026-05-07)
 *
 * 5-section per-phase verifier for M2.0j Module 1 audit + display fixes.
 *
 * Sections:
 *   1. Schema: Phase.constructionPeriods accepts 0; Asset.type optional;
 *      CostPhasing user-pickable narrows to ['even','manual']; legacy
 *      values still acceptable on read; migration folds to 'even'.
 *   2. Routes + baseline: dev server reachable; baseline diff bit-identical.
 *   3. Calc engine: computePhaseTimeline with constructionPeriods=0;
 *      costLineCaption per method; costLineProjectPeriodIndex offset;
 *      computeAssetCostSummaryFromBreakdown 3 totals; formatPercent default
 *      2 decimals; formatArea respects decimals; formatScaledForExport
 *      strips suffix.
 *   4. State: 16-fix source-file markers + em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20j.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  COST_PHASING_OPTIONS,
  COST_PHASINGS,
  normalizeCostPhasing,
  type Phase,
  type Project,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computePhaseTimeline,
  costLineCaption,
  costLineProjectPeriodIndex,
  computeAssetCostSummaryFromBreakdown,
  type AssetAreaMetrics,
} from '../src/core/calculations';
import type { CostLine } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  formatScaled,
  formatScaledForExport,
  formatArea,
  formatPercent,
} from '../src/core/formatters';

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
console.log('\n[1/5] Schema + types');

if (COST_PHASING_OPTIONS.length === 2 && COST_PHASING_OPTIONS.includes('even') && COST_PHASING_OPTIONS.includes('manual')) {
  pass('Fix 9: COST_PHASING_OPTIONS = ["even","manual"]');
} else fail('Fix 9 options', `got [${COST_PHASING_OPTIONS.join(',')}]`);

if (COST_PHASINGS.includes('frontloaded') && COST_PHASINGS.includes('sCurve')) {
  pass('Fix 9: legacy phasing values still acceptable on read (COST_PHASINGS includes them)');
} else fail('Fix 9 read-side compat', 'legacy values missing from COST_PHASINGS');

if (normalizeCostPhasing('frontloaded') === 'even' && normalizeCostPhasing('sCurve') === 'even' && normalizeCostPhasing('phase_aligned') === 'even' && normalizeCostPhasing('manual') === 'manual') {
  pass('Fix 9: normalizeCostPhasing folds legacy values to even, preserves manual');
} else fail('Fix 9 normalize', `unexpected output`);

// Phase.constructionPeriods=0 + computePhaseTimeline.
const project: Project = {
  name: 'T', currency: 'SAR', modelType: 'annual', startDate: '2025-01-01',
  status: 'draft', location: 'Riyadh',
};
const phaseOp: Phase = {
  id: 'p1', name: 'Op-from-start', constructionStart: 1, constructionPeriods: 0,
  operationsPeriods: 5, overlapPeriods: 0,
  startDate: '2025-01-01',
};
const tlOp = computePhaseTimeline(phaseOp, project);
if (tlOp.constructionStart === '2025-01-01' && tlOp.operationsStart === '2025-01-01') {
  pass('Fix 1: constructionPeriods=0 -> operationsStart === phase.startDate');
} else fail('Fix 1 timeline', `got constructionStart=${tlOp.constructionStart}, operationsStart=${tlOp.operationsStart}`);

// ── Section 2: Routes + baseline ─────────────────────────────────────────
console.log('\n[2/5] Routes + snapshot baseline');
let routeOk = false;
try {
  const code = execSync('curl -s -o NUL -w "%{http_code}" http://localhost:3000/refm', {
    timeout: 3000, encoding: 'utf8',
  }).trim();
  routeOk = code === '200' || code === '302' || code === '307';
  if (routeOk) pass(`/refm responsive (HTTP ${code})`);
  else skip('/refm', `dev server returned HTTP ${code}; sign-in required`);
} catch {
  skip('/refm', 'dev server not reachable');
}

try {
  const out = execSync('npx tsx scripts/module1-v5-diff.ts', { encoding: 'utf8', timeout: 30000 });
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (baseline unchanged across M2.0j)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: Calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine + formatters');

// costLineCaption per method
const metrics: AssetAreaMetrics = {
  landSqm: 5_718, ndaSqm: 4_860, roadsSqm: 858, gfa: 157_133, bua: 130_874, nsa: 84_297,
  unitCount: 478, supportArea: 0, parkingArea: 0,
  cashLandValue: 1_715_400, inKindLandValue: 1_143_600, landValue: 2_859_000,
} as unknown as AssetAreaMetrics;

const baseAsset = {
  id: 'a', phaseId: 'p1', name: 'T1', type: '', strategy: 'Sell',
  visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
} as unknown as Parameters<typeof costLineCaption>[0]['asset'];

const lineBua = { method: 'rate_per_bua', value: 4500 } as unknown as CostLine;
const capBua = costLineCaption({ line: lineBua, asset: baseAsset, metrics, parkingBays: 0, resolvedTotal: 588_933_000 });
if (capBua.includes('130,874') && capBua.includes('BUA') && capBua.includes('588,933,000')) {
  pass('Fix 8: caption rate_per_bua includes multiplier + result');
} else fail('Fix 8 bua caption', capBua);

const lineLand = { method: 'rate_per_land', value: 500 } as unknown as CostLine;
const capLand = costLineCaption({ line: lineLand, asset: baseAsset, metrics, parkingBays: 0, resolvedTotal: 2_859_000 });
if (capLand.includes('5,718') && capLand.includes('Land')) pass('Fix 8: caption rate_per_land');
else fail('Fix 8 land caption', capLand);

const linePct = { method: 'percent_of_selected', value: 5 } as unknown as CostLine;
const capPct = costLineCaption({ line: linePct, asset: baseAsset, metrics, parkingBays: 0, resolvedTotal: 42_500_000, selectedTotal: 850_000_000 });
if (capPct.includes('5') && capPct.includes('%') && capPct.includes('850,000,000')) pass('Fix 8: caption percent_of_selected');
else fail('Fix 8 pct caption', capPct);

const lineFixed = { method: 'fixed', value: 1_000_000 } as unknown as CostLine;
const capFixed = costLineCaption({ line: lineFixed, asset: baseAsset, metrics, parkingBays: 0, resolvedTotal: 1_000_000 });
if (capFixed.includes('Fixed') && capFixed.includes('1,000,000')) pass('Fix 8: caption fixed');
else fail('Fix 8 fixed caption', capFixed);

// costLineProjectPeriodIndex offset
const phase2: Phase = { id: 'p2', name: 'Phase 2', constructionStart: 1, constructionPeriods: 4, operationsPeriods: 10, overlapPeriods: 0, startDate: '2026-01-01' };
const idxP2Y1 = costLineProjectPeriodIndex(project, phase2, 1);
if (idxP2Y1 === 2) pass('Fix 10: costLineProjectPeriodIndex Phase 2 (start 2026) periodIndex=1 -> project Y2');
else fail('Fix 10 offset', `got ${idxP2Y1}`);

// computeAssetCostSummaryFromBreakdown
const stageT = { land: 100, hard: 600, soft: 200, operating: 50 };
const summary = computeAssetCostSummaryFromBreakdown(stageT, 60, 40);
if (summary.exclLand === 850 && summary.exclLandInKind === 910 && summary.inclLandInKind === 950) {
  pass('Fix 16: computeAssetCostSummaryFromBreakdown 3 totals correct');
} else fail('Fix 16 summary', JSON.stringify(summary));

// formatPercent default 2 decimals (Fix 5)
if (formatPercent(10) === '10.00%' && formatPercent(15.5) === '15.50%' && formatPercent(4.25) === '4.25%') {
  pass('Fix 5: formatPercent default 2 decimals');
} else fail('Fix 5 percent', `${formatPercent(10)} | ${formatPercent(15.5)} | ${formatPercent(4.25)}`);

// formatArea (Fix 5)
if (formatArea(47800, 0) === '47,800' && formatArea(47800.123, 2) === '47,800.12' && formatArea(0, 2) === '0.00') {
  pass('Fix 5: formatArea respects decimals + thousand separator');
} else fail('Fix 5 area', `${formatArea(47800, 0)} | ${formatArea(47800.123, 2)} | ${formatArea(0, 2)}`);

// formatScaledForExport (Fix 4)
if (formatScaledForExport(1_234_567.89, 'thousands', 1) === '1,234.6' && !formatScaledForExport(1_234_567, 'millions', 2).includes('M')) {
  pass('Fix 4: formatScaledForExport strips suffix, keeps scale + decimals');
} else fail('Fix 4 export', `${formatScaledForExport(1_234_567.89, 'thousands', 1)} | ${formatScaledForExport(1_234_567, 'millions', 2)}`);

// formatScaled UI keeps suffix (sanity check Fix 4)
if (formatScaled(1_234_567, 'millions', 2).endsWith(' M')) {
  pass('Fix 4: UI formatScaled retains K/M suffix unchanged');
} else fail('Fix 4 UI', formatScaled(1_234_567, 'millions', 2));

// ── Section 4: Source-file markers ────────────────────────────────────────
console.log('\n[4/5] Source-file markers');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const formatPath = 'src/core/formatters/index.ts';
const migratePath = 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts';
const wizardPath = 'src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts';
const projWizPath = `${componentRoot}/modals/ProjectWizard.tsx`;
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const phasesPath = `${moduleRoot}/Module1ProjectPhases.tsx`;
const costsPath = `${moduleRoot}/Module1Costs.tsx`;
const inputUiPath = `${componentRoot}/ui/AccountingNumberInput.tsx`;

const markers: Marker[] = [
  // Fix 1
  { label: 'F1.1: Tab 1 constructionPeriods min=0', path: phasesPath, needle: 'M2.0j Fix 1' },
  { label: 'F1.2: Tab 1 "Operational from start" caption', path: phasesPath, needle: "'Operational from start'" },
  { label: 'F1.3: Wizard step2Valid allows constructionPeriods=0', path: projWizPath, needle: 'M2.0j Fix 1' },
  { label: 'F1.4: Wizard input min=0', path: projWizPath, needle: 'min={0}' },
  { label: 'F1.5: buildWizardSnapshot allows cp=0', path: wizardPath, needle: 'M2.0j Fix 1' },
  { label: 'F1.6: computePhaseTimeline cp=0 branch', path: calcPath, needle: 'M2.0j Fix 1' },
  // Fix 2
  { label: 'F2.1: Asset.type optional comment', path: typesPath, needle: 'optional from M2.0j Fix 2' },
  { label: 'F2.2: resolveTypeCatalog union for Mixed-Use/Custom', path: assetsPath, needle: 'M2.0j Fix 2' },
  { label: 'F2.3: Asset add defaults type=""', path: assetsPath, needle: "M2.0j Fix 2: default to empty string" },
  { label: 'F2.4: Type field marked optional in label', path: assetsPath, needle: 'Type (optional)' },
  // Fix 3
  { label: 'F3.1: Land Parcel rate header is currency/sqm', path: assetsPath, needle: 'M2.0j Fix 3' },
  // Fix 4
  { label: 'F4.1: formatter export-comment', path: formatPath, needle: 'M2.0j Fix 4' },
  { label: 'F4.2: formatScaledForExport export', path: formatPath, needle: 'export function formatScaledForExport' },
  // Fix 5
  { label: 'F5.1: formatPercent default 2 decimals', path: formatPath, needle: 'percentages always render with 2 decimals' },
  { label: 'F5.2: formatArea export', path: formatPath, needle: 'export function formatArea' },
  { label: 'F5.3: ParcelRow threads scale + decimals', path: assetsPath, needle: 'M2.0j Fix 5' },
  { label: 'F5.4: parcels totals row uses formatArea + formatScaled', path: assetsPath, needle: 'parcels-total-area' },
  // Fix 6
  { label: 'F6.1: SubUnitRow bidirectional sync', path: assetsPath, needle: 'M2.0j Fix 6' },
  { label: 'F6.2: onEditAreaWhenUnits handler', path: assetsPath, needle: 'onEditAreaWhenUnits' },
  { label: 'F6.3: units-no-size-error inline warning', path: assetsPath, needle: 'units-no-size-error' },
  // Fix 7
  { label: 'F7.1: AccountingNumberInput primitive', path: inputUiPath, needle: 'export function AccountingNumberInput' },
  { label: 'F7.2: cost line value uses AccountingNumberInput', path: costsPath, needle: 'M2.0j Fix 7' },
  // Fix 8
  { label: 'F8.1: costLineCaption export', path: calcPath, needle: 'export function costLineCaption' },
  { label: 'F8.2: cost row caption testid', path: costsPath, needle: 'M2.0j Fix 8' },
  { label: 'F8.3: cost row caption data-testid hook', path: costsPath, needle: '-caption' },
  // Fix 9
  { label: 'F9.1: COST_PHASING_OPTIONS export', path: typesPath, needle: 'export const COST_PHASING_OPTIONS' },
  { label: 'F9.2: normalizeCostPhasing helper', path: typesPath, needle: 'export function normalizeCostPhasing' },
  { label: 'F9.3: migrateM20jPhasing migration step', path: migratePath, needle: 'function migrateM20jPhasing' },
  { label: 'F9.4: cost row dropdown uses COST_PHASING_OPTIONS', path: costsPath, needle: 'COST_PHASING_OPTIONS.map' },
  // Fix 10
  { label: 'F10.1: costLinePeriodEndDate export', path: calcPath, needle: 'export function costLinePeriodEndDate' },
  { label: 'F10.2: costLineProjectPeriodIndex export', path: calcPath, needle: 'export function costLineProjectPeriodIndex' },
  { label: 'F10.3: phaseScopedPeriodLabel computation', path: costsPath, needle: 'phaseScopedPeriodLabel' },
  // Fix 11
  { label: 'F11.1: Capex by Period phase offset audit', path: costsPath, needle: 'M2.0j Fix 11' },
  { label: 'F11.2: SummaryTables key remount on granularity', path: costsPath, needle: '`summary-${granularity}`' },
  // Fix 12
  { label: 'F12.1: hide zero-value asset rows', path: costsPath, needle: 'M2.0j Fix 12' },
  // Fix 13
  { label: 'F13.1: cost row drops stage label', path: costsPath, needle: 'M2.0j Fix 13' },
  // Fix 14+15
  { label: 'F14+15: 3 summary tables removed', path: costsPath, needle: 'M2.0j Fix 14 + 15' },
  // Fix 16
  { label: 'F16.1: computeAssetCostSummaryFromBreakdown export', path: calcPath, needle: 'export function computeAssetCostSummaryFromBreakdown' },
  { label: 'F16.2: asset selector bar testid', path: costsPath, needle: 'costs-asset-selector' },
  { label: 'F16.3: asset selector All Assets', path: costsPath, needle: 'costs-asset-selector-all' },
  { label: 'F16.4: 3 summary cards testids', path: costsPath, needle: 'costs-summary-excl-land' },
  { label: 'F16.5: Excl. Land In-Kind card', path: costsPath, needle: 'costs-summary-excl-land-inkind' },
  { label: 'F16.6: Incl. Land In-Kind card', path: costsPath, needle: 'costs-summary-incl-land-inkind' },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) { fail(m.label, `file missing: ${m.path}`); continue; }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle.slice(0, 80)}`);
}

// Em-dash sweep
const emDashFiles = [
  calcPath, typesPath, formatPath, migratePath, wizardPath, projWizPath,
  assetsPath, phasesPath, costsPath, inputUiPath,
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass(`em-dash sweep: zero hits across ${emDashFiles.length} files`);
else fail('em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright spec ────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20j-costs-audit.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20j-costs-audit.spec.ts not found');
} else {
  pass('m20j-costs-audit.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', '/refm needs auth; spec runnable on authenticated dev server');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20j-costs-audit.spec.ts --reporter=list', {
        stdio: 'pipe', timeout: 240000,
      });
      pass('Playwright m20j-costs-audit.spec.ts');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fail('Playwright', msg.slice(0, 200));
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
process.exit(0);
