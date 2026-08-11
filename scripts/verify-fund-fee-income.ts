/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-fee-income.ts (fund layer, Step 5: fee earners + the M5 surface)
 *
 * See docs/FUND_LAYER_GUIDELINE.md.
 *
 * THE CLAIMS IT PINS:
 *
 *   A. THE FUND MANAGER EARNS 100% OF THE MANAGEMENT FEES, UNSPLIT, and it is
 *      always present when the layer is on, even with an empty matrix.
 *   B. THE PERFORMANCE FEE IS SPLIT BY THE MATRIX, EXACTLY AS ENTERED. Shares
 *      are never normalised: a column summing to 0.8 allocates 80% and reports
 *      the remaining 20% as unallocated rather than absorbing it.
 *   C. THE PARTNER RECONCILIATION IS UNTOUCHED. This is the decisive one, and
 *      it is tested rather than asserted: within a fund-ON run, changing the
 *      fee distribution matrix must leave the ENTIRE partners block and every
 *      GROSS stream byte-identical, with only `feeEarners` moving. A fee earner
 *      that had leaked into the equity split would fail here immediately.
 *      Plus: no fee earner id ever appears among the partner ids, and
 *      Sigma partner streams still equals the consolidated stream per period.
 *   D. TOGGLE OFF EQUALS TODAY. Exact, value for value, and the UI sections are
 *      gated so nothing renders.
 *
 * THE UI IS CHECKED AT SOURCE LEVEL ONLY, and that limit is stated plainly
 * rather than left implied: this asserts the two sections are gated on the
 * snapshot's `active` flags and that the reference row labels are present in
 * the exact order. It CANNOT prove the surface renders. That is the same gap
 * that let Module 7's EditLayer sit dead for about ten days behind passing
 * checks, and Step 5 is the first fund step with a visible surface, so the live
 * browser check is Ahmad's and is a genuine part of the sign-off, not a
 * formality.
 *
 * Run: npx tsx scripts/verify-fund-fee-income.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeFeeEarnerReturns, emptyFeeEarners } from '../src/core/calculations/returns';
import type { FeeEarnersSnapshot } from '../src/core/calculations/returns';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { resolveFeeEarners, resolveFundTerms, FUND_MANAGER_ROW_ID } from '../src/hubs/modeling/platforms/refm/lib/fundTerms';
import { FUND_WATERFALL_ROW_ORDER, FUND_WATERFALL_NO_TOTAL_ROWS, buildFundWaterfallRows } from '../src/hubs/modeling/platforms/refm/lib/reports/fundReports';
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

// ── 1. The pure engine ─────────────────────────────────────────────────────

console.log('=== 1. Management fees are the Fund Manager\'s, unsplit ===');
{
  const mgmt = [0, 100, 100, 100];
  const perf = [0, 0, 0, 500];
  const s = computeFeeEarnerReturns({
    earners: [
      { entityId: FUND_MANAGER_ROW_ID, name: 'Acme FM', kind: 'fund_manager', managementFeeShare: 1, performanceFeeShare: 0.6 },
      { entityId: 'party-1', name: 'Sponsor Co', kind: 'party', managementFeeShare: 0, performanceFeeShare: 0.4 },
    ],
    managementFeePerPeriod: mgmt, performanceFeePerPeriod: perf, active: true,
  });
  const fm = s.earners[0], party = s.earners[1];
  check('the Fund Manager takes every management fee', near(fm.totalManagementFeeIncome, 300));
  check('a project party takes none of the management fees', party.totalManagementFeeIncome === 0);
  check('management fees are fully allocated', near(s.allocatedManagementFee, s.totalManagementFee));
  check('the management-fee shares reconcile to 100 percent', s.managementFeeReconciles);
  check('the performance fee splits by the matrix',
    near(fm.totalPerformanceFeeIncome, 300) && near(party.totalPerformanceFeeIncome, 200));
  check('per-earner totals are management plus performance',
    near(fm.totalFeeIncome, 600) && near(party.totalFeeIncome, 200));
  check('per-period income sums to the per-earner total',
    near(fm.totalFeeIncomePerPeriod.reduce((a, b) => a + b, 0), fm.totalFeeIncome));
  check('Sigma earner income equals the fees actually allocated',
    near(s.totalFeeIncome, s.allocatedManagementFee + s.allocatedPerformanceFee));
  check('a fully allocated matrix leaves nothing unallocated',
    s.performanceFeeReconciles && s.unallocatedPerformanceFee === 0);
  check('the project totals are reported alongside the split',
    near(s.totalManagementFee, 300) && near(s.totalPerformanceFee, 500));
}

console.log('\n=== 2. Shares are shown as entered, never normalised ===');
{
  const run = (shares: number[]): FeeEarnersSnapshot => computeFeeEarnerReturns({
    earners: shares.map((v, i) => ({
      entityId: i === 0 ? FUND_MANAGER_ROW_ID : `party-${i}`,
      name: i === 0 ? 'FM' : `Party ${i}`,
      kind: (i === 0 ? 'fund_manager' : 'party') as 'fund_manager' | 'party',
      managementFeeShare: i === 0 ? 1 : 0,
      performanceFeeShare: v,
    })),
    managementFeePerPeriod: [0, 100], performanceFeePerPeriod: [0, 1000], active: true,
  });

  const half = run([0.5, 0.3]);
  check('an 80 percent matrix allocates exactly 80 percent', near(half.allocatedPerformanceFee, 800));
  check('and reports the remaining 200 as unallocated', near(half.unallocatedPerformanceFee, 200));
  check('and does NOT scale the shares up to 100 percent',
    near(half.earners[0].performanceFeeShare, 0.5) && near(half.earners[1].performanceFeeShare, 0.3));
  check('and flags the shortfall', !half.performanceFeeReconciles && near(half.performanceFeeShareDelta, -0.2));
  check('a shortfall is not the same as nothing allocated', half.noneAllocated === false);

  const none = run([0, 0]);
  check('nobody allocated yet is its own state', none.noneAllocated === true);
  check('and allocates nothing', none.allocatedPerformanceFee === 0);
  check('and the whole fee is unallocated', near(none.unallocatedPerformanceFee, 1000));

  const full = run([0.7, 0.3]);
  check('a 100 percent matrix reconciles', full.performanceFeeReconciles && !full.noneAllocated);
  check('and allocates the whole fee', near(full.allocatedPerformanceFee, 1000)
    && full.unallocatedPerformanceFee === 0);

  const over = run([0.8, 0.5]);
  check('an over-allocated matrix is flagged', !over.performanceFeeReconciles
    && near(over.performanceFeeShareDelta, 0.3));
  check('and allocates more than the fee, which the chip surfaces',
    near(over.allocatedPerformanceFee, 1300));
  check('but unallocated never goes negative', over.unallocatedPerformanceFee === 0);

  // Toggle off, and the empty constructor must agree with the inactive path so
  // there is one definition of "off" rather than two that can drift.
  const off = computeFeeEarnerReturns({
    earners: [{ entityId: FUND_MANAGER_ROW_ID, name: 'FM', kind: 'fund_manager', managementFeeShare: 1, performanceFeeShare: 1 }],
    managementFeePerPeriod: [0, 100], performanceFeePerPeriod: [0, 1000], active: false,
  });
  const d = firstDiff(off, emptyFeeEarners(2), 'inactive-vs-empty');
  check('an inactive run is identical to the empty snapshot, populated inputs and all', d === null, d ?? '');
  check('an inactive run lists no earners at all', off.earners.length === 0);
}

console.log('\n=== 3. resolveFeeEarners feeds the engine the right shape ===');
{
  const terms = resolveFundTerms({
    fundTerms: {
      enabled: true, fundManagerName: 'Acme Fund Managers',
      performanceFeePct: 0.2, hurdleRatePct: 0.08,
      feeDistribution: [
        { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 0.5, developerFeePct: 0, commissionPct: 0 },
        { partyId: 'party-1', partyName: 'Sponsor Co', performanceFeePct: 0.5, developerFeePct: 1, commissionPct: 0 },
      ],
    },
  } as any);
  const earners = resolveFeeEarners(terms);
  check('the Fund Manager is always first', earners[0]?.kind === 'fund_manager');
  check('it carries the reserved id', earners[0]?.entityId === FUND_MANAGER_ROW_ID);
  check('it takes the whole management fee', earners[0]?.managementFeeShare === 1);
  check('every other earner takes none of it', earners.slice(1).every((e) => e.managementFeeShare === 0));
  check('the manager keeps its matrix performance share', near(earners[0]?.performanceFeePct ?? 0, 0.5));
  check('a project party is carried through with its share',
    earners[1]?.kind === 'party' && earners[1]?.entityId === 'party-1' && near(earners[1].performanceFeePct, 0.5));

  // The manager exists even with a completely empty matrix, because the
  // management fees are its entitlement regardless of any split.
  const bare = resolveFundTerms({ fundTerms: { enabled: true, fundManagerName: 'Solo FM' } } as any);
  const bareEarners = resolveFeeEarners(bare);
  check('an empty matrix still yields the Fund Manager', bareEarners.length === 1
    && bareEarners[0].kind === 'fund_manager' && bareEarners[0].managementFeeShare === 1);
  check('with a zero performance share, not an invented default', bareEarners[0].performanceFeePct === 0);
}

// ── 4 to 6: the M5 integration ─────────────────────────────────────────────

function buildState(fund?: any, partners?: any[]): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  if (fund) project.fundTerms = fund;
  if (partners) project.partners = partners;
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

/** Fund terms with a variable distribution matrix. */
const fundTerms = (enabled: boolean, matrix: Array<{ partyId: string; partyName: string; performanceFeePct: number }>): any => ({
  enabled,
  fundManagerName: 'Acme Fund Managers',
  fundSize: 500_000_000, facilityLimit: 300_000_000, facilityLimitOverride: true,
  fundStructureFeePct: 0.01, fundManagementFeePct: 0.02, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.0075, otherExpensesPerAnnum: 1_500_000,
  performanceFeePct: 0.20, carryPct: 0.20, hurdleRatePct: 0.08,
  feeDistribution: matrix.map((m) => ({ ...m, developerFeePct: 0, commissionPct: 0 })),
  managementFeePct: 0.02, feeBase: 'committed_capital', committedCapital: 250_000_000, feeShares: [],
});

const TWO_PARTNERS = [
  { id: 'pa', name: 'Partner A', cashPct: 60, inKindPct: 60, existingPct: 60 },
  { id: 'pb', name: 'Partner B', cashPct: 40, inKindPct: 40, existingPct: 40 },
];

const runSnap = (fund?: any): { fin: any; ret: any } => {
  const state = buildState(fund, TWO_PARTNERS);
  const fin = computeFinancialsSnapshot(state);
  const ret = computeReturnsSnapshot(fin, state.project);
  return { fin, ret };
};

console.log('\n=== 4. The fee split CANNOT disturb the partner reconciliation ===');
{
  // The decisive check. Same project, fund layer ON in all three, only the fee
  // DISTRIBUTION MATRIX differs. If a fee earner had leaked into the equity
  // split, the partners block or a gross stream would move here.
  const a = runSnap(fundTerms(true, []));
  const b = runSnap(fundTerms(true, [
    { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 1 },
  ]));
  const c = runSnap(fundTerms(true, [
    { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 0.4 },
    { partyId: 'pa', partyName: 'Partner A', performanceFeePct: 0.35 },
    { partyId: 'pb', partyName: 'Partner B', performanceFeePct: 0.25 },
  ]));

  for (const [label, x, y] of [['manager takes all', a, b], ['split across parties', a, c]] as const) {
    const dFin = firstDiff(x.fin, y.fin, 'financials');
    check(`financials snapshot unchanged by the matrix (${label})`, dFin === null, dFin ?? '');
    const dPartners = firstDiff(x.ret.partners, y.ret.partners, 'partners');
    check(`the ENTIRE partners block is unchanged (${label})`, dPartners === null, dPartners ?? '');
    check(`gross FCFE stream unchanged (${label})`,
      firstDiff(x.ret.fcfePerPeriod, y.ret.fcfePerPeriod) === null);
    check(`gross Distributed-Equity stream unchanged (${label})`,
      firstDiff(x.ret.dividendStreamPerPeriod, y.ret.dividendStreamPerPeriod) === null);
    check(`gross result block unchanged (${label})`, firstDiff(x.ret.result, y.ret.result) === null);
    check(`the waterfall itself is unchanged (${label})`,
      firstDiff(x.ret.waterfall, y.ret.waterfall) === null);
    check(`net returns are unchanged (${label})`,
      firstDiff(x.ret.resultNetDividends, y.ret.resultNetDividends) === null);
  }

  // And the fee earners MUST differ, or the checks above are passing on three
  // identical results and prove nothing.
  check('the fee earners genuinely differ between the three matrices',
    firstDiff(a.ret.feeEarners, b.ret.feeEarners) !== null
    && firstDiff(b.ret.feeEarners, c.ret.feeEarners) !== null);
  check('the manager-takes-all matrix gives it the whole performance fee',
    near(b.ret.feeEarners.earners[0].totalPerformanceFeeIncome, b.ret.waterfall.totalPerformanceFee, 1e-3));
  check('the split matrix shares it out', c.ret.feeEarners.earners.length === 3
    && near(c.ret.feeEarners.allocatedPerformanceFee, c.ret.waterfall.totalPerformanceFee, 1e-3));
  check('an empty matrix leaves the performance fee unallocated',
    a.ret.feeEarners.noneAllocated
    && near(a.ret.feeEarners.unallocatedPerformanceFee, a.ret.waterfall.totalPerformanceFee, 1e-3));

  // No fee earner is ever inside the partner roster.
  const partnerIds = c.ret.partners.partners.map((p: any) => p.id);
  check('no partner carries the reserved Fund Manager id', !partnerIds.includes(FUND_MANAGER_ROW_ID));
  check('the partner roster is still exactly the equity partners',
    partnerIds.length === 2 && partnerIds.includes('pa') && partnerIds.includes('pb'));
  // The identity that makes the partner table trustworthy still holds.
  {
    const snapP = c.ret.partners;
    let worst = 0;
    for (let i = 0; i < snapP.totalStream.length; i++) {
      const s = snapP.partners.reduce((acc: number, p: any) => acc + (p.cashFlowStream[i] ?? 0), 0);
      worst = Math.max(worst, Math.abs(s - snapP.totalStream[i]));
    }
    check('Sigma partner streams still equals the consolidated total, per period', worst <= 1e-6, `worst ${worst}`);
    check('the agreed shares still reconcile to 100 percent', snapP.shareholdingReconciles);
  }
}

console.log('\n=== 5. Fee income ties to the model ===');
{
  const { fin, ret } = runSnap(fundTerms(true, [
    { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 0.6 },
    { partyId: 'pa', partyName: 'Partner A', performanceFeePct: 0.4 },
  ]));
  const fe: FeeEarnersSnapshot = ret.feeEarners;

  check('the fee earners block is active with the fund layer on', fe.active === true);
  check('it spans the same periods as the streams',
    fe.managementFeePerPeriod.length === ret.dividendStreamPerPeriod.length,
    `${fe.managementFeePerPeriod.length} vs ${ret.dividendStreamPerPeriod.length}`);
  check('the inception period carries no management fee', fe.managementFeePerPeriod[0] === 0);
  // The management fee series must BE the M4 schedule, lifted onto the stream
  // basis, not a second computation of the same thing.
  {
    const E = ret.dividendStreamPerPeriod.length - 1;
    let worst = 0;
    for (let t = 0; t < E; t++) {
      worst = Math.max(worst, Math.abs((fe.managementFeePerPeriod[t + 1] ?? 0) - (fin.fundFees.totalPerPeriod[t] ?? 0)));
    }
    check('management fees are the M4 fee schedule, period for period', worst <= 1e-9, `worst ${worst}`);
  }
  check('the performance fee series IS the waterfall\'s',
    firstDiff(fe.performanceFeePerPeriod, ret.waterfall.performanceFeePerPeriod) === null);
  check('a management fee was actually charged, so this is not passing on zeros',
    fe.totalManagementFee > 0, String(fe.totalManagementFee));
  check('a performance fee was actually charged', fe.totalPerformanceFee > 0, String(fe.totalPerformanceFee));
  check('the Fund Manager takes every management fee',
    near(fe.earners[0].totalManagementFeeIncome, fe.totalManagementFee, 1e-6));
  check('and 60 percent of the performance fee',
    near(fe.earners[0].totalPerformanceFeeIncome, fe.totalPerformanceFee * 0.6, 1e-3));
  check('the party takes 40 percent of the performance fee and no management fee',
    near(fe.earners[1].totalPerformanceFeeIncome, fe.totalPerformanceFee * 0.4, 1e-3)
    && fe.earners[1].totalManagementFeeIncome === 0);
  check('Sigma earner income per period equals the allocated total',
    near(fe.totalFeeIncomePerPeriod.reduce((a, b) => a + b, 0), fe.totalFeeIncome, 1e-6));
  check('fee income never exceeds the fees the model actually charged',
    fe.totalFeeIncome <= fe.totalManagementFee + fe.totalPerformanceFee + EPS);
}

console.log('\n=== 6. Toggle OFF equals today ===');
{
  const plain = runSnap();
  const off = runSnap(fundTerms(false, [
    { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 1 },
  ]));

  const dFin = firstDiff(plain.fin, off.fin, 'financials');
  check('financials snapshot identical with the toggle off', dFin === null, dFin ?? '');
  const dRet = firstDiff(plain.ret, off.ret, 'returns');
  check('returns snapshot identical with the toggle off', dRet === null, dRet ?? '');

  for (const [label, r] of [['no fund block', plain.ret], ['populated but disabled', off.ret]] as const) {
    check(`${label}: the fee earners block is inactive`, r.feeEarners.active === false);
    check(`${label}: it lists no earners`, r.feeEarners.earners.length === 0);
    check(`${label}: every fee total is zero`,
      r.feeEarners.totalManagementFee === 0 && r.feeEarners.totalPerformanceFee === 0
      && r.feeEarners.totalFeeIncome === 0 && r.feeEarners.unallocatedPerformanceFee === 0);
    check(`${label}: the waterfall is inactive too`, r.waterfall.active === false);
  }
}

console.log('\n=== 7. The M5 surface (SOURCE LEVEL ONLY, see the header) ===');
{
  const ui = readFileSync(join(root, 'src/hubs/modeling/platforms/refm/components/modules/Module5Returns.tsx'), 'utf8');

  check('the waterfall section is gated on the snapshot active flag',
    /\{rs\.waterfall\.active\s*&&/.test(ui));
  check('the fee income section is gated on the snapshot active flag',
    /\{rs\.feeEarners\.active\s*&&/.test(ui));
  check('both sections carry a test id',
    ui.includes('data-testid="m5-fund-waterfall"') && ui.includes('data-testid="m5-fee-income"'));

  // The reference row order, asserted as an ORDER rather than a set: a table
  // whose lines are shuffled is a different calculation to read, even though
  // every label is still present.
  //
  // MOVED TO THE BUILDER 2026-08-10. These two used to grep the component
  // source for the row labels, which stopped being where they live once the
  // rows were lifted into the shared lib/reports/fundReports builder so the
  // Excel workbook and both PDFs could render the same table. Asserting the
  // BUILDER OUTPUT is strictly stronger than grepping source text: it checks
  // the data the component actually receives, and it now covers every surface
  // at once rather than this one component.
  const REFERENCE_ROWS = [
    'Equity Drawn',
    'Unpaid Hurdle Balance BoP',
    'Hurdle Accrued',
    'Total Hurdle Owed',
    'Hurdle Paid',
    'Unpaid Hurdle Balance EoP',
    'Excess Distributions',
    'Performance Fee',
    'Distributions Net of Performance Fee',
  ];
  check('the component renders the waterfall from the SHARED builder',
    /buildFundWaterfallRows/.test(ui) && /from '.*reports\/fundReports'/.test(ui));
  const builtLabels = FUND_WATERFALL_ROW_ORDER.filter((l) => !l.startsWith('Memo:'));
  check('every reference waterfall row is present, in the reference order',
    builtLabels.join('|') === REFERENCE_ROWS.join('|'), builtLabels.join('|'));
  check('the gross-vs-net comparison is labelled as such',
    ui.includes('Excluding fund fees (gross)') || /buildFundGrossNetRows/.test(ui));
  // Four rows carry no lifetime total as of 2026-08-11: the three balances,
  // plus Hurdle Accrued (an accrual on a compounding balance, printed between
  // two balance rows). Asserted against the BUILDER's own list so the rule has
  // one definition, and pinned at four so a row cannot quietly drop out.
  check('balance rows and Hurdle Accrued are rendered without a lifetime total',
    FUND_WATERFALL_NO_TOTAL_ROWS.length === 4
    && FUND_WATERFALL_NO_TOTAL_ROWS.includes('Hurdle Accrued')
    && FUND_WATERFALL_NO_TOTAL_ROWS.every((l) => REFERENCE_ROWS.includes(l)));
  // Teeth: the rule must be encoded in the BUILDER OUTPUT, not just in a list a
  // renderer might ignore. Without this the check above passes on a constant.
  check('the shared builder actually emits those four rows with an empty total',
    (() => {
      const { fin, ret } = runSnap(fundTerms(true, []));
      const rows = buildFundWaterfallRows({
        snap: fin, returns: ret,
        fmt: { money: (v) => String(v), pct: (v) => String(v ?? ''), mult: (v) => String(v ?? '') },
      });
      const blank = rows.filter((r) => r.totalOverride === '').map((r) => r.label);
      return blank.length === 4 && FUND_WATERFALL_NO_TOTAL_ROWS.every((l) => blank.includes(l));
    })());
  check('the fee income section names the Fund Manager as a distinct kind',
    ui.includes("e.kind === 'fund_manager' ? 'Fund Manager' : 'Project Party'"));
  check('an unallocated performance fee is rendered rather than absorbed',
    ui.includes('s.unallocatedPerformanceFee > 0'));
  // The strongest structural guarantee in Step 5: the partner code path was not
  // edited at all, so the fee sections are rendered as siblings.
  check('the fee income section is a SIBLING of PartnersSection, not inside it',
    ui.indexOf('<FeeIncomeSection') > ui.indexOf('<PartnersSection'));
  check('PartnersSection still receives exactly the equity partners',
    /partners=\{project\.partners \?\? \[\]\}/.test(ui));
}

console.log('\n=== 7b. The data the UI feeds the tables is renderable ===');
{
  // A real render check is not achievable cheaply here: the table tree imports
  // a CSS module, which is a Next build feature that tsx cannot compile, and
  // stubbing the module interop did not hold. So instead of claiming a render
  // this asserts the SHAPE of every array the two sections hand to
  // M4PeriodTable, which is where a runtime crash would actually come from (an
  // undefined index or a ragged array), and leaves the render itself to the
  // live browser check.
  const { fin, ret } = runSnap(fundTerms(true, [
    { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme Fund Managers', performanceFeePct: 1 },
  ]));
  const E1 = ret.dividendStreamPerPeriod.length; // E+1, the table's index basis
  const w = ret.waterfall;
  const fe: FeeEarnersSnapshot = ret.feeEarners;

  const series: Array<[string, number[]]> = [
    ['equityDrawnPerPeriod', w.equityDrawnPerPeriod],
    ['openingUnpaidHurdle (derived)', w.periods.map((p: any) => p.openingUnpaidHurdle)],
    ['hurdleAccruedPerPeriod', w.hurdleAccruedPerPeriod],
    ['totalHurdleOwedPerPeriod', w.totalHurdleOwedPerPeriod],
    ['hurdlePaidPerPeriod', w.hurdlePaidPerPeriod],
    ['unpaidHurdlePerPeriod', w.unpaidHurdlePerPeriod],
    ['excessDistributionsPerPeriod', w.excessDistributionsPerPeriod],
    ['performanceFeePerPeriod', w.performanceFeePerPeriod],
    ['netDistributionPerPeriod', w.netDistributionPerPeriod],
    ['distributionPerPeriod', w.distributionPerPeriod],
    ['fee: managementFeePerPeriod', fe.managementFeePerPeriod],
    ['fee: performanceFeePerPeriod', fe.performanceFeePerPeriod],
    ['fee: totalFeeIncomePerPeriod', fe.totalFeeIncomePerPeriod],
  ];
  for (const [name, arr] of series) {
    check(`${name} is a full-length array of finite numbers`,
      Array.isArray(arr) && arr.length === E1 && arr.every((v) => Number.isFinite(v)),
      `length ${arr?.length} vs ${E1}`);
  }

  // The fee-line breakdown the section renders comes from the M4 schedule.
  check('the M4 fee schedule exposes the five fee lines to render',
    Array.isArray(fin.fundFees.lines) && fin.fundFees.lines.length === 5);
  check('every fee line carries a label and a full axis series',
    fin.fundFees.lines.every((l: any) => typeof l.label === 'string' && l.label.length > 0
      && Array.isArray(l.amountPerPeriod) && l.amountPerPeriod.length >= E1 - 1
      && l.amountPerPeriod.every((v: number) => Number.isFinite(v))));
  check('at least one earner exists to render a row', fe.earners.length > 0);
  check('every earner carries a non-empty name', fe.earners.every((e) => typeof e.name === 'string' && e.name.length > 0));
}

console.log('\n=== 8. House style ===');
{
  const emDash = new RegExp('[\\u2014\\u2015]');
  for (const p of [
    'src/core/calculations/returns/feeEarners.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module5Returns.tsx',
    'scripts/verify-fund-fee-income.ts',
  ]) check(`no em dash in ${p.split('/').pop()}`, !emDash.test(readFileSync(join(root, p), 'utf8')));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
