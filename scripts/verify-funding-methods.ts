/**
 * verify-funding-methods.ts
 *
 * Pins the 2026-06-01 funding-method fix:
 *   - Methods 2 (Net Funding Requirement) + 3 (Cash Deficit Funding) now
 *     CALCULATE from the per-period gap series (no longer stubbed to 0).
 *   - Each method reads its OWN debt / equity ratio (Method 1 fixedRatio,
 *     Method 2 netFundingConfig, Method 3 cashDeficitConfig, Method 4
 *     derived from amounts).
 *   - A selected Method 2 / 3 sizes external funding to its gap via the
 *     custom-curve path (customDebtByPeriod / customEquityByPeriod).
 *   - Method 3 does NOT double-add the minimum cash reserve.
 *   - Backward compatible: no gapInputs => Methods 2 + 3 fall back to 0.
 *
 * Run: npx tsx scripts/verify-funding-methods.ts
 */
import { computeFundingRequirement, type FundingGapInputs } from '../src/core/calculations/financing/funding';
import type { CapexAggregate } from '../src/core/calculations/financing/types';
import type { ProjectFinancingConfig } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const approx = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;

// Minimal 4-period capex fixture: 1000 of non-land capex spread evenly.
const capex: CapexAggregate = {
  totals: { exclAllLand: 1000, exclLandInKind: 1000, inclAllLand: 1000 },
  perPeriod: {
    exclAllLand:    [250, 250, 250, 250],
    exclLandInKind: [250, 250, 250, 250],
    inclAllLand:    [250, 250, 250, 250],
    landCash:       [0, 0, 0, 0],
    landInKind:     [0, 0, 0, 0],
    nonLand:        [250, 250, 250, 250],
  },
};

const gap: FundingGapInputs = {
  // Net Funding Requirement (capex less pre-sales): 600 total.
  method2PerPeriod: [200, 150, 150, 100],
  // Cash Deficit (to maintain min cash): 400 total.
  method3PerPeriod: [100, 100, 120, 80],
};

function cfg(method: 1 | 2 | 3 | 4, extra: Partial<ProjectFinancingConfig> = {}): ProjectFinancingConfig {
  return {
    fundingMethod: method,
    parcelFunding: [],
    viewMode: 'combined',
    ...extra,
  } as ProjectFinancingConfig;
}

// ── Backward compat: no gap inputs => Methods 2 + 3 are 0 ──────────────
{
  const r = computeFundingRequirement(capex, cfg(1));
  check('no gap: method1 = capex total (1000)', approx(r.method1, 1000));
  check('no gap: method2 = 0', approx(r.method2, 0));
  check('no gap: method3 = 0', approx(r.method3, 0));
}

// ── Methods 2 + 3 now calculate from the gap series ───────────────────
{
  const r = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 } }), gap);
  check('method2 total = sum(gap.method2PerPeriod) = 600', approx(r.method2, 600), `got ${r.method2}`);
  check('method3 total = sum(gap.method3PerPeriod) = 400', approx(r.method3, 400), `got ${r.method3}`);
  check('method1 still = capex total (1000)', approx(r.method1, 1000));
}

// ── Method 2 selected WITH gap: GAP-SIZED custom curve at own ratio ───
// Gap-sized drawdown (2026-06-01): when the per-period gap is fed (the
// snapshot's 2nd pass + Module 1), Methods 2/3 size debt/equity to the net
// requirement via the custom path. When NO gap is fed (1st pass / direct),
// they fall back to capex sizing (no custom arrays) so funding is never
// zeroed (the regression). See the "no-gap fallback" block below.
{
  const r = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 } }), gap);
  check('M2 selected: selected = 600 (gap total)', approx(r.selected, 600), `got ${r.selected}`);
  check('M2 selected: debtPct = 60 (netFundingConfig)', approx(r.debtPct, 60), `got ${r.debtPct}`);
  check('M2 selected: equityPct = 40', approx(r.equityPct, 40), `got ${r.equityPct}`);
  check('M2 selected: selectedByPeriod mirrors gap', JSON.stringify(r.selectedByPeriod) === JSON.stringify(gap.method2PerPeriod));
  check('M2 gap-sized: custom debt = gap * 0.6', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 120));
  check('M2 gap-sized: custom equity = gap * 0.4', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 80));
}

// ── Method 3 selected WITH gap: GAP-SIZED, min-cash NOT double-added ──
{
  const r = computeFundingRequirement(
    capex,
    cfg(3, {
      cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 },
      minimumCashReserve: 500, // gap already nets min-cash; must NOT add again
    }),
    gap,
  );
  check('M3 selected: selected = 400 (gap total)', approx(r.selected, 400), `got ${r.selected}`);
  check('M3 selected: debtPct = 75 (cashDeficitConfig)', approx(r.debtPct, 75), `got ${r.debtPct}`);
  check('M3 selected: equityPct = 25', approx(r.equityPct, 25), `got ${r.equityPct}`);
  check('M3 gap-sized: custom debt = gap * 0.75', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 75));
  check('M3 gap-sized: custom equity = gap * 0.25', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 25));
  check('M3 gap-sized: min-cash NOT double-added (buffer 0)', r.minCashByPeriod.every((v) => v === 0));
}

// ── No-gap fallback: Methods 2/3 size from capex (snapshot pass 1) ────
// REGRESSION GUARD: no custom arrays without a gap, so debtEquity.ts uses
// the capex split and the statements are never left unfunded.
{
  const r2 = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 }, minimumCashReserve: 500 }));
  const r3 = computeFundingRequirement(capex, cfg(3, { cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 }, minimumCashReserve: 500 }));
  check('M2 no-gap: NO custom arrays => capex split draws funding', r2.customDebtByPeriod === undefined && r2.customEquityByPeriod === undefined);
  check('M3 no-gap: NO custom arrays => capex split draws funding', r3.customDebtByPeriod === undefined && r3.customEquityByPeriod === undefined);
  check('M2 no-gap: selectedByPeriod falls back to capex curve', JSON.stringify(r2.selectedByPeriod) === JSON.stringify(capex.perPeriod.exclLandInKind));
  check('M3 no-gap: min-cash buffer placed (capex sizing, sum 500)', approx(r3.minCashByPeriod.reduce((s, v) => s + v, 0), 500));
}

// ── Method 1 still adds the min-cash buffer (regression guard) ─────────
{
  const r = computeFundingRequirement(capex, cfg(1, { fixedRatio: { debtPct: 70, equityPct: 30 }, minimumCashReserve: 500 }), gap);
  check('M1 selected: debtPct = 70 (fixedRatio)', approx(r.debtPct, 70));
  check('M1 selected: min-cash buffer placed (sum 500)', approx(r.minCashByPeriod.reduce((s, v) => s + v, 0), 500));
}

// ── Method 4 unchanged: derived ratio from amounts ────────────────────
{
  const r = computeFundingRequirement(
    capex,
    cfg(4, { fixedAmountConfig: { debtAmount: 800, equityAmount: 200, yoySchedule: [25, 25, 25, 25] } }),
    gap,
  );
  check('M4 selected: selected = debt + equity (1000)', approx(r.selected, 1000), `got ${r.selected}`);
  check('M4 selected: debtPct = 80 (derived)', approx(r.debtPct, 80), `got ${r.debtPct}`);
  check('M4 selected: equityPct = 20 (derived)', approx(r.equityPct, 20), `got ${r.equityPct}`);
}

// ── SNAPSHOT REGRESSION GUARD ─────────────────────────────────────────
// The 2026-06-01 regression: with Method 2 or 3 selected, the Cash Flow
// drew ZERO new debt + equity because computeFinancialsSnapshot does not
// feed the per-period gap, so the (removed) custom-zero arrays zeroed all
// funding. This guard builds a REAL snapshot per method and asserts every
// method draws debt + equity and the BS balances.
function buildSnapState(method: 1 | 2 | 3 | 4): Parameters<typeof computeFinancialsSnapshot>[0] {
  const project = makeDefaultProject();
  project.startDate = '2026-01-01';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (project as any).financing = { ...((project as any).financing ?? {}), fundingMethod: method, parcelFunding: [],
    netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 },
    cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 },
    fixedAmountConfig: { debtAmount: 500_000, equityAmount: 300_000, yoySchedule: [50, 50] } };
  const p1 = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sell: any = { id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true, gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'a1', subUnits: [{ subUnitId: 'su1', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0.5, 0.5, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [] }], cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const su = { id: 'su1', assetId: 'a1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 50000, unitPrice: 5000 };
  const parcel = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { project, phases: [p1], assets: [sell], subUnits: [su], parcels: [parcel], costLines: makeDefaultCostLines('p1', 2), costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [] } as any;
}
let m1Funding = 0;
for (const method of [1, 2, 3, 4] as const) {
  const snap = computeFinancialsSnapshot(buildSnapState(method));
  const debt = snap.directCF.debtDrawdownPerPeriod.reduce((s, v) => s + v, 0);
  const equity = snap.directCF.equityDrawdownPerPeriod.reduce((s, v) => s + v, 0);
  const bsMax = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const cfTie = Math.max(...snap.directCF.closingCashPerPeriod.map((v, i) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[i] ?? 0))));
  check(`SNAPSHOT Method ${method}: new debt > 0 in Cash Flow`, debt > 0, `debt=${Math.round(debt)}`);
  check(`SNAPSHOT Method ${method}: equity > 0 in Cash Flow`, equity > 0, `equity=${Math.round(equity)}`);
  check(`SNAPSHOT Method ${method}: BS balances`, bsMax < 1, `maxBSdiff=${Math.round(bsMax)}`);
  check(`SNAPSHOT Method ${method}: Direct CF == Indirect CF (2-pass stable)`, cfTie < 1, `tie=${Math.round(cfTie)}`);
  if (method === 1) m1Funding = debt + equity;
  // Gap-sized drawdown: Methods 2/3 fund the NET requirement, so total
  // funding is <= Method 1 (full capex). (Equal only if the gap = capex.)
  if (method === 2 || method === 3) {
    check(`SNAPSHOT Method ${method}: gap-sized funding <= Method 1 (capex)`, debt + equity <= m1Funding + 1, `m${method}=${Math.round(debt + equity)} m1=${Math.round(m1Funding)}`);
  }
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
