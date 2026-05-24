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
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';

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
// priorEquity + cumulative equityDrawdownPerPeriod[0..t]. AND the
// equityDrawdownPerPeriod does NOT include the existing-equity lump
// (that lump is captured by priorEquity instead, avoiding the
// double-count that caused the BS to drift by priorEquity at year 0).
// ──────────────────────────────────────────────────────────────────
console.log('\n[J] Pass 2N-Fix: BS Share Capital includes pre-axis equity opening (no double-count)');
{
  // Build a fixture with non-zero asset historicalEquityAmount so
  // priorEquity > 0, and verify BS shareCapital tracks it correctly
  // across the axis.
  const base = buildOpeningCashState();
  const project: Project = { ...base.project, startDate: '2026-01-01' };
  const phase: Phase = { ...base.phases[0], status: 'operational', constructionPeriods: 0, operationsPeriods: 6 };
  const asset: Asset = {
    ...base.assets[0],
    status: 'operational',
    historicalEquityAmount: 5_000_000,
    historicalPreCapexLand: 3_000_000,
    historicalPreCapexBuilding: 2_000_000,
  } as Asset;
  const state: Parameters<typeof computeFinancialsSnapshot>[0] = {
    ...base,
    project,
    phases: [phase],
    assets: [asset],
  };
  const snap = computeFinancialsSnapshot(state);
  const priorEquity = snap.financing.existing.equityTotal;
  if (priorEquity !== 5_000_000) {
    fail++;
    failures.push(`J-setup: priorEquity expected 5,000,000 got ${priorEquity}`);
    console.log(`  [FAIL] J-setup: priorEquity = ${priorEquity}, expected 5,000,000`);
  } else {
    pass++;
    console.log(`  [PASS] J-setup: priorEquity = 5,000,000`);
  }
  let cumDraws = 0;
  for (let t = 0; t < Math.min(snap.axisLength, 4); t++) {
    cumDraws += snap.directCF.equityDrawdownPerPeriod[t] ?? 0;
    assertNear(
      `J[t=${t}]: shareCapital = priorEquity + cumDraws`,
      snap.bs.shareCapitalPerPeriod[t],
      priorEquity + cumDraws,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// K: M4 Pass 2P (2026-05-24) — CF equity split (cash vs in-kind)
// Pinned:
//   K1: directCF.equityDrawdownPerPeriod equals financing.equity.cashPerPeriod
//       (CF carries cash only).
//   K2: directCF.equityInKindDrawdownPerPeriod equals financing.equity.inKindPerPeriod
//       (in-kind is a memo, separate from CF cash).
//   K3: cashFromFinancing does NOT include in-kind (sum identity).
// ──────────────────────────────────────────────────────────────────
console.log('\n[K] Pass 2P: CF equity is cash only; in-kind is memo');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  for (let t = 0; t < snap.axisLength; t++) {
    assertNear(
      `K1[t=${t}]: directCF.equityDrawdownPerPeriod == financing.equity.cashPerPeriod`,
      snap.directCF.equityDrawdownPerPeriod[t] ?? 0,
      snap.financing.equity.cashPerPeriod[t] ?? 0,
    );
    assertNear(
      `K2[t=${t}]: directCF.equityInKindDrawdownPerPeriod == financing.equity.inKindPerPeriod`,
      snap.directCF.equityInKindDrawdownPerPeriod[t] ?? 0,
      snap.financing.equity.inKindPerPeriod[t] ?? 0,
    );
    // K3: cashFromFinancing = cash equity + debt draws - debt repays - interest paid (no in-kind).
    // Sign convention: interestPaidPerPeriod is already negative on directCF; debtRepaymentPerPeriod negative.
    const reconstructed = (snap.directCF.equityDrawdownPerPeriod[t] ?? 0)
      + (snap.directCF.debtDrawdownPerPeriod[t] ?? 0)
      + (snap.directCF.debtRepaymentPerPeriod[t] ?? 0)
      + (snap.directCF.interestPaidPerPeriod[t] ?? 0);
    assertNear(
      `K3[t=${t}]: cashFromFinancing = cashEquity + debtDraws + debtRepays(neg) + interest(neg)`,
      snap.directCF.cashFromFinancingPerPeriod[t] ?? 0,
      reconstructed,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// L: M4 Pass 2P (2026-05-24) — Retained Earnings roll-forward identity
// Pinned per period: retained[t] − retained[t−1]
//                    = pat[t] − statutoryReserveTransfer[t] − dividends[t]
// ──────────────────────────────────────────────────────────────────
console.log('\n[L] Pass 2P: Retained Earnings roll-forward identity');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  for (let t = 0; t < snap.axisLength; t++) {
    const opening = t === 0 ? 0 : (snap.bs.retainedEarningsPerPeriod[t - 1] ?? 0);
    const expectedClosing = opening
      + (snap.pl.patPerPeriod[t] ?? 0)
      - (snap.bs.statutoryReserveTransferPerPeriod[t] ?? 0)
      - (snap.bs.dividendsPerPeriod[t] ?? 0);
    assertNear(
      `L[t=${t}]: retained[t] = opening + PAT − transfer − dividend`,
      snap.bs.retainedEarningsPerPeriod[t] ?? 0,
      expectedClosing,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// M: M4 Pass 2R (2026-05-24) — Funding Gap identities
//   M1: Method A per period = capex − (preSales − escrowHeld)
//   M2: Method A cumulative = running sum of methodAGapPerPeriod
//   M3: Method B per period = max(0, −(ops + inv))
//   M4: preFinancingNetCf = ops + inv (no clamping)
//   M5: Method B grand total = sum of methodBGapPerPeriod
// ──────────────────────────────────────────────────────────────────
console.log('\n[M] Pass 2R: Funding Gap identities');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  const gap = computeFundingGap(snap);
  let runningA = 0;
  let runningB = 0;
  for (let t = 0; t < snap.axisLength; t++) {
    // M4 Pass 2T-Fix (2026-05-24): Method A uses LAGGED pre-sales.
    //   gap[t] = MAX(0, capex[t] − preSalesNet[t-1])
    // First-period gap = full capex (no prior-year pre-sales available).
    const presLagged = t === 0
      ? 0
      : ((gap.preSalesGrossPerPeriod[t - 1] ?? 0)
        - (gap.escrowHeldPerPeriod[t - 1] ?? 0)
        + (gap.escrowReleasePerPeriod[t - 1] ?? 0));
    const expectedA = Math.max(0, (gap.capexPerPeriod[t] ?? 0) - presLagged);
    assertNear(`M1[t=${t}]: methodA = MAX(0, capex − preSalesNet[t-1])`, gap.methodAGapPerPeriod[t] ?? 0, expectedA);
    runningA += expectedA;
    assertNear(`M2[t=${t}]: methodA cumulative`, gap.methodAGapCumulative[t] ?? 0, runningA);
    const expectedFulfilled = Math.min(gap.capexPerPeriod[t] ?? 0, Math.max(0, presLagged));
    assertNear(`M1b[t=${t}]: fulfilled = MIN(capex, max(0, preSalesNet[t-1]))`, gap.fulfilledByPreSalesPerPeriod[t] ?? 0, expectedFulfilled);

    const ops = gap.cashFromOpsPerPeriod[t] ?? 0;
    const inv = gap.cashFromInvPerPeriod[t] ?? 0;
    // M4 Pass 2T-Fix #2 (2026-05-24): Method B lagged. preFinancingNetCf
    // uses ops[t-1] + inv[t], not same-period ops.
    const opsLagged = t === 0 ? 0 : (gap.cashFromOpsPerPeriod[t - 1] ?? 0);
    assertNear(`M4[t=${t}]: preFinancingNetCf = ops[t-1] + inv[t]`, gap.preFinancingNetCfPerPeriod[t] ?? 0, opsLagged + inv);
    const expectedB = Math.max(0, -(opsLagged + inv));
    assertNear(`M3[t=${t}]: methodB = max(0, −(ops[t-1] + inv[t]))`, gap.methodBGapPerPeriod[t] ?? 0, expectedB);
    void ops; // same-period ops kept on the snapshot for display only
    runningB += expectedB;
    assertNear(`M2-B[t=${t}]: methodB cumulative`, gap.methodBGapCumulative[t] ?? 0, runningB);
  }
  assertNear(
    'M5: methodB grand total = sum of per-period deficit',
    gap.methodBTotalGap,
    gap.methodBGapPerPeriod.reduce((s, v) => s + v, 0),
  );
}

// ──────────────────────────────────────────────────────────────────
// N: M4 Pass 2S (2026-05-24) — Cash Sweep identities
//   N1: snapshot always carries a cashSweep object (enabled false when
//       no tranche has sweep config)
//   N2: when enabled, sum(eligibleTranches[i].sweepPerPeriod[t]) == totalSweepPerPeriod[t]
//   N3: adjustedDebtOutstanding[t] <= sum(facility.outstanding[t]) (sweep
//       only reduces debt, never increases)
//   N4: BS still balances under default fixture (no sweep configured)
// ──────────────────────────────────────────────────────────────────
console.log('\n[N] Pass 2S: Cash Sweep identities');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  // N1: cashSweep always present
  if (!snap.cashSweep || typeof snap.cashSweep.enabled !== 'boolean') {
    fail++;
    failures.push('N1: snap.cashSweep missing');
    console.log('  [FAIL] N1: snap.cashSweep missing');
  } else {
    pass++;
    console.log(`  [PASS] N1: snap.cashSweep present (enabled=${snap.cashSweep.enabled})`);
  }
  // N3 (no sweep): adjustedDebt equals raw sum of facility outstandings
  let rawDebtMatch = true;
  for (let t = 0; t < snap.axisLength; t++) {
    let raw = 0;
    for (const fac of snap.financing.facilities.values()) raw += fac.outstanding[t] ?? 0;
    if (Math.abs(raw - (snap.cashSweep.adjustedDebtOutstanding[t] ?? 0)) > 1) {
      rawDebtMatch = false;
      break;
    }
  }
  if (rawDebtMatch) {
    pass++;
    console.log('  [PASS] N3 (no sweep): adjustedDebtOutstanding == raw sum of facility.outstanding');
  } else {
    fail++;
    failures.push('N3: adjustedDebtOutstanding diverges from raw facility sum when no sweep configured');
    console.log('  [FAIL] N3: adjustedDebtOutstanding diverges from raw facility sum when no sweep configured');
  }
  // N4: BS still balances under default fixture
  const maxAbs = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  if (maxAbs < 1) {
    pass++;
    console.log(`  [PASS] N4: BS still balances with sweep wired in (maxAbsDiff=${maxAbs.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`N4: BS diff ${maxAbs.toFixed(2)} > 1 after sweep wire-up`);
    console.log(`  [FAIL] N4: BS diff ${maxAbs.toFixed(2)} > 1 after sweep wire-up`);
  }
}

// ──────────────────────────────────────────────────────────────────
// O: M4 Pass 2T (2026-05-24) — Dividend waterfall identities
//   O1: snap.dividends always present
//   O2: when no phase has dividendPolicy.enabled, dividends.enabled === false
//       and totalDividends === 0
//   O3: bs.dividendsPerPeriod equals snap.dividends.totalDividendsPerPeriod
//   O4: BS still balances under default fixture
// ──────────────────────────────────────────────────────────────────
console.log('\n[O] Pass 2T: Dividend waterfall identities');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  if (!snap.dividends || typeof snap.dividends.enabled !== 'boolean') {
    fail++;
    failures.push('O1: snap.dividends missing');
    console.log('  [FAIL] O1: snap.dividends missing');
  } else {
    pass++;
    console.log(`  [PASS] O1: snap.dividends present (enabled=${snap.dividends.enabled})`);
  }
  if (snap.dividends.enabled === false && snap.dividends.totalDividends === 0) {
    pass++;
    console.log('  [PASS] O2: dividends disabled with zero total when no phase opts in');
  } else {
    fail++;
    failures.push(`O2: expected dividends disabled & total 0; got enabled=${snap.dividends.enabled}, total=${snap.dividends.totalDividends}`);
    console.log(`  [FAIL] O2: dividends enabled=${snap.dividends.enabled}, total=${snap.dividends.totalDividends}`);
  }
  let mirror = true;
  for (let t = 0; t < snap.axisLength; t++) {
    if (Math.abs((snap.bs.dividendsPerPeriod[t] ?? 0) - (snap.dividends.totalDividendsPerPeriod[t] ?? 0)) > 1) {
      mirror = false;
      break;
    }
  }
  if (mirror) {
    pass++;
    console.log('  [PASS] O3: bs.dividendsPerPeriod mirrors dividends.totalDividendsPerPeriod');
  } else {
    fail++;
    failures.push('O3: bs.dividendsPerPeriod diverges from dividends.totalDividendsPerPeriod');
    console.log('  [FAIL] O3: bs.dividendsPerPeriod diverges from dividends.totalDividendsPerPeriod');
  }
  const maxAbs = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  if (maxAbs < 1) {
    pass++;
    console.log(`  [PASS] O4: BS still balances with dividend wire-up (maxAbsDiff=${maxAbs.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`O4: BS diff ${maxAbs.toFixed(2)} > 1 after dividend wire-up`);
    console.log(`  [FAIL] O4: BS diff ${maxAbs.toFixed(2)} > 1 after dividend wire-up`);
  }
}

// ──────────────────────────────────────────────────────────────────
// P: M4 Pass 2T-Fix (2026-05-24) — Dividend EBITDA cap
//   P1: enable dividend on the fixture's operational phase with 100%
//       payout. Cumulative dividend per phase MUST equal cumulative
//       phase EBITDA (cap binds when payout is large enough to exhaust
//       both cash AND EBITDA).
//   P2: dividend in any period <= excess available (no overdistribution).
//   P3: cumulative dividend per phase <= cumulative EBITDA per phase
//       at every period (cap never breached).
//   P4: BS still balances under dividend pressure.
// ──────────────────────────────────────────────────────────────────
console.log('\n[P] Pass 2T-Fix: Dividend EBITDA cap');
{
  // Use the simple residential fixture and just enable dividend on its
  // phase. Dividend gets capped by the project's EBITDA cap. Even when
  // the project has no positive EBITDA in fixtures (CoS exceeds rev in
  // early years), the cap should fire correctly (no negative dividend).
  const base = buildSimpleResidentialState();
  const phase: Phase = {
    ...base.phases[0],
    dividendPolicy: { enabled: true, priority: 'after_sweep', payoutRatio: 100 },
  };
  const state: Parameters<typeof computeFinancialsSnapshot>[0] = {
    ...base,
    phases: [phase],
  };
  const snap = computeFinancialsSnapshot(state);
  const phaseRow = [...snap.dividends.beforeSweepPhases, ...snap.dividends.afterSweepPhases].find((r) => r.phaseId === phase.id);
  if (!phaseRow) {
    fail++;
    failures.push('P-setup: dividend phase row missing');
    console.log('  [FAIL] P-setup: dividend phase row missing');
  } else {
    // P3: cumulative dividend never exceeds cumulative EBITDA per period.
    let capOk = true;
    let cumDiv = 0;
    for (let t = 0; t < snap.axisLength; t++) {
      cumDiv += phaseRow.dividendsPerPeriod[t] ?? 0;
      const cumEb = phaseRow.cumulativeEbitdaPerPeriod[t] ?? 0;
      if (cumDiv > cumEb + 1) {
        capOk = false;
        failures.push(`P3[t=${t}]: cumDiv ${cumDiv} > cumEbitda ${cumEb}`);
        console.log(`  [FAIL] P3[t=${t}]: cumDiv ${cumDiv} > cumEbitda ${cumEb}`);
        break;
      }
    }
    if (capOk) {
      pass++;
      console.log('  [PASS] P3: cumulative dividend <= cumulative EBITDA at every period');
    } else {
      fail++;
    }
    // P1: when payout is 100% and excess cash is plentiful, total
    // dividends should equal totalPhaseEbitda (cap binds). If excess
    // cash is the binding constraint, we'll have totalDividends <= EBITDA.
    // Either way, we test the cap upper bound: total <= EBITDA.
    if (phaseRow.totalDividends <= phaseRow.totalPhaseEbitda + 1) {
      pass++;
      console.log(`  [PASS] P1: totalDividends ${phaseRow.totalDividends.toFixed(2)} <= totalPhaseEbitda ${phaseRow.totalPhaseEbitda.toFixed(2)}`);
    } else {
      fail++;
      failures.push(`P1: totalDividends ${phaseRow.totalDividends} > totalPhaseEbitda ${phaseRow.totalPhaseEbitda}`);
      console.log(`  [FAIL] P1: totalDividends ${phaseRow.totalDividends} > totalPhaseEbitda ${phaseRow.totalPhaseEbitda}`);
    }
  }
  // P4: BS still balances under dividend.
  const maxAbs = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  if (maxAbs < 1) {
    pass++;
    console.log(`  [PASS] P4: BS still balances under dividend pressure (maxAbsDiff=${maxAbs.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`P4: BS diff ${maxAbs.toFixed(2)} > 1 under dividend pressure`);
    console.log(`  [FAIL] P4: BS diff ${maxAbs.toFixed(2)} > 1 under dividend pressure`);
  }
}

// ──────────────────────────────────────────────────────────────────
// Q: M4 Pass 2U (2026-05-24) — Method 3 detailed waterfall identities
//   Q1: snap exposes gap.method3Waterfall
//   Q2: per period, Cash Available Before New Debt
//       = Opening + Ops + Inv + ExistingEquity + ExistingDebtDraw
//         + ExistingDebtRepayment(neg) + FinanceCostPaid(neg)
//         + DividendsBeforeSweep(neg)
//   Q3: Net Cash Required = max(0, minCash − Cash Available)
//   Q4: Opening Cash[t+1] = max(minCash, Cash Available[t]) when net
//       required plugs the gap (forward-walk consistency)
// ──────────────────────────────────────────────────────────────────
console.log('\n[Q] Pass 2U: Method 3 detailed waterfall identities');
{
  const snap = computeFinancialsSnapshot(buildSimpleResidentialState());
  const gap = computeFundingGap(snap);
  const w = gap.method3Waterfall;
  if (w) {
    pass++;
    console.log('  [PASS] Q1: snap.gap.method3Waterfall present');
  } else {
    fail++;
    failures.push('Q1: method3Waterfall missing');
    console.log('  [FAIL] Q1: method3Waterfall missing');
    process.exit(1);
  }
  for (let t = 0; t < w.axisLength; t++) {
    const expectedAvail = (w.openingCashPerPeriod[t] ?? 0)
      + (w.cashFromOpsPerPeriod[t] ?? 0)
      + (w.cashFromInvPerPeriod[t] ?? 0)
      + (w.existingEquityDrawdownPerPeriod[t] ?? 0)
      + (w.existingDebtDrawdownPerPeriod[t] ?? 0)
      + (w.existingDebtRepaymentPerPeriod[t] ?? 0)
      + (w.financeCostPaidPerPeriod[t] ?? 0)
      + (w.dividendsBeforeSweepPerPeriod[t] ?? 0);
    assertNear(`Q2[t=${t}]: cashAvailable identity`, w.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0, expectedAvail);
    const expectedReq = Math.max(0, w.minCashReserve - (w.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0));
    assertNear(`Q3[t=${t}]: netCashRequired = max(0, minCash − cashAvail)`, w.netCashRequiredPerPeriod[t] ?? 0, expectedReq);
    if (t + 1 < w.axisLength) {
      const expectedOpeningNext = Math.max(w.minCashReserve, w.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0);
      assertNear(`Q4[t=${t}→${t+1}]: opening cash forward-walk`, w.openingCashPerPeriod[t + 1] ?? 0, expectedOpeningNext);
    }
  }
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
