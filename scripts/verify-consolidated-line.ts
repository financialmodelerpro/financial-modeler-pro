/**
 * verify-consolidated-line.ts (2026-09-09, consolidation merge rules)
 *
 * THE COLLISIONS DISAPPEAR RATHER THAN BEING RESOLVED.
 *
 * What it proves:
 *   A. THE MERGE IS UNCONDITIONAL. Same type, same phase, one line; a different
 *      phase is a different line; strategy is NOT part of the key.
 *   B. A COMPANION IS NOT A LINE MEMBER, which is what dropping strategy from
 *      the key made necessary rather than optional.
 *   C. THE TWO FIELD LISTS ARE DISJOINT. A field with two owners is the shape
 *      of most defects in this codebase, so line-level and plot-level are
 *      declared separately and proven not to overlap, and every field step 2a
 *      flagged as colliding is accounted for by one of them.
 *   D. NO NUMBER CHANGES. Every live line on both projects has exactly ONE
 *      member, so every line-level value is that member's verbatim and nothing
 *      merges. Measured on the real snapshots, field by field.
 *   E. A LINE POOLS LAND from several plots, with a blended rate that is value
 *      over area rather than an average of rates.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-consolidated-line.ts
 *
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import {
  LINE_LEVEL_FIELDS,
  PLOT_LEVEL_FIELDS,
  poolLineAreas,
  poolLineLand,
  resolveConsolidatedLine,
  resolveLineField,
  type LineMemberAsset,
} from '../src/core/calculations/consolidatedLine';
import { consolidationKey, consolidationKeyParts, groupAssetsForConsolidation } from '../src/core/calculations/consolidation';
import { COMPARED_FIELDS } from '../src/core/calculations/consolidationCollisions';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };
const N = normaliseAssetTypeId;
const A = (o: Record<string, unknown>) => ({ phaseId: 'p1', strategy: 'Sell', ...o } as never);

function offlineChecks(): void {
  section('A. The merge is unconditional: same type, same phase, one line');
  check('A1 the key is phase and type, and carries NO strategy',
    consolidationKey(A({ id: 'a', type: 'Branded Villas', strategy: 'Sell' }), N) === 'p1|branded-villas');
  check('A2 two plots of one type in one phase share a line whatever their strategy',
    consolidationKey(A({ id: 'a', type: 'Branded Villas', strategy: 'Sell' }), N)
    === consolidationKey(A({ id: 'b', type: 'Branded Villas', strategy: 'Lease' }), N));
  check('A3 a different PHASE is still a different line',
    consolidationKey(A({ id: 'a', phaseId: 'p2', type: 'X' }), N)
    !== consolidationKey(A({ id: 'b', phaseId: 'p3', type: 'X' }), N));
  check('A4 a different TYPE is still a different line',
    consolidationKey(A({ id: 'a', type: 'X' }), N) !== consolidationKey(A({ id: 'b', type: 'Y' }), N));
  // A5 EXISTS BECAUSE A1 TO A4 PASSED WHILE THE OPPOSITE WAS SHIPPING.
  //
  // They test `consolidationKey`, which nothing groups by. The GROUPING built
  // its own `phase|type|strategy` string beside it, so the merge was not
  // unconditional on the only code path any screen runs, and four green checks
  // said it was. The one rule now has one statement, and this is what holds it
  // there: two plots of one type in one phase must land in ONE group whatever
  // their strategies, asserted through the function callers actually call.
  const twoStrategies = groupAssetsForConsolidation([
    A({ id: 'a', type: 'Branded Villas', strategy: 'Sell' }),
    A({ id: 'b', type: 'Branded Villas', strategy: 'Lease' }),
  ], ['p1'], N);
  check('A5 the GROUPING merges them too, not just the key function nothing groups by',
    twoStrategies.length === 1 && twoStrategies[0].assets.length === 2
    && twoStrategies[0].key === consolidationKey(A({ id: 'a', type: 'Branded Villas', strategy: 'Sell' }), N),
    `${twoStrategies.length} groups, key ${twoStrategies[0]?.key}`);
  check('A5b the group key IS the key function, character for character',
    !/const key = `\$\{parts\.phaseId\}/.test(readFileSync('src/core/calculations/consolidation.ts', 'utf8'))
    && /const key = consolidationKey\(a, normaliseTypeId\);/
      .test(readFileSync('src/core/calculations/consolidation.ts', 'utf8')));

  section('B. A companion is not a line member');
  const gs = groupAssetsForConsolidation([
    A({ id: 'parent', phaseId: 'p2', type: 'High-end Apartments', strategy: 'Sell + Manage' }),
    A({ id: 'comp', phaseId: 'p2', type: 'High-end Apartments', strategy: 'Operate', isCompanion: true }),
  ], ['p2'], N);
  check('B1 the parent and its companion do NOT become one two-strategy line',
    gs.length === 1 && gs[0].assets.length === 1 && gs[0].assets[0].id === 'parent',
    JSON.stringify(gs.map((g) => g.assets.map((x) => x.id))));
  check('B2 a companion never appears in any line',
    gs.every((g) => g.assets.every((x) => x.isCompanion !== true)));

  section('C. Line-level and plot-level are disjoint, and cover the collisions');
  const overlap = LINE_LEVEL_FIELDS.filter((f) => (PLOT_LEVEL_FIELDS as readonly string[]).includes(f));
  check('C1 no field is on BOTH lists (a field with two owners has no owner)',
    overlap.length === 0, overlap.join(', '));
  check('C2 both lists are non-trivial',
    LINE_LEVEL_FIELDS.length >= 12 && PLOT_LEVEL_FIELDS.length >= 8);
  // EVERY COLLISION STEP 2a FOUND IS ACCOUNTED FOR. A compared field that is on
  // neither list is a collision nobody decided about, which is exactly the gap
  // this whole exercise exists to close.
  const KEY_PARTS = ['phaseId', 'assetTypeId'];
  const unaccounted = COMPARED_FIELDS
    .map((c) => c.field)
    .filter((f) => !(LINE_LEVEL_FIELDS as readonly string[]).includes(f))
    .filter((f) => !(PLOT_LEVEL_FIELDS as readonly string[]).includes(f))
    .filter((f) => !KEY_PARTS.includes(f))
    .filter((f) => f !== 'isCompanion');
  check('C3 every field step 2a compared is line-level, plot-level, part of the key, or the companion flag',
    unaccounted.length === 0, unaccounted.join(', '));
  check('C4 the fields that collided most on live data are LINE level',
    ['revenue.sell.recognitionProfile.method', 'revenue.operate.startingADR',
      'capexPhasing.phasing', 'opex.defaultIndexation.method', 'revenue.sell.indexation.method']
      .every((f) => (LINE_LEVEL_FIELDS as readonly string[]).includes(f)));
  check('C5 the chain inputs stay on the PLOT, since they describe that plot massing',
    ['landChain.utilisationPct', 'landChain.coveragePct', 'landChain.farRatio',
      'landChain.retailPct', 'landChain.servicePct', 'landChain.maxFloors']
      .every((f) => (PLOT_LEVEL_FIELDS as readonly string[]).includes(f)));

  section('D. One member means nothing merges');
  const solo: LineMemberAsset = {
    id: 'a', strategy: 'Lease', usefulLifeYears: 25,
    revenue: { sell: { recognitionProfile: { method: 'over_time' } }, operate: { startingADR: 268 } },
  };
  const r1 = resolveConsolidatedLine([solo]);
  check('D1 a single-member line takes its member value VERBATIM, marked single',
    r1.singleMember && r1.conflicts.length === 0
    && r1.fields.strategy.value === 'Lease' && r1.fields.strategy.source === 'single'
    && r1.fields['revenue.operate.startingADR'].value === 268);
  check('D2 an ABSENT value stays absent rather than becoming a zero or a default',
    r1.fields['revenue.lease.baseRate'].value === undefined);
  const agree = resolveConsolidatedLine([solo, { ...solo, id: 'b' }]);
  check('D3 two members that agree resolve to that value, marked agreed',
    agree.fields.strategy.source === 'agreed' && agree.conflicts.length === 0);
  const clash = resolveConsolidatedLine([solo, { ...solo, id: 'b', strategy: 'Sell' }]);
  check('D4 two members that DISAGREE report a conflict rather than picking silently',
    clash.conflicts.includes('strategy')
    && clash.fields.strategy.source === 'conflict'
    && (clash.fields.strategy.others ?? []).join(' vs ') === 'Lease vs Sell');
  check('D5 a conflict still yields a usable value, the first member, so nothing crashes',
    clash.fields.strategy.value === 'Lease');
  check('D6 resolveLineField reads a nested path without throwing on a missing branch',
    resolveLineField([{ id: 'a' }], 'revenue.sell.escrow.heldPctOverride').value === undefined);

  section('E. A line pools land from several plots');
  const land = poolLineLand([
    { assetId: 'a', parcelId: 'L1', sqm: 1000, rate: 100, value: 100000 },
    { assetId: 'b', parcelId: 'L2', sqm: 3000, rate: 200, value: 600000 },
  ]);
  check('E1 the pooled land sums area and value across plots',
    land.totalSqm === 4000 && land.totalValue === 700000 && land.plotCount === 2);
  check('E2 the blended rate is VALUE OVER AREA, not an average of rates',
    land.weightedRate === 175, `${land.weightedRate} (an average of rates would be 150)`);
  check('E3 no land means a rate of zero rather than a division by zero',
    poolLineLand([]).weightedRate === 0 && poolLineLand([]).totalSqm === 0);
  check('E4 two draws on the SAME plot count as one plot',
    poolLineLand([
      { assetId: 'a', parcelId: 'L1', sqm: 1, rate: 1, value: 1 },
      { assetId: 'b', parcelId: 'L1', sqm: 1, rate: 1, value: 1 },
    ]).plotCount === 1);
  const areas = poolLineAreas(
    [{ totalGfaSqm: 100, netSaleableSqm: 80 }, { totalGfaSqm: 50 }],
    ['totalGfaSqm', 'netSaleableSqm', 'unused'],
  );
  check('E5 derived areas ADD, which is why they need no rule',
    areas.totalGfaSqm === 150 && areas.netSaleableSqm === 80);
  check('E6 an area NO member could derive is absent, not zero',
    !('unused' in areas));

  section('F. Nothing reads it');
  const engine = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
  ].filter((f) => /from '[^']*consolidatedLine'|from "[^"]*consolidatedLine"/.test(readFileSync(f, 'utf8')));
  check('F1 no calculation or resolver imports the line model', engine.length === 0, engine.join(' | '));
  check('F2 the line model imports NOTHING',
    !/^\s*import\s/m.test(readFileSync('src/core/calculations/consolidatedLine.ts', 'utf8')));

  // ── H. ABSENCE IS NOT DISAGREEMENT. Found on the first live two-plot line,
  // which reported five conflicts that were all "<a value> vs null".
  section('H. A blank plot does not disagree with a filled one');
  const m = (id: string, extra: Record<string, unknown> = {}): LineMemberAsset =>
    ({ id, ...extra } as unknown as LineMemberAsset);
  const stated = resolveLineField<string>([m('a', { subUnitMetric: 'area' }), m('b')], 'subUnitMetric');
  check('H1 one plot states it and the other is silent: AGREED, and the answer is the stated one',
    stated.source === 'agreed' && stated.value === 'area',
    `${stated.source} / ${JSON.stringify(stated.value)}`);
  const reversed = resolveLineField<string>([m('a'), m('b', { subUnitMetric: 'area' })], 'subUnitMetric');
  check('H2 the SILENT plot may come first: the line still shows the stated answer',
    reversed.source === 'agreed' && reversed.value === 'area',
    `${reversed.source} / ${JSON.stringify(reversed.value)}`);
  const nulled = resolveLineField<string>([m('a', { subUnitMetric: 'area' }), m('b', { subUnitMetric: null })], 'subUnitMetric');
  const blanked = resolveLineField<string>([m('a', { subUnitMetric: 'area' }), m('b', { subUnitMetric: '   ' })], 'subUnitMetric');
  check('H3 an explicit null and an all-whitespace string are silence too, not a second answer',
    nulled.source === 'agreed' && blanked.source === 'agreed',
    `${nulled.source} / ${blanked.source}`);
  const real = resolveLineField<string>([m('a', { subUnitMetric: 'area' }), m('b', { subUnitMetric: 'units' })], 'subUnitMetric');
  check('H4 two DIFFERENT stated values are still a conflict, and both are reported',
    real.source === 'conflict' && (real.others ?? []).length === 2
    && (real.others ?? []).includes('area') && (real.others ?? []).includes('units'),
    `${real.source} / ${(real.others ?? []).join(' vs ')}`);
  // A TYPED ZERO AND A TYPED FALSE ARE ANSWERS. This is the standing
  // blank-versus-zero rule, and the whole reason isStated is not a truthiness
  // test: `0` is what a user types to mean zero.
  const zero = resolveLineField<number>([m('a', { usefulLifeYears: 0 }), m('b', { usefulLifeYears: 30 })], 'usefulLifeYears');
  const zeroAlone = resolveLineField<number>([m('a', { usefulLifeYears: 0 }), m('b')], 'usefulLifeYears');
  check('H5 a typed 0 is an ANSWER: it conflicts with 30, and it survives beside a blank',
    zero.source === 'conflict' && zeroAlone.source === 'agreed' && zeroAlone.value === 0,
    `${zero.source} / ${zeroAlone.source} ${JSON.stringify(zeroAlone.value)}`);
  const noneAtAll = resolveLineField<string>([m('a'), m('b')], 'subUnitMetric');
  check('H6 nobody typed it at all: one answer (none), never a conflict',
    noneAtAll.source === 'agreed' && noneAtAll.value === undefined,
    `${noneAtAll.source}`);
  // ONE MEMBER STILL REPORTS `single`, which is the "no number changes"
  // promise: a line with one plot IS its plot.
  const onePlot = resolveLineField<string>([m('a', { subUnitMetric: 'area' })], 'subUnitMetric');
  check('H7 a one-plot line still reports `single`, so nothing was merged, averaged or picked',
    onePlot.source === 'single' && onePlot.value === 'area', onePlot.source);
}

async function liveChecks(): Promise<void> {
  section('G. Live: every line has ONE member, so no number moves');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('G0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let projects = 0, lines = 0, multi = 0, conflicts = 0, verbatim = 0, compared = 0, keySpans = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: LineMemberAsset[]; phases?: { id: string }[] } }[];
    const s = vs[0]?.snapshot;
    if (!s?.assets?.length) continue;
    projects += 1;
    const gs = groupAssetsForConsolidation(s.assets as never, (s.phases ?? []).map((f) => f.id), N);
    console.log(`  ${p.name}: ${s.assets.length} assets -> ${gs.length} lines`);
    for (const g of gs) {
      lines += 1;
      if (g.assets.length > 1) multi += 1;
      // THE TYPE IS RESOLVED, never read raw: a picked registry id and a typed
      // "Branded Villas" are one type, so comparing assetTypeId alone reports a
      // span that is not there.
      const spanned = g.assets;
      if (new Set(spanned.map((a) => consolidationKeyParts(a, N).phaseId)).size > 1
        || new Set(spanned.map((a) => consolidationKeyParts(a, N).typeKey)).size > 1) keySpans += 1;
      const members = g.assets as unknown as LineMemberAsset[];
      const res = resolveConsolidatedLine(members);
      conflicts += res.conflicts.length;
      // THE PROMISE, FIELD BY FIELD: the line's value IS the member's value.
      for (const path of LINE_LEVEL_FIELDS) {
        compared += 1;
        const lineVal = JSON.stringify(res.fields[path].value ?? null);
        const memberVal = JSON.stringify(resolveLineField([members[0]], path).value ?? null);
        if (lineVal === memberVal) verbatim += 1;
      }
      if (g.assets.length > 1) {
        console.log(`      MULTI ${g.key}: ${members.map((m) => m.name ?? m.id).join(' + ')}`);
      }
    }
  }
  // RE-AIMED 2026-09-12: the founder deleted FMP RE HUB, so one live project carries assets.
  check('G1 the projects with assets were reached', projects >= 1, `${projects}`);
  // G2 RE-AIMED 2026-09-09, and the reason is that the founder built the case.
  // It read "EVERY live line has exactly one member, so nothing merges", which
  // was a census of the data on the day it was written, not an invariant. There
  // is now one real two-plot line (branded villas, Sell, phase 1 on the Marina
  // project), which is exactly what the merge exists for. So what is asserted
  // is the property that must hold whether or not anything merges: a line never
  // spans two phases or two types, because those are the key.
  check('G2 no live line spans two phases or two types, however many plots feed it',
    keySpans === 0, `${keySpans} lines span more than one phase or type`);
  console.log(`  ${multi} of ${lines} live lines merge more than one plot`);
  // G3 SURVIVED THE MERGE BECAUSE THE RULE CHANGED UNDER IT. The first live
  // two-plot line reported five conflicts, every one of them "<a value> vs
  // null": the second plot had nothing typed. Absence is not disagreement, so
  // resolveLineField now compares only STATED values and this reads zero again.
  check('G3 no live line reports a conflict', conflicts === 0, `${conflicts}`);
  check('G4 every line-level value equals its member value, verbatim',
    compared > 0 && verbatim === compared, `${verbatim} of ${compared}`);
  console.log(`  ${lines} lines, ${compared} line-level values checked, ${verbatim} identical to their member`);
}

async function main(): Promise<void> {
  console.log('=== verify-consolidated-line ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
