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
import { buildCohortMatrix, columnSums } from '../src/core/calculations/revenue/cohort';
import { buildSaleCohortProfile, instalmentCount, resolveDownpayment, hasAnyDownpayment } from '../src/core/calculations/revenue/cohortTerms';
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
section('F. Downpayment display rules: unset is not zero, and nothing sums');

{
  // F1. FORWARD FILL. Lengthening a construction period extends the sale-year
  // window, and a new column appearing as a silent 0% would quietly change the
  // terms of every cohort added after it.
  const arr = [0.2, null, null, 0.3, null];
  check('F: a set year resolves to itself', resolveDownpayment(arr, 0).value === 0.2 && resolveDownpayment(arr, 0).source === 'set');
  check('F: an unset year carries the last set year forward',
    resolveDownpayment(arr, 1).value === 0.2 && resolveDownpayment(arr, 1).source === 'inherited');
  check('F: it carries across a run of unset years',
    resolveDownpayment(arr, 2).value === 0.2 && resolveDownpayment(arr, 2).source === 'inherited');
  check('F: a later set year overrides the carry', resolveDownpayment(arr, 3).value === 0.3 && resolveDownpayment(arr, 3).source === 'set');
  check('F: and the carry then follows the NEW value, not the original',
    resolveDownpayment(arr, 4).value === 0.3 && resolveDownpayment(arr, 4).source === 'inherited');
  check('F: a year past the end of the array still carries', resolveDownpayment(arr, 9).source === 'inherited');
  check('F: with nothing set anywhere, a year is unset and not silently zero',
    resolveDownpayment([], 2).source === 'unset' && resolveDownpayment(undefined, 0).source === 'unset');

  // F2. ZERO IS A DECISION. This is the whole point of storing null: a zero
  // downpayment is a legitimate term, so it must not read as "not filled in",
  // and it must not be carried over by a later year looking backwards.
  check('F: an explicit zero reports as SET, not unset', resolveDownpayment([0], 0).source === 'set');
  check('F: an explicit zero is what a later year inherits',
    resolveDownpayment([0, null], 1).value === 0 && resolveDownpayment([0, null], 1).source === 'inherited');
  check('F: hasAnyDownpayment sees an explicit zero', hasAnyDownpayment([null, 0]) === true);
  check('F: hasAnyDownpayment is false when nothing is set', hasAnyDownpayment([null, null]) === false && hasAnyDownpayment([]) === false);

  // F3. The strip carries no Total and no Cumulative row. These are independent
  // per-cohort terms, each a percentage of its own sale year's value, so a
  // total of 80% would invite a reader to treat 100% as a target. The reference
  // model carries neither row on its downpayment line for the same reason.
  const screen = read(SCREEN);
  const stripCall = screen.slice(screen.indexOf('m2-cohort-dp-'), screen.indexOf('m2-cohort-dp-') + 400);
  check('F: the downpayment strip asks for no summary column', /summary="none"/.test(stripCall));
  check('F: the downpayment strip passes per-cell provenance', /entryStates=/.test(stripCall));
  // And the component must actually honour it, rather than accepting the prop
  // and rendering the rows anyway.
  check('F: the summary column is suppressed when summary is none',
    /\{summary !== 'none' && <th style=\{HEADER_TOTAL_CELL\}>/.test(screen));
  check('F: the cumulative row is bound to the total mode only',
    /const showCumulative = summary === 'total';/.test(screen));
  // The rows must SURVIVE on the cash payment profile, where they do mean
  // something. Dropping them everywhere would be the opposite mistake.
  const cashCall = screen.slice(screen.indexOf('m2-cash-') - 400, screen.indexOf('m2-cash-') + 60);
  check('F: the cash payment profile keeps its Total and Cumulative rows',
    !/summary="none"/.test(cashCall) && !/summary="avg"/.test(cashCall));

  // F4. Writing one year must not stamp zeros over the others, or the
  // distinction above is destroyed by the first edit.
  const setter = stripComments(screen.slice(screen.indexOf('const setDownpayment'), screen.indexOf('const setDownpayment') + 1200));
  check('F: the setter preserves unset years as null rather than filling zeros',
    setter.includes('null') && !/new Array<number>\(phaseLen\)\.fill\(0\)/.test(setter));
}

// ---------------------------------------------------------------------------
section('G. STEP 2: the cohort matrix can vary its terms by sale year');

{
  // G1. THE STATIC PATH IS UNTOUCHED. A resolver returning the same spec for
  // every year must produce the identical matrix, because that equivalence is
  // what makes the Step 3 switch-over a decision rather than a leap.
  const sales = [100, 200, 0, 300, 50];
  const spec = { percentages: [0.3, 0.4, 0.3], positions: [0, 1, 2], profileMode: 'relative_to_sale' as const };
  const viaSpec = buildCohortMatrix(sales, spec, 5);
  const viaResolver = buildCohortMatrix(sales, () => spec, 5);
  check('G: a resolver returning one spec matches passing that spec directly',
    JSON.stringify(viaSpec) === JSON.stringify(viaResolver));
  check('G: and the fixture is not vacuous (the matrix has content)',
    viaSpec.some((r) => r.some((v) => v > 0)));

  const absSpec = { percentages: [0.5, 0.5], positions: [1, 3] };
  check('G: the same holds in absolute_with_catchup mode',
    JSON.stringify(buildCohortMatrix(sales, absSpec, 5)) === JSON.stringify(buildCohortMatrix(sales, () => absSpec, 5)));

  // G2. TERMS THAT ACTUALLY DIFFER BY ROW. Without this the resolver is just a
  // more expensive way of passing one profile.
  const perYear = buildCohortMatrix([100, 100], (y) => (
    y === 0
      ? { percentages: [1], positions: [0], profileMode: 'relative_to_sale' as const }
      : { percentages: [0.5, 0.5], positions: [0, 1], profileMode: 'relative_to_sale' as const }
  ), 3);
  check('G: cohort 0 pays all at once', perYear[0][0] === 100 && perYear[0][1] === 0);
  check('G: cohort 1 splits across two years', perYear[1][1] === 50 && perYear[1][2] === 50);

  // G3. A row the resolver cannot serve is SKIPPED, not fatal. A static profile
  // that is unusable still abandons the whole matrix, as it always has.
  const oneBadRow = buildCohortMatrix([100, 100], (y) => (
    y === 0 ? { percentages: [] } : { percentages: [1], positions: [0], profileMode: 'relative_to_sale' as const }
  ), 2);
  check('G: an unusable row contributes nothing', oneBadRow[0].every((v) => v === 0));
  check('G: and its neighbours still compute', oneBadRow[1][1] === 100);
  check('G: an unusable STATIC profile still abandons the matrix, unchanged',
    buildCohortMatrix([100], { percentages: [] }, 1).every((r) => r.every((v) => v === 0)));
}

// ---------------------------------------------------------------------------
section('H. STEP 2: the reference rule, on the cases that separate it');

{
  // Handover at index 5, three instalment years allowed, twenty percent down.
  const H = 5;
  const terms = (saleYear: number, stopAtHandover = true, downpayment = 0.2, instalmentYearsAllowed = 3) =>
    ({ saleYear, handoverYear: H, downpayment, instalmentYearsAllowed, stopAtHandover });

  // H1. A COHORT SELLING AFTER HANDOVER pays in full in its own year. This is
  // the convention the post-sales path already uses, so the two must agree.
  {
    const p = buildSaleCohortProfile(terms(6));
    check('H1: a cohort selling after handover pays once', p.percentages.length === 1 && p.percentages[0] === 1);
    check('H1: and it pays in its own sale year', (p.positions ?? [])[0] === 0);
    check('H1: it gets no instalments', instalmentCount(terms(6)) === 0);
  }

  // H2. A COHORT SELLING IN THE HANDOVER YEAR is the boundary case, and the
  // reference treats it as "at or after", not "before".
  {
    const p = buildSaleCohortProfile(terms(5));
    check('H2: a cohort selling IN the handover year pays in full at once',
      p.percentages.length === 1 && p.percentages[0] === 1 && (p.positions ?? [])[0] === 0);
    check('H2: it gets no instalments', instalmentCount(terms(5)) === 0);
  }

  // H3. ONE YEAR BEFORE HANDOVER with a three year allowance: the run must
  // shorten to one, not stay at three.
  {
    const t = terms(4);
    check('H3: the instalment count shortens to 1', instalmentCount(t) === 1);
    const p = buildSaleCohortProfile(t);
    check('H3: two payments in total, a downpayment and one instalment', p.percentages.length === 2);
    check('H3: the downpayment is 20% in the sale year',
      Math.abs(p.percentages[0] - 0.2) < 1e-12 && (p.positions ?? [])[0] === 0);
    check('H3: the whole balance falls in the next year, which is handover',
      Math.abs(p.percentages[1] - 0.8) < 1e-12 && (p.positions ?? [])[1] === 1);
  }

  // H4. TWO YEARS BEFORE HANDOVER, the case that proves the count is computed
  // rather than fixed at the allowance. Requested by the user, and it is the
  // one a naive implementation gets wrong while passing H3.
  {
    const t = terms(3);
    check('H4: the instalment count shortens to 2, not the 3 allowed', instalmentCount(t) === 2);
    const p = buildSaleCohortProfile(t);
    check('H4: three payments, a downpayment and two instalments', p.percentages.length === 3);
    check('H4: the two instalments are EQUAL at 40% each',
      Math.abs(p.percentages[1] - 0.4) < 1e-12 && Math.abs(p.percentages[2] - 0.4) < 1e-12);
    check('H4: the last instalment lands ON handover, not past it',
      (p.positions ?? [])[2] === 2 && t.saleYear + ((p.positions ?? [])[2] ?? 0) === H);
  }

  // H5. FAR ENOUGH OUT, the allowance binds instead of handover.
  {
    const t = terms(0);
    check('H5: with room to spare the allowance binds at 3', instalmentCount(t) === 3);
    const p = buildSaleCohortProfile(t);
    check('H5: four payments', p.percentages.length === 4);
    check('H5: instalments are equal thirds of the balance',
      p.percentages.slice(1).every((v) => Math.abs(v - 0.8 / 3) < 1e-12));
    check('H5: the last one finishes BEFORE handover', t.saleYear + ((p.positions ?? [])[3] ?? 0) === 3);
  }

  // H6. THE TOGGLE. Off, the run is the full allowance even where it crosses
  // handover. This is why it is a toggle and not a rule.
  {
    const hard = terms(4, true);
    const soft = terms(4, false);
    check('H6: hard cut-off shortens to 1', instalmentCount(hard) === 1);
    check('H6: soft cut-off keeps all 3', instalmentCount(soft) === 3);
    const p = buildSaleCohortProfile(soft);
    check('H6: and the last payment really does fall past handover',
      soft.saleYear + ((p.positions ?? [])[3] ?? 0) === 7);
  }

  // H7. EVERY ROW SUMS TO ONE. This is the invariant that makes the whole
  // restructure a re-timing of money rather than a change to how much there is,
  // and it is the property the Step 3 measurement will lean on.
  {
    let worst = 0;
    for (let s = 0; s < 9; s++) {
      for (const stop of [true, false]) {
        for (const d of [0, 0.15, 0.5, 1]) {
          for (const m of [0, 1, 3, 6]) {
            const p = buildSaleCohortProfile(terms(s, stop, d, m));
            const total = p.percentages.reduce((a, b) => a + b, 0);
            worst = Math.max(worst, Math.abs(total - 1));
          }
        }
      }
    }
    check('H7: every profile across 288 combinations sums to exactly 1', worst < 1e-12, `worst deviation ${worst}`);
  }

  // H8. A zero downpayment and a 100% downpayment are both legal terms and
  // neither may lose the balance.
  {
    const zero = buildSaleCohortProfile(terms(0, true, 0));
    check('H8: a zero downpayment still pays nothing at sale', zero.percentages[0] === 0);
    check('H8: and spreads the whole value over the instalments',
      Math.abs(zero.percentages.slice(1).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    const full = buildSaleCohortProfile(terms(0, true, 1));
    check('H8: a 100% downpayment leaves zero instalments to pay',
      full.percentages[0] === 1 && full.percentages.slice(1).every((v) => v === 0));
  }

  // H9. END TO END through the matrix the engine will actually use, which is
  // the check that the profile shape and the matrix agree about what an offset
  // means. Conservation is asserted on the COLUMN SUMS, because that is the
  // series the funding solver will read.
  {
    const N = 9;
    const sales = [0, 100, 0, 200, 0, 0, 50, 0, 0];
    const m = buildCohortMatrix(sales, (s) => buildSaleCohortProfile(terms(s)), N);
    const cols = columnSums(m, N);
    const totalIn = sales.reduce((a, b) => a + b, 0);
    const totalOut = cols.reduce((a, b) => a + b, 0);
    check('H9: nothing is created or destroyed across the grid', Math.abs(totalOut - totalIn) < 1e-9,
      `${totalIn} in, ${totalOut} out`);
    // The 100 sold at index 1 is four years before handover, so the allowance
    // binds: 20 at year 1, then 26.67 at each of years 2, 3 and 4.
    check('H9: the year-1 cohort pays its downpayment in year 1', Math.abs(m[1][1] - 20) < 1e-9);
    check('H9: and three equal instalments after it',
      Math.abs(m[1][2] - 80 / 3) < 1e-9 && Math.abs(m[1][3] - 80 / 3) < 1e-9 && Math.abs(m[1][4] - 80 / 3) < 1e-9);
    check('H9: it pays nothing at or after handover', m[1].slice(5).every((v) => Math.abs(v) < 1e-9));
    // The 200 sold at index 3 is two years out, so its run shortens to two.
    check('H9: the year-3 cohort shortens to two instalments',
      Math.abs(m[3][3] - 40) < 1e-9 && Math.abs(m[3][4] - 80) < 1e-9 && Math.abs(m[3][5] - 80) < 1e-9);
    check('H9: and its last instalment lands exactly on handover',
      Math.abs(m[3][5] - 80) < 1e-9 && m[3].slice(6).every((v) => Math.abs(v) < 1e-9));
    // The 50 sold at index 6 is after handover, so it pays in full at once.
    check('H9: the post-handover cohort pays in full in its own year',
      Math.abs(m[6][6] - 50) < 1e-9 && m[6].every((v, i) => i === 6 || Math.abs(v) < 1e-9));
  }

  // H10. STILL NOTHING CALLS IT. Step 2 builds the rule; Step 3 wires it.
  {
    const roots = ['src/core/calculations', 'src/hubs/modeling/platforms/refm/lib'];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        // Where it is DEFINED and where it is re-exported are not calls.
        if (rel.endsWith('/revenue/cohortTerms.ts') || rel.endsWith('/revenue/index.ts')) continue;
        if (stripComments(read(rel)).includes('buildSaleCohortProfile')) offenders.push(rel);
      }
    };
    for (const r of roots) walk(r);
    check('H10: no engine path calls buildSaleCohortProfile yet', offenders.length === 0, offenders.join('; '));
  }
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
