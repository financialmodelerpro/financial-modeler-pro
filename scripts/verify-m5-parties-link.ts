/**
 * verify-m5-parties-link.ts
 *
 * M5 <-> M1 Parties link (2026-07-09). Asserts the two things the feature must
 * guarantee, without touching the returns math:
 *   1. Equity-role filtering (which parties can be picked as equity partners).
 *   2. Partner identity (name / partyId) is math-inert: the returns engine
 *      derives shares from contributions only, so re-labelling a partner (or
 *      linking it to a party) never changes any number.
 *
 * The broader math guard is that verify-returns-engine / -snapshot stay green;
 * this file pins the identity contract specifically.
 *
 * No em dashes in this file.
 */
import { EQUITY_PARTY_ROLES, isEquityParty } from '../src/hubs/modeling/platforms/refm/lib/parties';
import { computePartnerReturns, type PartnerInput } from '../src/core/calculations/returns/partners';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}`); }
}

// ── 1. Equity-role filter ───────────────────────────────────────────────────
check('EQUITY_PARTY_ROLES = Sponsor / Developer / Investor-Equity Partner',
  EQUITY_PARTY_ROLES.length === 3 &&
  EQUITY_PARTY_ROLES.includes('Sponsor') &&
  EQUITY_PARTY_ROLES.includes('Developer') &&
  EQUITY_PARTY_ROLES.includes('Investor/Equity Partner'));

check('isEquityParty: Sponsor is equity', isEquityParty(['Sponsor']));
check('isEquityParty: Investor/Equity Partner is equity', isEquityParty(['Investor/Equity Partner']));
check('isEquityParty: Developer is equity', isEquityParty(['Developer']));
check('isEquityParty: multi-role picks up equity when present', isEquityParty(['Lender', 'Sponsor']));
check('isEquityParty: Lender only is NOT equity', !isEquityParty(['Lender']));
check('isEquityParty: Advisor / Contact only is NOT equity', !isEquityParty(['Advisor', 'Contact']));
check('isEquityParty: empty roles is NOT equity', !isEquityParty([]));
check('isEquityParty: non-array is NOT equity', !isEquityParty(undefined) && !isEquityParty(null));

// ── 2. Identity is math-inert ───────────────────────────────────────────────
// Same contributions, different names => identical engine output. (partyId is
// not even a field on PartnerInput, so it cannot reach the engine; the resolver
// strips it. This pins the name-invariance half of that contract.)
const common = {
  totalCash: 1000, totalInKind: 500, totalExisting: 300,
  cashAxisPerPeriod: [400, 600], inKindAxisPerPeriod: [500, 0],
  dividendsPerPeriod: [0, 900], terminalEquityValue: 400,
  exitIdx: 1, streamYearLabels: [2024, 2025, 2026],
};
const base: PartnerInput[] = [
  { id: 'a', name: 'Partner 1', cashContribution: 600, inKindContribution: 500, existingContribution: 300 },
  { id: 'b', name: 'Partner 2', cashContribution: 400, inKindContribution: 0, existingContribution: 0 },
];
const relabelled: PartnerInput[] = [
  { id: 'a', name: 'PaceMakers Holdings LLP', cashContribution: 600, inKindContribution: 500, existingContribution: 300 },
  { id: 'b', name: 'JV Investor Co', cashContribution: 400, inKindContribution: 0, existingContribution: 0 },
];

const s1 = computePartnerReturns({ ...common, partners: base });
const s2 = computePartnerReturns({ ...common, partners: relabelled });

const numsEqual = (x: number | null, y: number | null): boolean =>
  (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 1e-9);

check('relabelling keeps each partner IRR identical',
  s1.partners.every((p, i) => numsEqual(p.irr, s2.partners[i].irr)));
check('relabelling keeps each partner shareholding identical',
  s1.partners.every((p, i) => Math.abs(p.shareholdingPct - s2.partners[i].shareholdingPct) < 1e-12));
check('relabelling keeps each partner MOIC identical',
  s1.partners.every((p, i) => Math.abs(p.moic - s2.partners[i].moic) < 1e-9));
check('relabelling keeps each cash-flow stream identical',
  s1.partners.every((p, i) => p.cashFlowStream.every((v, t) => Math.abs(v - s2.partners[i].cashFlowStream[t]) < 1e-9)));
check('relabelling keeps the reconciliation totals identical',
  Math.abs(s1.totalContributions - s2.totalContributions) < 1e-9 &&
  s1.contributionsReconcile === s2.contributionsReconcile);
check('names actually flow through to results (identity preserved)',
  s2.partners[0].name === 'PaceMakers Holdings LLP' && s2.partners[1].name === 'JV Investor Co');

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
