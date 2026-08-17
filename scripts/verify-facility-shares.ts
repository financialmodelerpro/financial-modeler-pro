/**
 * verify-facility-shares.ts (2026-08-17)
 *
 * TWO IDENTICAL SENIOR DEBT TABLES, AND WHY THE COMBINED IS NOT A DOUBLE COUNT.
 *
 * A facility's schedule is PROJECT-WIDE. Since Pass 28 (2026-05-14) the engine
 * deliberately stopped windowing a tranche to `tranche.phaseId`, because a bank
 * funds drawdowns in every phase and the interest on all of them is IDC. A
 * facility therefore draws the project debt requirement TIMES ITS SHARE, and
 * `normaliseFacilityShares` gives an equal split when no share is set.
 *
 * The wizard seeded one facility PER PHASE, so a two-phase project opened with
 * two facilities at 50% each: two tables reading exactly the same numbers, with
 * nothing saying they were halves, and a Combined total that reads like a
 * double count of one table.
 *
 * IT IS NOT ONE, and this file pins that distinction, because the fix for a
 * genuine double count (removing a duplicate charge) and the fix for this
 * (naming the shares) are opposite actions and confusing them would corrupt a
 * correct model. Section B is the one that matters: the sum of the facilities
 * equals the requirement exactly, and collapsing them to one facility changes
 * nothing.
 *
 * Run: npx tsx scripts/verify-facility-shares.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { normaliseFacilityShares } from '../src/core/calculations/financing/shares';
import { computeFinancingResult } from '../src/core/calculations/financing';
import { buildWizardSnapshot } from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeDefaultFinancingTranche,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  type FinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

// ── A wizard project with two phases and real capex ────────────────────────
const draft = {
  projectName: 'Shares', currency: 'SAR', modelType: 'annual' as const,
  outputGranularity: 'annual' as const, startDate: '2026-01-01', location: '',
  displayScale: 'full' as const, projectType: 'Mixed-Use' as const,
  phases: [
    { name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 8, overlapPeriods: 0 },
    { name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 3, operationsPeriods: 8, overlapPeriods: 0 },
  ],
  parcels: [{ name: 'Land 1', area: 20000, rate: 5000, cashPct: 60, inKindPct: 40 }],
  landAllocationMode: 'sqm' as const,
};
const snap = buildWizardSnapshot(draft);
// One asset per phase, with construction cost, so the debt requirement is real.
const asset = (id: string, phaseId: string, sqm: number) => ({
  id, phaseId, name: id, type: '', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  landAllocation: { parcelId: snap.parcels[0]?.id, sqm }, landAreaSqm: sqm,
} as never);
const assets = [asset('a1', 'phase_1', 12000), asset('a2', 'phase_2', 8000)];
const subUnits = [
  { id: 's1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 2_000_000 },
  { id: 's2', assetId: 'a2', name: 'Apts', category: 'Sellable', metric: 'units', metricValue: 60, unitArea: 100, unitPrice: 2_000_000 },
] as never[];
const costLines = snap.costLines.map((c) => (
  c.id.startsWith('construction-bua') ? { ...c, value: 4000 } : c
));

const ctx = (tranches: FinancingTranche[]) => ({
  project: snap.project,
  phases: snap.phases,
  parcels: snap.parcels,
  assets,
  subUnits,
  costLines,
  costOverrides: [],
  landAllocationMode: 'sqm' as const,
  financingConfig: (snap.project as unknown as { financing?: Record<string, unknown> }).financing ?? DEFAULT_PROJECT_FINANCING_CONFIG,
  tranches,
} as never);

// ════════════════════════════════════════════════════════════════════════════
section('A. The wizard seeds ONE facility, not one per phase');

{
  check('two phases, one facility', snap.financingTranches.length === 1,
    `${snap.financingTranches.length} tranches for ${snap.phases.length} phases`);
  check('it is a new facility', snap.financingTranches[0]?.origin !== 'existing');
  check('and it still carries a phase (removePhase cascades on it)',
    !!snap.financingTranches[0]?.phaseId);

  const shares = normaliseFacilityShares(snap.financingTranches);
  check('a lone facility takes the whole requirement',
    shares.get(snap.financingTranches[0].id) === 100, String(shares.get(snap.financingTranches[0].id)));
}

// ════════════════════════════════════════════════════════════════════════════
section('B. Two facilities are HALVES, and the combined is their sum');

{
  const one = snap.financingTranches;
  const two = [...one, makeDefaultFinancingTranche('tranche_2', 'phase_2')];

  const shares = normaliseFacilityShares(two);
  check('no explicit share means an equal split',
    shares.get('tranche_1') === 50 && shares.get('tranche_2') === 50,
    [...shares.entries()].map(([k, v]) => `${k}=${v}`).join(', '));

  const r2 = computeFinancingResult(ctx(two));
  const f1 = r2.facilities.get('tranche_1')!;
  const f2 = r2.facilities.get('tranche_2')!;
  const requirement = sum(r2.debtEquitySplit.debt);

  check('the fixture raises real debt (non-vacuous)', requirement > 0, String(Math.round(requirement)));
  check('the two schedules are identical, period by period',
    JSON.stringify(f1.drawSchedule) === JSON.stringify(f2.drawSchedule));
  check('each draws half the requirement',
    Math.abs(sum(f1.drawSchedule) - requirement / 2) < 1,
    `${Math.round(sum(f1.drawSchedule))} vs ${Math.round(requirement / 2)}`);
  // THE CHECK THAT SETTLES IT: the combined is the SUM, and the sum is the
  // requirement. Nothing is counted twice.
  check('the combined equals the sum of the facilities',
    Math.abs(sum(r2.combined.totalDrawdown) - (sum(f1.drawSchedule) + sum(f2.drawSchedule))) < 1,
    `${Math.round(sum(r2.combined.totalDrawdown))}`);
  check('and the combined equals the project debt requirement, not twice it',
    Math.abs(sum(r2.combined.totalDrawdown) - requirement) < 1,
    `${Math.round(sum(r2.combined.totalDrawdown))} vs ${Math.round(requirement)}`);

  // Collapsing to one facility changes nothing. This is what makes "delete all
  // but one" a safe instruction to put in the UI.
  const r1 = computeFinancingResult(ctx(one));
  for (const [label, a, b] of [
    ['capex drawdown', sum(r1.combined.totalDrawdown), sum(r2.combined.totalDrawdown)],
    ['IDC', sum(r1.combined.totalInterestCapitalized), sum(r2.combined.totalInterestCapitalized)],
    ['interest expensed', sum(r1.combined.totalInterestExpensed), sum(r2.combined.totalInterestExpensed)],
    ['principal repaid', sum(r1.combined.totalPrincipalRepaid), sum(r2.combined.totalPrincipalRepaid)],
    ['debt requirement', sum(r1.debtEquitySplit.debt), sum(r2.debtEquitySplit.debt)],
  ] as Array<[string, number, number]>) {
    check(`one facility or two: ${label} is the same`, Math.abs(a - b) < 1,
      `${Math.round(a)} vs ${Math.round(b)}`);
  }

  // An explicit share is honoured, so the split is a decision and not a
  // hard-coded half.
  const weighted = [
    { ...two[0], facilitySharePct: 70 },
    { ...two[1], facilitySharePct: 30 },
  ] as FinancingTranche[];
  const rw = computeFinancingResult(ctx(weighted));
  check('an explicit share splits the requirement',
    Math.abs(sum(rw.facilities.get('tranche_1')!.drawSchedule) - requirement * 0.7) < 1,
    `${Math.round(sum(rw.facilities.get('tranche_1')!.drawSchedule))}`);
  check('and still sums to the requirement',
    Math.abs(sum(rw.combined.totalDrawdown) - requirement) < 1);
}

// ════════════════════════════════════════════════════════════════════════════
section('C. The screen says which share each table is');

{
  const ui = read('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
  check('each facility table names its share', ui.includes('% of the project facility'));
  check('and only when there is more than one', /share !== undefined && newTranches\.length > 1/.test(ui));
  check('a note explains identical schedules', ui.includes('fin-implicit-shares-note'));
  check('the note keys on the SYMPTOM, identical schedules, not on an absent share',
    /const identicalFacilities = newTranches.length > 1/.test(ui)
    && ui.includes('JSON.stringify(r.drawSchedule) === JSON.stringify(first.drawSchedule)'));
  check('it states that the combined is a SUM, not a double count',
    ui.includes('their SUM, not a double count'));
  check('and that deleting all but one changes nothing',
    ui.includes('every combined total stays exactly the same'));
  const wizard = read('src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts');
  check('the wizard no longer maps a facility per phase',
    !/phases\.map\(\(p, i\) =>\s*makeDefaultFinancingTranche/.test(wizard));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. The two project-cost tiles');

{
  const ui = read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  check('a total incl. land tile exists', ui.includes('costs-total-incl-land'));
  check('a total excl. in-kind land tile exists', ui.includes('costs-total-excl-inkind'));
  check('the total is derived from COST_STAGES, not a hand-written sum',
    /const totalInclLand = COST_STAGES\.reduce/.test(ui));
  check('the in-kind slice comes from the engine series',
    ui.includes('perPeriodLandInKind ?? []'));
  check('excl. in-kind is the total less that slice',
    /const totalExclInKindLand = totalInclLand - stageTotals\.landInKind/.test(ui));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-facility-shares: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
