/* eslint-disable no-console */
/**
 * verify-returns-engine.ts
 *
 * Pins the M5 Returns engine pure math against textbook / Excel values.
 *
 * Excel cross-check (paste into a sheet to confirm):
 *   IRR:  =IRR({-1000;500;500;500})            -> 0.233751  (23.38%)
 *         =IRR({-100;110})                       -> 0.10
 *         =IRR({-100;0;121})                     -> 0.10
 *   NPV (t=0 convention used here = value0 + Excel NPV(r, value1..n)):
 *         -100 + NPV(0.1,{110})                  -> 0
 *         -1000 + NPV(0.1,{500;500;500})         -> 243.426
 *   Payback {-100;50;50;50}                      -> 2.0 years
 *           {-100;60;60}                          -> 1.667 years
 *   Terminal (perpetuity) 100*(1.02)/(0.10-0.02) -> 1275
 *
 * Run: npx tsx scripts/verify-returns-engine.ts
 */
import { npv, irr, moic, paybackPeriod, peakExposure } from '../src/core/calculations/returns/irr';
import { terminalEnterpriseValue, terminalEquityValue } from '../src/core/calculations/returns/terminalValue';
import {
  yieldOnCost, capRate, profitOnCost, profitMargin, loanToValue,
  equityMultiple, debtYield, dscrSeries, icrSeries, cashOnCashSeries,
} from '../src/core/calculations/returns/metrics';
import { computeReturns, summariseStream } from '../src/core/calculations/returns';
import type { ReturnsInput } from '../src/core/calculations/returns/types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const near = (a: number | null, b: number, tol = 1e-3) => a !== null && Math.abs(a - b) <= tol;

console.log('=== M5 Returns engine ===');

// ── NPV (t=0 convention) ──────────────────────────────────────────────
check('npv(0.1, [-100,110]) = 0', near(npv(0.1, [-100, 110]), 0), `got ${npv(0.1, [-100, 110])}`);
check('npv(0.1, [100]) = 100', near(npv(0.1, [100]), 100));
check('npv(0.1, [-1000,500,500,500]) = 243.426', near(npv(0.1, [-1000, 500, 500, 500]), 243.426, 1e-2), `got ${npv(0.1, [-1000, 500, 500, 500])}`);

// ── IRR (Excel cross-check) ───────────────────────────────────────────
check('irr([-100,110]) = 10%', near(irr([-100, 110]), 0.10), `got ${irr([-100, 110])}`);
check('irr([-100,0,121]) = 10%', near(irr([-100, 0, 121]), 0.10), `got ${irr([-100, 0, 121])}`);
check('irr([-1000,500,500,500]) = 23.375%', near(irr([-1000, 500, 500, 500]), 0.233751, 1e-4), `got ${irr([-1000, 500, 500, 500])}`);
check('irr all-positive = null (undefined)', irr([100, 100]) === null);
check('irr all-negative = null (undefined)', irr([-100, -100]) === null);
// IRR self-consistency: npv at the solved IRR is ~0.
const r1 = irr([-500, 120, 130, 140, 600]);
check('irr root: npv(irr) ~ 0', r1 !== null && Math.abs(npv(r1, [-500, 120, 130, 140, 600])) < 1e-3, `irr=${r1}`);

// ── MOIC ──────────────────────────────────────────────────────────────
check('moic([-100,50,80]) = 1.3', near(moic([-100, 50, 80]), 1.3));
check('moic([-100,-50,300]) = 2.0', near(moic([-100, -50, 300]), 2.0));
check('moic(no outflow) = 0', moic([100, 50]) === 0);

// ── Payback ───────────────────────────────────────────────────────────
check('payback([-100,50,50,50]) = 2.0', near(paybackPeriod([-100, 50, 50, 50]), 2.0));
check('payback([-100,60,60]) = 1.667', near(paybackPeriod([-100, 60, 60]), 1 + 40 / 60, 1e-3), `got ${paybackPeriod([-100, 60, 60])}`);
check('payback never recovers = null', paybackPeriod([-100, 10, 10]) === null);
check('payback no investment = 0', paybackPeriod([100, 50]) === 0);

// ── Peak exposure ─────────────────────────────────────────────────────
check('peakExposure([-100,-50,200]) = 150', near(peakExposure([-100, -50, 200]), 150));

// ── Terminal value ────────────────────────────────────────────────────
check('exit_multiple 100x10 = 1000', terminalEnterpriseValue({ method: 'exit_multiple', exitMetric: 100, exitMultiple: 10 }) === 1000);
check('perpetuity 100,g2%,r10% = 1275', near(terminalEnterpriseValue({ method: 'perpetuity', exitMetric: 100, perpetuityGrowth: 0.02, discountRate: 0.10 }), 1275));
check('perpetuity r<=g guarded to 0', terminalEnterpriseValue({ method: 'perpetuity', exitMetric: 100, perpetuityGrowth: 0.10, discountRate: 0.05 }) === 0);
check('terminal none = 0', terminalEnterpriseValue({ method: 'none', exitMetric: 100 }) === 0);
check('equity TV = EV - debt + cash', terminalEquityValue(1000, 300, 50) === 750);
check('equity TV floored at 0', terminalEquityValue(100, 500, 0) === 0);

// ── RE metric primitives ──────────────────────────────────────────────
check('yieldOnCost 80/1000 = 8%', near(yieldOnCost(80, 1000), 0.08));
check('capRate 80/1600 = 5%', near(capRate(80, 1600), 0.05));
check('profitOnCost (1300-1000)/1000 = 30%', near(profitOnCost(1300, 1000), 0.30));
check('profitMargin 150/1000 = 15%', near(profitMargin(150, 1000), 0.15));
check('LTV 600/1600 = 37.5%', near(loanToValue(600, 1600), 0.375));
check('equityMultiple 250/100 = 2.5x', near(equityMultiple(250, 100), 2.5));
check('debtYield 80/600 = 13.33%', near(debtYield(80, 600), 80 / 600, 1e-4));
check('ratio with zero denom = null', yieldOnCost(80, 0) === null);

// ── DSCR / ICR / Cash-on-Cash series ──────────────────────────────────
const dscr = dscrSeries([0, 150, 160, 170], [0, 100, 100, 100]);
check('dscr min = 1.5', near(dscr.min, 1.5));
check('dscr avg = 1.6', near(dscr.avg, (1.5 + 1.6 + 1.7) / 3));
check('dscr skips no-debt-service periods', dscr.perPeriod[0] === 0);
const icr = icrSeries([0, 200, 220], [0, 100, 100]);
check('icr min = 2.0', near(icr.min, 2.0));
const coc = cashOnCashSeries([0, 8, 12], [100, 100, 100]);
check('cashOnCash avg = 10%', near(coc.avg, 0.10));

// ── Full computeReturns assembly ──────────────────────────────────────
const input: ReturnsInput = {
  axisLength: 4,
  fcff: { perPeriod: [-1000, 300, 400, 800] },
  fcfe: { perPeriod: [-400, 100, 150, 500] },
  dividends: { perPeriod: [-400, 0, 50, 450] },
  discountRate: 0.10,
  metrics: {
    stabilisedNOI: 90, totalDevelopmentCost: 1000, totalRevenue: 1500, totalCost: 1100,
    totalPAT: 250, exitNOI: 95, exitEnterpriseValue: 1583, debtOutstandingAtExit: 500,
    totalEquityInvested: 400, totalEquityDistributions: 1000,
    cfadsPerPeriod: [0, 150, 160, 170], debtServicePerPeriod: [0, 100, 100, 100],
    ebitdaPerPeriod: [0, 200, 220, 240], interestPerPeriod: [0, 50, 50, 50],
    distributionPerPeriod: [0, 0, 50, 450], cumulativeEquityPerPeriod: [400, 400, 400, 400],
    equityInvestedPerPeriod: [400, 0, 0, 0],
  },
};
const res = computeReturns(input);
check('computeReturns: FCFF IRR present', res.fcff.irr !== null);
check('computeReturns: FCFE MOIC = 750/400', near(res.fcfe.moic, 750 / 400));
check('computeReturns: dividends payback present', res.dividends.paybackPeriod !== null);
check('computeReturns: equityMultiple = 2.5x', near(res.realEstate.equityMultiple, 2.5));
check('computeReturns: yieldOnCost = 9%', near(res.realEstate.yieldOnCost, 0.09));
check('computeReturns: developmentSpread = YoC - cap', res.realEstate.developmentSpread !== null && near(res.realEstate.developmentSpread, 0.09 - 95 / 1583, 1e-4));
check('computeReturns: dscrMin = 1.5', near(res.realEstate.dscrMin, 1.5));
check('summariseStream matches computeReturns', summariseStream(input.fcff, 0.1).npv === res.fcff.npv);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
