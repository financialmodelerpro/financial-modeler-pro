/**
 * M2 Pass 2 verifier (re-baselined Pass 7d).
 *
 * Phase 1 Residential Sell engine baseline. Pass 7d (2026-05-17)
 * removed multi-cohort + Wafi escrow. Fixtures retained:
 *   A. Synthetic PIT recognition, no escrow.
 *   B. MAAD T2 cohort matrix (cash + over-time recognition) totals.
 */

import {
  computeSellAsset,
  reconcileSellAsset,
  type AssetSellConfig,
  type SubUnitMaterial,
} from '@/src/core/calculations/revenue';

interface Check { id: string; ok: boolean; detail: string }

const checks: Check[] = [];

function near(a: number, b: number, tolAbs = 1, tolRelPct = 1): boolean {
  const d = Math.abs(a - b);
  if (d <= tolAbs) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return (d / scale) * 100 <= tolRelPct;
}

function assertNear(id: string, actual: number, expected: number, tolAbs = 1, tolRelPct = 1): void {
  const ok = near(actual, expected, tolAbs, tolRelPct);
  checks.push({
    id,
    ok,
    detail: `actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${(actual - expected).toFixed(2)})`,
  });
}

function assertTrue(id: string, ok: boolean, detail: string): void {
  checks.push({ id, ok, detail });
}

// ───────────────────────────────────────────────────────────────
// Fixture A: synthetic single sub-unit
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture A: synthetic Point-in-Time, no escrow ---');

const fixtureASubUnits: SubUnitMaterial[] = [
  { id: 'su-A-1br', area: 47800, count: 478, ratePerArea: 33456, ratePerUnit: 33456 * 100, metric: 'units' },
];
const totalSalesValueA = 47800 * 33456 * (0.05 + 0.30 + 0.30 + 0.25);

const fixtureAConfig: AssetSellConfig = {
  assetId: 'asset-A',
  subUnits: [
    { subUnitId: 'su-A-1br',
      preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
      postSalesVelocity: [0, 0, 0, 0, 0, 0, 0] },
  ],
  cashPaymentProfile: {
    percentages: [0, 0.20, 0.30, 0.30, 0.15, 0.05, 0],
    profileMode: 'absolute_with_catchup',
  },
  recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
  indexation: { method: 'none' },
};

const resultA = computeSellAsset({
  config: fixtureAConfig,
  subUnits: fixtureASubUnits,
  axisLength: 7,
  handoverYear: 4,
});

// A1: total sales value
const totSalesA = resultA.presalesRevenuePerPeriod.reduce((s, v) => s + v, 0);
assertNear('A1: total sales value', totSalesA, totalSalesValueA, 1, 0.01);

// A2: sum of cash = sum of sales
const totCashA = resultA.cashCollectedPerPeriod.reduce((s, v) => s + v, 0);
assertNear('A2: cash total = sales total', totCashA, totalSalesValueA, 1, 0.01);

// A3: sum of recognition = sum of sales
const totRecA = resultA.recognitionPerPeriod.reduce((s, v) => s + v, 0);
assertNear('A3: recognition total = sales total', totRecA, totalSalesValueA, 1, 0.01);

// A4: PIT recognition lumps all at handover year (idx 4)
assertNear('A4: PIT recognition lump at handover', resultA.recognitionPerPeriod[4], totalSalesValueA, 1, 0.01);

// A5: reconcile.ok
const reconA = reconcileSellAsset(resultA, fixtureAConfig);
assertTrue('A5: reconcile.ok (PIT no escrow)', reconA.ok,
  reconA.identities.filter((x) => !x.ok).map((x) => `${x.id}:${x.message}`).join('; ') || 'all passed');

// ───────────────────────────────────────────────────────────────
// Fixture B: MAAD T2 (1BR + 2BR, over-time recognition, no escrow)
// Verifies cohort matrix totals across cash + recognition.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture B: MAAD T2 cohort totals (no escrow) ---');

const fixtureBSubUnits: SubUnitMaterial[] = [
  { id: 'su-B-1br', area: 47800, count: 478, ratePerArea: 33456, ratePerUnit: 33456 * 100, metric: 'units' },
  { id: 'su-B-2br', area: 36497.1, count: 243, ratePerArea: 33505, ratePerUnit: 33505 * 150.198, metric: 'units' },
];
const totSales1br = 47800 * 33456 * (0.05 + 0.30 + 0.30 + 0.25);
const totSales2br = 36497.1 * 33505 * (0.05 + 0.30 + 0.30 + 0.25);
const totSalesB = totSales1br + totSales2br;

const fixtureBConfig: AssetSellConfig = {
  assetId: 'asset-B',
  subUnits: [
    { subUnitId: 'su-B-1br',
      preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
      postSalesVelocity: [0, 0, 0, 0, 0, 0, 0] },
    { subUnitId: 'su-B-2br',
      preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
      postSalesVelocity: [0, 0, 0, 0, 0, 0, 0] },
  ],
  cashPaymentProfile: {
    percentages: [0, 0.20, 0.30, 0.30, 0.15, 0.05, 0],
    profileMode: 'absolute_with_catchup',
  },
  recognitionProfile: {
    method: 'over_time',
    percentages: [0, 0.30, 0.30, 0.30, 0.10, 0, 0],
    profileMode: 'absolute_with_catchup',
  },
  indexation: { method: 'none' },
};

const resultB = computeSellAsset({
  config: fixtureBConfig,
  subUnits: fixtureBSubUnits,
  axisLength: 7,
  handoverYear: 4,
});

// B1: total sales matches
const totSalesBComputed = resultB.presalesRevenuePerPeriod.reduce((s, v) => s + v, 0);
assertNear('B1: total sales value matches', totSalesBComputed, totSalesB, 1, 0.01);

// B2: total cash = total sales
const totCashB = resultB.cashCollectedPerPeriod.reduce((s, v) => s + v, 0);
assertNear('B2: cash total = sales total', totCashB, totSalesB, 1, 0.01);

// B3: total recognition = total sales
const totRecB = resultB.recognitionPerPeriod.reduce((s, v) => s + v, 0);
assertNear('B3: recognition total = sales total', totRecB, totSalesB, 1, 0.01);

// B4: reconcile.ok
const reconB = reconcileSellAsset(resultB, fixtureBConfig);
assertTrue('B4: reconcile.ok (Over-Time no escrow)', reconB.ok,
  reconB.identities.filter((x) => !x.ok).map((x) => `${x.id}:${x.message}`).join('; ') || 'all passed');

// B5: vintage matrix row sums = sales per year
let vintageOk = true;
for (let r = 0; r < 7; r++) {
  const rowSum = resultB.cashVintageMatrix[r].reduce((s, v) => s + v, 0);
  const sale = resultB.presalesRevenuePerPeriod[r];
  if (Math.abs(rowSum - sale) > 1) { vintageOk = false; break; }
}
assertTrue('B5: cash vintage matrix row sums = sales per cohort', vintageOk,
  vintageOk ? 'every row total = cohort sales value' : 'row sum mismatch');

// B6: vintage matrix column sums = cash collected per period
let colOk = true;
for (let c = 0; c < 7; c++) {
  let colSum = 0;
  for (let r = 0; r < 7; r++) colSum += resultB.cashVintageMatrix[r][c];
  if (Math.abs(colSum - resultB.cashCollectedPerPeriod[c]) > 1) { colOk = false; break; }
}
assertTrue('B6: cash vintage matrix col sums = cashCollected per period', colOk,
  colOk ? 'every col total = period cash collection' : 'col sum mismatch');

// Report
let pass = 0;
let fail = 0;
for (const c of checks) {
  const tag = c.ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${c.id}: ${c.detail}`);
  if (c.ok) pass++; else fail++;
}
console.log(`\n--- Revenue rebuild verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) process.exitCode = 1;
