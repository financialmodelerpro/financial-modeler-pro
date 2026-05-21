/**
 * M4 Pass 2M-C4 (2026-05-20): M4 composer BS reconciliation identities.
 *
 * End-to-end verifier on computeFinancialsSnapshot — feeds the M4
 * composer a tightly controlled state and checks the BS identities:
 *
 *   A: TOTAL ASSETS = TOTAL CURRENT ASSETS + TOTAL FIXED ASSETS
 *   B: TOTAL LIABILITIES = AP + Unearned + Escrow + Debt
 *   C: TOTAL EQUITY = Share Capital + Reserve + Retained
 *   D: TOTAL L+E = TOTAL LIABILITIES + TOTAL EQUITY
 *   E: BS Check = TOTAL ASSETS - TOTAL L+E (target ~0)
 *   F: Closing Cash from Direct CF = BS Cash (the plug identity)
 *   G: Opening Cash seed: BS Cash[0] = historicalOpeningCashTotal + netCF[0]
 *   H: Indirect Net CF = Direct Net CF identity per period
 *
 * Three fixtures: empty project, simple residential, residential with
 * pre-existing operational phase + opening cash.
 */

import {
  type Asset,
  type Phase,
  type Project,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertNear(name: string, actual: number, expected: number, tol = 1): void {
  const delta = actual - expected;
  if (Math.abs(delta) <= tol) {
    pass++;
    console.log(`  [PASS] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
    console.log(`  [FAIL] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  }
}

function buildEmptyState(): Parameters<typeof computeFinancialsSnapshot>[0] {
  const project: Project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 };
  return {
    project, phases: [phase], assets: [], subUnits: [], parcels: [], costLines: [],
    costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [], equityContributions: [],
  };
}

function buildSimpleResidentialState(): Parameters<typeof computeFinancialsSnapshot>[0] {
  const project: Project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 };
  const asset: Asset = {
    id: 'a1', phaseId: phase.id, name: 'Tower A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
  };
  return {
    project, phases: [phase], assets: [asset], subUnits: [], parcels: [], costLines: [],
    costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [], equityContributions: [],
  };
}

function buildOpeningCashState(): Parameters<typeof computeFinancialsSnapshot>[0] {
  const base = buildSimpleResidentialState();
  // Make the phase operational + carry opening cash.
  const phase = base.phases[0];
  base.phases = [{
    ...phase,
    status: 'operational',
    historicalBaseline: {
      historicalCapexTotal: 0,
      historicalEquityContributed: 1_000_000,
      historicalDebtDrawn: 500_000,
      currentDebtOutstanding: 500_000,
      cumulativeDepreciationCharged: 0,
      netBookValueFixedAssets: 0,
      last12MonthsRevenue: 0,
      last12MonthsOpex: 0,
      historicalOpeningCash: 1_500_000,
    },
  }];
  return base;
}

console.log('=== M4 Pass 2M-C4 BS reconciliation verifier ===');

// ──────────────────────────────────────────────────────────────────
// A-D: Empty project reconciliation
// ──────────────────────────────────────────────────────────────────
console.log('\n[A-D] Empty project: every BS subtotal identity holds');
{
  const snap = computeFinancialsSnapshot(buildEmptyState());
  const N = snap.axisLength;
  for (let t = 0; t < N; t++) {
    const ta = snap.bs.totalAssetsPerPeriod[t];
    const tca = snap.bs.totalCurrentAssetsPerPeriod[t];
    const tfa = snap.bs.totalFixedAssetsPerPeriod[t];
    const tl = snap.bs.totalLiabilitiesPerPeriod[t];
    const tcl = snap.bs.totalCurrentLiabilitiesPerPeriod[t];
    const debt = snap.bs.debtOutstandingPerPeriod[t];
    const te = snap.bs.totalEquityPerPeriod[t];
    const sc = snap.bs.shareCapitalPerPeriod[t];
    const res = snap.bs.statutoryReservePerPeriod[t];
    const ret = snap.bs.retainedEarningsPerPeriod[t];
    const tle = snap.bs.totalLiabilitiesAndEquityPerPeriod[t];

    assertNear(`A[t=${t}]: TA = TCA + TFA`, ta, tca + tfa);
    assertNear(`B[t=${t}]: TL = TCL + Debt`, tl, tcl + debt);
    assertNear(`C[t=${t}]: TE = SC + Reserve + Retained`, te, sc + res + ret);
    assertNear(`D[t=${t}]: TL+E = TL + TE`, tle, tl + te);
  }
}

// ──────────────────────────────────────────────────────────────────
// E-F: Simple residential, BS check + cash plug
// ──────────────────────────────────────────────────────────────────
console.log('\n[E-F] Residential: BS check and cash plug');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  const N = snap.axisLength;
  // BS check on every period should be tiny (composer's identity).
  let maxAbsDiff = 0;
  for (let t = 0; t < N; t++) {
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(snap.bs.bsDifferencePerPeriod[t]));
  }
  assertNear('E1: max |BS diff| < 1 (residential, no costs / financing)', maxAbsDiff, 0);

  // Cash plug: BS.Cash[t] = Direct.closingCash[t] for every t.
  for (let t = 0; t < Math.min(N, 4); t++) {
    assertNear(`F[t=${t}]: BS Cash = Direct.closingCash`, snap.bs.cashPerPeriod[t], snap.directCF.closingCashPerPeriod[t]);
  }
}

// ──────────────────────────────────────────────────────────────────
// G: Opening cash seed
// ──────────────────────────────────────────────────────────────────
console.log('\n[G] Opening cash seed flows into BS Cash + Direct CF');
{
  const snap = computeFinancialsSnapshot(buildOpeningCashState());
  // The composer should report historicalOpeningCashTotal = 1.5M.
  assertNear('G1: bs.historicalOpeningCashTotal = 1.5M', snap.bs.historicalOpeningCashTotal, 1_500_000);
  // The Direct CF opening cash[0] equals the seed.
  assertNear('G2: Direct.openingCash[0] = 1.5M', snap.directCF.openingCashPerPeriod[0], 1_500_000);
  // Direct CF closing cash[0] = opening + netCF[0].
  const expectedClose0 = 1_500_000 + snap.directCF.netCashFlowPerPeriod[0];
  assertNear('G3: Direct.closingCash[0] = opening + netCF[0]', snap.directCF.closingCashPerPeriod[0], expectedClose0);
}

// ──────────────────────────────────────────────────────────────────
// H: Direct vs Indirect Net CF parity
// ──────────────────────────────────────────────────────────────────
console.log('\n[H] Direct vs Indirect Net Cash Flow parity');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  const N = snap.axisLength;
  for (let t = 0; t < Math.min(N, 4); t++) {
    assertNear(`H[t=${t}]: Direct Net CF = Indirect Net CF`, snap.directCF.netCashFlowPerPeriod[t], snap.indirectCF.netCashFlowPerPeriod[t]);
  }
}

// ──────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────
// I: M4 Pass 2N-Fix (2026-05-21) — debt outstanding off-by-one regression
// pin. The previous composer / BS surfaces read fac.outstanding[t + 1],
// which (a) showed year-t+1 closing balance in the year-t column, and
// (b) zeroed out the last year (out-of-bounds read), driving a large
// BS imbalance whenever debt was NOT fully repaid by the end of axis.
// This section pins: BS debt at year t == sum of facility.outstanding[t]
// per tranche, AND last-year debt > 0 when the tranche carries a
// balance past the axis.
// ──────────────────────────────────────────────────────────────────
console.log('\n[I] Pass 2N-Fix: BS debt mirrors facility.outstanding[t] exactly (no shift, no last-year drop)');
{
  // Build a project with an EXISTING debt tranche carrying a 10M
  // opening balance + long-tail repayment past the axis end. The
  // pre-fix code read fac.outstanding[t + 1], dropping the last-year
  // closing balance to 0 (out-of-bounds). The fix reads
  // fac.outstanding[t] directly so the BS surfaces the actual closing
  // balance at every year, including the last.
  const base = buildSimpleResidentialState();
  const project: Project = { ...base.project, startDate: '2026-01-01' };
  const phase: Phase = { ...base.phases[0], constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 };
  const asset: Asset = base.assets[0];
  const tranche = {
    id: 'tr1', name: 'Existing Loan', phaseId: 'p1', sharePct: 100,
    origin: 'existing', openingBalance: 10_000_000,
    interestRatePct: 5, interbankRatePct: 0, creditSpreadPct: 5,
    repaymentMethod: 'straight_line', repaymentPeriods: 30,
    remainingRepaymentPeriods: 30, repaymentStartYear: 2026,
    interestStartYear: 2026, drawdownPattern: 'pari_passu',
  } as unknown as Parameters<typeof computeFinancialsSnapshot>[0]['financingTranches'][number];
  const state: Parameters<typeof computeFinancialsSnapshot>[0] = {
    project, phases: [phase], assets: [asset], subUnits: [], parcels: [], costLines: [],
    costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [tranche], equityContributions: [],
  };
  const snap = computeFinancialsSnapshot(state);
  const facs = Array.from(snap.financing.facilities.values());
  if (facs.length === 0) {
    fail++;
    failures.push('I-setup: facility not created');
    console.log('  [FAIL] I-setup: facility not created');
  } else {
    const fac = facs[0];
    for (let t = 0; t < snap.axisLength; t++) {
      assertNear(`I[t=${t}]: BS debt = facility.outstanding[${t}]`, snap.bs.debtOutstandingPerPeriod[t], fac.outstanding[t]);
    }
    // I-shape: pre-fix code read outstanding[t + 1], so the year-0 BS
    // showed year-1 closing (one-year-later balance). This pins that
    // BS year-0 matches the year-0 closing balance, NOT year-1.
    assertNear('I-shape: BS year-0 debt == facility.outstanding[0] (year-0 closing, not year-1)', snap.bs.debtOutstandingPerPeriod[0], fac.outstanding[0]);
    // I-opening: openingBalance field on FacilityResult should equal
    // the tranche's openingBalance (existing tranches carry pre-axis balance).
    assertNear('I-opening: fac.openingBalance == tranche.openingBalance (existing)', fac.openingBalance, 10_000_000);
  }
}

// ──────────────────────────────────────────────────────────────────
// J: M4 Pass 2N-Fix (2026-05-21) — Share Capital line on the BS
// includes pre-axis equity opening. Earlier it only used cumulative
// new draws, leaving existing equity off the BS (the user observed
// "share capital line is wrong, it needs to be closing balance from
// BS Schedules E1"). Pinned: bs.shareCapitalPerPeriod[t] equals
// priorEquity + cumulative equityDrawdownPerPeriod[0..t].
// ──────────────────────────────────────────────────────────────────
console.log('\n[J] Pass 2N-Fix: BS Share Capital includes pre-axis equity opening');
{
  const snap = computeFinancialsSnapshot(buildOpeningCashState());
  const priorEquity = snap.financing.existing.equityTotal;
  let cumDraws = 0;
  for (let t = 0; t < Math.min(snap.axisLength, 6); t++) {
    cumDraws += snap.directCF.equityDrawdownPerPeriod[t] ?? 0;
    assertNear(
      `J[t=${t}]: shareCapital = priorEquity + cumDraws`,
      snap.bs.shareCapitalPerPeriod[t],
      priorEquity + cumDraws,
    );
  }
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
