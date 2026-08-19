/**
 * verify-selling-cost-scope.ts (2026-08-19)
 *
 * A SELLING COST APPLIES ONLY TO AN ASSET THAT SELLS.
 *
 * Three symptoms reported from the screen, one root:
 *
 *   1. A marketing rate typed on the residential asset appeared on the retail
 *      asset, and clearing it on the retail asset removed it from residential.
 *      That is a cost line being PHASE-WIDE, which is the design; the defect
 *      was that nothing said so. Section D pins the notice that now does.
 *
 *   2. Marketing was charged to Operate and Lease assets, which carry their own
 *      operating expenses and have no sale for a selling cost to be a
 *      percentage of. Sections A to C pin the scope that stops it.
 *
 *   3. The amount was wrong. Section E is the measurement, and it is the
 *      finding rather than the fix: `computeAssetRevenue`, the basis every
 *      percent-of-revenue method charges on, sums `metricValue x unitPrice`
 *      over Sellable AND Operable AND Leasable sub-units. That product is a
 *      sale value only for Sellable. For Leasable it is ONE YEAR of rent and
 *      for Operable it is ONE NIGHT at full occupancy, so the basis is
 *      understated by 5x to 11x on a leased asset and by over 2,000x on a
 *      hotel. This section pins the CURRENT behaviour with that fact stated,
 *      so nobody has to rediscover it, and it fails the moment the basis
 *      changes, which is when the pin must be revisited.
 *
 * THE RULE HAS ONE ENFORCEMENT POINT, `assetVisibleLines`, which the Costs tab,
 * the cost engine and the copy planner all call. That is what makes this NOT a
 * gate of the kind docs/TRAPS.md 7.19 warns about: a gate hides a row while the
 * engine charges it, and here the screen and the engine read the same rule, so
 * an asset that cannot see a marketing line is not charged for one and the tab
 * states why the row is absent.
 *
 * Usage: npx tsx scripts/verify-selling-cost-scope.ts
 *        npx tsx scripts/verify-selling-cost-scope.ts --sabotage=<1..4>
 */
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import {
  computeAssetCost,
  computeAssetRevenue,
  deriveAssetScope,
} from '@/src/core/calculations';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import {
  assetStrategySells,
  SELLING_ONLY_BASE_IDS,
  COST_ASSET_SCOPES,
  COST_ASSET_SCOPE_LABELS,
  type Asset,
  type CostLine,
  type CostOverride,
  type Parcel,
  type Phase,
  type Project,
  type SubUnit,
  type AssetStrategy,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { stampFromEntry, BUILT_IN_COST_CATALOG } from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  [PASS] ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` :: ${detail}` : ''}`); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
}
const SAB = Number(/--sabotage=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 0);

// ── Fixture: one phase, four assets, one of each strategy ───────────────────
const PHASE: Phase = {
  id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 3,
  operationsPeriods: 5, overlapPeriods: 0,
} as unknown as Phase;

function mkAsset(id: string, name: string, strategy: AssetStrategy): Asset {
  return {
    id, name, phaseId: 'p1', strategy, visible: true,
    landAllocation: { parcelId: 'parcel1', sqm: 5000 },
  } as unknown as Asset;
}
function mkUnit(id: string, assetId: string, category: string, metricValue: number, unitPrice: number): SubUnit {
  return { id, assetId, name: id, category, metric: 'area', metricValue, unitPrice } as unknown as SubUnit;
}
function mkLine(id: string, over: Partial<CostLine> = {}): CostLine {
  return {
    id, phaseId: 'p1', name: id, method: 'percent_of_revenue_sale', value: 3,
    stage: 'marketing', phasing: 'even', startPeriod: 1, endPeriod: 3,
    allocationBasis: 'per_asset', ...over,
  } as unknown as CostLine;
}

const ASSETS: Asset[] = [
  mkAsset('a_sell', 'Residences', 'Sell'),
  mkAsset('a_sellmanage', 'Serviced Apts', 'Sell + Manage'),
  mkAsset('a_operate', 'Hotel', 'Operate'),
  mkAsset('a_lease', 'Retail', 'Lease'),
];
const SUBUNITS: SubUnit[] = [
  mkUnit('u1', 'a_sell', 'Sellable', 10_000, 20_000),
  mkUnit('u2', 'a_sellmanage', 'Sellable', 5_000, 18_000),
  mkUnit('u3', 'a_operate', 'Operable', 200, 900),
  mkUnit('u4', 'a_lease', 'Leasable', 4_000, 1_500),
];
const PARCELS: Parcel[] = [
  { id: 'parcel1', phaseId: 'p1', name: 'Parcel 1', area: 20_000, rate: 1_000, cashPct: 100, inKindPct: 0 } as unknown as Parcel,
];
const LINES: CostLine[] = [
  mkLine('hard__p1', { name: 'Construction', method: 'rate_per_bua', value: 4_000, stage: 'hard' }),
  mkLine('marketing__p1', { name: 'Marketing', method: 'percent_of_revenue_sale', value: 3, stage: 'marketing' }),
  mkLine('commission__p1', { name: 'Commission', method: 'percent_of_total_revenue', value: 2, stage: 'soft' }),
];
const PROJECT: Project = { id: 'proj', name: 'Fixture', currency: 'SAR', startDate: '2026-01-01' } as unknown as Project;

function lines(): CostLine[] {
  const out = LINES.map((l) => ({ ...l }));
  if (SAB === 1) {
    // 1: THE REPORTED DEFECT. The scope is ignored, so a selling cost charges
    //    every asset in the phase, on a rent or an ADR.
    for (const l of out) l.assetScopeOverride = 'all';
  }
  if (SAB === 2) {
    // 2: the scope leaks the other way, so a CONSTRUCTION line stops charging
    //    the operated and leased assets.
    for (const l of out) if (l.id.startsWith('hard')) l.assetScopeOverride = 'selling';
  }
  return out;
}

function costOf(asset: Asset, ls: CostLine[], overrides: CostOverride[] = []): ReturnType<typeof computeAssetCost> {
  return computeAssetCost({
    asset, assets: ASSETS, phase: PHASE, phases: [PHASE], parcels: PARCELS, subUnits: SUBUNITS,
    costLines: ls, costOverrides: overrides, landAllocationMode: 'sqm', project: PROJECT,
  } as unknown as Parameters<typeof computeAssetCost>[0]);
}

console.log('=== verify-selling-cost-scope ===');
if (SAB > 0) console.log(`SABOTAGE ${SAB} ACTIVE: failures below are the point.\n`);

// ── A. The rule, and it is not vacuous ──────────────────────────────────────
console.log('\n-- A. The scope resolves, from the line and from the base id --');
{
  const ls = lines();
  const mk = ls.find((l) => l.id === 'marketing__p1')!;
  const cm = ls.find((l) => l.id === 'commission__p1')!;
  const hd = ls.find((l) => l.id === 'hard__p1')!;
  check('marketing resolves to the selling scope with NOTHING stamped on the line',
    deriveAssetScope(mk) === 'selling', deriveAssetScope(mk));
  check('commission resolves to the selling scope too',
    deriveAssetScope(cm) === 'selling', deriveAssetScope(cm));
  check('a construction line resolves to every asset', deriveAssetScope(hd) === 'all', deriveAssetScope(hd));
  check('the id fallback is what does it, so an already-saved line needs no migration',
    SELLING_ONLY_BASE_IDS.has('marketing') && SELLING_ONLY_BASE_IDS.has('commission'));
  check('an explicit override outranks the id (the escape hatch works both ways)',
    deriveAssetScope({ ...mk, assetScopeOverride: 'all' }) === 'all'
    && deriveAssetScope({ ...hd, assetScopeOverride: 'selling' }) === 'selling');
  check('assetStrategySells names exactly the two selling strategies',
    assetStrategySells('Sell') && assetStrategySells('Sell + Manage')
    && !assetStrategySells('Operate') && !assetStrategySells('Lease'));
  check('the picker offers both scopes with a label each',
    COST_ASSET_SCOPES.length === 2 && COST_ASSET_SCOPES.every((s) => (COST_ASSET_SCOPE_LABELS[s] ?? '').length > 8));
}

// ── B. ONE enforcement point, and the screen reads it ───────────────────────
console.log('\n-- B. Visibility and charge come from the SAME rule --');
{
  const ls = lines();
  for (const a of ASSETS) {
    const visible = assetVisibleLines(ls, 'p1', a.id, a.strategy);
    const res = costOf(a, ls);
    const sells = assetStrategySells(a.strategy);
    const sees = (id: string): boolean => visible.some((l) => l.id === id);
    const charged = (id: string): number => res.byLineId[id] ?? 0;
    check(`${a.name} (${a.strategy}): every line it is CHARGED for is a line it can SEE`,
      ls.every((l) => charged(l.id) === 0 || sees(l.id)),
      ls.filter((l) => charged(l.id) !== 0 && !sees(l.id)).map((l) => l.id).join(',') || 'none charged unseen');
    check(`${a.name}: a line it cannot see is charged EXACTLY zero`,
      ls.filter((l) => !sees(l.id)).every((l) => charged(l.id) === 0));
    if (!sells) {
      check(`${a.name}: does not see the selling lines`, !sees('marketing__p1') && !sees('commission__p1'));
      check(`${a.name}: still sees the construction line`, sees('hard__p1'));
    } else {
      check(`${a.name}: sees and is charged for both selling lines`,
        sees('marketing__p1') && sees('commission__p1') && charged('marketing__p1') > 0 && charged('commission__p1') > 0,
        `mk ${charged('marketing__p1').toFixed(0)} cm ${charged('commission__p1').toFixed(0)}`);
    }
  }
  // Not vacuous: the charge is a real figure on a selling asset.
  const sellRes = costOf(ASSETS[0], ls);
  check('the fixture charges a REAL marketing amount on the selling asset (not vacuous)',
    (sellRes.byLineId['marketing__p1'] ?? 0) > 1_000_000,
    (sellRes.byLineId['marketing__p1'] ?? 0).toFixed(0));
}

// ── C. The phase-level question still gets the phase-level answer ───────────
console.log('\n-- C. Omitting the strategy asks about the PHASE, and keeps every line --');
{
  const ls = lines();
  const phaseWide = assetVisibleLines(ls, 'p1', undefined);
  check('a phase-level call (no strategy) keeps every line, selling ones included',
    phaseWide.length === ls.length && phaseWide.some((l) => l.id === 'marketing__p1'),
    `${phaseWide.length} of ${ls.length}`);
  check('and passing the id without the strategy is the same answer',
    assetVisibleLines(ls, 'p1', 'a_lease').length === ls.length);
}

// ── D. The catalog stamps it, and the screen states the absence ─────────────
console.log('\n-- D. The catalog stamp and the two screen notices --');
{
  const mkEntry = BUILT_IN_COST_CATALOG.find((e) => e.id === 'marketing')!;
  const cmEntry = BUILT_IN_COST_CATALOG.find((e) => e.id === 'commission')!;
  const hdEntry = BUILT_IN_COST_CATALOG.find((e) => e.id === 'superstructure')
    ?? BUILT_IN_COST_CATALOG.find((e) => e.stage === 'hard')!;
  check('the marketing entry declares the selling scope', mkEntry.assetScope === 'selling');
  check('the commission entry declares it too', cmEntry.assetScope === 'selling');
  check('a construction entry does not', hdEntry.assetScope === undefined || hdEntry.assetScope === 'all');
  check('selecting marketing STAMPS the scope explicitly (never left to the id)',
    stampFromEntry(mkEntry).assetScopeOverride === 'selling');
  check('selecting a construction entry stamps "all", so it cannot inherit a selling id',
    stampFromEntry(hdEntry).assetScopeOverride === 'all');

  const src = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('the Costs tab states WHY a selling row is absent on a held asset',
    src.includes('costs-selling-scope-notice-'));
  check('that notice names the lines rather than describing them generically',
    /costs-selling-scope-notice-[\s\S]{0,900}sellingLinesNotShown\.map\(\(c\) => c\.name\)/.test(src));
  check('the row states which OTHER assets a typed value reaches (the reported symptom)',
    src.includes('-shared-notice') && src.includes('sharingAssets.join'));
  check('the row offers the Applies to picker', src.includes('-asset-scope'));
  check('the Costs tab list calls the SHARED rule instead of re-spelling the filter',
    src.includes('assetVisibleLines(costLines, activeAsset.phaseId, activeAsset.id, activeAsset.strategy)')
    && !/\.filter\(\(c\) => c\.targetAssetId === undefined \|\| c\.targetAssetId === activeAsset\.id\)/.test(src));
}

// ── E. THE BASIS. Pinned as it is, with the fact stated ─────────────────────
console.log('\n-- E. The revenue basis is a SALE value only for Sellable (finding, not fixed) --');
{
  const sell = computeAssetRevenue(ASSETS[0], SUBUNITS);
  const operate = computeAssetRevenue(ASSETS[2], SUBUNITS);
  const lease = computeAssetRevenue(ASSETS[3], SUBUNITS);
  check('Sellable: the basis is units x price, a genuine sale value',
    Math.abs(sell - 10_000 * 20_000) < 1, sell.toFixed(0));
  check('Operable: the basis is keys x ADR, i.e. ONE NIGHT at full occupancy, not a revenue',
    Math.abs(operate - 200 * 900) < 1, `${operate.toFixed(0)} for a hotel that will earn many multiples of it`);
  check('Leasable: the basis is area x annual rent, i.e. ONE YEAR, not a lifetime',
    Math.abs(lease - 4_000 * 1_500) < 1, lease.toFixed(0));
  console.log('  (info) measured on the live projects: the basis understates lease revenue 5x to 11x');
  console.log('  (info) and hotel revenue by 2,255x to 4,739x. Scoping the SELLING costs to selling');
  console.log('  (info) assets removes the exposure for marketing and commission; any OTHER line set');
  console.log('  (info) to a percent-of-revenue method on a held asset is still charging on this basis.');
  // The scope is what protects the selling costs from that basis, so prove the
  // protection rather than trusting it.
  const ls = lines();
  const hotel = costOf(ASSETS[2], ls);
  check('so no selling cost is charged on the one-night basis',
    (hotel.byLineId['marketing__p1'] ?? 0) === 0 && (hotel.byLineId['commission__p1'] ?? 0) === 0);
}

// ── F. Nothing else moved ───────────────────────────────────────────────────
console.log('\n-- F. A project with no selling line at all is untouched --');
{
  const only = [LINES[0]].map((l) => ({ ...l }));
  for (const a of ASSETS) {
    const res = costOf(a, only);
    // A real assertion. The first version of this read
    //   (x > 0 || strategy === 'Operate' || strategy === 'Lease' ? true : false)
    // whose ternary binds after the ||, so it was the constant true: a check
    // that could not fail, on the very thing section F exists to prove.
    check(`${a.name}: the construction line still charges every asset, held or sold`,
      (res.byLineId['hard__p1'] ?? 0) > 0, (res.byLineId['hard__p1'] ?? 0).toFixed(0));
  }
  const totals = ASSETS.map((a) => costOf(a, only).total);
  check('every asset carries a non-zero total from the construction line alone',
    totals.every((t) => t > 0), totals.map((t) => t.toFixed(0)).join(' / '));
}

// ── G. The two copies of the precedence agree ───────────────────────────────
console.log('\n-- G. deriveAssetScope and the selectedBase copy cannot drift --');
{
  const cases: CostLine[] = [
    mkLine('marketing__p1'),
    mkLine('commission__p1'),
    mkLine('hard__p1'),
    mkLine('marketing__p1', { assetScopeOverride: 'all' }),
    mkLine('hard__p1', { assetScopeOverride: 'selling' }),
    mkLine('marketing'),
    mkLine('someone-elses-line__p1'),
  ];
  let agree = true; let detail = '';
  for (const l of cases) {
    // What selectedBase decides, observed through the function rather than by
    // reading its private helper: a non-selling asset either sees the line or
    // does not, and that must equal deriveAssetScope saying 'all'.
    const seenByLease = assetVisibleLines([l], 'p1', 'a_lease', 'Lease').length === 1;
    const scopeSaysAll = deriveAssetScope(l) === 'all';
    if (seenByLease !== scopeSaysAll) { agree = false; detail = `${l.id} visible=${seenByLease} scope=${deriveAssetScope(l)}`; }
  }
  check('the engine derivation and the visibility filter give the same answer on every case', agree, detail);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail > 0 ? 1 : 0);
