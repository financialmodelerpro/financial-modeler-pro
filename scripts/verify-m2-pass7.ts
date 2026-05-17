/**
 * M2 Pass 7 verifier (re-baselined Pass 7d).
 *
 * Builds two fixture results from the existing Sell engine, then runs
 * the three new schedule builders and asserts:
 *
 *   1. AR + Unearned identities are mirrors: at most one is non-zero
 *      per period, and ar[i] - unearned[i] = cumRec[i] - cumCash[i].
 *   2. Both are non-negative.
 *   3. AR/Unearned closing balances correctly track cumulative recognition
 *      minus cumulative cash.
 *   4. CoS sum equals total capex (matching principle) when recognition
 *      is fully realised by end of axis.
 *   5. CoS per period = totalCapex * recognition[i] / totalRecognition
 *      (re-derivation check).
 *   6. CoS axis length matches recognition axis length.
 *   7. Gross margin per period = recognition[i] - cos[i].
 *
 * Pass 7d (2026-05-17): escrow + multi-cohort removed from the engine,
 * fixtures no longer pass those fields.
 */

import {
  computeSellAsset,
  buildAccountsReceivable,
  buildUnearnedRevenue,
  buildCostOfSales,
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
  checks.push({ id, ok, detail: `actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${(actual - expected).toFixed(2)})` });
}
function assertTrue(id: string, ok: boolean, detail: string): void {
  checks.push({ id, ok, detail });
}

// ───────────────────────────────────────────────────────────────
// Fixture A: PIT recognition at handover, milestone cash.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture A: PIT recognition, milestone cash ---');

const subUnitsA: SubUnitMaterial[] = [
  { id: 'su-A-1br', area: 47800, count: 478, ratePerArea: 33456, ratePerUnit: 33456 * 100, metric: 'units' },
];
const totalSalesValueA = 47800 * 33456 * (0.05 + 0.30 + 0.30 + 0.25);
const configA: AssetSellConfig = {
  assetId: 'asset-A',
  subUnits: [{
    subUnitId: 'su-A-1br',
    preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
    postSalesVelocity: [0, 0, 0, 0, 0, 0, 0],
  }],
  cashPaymentProfile: { percentages: [0, 0.20, 0.30, 0.30, 0.15, 0.05, 0], profileMode: 'absolute_with_catchup' },
  recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
  indexation: { method: 'none' },
};
const resA = computeSellAsset({ config: configA, subUnits: subUnitsA, axisLength: 7, handoverYear: 4 });

const arA = buildAccountsReceivable(resA.recognitionPerPeriod, resA.cashCollectedPerPeriod, 7);
const urA = buildUnearnedRevenue(resA.recognitionPerPeriod, resA.cashCollectedPerPeriod, 7);

let bothNonZero = 0;
for (let i = 0; i < 7; i++) {
  if (arA.perPeriod[i] > 0.5 && urA.perPeriod[i] > 0.5) bothNonZero++;
}
assertTrue('A1: AR and Unearned mutually exclusive per period', bothNonZero === 0,
  `${bothNonZero} period(s) had both AR and Unearned simultaneously non-zero`);

let identityMaxDelta = 0;
for (let i = 0; i < 7; i++) {
  const lhs = arA.perPeriod[i] - urA.perPeriod[i];
  const rhs = arA.cumulativeRecognition[i] - arA.cumulativeCash[i];
  identityMaxDelta = Math.max(identityMaxDelta, Math.abs(lhs - rhs));
}
assertTrue('A2: AR - Unearned identity = cumRec - cumCash', identityMaxDelta < 1,
  `max delta=${identityMaxDelta.toFixed(4)}`);

let negCount = 0;
for (let i = 0; i < 7; i++) {
  if (arA.perPeriod[i] < -0.001) negCount++;
  if (urA.perPeriod[i] < -0.001) negCount++;
}
assertTrue('A3: AR/Unearned non-negative', negCount === 0, `${negCount} negative entries`);

const cumRecAt4 = arA.cumulativeRecognition[4];
assertNear('A4: cum recognition at handover = total sales', cumRecAt4, totalSalesValueA, 1, 0.01);

const capexA = 1_200_000_000;
const cosA = buildCostOfSales(resA.recognitionPerPeriod, capexA, 7);
const cosSumA = cosA.perPeriod.reduce((s, v) => s + v, 0);
assertNear('A5: cum CoS == totalCapex (full recognition)', cosSumA, capexA, 1, 0.001);

const totalRecA = resA.recognitionPerPeriod.reduce((s, v) => s + v, 0);
let cosReDeriveMax = 0;
for (let i = 0; i < 7; i++) {
  const expected = capexA * (resA.recognitionPerPeriod[i] / totalRecA);
  cosReDeriveMax = Math.max(cosReDeriveMax, Math.abs(cosA.perPeriod[i] - expected));
}
assertTrue('A6: CoS[i] = capex * rec[i] / totalRec re-derivation', cosReDeriveMax < 0.5,
  `max delta=${cosReDeriveMax.toFixed(4)}`);

assertTrue('A7: CoS axis length matches recognition', cosA.perPeriod.length === 7,
  `cos len=${cosA.perPeriod.length}`);

let gmMax = 0;
for (let i = 0; i < 7; i++) {
  const expected = resA.recognitionPerPeriod[i] - cosA.perPeriod[i];
  gmMax = Math.max(gmMax, Math.abs(cosA.grossMarginPerPeriod[i] - expected));
}
assertTrue('A8: gross margin = rec - CoS', gmMax < 0.5, `max delta=${gmMax.toFixed(4)}`);

// ───────────────────────────────────────────────────────────────
// Fixture B: Over-Time with matched cash profile, expect AR ~ 0
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture B: Over-Time recognition with matched cash profile ---');

const subUnitsB: SubUnitMaterial[] = [
  { id: 'su-B-1br', area: 47800, count: 478, ratePerArea: 33456, ratePerUnit: 33456 * 100, metric: 'units' },
];
const matchedProfile = { percentages: [0, 0.20, 0.30, 0.30, 0.15, 0.05, 0], profileMode: 'absolute_with_catchup' as const };
const configB: AssetSellConfig = {
  assetId: 'asset-B',
  subUnits: [{
    subUnitId: 'su-B-1br',
    preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
    postSalesVelocity: [0, 0, 0, 0, 0, 0, 0],
  }],
  cashPaymentProfile: matchedProfile,
  recognitionProfile: {
    method: 'over_time',
    percentages: matchedProfile.percentages,
    profileMode: 'absolute_with_catchup',
  },
  indexation: { method: 'none' },
};
const resB = computeSellAsset({ config: configB, subUnits: subUnitsB, axisLength: 7, handoverYear: 4 });
const arB = buildAccountsReceivable(resB.recognitionPerPeriod, resB.cashCollectedPerPeriod, 7);
const urB = buildUnearnedRevenue(resB.recognitionPerPeriod, resB.cashCollectedPerPeriod, 7);
let bMaxAR = 0, bMaxUR = 0;
for (let i = 0; i < 7; i++) {
  bMaxAR = Math.max(bMaxAR, arB.perPeriod[i]);
  bMaxUR = Math.max(bMaxUR, urB.perPeriod[i]);
}
assertTrue('B1: matched-profile AR ~ 0', bMaxAR < 1, `max AR=${bMaxAR.toFixed(2)}`);
assertTrue('B2: matched-profile Unearned ~ 0', bMaxUR < 1, `max Unearned=${bMaxUR.toFixed(2)}`);

// ───────────────────────────────────────────────────────────────
// Fixture C: zero capex
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture C: zero capex => zero CoS ---');
const cosZeroCapex = buildCostOfSales(resA.recognitionPerPeriod, 0, 7);
const cosZeroSum = cosZeroCapex.perPeriod.reduce((s, v) => s + v, 0);
assertTrue('C1: zero capex => zero CoS', cosZeroSum === 0, `sum=${cosZeroSum}`);

// ───────────────────────────────────────────────────────────────
// Fixture D: zero recognition
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture D: zero recognition => zero CoS ---');
const zeroRec = new Array<number>(7).fill(0);
const cosZeroRec = buildCostOfSales(zeroRec, 500_000_000, 7);
const cosZeroRecSum = cosZeroRec.perPeriod.reduce((s, v) => s + v, 0);
assertTrue('D1: zero recognition => zero CoS', cosZeroRecSum === 0, `sum=${cosZeroRecSum}`);

// Report
let pass = 0;
let fail = 0;
for (const c of checks) {
  const tag = c.ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${c.id}: ${c.detail}`);
  if (c.ok) pass++; else fail++;
}
console.log(`\n--- M2 Pass 7 verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) process.exitCode = 1;
