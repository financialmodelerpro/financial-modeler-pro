/* eslint-disable no-console */
/**
 * verify-financing-rebuild.ts (Tab 4 Rebuild, 2026-05-14)
 *
 * Drives a synthetic project fixture through the new
 * `src/core/calculations/financing/` engine and asserts the 9
 * reconciliation identities by construction:
 *
 *   1. Capex perPeriod sums equal totals (each of 3 rows).
 *   2. Total debt + total cash equity = capex excl land in-kind.
 *   3. Sum of facility shares = 100.
 *   4. Sum of per-facility drawdown per period = split.debt[period].
 *   5. Sum of per-facility drawdown over all periods = total debt × share.
 *   6. EquityMovement.totalCash = sum(split.equity).
 *   7. EquityMovement.totalInKind = sum(split.inKind).
 *   8. Funding.selected = methodN matching selectedMethodId.
 *   9. Sole external invariant: result.reconciliation.ok === true.
 *
 * Usage: npx tsx scripts/verify-financing-rebuild.ts
 */

import {
  type Asset,
  type Parcel,
  type SubUnit,
  type CostLine,
  type FinancingTranche,
  type EquityContribution,
  type ProjectFinancingConfig,
  makeDefaultPhase,
  makeDefaultProject,
  makeDefaultParcel,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancingResult } from '../src/core/calculations/financing';

let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const near = (a: number, b: number, eps = 1e-2): boolean => {
  const d = Math.abs(a - b);
  if (d <= eps) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return d / scale <= 1e-6;
};

// ── Fixture: one phase, one parcel, one asset, three facilities ─────────

function buildFixture() {
  const project = makeDefaultProject('Verifier Project', 'SAR', 'annual');
  project.startDate = '2026-01-01';
  project.financing = {
    fundingMethod: 1,
    fixedRatio: { debtPct: 70, equityPct: 30 },
    parcelFunding: [
      { parcelId: 'parcel_1', debtPct: 50, equityPct: 50 },
    ],
    viewMode: 'combined',
    minimumCashReserve: 0,
  } as ProjectFinancingConfig;

  const phase = makeDefaultPhase('phase_1', 'Phase 1', 4, 10, 0);
  const parcel: Parcel = {
    ...makeDefaultParcel('parcel_1', 'phase_1', 'Land 1', 100000, 500),
    cashPct: 60,
  };

  const asset: Asset = {
    id: 'asset_1',
    phaseId: 'phase_1',
    name: 'Asset 1',
    type: 'Residential',
    strategy: 'Sell',
    visible: true,
    gfaSqm: 80000,
    buaSqm: 60000,
    sellableBuaSqm: 50000,
    parkingBaysRequired: 0,
  };

  const subUnits: SubUnit[] = [];
  const costLines: CostLine[] = makeDefaultCostLines('phase_1', 4);

  const t1: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_1', 'phase_1'),
    name: 'Senior',
    interestRatePct: 6,
    facilitySharePct: 60,
    drawdownStartPeriod: 0,
    repaymentMethod: 'straight_line',
    repaymentPeriods: 8,
    gracePeriods: 1,
  };
  const t2: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_2', 'phase_1'),
    name: 'Mezz',
    interestRatePct: 10,
    facilitySharePct: 30,
    drawdownStartPeriod: 0,
    repaymentMethod: 'bullet',
    repaymentPeriods: 10,
  };
  const t3: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_3', 'phase_1'),
    name: 'Bridge',
    interestRatePct: 8,
    facilitySharePct: 10,
    drawdownStartPeriod: 0,
    repaymentMethod: 'equal_periodic_amortization',
    repaymentPeriods: 6,
  };

  const equityContributions: EquityContribution[] = [];

  return {
    project,
    phases: [phase],
    parcels: [parcel],
    assets: [asset],
    subUnits,
    costLines,
    costOverrides: [],
    landAllocationMode: 'autoByBua' as const,
    financingConfig: project.financing!,
    tranches: [t1, t2, t3],
    equityContributions,
  };
}

// ── Run ────────────────────────────────────────────────────────────────

const ctx = buildFixture();
const r = computeFinancingResult(ctx);

console.log('\n[1] Capex perPeriod sums match totals');
{
  const sumExcl   = r.capex.perPeriod.exclAllLand.reduce((s, v) => s + v, 0);
  const sumExclIK = r.capex.perPeriod.exclLandInKind.reduce((s, v) => s + v, 0);
  const sumIncl   = r.capex.perPeriod.inclAllLand.reduce((s, v) => s + v, 0);
  if (near(sumExcl, r.capex.totals.exclAllLand)) pass('exclAllLand');
  else fail('exclAllLand', `${sumExcl} vs ${r.capex.totals.exclAllLand}`);
  if (near(sumExclIK, r.capex.totals.exclLandInKind)) pass('exclLandInKind');
  else fail('exclLandInKind', `${sumExclIK} vs ${r.capex.totals.exclLandInKind}`);
  if (near(sumIncl, r.capex.totals.inclAllLand)) pass('inclAllLand');
  else fail('inclAllLand', `${sumIncl} vs ${r.capex.totals.inclAllLand}`);
}

console.log('\n[2] Debt + Cash Equity = Capex (excl land in-kind)');
{
  const tDebt = r.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
  const tEq   = r.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
  if (near(tDebt + tEq, r.capex.totals.exclLandInKind)) pass('funding identity', `${(tDebt + tEq).toFixed(0)} = ${r.capex.totals.exclLandInKind.toFixed(0)}`);
  else fail('funding identity', `${tDebt + tEq} vs ${r.capex.totals.exclLandInKind}`);
}

console.log('\n[3] Sum of facility shares = 100');
{
  let s = 0;
  for (const v of r.shares.values()) s += v;
  if (near(s, 100)) pass(`shares sum`, `${s.toFixed(4)}`);
  else fail('shares sum', `${s}`);
}

console.log('\n[4] Sum of per-facility drawdown per period = split.debt[period]');
{
  let allOk = true;
  for (let i = 0; i < r.axis.totalPeriods + 1; i++) {
    let s = 0;
    for (const f of r.facilities.values()) s += f.drawSchedule[i] ?? 0;
    if (!near(s, r.debtEquitySplit.debt[i] ?? 0)) {
      fail(`period ${i} drawdown sum`, `${s} vs ${r.debtEquitySplit.debt[i]}`);
      allOk = false;
      break;
    }
  }
  if (allOk) pass('drawdown per-period sum');
}

console.log('\n[5] Total drawdown per facility = totalDebt × share');
{
  const totalDebt = r.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
  for (const f of r.facilities.values()) {
    const expected = totalDebt * (f.sharePct / 100);
    if (near(f.totalDrawn, expected)) pass(`facility ${f.trancheId} drawdown`, `${f.totalDrawn.toFixed(0)}`);
    else fail(`facility ${f.trancheId} drawdown`, `${f.totalDrawn} vs ${expected}`);
  }
}

console.log('\n[6] EquityMovement.totalCash = sum(split.equity)');
{
  const sumEquity = r.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
  if (near(r.equity.totalCash, sumEquity)) pass('totalCash', `${r.equity.totalCash.toFixed(0)}`);
  else fail('totalCash', `${r.equity.totalCash} vs ${sumEquity}`);
}

console.log('\n[7] EquityMovement.totalInKind = sum(split.inKind)');
{
  const sumIK = r.debtEquitySplit.inKind.reduce((s, v) => s + v, 0);
  if (near(r.equity.totalInKind, sumIK)) pass('totalInKind', `${r.equity.totalInKind.toFixed(0)}`);
  else fail('totalInKind', `${r.equity.totalInKind} vs ${sumIK}`);
}

console.log('\n[8] Funding.selected mirrors selectedMethodId');
{
  const expected =
    r.funding.selectedMethodId === 1 ? r.funding.method1
    : r.funding.selectedMethodId === 2 ? r.funding.method2
    : r.funding.method3;
  if (near(r.funding.selected, expected)) pass('selected matches', `m${r.funding.selectedMethodId} = ${r.funding.selected.toFixed(0)}`);
  else fail('selected matches', `${r.funding.selected} vs ${expected}`);
}

console.log('\n[9] Engine reconciliation.ok');
{
  if (r.reconciliation.ok) pass('reconciliation.ok = true');
  else {
    fail('reconciliation.ok', 'false');
    for (const msg of r.reconciliation.issues) console.log(`     - ${msg}`);
  }
}

console.log('\n[10] Outstanding balance drops to zero (each fully-amortising facility)');
{
  const last = r.axis.totalPeriods;
  for (const f of r.facilities.values()) {
    const remain = f.outstanding[last] ?? 0;
    if (near(remain, 0)) pass(`facility ${f.trancheId} amortised`);
    else fail(`facility ${f.trancheId} amortised`, `remain ${remain}`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
