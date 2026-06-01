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

// ── Method 2 selected: own ratio + gap-sized custom curve ─────────────
{
  const r = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 } }), gap);
  check('M2 selected: selected = 600', approx(r.selected, 600), `got ${r.selected}`);
  check('M2 selected: debtPct = 60 (netFundingConfig)', approx(r.debtPct, 60), `got ${r.debtPct}`);
  check('M2 selected: equityPct = 40', approx(r.equityPct, 40), `got ${r.equityPct}`);
  check('M2 selected: selectedByPeriod mirrors gap', JSON.stringify(r.selectedByPeriod) === JSON.stringify(gap.method2PerPeriod));
  check('M2 selected: custom debt = gap * 0.6', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 120));
  check('M2 selected: custom equity = gap * 0.4', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 80));
}

// ── Method 3 selected: own ratio, no min-cash double-add ──────────────
{
  const r = computeFundingRequirement(
    capex,
    cfg(3, {
      cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 },
      minimumCashReserve: 500, // would double-add for M1/2/4; M3 must ignore
    }),
    gap,
  );
  check('M3 selected: selected = 400', approx(r.selected, 400), `got ${r.selected}`);
  check('M3 selected: debtPct = 75 (cashDeficitConfig)', approx(r.debtPct, 75), `got ${r.debtPct}`);
  check('M3 selected: equityPct = 25', approx(r.equityPct, 25), `got ${r.equityPct}`);
  check('M3 selected: minCashByPeriod all 0 (no double-add)', r.minCashByPeriod.every((v) => v === 0));
  check('M3 selected: custom debt = gap * 0.75', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 75));
  check('M3 selected: custom equity = gap * 0.25', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 25));
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

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
