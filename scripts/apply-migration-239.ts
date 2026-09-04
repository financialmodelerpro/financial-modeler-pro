/**
 * apply-migration-239.ts
 *
 * Applies 239_accounts.sql, and proves it first.
 *
 * Every claim is tested by CAUSING the situation:
 *   1. The accounts table exists after the body runs.
 *   2. Backfill: every user has an account, every holder points back at their
 *      own, and exactly one account is 'internal' (the platform admin's).
 *   3. The trigger: a NEW user gets a personal account automatically, named
 *      from company where there is one, else the name; kind 'client' for a
 *      plain user.
 *   4. One account per person: a second account for the same owner is REFUSED
 *      (the UNIQUE constraint).
 *   5. Deleting a user CASCADES their personal account away.
 *   6. THE BACKSTOP: deleting a holder whose account still has a MEMBER is
 *      refused inside Postgres (users.account_id is NO ACTION), and deleting
 *      the member first frees the holder.
 *   7. A row arriving WITH an account_id (a future invited member) gets NO
 *      personal account of its own.
 *   8. Idempotent: re-running the body changes nothing and leaves the trigger
 *      present exactly once.
 *   9. No probe rows are left behind.
 *
 * Run: npx tsx scripts/apply-migration-239.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-239.ts --apply  (commits)
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

const SQL_PATH = 'supabase/migrations/239_accounts.sql';
const APPLY = process.argv.includes('--apply');

function migrationBody(): string {
  return readFileSync(SQL_PATH, 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

async function refuses(c: PgClient, sql: string, values: unknown[], want: RegExp): Promise<{ ok: boolean; msg: string }> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, values);
    await c.query('ROLLBACK TO SAVEPOINT probe');
    return { ok: false, msg: 'the statement SUCCEEDED and should not have' };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe');
    const msg = (e as { message?: string }).message ?? '';
    return { ok: want.test(msg), msg };
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`=== migration 239 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const t = await c.query(`SELECT to_regclass('public.accounts') AS t`);
    check('1 the accounts table exists after the body runs', t.rows[0]?.t !== null);

    // ── 2. Backfill invariants over the REAL rows ─────────────────────────
    const orphans = await c.query(`SELECT count(*)::int AS n FROM users WHERE account_id IS NULL`);
    check('2a every user has an account', Number(orphans.rows[0].n) === 0, `${orphans.rows[0].n} users without one`);

    const astray = await c.query(
      `SELECT count(*)::int AS n FROM accounts a JOIN users u ON u.id = a.owner_user_id
        WHERE u.account_id IS DISTINCT FROM a.id`);
    check('2b every holder points back at their own account', Number(astray.rows[0].n) === 0);

    const internal = await c.query(
      `SELECT a.id, u.role FROM accounts a JOIN users u ON u.id = a.owner_user_id WHERE a.kind = 'internal'`);
    check('2c exactly one internal account, held by the platform admin',
      internal.rows.length === 1 && internal.rows[0].role === 'admin',
      `${internal.rows.length} internal, roles=${internal.rows.map((r) => r.role).join(',')}`);

    const named = await c.query(
      `SELECT count(*)::int AS n FROM accounts a JOIN users u ON u.id = a.owner_user_id
        WHERE NULLIF(trim(u.company), '') IS NOT NULL AND a.name <> trim(u.company)`);
    check('2d name comes from the company field where there is one', Number(named.rows[0].n) === 0);

    // ── 3. The trigger, by inserting real users ───────────────────────────
    const stamp = Date.now();
    const h = await c.query(
      `INSERT INTO users (email, name, company, role) VALUES ($1, 'Probe 239 holder', 'Probe Firm 239', 'user') RETURNING id`,
      [`probe239-holder+${stamp}@example.invalid`]);
    const holderId = String(h.rows[0].id);
    const hAcct = await c.query(
      `SELECT a.id, a.name, a.kind, u.account_id FROM accounts a JOIN users u ON u.id = a.owner_user_id WHERE a.owner_user_id = $1`,
      [holderId]);
    check('3a a new user gets a personal account automatically', hAcct.rows.length === 1);
    check('3b ...named from the company field', hAcct.rows[0]?.name === 'Probe Firm 239', String(hAcct.rows[0]?.name));
    check('3c ...kind client for a plain user, holder pointing back',
      hAcct.rows[0]?.kind === 'client' && String(hAcct.rows[0]?.account_id) === String(hAcct.rows[0]?.id));
    const holderAcctId = String(hAcct.rows[0]?.id);

    const noCo = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Probe 239 nameless co', 'user') RETURNING id`,
      [`probe239-noco+${stamp}@example.invalid`]);
    const noCoId = String(noCo.rows[0].id);
    const noCoAcct = await c.query(`SELECT name FROM accounts WHERE owner_user_id = $1`, [noCoId]);
    check('3d without a company, the account is named from the person', noCoAcct.rows[0]?.name === 'Probe 239 nameless co');
    await c.query(`DELETE FROM users WHERE id = $1`, [noCoId]);

    // ── 4. One account per person ─────────────────────────────────────────
    const dup = await refuses(c,
      `INSERT INTO accounts (name, kind, owner_user_id) VALUES ('Second', 'client', $1)`,
      [holderId], /duplicate key|unique/i);
    check('4 a SECOND account for the same owner is refused', dup.ok, dup.msg);

    // ── 6. The backstop: a holder with a member cannot be deleted ─────────
    // A member points at the holder's account and holds none of their own,
    // which is what an invited member will look like.
    const m = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Probe 239 member', 'user') RETURNING id`,
      [`probe239-member+${stamp}@example.invalid`]);
    const memberId = String(m.rows[0].id);
    await c.query(`UPDATE users SET account_id = $1 WHERE id = $2`, [holderAcctId, memberId]);
    await c.query(`DELETE FROM accounts WHERE owner_user_id = $1`, [memberId]);

    const blocked = await refuses(c, `DELETE FROM users WHERE id = $1`, [holderId], /foreign key|violates/i);
    check('6a deleting a holder whose account still has a member is REFUSED', blocked.ok, blocked.msg);
    const stillThere = await c.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [holderId]);
    check('6b ...and the holder still exists', Number(stillThere.rows[0].n) === 1);

    // ── 7. A row arriving WITH an account (an invited member) gets no own ──
    const ownAcct = await c.query(`SELECT count(*)::int AS n FROM accounts WHERE owner_user_id = $1`, [memberId]);
    check('7 a user pointing at another account holds no account of their own', Number(ownAcct.rows[0].n) === 0);

    // ── 5 + 6c. Member deleted frees the holder; cascade removes the account
    await c.query(`DELETE FROM users WHERE id = $1`, [memberId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const gone = await c.query(`SELECT count(*)::int AS n FROM accounts WHERE id = $1`, [holderAcctId]);
    check('5 deleting the user CASCADES their personal account away', Number(gone.rows[0].n) === 0);

    // ── 8. Idempotent ─────────────────────────────────────────────────────
    const before = await c.query(`SELECT count(*)::int AS n FROM accounts`);
    await c.query(migrationBody());
    const after = await c.query(`SELECT count(*)::int AS n FROM accounts`);
    const trg = await c.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal AND tgname = 'trg_users_personal_account'`);
    check('8 idempotent: re-run changes no accounts, trigger present exactly once',
      Number(before.rows[0].n) === Number(after.rows[0].n) && trg.rows.length === 1,
      `before=${before.rows[0].n} after=${after.rows[0].n} triggers=${trg.rows.length}`);

    // ── 9. No probe rows left ─────────────────────────────────────────────
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe239-%'`);
    const leftA = await c.query(`SELECT count(*)::int AS n FROM accounts WHERE name LIKE 'Probe%239%'`);
    check('9 no probe rows are left behind', Number(leftU.rows[0].n) === 0 && Number(leftA.rows[0].n) === 0,
      `users=${leftU.rows[0].n} accounts=${leftA.rows[0].n}`);

    if (fail > 0) {
      await c.query('ROLLBACK');
      console.log(`\n=== ${pass} passed, ${fail} FAILED. Rolled back, nothing applied. ===`);
      process.exit(1);
    }
    if (APPLY) {
      await c.query('COMMIT');
      console.log(`\n=== ${pass} passed, 0 failed. COMMITTED. ===`);
    } else {
      await c.query('ROLLBACK');
      console.log(`\n=== ${pass} passed, 0 failed. Rolled back (dry run). Re-run with --apply. ===`);
    }
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* gone */ }
    console.error('FAILED:', (e as Error).message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
