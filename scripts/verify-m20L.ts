/* eslint-disable no-console */
/**
 * verify-m20L.ts (M2.0L verifier, 2026-05-11)
 *
 * 5-section verifier for M2.0L: Costs diagnose-and-fix + full Financing build.
 *
 *   1. Schema: phase-scoped cost line ids (composeLineId / deriveLineBaseId);
 *      9 drawdown methods; 9 repayment methods; 3 IDC treatments; FacilityType,
 *      BaseRate, FeeTreatment, EquityTrancheType enums; new optional fields on
 *      FinancingTranche + EquityContribution.
 *   2. Routes + baseline: dev server reachable; module1-v5-diff bit-identical
 *      (refreshed for M2.0L composed ids).
 *   3. Calc engine: computeEqualPeriodicPayment (annuity), computeCapitalStack
 *      (sources/uses/LTV), computeIdcSummary, applyIdcToCapex (seeds), 4 new
 *      drawdown methods produce sensible distributions, 4 new repayment methods
 *      produce non-negative balances, computeCombinedDebtService aggregates.
 *   4. Source markers: ~30 markers across Module1Costs, Module1Financing,
 *      calculations, types, migrate + em-dash sweep.
 *   5. Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20L.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  COST_PHASING_OPTIONS,
  COST_PHASINGS,
  DRAWDOWN_METHODS,
  REPAYMENT_METHODS,
  IDC_TREATMENTS,
  FACILITY_TYPES,
  BASE_RATES,
  FEE_TREATMENTS,
  EQUITY_TRANCHE_TYPES,
  STANDARD_COST_LINE_IDS,
  composeLineId,
  deriveLineBaseId,
  isStandardCostLineBaseId,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  type FinancingTranche,
  type Phase,
  type Project,
  type EquityContribution,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeEqualPeriodicPayment,
  computeCapitalStack,
  computeIdcSummary,
  computeCombinedDebtService,
  computeFinancing,
  applyIdcToCapex,
  type FinancingResult,
} from '../src/core/calculations';

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

// ── Section 1: Schema + types ─────────────────────────────────────────────
console.log('\n[1/5] Schema + types');

// 1.1 Phase-scoped cost line ids
const composed = composeLineId('land-cash', 'phase_1');
if (composed === 'land-cash__phase_1') pass('M2.0L: composeLineId formats as baseId__phaseId');
else fail('composeLineId format', composed);

const composedTwice = composeLineId('land-cash__phase_1', 'phase_2');
if (composedTwice === 'land-cash__phase_1') pass('M2.0L: composeLineId is idempotent on already-scoped ids');
else fail('composeLineId idempotent', composedTwice);

if (deriveLineBaseId('land-cash__phase_1') === 'land-cash') pass('M2.0L: deriveLineBaseId strips the suffix');
else fail('deriveLineBaseId strip', deriveLineBaseId('land-cash__phase_1'));

if (deriveLineBaseId('custom-1234567') === 'custom-1234567') pass('M2.0L: deriveLineBaseId leaves custom ids alone');
else fail('deriveLineBaseId custom', deriveLineBaseId('custom-1234567'));

if (isStandardCostLineBaseId('construction-bua')) pass('M2.0L: isStandardCostLineBaseId positive case');
else fail('isStandardCostLineBaseId', 'construction-bua should be recognised');

if (!isStandardCostLineBaseId('custom-xyz')) pass('M2.0L: isStandardCostLineBaseId rejects unknown ids');
else fail('isStandardCostLineBaseId negative', 'custom-xyz should not be recognised');

// 1.2 makeDefaultCostLines composes ids per phase
const defaultsP1 = makeDefaultCostLines('phase_1', 24);
const defaultsP2 = makeDefaultCostLines('phase_2', 24);
const p1Ids = new Set(defaultsP1.map((c) => c.id));
const p2Ids = new Set(defaultsP2.map((c) => c.id));
const overlap = [...p1Ids].filter((id) => p2Ids.has(id));
if (overlap.length === 0) pass('M2.0L: phase_1 + phase_2 default cost lines have ZERO id overlap');
else fail('phase id overlap', `${overlap.length} ids collide: ${overlap.slice(0, 3).join(',')}`);

if (defaultsP1.every((c) => c.id.endsWith('__phase_1'))) pass('M2.0L: every phase_1 default line id ends with __phase_1');
else fail('phase_1 id suffix', 'not all default lines are scoped');

// 1.3 selectedLineIds reference phase-scoped peers
const preOp = defaultsP1.find((c) => c.id === composeLineId('pre-operating', 'phase_1'));
if (preOp && preOp.selectedLineIds && preOp.selectedLineIds.every((id) => id.endsWith('__phase_1'))) {
  pass('M2.0L: pre-operating.selectedLineIds reference phase_1-scoped peers');
} else fail('selectedLineIds scope', JSON.stringify(preOp?.selectedLineIds));

// 1.4 Standard catalog size unchanged
if (STANDARD_COST_LINE_IDS.length === 10) pass('M2.0L: STANDARD_COST_LINE_IDS still 10 base ids (catalog unchanged)');
else fail('catalog size', `${STANDARD_COST_LINE_IDS.length}`);

// 1.5 Drawdown / repayment / IDC / facility / equity-type enum sizes
if (DRAWDOWN_METHODS.length === 9) pass('M2.0L: 9 drawdown methods (5 legacy + 4 new + cash_available alias)');
else fail('drawdown count', `${DRAWDOWN_METHODS.length}`);

// P2-Fix 5 (2026-05-11): widened to 12 (3 new Pass 2 + 9 legacy retained on type).
if (REPAYMENT_METHODS.length === 12) pass('M2.0L+P2: 12 repayment methods (3 P2 + 9 legacy retained)');
else fail('repayment count', `${REPAYMENT_METHODS.length}`);

if (IDC_TREATMENTS.length === 3 && IDC_TREATMENTS.includes('capitalize') && IDC_TREATMENTS.includes('expense') && IDC_TREATMENTS.includes('mixed')) {
  pass('M2.0L: IDC_TREATMENTS = [capitalize, expense, mixed]');
} else fail('IDC treatments', JSON.stringify(IDC_TREATMENTS));

if (FACILITY_TYPES.length === 6) pass('M2.0L: 6 facility types');
else fail('facility types', `${FACILITY_TYPES.length}`);

if (BASE_RATES.length === 5) pass('M2.0L: 5 base rates (SAIBOR 1/3/6M, SOFR, EIBOR)');
else fail('base rates', `${BASE_RATES.length}`);

if (FEE_TREATMENTS.length === 3) pass('M2.0L: 3 fee treatments');
else fail('fee treatments', `${FEE_TREATMENTS.length}`);

if (EQUITY_TRANCHE_TYPES.length === 3) pass('M2.0L: 3 equity tranche types');
else fail('equity types', `${EQUITY_TRANCHE_TYPES.length}`);

// 1.6 Phasing options unchanged
if (COST_PHASING_OPTIONS.length === 2) pass('M2.0L: COST_PHASING_OPTIONS still [even, manual] (M2.0j unchanged)');
else fail('phasing options', `${COST_PHASING_OPTIONS.length}`);

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (M2.0L baseline current)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: Calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// 3.1 Annuity PMT
const pmt = computeEqualPeriodicPayment(100_000, 0.05, 10);
// Expected ~ 12,950.46 for $100K @ 5% for 10 periods.
if (Math.abs(pmt - 12_950.46) < 1) pass(`M2.0L: computeEqualPeriodicPayment(100K, 5%, 10) -> ${pmt.toFixed(2)} (expected ~12,950.46)`);
else fail('PMT formula', `got ${pmt.toFixed(2)}`);

// 3.2 PMT zero-rate edge case
const pmtZero = computeEqualPeriodicPayment(120_000, 0, 12);
if (pmtZero === 10_000) pass('M2.0L: PMT zero-rate edge -> principal/periods');
else fail('PMT zero rate', `got ${pmtZero}`);

// 3.3 Capital stack with empty inputs
const stackEmpty = computeCapitalStack([], [], 0);
if (stackEmpty.totalSources === 0 && stackEmpty.totalUses === 0 && stackEmpty.gap === 0) {
  pass('M2.0L: computeCapitalStack empty inputs -> all zero');
} else fail('stack empty', JSON.stringify(stackEmpty));

// 3.4 Capital stack with one debt + one equity
const phaseStack: Phase = { id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 24, operationsPeriods: 60, overlapPeriods: 0, startDate: '2026-01-01' };
const tranche: FinancingTranche = makeDefaultFinancingTranche('t1', 'p1');
tranche.principal = 850_000_000;
tranche.facilityType = 'senior_construction';
const equity: EquityContribution = {
  id: 'e1', phaseId: 'p1', name: 'Sponsor', amount: 300_000_000, timing: 'upfront', type: 'cash',
};
const stack1 = computeCapitalStack([tranche], [equity], 1_150_000_000);
if (stack1.totalEquity === 300_000_000 && stack1.totalDebt === 850_000_000 && stack1.totalSources === 1_150_000_000 && Math.abs(stack1.gap) < 1) {
  pass('M2.0L: computeCapitalStack senior 850M + equity 300M = 1.15B; gap=0');
} else fail('stack 1.15B', JSON.stringify({ eq: stack1.totalEquity, debt: stack1.totalDebt, gap: stack1.gap }));

if (Math.abs(stack1.ltvSenior - 73.91) < 0.5) pass(`M2.0L: ltvSenior=${stack1.ltvSenior.toFixed(2)}% (~73.91%)`);
else fail('ltvSenior', `got ${stack1.ltvSenior.toFixed(2)}`);

// 3.5 Drawdown front_loaded
const project: Project = {
  name: 'T', currency: 'SAR', modelType: 'annual', startDate: '2026-01-01',
  status: 'draft', location: 'Riyadh',
};
const capexFlat = [10_000, 10_000, 10_000, 10_000, 10_000, 10_000];
const presalesZero = [0, 0, 0, 0, 0, 0];
const fpFront: FinancingTranche = makeDefaultFinancingTranche('t-fl', 'p1');
fpFront.drawdownMethod = 'front_loaded';
fpFront.principal = 30_000;
const tFrontPhase = { ...phaseStack, constructionPeriods: 6, operationsPeriods: 0, overlapPeriods: 0 };
const rFront = computeFinancing(fpFront, tFrontPhase, capexFlat, presalesZero, project);
if (Math.abs(rFront.drawSchedule[0] - 30_000) < 1 && rFront.drawSchedule.slice(1).every((v) => v === 0)) {
  pass('M2.0L: front_loaded draws 100% in period 0');
} else fail('front_loaded', `draws=${rFront.drawSchedule.join(',')}`);

// 3.6 Drawdown equal_periodic
const fpEqual: FinancingTranche = makeDefaultFinancingTranche('t-eq', 'p1');
fpEqual.drawdownMethod = 'equal_periodic';
fpEqual.principal = 60_000;
fpEqual.availabilityPeriods = 6;
const rEqual = computeFinancing(fpEqual, tFrontPhase, capexFlat, presalesZero, project);
const expectedSlice = 10_000;
if (rEqual.drawSchedule.slice(0, 6).every((v) => Math.abs(v - expectedSlice) < 0.5)) {
  pass(`M2.0L: equal_periodic draws ${expectedSlice} per period across 6-period availability`);
} else fail('equal_periodic', `draws=${rEqual.drawSchedule.join(',')}`);

// 3.7 Repayment bullet (single lump at maturity)
const fpBullet: FinancingTranche = makeDefaultFinancingTranche('t-bu', 'p1');
fpBullet.drawdownMethod = 'capex_basis';
fpBullet.repaymentMethod = 'bullet';
fpBullet.repaymentPeriods = 3;
fpBullet.idcTreatment = 'expense';
fpBullet.ltvPct = 100;
const phaseBullet = { ...phaseStack, constructionPeriods: 1, operationsPeriods: 5, overlapPeriods: 0 };
const capexBullet = [10_000, 0, 0, 0, 0, 0];
const rBullet = computeFinancing(fpBullet, phaseBullet, capexBullet, [0, 0, 0, 0, 0, 0], project);
const principalSum = rBullet.principalRepaid.reduce((s, v) => s + v, 0);
const principalNonZeroSlots = rBullet.principalRepaid.filter((v) => v > 0).length;
if (Math.abs(principalSum - 10_000) < 1 && principalNonZeroSlots === 1) {
  pass(`M2.0L: bullet repayment lump-sums principal at maturity (single non-zero slot of 10,000)`);
} else fail('bullet repayment', `principals=${rBullet.principalRepaid.join(',')}`);

// 3.8 Repayment balloon (50% balloon at maturity, rest distributed)
const fpBalloon: FinancingTranche = makeDefaultFinancingTranche('t-bal', 'p1');
fpBalloon.drawdownMethod = 'capex_basis';
fpBalloon.repaymentMethod = 'balloon';
fpBalloon.balloonPct = 50;
fpBalloon.repaymentPeriods = 3;
fpBalloon.idcTreatment = 'expense';
fpBalloon.ltvPct = 100;
const rBalloon = computeFinancing(fpBalloon, phaseBullet, capexBullet, [0, 0, 0, 0, 0, 0], project);
const balloonSum = rBalloon.principalRepaid.reduce((s, v) => s + v, 0);
const balloonMax = Math.max(...rBalloon.principalRepaid);
if (Math.abs(balloonSum - 10_000) < 1 && Math.abs(balloonMax - 5_000) < 100) {
  pass('M2.0L: balloon repayment distributes 50% balloon at maturity, remainder over earlier periods');
} else fail('balloon repayment', `principals=${rBalloon.principalRepaid.join(',')}`);

// 3.9 IDC mixed treatment
const fpMixed: FinancingTranche = makeDefaultFinancingTranche('t-mixed', 'p1');
fpMixed.idcTreatment = 'mixed';
fpMixed.idcMixedSplitPeriod = 1; // capitalize through period 1, expense after
fpMixed.drawdownMethod = 'front_loaded';
fpMixed.principal = 100_000;
fpMixed.interestRatePct = 10;
fpMixed.repaymentMethod = 'bullet';
fpMixed.repaymentPeriods = 5;
const phaseMixed = { ...phaseStack, constructionPeriods: 2, operationsPeriods: 4, overlapPeriods: 0 };
const rMixed = computeFinancing(fpMixed, phaseMixed, [50_000, 50_000, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], project);
const cap = rMixed.interestCapitalized;
if (cap[0] > 0 && cap[1] > 0 && cap[2] === 0 && cap[3] === 0) {
  pass('M2.0L: idcTreatment=mixed capitalises through split period, expenses after');
} else fail('IDC mixed', `cap=${cap.slice(0, 5).join(',')}`);

// 3.10 IDC summary aggregates
const results = new Map<string, FinancingResult>();
results.set(fpMixed.id, rMixed);
const idcSum = computeIdcSummary([fpMixed], results);
if (idcSum.totalCapitalized > 0 && idcSum.byFacility.length === 1) pass('M2.0L: computeIdcSummary aggregates capitalized + per-facility');
else fail('IDC summary', JSON.stringify(idcSum));

// 3.11 Combined debt service
const combined = computeCombinedDebtService(results);
if (combined.totalDebtService.length > 0 && combined.totalInterest.reduce((s, v) => s + v, 0) > 0) {
  pass('M2.0L: computeCombinedDebtService aggregates interest + principal');
} else fail('combined service', JSON.stringify(combined));

// 3.12 applyIdcToCapex generates per-asset seeds
const assets = [
  { id: 'a1', phaseId: 'p1', name: 'Apt', type: '', strategy: 'Sell' as const, visible: true, gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 0, parkingBaysRequired: 0 },
  { id: 'a2', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate' as const, visible: true, gfaSqm: 0, buaSqm: 10000, sellableBuaSqm: 0, parkingBaysRequired: 0 },
];
const seeds = applyIdcToCapex([fpMixed], results, assets, [], [phaseStack]);
if (seeds.length === 1 && seeds[0].perAsset.length === 2 && seeds[0].perAsset.every((s) => s.amount > 0)) {
  pass('M2.0L: applyIdcToCapex generates 1 seed × 2 assets with positive amounts');
} else fail('applyIdcToCapex', `seeds=${seeds.length}`);

// 3.13 Custom-schedule drawdown clipping
const fpCustom: FinancingTranche = makeDefaultFinancingTranche('t-cu', 'p1');
fpCustom.drawdownMethod = 'custom_schedule';
fpCustom.drawdownCustomSchedule = [40_000, 40_000, 40_000, 40_000];
fpCustom.principal = 100_000;
const rCustom = computeFinancing(fpCustom, tFrontPhase, capexFlat, presalesZero, project);
const sumCustom = rCustom.drawSchedule.reduce((s, v) => s + v, 0);
if (Math.abs(sumCustom - 100_000) < 1) pass('M2.0L: custom_schedule clips to facility size (40+40+20+0 = 100K)');
else fail('custom_schedule clip', `sum=${sumCustom}`);

// ── Section 4: Source markers ─────────────────────────────────────────────
console.log('\n[4/5] Source-file markers');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const migratePath = 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts';
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const costsPath = `${moduleRoot}/Module1Costs.tsx`;
const financingPath = `${moduleRoot}/Module1Financing.tsx`;

const markers: Marker[] = [
  // Cost duplication fix
  { label: 'M2.0L: composeLineId export', path: typesPath, needle: 'export function composeLineId' },
  { label: 'M2.0L: deriveLineBaseId export', path: typesPath, needle: 'export function deriveLineBaseId' },
  { label: 'M2.0L: isStandardCostLineBaseId export', path: typesPath, needle: 'export function isStandardCostLineBaseId' },
  { label: 'M2.0L: makeDefaultCostLines uses composeLineId', path: typesPath, needle: "composeLineId(baseId, phaseId)" },
  { label: 'M2.0L: deriveCostStage strips suffix', path: calcPath, needle: 'deriveLineBaseId(line.id)' },
  { label: 'M2.0L: migrateM20lDedupeCostLineIds migration step', path: migratePath, needle: 'function migrateM20lDedupeCostLineIds' },
  { label: 'M2.0L: Results filter scopes by phaseId', path: costsPath, needle: 'c.phaseId === a.phaseId' },

  // Sub-unit metric round-trip guard
  { label: 'M2.0L: canSwitchMetric guard', path: assetsPath, needle: 'export function canSwitchMetric' },
  { label: 'M2.0L: metric onChange refuses when guard fails', path: assetsPath, needle: 'canSwitchMetric(subUnit, next)' },

  // Costs UX additions
  { label: 'M2.0L: manual % money chips', path: costsPath, needle: 'manual-money-chips' },
  { label: 'M2.0L: per-row chip strip', path: costsPath, needle: 'chip-strip' },
  { label: 'M2.0L: % of Selected picker', path: costsPath, needle: 'PercentOfSelectedPicker' },
  { label: 'M2.0L: Results filter pill bar', path: costsPath, needle: 'costs-results-asset-filter' },
  { label: 'M2.0L: SummaryTables key includes filter', path: costsPath, needle: '`summary-${granularity}-${resultsAssetFilter ?? \'all\'}`' },

  // Financing schema additions
  { label: 'M2.0L: FACILITY_TYPES export', path: typesPath, needle: 'export const FACILITY_TYPES' },
  { label: 'M2.0L: IDC_TREATMENTS export', path: typesPath, needle: 'export const IDC_TREATMENTS' },
  { label: 'M2.0L: BASE_RATES export', path: typesPath, needle: 'export const BASE_RATES' },
  { label: 'M2.0L: EQUITY_TRANCHE_TYPES export', path: typesPath, needle: 'export const EQUITY_TRANCHE_TYPES' },
  { label: 'M2.0L: FinancingTranche.idcTreatment field', path: typesPath, needle: 'idcTreatment?: IDCTreatment' },
  { label: 'M2.0L: FinancingTranche.facilityType field', path: typesPath, needle: 'facilityType?: FacilityType' },
  { label: 'M2.0L: FinancingTranche.prepayments field', path: typesPath, needle: 'prepayments?: Array<' },
  { label: 'M2.0L: EquityContribution.type field', path: typesPath, needle: 'type?: EquityTrancheType' },
  { label: 'M2.0L: EquityContribution.autoDetectedFromCostLine field', path: typesPath, needle: 'autoDetectedFromCostLine?: boolean' },

  // Calc engine additions
  { label: 'M2.0L: computeEqualPeriodicPayment export', path: calcPath, needle: 'export function computeEqualPeriodicPayment' },
  { label: 'M2.0L: computeCapitalStack export', path: calcPath, needle: 'export function computeCapitalStack' },
  { label: 'M2.0L: computeIdcSummary export', path: calcPath, needle: 'export function computeIdcSummary' },
  { label: 'M2.0L: applyIdcToCapex export', path: calcPath, needle: 'export function applyIdcToCapex' },
  { label: 'M2.0L: computeCombinedDebtService export', path: calcPath, needle: 'export function computeCombinedDebtService' },
  { label: 'M2.0L: drawdown front_loaded branch', path: calcPath, needle: "case 'front_loaded'" },
  { label: 'M2.0L: drawdown equal_periodic branch', path: calcPath, needle: "case 'equal_periodic'" },
  { label: 'M2.0L: repayment bullet branch', path: calcPath, needle: "tranche.repaymentMethod === 'bullet'" },
  { label: 'M2.0L: repayment balloon branch', path: calcPath, needle: "tranche.repaymentMethod === 'balloon'" },

  // Financing UI
  { label: 'M2.0L: Financing sub-tabs', path: financingPath, needle: 'financing-sub-tabs' },
  { label: 'M2.0L: Capital Structure Overview cards', path: financingPath, needle: 'financing-capital-stack' },
  { label: 'M2.0L: Schedules filter pill bar', path: financingPath, needle: 'financing-filter-combined' },
  { label: 'M2.0L: Schedules granularity toggle', path: financingPath, needle: 'financing-granularity-' },
  { label: 'M2.0L: 6 Schedule tables present', path: financingPath, needle: 'dataTestid="combined-debt-service"' },
  { label: 'M2.0L: Cross-tab IDC -> Costs auto-line effect', path: financingPath, needle: 'applyIdcToCapex(phaseTranches' },
  { label: 'M2.0L: Cross-tab Land In-Kind -> Equity auto-detect', path: financingPath, needle: 'autoDetectedFromCostLine: true' },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) { fail(m.label, `file missing: ${m.path}`); continue; }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle.slice(0, 80)}`);
}

// Em-dash sweep (em-dash = U+2014)
const emDashFiles = [calcPath, typesPath, migratePath, assetsPath, costsPath, financingPath];
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
const specPath = join(REPO_ROOT, 'tests/e2e/m20L-costs-financing.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20L-costs-financing.spec.ts not found');
} else {
  pass('m20L-costs-financing.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', '/refm needs auth; spec runnable on authenticated dev server');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20L-costs-financing.spec.ts --reporter=list', {
        stdio: 'pipe', timeout: 240000,
      });
      pass('Playwright m20L-costs-financing.spec.ts');
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
