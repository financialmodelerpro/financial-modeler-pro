/**
 * verify-cases.ts (2026-06-03): pure case-merge engine.
 *
 * Covers applyOverrides / buildOverrides / seeding against a minimal hand-built
 * model snapshot. The store + UI wiring is verified separately.
 */
import {
  applyOverrides,
  buildOverrides,
  getByPath,
  seedCases,
  baseCaseId,
  normaliseCases,
  curatedDefaultFields,
  enumerateOverridableFields,
} from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import type { ProjectCase } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}`); }
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Minimal model snapshot carrying the fields applyOverrides / diffSnapshots walk.
function baseSnap(): any {
  return {
    project: { name: 'P', currency: 'SAR', financing: { fundingMethod: 1, minimumCashReserve: 50000 } },
    landAllocationMode: 'autoByBua',
    phases: [{ id: 'ph1', name: 'Phase 1' }],
    parcels: [],
    assets: [
      { id: 'a1', name: 'Hotel', strategy: 'Operate', revenue: { operate: { startingADR: 900 } } },
      { id: 'a2', name: 'Resi', strategy: 'Sell', revenue: { sell: { pricePerUnit: 1000000 } } },
    ],
    subUnits: [],
    costLines: [{ id: 'L1', name: 'Construction', value: 1000, method: 'rate_per_bua' }],
    costOverrides: [{ assetId: 'a1', lineId: 'L1', value: 1234 }],
    financingTranches: [],
    equityContributions: [],
    migrationsApplied: [],
  };
}

console.log('=== verify-cases ===');

// A: applyOverrides sets nested project + asset + cost-line fields.
{
  const base = baseSnap();
  const merged: any = applyOverrides(base, {
    'project.financing.fundingMethod': 3,
    'assets[id=a2].revenue.sell.pricePerUnit': 1200000,
    'costLines[id=L1].value': 1500,
    'landAllocationMode': 'manual',
  });
  check('A1: nested project field set', merged.project.financing.fundingMethod === 3);
  check('A2: asset field by id set', merged.assets[1].revenue.sell.pricePerUnit === 1200000);
  check('A3: cost-line value by id set', merged.costLines[0].value === 1500);
  check('A4: top-level scalar set', merged.landAllocationMode === 'manual');
  check('A5: untouched asset inherits base', merged.assets[0].revenue.operate.startingADR === 900);
  check('A6: base snapshot is NOT mutated (clone)', base.project.financing.fundingMethod === 1 && base.assets[1].revenue.sell.pricePerUnit === 1000000);
}

// B: compound-key costOverrides path.
{
  const base = baseSnap();
  const merged: any = applyOverrides(base, { 'costOverrides[a1::L1].value': 9999 });
  check('B1: costOverride compound-key set', merged.costOverrides[0].value === 9999);
  check('B2: base costOverride unchanged', base.costOverrides[0].value === 1234);
}

// C: value-only, missing entity is a no-op (never creates a new entity).
{
  const base = baseSnap();
  const merged: any = applyOverrides(base, { 'assets[id=ghost].revenue.sell.pricePerUnit': 5 });
  check('C1: override on missing asset is skipped', merged.assets.length === 2 && eq(merged.assets, base.assets));
}

// D: round-trip applyOverrides(base, buildOverrides(base, edited)) === edited.
{
  const base = baseSnap();
  const edited = baseSnap();
  edited.project.financing.fundingMethod = 2;
  edited.assets[0].revenue.operate.startingADR = 990;
  edited.assets[1].revenue.sell.pricePerUnit = 1100000;
  edited.costLines[0].value = 1750;
  const ov = buildOverrides(base, edited);
  check('D1: buildOverrides captured 4 changed fields', Object.keys(ov).length === 4);
  const rebuilt = applyOverrides(base, ov);
  check('D2: round-trip rebuilds the edited snapshot exactly', eq(rebuilt, edited));
  check('D3: round-trip leaves base untouched', base.project.financing.fundingMethod === 1);
}

// E: inheritance, a field not overridden tracks the base value.
{
  const base = baseSnap();
  base.project.currency = 'AED'; // base changed
  const merged: any = applyOverrides(base, { 'assets[id=a2].revenue.sell.pricePerUnit': 1 });
  check('E1: unoverridden field inherits new base value', merged.project.currency === 'AED');
}

// F: seeding + normalise.
{
  const seeded = seedCases();
  check('F1: seeds 3 cases', seeded.length === 3);
  check('F2: exactly one base = Management', seeded.filter((c) => c.role === 'base').length === 1 && seeded[0].name === 'Management Case');
  check('F3: baseCaseId resolves the base', baseCaseId(seeded) === 'case_management');
  check('F4: normalise(undefined) seeds', normaliseCases(undefined).length === 3);
  const noBase: ProjectCase[] = [{ id: 'x', name: 'X', role: 'scenario', overrides: {} }, { id: 'y', name: 'Y', role: 'scenario', overrides: {} }];
  check('F5: normalise promotes first when no base', normaliseCases(noBase)[0].role === 'base');
  const twoBase: ProjectCase[] = [{ id: 'x', name: 'X', role: 'base', overrides: {} }, { id: 'y', name: 'Y', role: 'base', overrides: {} }];
  const fixed = normaliseCases(twoBase);
  check('F6: normalise keeps exactly one base', fixed.filter((c) => c.role === 'base').length === 1);
}

// ──────────────────────────────────────────────────────────────────────────
// G: OverrideBadge wired paths (Cases follow-up B). For each path a badge is
// wired to, editing that field must produce a buildOverrides key EXACTLY equal
// to the badge path (so the badge's getByPath detection + resetOverridePath
// target the same override) AND getByPath must read base vs edited differently.
// ──────────────────────────────────────────────────────────────────────────
{
  const base = baseSnap();
  base.project.tax = { rate: 0.15 };
  base.project.operatingAr = { dsoDays: 30 };
  base.project.statutoryReserve = { transferRate: 0.1, capOfShareCapital: 0.3 };
  base.project.shareCapital = 1000;
  base.project.returns = { discountRate: 0.1, exitMultiple: 8, perpetuityGrowth: 0.02 };
  const edited = JSON.parse(JSON.stringify(base));
  edited.project.tax.rate = 0.2;
  edited.project.operatingAr.dsoDays = 60;
  edited.project.statutoryReserve.transferRate = 0.05;
  edited.project.statutoryReserve.capOfShareCapital = 0.25;
  edited.project.shareCapital = 2000;
  edited.project.returns.discountRate = 0.12;
  edited.project.returns.exitMultiple = 10;
  edited.project.returns.perpetuityGrowth = 0.03;
  const ov = buildOverrides(base, edited);
  const wiredPaths = [
    'project.tax.rate', 'project.operatingAr.dsoDays',
    'project.statutoryReserve.transferRate', 'project.statutoryReserve.capOfShareCapital',
    'project.shareCapital', 'project.returns.discountRate', 'project.returns.exitMultiple', 'project.returns.perpetuityGrowth',
  ];
  for (const p of wiredPaths) {
    check(`G: buildOverrides has wired path ${p}`, Object.prototype.hasOwnProperty.call(ov, p));
    check(`G: getByPath base!=edited for ${p}`, JSON.stringify(getByPath(base, p)) !== JSON.stringify(getByPath(edited, p)));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// H: curatedDefaultFields (assumptions-grid default rows). Every returned field
// must be a real overridable path (round-trips the diff grammar), and the
// curated set must surface the headline drivers the model actually carries while
// excluding non-driver scalars (e.g. project.name / currency).
// ──────────────────────────────────────────────────────────────────────────
{
  const base = baseSnap();
  base.project.returns = { discountRate: 0.1, exitMultiple: 8, perpetuityGrowth: 0.02 };
  base.project.tax = { rate: 0.15 };
  base.assets[0].revenue.operate.occupancyPct = 70; // hospitality driver
  base.financingTranches = [{ id: 'T1', name: 'Senior', interestRatePct: 7.5 }];
  base.subUnits = [{ id: 'u1', name: 'Apartments', unitPrice: 12000 }];

  const curated = curatedDefaultFields(base);
  const curatedPaths = new Set(curated.map((f) => f.path));
  const allPaths = new Set(enumerateOverridableFields(base).map((f) => f.path));

  check('H1: every curated field is a real overridable path', curated.every((f) => allPaths.has(f.path)));
  check('H2: curated surfaces returns.discountRate', curatedPaths.has('project.returns.discountRate'));
  check('H3: curated surfaces tax rate', curatedPaths.has('project.tax.rate'));
  check('H4: curated surfaces facility interest rate', curatedPaths.has('financingTranches[id=T1].interestRatePct'));
  check('H5: curated surfaces sub-unit unit price', curatedPaths.has('subUnits[id=u1].unitPrice'));
  check('H6: curated surfaces sell price per unit', curatedPaths.has('assets[id=a2].revenue.sell.pricePerUnit'));
  check('H7: curated EXCLUDES non-driver project.name', !curatedPaths.has('project.name'));
  check('H8: curated EXCLUDES project.currency', !curatedPaths.has('project.currency'));
  // Each curated path applies cleanly (no silent skip = value actually changes).
  const merged: any = applyOverrides(base, { 'project.returns.discountRate': 0.2 });
  check('H9: a curated path round-trips through applyOverrides', merged.project.returns.discountRate === 0.2);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
