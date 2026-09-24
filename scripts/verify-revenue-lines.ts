/**
 * verify-revenue-lines.ts (2026-09-13)
 *
 * THE MODULE 2 RESTRUCTURE: revenue is read per LINE (one type in one phase
 * across its plots, Table 5's grouping), filed by the ONE rule in
 * lib/revenueLines.ts, and the resolver reads the store's rows through the
 * asset's metric. Each section below is a defect that was measured on the
 * live project on 2026-09-13 before the fix, so a regression here is a
 * regression of something that was real.
 *
 *   A. The filing rule: category, never strategy; the two named exceptions.
 *   B. The line planner: plots pooled, companions on their own, reading order.
 *   C. The Sell row list is the STORE's, looked up by id, with the line default.
 *   D. The resolver reads the ASSET's metric (TRAPS 7.32), three sites.
 *   E. Hospitality keys from an area row through the type's unit size.
 *   F. Lease GLA by the one area rule; Support is never priced.
 *   G. The hospitality loop admits by STRATEGY, not the companion flag.
 *   H. A line's result is the sum of its plots; the project total is the same sum.
 *   I. Revenue blocks are seeded in the persistence layer and the seed settles.
 *   J. A line's cost of sales is the sum of its plots'.
 *   K. The surfaces read the rule (static), and the live projects agree (live).
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-revenue-lines.ts
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset, Phase, Project, SubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAllSellResults, resolveRowVelocity, resolveHospitalityConfig, resolveLeaseConfig,
  sumSellResults, sumHospitalityResults, lineRevenueResults,
} from '../src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import {
  revenueSection, planRevenueLines, groupRevenueLines, REVENUE_SECTIONS, lineForAsset,
} from '../src/hubs/modeling/platforms/refm/lib/revenueLines';
import { seedRevenueBlocks } from '../src/hubs/modeling/platforms/refm/lib/state/revenueSeeds';
import { sumAssetCostOfSales, type AssetCostOfSales } from '../src/hubs/modeling/platforms/refm/lib/costOfSales';
import { keysFromArea, isRevenueSubUnit, resolveSubUnitAdr } from '../src/core/calculations';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildExcelSampleState } from './excelSampleState';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { settleSubUnitPrices, activePriceKey, rowsWithoutPriceIn, hasDualPrice } from '../src/hubs/modeling/platforms/refm/lib/state/subUnitPrices';

let passed = 0;
const failures: string[] = [];
function check(id: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  [PASS] ${id}`); }
  else { failures.push(id); console.log(`  [FAIL] ${id}${detail ? `: ${detail}` : ''}`); }
}
function section(title: string): void { console.log(`\n--- ${title} ---`); }
const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + v, 0);
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
/** Every MONEY flow on the three project totals, as one string. The per-row
 *  maps are left out on purpose (a seeded row adds a zero entry to them, a
 *  key, not money) and so are the capacity rows (room nights, effective keys):
 *  a seeded hotel block lets the engine COUNT the hotel's keys, which is the
 *  point, while earning nothing until an occupancy is typed. */
const flowsOf = (snap: ReturnType<typeof computeAllSellResults>): string => {
  const money = /Revenue|Cash|Recognition|SalesValue|OccupiedArea/;
  const pick = (o: Record<string, unknown>): Record<string, number[]> => Object.fromEntries(
    Object.entries(o).filter(([k, v]) => k.endsWith('PerPeriod') && Array.isArray(v) && !k.includes('PerSubUnit') && money.test(k)) as Array<[string, number[]]>,
  );
  return JSON.stringify([
    pick(snap.projectTotals as unknown as Record<string, unknown>),
    snap.projectTotals.cashVintageMatrix, snap.projectTotals.recognitionVintageMatrix,
    pick(snap.hospitalityProjectTotals as unknown as Record<string, unknown>),
    pick(snap.leaseProjectTotals as unknown as Record<string, unknown>),
  ]);
};

// ── Fixture ─────────────────────────────────────────────────────────────────
const project = {
  name: 'Lines fixture', startDate: '2026-01-01', modelType: 'annual',
  assetTypes: [
    { id: 'branded-villas', label: 'Branded Villas', category: 'Residential', order: 1 },
    { id: '4-star-hotel', label: '4 Star Hotel', category: 'Hospitality', order: 2 },
    { id: 'standalone-commercial', label: 'Standalone Commercial', category: 'Retail', order: 3 },
  ],
  assetTypeValues: { '4-star-hotel': { avgUnitSizeSqm: 50 } },
} as unknown as Project;
const phase1 = { id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 6, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
const phase2 = { id: 'p2', name: 'Phase 2', startDate: '2027-01-01', constructionPeriods: 3, operationsPeriods: 6, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
const phases = [phase1, phase2];

const mkAsset = (o: Record<string, unknown>): Asset => ({
  visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, name: '', ...o,
} as unknown as Asset);
const mkSu = (o: Record<string, unknown>): SubUnit => ({
  name: 'row', category: 'Sellable', metric: 'area', unitPrice: 0, ...o,
} as unknown as SubUnit);

const sellBlock = (assetId: string, rows: Array<{ id: string; pre: number[] }>, velocityDefault?: { pre: number[]; post: number[] }) => ({
  assetId,
  subUnits: rows.map((r) => ({ subUnitId: r.id, preSalesVelocityByPhase: r.pre, postSalesVelocityByPhase: [], preSalesVelocity: [], postSalesVelocity: [] })),
  cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup' as const },
  recognitionProfile: { method: 'point_in_time' as const, pointInTimeYear: 'handover' as const },
  indexation: { method: 'none' as const },
  ...(velocityDefault ? { velocityDefault: { preSalesVelocityByPhase: velocityDefault.pre, postSalesVelocityByPhase: velocityDefault.post } } : {}),
});

const villasA = mkAsset({ id: 'vA', phaseId: 'p1', type: 'Branded Villas', assetTypeId: 'branded-villas', strategy: 'Sell', subUnitMetric: 'area',
  revenue: { sell: sellBlock('vA', [{ id: 'suA1', pre: [0.5, 0.5, 0, 0] }]) } });
const villasB = mkAsset({ id: 'vB', phaseId: 'p1', type: 'Branded Villas', assetTypeId: 'branded-villas', strategy: 'Sell', subUnitMetric: 'area',
  revenue: { sell: sellBlock('vB', [{ id: 'suB1', pre: [0.5, 0.5, 0, 0] }]) } });
const hotel = mkAsset({ id: 'h1', phaseId: 'p2', type: '4 Star Hotel', assetTypeId: '4-star-hotel', strategy: 'Operate', subUnitMetric: 'area',
  revenue: { operate: { assetId: 'h1', startingADR: 0, adrIndexation: { method: 'none' }, occupancyPerPeriod: [], occupancyPerPeriodByPhase: [0, 0, 0, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6], fb: { mode: 'percent_of_rooms', percentOfRooms: 0 }, otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 } } } });
// No asset-level metric: the ROW's stands (a units row on a Lease asset).
const commercial = mkAsset({ id: 'c1', phaseId: 'p1', type: 'Standalone Commercial', assetTypeId: 'standalone-commercial', strategy: 'Lease',
  revenue: { lease: { assetId: 'c1', baseRate: 0, rentIndexation: { method: 'none' }, occupancyPerPeriod: [], occupancyPerPeriodByPhase: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1], arDays: 30 } } });
const strip = mkAsset({ id: 'retail_p1', phaseId: 'p1', type: 'Branded Villas', strategy: 'Lease', isCompanion: true, companionType: 'retail', retailHostAssetIds: ['vA', 'vB'],
  revenue: { lease: { assetId: 'retail_p1', baseRate: 0, rentIndexation: { method: 'none' }, occupancyPerPeriod: [], arDays: 30 } } });
const manageParent = mkAsset({ id: 'm1', phaseId: 'p2', type: 'Branded Villas', assetTypeId: 'branded-villas', strategy: 'Sell + Manage', subUnitMetric: 'units',
  revenue: { sell: sellBlock('m1', [{ id: 'suM1', pre: [1, 0, 0] }]) } });
const companion = mkAsset({ id: 'companion_m1', phaseId: 'p2', type: 'Branded Villas', strategy: 'Operate', isCompanion: true, companionType: 'operate', parentAssetId: 'm1',
  revenue: { operate: { assetId: 'companion_m1', startingADR: 0, adrIndexation: { method: 'none' }, occupancyPerPeriod: [], fb: { mode: 'percent_of_rooms', percentOfRooms: 0 }, otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 } } } });
const hidden = mkAsset({ id: 'hid', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell', visible: false });

const subUnits: SubUnit[] = [
  mkSu({ id: 'suA1', assetId: 'vA', metricValue: 1000, unitPrice: 10000 }),
  mkSu({ id: 'suA2', assetId: 'vA', metricValue: 500, unitPrice: 20000 }),           // NOT in vA's sell list
  mkSu({ id: 'suB1', assetId: 'vB', metricValue: 2000, unitPrice: 10000 }),
  mkSu({ id: 'suAS', assetId: 'vA', category: 'Support', metricValue: 300, unitPrice: 0 }),
  mkSu({ id: 'suH1', assetId: 'h1', category: 'Operable', metric: 'area', metricValue: 5000, unitPrice: 800 }), // area row on a hotel
  mkSu({ id: 'suC1', assetId: 'c1', category: 'Leasable', metric: 'units', metricValue: 10, unitArea: 100, unitPrice: 1400 }), // units row on a lease
  mkSu({ id: 'suCS', assetId: 'c1', category: 'Support', metric: 'area', metricValue: 400, unitPrice: 0 }),
  mkSu({ id: 'retail_p1__sub', assetId: 'retail_p1', category: 'Leasable', metricValue: 800, unitPrice: 1400 }),
  mkSu({ id: 'suM1', assetId: 'm1', metric: 'units', metricValue: 20, unitArea: 100, unitPrice: 1_000_000 }),
];
const assets = [villasA, villasB, hotel, commercial, strip, manageParent, companion, hidden];
const state = { project, phases, assets, subUnits };

// ── A. The filing rule ──────────────────────────────────────────────────────
section('A. The filing rule: category, never strategy');
check('A1 a retail strip files under Retail Ground Floor', revenueSection(strip, project) === 'Retail Ground Floor');
check('A2 the Operate companion files under Hospitality (founder, 2026-09-13)', revenueSection(companion, project) === 'Hospitality');
check('A3 Standalone Commercial (category Retail, not a strip) files under Standalone Commercial', revenueSection(commercial, project) === 'Standalone Commercial');
check('A4 a hotel files under Hospitality', revenueSection(hotel, project) === 'Hospitality');
check('A5 Branded Villas files under Residential', revenueSection(villasA, project) === 'Residential');
check('A6 a hotel SOLD off plan still files under Hospitality: the strategy does not move the section',
  revenueSection({ ...hotel, strategy: 'Sell' } as Asset, project) === 'Hospitality');
check('A7 the reading order is the founder\'s',
  JSON.stringify(REVENUE_SECTIONS) === JSON.stringify(['Residential', 'Hospitality', 'Standalone Commercial', 'Retail Ground Floor', 'Other']));
check('A8 an untyped asset files under Other', revenueSection(mkAsset({ type: '' }), project) === 'Other');

// ── B. The line planner ─────────────────────────────────────────────────────
section('B. The line planner');
const lines = planRevenueLines(assets, subUnits, phases, project);
const villasLine = lines.find((l) => l.key === 'p1|branded-villas');
check('B1 two plots of one type in one phase are ONE line with two members', villasLine?.members.length === 2);
check('B2 the line pools its plots\' rows, Support excluded (3 of 4)',
  villasLine?.subUnits.length === 3 && villasLine.subUnits.every((u) => u.category !== 'Support'));
check('B3 the strip is its own line, flagged', lines.some((l) => l.key === 'companion__retail_p1' && l.isStrip && l.section === 'Retail Ground Floor'));
const compLine = lines.find((l) => l.key === 'companion__companion_m1');
check('B4 the Operate companion is its own line under Hospitality, pointing at its parent line',
  compLine?.isOperateCompanion === true && compLine.section === 'Hospitality' && compLine.parentLineKey === 'p2|branded-villas');
check('B5 a hidden asset is on no line', !lines.some((l) => l.members.some((m) => m.id === 'hid')));
check('B6 every visible asset is on exactly one line',
  assets.filter((a) => a.visible !== false).every((a) => lines.filter((l) => l.members.some((m) => m.id === a.id)).length === 1));
const order = lines.map((l) => l.section);
const sectionRank = (s: string): number => REVENUE_SECTIONS.indexOf(s as never);
check('B7 lines come back in section order, then phase order',
  order.every((s, i) => i === 0 || sectionRank(s) >= sectionRank(order[i - 1]))
  && lines.filter((l) => l.section === 'Residential').map((l) => l.phaseId).join(',') === 'p1,p2');
check('B8 groupRevenueLines drops empty sections and keeps the order',
  groupRevenueLines(lines).map((g) => g.section).join('|') === 'Residential|Hospitality|Standalone Commercial|Retail Ground Floor');
check('B9 lineForAsset finds the line a plot is on', lineForAsset(lines, 'vB')?.key === 'p1|branded-villas');
check('B10 the form follows the strategy: Sell + Manage parent is a sell form, its companion an operate form',
  lines.find((l) => l.key === 'p2|branded-villas')?.form === 'sell' && compLine?.form === 'operate');

// ── C. The Sell row list is the store's ────────────────────────────────────
section('C. The Sell row list is the store\'s, looked up by id, with the line default');
{
  const snap = computeAllSellResults(state as never);
  const rA = snap.bySellAsset.get('vA')!;
  check('C1 a row NOT in the stored list is still in the result (keyed by id)', 'suA2' in rA.presalesRevenuePerPeriodPerSubUnit);
  check('C2 with no entry and no line default it sells nothing', sum(rA.presalesRevenuePerPeriodPerSubUnit.suA2) === 0);
  check('C3 the listed row sells: 1000 sqm at 10,000', near(sum(rA.presalesRevenuePerPeriodPerSubUnit.suA1), 10_000_000));
  const withDefault = { ...villasA, revenue: { sell: sellBlock('vA', [{ id: 'suA1', pre: [0.5, 0.5, 0, 0] }], { pre: [1, 0, 0, 0], post: [] }) } } as Asset;
  const snap2 = computeAllSellResults({ ...state, assets: [withDefault, villasB] } as never);
  const rA2 = snap2.bySellAsset.get('vA')!;
  check('C4 with a line default the unlisted row sells at the DEFAULT: 500 sqm at 20,000 in year 1',
    near(rA2.presalesRevenuePerPeriodPerSubUnit.suA2[0], 10_000_000) && near(sum(rA2.presalesRevenuePerPeriodPerSubUnit.suA2), 10_000_000));
  check('C5 a row with its OWN entry keeps it over the default (50/50, not 100/0)',
    near(rA2.presalesRevenuePerPeriodPerSubUnit.suA1[0], 5_000_000) && near(rA2.presalesRevenuePerPeriodPerSubUnit.suA1[1], 5_000_000));
  check('C6 the Support row is never sold', !('suAS' in rA.presalesRevenuePerPeriodPerSubUnit));
  const sell = withDefault.revenue!.sell;
  check('C7 resolveRowVelocity names the source: own / default / none',
    resolveRowVelocity(sell, 'suA1').source === 'own' && resolveRowVelocity(sell, 'suA2').source === 'default'
    && resolveRowVelocity(villasA.revenue!.sell, 'suA2').source === 'none');
}

// ── D. The asset's metric ───────────────────────────────────────────────────
section('D. The resolver reads the ASSET\'s metric (TRAPS 7.32)');
{
  // The live row: stored 'units' with a 190 sqm unit size, under an asset that
  // counts AREA; metricValue is the sqm. Worth 166.6m, was priced at 0.88m.
  const a = mkAsset({ id: 'x', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell', subUnitMetric: 'area',
    revenue: { sell: sellBlock('x', [{ id: 'sx', pre: [1, 0, 0, 0] }]) } });
  const su = mkSu({ id: 'sx', assetId: 'x', metric: 'units', metricValue: 10098.226756378977, unitArea: 190, unitPrice: 16500 });
  const r = computeAllSellResults({ project, phases, assets: [a], subUnits: [su] } as never).bySellAsset.get('x')!;
  const value = sum(r.presalesRevenuePerPeriod);
  check('D1 a units-stored row under an area asset is priced per sqm: 10,098 x 16,500, not 10,098 x 86.84',
    value > 166_000_000 && value < 166_700_000, `got ${value.toFixed(2)}`);
  check('D2 and its units column reads zero (the asset counts area)', sum(r.presalesUnitsPerPeriod) === 0);
}

// ── E. Hospitality keys from an area row ────────────────────────────────────
section('E. Hospitality keys from an area row through the type\'s unit size');
{
  const cfg = resolveHospitalityConfig(hotel, phase2, subUnits, 2026, 10, { avgUnitSizeSqm: 50 } as never)!;
  check('E1 an area row on a hotel holds area over unit size keys: 5,000 / 50 = 100', cfg.keys === 100 && cfg.subUnits[0]?.keys === 100);
  const none = resolveHospitalityConfig(hotel, phase2, subUnits, 2026, 10, undefined)!;
  check('E2 with no unit size anywhere it holds no keys, and does not invent a hotel', none.keys === 0);
  const withRowSize = resolveHospitalityConfig(hotel, phase2, [{ ...subUnits[4], unitArea: 25 } as SubUnit], 2026, 10, { avgUnitSizeSqm: 50 } as never)!;
  check('E3 a unit size stated on the row wins over the type: 5,000 / 25 = 200', withRowSize.keys === 200);
  check('E4 the rule is the one Table 5 seeds with (keysFromArea), whole keys, never below one',
    keysFromArea(5000, 50) === 100 && keysFromArea(10, 50) === 1 && keysFromArea(0, 50) === 0 && keysFromArea(100, undefined) === 0);
  const snap = computeAllSellResults(state as never);
  const rh = snap.byHospitalityAsset.get('h1')!;
  check('E5 and the hotel earns on them: 100 keys x 800 x 60% x 365 x 6 years', near(sum(rh.totalRevenuePerPeriod), 100 * 800 * 0.6 * 365 * 6, 1e-3));
  const counted = resolveHospitalityConfig({ ...hotel, subUnitMetric: 'units' } as Asset, phase2, [mkSu({ id: 'k', assetId: 'h1', category: 'Operable', metric: 'units', metricValue: 143.6, unitPrice: 800 })], 2026, 10)!;
  check('E6 a count row is its count, rounded', counted.keys === 144);
}

// ── F. Lease GLA ────────────────────────────────────────────────────────────
section('F. Lease GLA by the one area rule; Support never priced');
{
  const cfg = resolveLeaseConfig(commercial, phase1, subUnits, 2026, 10)!;
  check('F1 a units row under a Lease asset leases count x unit size: 10 x 100 = 1,000 sqm (was dropped)', cfg.gla === 1000 && cfg.subUnits.length === 1);
  check('F2 the Support row is not leasable area', !cfg.subUnits.some((s) => s.id === 'suCS'));
  check('F3 isRevenueSubUnit is the one filter', isRevenueSubUnit({ category: 'Support' }) === false && isRevenueSubUnit({ category: 'Leasable' }) === true);
  const snap = computeAllSellResults(state as never);
  const rl = snap.byLeaseAsset.get('c1')!;
  check('F4 and it earns: 1,000 sqm x 1,400 x 6 years', near(sum(rl.totalRevenuePerPeriod), 1000 * 1400 * 6, 1e-3));
}

// ── G. The hospitality loop admits by strategy ──────────────────────────────
section('G. The hospitality loop admits by STRATEGY, not the companion flag');
{
  const sabotaged = { ...strip, revenue: { ...strip.revenue, operate: { assetId: 'retail_p1', startingADR: 900, adrIndexation: { method: 'none' }, occupancyPerPeriod: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], fb: { mode: 'percent_of_rooms', percentOfRooms: 0 }, otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 } } } } as Asset;
  const snap = computeAllSellResults({ ...state, assets: [villasA, sabotaged, companion] } as never);
  check('G1 a retail strip (Lease) with an operate block still never enters the hospitality loop', !snap.byHospitalityAsset.has('retail_p1'));
  check('G2 the Operate companion (strategy Operate) does', snap.byHospitalityAsset.has('companion_m1'));
  check('G3 the strip is in the lease loop', snap.byLeaseAsset.has('retail_p1'));
}

// ── H. Sums ─────────────────────────────────────────────────────────────────
section('H. A line\'s result is the sum of its plots; the project total is the same sum');
{
  const snap = computeAllSellResults(state as never);
  const line = lineRevenueResults(['vA', 'vB'], snap, 'p1|branded-villas').sell!;
  const rA = snap.bySellAsset.get('vA')!, rB = snap.bySellAsset.get('vB')!;
  check('H1 the line\'s sales value is the two plots\' added', near(sum(line.presalesRevenuePerPeriod), sum(rA.presalesRevenuePerPeriod) + sum(rB.presalesRevenuePerPeriod)));
  check('H2 the per-row maps carry both plots\' rows', 'suA1' in line.presalesRevenuePerPeriodPerSubUnit && 'suB1' in line.presalesRevenuePerPeriodPerSubUnit);
  check('H3 the cash vintage matrix adds cell by cell', near(line.cashVintageMatrix[0][0], rA.cashVintageMatrix[0][0] + rB.cashVintageMatrix[0][0]));
  const sells = [...snap.bySellAsset.values()];
  check('H4 the project total IS sumSellResults over every asset', JSON.stringify(sumSellResults(sells, snap.axisLength, '__project__')) === JSON.stringify(snap.projectTotals));
  const h = lineRevenueResults(['h1'], snap, 'x').hospitality!;
  const rh = snap.byHospitalityAsset.get('h1')!;
  check('H5 a one-member hospitality line reads its member\'s occupancy and ADR exactly',
    JSON.stringify(h.occupancyPerPeriod) === JSON.stringify(rh.occupancyPerPeriod) && JSON.stringify(h.adrPerPeriod) === JSON.stringify(rh.adrPerPeriod));
  check('H6 the hospitality project total still carries no rates', snap.hospitalityProjectTotals.adrPerPeriod.every((v) => v === 0));
  const two = sumHospitalityResults([rh, rh], snap.axisLength, 'two', true);
  check('H7 two identical hotels summed: flows double, occupancy and ADR unchanged',
    near(sum(two.totalRevenuePerPeriod), 2 * sum(rh.totalRevenuePerPeriod)) && JSON.stringify(two.occupancyPerPeriod) === JSON.stringify(rh.occupancyPerPeriod));
}

// ── I. Seeds ────────────────────────────────────────────────────────────────
section('I. Revenue blocks are seeded in the persistence layer and the seed settles');
{
  const bare = [
    mkAsset({ id: 's1', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell' }),
    mkAsset({ id: 'o1', phaseId: 'p2', type: '4 Star Hotel', strategy: 'Operate' }),
    mkAsset({ id: 'l1', phaseId: 'p1', type: 'Standalone Commercial', strategy: 'Lease' }),
    mkAsset({ id: 'sm', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell + Manage' }),
    mkAsset({ id: 'hid2', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell', visible: false }),
  ];
  const first = seedRevenueBlocks(bare);
  check('I1 four visible bare assets are seeded, the hidden one is not', first.changed && first.seeded.length === 4 && !first.seeded.some((s) => s.assetId === 'hid2'));
  check('I2 each gets the block its strategy reads (Sell + Manage reads sell)',
    first.seeded.find((s) => s.assetId === 's1')?.form === 'sell' && first.seeded.find((s) => s.assetId === 'o1')?.form === 'operate'
    && first.seeded.find((s) => s.assetId === 'l1')?.form === 'lease' && first.seeded.find((s) => s.assetId === 'sm')?.form === 'sell');
  const second = seedRevenueBlocks(first.assets);
  check('I3 it SETTLES: the second pass returns the input array', second.changed === false && second.assets === first.assets);
  check('I4 the fixture assets already carry their blocks, so seeding them is a no-op', seedRevenueBlocks(assets).changed === false);
  const before = computeAllSellResults({ project, phases, assets: [...assets, ...bare], subUnits } as never);
  const after = computeAllSellResults({ project, phases, assets: [...assets, ...first.assets], subUnits } as never);
  check('I5 a seeded block earns nothing: every project-total FLOW is byte-identical (a seeded row adds a zero map entry, never money)',
    flowsOf(before) === flowsOf(after));
  check('I6 but the seeded assets now have a result the tabs can show (a zero line, not an absent one)',
    after.bySellAsset.has('s1') && after.byHospitalityAsset.has('o1') && after.byLeaseAsset.has('l1') && !before.bySellAsset.has('s1'));
  const store = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts'), 'utf8');
  // The load door's passes moved to settleModel.ts (2026-09-15, step 8); hydrate calls it.
  const settleSrc = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/lib/state/settleModel.ts'), 'utf8');
  check('I7 the store seeds on BOTH doors, load and save', /seedRevenueBlocks\(/.test(settleSrc) && /settleOnLoad = settleModel/.test(store) && /extractPersistSnapshot: \(\)[\s\S]*seedRevenueBlocks\(/.test(store));
}

// ── J. Cost of sales per line ──────────────────────────────────────────────
section('J. A line\'s cost of sales is the sum of its plots\'');
{
  const N = 4;
  const part = (id: string, k: number): AssetCostOfSales => ({
    assetId: id, assetCost: 100 * k, idc: 10 * k, capexBase: 110 * k,
    capexPerPeriod: [110 * k, 0, 0, 0], assetCapexPerPeriod: [100 * k, 0, 0, 0], idcCapitalisedPerPeriod: [10 * k, 0, 0, 0],
    recognitionPerPeriod: [0, 0, 50 * k, 50 * k], recognitionSharePerPeriod: [0, 0, 0.5, 0.5], totalRecognition: 100 * k,
    cos: { perPeriod: [0, 0, 55 * k, 55 * k], cumulativePerPeriod: [0, 0, 55 * k, 110 * k], grossMarginPerPeriod: [0, 0, -5 * k, -5 * k], totalCapex: 110 * k, totalRecognition: 100 * k },
    cosPresalesPerPeriod: [0, 0, 55 * k, 55 * k], cosPostSalesPerPeriod: [0, 0, 0, 0],
    inventoryPerPeriod: [110 * k, 110 * k, 55 * k, 0], vintageMatrix: [[0, 0, 55 * k, 55 * k], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    basis: { assetCost: 100 * k, idc: 10 * k, capexBase: 110 * k, label: '' },
  });
  const s = sumAssetCostOfSales([part('a', 1), part('b', 3)], 'line', N)!;
  check('J1 the charge adds', JSON.stringify(s.cos.perPeriod) === JSON.stringify([0, 0, 220, 220]));
  check('J2 the base and the IDC add, and the basis label is re-stated on the sum', s.capexBase === 440 && s.idc === 40 && s.basis.capexBase === 440 && s.basis.label.length > 0);
  check('J3 the recognition share sums to one again', near(sum(s.recognitionSharePerPeriod), 1));
  check('J4 the inventory and the vintage matrix add', JSON.stringify(s.inventoryPerPeriod) === JSON.stringify([440, 440, 220, 0]) && s.vintageMatrix[0][2] === 220);
  check('J5 one plot comes back as itself under the line id', sumAssetCostOfSales([part('a', 1)], 'line', N)?.assetId === 'line' && sumAssetCostOfSales([], 'line', N) === null);
  // J6: plots of a merged line each carry the LINE's recognition, so the line
  // total takes it ONCE (it printed double on the Cost of Sales build), while
  // the charge still adds and the margin is struck on the single figure.
  {
    const lineRec = (p: AssetCostOfSales): AssetCostOfSales => ({ ...p, recognitionPerPeriod: [0, 0, 200, 200], totalRecognition: 400, recognitionIsLine: true });
    const l = sumAssetCostOfSales([lineRec(part('a', 1)), lineRec(part('b', 3))], 'line', N)!;
    check('J6 a line recognition carried by every plot is taken once, the charge still adds',
      JSON.stringify(l.recognitionPerPeriod) === JSON.stringify([0, 0, 200, 200]) && l.totalRecognition === 400
      && JSON.stringify(l.cos.perPeriod) === JSON.stringify([0, 0, 220, 220])
      && JSON.stringify(l.cos.grossMarginPerPeriod) === JSON.stringify([0, 0, -20, -20])
      && near(sum(l.recognitionSharePerPeriod), 1));
  }
}

// ── K. The surfaces read the rule (static) ──────────────────────────────────
section('K. The surfaces read the rule');
{
  const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
  const tabs = {
    inputs: read('src/hubs/modeling/platforms/refm/components/modules/Module2Revenue.tsx'),
    output: read('src/hubs/modeling/platforms/refm/components/modules/Module2RevenueOutput.tsx'),
    schedules: read('src/hubs/modeling/platforms/refm/components/modules/Module2Schedules.tsx'),
    cos: read('src/hubs/modeling/platforms/refm/components/modules/Module2CostOfSales.tsx'),
    cosReport: read('src/hubs/modeling/platforms/refm/lib/reports/cosReports.ts'),
    nav: read('src/hubs/modeling/platforms/refm/components/modules/_shared/AssetQuickNav.tsx'),
  };
  for (const [name, src] of Object.entries(tabs)) {
    check(`K1 ${name} imports the one filing rule (revenueLines)`, /from '[^']*revenueLines'/.test(src));
  }
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const name of ['inputs', 'output', 'schedules', 'cos'] as const) {
    const code = stripComments(tabs[name]);
    check(`K2 ${name} has no companion-flag section test left ("|| a.isCompanion")`, !/\|\|\s*a\.isCompanion(\s*===\s*true)?\)/.test(code));
    check(`K3 ${name} names no strategy section title`, !/'(Residential \/ Sell|Hospitality \/ Operations|Retail \/ Lease)'/.test(code));
  }
  check('K4 the Module 2 tabs navigate per LINE (RevenueLineNav), not per asset',
    /RevenueLineNav/.test(tabs.inputs) && /RevenueLineNav/.test(tabs.output) && /RevenueLineNav/.test(tabs.cos) && !/AssetQuickNav/.test(tabs.inputs + tabs.output + tabs.cos));
  check('K5 the Inputs tab writes the line\'s terms to EVERY member (writeForm over line.members)', /for \(const m of line\.members\)[\s\S]*updateAsset\(m\.id/.test(tabs.inputs));
  check('K6 the Inputs tab derives the lockstep state from the model (velocityDefault), not localStorage',
    /velocityDefault === undefined/.test(tabs.inputs) && !/velocity:split/.test(tabs.inputs));
  const resolver = stripComments(read('src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts'));
  check('K7 the resolver reads no row metric on its own (u.metric === )', !/\bu\.metric === '/.test(resolver));
}

// ── M. The last step sells the exact remainder ───────────────────────────────
section('M. A schedule typed to 100% sells 100%: the last step takes the exact remainder');
{
  const mk = (metricValue: number, unitArea: number | undefined, vel: number[], metric: 'area' | 'units' = 'area') => {
    const a = mkAsset({ id: 'rm', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell', subUnitMetric: metric,
      revenue: { sell: sellBlock('rm', [{ id: 'sr', pre: vel }]) } });
    const su = mkSu({ id: 'sr', assetId: 'rm', metric, metricValue, unitArea, unitPrice: 10000 });
    return computeAllSellResults({ project, phases, assets: [a], subUnits: [su] } as never).bySellAsset.get('rm')!;
  };
  const full = mk(12342.277146685417, undefined, [0.05, 0.05, 0.4, 0.5]);
  check('M1 12,342.28 sqm at 5/5/40/50 sells exactly 12,342.28 (was 12,342, a fraction unsold for ever)',
    near(sum(full.presalesAreaPerPeriod), 12342.277146685417, 1e-9), String(sum(full.presalesAreaPerPeriod)));
  check('M2 the earlier steps still round to whole sqm; only the last takes the remainder',
    Number.isInteger(full.presalesAreaPerPeriod[0]) && Number.isInteger(full.presalesAreaPerPeriod[2]) && !Number.isInteger(full.presalesAreaPerPeriod[3]));
  const units = mk(143.6, 100, [0.5, 0.5, 0, 0], 'units');
  check('M3 143.6 units at 50/50 sells 143.6 units and 14,360 sqm exactly',
    near(sum(units.presalesUnitsPerPeriod), 143.6, 1e-9) && near(sum(units.presalesAreaPerPeriod), 14360, 1e-6));
  const short = mk(12342.28, undefined, [0.3, 0.3, 0.3, 0]);
  check('M4 a schedule that stops at 90% still leaves 10% unsold, as it says',
    sum(short.presalesAreaPerPeriod) < 12342.28 * 0.9 + 1 && sum(short.presalesAreaPerPeriod) > 12342.28 * 0.9 - 2);
  const over = mk(1000, undefined, [0.6, 0.6, 0, 0]);
  check('M5 a schedule past 100% is capped at the inventory, exactly', near(sum(over.presalesAreaPerPeriod), 1000, 1e-9));
}

// ── N. Both prices, stored; the active one follows the basis ────────────────
section('N. A sub-unit carries a price per sqm and a price per unit; unitPrice is the active one');
{
  const areaAsset = mkAsset({ id: 'pa', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell', subUnitMetric: 'area' });
  const unitsAsset = { ...areaAsset, subUnitMetric: 'units' } as Asset;
  const row = mkSu({ id: 'pr', assetId: 'pa', metric: 'area', metricValue: 1000, unitArea: 100, unitPrice: 18500 });
  const first = settleSubUnitPrices([row], [areaAsset]);
  check('N1 a row that predates the pair takes its price as the per-sqm statement, unitPrice unchanged',
    first.changed && first.subUnits[0].pricePerSqm === 18500 && first.subUnits[0].unitPrice === 18500 && first.subUnits[0].pricePerUnit === undefined);
  const second = settleSubUnitPrices(first.subUnits, [areaAsset]);
  check('N2 it settles: the second pass returns the input array', !second.changed && second.subUnits === first.subUnits);
  const withUnit = { ...first.subUnits[0], pricePerUnit: 2_500_000 };
  const switched = settleSubUnitPrices([withUnit], [unitsAsset]);
  check('N3 the asset switched to units: unitPrice follows the per-unit statement, the per-sqm one is kept',
    switched.changed && switched.subUnits[0].unitPrice === 2_500_000 && switched.subUnits[0].pricePerSqm === 18500);
  const back = settleSubUnitPrices(switched.subUnits, [areaAsset]);
  check('N4 and back to area: unitPrice is the per-sqm price again, nothing lost',
    back.subUnits[0].unitPrice === 18500 && back.subUnits[0].pricePerUnit === 2_500_000);
  check('N5 activePriceKey reads the ASSET\'s metric (TRAPS 7.32)',
    activePriceKey(row, unitsAsset) === 'pricePerUnit' && activePriceKey(row, areaAsset) === 'pricePerSqm');
  check('N6 rowsWithoutPriceIn names the rows with no price in the basis being entered',
    rowsWithoutPriceIn([first.subUnits[0]], 'pricePerUnit').length === 1 && rowsWithoutPriceIn([withUnit], 'pricePerUnit').length === 0);
  const store = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts'), 'utf8');
  check('N7 the store settles prices on BOTH doors', (store.match(/settleSubUnitPrices\(/g) ?? []).length >= 2);
  const t5 = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
  check('N8 Table 5 has the other-basis price cell, writes both on the Rate cell, and the switch names unpriced rows',
    t5.includes('-rate-other') && t5.includes("[priceKeyFor(u.category, isUnits ? 'units' : 'area')]: v ?? 0") && t5.includes('rowsWithoutPriceIn(dual, entering)'));
  // ONLY A SELLABLE ROW HAS TWO PRICES (2026-09-13, the founder's hotel): an
  // Operable row's rate is the ADR per room per night whatever the count, a
  // Leasable row's is per sqm per year, so neither follows a metric switch.
  const opRow = mkSu({ id: 'op', assetId: 'pa', category: 'Operable', metric: 'area', metricValue: 18750, unitPrice: 850 });
  check('N9 an Operable row states its price as the ADR (pricePerUnit) even when counted in sqm, and keeps it across a switch',
    activePriceKey(opRow, areaAsset) === 'pricePerUnit' && activePriceKey(opRow, unitsAsset) === 'pricePerUnit'
    && settleSubUnitPrices([opRow], [areaAsset]).subUnits[0].pricePerUnit === 850 && !hasDualPrice(opRow) && hasDualPrice(row));
  check('N10 Table 5 labels an Operable rate per room/night and a Leasable rate per sqm/year whatever the count',
    /if \(category === 'Operable'\) return 'per room\/night';/.test(t5) && /if \(category === 'Leasable'\) return 'per sqm\/year';/.test(t5)
    && /if \(category === 'Operable'\) return 'night';/.test(t5) && t5.includes('hasDualPrice(u) ? ('));
}

// ── O. The surfaces, statically ─────────────────────────────────────────────
section('O. The Output tab, the Inputs card and the selling costs read per line, pre and post in one table');
{
  const out = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module2RevenueOutput.tsx'), 'utf8');
  const inp = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module2Revenue.tsx'), 'utf8');
  check('O1 blocks 1 and 2 are ONE table each, banded pre-sales and sales during operation, with the two totals at the foot',
    out.includes('bands={saleBands}') && out.includes('buildPrePostRows(') && out.includes("label: 'Pre-sales (construction)'") && out.includes("tone: 'pre' as const") && out.includes("tone: 'post' as const") && /label: 'Sales during operation'/.test(out)
    && !out.includes('1a. Pre-Sales') && !out.includes('2a. Pre-Sales Revenue') && !out.includes('2b. Sales During Operation Revenue'));
  check('O2 the share sold per year is the first table of block 1, per sub-unit, pre and post in one row',
    out.includes('buildShareSoldRows(') && out.includes('1a. Share of inventory sold per year'));
  check('O3 the selling costs table and its year-on-year schedule file per LINE, the plots of a line added',
    (() => {
      // The rows moved into the shared builder on 2026-09-17 (the screen and
      // the workbook both render it); the screen keeps the per-LINE test ids.
      const sc = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/lib/reports/sellingCostReports.ts'), 'utf8');
      return /buildSellingCostReport\(/.test(out) && sc.includes('lineForAsset(lines, r.assetId)') && sc.includes('groupOf(r.assetId)')
        && out.includes('data-testid={`m2-selling-cost-${r.lineKey}-${r.lineId}`}') && !out.includes('data-testid={`m2-selling-cost-${r.assetId}-${r.lineId}`}');
    })());
  check('O4 the Inputs card shows the sale price per year after indexation, through the engine\'s own applyIndexation',
    inp.includes('-indexed-price') && inp.includes('applyIndexation(base, c.idx, idxAxis)') && inp.includes('expandIndexationToAxis(idxConfig'));
  check('O5 the Inputs card can copy its terms to every other line of the same form, writing every member of every target',
    inp.includes('copyTermsTo') && inp.includes('-copy-apply') && /for \(const m of target\.members\)/.test(inp)
    && /drop = new Set\(\['assetId', 'subUnits', 'escrow', 'handoverYearOverride', 'operationsStartYearOverride'\]\)/.test(inp));
  check('O6 the copy carries the pace as the target\'s line default and onto every target row, phase-local only',
    /velocityDefault: p2,/.test(inp) && /preSalesVelocity: \[\], postSalesVelocity: \[\],/.test(inp));
  // THE FOUNDER'S TWO FOLLOW-UPS (2026-09-13): every table in the sell block
  // wears the band, the matrices included, and the indexed price is on the
  // Output tab too.
  const vm = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/_shared/VintageMatrix.tsx'), 'utf8');
  check('O7 recognition, cash, receivables and unearned wear the same band as blocks 1 and 2, the vintage matrices included',
    (out.match(/bands=\{saleBands\}/g) ?? []).length >= 10 && vm.includes('bands?:') && vm.includes("band?.tone === 'post'"));
  // RE-AIMED 2026-09-24 (founder: a price PER SQM on every sub-unit): 2a is
  // built by the ONE builder the PDF and workbook share, which applies the same
  // indexation on the same resolver axis. verify-escalated-price pins its rows.
  check('O8 the Output sell block shows the sale price per sqm per year after indexation, per sub-unit, before revenue, on the resolver\'s axis',
    out.includes('2a. Sale price per sqm per year, after indexation') && out.indexOf('2a. Sale price per sqm per year') < out.indexOf('2b. Revenue (per sub-unit')
    && out.includes('buildEscalatedPriceTable(assetSubUnits, ownerOf, idxAxis') && out.includes('expandIndexationToAxis(indexation'));
}

// ── Q. A stored ADR of zero does not shadow the Table 5 price ────────────────
section('Q. The ADR is the first POSITIVE of startingAdr and unitPrice (the live hotel had startingAdr 0 and earned nothing)');
{
  check('Q1 resolveSubUnitAdr: startingAdr 0 falls through to unitPrice; a positive startingAdr wins; neither gives 0',
    resolveSubUnitAdr({ startingAdr: 0, unitPrice: 850 }) === 850 && resolveSubUnitAdr({ startingAdr: 900, unitPrice: 850 }) === 900
    && resolveSubUnitAdr({ unitPrice: 850 }) === 850 && resolveSubUnitAdr({ startingAdr: 0, unitPrice: 0 }) === 0);
  const h = mkAsset({ id: 'hz', phaseId: 'p2', type: '4 Star Hotel', assetTypeId: '4-star-hotel', strategy: 'Operate', subUnitMetric: 'units',
    revenue: { operate: { assetId: 'hz', startingADR: 0, adrIndexation: { method: 'none' }, occupancyPerPeriod: [], occupancyPerPeriodByPhase: [0, 0, 0, 1, 1, 1, 1, 1, 1], fb: { mode: 'percent_of_rooms', percentOfRooms: 0 }, otherRevenue: { mode: 'percent_of_rooms', percentOfRooms: 0 } } } });
  const row = mkSu({ id: 'hzr', assetId: 'hz', category: 'Operable', metric: 'units', metricValue: 100, unitPrice: 850, startingAdr: 0 });
  const r = computeAllSellResults({ project, phases, assets: [h], subUnits: [row] } as never).byHospitalityAsset.get('hz')!;
  check('Q2 a hotel row with startingAdr 0 and a price of 850 earns 100 x 850 x 365 x 6', near(sum(r.totalRevenuePerPeriod), 100 * 850 * 365 * 6, 1e-3), String(sum(r.totalRevenuePerPeriod)));
  const src = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
  const readers = [
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts', 'src/hubs/modeling/platforms/refm/components/modules/Module2Revenue.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
    'src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts', 'src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts',
    'src/hubs/modeling/platforms/refm/lib/state/strategySwitch.ts',
  ];
  check('Q3 no surface coalesces startingAdr ?? unitPrice on its own any more: every reader goes through the one rule',
    readers.every((p) => !/startingAdr \?\? \w+\.unitPrice/.test(src(p)) && src(p).includes('resolveSubUnitAdr(')));
}

// ── R. A plot of a merged line releases its cost as the line sells ──────────
section('R. Cost of sales on a merged line: the plot with capex and no rows charges on the LINE\'s recognition');
{
  // The shared sample state, with its Sell asset cloned onto a second plot of
  // the SAME type and phase: the clone carries capex (the same typed BUA, priced
  // by the standard lines) and no row at all, which is the live Land 2 shape.
  const base = buildExcelSampleState() as unknown as { assets: Asset[]; subUnits: SubUnit[] } & Record<string, unknown>;
  const r1 = base.assets.find((a) => a.id === 'R1')!;
  const typed = { ...r1, type: 'Branded Villas' } as Asset;
  const clone = { ...typed, id: 'R1b', revenue: { sell: sellBlock('R1b', []) } } as Asset;
  const st = { ...base, assets: [typed, clone, ...base.assets.filter((a) => a.id !== 'R1')] } as never;
  let ok = false; let detail = '';
  try {
    const fs2 = computeFinancialsSnapshot(st);
    const a = fs2.byAssetCostOfSales.get('R1'), b = fs2.byAssetCostOfSales.get('R1b');
    const recA = a?.recognitionPerPeriod ?? [];
    const totalRecA = sum(recA);
    const chargedA = sum(a?.cos.perPeriod), chargedB = sum(b?.cos.perPeriod);
    detail = `A base ${a?.capexBase.toFixed(2)} charged ${chargedA.toFixed(2)}; B base ${b?.capexBase.toFixed(2)} charged ${chargedB.toFixed(2)}`;
    // B charged the same SHARE of its base as A did of A's, on A's timing.
    ok = !!a && !!b && b.capexBase > 0 && totalRecA > 0 && chargedB > 0
      && near(chargedB / b.capexBase, chargedA / a.capexBase, 1e-9)
      && b.cos.perPeriod.every((v, t) => near(v, b.capexBase * ((recA[t] ?? 0) / totalRecA), 1e-6));
  } catch (e) { detail = (e as Error).message; }
  check('R1 the row-less plot charges its base on the line\'s recognition, the same share and the same timing as the plot with the rows', ok, detail);
  // Sabotage: the same clone on ANOTHER type is a line of its own and charges nothing.
  let alone = false;
  try {
    const other = { ...clone, type: 'High End Apartments' } as Asset;
    const fs3 = computeFinancialsSnapshot({ ...base, assets: [typed, other, ...base.assets.filter((a) => a.id !== 'R1')] } as never);
    alone = sum(fs3.byAssetCostOfSales.get('R1b')?.cos.perPeriod) === 0;
  } catch { alone = false; }
  check('R2 a row-less plot on a line of its own still charges nothing (no recognition of its own to spread on)', alone);
  const composer = readFileSync(join(process.cwd(), 'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts'), 'utf8');
  check('R3 a line of ONE plot passes no line series (its own recognition is the line\'s)', /if \(members\.length > 1\)/.test(composer));
}

// ── L. Live ─────────────────────────────────────────────────────────────────
async function live(): Promise<void> {
  section('L. Live: every project partitions into lines, sums agree, seeding settles');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('L0 credentials present', false, 'missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let projects = 0, partitioned = 0, summed = 0, settled = 0, identical = 0, noStripInHosp = 0, priced = 0, priceMoved = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: Record<string, unknown> }[];
    if (!vs[0]?.snapshot) continue;
    let st: { project: Project; phases: Phase[]; assets: Asset[]; subUnits: SubUnit[] };
    try { st = hydrationFromAnySnapshot(vs[0].snapshot as never) as never; } catch { continue; }
    projects += 1;
    const visible = (st.assets ?? []).filter((a) => a.visible !== false);
    const ls = planRevenueLines(st.assets ?? [], st.subUnits ?? [], st.phases ?? [], st.project);
    if (visible.every((a) => ls.filter((l) => l.members.some((m) => m.id === a.id)).length === 1)) partitioned += 1;
    const snap = computeAllSellResults({ project: st.project, phases: st.phases, assets: st.assets, subUnits: st.subUnits } as never);
    const lineSum = ls.map((l) => lineRevenueResults(l.members.map((m) => m.id), snap, l.key));
    const totalSell = lineSum.reduce((s, r) => s + sum(r.sell?.presalesRevenuePerPeriod) + sum(r.sell?.postSalesRevenuePerPeriod), 0);
    const totalHosp = lineSum.reduce((s, r) => s + sum(r.hospitality?.totalRevenuePerPeriod), 0);
    const totalLease = lineSum.reduce((s, r) => s + sum(r.lease?.totalRevenuePerPeriod), 0);
    if (near(totalSell, sum(snap.projectTotals.presalesRevenuePerPeriod) + sum(snap.projectTotals.postSalesRevenuePerPeriod), 1e-3)
      && near(totalHosp, sum(snap.hospitalityProjectTotals.totalRevenuePerPeriod), 1e-3)
      && near(totalLease, sum(snap.leaseProjectTotals.totalRevenuePerPeriod), 1e-3)) summed += 1;
    if (![...snap.byHospitalityAsset.keys()].some((id) => st.assets.find((a) => a.id === id)?.companionType === 'retail')) noStripInHosp += 1;
    // P: the price settle backfills and then settles, and never moves a unitPrice on load.
    const pr1 = settleSubUnitPrices(st.subUnits ?? [], st.assets ?? []);
    const pr2 = settleSubUnitPrices(pr1.subUnits, st.assets ?? []);
    if (!pr2.changed) priced += 1;
    if (pr1.moved.length === 0) priceMoved += 1;
    const seeded = seedRevenueBlocks(st.assets ?? []);
    const again = seedRevenueBlocks(seeded.assets);
    if (!again.changed) settled += 1;
    const snapSeeded = computeAllSellResults({ project: st.project, phases: st.phases, assets: seeded.assets, subUnits: st.subUnits } as never);
    if (flowsOf(snapSeeded) === flowsOf(snap)) identical += 1;
    console.log(`    ${p.name}: ${visible.length} visible asset(s), ${ls.length} line(s), seeded ${seeded.seeded.length}`);
  }
  check(`L1 loaded live projects (${projects})`, projects > 0);
  check(`L2 every visible asset is on exactly one line, on every project (${partitioned}/${projects})`, partitioned === projects);
  check(`L3 the lines sum to the project totals, on every project (${summed}/${projects})`, summed === projects);
  check(`L4 no retail strip is in the hospitality loop, on any project (${noStripInHosp}/${projects})`, noStripInHosp === projects);
  check(`L5 seeding settles on the second pass, on every project (${settled}/${projects})`, settled === projects);
  check(`L6 seeding leaves the project totals byte-identical, on every project (${identical}/${projects})`, identical === projects);
  check(`P1 the sub-unit price settle settles on the second pass, on every project (${priced}/${projects})`, priced === projects);
  check(`P2 and moves no unitPrice on load: every existing row keeps its price (${priceMoved}/${projects})`, priceMoved === projects);
}

live().then(() => {
  console.log('');
  if (failures.length === 0) {
    console.log(`verify-revenue-lines: ${passed} passed, 0 failed`);
  } else {
    console.log(`verify-revenue-lines: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}).catch((e) => { console.error(e); process.exit(1); });
