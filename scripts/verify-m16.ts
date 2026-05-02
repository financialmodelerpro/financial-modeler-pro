/**
 * scripts/verify-m16.ts
 *
 * End-to-end verification that Phase M1.6 (REFM Supabase persistence)
 * is correctly deployed to the live Supabase project.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m16.ts
 *
 * To include the optional API smoke section, also run `npm run dev` in
 * a separate terminal so http://localhost:3000 responds. The script
 * skips section 7 cleanly when no dev server is reachable.
 *
 * What this verifies (30 checks at last count):
 *   1. Schema      — refm_projects + refm_project_versions tables
 *                    exist with all columns from migration 149
 *   2. RLS         — anon-key clients are denied SELECT and INSERT
 *   3. Trigger     — refm_projects.updated_at advances on UPDATE
 *   4. Counts      — total rows + distinct user_ids (informational —
 *                    use this to confirm a per-user migration ran)
 *   5. E2E         — full insert/version/pointer/read/uniq/cascade
 *                    cycle via service-role
 *   6. Migrator    — chronological sort, hydration recognition,
 *                    full-upload + read-back, snapshot fidelity
 *                    (projectName preserved through round-trip)
 *   7. API routes  — all 9 routes return 401 without auth as designed
 *
 * Re-run anytime to confirm the persistence layer still works.
 * Particularly useful right after a user opens REFM for the first time
 * post-M1.6 — the row counts in section 4 should jump from 0 to
 * whatever was in the user's pre-M1.6 localStorage blob.
 *
 * Replaces the manual "open browser, click around" eyeball pass with
 * a deterministic script that does the work itself, then prints a
 * pass/fail table.
 *
 * Sections covered:
 *   1. Schema   — refm_projects + refm_project_versions exist with the
 *                 columns migration 149 declares.
 *   2. RLS      — anon-key clients cannot read rows even when a
 *                 service-role write puts data there.
 *   3. Trigger  — refm_projects.updated_at advances on UPDATE.
 *   4. Counts   — total rows and rows-for-test-user (informational).
 *   5. E2E      — full insert / read / update / delete cycle via
 *                 service-role; cascade delete proves FK config.
 *   6. Migrator — runs the actual lib/persistence/migrator data flow
 *                 (chronological version sort + hydrationFromAnySnapshot)
 *                 against direct DB writes that mirror the API routes,
 *                 so it's testable without a running dev server.
 *   7. API      — optional. Hits the routes if a dev server responds
 *                 on http://localhost:3000; reports skip otherwise.
 *
 * Test-user fixture:
 *   - Creates a row in `users` with id 00000000-0000-0000-0000-000000000000
 *     and a synthetic invalid email (m16-verify+<timestamp>@test.invalid).
 *   - All test data lives under that user_id.
 *   - At the end (success OR failure) the script DELETEs the user row;
 *     ON DELETE CASCADE on refm_projects.user_id wipes everything
 *     downstream.
 *
 * Requires .env.local with:
 *   SUPABASE_URL                  (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (used for RLS section)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/verify-m16.ts
 *
 * Exit codes:
 *   0   all sections pass (skipped tests don't count as failures)
 *   1   any section fails
 *   2   environment / connectivity issue before tests start
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hydrationFromAnySnapshot, toLegacySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { DEFAULT_MODULE1_STATE } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

// ── Config ────────────────────────────────────────────────────────────────
const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m16-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.6 Verification Fixture';
const NAME_PREFIX     = 'M16-VERIFY-';   // every project name we create starts with this
const DEV_SERVER_URL  = process.env.M16_DEV_SERVER_URL ?? 'http://localhost:3000';

// ── Result accumulator ────────────────────────────────────────────────────
type Status = 'pass' | 'fail' | 'skip';
interface CheckResult { name: string; status: Status; detail: string }
const results: CheckResult[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  const tag = status === 'pass' ? '✓ PASS' : status === 'fail' ? '✗ FAIL' : '○ SKIP';
  // eslint-disable-next-line no-console
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`);
}

function section(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${'─'.repeat(72)}\n${label}\n${'─'.repeat(72)}`);
}

// ── Env loading ───────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function fatal(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

if (!SUPABASE_URL)  fatal('missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local');
if (!SERVICE_KEY)   fatal('missing SUPABASE_SERVICE_ROLE_KEY in .env.local');
if (!ANON_KEY)      fatal('missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');

const sb:    SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const sbAnon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// ── Sleep helper ──────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── 0. Test-user fixture ──────────────────────────────────────────────────
async function setupTestUser(): Promise<void> {
  // Wipe any left-over fixture from a prior failed run before insert.
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id:                  TEST_USER_ID,
    email:               TEST_USER_EMAIL,
    name:                TEST_USER_NAME,
    password_hash:       'M16_VERIFY_NOT_USABLE',
    role:                'user',
    subscription_plan:   'free',
    subscription_status: 'trial',
    projects_limit:      3,
    email_confirmed:     false,
  });
  if (error) fatal(`could not create test user: ${error.message}`);
}

async function teardownTestUser(): Promise<void> {
  // ON DELETE CASCADE on refm_projects.user_id cleans refm_projects;
  // refm_project_versions cascades from refm_projects.
  const { error } = await sb.from('users').delete().eq('id', TEST_USER_ID);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`WARN: teardown failed (manual cleanup may be needed): ${error.message}`);
  }
}

// ── 1. Schema checks ──────────────────────────────────────────────────────
const PROJECT_COLS  = 'id, user_id, name, location, status, asset_mix, schema_version, current_version_id, created_at, updated_at';
const VERSION_COLS  = 'id, project_id, version_number, schema_version, snapshot, label, created_at';

async function checkSchema(): Promise<void> {
  section('1. Schema verification');

  // refm_projects: select all expected columns. If the table is
  // missing or any column is missing, PostgREST returns an error
  // like "column refm_projects.x does not exist".
  const r1 = await sb.from('refm_projects').select(PROJECT_COLS).limit(1);
  if (r1.error) {
    record('refm_projects table + columns', 'fail', r1.error.message);
  } else {
    record('refm_projects table + columns', 'pass', 'all 10 columns present');
  }

  const r2 = await sb.from('refm_project_versions').select(VERSION_COLS).limit(1);
  if (r2.error) {
    record('refm_project_versions table + columns', 'fail', r2.error.message);
  } else {
    record('refm_project_versions table + columns', 'pass', 'all 7 columns present');
  }

  // Status CHECK constraint: try inserting an invalid status. Expect
  // a 23514 / new row violates check constraint.
  const probeId = await tryInsertProject('invalid-status-probe', { status: 'NotARealStatus' as never });
  if (probeId) {
    // Constraint failed to reject — that's a failure, but still clean up.
    await sb.from('refm_projects').delete().eq('id', probeId);
    record('refm_projects.status CHECK constraint', 'fail',
      'invalid status was accepted (constraint missing or wrong list)');
  } else {
    record('refm_projects.status CHECK constraint', 'pass',
      'invalid status rejected as expected');
  }
}

async function tryInsertProject(name: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  const { data, error } = await sb.from('refm_projects')
    .insert({
      user_id:        TEST_USER_ID,
      name:           NAME_PREFIX + name,
      schema_version: 4,
      ...extra,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

// ── 2. RLS verification ───────────────────────────────────────────────────
async function checkRls(): Promise<void> {
  section('2. RLS verification (anon-key client must see nothing)');

  // Seed a row via service-role.
  const projectId = await tryInsertProject('rls-probe');
  if (!projectId) {
    record('RLS seed via service-role', 'fail', 'service-role insert failed');
    return;
  }

  // Anon client tries to SELECT the same row. RLS policies under
  // NextAuth (auth.uid() is NULL) deny-by-default, so this should
  // return an empty array (or an error). Either is "RLS works."
  const { data: anonData, error: anonError } = await sbAnon
    .from('refm_projects')
    .select('id')
    .eq('id', projectId);

  // Cleanup the probe row.
  await sb.from('refm_projects').delete().eq('id', projectId);

  if (anonError) {
    // PostgREST may return a 401-ish error; that's also "RLS works."
    record('refm_projects RLS denies anon SELECT', 'pass',
      `anon client errored as expected: ${anonError.message}`);
  } else if (!anonData || anonData.length === 0) {
    record('refm_projects RLS denies anon SELECT', 'pass',
      'anon client got 0 rows (deny-by-default working)');
  } else {
    record('refm_projects RLS denies anon SELECT', 'fail',
      `anon client read ${anonData.length} row(s) — RLS NOT enforcing`);
  }

  // Anon-key INSERT should also fail.
  const { error: anonInsertErr } = await sbAnon.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'rls-anon-insert-probe',
    schema_version: 4,
  });
  if (anonInsertErr) {
    record('refm_projects RLS denies anon INSERT', 'pass',
      `anon insert rejected: ${anonInsertErr.message}`);
  } else {
    record('refm_projects RLS denies anon INSERT', 'fail',
      'anon-key client successfully inserted a row — RLS NOT enforcing');
    // Belt-and-braces cleanup if it somehow succeeded.
    await sb.from('refm_projects').delete()
      .eq('user_id', TEST_USER_ID)
      .eq('name', NAME_PREFIX + 'rls-anon-insert-probe');
  }
}

// ── 3. updated_at trigger ─────────────────────────────────────────────────
async function checkTrigger(): Promise<void> {
  section('3. updated_at trigger');

  const projectId = await tryInsertProject('trigger-probe');
  if (!projectId) {
    record('updated_at trigger — seed', 'fail', 'service-role insert failed');
    return;
  }

  const before = await sb.from('refm_projects').select('updated_at').eq('id', projectId).single();
  if (before.error || !before.data) {
    record('updated_at trigger — read before', 'fail', before.error?.message ?? 'no row');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  const t0 = (before.data as { updated_at: string }).updated_at;

  await sleep(50);

  const upd = await sb.from('refm_projects')
    .update({ name: NAME_PREFIX + 'trigger-probe-updated' })
    .eq('id', projectId);
  if (upd.error) {
    record('updated_at trigger — update', 'fail', upd.error.message);
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }

  const after = await sb.from('refm_projects').select('updated_at').eq('id', projectId).single();
  await sb.from('refm_projects').delete().eq('id', projectId);

  if (after.error || !after.data) {
    record('updated_at trigger — read after', 'fail', after.error?.message ?? 'no row');
    return;
  }
  const t1 = (after.data as { updated_at: string }).updated_at;

  if (t1 > t0) {
    record('refm_projects updated_at trigger', 'pass', `${t0} → ${t1}`);
  } else {
    record('refm_projects updated_at trigger', 'fail',
      `updated_at did not advance: before=${t0} after=${t1}`);
  }
}

// ── 4. Row counts (informational) ─────────────────────────────────────────
async function reportCounts(): Promise<void> {
  section('4. Row counts (informational, never fails)');

  const total = await sb.from('refm_projects').select('id', { count: 'exact', head: true });
  const totalCount = total.count ?? 0;
  record('refm_projects — total rows', 'pass', `${totalCount}`);

  const versionTotal = await sb.from('refm_project_versions').select('id', { count: 'exact', head: true });
  const versionCount = versionTotal.count ?? 0;
  record('refm_project_versions — total rows', 'pass', `${versionCount}`);

  // Per-user aggregate. Useful for Ahmad's "did my data upload?" check.
  const { data: byUser } = await sb
    .from('refm_projects')
    .select('user_id', { count: 'exact', head: false });
  const distinctUsers = new Set((byUser ?? []).map(r => (r as { user_id: string }).user_id)).size;
  record('refm_projects — distinct user_ids with data', 'pass', `${distinctUsers}`);
}

// ── 5. E2E persistence ────────────────────────────────────────────────────
async function checkE2E(): Promise<void> {
  section('5. E2E persistence cycle (service-role direct)');

  // INSERT project.
  const projectId = await tryInsertProject('e2e', { location: 'Test City', status: 'Draft' });
  if (!projectId) {
    record('E2E — insert project', 'fail', 'service-role insert failed');
    return;
  }
  record('E2E — insert project', 'pass', `id=${projectId}`);

  // INSERT version 1 with a real HydrateSnapshot.
  const snap = { ...DEFAULT_MODULE1_STATE, projectName: 'E2E Test Project' };
  const v1ins = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       snap,
    label:          'baseline',
  }).select('id').maybeSingle();
  if (v1ins.error || !v1ins.data) {
    record('E2E — insert version', 'fail', v1ins.error?.message ?? 'no data');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  const versionId = (v1ins.data as { id: string }).id;
  record('E2E — insert version', 'pass', `version_id=${versionId}`);

  // UPDATE pointer.
  const ptr = await sb.from('refm_projects')
    .update({ current_version_id: versionId })
    .eq('id', projectId);
  if (ptr.error) {
    record('E2E — pointer update (current_version_id FK)', 'fail', ptr.error.message);
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('E2E — pointer update (current_version_id FK)', 'pass', 'FK accepted');

  // Read back: project + version, verify snapshot round-trips.
  const read = await sb.from('refm_project_versions')
    .select('snapshot, version_number, schema_version, label')
    .eq('id', versionId)
    .single();
  if (read.error || !read.data) {
    record('E2E — read version', 'fail', read.error?.message ?? 'no data');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  const readSnap = (read.data as { snapshot: { projectName?: string } }).snapshot;
  if (readSnap?.projectName === 'E2E Test Project') {
    record('E2E — snapshot round-trip', 'pass', 'projectName field intact');
  } else {
    record('E2E — snapshot round-trip', 'fail',
      `expected projectName="E2E Test Project", got "${readSnap?.projectName}"`);
  }

  // Monotonic version_number unique constraint: try to insert another
  // version 1; expect 23505 unique violation.
  const dup = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       snap,
  });
  if (dup.error) {
    record('E2E — uniq(project_id, version_number)', 'pass',
      `duplicate rejected: ${dup.error.message}`);
  } else {
    record('E2E — uniq(project_id, version_number)', 'fail',
      'duplicate (project_id, version_number) was accepted — index missing');
  }

  // DELETE project — expect cascade to refm_project_versions.
  const del = await sb.from('refm_projects').delete().eq('id', projectId);
  if (del.error) {
    record('E2E — delete project', 'fail', del.error.message);
    return;
  }
  const orphan = await sb.from('refm_project_versions').select('id').eq('id', versionId).maybeSingle();
  if (orphan.data) {
    record('E2E — cascade delete of versions', 'fail',
      'version row still present after parent project DELETE');
    // Best-effort manual cleanup.
    await sb.from('refm_project_versions').delete().eq('id', versionId);
  } else {
    record('E2E — cascade delete of versions', 'pass', 'version row gone after parent DELETE');
  }
}

// ── 6. Migrator data flow (no HTTP) ───────────────────────────────────────
// Re-implements the migrator's data flow against direct DB writes so it
// can run without a dev server. Verifies the same behaviors:
//   - chronological ordering of legacy versions
//   - hydrationFromAnySnapshot tolerance of legacy v2 shape
//   - correct version_number assignment
async function checkMigrator(): Promise<void> {
  section('6. Migrator data flow simulation');

  // Legacy fixture: one project with two versions (oldest first).
  // The version `data` field uses toLegacySnapshot() output so it
  // matches what real pre-M1.6 production storage looks like — the
  // pre-M1.6 RealEstatePlatform.getSnapshot() always wrapped saves
  // through toLegacySnapshot(), producing { version: 2, ... } shape
  // that isLegacyV2() recognizes. A naive `{ ...DEFAULT_MODULE1_STATE }`
  // spread would NOT have a `version` field, would fall through to
  // hydrationFromAnySnapshot's unrecognized-shape branch, and would
  // be silently replaced with defaults — so build the fixture the
  // production way.
  const firstCutSnap = toLegacySnapshot({ ...DEFAULT_MODULE1_STATE, projectName: 'first-cut snapshot' });
  const preIcSnap    = toLegacySnapshot({ ...DEFAULT_MODULE1_STATE, projectName: 'pre-IC snapshot' });
  const legacyProject = {
    name:         NAME_PREFIX + 'migrator-sim',
    location:     'Migrated City',
    status:       'Active',
    assetMix:     ['Residential', 'Hospitality'],
    createdAt:    new Date(Date.now() - 86400000).toISOString(),
    lastModified: new Date().toISOString(),
    versions: {
      vA: { name: 'first-cut', createdAt: new Date(Date.now() - 86400000).toISOString(), data: firstCutSnap },
      vB: { name: 'pre-IC',    createdAt: new Date(Date.now() - 3600000).toISOString(),  data: preIcSnap    },
    },
  };

  // Step 1: chronological sort (mirrors lib/persistence/migrator.ts).
  const sortedVersions = Object.entries(legacyProject.versions)
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
  if (sortedVersions[0][0] !== 'vA' || sortedVersions[1][0] !== 'vB') {
    record('Migrator — chronological sort', 'fail',
      `expected [vA, vB], got [${sortedVersions[0][0]}, ${sortedVersions[1][0]}]`);
    return;
  }
  record('Migrator — chronological sort', 'pass', 'oldest first');

  // Step 2: hydrationFromAnySnapshot must accept the legacy data
  // shape and produce a complete HydrateSnapshot.
  let hydratedFirst;
  try {
    hydratedFirst = hydrationFromAnySnapshot(sortedVersions[0][1].data);
  } catch (e) {
    record('Migrator — hydrationFromAnySnapshot', 'fail',
      e instanceof Error ? e.message : String(e));
    return;
  }
  if (!hydratedFirst || typeof hydratedFirst !== 'object' || !('projectName' in hydratedFirst)) {
    record('Migrator — hydrationFromAnySnapshot', 'fail', 'hydration produced unusable shape');
    return;
  }
  record('Migrator — hydrationFromAnySnapshot', 'pass', 'shape complete');

  // Step 3: insert project + chronological versions, mirror what the
  // server-side createProject + saveVersion would do.
  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           legacyProject.name,
    location:       legacyProject.location,
    status:         legacyProject.status,
    asset_mix:      legacyProject.assetMix,
    schema_version: 4,
  }).select('id').maybeSingle();
  if (projInsert.error || !projInsert.data) {
    record('Migrator — INSERT project', 'fail', projInsert.error?.message ?? 'no data');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;

  let savedVersions = 0;
  let firstVersionId: string | null = null;
  for (let i = 0; i < sortedVersions.length; i++) {
    const [, ver] = sortedVersions[i];
    const snap = hydrationFromAnySnapshot(ver.data);
    const ins = await sb.from('refm_project_versions').insert({
      project_id:     projectId,
      version_number: i + 1,
      schema_version: 4,
      snapshot:       snap,
      label:          ver.name,
    }).select('id').maybeSingle();
    if (ins.error || !ins.data) {
      record(`Migrator — INSERT version ${i + 1}`, 'fail', ins.error?.message ?? 'no data');
      await sb.from('refm_projects').delete().eq('id', projectId);
      return;
    }
    if (i === 0) firstVersionId = (ins.data as { id: string }).id;
    savedVersions += 1;
  }

  // Step 4: bump current_version_id to the LAST version (matches
  // the API route's behavior on save).
  const last = await sb.from('refm_project_versions')
    .select('id')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last.data) {
    record('Migrator — pointer update', 'fail', 'could not find latest version');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  await sb.from('refm_projects').update({
    current_version_id: (last.data as { id: string }).id,
  }).eq('id', projectId);

  record('Migrator — full upload (project + N versions)', 'pass',
    `${savedVersions} versions, first=${firstVersionId?.slice(0, 8)}…`);

  // Step 5: read-back via the same pattern as GET /api/refm/projects/[id].
  const readProj = await sb.from('refm_projects')
    .select('current_version_id, asset_mix, status')
    .eq('id', projectId)
    .single();
  const readVer = await sb.from('refm_project_versions')
    .select('snapshot, label, version_number')
    .eq('id', (readProj.data as { current_version_id: string }).current_version_id)
    .single();
  const readSnap = (readVer.data as { snapshot: { projectName?: string }; label: string; version_number: number });

  if (readSnap.label !== 'pre-IC' || readSnap.version_number !== 2) {
    record('Migrator — read-back current version', 'fail',
      `expected label=pre-IC v2, got label=${readSnap.label} v${readSnap.version_number}`);
  } else {
    record('Migrator — read-back current version', 'pass',
      `label="${readSnap.label}" v${readSnap.version_number}`);
  }

  // Snapshot fidelity: the projectName encoded in the legacy v2
  // payload must survive the toLegacySnapshot → INSERT →
  // hydrationFromAnySnapshot round-trip and land in the read-back
  // snapshot.projectName. If this fails, the migrator is silently
  // substituting defaults — see the silent-data-loss finding in the
  // verification report.
  if (readSnap.snapshot?.projectName === 'pre-IC snapshot') {
    record('Migrator — snapshot fidelity (projectName preserved)', 'pass',
      `projectName="${readSnap.snapshot.projectName}"`);
  } else {
    record('Migrator — snapshot fidelity (projectName preserved)', 'fail',
      `expected projectName="pre-IC snapshot", got "${readSnap.snapshot?.projectName}" — likely silent default-substitution`);
  }

  // Cleanup: parent delete cascades versions.
  await sb.from('refm_projects').delete().eq('id', projectId);
}

// ── 7. API smoke tests (optional) ─────────────────────────────────────────
async function checkApi(): Promise<void> {
  section('7. API route smoke tests (only if dev server is up)');

  let healthy = false;
  try {
    const res = await fetch(`${DEV_SERVER_URL}/api/health`, { method: 'GET' });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  if (!healthy) {
    record('Dev server reachability', 'skip',
      `${DEV_SERVER_URL} not responding to /api/health — start with "npm run dev" to include section 7`);
    return;
  }
  record('Dev server reachability', 'pass', `${DEV_SERVER_URL}/api/health OK`);

  // Without a NextAuth session cookie, every /api/refm route should
  // return 401. We don't have a way to mint a real session here, so
  // just verify the auth gate fires.
  const routes: Array<{ method: string; path: string }> = [
    { method: 'GET',    path: '/api/refm/projects' },
    { method: 'POST',   path: '/api/refm/projects' },
    { method: 'GET',    path: '/api/refm/projects/00000000-0000-0000-0000-000000000000' },
    { method: 'PATCH',  path: '/api/refm/projects/00000000-0000-0000-0000-000000000000' },
    { method: 'DELETE', path: '/api/refm/projects/00000000-0000-0000-0000-000000000000' },
    { method: 'GET',    path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/versions' },
    { method: 'POST',   path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/versions' },
    { method: 'GET',    path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/versions/00000000-0000-0000-0000-000000000000' },
    { method: 'POST',   path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/duplicate' },
  ];

  for (const r of routes) {
    let status = 0;
    let body = '';
    try {
      const res = await fetch(`${DEV_SERVER_URL}${r.path}`, {
        method:  r.method,
        headers: { 'Content-Type': 'application/json' },
        body:    r.method === 'POST' || r.method === 'PATCH' ? JSON.stringify({}) : undefined,
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      record(`${r.method} ${r.path}`, 'fail',
        e instanceof Error ? e.message : String(e));
      continue;
    }
    if (status === 401) {
      record(`${r.method} ${r.path} — 401 without auth`, 'pass', `status=401`);
    } else {
      record(`${r.method} ${r.path} — 401 without auth`, 'fail',
        `expected 401, got ${status}: ${body.slice(0, 80)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.6 verification — target: ${SUPABASE_URL}\n`);

  await setupTestUser();
  try {
    await checkSchema();
    await checkRls();
    await checkTrigger();
    await reportCounts();
    await checkE2E();
    await checkMigrator();
    await checkApi();
  } finally {
    await teardownTestUser();
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const skip = results.filter(r => r.status === 'skip').length;

  // eslint-disable-next-line no-console
  console.log('\n' + '═'.repeat(72));
  // eslint-disable-next-line no-console
  console.log(`Summary: ${pass} pass, ${fail} fail, ${skip} skip`);
  // eslint-disable-next-line no-console
  console.log('═'.repeat(72));

  if (fail > 0) {
    // eslint-disable-next-line no-console
    console.log('\nFAILURES:');
    for (const r of results.filter(rr => rr.status === 'fail')) {
      // eslint-disable-next-line no-console
      console.log(`  ✗ ${r.name}\n    ${r.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('verification crashed:', e);
  process.exit(1);
});
