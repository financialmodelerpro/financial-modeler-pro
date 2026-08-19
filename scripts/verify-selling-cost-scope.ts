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
 *   3. The amount was wrong, and it is now FIXED (2026-08-19). The basis every
 *      percent-of-revenue method charged on was `computeAssetRevenue`, the sum
 *      of `metricValue x unitPrice` over Sellable AND Operable AND Leasable.
 *      That product is a sale value only for Sellable: for Leasable it is ONE
 *      YEAR of rent and for Operable it is ONE NIGHT at full occupancy, so the
 *      basis understated a leased asset 5x to 11x and a hotel 2,255x to 4,739x,
 *      and it ignored sale price indexation so even a Sell asset was low. The
 *      base now comes from the REVENUE MODULE and the RATE stays an input on the
 *      Capex tab, which is the split the user asked for. Section E pins it.
 *      MEASURED on the live projects: FMP - MARINA GATE total capex
 *      437,844,950.00 -> 438,943,005.32 (+1,098,055.32, all of it the marketing
 *      line on Marina Residences moving from a 571.900m product to a 626.803m
 *      sale value); FMP RE HUB +1,625.87 on 4.9bn, rounding scale.
 *
 * THE RULE HAS ONE ENFORCEMENT POINT, `assetVisibleLines`, which the Costs tab,
 * the cost engine and the copy planner all call. That is what makes this NOT a
 * gate of the kind docs/TRAPS.md 7.19 warns about: a gate hides a row while the
 * engine charges it, and here the screen and the engine read the same rule, so
 * an asset that cannot see a marketing line is not charged for one and the tab
 * states why the row is absent.
 *
 * Usage: npx tsx scripts/verify-selling-cost-scope.ts
 *        npx tsx scripts/verify-selling-cost-scope.ts --sabotage=<1|2|4>
 *
 * Sabotages: 1 the scope ignored; 2 the scope leaking onto construction lines;
 * 4 the revenue bases withheld, i.e. the old sub-unit product basis. There is no
 * 3: it renamed the fixture's ids rather than breaking the code, the fixed code
 * handled it, and it therefore proved nothing. That case is now permanent section
 * H, which goes red if the identity resolution regresses.
 */
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import {
  computeAssetCost,
  computeAssetRevenue,
  costLineCaption,
  deriveAssetScope,
  type AssetAreaMetrics,
} from '@/src/core/calculations';
import {
  saleRevenueTotalForAsset,
  totalRevenueTotalForAsset,
  type CollectionsSource,
} from '@/src/core/calculations/capexPhasing';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import {
  assetStrategySells,
  deriveLineBaseId,
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
import { stampFromEntry, resolveCatalogId, BUILT_IN_COST_CATALOG } from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';

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

function lines2(): CostLine[] {
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
  // SAB 3 was a fixture variant, not a sabotage: it renamed the ids into the
  // catalog-minted shape, and the FIXED code handles that shape, so it proved
  // nothing. It is now permanent section H, which is the real guard: revert
  // `deriveAssetScope` to reading the base id alone and section H goes red.
  // SAB 4 is applied in `costOf`, which withholds the linked revenue bases.
  return out;
}

/** The fixture with the two selling lines in the shape the CATALOG PICKER mints:
 *  a `custom-<timestamp>` id with the identity carried in `catalogId`. This is
 *  the exact shape of the live project's row that the first version of the scope
 *  rule missed. */
function mintedLines(): CostLine[] {
  return lines2().map((l) => {
    const base = deriveLineBaseId(l.id);
    if (base !== 'marketing' && base !== 'commission') return l;
    return { ...l, catalogId: base, id: `custom-1700000000000-${base}__p1` };
  });
}

/**
 * The revenue module's answers for this fixture, deliberately DIFFERENT from the
 * sub-unit products above, so a check that passed on either could not tell them
 * apart. A Sell asset's sale value carries indexation (200m of list becomes
 * 230m); the held assets have NO sale value and real whole-hold revenue.
 */
const SALE_REVENUE: Record<string, number> = {
  a_sell: 230_000_000,
  a_sellmanage: 96_000_000,
  a_operate: 0,
  a_lease: 0,
};
const OPERATING_REVENUE: Record<string, number> = {
  a_sell: 0,
  a_sellmanage: 0,
  a_operate: 480_000_000,
  a_lease: 66_000_000,
};
const TOTAL_REVENUE: Record<string, number> = Object.fromEntries(
  Object.keys(SALE_REVENUE).map((k) => [k, SALE_REVENUE[k] + OPERATING_REVENUE[k]]),
);
/** Shaped like the real snapshot, split across the three maps the helpers read. */
const REV_SOURCE: CollectionsSource = {
  bySellAsset: new Map(Object.keys(SALE_REVENUE).map((id) => [id, {
    presalesRevenuePerPeriod: [SALE_REVENUE[id]],
    postSalesRevenuePerPeriod: [0],
    cashCollectedPerPeriod: [SALE_REVENUE[id]],
  }])),
  byHospitalityAsset: new Map([['a_operate', { totalRevenuePerPeriod: [OPERATING_REVENUE['a_operate']] }]]),
  byLeaseAsset: new Map([['a_lease', { totalRevenuePerPeriod: [OPERATING_REVENUE['a_lease']] }]]),
};
const REV_BASES: Record<string, { saleRevenueTotal?: number; totalRevenueTotal?: number }> =
  Object.fromEntries(Object.keys(SALE_REVENUE).map((id) => [id, {
    saleRevenueTotal: saleRevenueTotalForAsset(REV_SOURCE, id),
    totalRevenueTotal: totalRevenueTotalForAsset(REV_SOURCE, id),
  }]));
/** Minimal metrics for a direct `costLineCaption` call. */
const METRICS_STUB = {
  landSqm: 0, ndaSqm: 0, roadsSqm: 0, gfa: 0, bua: 0, nsa: 0, unitCount: 0, parkingBays: 0,
  supportArea: 0, parkingArea: 0, landValue: 0, cashLandValue: 0, inKindLandValue: 0,
  totalRevenue: 200_000_000,
} as unknown as AssetAreaMetrics;

/**
 * `bases` OMITTED reproduces the pre-2026-08-19 engine exactly: with no revenue
 * snapshot the methods fall back to `metrics.totalRevenue`, the sub-unit product.
 * That is what makes the A/B in section E a real before-and-after rather than
 * two spellings of the same call.
 */
function costOf(
  asset: Asset,
  ls: CostLine[],
  overrides: CostOverride[] = [],
  bases?: { saleRevenueTotal?: number; totalRevenueTotal?: number },
): ReturnType<typeof computeAssetCost> {
  return computeAssetCost({
    asset, assets: ASSETS, phase: PHASE, phases: [PHASE], parcels: PARCELS, subUnits: SUBUNITS,
    costLines: ls, costOverrides: overrides, landAllocationMode: 'sqm', project: PROJECT,
    ...(SAB === 4 ? {} : (bases ?? {})),
  } as unknown as Parameters<typeof computeAssetCost>[0]);
}

/** A fixture line, by CATALOG IDENTITY rather than by id. */
function byIdentity(ls: CostLine[], want: string): CostLine {
  const hit = ls.find((l) => resolveCatalogId(l) === want);
  if (!hit) throw new Error(`fixture has no ${want} line`);
  return hit;
}
/** The fixture's ids, resolved once by identity, so every check below survives a
 *  sabotage that renames them (and so does a real project's minted id). */
const MK_ID = byIdentity(lines2(), 'marketing').id;
const CM_ID = byIdentity(lines2(), 'commission').id;
const HD_ID = lines2().find((l) => deriveLineBaseId(l.id) === 'hard')!.id;

console.log('=== verify-selling-cost-scope ===');
if (SAB > 0) console.log(`SABOTAGE ${SAB} ACTIVE: failures below are the point.\n`);

// ── A. The rule, and it is not vacuous ──────────────────────────────────────
console.log('\n-- A. The scope resolves, from the line and from the base id --');
{
  const ls = lines2();
  // FOUND BY IDENTITY, NOT BY LITERAL ID. A line minted from the catalog picker
  // has an id like `custom-1787123860417__phase_1` and carries its identity in
  // `catalogId`, which is the shape sabotage 3 reproduces and the shape the live
  // project actually has. Looking these up by a hardcoded id made this section
  // CRASH under that sabotage rather than fail, a harness bug that would have
  // hidden the very thing the sabotage exists to prove.
  const mk = byIdentity(ls, 'marketing');
  const cm = byIdentity(ls, 'commission');
  const hd = ls.find((l) => deriveLineBaseId(l.id) === 'hard')!;
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
  const ls = lines2();
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
      check(`${a.name}: does not see the selling lines`, !sees(MK_ID) && !sees(CM_ID));
      check(`${a.name}: still sees the construction line`, sees(HD_ID));
    } else {
      check(`${a.name}: sees and is charged for both selling lines`,
        sees(MK_ID) && sees(CM_ID) && charged(MK_ID) > 0 && charged(CM_ID) > 0,
        `mk ${charged(MK_ID).toFixed(0)} cm ${charged(CM_ID).toFixed(0)}`);
    }
  }
  // Not vacuous: the charge is a real figure on a selling asset.
  const sellRes = costOf(ASSETS[0], ls);
  check('the fixture charges a REAL marketing amount on the selling asset (not vacuous)',
    (sellRes.byLineId[MK_ID] ?? 0) > 1_000_000,
    (sellRes.byLineId[MK_ID] ?? 0).toFixed(0));
}

// ── C. The phase-level question still gets the phase-level answer ───────────
console.log('\n-- C. Omitting the strategy asks about the PHASE, and keeps every line --');
{
  const ls = lines2();
  const phaseWide = assetVisibleLines(ls, 'p1', undefined);
  check('a phase-level call (no strategy) keeps every line, selling ones included',
    phaseWide.length === ls.length && phaseWide.some((l) => resolveCatalogId(l) === 'marketing'),
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

// ── E. THE BASIS, NOW LINKED TO THE REVENUE MODULE ──────────────────────────
//
// This section USED TO PIN THE DEFECT: it asserted that the basis was one
// night's ADR on a hotel and one year's rent on a leased asset, with the
// measured multiples in a comment, because correcting it moved numbers and
// needed a decision. The decision was made on 2026-08-19 and the basis is now
// supplied by the revenue module, so the section pins the FIX. The old
// assertions are kept, inverted, as the sabotage target: sabotage 4 withholds
// the linked bases and this section must go red.
console.log('\n-- E. The percent-of-revenue bases come from the REVENUE MODULE --');
{
  const ls = lines2();
  // The three products the OLD basis conflated, still measurable so the size of
  // the defect stays on the record rather than only in a commit message.
  const oldSell = computeAssetRevenue(ASSETS[0], SUBUNITS);
  const oldOperate = computeAssetRevenue(ASSETS[2], SUBUNITS);
  const oldLease = computeAssetRevenue(ASSETS[3], SUBUNITS);
  check('the OLD basis was units x price for Sellable (a genuine sale value)',
    Math.abs(oldSell - 10_000 * 20_000) < 1, oldSell.toFixed(0));
  check('the OLD basis was keys x ADR for Operable, i.e. ONE NIGHT at full occupancy',
    Math.abs(oldOperate - 200 * 900) < 1, oldOperate.toFixed(0));
  check('the OLD basis was area x annual rent for Leasable, i.e. ONE YEAR',
    Math.abs(oldLease - 4_000 * 1_500) < 1, oldLease.toFixed(0));

  // A SALE BASIS ON A HELD ASSET IS ZERO. That is the substantive change: an
  // asset that is operated or leased has no sale, so a percentage of its sale
  // value is zero, whatever its ADR or its rent happens to be. Proven by
  // charging the line to a held asset with the scope forced OPEN, so this is
  // the BASIS doing the work and not the scope.
  const openScope = ls.map((l) => ({ ...l, assetScopeOverride: 'all' as const }));
  for (const a of [ASSETS[2], ASSETS[3]]) {
    const withBases = costOf(a, openScope, [], REV_BASES[a.id]);
    check(`${a.name} (${a.strategy}): a sale-basis line charges ZERO even with the scope forced open`,
      (withBases.byLineId[MK_ID] ?? 0) === 0,
      (withBases.byLineId[MK_ID] ?? 0).toFixed(2));
    const withoutBases = costOf(a, openScope);
    check(`${a.name}: and WITHOUT the linked basis it charged a real amount (so the fix is not vacuous)`,
      (withoutBases.byLineId[MK_ID] ?? 0) > 0,
      (withoutBases.byLineId[MK_ID] ?? 0).toFixed(2));
  }

  // A SELLING ASSET CHARGES ON THE REVENUE MODULE'S SALE VALUE, not on the
  // sub-unit product. The fixture's sale value is deliberately DIFFERENT from
  // the product, so a check that passed on either could not tell them apart.
  const sellRes = costOf(ASSETS[0], ls, [], REV_BASES['a_sell']);
  const expectSale = SALE_REVENUE['a_sell'] * 0.03;
  check('a Sell asset charges 3% of the REVENUE MODULE sale value',
    Math.abs((sellRes.byLineId[MK_ID] ?? 0) - expectSale) < 1,
    `${(sellRes.byLineId[MK_ID] ?? 0).toFixed(0)} vs ${expectSale.toFixed(0)}`);
  const sellOld = costOf(ASSETS[0], ls);
  check('and that is NOT what the sub-unit product would have given (the two differ)',
    Math.abs((sellOld.byLineId[MK_ID] ?? 0) - expectSale) > 1,
    `old ${(sellOld.byLineId[MK_ID] ?? 0).toFixed(0)}`);

  // percent_of_total_revenue reads the LIFETIME total, so a held asset is no
  // longer charged on a single period.
  const hotelTotal = costOf(ASSETS[2], openScope, [], REV_BASES['a_operate']);
  const expectComm = TOTAL_REVENUE['a_operate'] * 0.02;
  check('percent_of_total_revenue charges on the whole-hold revenue, not one period',
    Math.abs((hotelTotal.byLineId[CM_ID] ?? 0) - expectComm) < 1,
    `${(hotelTotal.byLineId[CM_ID] ?? 0).toFixed(0)} vs ${expectComm.toFixed(0)}`);
  check('and the whole-hold figure is materially larger than the one-night product',
    TOTAL_REVENUE['a_operate'] > oldOperate * 100,
    `${TOTAL_REVENUE['a_operate'].toFixed(0)} vs ${oldOperate.toFixed(0)}`);

  // ZERO IS NOT ABSENT. The helper must return a number when a snapshot exists,
  // because undefined falls back to the broken basis; that distinction IS the
  // fix for the held assets above.
  check('saleRevenueTotalForAsset returns 0, not undefined, for a held asset with a snapshot',
    saleRevenueTotalForAsset(REV_SOURCE, 'a_lease') === 0);
  check('and returns undefined only when NO revenue snapshot is supplied',
    saleRevenueTotalForAsset(undefined, 'a_lease') === undefined);
  check('totalRevenueTotalForAsset returns undefined when the operating maps are absent',
    totalRevenueTotalForAsset({ bySellAsset: REV_SOURCE.bySellAsset }, 'a_lease') === undefined);

  // The caption must state the figure the engine used, or it is a second source.
  const cap = costLineCaption({
    line: byIdentity(ls, 'marketing'),
    asset: ASSETS[0], metrics: METRICS_STUB, parkingBays: 0, resolvedTotal: 0,
    saleRevenueTotal: SALE_REVENUE['a_sell'],
  });
  check('the caption names the sale value (GDV) and says it comes from Revenue',
    /sale value \(GDV\), from Revenue/.test(cap), cap);
  const capHeld = costLineCaption({
    line: byIdentity(ls, 'marketing'),
    asset: ASSETS[3], metrics: METRICS_STUB, parkingBays: 0, resolvedTotal: 0,
    saleRevenueTotal: 0,
  });
  check('and on a held asset it says there is no sale value rather than "nothing set up"',
    /no sale value: this asset is held, not sold/.test(capHeld), capHeld);
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

// ── H. A CATALOG-MINTED LINE, which is what a real project has ──────────────
//
// THE DEFECT THIS PINS SHIPPED ON 2026-08-19 AND WAS FOUND BY THE USER, NOT BY A
// CHECK. The first version of `deriveAssetScope` resolved identity from
// `deriveLineBaseId(line.id)` alone, a SECOND identity rule that disagreed with
// the shared `resolveCatalogId` on exactly this shape: a line added from the
// picker has a minted id (`custom-1787123860417__phase_1`) and carries its
// identity in `catalogId`. Its base id matches no selling id, so the scope
// resolved to 'all' and Marketing kept charging a leased asset. Measured live on
// FMP - MARINA GATE: 119,700 on Podium Retail, while the seeded
// `commission__phase_2` on the same project was correctly scoped.
//
// Every check in this section passes ONLY IF identity is resolved the shared way.
console.log('\n-- H. A line minted by the catalog picker scopes the same as a seeded one --');
{
  const minted = mintedLines();
  const mk = byIdentity(minted, 'marketing');
  const cm = byIdentity(minted, 'commission');
  check('the minted line really is the awkward shape (a custom id, identity in catalogId)',
    mk.id.startsWith('custom-') && mk.catalogId === 'marketing'
    && !SELLING_ONLY_BASE_IDS.has(deriveLineBaseId(mk.id)),
    `id=${mk.id} baseId=${deriveLineBaseId(mk.id)} catalogId=${String(mk.catalogId)}`);
  check('and it STILL resolves to the selling scope', deriveAssetScope(mk) === 'selling', deriveAssetScope(mk));
  check('so does a minted commission line', deriveAssetScope(cm) === 'selling', deriveAssetScope(cm));
  for (const a of [ASSETS[2], ASSETS[3]]) {
    const visible = assetVisibleLines(minted, 'p1', a.id, a.strategy);
    const res = costOf(a, minted, [], REV_BASES[a.id]);
    check(`${a.name} (${a.strategy}): does not see the minted selling lines`,
      !visible.some((l) => l.id === mk.id) && !visible.some((l) => l.id === cm.id));
    check(`${a.name}: and is charged zero for them`,
      (res.byLineId[mk.id] ?? 0) === 0 && (res.byLineId[cm.id] ?? 0) === 0,
      `${(res.byLineId[mk.id] ?? 0).toFixed(2)} / ${(res.byLineId[cm.id] ?? 0).toFixed(2)}`);
  }
  const sellRes = costOf(ASSETS[0], minted, [], REV_BASES['a_sell']);
  check('while the selling asset is still charged in full for the minted line',
    (sellRes.byLineId[mk.id] ?? 0) > 1_000_000, (sellRes.byLineId[mk.id] ?? 0).toFixed(0));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail > 0 ? 1 : 0);
