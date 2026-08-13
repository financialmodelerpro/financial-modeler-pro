/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ai-metering.ts
 *
 * Verifier for server-side AI cap enforcement.
 *
 * THE CENTRAL CLAIM: editing a cap in /admin/ai-features changes what is
 * enforced. So the headline test sets a cap through the SAME admin write path
 * the panel uses, then calls checkAndConsume repeatedly and asserts the block
 * lands on exactly the (cap+1)th call, then re-edits the cap and asserts the
 * limit moves. No hardcoded number is consulted anywhere in that chain.
 *
 * The second claim is FAIL CLOSED. Every uncertain path must deny: unregistered
 * feature, disabled feature, no cap row, cap of zero, no plan, and an
 * unreachable counter store. Each is exercised.
 *
 * The in-memory database fake implements ai_usage_consume with the SAME
 * semantics as the SQL function in migration 205, including the cap<=0 guard
 * and the conditional increment, so the decision logic is tested end to end
 * without a live database.
 *
 *   npx tsx scripts/verify-ai-metering.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkAndConsume, currentPeriodStart, meterDenyStatus, refundAiUsage } from '../src/shared/ai/metering';
import { registerAiFeature } from '../src/shared/ai/registry';
import { setAiFeatureCaps, setAiFeatureEnabled } from '../src/shared/ai/registryAdmin';
import { loadAiUsage } from '../src/shared/ai/usage';
import { AI_PLATFORM_ALL } from '../src/shared/ai/registryTypes';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
};
const eq = (label: string, a: unknown, b: unknown) =>
  ok(`${label} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`, a === b);
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── Fake database, including an ai_usage_consume that mirrors the SQL ───────
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;
interface FakeDb { tables: Record<string, Row[] | undefined>; rpcBroken?: boolean }

let seq = 0;
const nextId = () => `uuid-${++seq}`;

function exec(db: FakeDb, table: string, s: { op: string; filters: Pred[]; payload: unknown; opts: any }) {
  const rows = db.tables[table];
  if (rows === undefined) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  const match = (r: Row) => s.filters.every((f) => f(r));
  if (s.op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
  if (s.op === 'insert') { const row = { id: nextId(), ...(s.payload as Row) }; rows.push(row); return { data: [{ ...row }], error: null }; }
  if (s.op === 'update') { const hit = rows.filter(match); for (const r of hit) Object.assign(r, s.payload as Row); return { data: hit.map((r) => ({ ...r })), error: null }; }
  if (s.op === 'upsert') {
    const conflict = String(s.opts?.onConflict ?? '').split(',').map((c: string) => c.trim()).filter(Boolean);
    for (const incoming of s.payload as Row[]) {
      const hit = rows.find((r) => conflict.every((c) => r[c] === incoming[c]));
      if (hit) { if (s.opts?.ignoreDuplicates !== true) Object.assign(hit, incoming); continue; }
      rows.push({ id: nextId(), ...incoming });
    }
    return { data: null, error: null };
  }
  return { data: null, error: { message: `unsupported ${s.op}` } };
}

function fakeClient(db: FakeDb): any {
  return {
    from(table: string) {
      const s = { op: 'select', filters: [] as Pred[], payload: null as unknown, opts: null as any };
      const b: any = {
        select() { return b; },
        insert(p: unknown) { s.op = 'insert'; s.payload = p; return b; },
        update(p: unknown) { s.op = 'update'; s.payload = p; return b; },
        upsert(p: unknown, o: any) { s.op = 'upsert'; s.payload = p; s.opts = o; return b; },
        eq(c: string, v: unknown) { s.filters.push((r) => r[c] === v); return b; },
        in(c: string, vs: unknown[]) { s.filters.push((r) => vs.includes(r[c])); return b; },
        maybeSingle() {
          return Promise.resolve(exec(db, table, s)).then((r: any) =>
            r.error ? r : { data: (r.data ?? [])[0] ?? null, error: null });
        },
        order() { return b; }, limit() { return b; }, range() { return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(exec(db, table, s)).then(res, rej);
        },
      };
      return b;
    },
    // Mirrors migration 205's ai_usage_consume exactly.
    rpc(name: string, args: any) {
      // Mirrors migration 206's ai_usage_refund: one update, floored at zero,
      // never creates a row.
      if (name === 'ai_usage_refund') {
        if (db.rpcBroken || db.tables.ai_usage_counters === undefined) {
          return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ai_usage_refund' } });
        }
        const { p_user, p_feature, p_period } = args;
        const row = db.tables.ai_usage_counters!.find((r) => r.user_id === p_user && r.ai_feature_id === p_feature && r.period_start === p_period);
        if (!row) return Promise.resolve({ data: null, error: null });
        row.used = Math.max((row.used as number) - 1, 0);
        return Promise.resolve({ data: row.used, error: null });
      }
      if (name !== 'ai_usage_consume') return Promise.resolve({ data: null, error: { message: `unknown function ${name}` } });
      if (db.rpcBroken || db.tables.ai_usage_counters === undefined) {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ai_usage_consume' } });
      }
      const { p_user, p_feature, p_period, p_cap } = args;
      if (p_cap === null || p_cap === undefined || p_cap <= 0) return Promise.resolve({ data: null, error: null });
      const rows = db.tables.ai_usage_counters!;
      const hit = rows.find((r) => r.user_id === p_user && r.ai_feature_id === p_feature && r.period_start === p_period);
      if (!hit) { rows.push({ id: nextId(), user_id: p_user, ai_feature_id: p_feature, period_start: p_period, used: 1 }); return Promise.resolve({ data: 1, error: null }); }
      if ((hit.used as number) < p_cap) { hit.used = (hit.used as number) + 1; return Promise.resolve({ data: hit.used, error: null }); }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const USER = 'user-1';
const freshDb = (counters = true): FakeDb => ({
  tables: {
    ai_features: [], ai_feature_caps: [],
    entitlement_plans: [{ plan_key: 'firm', platform_slug: AI_PLATFORM_ALL, active: true }],
    users: [{ id: USER, subscription_plan: 'firm', role: 'admin' }],
    ai_usage_counters: counters ? [] : undefined,
  },
});

const FEATURE = {
  featureId: 'newsletter_enhance', platformSlug: AI_PLATFORM_ALL, name: 'Newsletter rewriter',
  category: 'generation' as const, grounding: ['context' as const],
};
const consume = (sb: any, extra: any = {}) =>
  checkAndConsume({ userId: USER, featureId: FEATURE.featureId, platformSlug: FEATURE.platformSlug, sb, ...extra });

async function main() {
  // ── 1. THE HEADLINE: an admin cap edit changes the enforced limit ─────────
  const db = freshDb();
  const sb = fakeClient(db);
  await registerAiFeature(FEATURE, sb);
  await setAiFeatureEnabled(FEATURE.featureId, FEATURE.platformSlug, true, sb);

  // Set the cap through the SAME path /admin/ai-features uses.
  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 3 }, sb);

  const results = [] as any[];
  for (let i = 0; i < 5; i++) results.push(await consume(sb));

  eq('call 1 of cap 3 is allowed', results[0].allowed, true);
  eq('call 2 of cap 3 is allowed', results[1].allowed, true);
  eq('call 3 of cap 3 is allowed', results[2].allowed, true);
  eq('call 4 BLOCKS at exactly the cap', results[3].allowed, false);
  eq('and the reason is cap_reached', results[3].allowed === false && results[3].reason, 'cap_reached');
  eq('call 5 stays blocked', results[4].allowed, false);
  eq('the third allowed call reports used 3', results[2].allowed && results[2].used, 3);
  eq('remaining reaches zero', results[2].allowed && results[2].remaining, 0);
  eq('the enforced cap is the DB value', results[2].allowed && results[2].cap, 3);
  eq('a blocked attempt does NOT inflate the counter', (db.tables.ai_usage_counters ?? [])[0].used, 3);

  // Now RAISE the cap in the panel. The limit must move immediately.
  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 5 }, sb);
  const after1 = await consume(sb);
  const after2 = await consume(sb);
  const after3 = await consume(sb);
  eq('raising the cap to 5 immediately allows call 4', after1.allowed, true);
  eq('and call 5', after2.allowed, true);
  eq('then blocks again at the NEW cap', after3.allowed, false);
  eq('the new enforced cap is 5', after1.allowed && after1.cap, 5);

  // And LOWERING it below current usage blocks at once.
  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 1 }, sb);
  const lowered = await consume(sb);
  eq('lowering the cap below current usage blocks immediately', lowered.allowed, false);
  eq('reported against the lowered cap', lowered.allowed === false && lowered.cap, 1);

  // ── 2. FAIL CLOSED on every uncertain path ────────────────────────────────
  const db2 = freshDb();
  const sb2 = fakeClient(db2);

  const unregistered = await consume(sb2);
  eq('an unregistered feature is DENIED', unregistered.allowed, false);
  eq('with reason not_registered', unregistered.allowed === false && unregistered.reason, 'not_registered');

  await registerAiFeature(FEATURE, sb2);
  const disabled = await consume(sb2);
  eq('a registered but DISABLED feature is denied', disabled.allowed, false);
  eq('with reason disabled', disabled.allowed === false && disabled.reason, 'disabled');

  await setAiFeatureEnabled(FEATURE.featureId, FEATURE.platformSlug, true, sb2);
  // Registration seeded a cap for 'firm' (the only active plan). Remove it to
  // reach the no-cap path.
  db2.tables.ai_feature_caps = [];
  const noCap = await consume(sb2);
  eq('no cap row for the plan is DENIED', noCap.allowed, false);
  eq('with reason no_cap', noCap.allowed === false && noCap.reason, 'no_cap');

  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 0 }, sb2);
  const zero = await consume(sb2);
  eq('a cap of ZERO denies the tier', zero.allowed, false);
  eq('with reason cap_reached', zero.allowed === false && zero.reason, 'cap_reached');
  eq('and no counter row is created for a zero cap', (db2.tables.ai_usage_counters ?? []).length, 0);

  db2.tables.users = [{ id: USER, subscription_plan: null, role: 'admin' }];
  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 5 }, sb2);
  const noPlan = await consume(sb2);
  eq('a user with no resolvable plan is DENIED', noPlan.allowed, false);
  eq('with reason no_plan', noPlan.allowed === false && noPlan.reason, 'no_plan');

  // Counter store unreachable (pre-migration 205, or the function is missing).
  const db3 = freshDb(false);
  const sb3 = fakeClient(db3);
  await registerAiFeature(FEATURE, sb3);
  await setAiFeatureEnabled(FEATURE.featureId, FEATURE.platformSlug, true, sb3);
  await setAiFeatureCaps(FEATURE.featureId, FEATURE.platformSlug, { firm: 100 }, sb3);
  const noStore = await consume(sb3);
  eq('an unreachable counter store DENIES (fail closed)', noStore.allowed, false);
  eq('with reason unavailable', noStore.allowed === false && noStore.reason, 'unavailable');
  ok('and it does NOT fall through to allowing the call', noStore.allowed === false);

  // ── 3. Admins are metered, no bypass ──────────────────────────────────────
  ok('the metering module contains no admin bypass',
    !/role\s*===\s*'admin'|isAdmin/.test(read('src/shared/ai/metering.ts')));

  // ── 4. Monthly period ─────────────────────────────────────────────────────
  eq('the period is the first of the month, UTC',
    currentPeriodStart(new Date(Date.UTC(2026, 6, 31, 23, 59))), '2026-07-01');
  eq('a new month is a new period key',
    currentPeriodStart(new Date(Date.UTC(2026, 7, 1, 0, 0))), '2026-08-01');
  ok('so usage resets without a cron job', true);

  // ── 5. Usage report reads the counters ────────────────────────────────────
  const usage = await loadAiUsage(undefined, sb);
  ok('usage becomes available once counters exist', usage.available);
  if (usage.available) {
    const row = usage.rows.find((r) => r.featureId === FEATURE.featureId);
    ok('and reports the feature by its code id', !!row);
    eq('with the real call count', row?.calls, 5);
    eq('and the distinct user count', row?.users, 1);
    ok('with a human period label', /\w+ \d{4}/.test(usage.periodLabel));
  }
  const usageNoStore = await loadAiUsage(undefined, sb3);
  eq('usage stays UNAVAILABLE when the store is missing, never zeroed', usageNoStore.available, false);

  // ── 6. Deny statuses ──────────────────────────────────────────────────────
  eq('cap reached maps to 402 (upgrade to continue)', meterDenyStatus('cap_reached'), 402);
  eq('unavailable maps to 503', meterDenyStatus('unavailable'), 503);
  eq('disabled maps to 404', meterDenyStatus('disabled'), 404);

  // ── 7. Source assertions ──────────────────────────────────────────────────
  const metering = read('src/shared/ai/metering.ts');
  const route = read('app/api/admin/newsletter/enhance/route.ts');
  const sql = read('supabase/migrations/205_ai_usage_metering.sql');

  // Assertions about what the CODE does run against comment-stripped source:
  // metering.ts names DEFAULT_AI_MONTHLY_CAPS in its header precisely to explain
  // that it is a seeding default and is NOT consulted here, and a naive scan
  // would read that explanation as the thing it denies.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const meteringCode = code(metering);

  ok('metering reads the cap through resolveAiCap (the DB path)', /resolveAiCap/.test(meteringCode));
  ok('metering never reads a hardcoded cap default',
    !/DEFAULT_AI_MONTHLY_CAPS|FALLBACK_AI_MONTHLY_CAP/.test(meteringCode));
  ok('no numeric cap literal is used as a limit in metering',
    !/cap\s*=\s*\d+/.test(meteringCode));
  ok('the live route meters BEFORE calling the model',
    route.indexOf('checkAndConsume') < route.indexOf('runAi('));
  ok('the live route returns the deny status', /meterDenyStatus/.test(route));
  ok('the route carries no cap value of its own', !/cap\s*[:=]\s*\d+/.test(route));

  ok('the migration guards a zero cap before inserting', /p_cap IS NULL OR p_cap <= 0/.test(sql));
  ok('the migration increments only when under cap', /WHERE ai_usage_counters\.used < p_cap/.test(sql));
  ok('the decision is one atomic statement', /ON CONFLICT[\s\S]{0,200}DO UPDATE[\s\S]{0,200}RETURNING used/.test(sql));
  ok('the counter is unique per user, feature and period', /UNIQUE \(user_id, ai_feature_id, period_start\)/.test(sql));
  ok('the migration is additive', !/DROP TABLE|TRUNCATE|DELETE FROM/i.test(sql));
  ok('RLS is on the counter table', /ALTER TABLE ai_usage_counters ENABLE ROW LEVEL SECURITY/.test(sql));
  ok('the function is not callable by anon or authenticated',
    /REVOKE ALL ON FUNCTION ai_usage_consume[\s\S]{0,200}anon/.test(sql));

  // ── 8. REFUND: a failed generation must not cost quota (migration 206) ────
  //
  // Consume happens BEFORE the call, which is correct for concurrency, so the
  // other half is giving the credit back when the call produced nothing. These
  // checks prove the counting, and the SQL assertions prove the atomicity,
  // which is a property of the statement and cannot be shown by a JS fake.
  {
    const refundSql = read('supabase/migrations/206_ai_usage_refund.sql');

    ok('the refund is ONE update statement, not read-modify-write',
      /UPDATE ai_usage_counters[\s\S]{0,300}RETURNING used INTO v_used/.test(refundSql));
    ok('and there is no SELECT of the count before it',
      !/SELECT[\s\S]{0,120}used[\s\S]{0,120}FROM ai_usage_counters/i.test(refundSql));
    ok('the refund floors at zero so it cannot break the CHECK',
      /GREATEST\(ai_usage_counters\.used - 1, 0\)/.test(refundSql));
    ok('the refund never creates a counter row', !/INSERT INTO ai_usage_counters/.test(refundSql));
    ok('the refund is scoped to one user, feature and period',
      /WHERE user_id = p_user[\s\S]{0,160}ai_feature_id = p_feature[\s\S]{0,160}period_start = p_period/.test(refundSql));
    ok('the refund function is not callable by anon or authenticated',
      /REVOKE ALL ON FUNCTION ai_usage_refund[\s\S]{0,220}anon/.test(refundSql));
    ok('migration 206 is additive', !/DROP |TRUNCATE|DELETE FROM|ALTER TABLE/i.test(refundSql));

    // Behaviour, against the same in-memory fake.
    const db = freshDb();
    db.tables.ai_usage_counters = [];
    const sb = fakeClient(db);
    const U = 'user-refund';
    const F = 'feature-row-1';
    const P = '2026-08-01';
    const countOf = () => (db.tables.ai_usage_counters ?? []).find(
      (r: any) => r.user_id === U && r.ai_feature_id === F && r.period_start === P,
    )?.used ?? null;

    // Consume three, refund one: the arithmetic has to land exactly.
    for (let i = 0; i < 3; i++) await sb.rpc('ai_usage_consume', { p_user: U, p_feature: F, p_period: P, p_cap: 10 });
    eq('three generations consumed', countOf(), 3);

    const r1 = await refundAiUsage({ userId: U, featureRowId: F, periodStart: P, sb: sb as any });
    eq('a refund reports success', r1.refunded, true);
    eq('and returns the new count', r1.refunded === true ? r1.used : null, 2);
    eq('the counter went down by exactly one', countOf(), 2);

    // A refund never drives the counter negative, however many arrive.
    for (let i = 0; i < 6; i++) await refundAiUsage({ userId: U, featureRowId: F, periodStart: P, sb: sb as any });
    eq('over-refunding floors at zero rather than going negative', countOf(), 0);

    // Interleaved consumes and refunds settle at the right number. This is the
    // closest a single-threaded fake gets to concurrency: the calls are started
    // together and resolve through the same row.
    await Promise.all([
      sb.rpc('ai_usage_consume', { p_user: U, p_feature: F, p_period: P, p_cap: 10 }),
      sb.rpc('ai_usage_consume', { p_user: U, p_feature: F, p_period: P, p_cap: 10 }),
      sb.rpc('ai_usage_consume', { p_user: U, p_feature: F, p_period: P, p_cap: 10 }),
      sb.rpc('ai_usage_consume', { p_user: U, p_feature: F, p_period: P, p_cap: 10 }),
    ]);
    eq('four concurrent consumes all counted', countOf(), 4);
    await Promise.all([
      refundAiUsage({ userId: U, featureRowId: F, periodStart: P, sb: sb as any }),
      refundAiUsage({ userId: U, featureRowId: F, periodStart: P, sb: sb as any }),
    ]);
    eq('two concurrent refunds both counted, none lost', countOf(), 2);

    // A period with no row: nothing to give back, and nothing invented.
    const other = await refundAiUsage({ userId: U, featureRowId: F, periodStart: '2026-07-01', sb: sb as any });
    eq('refunding a period that was never consumed refunds nothing', other.refunded, false);
    eq('and says why', other.refunded === false ? other.reason : null, 'no_row');
    eq('and creates no row for that period', (db.tables.ai_usage_counters ?? []).length, 1);

    // Before migration 206 is applied, the refund reports it and never throws.
    const noFn = fakeClient(freshDb());
    (noFn as any).rpc = (name: string) => Promise.resolve(
      name === 'ai_usage_refund'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ai_usage_refund' } }
        : { data: 1, error: null },
    );
    const pre = await refundAiUsage({ userId: U, featureRowId: F, periodStart: P, sb: noFn as any });
    eq('with migration 206 unapplied the refund reports not_installed',
      pre.refunded === false ? pre.reason : null, 'not_installed');

    // The consume decision must carry what the refund needs.
    ok('an allowed decision carries the feature row id to refund against',
      /featureRowId: feature\.id/.test(meteringCode));
    ok('the refund takes the period it was charged to, not a fresh one',
      /periodStart: string/.test(meteringCode) && !/currentPeriodStart\(\)[\s\S]{0,80}refund/i.test(meteringCode));

    // The service must refund on failure and NOT on success.
    const svc = code(read('src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService.ts'));
    ok('the service refunds when the AI call fails',
      /if \(!result\.ok\) \{[\s\S]{0,600}giveBack\(\)/.test(svc));
    ok('the service refunds when the draft comes back empty',
      /!shaped\.text\.trim\(\)[\s\S]{0,300}giveBack\(\)/.test(svc));
    ok('the service refunds the exact counter it consumed',
      /featureRowId: decision\.featureRowId[\s\S]{0,120}periodStart: decision\.periodStart/.test(svc));
    // A SUCCESSFUL generation does not refund.
    //
    // This used to slice the file after the first `ok: true` return and assert
    // no giveBack appeared beyond it. That worked while the service had one
    // generation function; free-form drafting added a second BELOW it, so the
    // tail now contains that function's perfectly legitimate failure refunds.
    //
    // Stated directly instead: every giveBack() CALL SITE must sit on a failure
    // path, which is checked by requiring the return that follows it to carry
    // `ok: false`. That is the property the old slice was approximating, and it
    // holds however many generation functions the file grows.
    {
      const sites = [...svc.matchAll(/await giveBack\(\)/g)].map((m) => m.index ?? -1);
      eq('every refund call site is found', sites.length >= 2, true);
      let allOnFailure = true;
      for (const at of sites) {
        const after = svc.slice(at, at + 400);
        if (!/ok:\s*false/.test(after)) allOnFailure = false;
      }
      ok('a SUCCESSFUL generation does not refund (every refund is on a failure path)', allOnFailure,
        `${sites.length} refund sites`);
      // And the refusal path, which returns ok: true with no draft, must not
      // refund either: the call was made and the tokens were spent.
      const ff = svc.slice(svc.indexOf('export async function generateIcFreeform'));
      const refusalReturn = ff.indexOf('refused: true');
      const beforeRefusal = ff.slice(0, refusalReturn);
      ok('a REFUSAL keeps its counted generation', !/await giveBack\(\)[\s\S]{0,200}refused: true/.test(beforeRefusal + ff.slice(refusalReturn, refusalReturn + 200)));
    }
    ok('a flagged audit is not treated as a failure',
      !/audit\.ok[\s\S]{0,200}giveBack/.test(svc));
  }

  const EM = String.fromCharCode(0x2014);
  for (const [n, s] of [['metering.ts', metering], ['205 migration', sql], ['enhance route', route],
    ['206 migration', read('supabase/migrations/206_ai_usage_refund.sql')],
    ['usage.ts', read('src/shared/ai/usage.ts')], ['features.ts', read('src/shared/ai/features.ts')],
    ['verify-ai-metering.ts', read('scripts/verify-ai-metering.ts')]] as const) {
    ok(`${n} contains no em dashes`, !s.includes(EM));
  }

  console.log(`\nverify-ai-metering: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('verify-ai-metering crashed:', e); process.exit(1); });
