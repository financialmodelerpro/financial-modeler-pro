/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ic-narrative-feature.ts
 *
 * Registers the Module 7 IC narrative as the first REFM AI feature and pins
 * what that has to mean.
 *
 * This unit REGISTERS ONLY. Generation is Unit 7 and the buttons are Unit 8, so
 * the verifier also asserts that no generation path exists yet: the feature
 * must be inert until someone deliberately turns it on.
 *
 * Three things it proves beyond "a row was written":
 *
 *   1. The caps are the ones the spec asked for (trial 5, pro 100, firm 500)
 *      WITHOUT the definition restating them. They are seeded from the shared
 *      default across the platform's ACTIVE plans, so the requirement is pinned
 *      here rather than duplicated into a second source that could drift.
 *   2. The cap that gets ENFORCED for this feature is the database value, not a
 *      constant: editing it moves the limit for m7_ic_narrative specifically.
 *   3. The platform slug is 'real-estate'. Registering under 'refm' would render
 *      a raw slug in the admin panel and seed caps from the wrong plan list.
 *
 *   npx tsx scripts/verify-ic-narrative-feature.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IC_NARRATIVE_FEATURE, REFM_PLATFORM_SLUG, ensureRefmAiFeatures } from '../src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures';
import { resetAiFeatureRegistrationCache } from '../src/shared/ai/features';
import { getAiFeature, listAiFeatures } from '../src/shared/ai/registry';
import { setAiFeatureCaps, setAiFeatureEnabled } from '../src/shared/ai/registryAdmin';
import { checkAndConsume } from '../src/shared/ai/metering';
import { PLATFORMS } from '../src/hubs/modeling/config/platforms';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = '') => { if (c) { pass++; return; } fail++; console.error(`FAIL ${l}${d ? ` :: ${d}` : ''}`); };
const eq = (l: string, a: unknown, b: unknown) => ok(`${l} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`, a === b);
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── In-memory database fake, with ai_usage_consume matching migration 205 ───
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;
interface FakeDb { tables: Record<string, Row[] | undefined> }
let seq = 0;
const nextId = () => `uuid-${++seq}`;

function exec(db: FakeDb, table: string, s: any) {
  const rows = db.tables[table];
  if (rows === undefined) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  const match = (r: Row) => s.filters.every((f: Pred) => f(r));
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
      const s: any = { op: 'select', filters: [], payload: null, opts: null };
      const b: any = {
        select() { return b; },
        insert(p: unknown) { s.op = 'insert'; s.payload = p; return b; },
        update(p: unknown) { s.op = 'update'; s.payload = p; return b; },
        upsert(p: unknown, o: any) { s.op = 'upsert'; s.payload = p; s.opts = o; return b; },
        eq(c: string, v: unknown) { s.filters.push((r: Row) => r[c] === v); return b; },
        in(c: string, vs: unknown[]) { s.filters.push((r: Row) => vs.includes(r[c])); return b; },
        maybeSingle() { return Promise.resolve(exec(db, table, s)).then((r: any) => r.error ? r : { data: (r.data ?? [])[0] ?? null, error: null }); },
        order() { return b; }, limit() { return b; }, range() { return b; },
        then(res: any, rej?: any) { return Promise.resolve(exec(db, table, s)).then(res, rej); },
      };
      return b;
    },
    rpc(name: string, a: any) {
      if (name !== 'ai_usage_consume') return Promise.resolve({ data: null, error: { message: 'unknown fn' } });
      if (a.p_cap === null || a.p_cap === undefined || a.p_cap <= 0) return Promise.resolve({ data: null, error: null });
      const rows = db.tables.ai_usage_counters!;
      const hit = rows.find((r) => r.user_id === a.p_user && r.ai_feature_id === a.p_feature && r.period_start === a.p_period);
      if (!hit) { rows.push({ id: nextId(), user_id: a.p_user, ai_feature_id: a.p_feature, period_start: a.p_period, used: 1 }); return Promise.resolve({ data: 1, error: null }); }
      if ((hit.used as number) < a.p_cap) { hit.used = (hit.used as number) + 1; return Promise.resolve({ data: hit.used, error: null }); }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const USER = 'user-1';
/** Mirrors production: solo exists but is INACTIVE, so it seeds no cap. */
const freshDb = (): FakeDb => ({
  tables: {
    ai_features: [], ai_feature_caps: [], ai_usage_counters: [],
    entitlement_plans: [
      { plan_key: 'solo', platform_slug: 'real-estate', active: false },
      { plan_key: 'trial', platform_slug: 'real-estate', active: true },
      { plan_key: 'pro', platform_slug: 'real-estate', active: true },
      { plan_key: 'firm', platform_slug: 'real-estate', active: true },
    ],
    users: [{ id: USER, subscription_plan: 'firm', role: 'user' }],
  },
});

async function main() {
  // ── 1. The definition ─────────────────────────────────────────────────────
  eq('feature id', IC_NARRATIVE_FEATURE.featureId, 'm7_ic_narrative');
  eq('category is narrative (it interprets, it does not create facts)', IC_NARRATIVE_FEATURE.category, 'narrative');
  eq('grounded in the model only', IC_NARRATIVE_FEATURE.grounding.join(','), 'model');
  eq('platform slug is real-estate, NOT the shortName refm', IC_NARRATIVE_FEATURE.platformSlug, 'real-estate');
  eq('the exported slug constant agrees', REFM_PLATFORM_SLUG, 'real-estate');
  ok('and that slug resolves in the platform catalog, so the panel groups it under a real label',
    PLATFORMS.some((p) => p.slug === IC_NARRATIVE_FEATURE.platformSlug));
  ok('it has a description for the panel', !!IC_NARRATIVE_FEATURE.description);
  ok('the definition does NOT restate the caps (one source for the defaults)',
    IC_NARRATIVE_FEATURE.defaultCaps === undefined);
  ok('and does not ask to start enabled', IC_NARRATIVE_FEATURE.enabledOnCreate !== true);

  // ── 2. Registration ───────────────────────────────────────────────────────
  const db = freshDb();
  const sb = fakeClient(db);
  resetAiFeatureRegistrationCache();
  await ensureRefmAiFeatures(sb);

  const f = await getAiFeature('m7_ic_narrative', 'real-estate', sb);
  ok('the feature is registered', !!f);
  eq('it registers DISABLED, so enabling it is a deliberate act', f?.enabled, false);
  eq('name carried through', f?.name, 'IC narrative');
  eq('category carried through', f?.category, 'narrative');
  eq('grounding carried through', f?.grounding.join(','), 'model');

  // ── 3. THE CAPS, seeded not hardcoded ─────────────────────────────────────
  eq('trial cap is 5', f?.caps.trial, 5);
  eq('pro cap is 100', f?.caps.pro, 100);
  eq('firm cap is 500', f?.caps.firm, 500);
  eq('an INACTIVE plan seeds no cap row', f?.caps.solo, undefined);
  eq('exactly three caps, one per active plan', Object.keys(f?.caps ?? {}).length, 3);

  // ── 4. It appears in the panel automatically ──────────────────────────────
  const refmList = await listAiFeatures('real-estate', sb);
  ok('it appears in the REFM panel group',
    refmList.features.some((x) => x.featureId === 'm7_ic_narrative'));
  const ermList = await listAiFeatures('equity-research', sb);
  ok('and does NOT leak into another platform',
    !ermList.features.some((x) => x.featureId === 'm7_ic_narrative'));

  // Re-registration must not undo an admin's work.
  await setAiFeatureEnabled('m7_ic_narrative', 'real-estate', true, sb);
  await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { firm: 25 }, sb);
  resetAiFeatureRegistrationCache();
  await ensureRefmAiFeatures(sb);
  const after = await getAiFeature('m7_ic_narrative', 'real-estate', sb);
  eq('an admin ENABLE survives re-registration', after?.enabled, true);
  eq('an admin CAP edit survives re-registration', after?.caps.firm, 25);
  eq('and no duplicate feature row was created', (db.tables.ai_features ?? []).length, 1);

  // ── 5. Metered against the DB cap, not a constant ─────────────────────────
  const consume = () => checkAndConsume({ userId: USER, featureId: 'm7_ic_narrative', platformSlug: 'real-estate', sb });
  await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { firm: 2 }, sb);

  const c1 = await consume(); const c2 = await consume(); const c3 = await consume();
  eq('IC narrative call 1 allowed under a cap of 2', c1.allowed, true);
  eq('call 2 allowed', c2.allowed, true);
  eq('call 3 BLOCKED at the cap', c3.allowed, false);
  eq('blocked with cap_reached', c3.allowed === false && c3.reason, 'cap_reached');
  eq('the enforced cap is the DB value', c2.allowed && c2.cap, 2);

  await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { firm: 3 }, sb);
  const c4 = await consume();
  eq('raising the cap in the panel immediately raises the limit', c4.allowed, true);
  eq('and reports the NEW cap', c4.allowed && c4.cap, 3);

  // Disabled means denied, whatever the cap says.
  await setAiFeatureEnabled('m7_ic_narrative', 'real-estate', false, sb);
  const off = await consume();
  eq('switching it OFF denies generation', off.allowed, false);
  eq('with reason disabled', off.allowed === false && off.reason, 'disabled');

  // ── 6. This unit registers ONLY: no generation exists yet ─────────────────
  const src = read('src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures.ts');
  ok('the registration module does not call the model', !/runAi|buildGroundedRequest/.test(src));
  ok('no IC narrative generation route exists yet (Unit 7)',
    !/m7_ic_narrative/.test(read('app/api/admin/ai-features/route.ts')));

  // ── 7. Boundaries ─────────────────────────────────────────────────────────
  ok('the shared foundation still imports no platform',
    !/hubs\/modeling|platforms\/refm/.test(read('src/shared/ai/features.ts'))
    && !/hubs\/modeling|platforms\/refm/.test(read('src/shared/ai/registry.ts')));
  const route = read('app/api/admin/ai-features/route.ts');
  ok('the ROUTE is the composition layer that pulls both together',
    /ensureBuiltInAiFeatures/.test(route) && /ensureRefmAiFeatures/.test(route));
  ok('and it registers BEFORE listing, so a declared feature shows up',
    route.indexOf('ensureRefmAiFeatures()') < route.indexOf('listAiFeatures(platform)'));

  const EM = String.fromCharCode(0x2014);
  for (const [n, s] of [['refmAiFeatures.ts', src], ['ai-features route', route],
    ['verify-ic-narrative-feature.ts', read('scripts/verify-ic-narrative-feature.ts')]] as const) {
    ok(`${n} contains no em dashes`, !s.includes(EM));
  }

  console.log(`\nverify-ic-narrative-feature: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('verify-ic-narrative-feature crashed:', e); process.exit(1); });
