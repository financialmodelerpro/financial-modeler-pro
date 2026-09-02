/**
 * apply-migration-232.ts
 *
 * Applies 232_refm_member_ordering.sql, and proves it first.
 *
 * The proofs specific to this one:
 *   1. Nothing to migrate, re-checked at apply time, not just before it.
 *   2. THE GUARD FIRES when someone HAS ordered or flagged a project, so the
 *      migration refuses rather than stranding their arrangement.
 *   3. The old columns SURVIVE and carry their deprecation comment.
 *   4. `refm_projects.status` is UNTOUCHED: it stays one value per project.
 *   5. Two members of one project can hold DIFFERENT orders, which is the
 *      whole point of the move.
 *
 * Run: npx tsx scripts/apply-migration-232.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-232.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/232_refm_member_ordering.sql';
const APPLY = process.argv.includes('--apply');

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

async function snapshot(c: PgClient): Promise<Record<string, unknown>> {
  const mem = await c.query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name='refm_project_members'
      AND column_name IN ('priority','sort_order') ORDER BY column_name`);
  const proj = await c.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='refm_projects'
      AND column_name IN ('priority','sort_order','status') ORDER BY column_name`);
  const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename='refm_project_members' AND indexname='idx_refm_members_card_order'`);
  const dep = await c.query(`SELECT column_name,
      col_description('public.refm_projects'::regclass, ordinal_position) AS c
    FROM information_schema.columns WHERE table_schema='public' AND table_name='refm_projects'
      AND column_name IN ('priority','sort_order','status') ORDER BY column_name`);
  return {
    memberColumns: mem.rows,
    projectColumnsStillPresent: proj.rows.map((r) => r.column_name),
    memberIndex: idx.rows[0]?.indexname ?? null,
    comments: dep.rows.map((r) => ({
      column: r.column_name,
      deprecated: /DEPRECATED/i.test(String(r.c ?? '')),
      hasComment: !!r.c,
    })),
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
    console.log('  member columns: ' + JSON.stringify(after.memberColumns));
    console.log('  member index  : ' + after.memberIndex);
    console.log('  project columns still present: ' + JSON.stringify(after.projectColumnsStillPresent));
    console.log('  comments: ' + JSON.stringify(after.comments));

    await c.query(sql);
    console.log('  second run: OK (idempotent)');

    // ── 4. status is untouched. ──────────────────────────────────────
    const st = await c.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid='public.refm_projects'::regclass AND conname='refm_projects_status_check'`);
    console.log('  STATUS UNCHANGED: ' + String(st.rows[0]?.def ?? 'ABSENT').slice(0, 90));

    // ── 5. Two members, two different orders. ────────────────────────
    await c.query('SAVEPOINT perUser');
    try {
      const a = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-232-a@example.invalid', 'Probe A') RETURNING id`);
      const b = await c.query(`INSERT INTO public.users (email, name)
        VALUES ('probe-232-b@example.invalid', 'Probe B') RETURNING id`);
      const p = await c.query(`INSERT INTO public.refm_projects (user_id, name)
        VALUES ($1, 'probe 232') RETURNING id`, [a.rows[0].id]);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role, priority, sort_order)
        VALUES ($1, $2, 'owner', true, 0)`, [p.rows[0].id, a.rows[0].id]);
      await c.query(`INSERT INTO public.refm_project_members (project_id, user_id, role, priority, sort_order)
        VALUES ($1, $2, 'viewer', false, 7)`, [p.rows[0].id, b.rows[0].id]);
      const both = await c.query(`SELECT user_id, priority, sort_order FROM public.refm_project_members
        WHERE project_id = $1 ORDER BY sort_order`, [p.rows[0].id]);
      console.log('  PER USER: one project, two members, two orders -> '
        + both.rows.map((r) => `priority=${r.priority} sort=${r.sort_order}`).join(' | '));
    } catch (e: unknown) {
      console.log('  PER-USER PROBE failed -> ' + String((e as { message?: string }).message).slice(0, 140));
    }
    await c.query('ROLLBACK TO SAVEPOINT perUser');

    // ── 2. The guard must FIRE on a project that carries an order. ───
    await c.query('SAVEPOINT guard');
    try {
      await c.query(`UPDATE public.refm_projects SET sort_order = 3
        WHERE id = (SELECT id FROM public.refm_projects LIMIT 1)`);
      await c.query(sql);
      console.log('  GUARD: FAILED, the migration proceeded over an existing manual order');
    } catch (e: unknown) {
      console.log('  GUARD fired on an existing order: '
        + String((e as { message?: string }).message).slice(0, 130));
    }
    await c.query('ROLLBACK TO SAVEPOINT guard');

    await c.query('SAVEPOINT guard2');
    try {
      await c.query(`UPDATE public.refm_projects SET priority = true
        WHERE id = (SELECT id FROM public.refm_projects LIMIT 1)`);
      await c.query(sql);
      console.log('  GUARD: FAILED, the migration proceeded over an existing urgent flag');
    } catch (e: unknown) {
      console.log('  GUARD fired on an existing urgent flag: '
        + String((e as { message?: string }).message).slice(0, 130));
    }
    await c.query('ROLLBACK TO SAVEPOINT guard2');
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
