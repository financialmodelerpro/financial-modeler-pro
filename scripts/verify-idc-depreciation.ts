/**
 * M4 Pass 2M-C2 (2026-05-20): IDC depreciation on Operate/Lease.
 *
 * The composer feeds capitalised IDC interest into computeAssetFixedAssets
 * as a per-period addition stream so the IDC amounts depreciate over the
 * asset's useful life. This verifier exercises that surface with
 * deterministic fixtures.
 *
 * Sections:
 *   A: Single-period IDC addition, straight-line useful life
 *   B: Multi-period IDC additions (construction window)
 *   C: IDC addition + opening NBV vintage interact correctly
 *   D: Wash identity: sum(depreciation) = sum(additions) when run long
 *   E: Reducing-balance IDC depreciation
 *   F: startIdx defers depreciation for early additions
 */

import { computeAssetFixedAssets } from '@/src/core/calculations/depreciation';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertNear(name: string, actual: number, expected: number, tol = 0.01): void {
  const delta = actual - expected;
  if (Math.abs(delta) <= tol) {
    pass++;
    console.log(`  [PASS] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
    console.log(`  [FAIL] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  }
}

console.log('=== M4 Pass 2M-C2 IDC depreciation verifier ===');

// ──────────────────────────────────────────────────────────────────
// A: Single-period IDC addition
// ──────────────────────────────────────────────────────────────────
console.log('\n[A] Single-period IDC addition, straight-line 10y');
{
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 11,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  assertNear('A1: depreciation[1] = 100 / 10 = 10', r.depreciationPerPeriod[1], 10);
  assertNear('A2: depreciation[10] = 10', r.depreciationPerPeriod[10], 10);
  assertNear('A3: closing NBV[10] = 0 (fully depreciated)', r.closingNBVPerPeriod[10], 0);
  assertNear('A4: sum(depreciation) = 100', r.depreciationPerPeriod.reduce((s, v) => s + v, 0), 100);
}

// ──────────────────────────────────────────────────────────────────
// B: Multi-period IDC additions during construction
// ──────────────────────────────────────────────────────────────────
console.log('\n[B] Multi-period IDC additions during construction');
{
  // IDC pattern: 3-year construction with capitalised interest
  const additions = [0, 50, 60, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 13,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  // Year 1: 50 over 10y = 5/yr starting year 1
  // Year 2: 60 over 10y = 6/yr starting year 2; total = 5 + 6 = 11
  // Year 3: 70 over 10y = 7/yr starting year 3; total = 5 + 6 + 7 = 18
  assertNear('B1: dep[1] = 5 (50/10)', r.depreciationPerPeriod[1], 5);
  assertNear('B2: dep[2] = 11 (5 + 6)', r.depreciationPerPeriod[2], 11);
  assertNear('B3: dep[3] = 18 (5 + 6 + 7)', r.depreciationPerPeriod[3], 18);
  assertNear('B4: dep[4] = 18 (same three vintages still active)', r.depreciationPerPeriod[4], 18);
  assertNear('B5: cum dep at end approximately = total additions', r.depreciationPerPeriod.reduce((s, v) => s + v, 0), 180);
}

// ──────────────────────────────────────────────────────────────────
// C: IDC addition layered on opening NBV
// ──────────────────────────────────────────────────────────────────
console.log('\n[C] Opening NBV + IDC additions');
{
  // Existing asset with 200 NBV over 5y remaining + new IDC 100 at year 1
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 12,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
    openingNBV: 200,
    openingRemainingLife: 5,
  });
  // Year 0: 200 / 5 = 40 (opening NBV vintage)
  assertNear('C1: dep[0] = 40 (opening NBV over 5y)', r.depreciationPerPeriod[0], 40);
  // Year 1: 40 (opening) + 10 (new 100 over 10y) = 50
  assertNear('C2: dep[1] = 50 (opening 40 + new 10)', r.depreciationPerPeriod[1], 50);
  // Year 5: opening NBV fully depreciated, new vintage still depreciating at 10/yr
  assertNear('C3: dep[5] = 10 (opening done; new vintage only)', r.depreciationPerPeriod[5], 10);
  // Wash: sum(depreciation) = 200 + 100 (opening + addition) once both fully depreciated.
  assertNear('C4: closing NBV[10] = 0 (opening 5y + new 10y both done by year 10)', r.closingNBVPerPeriod[10], 0);
}

// ──────────────────────────────────────────────────────────────────
// D: Wash identity over a sufficiently long axis
// ──────────────────────────────────────────────────────────────────
console.log('\n[D] Wash identity: sum(dep) = sum(additions) when axis fully covers all vintages');
{
  const additions = [0, 30, 40, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 14,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  const totalAdditions = additions.reduce((s, v) => s + v, 0);
  const totalDep = r.depreciationPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('D1: sum(dep) = sum(additions)', totalDep, totalAdditions);
}

// ──────────────────────────────────────────────────────────────────
// E: Reducing-balance method
// ──────────────────────────────────────────────────────────────────
console.log('\n[E] Reducing-balance IDC depreciation');
{
  const additions = [0, 100, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 5,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
    method: 'reducing_balance',
    reducingBalanceRate: 0.20,
  });
  // Year 1: 100 × 20% = 20
  // Year 2: 80 × 20% = 16
  // Year 3: 64 × 20% = 12.8
  // Year 4: 51.2 × 20% = 10.24
  assertNear('E1: dep[1] = 20', r.depreciationPerPeriod[1], 20);
  assertNear('E2: dep[2] = 16', r.depreciationPerPeriod[2], 16);
  assertNear('E3: dep[3] = 12.8', r.depreciationPerPeriod[3], 12.8);
  assertNear('E4: closing NBV[4] = 100 - cumulative dep', r.closingNBVPerPeriod[4], 100 - 20 - 16 - 12.8 - 10.24);
}

// ──────────────────────────────────────────────────────────────────
// F: startIdx defers early additions
// ──────────────────────────────────────────────────────────────────
console.log('\n[F] startIdx defers depreciation for early additions');
{
  // Addition at t=1, but startIdx = 3 → depreciation begins at year 3.
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 13,
    startIdx: 3,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  assertNear('F1: dep[1] = 0 (deferred)', r.depreciationPerPeriod[1], 0);
  assertNear('F2: dep[2] = 0 (still deferred)', r.depreciationPerPeriod[2], 0);
  assertNear('F3: dep[3] = 10 (starts at startIdx)', r.depreciationPerPeriod[3], 10);
  assertNear('F4: dep[12] = 10 (last full year)', r.depreciationPerPeriod[12], 10);
}

// ──────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
