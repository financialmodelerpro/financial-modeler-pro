/**
 * verify-cf-capex-foot.ts (2026-08-18)
 *
 * Pins two defects found on the live project by reading the Cash Flow screen.
 *
 * The reported symptom: the Investing section's per-asset capex rows did not
 * add up to the "Total Capex" subtotal printed under them. Measured on
 * FMP - MARINA GATE: the rows summed to 426,407.0k against a Total Capex of
 * 366,407.0k, a gap of 60,000.0k which was exactly the LAND CONTRIBUTED IN
 * KIND. The subtotal has been the CASH basis since M4 Pass 2P (in-kind land is
 * not a cash outflow, it is recognised as Land and Share Capital at once); the
 * rows were the full cost. Both are now the cash slice, with the in-kind land
 * on its own memo row so nothing the model charges leaves the screen.
 *
 * The second, larger defect it led to: the Balance Sheet was out by
 * -25,000,000 in the construction year. In-kind EQUITY was stamped by a walk
 * over the parcels, at the OWNING parcel's phase; the in-kind LAND was
 * capitalised by the capex engine, in the CONSUMING asset's phase. Since
 * 2026-08-17 a parcel is PROJECT-WIDE, so those two are not the same period
 * whenever a later phase draws on an earlier phase's land, and the Balance
 * Sheet carried the difference. One definition now: `capex.perPeriod.landInKind`.
 *
 * The fixture below is the shape that reproduces it, and NO existing fixture
 * had it: every one of them puts the parcel in the same phase as the asset
 * that consumes it, which is why the whole suite stayed green while the live
 * project was out by 25m.
 *
 * Usage: npx tsx scripts/verify-cf-capex-foot.ts
 *        npx tsx scripts/verify-cf-capex-foot.ts --sabotage=<n>
 */
import {
  type Asset, type CostLine, type Phase, type Project, type SubUnit, type Parcel,
  makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildDirectCFRows, buildIndirectCFRows, type M4ReportCtx } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '../src/core/calculations/financials';

type State = Parameters<typeof computeFinancialsSnapshot>[0];
// `M4Row` is internal to m4Reports; take it from the builder's return type
// rather than widening the module's surface just for a verifier.
type M4Row = ReturnType<typeof buildDirectCFRows>[number];

let passed = 0, failed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` :: ${detail}` : ''}`); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

// ── The fixture that reproduces it ──────────────────────────────────────────
// ONE parcel, owned by Phase 1, half of it contributed IN KIND. Assets in BOTH
// phases, and each phase carries its own seeded Land (In-Kind) cost line, so
// the Phase 2 assets capitalise a slice of the Phase 1 parcel: the project-wide
// parcel case. Financed, so the funding solver and IDC run too.
const SELL_SUBUNIT = (assetId: string, id: string): SubUnit => ({
  id, assetId, name: '2BR', category: 'Sellable', metric: 'area', metricValue: 40000, unitPrice: 4000,
});
function sellAsset(id: string, phaseId: string, name: string, suId: string): Asset {
  return {
    id, phaseId, name, type: '', strategy: 'Sell', visible: true,
    gfaSqm: 40000, buaSqm: 40000, sellableBuaSqm: 40000, parkingBaysRequired: 0,
    revenue: { sell: {
      assetId: id,
      subUnits: [{ subUnitId: suId, preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0, 0.4, 0.4, 0.2, 0, 0, 0, 0], postSalesVelocityByPhase: [] }],
      cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] },
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  } as Asset;
}
function operateAsset(id: string, phaseId: string, name: string): Asset {
  return {
    id, phaseId, name, type: '', strategy: 'Operate', visible: true,
    gfaSqm: 20000, buaSqm: 20000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
  } as Asset;
}
/** An EXPLICIT parcel reference plus an explicit sqm, which is `sqm` mode and
 *  the only allocation rule that crosses phases: `autoByBua` / `percent` /
 *  equal-share all stay inside the asset's own phase, so none of them can
 *  reproduce this and none of the pre-existing fixtures did. */
const withLand = (a: Asset, sqm: number): Asset =>
  ({ ...a, landAllocation: { ...(a.landAllocation ?? {}), sqm, parcelId: 'parcel_1' } }) as Asset;

function buildCrossPhase(): State {
  const project: Project = { ...makeDefaultProject(), startDate: '2027-01-01' };
  const p1: Phase = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2027-01-01', constructionPeriods: 3, operationsPeriods: 6, overlapPeriods: 0 };
  const p2: Phase = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 };
  // THE PARCEL BELONGS TO PHASE 1 AND IS HALF IN KIND. Phase 2's assets draw on
  // it, which is the whole point of the fixture.
  const parcel: Parcel = { id: 'parcel_1', phaseId: 'p1', name: 'Land 1', area: 24000, rate: 5000, cashPct: 50, inKindPct: 50 };
  // 14,000 sqm of the parcel to Phase 1 and 10,000 to Phase 2, so the in-kind
  // land splits 35,000,000 / 25,000,000: the same shape, and the same two
  // figures, as the live project this was found on.
  const assets = [
    withLand(sellAsset('a1', 'p1', 'Residences', 'su1'), 8000),
    withLand(operateAsset('a2', 'p1', 'Podium Retail'), 6000),
    withLand(sellAsset('a3', 'p2', 'Tower Two', 'su3'), 6000),
    withLand(operateAsset('a4', 'p2', 'Hotel'), 4000),
  ];
  const costLines: CostLine[] = [...makeDefaultCostLines('p1', 3), ...makeDefaultCostLines('p2', 3)];
  // Phase 2's land is paid in the phase's FIRST construction period rather
  // than the period before it, which is what the live project has (the user
  // typed the window, so `windowFollowsConstruction` is false). It matters:
  // phase-local index 0 is the upfront lump and clamps to `offset - 1`, so a
  // land line left at index 0 in a phase one year out lands on the SAME axis
  // column as phase 1's, and the old parcel rule and the capex rule agree by
  // accident. Moving it off index 0 is what separates them.
  for (const c of costLines) {
    if (c.phaseId === 'p2' && c.stage === 'land') { c.startPeriod = 1; c.endPeriod = 1; c.windowFollowsConstruction = false; }
  }
  return {
    project, phases: [p1, p2], assets,
    subUnits: [SELL_SUBUNIT('a1', 'su1'), SELL_SUBUNIT('a3', 'su3')],
    parcels: [parcel], costLines, costOverrides: [], landAllocationMode: 'sqm',
    financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [],
  };
}

// A same-phase control: parcel and consuming assets in ONE phase. This is the
// shape every pre-existing fixture had, and it must keep behaving.
function buildSamePhase(): State {
  const s = buildCrossPhase();
  s.assets = s.assets.filter((a) => a.phaseId === 'p1');
  s.subUnits = s.subUnits.filter((u) => u.assetId === 'a1');
  s.costLines = s.costLines.filter((c) => c.phaseId === 'p1');
  s.phases = s.phases.filter((p) => p.id === 'p1');
  return s;
}

// ── Row helpers ─────────────────────────────────────────────────────────────
const ctxFor = (state: State, snap: ReturnType<typeof computeFinancialsSnapshot>, filterPhaseId = '__all__'): M4ReportCtx => ({
  snap, state, filterPhaseId,
  labels: getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country)),
  fmt: (v: number) => String(v),
} as M4ReportCtx);

/** The asset rows the Investing section renders: the members of the three
 *  capex collapse groups. Deliberately NOT the bucket headers, so a header
 *  that disagreed with its own members would still be caught below. */
const capexAssetRows = (rows: M4Row[]): M4Row[] =>
  rows.filter((r) => typeof r.collapseGroup === 'string' && r.collapseGroup.startsWith('cf-capex-') && r.collapseRole === 'member');
const capexHeaderRows = (rows: M4Row[]): M4Row[] =>
  rows.filter((r) => typeof r.collapseGroup === 'string' && r.collapseGroup.startsWith('cf-capex-') && r.collapseRole === 'header');
const rowByLabel = (rows: M4Row[], label: string): M4Row | undefined => rows.find((r) => r.label === label);
const memoRow = (rows: M4Row[]): M4Row | undefined => rows.find((r) => r.label.includes('(memo) Land In-Kind'));

function seriesSum(rows: M4Row[], N: number): number[] {
  const out = new Array<number>(N).fill(0);
  for (const r of rows) for (let t = 0; t < N; t++) out[t] += r.values[t] ?? 0;
  return out;
}

// ── Sabotage harness ────────────────────────────────────────────────────────
// Each sabotage is applied to the SNAPSHOT, reproducing exactly the pre-fix
// behaviour a check must catch, so the checks are proven to have teeth without
// editing source and reverting it by hand.
const SABOTAGE = Number(/--sabotage=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 0);
function sabotage(snap: ReturnType<typeof computeFinancialsSnapshot>): ReturnType<typeof computeFinancialsSnapshot> {
  if (SABOTAGE === 0) return snap;
  const s = snap as unknown as Record<string, unknown>;
  if (SABOTAGE === 1) {
    // 1: the pre-fix report. Per-asset in-kind reads as zero, so the rows go
    //    back to the full cost while the subtotal stays cash.
    for (const cf of snap.perAssetCF.values()) cf.landInKindPerPeriod = cf.landInKindPerPeriod.map(() => 0);
  }
  if (SABOTAGE === 2) {
    // 2: the pre-fix engine. In-kind equity lumped at the OWNING parcel's
    //    phase index, i.e. everything at t=0. Note this can only nick the
    //    equity-vs-capex identity, not the Balance Sheet check: the BS was
    //    built before the mutation. The Balance Sheet's own teeth are proven
    //    by the COUNTERFACTUAL section instead, which measures what the old
    //    rule would have done to it.
    const eq = snap.financing.equity;
    const total = sum(eq.inKindPerPeriod);
    const moved = eq.inKindPerPeriod.map(() => 0); moved[0] = total;
    eq.inKindPerPeriod = moved;
  }
  if (SABOTAGE === 3) {
    // 3: per-asset in-kind exists but is a period late, so the totals still
    //    agree and only the per-period identity catches it.
    for (const cf of snap.perAssetCF.values()) {
      cf.landInKindPerPeriod = [0, ...cf.landInKindPerPeriod.slice(0, -1)];
    }
  }
  if (SABOTAGE === 4) {
    // 4: the memo row's source is emptied, so the in-kind land is silently
    //    absent from the screen rather than stated.
    for (const cf of snap.perAssetCF.values()) {
      cf.capexPerPeriod = cf.capexPerPeriod.map((v, t) => v - (cf.landInKindPerPeriod[t] ?? 0));
      cf.landInKindPerPeriod = cf.landInKindPerPeriod.map(() => 0);
    }
  }
  void s;
  return snap;
}

// ── Sections ────────────────────────────────────────────────────────────────
function runFixture(name: string, build: () => State, expectInKind: boolean, expectSplitPeriods = false): void {
  console.log(`\n-- ${name} --`);
  const state = build();
  const snap = sabotage(computeFinancialsSnapshot(state));
  const N = snap.axisLength;

  // A. The Balance Sheet balances. This is the check the 25m defect broke.
  const worstBs = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  check(`${name}: Balance Sheet balances every period`, worstBs < 1, `worst |Assets - L&E| = ${worstBs.toFixed(2)}`);

  // B. ONE definition of when in-kind land arrives: the equity credit and the
  //    capitalised land are the SAME series, period by period.
  const capIK = snap.financing.capex.perPeriod.landInKind;
  const eqIK = snap.financing.equity.inKindPerPeriod;
  check(`${name}: in-kind equity equals in-kind land capitalised, EVERY period`,
    Array.from({ length: N }, (_, t) => near(eqIK[t] ?? 0, capIK[t] ?? 0)).every(Boolean),
    `equity [${eqIK.slice(0, 4).map((v) => v.toFixed(0)).join(', ')}] vs capex [${capIK.slice(0, 4).map((v) => v.toFixed(0)).join(', ')}]`);
  check(`${name}: and on the lifetime total`, near(sum(eqIK), sum(capIK), 0.5));
  if (expectInKind) {
    check(`${name}: the fixture actually carries in-kind land (else the section passes vacuously)`, sum(capIK) > 0, `total = ${sum(capIK)}`);
  }
  if (expectSplitPeriods) {
    // Without this the cross-phase fixture would silently stop reproducing the
    // defect the moment the land window moved, and section B would pass on a
    // single-period series where the old rule and the new one AGREE.
    const nonZero = capIK.filter((v) => Math.abs(v) > 0.5).length;
    check(`${name}: the in-kind land genuinely arrives in MORE THAN ONE period`, nonZero > 1,
      `non-zero periods = ${nonZero}, series [${capIK.slice(0, 4).map((v) => (v / 1e6).toFixed(1)).join(', ')}]m`);
  }

  // C. The per-asset in-kind slices sum to the project's.
  const perAssetIK = new Array<number>(N).fill(0);
  for (const a of state.assets) {
    if (a.visible === false) continue;
    const cf = snap.perAssetCF.get(a.id);
    if (!cf) continue;
    for (let t = 0; t < N; t++) perAssetIK[t] += cf.landInKindPerPeriod[t] ?? 0;
  }
  check(`${name}: per-asset in-kind land sums to financing.capex.perPeriod.landInKind`,
    Array.from({ length: N }, (_, t) => near(perAssetIK[t], capIK[t] ?? 0, 0.5)).every(Boolean),
    `assets total ${sum(perAssetIK).toFixed(0)} vs capex total ${sum(capIK).toFixed(0)}`);

  // D. AssetCF.capexPerPeriod is still the FULL cost. The asset's carrying
  //    value (inventory, per-asset returns, the IC report) must not have been
  //    quietly netted down by the cash-flow fix.
  const perAssetFull = new Array<number>(N).fill(0);
  for (const a of state.assets) {
    const cf = snap.perAssetCF.get(a.id);
    if (!cf) continue;
    for (let t = 0; t < N; t++) perAssetFull[t] += cf.capexPerPeriod[t] ?? 0;
  }
  check(`${name}: AssetCF.capexPerPeriod is still the FULL cost incl. in-kind land`,
    Array.from({ length: N }, (_, t) => near(perAssetFull[t], snap.financing.capex.perPeriod.inclAllLand[t] ?? 0, 0.5)).every(Boolean),
    `assets ${sum(perAssetFull).toFixed(0)} vs inclAllLand ${sum(snap.financing.capex.perPeriod.inclAllLand).toFixed(0)}`);

  // E. THE REPORTED SYMPTOM. The Investing section foots, on both methods.
  for (const [method, build2] of [['Direct CF', buildDirectCFRows], ['Indirect CF', buildIndirectCFRows]] as const) {
    const rows = build2(ctxFor(state, snap));
    const assetRows = capexAssetRows(rows);
    const headers = capexHeaderRows(rows);
    const total = rowByLabel(rows, 'Total Capex');
    check(`${name}: ${method} renders asset capex rows and a Total Capex`, assetRows.length > 0 && !!total,
      `${assetRows.length} rows, total ${total ? 'present' : 'ABSENT'}`);
    if (!total) continue;
    const rowsTotal = seriesSum(assetRows, N);
    const okRows = Array.from({ length: N }, (_, t) => near(rowsTotal[t], total.values[t] ?? 0, 0.5)).every(Boolean);
    check(`${name}: ${method} asset rows sum to Total Capex, EVERY period`, okRows,
      `rows ${sum(rowsTotal).toFixed(0)} vs total ${sum(total.values).toFixed(0)}`);
    const headTotal = seriesSum(headers, N);
    check(`${name}: ${method} bucket headers sum to Total Capex too`,
      Array.from({ length: N }, (_, t) => near(headTotal[t], total.values[t] ?? 0, 0.5)).every(Boolean),
      `headers ${sum(headTotal).toFixed(0)} vs total ${sum(total.values).toFixed(0)}`);
    check(`${name}: ${method} Total Capex is the CASH basis (exclLandInKind), negated`,
      Array.from({ length: N }, (_, t) => near(total.values[t] ?? 0, -(snap.financing.capex.perPeriod.exclLandInKind[t] ?? 0), 0.5)).every(Boolean));
    check(`${name}: ${method} Cash Flow from Investment equals Total Capex`,
      Array.from({ length: N }, (_, t) => near(rowByLabel(rows, 'Cash Flow from Investment')?.values[t] ?? 0, total.values[t] ?? 0, 0.5)).every(Boolean));

    // F. Nothing is hidden: the in-kind land is STATED, and it is exactly the
    //    difference between what the assets cost and what left the bank.
    const memo = memoRow(rows);
    if (expectInKind) {
      check(`${name}: ${method} states the in-kind land on a memo row`, !!memo);
      if (memo) {
        check(`${name}: ${method} the memo equals the capitalised in-kind land, every period`,
          Array.from({ length: N }, (_, t) => near(memo.values[t] ?? 0, -(capIK[t] ?? 0), 0.5)).every(Boolean),
          `memo ${sum(memo.values).toFixed(0)} vs in-kind ${(-sum(capIK)).toFixed(0)}`);
        check(`${name}: ${method} rows + memo reconstruct the FULL cost (nothing dropped)`,
          Array.from({ length: N }, (_, t) => near((rowsTotal[t] ?? 0) + (memo.values[t] ?? 0), -(snap.financing.capex.perPeriod.inclAllLand[t] ?? 0), 0.5)).every(Boolean));
        check(`${name}: ${method} the memo is not counted in Total Capex`,
          !near(total.values[0] ?? 0, (rowsTotal[0] ?? 0) + (memo.values[0] ?? 0), 0.5) || near(memo.values[0] ?? 0, 0, 0.5));
      }
    } else {
      check(`${name}: ${method} renders NO memo row when there is no in-kind land`, !memo);
    }
  }

  // G0. THE SECTION MUST FOOT UNDER EVERY PHASE FILTER, not just under "All".
  //     The asset rows are phase-filtered by `matchesPhase`, so a subtotal that
  //     ignores the filter leaves a phase view whose rows and total describe
  //     different populations. Checking only the unfiltered view (which the
  //     first version of this verifier did) misses exactly that.
  for (const ph of state.phases) {
    for (const [method, build2] of [['Direct CF', buildDirectCFRows], ['Indirect CF', buildIndirectCFRows]] as const) {
      const rows = build2(ctxFor(state, snap, ph.id));
      const total = rowByLabel(rows, 'Total Capex');
      if (!total) continue;
      const rowsTotal = seriesSum(capexAssetRows(rows), N);
      check(`${name}: ${method} foots under the "${ph.name}" filter too`,
        Array.from({ length: N }, (_, t) => near(rowsTotal[t], total.values[t] ?? 0, 0.5)).every(Boolean),
        `rows ${sum(rowsTotal).toFixed(0)} vs total ${sum(total.values).toFixed(0)}`);
    }
  }

  // G. The phase filter changes the SCOPE, never the BASIS. Summing the two
  //    phase-filtered subtotals must give the unfiltered one.
  if (state.phases.length > 1) {
    const all = rowByLabel(buildIndirectCFRows(ctxFor(state, snap)), 'Total Capex');
    const perPhase = state.phases.map((p) => rowByLabel(buildIndirectCFRows(ctxFor(state, snap, p.id)), 'Total Capex'));
    const stacked = new Array<number>(N).fill(0);
    for (const r of perPhase) for (let t = 0; t < N; t++) stacked[t] += r?.values[t] ?? 0;
    check(`${name}: the phase-filtered Total Capex figures sum to the unfiltered one`,
      !!all && Array.from({ length: N }, (_, t) => near(stacked[t], all.values[t] ?? 0, 0.5)).every(Boolean),
      `stacked ${sum(stacked).toFixed(0)} vs all ${all ? sum(all.values).toFixed(0) : 'n/a'}`);
  }
}

console.log('=== verify-cf-capex-foot ===');
if (SABOTAGE > 0) console.log(`SABOTAGE ${SABOTAGE} ACTIVE: failures below are the point.\n`);

runFixture('cross-phase parcel', buildCrossPhase, true, true);
runFixture('same-phase parcel (control)', buildSamePhase, true);

// H. THE COUNTERFACTUAL. A Balance Sheet that balances proves nothing unless
//    the fixture could have unbalanced it, and section A cannot be sabotaged
//    after the fact (the BS is already built). So measure directly what the
//    retired rule would have produced on this same fixture: every parcel's
//    in-kind value stamped whole at its OWNING phase's index. The gap between
//    the two cumulative curves IS the Balance Sheet imbalance, because the
//    asset side is unchanged and only the equity credit moves.
{
  console.log('\n-- counterfactual: what the retired parcel rule would have done --');
  const state = buildCrossPhase();
  const snap = computeFinancialsSnapshot(state);
  const N = snap.axisLength;
  const projStart = new Date(state.project.startDate).getUTCFullYear();
  const oldRule = new Array<number>(N).fill(0);
  for (const p of state.parcels) {
    const value = p.area * p.rate * (Math.max(0, Math.min(100, 100 - (p.cashPct ?? 0))) / 100);
    if (value <= 0) continue;
    const ph = state.phases.find((x) => x.id === p.phaseId);
    const psy = ph?.startDate ? new Date(ph.startDate).getUTCFullYear() : projStart;
    const idx = Math.max(0, Math.max(0, psy - projStart) - 1);
    if (idx < N) oldRule[idx] += value;
  }
  const cum = (a: number[]): number[] => { let r = 0; return a.map((v) => (r += v ?? 0)); };
  const cumOld = cum(oldRule), cumNew = cum(snap.financing.equity.inKindPerPeriod);
  const worst = Math.max(...cumNew.map((v, t) => Math.abs((cumOld[t] ?? 0) - v)));
  check('counterfactual: the retired rule and the current one DISAGREE on this fixture',
    worst > 1, `worst cumulative gap = ${worst.toFixed(0)} (a zero here means the fixture stopped reproducing the defect and section A is vacuous)`);
  check('counterfactual: they still agree on the lifetime total (only the TIMING was wrong)',
    near(sum(oldRule), sum(snap.financing.equity.inKindPerPeriod), 1),
    `${sum(oldRule).toFixed(0)} vs ${sum(snap.financing.equity.inKindPerPeriod).toFixed(0)}`);
  console.log(`         (the Balance Sheet was out by ${(worst / 1e6).toFixed(1)}m under the retired rule; it is 0.00 now)`);
}

// I. A project with no in-kind land at all is untouched by any of this.
{
  console.log('\n-- no in-kind land at all --');
  const s = buildCrossPhase();
  s.parcels = s.parcels.map((p) => ({ ...p, cashPct: 100, inKindPct: 0 }));
  const snap = computeFinancialsSnapshot(s);
  const N = snap.axisLength;
  check('all-cash land: no in-kind land anywhere', near(sum(snap.financing.capex.perPeriod.landInKind), 0));
  check('all-cash land: no in-kind equity anywhere', near(sum(snap.financing.equity.inKindPerPeriod), 0));
  const rows = buildDirectCFRows(ctxFor(s, snap));
  check('all-cash land: no memo row is rendered', !memoRow(rows));
  const total = rowByLabel(rows, 'Total Capex');
  const rowsTotal = seriesSum(capexAssetRows(rows), N);
  check('all-cash land: the section still foots',
    !!total && Array.from({ length: N }, (_, t) => near(rowsTotal[t], total.values[t] ?? 0, 0.5)).every(Boolean));
  check('all-cash land: Balance Sheet still balances',
    Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))) < 1);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(failed > 0 ? 1 : 0);
