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
      'src/shared/admin/seats.ts', // step 3: seats count the account's people
      'src/shared/account/invites.ts', // step 5: invites attach members to the account
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

  console.log('D. Step 4: a member inherits the holder\'s plan, in ONE place');
  {
    // The lookup lives in resolveAccountHolder, and its callers are an
    // ALLOW-LIST grown consciously, like S10: the gate (the one place plan
    // inheritance happens; a second inheritance site could resolve the
    // MEMBER and show a paying client's colleague the request-access
    // storefront) plus the invite engine and its route, which reuse the SAME
    // rule to ask "is this caller the holder", the reuse the one-place
    // principle exists for.
    const CALLERS = new Set([
      'src/shared/entitlements/resolveUser.ts', // step 4: plan inheritance, the one place
      'src/shared/account/invites.ts',          // step 5: only the holder invites
      'app/api/account/invites/route.ts',       // step 5: eligibility for the team card
    ]);
    const callers: string[] = [];
    for (const dir of ['src', 'app']) {
      for (const f of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        if (rel === 'src/shared/admin/accountBoundary.ts') continue;
        if (/resolveAccountHolder\(/.test(fs.readFileSync(f, 'utf8')) && !CALLERS.has(rel)) callers.push(rel);
      }
    }
    check('D1 resolveAccountHolder has no caller outside the allow-list (plan inheritance stays in the gate)',
      callers.length === 0, callers.join(', '));

    const gate = src('src/shared/entitlements/resolveUser.ts');
    check('D2 every plan-shaped read uses the billing identity',
      /const billingUserId = isMember \? holderUserId : userId;/.test(gate)
      && (gate.match(/eq\('user_id', billingUserId\)/g) ?? []).length === 2);
    check('D3 a member gets no project allowance of their own',
      /isMember \? \{ projectLimit: 0, archiveAllowed: false \}/.test(gate));
    check('D4 the member\'s ROLE stays their own (only plan fields come from the holder)',
      /select\('subscription_plan, trial_ends_at'\)/.test(gate)
      && /const role = \(user\.role as string\)/.test(gate));
    check('D5 an unreadable holder DENIES for a member, never guesses',
      /holder load failed for member/.test(gate));
    check('D6 the access-reminder scan drops members',
      /accountMemberIds\(sb, ids\)/.test(src('src/shared/email/subscriptionEmails.ts')));
    const camp = src('src/shared/email/campaigns.ts');
    check('D7 a no-plan campaign audience drops members AND reports the count',
      /membersExcluded/.test(camp) && /accountMemberIds\(/.test(camp)
      && /includes\('none'\)/.test(camp));
  }

  console.log('E. Step 5: invites');
  {
    const mig = src('supabase/migrations/240_account_invites.sql');
    check('E1 only a token HASH is stored, unique, with a hard expiry',
      /token_hash\s+text NOT NULL UNIQUE/.test(mig) && /expires_at\s+timestamptz NOT NULL/.test(mig)
      && !/raw_token|token\s+text/.test(mig));
    check('E2 one OPEN invite per (account, email), case-insensitive',
      /uniq_account_invites_open/.test(mig) && /lower\(email\)\) WHERE consumed_at IS NULL/.test(mig));
    check('E3 redemption is ONE transaction: lock, match, attach, consume',
      /FOR UPDATE/.test(mig) && /RAISE EXCEPTION 'invalid_invite'/.test(mig)
      && /RAISE EXCEPTION 'email_mismatch'/.test(mig) && /v_invite\.account_id/.test(mig));

    const inv = src('src/shared/account/invites.ts');
    check('E4 the seat is reserved at CREATE: people + open invites + 1 vs the limit',
      /seatsAllow\(seats\.used \+ seats\.reserved \+ 1, seats\.limit\)/.test(inv));
    check('E4b ...and re-checked at ACCEPT with the reservation counted, not grown',
      /seatsAllow\(seats\.used \+ seats\.reserved, seats\.limit\)/.test(inv));
    check('E5 an unsendable invite email rolls the reservation back',
      /await sb\.from\('account_invites'\)\.delete\(\)\.eq\('id',.*\n?.*email_send_failed/.test(inv)
      || (/email_send_failed/.test(inv) && /account_invites'\)\.delete\(\)\.eq\('id'/.test(inv)));
    check('E6 an existing user cannot be invited (one person, one account)',
      /existing_user/.test(inv));
    check('E7 only the holder invites; a member is refused',
      /not_holder/.test(inv) && /resolveAccountHolder\(sb, inviterUserId\)/.test(inv));

    const reg = src('app/api/auth/register/route.ts');
    const forkAt = reg.indexOf('body.inviteToken');
    const gateAt = reg.indexOf('await canEmailRegisterModeling(email)');
    const captchaAt = reg.indexOf('await verifyCaptcha');
    check('E8 the register fork sits AFTER captcha and BEFORE the launch gate (the client pays)',
      captchaAt > 0 && forkAt > captchaAt && gateAt > forkAt,
      `captcha=${captchaAt} fork=${forkAt} gate=${gateAt}`);
    check('E9 the invite branch redeems through the ONE atomic rpc, never inserting a user itself',
      /redeemAccountInvite\(serverClient/.test(reg)
      && !/from\('users'\)\.insert/.test(reg.slice(forkAt, gateAt)));
    check('E10 the redeemed email joins the signin whitelist (a paid member can log in)',
      /modeling_access_whitelist/.test(reg.slice(forkAt, gateAt)));
    check('E11 the ordinary path is untouched: gate, duplicate check and tiered insert all remain',
      /await canEmailRegisterModeling\(email\)/.test(reg)
      && /An account with that email already exists/.test(reg)
      && /insert\(withQualification\)/.test(reg));

    check('E12 the register page resolves the token server-side and locks the email',
      /previewInviteByToken/.test(src('app/modeling/register/page.tsx'))
      && /inviteToken/.test(src('app/modeling/register/RegisterForm.tsx')));
    check('E13 the dashboard card decides nothing: eligibility comes from the server',
      /\/api\/account\/invites/.test(src('src/hubs/modeling/components/TeamInvitesCard.tsx'))
      && /eligible/.test(src('app/api/account/invites/route.ts')));
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
      const sameAccount = (id: string) => {
        const u = uList.find((x) => x.id === id);
        return !!u && u.account_id === a.account_id;
      };
      check('L13 candidates for a client owner = their account ONLY, nobody else',
        l1.scoped && l1.candidates.length > 0
        && l1.candidates.every((c) => sameAccount(c.id))
        && !l1.candidates.some((c) => c.id === b.id),
        l1.candidates.map((c) => c.email).join(', '));
      // The list is NARROWER than the write, never the reverse: the admin is
      // accepted by the check (L12) but not OFFERED as a standing option.
      check('L13b the platform admin is not offered, though the write would accept them',
        !l1.candidates.some((c) => c.id === adminUser.id),
        l1.candidates.map((c) => c.email).join(', '));

      const l2 = await listAccountCandidates(sb, adminUser.id);
      check('L14 candidates for the admin owner = everyone (admin is never blocked)',
        l2.scoped && l2.candidates.length === uList.length,
        `${l2.candidates.length} of ${uList.length}`);
    }

    // ── Step 4 live: the member gate, end to end, with a probe pair ───────
    // A probe holder on the REAL pro plan and a probe member wired into their
    // account; resolveUserGate is the REAL resolver every gated surface
    // reads. The feature ships dark (no members exist), so this is the only
    // way to see it work before invites do.
    {
      const { resolveUserGate } = await import('../src/shared/entitlements/resolveUser');
      const { resolveAccountHolder, accountMemberIds } = await import('../src/shared/admin/accountBoundary');
      const stamp = Date.now();
      let holderId: string | null = null;
      let memberId: string | null = null;
      try {
        const { data: h } = await sb.from('users')
          .insert({ email: `probe-accounts-h${stamp}@example.invalid`, name: 'Probe Holder', role: 'user', subscription_plan: 'pro', subscription_status: 'active' })
          .select('id').single();
        holderId = (h as { id: string } | null)?.id ?? null;
        const { data: m } = await sb.from('users')
          .insert({ email: `probe-accounts-m${stamp}@example.invalid`, name: 'Probe Member', role: 'user', subscription_plan: 'none', subscription_status: 'expired' })
          .select('id').single();
        memberId = (m as { id: string } | null)?.id ?? null;
        if (!holderId || !memberId) {
          check('L15-L18 member-gate probe pair created', false, 'insert failed');
        } else {
          const { data: hRow } = await sb.from('users').select('account_id').eq('id', holderId).single();
          const holderAcct = (hRow as { account_id: string | null } | null)?.account_id;
          await sb.from('users').update({ account_id: holderAcct }).eq('id', memberId);
          await sb.from('accounts').delete().eq('owner_user_id', memberId);

          const rh = await resolveAccountHolder(sb, memberId);
          check('L15 the member resolves to the HOLDER as billing identity',
            rh.isMember && rh.holderUserId === holderId, JSON.stringify(rh));

          const memberGate = await resolveUserGate(memberId);
          check('L16 the member INHERITS the holder\'s plan, lapse and grace',
            memberGate.planKey === 'pro' && memberGate.knownPlan && memberGate.lapseState === 'active' && !memberGate.readOnly,
            `plan=${memberGate.planKey} lapse=${memberGate.lapseState}`);
          check('L16b ...with NO project allowance of their own, role their own',
            memberGate.projectLimit === 0 && memberGate.archiveAllowed === false && memberGate.role === 'user',
            `limit=${memberGate.projectLimit}`);

          const holderGate = await resolveUserGate(holderId);
          check('L17 the holder\'s own gate is untouched (a real allowance, same plan)',
            holderGate.planKey === 'pro' && holderGate.projectLimit !== 0,
            `plan=${holderGate.planKey} limit=${holderGate.projectLimit}`);

          const mids = await accountMemberIds(sb, [holderId, memberId]);
          check('L18 the audience rule sees exactly the member, never the holder',
            mids.size === 1 && mids.has(memberId));
        }
      } finally {
        if (memberId) await sb.from('users').delete().eq('id', memberId);
        if (holderId) await sb.from('users').delete().eq('id', holderId);
        await sb.from('users').delete().like('email', 'probe-accounts-%');
      }
    }

    // ── Step 5 live: the invite cycle, end to end, no email sent ──────────
    // The redemption goes through the REAL engine and the REAL rpc; the two
    // refusal probes (seat limit, existing user) return BEFORE the email
    // send, so the suite never mails anyone.
    {
      const { redeemAccountInvite, createAccountInvite, hashInviteToken } = await import('../src/shared/account/invites');
      const stamp = Date.now();
      let firmId: string | null = null;
      let proId: string | null = null;
      let joinedId: string | null = null;
      try {
        const { data: f } = await sb.from('users')
          .insert({ email: `probe-accounts-firm${stamp}@example.invalid`, name: 'Probe Firm Holder', role: 'user', subscription_plan: 'firm', subscription_status: 'active' })
          .select('id').single();
        firmId = (f as { id: string } | null)?.id ?? null;
        const { data: p } = await sb.from('users')
          .insert({ email: `probe-accounts-pro${stamp}@example.invalid`, name: 'Probe Pro Holder', role: 'user', subscription_plan: 'pro', subscription_status: 'active' })
          .select('id').single();
        proId = (p as { id: string } | null)?.id ?? null;
        if (!firmId || !proId) {
          check('L20-L24 invite live probes have their holders', false, 'insert failed');
        } else {
          const { data: fAcct } = await sb.from('accounts').select('id').eq('owner_user_id', firmId).single();
          const firmAcct = (fAcct as { id: string }).id;

          // A pro holder (1 seat, owner in it) cannot reserve another.
          const refused = await createAccountInvite(sb, proId, `probe-accounts-x${stamp}@example.invalid`, 'https://example.invalid');
          check('L20 a one-seat holder cannot invite past their seats (refused at CREATE)',
            !refused.ok && refused.code === 'seat_limit', refused.ok ? 'ALLOWED' : refused.code);

          // An existing user cannot be invited (refused before any email).
          const dup = await createAccountInvite(sb, firmId, uList[0] ? (await sb.from('users').select('email').eq('id', uList[0].id).single()).data!.email as string : 'x', 'https://example.invalid');
          check('L21 an existing user cannot be invited', !dup.ok && dup.code === 'existing_user', dup.ok ? 'ALLOWED' : dup.code);

          // A firm invite redeems through the REAL rpc into a MEMBER.
          const token = `probe-accounts-tok-${stamp}`;
          const joinEmail = `probe-accounts-join${stamp}@example.invalid`;
          await sb.from('account_invites').insert({
            account_id: firmAcct, email: joinEmail, token_hash: hashInviteToken(token),
            invited_by: firmId, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          });
          const red = await redeemAccountInvite(sb, {
            rawToken: token, email: joinEmail, name: 'Probe Joined', passwordHash: 'x-hash',
            phone: null, city: null, country: null, company: null, jobTitle: null,
            worksInRealEstate: null, roleNote: null,
          });
          check('L22 redeeming attaches the person to the inviting account', red.ok, red.ok ? '' : `${red.code}: ${red.error}`);
          if (red.ok) {
            joinedId = red.userId;
            const { data: joined } = await sb.from('users').select('account_id, subscription_plan').eq('id', joinedId).single();
            const { count: ownAcct } = await sb.from('accounts').select('id', { count: 'exact', head: true }).eq('owner_user_id', joinedId);
            check('L23 ...as a MEMBER: on the account, plan none, no account of their own',
              (joined as { account_id: string }).account_id === firmAcct
              && (joined as { subscription_plan: string }).subscription_plan === 'none'
              && (ownAcct ?? 0) === 0);
            const again = await redeemAccountInvite(sb, {
              rawToken: token, email: joinEmail, name: 'X', passwordHash: 'x',
              phone: null, city: null, country: null, company: null, jobTitle: null,
              worksInRealEstate: null, roleNote: null,
            });
            check('L24 the invite is single use', !again.ok && again.code === 'invalid_invite', again.ok ? 'ALLOWED' : again.code);
          }
        }
      } finally {
        if (joinedId) await sb.from('users').delete().eq('id', joinedId);
        if (firmId) await sb.from('users').delete().eq('id', firmId);
        if (proId) await sb.from('users').delete().eq('id', proId);
        await sb.from('users').delete().like('email', 'probe-accounts-%');
        await sb.from('account_invites').delete().like('email', 'probe-accounts-%');
      }
    }

    // Every REAL user is a holder today, so the gate resolves everyone to
    // THEMSELVES: the step ships dark and nothing changed for anyone.
    {
      const { resolveAccountHolder } = await import('../src/shared/admin/accountBoundary');
      let selfResolved = 0;
      for (const u of uList) {
        const r = await resolveAccountHolder(sb, u.id);
        if (!r.isMember && r.holderUserId === u.id) selfResolved++;
      }
      check(`L19 all ${uList.length} real users resolve to themselves (ships dark, nothing changes)`,
        selfResolved === uList.length, `${selfResolved} of ${uList.length}`);
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
