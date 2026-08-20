/**
 * verify-sale-cohort-inputs.ts (2026-08-19)
 *
 * MODULE 2 SALE COHORT RESTRUCTURE: THE COHORT RULE DRIVES COLLECTIONS.
 *
 * Step 1 lands three inputs before the rule that will consume them:
 *
 *   downpaymentByPhase          a FRACTION per SALE YEAR, phase-local
 *   maxInstalmentYears          one number for the asset
 *   instalmentsStopAtHandover   a toggle, absent means true (hard cut-off)
 *
 * Steps 1 and 2 landed the inputs and the rule while nothing read them, and
 * this file asserted that nothing did. STEP 3 SWITCHED IT ON, so those checks
 * have been REPLACED, as their own comments promised, by checks on what the
 * rule actually does:
 *
 *   C  the terms reach the engine and MOVE the money they are supposed to move
 *   D  the retired input no longer drives collections, and the screen and the
 *      exports say so rather than presenting it as live
 *
 * The invariant that survives from the earlier steps is the one that matters
 * most: LIFETIME COLLECTIONS PER ASSET ARE UNCHANGED, because a rule that only
 * re-times money cannot change how much there is.
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
import { buildSaleCohortTermsBlock, saleCohortRuleText } from '../src/hubs/modeling/platforms/refm/lib/reports/saleCohortReports';
import { makeDefaultProject } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
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
section('C. THE TERMS REACH THE ENGINE AND MOVE THE MONEY');

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

  const run = (terms: Record<string, unknown>) => computeAllSellResults(
    { project, phases: [phase], assets: [makeAsset(terms)], subUnits: [subUnit] } as never,
  ).bySellAsset.get('asset1') as unknown as Record<string, number[]>;

  // C1. THE TERMS REACH THE ENGINE. This was the check that was missing at
  // Step 1 and it is why a sabotage that moved real money still passed: the
  // config mapper had dropped the fields before the engine ever saw them.
  const cfg = resolveSellConfig(
    makeAsset({ downpaymentByPhase: [0.2], maxInstalmentYears: 1, instalmentsStopAtHandover: false }),
    project,
  ) as unknown as Record<string, unknown>;
  check('C1: the engine config carries the downpayment',
    JSON.stringify(cfg?.downpaymentByPhase) === JSON.stringify([0.2]));
  check('C1: the engine config carries the instalment allowance', cfg?.maxInstalmentYears === 1);
  check('C1: the engine config carries the cut-off toggle', cfg?.instalmentsStopAtHandover === false);
  const cfgEscrow = resolveSellConfig(makeAsset({ escrow: { heldPctOverride: 0.35 } }), project) as unknown as { escrow?: { heldPctOverride?: number } };
  check('C1: and escrow, which the old field list had dropped', cfgEscrow?.escrow?.heldPctOverride === 0.35);

  // C2. CHANGING A TERM CHANGES THE CASH. The mirror of the Step 1 check: what
  // was required to be inert is now required to bite.
  const a = run({ downpaymentByPhase: [0.5, 0.5, 0.5, 0.5], maxInstalmentYears: 3 });
  const b = run({ downpaymentByPhase: [0, 0, 0, 0], maxInstalmentYears: 3 });
  check('C2: a different downpayment gives a different cash profile',
    JSON.stringify(a.cashCollectedPerPeriod) !== JSON.stringify(b.cashCollectedPerPeriod));
  const c = run({ downpaymentByPhase: [0.5, 0.5, 0.5, 0.5], maxInstalmentYears: 1 });
  check('C2: a different instalment allowance gives a different cash profile',
    JSON.stringify(a.cashCollectedPerPeriod) !== JSON.stringify(c.cashCollectedPerPeriod));
  const d = run({ downpaymentByPhase: [0.5, 0.5, 0.5, 0.5], maxInstalmentYears: 3, instalmentsStopAtHandover: false });
  check('C2: releasing the handover cut-off gives a different cash profile',
    JSON.stringify(a.cashCollectedPerPeriod) !== JSON.stringify(d.cashCollectedPerPeriod));

  // C3. AND THE TOTAL NEVER MOVES. The invariant behind the whole restructure.
  const totalOf = (x: Record<string, number[]>) => (x.cashCollectedPerPeriod ?? []).reduce((s2, v) => s2 + v, 0);
  const saleOf = (x: Record<string, number[]>) =>
    (x.presalesRevenuePerPeriod ?? []).reduce((s2, v) => s2 + v, 0)
    + (x.postSalesRevenuePerPeriod ?? []).reduce((s2, v) => s2 + v, 0);
  for (const [label, res] of [['downpayment 50%', a], ['downpayment 0%', b], ['one instalment', c], ['no cut-off', d]] as const) {
    check('C3: lifetime collections equal lifetime sale value (' + label + ')',
      Math.abs(totalOf(res) - saleOf(res)) < 1e-6, String(totalOf(res) - saleOf(res)));
  }

  // C4. THE PRE-SALES CASH SERIES IS THE MATRIX. They used to be built
  // separately from the same profile, which is two chances to answer one
  // question. Compared against the PRE-SALES half deliberately: the vintage
  // matrix covers pre-sales cohorts only, and total collections also carry
  // post-handover sales, which have no matrix and never did.
  const cols = new Array((a.cashCollectedPerPeriod ?? []).length).fill(0);
  for (const rowArr of (a as unknown as { cashVintageMatrix: number[][] }).cashVintageMatrix) {
    for (let i = 0; i < rowArr.length && i < cols.length; i++) cols[i] += rowArr[i] ?? 0;
  }
  check('C4: pre-sales collections are exactly the cohort matrix column sums',
    cols.every((v, i) => Math.abs(v - (a.presalesCashPerPeriod[i] ?? 0)) < 1e-9));
  check('C4: and total collections are the pre-sales plus post-sales halves',
    (a.cashCollectedPerPeriod ?? []).every((v, i) => Math.abs(v - ((a.presalesCashPerPeriod[i] ?? 0) + (a.postSalesCashPerPeriod[i] ?? 0))) < 1e-9));

  // C5. A POST-HANDOVER COHORT IS UNAFFECTED BY THE TERMS, because it pays in
  // full in its own year. Sales during operation must not have been disturbed.
  check('C5: post-sales cash still equals post-sales revenue exactly',
    JSON.stringify(a.postSalesCashPerPeriod) === JSON.stringify(a.postSalesRevenuePerPeriod));

  // C6. RECOGNITION IS UNTOUCHED. Cash and recognition are separate schedules
  // and this step changed only one of them.
  check('C6: changing the cash terms does not move recognition',
    JSON.stringify(a.recognitionPerPeriod) === JSON.stringify(b.recognitionPerPeriod));
}

// ---------------------------------------------------------------------------
section('D. The retired input is retired, and every surface says so');

{
  // The cash payment profile no longer drives collections. Leaving an editable
  // strip that changes nothing would be TRAPS 7.20, and leaving the exports
  // printing it under a plain heading would be the same lie on paper.
  const screen = read(SCREEN);

  check('D: the engine no longer calls the old single-profile distributor',
    !stripComments(read('src/core/calculations/revenue/sell.ts')).includes('distributeCashCollection'));
  check('D: and the engine builds its cash from the cohort rule',
    stripComments(read('src/core/calculations/revenue/sell.ts')).includes('buildSaleCohortProfile'));

  // No editable control for the retired profile. The setter may still exist for
  // the stored data, but nothing may render an input bound to it.
  check('D: the screen renders no editable strip for the cash payment profile',
    !/testidPrefix=\{`m2-cash-\$\{asset\.id\}`\}/.test(screen));
  check('D: and it says the profile is superseded',
    /superseded/i.test(screen) && /No longer used/i.test(screen));
  // SCOPED TO THE COHORT TERMS SECTION, not the whole screen. The project
  // default band added by Option B Step 1 correctly says 'Not yet applied'
  // about ITSELF, and a screen-wide scan cannot tell the two apart.
  check('D: the cohort terms section no longer claims it is not applied',
    !/These (inputs|terms) are stored but not yet (applied|used)/i.test(screen)
    && !/Collections still follow the cash payment profile above/i.test(screen));
  check('D: the cohort section says it drives collections',
    /Drives collections/i.test(screen) && /These terms drive collections/i.test(screen));

  // An asset with no downpayment set is treated as taking no deposit, which is
  // a large consequence reachable by doing nothing, so the screen must say it.
  check('D: the screen warns when no downpayment is set anywhere on the asset',
    /No downpayment is set on this asset/.test(screen));

  // ONE SHARED BUILDER for the exports, not three copies. The label must come
  // from the shared constant at every site, so re-wording it is one edit.
  const wb = read('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts');
  const pdf = read('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts');
  for (const [name, src] of [['workbook', wb], ['pdf', pdf]] as const) {
    check('D: the ' + name + ' imports the shared sale cohort builder', src.includes('saleCohortReports'));
    check('D: the ' + name + ' labels the retired row from the shared constant',
      src.includes('CASH_PROFILE_SUPERSEDED_LABEL'));
    check('D: the ' + name + ' prints the live cohort terms', src.includes('buildSaleCohortTermsBlock'));
    check('D: the ' + name + ' re-declares no label of its own',
      !/'Cash payment %'/.test(stripComments(src)));
  }

  // The builder must produce something on a real shape, or the wiring above is
  // decorative.
  const phase = { id: 'ph1', startDate: '2026-01-01', constructionPeriods: 4 } as unknown as Phase;
  const asset = {
    id: 'a1', phaseId: 'ph1', name: 'Tower A',
    revenue: { sell: { assetId: 'a1', subUnits: [], downpaymentByPhase: [0.2, null, 0.3], maxInstalmentYears: 2, instalmentsStopAtHandover: false } },
  } as unknown as Asset;
  const block = buildSaleCohortTermsBlock(asset, phase, 2026);
  check('D: the builder returns a block for a sell asset', block !== null);
  check('D: one column per construction year', block?.downpayments.length === 4);
  check('D: it reports the set year', block?.downpayments[0].source === 'set' && block?.downpayments[0].value === 0.2);
  check('D: it carries forward into the unset year', block?.downpayments[1].source === 'inherited' && block?.downpayments[1].value === 0.2);
  check('D: handover is the LAST construction year, not the first operating one',
    block?.handoverYear === 2029);
  check('D: it reports the allowance and the toggle',
    block?.instalmentYears === 2 && block?.stopAtHandover === false);
  check('D: the rule text names this asset\'s own numbers',
    (saleCohortRuleText(block!) ?? '').includes('2 years') && saleCohortRuleText(block!).includes('2029'));
  const bare = buildSaleCohortTermsBlock(
    { id: 'a2', phaseId: 'ph1', name: 'B', revenue: { sell: { assetId: 'a2', subUnits: [] } } } as unknown as Asset, phase, 2026,
  );
  check('D: an asset with no downpayment is flagged', bare?.noDownpaymentSet === true);
  check('D: and the default allowance is the shared constant', bare?.instalmentYears === 3);
  check('D: a non-sell asset returns nothing',
    buildSaleCohortTermsBlock({ id: 'a3', phaseId: 'ph1', name: 'C' } as unknown as Asset, phase, 2026) === null);
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

  // H10. THE RULE IS THE ONE THE ENGINE RUNS. Steps 1 and 2 asserted that
  // nothing called this; Step 3 requires that the sell engine does, and that
  // the retired distributor is gone rather than merely unused.
  {
    const sell = stripComments(read('src/core/calculations/revenue/sell.ts'));
    check('H10: the sell engine builds its cash from buildSaleCohortProfile',
      sell.includes('buildSaleCohortProfile'));
    check('H10: it resolves the downpayment through the shared rule',
      sell.includes('resolveDownpayment'));
    check('H10: it takes the collections series from the cohort matrix',
      sell.includes('columnSums(cashVintageMatrix'));
    check('H10: the old single-profile distributor is not called anywhere in src',
      !stripComments(read('src/core/calculations/revenue/sell.ts')).includes('distributeCashCollection'));
  }
}

// ---------------------------------------------------------------------------
section('I. OPTION B STEP 1: the project default is stored and changes nothing');

{
  // The per-asset downpayment is set per sale year. An asset carrying NOTHING
  // used to resolve every cohort to a zero deposit, which is a large
  // consequence reachable by doing nothing: it is what takes FMP RE HUB's
  // funding requirement from 234.301m to 1,032.419m. The project default
  // stands in for such an asset.
  //
  // STEP 1 STORES IT AND READS IT NOWHERE, so the screen can be reviewed while
  // no saved number can move. Step 2 wires the resolution and MUST replace the
  // "reads nothing" checks below, exactly as Step 3 of the restructure
  // replaced sections C and D.

  const stored = read(STORED_TYPES);
  check('I: saleCohortDefaults is declared on Project', /saleCohortDefaults\?:/.test(stored));
  check('I: with a downpayment field', /saleCohortDefaults\?: \{[\s\S]{0,400}downpayment\?: number;/.test(stored));

  // SEEDED TO NOTHING. A default of zero and no default at all are different
  // statements, and the whole point of this step is that the second one is
  // visible rather than silently behaving like the first.
  const defaults = makeDefaultProject() as unknown as Record<string, unknown>;
  check('I: a new project has NO default seeded',
    defaults.saleCohortDefaults === undefined
    || (defaults.saleCohortDefaults as { downpayment?: number }).downpayment === undefined);

  // Nothing in the engine or the resolvers may read it yet.
  {
    const roots = ['src/core/calculations', 'src/hubs/modeling/platforms/refm/lib'];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (rel === STORED_TYPES) continue;   // where it is DECLARED, not read
        if (stripComments(read(rel)).includes('saleCohortDefaults')) offenders.push(rel);
      }
    };
    for (const r of roots) walk(r);
    check('I: no engine or resolver file reads saleCohortDefaults yet',
      offenders.length === 0, offenders.join('; '));
  }

  // And the screen DOES edit it, or Step 1 shipped nothing.
  const screen = read(SCREEN);
  check('I: the Module 2 Revenue screen edits it', stripComments(screen).includes('saleCohortDefaults'));
  check('I: the project default input is rendered', screen.includes('m2-project-default-downpayment'));
  check('I: it can be CLEARED back to not-set',
    screen.includes('m2-project-default-downpayment-clear') && /delete next\.downpayment/.test(screen));
  check('I: the screen states it is not yet applied', /Not yet applied/.test(screen));
  check('I: and states that not set is not the same as zero',
    /not the same as zero/i.test(screen));
  // The write must SPREAD, not rebuild from a field list, so a sibling default
  // added later is not dropped (TRAPS 7.16, three instances on this path).
  check('I: the setter spreads the existing defaults object',
    /\.\.\.\(project\.saleCohortDefaults \?\? \{\}\)/.test(stripComments(screen)));

  // BEHAVIOURAL: setting it moves nothing, because nothing reads it. The
  // anti-vacuity lesson from Step 1 applies, so this also proves the value
  // really is present on the project the engine is handed.
  {
    const project = { name: 'P', startDate: '2026-01-01', modelType: 'annual' } as unknown as Project;
    const withDefault = { ...project, saleCohortDefaults: { downpayment: 0.45 } } as unknown as Project;
    check('I: the fixture really carries the default (not a vacuous pass)',
      (withDefault as unknown as { saleCohortDefaults?: { downpayment?: number } }).saleCohortDefaults?.downpayment === 0.45);
    const phase = {
      id: 'phase1', name: 'Phase 1', startDate: '2026-01-01',
      constructionPeriods: 4, operationsPeriods: 6, overlapPeriods: 0, status: 'planning',
    } as unknown as Phase;
    const subUnit = {
      id: 'su1', assetId: 'asset1', name: 'Apartments', category: 'residential',
      metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
    } as unknown as SubUnit;
    // An asset with NO downpayment of its own: the exact case the default is
    // for, so if it were being read anywhere this would move.
    const asset = {
      id: 'asset1', phaseId: 'phase1', name: 'Tower A', type: 'Residential',
      strategy: 'Sell', visible: true, gfaSqm: 10000, buaSqm: 8000, sellableBuaSqm: 6000,
      revenue: { sell: {
        assetId: 'asset1',
        subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [0.1, 0.3, 0.3, 0.2], postSalesVelocityByPhase: [0.1], preSalesVelocity: [], postSalesVelocity: [] }],
        cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup' },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      } },
    } as unknown as Asset;
    const without = computeAllSellResults({ project, phases: [phase], assets: [asset], subUnits: [subUnit] } as never).bySellAsset.get('asset1');
    const withIt = computeAllSellResults({ project: withDefault, phases: [phase], assets: [asset], subUnits: [subUnit] } as never).bySellAsset.get('asset1');
    check('I: the fixture computes something', ((without as unknown as Record<string, number[]>)?.cashCollectedPerPeriod ?? []).some((v) => v > 0));
    check('I: setting the project default moves NOTHING at Step 1',
      JSON.stringify(without) === JSON.stringify(withIt));
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
