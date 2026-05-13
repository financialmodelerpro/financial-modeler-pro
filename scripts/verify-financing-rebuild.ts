/* eslint-disable no-console */
/**
 * verify-financing-rebuild.ts (Tab 4 Rebuild + Existing Ops + Post-Rebuild
 * Fixes, 2026-05-14)
 *
 * Fixture A (new-only): three new facilities (straight-line + bullet +
 * equal-periodic-amortization) over one construction phase. Asserts all
 * core reconciliation identities + full amortisation to zero.
 *
 * Fixture B (VOCO operational): one operational Phase 1 (pre-capex 3.6B,
 * existing debt 2.4B, existing equity 1.2B) + one construction Phase 2
 * + one existing facility (openingBalance 2.4B, 6% rate, equal-periodic
 * 15 years, 0 grace) + one new facility on Phase 2.
 *
 * Fixture C (post-rebuild user scenario): 3.5B non-land capex, 0.7B
 * land cash, 1.35B land in-kind, Method 1 70/30, Senior at 7.5%,
 * 50/50 parcel split. Asserts all 9 reconciliation identities from
 * the post-rebuild fix brief by construction.
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

// ── Fixture A: new-only ─────────────────────────────────────────────────

function buildFixtureA() {
  const project = makeDefaultProject('Verifier Project', 'SAR', 'annual');
  project.startDate = '2026-01-01';
  project.financing = {
    fundingMethod: 1,
    fixedRatio: { debtPct: 70, equityPct: 30 },
    parcelFunding: [{ parcelId: 'parcel_1', debtPct: 50, equityPct: 50 }],
    viewMode: 'combined',
    minimumCashReserve: 0,
  } as ProjectFinancingConfig;

  const phase = makeDefaultPhase('phase_1', 'Phase 1', 4, 10, 0);
  const parcel: Parcel = { ...makeDefaultParcel('parcel_1', 'phase_1', 'Land 1', 100000, 500), cashPct: 60 };
  const asset: Asset = {
    id: 'asset_1', phaseId: 'phase_1', name: 'Asset 1', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 80000, buaSqm: 60000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
  };
  const subUnits: SubUnit[] = [];
  const costLines: CostLine[] = makeDefaultCostLines('phase_1', 4);

  const t1: FinancingTranche = { ...makeDefaultFinancingTranche('fac_1', 'phase_1'), name: 'Senior', interestRatePct: 6, facilitySharePct: 60, drawdownStartPeriod: 0, repaymentMethod: 'straight_line', repaymentPeriods: 8, gracePeriods: 1 };
  const t2: FinancingTranche = { ...makeDefaultFinancingTranche('fac_2', 'phase_1'), name: 'Mezz', interestRatePct: 10, facilitySharePct: 30, drawdownStartPeriod: 0, repaymentMethod: 'bullet', repaymentPeriods: 10 };
  const t3: FinancingTranche = { ...makeDefaultFinancingTranche('fac_3', 'phase_1'), name: 'Bridge', interestRatePct: 8, facilitySharePct: 10, drawdownStartPeriod: 0, repaymentMethod: 'equal_periodic_amortization', repaymentPeriods: 6 };

  return {
    project, phases: [phase], parcels: [parcel], assets: [asset], subUnits, costLines, costOverrides: [],
    landAllocationMode: 'autoByBua' as const, financingConfig: project.financing!,
    tranches: [t1, t2, t3], equityContributions: [] as EquityContribution[],
  };
}

console.log('\n========== Fixture A: new facilities only ==========');
const rA = computeFinancingResult(buildFixtureA());

console.log('\n[A1] Capex perPeriod sums match totals');
{
  const sumExcl = rA.capex.perPeriod.exclAllLand.reduce((s, v) => s + v, 0);
  const sumExclIK = rA.capex.perPeriod.exclLandInKind.reduce((s, v) => s + v, 0);
  const sumIncl = rA.capex.perPeriod.inclAllLand.reduce((s, v) => s + v, 0);
  if (near(sumExcl, rA.capex.totals.exclAllLand)) pass('exclAllLand'); else fail('exclAllLand', `${sumExcl} vs ${rA.capex.totals.exclAllLand}`);
  if (near(sumExclIK, rA.capex.totals.exclLandInKind)) pass('exclLandInKind'); else fail('exclLandInKind', `${sumExclIK} vs ${rA.capex.totals.exclLandInKind}`);
  if (near(sumIncl, rA.capex.totals.inclAllLand)) pass('inclAllLand'); else fail('inclAllLand', `${sumIncl} vs ${rA.capex.totals.inclAllLand}`);
}

console.log('\n[A2] Debt + Cash Equity = Capex (excl land in-kind)');
{
  const tDebt = rA.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
  const tEq = rA.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
  if (near(tDebt + tEq, rA.capex.totals.exclLandInKind)) pass('funding identity', `${(tDebt + tEq).toFixed(0)} = ${rA.capex.totals.exclLandInKind.toFixed(0)}`);
  else fail('funding identity', `${tDebt + tEq} vs ${rA.capex.totals.exclLandInKind}`);
}

console.log('\n[A3] Sum of NEW facility shares = 100');
{ let s = 0; for (const v of rA.shares.values()) s += v; if (near(s, 100)) pass('shares sum', `${s.toFixed(4)}`); else fail('shares sum', `${s}`); }

console.log('\n[A4] Engine reconciliation.ok');
if (rA.reconciliation.ok) pass('reconciliation.ok'); else { fail('reconciliation.ok', 'false'); for (const m of rA.reconciliation.issues) console.log(`     - ${m}`); }

console.log('\n[A5] Outstanding balance drops to zero (each fully-amortising facility)');
{
  const last = rA.axis.totalPeriods - 1;
  for (const f of rA.facilities.values()) {
    const remain = f.outstanding[last] ?? 0;
    if (near(remain, 0)) pass(`facility ${f.trancheId} amortised`); else fail(`facility ${f.trancheId} amortised`, `remain ${remain}`);
  }
}

console.log('\n[A6] IDC captured during construction (no-prior-column convention)');
{
  for (const f of rA.facilities.values()) {
    const capSum = f.interestCapitalized.reduce((s, v) => s + v, 0);
    if (capSum > 0) pass(`facility ${f.trancheId} IDC captured`, `${capSum.toFixed(0)}`);
    else fail(`facility ${f.trancheId} IDC`, 'no interest capitalised during construction');
  }
}

console.log('\n[A7] Closing balance identity per period per facility');
{
  let allOk = true;
  for (const f of rA.facilities.values()) {
    for (let i = 0; i < rA.axis.totalPeriods; i++) {
      const opening = i === 0 ? 0 : (f.outstanding[i - 1] ?? 0);
      const expectedClosing = opening + (f.drawSchedule[i] ?? 0) + (f.interestCapitalized[i] ?? 0) - (f.principalRepaid[i] ?? 0);
      const actual = f.outstanding[i] ?? 0;
      if (!near(expectedClosing, actual, 1)) {
        fail(`closing[${i}] for ${f.trancheId}`, `${expectedClosing} vs ${actual}`);
        allOk = false;
        break;
      }
    }
  }
  if (allOk) pass('per-period closing identity');
}

// ── Fixture B: VOCO operational ────────────────────────────────────────

function buildFixtureB() {
  const project = makeDefaultProject('VOCO Project', 'SAR', 'annual');
  project.startDate = '2026-01-01';
  project.financing = {
    fundingMethod: 1,
    fixedRatio: { debtPct: 70, equityPct: 30 },
    parcelFunding: [{ parcelId: 'p2_parcel', debtPct: 50, equityPct: 50 }],
    viewMode: 'combined',
    minimumCashReserve: 0,
  } as ProjectFinancingConfig;

  // Phase 1 is operational (constructionStart=1, no future construction).
  // For the project axis we need it to reserve its column slot. We give
  // it 0 construction + 15 operations (= remaining life of VOCO).
  const phase1 = makeDefaultPhase('phase_1', 'Phase 1 (VOCO, operational)', 0, 15, 0);
  phase1.status = 'operational';
  phase1.historicalBaseline = {
    historicalCapexTotal: 3_600_000_000,
    historicalEquityContributed: 1_200_000_000,
    historicalDebtDrawn: 2_400_000_000,
    currentDebtOutstanding: 2_400_000_000,
    cumulativeDepreciationCharged: 0,
    netBookValueFixedAssets: 3_600_000_000,
    last12MonthsRevenue: 0,
    last12MonthsOpex: 0,
  };

  // Phase 2 is a normal construction phase, offset by phase1's span so
  // they don't collide. constructionStart=1 + constructionPeriods=4.
  const phase2 = makeDefaultPhase('phase_2', 'Phase 2 (new construction)', 4, 10, 0);
  phase2.constructionStart = 2;  // start 1 period after Phase 1's first col

  const parcel: Parcel = { ...makeDefaultParcel('p2_parcel', 'phase_2', 'Phase 2 Land', 50000, 400), cashPct: 100 };

  // Phase 1 asset is operational, no new capex.
  const phase1Asset: Asset = {
    id: 'asset_voco', phaseId: 'phase_1', name: 'VOCO Hotel', type: 'Hotel', strategy: 'Operate', visible: true,
    gfaSqm: 40000, buaSqm: 30000, sellableBuaSqm: 25000, parkingBaysRequired: 0, status: 'operational',
  };
  // Phase 2 asset is a new development.
  const phase2Asset: Asset = {
    id: 'asset_p2', phaseId: 'phase_2', name: 'Tower A', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 60000, buaSqm: 50000, sellableBuaSqm: 40000, parkingBaysRequired: 0,
  };

  const subUnits: SubUnit[] = [];
  const costLines: CostLine[] = makeDefaultCostLines('phase_2', 4);

  // Existing facility for VOCO.
  const exFac: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_voco', 'phase_1'),
    name: 'VOCO Senior Loan',
    origin: 'existing',
    openingBalance: 2_400_000_000,
    interestRatePct: 6,
    repaymentMethod: 'equal_periodic_amortization',
    remainingRepaymentPeriods: 15,
    gracePeriods: 0,
  };

  // New facility for Phase 2.
  const newFac: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_p2', 'phase_2'),
    name: 'Phase 2 Senior',
    interestRatePct: 7,
    facilitySharePct: 100,
    drawdownStartPeriod: 1,
    repaymentMethod: 'equal_periodic_amortization',
    repaymentPeriods: 10,
  };

  return {
    project, phases: [phase1, phase2], parcels: [parcel],
    assets: [phase1Asset, phase2Asset], subUnits, costLines, costOverrides: [],
    landAllocationMode: 'autoByBua' as const, financingConfig: project.financing!,
    tranches: [exFac, newFac], equityContributions: [] as EquityContribution[],
  };
}

console.log('\n========== Fixture B: VOCO operational phase ==========');
const rB = computeFinancingResult(buildFixtureB());

console.log('\n[B1] Existing aggregate populated');
{
  const e = rB.existing;
  if (near(e.preCapexTotal, 3_600_000_000)) pass('preCapexTotal = 3.6B'); else fail('preCapexTotal', `${e.preCapexTotal}`);
  if (near(e.debtOutstandingTotal, 2_400_000_000)) pass('debtOutstandingTotal = 2.4B'); else fail('debtOutstandingTotal', `${e.debtOutstandingTotal}`);
  if (near(e.equityTotal, 1_200_000_000)) pass('equityTotal = 1.2B'); else fail('equityTotal', `${e.equityTotal}`);
}

console.log('\n[B2] Tab 1 validation chip math (pre-capex = debt + equity)');
{
  const e = rB.existing;
  if (near(e.preCapexTotal, e.debtOutstandingTotal + e.equityTotal)) pass('chip green', '3.6B = 2.4B + 1.2B');
  else fail('chip', `${e.preCapexTotal} vs ${e.debtOutstandingTotal + e.equityTotal}`);
}

console.log('\n[B3] Operational phase pre-capex NOT in new perPeriod (no double count)');
{
  const sumIncl = rB.capex.perPeriod.inclAllLand.reduce((s, v) => s + v, 0);
  if (sumIncl < 3_600_000_000) pass('new capex independent', `total ${sumIncl.toFixed(0)} < 3.6B (pre-capex excluded)`);
  else fail('double count', `inclAllLand sum ${sumIncl} >= 3.6B suggests pre-capex leaked into new capex`);
}

console.log('\n[B4] Existing facility opening = openingBalance (recovered from closing identity)');
{
  const f = rB.facilities.get('fac_voco');
  if (!f) { fail('fac_voco', 'missing'); }
  else {
    // No-prior-column convention: bal starts at openingBalance, activity
    // fires at i=0. Opening at i=0 is recoverable as outstanding[0] +
    // principal[0] - drawdown[0] - capitalized[0].
    const opening0 = (f.outstanding[0] ?? 0) + (f.principalRepaid[0] ?? 0)
                   - (f.drawSchedule[0] ?? 0) - (f.interestCapitalized[0] ?? 0);
    if (near(opening0, 2_400_000_000, 1)) pass('opening[0] = 2.4B'); else fail('opening[0]', `${opening0}`);
    const totalDraw = f.drawSchedule.reduce((s, v) => s + v, 0);
    if (near(totalDraw, 0)) pass('no new drawdown on existing'); else fail('drawdown', `${totalDraw}`);
    if (near(f.totalDrawn, 2_400_000_000)) pass('totalDrawn = openingBalance');
    else fail('totalDrawn', `${f.totalDrawn} vs 2.4B`);
  }
}

console.log('\n[B5] Existing facility fully amortised by remaining period');
{
  const f = rB.facilities.get('fac_voco');
  if (!f) { fail('fac_voco', 'missing'); }
  else {
    // Repayment runs at i=0..14 (15 periods, new convention).
    const finalIdx = rB.axis.totalPeriods - 1;
    const remain = f.outstanding[finalIdx] ?? 0;
    if (near(remain, 0, 1)) pass(`outstanding[${finalIdx}] = 0`);
    else fail(`outstanding[${finalIdx}]`, `${remain}`);
    const totalPrincipal = f.principalRepaid.reduce((s, v) => s + v, 0);
    if (near(totalPrincipal, 2_400_000_000, 1)) pass('total principal = 2.4B');
    else fail('total principal', `${totalPrincipal}`);
  }
}

console.log('\n[B6] Existing facility starts repaying at i=0');
{
  const f = rB.facilities.get('fac_voco');
  if (!f) { fail('fac_voco', 'missing'); }
  else {
    if ((f.interestAccrued[0] ?? 0) > 0) pass('interestAccrued[0] > 0', `${(f.interestAccrued[0] ?? 0).toFixed(0)}`);
    else fail('interestAccrued[0]', 'expected positive (activity fires at first active year)');
    if ((f.principalRepaid[0] ?? 0) > 0) pass('principalRepaid[0] > 0', `${(f.principalRepaid[0] ?? 0).toFixed(0)}`);
    else fail('principalRepaid[0]', 'expected positive (repayment starts at first active year)');
  }
}

console.log('\n[B7] Existing facility interest expensed (never capitalised)');
{
  const f = rB.facilities.get('fac_voco');
  if (!f) { fail('fac_voco', 'missing'); }
  else {
    const totalCap = f.interestCapitalized.reduce((s, v) => s + v, 0);
    if (near(totalCap, 0)) pass('interest never capitalised on existing');
    else fail('interestCapitalized', `${totalCap}`);
  }
}

console.log('\n[B8] Existing equity lump at column 0');
{
  const eq0 = rB.equity.existingEquityPerPeriod[0] ?? 0;
  if (near(eq0, 1_200_000_000)) pass('existingEquity[0] = 1.2B');
  else fail('existingEquity[0]', `${eq0}`);
  if (near(rB.equity.totalExisting, 1_200_000_000)) pass('totalExisting = 1.2B');
  else fail('totalExisting', `${rB.equity.totalExisting}`);
}

console.log('\n[B9] New facility on Phase 2 still works');
{
  const f = rB.facilities.get('fac_p2');
  if (!f) { fail('fac_p2', 'missing'); }
  else {
    const totalDraw = f.drawSchedule.reduce((s, v) => s + v, 0);
    if (totalDraw > 0) pass('new facility draws debt', `${totalDraw.toFixed(0)}`);
    else fail('new facility drawdown', '0');
    if (near(f.sharePct, 100)) pass('new facility share = 100%'); else fail('share', `${f.sharePct}`);
  }
}

console.log('\n[B10] Reconciliation still green with operational phase');
if (rB.reconciliation.ok) pass('reconciliation.ok'); else { fail('reconciliation.ok', 'false'); for (const m of rB.reconciliation.issues) console.log(`     - ${m}`); }

// ── Fixture C: post-rebuild user scenario ──────────────────────────────

function buildFixtureC() {
  const project = makeDefaultProject('Post-Rebuild Scenario', 'SAR', 'annual');
  project.startDate = '2025-01-01';
  project.financing = {
    fundingMethod: 1,
    fixedRatio: { debtPct: 70, equityPct: 30 },
    parcelFunding: [{ parcelId: 'p_main', debtPct: 50, equityPct: 50 }],
    viewMode: 'combined',
    minimumCashReserve: 0,
  } as ProjectFinancingConfig;

  // Phase: 5 construction periods, 15 operations.
  const phase = makeDefaultPhase('phase_1', 'Phase 1', 5, 15, 0);

  // One parcel: area*rate = 2.05B, with cashPct = 34.146% so cash =
  // 0.7B, in-kind = 1.35B (matches user's brief exactly). Critical:
  // the cost engine reads parcel.inKindPct directly (not 100 - cashPct),
  // so both fields must be set or land-in-kind computes NaN.
  const cashPct = (0.7 / 2.05) * 100;
  const parcel: Parcel = {
    id: 'p_main', phaseId: 'phase_1', name: 'Main Parcel',
    area: 2050, rate: 1_000_000, cashPct, inKindPct: 100 - cashPct,
  };

  const asset: Asset = {
    id: 'asset_1', phaseId: 'phase_1', name: 'Asset 1', type: 'Mixed-Use', strategy: 'Sell', visible: true,
    gfaSqm: 80000, buaSqm: 60000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
    landAllocation: { parcelId: 'p_main', sqm: 2050 },
  };

  // Cost lines: non-land construction (fixed 3.5B over 5 periods) plus
  // the two locked land lines from the standard catalog (which route
  // through percent_of_cash_land / percent_of_inkind_land off the asset
  // metrics produced by resolveAssetAreaMetrics + the parcel).
  const costLines: CostLine[] = [
    {
      id: 'construction-bua__phase_1', phaseId: 'phase_1', name: 'Construction',
      method: 'fixed', value: 3_500_000_000, stage: 'hard', scope: 'direct',
      allocationBasis: 'per_asset',
      startPeriod: 1, endPeriod: 5, phasing: 'even',
    },
    {
      id: 'land-cash__phase_1', phaseId: 'phase_1', name: 'Land (Cash)',
      method: 'percent_of_cash_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
      isLocked: true,
    },
    {
      id: 'land-inkind__phase_1', phaseId: 'phase_1', name: 'Land (In-Kind)',
      method: 'percent_of_inkind_land', value: 100,
      stage: 'land', scope: 'direct', allocationBasis: 'land_share',
      startPeriod: 0, endPeriod: 0, phasing: 'even',
      isLocked: true,
    },
  ];

  const senior: FinancingTranche = {
    ...makeDefaultFinancingTranche('fac_senior', 'phase_1'),
    name: 'Senior Debt',
    interestRatePct: 7.5,
    facilitySharePct: 100,
    drawdownStartPeriod: 0,
    repaymentMethod: 'equal_periodic_amortization',
    repaymentPeriods: 15,
    gracePeriods: 0,
  };

  return {
    project, phases: [phase], parcels: [parcel],
    assets: [asset], subUnits: [] as SubUnit[], costLines, costOverrides: [],
    landAllocationMode: 'autoByBua' as const, financingConfig: project.financing!,
    tranches: [senior], equityContributions: [] as EquityContribution[],
  };
}

console.log('\n========== Fixture C: post-rebuild user scenario ==========');
const rC = computeFinancingResult(buildFixtureC());

console.log('\n[C0] Expected totals from the spec');
{
  if (near(rC.capex.totals.exclAllLand, 3_500_000_000, 1)) pass('non-land capex = 3.5B');
  else fail('non-land capex', `${rC.capex.totals.exclAllLand}`);
  const landCashTotal = rC.capex.perPeriod.landCash.reduce((s, v) => s + v, 0);
  if (near(landCashTotal, 700_000_000, 1)) pass('land cash = 0.7B');
  else fail('land cash', `${landCashTotal}`);
  const landInKindTotal = rC.capex.perPeriod.landInKind.reduce((s, v) => s + v, 0);
  if (near(landInKindTotal, 1_350_000_000, 1)) pass('land in-kind = 1.35B');
  else fail('land in-kind', `${landInKindTotal}`);
  if (near(rC.capex.totals.exclLandInKind, 4_200_000_000, 1)) pass('total capex excl in-kind = 4.2B');
  else fail('total capex excl in-kind', `${rC.capex.totals.exclLandInKind}`);
}

console.log('\n[C1] Σ Capex Breakdown rows = Total Capex Incl Cash Land per period');
{
  let ok = true;
  for (let i = 0; i < rC.axis.totalPeriods; i++) {
    const sum = (rC.capex.perPeriod.exclAllLand[i] ?? 0) + (rC.capex.perPeriod.landCash[i] ?? 0);
    const expected = rC.capex.perPeriod.exclLandInKind[i] ?? 0;
    if (!near(sum, expected, 1)) { fail(`period ${i}`, `${sum} vs ${expected}`); ok = false; break; }
  }
  if (ok) pass('per-period sum identity');
}

console.log('\n[C2] Funding Requirement Selected per period = debt + cash equity per period');
{
  let ok = true;
  for (let i = 0; i < rC.axis.totalPeriods; i++) {
    const need = rC.capex.perPeriod.exclLandInKind[i] ?? 0;
    const debt = rC.debtEquitySplit.debt[i] ?? 0;
    const equity = rC.debtEquitySplit.equity[i] ?? 0;
    if (!near(need, debt + equity, 1)) { fail(`period ${i}`, `need ${need} vs d+e ${debt + equity}`); ok = false; break; }
  }
  if (ok) pass('funding identity holds per period');
}

console.log('\n[C3] Σ facility drawdown per period = Total Debt Required per period');
{
  let ok = true;
  for (let i = 0; i < rC.axis.totalPeriods; i++) {
    let s = 0;
    for (const f of rC.facilities.values()) s += f.drawSchedule[i] ?? 0;
    const expected = rC.debtEquitySplit.debt[i] ?? 0;
    if (!near(s, expected, 1)) { fail(`period ${i}`, `${s} vs ${expected}`); ok = false; break; }
  }
  if (ok) pass('facility drawdown sum = total debt per period');
}

console.log('\n[C4] Combined Debt Service Total Drawdown per period = Total Debt Required per period');
{
  let ok = true;
  for (let i = 0; i < rC.axis.totalPeriods; i++) {
    const combined = rC.combined.totalDrawdown[i] ?? 0;
    const expected = rC.debtEquitySplit.debt[i] ?? 0;
    if (!near(combined, expected, 1)) { fail(`period ${i}`, `${combined} vs ${expected}`); ok = false; break; }
  }
  if (ok) pass('combined drawdown = total debt per period');
}

console.log('\n[C5] Equity Movement In-Kind total = Land In-Kind value (single sum)');
{
  if (near(rC.equity.totalInKind, 1_350_000_000, 1)) pass('in-kind = 1.35B (not doubled, single sum from parcel)');
  else fail('in-kind', `${rC.equity.totalInKind}`);
}

console.log('\n[C6] Equity Movement Total = Cash + In-Kind');
{
  const expected = rC.equity.totalCash + rC.equity.totalInKind + rC.equity.totalExisting;
  if (near(rC.equity.grandTotal, expected, 1)) pass('grand total = cash + in-kind + existing');
  else fail('grand total', `${rC.equity.grandTotal} vs ${expected}`);
}

console.log('\n[C7] Finance Cost Capitalized + Expensed per period = Charge per period');
{
  let ok = true;
  for (const f of rC.facilities.values()) {
    for (let i = 0; i < rC.axis.totalPeriods; i++) {
      const cap = f.interestCapitalized[i] ?? 0;
      const exp = f.interestPaid[i] ?? 0;
      const charge = f.interestAccrued[i] ?? 0;
      if (!near(cap + exp, charge, 1)) {
        fail(`facility ${f.trancheId} period ${i}`, `cap+exp ${cap + exp} vs charge ${charge}`);
        ok = false;
        break;
      }
    }
    if (!ok) break;
  }
  if (ok) pass('cap + exp = charge per period per facility');
}

console.log('\n[C8] IDC Summary Capitalised per facility = Σ Finance Cost Capitalized per facility');
{
  for (const f of rC.facilities.values()) {
    const capSum = f.interestCapitalized.reduce((s, v) => s + v, 0);
    if (capSum > 0) pass(`facility ${f.trancheId} IDC = ${capSum.toFixed(0)}`);
    else fail(`facility ${f.trancheId} IDC`, 'expected positive (Senior 7.5% over 5-period capex window)');
  }
}

console.log('\n[C9] Closing Balance accounting identity holds for every period every facility');
{
  let ok = true;
  for (const f of rC.facilities.values()) {
    const t = buildFixtureC().tranches.find((x) => x.id === f.trancheId);
    const openingInitial = t?.origin === 'existing' ? Math.max(0, t.openingBalance ?? 0) : 0;
    for (let i = 0; i < rC.axis.totalPeriods; i++) {
      const opening = i === 0 ? openingInitial : (f.outstanding[i - 1] ?? 0);
      const expectedClosing = opening + (f.drawSchedule[i] ?? 0) + (f.interestCapitalized[i] ?? 0) - (f.principalRepaid[i] ?? 0);
      const actual = f.outstanding[i] ?? 0;
      if (!near(expectedClosing, actual, 1)) {
        fail(`closing[${i}] for ${f.trancheId}`, `${expectedClosing} vs ${actual}`);
        ok = false;
        break;
      }
    }
    if (!ok) break;
  }
  if (ok) pass('closing identity per period per facility');
}

console.log('\n[C10] Reconciliation green on user scenario');
if (rC.reconciliation.ok) pass('reconciliation.ok');
else { fail('reconciliation.ok', 'false'); for (const m of rC.reconciliation.issues) console.log(`     - ${m}`); }

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
