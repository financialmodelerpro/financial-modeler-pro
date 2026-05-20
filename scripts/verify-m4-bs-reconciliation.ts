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
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
