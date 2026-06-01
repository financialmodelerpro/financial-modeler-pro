/* eslint-disable no-console */
/**
 * verify-m4-reconciliation-broad.ts (2026-06-01)
 *
 * Broad reconciliation guard for the Module 4 statements. For each
 * well-formed fixture it asserts THREE invariants on EVERY period:
 *
 *   1. BS BALANCE      |bs.bsDifferencePerPeriod[t]| ~ 0
 *   2. CF TIE          |directCF.closingCash[t] - indirectCF.closingCash[t]| ~ 0
 *   3. BRIDGE RESIDUAL |bsReconciliation.unexplainedPerPeriod[t]| ~ 0
 *
 * Invariants 2 (Direct vs Indirect CLOSING cash) and 3 (per-line bridge
 * residual) are NOT covered by verify-m4-bs-reconciliation.ts, which only
 * checks Net CF parity on 4 periods of an inventory-free fixture.
 *
 * Inventory regression (2026-06-01): a Sell/developer asset's Inventory
 * (WIP) is built by construction capex (whose cash sits in Investing) and
 * released to Cost of Sales. The Indirect CFO previously subtracted the
 * inventory build AND counted the capex in Investing, double-counting the
 * capex and diverging from the Direct method by the inventory build. Fixed
 * by adding Cost of Sales back in operations (non-cash, like depreciation)
 * instead of the inventory change. The "Sell + inventory" fixture below
 * pins that fix: it has real construction capex and must reconcile on all
 * three invariants.
 *
 * KNOWN OPEN (printed, not asserted) below: financing/IDC residual,
 * capex-past-handover BS gap, and opening-cash seed offset.
 *
 * Usage: npx tsx scripts/verify-m4-reconciliation-broad.ts
 */

import {
  type Asset,
  type CostLine,
  type Phase,
  type Project,
  type SubUnit,
  type Parcel,
  makeDefaultPhase,
  makeDefaultProject,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';

type State = Parameters<typeof computeFinancialsSnapshot>[0];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function isNear(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  if (d <= 1e-2) return true;
  return d / Math.max(Math.abs(a), Math.abs(b), 1) <= 1e-6;
}

// Assert all three invariants on every period of a fixture.
function assertReconciles(name: string, build: () => State): void {
  const snap = computeFinancialsSnapshot(build());
  const N = snap.axisLength;
  let okBal = true, okCf = true, okBr = true;
  let wBal = 0, wCf = 0, wBr = 0;
  for (let t = 0; t < N; t++) {
    const bal = snap.bs.bsDifferencePerPeriod[t] ?? 0;
    const cf = (snap.directCF.closingCashPerPeriod[t] ?? 0) - (snap.indirectCF.closingCashPerPeriod[t] ?? 0);
    const br = snap.bsReconciliation?.unexplainedPerPeriod?.[t] ?? 0;
    if (!isNear(bal, 0)) { okBal = false; wBal = Math.max(wBal, Math.abs(bal)); }
    if (!isNear(cf, 0)) { okCf = false; wCf = Math.max(wCf, Math.abs(cf)); }
    if (!isNear(br, 0)) { okBr = false; wBr = Math.max(wBr, Math.abs(br)); }
  }
  const check = (label: string, ok: boolean, worst: number): void => {
    if (ok) { passed++; console.log(`  PASS  ${name} :: ${label}`); }
    else { failed++; failures.push(`${name} :: ${label} (worst |delta|=${worst.toFixed(2)})`); console.log(`  FAIL  ${name} :: ${label} (worst |delta|=${worst.toFixed(2)})`); }
  };
  check('BS balances every period', okBal, wBal);
  check('Direct CF closing == Indirect CF closing every period', okCf, wCf);
  check('Reconciliation bridge residual ~0 every period', okBr, wBr);
}

// ── Fixtures ────────────────────────────────────────────────────────────

const basePhase = (): Phase => ({ ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 });
const sellSubUnit = (): SubUnit => ({ id: 'su1', assetId: 'a1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 50000, unitPrice: 5000 });
function sellAsset(recognition: 'handover' | 'over_time'): Asset {
  return {
    id: 'a1', phaseId: 'p1', name: 'Tower A', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
    revenue: { sell: {
      assetId: 'a1',
      subUnits: [{ subUnitId: 'su1', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0, 0.4, 0.4, 0.2, 0, 0, 0, 0], postSalesVelocityByPhase: [] }],
      cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: recognition === 'over_time' ? [0.5, 0.3, 0.2] : [1], positionsByPhase: recognition === 'over_time' ? [0, 1, 2] : [0] },
      recognitionProfile: recognition === 'over_time'
        ? { method: 'over_time', profileMode: 'relative_to_sale', percentagesByPhase: [0.5, 0.3, 0.2], positionsByPhase: [0, 1, 2] }
        : { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  };
}
// A land parcel funds the land so financed fixtures are WELL-FORMED. A
// financing tranche with no parcel (no land) is malformed and cannot
// reconcile; the earlier "Finding 4" 28M imbalance was exactly that artifact.
const refParcel = (): Parcel => ({ id: 'parcel_1', phaseId: 'p1', name: 'Parcel 1', area: 10000, rate: 1000, cashPct: 50, inKindPct: 50 });
const wrap = (project: Project, asset: Asset | null, subUnits: SubUnit[], costLines: CostLine[], parcels: Parcel[] = []): State => ({
  project, phases: [basePhase()], assets: asset ? [asset] : [], subUnits, parcels, costLines,
  costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [], equityContributions: [],
});

const buildEmpty = (): State => wrap(makeDefaultProject(), null, [], []);
const buildSellSimple = (): State => wrap(makeDefaultProject(), { id: 'a1', phaseId: 'p1', name: 'Tower A', type: '', strategy: 'Sell', visible: true, gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0 }, [], []);
const buildOverTime = (): State => wrap(makeDefaultProject(), sellAsset('over_time'), [sellSubUnit()], []);
const buildEscrow = (): State => wrap({ ...makeDefaultProject(), escrow: { heldPct: 20, defaultReleaseYear: 2030 } } as Project, sellAsset('handover'), [sellSubUnit()], []);
// Inventory regression fixture: real construction capex (confined to the
// construction window) so Inventory builds and releases to CoS. Pins the
// Indirect-CF inventory double-count fix.
function buildSellWithInventory(): State {
  const cl = makeDefaultCostLines('p1', 3);
  cl.forEach((l) => { if ((l.endPeriod ?? 0) > 3) l.endPeriod = 3; });
  return wrap(makeDefaultProject(), sellAsset('handover'), [sellSubUnit()], cl);
}
// Inventory + financing (confined capex): senior debt + IDC. Pins the
// Finding 1b fix (interest paid was double-counted across operating +
// financing in the Indirect CF, diverging Direct vs Indirect once cash
// interest started in operations).
function buildSellInventoryFinanced(): State {
  const cl = makeDefaultCostLines('p1', 3);
  cl.forEach((l) => { if ((l.endPeriod ?? 0) > 3) l.endPeriod = 3; });
  const s = wrap(makeDefaultProject(), sellAsset('handover'), [sellSubUnit()], cl, [refParcel()]);
  s.financingTranches = [makeDefaultFinancingTranche('t1', 'p1')];
  return s;
}
// Capex-past-handover regression (2026-06-01 BS floor fix): UNCONFINED cost
// lines (default endPeriod cp+1) + financing + land. CoS recognises the full
// cost base at handover while a capex slice is spent the following period;
// Inventory now carries that (transient negative) slice instead of flooring to
// 0, so the BS balances every period.
function buildSellInventoryFinancedUnconfined(): State {
  const cl = makeDefaultCostLines('p1', 3); // default endPeriod cp+1 spills past handover
  const s = wrap(makeDefaultProject(), sellAsset('handover'), [sellSubUnit()], cl, [refParcel()]);
  s.financingTranches = [makeDefaultFinancingTranche('t1', 'p1')];
  return s;
}
// Comprehensive: an operational Phase 1 (existing hotel with pre-capex +
// existing equity + existing debt) plus a new-development Phase 2 (Sell tower
// with an in-kind land parcel and unconfined construction capex), financed.
// Exercises existing-ops opening BS + in-kind land + capex-past-handover + IDC
// together, and must reconcile on all three invariants every period.
function buildComprehensive(): State {
  const project = makeDefaultProject();
  project.startDate = '2026-01-01';
  const p1: Phase = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 1, operationsPeriods: 7, overlapPeriods: 0, status: 'operational' } as Phase;
  const p2: Phase = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2027-01-01', constructionPeriods: 3, operationsPeriods: 4, overlapPeriods: 0 };
  const hotel: Asset = { id: 'h1', phaseId: 'p1', name: 'Hotel 01', type: '', strategy: 'Operate', visible: true, gfaSqm: 0, buaSqm: 40000, sellableBuaSqm: 0, parkingBaysRequired: 0, historicalPreCapexBuilding: 3_682_051, historicalEquityAmount: 1_282_051, usefulLifeYears: 20 } as Asset;
  const res = { ...sellAsset('handover'), phaseId: 'p2' } as Asset;
  const su = sellSubUnit();
  const parcel: Parcel = { id: 'parcel_2', phaseId: 'p2', name: 'Parcel 2', area: 10000, rate: 1000, cashPct: 50, inKindPct: 50 };
  const cl = makeDefaultCostLines('p2', 3);
  const trEx = { ...makeDefaultFinancingTranche('t1', 'p1'), origin: 'existing' as const, openingBalance: 2_400_000, originationYear: 2020 };
  const trNew = { ...makeDefaultFinancingTranche('t2', 'p2'), origin: 'new' as const };
  return { project, phases: [p1, p2], assets: [hotel, res], subUnits: [su], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [trEx, trNew], equityContributions: [] };
}

console.log('=== M4 broad reconciliation guard ===');
assertReconciles('Empty project', buildEmpty);
assertReconciles('Sell (no revenue config)', buildSellSimple);
assertReconciles('Sell + over-time recognition', buildOverTime);
assertReconciles('Sell + escrow (20% held)', buildEscrow);
assertReconciles('Sell + inventory (construction capex)', buildSellWithInventory);
assertReconciles('Sell + inventory + financing + land (confined capex)', buildSellInventoryFinanced);
assertReconciles('Sell + inventory + financing + land (capex past handover)', buildSellInventoryFinancedUnconfined);
assertReconciles('Comprehensive: existing ops + new dev + in-kind + financing', buildComprehensive);

console.log(`\nResults: ${passed} pass / ${failed} fail`);
if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(failed > 0 ? 1 : 0);
