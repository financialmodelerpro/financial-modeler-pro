/**
 * M4 Pass 2M-C1 (2026-05-20): Cost of Sales V2 engine verifier.
 *
 * Pure-engine coverage for buildCostOfSalesV2 mirroring the
 * verify-opex-ap pattern: deterministic fixtures + identity checks.
 *
 * Sections:
 *   A: Zero pre-sales, all-deferred to operations
 *   B: 100% pre-sold upfront, CoS follows recognition profile
 *   C: 50% pre-sold mid-construction, joint factor sanity
 *   D: Wash identity: cumulative CoS = totalCapex × (pre + post) / inventory
 *   E: Vintage matrix row sum = capex_i × cum_pre %
 *   F: Vintage matrix t < i cells = 0
 *   G: Recognition normalisation (caller passed % vs fraction)
 *   H: totalInventory fallback when inputs.totalInventory = 0
 */

import { buildCostOfSalesV2 } from '@/src/core/calculations/revenue';

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

console.log('=== M4 Pass 2M-C1 buildCostOfSalesV2 verifier ===');

// ──────────────────────────────────────────────────────────────────
// A: Zero pre-sales, all post-handover
// ──────────────────────────────────────────────────────────────────
console.log('\n[A] Zero pre-sales, all post-handover sales');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0, 0],
    presalesPerPeriod: [0, 0, 0, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 50, 50],
    recognitionPerPeriod: [0, 0.5, 0.5, 0, 0],
    totalInventory: 100,
    axisLength: 5,
  });
  assertNear('A1: totalCapex = 1000', r.totalCapex, 1000);
  assertNear('A2: construction CoS sums to 0 (no pre-sales)', r.cosConstructionPerPeriod.reduce((s, v) => s + v, 0), 0);
  assertNear('A3: ops CoS at year 3 = capex × postSales/inv (1000 × 50/100)', r.cosOperationsPerPeriod[3], 500);
  assertNear('A4: ops CoS at year 4 = 1000 × 50/100 = 500', r.cosOperationsPerPeriod[4], 500);
  assertNear('A5: total CoS = 1000 (entire capex flowed)', r.totalCosPerPeriod.reduce((s, v) => s + v, 0), 1000);
}

// ──────────────────────────────────────────────────────────────────
// B: 100% pre-sold upfront, CoS = recognition × capex
// ──────────────────────────────────────────────────────────────────
console.log('\n[B] 100% pre-sold upfront');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0],
    presalesPerPeriod: [100, 0, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 0],
    recognitionPerPeriod: [0, 0.4, 0.6, 0],
    totalInventory: 100,
    axisLength: 4,
  });
  assertNear('B1: cum pre-sales at t=0 = 1.0', r.cumPreSalesPerPeriod[0], 1.0);
  assertNear('B2: cum recognition at t=2 = 1.0', r.cumRecognitionPerPeriod[2], 1.0);
  assertNear('B3: construction CoS sum = totalCapex (1000)', r.cosConstructionPerPeriod.reduce((s, v) => s + v, 0), 1000);
  assertNear('B4: ops CoS sum = 0 (no post-handover sales)', r.cosOperationsPerPeriod.reduce((s, v) => s + v, 0), 0);
}

// ──────────────────────────────────────────────────────────────────
// C: 50% pre-sold mid-construction (joint factor sanity)
// ──────────────────────────────────────────────────────────────────
console.log('\n[C] 50% pre-sold at end of construction');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0, 0],
    presalesPerPeriod: [0, 25, 25, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 25, 25],
    recognitionPerPeriod: [0, 0.5, 0.5, 0, 0],
    totalInventory: 100,
    axisLength: 5,
  });
  assertNear('C1: cum pre-sales at t=2 = 0.5', r.cumPreSalesPerPeriod[2], 0.5);
  assertNear('C2: cum recognition at t=2 = 1.0', r.cumRecognitionPerPeriod[2], 1.0);
  assertNear('C3: joint factor at t=2 = 0.5', r.jointFactorPerPeriod[2], 0.5);
  assertNear('C4: construction CoS sum = 0.5 × 1000 = 500', r.cosConstructionPerPeriod.reduce((s, v) => s + v, 0), 500);
  assertNear('C5: ops CoS sum = post 50/100 × 1000 = 500', r.cosOperationsPerPeriod.reduce((s, v) => s + v, 0), 500);
}

// ──────────────────────────────────────────────────────────────────
// D: Wash identity
// ──────────────────────────────────────────────────────────────────
console.log('\n[D] Cumulative CoS = totalCapex × (pre + post) / inventory');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 1000, 1000, 0, 0],
    presalesPerPeriod: [0, 30, 20, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 30, 20],
    recognitionPerPeriod: [0, 0.5, 0.5, 0, 0],
    totalInventory: 100,
    axisLength: 5,
  });
  const totalPre = 50; const totalPost = 50;
  const expected = 2000 * (totalPre + totalPost) / 100;
  assertNear('D1: cumulative CoS at end matches identity', r.cumulativeCosPerPeriod[4], expected);
}

// ──────────────────────────────────────────────────────────────────
// E: Vintage matrix row sum = capex_i × cum_pre % (total)
// ──────────────────────────────────────────────────────────────────
console.log('\n[E] Vintage matrix row sum identity (construction window)');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 400, 600, 0],
    presalesPerPeriod: [0, 50, 50, 0],
    postSalesPerPeriod: [0, 0, 0, 0],
    recognitionPerPeriod: [0, 0.6, 0.4, 0],
    totalInventory: 100,
    axisLength: 4,
  });
  const row1Sum = r.vintageMatrix[1].reduce((s, v) => s + v, 0);
  const row2Sum = r.vintageMatrix[2].reduce((s, v) => s + v, 0);
  assertNear('E1: row 1 sum = capex_1 × cum_pre_total (400 × 1.0)', row1Sum, 400);
  assertNear('E2: row 2 sum = capex_2 × cum_pre_total (600 × 1.0)', row2Sum, 600);
}

// ──────────────────────────────────────────────────────────────────
// F: Vintage matrix t < i cells = 0
// ──────────────────────────────────────────────────────────────────
console.log('\n[F] Vintage matrix lower-triangular zero check');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0],
    presalesPerPeriod: [0, 50, 50, 0],
    postSalesPerPeriod: [0, 0, 0, 0],
    recognitionPerPeriod: [0, 0.5, 0.5, 0],
    totalInventory: 100,
    axisLength: 4,
  });
  let bad = 0;
  for (let i = 0; i < 4; i++) {
    for (let t = 0; t < i; t++) {
      if (Math.abs(r.vintageMatrix[i][t]) > 0.01) bad++;
    }
  }
  assertNear('F1: zero cells below diagonal', bad, 0);
}

// ──────────────────────────────────────────────────────────────────
// G: Recognition profile normalisation (sum to 1)
// ──────────────────────────────────────────────────────────────────
console.log('\n[G] Recognition normalisation: 0..100 vs 0..1');
{
  const r1 = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0],
    presalesPerPeriod: [50, 0, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 0],
    recognitionPerPeriod: [0, 60, 40, 0],
    totalInventory: 100,
    axisLength: 4,
  });
  const r2 = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0],
    presalesPerPeriod: [50, 0, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 0],
    recognitionPerPeriod: [0, 0.6, 0.4, 0],
    totalInventory: 100,
    axisLength: 4,
  });
  assertNear('G1: % and fraction recognition give same construction CoS sum', r1.cosConstructionPerPeriod.reduce((s, v) => s + v, 0), r2.cosConstructionPerPeriod.reduce((s, v) => s + v, 0));
  assertNear('G2: cum recognition tops out at 1.0', r1.cumRecognitionPerPeriod[2], 1.0);
}

// ──────────────────────────────────────────────────────────────────
// H: totalInventory = 0 fallback
// ──────────────────────────────────────────────────────────────────
console.log('\n[H] totalInventory = 0 fallback uses sum(pre + post)');
{
  const r = buildCostOfSalesV2({
    capexPerPeriod: [0, 500, 500, 0, 0],
    presalesPerPeriod: [0, 50, 50, 0, 0],
    postSalesPerPeriod: [0, 0, 0, 0, 0],
    recognitionPerPeriod: [0, 0.5, 0.5, 0, 0],
    totalInventory: 0,
    axisLength: 5,
  });
  assertNear('H1: construction CoS sum = totalCapex when fully pre-sold (fallback)', r.cosConstructionPerPeriod.reduce((s, v) => s + v, 0), 1000);
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
