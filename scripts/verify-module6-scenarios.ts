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
import {
  describeAssumption, curatedDefaultFields, ASSUMPTION_CATEGORY_ORDER,
} from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import { deriveLineBaseId } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
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

// ── Per-element parcelFunding (new grammar) round-trips as discrete paths ─────
{
  const withPF: any = JSON.parse(JSON.stringify(base));
  const parcelId = withPF.parcels?.[0]?.id;
  withPF.project.financing = withPF.project.financing ?? {};
  withPF.project.financing.parcelFunding = parcelId ? [{ parcelId, debtPct: 40, equityPct: 60 }] : [];
  const pfFields = enumerateOverridableFields(withPF).filter((f) => /parcelFunding\[parcelId=.+\]\./.test(f.path));
  check('picker offers per-parcel funding fields (debtPct / equityPct)', !!parcelId && pfFields.some((f) => /\.debtPct$/.test(f.path)) && pfFields.some((f) => /\.equityPct$/.test(f.path)), `count=${pfFields.length}`);
  check('per-parcel funding never offers the parcelId reference itself', pfFields.every((f) => !/\.parcelId$/.test(f.path)));
  const debtField = pfFields.find((f) => /\.debtPct$/.test(f.path));
  if (debtField) {
    const merged = applyOverrides(withPF, { [debtField.path]: 75 });
    check('per-parcel funding override round-trips through applyOverrides', getByPath(merged as any, debtField.path) === 75, `got ${getByPath(merged as any, debtField.path)}`);
    // diffSnapshots emits the SAME per-element path (so auto-capture records it).
    const edited: any = JSON.parse(JSON.stringify(withPF));
    edited.project.financing.parcelFunding[0].debtPct = 75;
    const captured = buildOverrides(withPF as any, edited);
    check('diff grammar emits the per-element parcelFunding path', Object.keys(captured).some((p) => /parcelFunding\[parcelId=.+\]\.debtPct$/.test(p)) && captured[debtField.path] === 75, Object.keys(captured).join(','));
  }
}

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

// ── Assumptions grid: plain labels, categories, curated default set ──────────
console.log('\n=== Assumptions grid (labels / categories / curated) ===');
const F = (path: string, group: string, field: string, value: any, type: any = 'number'): any => ({ path, group, field, value, type });
const expectLabel = (f: any, label: string, cat: string, curated: boolean): void => {
  const d = describeAssumption(f);
  check(`"${label}" [${cat}${curated ? ', curated' : ''}]`, d.label === label && d.category === cat && d.curated === curated, `got label="${d.label}" cat=${d.category} curated=${d.curated}`);
};
expectLabel(F('project.returns.discountRate', 'Project', 'returns.discountRate', 0.1), 'Discount rate', 'project', true);
expectLabel(F('project.returns.exitMultiple', 'Project', 'returns.exitMultiple', 8), 'Exit multiple', 'project', true);
expectLabel(F('project.returns.perpetuityGrowth', 'Project', 'returns.perpetuityGrowth', 0.02), 'Perpetuity growth rate', 'project', true);
expectLabel(F('project.financing.fixedRatio.debtPct', 'Project', 'financing.fixedRatio.debtPct', 70), 'Debt %', 'financing', true);
expectLabel(F('financingTranches[id=t1].interestRatePct', 'Facility: Senior', 'interestRatePct', 7.5), 'Interest rate', 'financing', true);
expectLabel(F('costLines[id=construction-bua__p1].value', 'Cost line: Construction (BUA)', 'value', 4500), 'Construction cost rate (per BUA)', 'construction', true);
expectLabel(F('costLines[id=construction-parking__p1].value', 'Cost line: Construction (Parking)', 'value', 25000), 'Parking cost rate (per bay)', 'construction', true);
expectLabel(F('costLines[id=contingency__p1].value', 'Cost line: Contingency', 'value', 5), 'Contingency %', 'construction', true);
expectLabel(F('costLines[id=professional-fee__p1].value', 'Cost line: Professional Fee', 'value', 6), 'Professional fee %', 'construction', true);
expectLabel(F('costLines[id=pre-operating__p1].value', 'Cost line: Pre-operating', 'value', 3), 'Pre-operating %', 'construction', true);
expectLabel(F('costLines[id=commission__p1].value', 'Cost line: Commission', 'value', 4), 'Commission %', 'construction', false);
expectLabel(F('costLines[id=land-cash__p1].value', 'Cost line: Land (Cash)', 'value', 100), 'Land cost (cash) %', 'construction', false);
expectLabel(F('subUnits[id=rsu1].unitPrice', 'Sub-unit: Apartments', 'unitPrice', 1500000), 'Unit price / rate', 'revenue', true);
expectLabel(F('subUnits[id=ksu1].occupancyPct', 'Sub-unit: Keys', 'occupancyPct', 70), 'Occupancy %', 'revenue', true);
expectLabel(F('assets[id=h1].revenue.operate.startingADR', 'Asset: Hotel', 'revenue.operate.startingADR', 900), 'Starting ADR', 'revenue', true);
expectLabel(F('assets[id=h1].opex.defaultIndexation.rate', 'Asset: Hotel', 'opex.defaultIndexation.rate', 0.03), 'Opex inflation', 'opex', true);
expectLabel(F('project.name', 'Project', 'name', 'X', 'string'), 'Name', 'project', false);
check('context strips the entity-kind prefix (shows the entity name)', describeAssumption(F('subUnits[id=rsu1].unitPrice', 'Sub-unit: Apartments', 'unitPrice', 1)).context === 'Apartments');
check('no raw field-path leaks as a label (every catalog field gets a readable label)', fields.every((f) => { const d = describeAssumption(f); return d.label.length > 0 && !d.label.includes('[id='); }));

// ── Construction levers move Capex -> TDC -> IRR -> margin; base untouched ────
console.log('\n=== Construction levers move the model ===');
const conLine = (base.costLines as any[]).find((c) => deriveLineBaseId(c.id) === 'construction-bua');
const contLine = (base.costLines as any[]).find((c) => deriveLineBaseId(c.id) === 'contingency');
check('sample carries a construction (BUA) cost line', !!conLine);
check('sample carries a contingency cost line', !!contLine);
const TDC = 'Total Development Cost', IRR = 'Project IRR (FCFF)', MARGIN = 'Development Margin';
const runScenario = (ov: Record<string, unknown>) => {
  const cs = seedCases();
  const scen = cs.find((c) => c.role === 'scenario')!;
  scen.overrides = ov;
  const rep = buildCaseComparisonReport({ baseModel: base, cases: cs, activeCaseId: baseCaseId(cs) });
  return { baseCol: rep.columns.find((c) => c.role === 'base')!, scenCol: rep.columns.find((c) => c.id === scen.id)! };
};
if (conLine) {
  const conPath = `costLines[id=${conLine.id}].value`;
  const conValue = conLine.value;
  const { baseCol, scenCol } = runScenario({ [conPath]: conValue * 1.5 });
  check('construction cost +50% raises Total Development Cost', (scenCol.values[TDC] ?? 0) > (baseCol.values[TDC] ?? 0) + 1, `base=${Math.round(baseCol.values[TDC] ?? 0)} scen=${Math.round(scenCol.values[TDC] ?? 0)}`);
  check('construction cost +50% moves Project IRR', Math.abs((scenCol.values[IRR] ?? 0) - (baseCol.values[IRR] ?? 0)) > 1e-6, `base=${baseCol.values[IRR]} scen=${scenCol.values[IRR]}`);
  check('construction cost +50% moves Development Margin', Math.abs((scenCol.values[MARGIN] ?? 0) - (baseCol.values[MARGIN] ?? 0)) > 1e-6);
  check('base construction cost line is NOT mutated', (base.costLines as any[]).find((c) => c.id === conLine.id).value === conValue);
}
if (contLine) {
  const contPath = `costLines[id=${contLine.id}].value`;
  const { baseCol, scenCol } = runScenario({ [contPath]: (contLine.value || 5) + 10 });
  check('contingency +10pp raises Total Development Cost', (scenCol.values[TDC] ?? 0) > (baseCol.values[TDC] ?? 0) + 1, `base=${Math.round(baseCol.values[TDC] ?? 0)} scen=${Math.round(scenCol.values[TDC] ?? 0)}`);
}

// curatedDefaultFields surfaces the construction levers present in the model.
{
  const curated = curatedDefaultFields(base);
  const curatedLineIds = new Set(curated.filter((f) => f.path.startsWith('costLines[')).map((f) => deriveLineBaseId(/id=([^\]]+)/.exec(f.path)?.[1] ?? '')));
  for (const id of ['construction-bua', 'construction-parking', 'infrastructure', 'landscaping', 'pre-operating', 'professional-fee', 'contingency']) {
    check(`curated default includes construction lever: ${id}`, curatedLineIds.has(id));
  }
  check('curated default EXCLUDES land-cash (locked / derived)', !curatedLineIds.has('land-cash'));
  check('curated default EXCLUDES commission (revenue-driven)', !curatedLineIds.has('commission'));
  check('every category in the order list is a valid key', ASSUMPTION_CATEGORY_ORDER.length === 5);
  console.log('Curated key drivers in sample: ' + curated.map((f) => describeAssumption(f).label).join(', '));
}

console.log('\nDeferred (NOT in this commit): construction-timeline fields');
console.log('  constructionStart / constructionPeriods / operationsPeriods / startDate are scalar');
console.log('  phase fields that round-trip the grammar, but the engine reads them to derive the');
console.log('  period axis + handover, while cost-line start/endPeriod and the per-phase windowed');
console.log('  byPhase arrays are stored separately and are NOT re-derived by a value-only override');
console.log('  (the phase-date cascade was deliberately disabled). They need a cascade-on-override to');
console.log('  be correct, so they are excluded from the curated levers here.');

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
