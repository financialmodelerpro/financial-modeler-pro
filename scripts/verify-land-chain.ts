/**
 * verify-land-chain.ts (2026-09-07, land planning step 2)
 *
 * THE TOP-DOWN AREA DERIVATION: `src/core/calculations/landChain.ts`, its
 * read-only panel, and the invariant that neither reaches the engine.
 *
 * What it proves:
 *   A. THE CHAIN REPRODUCES THE REFERENCE WORKBOOK, to the cent, on two real
 *      rows: one with no retail and one with retail. Every intermediate step
 *      is checked, not just the total, so a change to any line fails against
 *      the source rather than against anybody's reading of it.
 *   B. A BLANK INPUT IS NOT A ZERO: an absent input stops the chain and is
 *      reported as a gap; a typed 0 computes.
 *   C. NOTHING READS IT. The calculation, resolver, report and export surface
 *      contains no reference to the chain or its inputs; the sole consumer is
 *      the read-only panel.
 *   D. THE ENGINE IS BYTE-IDENTICAL with the chain inputs present and absent,
 *      on a two-phase mixed-use fixture, WITH a positive control so the check
 *      cannot pass by failing to reach the engine.
 *   E. Additive schema: hydrate carries the inputs and invents none, and no
 *      live project acquires any.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-land-chain.ts
 *
 * No em dashes in this file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeLandChain,
  landChainIsEmpty,
  compareChainValue,
  chainGapText,
  type ChainGap,
  type LandChainInputs,
} from '../src/core/calculations/landChain';
import {
  groupAssetsByPlot,
  primaryParcelId,
  UNPLOTTED_GROUP,
  type AssetPlotGroup,
} from '../src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel';
import type { Asset, Parcel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

/** The workbook carries full float precision; compare to the cent. */
const near = (a: number | undefined, b: number, tol = 0.005): boolean =>
  typeof a === 'number' && Math.abs(a - b) < tol;

function offlineChecks(): void {
  // ── A. Against the reference workbook ────────────────────────────────────
  //
  // Two rows of "Inputs - Plots Info", read out of the workbook itself and
  // pinned here as literals so this runs with no spreadsheet present. Every
  // expected figure below is the workbook's own cached result.
  section('A. The chain reproduces the reference workbook, step by step');

  // Row 4: Resort 5 Star. NO retail (retail% = 0), no service deduction.
  // Company standards for that type: unit size 120 m2/key, parking 0.5
  // slots/key; the account-wide parking area per slot is 40 m2.
  const resort = computeLandChain(
    48862.98,
    { utilisationPct: 100, coveragePct: 50, retailPct: 0, servicePct: 0, farRatio: 3 },
    { avgUnitSizeSqm: 120, parkingRatio: 0.5, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40 },
  );
  check('A1 no-retail row: land utilised, footprint and landscape',
    near(resort.landUtilisedSqm, 48862.98) && near(resort.footprintSqm, 24431.49)
    && near(resort.landscapeSqm, 24431.49) && resort.landscapePct === 50,
    JSON.stringify({ u: resort.landUtilisedSqm, f: resort.footprintSqm, l: resort.landscapeSqm }));
  check('A2 no-retail row: retail 0, lobby is the whole footprint',
    near(resort.retailGfaSqm, 0) && near(resort.lobbyGfaSqm, 24431.49));
  check('A3 no-retail row: total GFA is UTILISED LAND x FAR, and the main asset keeps ALL of it',
    near(resort.totalGfaSqm, 146588.94) && near(resort.mainAssetGfaSqm, 146588.94));
  // A4 AND A5 CARRY THE DIVERGENCE. Net saleable still ties to the workbook to
  // the cent, because rounding happens AFTER it. The count does not: the
  // workbook keeps 1221.5745 keys and we keep 1222, by decision, and every
  // figure below the count follows from the whole number.
  check('A4 no-retail row: net saleable ties exactly; the count is WHOLE (workbook 1221.5745)',
    near(resort.netSaleableSqm, 146588.94)
    && resort.units === 1222 && resort.unitsSource === 'derived'
    // 1222 x 0.5 slots per key, off the rounded count, not off 1221.5745.
    && resort.parkingSlots === 611,
    `units=${resort.units} slots=${resort.parkingSlots}`);
  check('A5 no-retail row: parking area and BUA follow the ROUNDED slots (workbook 171020.43, ours 171028.94)',
    near(resort.parkingAreaSqm, 24440) && near(resort.totalParkingAreaSqm, 24440)
    && near(resort.totalBuaSqm, 171028.94)
    // The whole divergence is the rounding and nothing else: 0.21275 of a
    // slot at 40 sqm, which is 8.51 sqm on a 171,000 sqm asset.
    && near((resort.totalBuaSqm ?? 0) - 171020.43, (611 - 610.78725) * 40, 0.01),
    `bua=${resort.totalBuaSqm}`);

  // Row 7: High End Apartments. WITH retail (50% of the footprint) and a 20%
  // service deduction. Unit size 150, parking 1 slot/unit, retail parking at
  // 25 m2 of retail GFA per slot.
  const apts = computeLandChain(
    6807.72,
    { utilisationPct: 100, coveragePct: 60, retailPct: 50, servicePct: 20, farRatio: 3.6, retailAreaPerSlotSqm: 25 },
    { avgUnitSizeSqm: 150, parkingRatio: 1, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40 },
  );
  check('A6 retail row: footprint, landscape, retail and lobby',
    near(apts.footprintSqm, 4084.632) && near(apts.landscapeSqm, 2723.088)
    && near(apts.retailGfaSqm, 2042.316) && near(apts.lobbyGfaSqm, 2042.316));
  check('A7 retail row: the main asset gives up BOTH retail and lobby',
    near(apts.totalGfaSqm, 24507.792) && near(apts.mainAssetGfaSqm, 20423.16),
    `main=${apts.mainAssetGfaSqm}`);
  check('A8 retail row: net saleable ties exactly; the count is WHOLE (workbook 108.92352)',
    near(apts.netSaleableSqm, 16338.528) && apts.units === 109);
  check('A9 retail row: retail parking is on its OWN basis, and every slot count is whole',
    apts.parkingSlots === 109 && apts.retailParkingSlots === 82
    && apts.totalParkingSlots === 191,
    `${apts.parkingSlots}/${apts.retailParkingSlots}/${apts.totalParkingSlots}`);
  check('A10 retail row: parking areas and BUA follow the ROUNDED slots (workbook 32132.4384, ours 32147.792)',
    near(apts.parkingAreaSqm, 4360) && near(apts.retailParkingAreaSqm, 3280)
    && near(apts.totalParkingAreaSqm, 7640) && near(apts.totalBuaSqm, 32147.792),
    `bua=${apts.totalBuaSqm}`);
  // A11 IS THE REVERSE OF WHAT IT ASSERTED, and the reversal is the decision.
  // It used to pin "units are NOT rounded, the workbook carries fractional
  // keys". You cannot build 0.57 of an apartment, so the count is now whole
  // and everything downstream follows from the whole number rather than from
  // the fraction. A5 and A10 measure exactly what that costs against the
  // source.
  const whole = (n: number | undefined): boolean => typeof n === 'number' && Number.isInteger(n);
  check('A11 counts are WHOLE, and so is everything counted: units, slots, retail slots, totals',
    [resort.units, resort.parkingSlots, resort.totalParkingSlots,
      apts.units, apts.parkingSlots, apts.retailParkingSlots, apts.totalParkingSlots].every(whole));
  check('A11b the AREAS are not rounded: only things you count are',
    !Number.isInteger(apts.netSaleableSqm as number)
    && !Number.isInteger(apts.totalBuaSqm as number)
    && !Number.isInteger(apts.footprintSqm as number));
  check('A11c a sub-unit count is rounded too, so both sources of a count agree in kind',
    computeLandChain(6807.72, { utilisationPct: 100, coveragePct: 60, retailPct: 50, servicePct: 20, farRatio: 3.6 },
      { avgUnitSizeSqm: 150 }, 12.4).units === 12);

  // ── B. Blank is not zero ────────────────────────────────────────────────
  section('B. A blank input stops the chain; a typed zero computes');
  const noInputs = computeLandChain(10000, undefined, {});
  check('B1 an asset with NO chain inputs derives nothing and says it is empty',
    noInputs.empty && noInputs.landUtilisedSqm === undefined && noInputs.gaps.length === 0
    && landChainIsEmpty(undefined) && landChainIsEmpty({}));
  const noFar = computeLandChain(10000, { utilisationPct: 100, coveragePct: 50 }, {});
  check('B2 a missing FAR leaves total GFA absent and records the gap, rather than reporting 0',
    noFar.totalGfaSqm === undefined && noFar.gaps.includes('no_far')
    && near(noFar.footprintSqm, 5000));
  const zeroCoverage = computeLandChain(10000, { utilisationPct: 100, coveragePct: 0, farRatio: 2 }, {});
  check('B3 a TYPED ZERO coverage is a real answer: no footprint, all landscape, GFA still derived',
    near(zeroCoverage.footprintSqm, 0) && near(zeroCoverage.landscapeSqm, 10000)
    && near(zeroCoverage.totalGfaSqm, 20000) && !zeroCoverage.gaps.includes('no_coverage'));
  const noLand = computeLandChain(0, { utilisationPct: 100, coveragePct: 50, farRatio: 2 }, {});
  check('B4 no land allocated is a gap, not a silent zero chain',
    noLand.gaps.includes('no_land') && noLand.landUtilisedSqm === undefined);
  const noStandards = computeLandChain(
    10000, { utilisationPct: 100, coveragePct: 50, farRatio: 2 }, {});
  check('B5 missing standards are named one by one',
    noStandards.gaps.includes('no_unit_size') && noStandards.gaps.includes('no_parking_ratio')
    && noStandards.units === undefined && noStandards.parkingSlots === undefined);
  const retailNoBasis = computeLandChain(
    10000, { utilisationPct: 100, coveragePct: 50, retailPct: 40, farRatio: 2 },
    { avgUnitSizeSqm: 100, parkingRatio: 1, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40 });
  check('B6 retail with no retail-slot basis reports the gap instead of zero retail parking',
    retailNoBasis.retailParkingSlots === undefined
    && retailNoBasis.gaps.includes('no_retail_area_per_slot'));
  check('B7 every gap has a sentence a surface can print',
    (['no_land', 'no_utilisation', 'no_coverage', 'no_far', 'no_unit_size', 'no_parking_ratio',
      'no_parking_area_per_slot', 'no_retail_area_per_slot'] as ChainGap[])
      .every((g) => chainGapText(g).length > 20));
  check('B8 sub-units WIN over the derived count, the step 1 precedence',
    computeLandChain(10000, { utilisationPct: 100, coveragePct: 50, farRatio: 2 },
      { avgUnitSizeSqm: 100 }, 42).units === 42
    && computeLandChain(10000, { utilisationPct: 100, coveragePct: 50, farRatio: 2 },
      { avgUnitSizeSqm: 100 }, 42).unitsSource === 'sub_units');
  const cmp = compareChainValue(120, 100);
  check('B9 the comparison states a difference only when BOTH sides exist',
    cmp.diff === 20 && cmp.diffPct === 20
    && compareChainValue(120, undefined).diff === undefined
    && compareChainValue(undefined, 100).diff === undefined
    && compareChainValue(120, 0).diffPct === undefined);

  // ── C. Nothing reads it ─────────────────────────────────────────────────
  section('C. The chain reaches no calculation, report or export');
  const CHAIN_FILE = 'src/core/calculations/landChain.ts';
  const ENGINE_ROOTS = [
    'src/core/calculations',
    'src/hubs/modeling/platforms/refm/lib/excel',
    'src/hubs/modeling/platforms/refm/lib/pdf',
    'src/hubs/modeling/platforms/refm/lib/reports',
    'src/hubs/modeling/platforms/refm/lib/pptx',
    'src/hubs/modeling/platforms/refm/lib/ai',
    'src/hubs/modeling/platforms/refm/lib/portfolio',
  ];
  const ENGINE_FILES = [
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
  ];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name).replace(/\\/g, '/');
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  };
  const files: string[] = [];
  for (const r of ENGINE_ROOTS) { try { files.push(...walk(r)); } catch { /* optional */ } }
  for (const f of ENGINE_FILES) { try { statSync(f); files.push(f); } catch { /* optional */ } }
  check('C0 the scan actually covers the surface', files.length > 50, `${files.length} files`);

  // The DEFINITION is excluded: it is the chain, not a consumer. Everything
  // else in the calculation and export surface must not mention it.
  const consumers = files
    .filter((f) => f !== CHAIN_FILE)
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('landChain') || src.includes('computeLandChain')
        || src.includes('LandChainInputs') || src.includes('retailAreaPerSlotSqm');
    });
  check('C1 no calculation, resolver, report or export file references the chain',
    consumers.length === 0, consumers.slice(0, 5).join(' | '));
  check('C2 the chain imports NOTHING (it cannot reach back into the model)',
    !/^\s*import\s/m.test(readFileSync(CHAIN_FILE, 'utf8')));

  const chainSrc = readFileSync(CHAIN_FILE, 'utf8');
  const panel = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/_shared/LandChainSection.tsx', 'utf8');
  const assetsTab = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('C3 the ONE consumer is the read-only panel, rendered by the asset card',
    panel.includes('computeLandChain(') && assetsTab.includes('<LandChainSection'));
  check('C4 the panel writes only the INPUTS, never a derived figure back onto the asset',
    !/onUpdate\(\{\s*(gfaSqm|buaSqm|sellableBuaSqm|supportArea|parkingArea|parkingBaysRequired)/.test(panel)
    && !panel.includes('setAssetTypeValue')
    && assetsTab.includes('landChain: mergeLandChain('));
  check('C5 the panel names BOTH vocabularies wherever the two meet',
    panel.includes('reference BUA Area = platform GFA')
    && panel.includes('reference Total GFA = platform BUA')
    && panel.includes('reference Net Saleable / GLA = platform NSA'));
  check('C6 clearing every input returns the asset to carrying no chain at all',
    assetsTab.includes('Object.keys(next).length === 0 ? undefined'));

  // ── T. The table surface ────────────────────────────────────────────────
  section('T. Assets group under their plot, and the plot checks its own sum');
  const mkAsset = (id: string, alloc: Record<string, unknown> | undefined, companion = false): Asset =>
    ({ id, phaseId: 'phase_1', name: id, type: '', strategy: 'Sell', visible: true,
      gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
      ...(alloc ? { landAllocation: alloc } : {}),
      ...(companion ? { isCompanion: true } : {}) }) as unknown as Asset;
  const mkParcel = (id: string, area: number): Parcel =>
    ({ id, phaseId: 'phase_1', name: `Plot ${id}`, area, rate: 100, cashPct: 100, inKindPct: 0 }) as Parcel;

  const parcelsT = [mkParcel('p1', 10000), mkParcel('p2', 5000), mkParcel('p3', 2000)];
  const single = mkAsset('a1', { parcelId: 'p1', sqm: 6000 });
  const second = mkAsset('a2', { parcelId: 'p2', sqm: 4000 });
  const sentinel = mkAsset('a3', { parcelId: '__custom__', sqm: 900, customRate: 50 });
  const nothing = mkAsset('a4', undefined);
  const companion = mkAsset('a5', { parcelId: 'p1', sqm: 99999 }, true);
  const grouped = groupAssetsByPlot([single, second, sentinel, nothing, companion], parcelsT);

  const byKey = (k: string): AssetPlotGroup | undefined => grouped.find((g) => g.key === k);
  check('T1 an asset is filed under the one plot it names',
    (byKey('p1')?.assets ?? []).map((a) => a.id).join(',') === 'a1'
    && (byKey('p2')?.assets ?? []).map((a) => a.id).join(',') === 'a2');
  // RE-AIMED 2026-09-08: AN ASSET BELONGS TO EXACTLY ONE PLOT. The
  // multi-parcel split is gone from the app (0 of 9399 stored asset rows ever
  // used one), so there is no "draws most from" rule left to test; what
  // matters now is that a LEGACY snapshot carrying a split is still filed
  // somewhere visible rather than vanishing from the table.
  const legacySplit = mkAsset('a6', { multiParcelSplits: [{ parcelId: 'p1', sqm: 1000 }, { parcelId: 'p2', sqm: 4000 }] });
  check('T2 a legacy split names no single plot, so it is filed in the unplotted group, never hidden',
    primaryParcelId(legacySplit) === UNPLOTTED_GROUP
    && (groupAssetsByPlot([legacySplit], parcelsT).find((g) => g.key === UNPLOTTED_GROUP)?.assets ?? []).length === 1);
  check('T3 an asset naming no real plot (a sentinel, or nothing) goes to the unplotted group',
    (byKey(UNPLOTTED_GROUP)?.assets ?? []).map((a) => a.id).sort().join(',') === 'a3,a4');
  check('T4 the plot check is a SIMPLE SUM of the assets under it',
    byKey('p1')?.allocatedSqm === 6000 && byKey('p1')?.remainingSqm === 4000
    && byKey('p1')?.status === 'under'
    && byKey('p2')?.allocatedSqm === 4000 && byKey('p2')?.status === 'under');
  check('T5 a plot drawn exactly reads ok, and an over-drawn plot reads over',
    groupAssetsByPlot([mkAsset('x', { parcelId: 'p2', sqm: 5000 })], [mkParcel('p2', 5000)])[0].status === 'ok'
    && groupAssetsByPlot([mkAsset('x', { parcelId: 'p2', sqm: 6000 })], [mkParcel('p2', 5000)])[0].status === 'over');
  check('T6 companions carry no land, so they never join a plot or its sum',
    !(byKey('p1')?.assets ?? []).some((a) => a.id === 'a5')
    && !(byKey(UNPLOTTED_GROUP)?.assets ?? []).some((a) => a.id === 'a5')
    && byKey('p1')?.allocatedSqm === 6000);
  check('T7 every parcel appears even with nothing on it; the unplotted group appears only when used',
    !!byKey('p3') && (byKey('p3')?.assets ?? []).length === 0
    && groupAssetsByPlot([single], parcelsT).every((g) => g.key !== UNPLOTTED_GROUP));

  section('U. The row carries what a row can, the drawer the rest');
  const tabSrc = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('U1 the assets table exists, grouped by plot, with a per-plot check',
    tabSrc.includes('data-testid="assets-table"') && tabSrc.includes('plot-group-${g.key}')
    && tabSrc.includes('plotCheckText(') && tabSrc.includes('groupAssetsByPlot('));
  // RE-AIMED 2026-09-08 with the split: the INPUT row carries the five chain
  // percentages (U11 asserts it carries no derived column), and the derived
  // cascade moved to the results table (U12).
  check('U2 the input row carries the five chain inputs, and the chain is what feeds the results',
    ['-utilisation', '-coverage', '-far', '-retail', '-service'].every((k) => tabSrc.includes(`asset-row-\${asset.id}${k}`))
    && tabSrc.includes('computeLandChain('));
  // RE-AIMED 2026-09-08: one asset, one plot. The count cell and the split
  // editor are gone, and what is checked now is that they cannot come back by
  // accident: no way to CREATE a split anywhere in the tab.
  check('U3 nothing in the tab can create a multi-parcel split any more',
    !tabSrc.includes('asset-${asset.id}-parcel-count')
    && !tabSrc.includes('add-parcel-split')
    && !tabSrc.includes('multi-parcel-section')
    && !/setAllocation\(\{[^}]*multiParcelSplits/.test(tabSrc)
    && !tabSrc.includes('const addSplit'));
  check('U4 the sub-units table picks its parent asset when adding',
    tabSrc.includes('data-testid="subunits-table"') && tabSrc.includes('subunits-parent-pick')
    && tabSrc.includes('subunits-add-subunit'));
  check('U5 NO field has two homes: name, phase, the free-text type and Delete live only in the row',
    !tabSrc.includes('data-testid={`asset-${asset.id}-name`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-phase`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-type`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-remove`}')
    && tabSrc.includes('asset-row-${asset.id}-name'));
  // ── The two defects the first cut shipped, both found on live data ──────
  check('U7 a RATE never takes the project number scale (18,500 per sqm read as "19" at thousands)',
    tabSrc.includes("formatAccounting(u.unitPrice, 'full'")
    && !/formatAccounting\(u\.unitPrice,\s*project\.displayScale/.test(tabSrc));
  check('U8 a count nobody can derive is a DASH, not a zero',
    tabSrc.includes('const count: number | undefined')
    && tabSrc.includes('(unitArea > 0 ? Math.round(u.metricValue / unitArea) : undefined)')
    && tabSrc.includes('count === undefined'));
  // U9 MOVED WITH THE CELL. Unit size used to be a read-only figure, so the
  // check was about how it PRINTED. It is now typed, so the distinction has to
  // hold at the point of entry: an absent size shows the "not set" placeholder
  // and a typed 0 shows 0, and only the absent one is silent.
  check('U9 an ABSENT unit size is visibly not set, and a typed 0 is a real answer',
    /value=\{draft \?\? stored\}/.test(tabSrc)
    && /const stored = value !== undefined \? String\(Math\.round\(value \* 100\) \/ 100\) : '';/.test(tabSrc)
    && /placeholder="not set"/.test(tabSrc)
    && /onCommit=\{\(v\) => onUpdate\(u\.id, \{ unitArea: v \}\)\}/.test(tabSrc));
  // RE-AIMED 2026-09-08: the one table became TWO, stacked. What you type is
  // table one; what the chain produces is table two, which can now carry the
  // WHOLE cascade because it carries no input.
  check('U10 both tables use a fixed layout with explicit column widths',
    (tabSrc.match(/tableLayout: 'fixed'/g) ?? []).length >= 2
    && (tabSrc.match(/<colgroup>/g) ?? []).length >= 2);
  check('U11 the INPUT table holds no derived column, which is what lets identity be readable',
    tabSrc.includes('data-testid="assets-table"')
    && !/asset-row-\$\{asset\.id\}-(land-utilised|total-gfa|net-saleable|total-bua)/.test(tabSrc));
  check('U12 the RESULTS table holds the WHOLE cascade through Total BUA, read only',
    tabSrc.includes('data-testid="assets-results-table"')
    && ['land-utilised', 'total-gfa', 'net-saleable', 'units', 'total-bua']
      .every((k) => tabSrc.includes(`asset-result-\${asset.id}-${k}`))
    && ['footprintSqm', 'landscapePct', 'landscapeSqm', 'retailGfaSqm', 'lobbyGfaSqm',
      'mainAssetGfaSqm', 'parkingSlots', 'retailParkingSlots', 'totalParkingSlots',
      'parkingAreaSqm', 'retailParkingAreaSqm', 'totalParkingAreaSqm']
      .every((k) => tabSrc.includes(`chain.${k}`)));
  // U13 IS SCOPED TO THE RESULTS COMPONENT'S OWN BODY, and it has to be.
  // The first version asserted only that both tables were PASSED the same
  // array, which a re-sort inside the results component satisfies happily: a
  // sabotage that re-sorted the results rows passed it. The invariant is that
  // the results table ORDERS NOTHING ITSELF, so that is what is checked.
  const resultsStart = tabSrc.indexOf('function AssetResultsTable(');
  const resultsEnd = tabSrc.indexOf('/** Both tables, stacked');
  const resultsBody = resultsStart >= 0 && resultsEnd > resultsStart
    ? tabSrc.slice(resultsStart, resultsEnd) : '';
  check('U13 BOTH tables render from ONE resolved row list, and the results table re-orders nothing',
    tabSrc.includes('function buildAssetRows(')
    && (tabSrc.match(/buildAssetRows\(/g) ?? []).length === 2
    && tabSrc.includes('<AssetInputsTable') && tabSrc.includes('<AssetResultsTable')
    && resultsBody.length > 500
    && !resultsBody.includes('.sort(')
    && !resultsBody.includes('.filter(')
    && !resultsBody.includes('buildAssetRows(')
    && !resultsBody.includes('groupAssetsByPlot('),
    resultsBody.length === 0 ? 'could not isolate the results component body' : '');
  // U15 EXISTS BECAUSE FOUR COUNTS DISAGREED AND NOTHING SAID SO. The results
  // table declared 19 columns in its colgroup, banded 19 in its group row and
  // set COLS = 19, while rendering 20 headers and 20 cells. Under
  // `table-layout: fixed` the undeclared twentieth got no width and no band,
  // so the outermost tier rendered as a nameless sliver. A colSpan is arithmetic
  // no compiler checks, so it is checked here instead.
  const countCols = (body: string): { band: number; head: number; cells: number; group: number; cols: number } => {
    const thead = body.slice(body.indexOf('<thead>'), body.indexOf('</thead>'));
    const rows = thead.split('<tr').slice(1);
    const spanOf = (th: string): number => { const m = /colSpan=\{(\d+)\}/.exec(th); return m ? Number(m[1]) : 1; };
    const cellsOf = (r: string): string[] => r.match(/<th\b[\s\S]*?(?:\/>|<\/th>)/g) ?? [];
    const cg = body.slice(body.indexOf('<colgroup>'), body.indexOf('</colgroup>'));
    const repeat = /length:\s*(\d+)\s*\}/.exec(cg);
    const explicit = (cg.match(/<col style=\{\{ width/g) ?? []).length;
    // The row rendering ONE asset: the widest <tr> in the tbody.
    const tbody = body.slice(body.indexOf('<tbody>'));
    const trs = tbody.split('<tr').map((t) => (t.match(/<td\b/g) ?? []).length);
    return {
      band: rows.length > 0 ? cellsOf(rows[0]).reduce((a, t) => a + spanOf(t), 0) : -1,
      head: rows.length > 1 ? cellsOf(rows[1]).reduce((a, t) => a + spanOf(t), 0) : -1,
      cells: Math.max(...trs),
      group: Number(/const COLS = (\d+)/.exec(body)?.[1] ?? -1),
      cols: explicit + (repeat ? Number(repeat[1]) : 0),
    };
  };
  const inputsStart = tabSrc.indexOf('function AssetInputsTable(');
  const inputsBody = inputsStart >= 0 ? tabSrc.slice(inputsStart, resultsStart) : '';
  for (const [label, body] of [['input', inputsBody], ['results', resultsBody]] as const) {
    const c = countCols(body);
    const all = [c.band, c.head, c.cells, c.group, c.cols];
    check(`U15 ${label} table: colgroup, both header rows, the body row and COLS all state the SAME column count`,
      body.length > 500 && all.every((v) => v > 0 && v === c.band),
      `band ${c.band}, headers ${c.head}, cells ${c.cells}, COLS ${c.group}, colgroup ${c.cols}`);
  }
  // ── THE VOCABULARY. The DISPLAY carries standard GCC development terms and
  // the INTERNAL fields invert the outer two tiers, so a column can never be
  // wired on the strength of a shared word: every tooltip names the field the
  // column feeds and the cost method that reads it.
  //
  // U17 IS THE REVERSE OF ITS FIRST VERSION. That one put the platform's field
  // names on the two contested columns. The founder's decision is the other
  // way: industry words on the face, the mapping in the tooltip, because these
  // tables are read by people who price plots, not by people who read our
  // types.
  check('U17 the two contested columns carry the INDUSTRY names, not our internal field names',
    /<th style=\{TH_N\}[^>]*>Total GFA \(sqm\)<\/th>/.test(resultsBody)
    && /<th style=\{TH_N\}[^>]*>Total BUA \(sqm\)<\/th>/.test(resultsBody)
    && !/>BUA \(sqm\)</.test(resultsBody)
    && !/>GFA \(sqm\)</.test(resultsBody));
  check('U18 every column with an internal field names BOTH the field and the cost method that reads it',
    [
      [/Asset\.buaSqm[^"]*rate_per_bua/, 'Total GFA'],
      [/Asset\.gfaSqm[^"]*rate_per_gfa/, 'Total BUA'],
      [/Asset\.sellableBuaSqm[^"]*rate_per_nsa/, 'NSA or GLA'],
      [/Asset\.parkingBaysRequired[^"]*rate_per_parking_bay/, 'Parking Slots'],
      [/rate_per_land and rate_per_nda/, 'Plot Area'],
      [/rate_per_unit/, 'Units or Keys'],
    ].every(([re]) => (re as RegExp).test(resultsBody)));
  check('U18b a column NO cost method reads says so, rather than staying silent',
    (resultsBody.match(/Read by no cost method\./g) ?? []).length >= 10);
  check('U19 the table states which vocabulary is in force AND that the fields invert',
    tabSrc.includes('data-testid="assets-results-vocabulary"')
    && /standard GCC development terms/.test(resultsBody)
    && /NSA or GLA sits inside Total GFA sits inside\s*\n?\s*Total BUA/.test(resultsBody)
    && /invert the outer two/.test(resultsBody));
  check('U20 every area header states its unit, and every label is the industry term',
    (resultsBody.match(/\(sqm\)</g) ?? []).length >= 14
    && ['Plot Area (sqm)', 'Net Developable Area (sqm)', 'Building Footprint (sqm)',
      'Landscape and Open Area (sqm)', 'Retail GFA (sqm)', 'Lobby and Circulation GFA (sqm)',
      'Main Asset GFA (sqm)', 'NSA or GLA (sqm)', 'Average Unit Size (sqm)', 'Units or Keys',
      'Parking Ratio', 'Parking Slots', 'Retail Parking Slots', 'Total Parking Slots',
      'Parking Area (sqm)', 'Retail Parking Area (sqm)', 'Total Parking Area (sqm)']
      .every((t) => resultsBody.includes(`>${t}</th>`))
    && ['Plot Area (sqm)', 'Land Utilisation %', 'Ground Coverage %', 'FAR', 'Max Floors',
      'Retail % (ground floor)', 'Service %']
      .every((t) => inputsBody.includes(`>${t}</th>`)));
  check('U21 the drawer panel uses the SAME words as the table it sits under',
    panel.includes("'BUA (reference Total GFA)'")
    && panel.includes("'GFA (reference BUA Area)'")
    && panel.includes("'Net saleable / GLA'"));
  check('U22 MAX FLOORS is typed and carried, and the chain computes with it NOWHERE',
    /maxFloors\?: number/.test(chainSrc)
    && inputsBody.includes('asset-row-${asset.id}-max-floors')
    && inputsBody.includes('patchChain({ maxFloors: v })')
    // NAMED ONCE, IN THE DECLARATION, AND NOWHERE ELSE IN THE CODE. A single
    // arithmetic use would make it a driver and move every derived figure on
    // every project. Comments are stripped first: the field's own docblock
    // says "CARRIED, NOT COMPUTED WITH", and the */ that closes it sits right
    // above the declaration, which a naive operator match reads as a division.
    && (chainSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      .match(/maxFloors/g) ?? []).length === 1);
  check('U23 the two standards that DRIVE the count and the slots are shown, not left invisible',
    resultsBody.includes('asset-result-${asset.id}-unit-size')
    && resultsBody.includes('asset-result-${asset.id}-parking-ratio')
    && /unitSizeSqm/.test(tabSrc) && /parkingRatioBasis/.test(resultsBody));
  check('U24 counts render WHOLE, through their own formatter, not through a 2-decimal one',
    /const whole = \(v: number \| undefined\)/.test(resultsBody)
    && /whole\(chain\.units\)/.test(resultsBody)
    && /whole\(chain\.parkingSlots\)/.test(resultsBody)
    && /whole\(chain\.retailParkingSlots\)/.test(resultsBody)
    && /whole\(chain\.totalParkingSlots\)/.test(resultsBody)
    && !/n\(chain\.(units|parkingSlots|retailParkingSlots|totalParkingSlots)\)/.test(resultsBody));
  // U25 EXISTS BECAUSE PROJECT TOTALS CONTRADICTED THE TABLES ABOVE IT. It
  // showed the same three quantities under our internal names, and the outer
  // two of those invert, so its BUA tile was the tables' Total GFA.
  check('U25 Project Totals uses the SAME words as the tables above it',
    /Total GFA<\/div>\s*\n\s*<strong[^>]*data-testid="globals-bua"/.test(tabSrc)
    && /Total BUA<\/div>\s*\n\s*<strong[^>]*data-testid="globals-gfa"/.test(tabSrc)
    && /NSA or GLA<\/div>\s*\n\s*<strong[^>]*data-testid="globals-nsa"/.test(tabSrc)
    && !/>BUA<\/div>/.test(tabSrc) && !/>GFA<\/div>/.test(tabSrc));

  // ── SUB-UNITS. The table showed area, unit size and count and offered no way
  // to type the unit size, so three of four live rows could not derive a count
  // at all. The inputs the rule needs are now there.
  const subStart = tabSrc.indexOf('function SubUnitsTable(');
  const subEnd = tabSrc.indexOf('// ── AssetCard');
  const subBody = subStart >= 0 && subEnd > subStart ? tabSrc.slice(subStart, subEnd) : '';
  check('U26 unit size is TYPED per sub-unit, which is what makes a count derivable',
    subBody.length > 500
    && subBody.includes('subunits-row-${u.id}-unit-size')
    && /onCommit=\{\(v\) => onUpdate\(u\.id, \{ unitArea: v \}\)\}/.test(subBody));
  check('U27 share and area are ONE pair: typing either sets the other',
    subBody.includes('subunits-row-${u.id}-share')
    && /metricValue: v === undefined \? 0 : \(nsa \* v\) \/ 100/.test(subBody)
    // In count mode the count is the input, so the share is shown derived
    // rather than offered as a second way to say the same thing.
    && /isUnits \|\| nsa <= 0 \?/.test(subBody));
  check('U28 the count is NSA over unit size, rounded, and a missing size is a DASH not a zero',
    /Math\.round\(u\.metricValue \/ unitArea\)/.test(subBody)
    && /unitArea > 0 \?/.test(subBody)
    && subBody.includes('This is not a count of zero.'));
  const groupStart = tabSrc.indexOf('function groupSubUnitsByAsset(');
  const groupBody = groupStart >= 0 ? tabSrc.slice(groupStart, subStart) : '';
  check('U29 the parts are checked against the asset OWN entered NSA, per asset',
    groupBody.length > 300
    && /const nsa = Math\.max\(0, asset\?\.sellableBuaSqm \?\? 0\);/.test(groupBody)
    // NEVER THE DERIVED CHAIN FIGURE. Sourcing the check from the chain would
    // put the derivation into an editing surface, which is the one thing this
    // step must not do. Both the grouping and the render are checked: the
    // number is chosen in the first and only displayed by the second.
    // The IDENTIFIER, not the word: both spans carry prose saying the chain is
    // deliberately not consulted here, and a bare word match reads those
    // sentences as the very thing they rule out. Second time this exact shape
    // has bitten in one session (see D5 in verify-asset-type-standards), and
    // `chain\.` alone was still not enough: it matched a sentence ENDING in
    // the word. A property access needs a property.
    && ![groupBody, subBody].some((b) => /netSaleableSqm|\bchain\.\w|computeLandChain/.test(b))
    && subBody.includes('Sub-units sum to NSA')
    && subBody.includes('Under-allocated') && subBody.includes('Over-allocated'));
  check('U29b a sub-unit whose asset is gone is still listed, so no row becomes undeletable',
    /const orphans = \[\.\.\.byAssetId\.values\(\)\]\.flat\(\)/.test(tabSrc)
    && /if \(orphans\.length > 0\) emit\(undefined, orphans\)/.test(tabSrc));
  check('U30 the rate column NAMES its basis, per row, through the one existing helper',
    subBody.includes('subunits-row-${u.id}-rate-basis')
    && /rateUnitLabel\(u\.category, isUnits \? 'units' : 'area'\)/.test(subBody)
    && subBody.includes('Rate Basis'));
  check('U31 headers WRAP and are CENTRED in both tables',
    /textAlign: 'center'/.test(tabSrc.slice(tabSrc.indexOf('const TH_T'), tabSrc.indexOf('const TABLE_INPUT')))
    && /whiteSpace: 'normal'/.test(tabSrc.slice(tabSrc.indexOf('const TH_T'), tabSrc.indexOf('const TABLE_INPUT')))
    && /const TH_N: React\.CSSProperties = \{ \.\.\.TH_T \};/.test(tabSrc));
  check('U14 the plot grouping is one shared header, and the CHECK is on the input table only',
    tabSrc.includes('function PlotHeaderRow(')
    && tabSrc.includes('showCheck onAddAsset={onAddAsset}')
    && tabSrc.includes('showCheck={false}')
    && tabSrc.includes('plot-group-${g.key}-check'));
  // The two split entries are dropped from this list with the feature (U3
  // asserts they are gone); the rest of what a row cannot hold still has a
  // home, and the rate-annotated parcel picker is now the reason the land
  // block stays in the drawer at all.
  check('U6 what a row CANNOT hold still has a home in the drawer',
    ['-area-reconciliation', '-land-rate-issue', '-companion-badge',
      '-standards-values', '-land-allocation-block', '-parcelId']
      .every((k) => tabSrc.includes(`asset-\${asset.id}${k}`))
    && tabSrc.includes('<LandChainSection'));

  // ── D. The engine does not move ─────────────────────────────────────────
  section('D. The engine is byte-identical with the chain inputs present');
  const baseState = buildExcelSampleState();
  const baseline = JSON.stringify(computeFinancialsSnapshot(baseState));
  check('D0 the fixture actually reaches the engine (a non-trivial snapshot)',
    baseline.length > 5000, `${baseline.length} chars`);

  const withChain = buildExcelSampleState();
  const CHAIN: LandChainInputs = {
    utilisationPct: 95, coveragePct: 55, retailPct: 20, servicePct: 18,
    farRatio: 3.2, retailAreaPerSlotSqm: 25,
  };
  for (const a of withChain.assets as Array<Record<string, unknown>>) a.landChain = { ...CHAIN };
  const after = JSON.stringify(computeFinancialsSnapshot(withChain));
  if (after !== baseline) {
    let i = 0;
    while (i < baseline.length && baseline[i] === after[i]) i += 1;
    check('D1 adding chain inputs to every asset changes NOTHING the engine computes', false,
      `first difference at ${i}: baseline ...${baseline.slice(Math.max(0, i - 60), i + 60)}... after ...${after.slice(Math.max(0, i - 60), i + 60)}...`);
  } else {
    check('D1 adding chain inputs to every asset changes NOTHING the engine computes', true);
  }

  // POSITIVE CONTROL. Without this, a check that never reached the engine
  // would pass by doing nothing at all.
  //
  // The dial has to be one this FIXTURE actually reads. Parking area was the
  // first choice and it moved nothing, correctly: the sample carries no
  // parking area and its parking cost line charges per BAY, not per sqm. BUA
  // is the right control here because the fixture does carry a `rate_per_bua`
  // line, so it proves the AREA path in particular is live, which is the
  // surface the chain must leave alone.
  const moved = buildExcelSampleState();
  const firstAsset = (moved.assets as Array<Record<string, unknown>>)[0];
  firstAsset.buaSqm = Number(firstAsset.buaSqm ?? 0) + 5000;
  check('D2 positive control: a real AREA input DOES move the engine',
    JSON.stringify(computeFinancialsSnapshot(moved)) !== baseline);

  // ── E. Additive schema ──────────────────────────────────────────────────
  section('E. Additive: hydrate carries the inputs and invents none');
  const mk = (asset: Record<string, unknown>): Record<string, unknown> => ({
    version: 8,
    project: { projectName: 'Probe', modelType: 'annual', currency: 'USD' },
    phases: [{ id: 'phase_1', name: 'Phase 1', constructionPeriods: 2, operationsPeriods: 3, constructionStart: 0 }],
    parcels: [{ id: 'parcel_1', phaseId: 'phase_1', name: 'Land 1', area: 1000, rate: 100, cashPct: 100, inKindPct: 0 }],
    assets: [asset], subUnits: [], costLines: [], costOverrides: [], financingTranches: [],
    landAllocationMode: 'sqm',
  });
  const base = {
    id: 'asset_1', phaseId: 'phase_1', name: 'Tower', type: 'High End Apartments',
    strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0,
    parkingBaysRequired: 0, supportArea: 1400, parkingArea: 2800,
  };
  const plainAsset = hydrationFromAnySnapshot(mk({ ...base })).assets[0] as unknown as Record<string, unknown>;
  check('E1 an asset without chain inputs hydrates without them (nothing invented)',
    !('landChain' in plainAsset));
  const chainedAsset = hydrationFromAnySnapshot(mk({ ...base, landChain: { ...CHAIN } }))
    .assets[0] as unknown as Record<string, unknown>;
  const carried = chainedAsset.landChain as LandChainInputs | undefined;
  check('E2 chain inputs survive hydrate VERBATIM',
    carried?.utilisationPct === 95 && carried?.farRatio === 3.2 && carried?.retailAreaPerSlotSqm === 25);
  const areaKeys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired'] as const;
  check('E3 carrying chain inputs changes NO area input on the asset',
    areaKeys.every((k) => JSON.stringify(plainAsset[k]) === JSON.stringify(chainedAsset[k])));
}

async function liveChecks(): Promise<void> {
  section('F. No live project carries a chain (nothing was written anywhere)');
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    check('F0 credentials loaded (.env.local)', false, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    return;
  }
  check('F0 credentials loaded (.env.local)', true);
  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const projects = await (await fetch(`${sbUrl}/rest/v1/refm_projects?select=id,name&deleted_at=is.null`, { headers: H })).json() as Array<{ id: string; name: string }>;
  check('F1 live projects reachable', Array.isArray(projects) && projects.length > 0);
  let checked = 0;
  for (const p of Array.isArray(projects) ? projects : []) {
    const arr = await (await fetch(
      `${sbUrl}/rest/v1/refm_project_versions?select=snapshot&project_id=eq.${p.id}&order=version_number.desc&limit=1`,
      { headers: H })).json() as Array<{ snapshot: Record<string, unknown> }>;
    if (!arr[0]) continue;
    checked += 1;
    // RE-AIMED 2026-09-08: chain inputs are now IN USE on live projects, which
    // is the feature working, so "nobody has any" stopped being the invariant
    // the moment it shipped. What still has to hold is that carrying them
    // changes nothing the model computes: they round-trip verbatim through
    // hydrate and no AREA input moves. (Section D proves the engine is
    // byte-identical on a fixture; this proves the real snapshots survive.)
    const stored = (arr[0].snapshot.assets ?? []) as Array<Record<string, unknown>>;
    const hydrated = hydrationFromAnySnapshot(arr[0].snapshot).assets as unknown as Array<Record<string, unknown>>;
    const areaKeys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired'] as const;
    const intact = stored.every((raw) => {
      const hyd = hydrated.find((h) => h.id === raw.id);
      if (!hyd) return false;
      const chainSame = JSON.stringify(raw.landChain ?? null) === JSON.stringify(hyd.landChain ?? null);
      const ZERO_DEFAULTED = new Set(['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'parkingBaysRequired']);
      const areasSame = areaKeys.every((k) => {
        const before = typeof raw[k] === 'number' ? raw[k] : (ZERO_DEFAULTED.has(k) ? 0 : raw[k]);
        return JSON.stringify(hyd[k]) === JSON.stringify(before);
      });
      return chainSame && areasSame;
    });
    check(`F2 ${p.name}: chain inputs round-trip verbatim and no area input moves`, intact);
  }
  check('F3 every live project was actually checked', checked >= 4, `${checked} checked`);
}

async function main(): Promise<void> {
  console.log('=== verify-land-chain ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
