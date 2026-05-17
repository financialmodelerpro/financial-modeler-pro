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
// Pass 7j (2026-05-17): YoY rounding applied. Units per year =
// round(velocity * count). 478 units * (0.05, 0.30, 0.30, 0.25) =
// (23.9, 143.4, 143.4, 119.5) -> (24, 143, 143, 120) = 430 units total
// (vs 430.2 unrounded). Area = 430 * 100 = 43,000 sqm; revenue =
// 43,000 * 33,456 = 1,438,608,000 (vs 1,439,277,120 unrounded).
const totalSalesValueA = (24 + 143 + 143 + 120) * 100 * 33456;

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
// Pass 7j (2026-05-17): YoY rounding applied. Per-period units:
// 1BR (478): velocity (0.05, 0.30, 0.30, 0.25) -> rounded (24, 143, 143, 120) = 430
// 2BR (243): velocity (0.05, 0.30, 0.30, 0.25) -> rounded (12, 73, 73, 61) = 219
// areaPerUnit_2br = 36497.1 / 243 = 150.1939506
// Revenue = area * ratePerArea (engine derives area from rounded
// units * areaPerUnit, then revenue = area * rate).
const areaPerUnit1br = 47800 / 478;       // = 100
const areaPerUnit2br = 36497.1 / 243;     // = 150.1939506
const units1br = 24 + 143 + 143 + 120;    // = 430
const units2br = 12 + 73 + 73 + 61;       // = 219
const totSales1br = units1br * areaPerUnit1br * 33456;
const totSales2br = units2br * areaPerUnit2br * 33505;
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

// B7: units per period are integer-rounded (Pass 7e)
let intOk = true;
for (let i = 0; i < 7; i++) {
  const v = resultB.presalesUnitsPerPeriod[i];
  if (!Number.isInteger(v)) { intOk = false; break; }
}
assertTrue('B7: presales units per period are integer-rounded', intOk,
  intOk ? 'every unit count is an integer' : 'fractional unit count');

// B8: area sold totals = sum of rounded per-period sales. Pass 7j
// (2026-05-17): YoY rounding makes the area derive from rounded
// units * areaPerUnit instead of raw cap * totalArea, so the
// expected uses the rounded math.
const totalAreaSold = resultB.presalesAreaPerPeriod.reduce((s, v) => s + v, 0)
  + resultB.postSalesAreaPerPeriod.reduce((s, v) => s + v, 0);
const expectedSold = units1br * areaPerUnit1br + units2br * areaPerUnit2br;
assertNear('B8: sum of area sold = rounded units * areaPerUnit', totalAreaSold, expectedSold, 1, 0.01);

// ───────────────────────────────────────────────────────────────
// Fixture D: resolveSellConfig is per-asset only (Pass 7g)
// Project-wide template removed; resolver reads cash + recognition +
// indexation straight from the asset (with empty defaults when unset).
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture D: resolveSellConfig per-asset (Pass 7g) ---');

import { resolveSellConfig, DEFAULT_SELL_TEMPLATE } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';

// Synthetic project, no template. revenueTemplates is now @deprecated
// and ignored even when present, so we omit it entirely.
const perAssetProject = {
  startDate: '2025-01-01',
  currency: 'SAR',
};

const customAsset = {
  id: 'a-1',
  strategy: 'Sell',
  revenue: {
    sell: {
      assetId: 'a-1',
      subUnits: [{ subUnitId: 'su-1', preSalesVelocity: [], postSalesVelocity: [] }],
      cashPaymentProfile: { percentages: [0, 0.2, 0.3, 0.3, 0.15, 0.05, 0], profileMode: 'absolute_with_catchup' as const },
      recognitionProfile: { method: 'point_in_time' as const, pointInTimeYear: 'handover' as const },
      indexation: { method: 'yoy_compound' as const, rate: 0.03, startYear: 0 },
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customResolved = resolveSellConfig(customAsset as any, perAssetProject as any);
assertTrue('D1: asset cash profile resolves to asset values',
  customResolved?.cashPaymentProfile.percentages[1] === 0.2,
  `got ${customResolved?.cashPaymentProfile.percentages[1]}`);
assertTrue('D2: asset indexation rate resolves to asset value',
  customResolved?.indexation.rate === 0.03,
  `got rate ${customResolved?.indexation.rate}`);

// Asset without per-asset profile fields: resolver returns the empty
// defaults (no schedule, no indexation).
const bareAsset = {
  id: 'a-bare',
  strategy: 'Sell',
  revenue: {
    sell: {
      assetId: 'a-bare',
      subUnits: [{ subUnitId: 'su-1', preSalesVelocity: [], postSalesVelocity: [] }],
    },
  },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bareResolved = resolveSellConfig(bareAsset as any, perAssetProject as any);
assertTrue('D3: bare asset cash profile is empty default',
  (bareResolved?.cashPaymentProfile.percentages.length ?? -1) === 0,
  `got len ${bareResolved?.cashPaymentProfile.percentages.length}`);

// D4: legacy revenueTemplates on the project is IGNORED by the resolver
// (deprecated). Even when present, the asset still wins.
const legacyTemplateProject = {
  ...perAssetProject,
  revenueTemplates: {
    sell: {
      cashPaymentProfile: { percentages: [1, 0, 0, 0, 0, 0, 0], profileMode: 'absolute_with_catchup' as const },
      recognitionProfile: { method: 'point_in_time' as const, pointInTimeYear: 'handover' as const },
      indexation: { method: 'yoy_compound' as const, rate: 0.10, startYear: 0 },
    },
  },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ignoredTplResolved = resolveSellConfig(bareAsset as any, legacyTemplateProject as any);
assertTrue('D4: legacy project template is ignored by per-asset resolver',
  (ignoredTplResolved?.cashPaymentProfile.percentages.length ?? -1) === 0
    && ignoredTplResolved?.indexation.method === 'none',
  `got len=${ignoredTplResolved?.cashPaymentProfile.percentages.length} idx=${ignoredTplResolved?.indexation.method}`);

// D5: DEFAULT_SELL_TEMPLATE exported (used by Output tab as fallback)
assertTrue('D5: DEFAULT_SELL_TEMPLATE has empty cash percentages',
  DEFAULT_SELL_TEMPLATE.cashPaymentProfile.percentages.length === 0,
  `len=${DEFAULT_SELL_TEMPLATE.cashPaymentProfile.percentages.length}`);

// ───────────────────────────────────────────────────────────────
// Fixture E: AR + Unearned per-cohort via vintage matrices
// (Pass 7m). Aggregate roll-forward floored (Pass 7k) lost early
// recognition deficits to the per-period floor and stuck the closing
// balance. Per-cohort fixes that: AR_s + UR_s computed per cohort,
// then summed.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture E: AR + Unearned per-cohort (Pass 7m) ---');

import { buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';

// Reuse Fixture B (real cohort matrices) for the per-cohort path.
// Recognition profile and cash profile both sum to 100% per cohort,
// so by end of the matrix every cohort settles: UR closes at 0, AR
// closes at 0. Mid-stream AR > 0 because Over-Time recognition is
// staggered vs the cash payment milestone schedule.

const arB = buildAccountsReceivable(
  resultB.recognitionPerPeriod,
  resultB.cashCollectedPerPeriod,
  resultB.axisLength,
  resultB.recognitionVintageMatrix,
  resultB.cashVintageMatrix,
);
const urB = buildUnearnedRevenue(
  resultB.recognitionPerPeriod,
  resultB.cashCollectedPerPeriod,
  resultB.axisLength,
  resultB.recognitionVintageMatrix,
  resultB.cashVintageMatrix,
);

assertTrue('E1: AR Opening[0] = 0',
  arB.openingPerPeriod[0] === 0,
  `got ${arB.openingPerPeriod[0]}`);
assertTrue('E2: AR Closing[i] = Opening[i+1] across full axis',
  arB.openingPerPeriod.slice(1).every((o, i) => Math.abs(o - arB.perPeriod[i]) < 1e-6),
  `opening=${JSON.stringify(arB.openingPerPeriod)} closing=${JSON.stringify(arB.perPeriod)}`);
assertTrue('E3: AR change = Closing - Opening',
  arB.changePerPeriod.every((d, i) => Math.abs(d - (arB.perPeriod[i] - arB.openingPerPeriod[i])) < 1e-6),
  `change=${JSON.stringify(arB.changePerPeriod)}`);
// Per-cohort: by the final period both Rec and Cash totals equal the
// cohort sale value, so each cohort settles. Final closing AR + UR
// must both be 0 (no stuck balance).
assertNear('E4: AR settles to 0 by end of recognition',
  arB.perPeriod[arB.perPeriod.length - 1], 0, 1, 0.01);
assertNear('E5: Unearned settles to 0 by end of recognition',
  urB.perPeriod[urB.perPeriod.length - 1], 0, 1, 0.01);
assertTrue('E6: Unearned Opening[0] = 0',
  urB.openingPerPeriod[0] === 0,
  `got ${urB.openingPerPeriod[0]}`);
assertTrue('E7: Unearned change = Closing - Opening',
  urB.changePerPeriod.every((d, i) => Math.abs(d - (urB.perPeriod[i] - urB.openingPerPeriod[i])) < 1e-6),
  `change=${JSON.stringify(urB.changePerPeriod)}`);

// Regression: a hand-traced 2-cohort fixture where one cohort has
// rec-ahead-of-cash and another has cash-ahead-of-rec at the same
// period. Aggregate netting would zero them out; per-cohort sums
// keep both gross positions visible.
const recMat = [
  [0, 100, 0, 0],   // cohort 0: rec all in period 1
  [0,   0, 0, 100], // cohort 1: rec all in period 3
];
const cashMat = [
  [0,  50, 50, 0], // cohort 0: cash split 50/50 across p1, p2
  [0, 100,  0, 0], // cohort 1: cash all in period 1
];
const recPP = [0, 100, 0, 100];
const cashPP = [0, 150, 50, 0];
const arSym = buildAccountsReceivable(recPP, cashPP, 4, recMat, cashMat);
const urSym = buildUnearnedRevenue(recPP, cashPP, 4, recMat, cashMat);
// At period 1:
//   cohort 0 cum: rec=100, cash=50 -> AR=50, UR=0
//   cohort 1 cum: rec=0,   cash=100 -> AR=0,  UR=100
//   aggregate AR=50, UR=100. Cumulative netting would have given 0/50.
// Pass 7m: AR is per-cohort (gross positions visible).
// Pass 7n: UR is signed roll-forward (aggregate netted, NOT per-cohort).
// In a mixed 2-cohort fixture the two diverge:
//   Per-cohort AR period 1 = cohort_0_AR (50) + cohort_1_AR (0) = 50
//   Signed UR period 1     = cumCash (150) - cumRec (100)        = 50
assertTrue('E8: AR (per-cohort) sees cohort_0 receivable',
  arSym.perPeriod[1] === 50,
  `got AR ${JSON.stringify(arSym.perPeriod)}`);
assertTrue('E9: UR (signed roll-forward) = cumCash - cumRec at period 1',
  urSym.perPeriod[1] === 50,
  `got UR ${JSON.stringify(urSym.perPeriod)}`);
// Period 2: cumCash=200, cumRec=100. Signed UR = 100. AR per-cohort = 0
// (cohort_0 fully cashed, cohort_1 still no rec yet).
assertTrue('E9b: UR (signed) at period 2 = 100',
  urSym.perPeriod[2] === 100,
  `got UR ${JSON.stringify(urSym.perPeriod)}`);
// By final period: cohort 0 fully settled (cum rec = cum cash = 100),
// cohort 1 fully settled (cum rec = cum cash = 100). Both at 0.
assertNear('E10: 2-cohort final AR = 0',
  arSym.perPeriod[3], 0, 0.01);
assertNear('E11: 2-cohort final UR = 0',
  urSym.perPeriod[3], 0, 0.01);

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
