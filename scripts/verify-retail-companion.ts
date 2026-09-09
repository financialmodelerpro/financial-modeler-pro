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
  normaliseAssetTypeId, resolveAssetTypeValues, resolveAvgUnitSize,
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
}

async function main(): Promise<void> {
  console.log('=== verify-retail-companion ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
