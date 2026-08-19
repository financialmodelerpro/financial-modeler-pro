/**
 * verify-sale-cohort-inputs.ts (2026-08-19)
 *
 * MODULE 2 SALE COHORT RESTRUCTURE, STEP 1: THE INPUTS EXIST AND CHANGE NOTHING.
 *
 * Step 1 lands three inputs before the rule that will consume them:
 *
 *   downpaymentByPhase          a FRACTION per SALE YEAR, phase-local
 *   maxInstalmentYears          one number for the asset
 *   instalmentsStopAtHandover   a toggle, absent means true (hard cut-off)
 *
 * The whole point of shipping them first is that the screen can be reviewed
 * while NO SAVED NUMBER CAN MOVE. That property is worth nothing if it is only
 * an intention, so this file proves it two ways: behaviourally, by computing a
 * sell asset with and without the three fields set and demanding the results
 * are byte identical, and structurally, by demanding no engine file so much as
 * mentions the field names.
 *
 * WHEN STEP 3 ARRIVES, SECTIONS C AND D WILL FAIL. That is deliberate and it is
 * the contract: whoever wires the fields into the engine has to come here and
 * replace the "reads nothing" checks with checks on what the rule actually
 * does. A silent switch-on is not possible.
 *
 * Section E covers a defect found while building Step 1 and fixed with it: the
 * Module 2 Revenue sell rebuild was a FIELD LIST, the shape recorded in
 * docs/TRAPS.md 7.16, so any edit on that tab destroyed every sell field the
 * list did not name. It already omitted `escrow` (no live project carried one,
 * measured, so nothing was actually lost) and it would have destroyed all three
 * fields added here.
 *
 * Run: npx tsx scripts/verify-sale-cohort-inputs.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { computeAllSellResults, resolveSellConfig } from '../src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import type { Asset, Phase, Project, SubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];

const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Strip comments before asserting a pattern is present or absent in source.
 *  A name in a docstring is not a read, and TRAPS records a check that failed
 *  against correct code because `indexOf` found the symbol in prose. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FIELDS = ['downpaymentByPhase', 'maxInstalmentYears', 'instalmentsStopAtHandover'] as const;

const ENGINE_TYPES = 'src/core/calculations/revenue/types.ts';
const STORED_TYPES = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const SCREEN = 'src/hubs/modeling/platforms/refm/components/modules/Module2Revenue.tsx';

// ---------------------------------------------------------------------------
section('A. The three fields are declared, on both sides');

{
  const engine = read(ENGINE_TYPES);
  const stored = read(STORED_TYPES);
  for (const f of FIELDS) {
    check(`A: ${f} declared on the engine AssetSellConfig`, new RegExp(`${f}\\?:`).test(engine));
    check(`A: ${f} declared on the stored sell shape`, new RegExp(`${f}\\?:`).test(stored));
  }
  // The stored shape mirrors the engine type. If they drift, a field can be
  // saved and then be unreadable, which is the whole reason the mirror exists.
  check('A: both sides agree on all three, none declared on only one',
    FIELDS.every((f) => new RegExp(`${f}\\?:`).test(engine) && new RegExp(`${f}\\?:`).test(stored)));

  // The downpayment is a FRACTION. It was briefly named ...PctByPhase while
  // storing 0.20, which is a name that lies about its unit. Nothing may
  // reintroduce that name.
  check('A: no field name claims a percentage while storing a fraction',
    !engine.includes('downpaymentPctByPhase') && !stored.includes('downpaymentPctByPhase'));
}

// ---------------------------------------------------------------------------
section('B. A saved project carrying all three survives being loaded');

{
  // The field-whitelist class (TRAPS 7.16) has cost this project three fields
  // already. Prove these three are not the fourth.
  const snapshot = {
    project: { name: 'Cohort fixture', startDate: '2026-01-01', modelType: 'annual' },
    phases: [{
      id: 'phase1', name: 'Phase 1', startDate: '2026-01-01',
      constructionPeriods: 4, operationsPeriods: 6, overlapPeriods: 0, status: 'planning',
    }],
    assets: [{
      id: 'asset1', phaseId: 'phase1', name: 'Tower A', type: 'Residential',
      strategy: 'Sell', visible: true, gfaSqm: 10000, buaSqm: 8000, sellableBuaSqm: 6000,
      revenue: {
        sell: {
          assetId: 'asset1',
          subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [0.1, 0.3, 0.3, 0.2], postSalesVelocityByPhase: [], preSalesVelocity: [], postSalesVelocity: [] }],
          cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup' },
          recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
          indexation: { method: 'none' },
          downpaymentByPhase: [0.2, 0.15, 0.25, 0.3],
          maxInstalmentYears: 3,
          instalmentsStopAtHandover: false,
        },
      },
    }],
    subUnits: [{ id: 'su1', assetId: 'asset1', name: 'Apartments', category: 'residential', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 }],
    costLines: [], costOverrides: [], parcels: [],
  };

  const hydrated = hydrationFromAnySnapshot(snapshot as never) as unknown as { assets?: Asset[] };
  const sell = (hydrated.assets?.[0] as unknown as { revenue?: { sell?: Record<string, unknown> } })?.revenue?.sell;
  check('B: the sell config survives the hydrate at all', sell !== undefined);
  check('B: downpaymentByPhase survives with every value intact',
    JSON.stringify(sell?.downpaymentByPhase) === JSON.stringify([0.2, 0.15, 0.25, 0.3]),
    JSON.stringify(sell?.downpaymentByPhase));
  check('B: maxInstalmentYears survives', sell?.maxInstalmentYears === 3, String(sell?.maxInstalmentYears));
  // FALSE is the value that catches a truthiness bug: a `?? true` default or a
  // `if (x)` guard anywhere in the chain would silently turn the toggle back on.
  check('B: instalmentsStopAtHandover survives as FALSE, not defaulted back to true',
    sell?.instalmentsStopAtHandover === false, String(sell?.instalmentsStopAtHandover));
}

// ---------------------------------------------------------------------------
section('C. THE STEP 1 CONTRACT: setting them changes no computed number');

{
  const project = { name: 'P', startDate: '2026-01-01', modelType: 'annual' } as unknown as Project;
  const phase = {
    id: 'phase1', name: 'Phase 1', startDate: '2026-01-01',
    constructionPeriods: 4, operationsPeriods: 6, overlapPeriods: 0, status: 'planning',
  } as unknown as Phase;
  const subUnit = {
    id: 'su1', assetId: 'asset1', name: 'Apartments', category: 'residential',
    metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit;

  const makeAsset = (cohortTerms: Record<string, unknown>): Asset => ({
    id: 'asset1', phaseId: 'phase1', name: 'Tower A', type: 'Residential',
    strategy: 'Sell', visible: true, gfaSqm: 10000, buaSqm: 8000, sellableBuaSqm: 6000,
    revenue: {
      sell: {
        assetId: 'asset1',
        subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [0.1, 0.3, 0.3, 0.2], postSalesVelocityByPhase: [0.1], preSalesVelocity: [], postSalesVelocity: [] }],
        cashPaymentProfile: { percentages: [0.2, 0.3, 0.3, 0.2], profileMode: 'absolute_with_catchup' },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'yoy_compound', rate: 0.05, startYear: 0 },
        ...cohortTerms,
      },
    },
  } as unknown as Asset);

  const base = computeAllSellResults({ project, phases: [phase], assets: [makeAsset({})], subUnits: [subUnit] } as never);
  const withTerms = computeAllSellResults({
    project, phases: [phase],
    assets: [makeAsset({
      downpaymentByPhase: [0.2, 0.15, 0.25, 0.3],
      maxInstalmentYears: 1,
      instalmentsStopAtHandover: false,
    })],
    subUnits: [subUnit],
  } as never);

  const a = base.bySellAsset.get('asset1') as unknown as Record<string, unknown>;
  const b = withTerms.bySellAsset.get('asset1') as unknown as Record<string, unknown>;
  check('C: the fixture actually computes something (not a vacuous pass)',
    a !== undefined && (a.cashCollectedPerPeriod as number[])?.some((v) => v > 0));

  // THE ANTI-VACUITY CHECK, and it is the most important one in this file.
  //
  // "Setting them changes nothing" is only meaningful if the engine ACTUALLY
  // RECEIVES them. It did not: `resolveSellConfig` was a field list that
  // dropped all three on the way in, so a sabotage that made the engine read
  // a cohort field and move real money still passed the checks above. The
  // whole section was proving the mapper was lossy, not that the engine was
  // inert. Fixed by spreading, and pinned here behaviourally rather than by
  // reading the source, so the guard survives a refactor of that function.
  const cfgForEngine = resolveSellConfig(
    makeAsset({ downpaymentByPhase: [0.2], maxInstalmentYears: 1, instalmentsStopAtHandover: false }),
    project,
  ) as unknown as Record<string, unknown>;
  check('C: the engine config carries downpaymentByPhase (else this section is vacuous)',
    JSON.stringify(cfgForEngine?.downpaymentByPhase) === JSON.stringify([0.2]));
  check('C: the engine config carries maxInstalmentYears', cfgForEngine?.maxInstalmentYears === 1);
  check('C: the engine config carries instalmentsStopAtHandover as false',
    cfgForEngine?.instalmentsStopAtHandover === false);
  // Same reasoning for the field that was already being dropped.
  const cfgEscrow = resolveSellConfig(
    makeAsset({ escrow: { heldPctOverride: 0.35 } }), project,
  ) as unknown as { escrow?: { heldPctOverride?: number } };
  check('C: the engine config carries escrow, which the field list had dropped',
    cfgEscrow?.escrow?.heldPctOverride === 0.35);
  check('C: the whole sell result is byte identical with the cohort terms set',
    JSON.stringify(a) === JSON.stringify(b));
  // Named separately, because these are the two series Step 3 will move and a
  // reader should see them called out rather than buried in a deep-equal.
  check('C: cash collected is unchanged',
    JSON.stringify(a?.cashCollectedPerPeriod) === JSON.stringify(b?.cashCollectedPerPeriod));
  check('C: recognised revenue is unchanged',
    JSON.stringify(a?.recognitionPerPeriod) === JSON.stringify(b?.recognitionPerPeriod));
  check('C: the cash cohort matrix is unchanged',
    JSON.stringify(a?.cashVintageMatrix) === JSON.stringify(b?.cashVintageMatrix));
}

// ---------------------------------------------------------------------------
section('D. No engine or resolver file reads the three names');

{
  // Section C proves the behaviour on one fixture. This proves the class: a
  // field nothing mentions cannot be read down some path the fixture missed.
  const roots = ['src/core/calculations', 'src/hubs/modeling/platforms/refm/lib'];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      // The two type declarations are where the fields are DEFINED, not read.
      if (rel === ENGINE_TYPES || rel === STORED_TYPES) continue;
      const src = stripComments(read(rel));
      for (const f of FIELDS) if (src.includes(f)) offenders.push(`${rel} reads ${f}`);
    }
  };
  for (const r of roots) walk(r);
  check('D: no engine or resolver file mentions any of the three fields',
    offenders.length === 0, offenders.slice(0, 5).join('; '));

  // And the screen DOES, or the inputs are unreachable and Step 1 shipped
  // nothing. The mirror of the check above, so neither can pass by accident.
  const screen = stripComments(read(SCREEN));
  for (const f of FIELDS) check(`D: the Module 2 Revenue screen edits ${f}`, screen.includes(f));
  check('D: the downpayment strip is rendered', screen.includes('m2-cohort-dp-'));
  check('D: the instalment years input is rendered', screen.includes('m2-cohort-') && screen.includes('max-instalment-years'));
  check('D: the screen states that the inputs are not yet applied',
    /not yet (applied|used)/i.test(read(SCREEN)));
}

// ---------------------------------------------------------------------------
section('E. The sell rebuild spreads, so a field it does not name survives');

{
  const screen = read(SCREEN);
  const idx = screen.indexOf('const updateSellInline');
  check('E: updateSellInline still exists', idx >= 0);
  const body = screen.slice(idx, idx + 1400);
  const stripped = stripComments(body);

  // The fix is SHAPE, not a longer list: the existing config is spread FIRST,
  // before any named default, so an unnamed field is carried rather than
  // dropped. Asserting the spread precedes `assetId` pins the ordering, since a
  // spread placed after the named fields would undo their defaults instead.
  const spreadAt = stripped.indexOf('...(sellConfig ?? {})');
  const assetIdAt = stripped.indexOf('assetId: asset.id');
  check('E: the rebuild spreads the existing sell config', spreadAt >= 0);
  check('E: the spread comes FIRST, before the named defaults',
    spreadAt >= 0 && assetIdAt >= 0 && spreadAt < assetIdAt);

  // `escrow` is the field this defect had already been dropping. It must not
  // be "fixed" by adding it to the list, which would leave the next field
  // exposed, so the check is that the list is gone, not that escrow is in it.
  check('E: escrow is not re-added as a named field (that would be the list again)',
    !/escrow:\s*sellConfig/.test(stripped));
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
if (failures.length === 0) {
  console.log(`verify-sale-cohort-inputs: ${passed} passed, 0 failed`);
} else {
  console.log(`verify-sale-cohort-inputs: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
