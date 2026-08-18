/**
 * verify-returns-buildup.ts (2026-08-18)
 *
 * Pins the three changes that brought the returns build-ups and IDC onto the
 * reference treatment.
 *
 *   1. FCFF DEDUCTS FULL-COST CAPEX: the cash capex, the land contributed in
 *      kind, and the IDC. It used to deduct only the cash capex, so a project
 *      whose land arrived in kind and whose interest was capitalised showed an
 *      unlevered return on a cost base it had not paid for. Measured on the
 *      live project: 41.24% / 4.912x became 24.67% / 3.064x.
 *
 *   2. FCFE BUILDS FROM FCFF, visibly, and each of the three cost pieces is
 *      charged EXACTLY ONCE. This is the check that matters: it is easy to make
 *      FCFF full-cost and leave the old in-kind row in FCFE, which charges the
 *      sponsor twice for land they contributed once. The guard is an algebraic
 *      identity against the equity holder's actual net cash, not a row count.
 *
 *   3. IDC IS ONE TREATMENT. While construction spend is happening the whole of
 *      that period's finance cost is IDC; it is paid in the period it arises;
 *      debt is drawn only for the part cash cannot cover. The capitalize and
 *      fundingMode toggles are gone, so two projects cannot behave differently.
 *
 * Usage: npx tsx scripts/verify-returns-buildup.ts
 *        npx tsx scripts/verify-returns-buildup.ts --sabotage=<n>
 *
 * No em dashes in this file.
 */
import {
  type Asset, type CostLine, type Phase, type Project, type SubUnit, type Parcel,
  makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  FCFF_BUILDUP_LABELS, FCFE_BUILDUP_LABELS, buildFcffBuildup, buildFcfeBuildup, m4StreamRow,
} from '../src/hubs/modeling/platforms/refm/lib/reports/streamReports';
import { buildDirectCFRows } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '../src/core/calculations/financials';

type State = Parameters<typeof computeFinancialsSnapshot>[0];
let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` :: ${detail}` : ''}`); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);
const SAB = Number(/--sabotage=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 0);

// ── Fixture: in-kind land AND a real IDC bill, so neither section is vacuous ──
function build(): State {
  const project: Project = { ...makeDefaultProject(), startDate: '2027-01-01' };
  (project as unknown as { financing: unknown }).financing = {
    fundingMethod: 1, parcelFunding: [], fixedRatio: { debtPct: 70, equityPct: 30 },
    minimumCashReserve: 5_000_000, viewMode: 'combined', phaseFilter: 'all',
  };
  const p1: Phase = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2027-01-01', constructionPeriods: 3, operationsPeriods: 7, overlapPeriods: 0 };
  // Half the land in kind, so the FCFF deduction is real and measurable.
  const parcel: Parcel = { id: 'parcel_1', phaseId: 'p1', name: 'Plot', area: 20000, rate: 4000, cashPct: 50, inKindPct: 50 };
  const sell = {
    id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'a1',
      subUnits: [{ subUnitId: 'su1', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0, 0.3, 0.4, 0.3, 0, 0, 0, 0], postSalesVelocityByPhase: [] }],
      cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] },
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' } } },
  } as unknown as Asset;
  const su = { id: 'su1', assetId: 'a1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 50000, unitPrice: 6000 } as unknown as SubUnit;
  const costLines: CostLine[] = makeDefaultCostLines('p1', 3);
  return {
    project, phases: [p1], assets: [sell], subUnits: [su], parcels: [parcel], costLines,
    costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [],
  } as State;
}

console.log('=== verify-returns-buildup ===');
if (SAB) console.log(`SABOTAGE ${SAB} ACTIVE: the failures below are the point.\n`);

const state = build();
const snap = computeFinancialsSnapshot(state);
const rs = computeReturnsSnapshot(snap, state.project);
const N = snap.axisLength;
const d = snap.directCF;

// Sabotages reproduce, on the finished snapshot, exactly the mistakes this file
// exists to catch. Applied AFTER the engine runs, so they cannot be defended
// against by anything the engine does.
if (SAB === 1) {
  // 1: FCFE charges the in-kind land a SECOND time, the mistake that making
  //    FCFF full-cost invites if the old FCFE row is left in place.
  for (let t = 0; t < rs.fcfePerPeriod.length; t++) rs.fcfePerPeriod[t] += (rs.buildup.inKindLandPerPeriod[t] ?? 0);
}
if (SAB === 2) {
  // 2: FCFF back to the cash basis, ignoring the land contributed in kind.
  for (let t = 0; t < rs.fcffPerPeriod.length; t++) rs.fcffPerPeriod[t] -= (rs.buildup.inKindLandPerPeriod[t] ?? 0);
}
if (SAB === 3) {
  // 3: FCFE deducts the full charge but FORGETS the IDC drawdown beside it, so
  //    the capitalised slice is charged to equity twice.
  for (let t = 0; t < N; t++) rs.fcfePerPeriod[t + 1] = (rs.fcfePerPeriod[t + 1] ?? 0) - (d.idcDrawdownPerPeriod[t] ?? 0);
}
if (SAB === 4) {
  // 4: the classification reverts to a phase window, so a period with real
  //    construction spend books its interest as an operating finance cost.
  //    Reclassified IN PLACE, so the period still has spend: that is the shape
  //    the live project was in, where 2030 was building and its interest was
  //    not IDC.
  d.operatingInterestPaidPerPeriod[0] = (d.operatingInterestPaidPerPeriod[0] ?? 0) + (d.idcAccruedPerPeriod[0] ?? 0);
  d.idcAccruedPerPeriod[0] = 0;
  d.idcPaidPerPeriod[0] = 0;
}
if (SAB === 5) {
  // 5: the capitalised slice is treated as paid as well, which is the ledger
  //    defect: it gets removed twice and the roll walks negative.
  for (let t = 0; t < N; t++) {
    snap.financing.combined.totalInterestPaid[t] = (snap.financing.combined.totalInterestPaid[t] ?? 0)
      + (snap.financing.combined.totalInterestCapitalized[t] ?? 0);
  }
}

// ── 1. The fixture is not vacuous ────────────────────────────────────────────
console.log('\n-- 0. The fixture exercises both cost pieces --');
const inKindTotal = sum(snap.financing.capex.perPeriod.landInKind);
const idcTotal = sum(snap.financing.combined.totalIdc);
check('the fixture has land contributed IN KIND', inKindTotal > 0, `${(inKindTotal / 1e6).toFixed(2)}m`);
check('the fixture has a real IDC bill', idcTotal > 0, `${(idcTotal / 1e6).toFixed(2)}m`);

// ── 2. IDC: one treatment ────────────────────────────────────────────────────
console.log('\n-- 1. IDC: classification, payment and funding --');
const capexByPeriod = snap.financing.capex.perPeriod.inclAllLand;
let classOk = true, classDetail = '';
for (let t = 0; t < N; t++) {
  const spend = capexByPeriod[t] ?? 0;
  const idc = d.idcAccruedPerPeriod[t] ?? 0;
  const op = d.operatingInterestPaidPerPeriod[t] ?? 0;
  // A period with spend puts its WHOLE finance cost in IDC; a period without
  // puts none of it there. This is the rule that replaced the phase window.
  if (spend > 0 && op > 0.01) { classOk = false; classDetail = `t=${t} has spend ${spend.toFixed(0)} but ${op.toFixed(0)} of operating finance cost`; }
  if (spend <= 0 && idc > 0.01) { classOk = false; classDetail = `t=${t} has NO spend but ${idc.toFixed(0)} of IDC`; }
}
check('the split follows CONSTRUCTION SPEND, not a phase window', classOk, classDetail);
check('IDC is PAID in the period it arises, all of it',
  d.idcPaidPerPeriod.every((v, t) => v <= (d.idcPaidPerPeriod[t] ?? 0) + (d.operatingInterestPaidPerPeriod[t] ?? 0) + 0.01));
check('IDC + operating finance cost = interest paid, every period',
  Array.from({ length: N }, (_, t) => Math.abs(((d.idcPaidPerPeriod[t] ?? 0) + (d.operatingInterestPaidPerPeriod[t] ?? 0))
    - -(d.interestPaidPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
check('debt drawn for IDC never exceeds the IDC charge it funds',
  d.idcDrawdownPerPeriod.every((v, t) => v <= (d.idcAccruedPerPeriod[t] ?? 0) + 0.01));
check('IDC charge = the cash half plus the debt-funded half, every period',
  Array.from({ length: N }, (_, t) => Math.abs((d.idcAccruedPerPeriod[t] ?? 0)
    - ((d.idcPaidPerPeriod[t] ?? 0) + (d.idcDrawdownPerPeriod[t] ?? 0))) < 0.01).every(Boolean));
// ONLY THE CAPEX DRAWDOWN IS CASH. The IDC drawdown funds interest that is
// never paid out, so it must not appear as a financing inflow; it grows the
// balance and leaves later as principal.
check('the cash drawdown is the CAPEX drawdown alone',
  Array.from({ length: N }, (_, t) => Math.abs((d.capexDrawdownPerPeriod[t] ?? 0)
    - (d.debtDrawdownPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
check('the IDC drawdown is NOT inside the cash drawdown',
  sum(d.idcDrawdownPerPeriod) > 0
  && Math.abs(sum(d.debtDrawdownPerPeriod) - sum(d.capexDrawdownPerPeriod)) < 0.01,
  `idcDraw ${(sum(d.idcDrawdownPerPeriod) / 1e6).toFixed(3)}m`);
// The whole facility, base plus IDC, is repaid.
const drawnAll = sum(d.capexDrawdownPerPeriod) + sum(d.idcDrawdownPerPeriod);
const repaidAll = -sum(d.debtRepaymentPerPeriod);
check('total debt = base facility + IDC drawn, and ALL of it is repaid',
  Math.abs(drawnAll - repaidAll) < Math.max(1, drawnAll * 1e-6),
  `drawn ${(drawnAll / 1e6).toFixed(3)}m vs repaid ${(repaidAll / 1e6).toFixed(3)}m`);
check('the retired toggles are not consulted: the snapshot reports the one treatment',
  snap.idc.capitalize === true && snap.idc.fundingMode === 'conditional');

// THE STRICT QUALIFYING-ASSET TEST (decision 2026-08-18). Interest is IDC only
// to the extent it funds an asset still UNDER CONSTRUCTION. A specific
// borrowing against an asset that is complete and operating is not directly
// attributable to anything being built, however much building is going on
// elsewhere in the project, so its interest stays an operating finance cost.
//
// This is the guard against reintroducing the capex-share allocation that was
// designed, measured and rejected: on FMP RE HUB it reclassified 604,800k of a
// pre-existing hotel loan into IDC purely because other phases were building.
// See CLAUDE-TODO.md, "tranche.phaseId is not a usable attribution key".
{
  const withExisting = build();
  withExisting.financingTranches = [
    ...withExisting.financingTranches,
    {
      ...makeDefaultFinancingTranche('t-existing', 'p1'),
      origin: 'existing' as const, openingBalance: 40_000_000, originationYear: 2025,
      interestRatePct: 6,
    },
  ];
  const exSnap = computeFinancialsSnapshot(withExisting);
  const exFac = exSnap.financing.facilities.get('t-existing');
  const exIdc = sum(exFac?.interestDuringConstruction);
  const exAccrued = sum(exFac?.interestAccrued);
  check('an EXISTING facility accrues real interest in the fixture (else this is vacuous)',
    exAccrued > 0, `${(exAccrued / 1e6).toFixed(2)}m`);
  check('an EXISTING facility\'s interest is NEVER IDC, even while other assets are building',
    Math.abs(exIdc) < 0.01, `${(exIdc / 1e6).toFixed(3)}m classified as IDC`);
  // And it must not have quietly leaked into the project IDC total either.
  check('the project IDC total excludes it',
    Math.abs(sum(exSnap.financing.combined.totalIdc) - sum(exSnap.financing.combined.totalIdc.map((v, t) => {
      const newFac = exSnap.financing.facilities.get('t1');
      return Math.min(v, (newFac?.interestDuringConstruction?.[t] ?? 0) + 0.01);
    }))) < 0.01);
}

// A saved project carrying the OLD toggles must be ignored, not obeyed.
{
  const legacy = build();
  (legacy.project as unknown as { idcConfig: unknown }).idcConfig = { allocationBasis: 'land', capitalize: false, fundingMode: 'cash' };
  const legacySnap = computeFinancialsSnapshot(legacy);
  check('a saved project with capitalize=false / fundingMode=cash behaves IDENTICALLY',
    Math.abs(sum(legacySnap.financing.combined.totalIdc) - idcTotal) < 0.01
    && Math.abs(sum(legacySnap.directCF.closingCashPerPeriod) - sum(d.closingCashPerPeriod)) < 1,
    `idc ${sum(legacySnap.financing.combined.totalIdc).toFixed(0)} vs ${idcTotal.toFixed(0)}`);
}

// ── 3. FCFF is unlevered, and carries capex including in-kind land ──────────
console.log('\n-- 2. FCFF: capex incl. in-kind land, and NO interest of any kind --');
const b = rs.buildup;
check('FCFF names the cash capex and the in-kind land, each on its own row',
  FCFF_BUILDUP_LABELS.some((l) => l.includes('Capex, cash'))
  && FCFF_BUILDUP_LABELS.some((l) => l.includes('Land Contributed In-Kind')),
  FCFF_BUILDUP_LABELS.join(' | '));
check('FCFF states that Cash from Operations is PRE-INTEREST',
  FCFF_BUILDUP_LABELS.some((l) => l.includes('pre-interest')));

// THE UNLEVERED-PURITY GUARD. FCFF is an unlevered measure, so no row in it
// may be an interest or IDC line. This is a check on the ROW LIST, so it bites
// the moment anyone adds one back, which is exactly what happened on
// 2026-08-18a and was reversed the same day.
{
  const offenders = FCFF_BUILDUP_LABELS.filter((l) =>
    /\bIDC\b|finance cost|during construction|interest (paid|charge|expense)|\(-\)[^)]*interest/i.test(l));
  check('UNLEVERED PURITY: no interest, IDC or finance-cost row appears in FCFF',
    offenders.length === 0, offenders.join(' | '));
}
{
  const rows = buildFcffBuildup(rs, m4StreamRow);
  const comps = rows.slice(0, -1);
  const ok = rs.fcffPerPeriod.every((v, t) => Math.abs(comps.reduce((a, r) => a + (r.values[t] ?? 0), 0) - v) < 0.01);
  check('the FCFF rows sum to FCFF in every period', ok);
}
check('the in-kind land really is inside FCFF (removing it breaks the identity)',
  rs.fcffPerPeriod.some((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) > 0.01));
// And the numeric half of the purity guard: FCFF must reconstruct from cfo,
// cash capex and in-kind land alone, with no interest term needed.
check('NUMERIC PURITY: FCFF reconstructs with no interest term at all',
  rs.fcffPerPeriod.every((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.inKindLandPerPeriod[t] ?? 0) + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) < 0.01));

// ── 4. FCFE chains from FCFF, and nothing is charged twice ───────────────────
console.log('\n-- 3. FCFE builds from FCFF, each cost charged exactly ONCE --');
check('the FCFE chain opens with the FCFF subtotal',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('FCFF (unlevered')), FCFE_BUILDUP_LABELS.join(' | '));
check('the FCFE chain names both drawdowns and the FULL finance cost',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('Debt Drawdown for Capex'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Debt Drawdown for IDC'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('full accrued charge')));
check('the FCFE chain swaps the terminal EXPLICITLY, backing the enterprise one out',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('Terminal Enterprise Value (in FCFF above)'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Terminal Value less Closing Debt')));
// THE DOUBLE-CHARGE GUARD. In-kind land is inside FCFF and must not repeat.
// The finance cost is NOT inside FCFF, so it appears here once, in full.
check('NO in-kind row in the FCFE chain (it is inside FCFF)',
  !FCFE_BUILDUP_LABELS.some((l) => /in-kind/i.test(l)),
  FCFE_BUILDUP_LABELS.filter((l) => /in-kind/i.test(l)).join(' | '));
check('exactly ONE finance-cost row in the FCFE chain',
  FCFE_BUILDUP_LABELS.filter((l) => /finance cost/i.test(l)).length === 1,
  FCFE_BUILDUP_LABELS.filter((l) => /finance cost/i.test(l)).join(' | '));
{
  const rows = buildFcfeBuildup(rs, m4StreamRow);
  const comps = rows.slice(0, -1);
  const ok = rs.fcfePerPeriod.every((v, t) => Math.abs(comps.reduce((a, r) => a + (r.values[t] ?? 0), 0) - v) < 0.01);
  check('the FCFE rows sum to FCFE in every period', ok);
}

// THE IDENTITY THAT PROVES IT. FCFE must equal the equity holder's real net
// cash, built from the cash statement independently of the returns engine. If
// any piece were charged twice this is where it shows, by exactly that amount.
{
  let worst = 0, at = -1;
  for (let t = 0; t < N; t++) {
    const equityCash = (d.cashFromOperationsPerPeriod[t] ?? 0)
      + (d.capexPerPeriod[t] ?? 0)                       // negative: cash capex
      - (snap.financing.capex.perPeriod.landInKind[t] ?? 0)
      - (d.idcPaidPerPeriod[t] ?? 0)                     // the CASH half of IDC
      - (d.operatingInterestPaidPerPeriod[t] ?? 0)
      + (d.capexDrawdownPerPeriod[t] ?? 0)               // the only cash drawdown
      + (d.debtRepaymentPerPeriod[t] ?? 0);              // already negative
    // rs streams are inception-prefixed, so axis period t is index t+1; strip
    // the terminal value, which is a valuation and not a cash movement.
    const fromStream = (rs.fcfePerPeriod[t + 1] ?? 0) - (b.terminalEquityPerPeriod[t + 1] ?? 0);
    const diff = Math.abs(equityCash - fromStream);
    if (diff > worst) { worst = diff; at = t; }
  }
  check('FCFE equals the equity holder\'s actual net cash, every period (the double-charge guard)',
    worst < 1, `worst ${worst.toFixed(2)} at t=${at}`);
}

// ── 5. The cash flow shows IDC ───────────────────────────────────────────────
console.log('\n-- 4. A reader can SEE the IDC on the cash flow --');
{
  const rows = buildDirectCFRows({
    snap, state, filterPhaseId: '__all__',
    labels: getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country)),
    fmt: (v: number) => String(v),
  } as Parameters<typeof buildDirectCFRows>[0]);
  const has = (frag: string): boolean => rows.some((r) => r.label.includes(frag));
  check('the cash flow names the capex drawdown, and the IDC drawdown as a MEMO',
    has('Debt Drawdown for Capex') && has('(memo) IDC capitalised to debt, non-cash'));
  check('the cash flow shows the IDC paid IN CASH',
    has('Interest During Construction paid in cash'));
  check('the old offsetting contra row is GONE (it would deduct IDC twice)',
    !has('Capitalised via IDC drawdown'));
  const idcRow = rows.find((r) => r.label.includes('Interest During Construction paid in cash'));
  const idcCashTotal = sum(d.idcPaidPerPeriod);
  check('the IDC cash row carries the CASH half, not the whole charge',
    !!idcRow && Math.abs(-sum(idcRow.values) - idcCashTotal) < 1,
    `row ${idcRow ? (-sum(idcRow.values) / 1e6).toFixed(3) : 'absent'}m vs cash IDC ${(idcCashTotal / 1e6).toFixed(3)}m (charge ${(idcTotal / 1e6).toFixed(3)}m)`);
}

// ── 5b. THE FINANCE COST ROLL FOOTS ─────────────────────────────────────────
// Opening + Accrued - Capitalised - Paid = Closing, with Paid being CASH ONLY.
// This is the ledger that walked to a stuck -21,525 on the live project when
// `interestPaid` briefly carried the whole charge: the capitalised slice was
// removed twice, once as capitalised and once inside paid.
console.log('\n-- 5. The finance cost ledger foots, with cash-paid excluding the capitalised slice --');
{
  const c = snap.financing.combined;
  let open = 0, worst = 0;
  for (let t = 0; t < N; t++) {
    const close = open + (c.totalInterestAccrued[t] ?? 0) - (c.totalInterestCapitalized[t] ?? 0)
      - (c.totalInterestPaid[t] ?? 0);
    if (Math.abs(close) > Math.abs(worst)) worst = close;
    open = close;
  }
  check('the finance cost roll closes at ZERO every period', Math.abs(worst) < 0.01,
    `worst closing ${(worst / 1e6).toFixed(3)}m`);
  check('cash paid EXCLUDES the capitalised slice',
    Math.abs(sum(c.totalInterestPaid) - (sum(c.totalInterestAccrued) - sum(c.totalInterestCapitalized))) < 0.01,
    `paid ${(sum(c.totalInterestPaid) / 1e6).toFixed(3)}m vs accrued-less-capitalised ${((sum(c.totalInterestAccrued) - sum(c.totalInterestCapitalized)) / 1e6).toFixed(3)}m`);
  check('the capitalised slice is real on this fixture (else the two above are vacuous)',
    sum(c.totalInterestCapitalized) > 0, `${(sum(c.totalInterestCapitalized) / 1e6).toFixed(3)}m`);
}

// ── 6. Nothing else moved ────────────────────────────────────────────────────
console.log('\n-- 5. The statements still reconcile --');
check('the balance sheet balances every period',
  Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))) < 1,
  `worst ${Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))).toFixed(2)}`);
check('Direct CF closing cash == Indirect CF closing cash',
  snap.directCF.closingCashPerPeriod.every((v, t) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[t] ?? 0)) < 1));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail > 0 ? 1 : 0);
