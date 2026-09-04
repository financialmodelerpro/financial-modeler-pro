/**
 * scripts/verify-accounts.ts
 *
 * THE ACCOUNT MODEL, steps 1 (mig 239) and 2 (the boundary). Pins:
 *
 *   S. SOURCE: the account is ITS OWN ROW (an accounts table with its own id),
 *      never a pointer to a person's row (no users.account_owner_id anywhere);
 *      owner_user_id is UNIQUE and cascades with its user; the deletion engine
 *      refuses a holder with members BEFORE any side effect; both HTTP routes
 *      map that refusal to 409; and NOTHING reads users.account_id yet outside
 *      the deletion engine, so the platform behaves exactly as before. Future
 *      steps grow that allow-list deliberately, here.
 *
 *   B. BEHAVIOUR (offline, real engine, fake client): a holder with a member
 *      is refused with zero side effects (no audit row, nothing deleted); a
 *      holder with no members deletes exactly as before mig 239.
 *
 *   L. LIVE (credentials required): every user has an account; every holder
 *      points back at their own; exactly ONE internal account, held by the
 *      platform admin; the trigger gives a brand-new user a personal account
 *      and the cascade removes it with them; a second account for the same
 *      owner is refused; users.account_id is a real FK.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-accounts.ts
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
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── Fake Supabase client (verify-account-deletion's shape, plus accounts) ───
interface Call { table: string; op: string; }
function makeFake(opts: { accountRow: { id: string; name: string } | null; memberCount: number }) {
  const calls: Call[] = [];
  const user = { id: 'u1', email: 'holder@example.com', name: 'Holder', role: 'user', subscription_plan: 'pro', avatar_url: null };

  function builder(table: string, op: string, selectOpts?: { count?: string; head?: boolean }) {
    const resolveValue = () => {
      if (op === 'select') {
        // The member-count read is the ONLY head+count select the engine makes
        // on users; the identity loads are plain selects.
        if (table === 'users' && selectOpts?.head) return { data: null, error: null, count: opts.memberCount };
        if (table === 'users') return { data: user, error: null };
        if (table === 'accounts') return { data: opts.accountRow, error: null };
        if (table === 'user_platform_subscriptions') return { data: [], error: null };
        if (table === 'refm_projects') return { data: [{ id: 'p1' }], error: null };
        if (table === 'refm_project_versions') return { data: null, error: null, count: 3 };
        if (table === 'trial_requests') return { data: null, error: null, count: 0 };
        return { data: null, error: null };
      }
      if (op === 'delete') return { data: null, error: null, count: 1 };
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
        select: (_c?: string, o?: { count?: string; head?: boolean }) => { calls.push({ table, op: 'select' }); return builder(table, 'select', o); },
        insert: (_v: unknown) => { calls.push({ table, op: 'insert' }); return builder(table, 'insert'); },
        update: (_v: unknown) => { calls.push({ table, op: 'update' }); return builder(table, 'update'); },
        delete: (_o?: unknown) => { calls.push({ table, op: 'delete' }); return builder(table, 'delete'); },
      };
    },
    storage: { from: (_b: string) => ({ remove: async (_p: string[]) => ({ data: null, error: null }) }) },
  } as unknown as SupabaseClient;

  return { sb, calls };
}

async function main() {
  console.log('S. Source: the shape of the account model');
  {
    const mig = src('supabase/migrations/239_accounts.sql');
    check('S1 accounts is its own table with its own id',
      /CREATE TABLE IF NOT EXISTS accounts/.test(mig) && /id\s+uuid PRIMARY KEY/.test(mig));
    check('S2 one account per person, dying with its holder',
      /owner_user_id\s+uuid NOT NULL UNIQUE REFERENCES users\(id\) ON DELETE CASCADE/.test(mig));
    check('S3 kind is constrained to client | internal',
      /CHECK \(kind IN \('client', 'internal'\)\)/.test(mig));
    check('S4 the trigger creates a personal account for every new user',
      /AFTER INSERT ON users/.test(mig) && /fn_users_create_personal_account/.test(mig));
    check('S5 a row arriving WITH an account gets no personal one (the invited-member path)',
      /IF NEW\.account_id IS NOT NULL THEN RETURN NEW/.test(mig));

    // The rejected design: an org as a pointer to a person's row.
    const offenders: string[] = [];
    for (const dir of ['src', 'app', 'supabase']) {
      for (const f of walk(path.join(ROOT, dir))) {
        if (fs.readFileSync(f, 'utf8').includes('account_owner_id')) offenders.push(path.relative(ROOT, f));
      }
    }
    check('S6 no users.account_owner_id anywhere (the account is a row, never a pointer to a person)',
      offenders.length === 0, offenders.join(', '));

    const engine = src('src/shared/account/deleteUserAccount.ts');
    const guardAt = engine.indexOf("code: 'account_has_members'");
    const auditAt = engine.indexOf("from('account_deletions').insert");
    const deleteAt = engine.indexOf("from('users').delete()");
    check('S7 the engine refuses a holder with members', guardAt > 0);
    check('S8 ...BEFORE the audit write and BEFORE the users delete (zero side effects)',
      guardAt > 0 && auditAt > guardAt && deleteAt > auditAt);
    check('S9 both routes answer 409 for account_has_members',
      /account_has_members' \? 409/.test(src('app/api/user/account/route.ts'))
      && /account_has_members' \? 409/.test(src('app/api/admin/users/[id]/route.ts')));

    // The reader allow-list IS the contract: each step of the account model
    // amends it consciously, here, so a surface can never start depending on
    // the column by accident. Step 1: the deletion engine. Step 2: the
    // boundary rule (the route enforces it THROUGH the helper and touches the
    // column nowhere itself, which is why it is not listed: a raw account_id
    // query appearing in the route should fail this check).
    const ALLOWED = new Set([
      'src/shared/account/deleteUserAccount.ts',
      'src/shared/admin/accountBoundary.ts',
    ]);
    const readers: string[] = [];
    for (const dir of ['src', 'app']) {
      for (const f of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        if (fs.readFileSync(f, 'utf8').includes('account_id') && !ALLOWED.has(rel)) readers.push(rel);
      }
    }
    check('S10 only the allow-listed account-model files read users.account_id',
      readers.length === 0, readers.join(', '));
  }

  console.log('B. Behaviour: the real engine against a recording client');
  {
    const { sb, calls } = makeFake({ accountRow: { id: 'a1', name: 'Client Firm' }, memberCount: 2 });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'adm', cancelPaddle: true });
    check('B1 a holder with members is refused (account_has_members)',
      !res.ok && res.code === 'account_has_members', res.ok ? 'succeeded' : res.code);
    check('B2 ...naming the account and the member count',
      !res.ok && /Client Firm/.test(res.error) && /2 members/.test(res.error), !res.ok ? res.error : '');
    check('B3 ...with ZERO side effects: no audit row, nothing deleted',
      !calls.some((c) => c.op === 'delete') && !calls.some((c) => c.table === 'account_deletions'));
  }
  {
    const { sb, calls } = makeFake({ accountRow: { id: 'a1', name: 'Solo' }, memberCount: 0 });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'adm', cancelPaddle: true });
    check('B4 a holder with NO members deletes exactly as before',
      res.ok && calls.some((c) => c.table === 'users' && c.op === 'delete'),
      res.ok ? '' : `${res.code}: ${res.error}`);
  }
  {
    // Pre-239 database: the accounts read returns nothing; behaviour is
    // exactly the pre-239 engine (the DB backstop does not exist there either,
    // and that IS pre-239 behaviour).
    const { sb } = makeFake({ accountRow: null, memberCount: 99 });
    const res = await deleteUserAccount(sb, { userId: 'u1', source: 'admin', deletedBy: 'adm', cancelPaddle: true });
    check('B5 no accounts row (pre-239): the delete proceeds unchanged', res.ok, res.ok ? '' : res.code);
  }

  console.log('C. Step 2: the account boundary on the member route');
  {
    const route = src('app/api/admin/project-members/route.ts');
    const userLookupAt = route.indexOf("badRequest('No such user.')");
    const boundaryAt = route.indexOf('checkAccountBoundary(');
    const seatAt = route.indexOf('checkSeatForMember(');
    check('C1 the POST checks the boundary AFTER the user lookup and BEFORE the seat check',
      userLookupAt > 0 && boundaryAt > userLookupAt && seatAt > boundaryAt);
    check('C2 a cross-account candidate is a 403, and a failed read refuses the write',
      /status: 403/.test(route) && /Account boundary check failed, nothing was changed/.test(route));
    check('C3 the candidates GET answers through the SAME rule (listAccountCandidates)',
      /candidatesFor/.test(route) && /listAccountCandidates\(/.test(route));

    const panel = src('src/hubs/modeling/components/TeamAccessPanel.tsx');
    check('C4 the dropdown asks candidatesFor and no longer lists every user',
      /candidatesFor=/.test(panel) && !/\/api\/admin\/users/.test(panel));
    check('C4b the stale read-only note is gone (the edit lock shipped in step 5)',
      !/read-only access for now/.test(panel) && !/team-access-readonly-note/.test(panel));

    const { checkAccountBoundary } = await import('../src/shared/admin/accountBoundary');
    const fakeUsers = (rows: Array<{ id: string; account_id: string | null; role: string | null }> | { errorMsg: string }) => ({
      from: (_t: string) => ({
        select: (_c?: string) => ({
          in: (_col: string, _ids: string[]) => Promise.resolve(
            'errorMsg' in rows
              ? { data: null, error: { message: rows.errorMsg } }
              : { data: rows, error: null },
          ),
        }),
      }),
    }) as unknown as SupabaseClient;

    const OWNER = { id: 'own', account_id: 'acct-A', role: 'user' };
    {
      const d = await checkAccountBoundary(fakeUsers([OWNER, { id: 'cand', account_id: 'acct-A', role: 'user' }]), 'own', 'cand');
      check('C5 same account -> allowed', d.allowed && d.reason === 'same_account', d.reason);
    }
    {
      const d = await checkAccountBoundary(fakeUsers([OWNER, { id: 'cand', account_id: 'acct-B', role: 'user' }]), 'own', 'cand');
      check('C6 cross account -> REFUSED', !d.allowed && d.reason === 'cross_account', d.reason);
    }
    {
      const d = await checkAccountBoundary(fakeUsers([OWNER, { id: 'cand', account_id: 'acct-B', role: 'admin' }]), 'own', 'cand');
      check('C7 a platform-admin candidate is exempt', d.allowed && d.reason === 'candidate_admin', d.reason);
    }
    {
      const d = await checkAccountBoundary(fakeUsers([{ ...OWNER, role: 'admin' }, { id: 'cand', account_id: 'acct-B', role: 'user' }]), 'own', 'cand');
      check('C8 an admin-owned project accepts anyone (admin is never blocked)', d.allowed && d.reason === 'owner_admin', d.reason);
    }
    {
      const d = await checkAccountBoundary(fakeUsers({ errorMsg: 'column users.account_id does not exist' }), 'own', 'cand');
      check('C9 pre-239 database -> allowed, flagged pre_migration (exactly pre-239 behaviour)',
        d.allowed && d.reason === 'pre_migration', d.reason);
    }
    {
      let threw = false;
      try { await checkAccountBoundary(fakeUsers({ errorMsg: 'connection reset' }), 'own', 'cand'); }
      catch { threw = true; }
      check('C10 any OTHER read failure THROWS, so the route refuses the write', threw);
    }
    {
      const d = await checkAccountBoundary(fakeUsers([{ ...OWNER, account_id: null }, { id: 'cand', account_id: null, role: 'user' }]), 'own', 'cand');
      check('C11 a NULL account post-239 (broken invariant) refuses rather than matching NULL to NULL',
        !d.allowed && d.reason === 'cross_account', d.reason);
    }
  }

  console.log('L. Live: the invariants over the real rows');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('SKIP L1-L8 (no DB creds: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key);

    // Stale probes from a crashed earlier run must not fail the invariants.
    await sb.from('users').delete().like('email', 'probe-accounts-%');

    const { data: users, error: uErr } = await sb.from('users').select('id, role, account_id');
    const { data: accounts, error: aErr } = await sb.from('accounts').select('id, name, kind, owner_user_id');
    check('L1 users and accounts are readable', !uErr && !aErr, uErr?.message ?? aErr?.message);

    const uList = (users ?? []) as Array<{ id: string; role: string | null; account_id: string | null }>;
    const aList = (accounts ?? []) as Array<{ id: string; name: string; kind: string; owner_user_id: string }>;
    const acctById = new Map(aList.map((a) => [a.id, a]));

    check('L2 every user has an account', uList.every((u) => !!u.account_id),
      uList.filter((u) => !u.account_id).map((u) => u.id).join(', '));
    check('L3 every user\'s account exists', uList.every((u) => !u.account_id || acctById.has(u.account_id)));
    const holders = new Map(aList.map((a) => [a.owner_user_id, a]));
    check('L4 every holder points back at their own account',
      uList.every((u) => !holders.has(u.id) || holders.get(u.id)!.id === u.account_id));
    check('L5 every account\'s holder is a real user, one account per person',
      aList.every((a) => uList.some((u) => u.id === a.owner_user_id))
      && new Set(aList.map((a) => a.owner_user_id)).size === aList.length);
    const internal = aList.filter((a) => a.kind === 'internal');
    check('L6 exactly one internal account (FMP\'s own), held by the platform admin',
      internal.length === 1 && uList.find((u) => u.id === internal[0]?.owner_user_id)?.role === 'admin',
      `${internal.length} internal`);

    // ── Step 2 live: the boundary decides over REAL rows, read-only ───────
    const { checkAccountBoundary, listAccountCandidates } = await import('../src/shared/admin/accountBoundary');
    const adminUser = uList.find((u) => u.role === 'admin');
    const nonAdmins = uList.filter((u) => u.role !== 'admin' && u.account_id);
    const crossPair = nonAdmins.length >= 2 && nonAdmins[0].account_id !== nonAdmins[1].account_id
      ? [nonAdmins[0], nonAdmins[1]] : null;
    if (!crossPair || !adminUser) {
      check('L11-L14 boundary live checks have the rows they need', false,
        `nonAdmins=${nonAdmins.length} admin=${!!adminUser}`);
    } else {
      const [a, b] = crossPair;
      const d1 = await checkAccountBoundary(sb, a.id, b.id);
      check('L11 two real users on different accounts -> REFUSED', !d1.allowed && d1.reason === 'cross_account', d1.reason);
      const d2 = await checkAccountBoundary(sb, a.id, adminUser.id);
      check('L12 the platform admin as candidate -> allowed on any project', d2.allowed && d2.reason === 'candidate_admin', d2.reason);

      const l1 = await listAccountCandidates(sb, a.id);
      const sameOrAdmin = (id: string) => {
        const u = uList.find((x) => x.id === id);
        return !!u && (u.role === 'admin' || u.account_id === a.account_id);
      };
      check('L13 candidates for a client owner = their account plus admins, nobody else',
        l1.scoped && l1.candidates.length > 0
        && l1.candidates.every((c) => sameOrAdmin(c.id))
        && !l1.candidates.some((c) => c.id === b.id),
        l1.candidates.map((c) => c.email).join(', '));

      const l2 = await listAccountCandidates(sb, adminUser.id);
      check('L14 candidates for the admin owner = everyone (admin is never blocked)',
        l2.scoped && l2.candidates.length === uList.length,
        `${l2.candidates.length} of ${uList.length}`);
    }

    // The trigger and the cascade, proven with one probe user, cleaned up in
    // finally so a crash cannot strand it past the next run's sweep.
    const email = `probe-accounts-${Date.now()}@example.invalid`;
    let probeId: string | null = null;
    try {
      const { data: ins, error: insErr } = await sb.from('users')
        .insert({ email, name: 'Probe Accounts', company: 'Probe Accounts Co', role: 'user', subscription_plan: 'none', subscription_status: 'expired' })
        .select('id').single();
      probeId = (ins as { id: string } | null)?.id ?? null;
      if (insErr || !probeId) {
        check('L7 the trigger gives a new user a personal account', false, insErr?.message ?? 'insert failed');
      } else {
        // RETURNING runs before AFTER triggers, so re-read the row.
        const { data: fresh } = await sb.from('users').select('account_id').eq('id', probeId).single();
        const acctId = (fresh as { account_id: string | null } | null)?.account_id ?? null;
        const { data: acct } = acctId
          ? await sb.from('accounts').select('id, name, kind, owner_user_id').eq('id', acctId).maybeSingle()
          : { data: null };
        const a = acct as { id: string; name: string; kind: string; owner_user_id: string } | null;
        check('L7 the trigger gives a new user a personal account, named from the company, kind client',
          !!a && a.owner_user_id === probeId && a.name === 'Probe Accounts Co' && a.kind === 'client',
          JSON.stringify(a));

        const { error: dupErr } = await sb.from('accounts')
          .insert({ name: 'Second', kind: 'client', owner_user_id: probeId });
        check('L8 a second account for the same owner is refused (unique)',
          !!dupErr && /duplicate|unique/i.test(dupErr.message), dupErr?.message ?? 'insert SUCCEEDED');

        const { error: badFk } = await sb.from('users')
          .insert({ email: `probe-accounts-fk-${Date.now()}@example.invalid`, name: 'P', role: 'user', account_id: '00000000-0000-0000-0000-000000000001' });
        check('L9 users.account_id is a real FK (a made-up account is refused)',
          !!badFk && /foreign key|violates/i.test(badFk.message), badFk?.message ?? 'insert SUCCEEDED');

        const { error: delErr } = await sb.from('users').delete().eq('id', probeId);
        const { data: after } = acctId
          ? await sb.from('accounts').select('id').eq('id', acctId).maybeSingle()
          : { data: null };
        check('L10 deleting the user cascades their personal account away', !delErr && !after,
          delErr?.message ?? (after ? 'account row survived' : ''));
        if (!delErr) probeId = null;
      }
    } finally {
      if (probeId) await sb.from('users').delete().eq('id', probeId);
      await sb.from('users').delete().like('email', 'probe-accounts-%');
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
