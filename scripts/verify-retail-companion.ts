/**
 * verify-retail-companion.ts (2026-09-09, consolidation step 4)
 *
 * GROUND-FLOOR RETAIL IS AN ASSET, COSTED AT ZERO.
 *
 * What it proves:
 *   A. THE POOL IS PER LINE, not per plot. Four plots with ground-floor retail
 *      give ONE retail line, and a line with no retail gives none at all.
 *   B. THE RECONCILE IS SELF-HEALING: it adds, drops and refreshes, returns the
 *      SAME array when nothing moved (which is what stops a derive-on-render
 *      loop marking every project dirty), and keeps what the user owns.
 *   C. THE ASSET IS A LEASE COMPANION with no land: the engine's own
 *      short-circuits are what make it free, so they are asserted here rather
 *      than trusted.
 *   D. THE OPERATE COMPANION MECHANISM IS REUSED, NOT COPIED, and the two
 *      Operate sync passes cannot touch a retail companion.
 *   E. "COMPANION" NO LONGER MEANS "OPERATE" in any classifier. Seven
 *      predicates read `strategy === 'Operate' || isCompanion === true`, which
 *      would have filed a Lease retail companion into hospitality revenue and
 *      hospitality opex the moment it existed.
 *   F. LIVE: the engine is BYTE-IDENTICAL with every retail companion the six
 *      real projects would build, injected. Hashing the projects before and
 *      after the code change proves only that the refactor is inert; it says
 *      nothing about an asset that is not in the stored snapshots. So the
 *      companions are built from each project's own chain and injected.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-retail-companion.ts
 *
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import {
  buildRetailCompanionSpecs,
  carveRetailLand,
  isRetailCompanion,
  reconcileRetailCompanions,
  reconcileRetailSubUnits,
  retailCompanionId,
  type RetailCompanionSpec,
} from '../src/core/calculations/retailCompanion';
import { computeLandChain } from '../src/core/calculations/landChain';
import { computeAssetLandBreakdown, computeAssetUnitCount, computeAssetLandSqm } from '../src/core/calculations';
import { groupAssetsForConsolidation } from '../src/core/calculations/consolidation';
import { makeRetailCompanionAsset, makeRetailCompanionSubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { Asset, SubUnit, SubUnitCategory, SubUnitMetric } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  normaliseAssetTypeId, resolveAssetTypeValues, resolveAvgUnitSize, resolveRetailSlotArea,
} from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';

// THE TWO LABEL RULES, restated so G2 runs them rather than reading them. They
// live beside each other in Module1Assets and are asserted in step with it by
// verify-land-chain U29d2.
const rateUnitLabel = (c: SubUnitCategory, m: SubUnitMetric): string => {
  if (c === 'Support') return '';
  if (c === 'Sellable') return m === 'units' ? 'per unit' : 'per sqm';
  if (c === 'Operable') return m === 'units' ? 'per room/night' : 'per sqm/year';
  if (c === 'Leasable') return m === 'units' ? 'per unit/year' : 'per sqm/year';
  return '';
};
const rateTimeBasisOf = (c: SubUnitCategory, m: SubUnitMetric): string | undefined => {
  if (c === 'Support') return undefined;
  if (c === 'Sellable') return 'capital';
  if (c === 'Operable') return m === 'units' ? 'night' : 'year';
  if (c === 'Leasable') return 'year';
  return undefined;
};

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const host = (id: string, gfa?: number, parkArea?: number, slots?: number) =>
  ({ assetId: id, retailGfaSqm: gfa, retailParkingAreaSqm: parkArea, retailParkingSlots: slots });
const line = (key: string, hosts: ReturnType<typeof host>[]) =>
  ({ key, phaseId: key.split('|')[0], typeLabel: 'Branded Villas', hosts });

function offlineChecks(): void {
  section('A. One pooled companion per LINE, never per plot');
  const four = buildRetailCompanionSpecs([line('phase_1|branded-villas', [
    host('a', 1320, 400, 16), host('b', 600, 200, 8), host('c', 500), host('d', 100, 50, 2),
  ])]);
  check('A1 four plots with ground-floor retail give ONE retail line, not four',
    four.length === 1 && four[0].hostAssetIds.length === 4, `${four.length} companions`);
  check('A2 the areas POOL, which is the whole reason the chain runs per plot first',
    four[0].retailGfaSqm === 2520 && four[0].retailParkingAreaSqm === 650 && four[0].retailParkingSlots === 26,
    `${four[0].retailGfaSqm} / ${four[0].retailParkingAreaSqm} / ${four[0].retailParkingSlots}`);
  check('A3 a line with NO retail gets no companion at all',
    buildRetailCompanionSpecs([line('phase_1|x', [host('a'), host('b', 0)])]).length === 0);
  // A PLOT THAT BUILDS NO RETAIL CONTRIBUTES NOTHING, including no parking: a
  // stray parking figure on a plot with no shops would pool into an asset that
  // does not hold that plot's retail.
  const partial = buildRetailCompanionSpecs([line('phase_1|y', [
    host('a', 1000, 300, 12), host('b', undefined, 999, 99),
  ])]);
  check('A4 a plot with no retail GFA contributes no retail PARKING either',
    partial[0].hostAssetIds.length === 1 && partial[0].retailParkingAreaSqm === 300,
    `${partial[0].retailParkingAreaSqm}`);
  // Retail with no parking figure is normal: the area-per-slot input is its own
  // field and is blank on both live projects today.
  check('A5 retail with NO parking figure is still a companion, with zero parking',
    buildRetailCompanionSpecs([line('phase_1|z', [host('a', 1320)])])[0].retailParkingAreaSqm === 0);
  check('A6 two different lines give two different companions, with different ids',
    buildRetailCompanionSpecs([
      line('phase_1|villas', [host('a', 100)]), line('phase_2|villas', [host('b', 100)]),
    ]).length === 2
    && retailCompanionId('phase_1|villas') !== retailCompanionId('phase_2|villas'));
  check('A7 the id is DERIVED from the line, so re-deriving finds the same asset',
    retailCompanionId('phase_1|branded-villas') === retailCompanionId('phase_1|branded-villas')
    && /^retail_[A-Za-z0-9_-]+$/.test(retailCompanionId('phase_1|branded-villas')),
    retailCompanionId('phase_1|branded-villas'));

  section('B. The reconcile is self-healing and quiet when nothing moved');
  const mk = (spec: RetailCompanionSpec, existing?: Asset): Asset => makeRetailCompanionAsset(spec, existing);
  const eq = (a: Asset, b: Asset): boolean => JSON.stringify(a) === JSON.stringify(b);
  const hostAsset = { id: 'a', phaseId: 'phase_1', name: 'Marina Residences', type: 'Branded Villas', strategy: 'Sell' } as unknown as Asset;
  const spec = buildRetailCompanionSpecs([line('phase_1|branded-villas', [host('a', 1320, 400, 16)])])[0];
  const added = reconcileRetailCompanions([hostAsset], [spec], mk, eq);
  check('B1 a missing companion is ADDED, and the host is untouched',
    added.changed && added.added.length === 1 && added.assets.length === 2
    && added.assets[0] === hostAsset);
  const again = reconcileRetailCompanions(added.assets, [spec], mk, eq);
  check('B2 running it twice changes NOTHING and returns the SAME array',
    !again.changed && again.assets === added.assets,
    'a new array every render would mark every project dirty just for being opened');
  const moved = buildRetailCompanionSpecs([line('phase_1|branded-villas', [host('a', 1500, 400, 16)])])[0];
  const refreshed = reconcileRetailCompanions(added.assets, [moved], mk, eq);
  check('B3 a companion whose line moved is REFRESHED, not duplicated',
    refreshed.changed && refreshed.updated.length === 1 && refreshed.assets.length === 2
    && (refreshed.assets.find((a) => isRetailCompanion(a)) as Asset).buaSqm === 1500);
  const gone = reconcileRetailCompanions(added.assets, [], mk, eq);
  check('B4 a line that stops building retail loses its companion',
    gone.changed && gone.removed.length === 1 && gone.assets.length === 1
    && !gone.assets.some((a) => isRetailCompanion(a)));
  // WHAT THE USER OWNS SURVIVES A RE-DERIVE. Everything else is the line's and
  // is overwritten, which is what makes this a derivation rather than a seed.
  const renamed = { ...(added.assets.find((a) => isRetailCompanion(a)) as Asset), name: 'Podium Shops', visible: false };
  const kept = reconcileRetailCompanions([hostAsset, renamed], [moved], mk, eq);
  const keptCompanion = kept.assets.find((a) => isRetailCompanion(a)) as Asset;
  check('B5 a renamed or hidden companion keeps its name and its visibility',
    keptCompanion.name === 'Podium Shops' && keptCompanion.visible === false
    && keptCompanion.buaSqm === 1500,
    `${keptCompanion.name} / ${String(keptCompanion.visible)} / ${keptCompanion.buaSqm}`);
  check('B6 a NON-retail companion is never touched by this reconcile',
    reconcileRetailCompanions(
      [{ id: 'c', isCompanion: true, companionType: 'operate' } as unknown as Asset], [], mk, eq,
    ).assets.length === 1);

  // ── G. THE STRIP CAN BE PRICED ─────────────────────────────────────────
  //
  // WHY DERIVED AND NOT USER-ADDED: its area is the pooled retail GFA, a figure
  // the model already knows, so asking a user to retype it would put one fact
  // in two places. The platform's existing answer to "a companion needs
  // sub-units" is already a derivation. And without a row the asset cannot earn
  // at all, so it would sit there as a half-built thing with nothing saying so.
  section('G. The companion carries one derived sub-unit, so its rent can be set');
  const su = (id: string, assetId: string, over: Record<string, unknown> = {}) =>
    ({ id, assetId, name: '', category: 'Leasable', metric: 'area', metricValue: 0, unitPrice: 0, ...over } as unknown as SubUnit);
  const buildSub = (companionId: string, gfa: number, existing?: SubUnit): SubUnit =>
    makeRetailCompanionSubUnit(companionId, gfa, existing);
  const eqSub = (a: SubUnit, b: SubUnit): boolean => JSON.stringify(a) === JSON.stringify(b);
  const seeded = reconcileRetailSubUnits([], [spec], buildSub, eqSub);
  const row = seeded.subUnits[0];
  check('G1 a companion with no rows gets ONE derived row, at the pooled retail GFA',
    seeded.changed && seeded.subUnits.length === 1
    && row.assetId === spec.id && row.metricValue === 1320,
    `${seeded.subUnits.length} rows`);
  check('G2 it is Leasable on an AREA metric, which is what makes the rate per sqm per year',
    row.category === 'Leasable' && row.metric === 'area'
    // The basis falls out of the EXISTING rule rather than a new one.
    && rateUnitLabel(row.category, row.metric) === 'per sqm/year'
    && rateTimeBasisOf(row.category, row.metric) === 'year',
    `${rateUnitLabel(row.category, row.metric)}`);
  check('G3 the rate starts at ZERO, which is what keeps the engine byte-identical',
    row.unitPrice === 0);
  check('G4 running it twice changes nothing and returns the SAME array',
    reconcileRetailSubUnits(seeded.subUnits, [spec], buildSub, eqSub).subUnits === seeded.subUnits);
  const moved2 = reconcileRetailSubUnits(seeded.subUnits, [{ ...spec, retailGfaSqm: 2000 }], buildSub, eqSub);
  check('G5 the AREA follows the line, because only the area is the line\'s to state',
    moved2.changed && moved2.subUnits[0].metricValue === 2000);
  // EVERY FIELD THE USER TOUCHED, not only the two this factory names. The
  // first cut checked the rate and the name, and both are carried by their own
  // `existing?.x ?? default`, so a sabotage removing the spread that carries
  // EVERYTHING ELSE passed: a rent escalation the user had typed would have
  // been silently dropped on the next re-derive. The check now uses a field
  // only the spread preserves.
  const priced = [{ ...row, unitPrice: 1400, name: 'Podium Shops', priceEscalationPct: 3 }];
  const kept2 = reconcileRetailSubUnits(priced, [{ ...spec, retailGfaSqm: 2000 }], buildSub, eqSub);
  check('G6 everything the user set survives a re-derive, not just the fields the factory names',
    kept2.subUnits[0].unitPrice === 1400 && kept2.subUnits[0].name === 'Podium Shops'
    && kept2.subUnits[0].priceEscalationPct === 3
    && kept2.subUnits[0].metricValue === 2000,
    `escalation ${String(kept2.subUnits[0].priceEscalationPct)}`);
  // THE CONDITION THAT KEEPS THIS OUT OF THE USER'S WAY. A landlord splitting a
  // strip into an anchor and four inline units is doing something no derivation
  // can second-guess, so the moment a second row exists this steps back.
  const split = [{ ...row, metricValue: 800 }, su('own', spec.id, { metricValue: 520 })];
  const untouched = reconcileRetailSubUnits(split, [{ ...spec, retailGfaSqm: 5000 }], buildSub, eqSub);
  check('G7 once the user adds a SECOND row the split is theirs and nothing is overwritten',
    !untouched.changed && untouched.subUnits === split
    && untouched.subUnits[0].metricValue === 800,
    'a derivation that fights a user is a derivation they will turn off');
  check('G8 a companion that already has the user\'s own rows is never seeded again',
    !reconcileRetailSubUnits([su('own', spec.id)], [spec], buildSub, eqSub).changed);
  check('G9 the derived row goes when its companion goes, and takes nothing else with it',
    (() => {
      const r = reconcileRetailSubUnits([row, su('elsewhere', 'other-asset')], [], buildSub, eqSub);
      return r.changed && r.removed.length === 1 && r.subUnits.length === 1
        && r.subUnits[0].id === 'elsewhere';
    })());
  check('G10 the row is SHOWN as its own Lease line in the sub-unit table, not in the leftover bucket',
    /const retail = assets\.filter\(\(a\) => isRetailCompanion\(a\)\);/.test(
      readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8'))
    && readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8')
      .includes('assets.filter((a) => a.isCompanion !== true || isRetailCompanion(a))'));


  // ── H. THE LAND CARVE-OUT (step 5, the first step that moves money) ─────
  //
  // THE FAILURE MODE THIS IS SHAPED AGAINST: a project land total that still
  // foots while the individual assets are wrong. A total is a weak check here
  // BY CONSTRUCTION, because the carve moves land between assets and can only
  // ever leave the total alone. So the reconciliation below is PER ASSET.
  section('H. The carve: both halves from one function, reconciled per asset');
  const carveHosts = [
    // Land 1: 11,000 sqm at 7,500, coverage 60, retail 20, FAR 2.4181.
    { assetId: 'h1', parcelId: 'p1', grossSqm: 11000, rate: 7500, retailGfaSqm: 1320, totalGfaSqm: 26599.1 },
    // Land 2: 5,000 sqm at 7,500, coverage 60, retail 20, FAR 2.5.
    { assetId: 'h2', parcelId: 'p2', grossSqm: 5000, rate: 7500, retailGfaSqm: 600, totalGfaSqm: 12500 },
  ];
  const carve = carveRetailLand(carveHosts);
  check('H1 the share is retail GFA over total GFA, per host',
    Math.abs(carve.hosts[0].share - 1320 / 26599.1) < 1e-12
    && carve.hosts[1].share === 0.048,
    `${carve.hosts[0].share} / ${carve.hosts[1].share}`);
  check('H2 each host loses gross x share, and keeps the rest',
    Math.abs(carve.hosts[0].carvedSqm - 545.8831) < 0.001
    && carve.hosts[1].carvedSqm === 240
    && Math.abs(carve.hosts[0].netSqm - (11000 - carve.hosts[0].carvedSqm)) < 1e-9,
    `${carve.hosts[0].carvedSqm} / ${carve.hosts[1].carvedSqm}`);
  // THE POINT OF THE SHAPE: the two halves are one arithmetic, measured
  // separately here so this compares them rather than reading one twice.
  check('H3 the companion gains EXACTLY what the hosts lost, in sqm and in value',
    Math.abs(carve.companionSqm - carve.hostsLostSqm) < 1e-9
    && Math.abs(carve.companionValue - carve.hostsLostValue) < 1e-9,
    `${carve.companionSqm} vs ${carve.hostsLostSqm}`);
  // TWO PLOTS AT TWO DIFFERENT RATES, so a blend is visibly wrong rather than
  // coincidentally right: the first cut used one rate for both, and a sabotage
  // that merged the plots into a single bucket went unnoticed because with one
  // rate the merged answer equals the split one.
  const twoRates = carveRetailLand([
    { assetId: 'h1', parcelId: 'p1', grossSqm: 10000, rate: 7500, retailGfaSqm: 1200, totalGfaSqm: 24000 },
    { assetId: 'h2', parcelId: 'p2', grossSqm: 10000, rate: 2500, retailGfaSqm: 1200, totalGfaSqm: 24000 },
  ]);
  check('H4 it carves PER PLOT at that plot\'s own rate, so a blended rate cannot distort it',
    twoRates.companionSplits.length === 2
    && twoRates.companionSplits.every((sp) => Math.abs(sp.value - sp.sqm * sp.rate) < 1e-9)
    && new Set(twoRates.companionSplits.map((sp) => sp.rate)).size === 2
    && new Set(twoRates.companionSplits.map((sp) => sp.parcelId)).size === 2
    // 500 sqm from each plot, valued at ITS OWN rate.
    && Math.abs((twoRates.companionSplits.find((x) => x.parcelId === 'p1')?.value ?? 0) - 500 * 7500) < 1e-6
    && Math.abs((twoRates.companionSplits.find((x) => x.parcelId === 'p2')?.value ?? 0) - 500 * 2500) < 1e-6,
    twoRates.companionSplits.map((x) => `${x.parcelId}@${x.rate}`).join(' '));
  // LAND CANCELS OUT OF THE SHARE, since retail GFA and total GFA are both
  // proportional to it. So the share is a property of the massing, and a plot
  // twice the size gives up twice the land at the same percentage.
  const doubled = carveRetailLand([{ ...carveHosts[0], grossSqm: 22000, retailGfaSqm: 2640, totalGfaSqm: 53198.2 }]);
  check('H5 doubling a plot doubles what it gives up, at the same share',
    Math.abs(doubled.hosts[0].share - carve.hosts[0].share) < 1e-12
    && Math.abs(doubled.hosts[0].carvedSqm - 2 * carve.hosts[0].carvedSqm) < 1e-9);
  // NO PLOT, NO CARVE. A host on a weighted average or a custom rate has no
  // parcel for the companion to be credited against, so carving there would
  // take land nobody receives and the two halves would stop matching.
  const noPlot = carveRetailLand([{ assetId: 'x', grossSqm: 5000, rate: 0, retailGfaSqm: 600, totalGfaSqm: 12500 }]);
  check('H6 a host with no resolvable plot gives up NOTHING, so the halves stay equal',
    noPlot.hosts[0].share === 0.048 && noPlot.hosts[0].carvedSqm === 0
    && noPlot.companionSqm === 0 && noPlot.hostsLostSqm === 0);
  check('H7 a host whose chain derives no retail gives up nothing',
    carveRetailLand([{ assetId: 'y', parcelId: 'p', grossSqm: 5000, rate: 100 }]).companionSqm === 0);
  // ONE FUNCTION, TWO WRAPPERS. The engine must not restate the share.
  const engineSrc2 = readFileSync('src/core/calculations/index.ts', 'utf8');
  check('H8 the engine reads the carve through the ONE function and restates nothing',
    (engineSrc2.match(/carveRetailLand\(/g) ?? []).length === 1
    && /function retailCarveContext\(/.test(engineSrc2)
    && /function retailCarveForHost\(/.test(engineSrc2)
    // The share is never recomputed from coverage/retail/FAR anywhere else.
    && !/retailPct[^\n]*\/[^\n]*farRatio/.test(engineSrc2)
    // AND THE CARVE ACTUALLY CALLS THE GROSS ONE. Asserting the gross function
    // merely EXISTS was too weak: it is also used by the breakdown's phase
    // branch, so a sabotage pointing the carve back at the carving function
    // (which recurses without terminating) left the existence check green.
    && /function computeAssetLandSqmGross\(/.test(engineSrc2)
    && /function computeAssetLandBreakdownGross\(/.test(engineSrc2)
    && /const grossSqm = computeAssetLandSqmGross\(h, parcels, assets, subUnits, mode\);/.test(engineSrc2)
    && /const gross = computeAssetLandSqmGross\(asset, parcels, assets, subUnits, mode\);/.test(engineSrc2)
    && /const gross = computeAssetLandBreakdownGross\(asset, parcels, assets, subUnits, mode\);/.test(engineSrc2));

  section('C. A Lease companion with no land, and the engine keeps it free');
  const asset = makeRetailCompanionAsset(spec);
  check('C1 strategy is Lease, so it capitalises as a fixed asset and earns rent',
    asset.strategy === 'Lease');
  check('C2 it is a companion, and its TYPE says which kind',
    asset.isCompanion === true && asset.companionType === 'retail' && isRetailCompanion(asset));
  check('C3 the areas use the platform field names, which invert the industry tiers',
    asset.buaSqm === 1320 && asset.sellableBuaSqm === 1320 && asset.gfaSqm === 1720
    && asset.parkingBaysRequired === 16,
    `bua ${asset.buaSqm} (Total GFA), gfa ${asset.gfaSqm} (Total BUA)`);
  check('C4 it names NO plot, so it can never draw land',
    asset.landAllocation === undefined && asset.landAreaSqm === undefined
    // RUN, not read: the whole plot is offered and the companion still draws
    // nothing, because Rule 2 fires before any allocation is considered.
    && computeAssetLandSqm(asset, [{ id: 'p', phaseId: 'phase_1', name: 'p', area: 9999, rate: 1, cashPct: 100, inKindPct: 0 } as never], [asset], [], 'sqm') === 0);
  check('C5 it carries its LINE and its hosts, since a line has many and parentAssetId is one',
    asset.retailLineKey === 'phase_1|branded-villas'
    && (asset.retailHostAssetIds ?? []).join(',') === 'a'
    // NO parentAssetId, deliberately: that absence is what makes both Operate
    // sync passes skip it without either learning a second kind exists.
    && asset.parentAssetId === undefined);
  const engineSrc = readFileSync('src/core/calculations/index.ts', 'utf8');
  check('C6 the ENGINE is what makes it free, and both short-circuits are still there',
    /if \(asset\.isCompanion === true\) \{\s*\n\s*const cpZero/.test(engineSrc.replace(/\r/g, ''))
    && /\/\/ Rule 2: companion has no land\.\s*\n\s*if \(asset\.isCompanion === true\) return 0;/
      .test(engineSrc.replace(/\r/g, '')));

  section('D. The Operate mechanism is reused, not copied');
  const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('D1 both Operate sync passes exclude a retail companion explicitly',
    (storeSrc.match(/a\.isCompanion && a\.parentAssetId && !isRetailCompanion\(a\)/g) ?? []).length === 2
    && /if \(!a\.isCompanion \|\| !a\.parentAssetId \|\| isRetailCompanion\(a\)\) return a;/.test(storeSrc));
  check('D2 the store reconciles through the CORE rules and writes nothing when quiet',
    /syncRetailCompanions: \(specs\) => set\(\(s\) => \{/.test(storeSrc)
    && /reconcileRetailCompanions\(/.test(storeSrc)
    && /reconcileRetailSubUnits\(/.test(storeSrc)
    // ONE quiet exit for BOTH halves: a pass that changed neither the assets
    // nor the sub-units must write nothing at all, or opening a project marks
    // it dirty.
    && /if \(!r\.changed && !u\.changed\) return \{\};/.test(storeSrc)
    && /\.\.\.\(r\.changed \? \{ assets: r\.assets \} : \{\}\),/.test(storeSrc)
    && /\.\.\.\(u\.changed \? \{ subUnits: u\.subUnits \} : \{\}\),/.test(storeSrc));
  const coreSrc = readFileSync('src/core/calculations/retailCompanion.ts', 'utf8');
  check('D3 the rule is PURE and imports nothing, like every other core rule here',
    !/^\s*import\s/m.test(coreSrc)
    // It describes; it never builds an Asset, which is a platform type.
    && !/makeRetailCompanionAsset/.test(coreSrc));
  const tabSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('D4 the tab feeds it the chain it ALREADY ran, rather than running a second one',
    /buildRetailCompanionSpecs\(/.test(tabSrc)
    && (tabSrc.match(/computeLandChain\(/g) ?? []).length === 1
    && /retailGfaSqm: r\.chain\.retailGfaSqm/.test(tabSrc));
  check('D5 the companion is SHOWN, under the line that builds it',
    tabSrc.includes('retail-companion-${group.key}')
    && tabSrc.includes('data-testid="merged-retail-heading"'));

  section('E. "Companion" no longer means "Operate" in any classifier');
  const CLASSIFIERS = [
    'src/hubs/modeling/platforms/refm/lib/reports/opexReports.ts',
    'src/hubs/modeling/platforms/refm/lib/reports/m4Reports.ts',
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts',
  ];
  const offenders = CLASSIFIERS.filter((f) =>
    /(strategy === 'Operate'[^;\n]*\|\|[^;\n]*isCompanion === true)|(isCompanion === true[^;\n]*\|\|[^;\n]*strategy === 'Operate')/
      .test(readFileSync(f, 'utf8')));
  check('E1 no classifier treats a companion as hospitality by the FLAG rather than the strategy',
    offenders.length === 0, offenders.join(' | '));
  check('E2 the fixed-asset rule reads the strategy, and a Lease companion is still depreciable',
    /return a\.strategy === 'Operate' \|\| a\.strategy === 'Lease';/
      .test(readFileSync('src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts', 'utf8'))
    && !/if \(a\.isCompanion === true\) return true;/
      .test(readFileSync('src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts', 'utf8')));
  // The EXCLUSIONS stay: a companion is still filtered out of land, cost and
  // the consolidation groupings, which is a different question from what KIND
  // of asset it is.
  check('E3 the exclusions that make a companion free are UNTOUCHED',
    /if \(a\.visible === false \|\| a\.isCompanion === true\) continue;/
      .test(readFileSync('src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts', 'utf8'))
    && /if \(a\.isCompanion === true\) continue;/
      .test(readFileSync('src/core/calculations/consolidation.ts', 'utf8')));
}

async function liveChecks(): Promise<void> {
  section('F. Live: the engine is byte-identical with every retail companion present');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('F0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let projects = 0, injected = 0, identical = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: Record<string, unknown> }[];
    if (!vs[0]?.snapshot) continue;
    let st: Record<string, unknown>;
    try { st = hydrationFromAnySnapshot(vs[0].snapshot as never) as never; } catch { continue; }
    projects += 1;
    const assets = (st.assets ?? []) as Asset[];
    const parcels = (st.parcels ?? []) as never[];
    const subUnits = (st.subUnits ?? []) as never[];
    const project = (st.project ?? {}) as Record<string, unknown>;
    const mode = (st.landAllocationMode ?? 'sqm') as never;
    const real = assets.filter((a) => a.isCompanion !== true);
    const chainByAsset = new Map<string, ReturnType<typeof computeLandChain>>();
    for (const a of real) {
      const b = computeAssetLandBreakdown(a, parcels, assets, subUnits, mode);
      const tv = resolveAssetTypeValues(a, project.assetTypeValues as never);
      const areas = (subUnits as { assetId?: string; unitArea?: number }[])
        .filter((u) => u.assetId === a.id && typeof u.unitArea === 'number' && u.unitArea > 0)
        .map((u) => u.unitArea as number);
      chainByAsset.set(a.id, computeLandChain(b.landSqm, a.landChain, {
        avgUnitSizeSqm: resolveAvgUnitSize(areas, tv).value,
        parkingRatio: tv?.parkingRatio,
        parkingRatioBasis: tv?.parkingRatioBasis,
        parkingAreaPerSlotSqm: project.parkingAreaPerSlotSqm as number | undefined,
        // THE SAME RESOLVE THE TAB DOES (2026-09-10): the retail divisor is the
        // retail TYPE's own sqm-per-slot ratio. This passed nothing at all
        // before, so the live half of this verifier measured a companion whose
        // retail parking was structurally absent.
        retailAreaPerSlotSqm: resolveRetailSlotArea(project.assetTypeValues as never),
      }, computeAssetUnitCount(a, subUnits)));
    }
    const lines = groupAssetsForConsolidation(
      real as never, ((st.phases ?? []) as { id: string }[]).map((f) => f.id), normaliseAssetTypeId,
    );
    const specs = buildRetailCompanionSpecs(lines.map((g) => ({
      key: g.key, phaseId: g.phaseId, typeLabel: g.typeLabel,
      hosts: (g.assets as unknown as { id: string }[]).map((a) => {
        const c = chainByAsset.get(a.id);
        return {
          assetId: a.id,
          retailGfaSqm: c?.retailGfaSqm,
          retailParkingAreaSqm: c?.retailParkingAreaSqm,
          retailParkingSlots: c?.retailParkingSlots,
        };
      }),
    })));
    injected += specs.length;
    const before = JSON.stringify(computeFinancialsSnapshot(st as never));
    const after = JSON.stringify(computeFinancialsSnapshot(
      { ...st, assets: [...assets, ...specs.map((sp) => makeRetailCompanionAsset(sp))] } as never,
    ));
    if (before === after) identical += 1;
    console.log(`  ${p.name}: ${specs.length} companion(s)`
      + `${specs.length ? ` [${specs.map((x) => `${x.typeLabel} ${Math.round(x.retailGfaSqm)} sqm`).join('; ')}]` : ''}`
      + ` -> ${before === after ? 'identical' : 'MOVED'}`);
  }
  check('F1 the census reached the live projects', projects >= 5, `${projects}`);
  check('F2 at least one live line actually builds retail, so this is not a vacuous pass',
    injected >= 1, `${injected} companions injected`);
  check('F3 EVERY project is byte-identical with its retail companions present',
    identical === projects, `${identical} of ${projects}`);

  // ── I. LIVE: PER ASSET, NOT PER TOTAL ──────────────────────────────────
  //
  // The carve moves land BETWEEN assets, so the project total is unchanged by
  // construction and a total-only check would pass however wrong the individual
  // figures were. That is the stated failure mode, so every asset is compared
  // against its own before-and-after.
  section('I. Live: every host loses exactly what its companion gains');
  let carveProjects = 0, carveMoved = 0, mismatched = 0, totalsMoved = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: Record<string, unknown> }[];
    if (!vs[0]?.snapshot) continue;
    let st: Record<string, unknown>;
    try { st = hydrationFromAnySnapshot(vs[0].snapshot as never) as never; } catch { continue; }
    const assets = (st.assets ?? []) as Asset[];
    const parcels = (st.parcels ?? []) as never[];
    const subUnits = (st.subUnits ?? []) as never[];
    const mode = (st.landAllocationMode ?? 'sqm') as never;
    if (!assets.some((a) => isRetailCompanion(a))) continue;
    carveProjects += 1;
    // BEFORE is the same engine with the host links stripped, so no carve can
    // fire and everything else is identical.
    const before = assets.map((a) => ({ ...a, retailHostAssetIds: undefined })) as Asset[];
    const bySqm = new Map<string, number>();
    const byVal = new Map<string, number>();
    for (let i = 0; i < assets.length; i += 1) {
      const b = computeAssetLandBreakdown(before[i], parcels, before, subUnits, mode);
      bySqm.set(assets[i].id, b.landSqm);
      byVal.set(assets[i].id, b.landValue);
    }
    let bTot = 0, aTot = 0, bVal = 0, aVal = 0;
    for (const a of assets) {
      const after = computeAssetLandBreakdown(a, parcels, assets, subUnits, mode);
      const gross = bySqm.get(a.id) ?? 0;
      const grossVal = byVal.get(a.id) ?? 0;
      bTot += gross; aTot += after.landSqm; bVal += grossVal; aVal += after.landValue;
      if (Math.abs(after.landSqm - gross) > 0.005 || Math.abs(after.landValue - grossVal) > 0.005) carveMoved += 1;
      if (!isRetailCompanion(a)) continue;
      // THE COMPANION'S GAIN IS ITS HOSTS' LOSSES, asset by asset.
      let hostLostSqm = 0, hostLostVal = 0;
      for (const hid of a.retailHostAssetIds ?? []) {
        const h = assets.find((x) => x.id === hid);
        if (!h) continue;
        const hAfter = computeAssetLandBreakdown(h, parcels, assets, subUnits, mode);
        hostLostSqm += (bySqm.get(hid) ?? 0) - hAfter.landSqm;
        hostLostVal += (byVal.get(hid) ?? 0) - hAfter.landValue;
      }
      if (Math.abs(hostLostSqm - after.landSqm) > 0.005
        || Math.abs(hostLostVal - after.landValue) > 0.005) mismatched += 1;
      console.log(`  ${p.name} / ${String(a.name)}: hosts gave up ${hostLostSqm.toFixed(2)} sqm`
        + ` / ${hostLostVal.toFixed(2)}, companion holds ${after.landSqm.toFixed(2)} sqm / ${after.landValue.toFixed(2)}`);
    }
    if (Math.abs(bTot - aTot) > 0.005 || Math.abs(bVal - aVal) > 0.005) totalsMoved += 1;
  }
  check('I1 at least one live project actually carves, so this is not a vacuous pass',
    carveProjects >= 1 && carveMoved >= 2, `${carveProjects} projects, ${carveMoved} assets moved`);
  check('I2 EVERY companion holds exactly what its hosts gave up, per asset',
    mismatched === 0, `${mismatched} mismatched`);
  // NECESSARY BUT NOT SUFFICIENT, and said so: the carve can only ever leave
  // the total alone, so this passing proves nothing on its own. It is here to
  // catch land being created or destroyed, not to check the carve.
  // I4 THE TWO ENGINE ENTRY POINTS MUST AGREE, and nothing checked that until
  // two sabotages walked through: one inflated the companion's sqm and one
  // stopped the host losing it, both in computeAssetLandSqm, while every check
  // here read computeAssetLandBreakdown. Two functions answering "how much land
  // does this asset have" differently is the shape this codebase has been bitten
  // by before (see resolveAssetPlotDraw's own header), and the carve doubled the
  // number of places that answer it.
  let disagreed = 0, compared = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: Record<string, unknown> }[];
    if (!vs[0]?.snapshot) continue;
    let st: Record<string, unknown>;
    try { st = hydrationFromAnySnapshot(vs[0].snapshot as never) as never; } catch { continue; }
    const assets = (st.assets ?? []) as Asset[];
    const parcels = (st.parcels ?? []) as never[];
    const subUnits = (st.subUnits ?? []) as never[];
    const mode = (st.landAllocationMode ?? 'sqm') as never;
    for (const a of assets) {
      compared += 1;
      const one = computeAssetLandSqm(a, parcels, assets, subUnits, mode);
      const two = computeAssetLandBreakdown(a, parcels, assets, subUnits, mode).landSqm;
      if (Math.abs(one - two) > 0.005) {
        disagreed += 1;
        console.log(`      DISAGREE ${p.name} / ${String(a.name)}: sqm ${one} vs breakdown ${two}`);
      }
    }
  }
  check('I4 computeAssetLandSqm and computeAssetLandBreakdown agree on EVERY live asset',
    disagreed === 0 && compared >= 12, `${disagreed} disagreed of ${compared} compared`);
  check('I3 and the project land total is unchanged (necessary, not sufficient)',
    totalsMoved === 0, `${totalsMoved} projects whose total moved`);

}

async function main(): Promise<void> {
  console.log('=== verify-retail-companion ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
