/* eslint-disable no-console */
/**
 * verify-module6-pipeline.ts (2026-06-16)
 *
 * EMPIRICAL override-pipeline verifier. The earlier verify-module6-scenarios
 * passed green while users saw "no delta" because it set case.overrides directly
 * and asserted labels / static wiring, never the live path. This verifier drives
 * the REAL store actions (hydrate -> setActiveCase -> setCaseFieldValue) exactly
 * as Module6Scenarios does, rebuilds the comparison with the REAL
 * buildCaseComparisonReport, and asserts OBSERVED value movement in the
 * comparison cells. A dead override (or a lost merge) fails here, not green.
 *
 * Run: npx tsx scripts/verify-module6-pipeline.ts
 */
import { useModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { buildExcelSampleState } from './excelSampleState';
import { buildCaseComparisonReport, CASE_KPIS } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';
import {
  enumerateOverridableFields, seedCases, buildOverrides, applyOverrides, getByPath,
} from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { inactiveLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';

let passed = 0, failed = 0;
const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const store = useModule1Store;
const base: any = buildExcelSampleState();
const MGMT = 'case_management', DOWN = 'case_downside';

function live(): any { return pickModel(store.getState() as unknown as Record<string, unknown>); }
function reset(): void { store.getState().hydrate({ ...base, cases: seedCases(), activeCaseId: 'case_management' } as any); }
function compareCols() {
  const s = store.getState();
  const m = live();
  const activeIsBase = s.activeCaseId === MGMT;
  const baseModel = activeIsBase ? m : s.baseSnapshot;
  return buildCaseComparisonReport({ baseModel, cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: m }).columns;
}
function movedKpis(path: string, value: number): string[] {
  reset();
  store.getState().setActiveCase(DOWN);
  store.getState().setCaseFieldValue(DOWN, path, value);
  const cols = compareCols();
  const mm = cols.find((c) => c.id === MGMT)!.values;
  const dd = cols.find((c) => c.id === DOWN)!.values;
  return CASE_KPIS.filter((k) => {
    const a = mm[k.label], b = dd[k.label];
    return a != null && b != null ? Math.abs(b - a) > Math.max(1e-7, Math.abs(a) * 1e-7) : a !== b;
  }).map((k) => k.label);
}

console.log('=== Module 6 override pipeline (empirical, store-driven) ===\n');

// ── 1. Merge integrity: applyOverrides applies EVERY enumerated field. ───────
// (Refutes "the override map merge silently no-ops".)
console.log('[1] Merge integrity (applyOverrides applies every field)');
const numFields = enumerateOverridableFields(base).filter((f) => f.type === 'number');
let mergeOk = 0; let firstBad = '';
for (const f of numFields) {
  const target = Number(f.value) === 0 ? 1 : Number(f.value) * 2 + 7;
  const merged = applyOverrides(base, { [f.path]: target });
  const got = Number(getByPath(merged as any, f.path));
  if (Math.abs(got - target) < 1e-9) mergeOk++;
  else if (!firstBad) firstBad = `${f.path}: got ${got} want ${target}`;
}
check(`applyOverrides applies all ${numFields.length} numeric fields (no lost merge)`, mergeOk === numFields.length, firstBad);

// ── 2. Observed comparison deltas for the headline levers (live store path). ─
console.log('\n[2] Observed comparison deltas (the path the UI renders)');

// Debt %: change to a value DIFFERENT from base; expect financing + equity move.
const baseDebt = Number(base.project?.financing?.fixedRatio?.debtPct ?? 70);
const debtMoved = movedKpis('project.financing.fixedRatio.debtPct', baseDebt >= 50 ? 40 : 80);
check('Debt % (changed vs base) moves the comparison', debtMoved.length > 0, `moved=${debtMoved.join(', ')}`);
check('Debt % moves Total Financing Cost', debtMoved.includes('Total Financing Cost'), `moved=${debtMoved.join(', ')}`);

// Revenue: a sub-unit unitPrice (sale price / rent) drives GDV.
const sub = (base.subUnits as any[]).find((u) => Number(u.unitPrice) > 0);
if (sub) {
  const revMoved = movedKpis(`subUnits[id=${sub.id}].unitPrice`, Number(sub.unitPrice) * 1.5);
  check('Sub-unit unitPrice +50% moves the comparison', revMoved.length > 0, `moved=${revMoved.join(', ')}`);
  check('unitPrice moves Gross Development Value', revMoved.includes('Gross Development Value'), `moved=${revMoved.join(', ')}`);
}

// Opex inflation: on an Operate/Lease asset; expect a profit/margin/IRR move.
const opAsset = (base.assets as any[]).find((a) => a.strategy === 'Operate' || a.strategy === 'Lease');
if (opAsset) {
  const opexMoved = movedKpis(`assets[id=${opAsset.id}].opex.defaultIndexation.rate`, 0.10);
  check('Opex inflation 10% moves the comparison (opex -> NOI -> returns)', opexMoved.length > 0, `moved=${opexMoved.join(', ')}`);
}

// ── 3. "N overrides" count must equal a REAL difference from base. ───────────
console.log('\n[3] Override count reflects a real model difference');
// A value EQUAL to base must NOT register as a real override.
reset();
store.getState().setActiveCase(DOWN);
store.getState().setCaseFieldValue(DOWN, 'project.financing.fixedRatio.debtPct', baseDebt);
const noopDiff = Object.keys(buildOverrides(store.getState().baseSnapshot, live())).length;
check('override == base value yields 0 real model diff (no phantom override)', noopDiff === 0, `realDiff=${noopDiff}`);
// A debt/equity SPLIT change registers a PAIRED real diff: the edited half plus
// its auto-derived partner (equity % = 100 - debt %), so the split stays
// consistent and the engine (which normalizes by debt+equity) honours it fully.
// See verify-module6-debt-equity-pair.ts.
reset();
store.getState().setActiveCase(DOWN);
store.getState().setCaseFieldValue(DOWN, 'project.financing.fixedRatio.debtPct', baseDebt >= 50 ? 40 : 80);
const realDiff = Object.keys(buildOverrides(store.getState().baseSnapshot, live())).length;
check('a debt % change registers a paired real diff (debt + auto-derived equity)', realDiff === 2, `realDiff=${realDiff}`);

// ── 4. Coverage census (informational, printed for the readout). ─────────────
console.log('\n[4] Coverage census (numeric fields that move >=1 KPI on a real change)');
let movers = 0;
for (const f of numFields) {
  const target = Number(f.value) === 0 ? 1 : Number(f.value) * 2 + 7;
  if (movedKpis(f.path, target).length > 0) movers++;
}
console.log(`  ${movers}/${numFields.length} numeric fields move at least one KPI on a real change.`);
check('a material share of fields move (pipeline is live, not dead)', movers > numFields.length * 0.4, `movers=${movers}/${numFields.length}`);

// ── 5. Inert-lever gating (do not offer levers dead under the active config). ─
console.log('\n[5] Inert-lever gating (config-aware)');
const m3: any = { project: { financing: { fundingMethod: 3 } } };
const m1: any = { project: { financing: { fundingMethod: 1 } } };
check('Debt % inactive under funding method 3 (gap-sized)', !!inactiveLeverReason('project.financing.fixedRatio.debtPct', m3));
check('Debt % ACTIVE under funding method 1', inactiveLeverReason('project.financing.fixedRatio.debtPct', m1) === null);
check('Tranche interest inactive under fixed-ratio (method 1)', !!inactiveLeverReason('financingTranches[id=t1].interestRatePct', m1));
const mOcc: any = { project: {}, assets: [{ id: 'h', strategy: 'Operate' }], subUnits: [{ id: 'k', assetId: 'h', occupancyPct: 65 }] };
check('Occupancy % inactive on an Operate (hospitality) asset', !!inactiveLeverReason('subUnits[id=k].occupancyPct', mOcc));
const mOpexPct: any = { project: {}, assets: [{ id: 'h', strategy: 'Operate', opex: { lines: [{ mode: 'pct_of_total_rev' }] } }] };
check('Opex inflation inactive with no fixed-cost lines', !!inactiveLeverReason('assets[id=h].opex.defaultIndexation.rate', mOpexPct));
const mOpexFixed: any = { project: {}, assets: [{ id: 'h', strategy: 'Operate', opex: { lines: [{ mode: 'per_room_year' }, { mode: 'pct_of_total_rev' }] } }] };
check('Opex inflation ACTIVE when a fixed-cost line exists', inactiveLeverReason('assets[id=h].opex.defaultIndexation.rate', mOpexFixed) === null);
const mLease: any = { project: {}, subUnits: [{ id: 'u', assetId: 'L', unitPrice: 1200 }] };
check('Lease base rate inactive when unit price is set', !!inactiveLeverReason('assets[id=L].revenue.lease.baseRate', mLease));
const mPerp: any = { project: { returns: { terminalMethod: 'exit_multiple' } } };
check('Perpetuity growth inactive under exit-multiple terminal', !!inactiveLeverReason('project.returns.perpetuityGrowth', mPerp));

// ── 6. Comparison metrics: NPV row + explicit null-FCFF label. ───────────────
console.log('\n[6] Comparison metrics (NPV row + null-FCFF label)');
check('comparison exposes an NPV (FCFF) row (so discount rate has a metric)', CASE_KPIS.some((k) => k.label === 'NPV (FCFF)'));
const fcffKpi = CASE_KPIS.find((k) => k.label === 'Project IRR (FCFF)');
check('Project IRR (FCFF) carries an explicit null label (not a bare n/a)', !!fcffKpi?.nullLabel);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
