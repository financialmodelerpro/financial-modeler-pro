/**
 * verify-consolidation-key.ts (2026-09-08, consolidation step 1)
 *
 * THE GROUPING KEY, and the proof that it reaches nothing.
 *
 * What it proves:
 *   A. THE KEY IS (PHASE, TYPE, STRATEGY) and a merge can never cross a phase
 *      or a strategy. The reference workbook keys on TYPE ALONE and then takes
 *      MINIFS(startYear) and XLOOKUP(plan) off the first matching plot, two
 *      silent lossy collapses that never fire there because its data happens to
 *      be uniform. Ours is not: FMP RE HUB carries the same type+strategy in
 *      two phases.
 *   B. AN UNTYPED ASSET GROUPS ALONE, including apart from other untyped
 *      assets, so consolidation can never merge two things a user simply has
 *      not classified yet.
 *   C. NOTHING READS IT. No calculation, resolver, report or export imports the
 *      module, so an asset's numbers are byte-identical with it present.
 *   D. LIVE CENSUS over all six projects: every asset lands in exactly one
 *      group, nothing is dropped, and every merge the key WOULD make is
 *      enumerated by name so a human can read the consequence before anything
 *      consolidates.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-consolidation-key.ts
 *
 * No em dashes in this file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  consolidationKey,
  consolidationKeyParts,
  groupAssetsForConsolidation,
  mergingGroups,
  UNTYPED_KEY_PREFIX,
  UNTYPED_LABEL,
  type ConsolidatableAsset,
} from '../src/core/calculations/consolidation';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const N = normaliseAssetTypeId;
const a = (o: Partial<ConsolidatableAsset> & { id: string }): ConsolidatableAsset =>
  ({ phaseId: 'p1', strategy: 'Sell', ...o });

function offlineChecks(): void {
  // ── A. The key ─────────────────────────────────────────────────────────
  section('A. The key is phase, type and strategy');
  check('A1 two assets of the same type and strategy in the SAME phase share a key',
    consolidationKey(a({ id: 'x', type: 'Strip Retail', strategy: 'Lease' }), N)
    === consolidationKey(a({ id: 'y', type: 'Strip Retail', strategy: 'Lease' }), N));
  check('A2 the SAME type and strategy in a DIFFERENT phase does NOT merge',
    consolidationKey(a({ id: 'x', phaseId: 'p2', type: 'Strip Retail', strategy: 'Lease' }), N)
    !== consolidationKey(a({ id: 'y', phaseId: 'p3', type: 'Strip Retail', strategy: 'Lease' }), N));
  check('A3 the same type on a DIFFERENT strategy does NOT merge',
    consolidationKey(a({ id: 'x', type: 'Strip Retail', strategy: 'Lease' }), N)
    !== consolidationKey(a({ id: 'y', type: 'Strip Retail', strategy: 'Sell' }), N));
  check('A4 free text and the registry id land in the SAME identity',
    consolidationKey(a({ id: 'x', type: 'Branded Villas' }), N)
    === consolidationKey(a({ id: 'y', assetTypeId: 'branded-villas' }), N));
  check('A5 the registry reference WINS over stale free text',
    consolidationKeyParts(a({ id: 'x', assetTypeId: 'branded-villas', type: 'Something Else' }), N).typeKey
    === 'branded-villas');
  check('A6 case and spacing do not split a type',
    consolidationKey(a({ id: 'x', type: '  branded   villas ' }), N)
    === consolidationKey(a({ id: 'y', type: 'Branded Villas' }), N));

  // ── B. Untyped ─────────────────────────────────────────────────────────
  section('B. An untyped asset groups alone');
  const u1 = a({ id: 'u1' });
  const u2 = a({ id: 'u2' });
  check('B1 an asset with no type at all is untyped',
    consolidationKeyParts(u1, N).typed === false
    && consolidationKeyParts(u1, N).typeKey === `${UNTYPED_KEY_PREFIX}u1`);
  check('B2 a blank or whitespace-only type is untyped',
    consolidationKeyParts(a({ id: 'u3', type: '   ' }), N).typed === false);
  check('B3 a type that normalises to nothing is untyped, not a type called ""',
    consolidationKeyParts(a({ id: 'u4', type: '---' }), N).typed === false
    && consolidationKeyParts(a({ id: 'u4', type: '---' }), N).typeKey === `${UNTYPED_KEY_PREFIX}u4`);
  check('B4 TWO untyped assets do NOT merge with each other',
    consolidationKey(u1, N) !== consolidationKey(u2, N));
  check('B5 an untyped group says so, so a surface can explain why it did not consolidate',
    groupAssetsForConsolidation([u1], ['p1'], N)[0].typeLabel === UNTYPED_LABEL
    && groupAssetsForConsolidation([u1], ['p1'], N)[0].typed === false);
  check('B6 an untyped asset does not join a TYPED group either',
    groupAssetsForConsolidation([u1, a({ id: 't1', type: 'Apartments' })], ['p1'], N).length === 2);

  // ── Grouping ───────────────────────────────────────────────────────────
  section('C. Grouping loses nothing and orders stably');
  const many: ConsolidatableAsset[] = [
    a({ id: '1', phaseId: 'p2', type: 'Strip Retail', strategy: 'Lease' }),
    a({ id: '2', phaseId: 'p1', type: 'Apartments', strategy: 'Sell' }),
    a({ id: '3', phaseId: 'p1', type: 'Apartments', strategy: 'Sell' }),
    a({ id: '4', phaseId: 'p1', type: 'Apartments', strategy: 'Sell', visible: false }),
    a({ id: '5', phaseId: 'p2', type: 'Apartments', strategy: 'Operate', isCompanion: true }),
    a({ id: '6', phaseId: 'p1' }),
  ];
  const gs = groupAssetsForConsolidation(many, ['p1', 'p2'], N);
  check('C1 every asset lands in exactly one group and none is dropped',
    gs.reduce((s, g) => s + g.assets.length, 0) === many.length
    && new Set(gs.flatMap((g) => g.assets.map((x) => x.id))).size === many.length);
  check('C2 the three same-phase Apartments/Sell rows are ONE group',
    gs.some((g) => g.assets.length === 3 && g.typeLabel === 'Apartments' && g.strategy === 'Sell'));
  check('C3 phase order leads the sort, then type, then strategy',
    gs.map((g) => g.phaseId).join(',') === 'p1,p1,p2,p2', gs.map((g) => `${g.phaseId}/${g.typeLabel}`).join(' | '));
  check('C4 companions and hidden members are COUNTED, not silently filtered',
    gs.find((g) => g.assets.length === 3)?.hiddenCount === 1
    && gs.find((g) => g.strategy === 'Operate')?.companionCount === 1);
  check('C5 a phase the caller did not list sorts LAST, never first',
    groupAssetsForConsolidation(
      [a({ id: 'z', phaseId: 'ghost', type: 'X' }), a({ id: 'y', phaseId: 'p1', type: 'X' })], ['p1'], N,
    )[0].phaseId === 'p1');
  check('C6 mergingGroups returns only the groups that actually merge',
    mergingGroups(gs).length === 1 && mergingGroups(gs)[0].assets.length === 3);

  // ── C. Nothing reads it ────────────────────────────────────────────────
  section('D. Nothing in the engine, reports or exports imports it');
  const roots = [
    'src/core/calculations',
    'src/hubs/modeling/platforms/refm/lib',
    'src/hubs/modeling/platforms/refm/components',
  ];
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, '/'));
    }
    return out;
  };
  const consumers = roots.flatMap((r) => walk(r))
    .filter((f) => !f.endsWith('calculations/consolidation.ts'))
    .filter((f) => /from '[^']*consolidation'|from "[^"]*consolidation"/.test(readFileSync(f, 'utf8')));
  check('D1 no calculation, resolver, report, export or component imports it',
    consumers.length === 0, consumers.join(' | '));
  const src = readFileSync('src/core/calculations/consolidation.ts', 'utf8');
  check('D2 the module imports NOTHING, so it cannot reach back into the model',
    !/^\s*import\s/m.test(src));
  check('D3 the type normaliser is INJECTED, not copied (one implementation, in the platform)',
    /normaliseTypeId: NormaliseTypeId/.test(src)
    && !/replace\(\/\[\^a-z0-9\]\+\/g/.test(src));
}

async function liveChecks(): Promise<void> {
  section('E. Live census: what the key does to every project');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    check('E0 credentials present', false, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    return;
  }
  const q = async (path: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const projects = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as
    { id: string; name: string }[];
  check('E1 every live project was reached', projects.length >= 6, `${projects.length} projects`);

  let totalAssets = 0, totalGroups = 0, totalMerges = 0, untypedLive = 0, projectsWithAssets = 0;
  // Groups the workbook's own key (type + plan, no phase) WOULD have merged and
  // ours deliberately does not. The count that proves the phase is load-bearing.
  let phaseSeparatedPairs = 0;
  for (const p of projects) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: ConsolidatableAsset[]; phases?: { id: string }[] } }[];
    const snap = vs[0]?.snapshot;
    const assets = snap?.assets ?? [];
    const phaseIds = (snap?.phases ?? []).map((f) => f.id);
    if (assets.length === 0) { console.log(`  ${p.name}: no assets`); continue; }
    projectsWithAssets += 1;
    const groups = groupAssetsForConsolidation(assets, phaseIds, N);
    const merges = mergingGroups(groups);
    const untyped = groups.filter((g) => !g.typed);
    totalAssets += assets.length; totalGroups += groups.length; totalMerges += merges.length;
    untypedLive += untyped.length;

    console.log(`  ${p.name}: ${assets.length} assets -> ${groups.length} groups, ${merges.length} would merge, ${untyped.length} untyped`);
    for (const g of merges) {
      console.log(`      MERGE ${g.typeLabel} / ${g.strategy} in ${g.phaseId}: ${g.assets.map((x) => `"${(x.name ?? x.id).trim()}"`).join(' + ')}`);
    }
    for (const g of untyped) console.log(`      UNTYPED alone: "${(g.assets[0].name ?? g.assets[0].id).trim()}"`);

    // THE WORKBOOK'S KEY, run beside ours on the same rows. It drops the phase,
    // exactly as `Schedules - Cluster N` rows 9 to 20 do, and every extra merge
    // it makes is a phase collapse ours refuses.
    const typeOnly = new Map<string, ConsolidatableAsset[]>();
    for (const asset of assets) {
      const parts = consolidationKeyParts(asset, N);
      const k = `${parts.typeKey} ${parts.strategy}`;
      typeOnly.set(k, [...(typeOnly.get(k) ?? []), asset]);
    }
    const wouldFlatten = [...typeOnly.values()].filter((list) => list.length > 1
      && new Set(list.map((x) => x.phaseId)).size > 1);
    phaseSeparatedPairs += wouldFlatten.length;
    for (const list of wouldFlatten) {
      console.log(`      PHASE SEPARATES: ${list.map((x) => `"${(x.name ?? x.id).trim()}" (${x.phaseId})`).join(' vs ')}`);
    }

    // Per project, the invariants that make the view safe to build on.
    check(`E2 ${p.name}: every asset lands in exactly one group, none dropped`,
      groups.reduce((s, g) => s + g.assets.length, 0) === assets.length
      && new Set(groups.flatMap((g) => g.assets.map((x) => x.id))).size === assets.length);
    check(`E3 ${p.name}: no group spans two phases or two strategies`,
      groups.every((g) => new Set(g.assets.map((x) => x.phaseId)).size === 1
        && new Set(g.assets.map((x) => x.strategy)).size === 1));
    check(`E4 ${p.name}: every untyped group holds exactly one asset`,
      groups.filter((g) => !g.typed).every((g) => g.assets.length === 1));
  }

  check('E5 the census actually covered projects that have assets',
    projectsWithAssets >= 2, `${projectsWithAssets} with assets`);
  console.log(`\n  census: ${totalAssets} assets across ${projectsWithAssets} projects -> ${totalGroups} groups, `
    + `${totalMerges} merging groups, ${untypedLive} untyped groups`);
  // MEASURED, AND IT CORRECTED THE DIAGNOSIS. The consolidation diagnosis
  // reported two merging pairs on FMP RE HUB, keying on type and strategy
  // alone. Both pairs sit in DIFFERENT PHASES, so with the phase in the key
  // nothing on the platform merges at all today: every group is one asset and
  // a consolidated view would be a pure relabelling everywhere.
  //
  // That makes the number a weak thing to assert, so what is asserted is the
  // REASON. The two pairs still exist; the phase is what separates them, and
  // this measures that on the live rows rather than trusting it.
  check('E6 nothing merges today, because the PHASE separates the pairs a type-only key would have flattened',
    totalMerges === 0 && phaseSeparatedPairs === 2,
    `${totalMerges} merging groups, ${phaseSeparatedPairs} pairs separated by phase alone`);
  check('E7 no live asset is untyped today, so the untyped rule is a guard rather than a migration',
    untypedLive === 0, `${untypedLive} untyped`);
}

async function main(): Promise<void> {
  console.log('=== verify-consolidation-key ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
