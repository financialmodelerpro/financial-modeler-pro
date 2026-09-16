/**
 * verify-cost-escalation.ts (2026-09-16, step 10b)
 *
 * CONSTRUCTION COST ESCALATION: one project rate, every rate base-year money.
 *
 *  A  the pure rules: what escalates, the factor for a year, and the weighting
 *     by a line's own spend profile
 *  B  the engine: a zero rate is byte-identical; a rate raises cost; a later
 *     phase escalates further at the same rate; the periods still sum to the total
 *  C  the exemptions: a lump sum, the land value lines, a line charged on land
 *  D  a percentage line charges on the escalated base and is escalated once
 *  E  the surfaces: the Module 6 lever and the base year on Types and Standards
 *
 * Offline: the pure functions and the capex engine on a two-phase fixture.
 * Run: npx tsx scripts/verify-cost-escalation.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { lineEscalates, escalationFactorAt, weightedEscalation } from '../src/core/calculations/costEscalation';
import { computeAssetCost } from '../src/core/calculations';
import { makeDefaultProject, makeDefaultPhase, makeBlankCostLines, DEFAULT_PHASE_ID } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { enumerateOverridableFields } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { inactiveLeverReason, curatedDefaultFields, describeAssumption } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((t, x) => t + (x ?? 0), 0);

console.log('A. The pure rules');
check('A1 a rate line escalates; a lump sum never does', lineEscalates({ method: 'rate_x_main_asset_gfa', isLandValue: false }) && !lineEscalates({ method: 'fixed', isLandValue: false }));
check('A2 the land value lines and anything charged on land are exempt',
  !lineEscalates({ method: 'rate_per_land', isLandValue: true }) && !lineEscalates({ method: 'percent_of_cash_land', isLandValue: false }) && !lineEscalates({ method: 'percent_of_total_land', isLandValue: false }));
check('A3 a line charged on revenue is exempt (revenue carries its own indexation)', !lineEscalates({ method: 'percent_of_revenue_sale', isLandValue: false }));
check('A4 a percentage line inherits its base and is not escalated itself',
  !lineEscalates({ method: 'percent_of_selected', isLandValue: false }) && !lineEscalates({ method: 'percent_of_construction', isLandValue: false }));
check('A5 the base year is period zero, and a later year compounds', escalationFactorAt(0, 4) === 1 && near(escalationFactorAt(3, 4), Math.pow(1.04, 3)));
check('A6 a zero or absent rate is a factor of one', escalationFactorAt(5, 0) === 1 && escalationFactorAt(5, undefined) === 1);
const w = weightedEscalation([0.5, 0.5], (i) => i + 1, 4);
check('A7 the weighting is the line\'s own spend profile', near(w, (Math.pow(1.04, 1) + Math.pow(1.04, 2)) / 2), String(w));
check('A8 spending later escalates more than spending sooner at the same rate',
  weightedEscalation([0, 0, 1], (i) => i, 4) > weightedEscalation([1, 0, 0], (i) => i, 4));

// ── the fixture: two phases, the second starting three years later ──────────
function buildState(escalationPct?: number): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.costEscalationPct = escalationPct;
  const p1: any = { ...makeDefaultPhase(), id: DEFAULT_PHASE_ID, name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 5 };
  const p2: any = { ...makeDefaultPhase(), id: 'p2', name: 'P2', startDate: '2029-01-01', constructionPeriods: 2, operationsPeriods: 5 };
  const mk = (phaseId: string): any[] => makeBlankCostLines(phaseId).map((l: any) => ({ ...l }));
  const lines = [...mk(DEFAULT_PHASE_ID), ...mk('p2')];
  for (const l of lines) {
    if (l.id.startsWith('construction-bua')) { l.value = 5000; l.method = 'rate_x_main_asset_gfa'; }
    if (l.id.startsWith('contingency')) { l.value = 10; }
    // The blank catalog seeds a 1 to 24 window and the settle that re-derives it from
    // the phase runs in the STORE, so a raw fixture would spend a two-year phase over
    // 24 periods and escalate accordingly. Give every spending line the phase's own
    // window, which is what a loaded project carries.
    if (l.startPeriod > 0) { l.startPeriod = 1; l.endPeriod = 2; }
  }
  const asset = (id: string, phaseId: string): any => ({
    id, phaseId, name: id, type: 'Apartments', strategy: 'Sell', visible: true,
    buaSqm: 10000, gfaSqm: 10000, sellableBuaSqm: 10000, parkingBaysRequired: 0, usefulLifeYears: 20,
    derivedAreas: { mainAssetGfaSqm: 10000, totalGfaSqm: 10000 },
  });
  const a1 = asset('a1', DEFAULT_PHASE_ID); const a2 = asset('a2', 'p2');
  return { project, phases: [p1, p2], assets: [a1, a2], subUnits: [], parcels: [], costLines: lines, costOverrides: [], landAllocationMode: 'sqm' };
}
const costOf = (st: any, assetId: string): any => {
  const a = st.assets.find((x: any) => x.id === assetId);
  return computeAssetCost({
    asset: a, project: st.project, phase: st.phases.find((p: any) => p.id === a.phaseId),
    parcels: st.parcels, assets: st.assets, subUnits: st.subUnits, costLines: st.costLines,
    costOverrides: st.costOverrides, landAllocationMode: st.landAllocationMode,
  } as any);
};

console.log('\nB. The engine');
const flat = buildState(undefined);
const flatZero = buildState(0);
const esc = buildState(4);
const b1a = costOf(flat, 'a1'); const b1b = costOf(flatZero, 'a1'); const e1 = costOf(esc, 'a1'); const e2 = costOf(esc, 'a2');
const f2 = costOf(flat, 'a2');
check('B1 no rate and a zero rate are byte-identical', JSON.stringify(b1a.byLineId) === JSON.stringify(b1b.byLineId) && b1a.total === b1b.total);
check('B2 a rate raises the cost of a rated line', e1.total > b1a.total, `${e1.total} vs ${b1a.total}`);
check('B3 a later phase escalates further at the same rate',
  (e2.total / f2.total) > (e1.total / b1a.total), `${(e2.total / f2.total).toFixed(4)} vs ${(e1.total / b1a.total).toFixed(4)}`);
check('B4 every line still sums to its own total, and the asset total to its periods',
  near(sum(e2.perPeriod), e2.total, 1e-9) && Object.entries(e2.perLinePerPeriod as Record<string, number[]>).every(([id, series]) => near(sum(series), (e2.byLineId as any)[id] ?? 0, 1e-9)),
  `${sum(e2.perPeriod)} vs ${e2.total}`);
// A two-period phase spends half in its first year and half in its second. Phase 1
// starts in the base year (project index 0), so those are factors 1 and 1.04; phase 2
// starts in 2029, which is project index 3, so they are 1.04^3 and 1.04^4. The figures
// are stated rather than recomputed, so this cannot agree with the engine by sharing
// its arithmetic.
const buaId1 = Object.keys(b1a.byLineId).find((id) => id.startsWith('construction-bua'))!;
const buaId2 = Object.keys(f2.byLineId).find((id) => id.startsWith('construction-bua'))!;
check('B5 phase 1 is the rate carried to the years it spends: the average of 1.00 and 1.04',
  near((e1.byLineId as any)[buaId1] / (b1a.byLineId as any)[buaId1], (1 + 1.04) / 2, 1e-9),
  `${(e1.byLineId as any)[buaId1] / (b1a.byLineId as any)[buaId1]}`);
check('B6 phase 2 spends in project years 3 and 4, so it is the average of 1.04^3 and 1.04^4',
  near((e2.byLineId as any)[buaId2] / (f2.byLineId as any)[buaId2], (Math.pow(1.04, 3) + Math.pow(1.04, 4)) / 2, 1e-9),
  `${(e2.byLineId as any)[buaId2] / (f2.byLineId as any)[buaId2]}`);

console.log('\nC. The exemptions');
const landIds = Object.keys(b1a.byLineId).filter((id) => /land-cash|land-inkind|rett/.test(id));
check('C1 the land value lines and the transfer tax on them do not escalate',
  landIds.every((id) => near((e1.byLineId as any)[id] ?? 0, (b1a.byLineId as any)[id] ?? 0)), landIds.join(','));
const lump = buildState(4);
const lumpFlat = buildState(undefined);
for (const st of [lump, lumpFlat]) {
  const l = st.costLines.find((x: any) => x.phaseId === DEFAULT_PHASE_ID && x.id.startsWith('construction-bua'));
  l.method = 'fixed'; l.value = 1_000_000;
}
check('C2 a lump sum is a stated amount and never escalates',
  near((costOf(lump, 'a1').byLineId as any)[buaId1], (costOf(lumpFlat, 'a1').byLineId as any)[buaId1]));

console.log('\nD. A percentage line');
const pctId = Object.keys(b1a.byLineId).find((id) => id.startsWith('contingency'))!;
const ratio = (e1.byLineId as any)[pctId] / (b1a.byLineId as any)[pctId];
const baseRatio = (e1.selectedBaseByLineId as any)[pctId] / (b1a.selectedBaseByLineId as any)[pctId];
check('D1 a soft percentage charges on the escalated base', ratio > 1 && near(ratio, baseRatio, 1e-9), `${ratio} vs base ${baseRatio}`);
check('D2 and is escalated exactly once (the percentage itself is untouched)',
  near((e1.byLineId as any)[pctId] / (e1.selectedBaseByLineId as any)[pctId], (b1a.byLineId as any)[pctId] / (b1a.selectedBaseByLineId as any)[pctId]));

console.log('\nE. The surfaces');
const model: any = { project: buildState(4).project, phases: [], parcels: [], assets: [], subUnits: [], costLines: [], costOverrides: [], financingTranches: [], equityContributions: [] };
const fields = enumerateOverridableFields(model);
const lever = fields.find((f) => f.path === 'project.costEscalationPct');
check('E1 Module 6 offers the escalation rate as a lever', !!lever && inactiveLeverReason('project.costEscalationPct', model) === null);
check('E2 it is named and curated', !!lever && describeAssumption(lever).label === 'Construction cost escalation'
  && curatedDefaultFields(model).some((f) => f.path === 'project.costEscalationPct'));
const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
check('E3 Types and Standards takes the rate and shows the base year beside the rate column',
  tab.includes('std-cost-escalation') && tab.includes('costEscalationPct') && /Rate \(\{baseYear\} money\)/.test(tab) && /in \{baseYear\} money/.test(tab));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
