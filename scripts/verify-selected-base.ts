/**
 * verify-selected-base.ts (Module 1 Capex, 2026-08-15)
 *
 * `percent_of_selected` may charge on any line ABOVE it on the same asset, and
 * on nothing else.
 *
 * THE CASE THIS EXISTS FOR: a developers fee charged on hard cost plus the soft
 * costs above it, then a contingency charged on everything INCLUDING the
 * developers fee. Both are percent_of_selected, and the picker used to exclude
 * that whole method ("we don't allow recursive references"), so the chain could
 * not be built at all. Ordering gives the same anti-cycle guarantee without
 * banning anything: there is no sequence of upward steps that returns to where
 * it started.
 *
 * THE RULE IS ENFORCED IN THE ENGINE, NOT ONLY OFFERED BY THE PICKER. Section C
 * is the one that matters: it drives the real engine, because a list that
 * merely looks right while the maths reads a different set is the failure mode
 * being designed out.
 *
 * Run: npx tsx scripts/verify-selected-base.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  assetVisibleLines, eligibleBaseLines, allowedSelectedIds,
} from '../src/core/calculations/selectedBase';
import { computeAssetCost, deriveCostStage, deriveCostType } from '../src/core/calculations';
import { sumCapexStages } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import {
  makeDefaultPhase, makeDefaultProject, makeBlankCostLines,
  COST_STAGES, COST_STAGE_LABELS,
  type Asset, type CostLine,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 60 - t.length))}`);

const SRC_UI = fs.readFileSync(
  path.resolve(__dirname, '../src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'),
  'utf8').replace(/\r\n/g, '\n');

const L = (id: string, method: CostLine['method'], value: number, over: Partial<CostLine> = {}): CostLine => ({
  id, phaseId: 'p1', name: id, method, value,
  stage: method === 'fixed' ? 'hard' : 'soft', scope: 'direct', allocationBasis: 'per_asset',
  startPeriod: 1, endPeriod: 2, phasing: 'even', ...over,
} as CostLine);

// ════════════════════════════════════════════════════════════════════════════
section('A. The rule');

const list = [
  L('build', 'fixed', 1000),
  L('prof', 'percent_of_selected', 6, { selectedLineIds: ['build'] }),
  L('devfee', 'percent_of_selected', 10, { selectedLineIds: ['build', 'prof'] }),
  L('conting', 'percent_of_selected', 5, { selectedLineIds: ['build', 'prof', 'devfee'] }),
];
const vis = assetVisibleLines(list, 'p1', 'a1');

check('A1 a line may charge on everything above it',
  JSON.stringify(eligibleBaseLines(vis, 'conting').map((c) => c.id)) === JSON.stringify(['build', 'prof', 'devfee']));
check('A2 ...in display order',
  eligibleBaseLines(vis, 'devfee').map((c) => c.id).join() === 'build,prof');
check('A3 the FIRST line may charge on nothing', eligibleBaseLines(vis, 'build').length === 0);
check('A4 a line never offers itself',
  !eligibleBaseLines(vis, 'devfee').some((c) => c.id === 'devfee'));
check('A5 nothing below is offered',
  !eligibleBaseLines(vis, 'prof').some((c) => c.id === 'devfee' || c.id === 'conting'));
// The whole point: percent_of_selected lines ARE offered now.
check('A6 a percent_of_selected line above IS offered (the developers fee case)',
  eligibleBaseLines(vis, 'conting').some((c) => c.id === 'devfee'),
  'this is exactly what the old method ban blocked');
check('A7 an unknown line id charges on nothing rather than everything',
  eligibleBaseLines(vis, 'nope').length === 0);

// Custom + asset-targeted lines were never the exclusion, and must stay in.
{
  const withCustom = [
    L('build', 'fixed', 1000),
    L('custom-1__p1', 'fixed', 50),                                  // project-wide custom
    L('custom-2__p1', 'fixed', 60, { targetAssetId: 'a1' }),         // targeted at this asset
    L('custom-3__p1', 'fixed', 70, { targetAssetId: 'other' }),      // another asset's
    L('conting', 'percent_of_selected', 5),
  ];
  const v = assetVisibleLines(withCustom, 'p1', 'a1');
  const ids = eligibleBaseLines(v, 'conting').map((c) => c.id);
  check('A8 a project-wide custom line is offered', ids.includes('custom-1__p1'));
  check('A9 a custom line targeted at THIS asset is offered', ids.includes('custom-2__p1'));
  check('A10 another asset\'s custom line is NOT', !ids.includes('custom-3__p1'));
}
{
  const gated = [
    L('build', 'fixed', 1000),
    L('rett__p1', 'percent_of_cash_land', 5, { requiresCountry: 'Saudi Arabia' }),
    L('conting', 'percent_of_selected', 5),
  ];
  check('A11 a country-gated line is offered where the gate matches',
    eligibleBaseLines(assetVisibleLines(gated, 'p1', 'a1', 'Saudi Arabia'), 'conting')
      .some((c) => c.id === 'rett__p1'));
  check('A12 ...and not where it does not',
    !eligibleBaseLines(assetVisibleLines(gated, 'p1', 'a1', 'UAE'), 'conting')
      .some((c) => c.id === 'rett__p1'));
}

// ════════════════════════════════════════════════════════════════════════════
section('B. Filtering a stored selection');

check('B1 an upward selection survives untouched',
  JSON.stringify(allowedSelectedIds(vis, 'conting', ['build', 'prof', 'devfee']))
    === JSON.stringify(['build', 'prof', 'devfee']));
check('B2 a downward selection is dropped',
  JSON.stringify(allowedSelectedIds(vis, 'prof', ['build', 'devfee'])) === JSON.stringify(['build']));
check('B3 a self reference is dropped',
  JSON.stringify(allowedSelectedIds(vis, 'devfee', ['devfee', 'build'])) === JSON.stringify(['build']));
check('B4 an unknown id is dropped', allowedSelectedIds(vis, 'conting', ['ghost']).length === 0);
check('B5 an empty selection stays empty', allowedSelectedIds(vis, 'conting', []).length === 0);

// ════════════════════════════════════════════════════════════════════════════
section('C. THE ENGINE ENFORCES IT (not just the picker)');

const project = makeDefaultProject();
const phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 3 };
const asset: Asset = {
  id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true,
  gfaSqm: 1000, buaSqm: 1000, sellableBuaSqm: 1000, parkingBaysRequired: 0, status: 'planned',
} as Asset;
const totals = (lines: CostLine[]): Record<string, number> =>
  computeAssetCost(asset, project as never, phase as never, [] as never, [asset], [] as never,
    lines, [], 'autoByBua').byLineId;

// The chain from the brief: build 1000, dev fee 10% of build (100),
// contingency 5% of (build + dev fee) = 5% of 1100 = 55.
{
  const t = totals([
    L('build', 'fixed', 1000),
    L('devfee', 'percent_of_selected', 10, { selectedLineIds: ['build'] }),
    L('conting', 'percent_of_selected', 5, { selectedLineIds: ['build', 'devfee'] }),
  ]);
  check('C1 the developers fee computes', Math.abs((t['devfee'] ?? 0) - 100) < 1e-9, String(t['devfee']));
  check('C2 contingency INCLUDES the developers fee in its base',
    Math.abs((t['conting'] ?? 0) - 55) < 1e-9, `${t['conting']} (55 = 5% of 1100)`);
}
// THE CHECK THAT ACTUALLY PROVES ENFORCEMENT.
//
// C3 to C7 below cannot tell an enforced rule from the engine's old accident:
// for a downward reference to ANOTHER percent_of_selected line, the forward
// pass read an absent map entry and contributed zero anyway, so both give the
// same numbers. A first draft of this file stopped there, and a sabotage
// removing the engine filter passed all of it.
//
// The distinguishing case is a downward reference to a DIRECT-method line.
// `directTotals` is fully populated in Pass 1, before Pass 3 runs, so the
// accident reads a REAL number for it and the base is genuinely wrong. This is
// also the correction to an earlier claim of mine that enforcing the rule moves
// no existing model: for this shape it does move, and it should.
{
  const t = totals([
    L('build', 'fixed', 1000),
    L('conting', 'percent_of_selected', 10, { selectedLineIds: ['build', 'below'] }),
    L('below', 'fixed', 500),
  ]);
  check('C2a a downward reference to a DIRECT line is excluded',
    Math.abs((t['conting'] ?? 0) - 100) < 1e-9,
    `${t['conting']} (100 = 10% of 1000; unenforced it reads 150 = 10% of 1500)`);
}
// A downward reference to another percent line contributes nothing either. It
// already contributed nothing by accident, so these two do not by themselves
// prove enforcement (see C2a).
{
  const t = totals([
    L('build', 'fixed', 1000),
    L('conting', 'percent_of_selected', 5, { selectedLineIds: ['build', 'devfee'] }),
    L('devfee', 'percent_of_selected', 10, { selectedLineIds: ['build'] }),
  ]);
  check('C3 a line below is excluded from the base',
    Math.abs((t['conting'] ?? 0) - 50) < 1e-9, `${t['conting']} (50 = 5% of 1000)`);
  check('C4 ...and the line below still computes its own total',
    Math.abs((t['devfee'] ?? 0) - 100) < 1e-9);
}
{
  const t = totals([
    L('build', 'fixed', 1000),
    L('self', 'percent_of_selected', 50, { selectedLineIds: ['self', 'build'] }),
  ]);
  check('C5 a line cannot charge on itself',
    Math.abs((t['self'] ?? 0) - 500) < 1e-9, `${t['self']} (500 = 50% of 1000)`);
}
{
  // A cycle is unrepresentable: the downward half is dropped, so the pair
  // resolves to a defined answer instead of an artefact of array position.
  const t = totals([
    L('build', 'fixed', 1000),
    L('cyc-a', 'percent_of_selected', 50, { selectedLineIds: ['cyc-b', 'build'] }),
    L('cyc-b', 'percent_of_selected', 50, { selectedLineIds: ['cyc-a', 'build'] }),
  ]);
  check('C6 a cycle cannot form: the downward half is dropped',
    Math.abs((t['cyc-a'] ?? 0) - 500) < 1e-9, String(t['cyc-a']));
  check('C7 ...and the upward half is honoured',
    Math.abs((t['cyc-b'] ?? 0) - 750) < 1e-9, `${t['cyc-b']} (750 = 50% of 1500)`);
}
// Deeper chain, to show it composes rather than working only one level down.
{
  const t = totals([
    L('build', 'fixed', 1000),
    L('prof', 'percent_of_selected', 10, { selectedLineIds: ['build'] }),
    L('devfee', 'percent_of_selected', 10, { selectedLineIds: ['build', 'prof'] }),
    L('conting', 'percent_of_selected', 10, { selectedLineIds: ['build', 'prof', 'devfee'] }),
  ]);
  check('C8 a three-deep chain composes',
    Math.abs((t['prof'] ?? 0) - 100) < 1e-9
    && Math.abs((t['devfee'] ?? 0) - 110) < 1e-9
    && Math.abs((t['conting'] ?? 0) - 121) < 1e-9,
    `prof=${t['prof']} devfee=${t['devfee']} conting=${t['conting']}`);
}
// The standard catalog must be unmoved: its selections all point upward.
{
  const cat = makeBlankCostLines('p1', 4).map((l) => (l.id.startsWith('construction-bua') ? { ...l, value: 4500 } : l));
  const t = totals(cat);
  const contingId = cat.find((c) => c.id.startsWith('contingency'))!.id;
  check('C9 the standard catalog still resolves (its selections point upward)',
    Number.isFinite(t[contingId] ?? 0));
  const catVis = assetVisibleLines(cat, 'p1', 'a1');
  for (const c of cat.filter((x) => x.method === 'percent_of_selected')) {
    const kept = allowedSelectedIds(catVis, c.id, c.selectedLineIds);
    check(`C10 catalog line ${c.id.split('__')[0]} keeps every seeded selection`,
      kept.length === (c.selectedLineIds ?? []).length,
      `${kept.length}/${(c.selectedLineIds ?? []).length}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('E. The reference cost cascade, built by SELECTION');

// The structure a development budget is actually built from, expressed with
// nothing hardcoded: every base is a set of preceding lines chosen per line.
// Kept as a permanent check because it is the shape the whole ordering rule
// exists to support, and because it is the case that proves a custom line
// (developer fee) can sit inside a later line's base.
{
  const HARD = ['superstructure', 'parking', 'landscape'];
  const AFTER_HARD = [...HARD, 'engineering', 'design', 'permits'];
  const cascade: CostLine[] = [
    L('superstructure', 'fixed', 1000),
    L('parking', 'fixed', 200),
    L('landscape', 'fixed', 100),
    L('engineering', 'percent_of_selected', 2, { selectedLineIds: HARD }),
    L('design', 'percent_of_selected', 3, { selectedLineIds: HARD }),
    L('permits', 'percent_of_selected', 1, { selectedLineIds: HARD }),
    L('sales-marketing', 'fixed', 50),
    L('dev-fee', 'percent_of_selected', 5, { selectedLineIds: [...AFTER_HARD, 'sales-marketing'] }),
    L('conting', 'percent_of_selected', 5, { selectedLineIds: [...AFTER_HARD, 'dev-fee', 'sales-marketing'] }),
  ];
  const v = assetVisibleLines(cascade, 'p1', 'a1');
  // Every base must be OFFERABLE, not merely computable: a cascade the engine
  // resolves but the picker will not let you build is not usable.
  for (const l of cascade.filter((x) => x.method === 'percent_of_selected')) {
    const offered = new Set(eligibleBaseLines(v, l.id).map((c) => c.id));
    const missing = (l.selectedLineIds ?? []).filter((id) => !offered.has(id));
    check(`E1 ${l.id}: every base is offered by the picker`, missing.length === 0, missing.join(', '));
  }
  const t = totals(cascade);
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  check('E2 hard cost is the sum of superstructure, parking and landscape',
    near(HARD.reduce((s, id) => s + (t[id] ?? 0), 0), 1300));
  check('E3 engineering is 2% of hard cost', near(t['engineering'] ?? 0, 26));
  check('E4 design is 3% of hard cost', near(t['design'] ?? 0, 39));
  check('E5 permits is 1% of hard cost', near(t['permits'] ?? 0, 13));
  check('E6 developer fee is 5% of hard + eng + design + permits + sales marketing',
    near(t['dev-fee'] ?? 0, 71.4), `${t['dev-fee']} (5% of 1428)`);
  check('E7 contingency is 5% of that PLUS the developer fee',
    near(t['conting'] ?? 0, 74.97), `${t['conting']} (5% of 1499.4)`);
  const totalExclLand = 1300 + 26 + 39 + 13 + (t['dev-fee'] ?? 0) + (t['conting'] ?? 0);
  check('E8 total construction excl land and excl sales marketing',
    near(totalExclLand, 1524.37), String(totalExclLand));
  // The KNOWN GAP, pinned so it is a recorded limitation rather than a surprise:
  // the platform's own "excl land" figure is stage-based, and sales marketing is
  // a soft cost, so it sits INSIDE that figure. The reference total excludes it.
  // There is no user-defined subtotal that can leave a line out.
  // ── The subtotal gap, CLOSED (2026-08-16) ───────────────────────────────
  //
  // Marketing has its own stage, so the platform's construction-cost figure now
  // matches the reference total exactly. Built from the SHARED report builder
  // rather than by re-adding the numbers here, because the builder is what the
  // screen, the PDF and the workbook all render.
  {
    const reportLines = cascade.map((l) => ({
      stage: l.id === 'sales-marketing' ? 'marketing' : (l.stage as string),
      amount: t[l.id] ?? 0,
    }));
    const sub = sumCapexStages(reportLines);
    check('E9 construction cost excl land now EXCLUDES marketing',
      near(sub.exclLand, 1524.37), `${sub.exclLand} (reference 1524.37)`);
    check('E9a marketing is reported as its own subtotal, not hidden',
      near(sub.marketing, 50), String(sub.marketing));
    check('E9b nothing is lost: construction + marketing + land = total',
      near(sub.exclLand + sub.marketing + sub.land, sub.total),
      `${sub.exclLand} + ${sub.marketing} + ${sub.land} vs ${sub.total}`);
    check('E9c marketing is NOT counted as a soft cost any more',
      near(sub.soft, 26 + 39 + 13 + (t['dev-fee'] ?? 0) + (t['conting'] ?? 0)),
      String(sub.soft));
  }
  // THE OTHER HALF: the stage must not disturb the cascade. Bases are
  // selections of named lines and have never consulted a stage, so the fee and
  // the contingency must be unchanged to the last decimal.
  check('E9d the developer fee STILL charges on marketing',
    near(t['dev-fee'] ?? 0, 71.4), `${t['dev-fee']} (5% of 1428, marketing included)`);
  check('E9e the contingency STILL charges on marketing',
    near(t['conting'] ?? 0, 74.97), `${t['conting']} (5% of 1499.40, marketing included)`);
  check('E9f the marketing line is still offerable to both bases',
    eligibleBaseLines(v, 'dev-fee').some((c) => c.id === 'sales-marketing')
    && eligibleBaseLines(v, 'conting').some((c) => c.id === 'sales-marketing'));

  // ── THE BASE IS A LIFETIME TOTAL, NOT AN AMOUNT-TO-DATE ─────────────────
  //
  // This matters because sales marketing follows the COLLECTION profile, so it
  // lands well after construction, while the developer fee is charged during
  // the build. If the base were period-aware, the fee would move with
  // collection timing, which is wrong: a fee on marketing spend is a fee on
  // the whole of it, whenever it happens to be paid.
  //
  // The engine resolves every line to ONE scalar total in passes 1 to 3, and
  // applies phasing afterwards in a separate loop, so a base can only ever be
  // a lifetime figure. Proven here by changing the marketing line's phasing to
  // three very different curves and requiring the fee and the contingency to
  // be byte-identical across all of them.
  const phasings: Array<[string, Partial<CostLine>]> = [
    ['even across the build', { phasing: 'even', startPeriod: 1, endPeriod: 3 }],
    ['all in the first period', { phasing: 'manual', distribution: [1, 0, 0], startPeriod: 1, endPeriod: 3 }],
    ['all in the last period, after the build', { phasing: 'manual', distribution: [0, 0, 0, 1], startPeriod: 1, endPeriod: 4 }],
  ];
  const results = phasings.map(([, patch]) => {
    const variant = cascade.map((l) => (l.id === 'sales-marketing' ? { ...l, ...patch } as CostLine : l));
    const r = totals(variant);
    return { fee: r['dev-fee'] ?? 0, cont: r['conting'] ?? 0, sm: r['sales-marketing'] ?? 0 };
  });
  check('E10 the marketing line total itself is unmoved by its phasing',
    results.every((r) => near(r.sm, 50)), results.map((r) => r.sm).join(' / '));
  check('E11 the DEVELOPER FEE uses the lifetime marketing total, not spend to date',
    results.every((r) => near(r.fee, 71.4)), results.map((r) => r.fee.toFixed(4)).join(' / '));
  check('E12 the CONTINGENCY does too',
    results.every((r) => near(r.cont, 74.97)), results.map((r) => r.cont.toFixed(4)).join(' / '));
  // And the same for a base line whose own timing is wildly different: the fee
  // must not track WHEN the base is spent under any arrangement.
  const shifted = cascade.map((l) => (l.id === 'superstructure'
    ? { ...l, phasing: 'manual', distribution: [0, 0, 1], startPeriod: 1, endPeriod: 3 } as CostLine : l));
  check('E13 ...and a construction line\'s own phasing does not move the fee either',
    near(totals(shifted)['dev-fee'] ?? 0, 71.4), String(totals(shifted)['dev-fee']));
}

// ════════════════════════════════════════════════════════════════════════════
section('F. The marketing stage');

{
  const cat = makeBlankCostLines('p1', 4);
  const mk = cat.find((c) => c.id.startsWith('marketing'))!;
  check('F1 the seeded Marketing line carries the marketing stage', mk.stage === 'marketing');
  check('F2 deriveCostStage agrees (it is id-driven, and must not say soft)',
    deriveCostStage(mk) === 'marketing');
  // CostType is a coarser internal classification with no marketing member. Its
  // default branch returns 'hard', so an unhandled stage would have made a
  // selling cost read as a hard cost wherever CostType is consulted.
  check('F3 CostType maps marketing to soft, NOT to the hard default',
    deriveCostType(mk) === 'soft');
  check('F4 no OTHER seeded line was moved onto the new stage',
    cat.filter((c) => c.stage === 'marketing').length === 1);
  // Every stage must be renderable, or a line lands on a stage with no label.
  for (const s of COST_STAGES) {
    check(`F5 ${s} has a label`, !!COST_STAGE_LABELS[s]);
  }
  check('F6 the engine buckets marketing separately', (() => {
    const lines = [L('build', 'fixed', 1000), { ...L('mk', 'fixed', 50), stage: 'marketing' } as CostLine];
    const bd = computeAssetCost(asset, project as never, phase as never, [] as never, [asset],
      [] as never, lines, [], 'autoByBua');
    return bd.byStage.marketing === 50 && bd.byStage.soft === 0 && bd.byStage.hard === 1000;
  })());
}

// ════════════════════════════════════════════════════════════════════════════
section('D. One rule, two surfaces');

check('D1 the picker uses the shared predicate',
  /eligibleBaseLines\(\s*assetVisibleLines\(costLines, line\.phaseId, asset\.id, projectCountry\)/.test(SRC_UI));
check('D2 the method ban is gone',
  !/c\.method !== 'percent_of_selected'/.test(SRC_UI),
  'banning the method is what blocked the developers fee chain');
check('D3 the picker no longer hand-rolls its own filter',
  !/c\.phaseId === line\.phaseId &&/.test(SRC_UI));

console.log('');
if (failures.length === 0) {
  console.log(`verify-selected-base: ${passed} passed, 0 failures`);
  process.exit(0);
}
console.log(`verify-selected-base: ${passed} passed, ${failures.length} FAILURES`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(1);
