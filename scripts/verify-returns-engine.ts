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
import {
  developmentEconomics, exitAnalysis, sourcesUses, fundingMix,
  equityExposure, stabilizationMetrics, debtAnalytics,
} from '../src/core/calculations/returns/analytics';
import { computePartnerReturns } from '../src/core/calculations/returns/partners';
import { buildSponsorStreamsForExit } from '../src/core/calculations/returns/streamBuild';
import { computeSensitivity } from '../src/core/calculations/returns/sensitivity';
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

// ── M5 Pass 1 analytics (2026-06-02) ──────────────────────────────────
{
  // Development economics: GDV 1000, dev cost 700, financing 50.
  const de = developmentEconomics(1000, 700, 50);
  check('devEcon: profitBeforeFinancing = 300', near(de.profitBeforeFinancing, 300));
  check('devEcon: profitAfterFinancing = 250', near(de.profitAfterFinancing, 250));
  check('devEcon: developmentMargin = 25%', near(de.developmentMargin, 0.25));
  check('devEcon: costToValue = 70%', near(de.costToValue, 0.70));
  check('devEcon: GDV 0 => null margin', developmentEconomics(0, 700, 50).developmentMargin === null);

  // Exit analysis ratios.
  const ex = exitAnalysis({ exitYearLabel: 2035, exitNOI: 100, exitEBITDA: 120, exitEnterpriseValue: 1250, exitEquityValue: 800, exitDebt: 450 });
  check('exit: LTV = 450/1250 = 36%', near(ex.ltvAtExit, 0.36));
  check('exit: debtYield = 100/450', near(ex.debtYield, 100 / 450, 1e-6));
  check('exit: capRate = 100/1250 = 8%', near(ex.capRate, 0.08));
  check('exit: zero debt => debtYield null', exitAnalysis({ exitYearLabel: 0, exitNOI: 100, exitEBITDA: 0, exitEnterpriseValue: 1250, exitEquityValue: 1250, exitDebt: 0 }).debtYield === null);

  // Sources & uses: operating cash balances the gap when cost > funding.
  const su = sourcesUses({ existingEquity: 100, newEquityCash: 200, inKindEquity: 50, existingDebt: 0, newDebt: 300, customerCollections: 0, land: 150, construction: 600, idc: 40 });
  check('S&U: totalUses base = 790 (no surplus)', near(su.totalUses, 790));
  check('S&U: operatingCash = 790 − 650 = 140', near(su.operatingCash, 140));
  check('S&U: reservesDistributions = 0 (cost > funding)', near(su.reservesDistributions, 0));
  check('S&U: totalSources = totalUses (balanced)', near(su.totalSources, su.totalUses));
  // Over-funded case: pre-sales push funding above cost -> reserves/distributions.
  const su2 = sourcesUses({ existingEquity: 100, newEquityCash: 200, inKindEquity: 0, existingDebt: 0, newDebt: 300, customerCollections: 400, land: 150, construction: 600, idc: 40 });
  check('S&U over-funded: operatingCash = 0', near(su2.operatingCash, 0));
  check('S&U over-funded: reserves = 1000 − 790 = 210', near(su2.reservesDistributions, 210));
  check('S&U over-funded: balanced', near(su2.totalSources, su2.totalUses));
  // Funding mix sums to ~100% (customer 400/1000 = 40%, debt 300/1000 = 30%).
  const mix = fundingMix(su2);
  check('mix: customer funding = 40%', near(mix.customerFundingPct, 0.40));
  check('mix: debt = 30%', near(mix.debtPct, 0.30));
  check('mix: cash equity = 30%', near(mix.cashEquityPct, 0.30));

  // Equity exposure on a signed FCFE stream.
  const ee = equityExposure({
    fcfePerPeriod: [-100, -50, 30, 80, 120],
    streamYearLabels: [2025, 2026, 2027, 2028, 2029],
    cumulativeEquityPerPeriod: [100, 150, 150, 150, 150],
    totalEquityRequired: 150,
    dividendsPerPeriod: [0, 0, 0, 25, 40],
    axisYearLabels: [2025, 2026, 2027, 2028, 2029],
  });
  check('equityExp: maxNegativeCumulativeCF = 150 (after −100,−50)', near(ee.maxNegativeCumulativeCF, 150));
  check('equityExp: firstPositiveCFYear = 2027', ee.firstPositiveCFYear === 2027);
  check('equityExp: firstDividendYear = 2028', ee.firstDividendYear === 2028);
  check('equityExp: equityAtRisk = 150', near(ee.equityAtRisk, 150));
  check('equityExp: averageEquityInvested = mean(100,150,150,150,150)=140', near(ee.averageEquityInvested, 140));

  // Stabilization: NOI ramps to 100; stabilises (≥95) at 2028.
  const st = stabilizationMetrics({ noiPerPeriod: [0, 40, 80, 96, 100], stabilisedNOI: 100, stabilisedYieldOnCost: 0.09, axisYearLabels: [2025, 2026, 2027, 2028, 2029] });
  check('stab: hasIncomeAssets = true', st.hasIncomeAssets === true);
  check('stab: stabilizationYear = 2028 (first ≥95)', st.stabilizationYear === 2028);
  check('stab: no income => null year', stabilizationMetrics({ noiPerPeriod: [0, 0, 0], stabilisedNOI: 0, stabilisedYieldOnCost: null, axisYearLabels: [2025, 2026, 2027] }).stabilizationYear === null);

  // Debt analytics: peak 1000, repaid to 200 at exit (idx 4).
  const da = debtAnalytics({ debtOutstandingPerPeriod: [1000, 800, 600, 400, 200, 0], exitIdx: 4, axisYearLabels: [2025, 2026, 2027, 2028, 2029, 2030] });
  check('debt: peakDebt = 1000', near(da.peakDebt, 1000));
  check('debt: remainingDebtAtExit = 200', near(da.remainingDebtAtExit, 200));
  check('debt: paydownPct = (1000−200)/1000 = 80%', near(da.paydownPct, 0.80));
  check('debt: avgDebtOutstanding = mean(1000,800,600,400,200)=600', near(da.averageDebtOutstanding, 600));
  check('debt: tenor = 2029−2025+1 = 5 yrs (to last outstanding)', da.tenorYears === 5);
}

// ── M5 Pass 2: multi-partner equity returns ───────────────────────────
{
  // Two partners, auto shareholding from contributions (600 / 400 = 60/40).
  // dividends per period [0,400,400], exit at idx 2, terminal equity 1000.
  const ps = computePartnerReturns({
    partners: [
      { id: 'A', name: 'Sponsor', cashContribution: 600, inKindContribution: 0, existingContribution: 0 },
      { id: 'B', name: 'JV', cashContribution: 400, inKindContribution: 0, existingContribution: 0 },
    ],
    dividendsPerPeriod: [0, 400, 400],
    terminalEquityValue: 1000,
    exitIdx: 2,
    totalProjectEquity: 1000,
    streamYearLabels: [2025, 2026, 2027, 2028],
  });
  check('partner: auto share A = 60%', near(ps.partners[0].shareholdingPct, 0.6));
  check('partner: auto share B = 40%', near(ps.partners[1].shareholdingPct, 0.4));
  check('partner: shareholding sums to 100%', near(ps.shareholdingSum, 1));
  check('partner: contributions reconcile (1000 == 1000)', ps.contributionsReconcile && near(ps.contributionDelta, 0));
  check('partner A dividends = 800 x 0.6 = 480', near(ps.partners[0].dividendsReceived, 480));
  check('partner A terminal = 1000 x 0.6 = 600', near(ps.partners[0].terminalDistribution, 600));
  check('partner A returned = 1080', near(ps.partners[0].totalCashReturned, 1080));
  check('partner A equity multiple = 1080/600 = 1.8x', near(ps.partners[0].equityMultiple, 1.8));
  check('partner A MOIC matches stream', near(ps.partners[0].moic, 1.8));
  check('partner A IRR finite', ps.partners[0].irr !== null && Number.isFinite(ps.partners[0].irr));
  check('partner stream A inception = -600', near(ps.partners[0].cashFlowStream[0], -600));
  // Sum of partner streams = lumped project equity stream (lifetime).
  const partnerLifetime = ps.totalStream.reduce((s, v) => s + v, 0);
  check('partner total stream lifetime = -1000 + 800 + 1000 = 800', near(partnerLifetime, 800));
  check('partner total stream[exit] = div + terminal = 1400', near(ps.totalStream[3], 1400));
  check('partner not manual mode (auto)', ps.manualMode === false);

  // Manual override: share ignores contribution split.
  const psm = computePartnerReturns({
    partners: [
      { id: 'A', name: 'Sponsor', cashContribution: 100, inKindContribution: 0, existingContribution: 0, manualShareholdingPct: 70 },
      { id: 'B', name: 'JV', cashContribution: 900, inKindContribution: 0, existingContribution: 0, manualShareholdingPct: 30 },
    ],
    dividendsPerPeriod: [0, 0, 1000],
    terminalEquityValue: 0,
    exitIdx: 2,
    totalProjectEquity: 1000,
    streamYearLabels: [2025, 2026, 2027, 2028],
  });
  check('partner manual: share A = 70% (override, not 10%)', near(psm.partners[0].shareholdingPct, 0.7));
  check('partner manual mode flagged', psm.manualMode === true);
  check('partner manual: dividends A = 1000 x 0.7 = 700', near(psm.partners[0].dividendsReceived, 700));

  // Empty partners => empty snapshot, no throw.
  const pe = computePartnerReturns({ partners: [], dividendsPerPeriod: [0, 100], terminalEquityValue: 0, exitIdx: 1, totalProjectEquity: 0, streamYearLabels: [2025, 2026, 2027] });
  check('partner: empty input => no partners', pe.partners.length === 0);
}

// ── M5 Pass 2: two-way sensitivity ────────────────────────────────────
{
  const inputs = {
    cfoAxis: [0, 0, 500, 500, 500, 500],
    cfiAxis: [-1000, -500, 0, 0, 0, 0],
    inKindAxis: [0, 0, 0, 0, 0, 0],
    debtDrawAxis: [600, 300, 0, 0, 0, 0],
    principalAxis: [0, 0, -150, -150, -150, -150],
    interestAxis: [0, -50, -40, -30, -20, -10],
    noiPerPeriod: [0, 0, 500, 500, 500, 500],
    debtOutstandingPerPeriod: [600, 900, 750, 600, 450, 300],
    existingPreCapex: 0,
    existingDebtOpening: 0,
  };
  const terminal = { method: 'exit_multiple' as const, exitMultiple: 8, perpetuityGrowth: 0.02, discountRate: 0.10 };
  const baseFcfe = buildSponsorStreamsForExit(inputs, 5, terminal).fcfe;
  const baseIrr = irr(baseFcfe);

  // Neutral cell (no shock) == base equity IRR.
  const g0 = computeSensitivity({ inputs, terminal, exitIdx: 5, x: { variable: 'sales_price_pct', values: [0] }, y: { variable: 'construction_cost_pct', values: [0] } });
  check('sensitivity: neutral cell == base equity IRR', (g0.irr[0][0] === null && baseIrr === null) || near(g0.irr[0][0] ?? NaN, baseIrr ?? NaN, 1e-9));
  check('sensitivity: baseEquityIrr == base', (g0.baseEquityIrr === null && baseIrr === null) || near(g0.baseEquityIrr ?? NaN, baseIrr ?? NaN, 1e-9));
  check('sensitivity: implied exit cap rate = NOI/EV = 500/4000 = 12.5%', near(g0.impliedExitCapRate, 0.125));

  // Lower exit cap rate => higher EV => higher IRR.
  const gc = computeSensitivity({ inputs, terminal, exitIdx: 5, x: { variable: 'exit_cap_rate', values: [0.05, 0.10] }, y: { variable: 'sales_price_pct', values: [0] } });
  check('sensitivity: lower cap rate gives higher IRR', (gc.irr[0][0] ?? -1) > (gc.irr[0][1] ?? -1));

  // +10% construction cost => lower IRR than base (0%).
  const gk = computeSensitivity({ inputs, terminal, exitIdx: 5, x: { variable: 'construction_cost_pct', values: [0, 0.10] }, y: { variable: 'sales_price_pct', values: [0] } });
  check('sensitivity: +10% construction cost lowers IRR', (gk.irr[0][1] ?? 1) < (gk.irr[0][0] ?? 1));

  // +10% sales price => higher IRR than base.
  const gp = computeSensitivity({ inputs, terminal, exitIdx: 5, x: { variable: 'sales_price_pct', values: [0, 0.10] }, y: { variable: 'construction_cost_pct', values: [0] } });
  check('sensitivity: +10% sales price raises IRR', (gp.irr[0][1] ?? -1) > (gp.irr[0][0] ?? -1));

  // Grid dimensions match the axis lengths.
  const gd = computeSensitivity({ inputs, terminal, exitIdx: 5, x: { variable: 'exit_cap_rate', values: [0.07, 0.08, 0.09] }, y: { variable: 'sales_price_pct', values: [-0.05, 0, 0.05] } });
  check('sensitivity: grid is yValues x xValues', gd.irr.length === 3 && gd.irr.every((r) => r.length === 3));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
