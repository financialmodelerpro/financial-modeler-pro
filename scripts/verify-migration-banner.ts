/**
 * verify-migration-banner.ts (2026-09-16)
 *
 * THE SCHEMA BANNER REPORTS A VALUE THE USER STATED BEING REINTERPRETED, NOT A
 * DEFAULT BEING FILLED, AND ONCE READ IT STAYS READ.
 *
 * "Project updated to latest schema, please verify your inputs" showed on every
 * open of every saved project. Two things were true at once, and both were
 * measured before anything was changed (2026-09-16):
 *
 *   1. The banner was set by the ROUTE. Every saved project takes the legacy
 *      branch (a save writes no version marker, and the v7 fingerprint matches
 *      exact base line ids while saved ids carry a phase suffix), so the notice
 *      fired whether or not the load did anything.
 *   2. It was ALSO telling the truth. Every one of the nine stored versions
 *      genuinely migrates on load, moving between 61 and 145 paths, because the
 *      migrated result is never written back: the load migrates, says so,
 *      discards it, and the next open repeats it. `migrationsApplied` is the
 *      ledger meant to settle this and only one pass ever writes to it.
 *
 * So a plain no-op test finds nothing, and the rule is what KIND of thing moved.
 * A field the snapshot never carried is a default being supplied. A value the
 * user stated (`CostLine.rateStated`, `SubUnit.priceStated`, a non-standard cost
 * override) being reinterpreted is worth reading about. And the answer is
 * remembered against the version it was read on, so a real notice is seen once.
 *
 *  A  the rule is wired at the load, is the shared diff rule, and the dismissal
 *     is remembered rather than only cleared in React state
 *  B  offline: a stated value moves and it speaks, a derived fill is silent
 *  C  live: the narrowing bites on real data, and what a load settles stays
 *     settled (loading the migrated result again says nothing)
 *  D  live: the route and the numbers are untouched, the model still computes
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-migration-banner.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hydrationFromAnySnapshotChecked, snapshotMovedSomething, LEGACY_MIGRATION_NOTICE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { createModule1Store, pickModel, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { DEFAULT_PHASE_ID, type Asset } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { seedCostStandardRows } from '../src/hubs/modeling/platforms/refm/lib/state/costStandards';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const quiet = <T>(fn: () => T): T => {
  const w = console.warn, l = console.log;
  console.warn = () => {}; console.log = () => {};
  try { return fn(); } finally { console.warn = w; console.log = l; }
};
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((t, x) => t + (x ?? 0), 0);
const src = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * What `attachToProject` does, from the same two exported pieces: hydrate the
 * store, then ask the ONE rule whether the stored snapshot and the loaded model
 * differ in anything the user stated. Section A pins that the app composes them
 * the same way, so this cannot drift into a second opinion.
 */
function loadOf(raw: unknown): { notice: string | undefined; model: HydrateSnapshot; extract: HydrateSnapshot } {
  return quiet(() => {
    const checked = hydrationFromAnySnapshotChecked(raw);
    const st = createModule1Store();
    st.getState().hydrate(checked.snapshot);
    const state = st.getState() as unknown as Record<string, unknown>;
    const moved = snapshotMovedSomething(raw, pickModel(state));
    return {
      notice: moved ? (checked.migrationNotice ?? LEGACY_MIGRATION_NOTICE) : undefined,
      model: pickModel(state),
      extract: st.getState().extractPersistSnapshot() as HydrateSnapshot,
    };
  });
}

async function main(): Promise<void> {
  console.log('A. The rule is wired at the load, and the dismissal is remembered');
  const SYNC = src('src/hubs/modeling/platforms/refm/lib/persistence/module1-sync.ts');
  const from = SYNC.indexOf("loaded = 'server';");
  const to = SYNC.indexOf('// Server miss');
  const serverBranch = from >= 0 && to > from ? SYNC.slice(from, to) : '';
  check('A1 the server load decides the notice by what the load changed', /migrationNotice = loadChangedTheModel\(/.test(serverBranch), 'not wired');
  check('A2 and never by the route alone', serverBranch.length > 0 && !/migrationNotice = checked\.migrationNotice;/.test(serverBranch), 'the branch assigns the route notice straight through');
  check('A3 the decision is the shared diff rule, over the stored snapshot and the loaded model',
    /function loadChangedTheModel\([\s\S]{0,400}?snapshotMovedSomething\(stored, pickModel\(/.test(SYNC), 'a second opinion');
  const CACHE = src('src/hubs/modeling/platforms/refm/lib/persistence/cache.ts');
  const UI = src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  check('A4 the dismissal is stored against the version it was read on',
    /isSchemaNoticeDismissed/.test(CACHE) && /dismissSchemaNotice/.test(CACHE) && /KEY_SCHEMA_NOTICE_PREFIX \+ projectId, versionId\)/.test(CACHE), 'not keyed by version');
  check('A5 the banner is not shown again once dismissed', /res\.migrationNotice && !isSchemaNoticeDismissed\(/.test(UI), 'the notice is set without asking');
  check('A6 and dismissing it records that, not only React state', /dismissSchemaNotice\(migrationNotice\.projectId, migrationNotice\.versionId\)/.test(UI), 'dismiss only clears state');

  console.log('\nB. A stated value speaks, a derived fill is silent');
  const st0 = createModule1Store();
  quiet(() => {
    st0.getState().setProject({ assetTypes: [{ id: 'branded-villas', label: 'Branded Villas' }] } as never);
    st0.getState().addAsset({
      id: 'v1', phaseId: DEFAULT_PHASE_ID, type: 'Branded Villas', assetTypeId: 'branded-villas',
      strategy: 'Sell', visible: true, buaSqm: 10000, sellableBuaSqm: 10000,
    } as unknown as Asset);
    st0.getState().setCostStandardRows(seedCostStandardRows([{ id: 'branded-villas', label: 'Branded Villas' }] as never, undefined));
  });
  const built = quiet(() => st0.getState().extractPersistSnapshot()) as HydrateSnapshot;
  /**
   * A STORE BUILT FIELD BY FIELD IS NOT WHAT A SAVED PROJECT IS. Measured: it has
   * never been through a load, so it still carries a default the migration
   * rewrites, the seeded tranche repaying `straight_line` where the migration
   * says `equal_repayment`. That is one stated value reinterpreted out of 31
   * moves, so it SHOULD speak, and the six old-shape live versions carry that
   * very change. A snapshot that HAS been through a load is the real comparison,
   * and it has nothing left to say.
   */
  check('B1 a snapshot that never went through a load states a change, and says so', !!loadOf(built).notice, 'silent');
  const stored = loadOf(built).extract;
  check('B2 a snapshot that has been through a load reloads with no banner', !loadOf(stored).notice, String(loadOf(stored).notice));

  // A value the user STATED, reinterpreted: land allocation is pinned to sqm on
  // every load path, so a stored 'autoByBua' is a real reinterpretation.
  const stated = JSON.parse(JSON.stringify(stored));
  stated.landAllocationMode = 'autoByBua';
  check('B3 a stated value the load reinterprets carries a banner', !!loadOf(stated).notice, 'silent');

  // The same shape of change, on a value the user never stated: the standards
  // settle supplies a rate to a line whose rateStated is false. Not a banner.
  const derived = JSON.parse(JSON.stringify(stored));
  let touched = 0;
  for (const l of derived.costLines ?? []) {
    if (l.rateStated !== true && typeof l.value === 'number' && l.value !== 0) { l.value = 0; touched++; }
  }
  check('B4 the derived fixture really does move a value', touched > 0, String(touched));
  check('B5 a value the user never stated is filled in silently', !loadOf(derived).notice, String(loadOf(derived).notice));

  // Absent fields are defaults being supplied, whatever their number.
  const absent = JSON.parse(JSON.stringify(stored));
  delete absent.project.financing;
  delete absent.costOverrides;
  check('B6 absent fields being filled in is silent', !loadOf(absent).notice, String(loadOf(absent).notice));
  check('B7 and the model still comes back whole', (loadOf(absent).model.assets ?? []).length === (stored.assets ?? []).length);
  check('B8 nothing usable still says so', !!loadOf({}).notice && !!loadOf(null).notice);

  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('C and D need credentials (run with --env-file=.env.local)', false); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  const projects = await get('refm_projects?select=id,name&deleted_at=is.null&order=name');

  console.log('\nC and D. Every stored version of every live project');
  let versions = 0; let silent = 0; let settles = 0; let computed = 0;
  const speaks: string[] = []; const unsettled: string[] = []; const broken: string[] = [];
  for (const p of projects) {
    const rows = await get(`refm_project_versions?project_id=eq.${p.id}&select=id,version_label,snapshot&order=created_at.asc`);
    for (const v of rows) {
      if (!v.snapshot) continue;
      versions++;
      const where = `${p.name} / ${v.version_label ?? String(v.id).slice(0, 8)}`;
      const res = loadOf(v.snapshot);
      if (res.notice) speaks.push(where); else silent++;
      // WHAT A LOAD SETTLES STAYS SETTLED. Load what the load produced: there is
      // nothing left to say about it. This is the check that would have caught a
      // banner that can never be cleared.
      if (loadOf(res.extract).notice) unsettled.push(where); else settles++;
      // D. The route and the numbers are untouched: the model still computes.
      if ((res.model.assets ?? []).length > 0) {
        const snap: any = quiet(() => computeFinancialsSnapshot(res.model as never));
        if (Number.isFinite(sum(snap?.pl?.totalRevenuePerPeriod))) computed++;
        else broken.push(where);
      } else computed++;
    }
  }
  console.log(`   ${silent} of ${versions} silent; still speaking: ${speaks.join(' | ') || 'none'}`);
  check('C1 the narrowing bites on real data: a stored version loads silently', versions > 0 && silent > 0, 'every version still speaks');
  check(`C2 what a load settles stays settled (${settles} of ${versions})`, versions > 0 && settles === versions, unsettled.slice(0, 4).join(' | '));
  check(`D1 the model still computes on every version (${computed} of ${versions})`, versions > 0 && computed === versions, broken.slice(0, 4).join(' | '));
}

main().then(() => { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
