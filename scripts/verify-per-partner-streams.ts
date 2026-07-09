/**
 * verify-per-partner-streams.ts
 *
 * M5 per-partner FCFE + DDM returns with time-weighted shareholding
 * (2026-07-09). Pins the reconciliation contract that keeps total project
 * returns byte-identical while splitting them per partner:
 *   1. Sigma partner FCFE stream = the consolidated FCFE stream, per period.
 *   2. Sigma partner DDM stream  = the consolidated Distributed-Equity stream.
 *   3. Weighted-average shareholding is TIME-weighted (earlier capital earns a
 *      larger share than equal capital contributed later).
 *   4. Manual override = the agreed share, driving BOTH bases, while the
 *      computed weighted-average stays visible alongside it.
 *   5. Agreed shares that do not sum to 100% flag the reconciliation delta.
 *
 * The consolidated streams themselves are computed independently of the split,
 * so this is a display-layer guarantee; the broader math guard is that
 * verify-returns-engine / -snapshot stay green.
 *
 * No em dashes in this file.
 */
import { computePartnerReturns } from '../src/core/calculations/returns/partners';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}`); }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// ── Fixture: equal-amount partners, different contribution TIMING ─────────────
// Partner A: 500 of in-kind land, drawn up front (axis year 0).
// Partner B: 500 of new cash, drawn late (axis year 2).
// Equal amounts => amount-weighted share would be 50/50; time-weighting must
// credit A more (its capital is deployed for the whole hold).
const consolidatedFcfe = [-1000, 150, 250, 1600]; // E+1 = 4 (exitIdx 2)
const ps = computePartnerReturns({
  partners: [
    { id: 'A', name: 'Landowner', cashContribution: 0, inKindContribution: 500, existingContribution: 0 },
    { id: 'B', name: 'Cash JV', cashContribution: 500, inKindContribution: 0, existingContribution: 0 },
  ],
  totalCash: 500, totalInKind: 500, totalExisting: 0,
  cashAxisPerPeriod: [0, 0, 500], inKindAxisPerPeriod: [500, 0, 0],
  dividendsPerPeriod: [0, 300, 700], terminalEquityValue: 1000, exitIdx: 2,
  streamYearLabels: [2024, 2025, 2026, 2027],
  consolidatedFcfePerPeriod: consolidatedFcfe,
});
const [A, B] = ps.partners;

// 3. Time-weighted shareholding: A deployed for 3 periods (1500 dollar-years),
//    B for 1 period (500) => 75 / 25, NOT the 50/50 amount split.
check('time-weighted share A = 75% (early land beats equal late cash)', near(A.weightedAvgShareholdingPct, 0.75));
check('time-weighted share B = 25%', near(B.weightedAvgShareholdingPct, 0.25));
check('weighted-average shares sum to 100%', near(ps.weightedAvgSum, 1));
check('agreed share defaults to the weighted average (no override)', near(A.shareholdingPct, 0.75) && !A.shareholdingIsManual);

// 1. Sigma partner FCFE == consolidated FCFE, per period.
check('Sigma partner FCFE == consolidated FCFE, per period',
  consolidatedFcfe.every((v, t) => near(ps.totalFcfeStream[t], v)) &&
  consolidatedFcfe.every((v, t) => near((A.fcfeStream[t] ?? 0) + (B.fcfeStream[t] ?? 0), v)));
check('each partner FCFE = agreed share x consolidated FCFE',
  consolidatedFcfe.every((v, t) => near(A.fcfeStream[t], 0.75 * v)) &&
  consolidatedFcfe.every((v, t) => near(B.fcfeStream[t], 0.25 * v)));

// 2. Sigma partner DDM == the reconstructed consolidated Distributed-Equity.
//    div stream: [0]=-existing(0); [t+1]=-(cash+inKind)+div; exit += terminal.
const ddmConsolidated = [
  0,
  -(0 + 500) + 0,      // t0: in-kind 500 out
  -(0 + 0) + 300,      // t1: dividend 300
  -(500 + 0) + 700 + 1000, // t2 exit: cash 500 out + div 700 + terminal 1000
];
check('Sigma partner DDM == consolidated Distributed-Equity, per period',
  ddmConsolidated.every((v, t) => near(ps.totalStream[t], v)) &&
  ddmConsolidated.every((v, t) => near((A.cashFlowStream[t] ?? 0) + (B.cashFlowStream[t] ?? 0), v)));

// FCFE metrics are produced per partner.
check('per-partner FCFE IRR + MOIC + equity multiple present',
  (A.fcfeIrr === null || Number.isFinite(A.fcfeIrr)) && Number.isFinite(A.fcfeMoic) && Number.isFinite(A.fcfeEquityMultiple));
check('per-partner DDM IRR present', A.irr === null || Number.isFinite(A.irr));

// 4. Manual override drives BOTH bases; computed weighted-average still shown.
const psm = computePartnerReturns({
  partners: [
    { id: 'A', name: 'Landowner', cashContribution: 0, inKindContribution: 500, existingContribution: 0, manualShareholdingPct: 60 },
    { id: 'B', name: 'Cash JV', cashContribution: 500, inKindContribution: 0, existingContribution: 0, manualShareholdingPct: 40 },
  ],
  totalCash: 500, totalInKind: 500, totalExisting: 0,
  cashAxisPerPeriod: [0, 0, 500], inKindAxisPerPeriod: [500, 0, 0],
  dividendsPerPeriod: [0, 300, 700], terminalEquityValue: 1000, exitIdx: 2,
  streamYearLabels: [2024, 2025, 2026, 2027],
  consolidatedFcfePerPeriod: consolidatedFcfe,
});
check('manual override sets agreed share (60/40), drives FCFE',
  near(psm.partners[0].shareholdingPct, 0.6) &&
  consolidatedFcfe.every((v, t) => near(psm.partners[0].fcfeStream[t], 0.6 * v)));
check('manual override drives DDM by the same agreed share',
  ddmConsolidated.every((v, t) => near(psm.partners[0].cashFlowStream[t], 0.6 * v)));
check('computed weighted-average still visible under manual override',
  near(psm.partners[0].weightedAvgShareholdingPct, 0.75) && psm.partners[0].shareholdingIsManual);
check('manual 60/40 still reconciles to 100%', psm.shareholdingReconciles && near(psm.shareholdingDelta, 0));

// 5. Agreed shares that do not sum to 100% flag a signed delta.
const psu = computePartnerReturns({
  partners: [
    { id: 'A', name: 'A', cashContribution: 0, inKindContribution: 500, existingContribution: 0, manualShareholdingPct: 60 },
    { id: 'B', name: 'B', cashContribution: 500, inKindContribution: 0, existingContribution: 0, manualShareholdingPct: 30 },
  ],
  totalCash: 500, totalInKind: 500, totalExisting: 0,
  cashAxisPerPeriod: [0, 0, 500], inKindAxisPerPeriod: [500, 0, 0],
  dividendsPerPeriod: [0, 300, 700], terminalEquityValue: 1000, exitIdx: 2,
  streamYearLabels: [2024, 2025, 2026, 2027],
  consolidatedFcfePerPeriod: consolidatedFcfe,
});
check('under-allocated agreed shares do NOT reconcile', !psu.shareholdingReconciles);
check('reconciliation delta is signed (-10%)', near(psu.shareholdingDelta, -0.1));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
