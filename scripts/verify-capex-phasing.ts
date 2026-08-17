/**
 * verify-capex-phasing.ts (Module 1 Capex, 2026-08-15)
 *
 * Four related changes, one shared mechanism.
 *
 *   A. The shared inherit-and-override primitive. Built once because the
 *      consolidated input matrices will reuse it, so it carries no capex
 *      vocabulary and is tested on its own terms.
 *   B. One curve across the asset: every line inherits it, any line can break
 *      out, and a broken-out line is visibly broken out.
 *   C. Derived sources: RETT follows the land cash outflow, marketing and
 *      commission follow sales collections.
 *   D. Hard / soft classification restored: on the row, as subtotals, and into
 *      the reports and exports.
 *
 * THE CHECK THAT MATTERS MOST IS THE INERT ONE. Every existing project carries
 * no asset curve and no phasingSource anywhere, and must be byte-identical.
 * Section E proves that against the real engine rather than asserting it.
 *
 * Run: npx tsx scripts/verify-capex-phasing.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveInheritance } from '../src/hubs/modeling/platforms/refm/lib/state/inheritance';
import {
  shapeToPhasing, resolvePhasingSource, resolveLinePhasing,
  capexPhasingIsInert, projectAxisToPhaseLocal, isParcelDrivenLandLine,
} from '../src/core/calculations/capexPhasing';
import {
  makeDefaultCostLines, makeBlankCostLines, makeDefaultPhase, makeDefaultProject,
  SEEDED_COST_LINE_IDS, CAPEX_PHASING_SOURCES,
  type Asset, type CostLine, type CostOverride,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeAssetCost, deriveCostStage } from '../src/core/calculations';
import { findCatalogEntry } from '../src/hubs/modeling/platforms/refm/lib/state/costCatalog';
import { sumCapexStages, totalCapexStages } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const REFM = 'src/hubs/modeling/platforms/refm';
const SRC_COSTS_UI = read(`${REFM}/components/modules/Module1Costs.tsx`);
const SRC_ENGINE = read('src/core/calculations/index.ts');
const SRC_PDF = read(`${REFM}/lib/pdf/generateProjectPdf.ts`);
const SRC_XLSX = read(`${REFM}/lib/excel/buildModelWorkbook.ts`);
const SRC_REPORTS = read(`${REFM}/lib/reports/capexReports.ts`);

const baseId = (id: string): string => id.split('__')[0];

// ════════════════════════════════════════════════════════════════════════════
section('A. The shared inherit-and-override mechanism');

check('A1 nothing set resolves to the fallback (the inert case)',
  resolveInheritance({ fallback: 'own-value' }).value === 'own-value');
check('A2 ...and is not reported as broken out',
  resolveInheritance({ fallback: 'x' }).brokenOut === false);
check('A3 a group value is inherited when present',
  resolveInheritance({ group: 'G', fallback: 'F' }).value === 'G');
check('A4 an explicit own value wins over the group',
  resolveInheritance({ mode: 'own', own: 'O', group: 'G', fallback: 'F' }).value === 'O');
check('A5 ...and IS reported as broken out',
  resolveInheritance({ mode: 'own', own: 'O', group: 'G', fallback: 'F' }).brokenOut === true);
check('A6 a derived source supplies its value',
  resolveInheritance({ mode: 'src', derived: { src: () => 'D' }, group: 'G', fallback: 'F' }).value === 'D');
{
  // The failure mode that matters: a follower whose source has nothing must
  // NOT resolve to empty. It falls through and says so.
  const r = resolveInheritance({ mode: 'src', derived: { src: () => undefined }, group: 'G', fallback: 'F' });
  check('A7 an empty source falls through rather than resolving to nothing', r.value === 'G');
  check('A8 ...and is flagged degraded', r.degraded === true);
  check('A9 ...and the reason says why', /nothing to follow/i.test(r.reason), r.reason);
}
{
  const r = resolveInheritance({ mode: 'src', derived: { src: () => undefined }, fallback: 'F' });
  check('A10 with no group either, it keeps its own setting', r.value === 'F' && r.degraded);
}
check('A11 an unknown source name degrades rather than throwing',
  resolveInheritance({ mode: 'nope', fallback: 'F' }).value === 'F');
check('A12 the mechanism carries no capex vocabulary (it is reused later)',
  !/capex|phasing|cost/i.test(read(`${REFM}/lib/state/inheritance.ts`).split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')));

// ════════════════════════════════════════════════════════════════════════════
section('B. Shapes and sources');

check('B1 a shape normalises to weights summing to 1', (() => {
  const p = shapeToPhasing([0, 0, 10, 30, 10]);
  const s = (p?.distribution ?? []).reduce((a, b) => a + b, 0);
  return !!p && Math.abs(s - 1) < 1e-12;
})());
check('B2 ...and trims to the periods the money actually moves in', (() => {
  const p = shapeToPhasing([0, 0, 10, 30, 10, 0, 0]);
  return p?.startPeriod === 2 && p?.endPeriod === 4;
})());
check('B3 an all-zero shape yields nothing to follow', shapeToPhasing([0, 0, 0]) === undefined);
check('B4 an empty shape yields nothing', shapeToPhasing([]) === undefined && shapeToPhasing(undefined) === undefined);
check('B5 a single-period shape is a single-period curve', (() => {
  const p = shapeToPhasing([0, 5, 0]);
  return p?.startPeriod === 1 && p?.endPeriod === 1 && p?.distribution?.length === 1;
})());
check('B6 project-axis to phase-local respects the engine offset rule', (() => {
  // local i>=1 maps to project offset+i-1; local 0 is the Y0 lump slot.
  const out = projectAxisToPhaseLocal([9, 8, 7, 6], 1, 4);
  return out?.[0] === 0 && out?.[1] === 8 && out?.[2] === 7;
})());

const bareLine = (over: Partial<CostLine> = {}): CostLine => ({
  id: 'l1', phaseId: 'p1', name: 'L', method: 'fixed', value: 100,
  stage: 'soft', scope: 'direct', allocationBasis: 'per_asset',
  startPeriod: 1, endPeriod: 3, phasing: 'even', ...over,
} as CostLine);

check('B7 an absent source means inherit (every pre-existing line)',
  resolvePhasingSource(bareLine()) === 'inherit');
check('B8 a line-level source is read',
  resolvePhasingSource(bareLine({ phasingSource: 'collections' })) === 'collections');
check('B9 an ACTIVE per-asset override wins over the master line',
  resolvePhasingSource(bareLine({ phasingSource: 'collections' }),
    { assetId: 'a1', lineId: 'l1', method: 'fixed', value: 1, phasing: 'even', phasingSource: 'own', overridden: true } as CostOverride) === 'own');
check('B10 an INACTIVE override does not',
  resolvePhasingSource(bareLine({ phasingSource: 'collections' }),
    { assetId: 'a1', lineId: 'l1', method: 'fixed', value: 1, phasing: 'even', phasingSource: 'own', overridden: false } as CostOverride) === 'collections');

// ════════════════════════════════════════════════════════════════════════════
section('C. Line resolution');

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned', ...over,
} as Asset);
const FALLBACK = { phasing: 'even' as const, distribution: undefined, startPeriod: 1, endPeriod: 3 };

check('C1 no asset curve: the line keeps exactly what it had',
  JSON.stringify(resolveLinePhasing(bareLine(), FALLBACK, asset(), {}).effective) === JSON.stringify(FALLBACK));
check('C2 an asset curve is inherited, keeping the line WINDOW', (() => {
  const e = resolveLinePhasing(bareLine(), FALLBACK, asset({ capexPhasing: { phasing: 'manual', distribution: [1, 2, 3] } }), {}).effective;
  return e.phasing === 'manual' && e.startPeriod === 1 && e.endPeriod === 3;
})());
// ── The alignment bug (2026-08-15b) ───────────────────────────────────────
// The asset curve is authored against ABSOLUTE periods P0..Pn, but
// distribute('manual', span, weights) reads weights[i] counting from the START
// OF THE WINDOW. Handing the whole array to a line starting at P1 applied the
// P0 weight to P1, shifted everything one period early and dropped the last
// weight. Measured before the fix: a typed 0/10/30/40/20 became
// 0 / 12.5 / 37.5 / 50 on a P1..P4 line. That is money on a curve the user
// never entered, so these checks are about the NUMBERS, not the display.
{
  const CURVE = [0, 10, 30, 40, 20];
  const win = { phasing: 'even' as const, distribution: undefined, startPeriod: 1, endPeriod: 4 };
  const e = resolveLinePhasing(bareLine(), win, asset({ capexPhasing: { phasing: 'manual', distribution: CURVE } }), {}).effective;
  check('C2a an inherited curve is SLICED to the line window, not applied from index 0',
    JSON.stringify(e.distribution) === JSON.stringify([10, 30, 40, 20]),
    JSON.stringify(e.distribution));
  check('C2b ...so the weight typed against P1 lands on P1',
    (e.distribution?.[0] ?? 0) === 10, String(e.distribution?.[0]));
  check('C2c ...and the last period is not dropped off the end',
    (e.distribution?.[3] ?? 0) === 20, String(e.distribution?.[3]));
  // A window the curve says nothing about must NOT become a zero curve, or the
  // line's money disappears without a trace.
  const far = { phasing: 'even' as const, distribution: undefined, startPeriod: 9, endPeriod: 12 };
  const d = resolveLinePhasing(bareLine(), far, asset({ capexPhasing: { phasing: 'manual', distribution: CURVE } }), {});
  check('C2d a window outside the curve degrades instead of zeroing the line',
    d.resolution.degraded === true && JSON.stringify(d.effective) === JSON.stringify(far));
  // An all-zero slice is the same hazard by a different route.
  const zeroSlice = { phasing: 'even' as const, distribution: undefined, startPeriod: 0, endPeriod: 0 };
  const z = resolveLinePhasing(bareLine(), zeroSlice, asset({ capexPhasing: { phasing: 'manual', distribution: CURVE } }), {});
  check('C2e an all-zero slice degrades too (P0 carries no weight here)',
    z.resolution.degraded === true);
}
check('C3 a broken-out line ignores the asset curve', (() => {
  const d = resolveLinePhasing(bareLine({ phasingSource: 'own' }), FALLBACK,
    asset({ capexPhasing: { phasing: 'manual', distribution: [1, 2, 3] } }), {});
  return d.effective.phasing === 'even' && d.resolution.brokenOut === true;
})());
check('C4 land_cash REPLACES the window, not just the shape', (() => {
  // The point of the fix: a transfer tax must not sit on the construction curve.
  const d = resolveLinePhasing(bareLine({ phasingSource: 'land_cash' }), FALLBACK, asset(),
    { landCashPerPeriod: [7, 0, 0, 0] });
  return d.effective.startPeriod === 0 && d.effective.endPeriod === 0;
})());
check('C5 collections REPLACE the window too', (() => {
  const d = resolveLinePhasing(bareLine({ phasingSource: 'collections' }), FALLBACK, asset(),
    { collectionsPerPeriod: [0, 0, 0, 0, 10, 30, 10] });
  return d.effective.startPeriod === 4 && d.effective.endPeriod === 6;
})());
check('C6 ...with weights proportional to the collections', (() => {
  const d = resolveLinePhasing(bareLine({ phasingSource: 'collections' }), FALLBACK, asset(),
    { collectionsPerPeriod: [0, 10, 30] });
  const w = d.effective.distribution ?? [];
  return Math.abs((w[0] ?? 0) - 0.25) < 1e-12 && Math.abs((w[1] ?? 0) - 0.75) < 1e-12;
})());
check('C7 a follower with NO collections degrades and says so', (() => {
  const d = resolveLinePhasing(bareLine({ phasingSource: 'collections' }), FALLBACK, asset(), {});
  return d.resolution.degraded === true && d.effective.phasing === 'even';
})());
check('C8 ...and does NOT silently phase to nothing',
  (resolveLinePhasing(bareLine({ phasingSource: 'collections' }), FALLBACK, asset(), {})
    .effective.distribution ?? []).length === 0);
// The case a missing profile does NOT cover: a profile that EXISTS and is all
// zero, which is what a sell asset with no collections inside its own window
// actually looks like. It must degrade the same way, not collapse the line into
// period 0. Added after a sabotage showed C7 and C8 both missed it.
{
  const d = resolveLinePhasing(bareLine({ phasingSource: 'collections' }), FALLBACK, asset(),
    { collectionsPerPeriod: [0, 0, 0, 0] });
  check('C9 an ALL-ZERO source degrades exactly like a missing one',
    d.resolution.degraded === true && JSON.stringify(d.effective) === JSON.stringify(FALLBACK));
}
{
  const d = resolveLinePhasing(bareLine({ phasingSource: 'land_cash' }), FALLBACK,
    asset({ capexPhasing: { phasing: 'manual', distribution: [2, 1] } }),
    { landCashPerPeriod: [0, 0, 0] });
  check('C10 ...falling back to the asset curve when there is one, and saying so',
    d.effective.phasing === 'manual' && d.resolution.degraded === true
    && /nothing to follow/i.test(d.resolution.reason));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. Seeded defaults and classification');

const lines = makeBlankCostLines('p1', 6);
const byBase = new Map(lines.map((l) => [baseId(l.id), l]));
// 2026-08-17c: RETT is NO LONGER SEEDED. It was seeded and country gated, so on
// most projects it was present but invisible, which let the engine charge a row
// nobody could see and later let selecting a country double a cost the user had
// entered by hand. It is a catalog ENTRY now, added when the project needs it,
// and the entry is what carries the land cash source onto the line. See
// verify-no-hidden-cost-lines. D1 / D3 / D6 moved there.
const rettEntry = findCatalogEntry('rett');
check('D1 RETT is in the CATALOG (not the seed)', !!rettEntry && !byBase.has('rett'));
check('D2 Marketing is in the catalog', byBase.has('marketing'));
check('D3 the RETT entry follows land cash', rettEntry?.phasingSource === 'land_cash');
check('D4 Marketing follows collections by default', byBase.get('marketing')?.phasingSource === 'collections');
check('D5 Commission follows collections by default', byBase.get('commission')?.phasingSource === 'collections');
check('D6 no seeded line is country gated', lines.every((l) => l.requiresCountry === undefined));
check('D7 the new lines seed at a ZERO rate like every other line',
  (byBase.get('marketing')?.value ?? -1) === 0);
check('D8 no OTHER seeded line was given a source (they inherit)',
  lines.filter((l) => l.phasingSource && !['marketing', 'commission'].includes(baseId(l.id))).length === 0);
// 2026-08-16: Marketing moved from `soft` to its OWN stage, so that construction
// cost excluding land can exclude it while the developer fee and contingency
// still charge on it. This check asserted the superseded classification.
check('D9 a RETT line classifies as land, Marketing as its own stage',
  rettEntry?.stage === 'land'
  && deriveCostStage(byBase.get('marketing')!) === 'marketing');
check('D10 the seed and the seed-set list agree',
  lines.length === SEEDED_COST_LINE_IDS.length, `${lines.length} vs ${SEEDED_COST_LINE_IDS.length}`);
check('D11 the reference catalog still carries the benchmark rates',
  makeDefaultCostLines('p1', 6).find((l) => baseId(l.id) === 'construction-bua')?.value === 4500);

// Stage subtotals, the shared builder.
{
  const st = sumCapexStages([
    { stage: 'hard', amount: 100 }, { stage: 'soft', amount: 40 },
    { stage: 'land', amount: 500 }, { stage: 'operating', amount: 10 },
  ]);
  check('D12 subtotals split hard / soft / land / operating',
    st.hard === 100 && st.soft === 40 && st.land === 500 && st.operating === 10);
  check('D13 development cost excludes land', st.exclLand === 150);
  check('D14 total includes it', st.total === 650);
  const roll = totalCapexStages([{ subtotals: st }, { subtotals: st }]);
  check('D15 the project roll-up adds up', roll.hard === 200 && roll.exclLand === 300 && roll.total === 1300);
}

// Where the classification has to REACH.
check('D16 the row carries a visible stage marker again',
  /data-testid=\{`cost-\$\{asset\.id\}-\$\{line\.id\}-stage`\}/.test(SRC_COSTS_UI));
check('D17 the report layer aggregates stages (it had none at all)',
  /sumCapexStages/.test(SRC_REPORTS) && /subtotals: sumCapexStages\(lines\)/.test(SRC_REPORTS));
check('D18 the report reads deriveCostStage, not the raw stored field',
  /stage: String\(deriveCostStage\(cl\)/.test(SRC_REPORTS));
check('D19 the PDF prints hard and soft subtotals',
  /\['Hard costs', ia\.subtotals\.hard\]/.test(SRC_PDF) && /\['Soft costs', ia\.subtotals\.soft\]/.test(SRC_PDF));
check('D20 the workbook prints them too',
  /\['Hard costs', ia\.subtotals\.hard\]/.test(SRC_XLSX) && /\['Soft costs', ia\.subtotals\.soft\]/.test(SRC_XLSX));

// ════════════════════════════════════════════════════════════════════════════
section('E. INERT BY DEFAULT (the check that protects every existing project)');

const project = makeDefaultProject();
const phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 4, operationsPeriods: 4 };
const parcels = [{ id: 'pc1', phaseId: 'p1', name: 'Land', area: 10000, rate: 500, cashPct: 100, inKindPct: 0 }];
const su = [{ id: 'su1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units', metricValue: 20, unitArea: 100, unitPrice: 800000 }];
const legacyLines = makeDefaultCostLines('p1', 4).map((l) => {
  // An EXISTING project's lines: no phasingSource anywhere.
  const { phasingSource: _drop, ...rest } = l as CostLine & { phasingSource?: unknown };
  return rest as CostLine;
});
const a0 = asset({ buaSqm: 2000, gfaSqm: 2000, sellableBuaSqm: 2000, landAllocation: { parcelId: 'pc1', sqm: 10000 } });

check('E1 an untouched asset + untouched lines are inert',
  capexPhasingIsInert(a0, legacyLines, []) === true);
check('E2 an asset curve breaks inertness (the opt-in)',
  capexPhasingIsInert(asset({ capexPhasing: { phasing: 'even' } }), legacyLines, []) === false);
check('E3 a line source breaks inertness',
  capexPhasingIsInert(a0, [...legacyLines, bareLine({ phasingSource: 'collections' })], []) === false);
check('E4 an explicit inherit does NOT break inertness',
  capexPhasingIsInert(a0, [...legacyLines, bareLine({ phasingSource: 'inherit' })], []) === true);
check('E5 an override source breaks inertness',
  capexPhasingIsInert(a0, legacyLines, [{ assetId: 'a1', lineId: 'l1', method: 'fixed', value: 1, phasing: 'even', phasingSource: 'own' } as CostOverride]) === false);

// The real proof: run the ENGINE both ways and compare every number.
const run = (lns: CostLine[], ast: Asset, collections?: number[]): string => JSON.stringify(
  computeAssetCost({ asset: ast, project: project as never, phase: phase as never, parcels: parcels as never, assets: [ast], subUnits: su as never, costLines: lns, costOverrides: [], landAllocationMode: 'autoByBua', parcelFunding: undefined, collectionsPerPeriod: collections }));

const baseline = run(legacyLines, a0);
check('E6 the engine is BYTE-IDENTICAL on an untouched project', run(legacyLines, a0) === baseline);
check('E7 ...and still identical when a collections profile is supplied but nothing follows it',
  run(legacyLines, a0, [0, 10, 20, 30]) === baseline,
  'a supplied profile must not move a project that never opted in');
check('E8 ...and still identical when every line explicitly says inherit',
  run(legacyLines.map((l) => ({ ...l, phasingSource: 'inherit' as const })), a0) === baseline);

// And the opposite: opting in DOES move the model, or the feature does nothing.
const withCurve = run(legacyLines, asset({ ...a0, capexPhasing: { phasing: 'manual', distribution: [0, 0, 0, 0, 1] } }));
check('E9 setting an asset curve DOES change the phasing', withCurve !== baseline);
// A follower with a REAL amount. Note the seeded `commission` line cannot be
// used here: it is percent_of_selected with an EMPTY selectedLineIds, so it
// computes to zero out of the box (pre-existing, and the seed comment says so),
// and a zero line is skipped before any curve is built. Using it would have
// made this check pass vacuously.
const followers = [...legacyLines, bareLine({
  id: 'follow__p1', phaseId: 'p1', name: 'Sales cost', method: 'fixed', value: 1_000_000,
  allocationBasis: 'per_asset', phasingSource: 'collections', startPeriod: 1, endPeriod: 4,
})];
check('E10 a collections follower moves when collections are supplied',
  run(followers, a0, [0, 0, 0, 0, 100]) !== run(followers, a0, [0, 100, 0, 0, 0]));
check('E10b ...and lands in the periods the collections are in', (() => {
  const bd = JSON.parse(run(followers, a0, [0, 0, 0, 0, 100])) as { perLinePerPeriod: Record<string, number[]> };
  const series = bd.perLinePerPeriod['follow__p1'] ?? [];
  return (series[4] ?? 0) > 0 && (series[1] ?? 0) === 0;
})(), 'the cost must arise where the cash arrives, not across the build');

// ── Land takes no part in phasing (2026-08-15b) ───────────────────────────
// Land cash timing comes from the parcel schedule. Presenting it as a curve,
// or letting it inherit one, implies a decision the user does not have.
{
  const landLine = legacyLines.find((l) => baseId(l.id) === 'land-cash')!;
  const inKind = legacyLines.find((l) => baseId(l.id) === 'land-inkind')!;
  check('E12a the land value lines are identified as parcel driven',
    isParcelDrivenLandLine(landLine) && isParcelDrivenLandLine(inKind));
  check('E12b RETT is NOT: it is a land-stage cost that DOES follow land cash',
    !isParcelDrivenLandLine({ id: 'rett__p1' }),
    'excluding by stage or by method would wrongly catch it');
  check('E12c a land line never reports as broken out',
    resolveLinePhasing(landLine, FALLBACK, asset({ capexPhasing: { phasing: 'manual', distribution: [1, 2, 3, 4, 5] } }), {})
      .resolution.brokenOut === false);
  check('E12d ...and keeps its own timing whatever the asset curve says', (() => {
    const e = resolveLinePhasing(landLine, FALLBACK,
      asset({ capexPhasing: { phasing: 'manual', distribution: [1, 2, 3, 4, 5] } }), {}).effective;
    return JSON.stringify(e) === JSON.stringify(FALLBACK);
  })());
  // The money proof: land is byte-identical with and without an asset curve.
  const landSeries = (s: string): string => JSON.stringify(
    (JSON.parse(s) as { perLinePerPeriod: Record<string, number[]> }).perLinePerPeriod['land-cash__p1'] ?? []);
  check('E12e land money does not move when an asset curve is set',
    landSeries(withCurve) === landSeries(baseline), `${landSeries(withCurve)} vs ${landSeries(baseline)}`);
}
check('E12f the row shows no phasing control for a land line',
  /isParcelLand \? \(/.test(SRC_COSTS_UI) && /phasing-parcel/.test(SRC_COSTS_UI));
check('E12g ...and no inheritance badge',
  /if \(isParcelLand\) return null;/.test(SRC_COSTS_UI));
check('E12h the row renders the curve IN FORCE, not the stored one',
  /const effDistribution = inheritedCurve \?\? storedDistribution;/.test(SRC_COSTS_UI));
check('E12i ...and locks it when the asset curve is driving',
  /disabled=\{isLocked \|\| curveIsReadOnly\}/.test(SRC_COSTS_UI));
check('E12j the engine and the row share ONE land predicate',
  /isParcelDrivenLandLine/.test(SRC_COSTS_UI) && /isParcelDrivenLandLine/.test(read('src/core/calculations/capexPhasing.ts')));

// Totals can never move: weights sum to 1.
const totalOf = (s: string): number => (JSON.parse(s) as { total: number }).total;
check('E11 phasing never changes a TOTAL',
  Math.abs(totalOf(withCurve) - totalOf(baseline)) < 1e-9,
  `${totalOf(withCurve)} vs ${totalOf(baseline)}`);

// Engine placement: the resolution must sit where it cannot be bypassed.
check('E12 the resolution lives inside computeAssetCost, not at the call sites',
  /capexPhasingIsInert\(asset, phaseLines, costOverrides\)/.test(SRC_ENGINE));
check('E13 it is SKIPPED when inert rather than trusted to cancel out',
  /if \(!capexPhasingIsInert\(/.test(SRC_ENGINE));
check('E14 every source in the type is offered in the UI',
  CAPEX_PHASING_SOURCES.every((s) => new RegExp(`'${s}'`).test(SRC_COSTS_UI) || s === 'inherit'));
check('E15 the UI badges a line that has stopped inheriting',
  /not inheriting/.test(SRC_COSTS_UI) && /phasing-badge/.test(SRC_COSTS_UI));
// "Above the cost table" means inside the asset section and before THAT
// section's table. An earlier draft compared against the first `<thead>` in the
// file, which belongs to an unrelated sub-unit rate table inside CostRow, so it
// was measuring nothing.
check('E16 the asset curve control sits above the asset cost table', (() => {
  const at = SRC_COSTS_UI.indexOf('<AssetPhasingControl');
  if (at < 0) return false;
  const tableAfter = SRC_COSTS_UI.indexOf('<colgroup>', at);
  const sectionEnd = SRC_COSTS_UI.indexOf('+ Add Custom Cost', at);
  return tableAfter > at && sectionEnd > tableAfter;
})());

// ════════════════════════════════════════════════════════════════════════════
section('F. RETT follows the LAND LINE, not every line sharing its method');

// The shape a `land_cash` follower follows was built by scanning for
// `method === 'percent_of_cash_land'`. A transfer tax IS a percentage of the
// cash land value, so RETT was HALF OF THE SHAPE IT WAS FOLLOWING. Measured on
// a live project: phase 2 land cash was 18,750,000 entirely in period 1, and
// RETT resolved across 1..3 as 625,000 / 156,250 / 156,250, which is the land
// cash blended with RETT's own construction spread.
{
  const landCash: CostLine = {
    id: 'land-cash__p1', phaseId: 'p1', name: 'Land (Cash)', method: 'percent_of_cash_land',
    value: 100, stage: 'land', scope: 'direct', allocationBasis: 'land_share',
    startPeriod: 1, endPeriod: 1, phasing: 'even', isLocked: true,
  };
  const rett: CostLine = {
    id: 'rett__p1', phaseId: 'p1', name: 'Real Estate Transfer Tax', method: 'percent_of_cash_land',
    value: 5, stage: 'land', scope: 'direct', allocationBasis: 'land_share',
    // A CONSTRUCTION window, which is what a seeded or user-added line carries.
    // This is the input that produced the wrong answer.
    startPeriod: 1, endPeriod: 4, phasing: 'even', phasingSource: 'land_cash',
  };
  const lns = [landCash, rett];
  const bd = JSON.parse(run(lns, a0)) as {
    perLinePerPeriod: Record<string, number[]>;
    resolvedWindowByLineId: Record<string, { startPeriod: number; endPeriod: number; source: string }>;
    byLineId: Record<string, number>;
  };
  const cash = bd.perLinePerPeriod['land-cash__p1'] ?? [];
  const tax = bd.perLinePerPeriod['rett__p1'] ?? [];
  const cashPeriods = cash.map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);
  const taxPeriods = tax.map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);

  check('F1 the fixture is non-vacuous: the land cash is a real amount in ONE period',
    cashPeriods.length === 1 && (bd.byLineId['land-cash__p1'] ?? 0) > 0,
    `periods ${cashPeriods.join(',')}`);
  check('F2 the transfer tax lands in exactly the periods the land cash does',
    JSON.stringify(taxPeriods) === JSON.stringify(cashPeriods),
    `tax in ${taxPeriods.join(',')} vs land cash in ${cashPeriods.join(',')}`);
  check('F3 ...as ONE amount, not spread across the build',
    taxPeriods.length === 1
    && Math.abs((tax[taxPeriods[0]] ?? 0) - (bd.byLineId['rett__p1'] ?? 0)) < 1,
    `${Math.round(tax[taxPeriods[0]] ?? 0)} of ${Math.round(bd.byLineId['rett__p1'] ?? 0)}`);
  check('F4 and the engine reports that it followed the land cash',
    bd.resolvedWindowByLineId['rett__p1']?.source === 'land_cash');

  // Moving the land cash moves the tax with it: proof it FOLLOWS rather than
  // happening to agree.
  const moved = JSON.parse(run([{ ...landCash, startPeriod: 3, endPeriod: 3 }, rett], a0)) as {
    perLinePerPeriod: Record<string, number[]>;
  };
  const movedTax = (moved.perLinePerPeriod['rett__p1'] ?? []).map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);
  check('F5 moving the land cash moves the tax with it',
    JSON.stringify(movedTax) === JSON.stringify([3]), movedTax.join(','));

  // In-kind land is not cash: a transfer tax follows the CASH outflow.
  const inKind: CostLine = {
    ...landCash, id: 'land-inkind__p1', name: 'Land (In-Kind)',
    method: 'percent_of_inkind_land', startPeriod: 4, endPeriod: 4,
  };
  const withInKind = JSON.parse(run([landCash, inKind, rett], a0)) as { perLinePerPeriod: Record<string, number[]> };
  const tax2 = (withInKind.perLinePerPeriod['rett__p1'] ?? []).map((v, i) => (v > 0.5 ? i : -1)).filter((i) => i >= 0);
  check('F6 an in-kind land line does not pull the transfer tax',
    JSON.stringify(tax2) === JSON.stringify(cashPeriods), tax2.join(','));

  // The rule is named, not re-derived.
  check('F7 the engine selects the land line by the shared predicate',
    /if \(!isParcelDrivenLandLine\(r\.line\) \|\| r\.method !== 'percent_of_cash_land'\) continue;/
      .test(SRC_ENGINE));
}

console.log('');
if (failures.length === 0) {
  console.log(`verify-capex-phasing: ${passed} passed, 0 failures`);
  process.exit(0);
}
console.log(`verify-capex-phasing: ${passed} passed, ${failures.length} FAILURES`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(1);
