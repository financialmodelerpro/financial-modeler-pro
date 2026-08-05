/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-waterfall.ts (fund layer, Step 4: the M5 distribution waterfall)
 *
 * REBUILT 2026-08-05 alongside the engine, to the reference model's structure.
 * See docs/FUND_LAYER_GUIDELINE.md.
 *
 * THE REFERENCE MECHANIC, per period, which every check below is written
 * against rather than against a generic private-equity waterfall:
 *
 *   hurdleAccrued    = (unpaidHurdleBoP + equityDrawn) x hurdleRate
 *   totalHurdleOwed  = equityDrawn + unpaidHurdleBoP + hurdleAccrued
 *   hurdlePaid       = MIN(distributions, totalHurdleOwed)
 *   unpaidHurdleEoP  = totalHurdleOwed - hurdlePaid
 *   excess           = distributions - hurdlePaid
 *   performanceFee   = excess x performanceFeePct
 *   netDistributions = distributions - performanceFee
 *
 * There is NO return-of-capital tier (equity drawn folds into the hurdle owed
 * and is settled by the single hurdlePaid line), NO catch-up, and NO residual
 * split. Section 4 pins the fold-in directly, because "we removed a tier" is
 * exactly the kind of change that leaves a vestige behind.
 *
 * THE CLAIMS IT PINS:
 *
 *   A. EXHAUSTION. Every period splits its full distribution into hurdle paid,
 *      performance fee, and excess after fee. Nothing is lost, nothing is
 *      created. Asserted PER PERIOD, not on the totals: an over-payment in one
 *      period and an under-payment in another would net out of a totals-only
 *      check and pass a broken engine.
 *   B. THE BALANCE CLOSES. owed = drawn + BoP + accrued, EoP = owed - paid, and
 *      each period's BoP is the prior EoP.
 *   C. THE FEE IS ONLY CHARGED ABOVE THE HURDLE, and it is a FLAT RATE on the
 *      excess rather than a share of a split.
 *   D. THE ACCRUAL COMPOUNDS. The whole mechanic collapses to
 *      owed = (BoP + drawn) x (1 + r), so the balance compounds at exactly
 *      (1+r) per period. Pinned as an exact identity, against an independently
 *      computed closed form, and by superposition across multiple draws.
 *   E. TOGGLE OFF EQUALS TODAY. Exact, value for value, including the sign of a
 *      zero, and Step 1's guard is run as a child process and must stay green.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that an investor paid exactly the hurdle
 * earns an IRR equal to the hurdle rate. The first cut asserted that, and it
 * was true under an opening-balance-only accrual. It is FALSE under the
 * reference's convention, which charges a full period of hurdle in the period
 * equity is drawn: the balance reaches C x (1+r)^(n+1) after n periods, so the
 * implied IRR is 16.64% on an 8% hurdle over one period and 8.83% over ten.
 * Section 4 pins that behaviour as the closed form instead of asserting an
 * equality the model does not have. A verifier that asserts a false thing is
 * worse than one that asserts less.
 *
 * Run: npx tsx scripts/verify-fund-waterfall.ts
 *
 * No em dashes in this file.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeDistributionWaterfall, emptyWaterfall } from '../src/core/calculations/returns';
import type { WaterfallSnapshot } from '../src/core/calculations/returns';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const root = join(__dirname, '..');

/** Currency-unit tolerance. The allocation is by subtraction, so any residue is
 *  pure floating-point rounding on figures in the hundreds of millions. */
const EPS = 1e-6;
const near = (a: number, b: number, eps = EPS): boolean => Math.abs(a - b) <= eps;

// ── Exact deep comparison (same shape as the Step 1 guard) ─────────────────
const typeTag = (v: unknown): string => Object.prototype.toString.call(v);
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  const ta = typeTag(a), tb = typeTag(b);
  if (ta !== tb) return `${path || '<root>'}: type ${ta} vs ${tb}`;
  if (typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean'
      || a === null || a === undefined || typeof a === 'bigint') {
    return `${path || '<root>'}: ${String(a)} vs ${String(b)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return `${path}.size: ${a.size} vs ${b.size}`;
    for (const [k, va] of a.entries()) {
      if (!b.has(k)) return `${path}.get(${String(k)}): missing`;
      const d = firstDiff(va, b.get(k), `${path}.get(${String(k)})`);
      if (d) return d;
    }
    return null;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return `${path}.size: ${a.size} vs ${b.size}`;
    for (const v of a) if (!b.has(v)) return `${path}: missing member ${String(v)}`;
    return null;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(ao), ...Object.keys(bo)])).sort();
    for (const k of keys) {
      if (!(k in ao)) return `${path}.${k}: absent on the left`;
      if (!(k in bo)) return `${path}.${k}: absent on the right`;
      const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path || '<root>'}: not comparable (${ta})`;
}

// ── Shared assertions over any waterfall ───────────────────────────────────

/** A: every period exhausts its distribution. */
function assertExhaustion(label: string, wf: WaterfallSnapshot): void {
  let worstSplit = 0, worstNet = 0, worstExcess = 0, negative = '';
  for (let t = 0; t < wf.periods.length; t++) {
    const p = wf.periods[t];
    worstSplit = Math.max(worstSplit,
      Math.abs((p.hurdlePaid + p.performanceFee + p.excessAfterFee) - p.distribution));
    worstNet = Math.max(worstNet, Math.abs((p.netDistribution + p.performanceFee) - p.distribution));
    worstExcess = Math.max(worstExcess, Math.abs((p.distribution - p.hurdlePaid) - p.excessDistributions));
    if (p.hurdlePaid < -EPS || p.performanceFee < -EPS || p.excessAfterFee < -EPS
        || p.excessDistributions < -EPS) negative = `period ${t}`;
  }
  check(`${label}: hurdle paid + fee + excess after fee equals the distribution, every period`,
    worstSplit <= EPS, `worst residue ${worstSplit}`);
  check(`${label}: net distribution plus fee equals the gross distribution, every period`,
    worstNet <= EPS, `worst residue ${worstNet}`);
  check(`${label}: excess is exactly distributions less hurdle paid`,
    worstExcess <= EPS, `worst residue ${worstExcess}`);
  check(`${label}: no line ever pays a negative amount`, negative === '', negative);
  check(`${label}: unallocated total is zero`, near(wf.unallocated, 0), String(wf.unallocated));
  check(`${label}: totals foot to total distributions`,
    near(wf.totalHurdlePaid + wf.totalPerformanceFee + wf.totalExcessAfterFee, wf.totalDistributions),
    `${wf.totalHurdlePaid + wf.totalPerformanceFee + wf.totalExcessAfterFee} vs ${wf.totalDistributions}`);
  check(`${label}: net distributions are gross less the fee`,
    near(wf.totalNetDistributions, wf.totalDistributions - wf.totalPerformanceFee));
  check(`${label}: hurdle paid never exceeds the cash there was to pay it with`,
    wf.periods.every((p) => p.hurdlePaid <= p.distribution + EPS));
  check(`${label}: hurdle paid never exceeds the amount owed`,
    wf.periods.every((p) => p.hurdlePaid <= p.totalHurdleOwed + EPS));
  check(`${label}: net cash flow is net distributions less equity drawn`,
    wf.periods.every((p) => near(p.netCashflow, p.netDistribution - p.equityDrawn)));
}

/** B: the single balance rolls forward and chains period to period. */
function assertBalanceCloses(label: string, wf: WaterfallSnapshot): void {
  let owedRoll = 0, eopRoll = 0, chain = 0, accrualBase = 0, negative = '';
  for (let t = 0; t < wf.periods.length; t++) {
    const p = wf.periods[t];
    accrualBase = Math.max(accrualBase,
      Math.abs(p.hurdleAccrued - (p.openingUnpaidHurdle + p.equityDrawn) * wf.hurdleRate));
    owedRoll = Math.max(owedRoll,
      Math.abs((p.equityDrawn + p.openingUnpaidHurdle + p.hurdleAccrued) - p.totalHurdleOwed));
    eopRoll = Math.max(eopRoll, Math.abs((p.totalHurdleOwed - p.hurdlePaid) - p.closingUnpaidHurdle));
    if (t > 0) chain = Math.max(chain, Math.abs(p.openingUnpaidHurdle - wf.periods[t - 1].closingUnpaidHurdle));
    if (p.closingUnpaidHurdle < -EPS) negative = `period ${t}`;
  }
  check(`${label}: accrual is (BoP + equity drawn) x rate, every period`,
    accrualBase <= EPS, `worst ${accrualBase}`);
  check(`${label}: owed is equity drawn + BoP + accrued, every period`,
    owedRoll <= EPS, `worst ${owedRoll}`);
  check(`${label}: EoP is owed less paid, every period`, eopRoll <= EPS, `worst ${eopRoll}`);
  check(`${label}: each period's BoP is the prior period's EoP`, chain <= EPS, `worst ${chain}`);
  check(`${label}: the balance is never paid below zero`, negative === '', negative);
  check(`${label}: the first period opens at zero`,
    wf.periods.length === 0 || wf.periods[0].openingUnpaidHurdle === 0);
  check(`${label}: equity drawn plus hurdle accrued less hurdle paid equals the closing balance`,
    near(wf.totalEquityDrawn + wf.totalHurdleAccrued - wf.totalHurdlePaid, wf.hurdleShortfall, 1e-3),
    `${wf.totalEquityDrawn + wf.totalHurdleAccrued - wf.totalHurdlePaid} vs ${wf.hurdleShortfall}`);
}

/** C: the fee is charged only above the hurdle, at a flat rate. */
function assertFeeOnlyAboveHurdle(label: string, wf: WaterfallSnapshot): void {
  let bad = '', feeWithoutExcess = '';
  for (let t = 0; t < wf.periods.length; t++) {
    const p = wf.periods[t];
    // A fee means the distribution outran the amount owed, which means the
    // balance closed at zero. Any other combination is the fee leaking below
    // the hurdle.
    if (p.performanceFee > EPS && p.closingUnpaidHurdle > EPS) bad = `period ${t}`;
    if (p.performanceFee > EPS && p.excessDistributions <= EPS) feeWithoutExcess = `period ${t}`;
  }
  check(`${label}: no fee is charged while the hurdle balance is still outstanding`, bad === '', bad);
  check(`${label}: no fee is charged without an excess to charge it on`, feeWithoutExcess === '', feeWithoutExcess);
  check(`${label}: the fee is a FLAT rate on the excess, every period`,
    wf.periods.every((p) => near(p.performanceFee, p.excessDistributions * wf.performanceFeePct)));
  check(`${label}: total fee is the flat rate on total excess`,
    near(wf.totalPerformanceFee, wf.totalExcessDistributions * wf.performanceFeePct, 1e-3));
}

/** D: the balance compounds at exactly (1 + r) per period. */
function assertCompounding(label: string, wf: WaterfallSnapshot): void {
  let worst = 0;
  for (const p of wf.periods) {
    worst = Math.max(worst,
      Math.abs(p.totalHurdleOwed - (p.openingUnpaidHurdle + p.equityDrawn) * (1 + wf.hurdleRate)));
  }
  check(`${label}: owed equals (BoP + equity drawn) x (1 + rate), every period`,
    worst <= EPS, `worst ${worst}`);
}

// ── Section 1 to 4: the pure engine ────────────────────────────────────────

console.log('=== 1. The reference mechanic on a worked example ===');
{
  // Hand-computable: 100 drawn at t=0, 10% hurdle, 20% fee, nothing paid until
  // t=2, then a large distribution. Every figure below is arithmetic done
  // independently of the engine.
  //   t0: BoP 0, drawn 100, accrued 10,   owed 110,   paid 0,     EoP 110
  //   t1: BoP 110, drawn 0, accrued 11,   owed 121,   paid 0,     EoP 121
  //   t2: BoP 121, drawn 0, accrued 12.1, owed 133.1, paid 133.1, EoP 0
  //       excess 200 - 133.1 = 66.9, fee 13.38, net 200 - 13.38 = 186.62
  const wf = computeDistributionWaterfall({
    equityDrawnPerPeriod: [100, 0, 0], distributionsPerPeriod: [0, 0, 200],
    hurdleRate: 0.10, performanceFeePct: 0.20, active: true,
  });
  const p = wf.periods;
  check('t0 accrues on the same-period draw', near(p[0].hurdleAccrued, 10, 1e-9), String(p[0].hurdleAccrued));
  check('t0 owes 110', near(p[0].totalHurdleOwed, 110, 1e-9), String(p[0].totalHurdleOwed));
  check('t0 pays nothing and carries 110', p[0].hurdlePaid === 0 && near(p[0].closingUnpaidHurdle, 110, 1e-9));
  check('t1 accrues 11 on the carried balance', near(p[1].hurdleAccrued, 11, 1e-9), String(p[1].hurdleAccrued));
  check('t1 carries 121', near(p[1].closingUnpaidHurdle, 121, 1e-9), String(p[1].closingUnpaidHurdle));
  check('t2 owes 133.1', near(p[2].totalHurdleOwed, 133.1, 1e-9), String(p[2].totalHurdleOwed));
  check('t2 pays the full 133.1 and closes at zero',
    near(p[2].hurdlePaid, 133.1, 1e-9) && near(p[2].closingUnpaidHurdle, 0, 1e-9));
  check('t2 excess is 66.9', near(p[2].excessDistributions, 66.9, 1e-9), String(p[2].excessDistributions));
  check('t2 fee is 13.38 (20% of the excess, not of the distribution)',
    near(p[2].performanceFee, 13.38, 1e-9), String(p[2].performanceFee));
  check('t2 net distribution is 186.62', near(p[2].netDistribution, 186.62, 1e-9), String(p[2].netDistribution));
  check('the fee is NOT 20% of the gross distribution', !near(p[2].performanceFee, 40, 1e-6));
  assertExhaustion('worked example', wf);
  assertBalanceCloses('worked example', wf);
  assertFeeOnlyAboveHurdle('worked example', wf);
  assertCompounding('worked example', wf);
}

console.log('\n=== 2. A realistic profile, plus edge shapes ===');
{
  const wf = computeDistributionWaterfall({
    equityDrawnPerPeriod: [0, 40_000_000, 35_000_000, 25_000_000, 0, 0, 0, 0, 0, 0],
    distributionsPerPeriod: [0, 0, 0, 0, 0, 12_000_000, 15_000_000, 18_000_000, 20_000_000, 260_000_000],
    hurdleRate: 0.08, performanceFeePct: 0.20, active: true,
  });
  check('the profile actually clears the hurdle (a fee is charged)', wf.totalPerformanceFee > 0,
    `fee ${wf.totalPerformanceFee}`);
  check('the profile actually settles its hurdle balance', near(wf.hurdleShortfall, 0, 1e-3),
    `shortfall ${wf.hurdleShortfall}`);
  assertExhaustion('realistic', wf);
  assertBalanceCloses('realistic', wf);
  assertFeeOnlyAboveHurdle('realistic', wf);
  assertCompounding('realistic', wf);
  // Early distributions must go entirely to the hurdle, no fee, while the
  // balance is still outstanding.
  check('the early distributions are 100 percent hurdle payment with no fee',
    wf.periods.slice(5, 9).every((p) => p.performanceFee === 0 && near(p.hurdlePaid, p.distribution)));

  const shapes: Array<{ name: string; d: number[]; x: number[]; h: number; f: number }> = [
    { name: 'no distributions at all (total loss)', d: [0, 100, 50], x: [0, 0, 0], h: 0.08, f: 0.2 },
    { name: 'no equity drawn at all', d: [0, 0, 0], x: [0, 10, 10], h: 0.08, f: 0.2 },
    { name: 'zero hurdle', d: [0, 100], x: [0, 300], h: 0, f: 0.2 },
    { name: 'zero performance fee', d: [0, 100], x: [0, 300], h: 0.08, f: 0 },
    { name: '100 percent performance fee', d: [0, 100], x: [0, 300], h: 0.08, f: 1 },
    { name: 'draw and distribution in the same period', d: [0, 100, 100], x: [0, 30, 400], h: 0.08, f: 0.2 },
    { name: 'every series empty', d: [], x: [], h: 0.08, f: 0.2 },
    { name: 'single period', d: [100], x: [500], h: 0.08, f: 0.2 },
    { name: 'distribution before any equity is drawn', d: [0, 100], x: [50, 0], h: 0.08, f: 0.2 },
  ];
  for (const s of shapes) {
    const w = computeDistributionWaterfall({
      equityDrawnPerPeriod: s.d, distributionsPerPeriod: s.x,
      hurdleRate: s.h, performanceFeePct: s.f, active: true,
    });
    assertExhaustion(s.name, w);
    assertBalanceCloses(s.name, w);
    assertFeeOnlyAboveHurdle(s.name, w);
    assertCompounding(s.name, w);
  }

  const loss = computeDistributionWaterfall({
    equityDrawnPerPeriod: [0, 100, 50], distributionsPerPeriod: [0, 0, 0],
    hurdleRate: 0.08, performanceFeePct: 0.2, active: true,
  });
  check('a total loss charges no fee', loss.totalPerformanceFee === 0);
  check('a total loss carries capital AND accrued hurdle in the closing balance',
    loss.hurdleShortfall > 150, String(loss.hurdleShortfall));

  const allFee = computeDistributionWaterfall({
    equityDrawnPerPeriod: [0, 100], distributionsPerPeriod: [0, 300],
    hurdleRate: 0.08, performanceFeePct: 1, active: true,
  });
  check('a 100 percent fee leaves investors exactly the hurdle payment',
    near(allFee.totalExcessAfterFee, 0) && near(allFee.totalNetDistributions, allFee.totalHurdlePaid));
  // A distribution arriving before any equity is drawn cannot be owed anything,
  // so it is all excess and all fee-bearing. Worth pinning: it is the one shape
  // where the balance is zero for a reason other than being paid off.
  const early = computeDistributionWaterfall({
    equityDrawnPerPeriod: [0, 100], distributionsPerPeriod: [50, 0],
    hurdleRate: 0.08, performanceFeePct: 0.2, active: true,
  });
  check('a distribution before any draw is entirely excess',
    near(early.periods[0].excessDistributions, 50) && early.periods[0].hurdlePaid === 0);
  check('and is charged the fee at the flat rate', near(early.periods[0].performanceFee, 10));
}

console.log('\n=== 3. The fee boundary: only above the hurdle ===');
{
  // Draw 100m at t=0, hold to t=5, then distribute. The exact owed figure comes
  // from a dry run, and is cross-checked against the closed form below.
  const N = 6;
  const drawn = new Array<number>(N).fill(0); drawn[0] = 100_000_000;
  const dry = computeDistributionWaterfall({
    equityDrawnPerPeriod: drawn, distributionsPerPeriod: new Array<number>(N).fill(0),
    hurdleRate: 0.08, performanceFeePct: 0.20, active: true,
  });
  const owed = dry.hurdleShortfall;
  // Six accrual periods (t=0 accrues on the same-period draw, t=1..5 on the
  // carried balance), so the closed-form exponent is N, not N-1.
  const expected = 100_000_000 * Math.pow(1.08, N);
  check('the dry-run balance matches the independently computed closed form',
    near(owed, expected, 1e-3), `${owed} vs ${expected}`);

  const runAt = (dist: number): WaterfallSnapshot => {
    const d = new Array<number>(N).fill(0); d[N - 1] = dist;
    return computeDistributionWaterfall({
      equityDrawnPerPeriod: drawn, distributionsPerPeriod: d,
      hurdleRate: 0.08, performanceFeePct: 0.20, active: true,
    });
  };

  const below = runAt(owed - 1_000_000);
  check('a million BELOW the hurdle charges zero fee', below.totalPerformanceFee === 0,
    String(below.totalPerformanceFee));
  check('a million below the hurdle leaves exactly that million outstanding',
    near(below.hurdleShortfall, 1_000_000, 1e-3), String(below.hurdleShortfall));
  check('and every dollar distributed went to the hurdle',
    near(below.totalHurdlePaid, owed - 1_000_000, 1e-3));

  const exact = runAt(owed);
  check('EXACTLY at the hurdle charges zero fee', near(exact.totalPerformanceFee, 0, 1e-6),
    String(exact.totalPerformanceFee));
  check('exactly at the hurdle closes the balance to zero', near(exact.hurdleShortfall, 0, 1e-6));

  const above = runAt(owed + 1_000_000);
  check('a million ABOVE the hurdle charges the fee on exactly that million',
    near(above.totalPerformanceFee, 200_000, 1e-3), String(above.totalPerformanceFee));
  check('and the rest of that million stays with the investors',
    near(above.totalExcessAfterFee, 800_000, 1e-3));
  check('the fee never reduces the hurdle payment itself',
    near(above.totalHurdlePaid, owed, 1e-3), String(above.totalHurdlePaid));
}

console.log('\n=== 4. Compounding, the closed form, and no return-of-capital tier ===');
{
  // D: the balance compounds at exactly (1+r) per period, so a single draw C
  // held n periods owes C x (1+r)^(n+1). Checked against arithmetic done here,
  // not against the engine's own recursion.
  for (const r of [0.05, 0.08, 0.12, 0.20]) {
    for (const n of [1, 3, 5, 10]) {
      const N = n + 1;
      const drawn = new Array<number>(N).fill(0); drawn[0] = 250_000_000;
      const wf = computeDistributionWaterfall({
        equityDrawnPerPeriod: drawn, distributionsPerPeriod: new Array<number>(N).fill(0),
        hurdleRate: r, performanceFeePct: 0.20, active: true,
      });
      const closed = 250_000_000 * Math.pow(1 + r, n + 1);
      check(`hurdle ${(r * 100).toFixed(0)}% over ${n} periods: balance is C x (1+r)^(n+1)`,
        near(wf.hurdleShortfall, closed, Math.abs(closed) * 1e-12), `${wf.hurdleShortfall} vs ${closed}`);
      assertCompounding(`hurdle ${(r * 100).toFixed(0)}%/${n}p`, wf);
    }
  }

  // Superposition: several draws compound independently and sum to the balance.
  {
    const r = 0.09, N = 6;
    const drawn = [50_000_000, 0, 30_000_000, 0, 20_000_000, 0];
    const wf = computeDistributionWaterfall({
      equityDrawnPerPeriod: drawn, distributionsPerPeriod: new Array<number>(N).fill(0),
      hurdleRate: r, performanceFeePct: 0.2, active: true,
    });
    // A draw at index i is compounded (N - i) times by the end of index N-1.
    const closed = drawn.reduce((s, v, i) => s + v * Math.pow(1 + r, N - i), 0);
    check('multiple draws compound independently and sum to the balance',
      near(wf.hurdleShortfall, closed, Math.abs(closed) * 1e-9), `${wf.hurdleShortfall} vs ${closed}`);
  }

  // THE FOLD-IN. With a zero hurdle rate nothing accrues, so the balance IS the
  // unreturned capital and the single hurdlePaid line IS the return of capital.
  // This is what proves there is no separate tier hiding anywhere.
  {
    const wf = computeDistributionWaterfall({
      equityDrawnPerPeriod: [100, 60, 0, 0], distributionsPerPeriod: [0, 0, 90, 200],
      hurdleRate: 0, performanceFeePct: 0.25, active: true,
    });
    check('at a zero hurdle the balance is exactly the unreturned capital',
      near(wf.periods[1].closingUnpaidHurdle, 160) && near(wf.periods[2].closingUnpaidHurdle, 70));
    check('capital is returned by the single hurdle-paid line',
      near(wf.periods[2].hurdlePaid, 90) && near(wf.periods[3].hurdlePaid, 70));
    check('nothing accrues at a zero hurdle rate', wf.totalHurdleAccrued === 0);
    check('the fee is charged only on what exceeded the capital returned',
      near(wf.periods[3].excessDistributions, 130) && near(wf.periods[3].performanceFee, 32.5));
    check('no fee is charged while capital is still outstanding', wf.periods[2].performanceFee === 0);
  }

  // The structural claim, stated as a shape check: the removed tiers left no
  // vestigial fields behind for a later reader to trust.
  {
    const wf = computeDistributionWaterfall({
      equityDrawnPerPeriod: [100], distributionsPerPeriod: [200],
      hurdleRate: 0.08, performanceFeePct: 0.2, active: true,
    });
    const keys = Object.keys(wf.periods[0]);
    for (const gone of ['returnOfCapital', 'preferredPaid', 'residual', 'residualToInvestors', 'carry']) {
      check(`the removed tier field '${gone}' is gone from the period shape`, !keys.includes(gone));
    }
    check("the snapshot exposes no 'carry' alias for the performance fee",
      !Object.keys(wf).includes('carryPct') && !Object.keys(wf).includes('totalCarry'));
  }
}

// ── Section 5 to 8: the M5 integration ─────────────────────────────────────

function buildState(fund?: any): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  if (fund) project.fundTerms = fund;
  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' },
  };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return {
    project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel],
    costLines: makeDefaultCostLines('p1', 2), costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [],
  };
}

const fundTerms = (enabled: boolean, hurdle: number, fee: number): any => ({
  enabled,
  fundManagerName: 'Acme Fund Managers',
  fundSize: 500_000_000, facilityLimit: 300_000_000, facilityLimitOverride: true,
  fundStructureFeePct: 0.01, fundManagementFeePct: 0.02, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.0075, otherExpensesPerAnnum: 1_500_000,
  performanceFeePct: fee, carryPct: fee, hurdleRatePct: hurdle,
  feeDistribution: [
    { partyId: '__fund_manager__', partyName: 'Acme Fund Managers', performanceFeePct: 1, developerFeePct: 0, commissionPct: 0 },
  ],
  managementFeePct: 0.02, feeBase: 'committed_capital', committedCapital: 250_000_000, feeShares: [],
});

const runSnap = (fund?: any): { fin: any; ret: any } => {
  const state = buildState(fund);
  const fin = computeFinancialsSnapshot(state);
  const ret = computeReturnsSnapshot(fin, state.project);
  return { fin, ret };
};

console.log('\n=== 5. The hurdle and fee are NOT in the funding solve ===');
{
  // The decisive check. Same project, three different hurdle and fee settings,
  // fund layer ON in all three so the Step 3 fees are live and identical. If a
  // hurdle or a fee could reach the M4 solve, the financials snapshot or a
  // gross stream would move. Neither may.
  const a = runSnap(fundTerms(true, 0, 0));
  const b = runSnap(fundTerms(true, 0.08, 0.20));
  const c = runSnap(fundTerms(true, 0.15, 0.50));

  const dFinAB = firstDiff(a.fin, b.fin, 'financials');
  const dFinAC = firstDiff(a.fin, c.fin, 'financials');
  check('changing the hurdle and fee does NOT move the financials snapshot (8/20)',
    dFinAB === null, dFinAB ?? '');
  check('changing the hurdle and fee does NOT move the financials snapshot (15/50)',
    dFinAC === null, dFinAC ?? '');

  for (const [label, x, y] of [['8/20', a, b], ['15/50', a, c]] as const) {
    check(`gross FCFF stream unchanged (${label})`, firstDiff(x.ret.fcffPerPeriod, y.ret.fcffPerPeriod) === null);
    check(`gross FCFE stream unchanged (${label})`, firstDiff(x.ret.fcfePerPeriod, y.ret.fcfePerPeriod) === null);
    check(`gross Distributed-Equity stream unchanged (${label})`,
      firstDiff(x.ret.dividendStreamPerPeriod, y.ret.dividendStreamPerPeriod) === null);
    check(`gross result block unchanged (${label})`, firstDiff(x.ret.result, y.ret.result) === null);
    check(`partner block unchanged (${label})`, firstDiff(x.ret.partners, y.ret.partners) === null);
  }

  check('the 8/20 run really did charge a fee', b.ret.waterfall.totalPerformanceFee > 0,
    `fee ${b.ret.waterfall.totalPerformanceFee}`);
  check('a higher hurdle leaves strictly less above the hurdle',
    c.ret.waterfall.totalExcessDistributions < b.ret.waterfall.totalExcessDistributions,
    `${c.ret.waterfall.totalExcessDistributions} vs ${b.ret.waterfall.totalExcessDistributions}`);
  check('a zero hurdle and zero fee charge nothing', a.ret.waterfall.totalPerformanceFee === 0);

  const state = buildState(fundTerms(true, 0.08, 0.20));
  const fin = computeFinancialsSnapshot(state);
  const before = JSON.parse(JSON.stringify({
    pl: fin.pl, directCF: fin.directCF, bs: fin.bs, fundFees: fin.fundFees, dividends: fin.dividends,
  }));
  computeReturnsSnapshot(fin, state.project);
  const after = { pl: fin.pl, directCF: fin.directCF, bs: fin.bs, fundFees: fin.fundFees, dividends: fin.dividends };
  check('computing the returns snapshot does not mutate the financials snapshot',
    JSON.stringify(before) === JSON.stringify(after));
}

console.log('\n=== 6. The M5 waterfall ties to the Distributed-Equity stream ===');
{
  const { ret } = runSnap(fundTerms(true, 0.08, 0.20));
  const wf: WaterfallSnapshot = ret.waterfall;

  check('the waterfall is active with the fund layer on', wf.active === true);
  check('it spans the same periods as the stream',
    wf.periods.length === ret.dividendStreamPerPeriod.length,
    `${wf.periods.length} vs ${ret.dividendStreamPerPeriod.length}`);

  // The two sides must reconstruct the gross stream exactly: that is what
  // proves it is allocating THE distributions and not a lookalike series.
  let worst = 0;
  for (let i = 0; i < wf.periods.length; i++) {
    const rebuilt = (wf.distributionPerPeriod[i] ?? 0) - (wf.equityDrawnPerPeriod[i] ?? 0);
    worst = Math.max(worst, Math.abs(rebuilt - (ret.dividendStreamPerPeriod[i] ?? 0)));
  }
  check('distributions less equity drawn rebuild the gross stream period for period',
    worst <= 1e-6, `worst ${worst}`);

  assertExhaustion('live model', wf);
  assertBalanceCloses('live model', wf);
  assertFeeOnlyAboveHurdle('live model', wf);
  assertCompounding('live model', wf);

  let netWorst = 0;
  for (let i = 0; i < ret.netDividendStreamPerPeriod.length; i++) {
    netWorst = Math.max(netWorst, Math.abs(
      ret.netDividendStreamPerPeriod[i] - (ret.dividendStreamPerPeriod[i] - (wf.performanceFeePerPeriod[i] ?? 0))));
  }
  check('the net stream is the gross stream less the fee, period for period', netWorst === 0,
    `worst ${netWorst}`);
  // The waterfall's own net cash flow (net distributions less equity drawn) is
  // the same series, so there is one definition and not two that can drift.
  let cfWorst = 0;
  for (let i = 0; i < wf.periods.length; i++) {
    cfWorst = Math.max(cfWorst, Math.abs((wf.netCashflowPerPeriod[i] ?? 0) - ret.netDividendStreamPerPeriod[i]));
  }
  check('the waterfall net cash flow equals the resolver net stream', cfWorst <= 1e-6, `worst ${cfWorst}`);
  check('net total distributions are lower than gross by exactly the fee',
    near(ret.result.dividends.totalInflow - ret.resultNetDividends.totalInflow, wf.totalPerformanceFee, 1e-3),
    `${ret.result.dividends.totalInflow - ret.resultNetDividends.totalInflow} vs ${wf.totalPerformanceFee}`);
  check('a fee was actually charged, so net and gross genuinely differ',
    wf.totalPerformanceFee > 0 && ret.resultNetDividends.irr !== ret.result.dividends.irr);
  check('the POST-FEE IRR is BELOW the gross IRR (a fee cannot improve a return)',
    ret.resultNetDividends.irr !== null && ret.result.dividends.irr !== null
    && (ret.resultNetDividends.irr as number) < (ret.result.dividends.irr as number),
    `${ret.resultNetDividends.irr} vs ${ret.result.dividends.irr}`);
  check('the POST-FEE MOIC is below the gross MOIC',
    ret.resultNetDividends.moic < ret.result.dividends.moic);
  check('the fee never exceeds the cash there was to distribute',
    wf.totalPerformanceFee <= wf.totalDistributions + EPS);
}

console.log('\n=== 7. Toggle OFF equals today ===');
{
  const plain = runSnap();
  const off = runSnap(fundTerms(false, 0.08, 0.20));

  const dFin = firstDiff(plain.fin, off.fin, 'financials');
  check('financials snapshot identical with the toggle off', dFin === null, dFin ?? '');
  const dRet = firstDiff(plain.ret, off.ret, 'returns');
  check('returns snapshot identical with the toggle off', dRet === null, dRet ?? '');

  for (const [label, r] of [['no fund block', plain.ret], ['populated but disabled', off.ret]] as const) {
    const wf: WaterfallSnapshot = r.waterfall;
    check(`${label}: the waterfall is inactive`, wf.active === false);
    check(`${label}: every waterfall total is zero`,
      wf.totalPerformanceFee === 0 && wf.totalDistributions === 0 && wf.totalEquityDrawn === 0
      && wf.totalHurdlePaid === 0 && wf.totalHurdleAccrued === 0 && wf.hurdleShortfall === 0);
    check(`${label}: no fee is charged in any period`, wf.performanceFeePerPeriod.every((v) => v === 0));
    const dStream = firstDiff(r.netDividendStreamPerPeriod, r.dividendStreamPerPeriod, 'net-vs-gross');
    check(`${label}: the net stream is byte-identical to the gross stream`, dStream === null, dStream ?? '');
    const dSummary = firstDiff(r.resultNetDividends, r.result.dividends, 'net-vs-gross summary');
    check(`${label}: the net summary is byte-identical to the gross summary`, dSummary === null, dSummary ?? '');
  }

  const empty = emptyWaterfall(5);
  const offPath = computeDistributionWaterfall({
    equityDrawnPerPeriod: [1, 2, 3, 4, 5], distributionsPerPeriod: [9, 9, 9, 9, 9],
    hurdleRate: 0.08, performanceFeePct: 0.2, active: false,
  });
  const dEmpty = firstDiff(empty, offPath, 'empty-vs-inactive');
  check('an inactive run is identical to the empty waterfall, populated inputs and all',
    dEmpty === null, dEmpty ?? '');
  check('an inactive run reports no rate, so a disabled hurdle cannot be read as live',
    offPath.hurdleRate === 0 && offPath.performanceFeePct === 0);
}

console.log('\n=== 8. Step 1 guard still green ===');
{
  let code = 1, out = '';
  try {
    out = execSync('npx tsx scripts/verify-fund-layer-guard.ts', {
      cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024,
    });
    code = 0;
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    code = err.status ?? 1;
    out = (err.stdout ?? '') + (err.stderr ?? err.message ?? '');
  }
  const m = /=== Result: (\d+) passed, (\d+) failed ===/.exec(out);
  check('verify-fund-layer-guard passes', code === 0, `exit ${code}`);
  check('and reports zero failures', m !== null && m[2] === '0', m ? `${m[1]}/${m[2]}` : 'no result line');
}

console.log('\n=== 9. House style ===');
{
  const emDash = new RegExp('[\\u2014\\u2015]');
  for (const p of [
    'src/core/calculations/returns/waterfall.ts',
    'src/hubs/modeling/platforms/refm/lib/returns-resolvers.ts',
    'scripts/verify-fund-waterfall.ts',
    'docs/FUND_LAYER_GUIDELINE.md',
  ]) check(`no em dash in ${p.split('/').pop()}`, !emDash.test(readFileSync(join(root, p), 'utf8')));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
