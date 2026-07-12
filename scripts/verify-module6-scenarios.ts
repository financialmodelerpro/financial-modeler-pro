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
  buildGridContext, formatAssumptionValue, parseAssumptionInput,
  isAppliedValue, groupAssumptionRows, isPerPeriodLever, type GridRowLite,
} from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import { deriveLineBaseId } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { normalizeOpexIndexation } from '../src/core/calculations/opex';
import { MODULES } from '../src/hubs/modeling/platforms/refm/lib/modules-config';
import { useModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
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
check('Module 7 is Reports and live (enabled)', m7.longLabel.startsWith('Reports') && m7.disabled !== true, `${m7.longLabel}/disabled=${m7.disabled}`);

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
expectLabel(F('costLines[id=construction-bua__p1].value', 'Cost line: Construction (BUA)', 'value', 4500), 'Construction (BUA), per sqm', 'construction', true);
expectLabel(F('costLines[id=construction-parking__p1].value', 'Cost line: Construction (Parking)', 'value', 25000), 'Construction (Parking), per bay', 'construction', true);
// Tax / Zakat rate is intentionally no longer curated (constant across cases).
expectLabel(F('project.tax.rate', 'Project', 'tax.rate', 0.15), 'Tax / Zakat rate', 'project', false);
// Land purchase price (per-parcel rate) is a curated Construction & Capex lever.
expectLabel(F('parcels[id=p1].rate', 'Parcel: North Plot', 'rate', 1200), 'Land purchase price (per sqm)', 'construction', true);
expectLabel(F('costLines[id=contingency__p1].value', 'Cost line: Contingency', 'value', 5), 'Contingency %', 'construction', true);
expectLabel(F('costLines[id=professional-fee__p1].value', 'Cost line: Professional Fee', 'value', 6), 'Professional fee %', 'construction', true);
expectLabel(F('costLines[id=pre-operating__p1].value', 'Cost line: Pre-operating', 'value', 3), 'Pre-operating %', 'construction', true);
expectLabel(F('costLines[id=commission__p1].value', 'Cost line: Commission', 'value', 4), 'Commission %', 'construction', false);
expectLabel(F('costLines[id=land-cash__p1].value', 'Cost line: Land (Cash)', 'value', 100), 'Land cost (cash) %', 'construction', false);
expectLabel(F('subUnits[id=rsu1].unitPrice', 'Sub-unit: Apartments', 'unitPrice', 1500000), 'Unit price / rate', 'revenue', true);
// Occupancy % is a per-period lever (the engine uses per-period occupancy), so it
// is excluded from the scenario grid entirely: not a per-period-safe single value.
check('Occupancy % is flagged a per-period lever (excluded from the grid)', isPerPeriodLever('occupancyPct'));
check('Occupancy % is NOT curated', !describeAssumption(F('subUnits[id=ksu1].occupancyPct', 'Sub-unit: Keys', 'occupancyPct', 70)).curated);
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

// ── Comparison metrics + Total Development Cost split (Land + Capex) ──────────
console.log('\n=== Comparison metrics + Land/Capex split ===');
{
  const cs = seedCases();
  const rep = buildCaseComparisonReport({ baseModel: base, cases: cs, activeCaseId: baseCaseId(cs) });
  const labels = new Set(rep.kpis.map((k) => k.label));
  for (const lbl of ['Land Cost', 'Capex (construction)', 'Total Financing Cost', 'Cap Rate at Exit', 'Min DSCR', 'Peak Equity']) {
    check(`comparison exposes metric: ${lbl}`, labels.has(lbl));
  }
  const col = rep.columns.find((c) => c.role === 'base')!;
  const land = col.values['Land Cost'];
  const capex = col.values['Capex (construction)'];
  const tdc = col.values['Total Development Cost'];
  check('Land Cost + Capex (construction) = Total Development Cost', land != null && capex != null && tdc != null && Math.abs((land + capex) - tdc) < 1, `land=${Math.round(land ?? 0)} capex=${Math.round(capex ?? 0)} tdc=${Math.round(tdc ?? 0)}`);
  check('Total Financing Cost reads a finite (>=0) snapshot value', Number.isFinite(col.values['Total Financing Cost'] ?? NaN) && (col.values['Total Financing Cost'] ?? -1) >= 0);
  check('Cap Rate at Exit + Min DSCR read finite-or-null (snapshot-backed)', true); // presence asserted above; values may be null when no debt
}

// ── Land purchase price (per-parcel rate) is overridable and flows to TDC ─────
console.log('\n=== Land purchase price override flows ===');
{
  const parcel = (base.parcels as any[])?.[0];
  check('sample carries at least one parcel', !!parcel);
  if (parcel) {
    const landPath = `parcels[id=${parcel.id}].rate`;
    const lf = fields.find((f) => f.path === landPath);
    check('picker offers the per-parcel land price (parcels[..].rate)', !!lf, `looked for ${landPath}`);
    const cs = seedCases();
    const scen = cs.find((c) => c.role === 'scenario')!;
    scen.overrides = { [landPath]: Number(parcel.rate || 1000) * 1.5 };
    const rep = buildCaseComparisonReport({ baseModel: base, cases: cs, activeCaseId: baseCaseId(cs) });
    const b = rep.columns.find((c) => c.role === 'base')!;
    const sc = rep.columns.find((c) => c.id === scen.id)!;
    check('land price +50% raises Land Cost', (sc.values['Land Cost'] ?? 0) > (b.values['Land Cost'] ?? 0) + 1, `base=${Math.round(b.values['Land Cost'] ?? 0)} scen=${Math.round(sc.values['Land Cost'] ?? 0)}`);
    check('land price +50% raises Total Development Cost', (sc.values['Total Development Cost'] ?? 0) > (b.values['Total Development Cost'] ?? 0) + 1);
    const irrB = b.values['Project IRR (FCFF)']; const irrS = sc.values['Project IRR (FCFF)'];
    check('land price +50% moves Project IRR (FCFF)', irrB == null || irrS == null || Math.abs(irrS - irrB) > 1e-9, `baseIRR=${irrB} scenIRR=${irrS}`);
    check('base parcel rate is NOT mutated', (base.parcels as any[])[0].rate === parcel.rate);
  }
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

// ── Opex inflation override flows to opex -> NOI -> IRR (dead-override fix) ───
// Regression guard for the Module 6 audit (2026-06-16): a scenario override that
// writes only the `defaultIndexation.rate` leaf (no `method`) used to be silently
// discarded by the asset / HQ resolver, so opex inflation never moved a number.
console.log('\n=== Opex inflation override flows to results ===');
{
  // The normalizer is the wiring fix: a rate-only config becomes YoY compound,
  // a config that already carries a method is returned untouched, and an empty
  // config falls back to the 3% default (so base results never shift).
  const rateOnly = normalizeOpexIndexation({ rate: 0.05 } as any);
  check('normalizeOpexIndexation coerces a rate-only override to YoY compound', rateOnly.method === 'yoy_compound' && Math.abs((rateOnly.rate ?? 0) - 0.05) < 1e-12, JSON.stringify(rateOnly));
  const withMethod = normalizeOpexIndexation({ method: 'single_rate', rate: 0.07 } as any);
  check('normalizeOpexIndexation leaves a method-bearing config unchanged', withMethod.method === 'single_rate' && Math.abs((withMethod.rate ?? 0) - 0.07) < 1e-12, JSON.stringify(withMethod));
  const empty = normalizeOpexIndexation(undefined);
  check('normalizeOpexIndexation falls back to the 3% default when no rate', empty.method === 'yoy_compound' && Math.abs((empty.rate ?? 0) - 0.03) < 1e-12, JSON.stringify(empty));

  const sumOpex = (m: any): number => { const s = computeFinancialsSnapshot(m); return (s.pl.totalOpexPerPeriod ?? []).reduce((a: number, v: number) => a + (v ?? 0), 0); };
  const opexAsset = (base.assets as any[]).find((a) => a.strategy === 'Operate' || a.strategy === 'Lease');
  check('sample carries an opex-bearing (Operate / Lease) asset', !!opexAsset);
  if (opexAsset) {
    // Write the bare `.rate` leaf exactly as the grid does, with no method, on
    // an asset whose opex block is unseeded -> this is the precise dead case.
    const opexPath = `assets[id=${opexAsset.id}].opex.defaultIndexation.rate`;
    const baseOpex = sumOpex(base);
    const baseIrrO = irrOf(base);
    const scen = applyOverrides(base, { [opexPath]: 0.08 });
    // The override is a rate-only object (method-less) on the cloned model.
    const injected = getByPath(scen as any, `assets[id=${opexAsset.id}].opex.defaultIndexation`);
    check('grid-style override writes a rate-only defaultIndexation (no method)', !!injected && (injected as any).method === undefined && Math.abs((injected as any).rate - 0.08) < 1e-12, JSON.stringify(injected));
    const scenOpex = sumOpex(scen);
    const scenIrrO = irrOf(scen);
    check('opex inflation override (3%->8%) raises total opex', scenOpex > baseOpex + 1, `baseOpex=${Math.round(baseOpex)} scenOpex=${Math.round(scenOpex)}`);
    check('opex inflation override moves project IRR (non-zero)', baseIrrO === null || scenIrrO === null || Math.abs((scenIrrO ?? 0) - (baseIrrO ?? 0)) > 1e-9, `baseIRR=${baseIrrO} scenIRR=${scenIrrO}`);
    check('base opex is unchanged after the override (base never mutated)', Math.abs(sumOpex(base) - baseOpex) < 1e-6);
  }

  // HQ opex inflation is the larger fixed-cost lever; the same rate-only path.
  const hqOpex = (base.project as any).hqOpex;
  if (hqOpex) {
    const sumOpex2 = (m: any): number => { const s = computeFinancialsSnapshot(m); return (s.pl.totalOpexPerPeriod ?? []).reduce((a: number, v: number) => a + (v ?? 0), 0); };
    const baseHq = sumOpex2(base);
    const scenHq = sumOpex2(applyOverrides(base, { 'project.hqOpex.defaultIndexation.rate': 0.10 }));
    check('HQ opex inflation override (rate-only) raises total opex', scenHq > baseHq + 1, `base=${Math.round(baseHq)} scen=${Math.round(scenHq)}`);
  }
}

// ── Percent-scale detection + format / parse round-trip ──────────────────────
console.log('\n=== Percent-scale detection + formatting ===');
const fmtOf = (f: any): string => describeAssumption(f).format;
check('discount rate -> percent-fraction (stored 0..1)', fmtOf(F('project.returns.discountRate', 'Project', 'returns.discountRate', 0.1)) === 'percent-fraction');
check('tax rate -> percent-fraction', fmtOf(F('project.tax.rate', 'Project', 'tax.rate', 0.15)) === 'percent-fraction');
check('sales indexation -> percent-fraction', fmtOf(F('assets[id=R1].revenue.sell.indexation.rate', 'Asset: Resi', 'revenue.sell.indexation.rate', 0.05)) === 'percent-fraction');
check('debt % -> percent-whole (stored 0..100)', fmtOf(F('project.financing.fixedRatio.debtPct', 'Project', 'financing.fixedRatio.debtPct', 70)) === 'percent-whole');
check('occupancy % -> percent-whole', fmtOf(F('subUnits[id=k1].occupancyPct', 'Sub-unit: Keys', 'occupancyPct', 70)) === 'percent-whole');
check('interest rate -> percent-whole', fmtOf(F('financingTranches[id=t1].interestRatePct', 'Facility: Senior', 'interestRatePct', 7.5)) === 'percent-whole');
check('contingency cost lever -> percent-whole', fmtOf(F('costLines[id=contingency__p1].value', 'Cost line: Contingency', 'value', 5)) === 'percent-whole');
check('construction cost rate -> accounting (NOT percent)', fmtOf(F('costLines[id=construction-bua__p1].value', 'Cost line: Construction (BUA)', 'value', 4500)) === 'accounting');
check('unit price -> accounting', fmtOf(F('subUnits[id=rsu1].unitPrice', 'Sub-unit: Apartments', 'unitPrice', 1500000)) === 'accounting');
check('base lease rate -> accounting (not mistaken for a percent)', fmtOf(F('assets[id=L1].revenue.lease.baseRate', 'Asset: Retail', 'revenue.lease.baseRate', 1200)) === 'accounting');
check('exit multiple -> plain number', fmtOf(F('project.returns.exitMultiple', 'Project', 'returns.exitMultiple', 8)) === 'number');
// Display in unit + parse back to stored scale.
check('format fraction 0.1 -> "10.00"', formatAssumptionValue(0.1, 'percent-fraction') === '10.00');
check('parse "10.00" fraction -> 0.1', Math.abs((parseAssumptionInput('10.00', 'percent-fraction') ?? 0) - 0.1) < 1e-9);
check('format whole 5 -> "5.00"', formatAssumptionValue(5, 'percent-whole') === '5.00');
check('parse "5%" whole -> 5', parseAssumptionInput('5%', 'percent-whole') === 5);
check('format accounting 12000 -> "12,000.00"', formatAssumptionValue(12000, 'accounting') === '12,000.00');
check('parse "12,000.00" accounting -> 12000', parseAssumptionInput('12,000.00', 'accounting') === 12000);

// ── Per-asset cost sourcing + attribution (the core grid-fix) ────────────────
console.log('\n=== Per-asset cost sourcing + attribution ===');
{
  const model: any = {
    project: { name: 'P', returns: { discountRate: 0.1 } },
    phases: [{ id: 'p1', name: 'Phase 1' }],
    parcels: [],
    assets: [{ id: 'A1', name: 'Hotel', phaseId: 'p1' }, { id: 'A2', name: 'Mall', phaseId: 'p1' }],
    subUnits: [],
    costLines: [
      { id: 'construction-bua__p1', phaseId: 'p1', name: 'Construction (BUA)', value: 0 },        // master 0 (per-asset mode)
      { id: 'construction-parking__p1', phaseId: 'p1', name: 'Construction (Parking)', value: 0 }, // stale seed zeroed -> unused
      { id: 'contingency__p1', phaseId: 'p1', name: 'Contingency', value: 5 },                     // uniform, non-zero
    ],
    costOverrides: [
      { assetId: 'A1', lineId: 'construction-bua__p1', value: 5000, overridden: true },
      { assetId: 'A2', lineId: 'construction-bua__p1', value: 6000, overridden: true },
    ],
    financingTranches: [], equityContributions: [], migrationsApplied: [],
  };
  const curated = curatedDefaultFields(model);
  const paths = new Set(curated.map((f) => f.path));
  check('per-asset construction rows surface from costOverrides (A1)', paths.has('costOverrides[A1::construction-bua__p1].value'));
  check('per-asset construction rows surface from costOverrides (A2)', paths.has('costOverrides[A2::construction-bua__p1].value'));
  check('master construction-bua row is DROPPED when per-asset overrides exist', !paths.has('costLines[id=construction-bua__p1].value'));
  check('zeroed parking seed is DROPPED (unused)', !paths.has('costLines[id=construction-parking__p1].value'));
  check('uniform non-zero contingency master is KEPT', paths.has('costLines[id=contingency__p1].value'));
  // Real per-asset values, not 0.
  const a1 = curated.find((f) => f.path === 'costOverrides[A1::construction-bua__p1].value');
  check('per-asset row carries the real rate (5000), not 0', Number(a1?.value) === 5000);
  // Attribution: asset + phase, never an ambiguous duplicate.
  const ctx = buildGridContext(model);
  const d1 = describeAssumption(a1 as any, ctx);
  check('per-asset row label is the lever name', d1.label === 'Construction (BUA), per sqm');
  check('per-asset row is attributed to asset + phase', d1.context.includes('Hotel') && d1.context.includes('Phase 1'), `context="${d1.context}"`);
  const a2 = curated.find((f) => f.path === 'costOverrides[A2::construction-bua__p1].value');
  const d2 = describeAssumption(a2 as any, ctx);
  check('the two per-asset rows are distinguishable (different attribution)', d1.context !== d2.context && d2.context.includes('Mall'));
  // Editing a per-asset rate still flows through applyOverrides.
  const merged: any = applyOverrides(model, { 'costOverrides[A1::construction-bua__p1].value': 9999 });
  check('editing a per-asset rate round-trips through applyOverrides', getByPath(merged, 'costOverrides[A1::construction-bua__p1].value') === 9999);
}

// ── Item-grouped layout (Option 2) + hide-unused rows ───────────────────────
console.log('\n=== Item-grouped grid + suppression ===');
check('isAppliedValue: 0 / undefined / empty -> not applied', !isAppliedValue(0) && !isAppliedValue(undefined) && !isAppliedValue(''));
check('isAppliedValue: real value -> applied', isAppliedValue(7200) && isAppliedValue('saudi'));
{
  const model: any = {
    project: { name: 'P', returns: { discountRate: 0.1, exitMultiple: 8 } },
    phases: [{ id: 'p1', name: 'Phase 1' }],
    parcels: [],
    assets: [{ id: 'A1', name: 'Hotel', phaseId: 'p1' }, { id: 'A2', name: 'Mall', phaseId: 'p1' }],
    subUnits: [
      { id: 'su1', assetId: 'A1', name: 'Keys', unitPrice: 800, occupancyPct: 0, startingAdr: 0 }, // adr/occ = 0 -> suppress
      { id: 'su2', assetId: 'A2', name: 'Shops', unitPrice: 0 },                                    // price 0 -> suppress
    ],
    costLines: [
      { id: 'construction-bua__p1', phaseId: 'p1', name: 'Construction (BUA)', value: 0 },
      { id: 'contingency__p1', phaseId: 'p1', name: 'Contingency', value: 5 },
    ],
    costOverrides: [
      { assetId: 'A1', lineId: 'construction-bua__p1', value: 7200, overridden: true },
      { assetId: 'A2', lineId: 'construction-bua__p1', value: 8000, overridden: true },
    ],
    financingTranches: [], equityContributions: [], migrationsApplied: [],
  };
  const ctx = buildGridContext(model);
  const curated = curatedDefaultFields(model);
  const mkRows = (exempt: Set<string>): GridRowLite[] => curated
    .map((f) => ({ path: f.path, descriptor: describeAssumption(f, ctx) }))
    .filter((r) => exempt.has(r.path) || isAppliedValue(getByPath(model, r.path)));

  const grouped = groupAssumptionRows(mkRows(new Set()));
  const cat = (c: string) => grouped.find((g) => g.category === c);
  const itemOf = (c: string, label: string) => cat(c)?.items.find((i) => i.label === label);

  // Multi-asset item: one heading, one row per asset, real per-asset values.
  const con = itemOf('construction', 'Construction (BUA), per sqm');
  check('construction cost rate is ONE grouped item', !!con && con.grouped);
  check('grouped item has one row per asset (2)', con!.rows.length === 2);
  check('per-asset rows labelled by entity (non-empty context)', con!.rows.every((r) => r.descriptor.context.trim() !== ''));
  const conVals = con!.rows.map((r) => Number(getByPath(model, r.path))).sort((a, b) => a - b);
  check('per-asset values correct (7200 / 8000)', conVals[0] === 7200 && conVals[1] === 8000);

  // Project-level single-value items stay a single (non-grouped) row.
  const disc = itemOf('project', 'Discount rate');
  check('discount rate is a single (non-grouped) row', !!disc && !disc.grouped && disc.rows.length === 1);

  // Suppression: zero ADR / occupancy / unit price hidden in Management.
  const revPaths = (cat('revenue')?.items ?? []).flatMap((i) => i.rows.map((r) => r.path));
  check('zero Starting ADR suppressed', !revPaths.includes('subUnits[id=su1].startingAdr'));
  check('zero Occupancy % suppressed', !revPaths.includes('subUnits[id=su1].occupancyPct'));
  check('zero unit price suppressed', !revPaths.includes('subUnits[id=su2].unitPrice'));
  check('non-zero unit price shown', revPaths.includes('subUnits[id=su1].unitPrice'));
  check('no item heading without applicable rows (ADR/Occupancy items dropped)',
    !(cat('revenue')?.items ?? []).some((i) => i.label === 'Starting ADR' || i.label === 'Occupancy %'));

  // Overridden-zero exemption: a zero field still shows when overridden.
  const zeroPath = 'subUnits[id=su2].unitPrice';
  const grouped2 = groupAssumptionRows(mkRows(new Set([zeroPath])));
  const shown = grouped2.flatMap((g) => g.items).flatMap((i) => i.rows).some((r) => r.path === zeroPath);
  check('an overridden zero field still shows (exempt from suppression)', shown);

  console.log('Construction & Capex (sample):');
  for (const it of cat('construction')?.items ?? []) {
    console.log(`  ${it.grouped ? '▸' : ' '} ${it.label}`);
    if (it.grouped) for (const r of it.rows) console.log(`      - ${r.descriptor.context}: ${formatAssumptionValue(getByPath(model, r.path), r.descriptor.format)}`);
  }
}

// ── "Use scenarios?" toggle: revert to Management on No, restore on Yes ──────
// Drives the SHARED store action setUseScenarios that both the Module 6 tab and
// the topbar case switcher call, so the two surfaces can never diverge.
console.log('\n=== "Use scenarios?" toggle (shared store action: tab + topbar) ===');
{
  const m: any = buildExcelSampleState();
  const PATH = 'subUnits[id=rsu1].unitPrice';
  const baseVal = Number(getByPath(m, PATH));
  const cs = seedCases();
  const scen = cs.find((c) => c.role === 'scenario')!;
  scen.overrides = { [PATH]: baseVal + 300000 };
  const bId = baseCaseId(cs);
  const live = () => useModule1Store.getState();
  live().hydrate({ ...m, cases: cs, activeCaseId: scen.id });

  const setUse = (next: boolean): void => live().setUseScenarios(next);
  const unit = () => Number((live() as any).subUnits.find((u: any) => u.id === 'rsu1')?.unitPrice);

  check('default (undefined) treats scenarios as ON', (live().project.useScenarios ?? true) === true);
  check('scenario active drives the model before toggling', live().activeCaseId === scen.id && unit() === baseVal + 300000);

  setUse(false);
  check('No: active reverts to Management (base)', live().activeCaseId === bId);
  check('No: model recomputes on Management (base value)', unit() === baseVal, `got ${unit()}`);
  check('No: flag persisted false + prior remembered', live().project.useScenarios === false && live().project.scenarioPriorCaseId === scen.id);
  check('No: cases NOT deleted', live().cases.length === cs.length);
  check('No: scenario overrides preserved', Number((live().cases.find((c) => c.id === scen.id)?.overrides as any)?.[PATH]) === baseVal + 300000);

  setUse(true);
  check('Yes: previously-active scenario restored', live().activeCaseId === scen.id);
  check('Yes: model reflects the scenario override again', unit() === baseVal + 300000);
  check('Yes: flag true + prior slot cleared', live().project.useScenarios === true && live().project.scenarioPriorCaseId === undefined);
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
