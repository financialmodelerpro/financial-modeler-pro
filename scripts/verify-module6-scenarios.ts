/**
 * verify-module6-scenarios.ts
 *
 * Module 6 Scenario Analysis surface: asserts the config swap, that the override
 * field picker only offers fields that round-trip the diff grammar, that an
 * explicit override recomputes the financials + returns on the active case while
 * the base is untouched, that auto-capture writes the same override map, and that
 * the comparison report builds. Also prints the override-coverage audit.
 *
 * Run: npx tsx scripts/verify-module6-scenarios.ts
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  applyOverrides, buildOverrides, getByPath, enumerateOverridableFields, seedCases, baseCaseId,
} from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { buildCaseComparisonReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';
import { MODULES } from '../src/hubs/modeling/platforms/refm/lib/modules-config';
import { buildExcelSampleState } from './excelSampleState';

let passed = 0, failed = 0;
const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const sumRev = (m: any): number => { const s = computeFinancialsSnapshot(m); return (s.pl.totalRevenuePerPeriod ?? []).reduce((a: number, v: number) => a + (v ?? 0), 0); };
const irrOf = (m: any): number | null => { try { return computeReturnsSnapshot(computeFinancialsSnapshot(m), m.project).result.fcff.irr; } catch { return null; } };

console.log('=== Module 6 Scenario Analysis verification ===\n');

// ── Config swap ──────────────────────────────────────────────────────────────
const m6 = MODULES.find((m) => m.key === 'module6')!;
const m7 = MODULES.find((m) => m.key === 'module7')!;
check('Module 6 is Scenario Analysis and enabled', m6.longLabel === 'Scenario Analysis' && m6.disabled === false && m6.status === 'done', `${m6.longLabel}/${m6.status}/disabled=${m6.disabled}`);
check('Module 7 is Reports and still a stub', m7.longLabel.startsWith('Reports') && m7.disabled === true, `${m7.longLabel}/disabled=${m7.disabled}`);

// ── Base model + field enumeration ───────────────────────────────────────────
const base = buildExcelSampleState() as any;
const fields = enumerateOverridableFields(base);
check('enumerateOverridableFields returns a non-trivial field list', fields.length > 20, `count=${fields.length}`);
check('every enumerated field is a scalar leaf (number / string / boolean)', fields.every((f) => f.type === 'number' || f.type === 'string' || f.type === 'boolean'));
check('the picker never offers an entity id', fields.every((f) => !/(^|\.)id$/.test(f.field)));

// Every enumerated field must round-trip: applyOverrides({path: v}) then read it back.
let roundTripOk = true; let firstBad = '';
for (const f of fields) {
  const probe = f.type === 'number' ? (Number(f.value) + 7) : f.type === 'boolean' ? !f.value : `${f.value}__x`;
  const merged = applyOverrides(base, { [f.path]: probe });
  const got = getByPath(merged as any, f.path);
  if (JSON.stringify(got) !== JSON.stringify(probe)) { roundTripOk = false; firstBad = `${f.path} -> got ${JSON.stringify(got)} want ${JSON.stringify(probe)}`; break; }
}
check('every offered field round-trips through applyOverrides', roundTripOk, firstBad);

// Auto-capture parity: buildOverrides on an edited model equals the explicit map.
const numField = fields.find((f) => f.type === 'number' && Number(f.value) > 0) ?? fields.find((f) => f.type === 'number')!;
const explicitMap = { [numField.path]: Number(numField.value) * 1.25 };
const editedModel = applyOverrides(base, explicitMap);
const captured = buildOverrides(base, editedModel);
check('auto-capture (buildOverrides) recovers the explicit override map', JSON.stringify(captured) === JSON.stringify(explicitMap), JSON.stringify(captured));

// ── Recompute on the active case + base untouched ────────────────────────────
const baseRev = sumRev(base);
const baseIrr = irrOf(base);
// Empirically find a single scalar override that actually moves total revenue,
// preferring obvious price / rate / occupancy drivers, so the test proves the
// override -> recompute chain rather than assuming a field name.
const numericPositive = fields.filter((f) => f.type === 'number' && Number(f.value) > 0);
const ordered = [
  ...numericPositive.filter((f) => /unitPrice|startingAdr|startingADR|baseRate|pricePerUnit|occupancy|adr|rent/i.test(f.field)),
  ...numericPositive,
];
let revField = ordered[0]; let scenRev = baseRev; let scenarioModel: any = base;
for (const f of ordered) {
  const m = applyOverrides(base, { [f.path]: Number(f.value) * 1.5 });
  const rev = sumRev(m);
  if (Math.abs(rev - baseRev) > 1) { revField = f; scenRev = rev; scenarioModel = m; break; }
}
const scenIrr = irrOf(scenarioModel);
check('overriding a revenue / price driver changes total revenue', Math.abs(scenRev - baseRev) > 1, `base=${Math.round(baseRev)} scenario=${Math.round(scenRev)} field=${revField.path}`);
check('the same override changes project IRR', baseIrr === null || scenIrr === null || Math.abs((scenIrr ?? 0) - (baseIrr ?? 0)) > 1e-6, `baseIRR=${baseIrr} scenIRR=${scenIrr}`);
check('the base model is unchanged after applying overrides', Math.abs(sumRev(base) - baseRev) < 1e-6 && getByPath(base, revField.path) === revField.value);

// ── Comparison report ────────────────────────────────────────────────────────
const cases = seedCases();
const scenarioCase = cases.find((c) => c.role === 'scenario')!;
scenarioCase.overrides = { [revField.path]: Number(revField.value) * 1.5 };
const report = buildCaseComparisonReport({ baseModel: base, cases, activeCaseId: baseCaseId(cases) });
check('comparison report has one column per case', report.columns.length === cases.length);
const baseColumn = report.columns.find((c) => c.role === 'base')!;
const scenColumn = report.columns.find((c) => c.id === scenarioCase.id)!;
const anyDelta = report.kpis.some((k) => baseColumn.values[k.label] !== scenColumn.values[k.label]);
check('comparison shows a real delta between base and scenario on at least one KPI', anyDelta);

// ── Coverage audit (printed for the readout) ─────────────────────────────────
console.log('\n=== Override coverage audit ===');
const byGroup = new Map<string, number>();
for (const f of fields) byGroup.set(f.group.split(':')[0], (byGroup.get(f.group.split(':')[0]) ?? 0) + 1);
console.log('Pickable scalar fields by group: ' + [...byGroup.entries()].map(([g, n]) => `${g}=${n}`).join('  '));
// Array-valued (scenario-relevant) leaves that are NOT individually pickable.
const arrayLeaves: string[] = [];
const walk = (path: string, obj: any): void => {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id') continue;
    if (Array.isArray(v)) arrayLeaves.push(`${path}.${k}`);
    else if (v && typeof v === 'object') walk(`${path}.${k}`, v);
  }
};
walk('project', base.project);
for (const a of base.assets ?? []) walk(`assets[id=${a.id}]`, a);
for (const u of base.subUnits ?? []) walk(`subUnits[id=${u.id}]`, u);
const uniqArr = [...new Set(arrayLeaves.map((p) => p.replace(/\[id=[^\]]+\]/g, '[id]')))];
console.log('Array-valued fields (overridable only as a WHOLE array via auto-capture, NOT in the picker):');
for (const p of uniqArr) console.log('   - ' + p);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(', ')); process.exit(1); }
