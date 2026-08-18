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
  // 3: FCFE deducts the TOTAL finance cost rather than the operating half, so
  //    the IDC is charged once in FCFF and once again here.
  for (let t = 0; t < N; t++) rs.fcfePerPeriod[t + 1] = (rs.fcfePerPeriod[t + 1] ?? 0) - (d.idcPaidPerPeriod[t] ?? 0);
}
if (SAB === 4) {
  // 4: the classification reverts to a phase window, so a period with real
  //    construction spend books its interest as an operating finance cost.
  //    Reclassified IN PLACE, so the period still has spend: that is the shape
  //    the live project was in, where 2030 was building and its interest was
  //    not IDC.
  d.operatingInterestPaidPerPeriod[0] = (d.operatingInterestPaidPerPeriod[0] ?? 0) + (d.idcPaidPerPeriod[0] ?? 0);
  d.idcPaidPerPeriod[0] = 0;
}
if (SAB === 5) {
  // 5: IDC goes back to being rolled into the balance instead of paid, so the
  //    drawdown exceeds what it funds and the debt no longer foots.
  for (let t = 0; t < N; t++) d.idcDrawdownPerPeriod[t] = (d.idcDrawdownPerPeriod[t] ?? 0) * 2;
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
  const idc = d.idcPaidPerPeriod[t] ?? 0;
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
check('debt drawn for IDC never exceeds the IDC itself',
  d.idcDrawdownPerPeriod.every((v, t) => v <= (d.idcPaidPerPeriod[t] ?? 0) + 0.01));
check('the two drawdowns sum to the debt drawdown on the cash flow',
  Array.from({ length: N }, (_, t) => Math.abs(((d.capexDrawdownPerPeriod[t] ?? 0) + (d.idcDrawdownPerPeriod[t] ?? 0))
    - (d.debtDrawdownPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
// The whole facility, base plus IDC, is repaid.
const drawnAll = sum(d.capexDrawdownPerPeriod) + sum(d.idcDrawdownPerPeriod);
const repaidAll = -sum(d.debtRepaymentPerPeriod);
check('total debt = base facility + IDC drawn, and ALL of it is repaid',
  Math.abs(drawnAll - repaidAll) < Math.max(1, drawnAll * 1e-6),
  `drawn ${(drawnAll / 1e6).toFixed(3)}m vs repaid ${(repaidAll / 1e6).toFixed(3)}m`);
check('the retired toggles are not consulted: the snapshot reports the one treatment',
  snap.idc.capitalize === true && snap.idc.fundingMode === 'conditional');

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

// ── 3. FCFF is full cost ─────────────────────────────────────────────────────
console.log('\n-- 2. FCFF deducts the FULL COST of building --');
const b = rs.buildup;
check('FCFF names the cash capex, the in-kind land and the IDC, each on its own row',
  FCFF_BUILDUP_LABELS.some((l) => l.includes('Capex, cash'))
  && FCFF_BUILDUP_LABELS.some((l) => l.includes('Land Contributed In-Kind'))
  && FCFF_BUILDUP_LABELS.some((l) => l.includes('Interest During Construction')),
  FCFF_BUILDUP_LABELS.join(' | '));
check('FCFF states that Cash from Operations is PRE-INTEREST',
  FCFF_BUILDUP_LABELS.some((l) => l.includes('pre-interest')));
{
  const rows = buildFcffBuildup(rs, m4StreamRow);
  const comps = rows.slice(0, -1);
  const ok = rs.fcffPerPeriod.every((v, t) => Math.abs(comps.reduce((a, r) => a + (r.values[t] ?? 0), 0) - v) < 0.01);
  check('the FCFF rows sum to FCFF in every period', ok);
}
check('the in-kind land really is inside FCFF (removing it breaks the identity)',
  rs.fcffPerPeriod.some((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.idcCapitalisedPerPeriod[t] ?? 0) + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) > 0.01));
check('the IDC really is inside FCFF (removing it breaks the identity)',
  rs.fcffPerPeriod.some((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.inKindLandPerPeriod[t] ?? 0) + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) > 0.01));

// ── 4. FCFE chains from FCFF, and nothing is charged twice ───────────────────
console.log('\n-- 3. FCFE builds from FCFF, each cost charged exactly ONCE --');
check('the FCFE chain opens with the FCFF subtotal',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('FCFF (unlevered')), FCFE_BUILDUP_LABELS.join(' | '));
check('the FCFE chain names both drawdowns and the OPERATING finance cost',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('Debt Drawdown for Capex'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Debt Drawdown for IDC'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Finance Cost, operating')));
check('the FCFE chain swaps the terminal EXPLICITLY, backing the enterprise one out',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('Terminal Enterprise Value (in FCFF above)'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Terminal Value less Closing Debt')));
// THE DOUBLE-CHARGE GUARD. Neither cost may appear a second time in the chain.
check('NO in-kind row and NO IDC row in the FCFE chain (they are inside FCFF)',
  !FCFE_BUILDUP_LABELS.some((l) => /in-kind/i.test(l))
  && !FCFE_BUILDUP_LABELS.some((l) => /Interest During Construction/i.test(l)),
  FCFE_BUILDUP_LABELS.filter((l) => /in-kind|Interest During/i.test(l)).join(' | '));
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
      - (d.idcPaidPerPeriod[t] ?? 0)
      + (d.capexDrawdownPerPeriod[t] ?? 0) + (d.idcDrawdownPerPeriod[t] ?? 0)
      + (d.debtRepaymentPerPeriod[t] ?? 0)               // already negative
      - (d.operatingInterestPaidPerPeriod[t] ?? 0);
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
  check('the cash flow names the capex drawdown and the IDC drawdown separately',
    has('Debt Drawdown for Capex') && has('Debt Drawdown for IDC'));
  check('the cash flow shows the IDC as PAID and says it is capitalised',
    has('Interest During Construction paid (capitalised into asset cost)'));
  check('the old offsetting contra row is GONE (it would deduct IDC twice)',
    !has('Capitalised via IDC drawdown'));
  const idcRow = rows.find((r) => r.label.includes('Interest During Construction paid'));
  check('the IDC row carries the IDC figure', !!idcRow && Math.abs(-sum(idcRow.values) - idcTotal) < 1,
    `row ${idcRow ? (-sum(idcRow.values) / 1e6).toFixed(3) : 'absent'}m vs IDC ${(idcTotal / 1e6).toFixed(3)}m`);
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
