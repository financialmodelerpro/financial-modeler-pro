/**
 * verify-returns-buildup.ts (2026-08-18, rewritten 2026-08-18c)
 *
 * Pins the returns build-ups and the IDC treatment to the REFERENCE MODEL,
 * whose formulas were read directly (Schedules rows 100 to 165, Returns rows
 * 93 to 109). Every check below is a property of that structure.
 *
 *   IDC. The FULL finance cost is paid each period; where cash is short, debt
 *   is drawn for the shortfall only; the cash flow shows the interest OUT and
 *   the drawdown IN. Capitalising routes the charge into the asset (cost of
 *   sales, fixed assets), it is not a non-cash item and never a memo. The IDC
 *   versus operating split is a genuine split of two different charges and is
 *   kept; what is NOT kept is the same movement stated three ways. A period is
 *   a construction period because construction COST is incurred in it, not
 *   because funding is still being drawn.
 *
 *   FCFF. Cash from operations, less capex INCLUDING in-kind land, plus the
 *   terminal value. UNLEVERED: no interest of any kind, IDC included.
 *
 *   FCFE. FOUR steps from the PRE-TERMINAL FCFF: plus net debt, less the full
 *   finance cost, plus the terminal value less closing debt. Plus one row the
 *   reference does not carry and this model does deliberately: the in-kind
 *   land is charged in FCFF (a real resource) and CREDITED in FCFE (a real
 *   equity contribution), so across the pair it is charged once and credited
 *   once, and FCFE is the return on cash equity.
 *
 *   EQUITY. The draw is one line whose total never changes, with a MEMO
 *   attributing it pro rata across what it funded: capex, fund fees, operating
 *   shortfall, finance cost.
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
const M = (v: number): string => `${(v / 1e6).toFixed(3)}m`;

// ── Fixture: in-kind land AND a real IDC bill, so no section is vacuous ──────
function build(): State {
  const project: Project = { ...makeDefaultProject(), startDate: '2027-01-01' };
  (project as unknown as { financing: unknown }).financing = {
    fundingMethod: 1, parcelFunding: [], fixedRatio: { debtPct: 70, equityPct: 30 },
    minimumCashReserve: 5_000_000, viewMode: 'combined', phaseFilter: 'all',
  };
  const p1: Phase = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2027-01-01', constructionPeriods: 3, operationsPeriods: 7, overlapPeriods: 0 };
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
const b = rs.buildup;

// Sabotages reproduce, on the finished snapshot, exactly the mistakes this file
// exists to catch. Applied AFTER the engine runs.
if (SAB === 1) {
  // 1: FCFE forgets the IDC drawdown, so the capitalised slice is charged to
  //    equity (inside the full finance cost) but the debt that funded it is
  //    never credited.
  for (let t = 0; t < N; t++) rs.fcfePerPeriod[t + 1] = (rs.fcfePerPeriod[t + 1] ?? 0) - (d.idcDrawdownPerPeriod[t] ?? 0);
}
if (SAB === 2) {
  // 2: FCFF back to the cash basis, ignoring the land contributed in kind.
  for (let t = 0; t < rs.fcffPerPeriod.length; t++) rs.fcffPerPeriod[t] -= (b.inKindLandPerPeriod[t] ?? 0);
}
if (SAB === 3) {
  // 3: FCFE forgets the in-kind credit, so the equity holder is charged for
  //    land they contributed and never credited for contributing it.
  for (let t = 0; t < rs.fcfePerPeriod.length; t++) rs.fcfePerPeriod[t] -= (b.inKindEquityCreditPerPeriod[t] ?? 0);
}
if (SAB === 4) {
  // 4: the classification reverts to a phase window: a period with real
  //    construction spend books its interest as operating. Reclassified IN
  //    PLACE so the period still has spend, which is the shape the live
  //    project was in when 2030 was building and its interest was not IDC.
  d.operatingInterestPaidPerPeriod[0] = (d.operatingInterestPaidPerPeriod[0] ?? 0) + (d.idcAccruedPerPeriod[0] ?? 0);
  d.idcAccruedPerPeriod[0] = 0;
  d.idcPaidPerPeriod[0] = 0;
}
if (SAB === 5) {
  // 5: interest goes back to "cash only" (the payment understated by the
  //    capitalised slice), so paid != accrued and the ledger stops closing.
  for (let t = 0; t < N; t++) {
    snap.financing.combined.totalInterestPaid[t] = (snap.financing.combined.totalInterestPaid[t] ?? 0)
      - (snap.financing.combined.totalInterestCapitalized[t] ?? 0);
  }
}
if (SAB === 6) {
  // 6: the equity memo drifts from the draw it explains.
  for (let t = 0; t < N; t++) d.equityForCapexPerPeriod[t] = (d.equityForCapexPerPeriod[t] ?? 0) * 1.1;
}

// ── 0. Not vacuous ───────────────────────────────────────────────────────────
console.log('\n-- 0. The fixture exercises every piece --');
const inKindTotal = sum(snap.financing.capex.perPeriod.landInKind);
const idcTotal = sum(snap.financing.combined.totalIdc);
check('the fixture has land contributed IN KIND', inKindTotal > 0, M(inKindTotal));
check('the fixture has a real IDC bill', idcTotal > 0, M(idcTotal));
check('the fixture draws debt for IDC (a real shortfall)', sum(d.idcDrawdownPerPeriod) > 0, M(sum(d.idcDrawdownPerPeriod)));
check('the fixture draws cash equity', sum(d.equityDrawdownPerPeriod) > 0, M(sum(d.equityDrawdownPerPeriod)));

// ── 1. IDC: the reference treatment ─────────────────────────────────────────
console.log('\n-- 1. IDC: classified by construction COST, paid in full, shortfall drawn --');
const capexByPeriod = snap.financing.capex.perPeriod.inclAllLand;
{
  let ok = true, detail = '';
  for (let t = 0; t < N; t++) {
    const spend = capexByPeriod[t] ?? 0;
    const idc = d.idcAccruedPerPeriod[t] ?? 0;
    const op = d.operatingInterestPaidPerPeriod[t] ?? 0;
    // A period with construction COST puts its WHOLE finance cost in IDC; a
    // period without puts none of it there. Cost, not funding: a period whose
    // spend is covered by pre-sales draws nothing and is still a construction
    // period.
    if (spend > 0 && op > 0.01) { ok = false; detail = `t=${t} has spend ${spend.toFixed(0)} but ${op.toFixed(0)} operating`; }
    if (spend <= 0 && idc > 0.01) { ok = false; detail = `t=${t} has NO spend but ${idc.toFixed(0)} of IDC`; }
  }
  check('the split follows CONSTRUCTION COST, not a phase window and not funding', ok, detail);
}
// The 2030 shape: a construction period with NO drawdown must still carry IDC.
{
  const t = Array.from({ length: N }, (_, i) => i).find((i) => (capexByPeriod[i] ?? 0) > 0 && (d.capexDrawdownPerPeriod[i] ?? 0) === 0 && (d.idcDrawdownPerPeriod[i] ?? 0) === 0);
  if (t !== undefined) {
    check(`a construction period funded entirely by pre-sales (t=${t}) still carries IDC`, (d.idcAccruedPerPeriod[t] ?? 0) > 0);
  } else {
    console.log('  (info) no construction period in the fixture is entirely pre-sales funded; the live project has one');
  }
}
check('the IDC charge is PAID IN FULL (paid == accrued, every period)',
  Array.from({ length: N }, (_, t) => Math.abs((d.idcAccruedPerPeriod[t] ?? 0) - (d.idcPaidPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
check('IDC + operating finance cost = interest paid, every period',
  Array.from({ length: N }, (_, t) => Math.abs(((d.idcPaidPerPeriod[t] ?? 0) + (d.operatingInterestPaidPerPeriod[t] ?? 0))
    - -(d.interestPaidPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
check('debt is drawn for IDC only up to the charge (shortfall, never more)',
  d.idcDrawdownPerPeriod.every((v, t) => v <= (d.idcAccruedPerPeriod[t] ?? 0) + 0.01));
check('the cash drawdown is capex PLUS IDC: the IDC drawdown IS cash',
  Array.from({ length: N }, (_, t) => Math.abs(((d.capexDrawdownPerPeriod[t] ?? 0) + (d.idcDrawdownPerPeriod[t] ?? 0))
    - (d.debtDrawdownPerPeriod[t] ?? 0)) < 0.01).every(Boolean));
{
  const drawnAll = sum(d.capexDrawdownPerPeriod) + sum(d.idcDrawdownPerPeriod);
  const repaidAll = -sum(d.debtRepaymentPerPeriod);
  check('total debt = base facility + IDC drawn, and ALL of it is repaid',
    Math.abs(drawnAll - repaidAll) < Math.max(1, drawnAll * 1e-6), `drawn ${M(drawnAll)} vs repaid ${M(repaidAll)}`);
}
check('the retired toggles are not consulted: the snapshot reports the one treatment',
  snap.idc.capitalize === true && snap.idc.fundingMode === 'conditional');
{
  const legacy = build();
  (legacy.project as unknown as { idcConfig: unknown }).idcConfig = { allocationBasis: 'land', capitalize: false, fundingMode: 'cash' };
  const legacySnap = computeFinancialsSnapshot(legacy);
  check('a saved project with capitalize=false / fundingMode=cash behaves IDENTICALLY',
    Math.abs(sum(legacySnap.financing.combined.totalIdc) - idcTotal) < 0.01
    && Math.abs(sum(legacySnap.directCF.closingCashPerPeriod) - sum(d.closingCashPerPeriod)) < 1);
}
// The strict qualifying-asset test (decision 2026-08-18): an existing facility
// against an operating asset is never IDC, however much is being built.
{
  const withExisting = build();
  withExisting.financingTranches = [
    ...withExisting.financingTranches,
    { ...makeDefaultFinancingTranche('t-existing', 'p1'), origin: 'existing' as const, openingBalance: 40_000_000, originationYear: 2025, interestRatePct: 6 },
  ];
  const exSnap = computeFinancialsSnapshot(withExisting);
  const exFac = exSnap.financing.facilities.get('t-existing');
  check('an EXISTING facility accrues real interest in the fixture (else vacuous)', sum(exFac?.interestAccrued) > 0);
  check("an EXISTING facility's interest is NEVER IDC, even while other assets are building",
    Math.abs(sum(exFac?.interestDuringConstruction)) < 0.01, `${M(sum(exFac?.interestDuringConstruction))} classified as IDC`);
}

// ── 2. The finance cost ledger foots ─────────────────────────────────────────
console.log('\n-- 2. The finance cost ledger: Opening + Charge - Paid = Closing --');
{
  // The capitalised figure is a DEBT DRAWDOWN. The reference has no
  // finance-cost payable ledger at all (its rows 126-130 are a debt schedule),
  // and deducting the capitalised slice from a payable as well as the payment
  // is exactly the double-removal that stuck the live ledger at -21,525k.
  const c = snap.financing.combined;
  let open = 0, worst = 0;
  for (let t = 0; t < N; t++) {
    const close = open + (c.totalInterestAccrued[t] ?? 0) - (c.totalInterestPaid[t] ?? 0);
    if (Math.abs(close) > Math.abs(worst)) worst = close;
    open = close;
  }
  check('the ledger closes at ZERO every period', Math.abs(worst) < 0.01, `worst closing ${M(worst)}`);
  check('paid == accrued (the charge is settled in full; capitalised is a drawdown, not a deduction)',
    Math.abs(sum(c.totalInterestPaid) - sum(c.totalInterestAccrued)) < 0.01,
    `paid ${M(sum(c.totalInterestPaid))} vs accrued ${M(sum(c.totalInterestAccrued))}`);
  check('the capitalised slice is non-zero (else the two above are vacuous)', sum(c.totalInterestCapitalized) > 0);
}

// ── 3. FCFF ──────────────────────────────────────────────────────────────────
console.log('\n-- 3. FCFF: capex incl. in-kind land, NO interest of any kind --');
check('FCFF names the cash capex and the in-kind land, each on its own row',
  FCFF_BUILDUP_LABELS.some((l) => l.includes('Capex, cash'))
  && FCFF_BUILDUP_LABELS.some((l) => l.includes('Land Contributed In-Kind')), FCFF_BUILDUP_LABELS.join(' | '));
{
  // THE UNLEVERED-PURITY GUARD, on the row list. FCFF may carry no interest,
  // IDC or finance-cost row. The regex deliberately does not fire on the
  // "pre-interest" caption of Cash from Operations.
  const offenders = FCFF_BUILDUP_LABELS.filter((l) =>
    /\bIDC\b|finance cost|during construction|interest (paid|charge|expense)|\(-\)[^)]*interest/i.test(l));
  check('UNLEVERED PURITY: no interest, IDC or finance-cost row appears in FCFF', offenders.length === 0, offenders.join(' | '));
}
{
  const rows = buildFcffBuildup(rs, m4StreamRow);
  const comps = rows.slice(0, -1);
  check('the FCFF rows sum to FCFF in every period',
    rs.fcffPerPeriod.every((v, t) => Math.abs(comps.reduce((a, r) => a + (r.values[t] ?? 0), 0) - v) < 0.01));
}
check('NUMERIC PURITY: FCFF reconstructs from cfo, cash capex, in-kind land and terminal, with no interest term',
  rs.fcffPerPeriod.every((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.inKindLandPerPeriod[t] ?? 0) + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) < 0.01));
check('the in-kind land really is inside FCFF (removing it breaks the identity)',
  rs.fcffPerPeriod.some((v, t) => Math.abs(
    ((b.existingPreCapexPerPeriod[t] ?? 0) + (b.cfoPerPeriod[t] ?? 0) + (b.cfiPerPeriod[t] ?? 0)
     + (b.terminalEnterprisePerPeriod[t] ?? 0)) - v) > 0.01));

// ── 4. FCFE: four steps ──────────────────────────────────────────────────────
console.log('\n-- 4. FCFE: FCFF, plus net debt, less finance cost, plus terminal (and the in-kind credit) --');
check('the FCFE chain is the reference four steps: FCFF, Net Debt, Finance Cost, Terminal',
  FCFE_BUILDUP_LABELS.some((l) => l.includes('FCFF (unlevered'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Net Debt'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Finance Cost'))
  && FCFE_BUILDUP_LABELS.some((l) => l.includes('Terminal Value less Closing Debt')), FCFE_BUILDUP_LABELS.join(' | '));
check('it chains from PRE-TERMINAL FCFF, so it carries NO removal rows',
  !FCFE_BUILDUP_LABELS.some((l) => /in FCFF above|removal|back(ed)? out/i.test(l)));
check('it is SHORT: at most six rows before the total', FCFE_BUILDUP_LABELS.length <= 7, `${FCFE_BUILDUP_LABELS.length} labels`);
check('exactly ONE finance-cost row', FCFE_BUILDUP_LABELS.filter((l) => /finance cost/i.test(l)).length === 1);
// THE IN-KIND PAIR: charged in FCFF, credited in FCFE, both present, equal and opposite.
check('in-kind land is CHARGED in FCFF (a (-) row) and CREDITED in FCFE (a (+) row)',
  FCFF_BUILDUP_LABELS.some((l) => /In-Kind/i.test(l) && l.startsWith('(-)'))
  && FCFE_BUILDUP_LABELS.some((l) => /In-Kind/i.test(l) && l.startsWith('(+)')));
check('the two in-kind rows are equal and opposite, every period',
  Array.from({ length: rs.fcffPerPeriod.length }, (_, i) =>
    Math.abs((b.inKindLandPerPeriod[i] ?? 0) + (b.inKindEquityCreditPerPeriod[i] ?? 0)) < 0.01).every(Boolean));
{
  const rows = buildFcfeBuildup(rs, m4StreamRow);
  const comps = rows.slice(0, -1);
  check('the FCFE rows sum to FCFE in every period',
    rs.fcfePerPeriod.every((v, t) => Math.abs(comps.reduce((a, r) => a + (r.values[t] ?? 0), 0) - v) < 0.01));
}
// THE IDENTITY. FCFE must equal the equity holder's actual net cash, rebuilt
// from the cash statement independently of the returns engine. The in-kind
// pair nets to zero across FCFF and FCFE, so it does not appear here.
{
  let worst = 0, at = -1;
  for (let t = 0; t < N; t++) {
    const equityCash = (d.cashFromOperationsPerPeriod[t] ?? 0)
      + (d.capexPerPeriod[t] ?? 0)                        // negative: cash capex
      - (d.idcPaidPerPeriod[t] ?? 0)                      // the FULL IDC charge, paid
      - (d.operatingInterestPaidPerPeriod[t] ?? 0)
      + (d.capexDrawdownPerPeriod[t] ?? 0) + (d.idcDrawdownPerPeriod[t] ?? 0)
      + (d.debtRepaymentPerPeriod[t] ?? 0);               // already negative
    const fromStream = (rs.fcfePerPeriod[t + 1] ?? 0) - (b.terminalEquityPerPeriod[t + 1] ?? 0);
    const diff = Math.abs(equityCash - fromStream);
    if (diff > worst) { worst = diff; at = t; }
  }
  check("FCFE equals the equity holder's actual net cash, every period", worst < 1, `worst ${worst.toFixed(2)} at t=${at}`);
}

// ── 5. The cash flow statement ───────────────────────────────────────────────
console.log('\n-- 5. The cash flow: reference line structure, and the equity memo --');
{
  const rows = buildDirectCFRows({
    snap, state, filterPhaseId: '__all__',
    labels: getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country)),
    fmt: (v: number) => String(v),
  } as Parameters<typeof buildDirectCFRows>[0]);
  const has = (frag: string): boolean => rows.some((r) => r.label.includes(frag));
  check('ONE debt drawdown line per origin (the total, capex plus IDC)',
    has('Debt Drawdown, New loans') && !has('Debt Drawdown for Capex') && !has('Debt Drawdown for IDC'));
  check('the finance cost is split into IDC and operating (two genuine charges)',
    has('Interest Paid, IDC') && has('Interest Paid, operating'));
  check('no memo row and no contra row for the IDC (it is paid, and the drawdown is cash)',
    !has('(memo) IDC') && !has('Capitalised via IDC drawdown'));
  const idcRow = rows.find((r) => r.label.includes('Interest Paid, IDC'));
  check('the IDC row carries the FULL charge', !!idcRow && Math.abs(-sum(idcRow.values) - idcTotal) < 1,
    `row ${idcRow ? M(-sum(idcRow.values)) : 'absent'} vs charge ${M(idcTotal)}`);
  // The equity draw: one line, total untouched, memo attributed beneath.
  const memoOk = Array.from({ length: N }, (_, t) => Math.abs(((d.equityForCapexPerPeriod[t] ?? 0) + (d.equityForFundFeesPerPeriod[t] ?? 0)
    + (d.equityForOperatingShortfallPerPeriod[t] ?? 0) + (d.equityForFinanceCostPerPeriod[t] ?? 0))
    - (d.equityDrawdownPerPeriod[t] ?? 0)) < 0.01).every(Boolean);
  check('the equity memo (capex / fund fees / operating shortfall / finance cost) sums to the draw EXACTLY', memoOk);
  check('the equity draw is a single line with the memo beneath it',
    rows.some((r) => r.label === 'Equity Drawdown (Cash)') && has('(memo) of which for capex'));
  check('every memo bucket is non-negative', [d.equityForCapexPerPeriod, d.equityForFundFeesPerPeriod, d.equityForOperatingShortfallPerPeriod, d.equityForFinanceCostPerPeriod]
    .every((s) => s.every((v) => v >= -0.01)));
}

// ── 6. Nothing else moved ────────────────────────────────────────────────────
console.log('\n-- 6. The statements still reconcile --');
check('the balance sheet balances every period',
  Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))) < 1,
  `worst ${Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))).toFixed(2)}`);
check('Direct CF closing cash == Indirect CF closing cash',
  snap.directCF.closingCashPerPeriod.every((v, t) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[t] ?? 0)) < 1));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail > 0 ? 1 : 0);
