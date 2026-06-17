/**
 * verify-module6-yoy.ts
 *
 * Guards the Module 6 "Year-on-Year Impact" report builder (lib/reports/
 * caseYoYReport.ts) on the LIVE FMP RE HUB snapshot. Asserts that, for each input
 * a scenario overrides, the block shows the driven per-period output for
 * Management + each scenario plus the scenario-vs-Management delta, and that every
 * value ties to the same computeFinancialsSnapshot series the platform renders
 * (no recompute / no engine change). Endpoint-only levers (discount rate) produce
 * no per-period block, and an empty case set yields no blocks (empty state).
 *
 * Fixture is gitignored live data; skip-with-notice when absent
 * (refresh: npx tsx scripts/fetch-fmp-re-hub.ts).
 *
 * Run: npx tsx scripts/verify-module6-yoy.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { buildCaseYoYReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseYoYReport';
import { applyOverrides } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import type { ProjectCase } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const seriesEqual = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6 * Math.max(1, Math.abs(b[i])));

const FIXTURE = 'scripts/fmpReHubSnapshot.json';
if (!existsSync(FIXTURE)) {
  console.log(`[SKIP] ${FIXTURE} not present (live project data, gitignored).`);
  console.log('       Refresh it with: npx tsx scripts/fetch-fmp-re-hub.ts');
  console.log('=== Result: skipped (no fixture) ===');
  process.exit(0);
}
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const base: any = doc.snapshot;
console.log(`=== Module 6 Year-on-Year Impact (LIVE "${doc.projectName}" v${doc.versionNumber}) ===\n`);

// A revenue mover from the live model: a priced Sell sub-unit.
const sellAssetIds = new Set((base.assets ?? []).filter((a: any) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a: any) => a.id));
const sellSub = (base.subUnits ?? []).find((u: any) => sellAssetIds.has(u.assetId) && Number(u.unitPrice) > 0);
const unitPath = sellSub ? `subUnits[id=${sellSub.id}].unitPrice` : null;

// Downside: paired debt/equity split (drives financing cost). Upside: unit price (drives revenue).
const downside: ProjectCase = { id: 'case_down', name: 'Downside', role: 'scenario', overrides: {
  'project.financing.cashDeficitConfig.debtPct': 50,
  'project.financing.cashDeficitConfig.equityPct': 50,
} };
const upside: ProjectCase = { id: 'case_up', name: 'Upside', role: 'scenario', overrides:
  unitPath ? { [unitPath]: Number(sellSub.unitPrice) * 1.2 } : {} };
const cases: ProjectCase[] = [
  { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
  downside, upside,
];

const report = buildCaseYoYReport({ baseModel: base, cases, activeCaseId: 'case_management' });
console.log(`yearLabels: ${report.yearLabels[0]}..${report.yearLabels[report.yearLabels.length - 1]} (${report.yearLabels.length} periods)`);
console.log(`blocks: ${report.blocks.map((b) => `${b.changedItems.join('+')} -> ${b.outputLabel}`).join(' | ')}\n`);

check('report exposes the platform period axis (yearLabels)', report.yearLabels.length > 0 && report.yearLabels.length === computeFinancialsSnapshot(base).yearLabels.length);
check('at least one impact block is produced', report.blocks.length > 0, `blocks=${report.blocks.length}`);

// ── Financing Cost block (debt/equity override) ──────────────────────────────
const fin = report.blocks.find((b) => b.outputKey === 'financingCost');
check('a Financing Cost block exists (driven by the debt/equity override)', !!fin,
  report.blocks.map((b) => b.outputKey).join(','));
if (fin) {
  check('Financing Cost block names the changed item (debt / equity %)', fin.changedItems.some((s) => /debt|equity/i.test(s)), fin.changedItems.join(','));
  const baseFin = computeFinancialsSnapshot(base).pl.interestExpensePerPeriod.slice(0, report.yearLabels.length);
  check('Management actuals tie to pl.interestExpensePerPeriod', seriesEqual(fin.base.values, baseFin),
    `report=${fin.base.values.slice(0, 3).map(Math.round)} snap=${baseFin.slice(0, 3).map(Math.round)}`);
  const downModel = applyOverrides(base, downside.overrides);
  const downFin = computeFinancialsSnapshot(downModel).pl.interestExpensePerPeriod.slice(0, report.yearLabels.length);
  const downRow = fin.scenarios.find((s) => s.id === 'case_down')!;
  check('Downside actuals tie to its own computed financing cost', seriesEqual(downRow.values, downFin));
  const downDelta = fin.deltas.find((d) => d.id === 'case_down')!;
  check('Downside delta == Downside minus Management per period', downDelta.values.every((v, i) => Math.abs(v - (downRow.values[i] - fin.base.values[i])) < 1e-6));
  check('the override actually moves financing cost (a non-zero delta exists)', downDelta.values.some((v) => Math.abs(v) > 1));
}

// ── Revenue block (unit price override) ──────────────────────────────────────
if (unitPath) {
  const rev = report.blocks.find((b) => b.outputKey === 'revenue');
  check('a Revenue block exists (driven by the unit price override)', !!rev, report.blocks.map((b) => b.outputKey).join(','));
  if (rev) {
    const upModel = applyOverrides(base, upside.overrides);
    const upRev = computeFinancialsSnapshot(upModel).pl.totalRevenuePerPeriod.slice(0, report.yearLabels.length);
    const upRow = rev.scenarios.find((s) => s.id === 'case_up')!;
    check('Upside revenue actuals tie to pl.totalRevenuePerPeriod', seriesEqual(upRow.values, upRev));
    const upDelta = rev.deltas.find((d) => d.id === 'case_up')!;
    check('Upside revenue delta is non-zero in at least one period', upDelta.values.some((v) => Math.abs(v) > 1));
    check('Downside (no revenue override) has a zero revenue delta', rev.deltas.find((d) => d.id === 'case_down')!.values.every((v) => Math.abs(v) < 1e-6));
  }
} else {
  console.log('  [SKIP] no priced Sell sub-unit in the live model (revenue block check skipped)');
}

// ── Endpoint-only lever produces NO per-period block ─────────────────────────
const discReport = buildCaseYoYReport({
  baseModel: base,
  cases: [
    { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
    { id: 'case_disc', name: 'Disc', role: 'scenario', overrides: { 'project.returns.discountRate': Number(base.project?.returns?.discountRate ?? 0.1) + 0.05 } },
  ],
  activeCaseId: 'case_management',
});
check('a discount-rate-only scenario produces no per-period block (endpoint lever)', discReport.blocks.length === 0, `blocks=${discReport.blocks.length}`);

// ── Empty state: no overrides -> no blocks ───────────────────────────────────
const emptyReport = buildCaseYoYReport({
  baseModel: base,
  cases: [
    { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
    { id: 'case_empty', name: 'Empty', role: 'scenario', overrides: {} },
  ],
  activeCaseId: 'case_management',
});
check('no overrides yields no blocks (empty state)', emptyReport.blocks.length === 0);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
