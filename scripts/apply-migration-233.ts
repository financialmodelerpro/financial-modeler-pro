/**
 * apply-migration-233.ts
 *
 * Applies 233_refm_project_locks.sql, and proves it first.
 *
 * THE PROOF THAT MATTERS IS CONCURRENCY. Everything else here is routine; the
 * claim worth testing is that two waiters racing for one lock cannot both win.
 * That is tested with TWO REAL CONNECTIONS issuing the acquire at the same
 * time, not by reasoning about the SQL, because a race is exactly the thing
 * reasoning gets wrong.
 *
 * Also proved:
 *   - a fresh acquire succeeds, and a second holder is refused;
 *   - the holder can refresh their own lock (and acquired_at does NOT move);
 *   - a STALE lock is stolen by the next acquirer, and acquired_at DOES move;
 *   - stealing clears a pending release request, which was addressed to the
 *     previous holder;
 *   - the cascade: deleting the project removes the lock.
 *
 * Run: npx tsx scripts/apply-migration-233.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-233.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';

interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[]; rowCount: number | null }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const SQL_PATH = 'supabase/migrations/233_refm_project_locks.sql';
const APPLY = process.argv.includes('--apply');
const CONN = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const t = await c.query(`SELECT to_regclass('public.refm_project_locks') AS t`);
  const fn = await c.query(`SELECT proname FROM pg_proc WHERE proname = 'refm_acquire_project_lock'`);
  if (t.rows[0]?.t === null) return { table: null, fn: fn.rows.length > 0, locks: 0 };
  const n = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_locks`);
  const cols = await c.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='refm_project_locks' ORDER BY ordinal_position`);
  return {
    table: 'refm_project_locks',
    columns: cols.rows.map((r) => r.column_name),
    fn: fn.rows.length > 0,
    locks: n.rows[0]?.n ?? 0,
  };
}

/**
 * THE CONCURRENCY PROOF, with two real connections.
 *
 * Runs only AFTER the table exists and is COMMITTED: two connections cannot
 * see each other's uncommitted work, so this cannot live inside the dry run.
 * It commits a probe project and races for its lock, then deletes everything
 * it made.
 */
async function proveConcurrency(c: PgClient): Promise<void> {
  console.log('\n=== CONCURRENCY: two waiters race for one stale lock ===');
  const c2 = new Client(CONN);
  await c2.connect();
  let probeProject: string | null = null;
  let ua2: string | null = null, ub2: string | null = null;
  try {
    const owner = await c.query(`SELECT user_id FROM public.refm_projects LIMIT 1`);
    const p = await c.query(`INSERT INTO public.refm_projects (user_id, name)
      VALUES ($1, 'lock race probe 233') RETURNING id`, [owner.rows[0].user_id]);
    probeProject = p.rows[0].id as string;
    const x = await c.query(`INSERT INTO public.users (email, name)
      VALUES ('probe-233-race-a@example.invalid', 'Race A') RETURNING id`);
    const y = await c.query(`INSERT INTO public.users (email, name)
      VALUES ('probe-233-race-b@example.invalid', 'Race B') RETURNING id`);
    ua2 = x.rows[0].id as string; ub2 = y.rows[0].id as string;

    let bothWon = 0, exactlyOne = 0, noWinner = 0;
    const ROUNDS = 25;
    for (let i = 0; i < ROUNDS; i++) {
      // Start from a STALE lock, so both callers believe it is available.
      await c.query(`INSERT INTO public.refm_project_locks (project_id, holder_user_id, heartbeat_at)
        VALUES ($1, $2, clock_timestamp() - interval '1 hour')
        ON CONFLICT (project_id) DO UPDATE SET heartbeat_at = clock_timestamp() - interval '1 hour'`,
        [probeProject, ua2]);
      // Fire both acquires simultaneously on separate connections.
      const [ra, rb] = await Promise.all([
        c.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [probeProject, ua2]),
        c2.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [probeProject, ub2]),
      ]);
      const winners = (ra.rows.length ? 1 : 0) + (rb.rows.length ? 1 : 0);
      if (winners === 2) bothWon++;
      else if (winners === 1) exactlyOne++;
      else noWinner++;
    }
    console.log(`  ${ROUNDS} races: exactly one winner ${exactlyOne}, BOTH won ${bothWon}, none won ${noWinner}`);
    console.log(`  VERDICT: ${bothWon === 0
      ? 'TWO WAITERS NEVER BOTH WIN. The single-statement acquire holds.'
      : 'RACE LOST: the acquire is not atomic. DO NOT SHIP.'}`);
    if (noWinner > 0) {
      console.log(`  NOTE: ${noWinner} round(s) had NO winner. Safe (nobody edits), and expected:`);
      console.log('        the loser of a race can arrive after the winner has already refreshed.');
    }
  } finally {
    if (probeProject) await c.query(`DELETE FROM public.refm_projects WHERE id = $1`, [probeProject]);
    if (ua2) await c.query(`DELETE FROM public.users WHERE id = $1`, [ua2]);
    if (ub2) await c.query(`DELETE FROM public.users WHERE id = $1`, [ub2]);
    await c2.end();
  }
}

async function main(): Promise<void> {
  const c = new Client(CONN);
  await c.connect();
  const sql = migrationBody();

  console.log('=== BEFORE ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));

  console.log('\n=== DRY RUN (transaction, rolled back) ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    console.log('  first run: OK');
    console.log('  after: ' + JSON.stringify(await snapshot(c)));
    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    const proj = await c.query(`SELECT id FROM public.refm_projects LIMIT 1`);
    const pid = proj.rows[0].id as string;
    const ua = await c.query(`INSERT INTO public.users (email, name)
      VALUES ('probe-233-a@example.invalid', 'Lock A') RETURNING id`);
    const ub = await c.query(`INSERT INTO public.users (email, name)
      VALUES ('probe-233-b@example.invalid', 'Lock B') RETURNING id`);
    const a = ua.rows[0].id as string;
    const b = ub.rows[0].id as string;

    // 1. Fresh acquire, then a second holder refused.
    const r1 = await c.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [pid, a]);
    console.log(`  ACQUIRE: A got the lock = ${r1.rows.length === 1}`);
    const r2 = await c.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [pid, b]);
    console.log(`  CONTEND: B refused while A is live = ${r2.rows.length === 0}`);

    // 2. The holder refreshes; acquired_at must NOT move.
    const before = r1.rows[0].acquired_at;
    const r3 = await c.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [pid, a]);
    console.log(`  HEARTBEAT: A refreshed = ${r3.rows.length === 1}`
      + `, acquired_at unchanged = ${String(r3.rows[0]?.acquired_at) === String(before)}`);

    // 3. A pending request, then a STALE steal that must clear it.
    await c.query(`UPDATE public.refm_project_locks
      SET release_requested_by = $1, release_requested_at = now() WHERE project_id = $2`, [b, pid]);
    await c.query(`UPDATE public.refm_project_locks
      SET heartbeat_at = now() - interval '10 minutes' WHERE project_id = $1`, [pid]);
    const r4 = await c.query(`SELECT * FROM refm_acquire_project_lock($1, $2, 90)`, [pid, b]);
    console.log(`  STALE STEAL: B took the aged-out lock = ${r4.rows.length === 1}`
      + `, holder is B = ${r4.rows[0]?.holder_user_id === b}`
      + `, acquired_at moved = ${String(r4.rows[0]?.acquired_at) !== String(before)}`
      + `, request cleared = ${r4.rows[0]?.release_requested_by === null}`);

    // 4. Cascade.
    await c.query('SAVEPOINT casc');
    const p2 = await c.query(`INSERT INTO public.refm_projects (user_id, name)
      VALUES ($1, 'lock cascade probe') RETURNING id`, [a]);
    await c.query(`SELECT refm_acquire_project_lock($1, $2, 90)`, [p2.rows[0].id, a]);
    await c.query(`DELETE FROM public.refm_projects WHERE id = $1`, [p2.rows[0].id]);
    const left = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_locks WHERE project_id = $1`,
      [p2.rows[0].id]);
    console.log(`  CASCADE: deleting the project removed its lock = ${left.rows[0].n === 0}`);
    await c.query('ROLLBACK TO SAVEPOINT casc');
  } finally {
    await c.query('ROLLBACK');
  }
  console.log('  rolled back');


  // Already applied? Then the race can be proven now, on the live table.
  if ((await snapshot(c)).table !== null) await proveConcurrency(c);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to commit.');
    await c.end();
    return;
  }

  console.log('\n=== APPLYING FOR REAL ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  console.log('committed.');
  console.log('\n=== AFTER ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));

  // Now that the table is committed, prove the race for real.
  await proveConcurrency(c);
  await c.end();
}

main().catch((e: unknown) => { console.error('ERR', (e as { message?: string }).message); process.exit(1); });
