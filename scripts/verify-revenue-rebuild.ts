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
// Pass 7z (2026-05-18): pin the handover convention. resolveHandoverYear
// must return the LAST construction year (= phaseStart + cp - 1 -
// projectStart), NOT the first operations year. Mirrors the user's
// scenario: Construction 2026-2029 (cp=4), Operations 2030+. Pre-sales
// recognition under PIT-at-handover must lump at 2029 (idx 3), and
// post-sales (sales during operation in 2030 = idx 4) must recognise
// in 2030.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture A2: handover convention (PIT lumps at LAST construction year) ---');

import { resolveHandoverYear } from '@/src/core/calculations/revenue';

const handoverIdx = resolveHandoverYear(14, 2026, 4, 2026);
assertTrue('A2-1: resolveHandoverYear returns LAST construction year (cp - 1)',
  handoverIdx === 3,
  `expected 3 (= 2029 index), got ${handoverIdx}`);

const fixtureA2SubUnits: SubUnitMaterial[] = [
  { id: 'su-A2-1br', area: 47800, count: 478, ratePerArea: 33456, ratePerUnit: 33456 * 100, metric: 'units' },
];
const fixtureA2Config: AssetSellConfig = {
  assetId: 'asset-A2',
  subUnits: [
    { subUnitId: 'su-A2-1br',
      // 2026 (idx 0): 5%, 2027: 30%, 2028: 30%, 2029: 25% (= 90% pre)
      preSalesVelocity: [0.05, 0.30, 0.30, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      // 2030 (idx 4): 10% (SDO, same-period recognition)
      postSalesVelocity:[0,    0,    0,    0,    0.10, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ],
  cashPaymentProfile: { percentages: [0.05, 0.30, 0.30, 0.25, 0.10, 0, 0, 0, 0, 0, 0, 0, 0, 0], profileMode: 'absolute_with_catchup' },
  recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
  indexation: { method: 'none' },
};
const resultA2 = computeSellAsset({
  config: fixtureA2Config,
  subUnits: fixtureA2SubUnits,
  axisLength: 14,
  handoverYear: handoverIdx,
});

const preTotalA2 = resultA2.presalesRevenuePerPeriod.reduce((s, v) => s + v, 0);
const postTotalA2 = resultA2.postSalesRevenuePerPeriod.reduce((s, v) => s + v, 0);

assertNear('A2-2: pre-sales recognition lumps at idx 3 (2029)',
  resultA2.recognitionPerPeriod[3], preTotalA2, 1, 0.01);
assertNear('A2-3: post-sales (SDO) recognises at idx 4 (2030), same period as sale',
  resultA2.recognitionPerPeriod[4], postTotalA2, 1, 0.01);
assertTrue('A2-4: no recognition spillover into 2030 from pre-sales (idx 4 has only SDO)',
  Math.abs(resultA2.presalesRecognitionPerPeriod[4]) < 0.5,
  `presalesRecognition[2030] should be 0, got ${resultA2.presalesRecognitionPerPeriod[4]}`);
assertTrue('A2-5: no pre-sales recognition leakage into other years',
  resultA2.presalesRecognitionPerPeriod.every((v, i) => i === 3 ? v > 0 : v < 0.5),
  `expected all 0 except idx 3, got ${JSON.stringify(resultA2.presalesRecognitionPerPeriod)}`);

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
// Fixture E: AR + Unearned sale-value driven (Pass 7q)
// Sale value drives the credit on both schedules; cash drains
// AR; recognition drains UR. Both settle to 0 by end of cohort
// lifecycle.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture E: AR + Unearned sale-value driven (Pass 7q) ---');

import { buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';

const arB = buildAccountsReceivable(
  resultB.presalesRevenuePerPeriod,
  resultB.presalesCashPerPeriod,
  resultB.axisLength,
);
const urB = buildUnearnedRevenue(
  resultB.presalesRecognitionPerPeriod,
  resultB.presalesRevenuePerPeriod,
  resultB.axisLength,
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
assertNear('E4: AR settles to 0 by end of cash collection',
  arB.perPeriod[arB.perPeriod.length - 1], 0, 1, 0.01);
assertNear('E5: Unearned settles to 0 by end of recognition',
  urB.perPeriod[urB.perPeriod.length - 1], 0, 1, 0.01);
assertTrue('E6: Unearned Opening[0] = 0',
  urB.openingPerPeriod[0] === 0,
  `got ${urB.openingPerPeriod[0]}`);
assertTrue('E7: Unearned change = Closing - Opening',
  urB.changePerPeriod.every((d, i) => Math.abs(d - (urB.perPeriod[i] - urB.openingPerPeriod[i])) < 1e-6),
  `change=${JSON.stringify(urB.changePerPeriod)}`);

// Pass 7q removed the old per-cohort cash-vs-rec hand-traced
// fixture (E8-E11). The sale-value formula no longer accepts
// (recognition, cash) as positional args; Fixture F covers the
// new semantics.

// ───────────────────────────────────────────────────────────────
// Fixture F: AR + Unearned sale-value driven (Pass 7q)
// Sale value drives the credit on BOTH schedules. AR drains via
// cash; UR drains via recognition. Both settle to 0 by end.
// ───────────────────────────────────────────────────────────────
console.log('--- Fixture F: AR + Unearned sale-value driven (Pass 7q) ---');

// Hand-traced 2-cohort fixture.
//   Cohort A sold year 0, value 100. Cash collected [0, 50, 50, 0].
//   Cohort B sold year 1, value 200. Cash collected [0, 0, 100, 100].
//   Aggregate sale value per year: [100, 200, 0, 0].
//   Aggregate cash per year:        [0,  50, 150, 100].
// AR closing per period:
//   y0: 0   + 100 - 0   = 100
//   y1: 100 + 200 - 50  = 250
//   y2: 250 + 0   - 150 = 100
//   y3: 100 + 0   - 100 = 0
const saleAgg = [100, 200, 0, 0];
const cashAgg = [0, 50, 150, 100];
const arSV = buildAccountsReceivable(saleAgg, cashAgg, 4);
assertTrue('F1: sale-value AR series matches hand trace',
  JSON.stringify(arSV.perPeriod) === JSON.stringify([100, 250, 100, 0]),
  `got ${JSON.stringify(arSV.perPeriod)}`);
assertNear('F2: sale-value AR final = 0', arSV.perPeriod[3], 0, 0.01);

// UR closing per period using PIT recognition at year 3 (lumps 300):
//   recognition per year: [0, 0, 0, 300]
//   y0: 0   + 100 - 0   = 100
//   y1: 100 + 200 - 0   = 300
//   y2: 300 + 0   - 0   = 300
//   y3: 300 + 0   - 300 = 0
const recPIT_SV = [0, 0, 0, 300];
const urSV = buildUnearnedRevenue(recPIT_SV, saleAgg, 4);
assertTrue('F3: sale-value UR series matches hand trace (PIT)',
  JSON.stringify(urSV.perPeriod) === JSON.stringify([100, 300, 300, 0]),
  `got ${JSON.stringify(urSV.perPeriod)}`);
assertNear('F4: sale-value UR final = 0', urSV.perPeriod[3], 0, 0.01);

// Symmetry: when cash profile == recognition profile, AR == UR.
const matched = [0, 50, 150, 100];
const arMatched = buildAccountsReceivable(saleAgg, matched, 4);
const urMatched = buildUnearnedRevenue(matched, saleAgg, 4);
assertTrue('F5: AR == UR when cash profile == recognition profile',
  JSON.stringify(arMatched.perPeriod) === JSON.stringify(urMatched.perPeriod),
  `AR=${JSON.stringify(arMatched.perPeriod)} UR=${JSON.stringify(urMatched.perPeriod)}`);

// Fixture B (real engine output) under Pass 7q:
//   AR  = presalesRevenuePerPeriod (sale) - presalesCashPerPeriod
//   UR  = presalesRevenuePerPeriod (sale) - presalesRecognitionPerPeriod
const arBsv = buildAccountsReceivable(
  resultB.presalesRevenuePerPeriod,
  resultB.presalesCashPerPeriod,
  resultB.axisLength,
);
const urBsv = buildUnearnedRevenue(
  resultB.presalesRecognitionPerPeriod,
  resultB.presalesRevenuePerPeriod,
  resultB.axisLength,
);
assertNear('F6: fixture B sale-value AR settles to 0',
  arBsv.perPeriod[arBsv.perPeriod.length - 1], 0, 1, 0.01);
assertNear('F7: fixture B sale-value UR settles to 0',
  urBsv.perPeriod[urBsv.perPeriod.length - 1], 0, 1, 0.01);

// ───────────────────────────────────────────────────────────────
// Fixture H (Pass 8a): Hospitality engine.
// 200 keys, ADR 500, occupancy ramp, F&B + Other across modes,
// ops window 4..13 (years 5-14 of a 14-year project axis).
// ───────────────────────────────────────────────────────────────
import { computeHospitalityAsset, type HospitalityConfig } from '@/src/core/calculations/revenue';

console.log('--- Fixture H: Hospitality engine baseline (Pass 8a) ---');

// H1: rooms math + percent_of_rooms F&B + percent Other.
// Year 5 (idx 4): occ 70%, no indexation.
const fixtureH1: HospitalityConfig = {
  assetId: 'asset-H1',
  subUnits: [],
  keys: 200,
  daysPerYear: 365,
  startingADR: 500,
  adrIndexation: { method: 'none' },
  occupancyPerPeriod: [0, 0, 0, 0, 0.70, 0.70, 0.70, 0.70, 0.70, 0.70, 0.70, 0.70, 0.70, 0.70],
  guestsPerOccupiedRoom: 1.5,
  fb:    { mode: 'percent_of_rooms', percentOfRooms: 0.25 },
  otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0.10 },
  opsStartIdx: 4,
  opsEndIdx: 13,
};
const resH1 = computeHospitalityAsset({ config: fixtureH1, axisLength: 14 });

const ARN_y5 = 200 * 365;            // 73,000
const ORN_y5 = ARN_y5 * 0.70;        // 51,100
const ROOMS_y5 = ORN_y5 * 500;       // 25,550,000
const FB_y5 = ROOMS_y5 * 0.25;       // 6,387,500
const OTHER_y5 = ROOMS_y5 * 0.10;    // 2,555,000
const TOTAL_y5 = ROOMS_y5 + FB_y5 + OTHER_y5;  // 34,492,500

assertNear('H1-1: ARN year 5 = keys × 365', resH1.availableRoomNightsPerPeriod[4], ARN_y5, 0.5);
assertNear('H1-2: ORN year 5 = ARN × occ', resH1.occupiedRoomNightsPerPeriod[4], ORN_y5, 0.5);
assertNear('H1-3: Rooms revenue year 5 = ORN × ADR', resH1.roomsRevenuePerPeriod[4], ROOMS_y5, 1, 0.01);
assertNear('H1-4: F&B (percent_of_rooms 25%) year 5', resH1.fbRevenuePerPeriod[4], FB_y5, 1, 0.01);
assertNear('H1-5: Other (percent_of_rooms 10%) year 5', resH1.otherRevenuePerPeriod[4], OTHER_y5, 1, 0.01);
assertNear('H1-6: Total revenue year 5', resH1.totalRevenuePerPeriod[4], TOTAL_y5, 1, 0.01);
assertTrue('H1-7: pre-ops (idx 0..3) revenue is 0',
  resH1.totalRevenuePerPeriod.slice(0, 4).every((v) => v === 0),
  `got ${JSON.stringify(resH1.totalRevenuePerPeriod.slice(0, 4))}`);

// H2: per_guest F&B mode. 1.5 guests/ORN × SAR 200/guest.
const fixtureH2: HospitalityConfig = {
  ...fixtureH1,
  assetId: 'asset-H2',
  fb:    { mode: 'per_guest', ratePerGuest: 200 },
  otherRevenue: { mode: 'per_guest', ratePerGuest: 50 },
};
const resH2 = computeHospitalityAsset({ config: fixtureH2, axisLength: 14 });
const GUESTS_y5 = ORN_y5 * 1.5;       // 76,650
const FB_pg_y5 = GUESTS_y5 * 200;     // 15,330,000
const OTHER_pg_y5 = GUESTS_y5 * 50;   // 3,832,500
assertNear('H2-1: Guests year 5 = ORN × guestsPerOR', resH2.guestsPerPeriod[4], GUESTS_y5, 0.5);
assertNear('H2-2: F&B (per_guest 200/guest) year 5', resH2.fbRevenuePerPeriod[4], FB_pg_y5, 1, 0.01);
assertNear('H2-3: Other (per_guest 50/guest) year 5', resH2.otherRevenuePerPeriod[4], OTHER_pg_y5, 1, 0.01);

// H3: ADR YoY indexation 3% from operations start (idx 4).
const fixtureH3: HospitalityConfig = {
  ...fixtureH1,
  assetId: 'asset-H3',
  adrIndexation: { method: 'yoy_compound', rate: 0.03, startYear: 4 },
};
const resH3 = computeHospitalityAsset({ config: fixtureH3, axisLength: 14 });
assertNear('H3-1: ADR year 5 = base (start year)', resH3.adrPerPeriod[4], 500, 0.01);
assertNear('H3-2: ADR year 6 = base × 1.03', resH3.adrPerPeriod[5], 500 * 1.03, 0.01);
assertNear('H3-3: ADR year 7 = base × 1.03^2', resH3.adrPerPeriod[6], 500 * 1.03 * 1.03, 0.01);

// H4: occupancy ramp (40 / 60 / 70 / 75 / 75...) + clamping >1.
const fixtureH4: HospitalityConfig = {
  ...fixtureH1,
  assetId: 'asset-H4',
  occupancyPerPeriod: [0, 0, 0, 0, 0.40, 0.60, 0.70, 0.75, 1.20, 0.75, 0.75, 0.75, 0.75, 0.75],
};
const resH4 = computeHospitalityAsset({ config: fixtureH4, axisLength: 14 });
assertNear('H4-1: Occupancy year 5 = 40%', resH4.occupancyPerPeriod[4], 0.40, 0.001);
assertNear('H4-2: Occupancy year 9 clamped to 100%', resH4.occupancyPerPeriod[8], 1.00, 0.001);
assertNear('H4-3: ORN year 5 = ARN × 0.40', resH4.occupiedRoomNightsPerPeriod[4], 200 * 365 * 0.40, 0.5);

// H5: ops window. Years before opsStartIdx and after opsEndIdx are 0.
const fixtureH5: HospitalityConfig = {
  ...fixtureH1,
  assetId: 'asset-H5',
  opsStartIdx: 4,
  opsEndIdx: 8, // shorter window: years 5..9
  occupancyPerPeriod: new Array<number>(14).fill(0.70), // would otherwise fire every year
};
const resH5 = computeHospitalityAsset({ config: fixtureH5, axisLength: 14 });
assertTrue('H5-1: Pre-ops (idx 0..3) revenue is 0',
  resH5.totalRevenuePerPeriod.slice(0, 4).every((v) => v === 0),
  `pre-ops got ${JSON.stringify(resH5.totalRevenuePerPeriod.slice(0, 4))}`);
assertTrue('H5-2: Post-ops (idx 9..13) revenue is 0',
  resH5.totalRevenuePerPeriod.slice(9).every((v) => v === 0),
  `post-ops got ${JSON.stringify(resH5.totalRevenuePerPeriod.slice(9))}`);
assertTrue('H5-3: In-ops (idx 4..8) revenue > 0',
  resH5.totalRevenuePerPeriod.slice(4, 9).every((v) => v > 0),
  `in-ops got ${JSON.stringify(resH5.totalRevenuePerPeriod.slice(4, 9))}`);

// H6: fixed_amount Other revenue with indexation.
const fixtureH6: HospitalityConfig = {
  ...fixtureH1,
  assetId: 'asset-H6',
  otherRevenue: {
    mode: 'fixed_amount',
    fixedAmountPerPeriod: [0, 0, 0, 0, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000],
    indexation: { method: 'yoy_compound', rate: 0.05, startYear: 4 },
  },
};
const resH6 = computeHospitalityAsset({ config: fixtureH6, axisLength: 14 });
assertNear('H6-1: Other (fixed 100k) year 5 = 100,000', resH6.otherRevenuePerPeriod[4], 100000, 1);
assertNear('H6-2: Other (fixed 100k × 1.05) year 6', resH6.otherRevenuePerPeriod[5], 100000 * 1.05, 1);
assertNear('H6-3: Other (fixed 100k × 1.05^2) year 7', resH6.otherRevenuePerPeriod[6], 100000 * 1.05 * 1.05, 1);

// ───────────────────────────────────────────────────────────────
// Fixture I (Pass 8d): DSO-driven AR for operating revenue.
// ───────────────────────────────────────────────────────────────
import { buildAccountsReceivableDSO } from '@/src/core/calculations/revenue';

console.log('--- Fixture I: AR DSO roll-forward (Pass 8d) ---');

// 4 years of revenue: [1000, 1200, 0, 0], DSO = 90 days, days/year = 360.
// ratio = 90/360 = 0.25
// closing = revenue × 0.25 = [250, 300, 0, 0]
// opening = [0, 250, 300, 0]
// change  = closing - opening = [250, 50, -300, 0]
// cash    = revenue - change  = [750, 1150, 300, 0]
const arDSO = buildAccountsReceivableDSO({
  revenuePerPeriod: [1000, 1200, 0, 0],
  dsoDays: 90,
  daysPerYear: 360,
  axisLength: 4,
});
assertTrue('I1: AR closing = revenue × dso/days',
  JSON.stringify(arDSO.perPeriod) === JSON.stringify([250, 300, 0, 0]),
  `got ${JSON.stringify(arDSO.perPeriod)}`);
assertTrue('I2: AR opening = prior closing (opening[0] = 0)',
  JSON.stringify(arDSO.openingPerPeriod) === JSON.stringify([0, 250, 300, 0]),
  `got ${JSON.stringify(arDSO.openingPerPeriod)}`);
assertTrue('I3: AR change = closing - opening',
  JSON.stringify(arDSO.changePerPeriod) === JSON.stringify([250, 50, -300, 0]),
  `got ${JSON.stringify(arDSO.changePerPeriod)}`);
assertTrue('I4: Cash received = revenue - change in AR',
  JSON.stringify(arDSO.cashReceivedPerPeriod) === JSON.stringify([750, 1150, 300, 0]),
  `got ${JSON.stringify(arDSO.cashReceivedPerPeriod)}`);
assertNear('I5: Total cash collected over lifetime = total revenue',
  arDSO.cashReceivedPerPeriod.reduce((s, v) => s + v, 0),
  1000 + 1200 + 0 + 0,
  0.01);
assertNear('I6: AR settles to 0 once revenue tails off',
  arDSO.perPeriod[3], 0, 0.01);

// Default daysPerYear = 365 sanity:
const arDSO365 = buildAccountsReceivableDSO({
  revenuePerPeriod: [365],
  dsoDays: 30,
  axisLength: 1,
});
assertNear('I7: DSO=30, days=365 default, revenue=365 -> closing=30',
  arDSO365.perPeriod[0], 30, 0.01);

// ───────────────────────────────────────────────────────────────
// Fixture J (Pass 8e): yoy_per_period indexation method.
// User asked for per-year variable ADR escalation. Engine math:
//   factor[startYear] = 1
//   factor[y] = factor[y-1] × (1 + growthPerPeriod[y]) for y > startYear
// ───────────────────────────────────────────────────────────────
import { applyIndexation, type IndexationConfig } from '@/src/core/calculations/revenue';

console.log('--- Fixture J: yoy_per_period indexation (Pass 8e) ---');

// J1: per-year growth from idx 4 onwards. growth at idx 5,6,7 =
// 5%, 3%, 4%. Base 500.
const cfgJ: IndexationConfig = {
  method: 'yoy_per_period',
  startYear: 4,
  growthPerPeriod: [0, 0, 0, 0, 0, 0.05, 0.03, 0.04, 0, 0, 0, 0, 0, 0],
};
assertNear('J1: factor at startYear (idx 4) = base',
  applyIndexation(500, 4, cfgJ), 500, 0.01);
assertNear('J2: factor at idx 5 = base × (1+5%) = 525',
  applyIndexation(500, 5, cfgJ), 500 * 1.05, 0.01);
assertNear('J3: factor at idx 6 = 525 × 1.03 = 540.75',
  applyIndexation(500, 6, cfgJ), 500 * 1.05 * 1.03, 0.01);
assertNear('J4: factor at idx 7 = 540.75 × 1.04 = 562.38',
  applyIndexation(500, 7, cfgJ), 500 * 1.05 * 1.03 * 1.04, 0.01);
assertNear('J5: factor at idx 8 = unchanged (growth 0 at 8)',
  applyIndexation(500, 8, cfgJ), 500 * 1.05 * 1.03 * 1.04, 0.01);
assertNear('J6: factor before startYear (idx 3) = base',
  applyIndexation(500, 3, cfgJ), 500, 0.01);

// J7: integrate with hospitality engine — ADR escalates per-year.
const hospJ = computeHospitalityAsset({
  config: {
    assetId: 'asset-J',
    subUnits: [],
    keys: 100,
    daysPerYear: 365,
    startingADR: 500,
    adrIndexation: cfgJ,
    occupancyPerPeriod: new Array<number>(14).fill(0.70),
    guestsPerOccupiedRoom: 1.5,
    fb: { mode: 'percent_of_rooms', percentOfRooms: 0 },
    otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 },
    opsStartIdx: 4,
    opsEndIdx: 13,
  },
  axisLength: 14,
});
assertNear('J7: ADR year 5 in hospitality engine = 500',
  hospJ.adrPerPeriod[4], 500, 0.01);
assertNear('J8: ADR year 6 in hospitality engine = 525',
  hospJ.adrPerPeriod[5], 525, 0.01);
assertNear('J9: ADR year 7 in hospitality engine = 540.75',
  hospJ.adrPerPeriod[6], 540.75, 0.01);

// ───────────────────────────────────────────────────────────────
// Fixture K (Pass 9c, 2026-05-18): per-sub-unit ADR.
// 3 room types: Standard (100 keys @ 400), Deluxe (50 keys @ 600),
// Suite (10 keys @ 1500). 14-year axis, ops 4..13, occ 70%, no
// indexation, no ancillary. Test asset-level keys-weighted ADR +
// per-sub-unit Rooms revenue.
// ───────────────────────────────────────────────────────────────
console.log('\n--- Fixture K: per-sub-unit ADR (Pass 9c) ---');

const cfgK: HospitalityConfig = {
  assetId: 'asset-K',
  subUnits: [
    { id: 'std', keys: 100, startingADR: 400 },
    { id: 'dlx', keys: 50, startingADR: 600 },
    { id: 'ste', keys: 10, startingADR: 1500 },
  ],
  keys: 160, // ignored when subUnits non-empty
  daysPerYear: 365,
  startingADR: 0, // ignored when sub-units carry their own
  adrIndexation: { method: 'none' },
  occupancyPerPeriod: new Array<number>(14).fill(0).map((_, i) => (i >= 4 && i <= 13 ? 0.70 : 0)),
  guestsPerOccupiedRoom: 1.5,
  fb: { mode: 'percent_of_rooms', percentOfRooms: 0 },
  otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 },
  opsStartIdx: 4,
  opsEndIdx: 13,
};
const resK = computeHospitalityAsset({ config: cfgK, axisLength: 14 });

const arnK = (100 + 50 + 10) * 365;         // 58,400
const ornK = arnK * 0.70;                   // 40,880
const roomsStd = 100 * 365 * 0.70 * 400;    // 10,220,000
const roomsDlx = 50 * 365 * 0.70 * 600;     // 7,665,000
const roomsSte = 10 * 365 * 0.70 * 1500;    // 3,832,500
const totalRoomsK = roomsStd + roomsDlx + roomsSte;
const weightedADR = (100 * 400 + 50 * 600 + 10 * 1500) / (100 + 50 + 10);

assertNear('K1: Available Room Nights y5 = (100+50+10) × 365 = 58,400',
  resK.availableRoomNightsPerPeriod[4], arnK, 0.5);
assertNear('K2: Occupied Room Nights y5 = ARN × 0.70 = 40,880',
  resK.occupiedRoomNightsPerPeriod[4], ornK, 0.5);
assertNear('K3: keys-weighted ADR y5 = (100×400+50×600+10×1500)/160 = 531.25',
  resK.adrPerPeriod[4], weightedADR, 0.01);
assertNear('K4: Total Rooms Revenue y5 = sum of per-sub-unit Rooms',
  resK.roomsRevenuePerPeriod[4], totalRoomsK, 0.5);
assertNear('K5: per-sub-unit Standard Rooms y5 = 10,220,000',
  resK.perSubUnit.std.roomsRevenuePerPeriod[4], roomsStd, 0.5);
assertNear('K6: per-sub-unit Deluxe Rooms y5 = 7,665,000',
  resK.perSubUnit.dlx.roomsRevenuePerPeriod[4], roomsDlx, 0.5);
assertNear('K7: per-sub-unit Suite Rooms y5 = 3,832,500',
  resK.perSubUnit.ste.roomsRevenuePerPeriod[4], roomsSte, 0.5);
assertNear('K8: per-sub-unit Suite ADR y5 = 1,500 (no indexation)',
  resK.perSubUnit.ste.adrPerPeriod[4], 1500, 0.01);
assertNear('K9: per-sub-unit Suite ARN y5 = 10 × 365 = 3,650',
  resK.perSubUnit.ste.availableRoomNightsPerPeriod[4], 10 * 365, 0.5);

// K10: per-sub-unit indexation override. Only Suite gets 5% YoY.
const cfgK2: HospitalityConfig = {
  ...cfgK,
  subUnits: [
    { id: 'std', keys: 100, startingADR: 400 },
    { id: 'dlx', keys: 50, startingADR: 600 },
    { id: 'ste', keys: 10, startingADR: 1500, adrIndexation: { method: 'yoy_compound', rate: 0.05, startYear: 4 } },
  ],
};
const resK2 = computeHospitalityAsset({ config: cfgK2, axisLength: 14 });
assertNear('K10: Standard ADR y6 = 400 (no per-su indexation, asset-level=none)',
  resK2.perSubUnit.std.adrPerPeriod[5], 400, 0.01);
assertNear('K11: Suite ADR y6 = 1500 × 1.05 = 1575 (per-su YoY 5%)',
  resK2.perSubUnit.ste.adrPerPeriod[5], 1500 * 1.05, 0.01);
assertNear('K12: Suite ADR y8 = 1500 × 1.05^3 = 1736.4375',
  resK2.perSubUnit.ste.adrPerPeriod[7], 1500 * 1.05 * 1.05 * 1.05, 0.01);

// K13: empty subUnits falls back to asset-level keys + startingADR.
const cfgK3: HospitalityConfig = {
  assetId: 'asset-K3',
  subUnits: [],
  keys: 200,
  daysPerYear: 365,
  startingADR: 500,
  adrIndexation: { method: 'none' },
  occupancyPerPeriod: new Array<number>(14).fill(0).map((_, i) => (i >= 4 && i <= 13 ? 0.70 : 0)),
  guestsPerOccupiedRoom: 1.5,
  fb: { mode: 'percent_of_rooms', percentOfRooms: 0 },
  otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 },
  opsStartIdx: 4,
  opsEndIdx: 13,
};
const resK3 = computeHospitalityAsset({ config: cfgK3, axisLength: 14 });
const arnK3 = 200 * 365;
const ornK3 = arnK3 * 0.70;
assertNear('K13: empty subUnits falls back to asset-level (ARN = 200 × 365)',
  resK3.availableRoomNightsPerPeriod[4], arnK3, 0.5);
assertNear('K14: empty subUnits fallback Rooms = ORN × 500',
  resK3.roomsRevenuePerPeriod[4], ornK3 * 500, 0.5);

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
