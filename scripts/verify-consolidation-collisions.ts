/**
 * verify-consolidation-collisions.ts (2026-09-08, consolidation step 2a)
 *
 * WHERE THE MEMBERS OF A CONSOLIDATED LINE DISAGREE, and the proof that the
 * detector can actually see it.
 *
 * THE CENTREPIECE IS REACHABILITY (section A). A collision detector that reads
 * a path nothing writes reports "no disagreement" forever, which is the
 * quietest possible way for this whole step to be useless: it would pass every
 * check, print an empty report, and be believed. Five of the first twenty-two
 * paths were wrong on the first run, written from memory rather than from the
 * type: `revenue.sell.recognitionMethod` (the block holds a
 * recognitionProfile), `capexPhasing.mode` (the field is `phasing`),
 * `managementAgreement.feePctOfRevenue` (it is `managementFeePct`), and the
 * probe that found them was itself wrong about the five `landChain.*` paths
 * because it searched only one of the two files the type lives in.
 *
 * So every compared path is proven against BOTH type sources and against the
 * live rows, and a path that is set on no live asset is reported rather than
 * hidden.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-consolidation-collisions.ts
 *
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import {
  COMPARED_FIELDS,
  collisionsForGroup,
  collisionsForGroups,
  readPath,
  showValue,
  type CollidableAsset,
} from '../src/core/calculations/consolidationCollisions';
import { groupAssetsForConsolidation } from '../src/core/calculations/consolidation';
import { resolveConsolidatedLine } from '../src/core/calculations/consolidatedLine';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const TYPE_SOURCES = [
  'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
  'src/core/calculations/landChain.ts',
];

function offlineChecks(): { liveNote: string[] } {
  section('A. Every compared path is a real field');
  const types = TYPE_SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n');
  const missing = COMPARED_FIELDS.filter((s) => {
    const leaf = s.field.split('.').slice(-1)[0];
    return !new RegExp(`\\b${leaf}\\??:`).test(types);
  });
  check('A1 every compared path names a field that exists in the type',
    missing.length === 0, missing.map((m) => m.field).join(', '));
  check('A2 the probe reads BOTH type sources (one of them alone flagged five real paths as missing)',
    TYPE_SOURCES.length === 2 && types.includes('utilisationPct') && types.includes('subUnitMetric'));
  check('A3 the field list is DATA, so adding one is a line and this check enumerates it',
    Array.isArray(COMPARED_FIELDS) && COMPARED_FIELDS.length >= 20);
  check('A4 every entry carries a severity and a reason',
    COMPARED_FIELDS.every((s) => ['blocking', 'review', 'summable'].includes(s.severity) && s.why.trim().length > 30));
  check('A5 no path is listed twice',
    new Set(COMPARED_FIELDS.map((s) => s.field)).size === COMPARED_FIELDS.length);
  // The three key parts must be blocking: if members disagree there, the
  // GROUPING is wrong, not the data, and that has to be loud.
  check('A6 the three key parts are blocking',
    ['strategy', 'phaseId'].every((f) =>
      COMPARED_FIELDS.find((s) => s.field === f)?.severity === 'blocking')
    && COMPARED_FIELDS.find((s) => s.field === 'subUnitMetric')?.severity === 'blocking');

  section('B. The detector sees what it is pointed at');
  const mk = (id: string, over: Record<string, unknown> = {}): CollidableAsset =>
    ({ id, phaseId: 'p1', strategy: 'Sell', subUnitMetric: 'units', ...over });
  check('B1 a group of ONE never collides, however odd its values',
    collisionsForGroup('k', [mk('a', { usefulLifeYears: 25 })]).fields.length === 0);
  check('B2 two members that agree do not collide',
    collisionsForGroup('k', [mk('a'), mk('b')]).fields.length === 0);
  const metric = collisionsForGroup('k', [mk('a'), mk('b', { subUnitMetric: 'area' })]);
  check('B3 a sub-unit metric disagreement is BLOCKING and names both values',
    metric.blocking === 1 && metric.fields[0].field === 'subUnitMetric'
    && metric.fields[0].values.map((v) => v.value).join(' vs ') === 'units vs area');
  // ABSENT VERSUS SET IS A DISAGREEMENT, and it is the commonest shape: on the
  // live rows, capexPhasing is unset on two Strip Retail assets and 'manual' on
  // the third. Treating "not set" as agreeing with everything would hide it.
  const absent = collisionsForGroup('k', [mk('a', { usefulLifeYears: 25 }), mk('b')]);
  check('B4 ABSENT versus SET is a disagreement, not a wildcard',
    absent.review === 1 && absent.fields[0].values.map((v) => v.value).join(' vs ') === '25 vs (not set)');
  check('B5 a nested path is read without throwing on a missing branch',
    readPath({ revenue: { sell: { indexation: { method: 'none' } } } }, 'revenue.sell.indexation.method') === 'none'
    && readPath({}, 'revenue.sell.indexation.method') === undefined
    && readPath(null, 'a.b') === undefined);
  check('B6 values render short and stable',
    showValue(undefined) === '(not set)' && showValue('') === '(blank)'
    && showValue(0) === '0' && showValue(false) === 'no' && showValue(null) === '(null)');
  check('B7 a THREE member group reports one value per member, in order',
    collisionsForGroup('k', [mk('a'), mk('b', { usefulLifeYears: 1 }), mk('c', { usefulLifeYears: 2 })])
      .fields[0].values.map((v) => v.assetId).join(',') === 'a,b,c');
  check('B8 groups of one are still RETURNED, so a caller can show they were checked',
    collisionsForGroups([{ key: 'k', assets: [mk('a')] }]).length === 1);
  check('B9 the detector decides nothing: it has no merge, resolve or pick',
    (() => {
      const src = readFileSync('src/core/calculations/consolidationCollisions.ts', 'utf8');
      return !/function\s+(merge|resolve|pick|apply)/i.test(src);
    })());

  section('C. Nothing reads it');
  const readers = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
  ].filter((f) => readFileSync(f, 'utf8').includes('consolidationCollisions'));
  check('C1 no calculation or resolver imports the detector', readers.length === 0, readers.join(' | '));
  check('C2 the detector imports NOTHING',
    !/^\s*import\s/m.test(readFileSync('src/core/calculations/consolidationCollisions.ts', 'utf8')));
  return { liveNote: [] };
}

async function liveChecks(): Promise<void> {
  section('D. Live: what the detector finds, and what it would find on a merge');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('D0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  const all: CollidableAsset[] = [];
  let multiMemberGroups = 0, groups = 0, liveCollisions = 0, rawDifferences = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: CollidableAsset[]; phases?: { id: string }[] } }[];
    const s = vs[0]?.snapshot;
    if (!s?.assets?.length) continue;
    all.push(...s.assets);
    for (const g of groupAssetsForConsolidation(s.assets as never, (s.phases ?? []).map((f) => f.id), normaliseAssetTypeId)) {
      groups += 1;
      if (g.assets.length > 1) multiMemberGroups += 1;
      // WHAT A REAL MERGE ACTUALLY COLLIDES ON. Zero is the claim, and it is
      // the point of the merge rules: the fields that used to collide between
      // two plots belong to the LINE, so neither plot holds them any more.
      if (g.assets.length > 1) {
        // TWO TOOLS, TWO JOBS, AND THE DIFFERENCE IS THE POINT.
        //
        // The DETECTOR reports absent-versus-set (B4), deliberately: it is the
        // pre-merge diagnostic whose whole value was showing a human what two
        // plots differ on, and hiding a blank there would have hidden the
        // commonest shape. The LINE RESOLVER answers a different question,
        // what the merged row SHOWS, and there a blank plot does not contest a
        // filled one. So the raw count is reported and what is ASSERTED is the
        // one that would be a defect: a line-level field with two STATED
        // answers, which no live merge may have.
        rawDifferences += collisionsForGroup(g.key, g.assets as never).fields.length;
        liveCollisions += resolveConsolidatedLine(g.assets as never).conflicts.length;
      }
    }
  }
  check('D1 the live rows were reached', all.length >= 13, `${all.length} assets, ${groups} groups`);

  // EVERY PATH PROVEN AGAINST REAL ROWS, not just against the type. A path
  // spelled correctly but written by nothing is still a blind spot, so the ones
  // no live asset sets are named rather than passed over.
  const unset = COMPARED_FIELDS.filter((s) => all.every((a) => readPath(a, s.field) === undefined));
  console.log(`  paths set on at least one live asset: ${COMPARED_FIELDS.length - unset.length} of ${COMPARED_FIELDS.length}`);
  for (const u of unset) console.log(`      never set live: ${u.field}`);
  // A NAMED SET, NOT A COUNT. The first cut allowed "three or fewer unset",
  // which is a threshold that says nothing: a fourth path spelled wrong would
  // have slipped in under a fifth being fixed. These four are proven to exist
  // in the type (A1) and simply are not used on any live project yet, so the
  // detector reads them correctly and finds nothing to report. A path that
  // joins this list without a line here is a path nobody checked.
  const EXPECTED_UNSET: Record<string, string> = {
    depreciationMethod: 'Every live asset uses the default straight line; the field exists and nothing has overridden it.',
    // landChain.retailPct and landChain.servicePct LEFT THIS LIST on 2026-09-09,
    // which is D2b doing its job: the founder has since typed a ground-floor
    // retail share and a service deduction on the Marina plots, so both paths
    // are now exercised by real data and no longer need excusing. An entry that
    // stays here after its field comes into use is a blind spot pretending to
    // be a decision.
    'revenue.sell.escrow.heldPctOverride': 'No live project overrides escrow at the asset level.',
  };
  const unexpected = unset.filter((u) => !(u.field in EXPECTED_UNSET));
  const goneStale = Object.keys(EXPECTED_UNSET).filter((f) => !unset.some((u) => u.field === f));
  check('D2 every compared path is either exercised by live data or named as not yet used',
    unexpected.length === 0,
    unexpected.map((u) => u.field).join(', '));
  check('D2b the not-yet-used list has not gone stale (a path now in use must leave it)',
    goneStale.length === 0, goneStale.join(', '));

  // D3 RE-AIMED 2026-09-09. It read "no live group has more than one member, so
  // no merge rule fires today", which was true when the detector was written
  // and is a census, not an invariant. The founder has since built the first
  // real two-plot line, which is the case the merge exists for, so what is
  // asserted now is the property that matters: whatever merges live, it
  // reports no COLLISION, because the fields that used to collide belong to the
  // line rather than the plot. A count is reported, never pinned.
  check('D3 no live merge has a LINE-LEVEL field with two stated answers',
    liveCollisions === 0,
    `${multiMemberGroups} multi-member groups, ${rawDifferences} raw differences, ${liveCollisions} line-level conflicts`);

  // THE PROXY. With no multi-member group live, the only real disagreements
  // available are between assets that share a type and strategy but sit in
  // different phases. Forcing them together is not a proposal, it is how the
  // fixtures get built from real data instead of from imagination.
  console.log('\n  If the same-type assets were forced into one line (phase ignored):');
  const byTypeStrategy = new Map<string, CollidableAsset[]>();
  for (const a of all) {
    const k = `${normaliseAssetTypeId(String(a.type ?? '').trim() || 'x')}|${String(a.strategy)}`;
    byTypeStrategy.set(k, [...(byTypeStrategy.get(k) ?? []), a]);
  }
  let realBlocking = 0, realReview = 0, pairs = 0;
  for (const [k, list] of byTypeStrategy) {
    if (list.length < 2) continue;
    pairs += 1;
    const c = collisionsForGroup(k, list);
    // phaseId is blocking BY CONSTRUCTION here, since the proxy dropped the
    // phase to force the merge. It is discounted rather than counted.
    const real = c.fields.filter((f) => f.field !== 'phaseId');
    realBlocking += real.filter((f) => f.severity === 'blocking').length;
    realReview += real.filter((f) => f.severity === 'review').length;
    console.log(`    ${k} (${list.length}): ${list.map((a) => String(a.name).trim()).join(', ')}`);
    for (const f of real) console.log(`        ${f.severity.toUpperCase()} ${f.field}: ${f.values.map((v) => v.value).join(' vs ')}`);
    if (real.length === 0) console.log('        no disagreement outside the phase');
  }
  check('D4 the proxy found real same-type pairs to learn from', pairs >= 3, `${pairs} pairs`);
  check('D5 and real disagreements inside them, which is what the fixtures must reproduce',
    realBlocking + realReview >= 4, `${realBlocking} blocking, ${realReview} review`);
}

async function main(): Promise<void> {
  console.log('=== verify-consolidation-collisions ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
