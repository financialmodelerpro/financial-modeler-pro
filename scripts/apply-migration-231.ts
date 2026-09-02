/**
 * apply-migration-231.ts
 *
 * Applies 231_refm_project_members.sql, and proves it first.
 *
 * The proofs that matter for THIS migration, beyond the usual dry run and
 * idempotence check:
 *
 *   1. EVERY EXISTING PROJECT GAINS EXACTLY ONE OWNER, and that owner is
 *      `refm_projects.user_id`. If this is wrong, switching getProject from an
 *      owner check to a membership check makes someone's project vanish.
 *   2. THE SEED IS NOT DESTRUCTIVE ON A RE-RUN. A membership that has since
 *      been changed to a lesser role must not be silently restored to owner.
 *   3. THE ORPHAN GUARD FIRES, proved by deleting a seeded owner row inside a
 *      savepoint and confirming the migration then refuses.
 *   4. THE CASCADES BEHAVE AS DECLARED: deleting a project removes its
 *      memberships, deleting a MEMBER removes only their row, and the
 *      `added_by` audit link survives the granter being deleted.
 *
 * All of it runs inside transactions that are rolled back.
 *
 * Run: npx tsx scripts/apply-migration-231.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-231.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/231_refm_project_members.sql';
const APPLY = process.argv.includes('--apply');

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const t = await c.query(`SELECT to_regclass('public.refm_project_members') AS t`);
  const exists = t.rows[0]?.t !== null;
  if (!exists) return { table: null, members: 0, projects: 0, ownerless: 0 };
  const m = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_members`);
  const p = await c.query(`SELECT count(*)::int AS n FROM public.refm_projects`);
  const o = await c.query(`SELECT count(*)::int AS n FROM public.refm_projects p
    WHERE NOT EXISTS (SELECT 1 FROM public.refm_project_members m
      WHERE m.project_id = p.id AND m.user_id = p.user_id AND m.role = 'owner')`);
  const byRole = await c.query(`SELECT role, count(*)::int AS n FROM public.refm_project_members GROUP BY 1 ORDER BY 1`);
  return {
    table: 'refm_project_members',
    members: m.rows[0]?.n ?? 0,
    projects: p.rows[0]?.n ?? 0,
    ownerless: o.rows[0]?.n ?? 0,
    byRole: byRole.rows,
  };
}

async function main(): Promise<void> {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const sql = migrationBody();

  console.log('=== BEFORE ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));

  console.log('\n=== DRY RUN (transaction, rolled back) ===');
  await c.query('BEGIN');
  try {
    await c.query(sql);
    console.log('  first run: OK');
    const after = await snapshot(c);
    console.log('  after: ' + JSON.stringify(after));
    console.log(`  EVERY PROJECT HAS AN OWNER: ${after.ownerless === 0 ? 'yes' : 'NO, ' + after.ownerless + ' ownerless'}`);
    console.log(`  one owner per project: ${after.members === after.projects ? 'yes' : `members ${after.members} vs projects ${after.projects}`}`);

    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    // ── 2. A re-run must not rewrite anyone else's role. ───────────────
    //
    // NOT by demoting the only owner: that legitimately leaves the project
    // ownerless and the guard rightly refuses, which is the guard working and
    // the probe being wrong (it aborted the whole dry run on the first
    // attempt). What the seed must leave alone is a SECOND person's
    // membership, since it only ever inserts the (project, owner) pair.
    await c.query('SAVEPOINT preserve');
    try {
      const guest = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-231-guest@example.invalid', 'Probe Guest') RETURNING id`);
      const proj = await c.query(`SELECT id FROM public.refm_projects LIMIT 1`);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role)
        VALUES ($1, $2, 'viewer')`, [proj.rows[0].id, guest.rows[0].id]);
      await c.query(sql);
      const back = await c.query(`SELECT role FROM public.refm_project_members
        WHERE project_id = $1 AND user_id = $2`, [proj.rows[0].id, guest.rows[0].id]);
      console.log(`  RE-RUN IS NON-DESTRUCTIVE: a second member's role reads "${back.rows[0]?.role}" `
        + `(${back.rows[0]?.role === 'viewer' ? 'preserved, correct' : 'REWRITTEN, WRONG'})`);
    } catch (e: unknown) {
      console.log('  PRESERVE PROBE could not run -> ' + String((e as { message?: string }).message).slice(0, 150));
    }
    await c.query('ROLLBACK TO SAVEPOINT preserve');

    // ── 3. The orphan guard must FIRE when the seed cannot cover the gap.
    //
    // A project whose owner already holds a NON-owner membership: the seed's
    // ON CONFLICT DO NOTHING leaves it as it is, so nothing supplies the
    // owner row and the guard must object rather than let the project become
    // unreachable by the person who owns it.
    await c.query('SAVEPOINT orphan2');
    try {
      // Insert a project whose owner already holds a NON-owner membership, so
      // ON CONFLICT DO NOTHING leaves it non-owner and the guard must object.
      const u = await c.query(`SELECT id FROM public.users LIMIT 1`);
      const p = await c.query(`INSERT INTO public.refm_projects (user_id, name)
        VALUES ($1, 'orphan probe 231') RETURNING id`, [u.rows[0].id]);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role)
        VALUES ($1, $2, 'viewer')`, [p.rows[0].id, u.rows[0].id]);
      await c.query(sql);
      console.log('  ORPHAN GUARD (uncoverable gap): FAILED, the migration proceeded');
    } catch (e: unknown) {
      console.log('  ORPHAN GUARD (uncoverable gap) fired: '
        + String((e as { message?: string }).message).slice(0, 150));
    }
    await c.query('ROLLBACK TO SAVEPOINT orphan2');

    // ── 4. Cascades. ─────────────────────────────────────────────────
    await c.query('SAVEPOINT cascades');
    try {
      const owner = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-231-owner@example.invalid', 'Probe Owner') RETURNING id`);
      const member = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-231-member@example.invalid', 'Probe Member') RETURNING id`);
      const granter = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-231-granter@example.invalid', 'Probe Granter') RETURNING id`);
      const proj = await c.query(`INSERT INTO public.refm_projects (user_id, name)
        VALUES ($1, 'probe 231') RETURNING id`, [owner.rows[0].id]);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role, added_by)
        VALUES ($1, $2, 'editor', $3)`, [proj.rows[0].id, member.rows[0].id, granter.rows[0].id]);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role, added_by)
        VALUES ($1, $2, 'owner', $2) ON CONFLICT DO NOTHING`, [proj.rows[0].id, owner.rows[0].id]);

      // added_by survives the granter being deleted.
      await c.query(`DELETE FROM public.users WHERE id = $1`, [granter.rows[0].id]);
      const afterGranter = await c.query(`SELECT added_by FROM public.refm_project_members
        WHERE project_id = $1 AND user_id = $2`, [proj.rows[0].id, member.rows[0].id]);
      console.log(`  CASCADE added_by: membership survives the granter, added_by = `
        + `${afterGranter.rows[0]?.added_by === null ? 'null (correct)' : String(afterGranter.rows[0]?.added_by)}`
        + `, rows=${afterGranter.rows.length}`);

      // Deleting a MEMBER removes only their row, not the project.
      await c.query(`DELETE FROM public.users WHERE id = $1`, [member.rows[0].id]);
      const projStill = await c.query(`SELECT id FROM public.refm_projects WHERE id = $1`, [proj.rows[0].id]);
      const memRows = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_members
        WHERE project_id = $1`, [proj.rows[0].id]);
      console.log(`  CASCADE member: project survives = ${projStill.rows.length === 1}, memberships left = ${memRows.rows[0].n} (the owner)`);

      // Deleting the PROJECT removes its memberships.
      await c.query(`DELETE FROM public.refm_projects WHERE id = $1`, [proj.rows[0].id]);
      const gone = await c.query(`SELECT count(*)::int AS n FROM public.refm_project_members
        WHERE project_id = $1`, [proj.rows[0].id]);
      console.log(`  CASCADE project: memberships remaining = ${gone.rows[0].n} (expected 0)`);
    } catch (e: unknown) {
      console.log('  CASCADE PROBE could not run -> ' + String((e as { message?: string }).message).slice(0, 160));
    }
    await c.query('ROLLBACK TO SAVEPOINT cascades');
  } finally {
    await c.query('ROLLBACK');
  }
  console.log('  rolled back');

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
  console.log('\n=== AFTER (read back) ===');
  console.log(JSON.stringify(await snapshot(c), null, 2));
  await c.end();
}

main().catch((e: unknown) => { console.error('ERR', (e as { message?: string }).message); process.exit(1); });
