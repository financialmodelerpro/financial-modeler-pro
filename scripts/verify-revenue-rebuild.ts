/**
 * M2 Pass 2 verifier - Phase 1 Residential Sell engine baseline.
 *
 * Two fixtures:
 *   A. Synthetic single-sub-unit, Point-in-Time recognition, no escrow,
 *      no indexation. Sanity tests for cash + recognition + reconcile.
 *   B. MAAD T2 (Branded Apartments Tower 2 from
 *      'Maad_Residential_Cashflow v1.16 05132026 all Tabs.xlsx'),
 *      verified against Excel rows 39 (sales value), 51 (cash), 186
 *      (recognition over-time), 18 + 24 (Wafi held + release).
 */

import {
  computeSellAsset,
  reconcileSellAsset,
  type AssetSellConfig,
  type SubUnitMaterial,
} from '@/src/core/calculations/revenue';

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

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
  escrow: { enabled: false, heldPct: 0, releaseYear: -1 },
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

// A3: cumulative cash trace per year. Using catchup mechanic with profile
//     pct = [0, 0.20, 0.30, 0.30, 0.15, 0.05, 0] and per-year sale values:
//   Y1: 0
//   Y2: 0.05 * 1,599,196,800 = 79,959,840
//   Y3: 0.30 * 1,599,196,800 = 479,759,040
//   Y4: 0.30 * 1,599,196,800 = 479,759,040
//   Y5: 0.25 * 1,599,196,800 = 399,799,200
// Cash trace under absolute-year + catchup:
//   Y2 cash: cohort-Y2 catchup at Y2 = (0 + 0.20) * 79,959,840 = 15,991,968
//   Y3 cash: cohort-Y2 Y3 = 0.30 * 79,959,840 = 23,987,952
//          + cohort-Y3 catchup at Y3 = (0 + 0.20 + 0.30) * 479,759,040 = 239,879,520
//          total = 263,867,472
//   Y4 cash: cohort-Y2 Y4 = 0.30 * 79,959,840 = 23,987,952
//          + cohort-Y3 Y4 = 0.30 * 479,759,040 = 143,927,712
//          + cohort-Y4 catchup at Y4 = (0+0.20+0.30+0.30) * 479,759,040 = 383,807,232
//          total = 551,722,896
//   Y5 cash: cohort-Y2 Y5 = 0.15 * 79,959,840 = 11,993,976
//          + cohort-Y3 Y5 = 0.15 * 479,759,040 = 71,963,856
//          + cohort-Y4 Y5 = 0.15 * 479,759,040 = 71,963,856
//          + cohort-Y5 catchup at Y5 = (0+0.20+0.30+0.30+0.15) * 399,799,200 = 379,809,240
//          total = 535,730,928
//   Y6 cash: 0.05 * (79,959,840 + 479,759,040 + 479,759,040 + 399,799,200)
//          = 0.05 * 1,439,277,120 = 71,963,856
//   Y7 cash: 0
const expectedCashA = [
  0,
  15991968,
  263867472,
  551722896,
  535730928,
  71963856,
  0,
];
for (let i = 0; i < 7; i++) {
  assertNear(`A3.${i}: cash[Y${i + 1}]`, resultA.cashCollectedPerPeriod[i], expectedCashA[i], 1, 0.01);
}

// A4: recognition is single lump at handover year (Y5, index 4)
const expectedHandoverRecA = totalSalesValueA;
assertNear('A4: recognition lump at handover', resultA.recognitionPerPeriod[4], expectedHandoverRecA, 1, 0.01);
const nonHandoverRecA = resultA.recognitionPerPeriod.reduce((s, v, i) => i === 4 ? s : s + v, 0);
assertTrue('A4b: recognition zero outside handover', nonHandoverRecA < 1, `nonHandover=${nonHandoverRecA}`);

// A5: (informational) cash and recognition cumulative trace - note that
// for Point-in-Time recognition with deferred milestones cash trails
// recognition between handover and final milestone (MAAD pattern). The
// universal identity is sum(cash) === sum(recognition) at axis end,
// already verified by A2 + reconcileSellAsset.
let cumCashA = 0;
let cumRecA = 0;
for (let i = 0; i < 7; i++) {
  cumCashA += resultA.cashCollectedPerPeriod[i];
  cumRecA += resultA.recognitionPerPeriod[i];
}
assertNear('A5: cumulative cash == cumulative recognition at axis end', cumCashA, cumRecA, 1, 0.01);

// A6: reconcile.ok === true
const recA = reconcileSellAsset(resultA, fixtureAConfig);
assertTrue('A6: reconcile.ok', recA.ok, recA.identities.filter(x => !x.ok).map(x => `${x.id}: ${x.message}`).join(' | ') || 'all passed');

// ───────────────────────────────────────────────────────────────
// Fixture B: MAAD T2 (Branded Apartments Tower 2)
// ───────────────────────────────────────────────────────────────
console.log('\n--- Fixture B: MAAD T2 reconciliation ---');

// SAR'000 in MAAD; we keep raw SAR here so 47,800 sqm × 33,456 SAR/sqm =
// 1,599,196,800 SAR, divide by 1000 at the end for comparison against
// MAAD's row totals.
const fixtureBSubUnits: SubUnitMaterial[] = [
  { id: 'su-B-1br', area: 47800,   count: 478,  ratePerArea: 33456.066945, ratePerUnit: 33456 * 100, metric: 'units' },
  { id: 'su-B-2br', area: 36497.1, count: 228,  ratePerArea: 33505.248362, ratePerUnit: 33505 * 160, metric: 'units' },
];

const fixtureBConfig: AssetSellConfig = {
  assetId: 'asset-B',
  subUnits: [
    { subUnitId: 'su-B-1br',
      preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
      postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0] },
    { subUnitId: 'su-B-2br',
      preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0],
      postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0] },
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
  escrow: { enabled: true, heldPct: 0.04, releaseYear: 5 },
  indexation: { method: 'none' },
};

const resultB = computeSellAsset({
  config: fixtureBConfig,
  subUnits: fixtureBSubUnits,
  axisLength: 7,
  handoverYear: 4,
});

// MAAD row 39 total Pre-Sales Revenue (SAR'000) = 2,539,827
const presalesTotalB = resultB.presalesRevenuePerPeriod.reduce((s, v) => s + v, 0);
assertNear('B1: pre-sales total (SAR000)', presalesTotalB / 1000, 2539827, 100, 0.1);

// MAAD row 39 per period (SAR'000): -, 141,107, 846,609, 846,609, 705,502
const expectedPresalesByYearK = [0, 141107, 846609, 846609, 705502, 0, 0];
for (let i = 0; i < 7; i++) {
  assertNear(`B1.${i}: pre-sales revenue Y${i + 1} (SAR000)`, resultB.presalesRevenuePerPeriod[i] / 1000, expectedPresalesByYearK[i], 100, 0.1);
}

// MAAD row 51 total cash collected per period (SAR'000):
//   -, 28,221, 465,637, 973,602, 945,376, 126,991, -
// But MAAD has pre-sales cash ONLY in row 51 (does not include post-sales,
// which are in rows 156-162 as Sales During Operation). Our engine sums
// post-sales into cashCollectedPerPeriod; for the MAAD comparison we
// strip the post-sales contribution which is point-in-time at Y6.
const expectedCashByYearK = [0, 28221, 465637, 973602, 945376, 126991, 0];
for (let i = 0; i < 7; i++) {
  const preCashOnly = (resultB.cashCollectedPerPeriod[i] - resultB.postSalesRevenuePerPeriod[i]) / 1000;
  assertNear(`B2.${i}: pre-sales cash Y${i + 1} (SAR000)`, preCashOnly, expectedCashByYearK[i], 100, 0.1);
}

// MAAD row 186 total recognition per period for T2 (SAR'000):
//   -, 42,332, 550,298, 1,058,263, 888,934, -, -
// Same exclusion: strip post-sales (lumps at Y6) for the over-time-only
// recognition comparison.
const expectedRecognitionByYearK = [0, 42332, 550298, 1058263, 888934, 0, 0];
for (let i = 0; i < 7; i++) {
  const preRecOnly = (resultB.recognitionPerPeriod[i] - resultB.postSalesRevenuePerPeriod[i]) / 1000;
  assertNear(`B3.${i}: pre-sales recognition Y${i + 1} (SAR000)`, preRecOnly, expectedRecognitionByYearK[i], 100, 0.1);
}

// MAAD Wafi Escrow row 18 (T2 & T3 held SAR'000) but our fixture is T2
// only. Per row 18 in MAAD T2 contribution can be backed out as 4% x
// row 11 (T2 & T3 collected per period). Here we just verify the
// invariant: held[i] = 4% x preCash[i]
for (let i = 0; i < 7; i++) {
  const preCash = resultB.cashCollectedPerPeriod[i] - resultB.postSalesRevenuePerPeriod[i];
  const expectedHeld = preCash * 0.04;
  assertNear(`B4.${i}: Wafi held Y${i + 1}`, resultB.escrowHeldPerPeriod[i], expectedHeld, 1, 0.01);
}

// MAAD row 24: T2 & T3 release at Y6 = 101,593 SAR'000 (full release at
// release year). Our fixture is T2 only; the release should equal the
// cumulative held over the full axis. Verify the equality.
const sumHeldB = resultB.escrowHeldPerPeriod.reduce((s, v) => s + v, 0);
assertNear('B5: release at Y6 = cumulative held', resultB.escrowReleasedPerPeriod[5], sumHeldB, 1, 0.01);
const sumReleasedB = resultB.escrowReleasedPerPeriod.reduce((s, v) => s + v, 0);
assertNear('B5b: sum released == sum held', sumReleasedB, sumHeldB, 1, 0.01);

// B6: net cash available = cash - held + released per period
let netOkB = true;
for (let i = 0; i < 7; i++) {
  const expected = resultB.cashCollectedPerPeriod[i] - resultB.escrowHeldPerPeriod[i] + resultB.escrowReleasedPerPeriod[i];
  if (!near(expected, resultB.netCashAvailablePerPeriod[i], 1)) netOkB = false;
}
assertTrue('B6: net cash identity per period', netOkB, netOkB ? 'all periods' : 'broken at some period');

// B7: reconcile.ok
const recB = reconcileSellAsset(resultB, fixtureBConfig);
assertTrue('B7: reconcile.ok', recB.ok, recB.identities.filter(x => !x.ok).map(x => `${x.id}: ${x.message}`).join(' | ') || 'all passed');

// ───────────────────────────────────────────────────────────────
// Fixture C: 2-cohort split of Fixture B (must sum to same totals)
// ───────────────────────────────────────────────────────────────
console.log('\n--- Fixture C: 2-cohort split must equal Fixture B totals ---');

// Split Fixture B's velocity 50/50 between two cohorts. Total per-sub-unit
// velocity stays identical, so the cohort-summed output MUST equal the
// single-cohort Fixture B output cell-for-cell.
const splitVel = (v: number): number => v * 0.5;
const fixtureCConfig: AssetSellConfig = {
  ...fixtureBConfig,
  cohorts: [
    {
      id: 'cohort-1',
      name: 'Launch Phase 1',
      subUnits: [
        { subUnitId: 'su-B-1br',
          preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0].map(splitVel),
          postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0].map(splitVel) },
        { subUnitId: 'su-B-2br',
          preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0].map(splitVel),
          postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0].map(splitVel) },
      ],
    },
    {
      id: 'cohort-2',
      name: 'Launch Phase 2',
      subUnits: [
        { subUnitId: 'su-B-1br',
          preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0].map(splitVel),
          postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0].map(splitVel) },
        { subUnitId: 'su-B-2br',
          preSalesVelocity: [0, 0.05, 0.30, 0.30, 0.25, 0, 0].map(splitVel),
          postSalesVelocity: [0, 0, 0, 0, 0, 0.10, 0].map(splitVel) },
      ],
    },
  ],
};

const resultC = computeSellAsset({
  config: fixtureCConfig,
  subUnits: fixtureBSubUnits,
  axisLength: 7,
  handoverYear: 4,
});

for (let i = 0; i < 7; i++) {
  assertNear(`C1.${i}: pre-sales revenue Y${i + 1} matches B`, resultC.presalesRevenuePerPeriod[i], resultB.presalesRevenuePerPeriod[i], 1, 0.0001);
  assertNear(`C2.${i}: cash Y${i + 1} matches B`, resultC.cashCollectedPerPeriod[i], resultB.cashCollectedPerPeriod[i], 1, 0.0001);
  assertNear(`C3.${i}: recognition Y${i + 1} matches B`, resultC.recognitionPerPeriod[i], resultB.recognitionPerPeriod[i], 1, 0.0001);
  assertNear(`C4.${i}: escrow held Y${i + 1} matches B`, resultC.escrowHeldPerPeriod[i], resultB.escrowHeldPerPeriod[i], 1, 0.0001);
}

const recC = reconcileSellAsset(resultC, fixtureCConfig);
assertTrue('C5: reconcile.ok (multi-cohort)', recC.ok, recC.identities.filter((x) => !x.ok).map(x => `${x.id}: ${x.message}`).join(' | ') || 'all passed');

// Fixture C2: velocity overflow across cohorts should trip the reconcile
// velocity-sum-bound identity (two cohorts each with full 100% velocity
// = 200% per sub-unit, which is impossible).
const fixtureC2Config: AssetSellConfig = {
  ...fixtureBConfig,
  cohorts: [
    { id: 'overflow-A', name: 'Overflow A',
      subUnits: [
        { subUnitId: 'su-B-1br', preSalesVelocity: [0, 0.50, 0.50, 0, 0, 0, 0], postSalesVelocity: [0,0,0,0,0,0,0] },
        { subUnitId: 'su-B-2br', preSalesVelocity: [0, 0.50, 0.50, 0, 0, 0, 0], postSalesVelocity: [0,0,0,0,0,0,0] },
      ] },
    { id: 'overflow-B', name: 'Overflow B',
      subUnits: [
        { subUnitId: 'su-B-1br', preSalesVelocity: [0, 0.50, 0.50, 0, 0, 0, 0], postSalesVelocity: [0,0,0,0,0,0,0] },
        { subUnitId: 'su-B-2br', preSalesVelocity: [0, 0.50, 0.50, 0, 0, 0, 0], postSalesVelocity: [0,0,0,0,0,0,0] },
      ] },
  ],
};
const resultC2 = computeSellAsset({
  config: fixtureC2Config,
  subUnits: fixtureBSubUnits,
  axisLength: 7,
  handoverYear: 4,
});
const recC2 = reconcileSellAsset(resultC2, fixtureC2Config);
const overflowIdentity = recC2.identities.find((x) => x.id === 'velocity-sum-bound');
assertTrue('C6: cross-cohort velocity overflow flagged by reconciler', !!overflowIdentity && !overflowIdentity.ok, overflowIdentity?.message ?? 'identity missing');

// ───────────────────────────────────────────────────────────────
// Summary
// ───────────────────────────────────────────────────────────────
const passed = checks.filter((c) => c.ok).length;
const failed = checks.length - passed;
console.log(`\n${passed} pass / ${failed} fail / ${checks.length} total`);
console.log('---');
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}`);
}
if (failed > 0) {
  process.exit(1);
}
