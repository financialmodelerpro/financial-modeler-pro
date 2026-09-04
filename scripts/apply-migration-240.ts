/**
 * apply-migration-240.ts
 *
 * Applies 240_account_invites.sql, and proves it first:
 *   1. Table and redeem function exist after the body runs.
 *   2. ONE open invite per (account, email): a second is refused; a different
 *      email is fine.
 *   3. Redeeming creates a user ATTACHED to the account with NO personal
 *      account of their own (the 239 trigger skips), and stamps the invite
 *      consumed with consumed_by.
 *   4. The SAME token a second time is refused (single use).
 *   5. An EXPIRED invite is refused.
 *   6. An email MISMATCH is refused and leaves NOTHING behind: no user, the
 *      invite still open (the same-operation guarantee).
 *   7. Deleting the account cascades its invites away.
 *   8. Idempotent re-run.
 *   9. No probe rows left behind.
 *
 * Run: npx tsx scripts/apply-migration-240.ts          (dry run, rolls back)
 *      npx tsx scripts/apply-migration-240.ts --apply  (commits)
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

const SQL_PATH = 'supabase/migrations/240_account_invites.sql';
const APPLY = process.argv.includes('--apply');
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

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
  console.log(`=== migration 240 ${APPLY ? '(APPLY)' : '(dry run, will roll back)'} ===\n`);

  try {
    await c.query('BEGIN');
    await c.query(migrationBody());

    const t = await c.query(`SELECT to_regclass('public.account_invites') AS t`);
    const fn = await c.query(`SELECT 1 FROM pg_proc WHERE proname = 'redeem_account_invite'`);
    check('1 the table and the redeem function exist', t.rows[0]?.t !== null && fn.rows.length === 1);

    const stamp = Date.now();
    const h = await c.query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Probe 240 holder', 'user') RETURNING id`,
      [`probe240-holder+${stamp}@example.invalid`]);
    const holderId = String(h.rows[0].id);
    const acct = await c.query(`SELECT id FROM accounts WHERE owner_user_id = $1`, [holderId]);
    const accountId = String(acct.rows[0].id);

    const inviteEmail = `probe240-member+${stamp}@example.invalid`;
    const token = `probe240-token-${stamp}`;
    const mk = (email: string, tok: string, expires = `now() + interval '7 days'`) => c.query(
      `INSERT INTO account_invites (account_id, email, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, ${expires}) RETURNING id`,
      [accountId, email, sha256(tok), holderId]);

    const inv1 = await mk(inviteEmail, token);
    check('2a an invite inserts, open', !!inv1.rows[0].id);
    const dup = await refuses(c,
      `INSERT INTO account_invites (account_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '7 days')`,
      [accountId, inviteEmail.toUpperCase(), sha256('other-token')], /duplicate key|unique/i);
    check('2b a SECOND open invite for the same email (any case) is refused', dup.ok, dup.msg);
    const other = await mk(`probe240-other+${stamp}@example.invalid`, `t2-${stamp}`);
    check('2c a different email is fine', !!other.rows[0].id);

    // 3. Redeem.
    const usersBefore = await c.query(`SELECT count(*)::int AS n FROM users`);
    const red = await c.query(
      `SELECT * FROM redeem_account_invite($1, $2, 'Probe 240 member', 'x-hash', null, null, null, null, null, null, null)`,
      [sha256(token), inviteEmail]);
    const memberId = String(red.rows[0].user_id);
    check('3a redeeming creates the user attached to the account',
      String(red.rows[0].joined_account_id) === accountId);
    const memberRow = await c.query(`SELECT account_id, subscription_plan FROM users WHERE id = $1`, [memberId]);
    const ownAcct = await c.query(`SELECT count(*)::int AS n FROM accounts WHERE owner_user_id = $1`, [memberId]);
    check('3b ...as a MEMBER: points at the account, plan none, NO personal account',
      String(memberRow.rows[0].account_id) === accountId
      && memberRow.rows[0].subscription_plan === 'none'
      && Number(ownAcct.rows[0].n) === 0);
    const consumed = await c.query(`SELECT consumed_at, consumed_by FROM account_invites WHERE id = $1`, [inv1.rows[0].id as string]);
    check('3c ...and the invite is consumed, naming who by',
      consumed.rows[0].consumed_at !== null && String(consumed.rows[0].consumed_by) === memberId);

    // 4. Single use.
    const again = await refuses(c,
      `SELECT * FROM redeem_account_invite($1, $2, 'X', 'x', null, null, null, null, null, null, null)`,
      [sha256(token), inviteEmail], /invalid_invite/);
    check('4 the same token a second time is refused', again.ok, again.msg);

    // 5. Expired.
    const expEmail = `probe240-expired+${stamp}@example.invalid`;
    await mk(expEmail, `exp-${stamp}`, `now() - interval '1 minute'`);
    const expired = await refuses(c,
      `SELECT * FROM redeem_account_invite($1, $2, 'X', 'x', null, null, null, null, null, null, null)`,
      [sha256(`exp-${stamp}`), expEmail], /invalid_invite/);
    check('5 an expired invite is refused', expired.ok, expired.msg);

    // 6. Mismatch leaves NOTHING behind.
    const beforeMismatch = await c.query(`SELECT count(*)::int AS n FROM users`);
    const mm = await refuses(c,
      `SELECT * FROM redeem_account_invite($1, $2, 'X', 'x', null, null, null, null, null, null, null)`,
      [sha256(`t2-${stamp}`), 'wrong@example.invalid'], /email_mismatch/);
    const afterMismatch = await c.query(`SELECT count(*)::int AS n FROM users`);
    const stillOpen = await c.query(
      `SELECT count(*)::int AS n FROM account_invites WHERE token_hash = $1 AND consumed_at IS NULL`,
      [sha256(`t2-${stamp}`)]);
    check('6 an email mismatch is refused with NOTHING behind: no user, invite still open',
      mm.ok && Number(beforeMismatch.rows[0].n) === Number(afterMismatch.rows[0].n)
      && Number(stillOpen.rows[0].n) === 1, mm.msg);

    check('sanity: exactly one user was created by the whole redeem block',
      Number((await c.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n)
      === Number(usersBefore.rows[0].n) + 1);

    // 7. The account cascade takes its invites.
    await c.query(`DELETE FROM users WHERE id = $1`, [memberId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [holderId]);
    const left = await c.query(`SELECT count(*)::int AS n FROM account_invites WHERE account_id = $1`, [accountId]);
    check('7 deleting the holder cascades account and invites away', Number(left.rows[0].n) === 0);

    // 8. Idempotent.
    await c.query(migrationBody());
    const idx = await c.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uniq_account_invites_open'`);
    check('8 idempotent: re-run leaves one open-invite index and the function', Number(idx.rows[0].n) === 1);

    // 9. Clean.
    const leftU = await c.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE 'probe240-%'`);
    const leftI = await c.query(`SELECT count(*)::int AS n FROM account_invites WHERE email LIKE 'probe240-%'`);
    check('9 no probe rows are left behind', Number(leftU.rows[0].n) === 0 && Number(leftI.rows[0].n) === 0);

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
