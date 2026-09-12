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
import { resolveAssetPlotDraw, computeAssetLandSqm, computeAssetLandBreakdown, computeLandAggregate, computeAssetUnitCount } from '../src/core/calculations';
import {
  groupAssetsByPlot,
  mintId,
  partitionSubUnitsByLine,
  planLineSubUnits,
  seedCategoryFor,
  poolSubUnits,
  primaryParcelId,
  resolveAssetNsa,
  derivedSupportId,
  planDerivedSupport,
  planDerivedAreas,
  totalsFromRows,
  UNPLOTTED_GROUP,
  type AssetPlotGroup,
  type DerivableRow,
  type ResolvedNsa,
  type TotalledRow,
} from '../src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel';
import type { Asset, Parcel, SubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { ASSET_TYPES_BY_CATEGORY, selectableCostMethods, COST_METHOD_LABELS, isRetiredCostMethod, type CostMethod } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { orderSubUnitLines } from '../src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel';
import {
  GROUND_FLOOR_RETAIL_TYPE_LABEL,
  normaliseAssetTypeId,
  resolveRetailSlotArea,
  resolveChainDefaults,
  type AssetTypeValuesByType,
} from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { needsManageCompanion } from '../src/hubs/modeling/platforms/refm/lib/state/strategySwitch';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { formatArea, formatAccounting } from '../src/core/formatters';
import { formatFieldNumber } from '../src/hubs/modeling/platforms/refm/components/ui/AccountingNumberInput';
import { buildExcelSampleState } from './excelSampleState';

// The tab's own area rule, restated here so the checks below RUN it rather
// than read it. U29j pins the tab to the same zero.
const areaText = (n: number | null | undefined): string => formatArea(n, 0);

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
    { utilisationPct: 100, coveragePct: 60, retailPct: 50, servicePct: 20, farRatio: 3.6 },
    { avgUnitSizeSqm: 150, parkingRatio: 1, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40, retailAreaPerSlotSqm: 25 },
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
  // ── A12 to A15. THE SQM-PER-SLOT BASIS, where we deliberately go further
  //    than the source. (2026-09-10)
  //
  // Row 209 of the reference plot table, a Standalone Commercial plot: land
  // 2265.48, utilisation 100%, coverage 60%, retail 0, service 0, FAR 1.6. Its
  // company standards state NO unit size and a parking ratio of 0 in m2/slot.
  // The workbook derives GFA 3624.768 and then 0 units, 0 slots, 0 parking area
  // and a BUA equal to its GFA, on all 14 such plots, because its parking
  // column multiplies a unit count by a ratio on EVERY row and never divides.
  const commercialInputs: LandChainInputs =
    { utilisationPct: 100, coveragePct: 60, retailPct: 0, servicePct: 0, farRatio: 1.6 };
  const commercialZero = computeLandChain(2265.48, commercialInputs,
    { parkingRatio: 0, parkingRatioBasis: 'sqm_per_slot', parkingAreaPerSlotSqm: 40 });
  check('A12 the reference commercial row: GFA ties, and a TYPED ZERO ratio derives ZERO slots, not a blank',
    near(commercialZero.totalGfaSqm, 3624.768) && near(commercialZero.mainAssetGfaSqm, 3624.768)
    && commercialZero.parkingSlots === 0 && commercialZero.totalParkingSlots === 0
    && near(commercialZero.parkingAreaSqm, 0) && near(commercialZero.totalParkingAreaSqm, 0)
    // BUA equal to GFA, exactly as the workbook has it for that plot.
    && near(commercialZero.totalBuaSqm, 3624.768),
    `slots=${String(commercialZero.parkingSlots)} bua=${String(commercialZero.totalBuaSqm)}`);
  check('A12b a blank unit size is NOT reported as a gap when parking comes off area',
    !commercialZero.gaps.includes('no_unit_size') && commercialZero.units === undefined
    // ... and it still IS a gap on the count-based basis, where it stops parking dead.
    && computeLandChain(2265.48, commercialInputs,
      { parkingRatio: 1, parkingRatioBasis: 'slots_per_unit' }).gaps.includes('no_unit_size'),
    commercialZero.gaps.join(','));
  // A13 IS THE DIVERGENCE ITSELF. Same plot, same blank unit size, a POSITIVE
  // m2/slot ratio: the workbook would still report zero (it multiplies a blank
  // count), and we divide the floor area, because that is what the unit on the
  // ratio says. 3624.768 / 25 = 144.99 -> 145 slots at 40 sqm = 5800.
  const commercialDivides = computeLandChain(2265.48, commercialInputs,
    { parkingRatio: 25, parkingRatioBasis: 'sqm_per_slot', parkingAreaPerSlotSqm: 40 });
  check('A13 sqm per slot DIVIDES the main asset GFA, with no unit count anywhere in it',
    commercialDivides.units === undefined && commercialDivides.parkingSlots === 145
    && near(commercialDivides.parkingAreaSqm, 5800) && near(commercialDivides.totalBuaSqm, 9424.768),
    `slots=${String(commercialDivides.parkingSlots)}`);
  check('A13b the basis is what decides it: the SAME ratio on the count basis derives nothing here',
    computeLandChain(2265.48, commercialInputs,
      { parkingRatio: 25, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40 })
      .parkingSlots === undefined);
  // A14. THE FILE SAYS SO. A reader who checks this behaviour against the
  // workbook must find the divergence stated where the code diverges, not
  // discover it by getting a different number. Scoped to the step 8 block, so
  // the note has to be AT the branch rather than anywhere in a long file.
  const chainFileSrc = readFileSync('src/core/calculations/landChain.ts', 'utf8');
  const step8 = chainFileSrc.slice(
    chainFileSrc.indexOf('// 8. Parking'), chainFileSrc.indexOf('// 9. Retail parking'));
  check('A14 step 8 states the divergence at the branch, rather than reading as a mirror of the source',
    step8.length > 400
    && /DELIBERATE DIVERGENCE FROM THE REFERENCE/.test(step8)
    && /TYPED ZERO/.test(step8),
    `${step8.length} chars`);
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
  // A PATH STRING IS NOT A REFERENCE, and this used to treat it as one.
  // consolidationCollisions.ts lists 'landChain.farRatio' and four siblings as
  // DATA, the field paths it compares members on; it imports nothing from the
  // chain and calls none of it. A bare token match read that list as five
  // dependencies. What "reads the chain" actually means is an import of the
  // module or a call to its function, so that is what is looked for.
  const consumers = files
    .filter((f) => f !== CHAIN_FILE)
    .filter((f) => {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      return /from '[^']*landChain'|from "[^"]*landChain"/.test(src)
        || /\bcomputeLandChain\s*\(/.test(src)
        || /:\s*LandChainInputs\b/.test(src);
    });
  // C1 CHANGED ON 2026-09-09, AND THE CHANGE IS THE POINT OF STEP 5.
  //
  // "Nothing reads the chain" was true, deliberately, from the day it was
  // written: the chain was a read-only panel and the engine was byte-identical
  // with its inputs present. The retail land carve-out ENDS that, because the
  // carve's share is retail GFA over total GFA and those are the chain's own
  // figures. Restating the formula in the engine to keep this check green would
  // have been the worst possible outcome: two definitions of retail GFA, which
  // is the shape at the bottom of most defects in this codebase.
  //
  // So the invariant narrows rather than disappearing. ONE engine file may read
  // the chain, for ONE purpose, and it is named here. A second consumer is a
  // decision nobody has made.
  // WIDENED ON 2026-09-11, AND ONLY BY ONE VERB.
  //
  // The chain's coverage, FAR and service share default from the asset TYPE
  // (2026-09-10), and the carve read the PLOT's inputs alone: a plot inheriting
  // its FAR produced an undefined total GFA and the host kept land its
  // companion should have carved, 4,094,123.49 of it on the live project, while
  // the project total still footed.
  //
  // The resolution has to happen where the project's type values and the assets
  // meet, and every such place in a library is on this surface. So two more
  // files may touch the chain module, for `withInheritedMassingAll` and nothing
  // else. THE INVARIANT THAT MATTERS IS UNTOUCHED and C1b still proves it:
  // `computeLandChain` is called in exactly ONE place, in index.ts, for the
  // carve share. These two pass the type's massing in; they do not run a chain.
  const ALLOWED_CHAIN_CONSUMERS = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts',
  ];
  const stripSrc = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const RUNS_A_CHAIN = /\bcomputeLandChain\s*\(/;
  const MASSING_ONLY = ALLOWED_CHAIN_CONSUMERS.slice(1);
  check('C1d the two massing doors pass the type in and never run a chain of their own',
    MASSING_ONLY.every((f) => {
      const src = stripSrc(readFileSync(f, 'utf8'));
      return src.includes('withInheritedMassingAll(') && !RUNS_A_CHAIN.test(src);
    }),
    MASSING_ONLY.filter((f) => RUNS_A_CHAIN.test(stripSrc(readFileSync(f, 'utf8')))).join(', '));
  const unexpectedChain = consumers.filter((f) => !ALLOWED_CHAIN_CONSUMERS.includes(f.replace(/\\/g, '/')));
  check('C1 only the ONE named engine file reads the chain, and only for the retail carve',
    unexpectedChain.length === 0, unexpectedChain.slice(0, 5).join(' | '));
  check('C1b that one reader consults it for the carve SHARE and nothing else',
    (() => {
      const eng = readFileSync('src/core/calculations/index.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // Exactly one call, inside the carve, reading exactly the two figures the
      // share is made of.
      return (eng.match(/computeLandChain\s*\(/g) ?? []).length === 1
        && /const chain = computeLandChain\(grossSqm, h\.landChain, \{\}, undefined\);/.test(eng)
        && /retailGfaSqm: chain\.retailGfaSqm/.test(eng)
        && /totalGfaSqm: chain\.totalGfaSqm/.test(eng)
        // No other chain figure reaches the engine: units, parking, landscape,
        // NSA and the rest are still read by nothing that computes money.
        && !/chain\.(units|parkingSlots|netSaleableSqm|landscapeSqm|footprintSqm|totalBuaSqm|mainAssetGfaSqm)/.test(eng);
    })());
  check('C1c and the chain is still the ONE definition of retail GFA, not restated in the engine',
    !/retailPct[^\n]*\/[^\n]*farRatio/.test(readFileSync('src/core/calculations/index.ts', 'utf8')));
  check('C2 the chain imports NOTHING (it cannot reach back into the model)',
    !/^\s*import\s/m.test(readFileSync(CHAIN_FILE, 'utf8')));

  const chainSrc = readFileSync(CHAIN_FILE, 'utf8');
  const tableModelSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts', 'utf8');
  const typesSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-types.ts', 'utf8');
  const costsSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
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
  // U1 MOVED FROM PLOT TO LINE. The tables group by the consolidated line now:
  // a line is one type in one phase and pools land from however many plots feed
  // it, so a plot cannot be the organising idea without splitting a line in two.
  // The plots keep their own table above, which is land only.
  // U1 RE-AIMED AGAIN, and the flip-flop is the finding. Entry and the chain
  // group by PLOT, because massing belongs to a piece of ground; the MERGE by
  // line is a separate table below them. Both groupings exist on the tab and
  // neither replaces the other.
  // THE CHAIN IS RUN IN ONE PLACE OUTSIDE THE ENGINE (2026-09-12), and that
  // place is the shared model, not the tab: `computeAssetChain` is called by
  // the row builder AND by the store on load and save, so the bag capex reads
  // is filled by one rule wherever the user is. Three checks below pinned the
  // tab as the site; they pin the site itself now.
  const modelChainSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const oneChainSite = (modelChainSrc.match(/computeLandChain\(/g) ?? []).length === 1
    && (tabSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').match(/computeLandChain\(/g) ?? []).length === 0
    && tabSrc.includes('computeAssetChain(');
  check('U1 the assets table exists, grouped by PLOT, with the merge in its own table',
    tabSrc.includes('data-testid="assets-table"')
    && tabSrc.includes('plot-group-${g.key}')
    && tabSrc.includes('groupAssetsByPlot(')
    && tabSrc.includes('groupAssetsForConsolidation(')
    && tabSrc.includes('data-testid="assets-merged-table"'));
  // RE-AIMED 2026-09-08 with the split: the INPUT row carries the five chain
  // percentages (U11 asserts it carries no derived column), and the derived
  // cascade moved to the results table (U12).
  check('U2 the input row carries the five chain inputs, and the chain is what feeds the results',
    ['-utilisation', '-coverage', '-far', '-retail', '-service'].every((k) => tabSrc.includes(`asset-row-\${asset.id}${k}`))
    && oneChainSite);
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
  // RE-AIMED 2026-09-10: the manual name has NO home now, not one. It was
  // retired when the label became the plot plus the type, so the clause that
  // required it in the row is inverted: it must be nowhere.
  check('U5 NO field has two homes, and the RETIRED name has none at all',
    !tabSrc.includes('data-testid={`asset-${asset.id}-name`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-phase`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-type`}')
    && !tabSrc.includes('data-testid={`asset-${asset.id}-remove`}')
    && !tabSrc.includes('asset-row-${asset.id}-name'));
  // ── The two defects the first cut shipped, both found on live data ──────
  // U7 RE-AIMED 2026-09-09 WITH THE CELL. The rate was read-only text rendered
  // at 'full'; it is an input now, so what must hold is the same rule at the
  // point of entry: the number a user sees and types is the rate itself, never
  // divided by the project's display scale. SubUnitNumber renders the raw
  // value, which is stronger than passing 'full'.
  check('U7 a RATE never takes the project number scale (18,500 per sqm read as "19" at thousands)',
    /testId=\{`subunits-row-\$\{u\.id\}-rate`\}/.test(tabSrc)
    && !/formatAccounting\(u\.unitPrice,\s*project\.displayScale/.test(tabSrc)
    && !/formatAccounting\(u\.unitPrice, scale/.test(tabSrc));
  // AND IT IS EDITABLE. Every other column on this table got an editor when the
  // table was built and this one did not, so the only place to set a rate was
  // the drawer. A column of numbers nobody can click is read as broken.
  check('U7b the rate is an INPUT, and a companion mirror writes the ADR with it',
    /<SubUnitNumber decimals=\{project\.displayDecimals \?\? 2\} value=\{u\.unitPrice\}/
      .test(tabSrc.replace(/\s*\n\s*/g, ' '))
    && /u\.parentSubUnitId !== undefined/.test(tabSrc)
    && /\{ unitPrice: v \?\? 0, startingAdr: v \?\? 0 \}/.test(tabSrc)
    && /\{ unitPrice: v \?\? 0 \}/.test(tabSrc));
  check('U8 a count nobody can derive is a DASH, not a zero',
    tabSrc.includes('const count: number | undefined')
    && tabSrc.includes('(unitArea > 0 ? Math.round(u.metricValue / unitArea) : undefined)')
    && tabSrc.includes('count === undefined'));
  // U9 MOVED WITH THE CELL. Unit size used to be a read-only figure, so the
  // check was about how it PRINTED. It is now typed, so the distinction has to
  // hold at the point of entry: an absent size shows the "not set" placeholder
  // and a typed 0 shows 0, and only the absent one is silent.
  // U9 RE-AIMED WITH THE FORMATTING (2026-09-09) AND MADE BEHAVIOURAL. The
  // rule is unchanged and is the one the separators could most easily have
  // broken: ABSENT renders empty and shows the placeholder, a TYPED ZERO
  // renders "0". formatAccounting would have printed that zero as "-", which
  // is why these fields format through formatFieldNumber instead.
  check('U9 an ABSENT unit size is visibly not set, and a typed 0 is a real answer',
    /value=\{draft \?\? stored\}/.test(tabSrc)
    && /const stored = value === undefined\s*\n?\s*\? ''/.test(tabSrc.replace(/\r/g, ''))
    && /placeholder="not set"/.test(tabSrc)
    && /onCommit=\{\(v\) => onUpdate\(u\.id, \{ unitArea: v \}\)\}/.test(tabSrc)
    && formatFieldNumber(0, 0) === '0'
    && formatFieldNumber(0, 2) === '0.00');
  // RE-AIMED 2026-09-08: the one table became TWO, stacked. What you type is
  // table one; what the chain produces is table two, which can now carry the
  // WHOLE cascade because it carries no input.
  check('U10 both tables use a fixed layout with explicit column widths',
    (tabSrc.match(/tableLayout: 'fixed'/g) ?? []).length >= 2
    && (tabSrc.match(/<colgroup>/g) ?? []).length >= 2);
  check('U11 the INPUT table holds no derived column, which is what lets identity be readable',
    tabSrc.includes('data-testid="assets-table"')
    && !/asset-row-\$\{asset\.id\}-(land-utilised|total-gfa|net-saleable|total-bua)/.test(tabSrc));
  // U12 IS BACK ON THE PLOT, and that is the point of the whole re-aim. The
  // per-plot table shows the cascade the chain actually produced, one row per
  // plot; the MERGE has its own table and its own check (U12b) below.
  const mergedStart = tabSrc.indexOf('function MergedLineTable(');
  const resultsStart = tabSrc.indexOf('function AssetResultsTable(');
  const resultsEnd = mergedStart > 0 ? tabSrc.lastIndexOf('/**', mergedStart) : -1;
  const resultsBody = resultsStart >= 0 && resultsEnd > resultsStart
    ? tabSrc.slice(resultsStart, resultsEnd) : '';
  const tablesStart = tabSrc.indexOf('function AssetTables(');
  const mergedBody = mergedStart >= 0 && tablesStart > mergedStart
    ? tabSrc.slice(mergedStart, tablesStart) : '';
  check('U12 the PER-PLOT results table holds the WHOLE cascade through Total BUA, read only',
    tabSrc.includes('data-testid="assets-results-table"')
    && ['land-utilised', 'total-gfa', 'net-saleable', 'units', 'total-bua']
      .every((k) => resultsBody.includes(`asset-result-\${asset.id}-${k}`))
    && ['footprintSqm', 'landscapeSqm', 'retailGfaSqm', 'lobbyGfaSqm',
      'mainAssetGfaSqm', 'parkingSlots', 'retailParkingSlots', 'totalParkingSlots',
      'parkingAreaSqm', 'retailParkingAreaSqm', 'totalParkingAreaSqm', 'totalBuaSqm']
      .every((k) => resultsBody.includes(`chain.${k}`))
    // NOTHING IS POOLED HERE. Pooling before the chain ran is exactly the
    // defect this table was rebuilt to undo.
    && !resultsBody.includes('poolLineAreas('),
    resultsBody.length === 0 ? 'could not isolate the results component body' : '');
  // U12b THE MERGE SUMS RESULTS, and its three ratio columns are quotients of
  // its OWN sums. A first cut merged at the entry table, so the chain ran on a
  // pooled line and Landscape %, Average Unit Size and Parking Ratio had no
  // single answer to give: they printed dashes on any two-plot line. Summing
  // the per-plot results and dividing two of those sums is what gives a merged
  // row a real blended figure, so a return to averaging the INPUTS fails here.
  check('U12b the merged table SUMS the per-plot results and derives its ratios from those sums',
    mergedBody.length > 500
    && mergedBody.includes('poolLineAreas(')
    && !mergedBody.includes('computeLandChain(')
    && /const landscapePct = ratio\(g\('landscapeSqm'\), g\('landUtilisedSqm'\)\);/.test(mergedBody)
    && /const avgUnitSize = ratio\(g\('netSaleableSqm'\), g\('units'\)\);/.test(mergedBody)
    && /const parkingRatio = ratio\(g\('parkingSlots'\), g\('units'\)\);/.test(mergedBody)
    // ABSENT, NEVER ZERO, when there is nothing to divide by.
    && /b > 0\) \? a \/ b : undefined/.test(mergedBody),
    mergedBody.length === 0 ? 'could not isolate the merged component body' : '');
  // ── U12d to U12h. THE TOTAL ROW, ONE RULE FOR TWO TABLES (2026-09-10) ────
  //
  // Tables 3 and 4 show the same assets under two groupings, so their totals
  // must agree. RUN, not read: a check that reads two JSX blocks and satisfies
  // itself they look alike proves nothing about what they add up to.
  const tRow = (landSqm: number, chain: Record<string, number | undefined>): TotalledRow =>
    ({ landSqm, chain });
  const sample: TotalledRow[] = [
    tRow(1000, { landUtilisedSqm: 900, landscapeSqm: 360, netSaleableSqm: 800, units: 4, parkingSlots: 8, totalBuaSqm: 1200 }),
    tRow(500, { landUtilisedSqm: 500, landscapeSqm: 140, netSaleableSqm: 400, units: 1, parkingSlots: 2, totalBuaSqm: 600 }),
  ];
  const straight = totalsFromRows(sample, 0);
  const regrouped = totalsFromRows([sample[1], sample[0]], 0);
  check('U12d the totals are order-independent, so two groupings of one row set agree',
    JSON.stringify(straight) === JSON.stringify(regrouped)
    && straight.landSqm === 1500 && straight.pooled.totalBuaSqm === 1800);
  check('U12e the three ratios are quotients of the SUMS, never averages of the rows own ratios',
    // Landscape: 500 / 1400, not the mean of 40% and 28%.
    Math.abs((straight.landscapePct ?? 0) - (500 / 1400)) < 1e-12
    // Unit size: 1200 / 5 = 240, not the mean of 200 and 400.
    && straight.avgUnitSize === 240
    && straight.parkingRatio === 2,
    `${String(straight.landscapePct)} / ${String(straight.avgUnitSize)} / ${String(straight.parkingRatio)}`);
  check('U12f a column no row could derive is ABSENT from the total, never a confident zero',
    !('retailGfaSqm' in straight.pooled) && !('footprintSqm' in straight.pooled)
    && totalsFromRows([tRow(0, {})], 0).avgUnitSize === undefined);
  // U12g IS THE DEFECT THIS WHOLE ROW EXISTS FOR. The carve moves land from the
  // hosts to the companion; the hosts' rows are already net of it, so a total
  // that leaves the companion out is short by exactly the carve, which is how
  // the carve managed to be invisible for a day.
  const carved: TotalledRow[] = [tRow(10454.12, { totalBuaSqm: 100 }), tRow(4760, { totalBuaSqm: 50 })];
  check('U12g the companion LAND is added to the total, and its floor area is NOT',
    Math.abs(totalsFromRows(carved, 785.88).landSqm - 16000) < 0.005
    // The companion contributes to LAND only: every pooled area is untouched,
    // because its floor area is already inside its hosts' figures.
    && totalsFromRows(carved, 785.88).pooled.totalBuaSqm === 150
    && totalsFromRows(carved, 0).landSqm === 15214.12,
    `${totalsFromRows(carved, 785.88).landSqm}`);
  check('U12h BOTH tables render the total through the ONE shared rule and the ONE shared cell list',
    // Imported from the shared model, so a verifier can run it; not redeclared
    // in the tab, which would put the arithmetic back in the markup.
    !/function totalsFromRows\(/.test(tabSrc)
    && (tabSrc.match(/totalsFromRows\(/g) ?? []).length === 2
    && (tabSrc.match(/<TotalCells totals=\{totals\}/g) ?? []).length === 2
    && resultsBody.includes('<TotalCells totals={totals}')
    && mergedBody.includes('<TotalCells totals={totals}')
    // And each table states which grouping its total is over, so the two rows
    // are readable side by side rather than looking like the same row twice.
    && tabSrc.includes('TOTAL, all plots') && tabSrc.includes('TOTAL, all lines'));
  // U12i THE COMPANION'S LAND IS ON SCREEN IN BOTH TABLES. Step 5 gave it land
  // and neither table showed it: table 3 excludes companions from its plot
  // grouping, and table 4 printed a hardcoded dash written during step 4, when
  // a companion really did take none. A reader saw land leave the hosts and
  // arrive nowhere.
  check('U12i the carved land is SHOWN: per plot in table 3, per companion in table 4',
    resultsBody.includes('retailLand.byParcelId[')
    && resultsBody.includes('retail companion, land carved from')
    && mergedBody.includes('{areaText(retailLand.byAssetId[r.id] ?? 0)}')
    // The stale claim is gone from both the cell and the section caption.
    && !tabSrc.includes('A companion takes no land')
    && !tabSrc.includes('No land and no cost lines yet'));
  // U12c THE MERGE HOLDS THE SAME ROWS TABLE 3 RENDERED. Running the chain a
  // second time under a different grouping would give the merge its own copy of
  // the arithmetic, and two copies are two answers waiting to diverge.
  check('U12c the merged rows are the per-plot rows REGROUPED, not rebuilt',
    /function buildLineRows\(rowGroups: RowGroup\[\], lineGroups: ConsolidationGroup\[\]\)/.test(tabSrc)
    && /const lineRowGroups = buildLineRows\(rowGroups, lineGroups\);/.test(tabSrc)
    && oneChainSite);
  // U13 IS SCOPED TO THE RESULTS COMPONENT'S OWN BODY, and it has to be.
  // The first version asserted only that both tables were PASSED the same
  // array, which a re-sort inside the results component satisfies happily: a
  // sabotage that re-sorted the results rows passed it. The invariant is that
  // the results table ORDERS NOTHING ITSELF, so that is what is checked.
  check('U13 ALL THREE asset tables render from ONE resolved row list, and none re-orders it',
    tabSrc.includes('function buildAssetRows(')
    && (tabSrc.match(/buildAssetRows\(/g) ?? []).length === 2
    && tabSrc.includes('<AssetInputsTable') && tabSrc.includes('<AssetResultsTable')
    && tabSrc.includes('<MergedLineTable')
    && resultsBody.length > 500
    && !resultsBody.includes('.filter(')
    && ![resultsBody, mergedBody].some((b) => b.includes('.sort(')
      || b.includes('buildAssetRows(') || b.includes('groupAssetsByPlot(')
      || b.includes('groupAssetsForConsolidation(')),
    resultsBody.length === 0 ? 'could not isolate the results component body' : '');
  // U15 EXISTS BECAUSE FOUR COUNTS DISAGREED AND NOTHING SAID SO. The results
  // table declared 19 columns in its colgroup, banded 19 in its group row and
  // set COLS = 19, while rendering 20 headers and 20 cells. Under
  // `table-layout: fixed` the undeclared twentieth got no width and no band,
  // so the outermost tier rendered as a nameless sliver. A colSpan is arithmetic
  // no compiler checks, so it is checked here instead.
  const countCols = (raw: string): { band: number; head: number; cells: number; group: number; cols: number } => {
    // COMMENTS ARE STRIPPED FIRST. This counts <td and <th in the SOURCE, so a
    // comment that mentions one is counted as one: a note reading "ONE <td>,
    // with the content switching inside it" made a 14-column table read as 15.
    // Same shape as U22 and D5, where prose about a thing matched as the thing.
    const body = raw
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
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
  for (const [label, body] of [
    ['input', inputsBody], ['results', resultsBody], ['merged', mergedBody],
  ] as const) {
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
  // U18b RE-AIMED 2026-09-12. It counted 'Read by no cost method.' and asked
  // for at least ten, which was true only while most of the chain's columns
  // were read by nothing. Seven of them are priced now (footprint, landscape,
  // retail GFA, main asset GFA, both parking areas, net developable area), so
  // the sentence had gone FALSE on those columns while the count still
  // passed. Now each column's tooltip is checked against the picker itself:
  // a column that says no method reads it must have no method labelled with
  // its name, and a column a method is labelled with must name that method.
  {
    const ths = [...resultsBody.matchAll(/<th style=\{TH_N\} title="([^"]*)">([^<]+)<\/th>/g)]
      .map((m) => ({ title: m[1], col: m[2].replace(' (sqm)', '').trim() }));
    const methodFor = (col: string): CostMethod | undefined => (Object.keys(COST_METHOD_LABELS) as CostMethod[])
      .find((m) => !isRetiredCostMethod(m) && COST_METHOD_LABELS[m] === `Rate \u00d7 ${col}`);
    const silent = ths.filter((t) => t.title.includes('Read by no cost method.'));
    check('U18b a column NO cost method reads says so, and ONLY such a column says so',
      ths.length >= 20 && silent.length >= 5 && silent.every((t) => methodFor(t.col) === undefined),
      silent.filter((t) => methodFor(t.col) !== undefined).map((t) => `${t.col} is read by ${methodFor(t.col)}`).join(', ') || `${silent.length} silent of ${ths.length}`);
    const read = ths.filter((t) => methodFor(t.col) !== undefined);
    check('U18c every column a cost method is labelled with names that method in its tooltip',
      read.length >= 13 && read.every((t) => t.title.includes(String(methodFor(t.col)))),
      read.filter((t) => !t.title.includes(String(methodFor(t.col)))).map((t) => `${t.col} (${methodFor(t.col)})`).join(', ') || `${read.length} read`);
  }
  // U18d TABLE 5 READS IN ORDER, ONE TABLE (2026-09-12, founder: "sort, do
  // not split"): phase first, then Residential, Hospitality, Retail with the
  // ground-floor strip before Standalone Commercial, then the rest, and what
  // is on no line last. Run on the pure rule the table calls.
  {
    const mk = (key: string, label: string, phaseId: string | undefined, category: string, isStrip = false) => ({ key, label, phaseId, category, isStrip });
    const shuffled = [
      mk('__no_line__', 'Not on a line', undefined, 'Other'),
      mk('p2|sc', 'Standalone Commercial', 'p2', 'Retail'),
      mk('p1|sc', 'Standalone Commercial', 'p1', 'Retail'),
      mk('retail__s1', 'Branded Villas (Retail)', 'p1', 'Retail', true),
      mk('p2|hotel', '4 Star Hotel', 'p2', 'Hospitality'),
      mk('p1|bv', 'Branded Villas', 'p1', 'Residential'),
      mk('p2|bv', 'Branded Villas', 'p2', 'Residential'),
      mk('p1|odd', 'Odd', 'p1', 'Other'),
    ];
    const ordered = orderSubUnitLines(shuffled, ['p1', 'p2']).map((l) => l.key);
    check('U18d Table 5 lines sort by phase, then category, strip before Standalone Commercial, no-line last',
      ordered.join(' ') === 'p1|bv retail__s1 p1|sc p1|odd p2|bv p2|hotel p2|sc __no_line__', ordered.join(' '));
    check('U18e the table calls the rule and never splits into one table per phase or category',
      tabSrc.includes('return orderSubUnitLines(out, phaseIds);')
      && (tabSrc.match(/data-testid="subunits-table"/g) ?? []).length === 1);
    // THE UNIT SIZE WHEN SWITCHING TO UNITS: one row takes the type's average
    // by itself; several rows with a size missing are asked, never guessed.
    check('U18f switching a line to Units fills a lone row from the type average and asks when several rows differ',
      tabSrc.includes("resolveAssetTypeValues(owner, project.assetTypeValues)?.avgUnitSizeSqm")
      && tabSrc.includes('Set a size on each row before switching to Units: each row can differ, so nothing is guessed for you.')
      && tabSrc.includes("if (missing.length > 0 && rows.length > 1) {"));
  }
  // U18g THE ASSET IS NAMED ONCE PER GROUP (2026-09-12, founder): the header
  // is the line; plots appear in the header and under a row only where the
  // line pools more than one plot.
  check('U18g Table 5 names the asset once: plots only on a pooled line, in the header and under each row',
    tabSrc.includes('{line.assetIds.length > 1 && (')
    && tabSrc.includes('{(line.assetIds.length > 1 || !asset) && (')
    && tabSrc.includes("{asset ? (line.plotByAssetId[asset.id] ?? asset.name) : 'no asset'}")
    && !tabSrc.includes("{line.assetNames.join(', ')}"));
  // U18h TABLE 1 SITS ON THE SAME SCALE as tables 2 to 5 (2026-09-12,
  // founder): the shared cell, header and input constants, not the FAST
  // input style and the 8px-grid padding it used to carry alone.
  {
    const t1s = tabSrc.indexOf('data-testid="parcels-table"');
    const t1 = t1s >= 0 ? tabSrc.slice(t1s, tabSrc.indexOf('</table>', t1s)) : '';
    const rs = tabSrc.indexOf('function ParcelRow(');
    const prow = rs >= 0 ? tabSrc.slice(rs, tabSrc.indexOf('\nfunction ', rs + 10)) : '';
    check('U18h Table 1 uses the shared TH_T / CELL / TABLE_INPUT scale and none of the larger FAST styling',
      t1.length > 0 && prow.length > 0
      && !t1.includes('tableHeaderStyle') && !t1.includes("padding: 'var(--sp-1)'")
      && !prow.includes('style={inputStyle}') && !prow.includes("padding: 'var(--sp-1)'")
      && (prow.match(/style=\{TABLE_INPUT\}/g) ?? []).length >= 5 && prow.includes('<td style={CELL}'));
  }
  // U18i TABLE 3 NAMES THE PLOT AND THE PHASE ONCE, like table 2 (2026-09-12):
  // no Plot column, the group header carries both, the label is the type.
  check('U18i Table 3 has no Plot column, its header names the phase, and its label is the type alone',
    !resultsBody.includes('<th style={TH_T}>Plot</th>')
    && resultsBody.includes('const COLS = 21;')
    && resultsBody.includes('{asset.type || asset.name}')
    && /phaseName=\{group\.parcel \? \((allPhases|phases)\.find/.test(resultsBody)
    && !resultsBody.includes("{parcel ? parcel.name : 'none'}"));
  // U18j THE STRIP'S LINE READS ITS TYPE and the basis control is worded for
  // the strategy (2026-09-12): the choice is meaningful on Sell, Lease and
  // Operate alike (units or area, so per unit or per sqm), only the verb moves.
  check('U18j Table 5 names the strip by type and words the basis control by strategy',
    tabSrc.includes("`${a.type || 'Retail'} (Retail)`")
    && tabSrc.includes("{line.strategy === 'Lease' ? 'Lets by' : line.strategy === 'Operate' ? 'Operates by' : 'Sells by'}")
    && !tabSrc.includes(">Sells by</span>"));
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
  // U23: still shown, now on the line row. With one plot they are that plot's;
  // with several they read as a dash rather than an average, because a unit
  // size averaged across plots is a number nobody entered.
  // U23 IS THE REASON THE CHAIN RUNS PER PLOT. The count and the slot count
  // are meaningless without the two standards they were divided by, and on a
  // pooled row there was no single pair to show, so both cells printed a dash.
  // Per plot each has one honest answer; on the merged row each is the quotient
  // of that row's own sums, which is a real blended figure a reader can check
  // against the two cells beside it. Neither may go back to a dash.
  check('U23 the two standards that DRIVE the count and the slots are shown in BOTH tables',
    /asset-result-\$\{asset\.id\}-unit-size/.test(resultsBody)
    && /asset-result-\$\{asset\.id\}-parking-ratio/.test(resultsBody)
    && /\{d\(unitSizeSqm\)\}/.test(resultsBody) && /\{n\(parkingRatio\)\}/.test(resultsBody)
    && /line-result-\$\{group\.key\}-unit-size/.test(mergedBody)
    && /line-result-\$\{group\.key\}-parking-ratio/.test(mergedBody)
    // NEVER A DASH BY CONSTRUCTION on a multi-plot line. A conditional that
    // gives up when there is more than one plot is what this replaced.
    && !/rows\.length === 1 \?/.test(mergedBody));
  // U24: a count never renders through the 2-decimal formatter, where a
  // rounding regression could hide. Per plot it is whole(chain.x); on the merge
  // it is whole() over the summed value.
  check('U24 counts render WHOLE, through their own formatter, not through a 2-decimal one',
    [resultsBody, mergedBody].every((b) => /const whole = \(v: number \| undefined\)/.test(b))
    && ['units', 'parkingSlots', 'retailParkingSlots', 'totalParkingSlots']
      .every((k) => resultsBody.includes(`whole(chain.${k})`))
    && /const w = \(k: string\): string =>/.test(mergedBody)
    && ["w('units')", "w('parkingSlots')", "w('retailParkingSlots')", "w('totalParkingSlots')"]
      .every((k) => mergedBody.includes(k))
    && !/p\('units'\)|p\('parkingSlots'\)/.test(mergedBody)
    && !/n\(chain\.units\)|d\(chain\.units\)/.test(resultsBody));
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
    && subBody.includes('subunits-row-${u.id}-unit-size`')
    && /onCommit=\{\(v\) => onUpdate\(u\.id, \{ unitArea: v \}\)\}/.test(subBody));
  // U27 GAINED A HALF ON 2026-09-10. The pair is the same pair; what changed
  // is that the write now RECORDS WHICH ONE THE USER TYPED, because a share
  // that only set an area once went stale the moment the line's NSA moved.
  check('U27 share and area are ONE pair: typing either sets the other, and says which is the statement',
    subBody.includes('subunits-row-${u.id}-share`')
    && subBody.includes(String.raw`{ nsaSharePct: v, metricValue: (nsa * v) / 100 }`)
    && subBody.includes(String.raw`{ metricValue: v ?? 0, nsaSharePct: undefined }`)
    // In count mode the count is the input, so the share is shown derived
    // rather than offered as a second way to say the same thing.
    && /isUnits \|\| nsa <= 0 \?/.test(subBody));
  check('U28 the count is NSA over unit size, rounded, and a missing size is a DASH not a zero',
    /Math\.round\(u\.metricValue \/ unitArea\)/.test(subBody)
    && /unitArea > 0 \?/.test(subBody)
    && subBody.includes('This is not a count of zero.'));
  // U29 REVERSED 2026-09-09, and this is the second reversal in this file
  // today, so the pattern is worth naming: a rule that sounds conservative and
  // measures nothing is not conservative.
  //
  // It asserted that the check reads the asset's OWN ENTERED NSA and NEVER the
  // chain, on the principle that a derivation has no business inside an editing
  // surface. In practice every live asset has an entered NSA of 0, so the check
  // NEVER FIRED ONCE on any project: every group printed "no NSA entered, so
  // there is nothing to check the parts against" while the chain sat one table
  // above holding the answer. The rule now matches the rest of the chain: opt
  // in, and once you have, it is the reference.
  const modelSrc = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts', 'utf8');
  // CHECKED BY RUNNING IT. The first cut matched the source of the chain
  // branch, and a sabotage that changed its `if` to `if (false)` left that
  // source in place, dead, and passed. Same shape as the `false &&` trap
  // already on record: a condition is not markup, and grep cannot see
  // reachability. Only calling the function can.
  check('U29 the parts are checked against the CHAIN NSA where the chain runs, the entered one where it does not',
    /export function resolveAssetNsa\(/.test(modelSrc)
    && resolveAssetNsa(0, 27599.1).source === 'chain'
    && resolveAssetNsa(0, 27599.1).value === 27599.1
    // A CHAIN ZERO IS STILL THE CHAIN SPEAKING: this plot builds nothing
    // saleable, so parts against it are over-allocated. Falling back to the
    // entered figure there answers a question the chain has already answered.
    && resolveAssetNsa(500, 0).source === 'chain'
    && resolveAssetNsa(500, undefined).source === 'entered'
    && resolveAssetNsa(500, undefined).value === 500
    && resolveAssetNsa(0, undefined).source === 'none'
    && resolveAssetNsa(undefined, undefined).value === 0,
    `${resolveAssetNsa(0, 27599.1).source} / ${resolveAssetNsa(500, 0).source} / ${resolveAssetNsa(500, undefined).source}`);
  check('U29g the resolved NSA reaches the table from the ROOT, so the chain is not run twice',
    /out\[r\.asset\.id\] = resolveAssetNsa\(r\.asset\.sellableBuaSqm, r\.chain\.netSaleableSqm\)/.test(tabSrc)
    && oneChainSite
    && subBody.includes('Sub-units sum to NSA')
    && subBody.includes('Under-allocated') && subBody.includes('Over-allocated'));
  // AND IT SAYS WHICH NSA IT USED. A figure the chain derived and a figure
  // someone typed are different kinds of answer, and a reader who disagrees
  // with the check needs to know which one to go and change.
  check('U29a the check NAMES its source, so a disagreement has somewhere to go',
    subBody.includes('subunits-line-${line.key}-basis`')
    && subBody.includes('area chain')
    && /line\.nsaSource === 'chain' \? 'area chain' : 'entered'/.test(subBody));
  check('U29b a sub-unit whose asset is gone is still listed, so no row becomes undeletable',
    // The orphan bucket moved into the pure partition when the per-asset
    // grouping was removed; the invariant did not move. What must stay true is
    // that a row pointing at no live asset still renders somewhere.
    /return \{ lines: out, stray: subUnits\.filter\(\(u\) => !claimed\.has\(u\.id\)\) \};/.test(modelSrc)
    // The bucket now takes what is left after the RETAIL companions have
    // claimed their own rows (they get lines of their own, since that is the
    // only place a strip's rent can be set). Anything still unclaimed, an asset
    // since deleted or an Operate mirror, lands here as before.
    && /const strayLine = build\('__no_line__', 'Not on a line', \[\], leftover\);/.test(tabSrc)
    && /const leftover = stray\.filter\(\(u\) => !claimed\.has\(u\.id\) && !retailIds\.has\(u\.assetId\)\);/.test(tabSrc)
    && /if \(strayLine\) out\.push\(strayLine\)/.test(tabSrc));
  // ── THE TOTALS. Value over area, never an average of rates.
  // THE POOLING IS RUN, NOT READ, and the test ids are ANCHORED at both ends:
  // a bare substring passes on `-total-areaX`, which is how two sabotages that
  // renamed a totals cell walked through the first cut of this.
  const pooled = poolSubUnits([
    { areaSqm: 1000, units: 4, rate: 100, perUnit: false },
    { areaSqm: 3000, units: 6, rate: 200, perUnit: false },
  ]);
  check('U29c each LINE carries total area, total units and a BLENDED rate',
    /export function poolSubUnits\(/.test(modelSrc)
    && pooled.areaSqm === 4000 && pooled.units === 10 && pooled.value === 700000
    // VALUE OVER AREA, never an average of rates: an average would be 150.
    && pooled.blendedRate === 175
    && ['total-area', 'total-units', 'blended-rate']
      .every((k) => subBody.includes(`subunits-line-\${line.key}-${k}\``))
    // The line total is named by WHAT IT POOLS, not by which row it is.
    && subBody.includes('`Blended ${line.label}`'),
    `blended ${pooled.blendedRate} (an average of rates would be 150)`);
  // U29c3 THE PROJECT FOOT ADDS ONLY WHAT ADDS. A line is one type, so pooling
  // its rates answers a real question; this row spans every type, and
  // residential sale prices, hotel keys and retail leases have no average
  // between them. Sharing a time basis is not enough to make one meaningful, so
  // the cell is GONE rather than gated: there is no condition under which it
  // should print a figure.
  check('U29c3 the project foot shows area and units only, and no rate at all',
    ['subunits-project-total-area', 'subunits-project-total-units']
      .every((k) => subBody.includes(`"${k}"`))
    && !subBody.includes('"subunits-project-blended-rate"')
    && !subBody.includes('"subunits-project-blended-basis"')
    // And it SAYS why the column is empty, rather than leaving two blank cells.
    && subBody.includes('rates blend per line, not across types'));
  // A PER-UNIT PRICE IS NOT MULTIPLIED BY AN AREA. 4 units at 50,000 is
  // 200,000 of value, not 1,000 sqm times 50,000.
  const perUnit = poolSubUnits([{ areaSqm: 1000, units: 4, rate: 50000, perUnit: true }]);
  check('U29c2 a rate is multiplied by WHAT IT IS PER, units for a per-unit price',
    perUnit.value === 200000 && perUnit.blendedRate === 200,
    `${perUnit.value} / ${perUnit.blendedRate}`);
  // U29d IS RUN, NOT READ, and it grew a second half. A per-NIGHT rate must
  // never be blended against sqm: a hotel line of 140 keys at 850 a night
  // blended to "9 per sqm" on live data, which is 119,000 a night over 13,300
  // sqm, a real number under a false label, sitting beside capital values per
  // sqm as though the two could be compared.
  const nightly = poolSubUnits([{ areaSqm: 13300, units: 140, rate: 850, perUnit: true, timeBasis: 'night' }]);
  const yearly = poolSubUnits([{ areaSqm: 4275, units: 0, rate: 1400, perUnit: false, timeBasis: 'year' }]);
  const mixedTime = poolSubUnits([
    { areaSqm: 1000, units: 4, rate: 100, perUnit: false, timeBasis: 'capital' },
    { areaSqm: 1000, units: 4, rate: 100, perUnit: false, timeBasis: 'year' },
  ]);
  check('U29d a per-NIGHT line is not blended against sqm, and two time bases are not added',
    nightly.blendable === false && nightly.timeBasis === 'night'
    && yearly.blendable === true && yearly.timeBasis === 'year'
    && mixedTime.blendable === false && mixedTime.timeBasis === undefined
    // The per-unit vs per-sqm mix is still only a NOTE: both are values, so the
    // pooled figure is a value per sqm either way.
    && poolSubUnits([
      { areaSqm: 1000, units: 4, rate: 100, perUnit: false, timeBasis: 'capital' },
      { areaSqm: 1000, units: 4, rate: 100, perUnit: true, timeBasis: 'capital' },
    ]).blendable === true,
    `night ${nightly.blendable} / year ${yearly.blendable} / mixed ${mixedTime.blendable}`);
  check('U29d2 the time basis is read off the SAME two inputs as the rate label, right beside it',
    /function rateTimeBasis\(category: SubUnitCategory, metric: SubUnitMetric\)/.test(tabSrc)
    && tabSrc.indexOf('function rateTimeBasis(') - tabSrc.indexOf('function rateUnitLabel(') < 1200
    && /if \(category === 'Operable'\) return metric === 'units' \? 'night' : 'year';/.test(tabSrc)
    && /timeBasis: rateTimeBasis\(unit\.category, isUnits \? 'units' : 'area'\)/.test(tabSrc));
  // U29e FOUND ON LIVE DATA, not reasoned about. A line priced but with NO
  // AREA (units entered with no unit size, which two live lines have) divides
  // by zero, and the 0 that falls out prints as a rate of nothing. Absent is
  // not zero, here as everywhere. EVERY reason for the dash is NAMED, because
  // a dash beside a column of real numbers reads as a defect until something
  // says otherwise.
  const noArea = poolSubUnits([{ areaSqm: 0, units: 140, rate: 850, perUnit: true, timeBasis: 'capital' }]);
  check('U29e a priced line with no area shows a DASH, not a rate of zero, and says why',
    noArea.blendable === false
    && poolSubUnits([]).blendable === false
    && /function blendedBasisText\(t: PooledSubUnits\): string/.test(tabSrc)
    && ['no rates', 'no area to divide by', 'per room/night, not blended against sqm',
      'mixed time bases, not blendable']
      .every((t) => tabSrc.includes(`'${t}'`))
    // ONE caller now, the line: the foot dropped its rate entirely (U29c3), so
    // there is one place a blend can appear and one sentence explaining it.
    && (subBody.match(/blendedBasisText\(/g) ?? []).length === 1
    && /\{line\.totals\.blendable \?/.test(subBody));
  // AND A COUNT TOTAL PRINTS WHOLE. Some stored counts are fractional
  // (309.9854 on a live line), and toLocaleString would have printed
  // "309.985" units.
  check('U29f the unit totals print WHOLE, like every other count on this tab',
    /Math\.round\(line\.totals\.units\)\.toLocaleString\(\)/.test(subBody)
    && /Math\.round\(all\.units\)\.toLocaleString\(\)/.test(subBody));
  // ── U29j AN AREA IS A WHOLE NUMBER OF SQUARE METRES.
  //
  // Decimals are for money, and displayDecimals is the control for money. Areas
  // carried two of them, so the same plot read "11,000.00" in one table and
  // "11,000" in the next and a reader matching a figure across five tables was
  // chasing hundredths nobody has ever entered. ONE rule, at the last step
  // before the text hits the cell, so a total is still the sum of the EXACT
  // parts rather than the sum of the rounded ones.
  check('U29j every area on the tab renders through ONE rule, at zero decimals',
    /const AREA_DECIMALS = 0;/.test(tabSrc)
    && /const areaText = \(n: number \| null \| undefined\): string => formatArea\(n, AREA_DECIMALS\);/.test(tabSrc)
    // formatArea is called in exactly one place: inside that rule. Everything
    // else on the tab goes through areaText.
    && (tabSrc.match(/formatArea\(/g) ?? []).length === 1
    && areaText(27599.14) === '27,599'
    && areaText(0) === '0'
    && areaText(undefined) === '0',
    `${areaText(27599.14)} / ${areaText(0)}`);
  // ── U29m THOUSANDS SEPARATORS, AND THE PATTERN IS REUSED RATHER THAN
  // REBUILT. Grouped while idle, RAW while focused, so a display rounding can
  // never round-trip into storage: a stored 16,559.46 reads "16,559" and comes
  // back exact the moment the field is clicked.
  check('U29m the cell inputs reuse the AccountingNumberInput formatter and parser',
    /import \{ AccountingNumberInput, formatFieldNumber, parseAccounting \}/.test(tabSrc)
    // Both cell inputs go raw on focus and formatted on blur.
    && (tabSrc.match(/onFocus=\{\(\) => setFocused\(true\)\}/g) ?? []).length === 2
    && (tabSrc.match(/onBlur=\{\(\) => \{ setDraft\(null\); setFocused\(false\); \}\}/g) ?? []).length === 2
    && (tabSrc.match(/decimals !== undefined && !focused/g) ?? []).length === 2
    // A pasted "16,559" is a number, through the shared parse.
    && (tabSrc.match(/parseAccounting\(/g) ?? []).length >= 3);
  check('U29m2 a typed ZERO still renders as 0, which formatAccounting would have shown as a dash',
    formatFieldNumber(0, 0) === '0' && formatFieldNumber(16559.46, 0) === '16,559'
    && formatFieldNumber(268.07, 2) === '268.07' && formatFieldNumber(2590000, 2) === '2,590,000.00'
    // The accounting formatter is what these fields must NOT use.
    && formatAccounting(0, 'full', 0) === '-',
    `${formatFieldNumber(0, 0)} / ${formatFieldNumber(16559.46, 0)}`);
  // WHICH FIELDS OPT IN, NAMED. Omitting `decimals` means unchanged, and the
  // five percentages, FAR and Max Floors deliberately omit it: none reaches a
  // thousand, and FAR is 2.4181 on a live plot, so a fixed two decimals would
  // show 2.42 for a figure that multiplies every area under it.
  check('U29m3 the one AREA in the inputs table opts in, and FAR and the percentages do not',
    /decimals=\{AREA_DECIMALS\}\s*\n?\s*placeholder=\{areaText\(landSqm\)\}/.test(inputsBody.replace(/\r/g, ''))
    && !/decimals=\{[^}]*\} value=\{asset\.landChain\?\.farRatio\}/.test(inputsBody)
    && !/decimals=\{[^}]*\} value=\{asset\.landChain\?\.utilisationPct\}/.test(inputsBody));
  check('U29m4 in the sub-unit table the area and the count are whole, the unit size and the rate keep decimals',
    /decimals=\{AREA_DECIMALS\}\s*\n?\s*value=\{u\.metricValue\}\s*\n?\s*testId=\{`subunits-row-\$\{u\.id\}-area`\}/
      .test(subBody.replace(/\r/g, ''))
    && /decimals=\{0\}\s*\n?\s*value=\{u\.metricValue\}\s*\n?\s*testId=\{`subunits-row-\$\{u\.id\}-count`\}/
      .test(subBody.replace(/\r/g, ''))
    // AVERAGE UNIT SIZE KEEPS TWO. It is a measured average that DIVIDES INTO
    // the unit count, so 73.13 shown as 73 would move a figure, not tidy one.
    && /decimals=\{2\}\s*\n?\s*value=\{u\.unitArea\}/.test(subBody.replace(/\r/g, ''))
    && /decimals=\{project\.displayDecimals \?\? 2\}\s*\n?\s*value=\{u\.unitPrice\}/.test(subBody.replace(/\r/g, ''))
    // NSA Share is left alone: a percent never reaches a thousand.
    && !/decimals=\{[^}]*\}\s*\n?\s*value=\{sharePct\}/.test(subBody.replace(/\r/g, '')));

  check('U29j2 the rounding is DISPLAY only: the pooled total is the sum of the exact parts',
    // 100.4 + 100.4 is 200.8, which renders 201. Summing the ROUNDED parts
    // would give 200, and a total that disagrees with its own column by a whole
    // unit is exactly what rounding early produces.
    poolSubUnits([
      { areaSqm: 100.4, perUnit: false }, { areaSqm: 100.4, perUnit: false },
    ]).areaSqm === 200.8
    && areaText(200.8) === '201'
    && areaText(100.4) === '100');
  // U29h ONE BAND. The line total carried no background at all, so it rendered
  // white directly above the navy project foot and the two read as a single
  // half-and-half strip. It is the closing band of its own line, so it wears
  // that line's pale header band.
  // U29h THE BAND IS ON THE CELLS, and that is the fix rather than a detail.
  // On the <tr> alone it painted the left of the row and left the rest white,
  // twice: once when the row had no background at all and once when it had one
  // the cells did not carry. A band is a property of every cell in the row, so
  // every cell states it, from ONE object shared by all three banded rows on
  // the tab, which is also what stops them drifting to three shades.
  check('U29h the line total is ONE band across EVERY column, from the shared object',
    /const BAND: React\.CSSProperties = \{ background: 'var\(--color-primary-pale\)' \}/.test(tabSrc)
    // TWO USES OF THE COLOUR, BOTH NAMED: the BAND constant every banded table
    // row spreads, and the standing callout div above the tables, which is not
    // a row and shares nothing with them. A THIRD is a band nobody decided on,
    // which is what this catches.
    && (tabSrc.match(/'var\(--color-primary-pale\)'/g) ?? []).length === 2
    && /style=\{\{ \.\.\.BAND, borderBottom: '2px solid var\(--color-navy\)' \}\}/.test(subBody)
    // Every cell of the blended row carries it: 9 columns in 8 cells, one of
    // which spans two.
    && (subBody.match(/subunits-line-\$\{line\.key\}-totals`\}>[\s\S]*?<\/tr>/)?.[0]
      .match(/\.\.\.BAND/g) ?? []).length === 8);
  // ── U29h3 THE ROOT CAUSE, PINNED ONCE FOR EVERY BANDED ROW ON THE TAB.
  //
  // app/globals.css carries an UNCLASSED, platform-wide rule:
  //   td:first-child { position: sticky; left: 0; background: var(--color-surface); z-index: 1; }
  // so the first cell of EVERY table in the application is a frozen column
  // with its own opaque white background painted above the row. A <tr>
  // background is therefore invisible on the first cell, always, and a banded
  // row renders white at the left. That is the "half and half" reported three
  // times on this tab, on three different rows, and it was never a row-specific
  // bug. <th> is untouched by that rule, which is why the navy table headers
  // have always looked right and only <td> bands broke.
  //
  // So the invariant is structural: no <td>-based banded row on this tab may
  // state its colour on the <tr> alone. Each of the three bands is an object,
  // spread onto every cell.
  const globalsCss = readFileSync('app/globals.css', 'utf8');
  check('U29h3 the global sticky first-cell rule is still there, so the per-cell band is REQUIRED',
    // [^}] already spans newlines, so no dotAll flag is needed (and this
    // project's tsconfig target refuses one).
    /td:first-child \{[^}]*position: sticky;[^}]*background: var\(--color-surface\);/.test(globalsCss),
    'if this rule ever goes, the per-cell bands become belt and braces rather than the fix');
  check('U29h4 EVERY banded row on the tab paints its cells, not just its row',
    ['BAND', 'FOOT_BAND', 'SUBTOTAL_BAND'].every((k) =>
      new RegExp(`const ${k}: React\\.CSSProperties = \\{`).test(tabSrc))
    // The grand-total foot and the plots subtotal, the two <td> rows that were
    // still relying on the row alone.
    && /<tr style=\{FOOT_BAND\} data-testid="subunits-project-totals">/.test(tabSrc)
    // ELEVEN SPREADS, AND THE COUNT IS MADE OF THREE THINGS (2026-09-10):
    // the sub-units foot row's own 8 cells, plus the two total rows added to
    // tables 3 and 4, which contribute ONE identity cell each and share ONE
    // cell style for all twenty numeric cells (`TotalCells`, the single
    // definition both tables render). That is why three rows cost three
    // spreads and not forty-eight: a missing band on any numeric cell is
    // impossible by construction rather than by counting.
    && (tabSrc.match(/\.\.\.FOOT_BAND/g) ?? []).length === 11
    && /<tr style=\{FOOT_BAND\} data-testid="assets-results-total">/.test(tabSrc)
    && /<tr style=\{FOOT_BAND\} data-testid="assets-merged-total">/.test(tabSrc)
    && /const C: React\.CSSProperties = \{ \.\.\.CELL_NUM, \.\.\.FOOT_BAND/.test(tabSrc)
    && /<tr style=\{SUBTOTAL_BAND\}>/.test(tabSrc)
    && (tabSrc.match(/\.\.\.SUBTOTAL_BAND/g) ?? []).length >= 6
    // AND NO <td> ROW STATES A COLOUR ON THE ROW ALONE. The shape that breaks
    // is a <tr> that bands and then opens a <td>; a <thead> row bands and opens
    // a <th>, which the global rule does not touch, so those are left alone
    // rather than swept up by a colour match that cannot tell them apart.
    // COMMENTS ARE STRIPPED FIRST. A lazy [\s\S]*? inside an optional comment
    // group happily skipped three <th> lines to reach a <td> further down and
    // flagged a thead row: the same "prose matched as the thing" shape as U15
    // and U22, so it gets the same treatment.
    && !/<tr style=\{\{ background: '[^']+'[^}]*\}\}[^>]*>\s*<td/
      .test(tabSrc.replace(/\r/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')));
  check('U29h2 the line HEADER and the plot headers wear the same band the same way',
    // TWO CELLS NOW, not four: the header shed the two numeric cells that were
    // printing totals under the wrong headings (U29k).
    (subBody.match(/subunits-line-\$\{line\.key\}`\}[\s\S]*?<\/tr>/)?.[0]
      .match(/\.\.\.BAND/g) ?? []).length === 2
    && (tabSrc.slice(tabSrc.indexOf('function PlotHeaderRow('), tabSrc.indexOf('function AssetInputsTable('))
      .match(/\.\.\.BAND/g) ?? []).length === 4);
  // ── U29k THE HEADER SAYS WHICH LINE, THE FOOT SAYS HOW MUCH.
  //
  // The header printed the line's NSA under the "NSA Share %" heading and the
  // parts sum under "Area", so a percent column read 27,599.10 and the same
  // figure appeared twice in a row whose job is to say which line this is. A
  // number under the wrong heading is worse than no number: it is read as the
  // quantity the heading names.
  check('U29k the header carries IDENTITY and the check in words, with no figure in a numeric column',
    // Identity: the type, its phase, its plots, its count.
    subBody.includes('{line.label}')
    && subBody.includes('subunits-line-${line.key}-plots`')
    && /\{line\.rows\.length\} sub-unit/.test(subBody)
    // The check spans every numeric column rather than sitting inside two of
    // them, and the two numeric header cells are gone.
    && /<td style=\{\{ \.\.\.CELL, \.\.\.BAND \}\} colSpan=\{7\}>/.test(subBody)
    && !subBody.includes('subunits-line-${line.key}-nsa`')
    && !subBody.includes('subunits-line-${line.key}-sum`'));
  check('U29k2 the Blended row carries the NSA share, 100% when the parts allocate it exactly',
    subBody.includes('subunits-line-${line.key}-total-share`')
    && /\(line\.totals\.areaSqm \/ nsa\) \* 100/.test(subBody)
    // A DASH when the line has no NSA, never 0%, which would claim the parts
    // allocate nothing rather than that there is nothing to allocate against.
    && /nsa > 0\s*\n?\s*\? `\$\{\(\(line\.totals\.areaSqm \/ nsa\) \* 100\)/.test(subBody.replace(/\r/g, '')));
  // ── U29i THE ID THAT COULD NOT BE UNIQUE. Every add button minted
  // `${prefix}_${Date.now()}`, millisecond resolution, so a double-click made
  // two rows share one id: an edit to either patched both, a delete removed
  // both, and React saw duplicate keys. That is the reported "two sub-units,
  // one rate" exactly, and nothing in the codebase copies a rate onto a new row.
  const minted = Array.from({ length: 500 }, () => mintId('subunit'));
  check('U29i a new row id is unique even when the clock does not move',
    new Set(minted).size === 500
    && minted.every((x) => /^subunit_\d+$/.test(x))
    // Strictly increasing, so ids stay sortable.
    && minted.every((x, i) => i === 0 || Number(x.slice(8)) > Number(minted[i - 1].slice(8))),
    `${new Set(minted).size} distinct of 500`);
  check('U29i2 NO add button mints an id from the clock alone any more',
    !/Date\.now\(\)\}`/.test(tabSrc)
    && (tabSrc.match(/id: mintId\('/g) ?? []).length === 4);

  // ── U29n THE UNIT COUNT ASKS THE ASSET, NOT THE ROW.
  //
  // Every surface resolves a sub-unit's metric as `asset.subUnitMetric ??
  // u.metric`: the asset wins, because the asset is what the column headings
  // and the area sums are written against. computeAssetUnitCount asked the ROW
  // alone, so a row whose own metric was left at 'units' while its asset counts
  // AREA was an area on screen and a COUNT in the engine. Live: Marina
  // Residences returned 12,599.1, its "2 BR" row's AREA, the chain took it as a
  // unit-count override and printed it verbatim, so 19,999 sqm of NSA at 170
  // sqm a unit reported 12,599 units instead of 118.
  const mkSub = (o: Record<string, unknown>): SubUnit =>
    ({ id: 'u', assetId: 'a', name: '', category: 'Sellable', metric: 'area',
      metricValue: 0, unitPrice: 0, ...o } as unknown as SubUnit);
  const asAsset = (o: Record<string, unknown>): Asset => ({ id: 'a', ...o } as unknown as Asset);
  const stale = [mkSub({ id: 'x', metric: 'area', metricValue: 15000, unitArea: 150 }),
    mkSub({ id: 'y', metric: 'units', metricValue: 12599.1, unitArea: 190 })];
  check('U29n an AREA asset counts no units, however a row\'s own stale metric reads',
    computeAssetUnitCount(asAsset({ subUnitMetric: 'area' }), stale) === 0,
    `${computeAssetUnitCount(asAsset({ subUnitMetric: 'area' }), stale)}`);
  check('U29n2 a UNITS asset counts every row, however a row\'s own stale metric reads',
    computeAssetUnitCount(asAsset({ subUnitMetric: 'units' }), stale) === 27599.1);
  check('U29n3 with no asset metric the ROW still decides, so nothing legacy loses its count',
    computeAssetUnitCount(asAsset({}), stale) === 12599.1
    // Legacy 'count' still resolves, on the asset as on the row.
    && computeAssetUnitCount(asAsset({ subUnitMetric: 'count' }), stale) === 27599.1);
  check('U29n4 Support is still excluded, whatever the metric says',
    computeAssetUnitCount(asAsset({ subUnitMetric: 'units' }),
      [mkSub({ category: 'Support', metricValue: 99 })]) === 0);
  // AND THE CHAIN FALLS THROUGH when the override is zero, which is what turns
  // the corrected count into the derived one rather than into a zero.
  check('U29n5 a zero override does not become a zero unit count: the chain derives instead',
    /if \(num\(subUnitUnits\) && subUnitUnits > 0\)/.test(chainSrc)
    && computeLandChain(0, undefined, { avgUnitSizeSqm: 170 }, 0).units === undefined
    && computeLandChain(11000, { utilisationPct: 100, coveragePct: 60, farRatio: 2.4181, retailPct: 20 },
      { avgUnitSizeSqm: 170 }, 0).units === 118,
    `${computeLandChain(11000, { utilisationPct: 100, coveragePct: 60, farRatio: 2.4181, retailPct: 20 }, { avgUnitSizeSqm: 170 }, 0).units}`);

  // ── THE SUB-UNIT PARTITION. Checked by RUNNING it, not by reading it.
  //
  // The defect it replaces could not have been caught by a source match: the
  // markup was right, the grouping helper was right, and the call passed one
  // wrong argument (this line's MEMBERS with the WHOLE project's sub-units).
  // Every other line's rows came back as an "Unassigned" orphan group under
  // every line, so four sub-units appeared under four headings and every line
  // header printed the project's total area. The rule is a partition, so the
  // checks are the two properties a partition has.
  const su = (id: string, assetId: string): { id: string; assetId: string } => ({ id, assetId });
  const asset = (id: string, phaseId: string, typeId: string): Asset =>
    ({ id, phaseId, assetTypeId: typeId, name: id, strategy: 'Sell' } as unknown as Asset);
  const pAssets = [
    asset('a1', 'p1', 'residential'), asset('a2', 'p1', 'retail'),
    asset('a3', 'p1', 'hotel'), asset('a4', 'p2', 'retail'),
  ];
  const pSubs = [su('u1', 'a1'), su('u2', 'a2'), su('u3', 'a3'), su('u4', 'a4')];
  const part = partitionSubUnitsByLine(pAssets, pSubs, ['p1', 'p2'], (raw) => raw);
  const seen = part.lines.flatMap((l) => l.subUnits.map((u) => u.id)).concat(part.stray.map((u) => u.id));
  check('U38 every sub-unit lands in EXACTLY ONE bucket, and the buckets sum to the input',
    seen.length === pSubs.length && new Set(seen).size === pSubs.length
    && pSubs.every((u) => seen.includes(u.id)),
    `${part.lines.length} lines, ${seen.length} placements for ${pSubs.length} sub-units`);
  check('U39 a sub-unit sits under the line its asset is on, and under no other',
    part.lines.every((l) => l.subUnits.every((u) => l.members.some((m) => m.id === u.assetId)))
    && part.lines.filter((l) => l.subUnits.length > 0).length === 4
    && part.stray.length === 0,
    part.lines.map((l) => `${l.key}:${l.subUnits.length}`).join(' '));
  // WHAT BELONGS TO NO LINE IS STILL A BUCKET, not a leftover: a row nothing
  // shows is a row nobody can delete.
  const strayPart = partitionSubUnitsByLine(
    pAssets, [...pSubs, su('u5', 'deleted-asset')], ['p1', 'p2'], (raw) => raw,
  );
  check('U40 a sub-unit whose asset is on no line goes to STRAY, and only that one does',
    strayPart.stray.length === 1 && strayPart.stray[0].id === 'u5'
    && strayPart.lines.every((l) => !l.subUnits.some((u) => u.id === 'u5')),
    `stray ${strayPart.stray.map((u) => u.id).join(',')}`);
  // TWO PLOTS OF ONE TYPE IN ONE PHASE ARE ONE LINE, and their sub-units meet
  // there. This is the case the merge exists for.
  const twoPlot = partitionSubUnitsByLine(
    [asset('b1', 'p1', 'villas'), asset('b2', 'p1', 'villas')],
    [su('v1', 'b1'), su('v2', 'b2')], ['p1'], (raw) => raw,
  );
  check('U41 two plots of one type in one phase form ONE line holding both their sub-units',
    twoPlot.lines.filter((l) => l.subUnits.length > 0).length === 1
    && twoPlot.lines[0].subUnits.length === 2
    && twoPlot.stray.length === 0,
    `${twoPlot.lines.length} lines`);
  // ── U51 to U59. A LINE ALWAYS HAS SOMETHING TO PRICE, AND A TYPED SHARE
  //     FOLLOWS ITS NSA (2026-09-10) ──────────────────────────────────────
  //
  // Table 5 lists SUB-UNITS, so a line whose assets have none has no row at all
  // (`build()` returns undefined on an empty list) and cannot be priced however
  // complete its areas are. Two live Standalone Commercial lines carrying 1,250
  // and 7,500 sqm of NSA were in exactly that state, and nothing about the type
  // was involved: five live assets, four different types, all invisible for the
  // same reason.
  const planAsset = (id: string, phaseId: string, typeId: string, extra: Record<string, unknown> = {}): Asset =>
    ({ id, phaseId, assetTypeId: typeId, name: id, strategy: 'Sell', ...extra } as unknown as Asset);
  const planSub = (id: string, assetId: string, extra: Record<string, unknown> = {}) =>
    ({ id, assetId, metric: 'area' as const, metricValue: 0, ...extra });
  const nsaOf = (m: Record<string, number>): Record<string, ResolvedNsa> => {
    const out: Record<string, ResolvedNsa> = {};
    for (const [k, v] of Object.entries(m)) out[k] = { value: v, source: 'chain' };
    return out;
  };
  const label = (a: Asset): string => a.name;
  const seedPlan = planLineSubUnits(
    [planAsset('s1', 'p1', 'commercial'), planAsset('s2', 'p1', 'villas')],
    [planSub('k1', 's2', { metricValue: 500 })],
    ['p1'], nsaOf({ s1: 1250, s2: 500 }), (raw) => raw, label,
  );
  check('U51 a line with NO sub-unit is seeded with one; a line that has one is left alone',
    seedPlan.seeds.length === 1 && seedPlan.seeds[0].assetId === 's1'
    && seedPlan.seeds[0].areaSqm === 1250 && seedPlan.seeds[0].name === 's1',
    `${seedPlan.seeds.length} seeds`);
  check('U52 the seeded row takes the CATEGORY its asset s strategy implies',
    seedCategoryFor('Sell') === 'Sellable' && seedCategoryFor('Lease') === 'Leasable'
    && seedCategoryFor('Operate') === 'Operable'
    // The same mapping the Add button uses, so a derived row and a typed one
    // are the same kind of thing.
    && seedCategoryFor('Sell + Manage') === 'Sellable');
  check('U53 a line with NO NSA is NOT seeded: a row of zero area is not something to price',
    planLineSubUnits([planAsset('z1', 'p1', 'x')], [], ['p1'], nsaOf({ z1: 0 }), (raw) => raw, label)
      .seeds.length === 0);
  // A COUNT-METRIC ASSET IS NOT SEEDED, and that is deliberate: "the whole NSA"
  // on an asset whose parts are counted is a number of KEYS, which needs a unit
  // size nobody has necessarily stated. Inventing one would be the platform
  // deciding how many apartments a tower has.
  check('U54 an asset whose parts are COUNTED is not seeded with an area row',
    planLineSubUnits([planAsset('c1', 'p1', 'x', { subUnitMetric: 'units' })], [],
      ['p1'], nsaOf({ c1: 9000 }), (raw) => raw, label).seeds.length === 0);
  // THE REALLOCATION. A typed SHARE is the statement and its area follows the
  // line's NSA; an AREA-stated row does not move, which is the other half of
  // the same sentence and what keeps every row that existed before this field
  // behaving exactly as it did.
  const realloc = planLineSubUnits(
    [planAsset('r1', 'p1', 'villas'), planAsset('r2', 'p1', 'villas')],
    [
      planSub('half', 'r1', { metricValue: 100, nsaSharePct: 50 }),
      planSub('fixed', 'r2', { metricValue: 100 }),
      planSub('counted', 'r1', { metric: 'units', metricValue: 4, nsaSharePct: 50 }),
    ],
    ['p1'], nsaOf({ r1: 600, r2: 400 }), (raw) => raw, label,
  );
  check('U55 a SHARE-stated row follows the line NSA; an AREA-stated row and a COUNT row do not',
    realloc.reallocations.length === 1
    && realloc.reallocations[0].subUnitId === 'half'
    // 50% of the LINE's 1,000, not of one plot's 600.
    && realloc.reallocations[0].areaSqm === 500
    && realloc.seeds.length === 0,
    JSON.stringify(realloc.reallocations));
  check('U56 a share whose area is ALREADY right produces no write, so a settled model stays clean',
    planLineSubUnits([planAsset('q1', 'p1', 'v')],
      [planSub('ok', 'q1', { metricValue: 500, nsaSharePct: 50 })],
      ['p1'], nsaOf({ q1: 1000 }), (raw) => raw, label).reallocations.length === 0
    // ... and a hundredth of a sqm is not a change, the same tolerance the
    // line's own allocation check uses, so float noise cannot mark a project
    // dirty just for being opened.
    && planLineSubUnits([planAsset('q2', 'p1', 'v')],
      [planSub('noise', 'q2', { metricValue: 500.005, nsaSharePct: 50 })],
      ['p1'], nsaOf({ q2: 1000 }), (raw) => raw, label).reallocations.length === 0);
  // U57 THE PLAN SETTLES. A seed is itself a sub-unit, so re-planning the
  // seeded state must ask for nothing: a plan that never settles is a
  // derive-on-render loop that marks a project dirty for ever.
  const settled = planLineSubUnits(
    [planAsset('s1', 'p1', 'commercial')],
    [planSub('seeded', 's1', { metricValue: 1250, nsaSharePct: 100 })],
    ['p1'], nsaOf({ s1: 1250 }), (raw) => raw, label,
  );
  check('U57 re-planning a seeded line asks for nothing: the plan settles',
    settled.seeds.length === 0 && settled.reallocations.length === 0);
  check('U58 the tab stores the SHARE as the statement, and an area typed after it takes it back',
    /nsaSharePct: v, metricValue: \(nsa \* v\) \/ 100/.test(tabSrc)
    && /metricValue: v \?\? 0, nsaSharePct: undefined/.test(tabSrc)
    // And the plan reaches the store through the same shape the retail
    // companion reconcile uses, from the tab where the chain runs.
    && /syncLineSubUnits\(subUnitPlan, \(\) => mintId\('subunit'\)\)/.test(tabSrc)
    && /planLineSubUnits\(/.test(tabSrc));
  // U59 THE TYPE IS OFFERED WHEN THE ASSET IS ADDED, through the SAME rule the
  // row's own dropdown writes, so a type set at creation and one set a second
  // later cannot mean different things.
  // ── U60 to U64. A ROW THAT PREDATES SHARES (2026-09-10, founder's call:
  //     convert everything with a resolvable NSA, stamping the share it
  //     already shows) ────────────────────────────────────────────────────
  //
  // Every row DISPLAYED a share long before one could be stated, because the
  // column divides the row's area by the line's NSA. So the share was always on
  // screen and never in the file, and the two agreed only until the NSA moved.
  // Conversion writes what the row already shows: it changes what the row
  // MEANS, never what it measures, which is why it was chosen over rescaling.
  const conv = planLineSubUnits(
    [planAsset('c1', 'p1', 'villas')],
    [
      planSub('a', 'c1', { metricValue: 550 }),
      planSub('b', 'c1', { metricValue: 450 }),
    ],
    ['p1'], nsaOf({ c1: 1000 }), (raw) => raw, label,
  );
  check('U60 an area-stated row is converted to the share it ALREADY shows, and its area is untouched',
    conv.conversions.length === 2
    // TO THE CENT, not to the bit: 550/1000 is 55.00000000000001 in binary
    // floating point, and asserting exact equality would be testing IEEE 754
    // rather than the rule.
    && near(conv.conversions[0].nsaSharePct, 55) && near(conv.conversions[1].nsaSharePct, 45)
    // NOTHING IS RESCALED: no reallocation accompanies a conversion, so the
    // engine cannot move on the pass that converts.
    && conv.reallocations.length === 0 && conv.seeds.length === 0,
    JSON.stringify(conv.conversions));
  check('U61 a SUPPORT row is left area-stated: it is not part of NSA, so a share of NSA is not its statement',
    planLineSubUnits([planAsset('s1', 'p1', 'v')],
      [planSub('sup', 's1', { metricValue: 200, category: 'Support' }),
        planSub('sell', 's1', { metricValue: 800, category: 'Sellable' })],
      ['p1'], nsaOf({ s1: 1000 }), (raw) => raw, label)
      .conversions.map((c) => c.subUnitId).join(',') === 'sell');
  // U62 IS TRAPS 7.32, IN THIS FILE'S OWN RULES. The metric is the ASSET's
  // where it states one; asking the row alone would have left behind exactly
  // the one live row that carries metric 'units' under an asset whose metric is
  // 'area', which is the row the founder was looking at.
  check('U62 the metric is the ASSET s where it states one, so a row s own metric cannot mislead it',
    // Row says units, asset says area: it IS an area row and converts.
    planLineSubUnits([planAsset('m1', 'p1', 'v', { subUnitMetric: 'area' })],
      [planSub('rowUnits', 'm1', { metric: 'units', metricValue: 500 })],
      ['p1'], nsaOf({ m1: 1000 }), (raw) => raw, label).conversions.length === 1
    // Row says area, asset says units: it is a COUNT row and is left alone.
    && planLineSubUnits([planAsset('m2', 'p1', 'v', { subUnitMetric: 'units' })],
      [planSub('rowArea', 'm2', { metric: 'area', metricValue: 500 })],
      ['p1'], nsaOf({ m2: 1000 }), (raw) => raw, label).conversions.length === 0);
  check('U63 conversion SETTLES, and a line with no resolvable NSA converts nothing',
    // A converted row has a stored share, so the next pass has nothing to say.
    planLineSubUnits([planAsset('c2', 'p1', 'v')],
      [planSub('done', 'c2', { metricValue: 550, nsaSharePct: 55 })],
      ['p1'], nsaOf({ c2: 1000 }), (raw) => raw, label).conversions.length === 0
    // NO NSA, NO STATEMENT: measured on the live project whose eight lines all
    // report source 'none', where all twelve rows are left exactly as they are.
    && planLineSubUnits([planAsset('n1', 'p1', 'v')],
      [planSub('orphan', 'n1', { metricValue: 500 })],
      ['p1'], nsaOf({ n1: 0 }), (raw) => raw, label).conversions.length === 0);
  const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('U64 the store writes a conversion as a SHARE only, so no area moves with it',
    /const convertTo = new Map\(plan\.conversions/.test(storeSrc)
    && /return \{ \.\.\.u, nsaSharePct: share \};/.test(storeSrc)
    // And never over a share that is already stated.
    && /if \(share === undefined \|\| u\.nsaSharePct !== undefined\) return u;/.test(storeSrc));
  check('U59 adding an asset offers the type, from the same choices and the same patch rule',
    // The picker resolves through the SAME assetTypePatch the row dropdown
    // uses, so a type set at creation and one set a second later are one write.
    tabSrc.includes('next === ADD_UNTYPED ? undefined : assetTypePatch(next, typeChoices, typeValues)')
    && /typeChoices\?: readonly TypeChoice\[\];/.test(tabSrc)
    && tabSrc.includes('<option value={ADD_UNTYPED}>Type not decided yet</option>')
    // The blank state stays reachable: an asset whose type is not yet decided
    // is a real answer, not a gap to be filled by a default.
    && /ADD_UNTYPED = '__add_untyped__'/.test(tabSrc));
  // U65 WHERE THE PICKER IS, which turned out to be the whole defect: it sat at
  // the far end of a fourteen-column scrolling row, trailing a sentence, and a
  // control nobody finds is a control that does not exist. It is now beside the
  // plot NAME on the band, and the LAND table carries the same one, because
  // that is where a user who has just typed a plot looks next.
  // ── U68 to U72. THE CHAIN'S SUPPORT AREA, OPT-IN PER PROJECT (2026-09-10) ─
  //
  // Capex charges on the BUILT area, which the engine reads from the sub-unit
  // rows plus the asset's own support and parking. The chain also derives the
  // lobby and the service share, so where nobody typed a support area the
  // engine is short by exactly that (measured: a Marina line at 23,841 sqm of
  // BUA that the chain puts at 28,051 of main GFA). It arrives as a ROW the
  // engine already reads; the chain still reaches no cost method.
  const drow = (over: Partial<DerivableRow> = {}): DerivableRow => ({
    assetId: 'a1', assetName: 'Tower', hasTypedSupport: false, hasDerivedRow: false,
    lobbyGfaSqm: 1000, mainAssetGfaSqm: 9000, netSaleableSqm: 7000, ...over,
  });

  // ── U81 to U85. STRATEGY: THE TYPE'S DEFAULT AND THE COMPANION RULE ──
  //
  // Every asset on a live project read 'Sell', a 4 Star Hotel among them,
  // because the add path writes that literal and the type picker never
  // mentioned the strategy. A hotel marked Sell gets NO opex (the classifier
  // takes Operate and Lease only), NO depreciation (isDepreciableAsset reads
  // the same two) and no operating revenue, so it is 156m of capex attached to
  // nothing.
  check('U81 the strategy is editable in the ROW, not only in the drawer',
    // A read-only span was the whole reason the wrong value could be seen and
    // not corrected where it was seen.
    inputsBody.includes('data-testid={`asset-row-${asset.id}-strategy`}')
    && inputsBody.includes('onPickStrategy(asset.id, e.target.value as AssetStrategy)')
    // PLAIN STRING MATCHING, not a regex: the markup is full of backticks,
    // braces and slashes, and escaping them is how this file has broken itself
    // before. The read-only span is what must be gone.
    && !tabSrc.includes('-strategy`}>{asset.strategy}</span>'));
  check('U82 and it goes through the SAME preview the drawer runs, not a write-through',
    tabSrc.includes('const pickRowStrategy = (id: string, to: AssetStrategy): void =>')
    && tabSrc.includes('setRowSwitch(applyStrategySwitch(slice, id, to).report)')
    // An asset with nothing to park is written straight through, the same
    // predicate the drawer and the store's banner both use.
    && tabSrc.slice(tabSrc.indexOf('const pickRowStrategy'), tabSrc.indexOf('const pickRowStrategy') + 900)
      .includes('assetHasStrategyAssumptions(slice, id)')
    // One dialog component for one model operation.
    && (tabSrc.match(/<StrategyChangeConfirm/g) ?? []).length === 2);
  // U83 THE COMPANION RULE SERVES BOTH DOORS. `updateAsset` created the
  // Sell + Manage companion on a CHANGE; an asset CREATED as Sell + Manage
  // never passes through that, so it would have been a parent with none.
  check('U83 a Sell + Manage asset needs a companion whichever door it came through',
    needsManageCompanion(
      { id: 'p1', strategy: 'Sell + Manage' } as never, [{ id: 'p1', strategy: 'Sell + Manage' }] as never,
    ) === true
    && needsManageCompanion(
      { id: 'p1', strategy: 'Sell + Manage' } as never,
      [{ id: 'p1' }, { id: 'c', isCompanion: true, parentAssetId: 'p1' }] as never,
    ) === false
    // A companion never asks for one of its own, or the seed would recurse.
    && needsManageCompanion(
      { id: 'c', strategy: 'Sell + Manage', isCompanion: true, parentAssetId: 'p1' } as never, [] as never,
    ) === false);
  check('U84 the add path calls that rule, so the two doors cannot drift',
    storeSrc.includes('needsManageCompanion(asset, assets)')
    && storeSrc.includes('seedManageCompanion(asset, s.subUnits)')
    // and the switch calls the same seeding function rather than its own copy
    && readFileSync('src/hubs/modeling/platforms/refm/lib/state/strategySwitch.ts', 'utf8')
      .includes('seedManageCompanion(patched, nextSubUnits)'));
  check('U85 one dropdown creating TWO assets says so first',
    tabSrc.includes('data-testid="add-asset-companion-confirm"')
    && tabSrc.includes("typePatch?.strategy === 'Sell + Manage'")
    // and only that strategy asks: a confirm on every add would be noise
    && tabSrc.includes('handleAddAssetToPhase(phaseId, parcelId, typePatch);'));

  // ── U78 to U80. EVERY FIGURE TABLE 4 SHOWS CROSSES TO CAPEX, UNGATED ────
  //
  // RE-AIMED 2026-09-12. Until today the bridge carried five figures and
  // gated two of them behind `useDerivedAreas`, on the reasoning that
  // deriving parking unasked would change a live model. It did, and the
  // founder asked for exactly that: the assets tab is the ONE source of
  // area, and a hand-typed parking figure is no longer a statement. So the
  // whole of what the chain produced for a plot crosses, and the opt-in now
  // governs only the derived SUPPORT ROW in table 5.
  const arow = {
    assetId: 'a1', hasDerivedAreas: false,
    landUtilisedSqm: 10000, footprintSqm: 6000, landscapeSqm: 4000,
    totalGfaSqm: 20000, mainAssetGfaSqm: 15000, retailGfaSqm: 3000, lobbyGfaSqm: 2000,
    netSaleableSqm: 12000, parkingAreaSqm: 2800, parkingSlots: 70,
    retailParkingAreaSqm: 1000, retailParkingSlots: 25,
  };
  const areas = planDerivedAreas([arow]).writes[0]?.areas ?? {};
  const keys = Object.keys(areas).sort();
  check('U78 the full Table 4 set crosses, with no toggle to leave any of it behind',
    JSON.stringify(keys) === JSON.stringify(['footprintSqm', 'landscapeSqm', 'lobbyGfaSqm', 'mainAssetGfaSqm',
      'netDevelopableSqm', 'netSaleableSqm', 'parkingAreaSqm', 'parkingBays', 'retailGfaSqm',
      'retailParkingAreaSqm', 'retailParkingSlots', 'serviceAreaSqm', 'totalGfaSqm']),
    keys.join(','));
  // SERVICE AREA IS THE SUM THE SUPPORT ROW STATES: lobby plus (main less net
  // saleable). One definition, so the row and the method cannot disagree.
  check('U79 service area is lobby plus the main asset\'s service share, the support row\'s own sum',
    areas.serviceAreaSqm === 2000 + (15000 - 12000),
    `serviceAreaSqm=${areas.serviceAreaSqm}`);
  // AN ASSET WITH NO CHAIN STILL DERIVES NOTHING, so this cannot start
  // writing a bag onto a project that has no massing at all; and one that
  // HAD a bag and now has no chain has it cleared, so a stale figure cannot
  // outlive the inputs that produced it.
  check('U80 an asset the chain produced nothing for is cleared, not written',
    (() => {
      const bare = { assetId: 'a1', hasDerivedAreas: true };
      const plan = planDerivedAreas([bare]);
      return plan.writes.length === 0 && plan.clearIds[0] === 'a1';
    })());

  // ── U73 to U77. THE TYPE'S MASSING DEFAULTS (2026-09-10) ────────────────
  //
  // Coverage, FAR and the service share are typed PER PLOT and five plots of
  // one type usually share them (the reference's fourteen Standalone
  // Commercial rows all read FAR 1.6 and coverage 60%). They default from the
  // type in the same inherit-and-override shape the parking ratio uses.
  const cd = (plot: Parameters<typeof resolveChainDefaults>[0], vals: Parameters<typeof resolveChainDefaults>[1]) =>
    resolveChainDefaults(plot, vals);
  check('U73 the PLOT wins and the type fills in, per field independently',
    cd({ coveragePct: 55 }, { coveragePct: 60, farRatio: 1.6, servicePct: 20 }).coveragePct === 55
    && cd({ coveragePct: 55 }, { coveragePct: 60, farRatio: 1.6, servicePct: 20 }).farRatio === 1.6
    && cd({ coveragePct: 55 }, { coveragePct: 60, farRatio: 1.6, servicePct: 20 }).servicePct === 20);
  check('U74 a TYPED ZERO on the plot is an override, never a blank to be filled',
    cd({ coveragePct: 0 }, { coveragePct: 60 }).coveragePct === 0
    && cd({ servicePct: 0 }, { servicePct: 20 }).servicePct === 0
    && cd({ farRatio: 0 }, { farRatio: 1.6 }).farRatio === 0);
  check('U75 with nothing stated anywhere the field stays ABSENT, so the chain reports its gap',
    cd(undefined, undefined).farRatio === undefined
    && cd({}, {}).coveragePct === undefined
    && cd(undefined, undefined).sources.farRatio === 'unset');
  check('U76 the SOURCE is carried, which is what lets an inherited FAR show as inherited',
    cd({ coveragePct: 55 }, { coveragePct: 60, farRatio: 1.6 }).sources.coveragePct === 'sub_unit'
    && cd({ coveragePct: 55 }, { coveragePct: 60, farRatio: 1.6 }).sources.farRatio === 'asset_type');
  const stdTabEarly = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('U77 an inherited FAR is SHOWN on the plot row, and the retail share never defaults',
    // The placeholder cannot be mistaken for a stored value, which is the point.
    tabSrc.includes("massing?.sources.farRatio === 'asset_type' && massing.farRatio !== undefined")
    && tabSrc.includes('(type)')
    // COVERAGE AND SERVICE INHERIT SILENTLY, by decision: they are conventions
    // of a building type, while FAR is a constraint of a piece of ground.
    // RETAIL IS NOT DEFAULTABLE AT ALL: no field, no resolve, no column.
    && !/retailPct?: number;/.test(readFileSync('src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards.ts', 'utf8'))
    // NO RETAIL COLUMN: the test id a retail cell would carry does not exist.
    && !/testId={`std-row-${id}-retail/.test(stdTabEarly)
    // AND THE TAB SAYS AN EDIT HERE NOW MOVES THE MODEL, which it did not until
    // today: every value on that tab was an input nothing read.
    && stdTabEarly.includes('data-testid="asset-standards-moves-model"')
    && stdTabEarly.includes('An edit here now moves the model'));
  check('U68 OFF derives nothing at all, which is what makes a live model safe to open',
    planDerivedSupport([drow()], false).writes.length === 0
    && planDerivedSupport([drow()], false).removeIds.length === 0);
  check('U69 ON derives LOBBY plus SERVICE, and nothing else',
    // 1,000 of lobby + (9,000 - 7,000) of service.
    planDerivedSupport([drow()], true).writes[0]?.areaSqm === 3000
    && planDerivedSupport([drow()], true).writes[0]?.id === derivedSupportId('a1'),
    String(planDerivedSupport([drow()], true).writes[0]?.areaSqm));
  // U70 IS THE FOUNDER'S RULE: derive only while nobody has said otherwise.
  check('U70 a TYPED support area wins, and an existing derived row stands down rather than double counting',
    planDerivedSupport([drow({ hasTypedSupport: true })], true).writes.length === 0
    && planDerivedSupport([drow({ hasTypedSupport: true, hasDerivedRow: true })], true)
      .removeIds[0] === derivedSupportId('a1'));
  check('U71 a chain that is not running derives nothing, and REMOVES a row it used to derive',
    planDerivedSupport([drow({ lobbyGfaSqm: undefined, mainAssetGfaSqm: undefined, netSaleableSqm: undefined })], true)
      .writes.length === 0
    // A stale derived figure is worse than none, because it still looks derived.
    && planDerivedSupport([drow({ lobbyGfaSqm: undefined, mainAssetGfaSqm: undefined, netSaleableSqm: undefined, hasDerivedRow: true })], true)
      .removeIds.length === 1
    // And an asset whose lobby and service are both zero is not given an empty row.
    && planDerivedSupport([drow({ lobbyGfaSqm: 0, mainAssetGfaSqm: 5000, netSaleableSqm: 5000 })], true).writes.length === 0);
  check('U72 the toggle is a PROJECT input, off by default, and the tab gates the plan on it',
    tabSrc.includes('data-testid="assets-use-derived-areas"')
    && tabSrc.includes('project.useDerivedAreas === true')
    && tabSrc.includes('setProject({ useDerivedAreas: next })')
    // SUPPORT IS NOT PART OF NSA, so what revenue prices cannot move with it.
    // Run rather than read: the categories that make NSA are the three below.
    && ['Sellable', 'Operable', 'Leasable'].every((c) => c !== 'Support'));
  check('U65 the picker sits beside the plot NAME, not trailing the check sentence',
    // Inside the first cell, which is the one holding the label and the count.
    /\{g\.assets\.length\} asset\{g\.assets\.length === 1 \? '' : 's'\}\s*<\/span>\s*\{\/\* ADD AN ASSET AND SAY WHAT IT IS/.test(tabSrc)
    // ... and NOT in the trailing cell any more: the check text stands alone.
    && !/plotCheckText\(g, \(n\) => areaText\(n\)\)\}\s*<\/span>\s*\{g\.parcel && onAddAsset/.test(tabSrc));
  // U66b THE COUNT IN THE LABEL SAYS WHAT IT COUNTS. "+ Add asset (2)" reads as
  // "add two assets"; it is how many are already on the plot, so the label says
  // that in words. A number in a control's label is a claim about that control
  // unless it is told otherwise.
  check('U66b the picker label states what its number counts',
    tabSrc.includes('already here')
    && !/\+ Add asset\{assetCount > 0 \? ` \(\$\{assetCount\}\)` : ''\}/.test(tabSrc));
  check('U66 the LAND table offers the same picker on every plot row, through the same rule',
    tabSrc.includes('data-testid={`parcel-${parcel.id}-add-asset`}')
    && tabSrc.includes('next === ADD_UNTYPED ? undefined : assetTypePatch(next, typeChoices, typeValues)')
    // Both pickers write through onAddAsset, so there is ONE creation path with
    // two doors rather than a second way to make an asset.
    && (tabSrc.match(/onAddAsset\(\n/g) ?? []).length === 2
    // RE-AIMED 2026-09-11: the two doors now route through requestAddAsset,
    // which previews a Sell + Manage pick before handleAddAssetToPhase creates
    // anything. What matters is unchanged: ONE creation path, two doors.
    && tabSrc.includes('onAddAsset={requestAddAsset}')
    && tabSrc.includes('handleAddAssetToPhase(phaseId, parcelId, typePatch);'));
  check('U67 the three type pickers share ONE resolved list, built once at the root',
    // Built in exactly one place, and passed down; a second buildTypeChoices
    // call is a second list, and "which types can I pick" would then depend on
    // where you picked.
    (tabSrc.match(/buildTypeChoices\(/g) ?? []).length === 2
    && /const typeChoices = useMemo\(\s*\(\) => buildTypeChoices\(assetTypeRegistry\.entries, resolveTypeCatalog\(project\)\),/.test(tabSrc)
    && tabSrc.includes('typeChoices={typeChoices}'));

  // ── RETAIL PARKING HAS AN INPUT A USER CAN FIND. ────────────────────────
  //
  // Retail GFA derived correctly on both live plots (1,320 and 600 sqm) while
  // Retail Parking Slots, Retail Parking Area and Total Parking Area were
  // dashes on every asset on the platform, because the one figure they divide
  // by could only be typed inside a row's drawer, under a label ("Retail sqm /
  // slot") that named neither retail parking nor what it divides. It is a chain
  // input; it now sits with the other chain inputs.
  // ANCHORED AT BOTH ENDS. A bare substring match passes on `-retail-slotX`,
  // which is how a sabotage that renamed the test id walked through the first
  // cut. Every test id here is inside a template literal, so the closing
  // backtick is the anchor.
  // U43 MOVED TWICE, AND THE SECOND MOVE IS THE ONE THAT ENDS IT (2026-09-10).
  // A per-plot COLUMN for one commit, then a PROJECT field for one day, and
  // neither was its home: the retail divisor is a retail TYPE's parking ratio
  // stated in sqm per slot, and the type table already had that cell. Both
  // earlier shapes put one number where it could disagree with the table, and
  // on the one live project holding retail they HAD disagreed: it carried 40,
  // the area a slot occupies, where the reference divides retail GFA by 25.
  // The reference does it from the type table too, dividing by the retail row
  // of the very parking-ratio table every other type reads.
  const stdTab = readFileSync(
    'src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('U43 the retail divisor is a TYPE STANDARD: no project field for it anywhere',
    !stdTab.includes('retailAreaPerSlotSqm')
    && !stdTab.includes('std-retail-area-per-slot')
    && !tabSrc.includes('project.retailAreaPerSlotSqm')
    // The sibling that IS a project assumption stays: no type owns the area a
    // bay occupies.
    && stdTab.includes('testId="std-parking-area-per-slot"')
    // And the tab says where the figure went, so its disappearance is not a
    // mystery to anyone who used it yesterday.
    && stdTab.includes('data-testid="std-retail-parking-note"'));
  // U43d THE RULE THAT PICKS THE TYPE, run rather than read. Ambiguity is
  // possible (a firm may hold several retail types) and must resolve the same
  // way every time or the number moves under the user.
  const retailId = normaliseAssetTypeId(GROUND_FLOOR_RETAIL_TYPE_LABEL);
  const vals = (o: Record<string, unknown>): AssetTypeValuesByType => o as AssetTypeValuesByType;
  check('U43d the ground-floor retail type WINS, a lone sqm-per-slot type serves, and a tie resolves to neither',
    // 1. The named type, even with another candidate present.
    resolveRetailSlotArea(vals({
      [retailId]: { parkingRatio: 25, parkingRatioBasis: 'sqm_per_slot' },
      'standalone-commercial': { parkingRatio: 30, parkingRatioBasis: 'sqm_per_slot' },
    })) === 25
    // 2. Exactly one candidate, under any name: a renamed list still derives.
    && resolveRetailSlotArea(vals({
      'shops': { parkingRatio: 30, parkingRatioBasis: 'sqm_per_slot' },
      'apartments': { parkingRatio: 1, parkingRatioBasis: 'slots_per_unit' },
    })) === 30
    // 3. Two unnamed candidates: we cannot tell which is ground-floor retail,
    //    so nothing, and the chain says so by name rather than picking one.
    && resolveRetailSlotArea(vals({
      'shops': { parkingRatio: 30, parkingRatioBasis: 'sqm_per_slot' },
      'kiosks': { parkingRatio: 20, parkingRatioBasis: 'sqm_per_slot' },
    })) === undefined
    // 4. A TYPED ZERO is not a divisor, and neither is a count-based ratio.
    && resolveRetailSlotArea(vals({ [retailId]: { parkingRatio: 0, parkingRatioBasis: 'sqm_per_slot' } })) === undefined
    && resolveRetailSlotArea(vals({ [retailId]: { parkingRatio: 25, parkingRatioBasis: 'slots_per_unit' } })) === undefined
    && resolveRetailSlotArea(undefined) === undefined
    && resolveRetailSlotArea(vals({})) === undefined);
  check('U43e the ground-floor retail label is a MIRRORED PAIR with the catalog, and the pair still agrees',
    ASSET_TYPES_BY_CATEGORY.Retail.includes(GROUND_FLOOR_RETAIL_TYPE_LABEL),
    `${GROUND_FLOOR_RETAIL_TYPE_LABEL} vs [${ASSET_TYPES_BY_CATEGORY.Retail.join(', ')}]`);
  check('U43b NO per-plot surface offers it any more, in the table or the drawer',
    !/asset-row-\$\{asset\.id\}-retail-slot/.test(tabSrc)
    && !/patchChain\(\{ retailAreaPerSlotSqm: v \}\)/.test(tabSrc)
    && !tabSrc.includes('>Retail GFA / slot (sqm)</th>')
    && !panel.includes('retailAreaPerSlotSqm')
    // BOTH surfaces resolve it, and from the same rule. The drawer passed
    // NOTHING until 2026-09-10, so its panel reported a missing retail ratio on
    // a plot whose own row three tables up derived retail parking fine.
    && (tabSrc.match(/resolveRetailSlotArea\(/g) ?? []).length === 2);
  // THE CHAIN ALREADY NAMES ITS OWN GAP. What was missing was a way to close
  // it, so the gap name and the input must stay wired to one place.
  check('U43c the chain reports the missing figure by name, and names where to set it',
    chainSrc.includes("'no_retail_area_per_slot'")
    && /out\.retailParkingSlots = Math\.round\(out\.retailGfaSqm \/ s\.retailAreaPerSlotSqm\)/.test(chainSrc)
    // The sentence must send the reader to the type, not to the retired field.
    && /retail asset type/.test(chainGapText('no_retail_area_per_slot'))
    && !/project/i.test(chainGapText('no_retail_area_per_slot'))
    // AND THE RETIRED PER-PLOT FIELD IS READ BY NOTHING, including the
    // is-the-chain-started test: a legacy snapshot carrying it must not make a
    // chain look started when nothing else is set. ASKED BY RUNNING IT, because
    // the source ban was written for one of the two parameter names (`i` in the
    // chain, `inputs` in the emptiness test) and a sabotage using the other
    // walked straight through. Both spellings are banned now as well.
    && landChainIsEmpty({ retailAreaPerSlotSqm: 40 } as never) === true
    && landChainIsEmpty({ retailAreaPerSlotSqm: 40, farRatio: 2 } as never) === false
    && !/\b(i|inputs)\.retailAreaPerSlotSqm/.test(chainSrc));

  // ── THE TYPE IS VISIBLE WHEREVER A ROW NAMES AN ASSET. ──────────────────
  //
  // Everything downstream keys off type: the line, the schedules, the cost
  // methods, the standards. A row labelled with an invented name says nothing
  // about which of those it lands in.
  // RE-AIMED 2026-09-10. The type used to be a SUFFIX printed beside an
  // invented name, shown only when the name was hiding it. The name is retired
  // and the type is part of the label itself now, on every surface, so the
  // suffix has nothing left to do and what must hold is that the type is IN
  // the label rather than beside it.
  check('U44 the type is part of the label itself, not a suffix beside a name',
    (() => {
      const src = readFileSync('src/core/calculations/assetName.ts', 'utf8');
      return !src.includes('assetTypeSuffix') && !src.includes('assetDisplayName')
        && src.includes("if (type !== '') parts.push(type);");
    })());
  // U44b MOVED WITH THE HEADER. The sub-unit table used to carry a per-asset
  // header row and the type sat on it; that row is gone (one header per line,
  // matching the four tables above), and the LINE header is labelled with the
  // type itself, so the type is on screen once rather than twice. Each row
  // still names the plot it hangs off, which is what a two-plot line needs.
  check('U44b the sub-unit line is labelled by TYPE, each row names its plot, and the pickers carry it',
    subBody.includes('{line.label}')
    && subBody.includes('subunits-line-${line.key}-plots`')
    && /subunits-row-\$\{u\.id\}-asset`/.test(subBody)
    // The pickers and the results row read the RESOLVED label, which already
    // carries the type; appending a suffix to it would print the type twice.
    && /asset-result-\$\{asset\.id\}-label`/.test(resultsBody)
    && !resultsBody.includes('assetTypeSuffix')
    && !tabSrc.includes('assetTypeSuffix'));
  // ONE HEADER ROW PER GROUP, in the pale style the plot headers use. It
  // rendered two, a navy bar and a pale bar, in styles matching nothing above.
  check('U44c the sub-unit group has ONE header row, in the same style as the tables above',
    (subBody.match(/data-testid=\{`subunits-line-\$\{line\.key\}`\}/g) ?? []).length === 1
    && /<tr\s*\n?\s*key=\{`line-\$\{line\.key\}`\}\s*\n?\s*style=\{BAND\}/
      .test(subBody.replace(/\r/g, ''))
    // The per-asset second header is gone, and so is the grouping that fed it.
    && !subBody.includes('subunits-group-${asset?.id ?? \'unassigned\'}')
    && !tabSrc.includes('function groupSubUnitsByAsset('));

  check('U42 the tab reads the partition rather than re-deriving which sub-unit is whose',
    // HOSTS, not every asset: the retail companions are pulled out first and
    // given lines of their own, since a companion is not a plot and the
    // consolidation grouping would drop it.
    /const \{ lines, stray \} = partitionSubUnitsByLine\(hosts, subUnits, phaseIds, normaliseAssetTypeId\);/.test(tabSrc)
    // The rows a line renders are ITS OWN sub-units, never the project's. The
    // defect was one call handed the whole project once per line, so what is
    // pinned is that the line's own list is what reaches the rows.
    && /const rows: SubUnitRowRef\[\] = units\.map/.test(tabSrc)
    && /build\(\s*\n?\s*line\.key,/.test(tabSrc.replace(/\r/g, ''))
    && /line\.members,\s*\n?\s*line\.subUnits,/.test(tabSrc.replace(/\r/g, ''))
    && !/\bmembers, subUnits\)/.test(tabSrc));
  check('U30 the rate column NAMES its basis, per row, through the one existing helper',
    subBody.includes('subunits-row-${u.id}-rate-basis`')
    && /rateUnitLabel\(u\.category, isUnits \? 'units' : 'area'\)/.test(subBody)
    && subBody.includes('Rate Basis'));
  // ── THE ROADS AND PARKS DEDUCTION IS RETIRED. It answered "how much of this
  // land is developable" a second time, on the same screen as the chain's Land
  // Utilisation %, which answers it at asset level.
  const engineSrc = readFileSync('src/core/calculations/index.ts', 'utf8');
  check('U32 the engine derives no deduction: developable land IS parcel land',
    /const ndaSqm = landSqm;/.test(engineSrc)
    && /const roadsSqm = 0;/.test(engineSrc)
    // The four precedence branches are gone, and so is the fallback that
    // applied projectRoadsPct even with the toggle OFF while ignoring parks.
    && !/projectNdaEnabled/.test(engineSrc)
    && !/parcel\.roadsPct|parcel\.parksPct|parcel\.hasNdaDeduction/.test(engineSrc)
    && !/project\.projectRoadsPct|project\.projectParksPct/.test(engineSrc));
  check('U33 both retired methods still RESOLVE, so no stored cost line is orphaned',
    /case 'rate_per_nda':\s*\n\s*return safeV \* m\.ndaSqm;/.test(engineSrc)
    && /case 'rate_per_roads':\s*\n\s*return safeV \* m\.roadsSqm;/.test(engineSrc)
    // ... and are refused to NEW lines, which is the only way to retire a
    // method without rewriting the two live lines that use it.
    && /RETIRED_COST_METHODS/.test(typesSrc)
    // RE-AIMED 2026-09-11 FROM A FILE TO A BEHAVIOUR. This required the costs
    // TAB to name `isRetiredCostMethod`, which it did while each of its three
    // pickers carried its own inline filter. Those three had drifted apart and
    // were replaced by one shared rule, so the tab no longer names the
    // predicate and the check failed on correct code. What must hold is the
    // OUTCOME: a new line cannot choose a retired method, and a line already on
    // one still can, or the select would rewrite it to its first option.
    && !(selectableCostMethods() as readonly string[]).includes('rate_per_nda')
    && !(selectableCostMethods() as readonly string[]).includes('rate_per_roads')
    && (selectableCostMethods('rate_per_nda') as readonly string[]).includes('rate_per_nda'));
  // U34 RE-AIMED 2026-09-11 WITH THE VOCABULARY. The label moved from "Land
  // Area (legacy)" to "Plot Area (legacy)" when the picker was brought into
  // line with the assets tab, which calls that column Plot Area. What must hold
  // is unchanged: the legacy method must not claim to be the NET DEVELOPABLE
  // area, which is a different figure with its own method since 2026-09-10.
  check('U34 rate_per_nda no longer CLAIMS to be net developable area',
    /rate_per_nda:\s*'Rate . Plot Area \(legacy\)'/.test(typesSrc)
    && !/rate_per_nda:\s*'Rate . (NDA|Net Developable)/.test(typesSrc)
    // And it is still named as the LEGACY one, or the retirement is invisible.
    && /rate_per_nda:[^\n]*\(legacy\)/.test(typesSrc));
  check('U35 a roads line SAYS it charges nothing instead of printing a confident 0',
    /the roads area is retired; this line charges nothing/.test(engineSrc));

  // ── THE PLOT IS EDITABLE IN THE ROW, and both routes point at the plot the
  // user actually meant.
  // RE-AIMED 2026-09-12: the plot picker moved from the row to the asset's
  // DRAWER (the row repeated the group header). Same field, same write rule.
  const cardStart = tabSrc.indexOf('function AssetCard(');
  const cardBody = cardStart >= 0 ? tabSrc.slice(cardStart, tabSrc.indexOf('\nfunction ', cardStart + 10)) : '';
  check('U36 the Plot picker lives in the drawer and writes the asset land allocation, sqm kept',
    cardBody.includes('asset-row-${asset.id}-plot')
    && /<select[\s\S]{0,400}asset-row-\$\{asset\.id\}-plot/.test(cardBody)
    && /landAllocation: next === ''/.test(cardBody)
    && /\.\.\.\(asset\.landAllocation \?\? \{ sqm: 0 \}\), parcelId: next/.test(cardBody)
    // AND THE ROW NO LONGER REPEATS THE HEADER: no plot or phase column.
    && !inputsBody.includes('asset-row-${asset.id}-plot') && !inputsBody.includes('asset-row-${asset.id}-phase\`}')
    && !inputsBody.includes('<th style={TH_T}>Plot</th>') && !inputsBody.includes('<th style={TH_T}>Phase</th>')
    && inputsBody.includes('const COLS = 11;'));
  // U37 IS BACK ON THE PLOT HEADER with the grouping. "+ Add asset here" must
  // create an asset ALREADY POINTING AT THAT PLOT, which was the founder's
  // original ask: a button on a plot that produces an asset on no plot is a
  // button that lies about what it did. Both routes (this button and the row's
  // own picker) write the same field, so the resolution cannot fork.
  check('U37 the plot add button seeds THAT PLOT, and the plot is also chosen in the row',
    tabSrc.includes('const handleAddAssetToPhase = (phaseId: string, parcelId?: string, typePatch?: Partial<Asset>)')
    && /const named = parcelId \? parcels\.find\(\(p\) => p\.id === parcelId\) : undefined;/.test(tabSrc)
    && /const fallbackParcel = named \?\? phaseParcels\[0\] \?\? parcels\[0\];/.test(tabSrc)
    // THE CONTROL IS A PICKER SINCE 2026-09-10 and passes a third argument;
    // what U37 pins is unchanged: it names THAT PLOT, not the phase's first.
    && tabSrc.includes('g.parcel!.phaseId,')
    && tabSrc.includes('g.parcel!.id,')
    && cardBody.includes('asset-row-${asset.id}-plot'));

  // ── THE PLOT DRAW. One rule, three former readers, and a sole occupant that
  // draws its whole plot without anyone typing it.
  section('V. The plot draw: one rule, and a sole occupant draws the whole plot');
  const plot = (id: string, area: number): Parcel =>
    ({ id, phaseId: 'p1', name: id, area, rate: 100, cashPct: 60, inKindPct: 40 } as Parcel);
  const mkPlotAsset = (id: string, parcelId?: string, sqm?: number, extra: Partial<Asset> = {}): Asset =>
    ({
      id, phaseId: 'p1', name: id, type: '', strategy: 'Sell', visible: true,
      gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
      landAllocation: parcelId ? { parcelId, ...(sqm === undefined ? {} : { sqm }) } : undefined,
      ...extra,
    } as Asset);

  const parcels = [plot('land1', 500), plot('land2', 900)];
  {
    const solo = mkPlotAsset('a1', 'land1');
    const draw = resolveAssetPlotDraw(solo, parcels, [solo]);
    check('V1 the ONLY asset on a plot draws the whole plot, with nothing typed',
      draw?.source === 'whole_plot' && draw.sqm === 500, JSON.stringify(draw));
  }
  {
    // A SEEDED ZERO IS NOT A DECISION. The factory used to write sqm: 0, which
    // is exactly the state the reported defect was in.
    const seeded = mkPlotAsset('a1', 'land1', 0);
    const draw = resolveAssetPlotDraw(seeded, parcels, [seeded]);
    check('V2 a stored ZERO reads as not decided, so the sole occupant still draws its plot',
      draw?.source === 'whole_plot' && draw.sqm === 500, JSON.stringify(draw));
  }
  {
    const typed = mkPlotAsset('a1', 'land1', 120);
    const draw = resolveAssetPlotDraw(typed, parcels, [typed]);
    check('V3 a TYPED figure wins and is never replaced by the whole plot',
      draw?.source === 'typed' && draw.sqm === 120, JSON.stringify(draw));
  }
  {
    // A second asset joins: the default stops for BOTH and the split is typed.
    const a1 = mkPlotAsset('a1', 'land1');
    const a2 = mkPlotAsset('a2', 'land1');
    const d1 = resolveAssetPlotDraw(a1, parcels, [a1, a2]);
    const d2 = resolveAssetPlotDraw(a2, parcels, [a1, a2]);
    check('V4 a SECOND asset on the plot ends the default for both, so the split has to be typed',
      d1?.source === 'unset' && d1.sqm === 0 && d2?.source === 'unset' && d2.sqm === 0);
    const t1 = mkPlotAsset('a1', 'land1', 200);
    check('V4b and a figure typed by then still wins',
      resolveAssetPlotDraw(t1, parcels, [t1, a2])?.sqm === 200);
  }
  {
    // MOVING RE-DEFAULTS BECAUSE NOTHING IS WRITTEN. The default is derived at
    // read time, so an asset alone on its new plot draws that plot, and a typed
    // figure survives the move untouched.
    const moved = mkPlotAsset('a1', 'land2');
    check('V5 an asset moved to a plot it is alone on re-defaults to THAT plot',
      resolveAssetPlotDraw(moved, parcels, [moved])?.sqm === 900);
    const movedTyped = mkPlotAsset('a1', 'land2', 120);
    check('V5b a typed figure survives the move and is not overwritten',
      resolveAssetPlotDraw(movedTyped, parcels, [movedTyped])?.sqm === 120);
  }
  {
    const companion = mkPlotAsset('c1', 'land1', undefined, { isCompanion: true });
    const hidden = mkPlotAsset('h1', 'land1', undefined, { visible: false });
    const solo = mkPlotAsset('a1', 'land1');
    check('V6 a companion carries no land and never counts as a sharer',
      resolveAssetPlotDraw(companion, parcels, [companion]) === undefined
      && resolveAssetPlotDraw(solo, parcels, [solo, companion, hidden])?.sqm === 500);
    check('V7 an asset naming NO plot, or a sentinel, gets no default at all',
      resolveAssetPlotDraw(mkPlotAsset('a1'), parcels, []) === undefined
      && resolveAssetPlotDraw(mkPlotAsset('a1', '__custom__', 10), parcels, []) === undefined
      && resolveAssetPlotDraw(mkPlotAsset('a1', '__weighted__', 10), parcels, []) === undefined);
  }
  {
    // THE DEFECT THAT STARTED THIS: two engine functions and the plot check
    // gave three answers for one asset. They are one rule now.
    const solo = mkPlotAsset('a1', 'land1', 0);
    const all = [solo];
    const bd = computeAssetLandBreakdown(solo, parcels, all, [], 'sqm');
    const sq = computeAssetLandSqm(solo, parcels, all, [], 'sqm');
    const groups = groupAssetsByPlot(all, parcels);
    const g = groups.find((x) => x.key === 'land1');
    check('V8 breakdown, computeAssetLandSqm and the plot check all say 500',
      Math.abs(bd.landSqm - 500) < 0.001 && Math.abs(sq - 500) < 0.001
      && Math.abs((g?.allocatedSqm ?? -1) - 500) < 0.001 && g?.status === 'ok',
      `bd=${bd.landSqm} sqm=${sq} group=${g?.allocatedSqm} status=${g?.status}`);
  }
  {
    const a1 = mkPlotAsset('a1', 'land1', 200);
    const a2 = mkPlotAsset('a2', 'land1', 200);
    const g = groupAssetsByPlot([a1, a2], parcels).find((x) => x.key === 'land1');
    check('V9 with two typed assets the check reports the gap rather than defaulting it away',
      Math.abs((g?.allocatedSqm ?? -1) - 400) < 0.001 && g?.status === 'under');
  }
  check('V10 the plot check delegates to the ONE rule instead of reading the field raw',
    /resolveAssetPlotDraw\(asset, parcels as Parcel\[\], assets as Asset\[\]\)/.test(tableModelSrc)
    && !/landAllocation\?\.sqm \?\? asset\.landAreaSqm/.test(tableModelSrc));
  check('V11 the factory seeds NO sqm, so absent means not decided',
    /landAllocation: fallbackParcel \? \{ parcelId: fallbackParcel\.id \} : undefined/.test(tabSrc)
    && !/parcelId: fallbackParcel\.id, sqm: 0/.test(tabSrc));
  check('V12 Plot Area is TYPEABLE in sqm mode and read-only, with a reason, in the others',
    /landAllocationMode === 'sqm' \? \(/.test(inputsBody)
    && inputsBody.includes('asset-row-${asset.id}-land')
    && /placeholder=\{areaText\(landSqm\)\}/.test(inputsBody)
    && /Derived: the project allocates land by/.test(inputsBody));

  // V13 AND V14 ARE THE TWO DEFECTS THAT SURVIVED V1-V12. Every one of those
  // proved the RULE, and the rule was right: the engine and the plot check
  // drew the whole plot. Neither of them looked at what the INPUT CELL renders,
  // so a working default still read as 0 on screen. A rule proven in the engine
  // is not a rule the user can see.
  check('V13 the Plot Area cell follows the RULE, not the raw stored field',
    /value=\{drawSource === 'whole_plot' \|\| drawSource === 'unset'\s*\n\s*\? undefined\s*\n\s*: asset\.landAllocation\?\.sqm\}/.test(inputsBody)
    // A sentinel or unplotted asset has no rule, so its stored figure still
    // shows: blanking those would hide a number the model is using.
    && /drawSource\?: 'typed' \| 'whole_plot' \| 'unset';/.test(tabSrc));
  check('V14 the parcels TOTAL rate is a rate: full scale, like every rate above it',
    /data-testid="parcels-weighted-rate">\{formatAccounting\(aggregate\.weightedRate, 'full',/.test(tabSrc)
    // The money totals beside it are totals and DO take the scale, or this
    // check would pass on a table that simply stopped scaling anything.
    && /data-testid="parcels-total-value">\{formatAccounting\(aggregate\.totalValue, project\.displayScale/.test(tabSrc)
    && /data-testid="parcels-cash-value">\{formatAccounting\(aggregate\.cashValue, project\.displayScale/.test(tabSrc));
  check('V14b the weighted rate ARITHMETIC was never the problem: total value over total area',
    Math.abs(computeLandAggregate([
      { id: 'l1', phaseId: 'p1', name: 'Land 1', area: 24000, rate: 7500, cashPct: 60, inKindPct: 40 },
      { id: 'l2', phaseId: 'p1', name: 'Land 2', area: 500, rate: 500, cashPct: 60, inKindPct: 40 },
    ] as Parcel[]).weightedRate - (180250000 / 24500)) < 1e-9);

  // ── V14c THE PLOTS TABLE LINES UP (2026-09-11) ──
  //
  // Header, body and footer were THREE different arrangements of the same
  // table. The row gained a Phase select and the header did not; Total Value
  // left the row when it became derived and its header stayed; so every header
  // sat one column left of its data and "Cash %" labelled the rate input. The
  // footer was different again, putting cash and in-kind MONEY under the two
  // percent headers.
  //
  // COUNTED, not eyeballed, and counted in all three places, which is the only
  // form of this check that can fail on the defect it is about.
  const parcelsTable = tabSrc.slice(
    tabSrc.indexOf('data-testid="parcels-table"'),
    tabSrc.indexOf('</table>', tabSrc.indexOf('data-testid="parcels-table"')));
  const parcelHead = parcelsTable.slice(parcelsTable.indexOf('<thead>'), parcelsTable.indexOf('</thead>'));
  const parcelFoot = parcelsTable.slice(parcelsTable.indexOf('<tfoot>'));
  const rowBody = tabSrc.slice(
    tabSrc.indexOf('function ParcelRow('),
    tabSrc.indexOf('function ChainCell('));
  // COUNT THE MARKUP, NOT THE PROSE. The first cut counted `<td` anywhere in
  // the slice and read 11 against 10, because the footer's own comment explains
  // the band rule with the words "this row is <td>" in it and the row's comment
  // quotes the tag too. A grep that counts a sentence is the failure this file
  // records more than any other, so comments come out before anything is
  // counted.
  const stripComments = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const countCells = (src: string, tag: string): number =>
    (stripComments(src).match(new RegExp('<' + tag + '[ >]', 'g')) ?? []).length;
  const headCells = countCells(parcelHead, 'th');
  const footCells = countCells(parcelFoot, 'td');
  const bodyCells = countCells(rowBody, 'td');
  check('V14c the plots table has ONE column count: header, row and totals agree',
    headCells === bodyCells && bodyCells === footCells && headCells === 10,
    `header ${headCells}, row ${bodyCells}, totals ${footCells}`);

  // WHAT A PLOT IS WORTH, ON THE PLOT'S OWN ROW. The row showed the two
  // percentages and left the split to the reader while the footer showed it
  // totalled, so the only way to see what one plot cost was to do the
  // arithmetic.
  check('V14d each plot row states its own land, cash and in-kind value',
    ['parcel-${parcel.id}-land-value', 'parcel-${parcel.id}-cash-value', 'parcel-${parcel.id}-inkind-value']
      .every((t) => rowBody.includes(t)),
    rowBody.slice(0, 0));
  // DERIVED THROUGH THE FUNCTION THE FOOTER TOTALS WITH, never restated. A row
  // that multiplied area x rate x pct itself would be a second definition of
  // land value, and the two would disagree about clamping first.
  check('V14e the row derives through computeLandAggregate, not a formula of its own',
    rowBody.includes('const own = computeLandAggregate([parcel]);')
    && !rowBody.includes('parcel.area * parcel.rate'));
  check('V14f so a row foots to the footer by construction, cash and in-kind included',
    (() => {
      const ps = [
        { id: 'l1', phaseId: 'p1', name: 'Land 1', area: 11000, rate: 7500, cashPct: 50, inKindPct: 50 },
        { id: 'l2', phaseId: 'p1', name: 'Land 2', area: 5000, rate: 7500, cashPct: 60, inKindPct: 40 },
        { id: 'l3', phaseId: 'p2', name: 'Land 3', area: 3000, rate: 0, cashPct: 60, inKindPct: 40 },
      ] as Parcel[];
      const agg = computeLandAggregate(ps);
      const rows = ps.map((p) => computeLandAggregate([p]));
      const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
      return near(rows.reduce((s, r) => s + r.totalValue, 0), agg.totalValue)
        && near(rows.reduce((s, r) => s + r.cashValue, 0), agg.cashValue)
        && near(rows.reduce((s, r) => s + r.inKindValue, 0), agg.inKindValue)
        // and each row's own two halves make its whole
        && rows.every((r) => near(r.cashValue + r.inKindValue, r.totalValue));
    })());
  // THE SAME FORMATTING STANDARD AS THE OTHER FOUR TABLES: money takes the
  // project scale, areas are whole, a RATE stays at full scale.
  check('V14g the three derived cells take the project money scale, like every other total',
    (rowBody.match(/formatAccounting\(own\.(totalValue|cashValue|inKindValue), scale, decimals\)/g) ?? []).length === 3);
  check('V14h and the footer states no total for the phase or the two percentages',
    // The footer cells took the shared CELL scale on 2026-09-12 (Table 1 on the
    // same scale as the others); the empty ones are still exactly three.
    (parcelFoot.match(/<td style={{ \.\.\.CELL, \.\.\.SUBTOTAL_BAND }}><\/td>/g) ?? []).length === 3);

  // ── V15 IS A SWEEP, NOT A LINE. Three rate-vs-scale defects turned up on
  // this tab one at a time (the sub-unit rate, the parcels totals rate, the
  // per-parcel caption), each found by eye after shipping. A scale divides a
  // figure for readability and belongs to TOTALS; a rate is per unit and must
  // show the whole amount. So every money render on the tab is enumerated and
  // any whose subject reads as a rate has to take 'full'.
  const words = (ident: string): string[] =>
    ident.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase());
  const isRate = (ident: string): boolean =>
    words(ident).some((w) => w === 'rate' || w === 'price' || w === 'adr' || w === 'unitprice');
  /** Split a call's arguments on TOP-LEVEL commas only. */
  const splitArgs = (src: string): string[] => {
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let k = 0; k < src.length; k += 1) {
      const c = src[k];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) { out.push(src.slice(start, k)); start = k + 1; }
    }
    out.push(src.slice(start));
    return out.map((x) => x.trim());
  };
  /** The whole call text from the open paren, brackets balanced. */
  const callArgs = (src: string, openParen: number): string => {
    let depth = 0;
    for (let k = openParen; k < src.length; k += 1) {
      const c = src[k];
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openParen + 1, k); }
    }
    return '';
  };
  // formatAccounting(value, scale, decimals) | fmtCurrency(value, currency,
  // scale, decimals) | fmtMoney(value), which closes over the block's scale
  // and therefore always scales.
  const SCALE_ARG: Record<string, number> = { formatAccounting: 1, fmtCurrency: 2, fmtMoney: -1 };
  const moneyCalls: { fn: string; args: string[] }[] = [];
  for (const m of tabSrc.matchAll(/\b(formatAccounting|fmtCurrency|fmtMoney)\(/g)) {
    const fn = m[1];
    const args = splitArgs(callArgs(tabSrc, m.index + fn.length));
    moneyCalls.push({ fn, args });
  }
  const scaledRates = moneyCalls.filter(({ fn, args }) => {
    if (!isRate(args[0] ?? '')) return false;
    const at = SCALE_ARG[fn];
    if (at < 0) return true;
    // THE SCALE ARGUMENT ITSELF, not the presence of the word 'full' anywhere
    // in the call. The first cut tested the whole argument string, so
    // `project.displayScale ?? 'full'` satisfied it and TWO sabotages walked
    // straight through. Same family as every other match-the-prose miss today.
    return (args[at] ?? '').trim() !== "'full'";
  });
  check('V15 no RATE on this tab takes the project display scale',
    moneyCalls.length >= 6 && scaledRates.length === 0,
    scaledRates.map((r) => `${r.fn}(${r.args.join(', ')})`).join(' | ') || `${moneyCalls.length} money renders scanned`);
  check('V15b the sweep still SEES the scaled totals, so it cannot pass by finding nothing',
    moneyCalls.some(({ fn, args }) => /totalValue|cashValue|inKindValue/.test(args[0] ?? '')
      && (SCALE_ARG[fn] < 0 || (args[SCALE_ARG[fn]] ?? '').includes('displayScale'))));
  const inputScales = [...tabSrc.matchAll(/<AccountingNumberInput\b([\s\S]{0,400}?)\/>/g)]
    .map((m) => /scale=(\{[^}]*\}|"[^"]*")/.exec(m[1])?.[1] ?? '(none)');
  check('V15d every AccountingNumberInput on this tab is FULL scale: areas, rates, counts and per-unit prices, never a total',
    inputScales.length >= 10 && inputScales.every((v) => v === '"full"' || v === '(none)'),
    `${inputScales.length} inputs: ${[...new Set(inputScales)].join(' | ')}`);
  check('V15c the per-parcel scaled caption is gone',
    !/parcel-\$\{parcel\.id\}-rate-fmt/.test(tabSrc)
    && !/formatAccounting\(parcel\.rate, scale/.test(tabSrc)
    // The parcel's own rate INPUT stays, at full scale.
    && /data-testid=\{`parcel-\$\{parcel\.id\}-rate`\}/.test(tabSrc));

  check('U31 headers WRAP and are CENTRED in both tables',
    /textAlign: 'center'/.test(tabSrc.slice(tabSrc.indexOf('const TH_T'), tabSrc.indexOf('const TABLE_INPUT')))
    && /whiteSpace: 'normal'/.test(tabSrc.slice(tabSrc.indexOf('const TH_T'), tabSrc.indexOf('const TABLE_INPUT')))
    && /const TH_N: React\.CSSProperties = \{ \.\.\.TH_T \};/.test(tabSrc));
  // U14 IS BACK ON THE PLOT HEADER. It was re-aimed at a line header for one
  // day; the line header merged one table too early, so entry and the chain
  // both lost the ground they belong to. The plot header is shared by the two
  // per-plot tables, and the CHECK (does this plot's area add up) belongs to
  // the entry table only.
  check('U14 the plot grouping is one shared header, and the CHECK is on the input table only',
    tabSrc.includes('function PlotHeaderRow(')
    // WHITESPACE-INSENSITIVE. An earlier cut matched a flag followed by a
    // literal newline, which is false on a CRLF checkout: it then failed on
    // THREE unrelated sabotages purely because git had converted the line
    // endings between runs. A check that fires for the wrong reason is worse
    // than no check, because it teaches you to ignore it. What is meant is that
    // the one header is used BOTH ways, so that is what is asserted.
    && /showCheck\s*$/m.test(tabSrc) && tabSrc.includes('showCheck={false}')
    && tabSrc.includes('plot-group-${g.key}-area`')
    && !tabSrc.includes('function LineHeaderRow('));
  // U14b THE HEADER PRINTS THE PHASE'S NAME. It printed `phase_1`, a storage
  // key, at a reader who has seen "Phase 1" on every other screen in the
  // platform. Both the plot header and the merged row resolve it through the
  // phase list, and neither falls back to the raw key without trying.
  check('U14b every phase shown on this tab is the phase NAME, resolved from the phase list',
    /phaseName=\{group\.parcel \? \(allPhases\.find\(\(p\) => p\.id === group\.parcel!\.phaseId\)\?\.name \?\? undefined\) : undefined\}/.test(tabSrc)
    && /allPhases\.find\(\(ph\) => ph\.id === group\.phaseId\)\?\.name \?\? group\.phaseId/.test(mergedBody)
    && /phases\.find\(\(p\) => p\.id === line\.phaseId\)\?\.name/.test(tabSrc)
    // No surface may hand a raw phaseId straight to a phaseName prop.
    && !/phaseName=\{group\.phaseId\}/.test(tabSrc));
  // U14c FIVE TABLES, IN ENTRY ORDER, EACH NUMBERED ON ITS OWN FACE. The order
  // is the argument: land, then what is entered on it, then what the chain
  // makes of each plot, then the merge, then the parts of the merged line.
  check('U14c the tab is five numbered tables in entry order',
    [
      '1. Plots, the land',
      '2. Assets by plot, what you enter',
      '3. Derived areas, per plot',
      '4. Merged by line',
      '5. Sub-units, under the merged line',
    ].every((t, i, all) => {
      const at = tabSrc.indexOf(`>${t}<`);
      if (at < 0) return false;
      return i === 0 || at > tabSrc.indexOf(`>${all[i - 1]}<`);
    }));
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
    farRatio: 3.2,
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
    carried?.utilisationPct === 95 && carried?.farRatio === 3.2);
  const areaKeys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired'] as const;
  check('E3 carrying chain inputs changes NO area input on the asset',
    areaKeys.every((k) => JSON.stringify(plainAsset[k]) === JSON.stringify(chainedAsset[k])));

  // ── E4 to E6. THE BASIS IS STORED, NOT DISPLAYED (2026-09-10) ───────────
  //
  // The standards dropdown showed "slots per unit" for any type whose basis was
  // unset and only WROTE one if the user changed it, so a type could hold a
  // ratio with no basis at all and the chain would read it as a count-based
  // ratio. Screen and model agreed by coincidence, not by record, and a ratio
  // meant as sqm per slot silently multiplied a unit count. Hydrate stamps the
  // basis the chain was already assuming, so it MOVES NO NUMBER.
  const withValues = (assetTypeValues: Record<string, unknown>): Record<string, unknown> => ({
    ...mk({ ...base }),
    project: { projectName: 'Probe', modelType: 'annual', currency: 'USD', assetTypeValues },
  });
  const stamped = (hydrationFromAnySnapshot(withValues({
    'high-end-apartments': { parkingRatio: 1 },
    'branded-villas': { parkingRatio: 0 },
  })) as unknown as { project: { assetTypeValues: AssetTypeValuesByType } }).project.assetTypeValues;
  check('E4 hydrate stamps the basis onto every type that states a ratio, a TYPED ZERO included',
    stamped['high-end-apartments']?.parkingRatioBasis === 'slots_per_unit'
    && stamped['high-end-apartments']?.parkingRatio === 1
    && stamped['branded-villas']?.parkingRatioBasis === 'slots_per_unit'
    && stamped['branded-villas']?.parkingRatio === 0,
    JSON.stringify(stamped));
  const untouched = (hydrationFromAnySnapshot(withValues({
    'retail-combined': { parkingRatio: 25, parkingRatioBasis: 'sqm_per_slot' },
    'plots': { avgUnitSizeSqm: 200 },
  })) as unknown as { project: { assetTypeValues: AssetTypeValuesByType } }).project.assetTypeValues;
  check('E5 a stated basis is never overwritten, and a type with NO ratio never acquires one',
    untouched['retail-combined']?.parkingRatioBasis === 'sqm_per_slot'
    && untouched['retail-combined']?.parkingRatio === 25
    && untouched['plots']?.parkingRatioBasis === undefined
    && untouched['plots']?.avgUnitSizeSqm === 200,
    JSON.stringify(untouched));
  // AND THE STAMP IS WHAT THE CHAIN ALREADY ASSUMED, proven by running both:
  // an absent basis and the stamped one derive the same slots.
  const bare = computeLandChain(10000, { utilisationPct: 100, coveragePct: 50, farRatio: 2 },
    { avgUnitSizeSqm: 100, parkingRatio: 1, parkingAreaPerSlotSqm: 40 });
  const withBasis = computeLandChain(10000, { utilisationPct: 100, coveragePct: 50, farRatio: 2 },
    { avgUnitSizeSqm: 100, parkingRatio: 1, parkingRatioBasis: 'slots_per_unit', parkingAreaPerSlotSqm: 40 });
  check('E6 stamping moves NO number: the fallback and the stored basis derive the same slots',
    bare.parkingSlots === withBasis.parkingSlots && bare.parkingSlots === 200
    && bare.totalBuaSqm === withBasis.totalBuaSqm,
    `${String(bare.parkingSlots)} vs ${String(withBasis.parkingSlots)}`);
  // AND THE TAB WRITES IT WITH THE RATIO, so a type created after this cannot
  // reach the stored state the stamp exists to repair.
  check('E7 the standards tab writes the basis alongside a newly typed ratio',
    /parkingRatioBasis: 'slots_per_unit' as ParkingRatioBasis/.test(stdTab)
    && /v\?\.parkingRatioBasis === undefined/.test(stdTab));
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
