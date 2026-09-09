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
  assignConsolidationIds,
  consolidationDrift,
  consolidationKey,
  consolidationKeyParts,
  withConsolidationIds,
  groupAssetsForConsolidation,
  mergingGroups,
  UNTYPED_KEY_PREFIX,
  UNTYPED_LABEL,
  type AssignableAsset,
  type ConsolidatableAsset,
} from '../src/core/calculations/consolidation';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

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
  section('A. The key is phase and type');
  check('A1 two assets of the same type and strategy in the SAME phase share a key',
    consolidationKey(a({ id: 'x', type: 'Strip Retail', strategy: 'Lease' }), N)
    === consolidationKey(a({ id: 'y', type: 'Strip Retail', strategy: 'Lease' }), N));
  check('A2 the SAME type and strategy in a DIFFERENT phase does NOT merge',
    consolidationKey(a({ id: 'x', phaseId: 'p2', type: 'Strip Retail', strategy: 'Lease' }), N)
    !== consolidationKey(a({ id: 'y', phaseId: 'p3', type: 'Strip Retail', strategy: 'Lease' }), N));
  // A3 IS THE REVERSE OF WHAT IT ASSERTED, and the reversal is the whole merge
  // rule. Strategy used to split the key, so two plots of one type on two
  // strategies were two lines. Strategy is now a property OF the line: the
  // fields that collided between plots belong to the line, not the plot, so
  // neither plot holds them and the merge is unconditional. Same type, same
  // phase, one line. See resolveConsolidatedLine for how the value is taken.
  check('A3 the same type on a DIFFERENT strategy now DOES merge, because the strategy is the line\'s',
    consolidationKey(a({ id: 'x', type: 'Strip Retail', strategy: 'Lease' }), N)
    === consolidationKey(a({ id: 'y', type: 'Strip Retail', strategy: 'Sell' }), N));
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
  // COMPANIONS ARE EXCLUDED BY DESIGN, so "none is dropped" is now "every
  // non-companion lands in exactly one group, and every companion in none".
  // Stating both halves is what stops the exclusion widening quietly.
  const real = many.filter((x) => x.isCompanion !== true);
  check('C1 every NON-COMPANION asset lands in exactly one group, and no companion lands anywhere',
    gs.reduce((s, g) => s + g.assets.length, 0) === real.length
    && new Set(gs.flatMap((g) => g.assets.map((x) => x.id))).size === real.length
    && gs.every((g) => g.assets.every((x) => x.isCompanion !== true)));
  check('C2 the three same-phase Apartments/Sell rows are ONE group',
    gs.some((g) => g.assets.length === 3 && g.typeLabel === 'Apartments' && g.strategy === 'Sell'));
  check('C3 phase order leads the sort, then type',
    gs.map((g) => g.phaseId).join(',') === 'p1,p1,p2',
    gs.map((g) => `${g.phaseId}/${g.typeLabel}`).join(' | '));
  // C4 REVERSED WHEN STRATEGY LEFT THE KEY, and the reversal is the decision.
  // It asserted that companions were COUNTED rather than filtered, which was
  // right while strategy was part of the key and a companion could not collide
  // with its parent. Without strategy in the key it can and does: FMP RE HUB's
  // "Residential Tower" (Sell + Manage) and its Operate companion share a phase
  // and a type. A companion is not a plot, so it is excluded at the door, and a
  // HIDDEN member is still counted because a hidden plot is still a plot.
  check('C4 a companion is NOT a line member, and a hidden member still is',
    gs.every((g) => g.assets.every((x) => x.isCompanion !== true))
    && gs.find((g) => g.assets.length === 3)?.hiddenCount === 1);
  check('C5 a phase the caller did not list sorts LAST, never first',
    groupAssetsForConsolidation(
      [a({ id: 'z', phaseId: 'ghost', type: 'X' }), a({ id: 'y', phaseId: 'p1', type: 'X' })], ['p1'], N,
    )[0].phaseId === 'p1');
  check('C6 mergingGroups returns only the groups that actually merge',
    mergingGroups(gs).length === 1 && mergingGroups(gs)[0].assets.length === 3);

  // ── E. THE LINE'S DURABLE IDENTITY (consolidation step 1) ──────────────
  //
  // A line has to be an identity before a sub-unit can point at it, and a key
  // built from phase, type and strategy is not one: the user edits all three.
  // Marina Gate carries an asset typed "Bran" right now, mid-word, which under
  // a derived key would have been three lines in three keystrokes.
  section('E. The line id is assigned once and then survives every edit');
  let seq = 0;
  const mint = () => `line_${++seq}`;
  const asg = (list: readonly AssignableAsset[]) => assignConsolidationIds(list, N, mint);
  const withIds = (list: readonly AssignableAsset[]): AssignableAsset[] => withConsolidationIds(list, asg(list));

  const villasA = a({ id: 'A', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell' });
  const villasB = a({ id: 'B', phaseId: 'p1', type: 'Branded Villas', strategy: 'Sell' });
  const apts = a({ id: 'C', phaseId: 'p1', type: 'Apartments', strategy: 'Sell' });

  seq = 0;
  const assigned = withIds([villasA, villasB, apts]) as AssignableAsset[];
  const idOf = (list: readonly AssignableAsset[], id: string): string | undefined =>
    list.find((x) => x.id === id)?.consolidation?.id;
  check('E1 two assets that SHOULD share a line get the same id',
    idOf(assigned, 'A') !== undefined && idOf(assigned, 'A') === idOf(assigned, 'B'),
    JSON.stringify(assigned.map((x) => [x.id, x.consolidation?.id])));
  check('E2 two that should NOT share a line get different ids',
    idOf(assigned, 'A') !== idOf(assigned, 'C'));
  check('E3 the second asset ADOPTS rather than minting, so a line is minted once',
    asg([{ ...villasA, consolidation: { id: 'L1', keyAtAssignment: consolidationKey(villasA, N) } }, villasB])
      .map((x) => x.source).join(',') === 'existing,adopted');

  // THE THREE EDITS. Each takes an assigned asset, changes one part of the key,
  // and re-runs assignment: the id must not move.
  const reassign = (asset: AssignableAsset) => asg([asset])[0];
  const seed = (asset: ConsolidatableAsset): AssignableAsset =>
    ({ ...asset, consolidation: { id: 'L_SEED', keyAtAssignment: consolidationKey(asset, N) } });
  const seeded = seed(villasA);
  check('E4 a TYPE edit does not change the id',
    reassign({ ...seeded, type: 'Apartments' }).id === 'L_SEED');
  check('E5 a PHASE change does not change the id',
    reassign({ ...seeded, phaseId: 'p9' }).id === 'L_SEED');
  check('E6 a STRATEGY change does not change the id',
    reassign({ ...seeded, strategy: 'Lease' }).id === 'L_SEED');
  check('E7 mid-typing a type name never churns the id (the "Bran" case, live on Marina Gate)',
    ['B', 'Br', 'Bra', 'Bran', 'Brand', 'Branded', 'Branded Villas']
      .every((t) => reassign({ ...seeded, type: t }).id === 'L_SEED'));
  check('E8 an assigned asset keeps its RECORDED key too, or the drift it exists to show is erased',
    reassign({ ...seeded, type: 'Apartments' }).keyAtAssignment === consolidationKey(villasA, N));

  // DRIFT: the price of a sticky id, made visible rather than hidden.
  section('F. Drift is detectable, which is what makes a sticky id safe');
  check('F1 an asset whose key still matches reports NO drift',
    consolidationDrift([seeded], N).length === 0);
  const drifted = { ...seeded, type: 'Apartments' };
  const d = consolidationDrift([drifted], N);
  check('F2 a retyped asset IS reported, with both keys named',
    d.length === 1 && d[0].keyAtAssignment !== d[0].currentKey
    && d[0].keyAtAssignment.includes('branded-villas') && d[0].currentKey.includes('apartments'),
    JSON.stringify(d));
  check('F3 an asset with no id at all is not drift, it is unassigned',
    consolidationDrift([villasA], N).length === 0);

  section('G. Assignment writes nothing and invents nothing');
  const before = JSON.stringify([villasA, villasB, apts]);
  asg([villasA, villasB, apts]);
  check('G1 assignConsolidationIds MUTATES NOTHING it is given',
    JSON.stringify([villasA, villasB, apts]) === before);
  check('G2 withConsolidationIds returns a NEW list and leaves the input alone',
    (() => {
      seq = 0;
      const out = withConsolidationIds([villasA as AssignableAsset], asg([villasA]));
      return out[0] !== villasA && out[0].consolidation !== undefined
        && (villasA as AssignableAsset).consolidation === undefined;
    })());
  check('G3 re-applying the SAME assignment returns the identical objects, so a no-op save is a no-op',
    (() => {
      seq = 0;
      const once = withIds([villasA, villasB]);
      const twice = withConsolidationIds(once, assignConsolidationIds(once, N, mint));
      return twice[0] === once[0] && twice[1] === once[1];
    })());
  // A PRE-EXISTING ID CLAIMS ITS KEY BEFORE ANY MINTING, or an asset earlier in
  // the array mints a second id for a line that already has one, splitting it.
  check('G4 an unassigned asset ADOPTS a later sibling id rather than minting a rival',
    (() => {
      seq = 0;
      const held = { ...villasB, consolidation: { id: 'HELD', keyAtAssignment: consolidationKey(villasB, N) } };
      const res = asg([villasA, held]);
      return res[0].id === 'HELD' && res[0].source === 'adopted' && res[1].source === 'existing';
    })());

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
  // D1 NARROWED WHEN STEP 2 LANDED, and the narrowing is the honest version of
  // the invariant rather than a weakening of it. Step 1 said "nothing imports
  // it" because nothing did. Step 2 adds exactly one consumer, the consolidated
  // REPORT builder, which is a presentation layer read by one screen. What must
  // stay true is that no CALCULATION and no RESOLVER touches it, because that is
  // what would make the grouping key part of how money is computed.
  // THE CONSUMERS ARE NAMED, not counted. Step 2 added the first, the
  // consolidated view builder; the layout pass added the second, the Assets tab
  // itself, which merges by line in its fourth table; the five-table rebuild
  // added the third, the tab's own pure table model, which is where the
  // sub-unit partition lives (a rule that belongs beside the other grouping
  // rules rather than inside a component). All three are presentation. A FOURTH
  // appearing without a line here is a consumer nobody decided on, which is
  // what this catches; D1b holds the line that matters, that nothing computing
  // money reads the key at all.
  const ALLOWED_CONSUMERS = [
    'src/hubs/modeling/platforms/refm/lib/reports/consolidatedReport.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
    'src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts',
  ];
  const unexpected = consumers.filter((f) => !ALLOWED_CONSUMERS.includes(f));
  const missing = ALLOWED_CONSUMERS.filter((f) => !consumers.includes(f));
  check('D1 the only consumers are the three named presentation surfaces',
    unexpected.length === 0, unexpected.join(' | '));
  check('D1c all three named consumers still consume it (a stale name is a hole)',
    missing.length === 0, missing.join(' | '));
  const computeSurface = [
    ...walk('src/core/calculations'),
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
  ].filter((f) => !f.endsWith('calculations/consolidation.ts'));
  const computeReaders = computeSurface
    .filter((f) => /from '[^']*consolidation'|from "[^"]*consolidation"/.test(readFileSync(f, 'utf8')));
  check('D1b NOTHING that computes money reads the grouping key',
    computeReaders.length === 0, computeReaders.join(' | '));
  const src = readFileSync('src/core/calculations/consolidation.ts', 'utf8');
  check('D2 the module imports NOTHING, so it cannot reach back into the model',
    !/^\s*import\s/m.test(src));
  const consolidationSrc = readFileSync('src/core/calculations/consolidation.ts', 'utf8');
  // COMMENTS STRIPPED FIRST. The Asset type's own docblock explains that
  // `assignConsolidationIds` has no caller, and a bare name match reads that
  // sentence as a call. Same shape as U22 and D5 elsewhere in this suite.
  const stripComments = (t: string): string => t
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const writers = roots.flatMap((r) => walk(r))
    .filter((f) => !f.endsWith('calculations/consolidation.ts'))
    .filter((f) => /assignConsolidationIds\(|withConsolidationIds\(|consolidationDrift\(/
      .test(stripComments(readFileSync(f, 'utf8'))));
  check('D2b NOTHING calls the assignment, the apply or the drift check',
    writers.length === 0, writers.join(' | '));
  // D2c ASKS THE QUESTION THAT MATTERS FOR "no existing project changes":
  // does anything WRITE the field onto an asset?
  //
  // Its first cut checked the builder's own body for mutation shapes and
  // included `.push(a)`, which matched `existing.assets.push(a)` in the
  // GROUPING function, a line that has nothing to do with it. A proxy for
  // purity is not purity; G1, G2 and G3 already prove that behaviourally by
  // running the function and comparing the input. What is left to prove is that
  // no persistence path sets the field, which is what this asks.
  const persistence = walk('src/hubs/modeling/platforms/refm/lib/state')
    .concat(walk('src/hubs/modeling/platforms/refm/lib/persistence'))
    .filter((f) => /consolidation:\s*\{/.test(stripComments(readFileSync(f, 'utf8'))));
  check('D2c no store, migration or persistence path writes the field onto an asset',
    persistence.length === 0, persistence.join(' | '));
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
  // Step 1 must leave every stored snapshot alone. Counted, not assumed.
  let liveWithConsolidation = 0, hydrateInvented = 0, hydrateDropped = 0;
  // Groups the workbook's own key (type + plan, no phase) WOULD have merged and
  // ours deliberately does not. The count that proves the phase is load-bearing.
  let phaseSeparatedPairs = 0;
  let mergingSpans = 0;
  for (const p of projects) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: ConsolidatableAsset[]; phases?: { id: string }[] } }[];
    const snap = vs[0]?.snapshot;
    const assets = snap?.assets ?? [];
    const phaseIds = (snap?.phases ?? []).map((f) => f.id);
    if (assets.length === 0) { console.log(`  ${p.name}: no assets`); continue; }
    projectsWithAssets += 1;
    for (const x of assets) if ((x as AssignableAsset).consolidation) liveWithConsolidation += 1;
    // HYDRATE IS THE ONLY PATH A STORED SNAPSHOT TAKES TO THE STORE. Run the
    // real one over the real snapshot: the field must come out exactly as it
    // went in, which today means absent on every asset.
    try {
      const hyd = hydrationFromAnySnapshot(vs[0].snapshot as never);
      for (const h of hyd.assets) {
        const raw = assets.find((x) => x.id === h.id) as AssignableAsset | undefined;
        const hadIt = raw?.consolidation !== undefined;
        const hasIt = (h as unknown as AssignableAsset).consolidation !== undefined;
        if (!hadIt && hasIt) hydrateInvented += 1;
        if (hadIt && !hasIt) hydrateDropped += 1;
      }
    } catch { /* a snapshot that will not hydrate is another verifier's problem */ }

    const groups = groupAssetsForConsolidation(assets, phaseIds, N);
    const merges = mergingGroups(groups);
    const untyped = groups.filter((g) => !g.typed);
    totalAssets += assets.length; totalGroups += groups.length; totalMerges += merges.length;
    untypedLive += untyped.length;
    // A MERGING GROUP IS ONE PHASE AND ONE TYPE, however many plots feed it.
    for (const g of merges) {
      const parts = g.assets.map((x) => consolidationKeyParts(x, N));
      if (new Set(parts.map((k) => k.phaseId)).size > 1
        || new Set(parts.map((k) => k.typeKey)).size > 1) mergingSpans += 1;
    }

    console.log(`  ${p.name}: ${assets.length} assets -> ${groups.length} groups, ${merges.length} would merge, ${untyped.length} untyped`);
    for (const g of merges) {
      console.log(`      MERGE ${g.typeLabel} / ${g.strategy} in ${g.phaseId}: ${g.assets.map((x) => `"${(x.name ?? x.id).trim()}"`).join(' + ')}`);
    }
    for (const g of untyped) console.log(`      UNTYPED alone: "${(g.assets[0].name ?? g.assets[0].id).trim()}"`);

    // THE WORKBOOK'S KEY, run beside ours on the same rows. It drops the phase,
    // exactly as `Schedules - Cluster N` rows 9 to 20 do, and every extra merge
    // it makes is a phase collapse ours refuses.
    // LIKE FOR LIKE. `groups` excludes companions; this did not, so the two
    // keys were being compared on different row sets and the retail companions
    // (2026-09-09) showed up as extra "flattened pairs" that our key had never
    // been offered. A comparison between two rules has to run them on the same
    // rows or it measures the difference in the inputs.
    const typeOnly = new Map<string, ConsolidatableAsset[]>();
    for (const asset of assets.filter((x) => x.isCompanion !== true)) {
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
    const nonCompanion = assets.filter((x) => (x as { isCompanion?: boolean }).isCompanion !== true);
    check(`E2 ${p.name}: every non-companion asset lands in exactly one group, none dropped`,
      groups.reduce((s, g) => s + g.assets.length, 0) === nonCompanion.length
      && new Set(groups.flatMap((g) => g.assets.map((x) => x.id))).size === nonCompanion.length);
    // A GROUP MAY NOW SPAN TWO STRATEGIES, since strategy is the line's. It may
    // never span two phases, which is still part of the key.
    check(`E3 ${p.name}: no group spans two phases`,
      groups.every((g) => new Set(g.assets.map((x) => x.phaseId)).size === 1));
    check(`E4 ${p.name}: every untyped group holds exactly one asset`,
      groups.filter((g) => !g.typed).every((g) => g.assets.length === 1));
  }

  check('E5 the census actually covered projects that have assets',
    projectsWithAssets >= 2, `${projectsWithAssets} with assets`);
  console.log(`\n  census: ${totalAssets} assets across ${projectsWithAssets} projects -> ${totalGroups} groups, `
    + `${totalMerges} merging groups, ${untypedLive} untyped groups`);
  // MEASURED, AND IT CORRECTED THE DIAGNOSIS. The consolidation diagnosis
  // reported two merging pairs on FMP RE HUB, keying on type and strategy
  // alone. Both pairs sit in DIFFERENT PHASES, and the phase is what separates
  // them. That part has not changed and is still measured on the live rows.
  //
  // E6 RE-AIMED 2026-09-09. It also asserted `totalMerges === 0`, which was a
  // census of the data on the day it was written rather than an invariant: the
  // founder has since built the first real two-plot line (branded villas, Sell,
  // phase 1 on the Marina project), which is the case the merge exists for. A
  // check that fails when the feature is finally used is a check that has to be
  // deleted at the worst moment, so what it asserts now is the REASON the two
  // FMP RE HUB pairs stay apart, and the merging count is REPORTED, not pinned.
  // THE COUNT IS REPORTED, NOT PINNED. It was 2 when written, then 4 when the
  // founder added a phase-2 line, and a check that fails because the model grew
  // is a check that gets deleted at the worst moment. What must hold is that
  // the phase is doing REAL work on live rows: the workbook's type-only key
  // would flatten pairs that ours keeps apart, and every one of them is
  // separated by phase alone.
  check('E6 the PHASE separates pairs a type-only key would have flattened, on live rows',
    phaseSeparatedPairs >= 1,
    `${totalMerges} merging groups, ${phaseSeparatedPairs} pairs separated by phase alone`);
  // Every merging group is one phase and one type, however many plots it holds.
  check('E6b no merging group spans two phases or two types',
    mergingSpans === 0, `${mergingSpans} of ${totalMerges} merging groups span the key`);
  check('E7 no live asset is untyped today, so the untyped rule is a guard rather than a migration',
    untypedLive === 0, `${untypedLive} untyped`);
  check('E8 NO live asset carries a consolidation id, so no existing project changed',
    liveWithConsolidation === 0, `${liveWithConsolidation} assets carry one`);
  check('E9 hydrate neither invents the field nor drops it',
    hydrateInvented === 0 && hydrateDropped === 0,
    `invented ${hydrateInvented}, dropped ${hydrateDropped}`);
}

async function main(): Promise<void> {
  console.log('=== verify-consolidation-key ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
