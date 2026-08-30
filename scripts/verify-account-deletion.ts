/**
 * scripts/verify-account-deletion.ts
 *
 * Pins the account-deletion semantics, BEHAVIORALLY, by running the REAL
 * shared engine (src/shared/account/deleteUserAccount.ts) against a fake
 * Supabase client that records every table operation. No env, no DB, no
 * network, no email: sendEmail fails offline and the engine must treat that as
 * best-effort.
 *
 * What must hold:
 *   A. A LIVE Paddle subscription REFUSES the delete without explicit opt-in,
 *      and an un-cancellable subscription ABORTS the delete (billing is never
 *      orphaned). Nothing is deleted on any refusal.
 *   B. An admin account is never deletable.
 *   C. An ADMIN deletion that cannot be audited does not proceed; a SELF
 *      deletion still can (a user's right to delete does not depend on our
 *      migration lag).
 *   D. Happy path: audit row BEFORE the users delete; the three no-FK tables
 *      are explicitly cleaned; the users row goes last.
 *   E. RETAINED tables are never touched: payment_transactions,
 *      manual_invoices (the financial records).
 *   F. Both HTTP routes delegate to the ONE shared engine (source), the admin
 *      route demands confirm:true, and the self route demands the explicit
 *      subscription acknowledgment.
 *   G. Migration 219 is additive only.
 *
 * Run: npx tsx scripts/verify-account-deletion.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteUserAccount } from '../src/shared/account/deleteUserAccount';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── Fake Supabase client ────────────────────────────────────────────────────
interface Call { table: string; op: string; }
interface FakeOpts {
  user?: Record<string, unknown> | null;
  subRows?: Array<Record<string, unknown>>;
  auditInsertError?: string | null;
}
function makeFake(opts: FakeOpts) {
  const calls: Call[] = [];
  const user = opts.user === undefined
    ? { id: 'u1', email: 'victim@example.com', name: 'Victim', role: 'user', subscription_plan: 'pro', avatar_url: null }
    : opts.user;

  function builder(table: string, op: string) {
    const resolveValue = () => {
      if (op === 'select') {
        if (table === 'users') return { data: user, error: null };
        if (table === 'user_platform_subscriptions') return { data: opts.subRows ?? [], error: null };
        if (table === 'refm_projects') return { data: [{ id: 'p1' }, { id: 'p2' }], error: null };
        if (table === 'refm_project_versions') return { data: null, error: null, count: 7 };
        if (table === 'trial_requests') return { data: null, error: null, count: 1 };
        if (table === 'payment_settings') return { data: null, error: null }; // -> defaults, no apiKey
        return { data: null, error: null };
      }
      if (op === 'insert' && table === 'account_deletions') {
        return { data: null, error: opts.auditInsertError ? { message: opts.auditInsertError } : null };
      }
      if (op === 'delete') return { data: null, error: null, count: 2 };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'in', 'range', 'order', 'limit', 'match', 'not', 'neq', 'or']) b[m] = chain;
    b.maybeSingle = () => Promise.resolve(resolveValue());
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolveValue()).then(res, rej);
    return b;
  }

  const sb = {
    from(table: string) {
      return {
        select: (_c?: string, _o?: unknown) => { calls.push({ table, op: 'select' }); return builder(table, 'select'); },
        insert: (_v: unknown) => { calls.push({ table, op: 'insert' }); return builder(table, 'insert'); },
        update: (_v: unknown) => { calls.push({ table, op: 'update' }); return builder(table, 'update'); },
        delete: (_o?: unknown) => { calls.push({ table, op: 'delete' }); return builder(table, 'delete'); },
      };
    },
    storage: { from: (_b: string) => ({ remove: async (_p: string[]) => ({ data: null, error: null }) }) },
  } as unknown as SupabaseClient;

  return { sb, calls };
}
const deleted = (calls: Call[], table: string) => calls.some((c) => c.table === table && c.op === 'delete');

async function main() {
  const LIVE_SUB = { platform_slug: 'real-estate', plan_key: 'pro', source: 'paddle', status: 'active', paddle_subscription_id: 'sub_123', paddle_customer_id: 'ctm_1', started_at: null, current_period_end: null, expires_at: null, amount_minor: null, currency: null, note: null };

  console.log('A. A live paid subscription is handled explicitly, never orphaned');
  {
    const { sb, calls } = makeFake({ subRows: [LIVE_SUB] });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'self', cancelPaddle: false });
    check('A1 live sub without acknowledgment -> refused (active_subscription)',
      !res.ok && res.code === 'active_subscription');
    check('A2 ...and NOTHING was deleted', !deleted(calls, 'users') && !deleted(calls, 'user_platform_subscriptions'));
  }
  {
    // cancelPaddle: true, but Paddle is NOT configured (no apiKey): the cancel
    // cannot be performed, so the delete must ABORT, not proceed around it.
    const { sb, calls } = makeFake({ subRows: [LIVE_SUB] });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'a1', cancelPaddle: true });
    check('A3 un-cancellable live sub -> aborted (paddle_cancel_failed)',
      !res.ok && res.code === 'paddle_cancel_failed');
    check('A4 ...and the users row was NOT deleted', !deleted(calls, 'users'));
  }

  console.log('B. Admin accounts are never deletable');
  {
    const { sb, calls } = makeFake({ user: { id: 'u1', email: 'boss@example.com', name: 'Boss', role: 'admin', subscription_plan: null, avatar_url: null } });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'a1' });
    check('B1 admin target -> refused (admin_account)', !res.ok && res.code === 'admin_account');
    check('B2 ...nothing deleted', !deleted(calls, 'users'));
  }

  console.log('C. Auditability');
  {
    const { sb, calls } = makeFake({ auditInsertError: 'relation "account_deletions" does not exist' });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'a1', message: 'bye' });
    check('C1 admin delete with no audit table -> refused (audit_unavailable)',
      !res.ok && res.code === 'audit_unavailable');
    check('C2 ...and the users row was NOT deleted', !deleted(calls, 'users'));
  }
  {
    const { sb, calls } = makeFake({ auditInsertError: 'relation "account_deletions" does not exist' });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'self' });
    check('C3 SELF delete still proceeds without the audit table (logged loudly)',
      res.ok === true && deleted(calls, 'users'));
    check('C4 ...reported as unaudited', res.ok && res.audited === false);
  }

  console.log('D. Happy path: order and cleanup');
  {
    const { sb, calls } = makeFake({});
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'a1', message: 'account removed' });
    check('D1 succeeds and is audited', res.ok === true && res.ok && res.audited === true);
    const auditIdx = calls.findIndex((c) => c.table === 'account_deletions' && c.op === 'insert');
    const userDelIdx = calls.findIndex((c) => c.table === 'users' && c.op === 'delete');
    check('D2 audit row written BEFORE the users delete', auditIdx !== -1 && userDelIdx !== -1 && auditIdx < userDelIdx);
    check('D3 user_platform_subscriptions explicitly cleaned', deleted(calls, 'user_platform_subscriptions'));
    check('D4 subscription_email_log explicitly cleaned', deleted(calls, 'subscription_email_log'));
    check('D5 trusted_devices explicitly cleaned', deleted(calls, 'trusted_devices'));
    check('D6 users row deleted (cascades take the project tree)', userDelIdx !== -1);
    check('D7 removed summary reports the project/version counts',
      res.ok && res.removed.projects === 2 && res.removed.versions === 7);
    check('D8 offline email failure is best-effort, not fatal', res.ok && res.messageEmailed === false);
  }

  console.log('E. Retained tables are never touched');
  {
    const { sb, calls } = makeFake({});
    await deleteUserAccount(sb, { userId: 'u1', source: 'self' });
    check('E1 payment_transactions never deleted (revenue ledger retained)', !deleted(calls, 'payment_transactions'));
    check('E2 manual_invoices never deleted (issued invoices retained)', !deleted(calls, 'manual_invoices'));
  }

  console.log('F. Routes delegate to the ONE engine (source)');
  const selfRoute = src('app/api/user/account/route.ts');
  const adminRoute = src('app/api/admin/users/[id]/route.ts');
  check('F1 self route imports the shared engine', selfRoute.includes("from '@/src/shared/account/deleteUserAccount'"));
  check('F2 self route has NO inline users delete of its own', !/from\('users'\)\s*\.delete\(/.test(selfRoute));
  check('F3 self route passes the explicit subscription acknowledgment through',
    /cancelPaddle:\s*body\.acknowledgeSubscriptionCancel === true/.test(selfRoute));
  check('F4 admin route imports the shared engine', adminRoute.includes("from '@/src/shared/account/deleteUserAccount'"));
  check('F5 admin route demands confirm: true', /body\.confirm !== true/.test(adminRoute));
  check('F6 admin route records WHO deleted (deletedBy: adminId)', /deletedBy:\s*adminId/.test(adminRoute));
  check('F7 admin route refuses self-targeting', /id === adminId/.test(adminRoute));
  check('F8 admin confirm modal requires typing the email',
    /confirmEmail\.trim\(\)\.toLowerCase\(\) === preview\.email\.toLowerCase\(\)/.test(src('src/components/admin/DeleteUserModal.tsx')));
  check('F9 settings page sends the acknowledgment and gates the button on it',
    /acknowledgeSubscriptionCancel: ackCancelSub/.test(src('app/settings/page.tsx')));

  console.log('G. Migration 219 is additive only');
  const mig = src('supabase/migrations/219_account_deletions.sql');
  const noComments = mig.replace(/--[^\n]*/g, '');
  check('G1 creates account_deletions', /CREATE TABLE IF NOT EXISTS account_deletions/.test(mig));
  check('G2 no DROP anywhere', !/\bDROP\b/i.test(noComments));
  check('G3 the only ALTER is enabling RLS on the new table itself',
    (noComments.match(/ALTER TABLE/gi) ?? []).length === 1
    && /ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY/.test(noComments));
  check('G4 deleted_user_id is a raw copy, not an FK',
    /deleted_user_id\s+uuid\s+NOT NULL,/.test(mig) && !/deleted_user_id\s+uuid[^,]*REFERENCES/.test(mig));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
